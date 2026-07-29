'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { LINE_CEILING } = require('./jsonl.js');
const { PROFILE_IDS } = require('./toolchain.js');
const { ISO_8601_UTC_RE } = require('./stream.js');

const ENVELOPE_KEYS = ['state', 'result', 'evidence', 'risks', 'artifact', 'question'];
const ENVELOPE_STATES = new Set(['done', 'partial', 'blocked']);
const ENVELOPE_STRING_KEYS = ['result', 'evidence', 'risks', 'artifact', 'question'];
const ENVELOPE_WORD_KEYS = ['result', 'evidence', 'risks', 'question'];
const ENVELOPE_WORD_CEILING = 300;

const BRIEF_KEYS = [
  'outcome',
  'scope',
  'anchors',
  'acceptance',
  'freshness',
  'tier',
  'return_format',
  'stop_condition',
];
const BRIEF_STRING_KEYS = [
  'outcome',
  'scope',
  'acceptance',
  'freshness',
  'tier',
  'return_format',
  'stop_condition',
];

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  // Restrict to ordinary data objects: a custom-prototype instance (or one
  // carrying a toJSON) can present six plausible enumerable fields while
  // JSON.stringify serializes something else entirely via toJSON, letting
  // field checks and the byte-size check validate different shapes.
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  if (typeof value.toJSON === 'function') return false;
  return true;
}

function countWords(text) {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  return trimmed.split(/\s+/).length;
}

// The public "never throws" contract must hold even for hostile objects
// (throwing getters, Proxy traps) that unguarded Object.keys/property reads
// inside the checks below could otherwise propagate as an exception.
function validateEnvelope(env) {
  try {
    return validateEnvelopeChecked(env);
  } catch (err) {
    return { ok: false, errors: [`envelope could not be inspected: ${err.message}`] };
  }
}

function validateEnvelopeChecked(env) {
  const errors = [];

  if (!isPlainObject(env)) {
    return { ok: false, errors: ['envelope must be a plain object'] };
  }

  const keys = Object.keys(env);
  for (const key of keys) {
    if (!ENVELOPE_KEYS.includes(key)) {
      errors.push(`envelope has unexpected extra key "${key}"`);
    }
  }
  for (const key of ENVELOPE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(env, key)) {
      errors.push(`envelope is missing required key "${key}"`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(env, 'state')) {
    if (typeof env.state !== 'string') {
      errors.push('envelope field "state" must be a string');
    } else if (!ENVELOPE_STATES.has(env.state)) {
      errors.push(
        `envelope field "state" must be one of done, partial, blocked (got "${env.state}")`
      );
    }
  }

  for (const key of ENVELOPE_STRING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(env, key) && typeof env[key] !== 'string') {
      errors.push(`envelope field "${key}" must be a string`);
    }
  }

  const wordKeysAreStrings = ENVELOPE_WORD_KEYS.every(
    (key) => typeof env[key] === 'string'
  );
  if (wordKeysAreStrings) {
    const totalWords = ENVELOPE_WORD_KEYS.reduce(
      (sum, key) => sum + countWords(env[key]),
      0
    );
    if (totalWords > ENVELOPE_WORD_CEILING) {
      errors.push(
        `envelope word count across result+evidence+risks+question is ${totalWords}, exceeding the ${ENVELOPE_WORD_CEILING}-word ceiling`
      );
    }
  }

  let serializedByteLength;
  try {
    // +1 for the trailing '\n' that jsonl.appendLine writes: LINE_CEILING is
    // defined there as the full line including the newline, so an envelope
    // must leave room for it to be a byte-for-byte accurate ceiling check.
    serializedByteLength = Buffer.byteLength(JSON.stringify(env), 'utf8') + 1;
  } catch {
    serializedByteLength = Infinity;
  }
  if (serializedByteLength > LINE_CEILING) {
    errors.push(
      `envelope serialized byte length is ${serializedByteLength}, exceeding the ${LINE_CEILING}-byte ceiling`
    );
  }

  return { ok: errors.length === 0, errors };
}

function validateBrief(brief) {
  try {
    return validateBriefChecked(brief);
  } catch (err) {
    return { ok: false, errors: [`brief could not be inspected: ${err.message}`] };
  }
}

function validateBriefChecked(brief) {
  const errors = [];

  if (!isPlainObject(brief)) {
    return { ok: false, errors: ['brief must be a plain object'] };
  }

  for (const key of BRIEF_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(brief, key)) {
      errors.push(`brief is missing required key "${key}"`);
    }
  }

  for (const key of BRIEF_STRING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(brief, key)) continue;
    const value = brief[key];
    if (typeof value !== 'string') {
      errors.push(`brief field "${key}" must be a string`);
    } else if (value.trim() === '') {
      errors.push(`brief field "${key}" must be a non-empty string`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(brief, 'anchors')) {
    const anchors = brief.anchors;
    if (!Array.isArray(anchors) || anchors.length === 0) {
      errors.push('brief field "anchors" must be a non-empty array of non-empty strings');
    } else {
      const hasInvalidEntry = anchors.some(
        (entry) => typeof entry !== 'string' || entry.trim() === ''
      );
      if (hasInvalidEntry) {
        errors.push('brief field "anchors" must contain only non-empty strings');
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

// synthesis §6's uniform brownfield trust-flag taxonomy: existing
// vision/README prose enters as brainstorm INPUTS (inherited-unverified);
// existing tests enter as verification seeds that cannot vote on "done"
// until re-reviewed (inherited-advisory). Every scout artifact that carries
// inherited material is bound to one of exactly these two flags.
const TRUST_FLAGS = new Set(['inherited-unverified', 'inherited-advisory']);

const AFFECTED_MAP_STATUSES = new Set(['pending', 'green', 'quarantined']);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

// verification/affected-map.json — synthesis §2/§8.1: "test-impact
// projection; derived/rebuildable from milestone+chunk+journey metadata,
// first-class verification artifact per plan P8's failing-first dance."
// Bounded minimal envelope: which journeys are impacted by which change, and
// their current failing-first status — everything else (WHY they're
// affected) lives in the milestone/chunk/journey metadata this file is
// rebuilt from, never hand-maintained here.
function validateAffectedMap(affectedMap) {
  try {
    return validateAffectedMapChecked(affectedMap);
  } catch (err) {
    return { ok: false, errors: [`affected-map could not be inspected: ${err.message}`] };
  }
}

function validateAffectedMapChecked(affectedMap) {
  if (affectedMap === null || typeof affectedMap !== 'object' || Array.isArray(affectedMap)) {
    return { ok: false, errors: ['affected-map must be a JSON object'] };
  }
  const errors = [];
  if (affectedMap.schema_version !== 1) errors.push('affected-map.schema_version must be 1');
  if (!isNonEmptyString(affectedMap.generated_at) || Number.isNaN(Date.parse(affectedMap.generated_at))) {
    errors.push('affected-map.generated_at must be an ISO-8601 timestamp string');
  }
  if (!Array.isArray(affectedMap.entries)) {
    errors.push('affected-map.entries must be an array');
  } else {
    affectedMap.entries.forEach((entry, index) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        errors.push(`affected-map.entries[${index}] must be an object`);
        return;
      }
      if (!isNonEmptyString(entry.journey_id)) {
        errors.push(`affected-map.entries[${index}].journey_id must be a non-empty string`);
      }
      if (!Array.isArray(entry.affected_by) || !entry.affected_by.every(isNonEmptyString)) {
        errors.push(`affected-map.entries[${index}].affected_by must be an array of non-empty strings`);
      }
      if (!AFFECTED_MAP_STATUSES.has(entry.status)) {
        errors.push(
          `affected-map.entries[${index}].status must be one of ${[...AFFECTED_MAP_STATUSES].join(', ')}`
        );
      }
    });
  }
  return { ok: errors.length === 0, errors };
}

// scout/constraints.json — synthesis §6 [S6, steal #17-part]: Sol's typed
// constraint fields (preserve[], protected_paths[], compatibility[],
// migrations[], known_failures[]) field-shape-borrowed from Sol's own
// dev-record constraints.json sketch, filed under
// Claude's trust-flag taxonomy rather than replacing it. Every entry carries
// its own trust_flag — the "carries" branch of synthesis §6's "every entry
// still carries — or is reachable through reuse-map.json for — one of
// Claude's two trust flags" — so a constraints.json is self-certifying
// without a second file read to cross-reference reuse-map.json.
const SCOUT_CONSTRAINT_FIELDS = ['preserve', 'protected_paths', 'compatibility', 'migrations', 'known_failures'];

function validateScoutConstraints(constraints) {
  try {
    return validateScoutConstraintsChecked(constraints);
  } catch (err) {
    return { ok: false, errors: [`scout constraints could not be inspected: ${err.message}`] };
  }
}

function validateScoutConstraintsChecked(constraints) {
  if (constraints === null || typeof constraints !== 'object' || Array.isArray(constraints)) {
    return { ok: false, errors: ['scout constraints must be a JSON object'] };
  }
  const errors = [];
  if (constraints.schema_version !== 1) errors.push('constraints.schema_version must be 1');
  if (!Number.isInteger(constraints.revision)) errors.push('constraints.revision must be an integer');

  for (const field of SCOUT_CONSTRAINT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(constraints, field)) {
      errors.push(`constraints.${field} is required`);
      continue;
    }
    const list = constraints[field];
    if (!Array.isArray(list)) {
      errors.push(`constraints.${field} must be an array`);
      continue;
    }
    list.forEach((entry, index) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        errors.push(`constraints.${field}[${index}] must be an object`);
        return;
      }
      if (!TRUST_FLAGS.has(entry.trust_flag)) {
        errors.push(`constraints.${field}[${index}].trust_flag must be one of ${[...TRUST_FLAGS].join(', ')}`);
      }
      // protected_paths[] specifically is machine-enforced path protection
      // (plan-gate.js's assertNoProtectedPathConflicts set-intersection),
      // not merely disclosed color like the other four fields — a
      // structurally "valid" entry carrying no usable path protects nothing
      // while still activating the surrounding protocol (P11 Sol review
      // finding 7). agents/scout-agent.md:54 already documents this field's
      // full required shape as {trust_flag, path, anchor, note}; enforced
      // here, fail-closed, rather than left to plan-gate.js's own defensive
      // skip of an unmatchable entry.
      if (field === 'protected_paths') {
        if (!isNonEmptyString(entry.path)) {
          errors.push(`constraints.${field}[${index}].path must be a non-empty string`);
        }
        if (!isNonEmptyString(entry.anchor)) {
          errors.push(`constraints.${field}[${index}].anchor must be a non-empty string`);
        }
        if (!isNonEmptyString(entry.note)) {
          errors.push(`constraints.${field}[${index}].note must be a non-empty string`);
        }
      }
    });
  }

  return { ok: errors.length === 0, errors };
}

// architecture/criteria-register.json — ruled: "architecture emits
// vision-criterion->ID JSON; every ID gets exactly one journey; phase 7
// assembles, never writes." {schema_version, criteria:[{id, text, source_ref,
// journey_id}]}: id and journey_id are BOTH unique across the register — the
// former because it is the criterion's own identity, the latter because
// "exactly one journey per criterion" is enforced here as a strict 1:1
// mapping (no two criteria sharing a journey). source_ref carries
// traceability back to the vision document a criterion was assembled from.
function validateCriteriaRegister(reg) {
  try {
    return validateCriteriaRegisterChecked(reg);
  } catch (err) {
    return { ok: false, errors: [`criteria register could not be inspected: ${err.message}`] };
  }
}

// Structural floor only (P6 Sol review BLOCKING #7): this proves the register
// is well-formed and internally 1:1 (id<->journey_id) over whatever entries
// it carries, and now also that it carries at least one entry with a
// declared schema. It can never prove the register is COMPLETE against
// vision.md's actual criteria — that every vision-stated criterion is
// present, none was silently dropped, none was invented — because "what the
// vision actually requires" is a semantic judgment, not a structural one.
// That completeness check is `plan-coverage-checker`'s lost-nothing mission
// against ground truth (`product/architecture/flow.md`'s "Deriving
// the criteria register" section) — an honest division of labor, not a gap:
// the machine checks shape, the Sol coverage seat checks truth.
function validateCriteriaRegisterChecked(reg) {
  if (!isPlainObject(reg)) {
    return { ok: false, errors: ['criteria register must be a plain object'] };
  }
  const errors = [];
  if (reg.schema_version !== 1) {
    errors.push('criteria register "schema_version" must be 1');
  }
  if (!Array.isArray(reg.criteria)) {
    errors.push('criteria register "criteria" must be an array');
    return { ok: false, errors };
  }
  if (reg.criteria.length === 0) {
    errors.push('criteria register "criteria" must be a non-empty array — an empty register proves no criterion exists');
  }

  const seenIds = new Set();
  const seenJourneyIds = new Set();
  reg.criteria.forEach((entry, index) => {
    const where = `criteria[${index}]`;
    if (!isPlainObject(entry)) {
      errors.push(`${where} must be an object`);
      return;
    }
    if (!isNonEmptyString(entry.id)) {
      errors.push(`${where}.id must be a non-empty string`);
    } else if (seenIds.has(entry.id)) {
      errors.push(`${where}.id "${entry.id}" is a duplicate — criteria ids must be unique`);
    } else {
      seenIds.add(entry.id);
    }
    if (!isNonEmptyString(entry.text)) {
      errors.push(`${where}.text must be a non-empty string`);
    }
    if (!isNonEmptyString(entry.source_ref)) {
      errors.push(`${where}.source_ref must be a non-empty string`);
    }
    if (!isNonEmptyString(entry.journey_id)) {
      errors.push(`${where}.journey_id must be a non-empty string`);
    } else if (seenJourneyIds.has(entry.journey_id)) {
      errors.push(
        `${where}.journey_id "${entry.journey_id}" is a duplicate — every criterion must map to exactly one journey`
      );
    } else {
      seenJourneyIds.add(entry.journey_id);
    }
  });

  return { ok: errors.length === 0, errors };
}

const DESIGNER_FAMILIES = new Set(['claude', 'gpt']);

// architecture/milestones.json cross-checked against criteria-register.json
// (the "lost-nothing" floor): {schema_version,
// milestones:[{id, order, title, designer_family, slice_goal,
// chunk_count_estimate, criteria_ids:[...]}]}. `order` is a contiguous 1..N
// sequence (same discipline phases.js's registry loader applies to phase
// order), `criteria_ids` is a non-empty subset of string ids per milestone.
// criteriaRegister is OPTIONAL: when passed (any object carrying a
// `criteria` array), two additional checks run — every referenced criteria_id
// must exist in the register (no unknown criteria), and every register
// criterion id must be claimed by at least one milestone (nothing is lost).
function validateMilestones(ms, criteriaRegister, opts) {
  try {
    return validateMilestonesChecked(ms, criteriaRegister, opts);
  } catch (err) {
    return { ok: false, errors: [`milestones could not be inspected: ${err.message}`] };
  }
}

function validateMilestonesChecked(ms, criteriaRegister, opts) {
  if (!isPlainObject(ms)) {
    return { ok: false, errors: ['milestones must be a plain object'] };
  }
  const errors = [];
  // P6 Sol review MAJOR: "neither milestone nor register schema_version is
  // checked." Checked here (non-fatal — collected alongside every other
  // shape violation, not an early return) for the same reason
  // validateCriteriaRegister checks its own: schema_version is part of the
  // structural floor this validator proves, not merely a convention.
  if (ms.schema_version !== 1) {
    errors.push('milestones "schema_version" must be 1');
  }
  if (!Array.isArray(ms.milestones)) {
    errors.push('milestones "milestones" must be an array');
    return { ok: false, errors };
  }

  // touched_paths — the agreement-pass block law [seq 50],
  // ruled in the dev record: "a plan touching a path
  // in scout's protected_paths[] IS a block, detected deterministically by
  // set-intersection at the plan gate." That intersection needs the plan's
  // own declared footprint in machine-readable form, and milestones.json is
  // the artifact `plan-gate.js` already parses as structured JSON with a
  // natural "what does this plan do" scope. A single, top-level,
  // artifact-wide field — not per-milestone — because the gate's check is
  // set-intersection over the WHOLE plan's touched files, never a
  // per-milestone accounting. OPTIONAL in general (a greenfield plan has no
  // scout constraints to declare a footprint against); `opts.requireTouchedPaths`
  // (set by `plan-gate.js` only when a brownfield scout/constraints.json
  // carries a non-empty protected_paths[]) makes it REQUIRED, fail-closed,
  // for exactly the plans that need checking — brownfield declares its
  // footprint, greenfield need not. Entries are relative, posix-normalizable
  // paths — no absolute path, no ".." segment — the same traversal-safety
  // discipline `scout.js`'s `writeReuseMap` already applies to its own path
  // claims, applied here to the artifact that will be compared against
  // scout's own path claims.
  const hasTouchedPaths = Object.prototype.hasOwnProperty.call(ms, 'touched_paths');
  if (hasTouchedPaths) {
    const touchedPaths = ms.touched_paths;
    if (!Array.isArray(touchedPaths)) {
      errors.push('milestones "touched_paths" must be an array of relative path strings');
    } else {
      touchedPaths.forEach((p, index) => {
        if (!isNonEmptyString(p)) {
          errors.push(`milestones.touched_paths[${index}] must be a non-empty string`);
          return;
        }
        if (path.isAbsolute(p) || p.split('/').includes('..')) {
          errors.push(`milestones.touched_paths[${index}] "${p}" must be a relative path with no ".." segment`);
        }
      });
    }
  } else if (opts && opts.requireTouchedPaths === true) {
    errors.push(
      'milestones "touched_paths" is required — scout/constraints.json declares protected_paths[], and a brownfield plan must declare its own touched-file footprint before the gate can check it'
    );
  }

  const seenIds = new Set();
  const seenOrders = new Set();
  const claimedCriteriaIds = new Set();
  const allReferencedCriteriaIds = [];

  ms.milestones.forEach((entry, index) => {
    const where = `milestones[${index}]`;
    if (!isPlainObject(entry)) {
      errors.push(`${where} must be an object`);
      return;
    }
    if (!isNonEmptyString(entry.id)) {
      errors.push(`${where}.id must be a non-empty string`);
    } else if (seenIds.has(entry.id)) {
      errors.push(`${where}.id "${entry.id}" is a duplicate — milestone ids must be unique`);
    } else {
      seenIds.add(entry.id);
    }

    if (!Number.isInteger(entry.order)) {
      errors.push(`${where}.order must be an integer`);
    } else if (seenOrders.has(entry.order)) {
      errors.push(`${where}.order ${entry.order} is a duplicate`);
    } else {
      seenOrders.add(entry.order);
    }

    if (!isNonEmptyString(entry.title)) {
      errors.push(`${where}.title must be a non-empty string`);
    }
    if (!DESIGNER_FAMILIES.has(entry.designer_family)) {
      errors.push(`${where}.designer_family must be one of ${[...DESIGNER_FAMILIES].join(', ')}`);
    }
    if (!isNonEmptyString(entry.slice_goal)) {
      errors.push(`${where}.slice_goal must be a non-empty string`);
    }
    if (!Number.isInteger(entry.chunk_count_estimate) || entry.chunk_count_estimate < 0) {
      errors.push(`${where}.chunk_count_estimate must be a non-negative integer`);
    }

    // toolchain_profile (research/r3/toolchain-scaffolding.md §2: "one
    // closed-enum field, not a new artifact file") is OPTIONAL — a milestone
    // authored before R3 landed, or one that genuinely needs no toolchain
    // action, carries no such key at all, and that is honest (null is the
    // field's own "nothing needed" value, not merely its absence). Only a
    // PRESENT-but-invalid value fails closed, the same absence-vs-wrong-type
    // distinction check-honesty.js's state.gates/checklist fields already draw.
    if (Object.prototype.hasOwnProperty.call(entry, 'toolchain_profile')) {
      const tp = entry.toolchain_profile;
      if (tp !== null && !PROFILE_IDS.has(tp)) {
        errors.push(
          `${where}.toolchain_profile must be null or one of ${[...PROFILE_IDS].join(', ')} (got ${JSON.stringify(tp)})`
        );
      }
    }

    if (!Array.isArray(entry.criteria_ids) || entry.criteria_ids.length === 0) {
      errors.push(`${where}.criteria_ids must be a non-empty array`);
    } else {
      entry.criteria_ids.forEach((cid, cidIndex) => {
        if (!isNonEmptyString(cid)) {
          errors.push(`${where}.criteria_ids[${cidIndex}] must be a non-empty string`);
          return;
        }
        claimedCriteriaIds.add(cid);
        allReferencedCriteriaIds.push({ id: cid, where: `${where}.criteria_ids[${cidIndex}]` });
      });
    }
  });

  // "order" values, taken together, must be the contiguous sequence 1..N —
  // no gaps, no phase-registry-style skip — mirroring phases.js's own
  // contiguous-order discipline for its (structurally analogous) registry.
  const n = ms.milestones.length;
  for (let expected = 1; expected <= n; expected++) {
    if (!seenOrders.has(expected)) {
      errors.push(`milestones has a non-contiguous "order" sequence (missing ${expected})`);
    }
  }

  if (criteriaRegister !== undefined) {
    if (!isPlainObject(criteriaRegister) || !Array.isArray(criteriaRegister.criteria)) {
      errors.push('criteriaRegister (for cross-check) must be an object with a "criteria" array');
    } else {
      const knownIds = new Set();
      for (const entry of criteriaRegister.criteria) {
        if (isPlainObject(entry) && isNonEmptyString(entry.id)) {
          knownIds.add(entry.id);
        }
      }

      for (const { id, where } of allReferencedCriteriaIds) {
        if (!knownIds.has(id)) {
          errors.push(`${where} references unknown criterion "${id}" — not present in the criteria register`);
        }
      }

      for (const id of knownIds) {
        if (!claimedCriteriaIds.has(id)) {
          errors.push(
            `criteria register criterion "${id}" is not claimed by any milestone — every criterion must appear in at least one milestone`
          );
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

// deviation ledger records (P11 finding F12) — the shape check-honesty.js's
// recordDeviation validates before writing kind:"deviation" to ledger.jsonl.
// Four required non-empty-string fields, deliberately narrow: who is
// reporting (an agent name, never "system" or "unknown"), what the brief or
// protocol led them to expect, what actually happened, and a one-line
// summary a reader who never opens the full ledger can still act on. No
// severity field — a deviation is an audit fact about a trust gap between
// instruction and reality, independent of whether it also became a blocker;
// the blocker ladder's own S1/S2/S3 vocabulary is for THAT separate question
// and is not duplicated here.
const DEVIATION_FIELDS = ['reported_by', 'expected', 'actual', 'summary'];

// The reporter-identity floor this file's own schema comment above already
// documents (P11 Sol review finding 18): "reported_by" names a real agent,
// never one of these two placeholders — an audit fact with no attributable
// reporter behind it is not a deviation report.
const FORBIDDEN_REPORTED_BY = new Set(['system', 'unknown']);

function validateDeviation(deviation) {
  try {
    return validateDeviationChecked(deviation);
  } catch (err) {
    return { ok: false, errors: [`deviation could not be inspected: ${err.message}`] };
  }
}

function validateDeviationChecked(deviation) {
  if (deviation === null || typeof deviation !== 'object' || Array.isArray(deviation)) {
    return { ok: false, errors: ['deviation must be a plain object'] };
  }
  const errors = [];
  for (const key of DEVIATION_FIELDS) {
    if (!isNonEmptyString(deviation[key])) {
      errors.push(`deviation field "${key}" must be a non-empty string`);
    }
  }
  if (isNonEmptyString(deviation.reported_by) && FORBIDDEN_REPORTED_BY.has(deviation.reported_by)) {
    errors.push(`deviation field "reported_by" must name a real reporting agent, never "${deviation.reported_by}"`);
  }
  const extraKeys = Object.keys(deviation).filter((key) => !DEVIATION_FIELDS.includes(key));
  for (const key of extraKeys) {
    errors.push(`deviation has unexpected extra key "${key}"`);
  }
  return { ok: errors.length === 0, errors };
}

// last-mile.jsonl "park" records (P11 finding F4) — the shape
// machine/src/delivery.js's recordPark validates before writing kind:"park"
// to last-mile.jsonl. Sibling of validateDeviation: two required non-empty-
// string fields (summary, severity) and one optional non-empty-string field
// (owner_phase) — the exact fields assembleLastMile's own collectParks
// reads, no more.
const PARK_REQUIRED_FIELDS = ['summary', 'severity'];
const PARK_OPTIONAL_FIELDS = ['owner_phase'];
const PARK_ALL_FIELDS = [...PARK_REQUIRED_FIELDS, ...PARK_OPTIONAL_FIELDS];

// The blocker ladder's own parkable set (agents/maestro.md's Blocker
// ladder — seq: "S2 (localized) or S3 (polish) -> park it"): S1 is a
// foundational/fence-breach severity that stops for the operator, never
// parked. validatePark previously accepted any non-empty string here (P11
// Sol review finding 13), letting a park record bypass the exact branch
// vocabulary it exists to enforce.
const PARK_SEVERITIES = new Set(['S2', 'S3']);

function validatePark(park) {
  try {
    return validateParkChecked(park);
  } catch (err) {
    return { ok: false, errors: [`park could not be inspected: ${err.message}`] };
  }
}

function validateParkChecked(park) {
  if (park === null || typeof park !== 'object' || Array.isArray(park)) {
    return { ok: false, errors: ['park must be a plain object'] };
  }
  const errors = [];
  for (const key of PARK_REQUIRED_FIELDS) {
    if (!isNonEmptyString(park[key])) {
      errors.push(`park field "${key}" must be a non-empty string`);
    }
  }
  if (isNonEmptyString(park.severity) && !PARK_SEVERITIES.has(park.severity)) {
    errors.push(
      `park field "severity" must be one of ${[...PARK_SEVERITIES].join(', ')} (the blocker ladder's parkable set — S1 is a hard stop, never parked), got "${park.severity}"`
    );
  }
  if (Object.prototype.hasOwnProperty.call(park, 'owner_phase') && !isNonEmptyString(park.owner_phase)) {
    errors.push('park field "owner_phase" must be a non-empty string when present');
  }
  const extraKeys = Object.keys(park).filter((key) => !PARK_ALL_FIELDS.includes(key));
  for (const key of extraKeys) {
    errors.push(`park has unexpected extra key "${key}"`);
  }
  return { ok: errors.length === 0, errors };
}

// ledger.jsonl "stop" records (P11 parked question (c), converged: the
// handoff pair's `handoff.js write-stop` command) — the shape
// machine/src/handoff.js's writeStop validates before writing kind:"stop".
// The closed stop-state vocabulary is `agents/maestro.md`'s own Stop-states
// section, verbatim: "DONE, BLOCKED-OPERATOR (the question is in
// handoff.md), QUOTA-WAIT (earliest-resume time recorded), BUDGET-CEILING,
// or EXHAUSTED (only parked lanes remain)". Two fields are always required
// (stop_state, reporter — the same reporter-identity floor as a deviation
// report: an audit fact with no attributable reporter is not a stop
// record); two more are required ONLY for the one stop kind that carries
// them, and refused outright for every other kind — a closed field set PER
// kind, not merely a shared bag every kind may reach into.
// A single-line-only floor for every stop field handoff.js's renderHandoffMd
// interpolates onto its own dedicated Markdown line (P11 Sol review pass-2
// finding 6): a forged value carrying an embedded "\n"/"\r" would inject
// additional, unattributed lines into handoff.md — including lines that
// impersonate a DIFFERENT field's own prefix (a `reporter` value like
// "x\nStop state: DONE" renders a second, forged "Stop state:" line below
// the real one) — defeating the "next session reads this file as an
// unambiguous mechanical view" property the whole handoff pair exists for.
const SINGLE_LINE_RE = /^[^\r\n]*$/;

function isSingleLineNonEmptyString(value) {
  return isNonEmptyString(value) && SINGLE_LINE_RE.test(value);
}

const STOP_STATES = new Set(['DONE', 'BLOCKED-OPERATOR', 'QUOTA-WAIT', 'BUDGET-CEILING', 'EXHAUSTED']);
const STOP_BASE_FIELDS = ['stop_state', 'reporter'];
const STOP_KIND_ONLY_FIELDS = ['question', 'earliest_resume'];
const STOP_ALL_FIELDS = [...STOP_BASE_FIELDS, ...STOP_KIND_ONLY_FIELDS];
// Which of STOP_KIND_ONLY_FIELDS a given stop_state requires — DONE,
// BUDGET-CEILING, and EXHAUSTED require neither (and permit neither).
const STOP_KIND_REQUIRED_FIELDS = {
  'BLOCKED-OPERATOR': ['question'],
  'QUOTA-WAIT': ['earliest_resume'],
};

function validateStop(stop) {
  try {
    return validateStopChecked(stop);
  } catch (err) {
    return { ok: false, errors: [`stop could not be inspected: ${err.message}`] };
  }
}

function validateStopChecked(stop) {
  if (stop === null || typeof stop !== 'object' || Array.isArray(stop)) {
    return { ok: false, errors: ['stop must be a plain object'] };
  }
  const errors = [];

  const stopStateOk = isNonEmptyString(stop.stop_state) && STOP_STATES.has(stop.stop_state);
  if (!stopStateOk) {
    errors.push(`stop field "stop_state" must be one of ${[...STOP_STATES].join(', ')}`);
  }
  if (!isNonEmptyString(stop.reporter)) {
    errors.push('stop field "reporter" must be a non-empty string');
  } else if (!SINGLE_LINE_RE.test(stop.reporter)) {
    errors.push('stop field "reporter" must not contain a newline or carriage return');
  }

  // Per-kind fields — required when this stop's own kind names them,
  // refused outright (present at all) when it doesn't. Only evaluated
  // against a recognized stop_state; an already-invalid stop_state gets no
  // second, confusing set of per-kind field errors layered on top.
  const requiredExtra = stopStateOk ? STOP_KIND_REQUIRED_FIELDS[stop.stop_state] || [] : [];
  for (const field of STOP_KIND_ONLY_FIELDS) {
    const present = Object.prototype.hasOwnProperty.call(stop, field);
    const required = requiredExtra.includes(field);
    if (required) {
      if (field === 'earliest_resume') {
        if (
          !isNonEmptyString(stop.earliest_resume) ||
          !ISO_8601_UTC_RE.test(stop.earliest_resume) ||
          Number.isNaN(Date.parse(stop.earliest_resume))
        ) {
          errors.push('stop field "earliest_resume" must be an ISO-8601 UTC timestamp string when stop_state is "QUOTA-WAIT"');
        }
      } else if (!isSingleLineNonEmptyString(stop[field])) {
        errors.push(
          isNonEmptyString(stop[field])
            ? `stop field "${field}" must not contain a newline or carriage return`
            : `stop field "${field}" must be a non-empty string when stop_state is "${stop.stop_state}"`
        );
      }
    } else if (stopStateOk && present) {
      errors.push(`stop field "${field}" is not permitted when stop_state is "${stop.stop_state}"`);
    }
  }

  const extraKeys = Object.keys(stop).filter((key) => !STOP_ALL_FIELDS.includes(key));
  for (const key of extraKeys) {
    errors.push(`stop has unexpected extra key "${key}"`);
  }
  return { ok: errors.length === 0, errors };
}

// intake/report.json — the typed record of finding a legacy tree, written by
// `intake.js harvest` and by nothing else (legacy-intake design §4.2). Two
// things make this validator worth its lines rather than a shape rubber-stamp:
//
//   1. It is the harvest's COMMIT WITNESS. §9.1.3 pairs it with
//      `routing/active.json`: the last write of a fixed sequence is that
//      sequence's witness, so "report.json exists and passes this validator"
//      is what a re-entering transaction reads as "the harvest committed".
//      A validator that accepted a torn report would make that proof a lie.
//   2. It is where §3.1's anti-fabrication rule becomes MACHINE-CHECKABLE.
//      Every carried entry must land under `intake/` — not `vision/`, not
//      `state.json`, not `milestones/` — and must carry one of this module's
//      two existing TRUST_FLAGS. A legacy VISION.md written to
//      `.kiln/vision/vision.md` would be byte-indistinguishable from a vision
//      the operator confirmed through the Sketchbook, which is fabrication of
//      earned state; this check refuses that plan before the first copy runs.
//
// It runs in the harvest's PLAN phase, before any mutation (§9.2.4), so a
// report that cannot pass leaves the filesystem byte-identical.
const INTAKE_REPORT_KEYS = [
  'schema_version',
  'txn_id',
  'tier',
  'markers',
  'archive_path',
  'archive_mtime',
  'aborted_scaffolds',
  'residue_path',
  'restore_commands',
  'carried',
  'noted',
  'ignored',
  'unreadable',
  'truncated',
  'harvested_utc',
];
const INTAKE_NOTED_KEYS = ['law_sealed', 'seals', 'audits', 'reviews', 'evidence', 'verbatim', 'entries'];
// `title` and `mtime` are tier 2's, and only tier 2's: §3.3 records
// {path, bytes, mtime, title} for every generic document, and the title is
// the one handle a reader has on a document nothing has classified. Tier 1's
// entries carry neither — their role IS the handle, and a title there would
// have to be read for no reader, or invented.
const INTAKE_CARRIED_KEYS = ['path', 'dest', 'role', 'trust_flag', 'bytes', 'title', 'mtime'];
// The closed role set of §3.2/§4.2's populate map. `document` is tier 2's
// single generic role; the other five are tier 1's typed ones.
const INTAKE_ROLES = new Set(['vision', 'law', 'design', 'research', 'codebase', 'document']);
// §3.4's three-value vocabulary, and only ever a `noted` fact: seal state
// never gates the harvest.
const INTAKE_LAW_SEAL_STATES = new Set(['sealed', 'unsealed', 'torn']);
const INTAKE_TXN_ID_RE = /^[0-9a-f]{32}$/;
const INTAKE_DEST_PREFIX = 'intake/';

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isUtcTimestamp(value) {
  return typeof value === 'string' && ISO_8601_UTC_RE.test(value) && !Number.isNaN(Date.parse(value));
}

// A relative POSIX path that cannot climb: no leading separator, no `..`
// segment, no drive letter. Used for both `archive_path` and every carried
// `dest`, so a report can never NAME a path outside the tree even before the
// filesystem-level containment check runs against it.
function isContainedRelativePath(value) {
  if (typeof value !== 'string' || value === '') return false;
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false;
  const segments = value.split(/[/\\]/);
  return segments.every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

// The single-line floor for the intake report, stated as one law over the
// whole shape: EVERY string in it is single-line except `noted.verbatim[].text`,
// which is the operator's own recorded prose and is never rendered into
// report.md at all. `renderReport` puts one value per Markdown line, and a
// value carrying "\n"/"\r" injects additional, unattributed lines — a
// paragraph asserting what the harvest did not do, or a fenced block reading
// as the report's own recovery commands. Here the value comes off the
// filesystem rather than from a caller: an archived file whose NAME embeds a
// newline is enough. Same class the stop fields close at SINGLE_LINE_RE, one
// scope wider.
//
// The offending value is named in the error because it is the diagnosis: a
// report that fails here is never written, so the operator has nothing else
// to read it off.
function checkSingleLine(value, at, errors) {
  if (!isNonEmptyString(value)) {
    errors.push(`${at} must be a non-empty string`);
    return;
  }
  if (!SINGLE_LINE_RE.test(value)) {
    errors.push(`${at} must not contain a line break (${JSON.stringify(value.slice(0, 60))})`);
  }
}

function checkSingleLineList(list, at, errors) {
  if (!Array.isArray(list)) {
    errors.push(`${at} must be an array of non-empty strings`);
    return;
  }
  list.forEach((value, index) => checkSingleLine(value, `${at}[${index}]`, errors));
}

// {path, reason} plus an optional `link_target` — the shape §9.2.3 gives a
// source symlink: the raw readlink string is recorded as an uninterpreted
// string, never resolved, because the target is never touched.
function checkPathReasonEntries(list, label, errors, { allowLinkTarget = false } = {}) {
  if (!Array.isArray(list)) {
    errors.push(`intake-report.${label} must be an array`);
    return;
  }
  list.forEach((entry, index) => {
    const at = `intake-report.${label}[${index}]`;
    if (!isPlainObject(entry)) {
      errors.push(`${at} must be an object`);
      return;
    }
    const allowed = allowLinkTarget ? ['path', 'reason', 'link_target'] : ['path', 'reason'];
    for (const key of Object.keys(entry)) {
      if (!allowed.includes(key)) errors.push(`${at} has unexpected key "${key}"`);
    }
    checkSingleLine(entry.path, `${at}.path`, errors);
    checkSingleLine(entry.reason, `${at}.reason`, errors);
    if (Object.prototype.hasOwnProperty.call(entry, 'link_target')) {
      if (typeof entry.link_target !== 'string') {
        errors.push(`${at}.link_target must be a string when present`);
      } else if (!SINGLE_LINE_RE.test(entry.link_target)) {
        errors.push(`${at}.link_target must not contain a line break (${JSON.stringify(entry.link_target.slice(0, 60))})`);
      }
    }
  });
}

// {count, source, sources[]} (+ `slices[]` for seals). §3.4 forbids
// reconciling a `.log` that disagrees with a `.jsonl`: BOTH counts are
// recorded in `sources[]` and neither file is repaired, so the disagreement
// survives into the report as the fact about an interrupted run that it is.
function checkCountedLedger(value, label, errors, { withSlices = false } = {}) {
  if (value === null) return;
  const at = `intake-report.noted.${label}`;
  if (!isPlainObject(value)) {
    errors.push(`${at} must be an object or null`);
    return;
  }
  const allowed = withSlices ? ['count', 'slices', 'source', 'sources'] : ['count', 'source', 'sources'];
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${at} has unexpected key "${key}"`);
  }
  if (!isNonNegativeInteger(value.count)) errors.push(`${at}.count must be a non-negative integer`);
  checkSingleLine(value.source, `${at}.source`, errors);
  if (withSlices) checkSingleLineList(value.slices, `${at}.slices`, errors);
  if (!Array.isArray(value.sources) || value.sources.length === 0) {
    errors.push(`${at}.sources must be a non-empty array`);
    return;
  }
  value.sources.forEach((entry, index) => {
    const src = `${at}.sources[${index}]`;
    if (!isPlainObject(entry)) {
      errors.push(`${src} must be an object`);
      return;
    }
    for (const key of Object.keys(entry)) {
      if (key !== 'file' && key !== 'count') errors.push(`${src} has unexpected key "${key}"`);
    }
    checkSingleLine(entry.file, `${src}.file`, errors);
    if (!isNonNegativeInteger(entry.count)) errors.push(`${src}.count must be a non-negative integer`);
  });
}

const INTAKE_TXN_SCHEMA_VERSION = 1;
const INTAKE_TXN_PHASES = ['claimed', 'archived', 'scaffolded', 'placed', 'harvested'];

// What makes an intake transaction record AUTHENTIC (legacy-intake design
// §9.1.2), stated once. Two modules read the marker — detect.js probes it to
// classify (row 0), intake.js reads it to resume the ladder — and the rule
// was written in both, where it drifted by a field: intake required
// `aborted_scaffolds`, detect did not, so a record missing it made detect
// report an in-flight transaction that intake then refused as corrupt.
//
// Each caller keeps its own filesystem read and its own refusal voice; what
// they share is the contract. `{ok:false, field, saw}` names the first
// mismatch, with `saw` already rendered, so both render the same sentence.
function checkIntakeTxn(txn, { projectRootReal, treeName }) {
  const mismatch = (field, value) => ({ ok: false, field, saw: JSON.stringify(value) });
  if (txn.schema_version !== INTAKE_TXN_SCHEMA_VERSION) return mismatch('schema_version', txn.schema_version);
  if (typeof txn.txn_id !== 'string' || !INTAKE_TXN_ID_RE.test(txn.txn_id)) return mismatch('txn_id', txn.txn_id);
  if (txn.tree_name !== treeName) return mismatch('tree_name', txn.tree_name);
  if (txn.project_root_real !== projectRootReal) return mismatch('project_root_real', txn.project_root_real);
  if (typeof txn.phase !== 'string' || !INTAKE_TXN_PHASES.includes(txn.phase)) return mismatch('phase', txn.phase);
  if (!Array.isArray(txn.aborted_scaffolds)) return mismatch('aborted_scaffolds', txn.aborted_scaffolds);
  return { ok: true };
}

function validateIntakeReport(report) {
  try {
    return validateIntakeReportChecked(report);
  } catch (err) {
    return { ok: false, errors: [`intake-report could not be inspected: ${err.message}`] };
  }
}

function validateIntakeReportChecked(report) {
  if (!isPlainObject(report)) {
    return { ok: false, errors: ['intake-report must be a JSON object'] };
  }
  const errors = [];

  for (const key of Object.keys(report)) {
    if (!INTAKE_REPORT_KEYS.includes(key)) errors.push(`intake-report has unexpected key "${key}"`);
  }
  for (const key of INTAKE_REPORT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(report, key)) {
      errors.push(`intake-report is missing required key "${key}"`);
    }
  }

  if (report.schema_version !== 1) errors.push('intake-report.schema_version must be 1');
  if (typeof report.txn_id !== 'string' || !INTAKE_TXN_ID_RE.test(report.txn_id)) {
    errors.push('intake-report.txn_id must be 32 lowercase hex characters');
  }
  if (report.tier !== 1 && report.tier !== 2) errors.push('intake-report.tier must be 1 or 2');
  checkSingleLineList(report.markers, 'intake-report.markers', errors);
  if (!isContainedRelativePath(report.archive_path)) {
    errors.push('intake-report.archive_path must be a relative path with no ".." segment');
  } else {
    checkSingleLine(report.archive_path, 'intake-report.archive_path', errors);
  }
  if (report.archive_mtime !== null && !isUtcTimestamp(report.archive_mtime)) {
    errors.push('intake-report.archive_mtime must be an ISO-8601 UTC timestamp or null');
  }
  if (!isUtcTimestamp(report.harvested_utc)) {
    errors.push('intake-report.harvested_utc must be an ISO-8601 UTC timestamp');
  }
  if (typeof report.truncated !== 'boolean') errors.push('intake-report.truncated must be a boolean');
  checkSingleLineList(report.restore_commands, 'intake-report.restore_commands', errors);

  // §9.1.4's retirement rule, as a shape law: an aborted scaffold is never
  // deleted, so a report naming one MUST also name where it was kept, and a
  // report naming residue must say what is in it. Neither half stands alone.
  if (!Array.isArray(report.aborted_scaffolds)) {
    errors.push('intake-report.aborted_scaffolds must be an array of non-empty strings');
  } else {
    checkSingleLineList(report.aborted_scaffolds, 'intake-report.aborted_scaffolds', errors);
    if (report.aborted_scaffolds.length === 0) {
      if (report.residue_path !== null) {
        errors.push('intake-report.residue_path must be null when aborted_scaffolds is empty');
      }
    } else if (!isNonEmptyString(report.residue_path)) {
      errors.push('intake-report.residue_path must name the kept residue when aborted_scaffolds is non-empty');
    } else {
      checkSingleLine(report.residue_path, 'intake-report.residue_path', errors);
    }
  }

  if (!Array.isArray(report.carried)) {
    errors.push('intake-report.carried must be an array');
  } else {
    report.carried.forEach((entry, index) => {
      const at = `intake-report.carried[${index}]`;
      if (!isPlainObject(entry)) {
        errors.push(`${at} must be an object`);
        return;
      }
      for (const key of Object.keys(entry)) {
        if (!INTAKE_CARRIED_KEYS.includes(key)) errors.push(`${at} has unexpected key "${key}"`);
      }
      checkSingleLine(entry.path, `${at}.path`, errors);
      // The anti-fabrication rule (§3.1, §4.1), enforced here and nowhere
      // else in this module: carried material lands under intake/ only.
      if (!isContainedRelativePath(entry.dest) || !entry.dest.startsWith(INTAKE_DEST_PREFIX)) {
        errors.push(`${at}.dest must be a relative path under "${INTAKE_DEST_PREFIX}" with no ".." segment`);
      } else {
        checkSingleLine(entry.dest, `${at}.dest`, errors);
      }
      if (!INTAKE_ROLES.has(entry.role)) {
        errors.push(`${at}.role must be one of ${[...INTAKE_ROLES].join(', ')}`);
      }
      if (!TRUST_FLAGS.has(entry.trust_flag)) {
        errors.push(`${at}.trust_flag must be one of ${[...TRUST_FLAGS].join(', ')}`);
      }
      if (!isNonNegativeInteger(entry.bytes)) errors.push(`${at}.bytes must be a non-negative integer`);
      // The tier decides which record shape is complete, so a generic harvest
      // that quietly stopped recording what it read cannot still produce a
      // valid-looking report — and a typed harvest cannot start claiming a
      // title it never opened the file to read.
      if (report.tier === 2) {
        if (!isNonEmptyString(entry.title)) {
          errors.push(`${at}.title must be a non-empty string in a tier-2 report`);
        } else {
          checkSingleLine(entry.title, `${at}.title`, errors);
        }
        if (entry.mtime !== null && !isUtcTimestamp(entry.mtime)) {
          errors.push(`${at}.mtime must be an ISO-8601 UTC timestamp or null in a tier-2 report`);
        }
      } else {
        for (const key of ['title', 'mtime']) {
          if (Object.prototype.hasOwnProperty.call(entry, key)) {
            errors.push(`${at} has unexpected key "${key}" in a tier-1 report`);
          }
        }
      }
    });
  }

  if (!isPlainObject(report.noted)) {
    errors.push('intake-report.noted must be an object');
  } else {
    const noted = report.noted;
    for (const key of Object.keys(noted)) {
      if (!INTAKE_NOTED_KEYS.includes(key)) errors.push(`intake-report.noted has unexpected key "${key}"`);
    }
    for (const key of INTAKE_NOTED_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(noted, key)) {
        errors.push(`intake-report.noted is missing required key "${key}"`);
      }
    }
    if (!INTAKE_LAW_SEAL_STATES.has(noted.law_sealed)) {
      errors.push(`intake-report.noted.law_sealed must be one of ${[...INTAKE_LAW_SEAL_STATES].join(', ')}`);
    }
    checkCountedLedger(noted.seals, 'seals', errors, { withSlices: true });
    checkCountedLedger(noted.audits, 'audits', errors);
    if (noted.reviews !== null) {
      if (!isPlainObject(noted.reviews)) {
        errors.push('intake-report.noted.reviews must be an object or null');
      } else {
        for (const key of Object.keys(noted.reviews)) {
          if (key !== 'count') errors.push(`intake-report.noted.reviews has unexpected key "${key}"`);
        }
        if (!isNonNegativeInteger(noted.reviews.count)) {
          errors.push('intake-report.noted.reviews.count must be a non-negative integer');
        }
      }
    }
    if (noted.evidence !== null) {
      if (!isPlainObject(noted.evidence)) {
        errors.push('intake-report.noted.evidence must be an object or null');
      } else {
        for (const key of Object.keys(noted.evidence)) {
          if (key !== 'count' && key !== 'generations') {
            errors.push(`intake-report.noted.evidence has unexpected key "${key}"`);
          }
        }
        if (!isNonNegativeInteger(noted.evidence.count)) {
          errors.push('intake-report.noted.evidence.count must be a non-negative integer');
        }
        checkSingleLineList(noted.evidence.generations, 'intake-report.noted.evidence.generations', errors);
      }
    }
    if (!Array.isArray(noted.verbatim)) {
      errors.push('intake-report.noted.verbatim must be an array');
    } else {
      noted.verbatim.forEach((entry, index) => {
        const at = `intake-report.noted.verbatim[${index}]`;
        if (!isPlainObject(entry)) {
          errors.push(`${at} must be an object`);
          return;
        }
        for (const key of Object.keys(entry)) {
          if (!['path', 'bytes', 'text', 'truncated'].includes(key)) {
            errors.push(`${at} has unexpected key "${key}"`);
          }
        }
        checkSingleLine(entry.path, `${at}.path`, errors);
        if (!isNonNegativeInteger(entry.bytes)) errors.push(`${at}.bytes must be a non-negative integer`);
        if (typeof entry.truncated !== 'boolean') errors.push(`${at}.truncated must be a boolean`);
        // `text` is null exactly when the record was too large to carry
        // verbatim — an honest omission, never a silent truncation of the
        // operator's own recorded words.
        if (entry.truncated) {
          if (entry.text !== null) errors.push(`${at}.text must be null when truncated is true`);
        } else if (typeof entry.text !== 'string') {
          errors.push(`${at}.text must be a string when truncated is false`);
        }
      });
    }
    checkPathReasonEntries(noted.entries, 'noted.entries', errors, { allowLinkTarget: true });
  }

  checkPathReasonEntries(report.ignored, 'ignored', errors);
  checkPathReasonEntries(report.unreadable, 'unreadable', errors);

  return { ok: errors.length === 0, errors };
}

// CLI entrypoint (P11 finding "library-only call" class: research-worker.md's
// own validateBrief site, plan-author.md's own validateCriteriaRegister site,
// plan-author-sol.md's own validateMilestones site). All three read their
// document from stdin (the judge-verdict.js stdin pattern) and print the
// validator's own `{ok, errors}` result, exiting 0 when ok and 1 otherwise —
// this module's other validators stay library-only, called in-process by the
// workers that already hold the parsed object they're validating.
const VALIDATE_COMMANDS = ['validate-brief', 'validate-criteria-register', 'validate-milestones'];

// Recognized argv flags for `validate-milestones` — currently one, taking
// no value. parseArgv fails closed (P11 Sol review finding 6) on anything
// this loop does not recognize by exact name, rather than silently ignoring
// an unknown or misspelled flag and proceeding as if it had never been
// given: a misspelled `--criteria-regster` previously reached `main` as a
// bare positional with no effect at all, silently skipping a cross-check
// the caller believed was running.
const KNOWN_FLAGS = new Set(['--require-touched-paths']);

function parseArgv(argv) {
  const [command, ...rest] = argv;
  let requireTouchedPaths = false;
  for (const flag of rest) {
    if (flag === '--require-touched-paths') {
      requireTouchedPaths = true;
    } else {
      return { command, error: `unknown flag "${flag}" (known flags: ${[...KNOWN_FLAGS].join(', ')})` };
    }
  }
  return { command, requireTouchedPaths, error: null };
}

function main(argv) {
  const { command, requireTouchedPaths, error } = parseArgv(argv);
  if (!VALIDATE_COMMANDS.includes(command) || error) {
    if (error) process.stderr.write(`validators.js: ${error}\n`);
    process.stderr.write(
      'usage: validators.js validate-brief   (brief JSON piped via stdin)\n' +
        '       validators.js validate-criteria-register   (register JSON piped via stdin)\n' +
        '       validators.js validate-milestones [--require-touched-paths]   (milestones JSON via stdin, or a {milestones, criteria_register} envelope JSON via stdin for the cross-checked pass)\n'
    );
    process.exit(1);
  }
  try {
    const inputText = fs.readFileSync(0, 'utf8'); // fd 0 = stdin
    const input = JSON.parse(inputText);
    let result;
    if (command === 'validate-brief') {
      result = validateBrief(input);
    } else if (command === 'validate-criteria-register') {
      result = validateCriteriaRegister(input);
    } else {
      // The criteria-register cross-check input moved off the shell
      // argument entirely (P11 Sol review finding 14): a single-quoted
      // `--criteria-register '<json>'` argument could never safely carry a
      // criterion string containing an apostrophe, and a large register is
      // bounded by the process argument-size limit. Both full documents now
      // arrive together over stdin as one envelope object — {milestones,
      // criteria_register} — distinguished from a bare milestones document
      // by "milestones" itself being a plain object (the full document)
      // rather than an array (a bare document's own "milestones" field).
      const isEnvelope = isPlainObject(input) && isPlainObject(input.milestones);
      const ms = isEnvelope ? input.milestones : input;
      const criteriaRegister = isEnvelope ? input.criteria_register : undefined;
      const opts = requireTouchedPaths ? { requireTouchedPaths: true } : undefined;
      result = validateMilestones(ms, criteriaRegister, opts);
    }
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    process.stderr.write(`validators.js: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  validateEnvelope,
  validateBrief,
  validateAffectedMap,
  validateScoutConstraints,
  validateCriteriaRegister,
  validateMilestones,
  validateDeviation,
  validatePark,
  validateStop,
  validateIntakeReport,
  checkIntakeTxn,
  TRUST_FLAGS,
  DESIGNER_FAMILIES,
  DEVIATION_FIELDS,
  PARK_ALL_FIELDS,
  STOP_STATES,
  STOP_ALL_FIELDS,
};
