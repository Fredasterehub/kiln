'use strict';

const fs = require('node:fs');

const { readAll } = require('./jsonl');

function pick(record, fields) {
  const picked = {};
  for (const key of fields) {
    if (record !== null && typeof record === 'object' && Object.prototype.hasOwnProperty.call(record, key)) {
      picked[key] = record[key];
    }
  }
  return picked;
}

// Drops elements from the front of view (oldest-first, since kept records
// preserve chronological order) until its serialized byte size fits within
// maxBytes, or until nothing is left to drop.
function evictToFit(view, maxBytes) {
  const fitted = view.slice();
  while (fitted.length > 0 && Buffer.byteLength(JSON.stringify(fitted), 'utf8') > maxBytes) {
    fitted.shift();
  }
  return fitted;
}

function project(records, spec) {
  const total = records.length;

  let stage = spec.kinds
    ? records.filter((record) => record !== null && typeof record === 'object' && spec.kinds.includes(record.kind))
    : records.slice();

  if (typeof spec.lastN === 'number') {
    stage = stage.slice(Math.max(0, stage.length - spec.lastN));
  }

  if (spec.fields) {
    stage = stage.map((record) => pick(record, spec.fields));
  }

  if (typeof spec.maxBytes === 'number') {
    stage = evictToFit(stage, spec.maxBytes);
  }

  return { view: stage, total, kept: stage.length, dropped: total - stage.length };
}

function projectFile(file, spec) {
  const { records, errors } = readAll(file);
  if (errors && errors.length > 0) {
    return { view: [], total: 0, kept: 0, dropped: 0, readErrors: errors.length };
  }
  return project(records, spec);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// CLI entrypoint (P11 convergence finding 3 — kept on THIS module, never a
// new transcript.js boundary: "projection.js projectFile as a project-file
// subcommand... it stays on projection.js, never a new transcript boundary"
// — the crystallizer's transcript.jsonl read, research-chief's
// decisions.jsonl/summary reads, and plan-author's decisions.jsonl read all
// go through this one command). `project-file <file>` reads the spec object
// ({kinds?, lastN?, fields?, maxBytes?}) from stdin — an empty/absent spec
// is valid (projectFile(file, {}) passes every record through, per
// project()'s own no-clauses behavior above), so stdin must still be piped,
// even as `{}`, the same "always read stdin" convention every other
// stdin-consuming CLI in this tree holds.
function parseArgv(argv) {
  const [command, file] = argv;
  return { command, file };
}

function main(argv) {
  const { command, file } = parseArgv(argv);
  if (command !== 'project-file' || typeof file !== 'string' || file === '') {
    process.stderr.write('usage: projection.js project-file <file>   (spec JSON via stdin, e.g. {"kinds":[...],"lastN":100})\n');
    process.exit(1);
  }
  try {
    const specText = fs.readFileSync(0, 'utf8'); // fd 0 = stdin
    let spec;
    try {
      spec = JSON.parse(specText);
    } catch (err) {
      throw new Error(`project-file: spec JSON via stdin is not valid JSON: ${err.message}`);
    }
    if (!isPlainObject(spec)) {
      throw new Error('project-file: spec JSON via stdin must be a JSON object');
    }
    const result = projectFile(file, spec);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    process.stderr.write(`projection.js: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { project, projectFile };
