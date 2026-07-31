'use strict';

// Mechanical anonymization for Maximal confrontation's reciprocal-review
// step: each reviews the other's convergences/divergences without either
// side's authorship leaking through the raw text. anonymizeBundle() is a
// pure, deterministic text transform — no model, no summarizer, no judgment —
// so each author's own session reviews an anonymized VIEW of the rival's raw
// files, never a third mind's interpretation of them (the same "no
// plan-merging by a third mind" anti-goal, applied to the
// reviewing step itself, not only the selection step plan-judge.md already
// respects).

const fs = require('node:fs');
const path = require('node:path');

// Case-insensitive, whole-word only (a hyphen or digit boundary counts —
// "GPT-5.6-Sol" tokenizes to GPT / 5.6 / Sol) so this never mangles an
// unrelated word that merely contains one of these strings ("solve",
// "console", "clauses" are all left untouched).
const MODEL_NAME_RE = /\b(fable|opus|sonnet|gpt|sol|claude)\b/gi;
const MODEL_REPLACEMENT = '[model]';

// UUID-shaped session identifiers and explicitly labeled session-id fields,
// whether JSON ("session_id": "...") or prose ("session id: ...", "Codex
// session id: ...").
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const LABELED_SESSION_ID_RE = /(session[_ -]?id["']?\s*[:=]\s*["'`]?)([^"'`\n,}]+)/gi;

// Literal transcript/tool-use tells: system-reminder blocks (including their
// content — the single biggest leak surface, since a harness reminder can
// itself narrate which model or tool is running) and the exact CLI
// resumption commands this codebase's own agents document
// (agents/agreement-pass.md, agents/plan-coverage-checker.md: "`codex exec
// resume`"), which name the dispatch mechanism a family-blind judge or rival
// author must never see.
const SYSTEM_REMINDER_BLOCK_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/gi;
const TOOL_TRANSCRIPT_MARKERS = [
  /<tool_use>[\s\S]*?<\/tool_use>/gi,
  /<function_results>[\s\S]*?<\/function_results>/gi,
  /`?codex exec resume[^\n`]*`?/gi,
  /`?codex exec[^\n`]*`?/gi,
];

// YAML frontmatter keys that name authorship directly rather than content —
// dropped whole (key and value) rather than merely having their value
// scrubbed, since the key name itself ("model:", "session_id:") is already
// the tell.
const FRONTMATTER_AUTHORSHIP_KEYS = new Set([
  'model',
  'author',
  'authored_by',
  'assistant',
  'session',
  'session_id',
  'family',
  'seat',
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value !== '';
}

// assertSafeRelPath(relPath, label) — rejects an absolute path or any ".."/"."
// segment BEFORE it is ever joined against a base directory: an unchecked
// relative path (e.g. a bare `../secret.txt`) would otherwise reach
// fs.readFileSync/fs.writeFileSync directly. Mirrors scout.js's
// normalizedContainedEntryPoint's own posix-normalize-then-check discipline,
// applied here fail-closed (throws)
// rather than that function's silent-drop posture — anonymizeBundle's own
// header comment already refuses a missing source file rather than
// skipping it, so a malformed path gets the same "refuse the whole call"
// treatment, never a silent per-entry skip.
function assertSafeRelPath(relPath, label) {
  if (!isNonEmptyString(relPath)) {
    throw new TypeError(`anonymize: every entry in ${label} must be a non-empty relative path string`);
  }
  const posixRel = relPath.split(path.sep).join('/');
  if (path.posix.isAbsolute(posixRel)) {
    throw new Error(`anonymize: ${label} entry must be a relative path, got absolute path "${relPath}"`);
  }
  if (posixRel.split('/').some((segment) => segment === '..' || segment === '')) {
    throw new Error(`anonymize: ${label} entry must not contain ".." or empty segments (got "${relPath}")`);
  }
}

// realpathOfPossiblyMissing(p) — the real (symlink-resolved) path of `p`,
// even when `p` itself (or a trailing suffix of it) does not exist yet on
// disk. Walks up to the deepest EXISTING ancestor, resolves that ancestor's
// real path, and reattaches the not-yet-created suffix literally — needed
// because destDir (and a fresh relPath's own parent directories under it)
// may not exist until anonymizeBundle's own mkdirSync call below creates
// them, so a plain fs.realpathSync(p) would throw ENOENT before any
// containment check could run.
function realpathOfPossiblyMissing(p) {
  const abs = path.resolve(p);
  const suffix = [];
  let existing = abs;
  while (!fs.existsSync(existing)) {
    suffix.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) break; // reached the filesystem root
    existing = parent;
  }
  const realExisting = fs.realpathSync(existing);
  return suffix.length > 0 ? path.join(realExisting, ...suffix) : realExisting;
}

// assertContained(baseReal, targetPath, label) — refuses a targetPath whose
// real (symlink-resolved) location falls outside baseReal, the resolved
// real path of the directory it is supposed to be contained by. Catches a
// pre-planted symlinked path component (either directory or the leaf file
// itself) even when the relPath string contains no ".." at all — the
// segment check above and this real-path check are deliberately BOTH run,
// the same "no ambient escape route, whichever form it takes" discipline
// telemetry.js's ensureSecureUsageDir/ensureSecureFile pair already applies
// to the usage-stream directory and its month files.
function assertContained(baseReal, targetPath, label) {
  const targetReal = realpathOfPossiblyMissing(targetPath);
  const rel = path.relative(baseReal, targetReal);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`anonymize: ${label} "${targetPath}" resolves outside its declared directory (via ".." or a symlink)`);
  }
}

// Strips a leading YAML frontmatter block's authorship keys (case-
// insensitive key match), leaving every other frontmatter line and the rest
// of the document untouched. A file with no frontmatter (no leading `---`
// line) is returned unchanged by this step — model-name/session-id scrubbing
// still runs over its full body regardless.
function stripFrontmatterAuthorshipKeys(text) {
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return text;
  const lines = text.split(/\r?\n/);
  const closingIdx = lines.findIndex((line, idx) => idx > 0 && line.trim() === '---');
  if (closingIdx === -1) return text; // unterminated frontmatter — leave as-is, nothing to safely strip

  const kept = lines.slice(0, closingIdx + 1);
  const body = lines.slice(closingIdx + 1);

  const filteredFrontmatter = [kept[0]];
  for (let i = 1; i < kept.length - 1; i++) {
    const line = kept[i];
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line);
    const key = match ? match[1].toLowerCase() : null;
    if (key !== null && FRONTMATTER_AUTHORSHIP_KEYS.has(key)) continue;
    filteredFrontmatter.push(line);
  }
  filteredFrontmatter.push(kept[kept.length - 1]);

  return [...filteredFrontmatter, ...body].join('\n');
}

function redactModelNames(text) {
  return text.replace(MODEL_NAME_RE, MODEL_REPLACEMENT);
}

function redactSessionIds(text) {
  return text.replace(UUID_RE, '[session]').replace(LABELED_SESSION_ID_RE, '$1[session]');
}

function redactToolTranscriptMarkers(text) {
  let out = text.replace(SYSTEM_REMINDER_BLOCK_RE, '[redacted]');
  for (const marker of TOOL_TRANSCRIPT_MARKERS) {
    out = out.replace(marker, '[redacted]');
  }
  return out;
}

// anonymizeText(text) — the full deterministic pipeline, exported
// separately so a caller anonymizing something that isn't a file on disk
// (e.g. an already-in-memory findings report) can reuse it without going
// through anonymizeBundle's filesystem contract.
function anonymizeText(text) {
  let out = stripFrontmatterAuthorshipKeys(text);
  out = redactToolTranscriptMarkers(out);
  out = redactSessionIds(out);
  out = redactModelNames(out);
  return out;
}

// anonymizeBundle(srcDir, destDir, files) -> {written: [{file, srcPath,
// destPath}]}. Copies each relPath in `files` from srcDir to the identical
// relative path under destDir, applying anonymizeText() to its content.
// Deterministic and pure: no Date.now(), no randomness, no model call — the
// same (srcDir, files) content always produces byte-identical destDir
// content. Refuses (throws) on a missing source file rather than silently
// skipping it — an anonymized bundle missing one of its five artifacts is
// not a partial success, it is a broken bundle no reviewer should receive.
function anonymizeBundle(srcDir, destDir, files) {
  if (!isNonEmptyString(srcDir)) {
    throw new TypeError('anonymize: srcDir must be a non-empty string');
  }
  if (!isNonEmptyString(destDir)) {
    throw new TypeError('anonymize: destDir must be a non-empty string');
  }
  if (!Array.isArray(files) || files.length === 0) {
    throw new TypeError('anonymize: files must be a non-empty array of relative paths');
  }

  // srcDir must already be real (every file below is read from it);
  // destDir may not exist yet (created below) — realpathOfPossiblyMissing
  // resolves both to a comparable real path regardless.
  const srcReal = fs.realpathSync(srcDir);
  const destReal = realpathOfPossiblyMissing(destDir);
  if (srcReal === destReal) {
    throw new Error('anonymize: destDir must not be the same directory as srcDir');
  }
  if (destReal.startsWith(`${srcReal}${path.sep}`)) {
    throw new Error('anonymize: destDir must not be nested inside srcDir');
  }
  if (srcReal.startsWith(`${destReal}${path.sep}`)) {
    throw new Error('anonymize: srcDir must not be nested inside destDir');
  }

  const written = [];
  for (const relPath of files) {
    assertSafeRelPath(relPath, 'files');

    const srcPath = path.join(srcDir, relPath);
    assertContained(srcReal, srcPath, 'source path');
    let raw;
    try {
      raw = fs.readFileSync(srcPath, 'utf8');
    } catch (err) {
      throw new Error(`anonymize: could not read ${srcPath}: ${err.message}`);
    }

    const destPath = path.join(destDir, relPath);
    assertContained(destReal, destPath, 'destination path');
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, anonymizeText(raw));
    written.push({ file: relPath, srcPath, destPath });
  }

  return { written };
}

// CLI entrypoint: Maximal confrontation's own mechanical mid-protocol steps
// (product/architecture/flow.md steps 2 and 6) run "Kiln runs
// machine/src/anonymize.js's anonymizeBundle(...)" — a Bash-only orchestrator
// has no way to call this in-process. `anonymize-bundle <srcDir> <destDir>`
// reads the `files` relative-path array via stdin (the same array
// anonymizeBundle itself takes — the canonical five-artifact set for a
// candidate's own draft directory, or an arbitrary report-file list for the
// adversarial-mission-report anonymization pass flow.md step 6 also names).
// parseArgv fails closed on a surplus positional argument rather than
// silently ignoring it — the same "every token is accounted for" discipline
// validators.js's own parseArgv already applies to an unrecognized flag,
// applied here to an extra positional instead.
function parseArgv(argv) {
  const [command, srcDir, destDir, ...rest] = argv;
  const error = rest.length > 0 ? `unexpected extra argument(s): ${rest.join(' ')}` : null;
  return { command, srcDir, destDir, error };
}

function main(argv) {
  const { command, srcDir, destDir, error } = parseArgv(argv);
  if (command !== 'anonymize-bundle' || !isNonEmptyString(srcDir) || !isNonEmptyString(destDir) || error) {
    if (error) process.stderr.write(`anonymize.js: ${error}\n`);
    process.stderr.write('usage: anonymize.js anonymize-bundle <srcDir> <destDir>   (files JSON array via stdin)\n');
    process.exit(1);
  }
  try {
    const filesText = fs.readFileSync(0, 'utf8'); // fd 0 = stdin
    let files;
    try {
      files = JSON.parse(filesText);
    } catch (err) {
      throw new Error(`anonymize-bundle: files JSON via stdin is not valid JSON: ${err.message}`);
    }
    const result = anonymizeBundle(srcDir, destDir, files);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    process.stderr.write(`anonymize.js: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { anonymizeBundle, anonymizeText };
