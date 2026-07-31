'use strict';

// The tablet: the build's one memory, at `<treeRoot>/tablet.jsonl`. Two
// subcommands and no more — `append` files one entry, `view` reads the index
// or one entry whole. There is no path here to delete or edit what is
// written: a later entry that corrects an earlier one names it in prose.
//
// Three kinds, closed, each with its own exact field set:
//   decision   — {course, because}                   a course chosen mid-build
//   constraint — {fact, must_respect}                an environment or tooling
//                                                    fact the build must respect
//   failure    — {broke, consequence, prevention}    what broke, what it cost,
//                                                    and what stops it recurring
//
// The first field of each kind is its one-line summary, the line the index
// carries. Hard caps, in UTF-16 code units — the unit JavaScript string length
// counts, so an astral character counts as two: SUMMARY_MAX_CHARS (120) for
// that summary, DETAIL_MAX_CHARS (300) for every other field — a distilled
// record fits, a progress note or a diary paragraph does not. Validation fails
// closed: an unknown kind, a missing, empty, over-cap or control-character-
// carrying field, or a field outside the kind's own set refuses the whole
// entry and writes nothing.
//
// One contract serves both ends. entryProblem holds it, append throws on it,
// and the read path applies it in full to every line it finds — so a record
// hand-written onto the stream that append would have refused is skipped
// exactly like a foreign kind, never rendered as memory.
//
// Entry identity is the stream's own monotonic seq, rendered `T-<seq>` —
// stream.js allocates it under the append lock, so nothing here allocates ids.
//
// The tree root is an explicit argument in every subcommand, never a working
// directory assumption.

const fs = require('node:fs');
const path = require('node:path');

const { appendRecord, readRecords, validateRecordHeader } = require('./stream.js');

const TABLET_FILENAME = 'tablet.jsonl';

const SUMMARY_MAX_CHARS = 120;
const DETAIL_MAX_CHARS = 300;

// The index the bounded `view` prints, in entries — the newest that many,
// with a more-entries line standing in for the rest.
const INDEX_MAX_ENTRIES = 20;

const KIND_FIELDS = Object.freeze({
  decision: Object.freeze({ summary: 'course', details: Object.freeze(['because']) }),
  constraint: Object.freeze({ summary: 'fact', details: Object.freeze(['must_respect']) }),
  failure: Object.freeze({ summary: 'broke', details: Object.freeze(['consequence', 'prevention']) }),
});

const ENTRY_KINDS = Object.freeze(Object.keys(KIND_FIELDS));

const ENTRY_ID_RE = /^T-(0|[1-9]\d*)$/;

// An index line is one line by contract, so a field that cannot render as one
// is not a lawful field. The whole C0 set is refused, DEL with it — CR and LF
// above all, which would break a single entry across two index lines and let a
// summary forge structure in every digest that renders it.
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function fieldsOf(kind) {
  const spec = KIND_FIELDS[kind];
  return [spec.summary, ...spec.details];
}

function entryId(seq) {
  return `T-${seq}`;
}

function tabletPath(treeRoot) {
  return path.join(treeRoot, TABLET_FILENAME);
}

// entryProblem(kind, payload) -> why that kind and those fields are not an
// entry, in one plain sentence, or null when they are one. This is the whole
// contract and the only copy of it: the kind is one of the three, the payload's
// key set matches that kind's own exactly (an extra key is refused, never
// silently dropped), and every field is a one-line non-empty string inside its
// cap. Append throws on the sentence; the read path skips the line that has one.
function entryProblem(kind, payload) {
  if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(KIND_FIELDS, kind)) {
    return `kind must be one of ${ENTRY_KINDS.join(', ')} (got ${JSON.stringify(kind)})`;
  }

  const fields = fieldsOf(kind);
  const expected = [...fields].sort();
  const supplied = Object.keys(payload).sort();
  const matches = supplied.length === expected.length && supplied.every((key, i) => key === expected[i]);
  if (!matches) {
    return `a "${kind}" entry must supply exactly these fields: ${expected.join(', ')} (got: ${supplied.join(', ') || '(none)'})`;
  }

  for (const field of fields) {
    const value = payload[field];
    if (!isNonEmptyString(value)) {
      return `"${kind}" field "${field}" must be a non-empty string`;
    }
    if (CONTROL_CHAR_RE.test(value)) {
      return `"${kind}" field "${field}" carries a control character — an entry field is one line of plain text`;
    }
    const cap = field === KIND_FIELDS[kind].summary ? SUMMARY_MAX_CHARS : DETAIL_MAX_CHARS;
    if (value.length > cap) {
      return `"${kind}" field "${field}" is ${value.length} characters, over the ${cap}-character cap — distil it`;
    }
  }

  return null;
}

// validateEntry(entry) -> {kind, payload} — the append end of the contract,
// checked before any write is attempted. The payload is rebuilt in the kind's
// own field order, so the record on disk reads the same whatever order the
// caller handed its fields in.
function validateEntry(entry) {
  if (!isPlainObject(entry)) {
    throw new TypeError('tablet: entry must be a plain object');
  }
  const { kind, ...supplied } = entry;
  const problem = entryProblem(kind, supplied);
  if (problem !== null) {
    throw new Error(`tablet: ${problem}`);
  }

  const payload = {};
  for (const field of fieldsOf(kind)) {
    payload[field] = supplied[field];
  }
  return { kind, payload };
}

// appendEntry(treeRoot, entry) -> the new entry's id. The stream stamps the
// header and allocates the seq; this returns that seq as the id the build
// quotes.
function appendEntry(treeRoot, entry) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('tablet: treeRoot must be a non-empty string');
  }
  const { kind, payload } = validateEntry(entry);
  return entryId(appendRecord(tabletPath(treeRoot), { kind, payload }));
}

// payloadOf(record) -> the record's own tablet fields, the common header
// stream.js stamps set aside. What remains is exactly the shape append
// supplied, so the one contract applies to it unchanged.
function payloadOf(record) {
  const { schema_version, seq, kind, ts, correlation_id, ...payload } = record;
  return payload;
}

// A record is an entry only if it carries a lawful common header, no
// correlator of its own, and one kind's complete field set under the very
// contract append applies — the tablet attaches no correlation_id, so a record
// carrying one was written by something else. Anything short of all three is
// another writer's line, and the tablet reads past it rather than render it as
// memory.
function isEntry(record) {
  if (!isPlainObject(record)) return false;
  if (!validateRecordHeader(record).ok) return false;
  if (record.correlation_id !== null) return false;
  return entryProblem(record.kind, payloadOf(record)) === null;
}

// readEntries(treeRoot) -> the lawful entries in stream order. A tree with no
// tablet yet has recorded nothing, and that is an empty list, not an error.
function readEntries(treeRoot) {
  if (!isNonEmptyString(treeRoot)) {
    throw new TypeError('tablet: treeRoot must be a non-empty string');
  }
  return readRecords(tabletPath(treeRoot)).records.filter(isEntry);
}

function summaryLine(entry) {
  return `- ${entryId(entry.seq)} ${entry.kind} — ${entry[KIND_FIELDS[entry.kind].summary]}`;
}

// indexLines(entries, limit) -> at most `limit` lines, newest first. When more
// entries exist than the budget holds, the newest fill it but for one line,
// and that last line counts what is not shown — the index stays bounded and
// says so, and the entries behind it are reachable by id.
function indexLines(entries, limit = INDEX_MAX_ENTRIES) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new TypeError('tablet: limit must be a positive integer');
  }
  const newestFirst = [...entries].reverse();
  if (newestFirst.length <= limit) return newestFirst.map(summaryLine);
  const shown = newestFirst.slice(0, limit - 1);
  return [...shown.map(summaryLine), `- (${entries.length - shown.length} more entries)`];
}

function fieldLabel(field) {
  const words = field.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// renderEntry(entry) -> one entry whole: its id and kind, when it was
// recorded, and every field the kind carries.
function renderEntry(entry) {
  const lines = [`${entryId(entry.seq)} ${entry.kind}`, `- Recorded: ${entry.ts}`];
  for (const field of fieldsOf(entry.kind)) {
    lines.push(`- ${fieldLabel(field)}: ${entry[field]}`);
  }
  return `${lines.join('\n')}\n`;
}

function findEntry(entries, id) {
  if (!ENTRY_ID_RE.test(id)) {
    throw new Error(`tablet: entry id must be T-<seq> (got ${JSON.stringify(id)})`);
  }
  const seq = Number(id.slice(2));
  const entry = entries.find((candidate) => candidate.seq === seq);
  if (!entry) {
    throw new Error(`tablet: no entry ${id} in ${TABLET_FILENAME}`);
  }
  return entry;
}

// CLI entrypoint. `append <treeRoot>` reads the entry JSON via stdin (the
// kind-registry.js stdin pattern) and prints the new id; `view <treeRoot>`
// prints the bounded index; `view <treeRoot> T-<seq>` prints that one entry.
//
// parseArgv fails closed on a surplus positional argument — the same "every
// token is accounted for" discipline the neighbouring CLIs apply — and
// `append` takes no entry id at all.
function parseArgv(argv) {
  const [command, treeRoot, id, ...rest] = argv;
  let error = rest.length > 0 ? `unexpected extra argument(s): ${rest.join(' ')}` : null;
  if (!error && command === 'append' && id !== undefined) {
    error = `unexpected extra argument(s): ${id}`;
  }
  return { command, treeRoot, id, error };
}

const USAGE =
  'usage: tablet.js append <treeRoot>          (entry JSON via stdin)\n' +
  '       tablet.js view <treeRoot>            (the bounded index, newest first)\n' +
  '       tablet.js view <treeRoot> T-<seq>    (one entry, whole)\n' +
  `entry kinds: ${ENTRY_KINDS.join(', ')}\n`;

function main(argv) {
  const { command, treeRoot, id, error } = parseArgv(argv);
  if ((command !== 'append' && command !== 'view') || !isNonEmptyString(treeRoot) || error) {
    if (error) process.stderr.write(`tablet.js: ${error}\n`);
    process.stderr.write(USAGE);
    process.exit(1);
  }
  try {
    if (command === 'append') {
      const entryText = fs.readFileSync(0, 'utf8'); // fd 0 = stdin
      let parsed;
      try {
        parsed = JSON.parse(entryText);
      } catch (err) {
        throw new Error(`append: entry JSON via stdin is not valid JSON: ${err.message}`);
      }
      if (!isPlainObject(parsed)) {
        throw new Error('append: entry JSON via stdin must be a JSON object');
      }
      process.stdout.write(`${appendEntry(treeRoot, parsed)}\n`);
      return;
    }
    const entries = readEntries(treeRoot);
    if (id !== undefined) {
      process.stdout.write(renderEntry(findEntry(entries, id)));
      return;
    }
    const lines = indexLines(entries, INDEX_MAX_ENTRIES);
    process.stdout.write(lines.length === 0 ? '(no entries)\n' : `${lines.join('\n')}\n`);
  } catch (err) {
    process.stderr.write(`tablet.js: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  ENTRY_KINDS,
  TABLET_FILENAME,
  INDEX_MAX_ENTRIES,
  SUMMARY_MAX_CHARS,
  DETAIL_MAX_CHARS,
  appendEntry,
  readEntries,
  indexLines,
  renderEntry,
};
