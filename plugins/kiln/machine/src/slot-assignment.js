'use strict';

// Mechanical, replayable slot assignment for Maximal confrontation (P6 Sol
// review BLOCKING #3: "the flow fixes plan-A as the Claude plan-author draft
// and describes plan-B as Sol-authored... Random opaque slot assignment...
// [is] missing"). Deciding which candidate is labeled "plan-A" by a coin
// Maestro flips (Date.now(), Math.random()) would be unreplayable and, worse,
// still a judgment call an agent makes — doctrine rule 6 ("Determinism
// through workflows, not guardrails") puts exactly this kind of binary
// decision in a deterministic script, not an agent's head. The rule: the
// parity of the FIRST HEX BYTE of each candidate's own manifest digest
// (machine/src/manifest.js's buildManifest, computed over each candidate's
// draft directory) decides which candidate is "plan-A" — a fact intrinsic to
// each candidate's own content, unknowable to either author or the judge
// ahead of time, and fully reproducible from the same two draft directories
// on a second run.

const fs = require('node:fs');

const SHA256_PREFIX = 'sha256:';

function firstHexByte(digest) {
  if (typeof digest !== 'string' || !digest.startsWith(SHA256_PREFIX) || digest.length !== SHA256_PREFIX.length + 64) {
    throw new TypeError(`slot-assignment: digest must be a "sha256:<64 hex chars>" string (got ${JSON.stringify(digest)})`);
  }
  const byteHex = digest.slice(SHA256_PREFIX.length, SHA256_PREFIX.length + 2);
  const value = parseInt(byteHex, 16);
  if (Number.isNaN(value)) {
    throw new TypeError(`slot-assignment: digest does not start with valid hex (got ${JSON.stringify(digest)})`);
  }
  return value;
}

// assignPlanSlot(candidates) -> {planA, planB} naming which candidate id
// (candidates[].id) is labeled "plan-A" vs "plan-B". candidates is exactly
// two entries, each {id, manifestDigest}. Rule: the candidate whose manifest
// digest's first hex byte is EVEN becomes plan-A. If both bytes share the
// same parity (both even or both odd — two independent digests can
// coincide), the tie-break is the lexicographically smaller full digest
// string becomes plan-A — still a pure function of the two digests, no
// randomness, no wall-clock time, replayable from the same inputs every
// time.
function assignPlanSlot(candidates) {
  if (!Array.isArray(candidates) || candidates.length !== 2) {
    throw new TypeError('slot-assignment: candidates must be an array of exactly two {id, manifestDigest} entries');
  }
  const [first, second] = candidates;
  for (const c of [first, second]) {
    if (c === null || typeof c !== 'object' || typeof c.id !== 'string' || c.id === '') {
      throw new TypeError('slot-assignment: every candidate must be an object with a non-empty "id" string');
    }
  }
  if (first.id === second.id) {
    throw new TypeError('slot-assignment: the two candidates must have distinct ids');
  }

  const firstByte = firstHexByte(first.manifestDigest);
  const secondByte = firstHexByte(second.manifestDigest);

  let firstIsPlanA;
  if (firstByte % 2 !== secondByte % 2) {
    firstIsPlanA = firstByte % 2 === 0;
  } else {
    firstIsPlanA = first.manifestDigest < second.manifestDigest;
  }

  return firstIsPlanA
    ? { planA: first.id, planB: second.id }
    : { planA: second.id, planB: first.id };
}

// CLI entrypoint (P11 convergence finding 4 — Maximal confrontation's own
// mechanical mid-protocol step, product/architecture/flow.md step 5:
// "Maestro... call[s] machine/src/slot-assignment.js's assignPlanSlot(...)"
// — a Bash-only orchestrator has no way to call this in-process). `assign
// <candidatesJson>` reads the two-entry `[{id, manifestDigest}, ...]` array
// via stdin (the same shape assignPlanSlot itself takes) and prints the
// `{planA, planB}` result.
function main(argv) {
  // Fails closed on a surplus positional argument (P11 Sol review finding
  // 13) rather than silently ignoring it — this dispatcher takes no
  // arguments beyond the command itself, so anything past argv[0] is
  // already surplus.
  const [command, ...rest] = argv;
  if (command !== 'assign' || rest.length > 0) {
    if (rest.length > 0) {
      process.stderr.write(`slot-assignment.js: unexpected extra argument(s): ${rest.join(' ')}\n`);
    }
    process.stderr.write('usage: slot-assignment.js assign   (candidates JSON array via stdin: [{id, manifestDigest}, {id, manifestDigest}])\n');
    process.exit(1);
  }
  try {
    const inputText = fs.readFileSync(0, 'utf8'); // fd 0 = stdin
    let candidates;
    try {
      candidates = JSON.parse(inputText);
    } catch (err) {
      throw new Error(`assign: candidates JSON via stdin is not valid JSON: ${err.message}`);
    }
    const result = assignPlanSlot(candidates);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    process.stderr.write(`slot-assignment.js: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { assignPlanSlot, firstHexByte };
