'use strict';

// Brownfield scout machinery: scout-and-inventory pass, then create all
// artifacts, then re-enter where state says. Scope-neutral — scout
// inventories whatever is there, makes no keep/drop decisions itself.
// Three writers, one shared law: every inherited fact this module records
// about a target repo carries one of validators.js's two trust flags
// (reuse-map.json) or goes through validators.validateScoutConstraints
// (constraints.json) before it reaches disk — inherited material never
// lands in a decision artifact unflagged.
//
// treeRoot vs. projectRoot, matching this codebase's existing convention
// (milestones.js/verification.js/phases.js): treeRoot is the
// `.kiln` directory itself; projectRoot is the target repo it lives
// inside of. inventoryTarget is the one function here that walks the TARGET
// repo, so it takes projectRoot and derives treeRoot internally;
// writeReuseMap/writeConstraints only ever touch the tree, so they take
// treeRoot directly, like every other writer in this codebase.
//
// None of the three writers may skip checking what they are writing
// through: a pre-planted `scout/` symlink must never let any of them land
// its output outside the target tree, and writeReuseMap must never accept
// claims naming files that were never walked or no longer exist. Every
// writer runs entries through ensureScoutDir (below) before touching
// `scout/`, and writeReuseMap revalidates each entry's path against the
// recorded inventory and the disk itself before it ever reaches
// reuse-map.json.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { readJson, writeAtomic } = require('./atomic-json.js');
const validators = require('./validators.js');

const TREE_NAME = '.kiln';
const SCHEMA_VERSION = 1;
const DEFAULT_MAX_ENTRIES = 5000;

// node_modules is skipped by name; .git and every other dot-directory
// (including the target's own .kiln/, preventing a scout run from
// inventorying its own prior output) are skipped by the leading-dot check
// in walk(), below.
const SKIP_DIR_NAMES = new Set(['node_modules']);

const EXT_LANG = {
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.swift': 'swift',
  '.sh': 'shell',
  '.bash': 'shell',
  '.json': 'json',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.toml': 'toml',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.sql': 'sql',
  '.xml': 'xml',
  '.txt': 'text',
};

// A small set of conventional extensionless filenames a plain extension map
// can't cover.
const EXTENSIONLESS_LANG = {
  Dockerfile: 'docker',
  Makefile: 'make',
  Gemfile: 'ruby',
  Rakefile: 'ruby',
};

const TEST_DIR_NAMES = new Set(['test', 'tests', '__tests__', '__test__', 'spec', 'specs', 'e2e']);

// Common conventional entrypoint filenames, checked for existence against
// the walked file list in addition to whatever package.json states — a
// small, named heuristic, not a language registry.
const COMMON_ENTRY_CANDIDATES = ['index.js', 'index.mjs', 'index.ts', 'main.py', 'app.py', 'main.go', 'src/main.rs', 'Main.java'];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// One lowercase basename, and nothing else. This single regex is what
// makes `name` unable to name anything but a
// direct child of treeRoot: it rejects an absolute path, `.`, `..`, a
// separator in either direction, the empty string, a leading dot, and an
// uppercase letter — so no caller can reach a parent, a nested path, or a
// hidden directory through this guard.
const TREE_SUBDIR_NAME_RE = /^[a-z][a-z0-9-]*$/;

// ensureTreeSubdir(treeRoot, name) -> the `<treeRoot>/<name>` directory's
// path, verified to already sit inside treeRoot with no symlink hop —
// generalized from `scout/` to any one tree subdirectory. atomic-json.js's
// writeAtomic does `fs.mkdirSync(dir, {recursive:true})` on whatever parent
// it is handed — symlink or real directory alike — before it ever opens the
// destination file, so a pre-planted `scout/` (or `intake/`) symlink
// pointing outside the target tree would silently redirect every one of
// that namespace's writers there. ONE guard, called by every writer before
// its writeAtomic call (never a second copy of this check in another
// module — `intake.js` is a CALLER of this function, not a reimplementation
// of it): requires treeRoot to already exist (scaffoldTree/detect create it
// ahead of scout in the brownfield sequence — product/brownfield/flow.md's
// detect -> scaffold -> scout order — and intake's own transaction ladder
// scaffolds it before the harvest; this module never invents its own tree
// root), refuses outright if the subdirectory is already a symlink,
// creates it if genuinely missing, then re-resolves it and refuses unless
// the resolved path still sits under the resolved tree root.
function ensureTreeSubdir(treeRoot, name) {
  if (typeof name !== 'string' || !TREE_SUBDIR_NAME_RE.test(name)) {
    throw new Error(
      `scout: refusing to ensure ${JSON.stringify(name)} — a tree subdirectory name must be one lowercase basename matching ${TREE_SUBDIR_NAME_RE}`
    );
  }
  // lstat, not existsSync: a symlinked treeRoot was RESOLVED here rather than
  // refused, so a caller handed one created the subdirectory inside whatever
  // the link pointed at — the exact redirection this guard exists to stop,
  // reached one level up from the name it checks. Every caller in the machine
  // happens to validate its own root first; the exported guard must not
  // depend on that.
  let rootLst;
  try {
    rootLst = fs.lstatSync(treeRoot);
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error(`scout: treeRoot does not exist: ${treeRoot}`);
    throw err;
  }
  if (rootLst.isSymbolicLink()) {
    throw new Error(`scout: refusing to ensure a subdirectory under a symlinked treeRoot: ${treeRoot}`);
  }
  if (!rootLst.isDirectory()) {
    throw new Error(`scout: treeRoot is not a directory: ${treeRoot}`);
  }
  const realTreeRoot = fs.realpathSync(treeRoot);
  const subDir = path.join(treeRoot, name);

  let lst;
  try {
    lst = fs.lstatSync(subDir);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    lst = null;
  }
  if (lst && lst.isSymbolicLink()) {
    throw new Error(`scout: refusing to write through symlink at ${subDir}`);
  }

  fs.mkdirSync(subDir, { recursive: true });

  const realSubDir = fs.realpathSync(subDir);
  if (realSubDir !== realTreeRoot && !realSubDir.startsWith(realTreeRoot + path.sep)) {
    throw new Error(`scout: ${subDir} resolves outside treeRoot ${treeRoot} (escaped to ${realSubDir})`);
  }

  return subDir;
}

function ensureScoutDir(treeRoot) {
  return ensureTreeSubdir(treeRoot, 'scout');
}

function langOf(basename) {
  if (Object.prototype.hasOwnProperty.call(EXTENSIONLESS_LANG, basename)) {
    return EXTENSIONLESS_LANG[basename];
  }
  const ext = path.extname(basename).toLowerCase();
  return EXT_LANG[ext] || 'other';
}

// Recursive walk, never following symlinks (loop risk — the same defense
// detect.js's hasProjectMaterial uses). Collects every file and every
// directory reached under root into the caller-supplied arrays, skipping
// node_modules and any dot-directory at every level.
function walk(dir, files, dirs) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    if (entry.isSymbolicLink()) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      dirs.push(abs);
      walk(abs, files, dirs);
    } else if (entry.isFile()) {
      files.push(abs);
    }
  }
}

function toRelPosix(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/');
}

function isGitRepo(projectRoot) {
  const res = spawnSync('git', ['-C', projectRoot, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  return res.status === 0 && res.stdout.trim() === 'true';
}

function commitCountOf(projectRoot) {
  const res = spawnSync('git', ['-C', projectRoot, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' });
  if (res.status !== 0) return undefined;
  const n = Number.parseInt(res.stdout.trim(), 10);
  return Number.isInteger(n) ? n : undefined;
}

function readPackageJson(projectRoot) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// A package.json main/bin string is untrusted target-repo content:
// `agents/scout-agent.md:31` commands the agent to read every entry_points
// value in full, so an unnormalized/uncontained value would become an
// instructed read target outside the project (`../../secret`,
// `/etc/passwd`) the moment it reaches this summary. Returns the candidate's
// own normalized, posix-relative form when it is safe to return at all:
// non-absolute, no ".." segment before or after normalization, actually
// present in the files the walk just inventoried (relFiles/knownRelFiles —
// the same inventory-membership discipline writeReuseMap already applies to
// its own path claims, applied here at read time instead of write time), and
// still present on disk. Returns null otherwise — the candidate is dropped,
// never returned as a read target.
function normalizedContainedEntryPoint(candidate, projectRoot, knownRelFiles) {
  if (!isNonEmptyString(candidate)) return null;
  const posixCandidate = candidate.split(path.sep).join('/');
  if (path.posix.isAbsolute(posixCandidate)) return null;
  if (posixCandidate.split('/').includes('..')) return null;
  const normalized = path.posix.normalize(posixCandidate);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    return null;
  }
  if (!knownRelFiles.has(normalized)) return null;
  if (!fs.existsSync(path.join(projectRoot, normalized))) return null;
  return normalized;
}

// entry_points — package.json main/bin (string or {name: path} object form)
// plus whichever COMMON_ENTRY_CANDIDATES the walk actually found, deduped
// and sorted. package.json-derived candidates are dropped, silently and
// individually, unless normalizedContainedEntryPoint accepts them —
// COMMON_ENTRY_CANDIDATES need no separate check since membership in `known`
// already proves containment and presence.
function entryPointsOf(projectRoot, relFiles) {
  const points = [];
  const pkg = readPackageJson(projectRoot);
  if (pkg) {
    if (isNonEmptyString(pkg.main)) points.push(pkg.main);
    if (isNonEmptyString(pkg.bin)) {
      points.push(pkg.bin);
    } else if (pkg.bin !== null && typeof pkg.bin === 'object' && !Array.isArray(pkg.bin)) {
      for (const target of Object.values(pkg.bin)) {
        if (isNonEmptyString(target)) points.push(target);
      }
    }
  }
  const known = new Set(relFiles);
  const safePoints = [];
  for (const candidate of points) {
    const normalized = normalizedContainedEntryPoint(candidate, projectRoot, known);
    if (normalized !== null) safePoints.push(normalized);
  }
  for (const candidate of COMMON_ENTRY_CANDIDATES) {
    if (known.has(candidate)) safePoints.push(candidate);
  }
  return [...new Set(safePoints)].sort();
}

function testDirsOf(relDirs) {
  return relDirs.filter((d) => TEST_DIR_NAMES.has(path.basename(d))).sort();
}

// inventoryTarget(projectRoot, opts) -> {schema_version, generated_ts,
// files[], summary{}, truncated} — scout/inventory.json's own existing
// assets map. Walks the TARGET repo (never its own
// .kiln/), atomic-writes the result to
// <projectRoot>/.kiln/scout/inventory.json, and returns the same
// document. opts.maxEntries (default 5000) is a breadth cap: the full file
// list is sorted first (deterministic ordering, path order) and only then
// capped, so a truncated inventory is always the sorted prefix, never an
// arbitrary subset — and `truncated` is set honestly rather than silently
// dropping the excess. Requires <projectRoot>/.kiln to already
// exist and derives treeRoot from it, then runs that treeRoot through
// ensureScoutDir before ever walking the target — the same containment
// guard writeReuseMap/writeConstraints use, applied here too since this is
// the writer that would otherwise create scout/ through whatever a
// pre-planted symlink pointed at.
function inventoryTarget(projectRoot, opts = {}) {
  if (!isNonEmptyString(projectRoot)) {
    throw new TypeError('scout: projectRoot must be a non-empty string');
  }
  if (!fs.existsSync(projectRoot)) {
    throw new Error(`scout: projectRoot does not exist: ${projectRoot}`);
  }
  const maxEntries = Object.prototype.hasOwnProperty.call(opts, 'maxEntries') ? opts.maxEntries : DEFAULT_MAX_ENTRIES;
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new TypeError('scout: opts.maxEntries must be a positive integer');
  }

  const treeRoot = path.join(projectRoot, TREE_NAME);
  ensureScoutDir(treeRoot);

  const absFiles = [];
  const absDirs = [];
  walk(projectRoot, absFiles, absDirs);

  const relFiles = absFiles.map((f) => toRelPosix(projectRoot, f)).sort();
  const relDirs = absDirs.map((d) => toRelPosix(projectRoot, d)).sort();

  const truncated = relFiles.length > maxEntries;
  const keptRelFiles = truncated ? relFiles.slice(0, maxEntries) : relFiles;

  const files = keptRelFiles.map((relPath) => {
    const stat = fs.statSync(path.join(projectRoot, relPath));
    return { path: relPath, lang: langOf(path.basename(relPath)), bytes: stat.size };
  });

  const by_lang = {};
  for (const f of files) {
    by_lang[f.lang] = (by_lang[f.lang] || 0) + 1;
  }

  const has_git = isGitRepo(projectRoot);
  const summary = {
    by_lang,
    entry_points: entryPointsOf(projectRoot, relFiles),
    test_dirs: testDirsOf(relDirs),
    has_git,
  };
  if (has_git) {
    const commit_count = commitCountOf(projectRoot);
    if (commit_count !== undefined) summary.commit_count = commit_count;
  }

  const inventory = {
    schema_version: SCHEMA_VERSION,
    generated_ts: new Date().toISOString(),
    files,
    summary,
    truncated,
  };

  writeAtomic(path.join(treeRoot, 'scout', 'inventory.json'), inventory);
  return inventory;
}

// writeReuseMap(treeRoot, entries) -> the written document. Every entry
// {path, trust, note} maps one inventory item to the artifact slot it feeds
// and the trust flag it carries there — checked inline against
// validators.js's TRUST_FLAGS taxonomy since reuse-map.json has no
// dedicated validators.js function of its own (constraints.json is the one
// scout artifact that does — see writeConstraints, below).
//
// Shape-valid is not the same as real. After every entry passes the
// structural checks above, a second pass
// revalidates each entry.path against two independent sources of truth
// before any of them reach disk — the recorded scout/inventory.json (so a
// reuse claim can never name a file the walk never saw) and the project
// filesystem itself (so a claim can never survive a file being deleted out
// from under it between inventory and reuse-map time). Containment
// (relative, no traversal, stays under projectRoot) is checked first since
// an entry that escapes the project has no business being looked up in the
// inventory at all.
function writeReuseMap(treeRoot, entries) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('scout: treeRoot must be a non-empty string');
  }
  if (!Array.isArray(entries)) {
    throw new TypeError('scout: entries must be an array');
  }

  const errors = [];
  entries.forEach((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`entries[${index}] must be an object`);
      return;
    }
    if (!isNonEmptyString(entry.path)) errors.push(`entries[${index}].path must be a non-empty string`);
    if (!validators.TRUST_FLAGS.has(entry.trust)) {
      errors.push(`entries[${index}].trust must be one of ${[...validators.TRUST_FLAGS].join(', ')}`);
    }
    if (!isNonEmptyString(entry.note)) errors.push(`entries[${index}].note must be a non-empty string`);
  });
  if (errors.length > 0) {
    throw new TypeError(`scout: writeReuseMap refuses malformed entries (${errors.join('; ')})`);
  }

  ensureScoutDir(treeRoot);

  const inventoryPath = path.join(treeRoot, 'scout', 'inventory.json');
  const inventory = readJson(inventoryPath, null);
  if (!isPlainObject(inventory) || !Array.isArray(inventory.files)) {
    throw new Error(
      `scout: writeReuseMap requires ${inventoryPath} to already exist (run inventoryTarget first) — reuse claims without an inventory are unverifiable`
    );
  }
  const inventoried = new Set(
    inventory.files.filter((f) => isPlainObject(f) && isNonEmptyString(f.path)).map((f) => f.path)
  );

  const projectRoot = path.dirname(treeRoot);
  const traceErrors = [];
  entries.forEach((entry, index) => {
    const relPath = entry.path;
    if (path.isAbsolute(relPath)) {
      traceErrors.push(`entries[${index}].path "${relPath}" must be relative, not absolute`);
      return;
    }
    if (relPath.split('/').includes('..')) {
      traceErrors.push(`entries[${index}].path "${relPath}" must not contain a ".." segment`);
      return;
    }
    const normalized = path.posix.normalize(relPath);
    if (normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
      traceErrors.push(`entries[${index}].path "${relPath}" normalizes outside the project (${normalized})`);
      return;
    }
    if (!inventoried.has(relPath)) {
      traceErrors.push(`entries[${index}].path "${relPath}" is not present in ${inventoryPath}`);
      return;
    }
    if (!fs.existsSync(path.join(projectRoot, relPath))) {
      traceErrors.push(`entries[${index}].path "${relPath}" no longer exists on disk under ${projectRoot}`);
    }
  });
  if (traceErrors.length > 0) {
    throw new Error(`scout: writeReuseMap refuses unverifiable entries (${traceErrors.join('; ')})`);
  }

  const sorted = entries.slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const reuseMap = {
    schema_version: SCHEMA_VERSION,
    generated_ts: new Date().toISOString(),
    entries: sorted,
  };

  writeAtomic(path.join(treeRoot, 'scout', 'reuse-map.json'), reuseMap);
  return reuseMap;
}

// writeConstraints(treeRoot, constraints) -> the written document.
// constraints.json's five typed fields go through
// validators.validateScoutConstraints before they ever reach disk — the
// sole gate, never re-implemented here.
function writeConstraints(treeRoot, constraints) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('scout: treeRoot must be a non-empty string');
  }
  const { ok, errors } = validators.validateScoutConstraints(constraints);
  if (!ok) {
    throw new TypeError(`scout: writeConstraints refuses malformed constraints (${errors.join('; ')})`);
  }
  ensureScoutDir(treeRoot);
  writeAtomic(path.join(treeRoot, 'scout', 'constraints.json'), constraints);
  return constraints;
}

// CLI entrypoint: invoking `inventoryTarget` must never depend on a
// cwd-relative `node -e` require, which breaks under the plugin layout, or
// a false "from the project root" assertion. writeReuseMap/writeConstraints
// need their own executable forms too — agents/scout-agent.md's own
// reading/authoring judgment over their `entries`/`constraints` arguments
// arrives as one stdin-JSON argument, the same shape this tree's other
// structured-input CLIs already take. `inventory <projectRoot>
// [maxEntries]`, `write-reuse-map <treeRoot>` (entries JSON array via
// stdin), and `write-constraints <treeRoot>` (constraints JSON object via
// stdin).
function parseArgv(argv) {
  const [command, ...rest] = argv;
  return { command, rest };
}

const USAGE =
  'usage: scout.js inventory <projectRoot> [maxEntries]\n' +
  '       scout.js write-reuse-map <treeRoot>   (entries JSON array via stdin)\n' +
  '       scout.js write-constraints <treeRoot>   (constraints JSON object via stdin)\n';

function readStdinJson(label) {
  const text = fs.readFileSync(0, 'utf8'); // fd 0 = stdin
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${label}: JSON via stdin is not valid JSON: ${err.message}`);
  }
}

function main(argv) {
  const { command, rest } = parseArgv(argv);

  if (command === 'inventory') {
    const [projectRoot, maxEntriesArg] = rest;
    if (typeof projectRoot !== 'string' || projectRoot === '') {
      process.stderr.write(USAGE);
      process.exit(1);
    }
    try {
      const opts = {};
      if (maxEntriesArg !== undefined) {
        // Number.parseInt accepts a numeric prefix and silently discards
        // trailing garbage ("1garbage" -> 1). A strict all-digits match is
        // required before parsing, matching inventoryTarget's own strict
        // Number.isInteger check on the parsed opts.maxEntries value one
        // level down.
        if (!/^\d+$/.test(maxEntriesArg)) {
          throw new TypeError(`scout: maxEntries must be a non-negative integer string (got ${JSON.stringify(maxEntriesArg)})`);
        }
        opts.maxEntries = Number.parseInt(maxEntriesArg, 10);
      }
      const inventory = inventoryTarget(projectRoot, opts);
      console.log(JSON.stringify(inventory, null, 2));
    } catch (err) {
      process.stderr.write(`scout.js: ${err.message}\n`);
      process.exit(1);
    }
    return;
  }

  // write-reuse-map/write-constraints: agents/scout-agent.md's own
  // writeReuseMap/writeConstraints calls, each taking its own single
  // stdin-JSON argument — the entries array or the constraints object,
  // respectively, exactly as the library functions themselves take them.
  if (command === 'write-reuse-map' || command === 'write-constraints') {
    const [treeRoot] = rest;
    if (typeof treeRoot !== 'string' || treeRoot === '') {
      process.stderr.write(USAGE);
      process.exit(1);
    }
    try {
      const body = readStdinJson(command);
      const result = command === 'write-reuse-map' ? writeReuseMap(treeRoot, body) : writeConstraints(treeRoot, body);
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      process.stderr.write(`scout.js: ${err.message}\n`);
      process.exit(1);
    }
    return;
  }

  process.stderr.write(USAGE);
  process.exit(1);
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { inventoryTarget, writeReuseMap, writeConstraints, ensureTreeSubdir };
