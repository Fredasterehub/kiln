'use strict';

// The closed kind-ownership table for the product-payload streams that had
// no owning module at all (P11 Sol review finding 3: "transcript
// readRecords/appendRecord... research-cache and stream writers... onboarding
// readJson/appendRecord" — commanded runtime calls with no executable,
// plugin-install-safe form; P11 convergence finding 8: "each sanctioned
// command must reject kinds or targets outside its closed contract... a
// generic stream CLI must not accept an arbitrary ledger path and kind").
//
// STREAM_REGISTRY below is the ENTIRE closed set this module will ever
// append to or read from — a caller names a symbolic streamId, never a
// literal path, so a target outside this table is structurally
// unreachable; and every streamId carries its own fixed, closed kind
// vocabulary, so a kind outside that one stream's own set is refused even
// though the caller correctly named the stream. This is NOT a generic
// "append anything, anywhere" mechanism — it is four narrow, independently
// closed contracts that happen to share one dispatcher, the same way
// validators.js shares one dispatcher across several unrelated shapes.
//
// research/scratchpad.jsonl's own "freshness_gate" kind is DELIBERATELY
// excluded from this table's allowed set — machine/src/research-cache.js's
// recordGateCheck is already that kind's sole sanctioned writer (one
// native mechanism per constraint), and admitting it here too
// would create a second writer for the exact same fact.

const fs = require('node:fs');
const path = require('node:path');

const { appendRecord, readRecords } = require('./stream.js');

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

// requireExactKeys(payload, keys, kindLabel) — a payload's own key set must
// match `keys` EXACTLY (no more, no fewer), the same "no silent extra field"
// discipline telemetry.js's own EVENT_KINDS dispatch already applies to its
// payload shapes (P11 Sol review finding 7: an `onboarding-decision` payload
// carrying an `unexpected` key alongside a forged `event` value was accepted
// whole, since only `kind` was ever checked).
function requireExactKeys(payload, keys, kindLabel) {
  const supplied = Object.keys(payload).sort();
  const expected = [...keys].sort();
  const matches = supplied.length === expected.length && supplied.every((k, i) => k === expected[i]);
  if (!matches) {
    throw new Error(
      `kind-registry: "${kindLabel}" payload must supply exactly these fields: ${expected.join(', ') || '(none)'} (got: ${supplied.join(', ') || '(none)'})`
    );
  }
}

// PAYLOAD_VALIDATORS — per-(streamId, kind) payload contracts, closing each
// closed stream's contract at the boundary that actually writes it (P11 Sol
// review finding 7). Every shape below is transcribed from the charter that
// documents it, cited in each validator's own comment — never invented.
// A (streamId, kind) pair absent from this table (vision-transcript's own
// "decision"/"finding" kinds — `agents/brainstorm-facilitator.md:87` states
// only that their payload "carries the content in a couple of plain
// fields," no exact shape pinned) gets no additional enforcement beyond the
// plain-object check every payload already receives — enforcing an
// undocumented shape here would be inventing a constraint doctrine rule 6
// requires be encoded FROM a real, cited source, not guessed.
const PAYLOAD_VALIDATORS = Object.freeze({
  'vision-transcript': Object.freeze({
    // agents/brainstorm-facilitator.md:87 — `{"text": "..."}`.
    idea(payload) {
      requireExactKeys(payload, ['text'], 'idea');
      if (!isNonEmptyString(payload.text)) {
        throw new Error('kind-registry: "idea" payload.text must be a non-empty string');
      }
    },
    // agents/brainstorm-facilitator.md:87 — `{"from": "...", "to": "..."}`.
    pivot(payload) {
      requireExactKeys(payload, ['from', 'to'], 'pivot');
      if (!isNonEmptyString(payload.from) || !isNonEmptyString(payload.to)) {
        throw new Error('kind-registry: "pivot" payload.from/to must be non-empty strings');
      }
    },
    // agents/brainstorm-facilitator.md:50 — `{turn, checked: true|false,
    // source}`, `source` present only when `checked: true`.
    freshness(payload) {
      const allowed = new Set(['turn', 'checked', 'source']);
      for (const key of Object.keys(payload)) {
        if (!allowed.has(key)) {
          throw new Error(`kind-registry: "freshness" payload has unexpected key "${key}"`);
        }
      }
      if (!isNonNegativeInteger(payload.turn)) {
        throw new Error('kind-registry: "freshness" payload.turn must be a non-negative integer');
      }
      if (typeof payload.checked !== 'boolean') {
        throw new Error('kind-registry: "freshness" payload.checked must be a boolean');
      }
      const hasSource = Object.prototype.hasOwnProperty.call(payload, 'source');
      if (payload.checked) {
        if (!hasSource || !isNonEmptyString(payload.source)) {
          throw new Error('kind-registry: "freshness" payload.source is required and must be a non-empty string when checked is true');
        }
      } else if (hasSource) {
        throw new Error('kind-registry: "freshness" payload.source is only permitted when checked is true');
      }
    },
    // Closure ritual — a terminal marker, no payload fields documented.
    sealed(payload) {
      requireExactKeys(payload, [], 'sealed');
    },
  }),
  'vision-decisions': Object.freeze({
    // agents/brainstorm-crystallizer.md:47 — statement, rationale, and the
    // transcript seq numbers the decision derives from.
    decision(payload) {
      requireExactKeys(payload, ['statement', 'rationale', 'transcript_seq_refs'], 'decision');
      if (!isNonEmptyString(payload.statement)) {
        throw new Error('kind-registry: vision-decisions "decision" payload.statement must be a non-empty string');
      }
      if (!isNonEmptyString(payload.rationale)) {
        throw new Error('kind-registry: vision-decisions "decision" payload.rationale must be a non-empty string');
      }
      if (
        !Array.isArray(payload.transcript_seq_refs) ||
        payload.transcript_seq_refs.length === 0 ||
        !payload.transcript_seq_refs.every(isNonNegativeInteger)
      ) {
        throw new Error(
          'kind-registry: vision-decisions "decision" payload.transcript_seq_refs must be a non-empty array of non-negative integers'
        );
      }
    },
  }),
  'research-scratchpad': Object.freeze({
    // agents/research-chief.md:76 — `{mission, subtopics: [{topic,
    // cache_status, action}]}`.
    decomposition(payload) {
      requireExactKeys(payload, ['mission', 'subtopics'], 'decomposition');
      if (!isNonEmptyString(payload.mission)) {
        throw new Error('kind-registry: "decomposition" payload.mission must be a non-empty string');
      }
      if (!Array.isArray(payload.subtopics) || payload.subtopics.length === 0) {
        throw new Error('kind-registry: "decomposition" payload.subtopics must be a non-empty array');
      }
      payload.subtopics.forEach((entry, index) => {
        if (!isPlainObject(entry)) {
          throw new Error(`kind-registry: "decomposition" payload.subtopics[${index}] must be an object`);
        }
        requireExactKeys(entry, ['topic', 'cache_status', 'action'], `decomposition.subtopics[${index}]`);
        if (!isNonEmptyString(entry.topic)) {
          throw new Error(`kind-registry: "decomposition" payload.subtopics[${index}].topic must be a non-empty string`);
        }
        if (!['fresh', 'stale', 'missing'].includes(entry.cache_status)) {
          throw new Error(`kind-registry: "decomposition" payload.subtopics[${index}].cache_status must be one of fresh, stale, missing`);
        }
        if (!['consumed_cache', 'brief_issued'].includes(entry.action)) {
          throw new Error(`kind-registry: "decomposition" payload.subtopics[${index}].action must be one of consumed_cache, brief_issued`);
        }
      });
    },
    // agents/research-chief.md:78 — `{worker, topic, outcome, anchors}`.
    brief_issued(payload) {
      requireExactKeys(payload, ['worker', 'topic', 'outcome', 'anchors'], 'brief_issued');
      for (const field of ['worker', 'topic', 'outcome']) {
        if (!isNonEmptyString(payload[field])) {
          throw new Error(`kind-registry: "brief_issued" payload.${field} must be a non-empty string`);
        }
      }
      if (!Array.isArray(payload.anchors) || payload.anchors.length === 0 || !payload.anchors.every(isNonEmptyString)) {
        throw new Error('kind-registry: "brief_issued" payload.anchors must be a non-empty array of non-empty strings');
      }
    },
    // agents/research-chief.md:79 — `{worker, topic, state, result}`.
    envelope_consumed(payload) {
      requireExactKeys(payload, ['worker', 'topic', 'state', 'result'], 'envelope_consumed');
      for (const field of ['worker', 'topic', 'state', 'result']) {
        if (!isNonEmptyString(payload[field])) {
          throw new Error(`kind-registry: "envelope_consumed" payload.${field} must be a non-empty string`);
        }
      }
    },
    // agents/research-chief.md:80 — `{decision, topic, reason}`.
    steer(payload) {
      requireExactKeys(payload, ['decision', 'topic', 'reason'], 'steer');
      for (const field of ['decision', 'topic', 'reason']) {
        if (!isNonEmptyString(payload[field])) {
          throw new Error(`kind-registry: "steer" payload.${field} must be a non-empty string`);
        }
      }
    },
    // agents/research-chief.md:81 — either `{topic, index_entry}` (one per
    // index upsert) or `{summary_path}` (the final summary write) — a
    // documented union, not an open shape.
    synthesis(payload) {
      const keys = Object.keys(payload).sort();
      const isIndexEntryShape = keys.length === 2 && keys[0] === 'index_entry' && keys[1] === 'topic';
      const isSummaryShape = keys.length === 1 && keys[0] === 'summary_path';
      if (!isIndexEntryShape && !isSummaryShape) {
        throw new Error('kind-registry: "synthesis" payload must be exactly {topic, index_entry} or exactly {summary_path}');
      }
      if (isIndexEntryShape) {
        if (!isNonEmptyString(payload.topic)) {
          throw new Error('kind-registry: "synthesis" payload.topic must be a non-empty string');
        }
        if (!isPlainObject(payload.index_entry)) {
          throw new Error('kind-registry: "synthesis" payload.index_entry must be an object');
        }
      } else if (!isNonEmptyString(payload.summary_path)) {
        throw new Error('kind-registry: "synthesis" payload.summary_path must be a non-empty string');
      }
    },
  }),
  'onboarding-decision': Object.freeze({
    // product/onboarding/interview.md's own Step 7, `agents/maestro.md`'s
    // Bash law point 8 — the one sanctioned event, exactly:
    // `{event:"settings_interview_completed", preset, telemetry_consent}`.
    decision(payload) {
      requireExactKeys(payload, ['event', 'preset', 'telemetry_consent'], 'decision');
      if (payload.event !== 'settings_interview_completed') {
        throw new Error(
          `kind-registry: onboarding-decision payload.event must be exactly "settings_interview_completed" (got ${JSON.stringify(payload.event)})`
        );
      }
      if (!isNonEmptyString(payload.preset)) {
        throw new Error('kind-registry: onboarding-decision payload.preset must be a non-empty string');
      }
      if (typeof payload.telemetry_consent !== 'boolean') {
        throw new Error('kind-registry: onboarding-decision payload.telemetry_consent must be a boolean');
      }
    },
  }),
});

// realpathOfPossiblyMissing(p) — same "resolve what exists, reattach the
// rest literally" helper anonymize.js's own copy documents in full.
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

// assertContained(treeRootReal, targetPath, streamId) — refuses a stream
// target whose real (symlink-resolved) location falls outside the real
// treeRoot (P11 Sol review finding 9: a `vision -> outside` pre-planted
// directory symlink let `append vision-transcript` create
// `outside/transcript.jsonl`, since the module joined the symbolic path and
// called `appendRecord` without checking any path component). Every
// STREAM_REGISTRY relPath is a fixed, trusted literal — this check is not
// about a caller-supplied path, it is about a pre-existing symlinked
// ancestor directory the caller cannot otherwise be prevented from
// planting.
function assertContained(treeRootReal, targetPath, streamId) {
  const targetReal = realpathOfPossiblyMissing(targetPath);
  const rel = path.relative(treeRootReal, targetReal);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`kind-registry: streamId "${streamId}" target resolves outside treeRoot (via a symlinked path component)`);
  }
}

const STREAM_REGISTRY = Object.freeze({
  // agents/brainstorm-facilitator.md's own "Session-log discipline" —
  // every keep-worthy turn, plus the Closure ritual's terminal "sealed"
  // record. Sole writer: the facilitator.
  'vision-transcript': Object.freeze({
    relPath: path.join('vision', 'transcript.jsonl'),
    kinds: new Set(['idea', 'decision', 'pivot', 'finding', 'freshness', 'sealed']),
  }),
  // agents/brainstorm-crystallizer.md's own "Appending decisions.jsonl" —
  // one "decision" record per decision the sealed transcript surfaces.
  // Sole writer: the crystallizer.
  'vision-decisions': Object.freeze({
    relPath: path.join('vision', 'decisions.jsonl'),
    kinds: new Set(['decision']),
  }),
  // agents/research-chief.md's own scratchpad discipline — the five kinds
  // the chief itself writes (decomposition/brief_issued/envelope_consumed/
  // steer/synthesis). "freshness_gate" is intentionally absent — see the
  // header comment above.
  'research-scratchpad': Object.freeze({
    relPath: path.join('research', 'scratchpad.jsonl'),
    kinds: new Set(['decomposition', 'brief_issued', 'envelope_consumed', 'steer', 'synthesis']),
  }),
  // product/onboarding/interview.md's own Step 7 — the settings interview's
  // closing "decision" ledger event
  // ({event:"settings_interview_completed", preset, telemetry_consent}).
  // ledger.jsonl carries many OTHER kinds from many other sanctioned
  // writers (phase-transition, gate, deviation, stop, preflight, ...) —
  // this streamId's own contract is narrower than "the whole file," it is
  // "kind:decision on this one file, nothing else."
  'onboarding-decision': Object.freeze({
    relPath: 'ledger.jsonl',
    kinds: new Set(['decision']),
  }),
});

function requireStreamEntry(streamId) {
  const entry = STREAM_REGISTRY[streamId];
  if (!entry) {
    throw new Error(`kind-registry: unknown streamId "${streamId}" (known: ${Object.keys(STREAM_REGISTRY).join(', ')})`);
  }
  return entry;
}

const RECORD_TOP_LEVEL_KEYS = ['kind', 'payload', 'correlation_id'];

// appendToStream(treeRoot, streamId, record) -> the appended seq. record is
// {kind, payload, correlation_id} — the same shape stream.js's own
// appendRecord takes. Validated in order: the record carries no top-level
// key beyond these three (P11 Sol review finding 7 — the prior destructure
// silently dropped an "unexpected" extra key rather than refusing the whole
// record), the kind is one this stream's own closed set accepts,
// correlation_id is null or a non-empty string (never an object/array/
// number — finding 7's second half), and the kind's own registered payload
// contract holds — all BEFORE any write is attempted, and before the
// symlink-containment check below ever runs.
function appendToStream(treeRoot, streamId, record) {
  if (typeof treeRoot !== 'string' || treeRoot === '') {
    throw new TypeError('kind-registry: treeRoot must be a non-empty string');
  }
  const entry = requireStreamEntry(streamId);
  if (!isPlainObject(record)) {
    throw new TypeError('kind-registry: record must be a plain object');
  }
  const extraKeys = Object.keys(record).filter((key) => !RECORD_TOP_LEVEL_KEYS.includes(key));
  if (extraKeys.length > 0) {
    throw new Error(`kind-registry: record has unexpected extra key(s): ${extraKeys.join(', ')}`);
  }
  const { kind, payload, correlation_id } = record;
  if (typeof kind !== 'string' || !entry.kinds.has(kind)) {
    throw new Error(
      `kind-registry: streamId "${streamId}" does not accept kind "${kind}" (accepted: ${[...entry.kinds].join(', ')})`
    );
  }
  if (correlation_id !== undefined && correlation_id !== null && !isNonEmptyString(correlation_id)) {
    throw new TypeError('kind-registry: record.correlation_id must be null or a non-empty string');
  }
  const payloadValidator = PAYLOAD_VALIDATORS[streamId] && PAYLOAD_VALIDATORS[streamId][kind];
  if (payloadValidator) {
    payloadValidator(isPlainObject(payload) ? payload : {});
  }

  const target = path.join(treeRoot, entry.relPath);
  assertContained(fs.realpathSync(treeRoot), target, streamId);

  return appendRecord(target, { kind, payload, correlation_id });
}

// readStreamRecords(treeRoot, streamId) -> stream.js's own readRecords()
// result ({records, errors, headerViolations}), with `records` filtered to
// this stream's own registered kind set (P11 Sol review finding 8: a shared-
// target stream like `onboarding-decision` resolves to the WHOLE
// `ledger.jsonl`, which carries many other sanctioned writers' kinds too —
// returning the unfiltered file would be a raw-ledger read path through a
// symbolic stream id, contrary to the bounded-stream rule). `errors`/
// `headerViolations` are left as `readRecords` reported them, against the
// FULL underlying file — they are diagnostic positions into that file, not
// claims about the filtered view.
function readStreamRecords(treeRoot, streamId) {
  if (typeof treeRoot !== 'string' || treeRoot === '') {
    throw new TypeError('kind-registry: treeRoot must be a non-empty string');
  }
  const entry = requireStreamEntry(streamId);
  const { records, errors, headerViolations } = readRecords(path.join(treeRoot, entry.relPath));
  const filtered = records.filter((rec) => isPlainObject(rec) && entry.kinds.has(rec.kind));
  return { records: filtered, errors, headerViolations };
}

// CLI entrypoint. `append <streamId> <treeRoot>` reads the record JSON via
// stdin (the judge-verdict.js stdin pattern); `read <streamId> <treeRoot>`
// takes no stdin and prints readStreamRecords()'s own result.
//
// parseArgv fails closed on a surplus positional argument (P11 Sol review
// finding 13) — the same "every token is accounted for" discipline
// validators.js's own parseArgv already applies to an unrecognized flag.
function parseArgv(argv) {
  const [command, streamId, treeRoot, ...rest] = argv;
  const error = rest.length > 0 ? `unexpected extra argument(s): ${rest.join(' ')}` : null;
  return { command, streamId, treeRoot, error };
}

function main(argv) {
  const { command, streamId, treeRoot, error } = parseArgv(argv);
  if (
    (command !== 'append' && command !== 'read') ||
    typeof streamId !== 'string' ||
    streamId === '' ||
    typeof treeRoot !== 'string' ||
    treeRoot === '' ||
    error
  ) {
    if (error) process.stderr.write(`kind-registry.js: ${error}\n`);
    process.stderr.write(
      'usage: kind-registry.js append <streamId> <treeRoot>   (record JSON via stdin)\n' +
        '       kind-registry.js read <streamId> <treeRoot>\n' +
        `known streamIds: ${Object.keys(STREAM_REGISTRY).join(', ')}\n`
    );
    process.exit(1);
  }
  try {
    let result;
    if (command === 'read') {
      result = readStreamRecords(treeRoot, streamId);
    } else {
      const recordText = fs.readFileSync(0, 'utf8'); // fd 0 = stdin
      let parsed;
      try {
        parsed = JSON.parse(recordText);
      } catch (err) {
        throw new Error(`append: record JSON via stdin is not valid JSON: ${err.message}`);
      }
      if (!isPlainObject(parsed)) {
        throw new Error('append: record JSON via stdin must be a JSON object');
      }
      const seq = appendToStream(treeRoot, streamId, parsed);
      result = { seq };
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    process.stderr.write(`kind-registry.js: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { STREAM_REGISTRY, appendToStream, readStreamRecords };
