'use strict';

// The ONE sanctioned way plan-judge.md's verdict reaches disk: the judge
// must never itself touch a winning content artifact. plan-judge.md's
// tools are `Read` only — it cannot write anything itself, by construction,
// so it structurally cannot touch `architecture/protocol-record.md` or any
// of the other four content artifacts even by accident. Its full verdict is
// returned as response text to whoever spawned it (Maestro), which relays
// it here via Bash — one of the narrow, named machine-layer CLIs
// `agents/maestro.md`'s "Bash is for machine-layer CLIs only" law permits,
// never an ad-hoc file write. This module does not parse, summarize, or
// interpret the verdict text it's given — it writes exactly what it
// received, a mechanical relay, so no third mind stands between the
// judge's selection and the record of it (the anti-merge law applies to
// this relay step too).

const fs = require('node:fs');
const path = require('node:path');

const { writeAtomicText } = require('./atomic-text.js');

const JUDGE_VERDICT_FILENAME = 'judge-verdict.md';

// writeJudgeVerdict(archDir, verdictText) -> {verdictPath}. archDir is the
// tree-relative `architecture/` directory — judge-verdict.md lives there,
// standalone, deliberately NEVER one of manifest.js's
// CANONICAL_ARCHITECTURE_ARTIFACTS (it is never digested, never sealed, and
// carries no bearing on the plan-gate's approval — it is provenance, not
// content).
function writeJudgeVerdict(archDir, verdictText) {
  if (typeof archDir !== 'string' || archDir === '') {
    throw new TypeError('judge-verdict: archDir must be a non-empty string');
  }
  if (typeof verdictText !== 'string' || verdictText.trim() === '') {
    throw new TypeError('judge-verdict: verdictText must be a non-empty string');
  }
  const verdictPath = path.join(archDir, JUDGE_VERDICT_FILENAME);
  writeAtomicText(verdictPath, verdictText);
  return { verdictPath };
}

function main(argv) {
  const [command, archDir] = argv;
  if (command !== 'write' || typeof archDir !== 'string' || archDir === '') {
    process.stderr.write('usage: judge-verdict.js write <archDir>   (verdict text piped via stdin)\n');
    process.exit(1);
    return;
  }
  try {
    const verdictText = fs.readFileSync(0, 'utf8'); // fd 0 = stdin
    const { verdictPath } = writeJudgeVerdict(archDir, verdictText);
    console.log(JSON.stringify({ verdictPath }, null, 2));
    process.exit(0);
  } catch (err) {
    process.stderr.write(`judge-verdict.js: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { writeJudgeVerdict, JUDGE_VERDICT_FILENAME };
