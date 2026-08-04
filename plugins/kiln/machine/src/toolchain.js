'use strict';

// Target-project toolchain scaffolding: hybrid ownership, zero new
// artifacts on the .kiln/ tree, one closed enum on
// `architecture/milestones.json` (`toolchain_profile`, validated by
// validators.js), one gate. The profile -> action mapping itself is
// versioned PRODUCT code — product code describing external tools that
// change over time, not target-project data — shipped as
// `machine/toolchain-profiles.json`, the same data-as-code pattern
// `machine/phases-registry.json` already establishes for phase sequencing,
// rather than a hand-written switch statement duplicating the same three
// facts per profile in JS.
//
// Version pinning is deliberately NOT this module's concern: the target
// project's own package manager resolves and commits versions to its own
// lockfile — that lockfile is the pin of record. This module only detects
// the manager, composes the install command, and probes whether a profile
// is already satisfied; it never runs an install itself (that stays
// check-honesty.js's runGate, the one sanctioned command-execution-plus-
// evidence mechanism — never duplicated here).

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_PROFILES_PATH = path.join(__dirname, '..', 'toolchain-profiles.json');

// The closed set this module supports: node-web (Playwright, hybrid-
// installed), node-cli (node:test, zero-install), python-pytest (pytest,
// venv+pip). A milestones.json `toolchain_profile` value of `null` ("nothing
// needed") is validated by validators.js directly — it is a value the field
// carries, never a member of this registry.
const PROFILE_IDS = new Set(['node-web', 'node-cli', 'python-pytest']);

// Lockfile-first package-manager detection: the shared algorithm behind
// detect-package-manager/package-manager-detector.
const KNOWN_PACKAGE_MANAGERS = new Set(['npm', 'yarn', 'pnpm', 'bun']);

const LOCKFILE_MANAGERS = [
  ['package-lock.json', 'npm'],
  ['yarn.lock', 'yarn'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['bun.lockb', 'bun'],
];

// {pm}_install_dev — the per-manager "add a devDependency" verb the
// node-web profile's `{pm_install_dev}` template placeholder substitutes.
const PM_INSTALL_DEV_PREFIX = {
  npm: 'npm install --save-dev',
  yarn: 'yarn add --dev',
  pnpm: 'pnpm add --save-dev',
  bun: 'bun add --dev',
};

// {pm}_exec — the per-manager "run a package's bin without a project-local
// install" verb the node-web profile's `{pm_exec}` placeholder substitutes,
// for the Playwright browser-install half of the same command: the
// browser-install half must track the detected manager, never a hardcoded
// `npx` regardless of it. This is a distinct concern from the product law
// that JOURNEY SCRIPTS run via `npx playwright` only, never the Playwright
// MCP tool (implementer-sol.md/implementer-opus.md) — that law is about
// avoiding the MCP tool at journey-run time, unrelated to which package
// manager owns the one-time browser binary download composed here.
const PM_EXEC_PREFIX = {
  npm: 'npx',
  yarn: 'yarn dlx',
  pnpm: 'pnpm dlx',
  bun: 'bunx',
};

// PATH-probe fallback order (lockfile, then `packageManager`, then PATH) —
// npm first since Node itself ships it, then
// the three alternate managers in the same order LOCKFILE_MANAGERS lists
// them.
const PATH_PROBE_ORDER = ['npm', 'yarn', 'pnpm', 'bun'];

const PROFILE_ENTRY_FIELDS = [
  'scaffolds',
  'install_cmd_template',
  'suite_cmd_template',
  'probe_cmd',
  'reporter_flags',
];

function isNonEmptyString(value) {
  return typeof value === 'string' && value !== '';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// validateProfiles(registry) -> {ok, errors[]}. Never throws (same "hostile
// input" discipline validators.js's own validateEnvelope/validateBrief
// apply) — the structural floor for `machine/toolchain-profiles.json`:
// schema_version 1, a `profiles` object declaring EXACTLY the PROFILE_IDS
// keys (no missing, no unexpected extra), each entry carrying all four
// PROFILE_ENTRY_FIELDS in their required shapes.
function validateProfiles(registry) {
  try {
    return validateProfilesChecked(registry);
  } catch (err) {
    return { ok: false, errors: [`toolchain profiles could not be inspected: ${err.message}`] };
  }
}

function validateProfilesChecked(registry) {
  if (!isPlainObject(registry)) {
    return { ok: false, errors: ['toolchain profiles document must be a plain object'] };
  }
  const errors = [];
  if (registry.schema_version !== 1) {
    errors.push('toolchain profiles "schema_version" must be 1');
  }
  if (!isPlainObject(registry.profiles)) {
    errors.push('toolchain profiles "profiles" must be an object');
    return { ok: false, errors };
  }

  const declaredKeys = Object.keys(registry.profiles);
  for (const id of PROFILE_IDS) {
    if (!declaredKeys.includes(id)) {
      errors.push(`toolchain profiles is missing required profile "${id}"`);
    }
  }
  for (const key of declaredKeys) {
    if (!PROFILE_IDS.has(key)) {
      errors.push(`toolchain profiles declares unexpected profile "${key}"`);
      continue;
    }
    const entry = registry.profiles[key];
    if (!isPlainObject(entry)) {
      errors.push(`toolchain profiles["${key}"] must be an object`);
      continue;
    }
    for (const field of PROFILE_ENTRY_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(entry, field)) {
        errors.push(`toolchain profiles["${key}"] is missing required field "${field}"`);
        continue;
      }
      if (field === 'scaffolds' || field === 'reporter_flags') {
        if (!Array.isArray(entry[field])) {
          errors.push(`toolchain profiles["${key}"].${field} must be an array`);
        }
      } else if (!isNonEmptyString(entry[field])) {
        errors.push(`toolchain profiles["${key}"].${field} must be a non-empty string`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

// loadProfiles(profilesPath?) — reads + validates the profile registry,
// defaulting to the shipped `machine/toolchain-profiles.json`. Fails closed:
// a registry that doesn't pass validateProfiles throws rather than handing
// callers a partially-usable object (the same "loadRegistry never returns
// something it hasn't checked" discipline phases.js's own loader follows).
function loadProfiles(profilesPath) {
  const file = profilesPath || DEFAULT_PROFILES_PATH;
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`toolchain: could not read profiles registry at ${file}: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`toolchain: profiles registry at ${file} is not valid JSON: ${err.message}`);
  }
  const { ok, errors } = validateProfiles(parsed);
  if (!ok) {
    throw new Error(`toolchain: profiles registry at ${file} failed validation: ${errors.join('; ')}`);
  }
  return parsed;
}

function assertKnownProfileId(profileId) {
  if (typeof profileId !== 'string' || !PROFILE_IDS.has(profileId)) {
    throw new TypeError(
      `toolchain: profileId must be one of ${[...PROFILE_IDS].join(', ')} (got ${JSON.stringify(profileId)})`
    );
  }
}

// The default PATH prober: `which <manager>` (POSIX) / `where <manager>`
// (Windows), true iff it exits 0. Never throws — a missing shell utility or
// an unreadable PATH is itself just "not found," the same fail-quiet-to-null
// posture the lockfile/packageManager checks above already take.
function defaultPathProbe(manager) {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(cmd, [manager], { encoding: 'utf8' });
  return result.error === undefined && result.status === 0;
}

// PATH-probe fallback (the third detection tier): without it, a fresh Node
// target with npm on PATH but no lockfile or `packageManager` field could
// never preflight node-web at all. Tried only when neither a lockfile nor a
// declared `packageManager` field named anything — never as a replacement
// for an explicitly-declared-but-unrecognized `packageManager` value, which
// stays its own distinct null (a project that named a manager this registry
// doesn't know should not silently get some OTHER manager substituted for
// it). `opts.pathProbe(manager) -> boolean` is injectable for deterministic
// tests; defaults to defaultPathProbe.
function detectFromPath(_dir, opts, noDeclarationReason) {
  const pathProbe = typeof opts.pathProbe === 'function' ? opts.pathProbe : defaultPathProbe;
  for (const manager of PATH_PROBE_ORDER) {
    if (pathProbe(manager)) {
      return { pm: manager, reason: `${noDeclarationReason}; found "${manager}" on PATH` };
    }
  }
  return { pm: null, reason: `${noDeclarationReason}; no known package manager (${PATH_PROBE_ORDER.join(', ')}) found on PATH` };
}

// detectPackageManager(dir, opts) -> {pm, reason}. `pm` is null (never
// thrown) when nothing in the target project names a manager AND none of
// the known managers resolve on PATH either — a genuinely undetectable
// target is a fact callers must handle, not a machine defect. Throws only
// on a structural inability to inspect the directory at all (missing dir,
// corrupt package.json). opts.pathProbe overrides the PATH-fallback prober
// (see detectFromPath).
function detectPackageManager(dir, opts = {}) {
  if (typeof dir !== 'string' || dir === '') {
    throw new TypeError('toolchain: dir must be a non-empty string');
  }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`toolchain: detectPackageManager: ${dir} is not a directory`);
  }

  for (const [lockfile, manager] of LOCKFILE_MANAGERS) {
    if (fs.existsSync(path.join(dir, lockfile))) {
      return { pm: manager, reason: `found ${lockfile}` };
    }
  }

  const pkgJsonPath = path.join(dir, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    } catch (err) {
      throw new Error(`toolchain: ${pkgJsonPath} is not valid JSON: ${err.message}`);
    }
    if (isNonEmptyString(pkg.packageManager)) {
      const name = pkg.packageManager.split('@')[0];
      if (KNOWN_PACKAGE_MANAGERS.has(name)) {
        return { pm: name, reason: `package.json "packageManager" field names "${name}"` };
      }
      return {
        pm: null,
        reason: `package.json "packageManager" field ("${pkg.packageManager}") does not name a known package manager`,
      };
    }
    return detectFromPath(dir, opts, `${pkgJsonPath} exists but declares no "packageManager" field`);
  }

  return detectFromPath(
    dir,
    opts,
    `no lockfile (${LOCKFILE_MANAGERS.map(([f]) => f).join(', ')}) or package.json found in ${dir}`
  );
}

// composeInstall(profileId, pmOrDir, opts) -> string (the exact shell
// command to run, never executed here). `node-cli` and `python-pytest`
// ignore pmOrDir entirely — their install_cmd_template carries no
// `{pm_install_dev}`/`{pm_exec}` placeholder and needs no manager resolved
// (node-cli installs nothing; python-pytest always goes through its own
// venv's pip, not the host project's JS package manager). `node-web`'s
// template carries BOTH placeholders: pmOrDir is either a known manager name
// (used directly) or a target directory (manager resolved via
// detectPackageManager, opts forwarded through for its PATH-probe override)
// — throws if that directory has no detectable manager, since there is
// then nothing honest to substitute. Both placeholders substitute from the
// SAME resolved `pm` — a yarn target gets `yarn dlx playwright install`,
// never a mixed `yarn add ... && npx playwright install`.
function composeInstall(profileId, pmOrDir, opts = {}) {
  assertKnownProfileId(profileId);
  const registry = loadProfiles();
  const template = registry.profiles[profileId].install_cmd_template;

  if (profileId !== 'node-web') {
    return template;
  }

  let pm;
  if (typeof pmOrDir === 'string' && KNOWN_PACKAGE_MANAGERS.has(pmOrDir)) {
    pm = pmOrDir;
  } else {
    const { pm: detected, reason } = detectPackageManager(pmOrDir, opts);
    if (detected === null) {
      throw new Error(`toolchain: composeInstall("node-web", ...) could not resolve a package manager for ${pmOrDir}: ${reason}`);
    }
    pm = detected;
  }

  return template
    .replace('{pm_install_dev}', PM_INSTALL_DEV_PREFIX[pm])
    .replace('{pm_exec}', PM_EXEC_PREFIX[pm]);
}

// composeSuite(profileId, pmOrDir, opts) -> string (the exact shell command
// that runs the target project's OWN full suite, never executed here).
//
// The per-chunk gate and the milestone regression floor both need this, and
// both had been hard-coding `npm test` — which is wrong for two of the three
// profiles and reports nothing machine-readable for the third. The command is
// a property of the toolchain profile exactly as the install command is, so it
// lives in the registry beside it; the reporter flags the registry already
// carried were unusable on their own, because nobody had said which command
// they attach to.
//
// EVERY declared reporter flag is appended, not the first one: a suite that
// reported on part of itself while looking like it reported on all of it is
// the failure this function exists to make impossible. `node-web` resolves its
// package manager exactly as composeInstall does, and for the same reason —
// a yarn target runs `yarn dlx playwright test`, never a mixed invocation.
function composeSuite(profileId, pmOrDir, opts = {}) {
  assertKnownProfileId(profileId);
  const registry = loadProfiles();
  const entry = registry.profiles[profileId];
  const flags = entry.reporter_flags.join(' ');

  let template = entry.suite_cmd_template;
  if (template.includes('{pm_exec}')) {
    template = template.replace('{pm_exec}', PM_EXEC_PREFIX[resolveManager(profileId, pmOrDir, opts)]);
  }
  return flags === '' ? template : `${template} ${flags}`;
}

// sanctionedGateCommands(profileId, role) -> the exact command strings this
// machine itself composes for a gate role: 'install', 'suite' or 'probe'. It
// answers the question a GATE RECORD cannot: the record says which id a result
// was filed under and which command produced it, and only the profile knows
// whether that command is the one the machine would have run.
//
// WHY A SET AND NOT A STRING. `node-web` substitutes a package manager into
// both its install and its suite, and which manager a project resolves to is a
// fact about that project's directory — a lockfile, a `packageManager` field,
// or a PATH probe that SPAWNS. A reader that must not spawn (the resolver is
// pure over disk, and that is a property worth more than this one distinction)
// therefore cannot narrow the four forms to one, so it accepts the profile's own
// command under any known manager and nothing else. The other two profiles
// substitute nothing and collapse to a single form.
//
// DERIVED THROUGH THE COMPOSERS THEMSELVES, never through a second reading of
// the templates: a checker with its own copy of the substitution rules is a
// second truth about what the command is, and the first divergence would be a
// door that refuses the very command the workflow just ran.
function sanctionedGateCommands(profileId, role) {
  assertKnownProfileId(profileId);
  const registry = loadProfiles();
  if (role === 'probe') return [registry.profiles[profileId].probe_cmd];
  if (role !== 'install' && role !== 'suite') {
    throw new TypeError(`toolchain: role must be one of install, suite, probe (got ${JSON.stringify(role)})`);
  }
  const compose = role === 'install' ? composeInstall : composeSuite;
  const forms = new Set();
  for (const pm of KNOWN_PACKAGE_MANAGERS) {
    forms.add(compose(profileId, pm));
  }
  return [...forms];
}

// The manager both composeInstall and composeSuite resolve the same way: a
// known manager name is used directly, anything else is a target directory to
// detect one in, and a directory with no detectable manager has nothing honest
// to substitute.
function resolveManager(profileId, pmOrDir, opts) {
  if (typeof pmOrDir === 'string' && KNOWN_PACKAGE_MANAGERS.has(pmOrDir)) return pmOrDir;
  const { pm, reason } = detectPackageManager(pmOrDir, opts);
  if (pm === null) {
    throw new Error(
      `toolchain: composing a "${profileId}" command could not resolve a package manager for ${pmOrDir}: ${reason}`
    );
  }
  return pm;
}

// scaffoldProfile(profileId, targetDir) -> {created[], skipped[]} —
// materializes the scaffold INPUTS a profile's `scaffolds` list names: the
// registry only lists scaffold path names, so this is the function that
// actually writes them. `node-cli` and a `null` profile are
// no-ops (node-cli ships with the runtime; `null` means "this milestone
// needs nothing"). Never overwrites a file that already exists — an
// existing `playwright.config.ts`/`requirements-dev.txt` is the target
// project's own, already-authored choice, and this function reports it
// skipped rather than clobbering it (the same "skip+report" discipline
// scaffold.js's own scaffoldTree applies to an existing `.kiln/`
// tree via its `force` escape hatch — here there is no force at all,
// because unlike a fresh greenfield tree these are files a human or an
// earlier milestone may already own).
const PLAYWRIGHT_CONFIG_TEMPLATE = `import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  reporter: [['json', { outputFile: 'playwright-report.json' }]],
  use: {
    trace: 'on-first-retry',
  },
});
`;

const PLAYWRIGHT_EXAMPLE_TEST_TEMPLATE = `import { test, expect } from '@playwright/test';

test('example: page loads and shows a title', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page).toHaveTitle(/Example/);
});
`;

const PYTHON_REQUIREMENTS_DEV_HEADER = `# managed by kiln toolchain scaffolding -- install via:
#   python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
`;

const PYTHON_REQUIRED_LINE = 'pytest';

// assertNotSymlink(targetPath, label) — refuses (throws) a target that
// already exists as a symlink, the same lstat-first, fail-closed-before-any-
// write discipline telemetry.js's own ensureSecureFile/ensureSecureUsageDir
// pair already applies to the usage stream: a pre-planted
// `requirements-dev.txt -> /outside/file` symlink would otherwise let
// scaffoldProfile's existsSync/readFileSync/appendFileSync sequence follow
// it straight through, appending `pytest` to a file entirely outside
// targetDir while reporting the symlink's own path as "created". A target
// that does not exist at all is always safe — this function only ever
// refuses an EXISTING symlink, never a plan to create one.
function assertNotSymlink(targetPath, label) {
  let lst;
  try {
    lst = fs.lstatSync(targetPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return; // does not exist yet — safe, scaffoldProfile creates a real file/dir
  }
  if (lst.isSymbolicLink()) {
    throw new Error(`toolchain: refusing to write through a symlinked ${label} ("${targetPath}")`);
  }
}

function scaffoldProfile(profileId, targetDir) {
  if (profileId !== null && !PROFILE_IDS.has(profileId)) {
    throw new TypeError(
      `toolchain: scaffoldProfile profileId must be null or one of ${[...PROFILE_IDS].join(', ')} (got ${JSON.stringify(profileId)})`
    );
  }
  if (typeof targetDir !== 'string' || targetDir === '') {
    throw new TypeError('toolchain: scaffoldProfile targetDir must be a non-empty string');
  }

  const created = [];
  const skipped = [];

  if (profileId === null || profileId === 'node-cli') {
    return { created, skipped };
  }

  if (profileId === 'node-web') {
    const configPath = path.join(targetDir, 'playwright.config.ts');
    assertNotSymlink(configPath, 'playwright.config.ts');
    if (fs.existsSync(configPath)) {
      skipped.push(configPath);
    } else {
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(configPath, PLAYWRIGHT_CONFIG_TEMPLATE);
      created.push(configPath);
    }

    const testsDir = path.join(targetDir, 'tests');
    assertNotSymlink(testsDir, 'tests directory');
    fs.mkdirSync(testsDir, { recursive: true });
    const examplePath = path.join(testsDir, 'example.spec.ts');
    assertNotSymlink(examplePath, 'tests/example.spec.ts');
    if (fs.existsSync(examplePath)) {
      skipped.push(examplePath);
    } else {
      fs.writeFileSync(examplePath, PLAYWRIGHT_EXAMPLE_TEST_TEMPLATE);
      created.push(examplePath);
    }
    return { created, skipped };
  }

  // python-pytest: create requirements-dev.txt (with the venv-convention
  // note) if absent, or append the "pytest" entry if the file exists but
  // lacks it — never rewriting whatever else the file already declares.
  const reqPath = path.join(targetDir, 'requirements-dev.txt');
  assertNotSymlink(reqPath, 'requirements-dev.txt');
  if (fs.existsSync(reqPath)) {
    const contents = fs.readFileSync(reqPath, 'utf8');
    const hasLine = contents.split('\n').some((line) => line.trim() === PYTHON_REQUIRED_LINE);
    if (hasLine) {
      skipped.push(reqPath);
    } else {
      const sep = contents.length > 0 && !contents.endsWith('\n') ? '\n' : '';
      fs.appendFileSync(reqPath, `${sep}${PYTHON_REQUIRED_LINE}\n`);
      created.push(reqPath);
    }
  } else {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(reqPath, `${PYTHON_REQUIREMENTS_DEV_HEADER}${PYTHON_REQUIRED_LINE}\n`);
    created.push(reqPath);
  }
  return { created, skipped };
}

// PROFILE_SATISFACTION_MARKER — the deterministic, fixture-checkable
// filesystem fact each profile's satisfaction reduces to: does
// @playwright/test resolve in the target's node_modules, does pytest
// resolve in the target's venv. Presence-of-marker, never executing the
// profile's own `probe_cmd` — a resolver-style probe command needs a real,
// fully-formed target install to mean anything, while the marker path
// states the same fact in fs terms instead of a spawned process's exit
// code, checkable against a fixture directory with no real install at all.
const PROBE_MARKERS = {
  'node-web': path.join('node_modules', '@playwright', 'test'),
  'python-pytest': path.join('.venv', 'bin', 'pytest'),
};

// PROFILE_DEPENDENCY_DIRS — the one directory in the target project each
// profile's suite needs and git does not carry: the installed dependencies.
// They are ignored by every ecosystem's own convention, so a fresh checkout of
// the project's tree — a `git worktree add`, for instance — does not have them,
// and a suite run there fails for want of its own libraries rather than because
// the code is wrong.
//
// It is the ECOSYSTEM's directory, not the profile's own install: `node-cli`
// installs nothing (node:test ships with the runtime) and still needs whatever
// the project itself depends on. `null` means this profile's suite needs no
// installed tree at all — no profile claims that today, and the shape is here
// so a future one can say so rather than being silently assumed into node.
const PROFILE_DEPENDENCY_DIRS = Object.freeze({
  'node-web': 'node_modules',
  'node-cli': 'node_modules',
  'python-pytest': '.venv',
});

// dependencyDirOf(profileId) -> the directory name, or null. Derived from the
// profile id rather than accepted from a caller: a caller free to name the
// directory would be naming a path inside somebody else's checkout.
function dependencyDirOf(profileId) {
  assertKnownProfileId(profileId);
  const dir = PROFILE_DEPENDENCY_DIRS[profileId];
  return dir === undefined ? null : dir;
}

// probeSatisfied(profileId, dir) -> {satisfied, probe_cmd}. `probe_cmd` is
// carried through from the profile registry as informational metadata for
// whatever runs the real preflight (check-honesty.js's runGate) —
// `satisfied` itself is decided by the marker check above, never by
// executing probe_cmd here.
function probeSatisfied(profileId, dir) {
  assertKnownProfileId(profileId);
  if (typeof dir !== 'string' || dir === '') {
    throw new TypeError('toolchain: dir must be a non-empty string');
  }
  const registry = loadProfiles();
  const probeCmd = registry.profiles[profileId].probe_cmd;
  if (profileId === 'node-cli') {
    return { satisfied: true, probe_cmd: probeCmd };
  }
  const marker = PROBE_MARKERS[profileId];
  return { satisfied: fs.existsSync(path.join(dir, marker)), probe_cmd: probeCmd };
}

// CLI entrypoint: product/implementation/flow.md's toolchain-preflight step
// names detectPackageManager/probeSatisfied/scaffoldProfile/composeInstall
// as commanded calls with no executable form otherwise; agents/security-
// scanner.md's own detectPackageManager call is the same site under a
// different worker. Four subcommands, one per function —
// `scaffold-profile` alone accepts the literal string "null" for profileId
// (scaffoldProfile's own "this milestone needs nothing" value; every other
// subcommand requires a real PROFILE_IDS member, matching
// assertKnownProfileId's own floor). `compose-install` never accepts a
// pathProbe override from the CLI — the real `which`/`where` probe always
// runs, the same probe a real toolchain preflight needs.
function parseProfileIdArg(raw, allowNull) {
  if (allowNull && raw === 'null') return null;
  return raw;
}

const CLI_COMMANDS = ['detect-package-manager', 'probe-satisfied', 'scaffold-profile', 'compose-install'];

// Positional-argument count each subcommand actually takes (after the
// command itself) — a surplus positional beyond this count is refused
// below, rather than the CLI silently ignoring it.
const CLI_ARG_COUNTS = {
  'detect-package-manager': 1,
  'probe-satisfied': 2,
  'scaffold-profile': 2,
  'compose-install': 2,
};

function cliParseArgv(argv) {
  const [command, ...rest] = argv;
  return { command, rest };
}

function main(argv) {
  const { command, rest } = cliParseArgv(argv);
  if (!CLI_COMMANDS.includes(command)) {
    process.stderr.write(
      'usage: toolchain.js detect-package-manager <dir>\n' +
        '       toolchain.js probe-satisfied <profileId> <dir>\n' +
        '       toolchain.js scaffold-profile <profileId|null> <targetDir>\n' +
        '       toolchain.js compose-install <profileId> <pmOrDir>\n'
    );
    process.exit(1);
  }
  try {
    // A surplus positional beyond each subcommand's own arg count is
    // refused here, fail-closed, rather than silently ignored.
    const maxArgs = CLI_ARG_COUNTS[command];
    if (rest.length > maxArgs) {
      throw new Error(`${command} takes at most ${maxArgs} argument(s), got extra: ${rest.slice(maxArgs).join(' ')}`);
    }
    let result;
    if (command === 'detect-package-manager') {
      const [dir] = rest;
      if (typeof dir !== 'string' || dir === '') throw new Error('detect-package-manager requires <dir>');
      result = detectPackageManager(dir);
    } else if (command === 'probe-satisfied') {
      const [profileId, dir] = rest;
      if (typeof dir !== 'string' || dir === '') throw new Error('probe-satisfied requires <profileId> <dir>');
      result = probeSatisfied(profileId, dir);
    } else if (command === 'scaffold-profile') {
      const [profileIdArg, targetDir] = rest;
      if (typeof targetDir !== 'string' || targetDir === '') throw new Error('scaffold-profile requires <profileId|null> <targetDir>');
      result = scaffoldProfile(parseProfileIdArg(profileIdArg, true), targetDir);
    } else {
      const [profileId, pmOrDir] = rest;
      if (typeof pmOrDir !== 'string' || pmOrDir === '') throw new Error('compose-install requires <profileId> <pmOrDir>');
      result = { cmd: composeInstall(profileId, pmOrDir) };
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    process.stderr.write(`toolchain.js: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  PROFILE_IDS,
  // TOOLCHAIN_PROFILES: an array alias over the same closed set, for callers
  // that want an ordered, spreadable list rather than a Set (several
  // roster agent files — agents/{milestone-designer,implementer-sol,
  // implementer-opus}.md — name "TOOLCHAIN_PROFILES" in their own prose;
  // this alias keeps that prose accurate without a second, divergent source
  // of truth — both names read the exact same three ids, PROFILE_IDS never
  // reconstructed independently).
  TOOLCHAIN_PROFILES: [...PROFILE_IDS],
  KNOWN_PACKAGE_MANAGERS,
  DEFAULT_PROFILES_PATH,
  loadProfiles,
  validateProfiles,
  detectPackageManager,
  composeInstall,
  composeSuite,
  sanctionedGateCommands,
  probeSatisfied,
  scaffoldProfile,
  PROFILE_DEPENDENCY_DIRS,
  dependencyDirOf,
};
