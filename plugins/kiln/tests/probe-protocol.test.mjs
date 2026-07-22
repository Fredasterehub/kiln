import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The bounded PROBE protocol is agent-to-agent prose (Da Vinci <-> conductor), not a runtime
// module — so its contract is pinned as bytes across the three files that carry it: the agent
// that may send the request, the conductor that answers it, and the brainstorm card that records
// the exchange. Truthfulness anchors, not prose locks: each asserts the load-bearing invariants
// the workflow's probe mode (research-sweep.test.mjs) depends on.
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const DV = read('../agents/da-vinci.md')
const SKILL = read('../skills/kiln-fire/SKILL.md')
const CARD = read('../cards/brainstorm.md')
const SWEEP = read('../workflows/research-sweep.js')
const README = read('../references/brainstorm/README.md')
const MANIFEST = read('../references/brainstorm/coverage-manifest.md')

test('da-vinci: the message rule is exactly one terminal completion plus at most one nonterminal probe — nothing else', () => {
  assert.ok(/only TERMINAL message you send, and it fires exactly once/.test(DV), 'the completion is the sole terminal message and fires once')
  assert.ok(DV.includes('single permitted') && DV.includes('nonterminal is the one probe request'), 'the sole permitted nonterminal is the one probe request — no other send is authorized')
  assert.ok(DV.includes('<probe>') && DV.includes('</probe>'), 'the probe block is present')
  assert.ok(DV.includes('At most once per session'), 'the probe is bounded to at most one per session')
})

test('da-vinci: the PROBE_REQUEST carries only the ledger path and seq IDs, never dialogue, and never authors content', () => {
  assert.ok(DV.includes('"e":"PROBE_REQUEST"'), 'the probe request envelope is documented')
  assert.ok(DV.includes('carrying ONLY the ledger path and the seq IDs'), 'it carries only the ledger path and seq IDs')
  assert.ok(DV.includes('no dialogue, no prose, no extra field'), 'no dialogue rides the probe request')
  assert.ok(DV.includes('you still close with exactly one `BRAINSTORM_COMPLETE`'), 'the probe never displaces the single terminal completion')
  assert.ok(DV.includes('it never becomes a logged idea, an intent, or the essence'), 'a probe informs discussion only — it never authors vision/essence/ledger')
})

test('conductor: SKILL.md answers a PROBE_REQUEST by launching research-sweep in probe mode and replying PROBE_RESULT', () => {
  assert.ok(/## The probe/.test(SKILL), 'the conductor documents the probe exchange')
  assert.ok(SKILL.includes('PROBE_REQUEST'), 'it names the request it answers')
  assert.ok(SKILL.includes('workflows/research-sweep.js') && SKILL.includes('mode: "probe"'), 'it launches the same recipe in probe mode, by path')
  assert.ok(SKILL.includes('PROBE_RESULT') && SKILL.includes('pointers.digest'), 'it replies PROBE_RESULT carrying the digest pointer and a beat')
  assert.ok(SKILL.includes('no posture read and no ratify'), 'probe mode bypasses posture and ratify — none exists during a brainstorm')
})

test('conductor: the PROBE_RESULT envelope is pinned in both shapes — single-line JSON with exact keys e/pointer/beat on success, the pointer key omitted on the honest failure variant', () => {
  // Success envelope: exactly e, pointer, beat — a single line, pinned where the conductor builds it
  // and again in the agent that receives it, so the two sides can never drift.
  assert.ok(SKILL.includes('{"e":"PROBE_RESULT","pointer":"<the returned pointers.digest>","beat":"<one line>"}'),
    'the conductor pins the success PROBE_RESULT envelope with exactly the keys e/pointer/beat')
  assert.ok(DV.includes('{"e":"PROBE_RESULT","pointer":"<digest path>","beat":"<one line>"}'),
    'the agent documents the same success envelope it receives')
  // Failure variant: the SAME envelope with the pointer key omitted — never a null or empty pointer.
  assert.ok(SKILL.includes('{"e":"PROBE_RESULT","beat":"<honest one line>"}'),
    'the conductor defines the no-pointer failure variant explicitly')
  assert.ok(/no-pointer failure variant/.test(SKILL), 'the failure path is named the no-pointer variant, not a bare beat')
  // Both envelopes are one line: the exact-string match above already forbids an embedded newline.
  for (const env of ['{"e":"PROBE_RESULT","pointer":"<the returned pointers.digest>","beat":"<one line>"}', '{"e":"PROBE_RESULT","beat":"<honest one line>"}']) {
    const line = SKILL.split('\n').find(l => l.includes(env))
    assert.ok(line !== undefined, 'the PROBE_RESULT envelope sits on a single line of the conductor spec')
  }
})

test('conductor: the four hard stops are preserved and PROBE is not a fifth question', () => {
  assert.ok(SKILL.includes('## The four hard stops — the only questions'), 'the four-hard-stops section is intact')
  for (const stop of ['User plan gate', 'Blocked gate', 'Missing codex', 'Completion']) {
    assert.ok(SKILL.includes(stop), `hard stop preserved: ${stop}`)
  }
  assert.ok(/not a fifth question/.test(SKILL) && SKILL.includes('not a hard stop'), 'the probe is a teammate exchange, never a fifth operator question')
})

test('brainstorm card: documents the bounded probe exchange and its posture/ratify bypass', () => {
  assert.ok(/## The probe/.test(CARD), 'the card records the probe exchange')
  assert.ok(CARD.includes('PROBE_REQUEST') && CARD.includes('PROBE_RESULT'), 'both sides of the exchange are named')
  assert.ok(/At\s+most once, before the completion/.test(CARD), 'the exchange is bounded to at most one probe')
  assert.ok(CARD.includes('bypasses the posture dial and the feasibility ratify'), 'the card records that probe mode is a light digest, not a ratified feasibility')
  assert.ok(CARD.includes('never displaces the single terminal'), 'exactly one terminal completion is preserved')
})

test('wiring: the conductor launch fields match the workflow probe branch', () => {
  for (const field of ['mode: "probe"', 'ledger', 'seqs', 'projectDir', 'plugin']) {
    assert.ok(SKILL.includes(field), `the probe launch names ${field}`)
  }
  assert.ok(SWEEP.includes("A.mode === 'probe'"), 'the workflow branches on the probe mode')
  assert.ok(SWEEP.includes('validLedgerRef(A.ledger, A.seqs)'), 'the workflow validates the forwarded ledger path and seq IDs')
})

test('sweep: the probe producer prompt bounds its SOLE write to the named digest — never the ledger, vision, essence, or posture', () => {
  assert.ok(SWEEP.includes('SOLE permitted write'), 'the probe producer prompt names its sole permitted write')
  assert.ok(/never create or modify the ledger, the vision, the essence, the posture/.test(SWEEP),
    'the probe producer is explicitly restricted from the ledger, vision, essence, and posture artifacts')
  assert.ok(SWEEP.includes("'.kiln/docs/probe-'"), 'the one permitted write is the deterministic digest under .kiln/docs')
})

test('shelf: da-vinci mandates reading every brainstorm reference before its first word — the shelf is a mandatory read', () => {
  assert.ok(DV.includes('Read every file under `$PLUGIN_ROOT/references/brainstorm/`'),
    'the agent mandates reading the whole brainstorm shelf at spawn')
})

test('shelf: the mandatory-read references qualify the channel for the optional probe — none asserts an absolute single-completion-only channel that contradicts the agent probe block', () => {
  // Da Vinci reads every shelf file, so a reference that still says the completion envelope is the
  // ONLY thing that ever crosses would contradict the agent's own <probe> block. Each channel
  // statement on the mandatory shelf must name the bounded probe as the permitted nonterminal, or a
  // future edit could silently reintroduce the contradiction the workflow probe mode depends on not
  // existing. These are truthfulness anchors: the probe is bounded, optional, and content-free.
  assert.ok(/probe/i.test(README) && /nonterminal/.test(README),
    'README law 3 (the window is the boundary) qualifies the channel for the bounded probe nonterminal')
  const oneMsgRow = MANIFEST.split('\n').find(l => l.includes('AGENT-ONEMSG'))
  assert.ok(oneMsgRow && /probe/i.test(oneMsgRow) && /nonterminal/.test(oneMsgRow),
    'the AGENT-ONEMSG coverage row names the optional probe as the permitted nonterminal, not an absolute single-message channel')
})
