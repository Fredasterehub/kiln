'use strict';

// promotion.js — how an agent-authored artifact becomes a canonical one.
//
// NO AGENT STEP WRITES A CANONICAL ARTIFACT. A seat writes what it authored
// into `staging/`, and this module is the only thing that moves it into the
// place the machine and every later reader will treat as true. That is what
// makes "the agent never wrote canonical truth" a property of the layout
// rather than an instruction a seat could ignore: a seat that wrote anywhere
// else wrote into a directory nothing reads.
//
// VALIDATION HAPPENS BEFORE THE MOVE, AND A FAILURE LEAVES THE STAGED FILE
// EXACTLY WHERE IT IS. An invalid artifact is not a crisis, it is a seat's
// draft that did not pass — the staged bytes stay put so the next attempt can
// see what was rejected, and nothing canonical changed.
//
// THE RECEIPT IS A DIGEST OF WHAT LANDED. Every promotion returns the digest
// of the bytes now at the canonical path, computed after the write, so a
// caller records what is actually there rather than what it believed it sent.
//
// REPLAY COMPARES MEANING FOR JSON AND BYTES FOR PROSE, and the split is not
// fussiness. Predicting the bytes a JSON write will produce means mirroring
// another module's serialization here, and the first time atomic-json.js
// changes its spacing every promotion in the tree would read as a conflict.
// What a JSON artifact IS is its parsed content, so that is what is compared;
// prose has no such distinction and is compared as it was written. Either way
// a re-promotion of the same artifact returns the same receipt and rewrites
// nothing, and promoting something DIFFERENT over an artifact that already
// exists fails closed rather than silently replacing a decision something
// downstream may already cite.

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');

const { writeAtomic } = require('./atomic-json.js');
const { writeAtomicText } = require('./atomic-text.js');
const { validateBrief, DESIGNER_FAMILIES } = require('./validators.js');
// The journey-nomination rule is owned by the module that will WRITE the
// nomination into the catalog, and imported here so a malformed one is refused
// at the promotion boundary rather than twice-defined.
const { nominationProblem } = require('./journeys.js');

const STAGING_DIRNAME = 'staging';

// A scope id names ONE path segment. This closes TRAVERSAL and nothing else —
// where a path leads is a separate question, answered by `requireInsideTree`
// below.
//
// It exists because derivation was once claimed as the whole fence and is not:
// `path.join` normalises `..`, so an id carrying one walks a derived path
// straight back out of the tree and a caller is choosing where the machine
// writes after all. The same regex capsule.js and dispatch.js already hold
// their own ids to; a leading dot is excluded, so `..` and `./x` never parse
// as ids at all.
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function idProblem(value, what) {
  if (typeof value !== 'string' || !SAFE_ID_RE.test(value)) {
    return `promotion: ${what} must be one path segment of letters, digits, dot, dash or underscore (got ${JSON.stringify(value)})`;
  }
  return null;
}

function digestOf(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

// Where a path LEADS, which is a different question from how it is spelled.
//
// The scope-id check above closes traversal — single path segments cannot walk
// a derived path out of the tree with `..`. It does not close a path that
// spells its way inside the tree and lands outside it: a symlinked
// `milestones/` or `staging/` is perfectly legal to `path.join`, and the write
// or read follows it wherever it goes. Two different hazards, so two checks;
// this is not the same guard twice.
//
// Resolve the deepest ancestor that actually exists and re-append the rest,
// because the target itself usually does not exist yet — a staging file a seat
// has not written, a canonical file about to be created. And a symlink that
// stays INSIDE the tree stays legal, which is why the comparison is against
// the resolved root rather than a ban on links.
function requireInsideTree(treeRoot, target, what) {
  const root = fs.realpathSync(treeRoot);
  const segments = [];
  let probe = path.resolve(target);
  for (;;) {
    if (fs.existsSync(probe)) break;
    const parent = path.dirname(probe);
    if (parent === probe) break;
    segments.unshift(path.basename(probe));
    probe = parent;
  }
  const resolved = path.join(fs.existsSync(probe) ? fs.realpathSync(probe) : probe, ...segments);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(
      `promotion: the ${what} ${JSON.stringify(target)} leads outside the tree, to ${JSON.stringify(resolved)} — a promotion writes and reads inside ${JSON.stringify(root)} and nowhere else`
    );
  }
  return resolved;
}

// ---------- the artifact classes ----------

// Each class says where its staged draft lives, where it lands, and what makes
// it valid. The set is CLOSED: a class this table does not name cannot be
// promoted at all, so a caller cannot invent a path by inventing a name.
const CLASSES = Object.freeze({
  spec: Object.freeze({
    format: 'text',
    stagedAt: () => 'spec.md',
    canonicalAt: (scope) => path.join('milestones', scope.milestone_id, 'spec.md'),
    problem: (content) =>
      isNonEmptyString(content) ? null : 'a spec must be prose, and this one is empty',
  }),
  'chunk-plan': Object.freeze({
    format: 'json',
    stagedAt: () => 'chunk-plan.json',
    canonicalAt: (scope) => path.join('milestones', scope.milestone_id, 'chunk-plan.json'),
    problem: (content) => {
      if (!isPlainObject(content) || !Array.isArray(content.chunks)) {
        return 'a chunk plan must be an object carrying a "chunks" array';
      }
      if (content.chunks.length === 0) {
        return 'a chunk plan with no chunks would leave its milestone with nothing to build';
      }
      const ids = content.chunks.map((entry) => (isPlainObject(entry) ? entry.id : null));
      if (!ids.every(isNonEmptyString)) {
        return 'every chunk in a plan must carry a non-empty "id"';
      }
      if (new Set(ids).size !== ids.length) {
        return 'a chunk plan names the same chunk twice, and the resolver would never reach the second';
      }
      // A chunk may nominate the JIT journey it closes, and that nomination is
      // the only machine-readable form the decision takes — the spec says it in
      // prose, and prose cannot be asked which journey a chunk closes. Optional,
      // because most chunks close no criterion; refused here when malformed,
      // because a designer can still fix it now and `journeys.js` would
      // otherwise meet it a whole milestone later, at the seal.
      const nominated = new Map();
      for (const entry of content.chunks) {
        if (!isPlainObject(entry) || entry.journey === undefined) continue;
        const problem = nominationProblem(entry.journey);
        if (problem !== null) return `chunk "${entry.id}" nominates a journey, and ${problem}`;
        // A journey is mechanically unique — the criteria register mints exactly
        // one per criterion — so two chunks claiming the same one is a
        // decomposition mistake. Caught here it costs a re-plan; left to the
        // seal it costs two authorship records for one journey, or a collision
        // that only fires after the second chunk has already sealed.
        const claimed = nominated.get(entry.journey.journey_id);
        if (claimed !== undefined) {
          return `journey "${entry.journey.journey_id}" is nominated by more than one chunk ("${claimed}" and "${entry.id}") — the register mints exactly one journey per criterion, so exactly one chunk closes it`;
        }
        nominated.set(entry.journey.journey_id, entry.id);
      }
      return null;
    },
  }),
  // A chunk brief is the EIGHT-FIELD brief `validators.js` already defines,
  // not prose that happens to be non-empty. Every seat downstream reads it as
  // that object, and "non-empty text" admitted a brief carrying none of the
  // eight — an artifact that validates against nothing and that an implementer
  // cannot work from.
  brief: Object.freeze({
    format: 'json',
    stagedAt: (scope) => `${scope.chunk_id}.json`,
    canonicalAt: (scope) => path.join('milestones', scope.milestone_id, 'briefs', `${scope.chunk_id}.json`),
    problem: (content) => {
      const { ok, errors } = validateBrief(content);
      return ok ? null : `this is not a chunk brief — ${errors.join('; ')}`;
    },
  }),
  // A chunk review is scoped to its ROUND as well as its chunk. A revise loop
  // produces several genuinely different verdicts on the same chunk, and a
  // single path for all of them means the second promotion is refused as a
  // conflicting rewrite of the first — correctly, since a promoted artifact
  // that a `chunk-review` record already cites must not change under it. Each
  // round therefore lands beside the last, and the record cites the one it
  // acted on.
  review: Object.freeze({
    format: 'json',
    stagedAt: (scope) => `${scope.chunk_id}-${scope.round}.json`,
    canonicalAt: (scope) =>
      path.join('milestones', scope.milestone_id, 'reviews', `${scope.chunk_id}-${scope.round}.json`),
    problem: (content) => verdictProblem(content),
  }),
  'milestone-review': Object.freeze({
    format: 'json',
    stagedAt: () => 'review.json',
    canonicalAt: (scope) => path.join('milestones', scope.milestone_id, 'review.json'),
    problem: (content) => verdictProblem(content),
  }),
  // The consult seam's artifact. Its shape is milestones.js's own
  // `chunk-consult` vocabulary — verdict plus verbatim anchor — so a promoted
  // answer and the lifecycle record that cites it cannot disagree about what
  // an answer is. The id inside the file must be the id it is promoted under,
  // or a consult could be answered by a file addressed to another question.
  consult: Object.freeze({
    format: 'json',
    stagedAt: (scope) => `${scope.consult_id}.json`,
    canonicalAt: (scope) => path.join('milestones', scope.milestone_id, 'consults', `${scope.consult_id}.json`),
    problem: (content, scope) => {
      if (!isPlainObject(content)) return 'a consult answer must be an object';
      for (const field of ['consult_id', 'asker', 'question', 'verdict', 'anchor']) {
        if (!isNonEmptyString(content[field])) {
          return `a consult answer requires a non-empty "${field}" — a verdict with no anchor is an opinion`;
        }
      }
      if (content.consult_id !== scope.consult_id) {
        return `this answer carries consult_id ${JSON.stringify(content.consult_id)} but is being promoted as ${JSON.stringify(scope.consult_id)}`;
      }
      return null;
    },
  }),
});

const CLASS_NAMES = Object.freeze(Object.keys(CLASSES));

// One verdict shape for both review classes: the vocabulary milestones.js
// already speaks, so a promoted verdict and a recorded one cannot disagree
// about what "approve" means. The FAMILY is required for the same reason the
// reviewer's selection was folded into the review transition: the chunk-review
// record evidences which family reviewed, and a verdict artifact that does not
// say cannot corroborate it.
function verdictProblem(content) {
  if (!isPlainObject(content)) return 'a review must be an object';
  if (content.verdict !== 'approve' && content.verdict !== 'revise') {
    return 'a review must carry a verdict of "approve" or "revise"';
  }
  if (!isNonEmptyString(content.evidence)) {
    return 'a review must carry non-empty "evidence" — a verdict with nothing behind it is an opinion';
  }
  if (!DESIGNER_FAMILIES.has(content.family)) {
    return `a review must name the "family" that produced it, one of ${[...DESIGNER_FAMILIES].join(', ')} (got ${JSON.stringify(content.family)})`;
  }
  return null;
}

// Which scope fields a class is addressed by. Every one of them becomes a path
// segment, so every one of them is checked as an id.
const SCOPE_IDS = Object.freeze({
  spec: ['milestone_id'],
  'chunk-plan': ['milestone_id'],
  brief: ['milestone_id', 'chunk_id'],
  review: ['milestone_id', 'chunk_id', 'round'],
  'milestone-review': ['milestone_id'],
  consult: ['milestone_id', 'consult_id'],
});

function requireScope(artifactClass, scope) {
  if (!Object.prototype.hasOwnProperty.call(CLASSES, artifactClass)) {
    return `promotion: unknown artifact class ${JSON.stringify(artifactClass)} (known: ${CLASS_NAMES.join(', ')})`;
  }
  if (!isPlainObject(scope)) {
    return 'promotion: every promotion is scoped, and requires a scope object';
  }
  for (const field of SCOPE_IDS[artifactClass]) {
    if (!isNonEmptyString(scope[field])) {
      return `promotion: a ${artifactClass} is scoped by "${field}" and requires a non-empty one`;
    }
    const problem = idProblem(scope[field], field);
    if (problem !== null) return problem;
  }
  return null;
}

// ---------- stagedPathFor ----------

// stagedPathFor(treeRoot, artifactClass, scope) — the exact file a seat must
// write, told by the module that will later read it.
//
// A workflow has to name this path to the seat it dispatches, and the only
// honest source of it is here. Inventing it at the call site is what let a
// seat be told an extensionless directory while promotion looked for
// `spec.md` — two derivations of one fact, disagreeing.
function stagedPathFor(treeRoot, artifactClass, scope) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('promotion: treeRoot must be a non-empty string');
  }
  const scopeProblem = requireScope(artifactClass, scope);
  if (scopeProblem !== null) throw new TypeError(scopeProblem);
  const staged = path.join(
    treeRoot,
    STAGING_DIRNAME,
    artifactClass,
    scope.milestone_id,
    CLASSES[artifactClass].stagedAt(scope)
  );
  requireInsideTree(treeRoot, staged, 'staged path');
  return staged;
}

// ---------- promoteArtifact ----------

// promoteArtifact(treeRoot, artifactClass, scope) — validate what a seat
// staged and move it into place, returning {ref, path, digest}.
//
// WHERE THIS WRITES IS NOT THE CALLER'S TO CHOOSE, and it takes three things
// to make that true rather than one. The path is DERIVED from the class and
// the scope, so no caller hands one in. The class comes from a closed table,
// so a name cannot invent a directory. And the scope VALUES are checked — as
// single path segments, and then for where the assembled path actually leads.
//
// The derivation alone was once claimed as the whole fence, and it is not:
// `path.join` normalises `..`, so an unvalidated `milestone_id` walked a
// derived path clean out of the tree, and a symlinked `milestones/` would take
// it out again by a different route. Both are closed now; the sentence is
// written this way so the next reader learns what carries the weight.
function promoteArtifact(treeRoot, artifactClass, scope) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('promotion: treeRoot must be a non-empty string');
  }
  const scopeProblem = requireScope(artifactClass, scope);
  if (scopeProblem !== null) throw new TypeError(scopeProblem);

  const spec = CLASSES[artifactClass];
  const stagedPath = stagedPathFor(treeRoot, artifactClass, scope);
  const canonicalPath = path.join(treeRoot, spec.canonicalAt(scope));
  requireInsideTree(treeRoot, canonicalPath, 'canonical path');

  if (!fs.existsSync(stagedPath)) {
    throw new Error(
      `promotion: nothing staged at ${stagedPath} — the ${artifactClass} seat wrote nowhere this module reads`
    );
  }

  const raw = fs.readFileSync(stagedPath);
  const content = spec.format === 'json' ? parseOrThrow(raw, stagedPath) : raw.toString('utf8');
  const problem = spec.problem(content, scope);
  if (problem !== null) {
    throw new Error(
      `promotion: the staged ${artifactClass} at ${stagedPath} is not promotable — ${problem}; it stays staged`
    );
  }

  // Already promoted: the receipt is what is on disk, if what is on disk is
  // this same artifact.
  if (fs.existsSync(canonicalPath)) {
    const existing = fs.readFileSync(canonicalPath);
    if (samePromotion(spec, existing, content)) {
      return receiptOf(treeRoot, canonicalPath, existing, spec.format);
    }
    throw new Error(
      `promotion: ${canonicalPath} already holds a different ${artifactClass} — refusing to replace an artifact a later record may already cite`
    );
  }

  if (spec.format === 'json') {
    writeAtomic(canonicalPath, content);
  } else {
    writeAtomicText(canonicalPath, content);
  }
  return receiptOf(treeRoot, canonicalPath, fs.readFileSync(canonicalPath), spec.format);
}

// Is what is already at the canonical path the same artifact as this one?
// For JSON that is a question about content, not about formatting; for prose
// the bytes are the content.
function samePromotion(spec, existingBytes, content) {
  if (spec.format !== 'json') return existingBytes.toString('utf8') === content;
  let existing;
  try {
    existing = JSON.parse(existingBytes.toString('utf8'));
  } catch {
    return false;
  }
  return isDeepStrictEqual(existing, content);
}

function parseOrThrow(raw, file) {
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch (err) {
    throw new Error(`promotion: the staged artifact at ${file} is not JSON: ${err.message}`);
  }
}

// The receipt carries WHAT LANDED, for a JSON artifact, and not only where.
//
// The caller that needs this is the workflow: a chunk-review record has to
// carry the verdict and the family the review actually reached, and the
// workflow runtime has no filesystem to go and read them with. The alternative
// was to take them from the seat's own report of itself, which is a model's
// claim about a file rather than the file — and the two can differ exactly
// when it matters. Reading them off the promoted bytes, after validation, is
// the machine attesting its own artifact.
//
// Prose carries no content field: a spec is read by seats, never destructured
// by a caller, and returning a whole document to every promotion would be
// paying for something nobody asked for.
function receiptOf(treeRoot, canonicalPath, bytes, format) {
  const receipt = {
    ref: path.relative(treeRoot, canonicalPath),
    path: canonicalPath,
    digest: digestOf(bytes),
  };
  if (format === 'json') receipt.content = JSON.parse(bytes.toString('utf8'));
  return receipt;
}

module.exports = {
  promoteArtifact,
  stagedPathFor,
  CLASS_NAMES,
};
