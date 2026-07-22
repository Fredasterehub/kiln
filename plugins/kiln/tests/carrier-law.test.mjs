import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// A truthfulness anchor for references/carrier-law.md — NOT a prose lock. The doc
// consolidates the worker/stage handoff protocol, so it must keep naming the envelope
// fields, all seven hops, and the Kiln Compact. If a field is renamed or a seam moves,
// the doc has to move with it or these reads go red. Zero run cost: bytes on disk.
const doc = readFileSync(
  fileURLToPath(new URL('../references/carrier-law.md', import.meta.url)), 'utf8',
)
const names = (label, tokens) => {
  for (const t of tokens) assert.ok(doc.includes(t), `${label}: doc must name ${t}`)
}

test('carrier-law: names every STAGE_RESULT envelope field', () => {
  names('envelope', [
    'STAGE_RESULT', 'facts', 'status', 'pointers', 'schema_valid', 'narration_beat',
    'gate_verdict', 'meter',
  ])
})

test('carrier-law: enumerates all seven hops with their real seams', () => {
  // The seven hop labels — the doc must present each one.
  names('hop labels', [
    'orchestrator→worker', 'worker→orchestrator', 'worker→kernel', 'stage→stage',
    'resume', 'repair', 'facilitator→orchestrator',
  ])
  // The seam a hop maps to: the file (or schema) that actually carries it.
  names('hop seams', [
    'SKILL.md', 'kernel.js', 'STATE.md', 'gate-review.json', 'review-schema.json',
    'vision.md', 'brainstorm-ledger.jsonl',
  ])
})

test('carrier-law: names the Kiln Compact and its three semantic artifacts', () => {
  names('compact', ['Kiln Compact', 'vision.md', 'LAW.md', 'decisions.md'])
})
