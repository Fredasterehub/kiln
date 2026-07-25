import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, appendFileSync, symlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The workflow runtime evaluates kernel.js as an async function body (top-level
// return, injected globals) — it is not an importable ESM module. The tests
// evaluate the marked pure-core region directly and execute the full body
// under a mocked runtime, exactly the way the runtime wraps it.
const src = readFileSync(
  fileURLToPath(new URL('../workflows/kernel.js', import.meta.url)), 'utf8',
)
const srcLines = src.split('\n')
const coreSrc = srcLines.slice(
  srcLines.findIndex(l => l.includes('KERNEL_CORE_BEGIN')) + 1,
  srcLines.findIndex(l => l.includes('KERNEL_CORE_END')),
).join('\n')
const core = new Function(coreSrc + `
  return { SPINE, parseArgs, resolveStage, nextStage, gateOutcome, reviewLoop,
           fillClosed, streakIndex, stateToken, stateKey, stateCommitCmd, gateCmd, sealedLawCheck, lawCheckReceipt, TRIO_MISMATCH,
           MILESTONE_PROJECTION_CHECK, PERCEPTUAL_TABLE_CHECK, verdictExit, redSetIsFuture, gateReviewInvalid,
           validateTiers, resolveTier, routeBuilder, parseSliceEntry, milestoneSeamAfter,
           validatePosture, recoveryDecision, strictSubsetProgress, capFromDial, reconcileAudit, sealMembers }`)()
const {
  SPINE, parseArgs, resolveStage, nextStage, gateOutcome, reviewLoop,
  fillClosed, streakIndex, stateToken, stateKey, stateCommitCmd, gateCmd, sealedLawCheck, lawCheckReceipt, TRIO_MISMATCH,
  MILESTONE_PROJECTION_CHECK, PERCEPTUAL_TABLE_CHECK, verdictExit, redSetIsFuture, gateReviewInvalid,
  validateTiers, resolveTier, routeBuilder, parseSliceEntry, milestoneSeamAfter,
  validatePosture, recoveryDecision, strictSubsetProgress, capFromDial, reconcileAudit, sealMembers,
} = core

// ── Mocked runtime: run the whole kernel body with scripted agents ──────────
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
// Every real conductor launch carries an absolute plugin root; the harness
// supplies one by default so object scenarios model the real launch envelope.
// A scenario overrides it — to a relative or explicitly-undefined value — by
// naming `plugin` in its own launch args; that is how the plugin-guard cases
// force the missing/relative paths. String launches pass through untouched.
const PLUGIN = '/abs/plugins/kiln'
// W2-S3: the LAW check commands are runtime-built from the plugin root (run-checks needs the
// kiln-review path), so the tests reconstruct them from the pure-core builders with the harness
// plugin. LAW_CHECK/LAW_GUARD collapsed to the one regime-aware selector; the receipt wraps it.
const LAW_CHECK_RECEIPT = lawCheckReceipt(PLUGIN + '/scripts/kiln-review')
// W2-S1: every real launch rides the run lock the conductor acquired — run_id + owner. The
// harness supplies both by default so object scenarios model the locked launch envelope and
// pass the pre-boot join; a scenario overrides them (to undefined) to exercise the
// unlocked-launch hold, or overrides the 'run-lock:join' leg to a nonzero to exercise the
// foreign-lock hold.
const RUN_ID = 'run-test'
const OWNER = 'owner-test'
// The boot leg fires on every valid launch; the harness supplies a valid projected
// tier config by default (the node -p projection shape the kernel validates), so a
// scenario only names 'tiers:boot' when it is testing the fail-closed path.
const TIERS_OK = {
  exit: 0, doctrine: true,
  resolver: { 'gpt-sol': 'gpt-5.6-sol' },
  surface_routing: { ui: 'builder-ui', logic: 'builder-logic', mixed: 'builder-logic' },
  roles: {
    'driver': { family: 'claude', alias: 'inherit', effort: 'high' },
    'kernel-leg': { family: 'claude', alias: 'inherit', effort: 'high' },
    'stage-card': { family: 'claude', alias: 'inherit', effort: 'high' },
    // INTAKE-19: the LAW stage is a thinking seat — slice creation runs on fable;
    // builder-ui is donkey work — opus implements ui from the locked plan.
    'stage-law': { family: 'claude', alias: 'fable', effort: 'high' },
    'builder-ui': { family: 'claude', alias: 'opus', effort: 'high' },
    // simple-fire: the logic seat is a claude context-builder whose CODER is
    // GPT-5.6 via one bash codex exec call (cards/build.md); the claude-family
    // route-target boot rule holds BY DESIGN. Wrapper effort HIGH per the
    // INTAKE-14b/Q1 default (a model-backed role defaults HIGH — medium was drift).
    'builder-logic': { family: 'claude', alias: 'sonnet', effort: 'high' },
    'reviewer-gate': { family: 'gpt', alias: 'gpt-sol', effort: 'high' },
    // The codex-absent fallback reviewer (duo-pool.json:7 logic_fallback restored):
    // a boot-required consumer role, consumed on the degraded logic/mixed gate — opus
    // reviews the sonnet-built slice, the best split without a second family.
    'fallback-reviewer': { family: 'claude', alias: 'opus', effort: 'high' },
    // Wave 1 (the Second Key): the always-on cross-family LAW-ratify gate — a
    // gpt reviewer, opposite-family to the claude/fable stage-law producer; a
    // boot-required consumer role the kernel resolves at the law stage.
    'ratify-reviewer': { family: 'gpt', alias: 'gpt-sol', effort: 'high' },
    'brainstorm-facilitator': { family: 'claude', alias: 'inherit', effort: 'high' },
    // Wave 3: raised medium -> high — every role now sits on the HIGH-effort floor.
    'haiku-migration': { family: 'claude', alias: 'sonnet', effort: 'high' },
    'dev-sol': { family: 'gpt', alias: 'gpt-sol', effort: 'high' },
  },
}
async function runKernel(kargs, script) {
  const launch = (kargs && typeof kargs === 'object' && !Array.isArray(kargs))
    ? { plugin: PLUGIN, run_id: RUN_ID, owner: OWNER, ...kargs }
    : kargs
  // W7-S2: every final slice is a milestone seam, so the audits.log grep-skip
  // consults on every build that reaches it; the harness answers already-logged
  // by default so pre-W7 scenarios stay on their own subject. Audit scenarios
  // override audit:check to open the seam gate.
  // W8-S3: every validate run consults the screening-room activation (the table
  // presence check + the dial leg) and clears the semantic marker on its
  // nonsemantic terminals; the harness answers dormant-and-clear by default so
  // pre-W8 scenarios stay on their own subject. Screening scenarios override.
  // S3 (C5+M5): every non-brainstorm stage reads the seal ledger ONCE into an exact-membership
  // Set; the harness answers an empty ledger by default so scenarios that do not script seals
  // build and validate exactly as before. Seal scenarios override with the sealed id set (or a
  // nonzero exit to exercise the fail-closed hold).
  const full = {
    // W2-S1: the pre-boot run-lock join fires on every valid launch; the harness answers a
    // clean join by default so every pre-lock scenario boots and dispatches exactly as before.
    // Foreign-lock scenarios override with a nonzero exit (and an ids owner to name).
    'run-lock:join': { exit: 0, ids: [] },
    // W2-S7b (item 11): the audited-skip decision now reads the reduction through audit-member. The
    // harness answers the coverage-less W1 member (`legacy`) by default — the closest reading of the
    // old already-logged default, so a boot-sealed seam still skips exactly as it did; audit scenarios
    // override with exit 1 (no current member) or an explicit covered csv.
    'tiers:boot': TIERS_OK, 'audit:member': { exit: 0, ids: ['legacy'] },
    // W2-S7b (item 9/10): both cutoff callers — a reopen and a milestone rejection — ride the trusted
    // invalidate verb. The harness answers a clean cutoff by default so every reopen scenario stops
    // exactly as before; a ledger-refusal scenario overrides with a nonzero.
    'seal:invalidate': { exit: 0 },
    // W2-S7a (F1): a fresh (not boot-sealed) seam re-audits even when a rendered audit answers —
    // the boot-snapshot skip guard never honors a stale audit over rebuilt content. The
    // harness answers the seam audit legs by default so a build scenario that reaches its final seam
    // completes without scripting them; audit scenarios still override these to test their subject.
    'law:pre-audit': { exit: 0, ids: [] },
    'audit:review': { exit: 0 },
    'audit:read': { exit: 0, ids: [JSON.stringify({ review_id: 'aud-1', law_hash: 'a'.repeat(64), findings: [], blockers: [], verdict: 'accept' })] },
    'audit:append': { exit: 0 },
    // W2-S6: the boot-time ledger reconcile fires on every non-brainstorm stage just before the
    // seal read; the harness answers a clean reconcile by default so every prior scenario boots and
    // reads membership exactly as before. A reconcile-fault scenario overrides this with a nonzero.
    'ledger:reconcile': { exit: 0 },
    'seal:set': { exit: 0, ids: [] },
    'perceptual:presence': { exit: 1 },
    'perceptual:dial': { exit: 0, perceptual: 'dormant', recovery_cap: 1 },
    'perceptual:marker-clear': { exit: 0 },
    // S4: the degradation path-selector and seal-label reads fire on every law/audit
    // path. The harness answers marker-absent by default (exit 1) so a scenario that
    // does not script codex-down takes the codex seat and seals dual, exactly as before;
    // the degraded scenarios override these with exit 0 (present) or a nonzero-nonone
    // untrusted exit to exercise the tri-state HOLD.
    'law:degraded': { exit: 1 }, 'law:seal-label': { exit: 1 },
    'audit:degraded': { exit: 1 }, 'audit:seal-label': { exit: 1 },
    // W2-S3: the degraded claude auditor brackets its turn with a trio digest before and
    // after; the harness answers an unchanged trio by default (both legs the same three
    // digests) so a degraded-audit scenario publishes exactly as before. A tamper scenario
    // overrides trio-confirm with a different digest set to exercise the fail-closed hold.
    // W2-S3 (B04): the claude turns bind d0 to the SEALED trio.hash digests, then rule d1 === d0.
    // The harness answers a coherent sealed trio by default (sealed === digest === confirm) so a
    // scenario publishes exactly as before; a drift scenario overrides trio-sealed or trio-confirm.
    'audit-claude:trio-sealed': { exit: 0, ids: ['t1', 't2', 't3'] },
    'audit-claude:trio-digest': { exit: 0, ids: ['t1', 't2', 't3'] },
    'audit-claude:trio-confirm': { exit: 0, ids: ['t1', 't2', 't3'] },
    'screen-claude:trio-sealed': { exit: 0, ids: ['t1', 't2', 't3'] },
    'screen-claude:trio-digest': { exit: 0, ids: ['t1', 't2', 't3'] },
    'screen-claude:trio-confirm': { exit: 0, ids: ['t1', 't2', 't3'] },
    // W2-S4: the claude build gate derives its facts from the ONE sealed authority via the
    // gate-facts verb — the cross-bound sealed law_hash on stdout, the filtered builder hints to
    // the trusted P.gateFacts file — and brackets its write-capable turn with the trio digest. The
    // harness answers a coherent sealed law by default so every pre-S4 gate scenario dispatches as
    // before; a torn-seal scenario overrides gate-claude:facts with exit 22, a mutation scenario
    // overrides gate-claude:trio-confirm.
    'gate-claude:facts': { exit: 0, ids: ['a'.repeat(64)] },
    'gate-claude:trio-sealed': { exit: 0, ids: ['t1', 't2', 't3'] },
    'gate-claude:trio-digest': { exit: 0, ids: ['t1', 't2', 't3'] },
    'gate-claude:trio-confirm': { exit: 0, ids: ['t1', 't2', 't3'] },
    // W2-S7a (B-D2): after a ui codex gate the kernel reads the reviewer leg the review verb wrote to
    // the gate sidecar; the harness answers a well-formed codex reviewer leg by default so every
    // ui-normal gate scenario seals with a real reviewer reference.
    'gate:leg': { exit: 0, ids: ['c'.repeat(32)] },
    // W2-S7a (FORK 3): every non-sealed slice captures its baseline before the builder mint, and every
    // gate prepares a fresh control-derived manifest; the harness answers both clean by default so
    // pre-FORK-3 scenarios build and gate exactly as before. A manifest-fault scenario overrides these.
    'manifest:start': { exit: 0 }, 'manifest:prepare': { exit: 0 },
    // W2-S7a (FORK 1): every claude reviewer leg composes its canonical contract through the trusted
    // contract-prepare verb before dispatch; the harness answers a fresh contract digest by default so
    // every pre-FORK-1 gate/audit/ratify/screen scenario dispatches and publishes exactly as before. A
    // contract-fault scenario overrides these with a nonzero exit.
    'gate-claude:contract': { exit: 0, ids: ['d'.repeat(64)] },
    'audit-claude:contract': { exit: 0, ids: ['d'.repeat(64)] },
    'ratify:contract': { exit: 0, ids: ['d'.repeat(64)] },
    'screen:contract': { exit: 0, ids: ['d'.repeat(64)] },
    // W2-S7a (F3): the write-capable claude screen leg recomposes its contract before publish and
    // requires the digest unchanged; the harness answers the confirm with the SAME digest by default so
    // a clean turn publishes. An evidence-tamper scenario overrides it with a different digest.
    'screen:contract-confirm': { exit: 0, ids: ['d'.repeat(64)] },
    ...script,
  }
  const calls = []
  // W2-S7a: each Claude dispatch now mints an identity leg first (an idsFetch labelled
  // identity:<role>) and then runs under the returned reserved leg: label. The harness answers a
  // mint with a fresh unique leg and registers its role+subject; a leg-labelled dispatch resolves
  // back to its stable logical label — role+subject from the mint, mode (review/recheck/escalate)
  // from the prompt — so every prior scenario keys its scripted answer and asserts on calls exactly
  // as before the swap. The RESOLVED label is what the call records, so nothing downstream changes.
  const legReg = new Map()
  let legSeq = 0
  // A dogfood launch names a real project dir; its identity mints run the REAL identity-begin so the
  // real append verbs validate the leg references against a real identity.jsonl. An object scenario
  // has no real .kiln, so its mints stay a fresh in-memory leg.
  const realDir = (launch && typeof launch === 'object' && typeof launch.projectDir === 'string' && existsSync(join(launch.projectDir, '.kiln'))) ? launch.projectDir : null
  const modeOf = (prompt) => /Recheck only/.test(prompt) ? 'recheck' : /bounded second-family escalation/.test(prompt) ? 'escalate' : 'review'
  const resolveLeg = (legLabel, prompt) => {
    const reg = legReg.get(legLabel)
    if (!reg) return legLabel
    switch (reg.role) {
      case 'builder': return 'slice:' + reg.subject
      case 'repair': return 'repair:' + reg.subject
      case 'audit-repair': return 'audit:repair'
      case 'gate-reviewer': return 'gate-claude:' + modeOf(prompt)
      case 'auditor': return 'audit-claude:' + modeOf(prompt)
      case 'ratifier': return 'ratify-claude:' + modeOf(prompt)
      case 'screen-grader': return 'screen-claude:' + modeOf(prompt)
      default: return legLabel
    }
  }
  const agentMock = async (prompt, opts = {}) => {
    let key = opts.label
    if (typeof key === 'string' && /^leg:[0-9a-f]{32}$/.test(key)) key = resolveLeg(key, prompt)
    calls.push({ label: key, prompt, opts })
    // The identity mint: a scenario may override identity:<role> to force a mint fault; absent an
    // override the harness answers a fresh unique leg and registers the upcoming dispatch identity.
    if (full[key] === undefined && typeof key === 'string' && key.startsWith('identity:')) {
      const m = prompt.match(/identity-begin \.kiln '([^']*)' '([^']*)' '([^']*)'/)
      if (realDir) {
        const rr = spawnSync('sh', ['-c', prompt.split('\n').pop()], { cwd: realDir, encoding: 'utf8' })
        const ids = (rr.stdout || '').trim().split(/\s+/).filter(Boolean)
        if (rr.status === 0 && ids.length === 2 && m) legReg.set(ids[1], { role: m[1], subject: m[3] })
        return { exit: rr.status === null ? 20 : rr.status, ids: rr.status === 0 ? ids : [] }
      }
      const id = (legSeq++).toString(16).padStart(32, '0')
      if (m) legReg.set('leg:' + id, { role: m[1], subject: m[3] })
      return { exit: 0, ids: [id, 'leg:' + id] }
    }
    const h = full[key]
    if (h === undefined) throw new Error('unmocked label: ' + key)
    return typeof h === 'function' ? h(prompt, calls) : h
  }
  const body = src.replace('export const meta', 'const meta')
  const fn = new AsyncFunction('agent', 'pipeline', 'parallel', 'log', 'phase', 'args', 'budget', 'workflow', body)
  const ret = await fn(agentMock, null, null, () => {}, () => {}, launch, null, null)
  // W-03: every kernel return carries a real beat — asserted on every scenario.
  assert.ok(typeof ret.beat === 'string' && ret.beat.length > 0,
    `W-03: empty beat on status "${ret.status}"`)
  return { ret, calls }
}
const lastStateDoc = (calls) => {
  const w = calls.filter(c => c.label === 'state:write')
  return w.length ? w[w.length - 1].prompt : ''
}
// The state:write courier now runs the opaque `kiln-review state-commit .kiln <token>
// <stage> <slice> <key> <density> [pointers...]` — no next_action prose (Defect B). Every
// word is single-quoted (shq) against shell injection, so strip the quotes to read the
// kernel's closed transition decision; the key -> hint-text rendering is proven per key
// against the real CLI in state-commit.test.mjs.
const stateArgs = (calls) => {
  const cmd = lastStateDoc(calls)
  const marker = 'state-commit .kiln '
  const i = cmd.indexOf(marker)
  if (i < 0) return { token: '', stage: '', slice: '', key: '', density: '', pointers: [], cmd }
  const words = cmd.slice(i + marker.length).trim().split(' ').map((w) => w.replace(/^'|'$/g, ''))
  const [token, stage, slice, key, density, ...pointers] = words
  return { token, stage, slice, key, density, pointers, cmd }
}
const GREEN = { exit: 0, ids: [] }
const LADDER = { exit: 0, ids: ['first-blood', 'spark-of-life', 'signal-fire'] }
// The claude gate returns the schema-forced review-schema.json object; the kernel
// publishes it by hand and maps the verdict onto the closed exit table.
const GATE_ACCEPT = { review_id: 'r1', law_hash: 'a'.repeat(64), findings: [], blockers: [], verdict: 'accept' }
// S1: the claude gate fetches the locked law hash from the review request as a
// closed machine fact before validating any verdict against it.
const HASH_OK = { exit: 0, ids: ['a'.repeat(64)] }
// Producer-self-publish (INTAKE-27): the claude reviewer WRITES its verdict to the
// candidate file and returns only this light {ok} ack; the kernel reads the written
// bytes back raw (gate:read) and validates them. The mock models the written
// candidate as the raw file read — a one-element array holding the file contents.
const OK_ACK = { ok: true }
const readCandidate = (verdict) => ({ exit: 0, ids: [JSON.stringify(verdict)] })
// Wave 3: the LAW input gate reads the onboarding outputs — the brief nonempty, then the
// posture as a valid {scope,novelty,reversibility} projection — before the law card plans.
// Every law scenario scripts these two passing legs; the gate's own fail paths override them.
const ONBOARDING_OK = {
  'onboarding:brief-check': { exit: 0 },
  'onboarding:posture': { exit: 0, scope: 'small', novelty: 'familiar', reversibility: 'reversible' },
  // Wave 3 (brownfield arm): greenfield by default — no marker, so the map-check
  // short-circuits and never runs. Brownfield law scenarios override this leg.
  'onboarding:brownfield-check': { exit: 1 },
  // W5-S2 (W5-04): the Gauge WIDTH dial read rides the law happy path AFTER the input gate.
  // floor keeps the single act producer — the untouched pre-W5-S2 path — so every existing law
  // scenario stays on the floor unless it overrides width:read. Law-only: validate/report never
  // reach the width branch, so an unused floor mock is harmless where ONBOARDING_OK is spread there.
  // W6-F: recovery_cap 2 matches this reversible onboarding posture, so the LAW-ratify loop keeps
  // the two-repair cap the pre-W6 hardcoded bound gave it — one dial read now carries both.
  'width:read': { exit: 0, width: 'floor', recovery_cap: 2 },
}
const VOICE = {
  'voice:resume': { exit: 0, ids: ['The fire never went out. Kiln again — the ledger holds the next step, and I am already taking it.'] },
  'voice:reopen': { exit: 0, ids: ['Slice {slice} reopened — a law check went red. A seal is evidence-bound, not sacred.'] },
  'voice:blocked': { exit: 0, ids: ['The gate held after {passes} repair passes. Findings {ids} are on the table; the ruling is yours.'] },
  'voice:degradation': { exit: 0, ids: ['Codex is not answering the door. Say `continue` and I proceed.'] },
  'voice:stage.brainstorm': { exit: 0, ids: ['Da Vinci takes the window. Speak freely — he sees what you meant, not just what you said.'] },
  // S1 joint ruling: the reachable kernel twin sites read these sealed keys.
  'voice:seal': { exit: 0, ids: ['Slice {slice} sealed — {label}. The evidence holds.'] },
  'voice:bad-args': { exit: 0, ids: ['Unknown stage in the launch args — the spine knows law, build, validate, report.'] },
  'voice:gate-unreachable': { exit: 0, ids: ['The gate tool would not run — not found or not executable where it lives, so codex was never reached and no verdict exists. Nothing seals on a guess; restore the gate and relaunch.'] },
  'voice:transport-failure': { exit: 0, ids: [
    'The review call went out and came back with no verdict — the gate could not finish the round-trip, so the slice cannot seal. The run holds until the transport is sound; I never turn a failed call into a pass.',
    'The stage worker returned no usable result — its report did not hold, so nothing seals and the run cannot advance. A clean rerun of that stage puts it back in motion.',
  ] },
}

test('workflow body: parses as an async function body with the runtime globals', () => {
  const body = src.replace('export const meta', 'const meta')
  assert.doesNotThrow(() => new AsyncFunction(
    'agent', 'pipeline', 'parallel', 'log', 'phase', 'args', 'budget', 'workflow', body,
  ))
})

test('content-blind: no filesystem, clock, randomness, or content parsing in the kernel', () => {
  // Command strings handed to mechanical agents are data (the lawful
  // closed-facts fetch); the scan targets kernel CODE, so string literals
  // are blanked before scanning.
  const code = src.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, '""')
  for (const banned of [
    'node:fs', 'readFile', 'writeFile', "require(", 'child_process',
    'Date.now', 'Math.random', 'new Date',
    '.match(', '.exec(', 'marked', 'frontmatter',
  ]) {
    assert.ok(!code.includes(banned), `kernel code must not contain "${banned}"`)
  }
  // W-01: exactly SIX JSON.parse calls — the sanctioned parse-and-hop args
  // adapter in the pure core (envelope mechanics), the gate-file mirror in the
  // workflow runtime (the kernel parses the raw candidate bytes it validates
  // and publishes), the W7-S2 audit-verdict mirror (the kernel parses the
  // published audit bytes it rederives through reconcileAudit), the W8-S3
  // shared screen mirror (one read site serves the Claude candidate, the Claude
  // escalation, and the recheck prior lineage), and the S4 claude ratify and
  // claude audit gate-file mirrors (each parses the raw candidate the opus
  // fallback reviewer wrote before validating and publishing it). All are
  // sanctioned envelope reads, never content parsing.
  assert.equal(code.split('JSON.parse').length - 1, 6, 'exactly six JSON.parse (the args adapter + the gate-file mirror + the audit-verdict mirror + the shared screen mirror + the S4 claude ratify and audit mirrors)')
  assert.ok(coreSrc.includes('Parse-and-hop'), 'the adapter is the marked parse-and-hop region')
})

test('parse-and-hop: args accepted in both shapes; malformed input never takes the bare path', () => {
  assert.deepEqual(parseArgs({ stage: 'law' }), { ok: true, value: { stage: 'law' } })
  assert.deepEqual(parseArgs(undefined), { ok: true, value: {} })
  assert.deepEqual(parseArgs(null), { ok: true, value: {} })
  const hop = parseArgs(JSON.stringify({ stage: 'build', projectDir: '/p', idea: 'x' }))
  assert.equal(hop.ok, true)
  assert.deepEqual(hop.value, { stage: 'build', projectDir: '/p', idea: 'x' })
  assert.equal(parseArgs('not json').ok, false)
  assert.equal(parseArgs('"a bare string"').ok, false)
  assert.equal(parseArgs('[1,2]').ok, false)
  assert.equal(parseArgs(42).ok, false)
})

test('topology: spine order, direct mode skips brainstorm, resume passthrough', () => {
  assert.deepEqual(SPINE, ['law', 'build', 'validate', 'report'])
  assert.equal(resolveStage({ idea: 'a site' }), 'law')
  assert.equal(resolveStage({}), 'needs-brainstorm')
  assert.equal(resolveStage({ stage: 'validate' }), 'validate')
  assert.equal(resolveStage({ stage: 'nonsense' }), null)
  assert.equal(nextStage('law'), 'build')
  assert.equal(nextStage('report'), null)
})

test('gate wiring: the transport exit table maps to closed outcomes, unknown fails closed', () => {
  assert.equal(gateOutcome(0), 'accept')
  assert.equal(gateOutcome(10), 'reject')
  assert.equal(gateOutcome(11), 'blocked')
  assert.equal(gateOutcome(21), 'codex_unavailable')
  assert.equal(gateOutcome(20), 'transport_failure')
  assert.equal(gateOutcome(1), 'transport_failure')
  assert.equal(gateOutcome(139), 'transport_failure')
  // 126/127 name the gate tool itself as unreachable — not a transport failure.
  assert.equal(gateOutcome(127), 'gate_unreachable', 'not found → the tool is unreachable')
  assert.equal(gateOutcome(126), 'gate_unreachable', 'not executable → the tool is unreachable')
})

test('review loop (W6-F): the repair edge is bounded by the injected reversibility-keyed cap — cap 2 allows two traversals, cap 1 one, both then block', async () => {
  // The pre-W6 hardcoded bound of 2 is now the keyed cap. The regenerate edge is traversable up
  // to the cap, then holds — parameterized on the two reachable caps (2 reversible, 1 otherwise).
  for (const cap of [2, 1]) {
    const calls = { gate: [], repair: [] }
    const exits = [10, 10, 10]
    const r = await reviewLoop({
      gate: async (mode) => { calls.gate.push(mode); return exits.shift() },
      repair: async (pass) => { calls.repair.push(pass); return true },
    }, cap)
    assert.deepEqual(r, { result: 'blocked', repairs: cap }, 'cap ' + cap + ': exactly cap edge traversals, then blocked')
    assert.equal(calls.repair.length, cap, 'cap ' + cap + ': the regenerate edge is traversed exactly cap times')
    assert.deepEqual(calls.gate, cap === 2 ? ['review', 'recheck', 'recheck'] : ['review', 'recheck'],
      'cap ' + cap + ': review then cap rechecks, never one more')
  }
})

test('core (W6-F): capFromDial keys the recovery cap on the dial — cap 2 only on exit 0 + recovery_cap exactly 2, else fail up to 1; width never enters', () => {
  assert.equal(capFromDial({ exit: 0, recovery_cap: 2 }), 2, 'exit 0 and recovery_cap 2 (the reversible profile) is the only cap-2 reading')
  assert.equal(capFromDial({ exit: 0, recovery_cap: 1 }), 1, 'recovery_cap 1 (risky/irreversible) keys cap 1')
  assert.equal(capFromDial({ exit: 0, width: 'wide', recovery_cap: 2 }), 2, 'a wide reading with recovery_cap 2 is still cap 2 — width never lowers it')
  assert.equal(capFromDial({ exit: 0, width: 'wide', recovery_cap: 1 }), 1, 'a wide reading with recovery_cap 1 is cap 1 — width never RAISES the cap')
  assert.equal(capFromDial({ exit: 0 }), 1, 'a missing recovery_cap fails up to 1')
  assert.equal(capFromDial({ exit: 20, recovery_cap: 2 }), 1, 'a transport failure fails up to 1 even when a cap value rode along')
  assert.equal(capFromDial({ exit: 0, recovery_cap: '2' }), 1, 'a string "2" is not the integer 2 — strict, fails up to 1')
  assert.equal(capFromDial({ exit: 0, recovery_cap: 3 }), 1, 'an out-of-range cap fails up to 1')
  assert.equal(capFromDial(undefined), 1, 'an absent leg fails up to 1, never throws')
})

test('review loop: clean accept seals with zero repairs; reject→accept seals after one', async () => {
  const mk = (exits) => ({ gate: async () => exits.shift(), repair: async () => true })
  assert.deepEqual(await reviewLoop(mk([0]), 2), { result: 'sealed', repairs: 0 })
  assert.deepEqual(await reviewLoop(mk([10, 0]), 2), { result: 'sealed', repairs: 1 })
})

test('review loop: an unconfirmed repair halts visibly — no recheck runs', async () => {
  const gates = []
  const r = await reviewLoop({
    gate: async (mode) => { gates.push(mode); return 10 },
    repair: async () => false,
  }, 2)
  assert.deepEqual(r, { result: 'repair-failed', repairs: 1 })
  assert.deepEqual(gates, ['review'], 'recheck must not run after a failed repair')
})

test('review loop: blocked, degradation, and transport failure short-circuit without repair', async () => {
  let repaired = false
  const mk = (exit) => ({ gate: async () => exit, repair: async () => { repaired = true; return true } })
  assert.equal((await reviewLoop(mk(11), 2)).result, 'blocked')
  assert.equal((await reviewLoop(mk(21), 2)).result, 'degraded')
  assert.equal((await reviewLoop(mk(20), 2)).result, 'transport-failure')
  assert.equal((await reviewLoop(mk(127), 2)).result, 'gate-unreachable')
  assert.equal((await reviewLoop(mk(126), 2)).result, 'gate-unreachable')
  assert.equal(repaired, false)
})

test('slots: every kernel-owned slot from the sealed map fills; semantic slots pass through', () => {
  // S2 joint ruling: {driver} is NOT kernel-owned — it is DRIVER-filled at
  // completion, so fillClosed leaves it even when a stray fact names it.
  const beat = '{STAGE} {i}/{n} slice {slice} [{label}] {s}/{t} {streak}|{STREAK} p{passes} c{count} [{ids}] d{driver} — {quote} {title_row}'
  const out = fillClosed(beat, {
    STAGE: 'BUILD', i: 2, n: 4, slice: 's1', label: 'dual', s: 1, t: 3,
    streak: 'first-blood', STREAK: 'FIRST-BLOOD', passes: 1, count: 2, ids: 'F1, F2', driver: 812,
  })
  assert.equal(out, 'BUILD 2/4 slice s1 [dual] 1/3 first-blood|FIRST-BLOOD p1 c2 [F1, F2] d{driver} — {quote} {title_row}')
  assert.equal(fillClosed('{STAGE}', {}), '{STAGE}', 'missing facts leave the slot for the owner')
})

test('streak arithmetic: the sealed formula, clamped and wrapping', () => {
  assert.equal(streakIndex(1, 0), 0)
  assert.equal(streakIndex(0, 0), 0, 'max(…,1) clamps')
  assert.equal(streakIndex(2, 3), 4)
  assert.equal(streakIndex(41, 0), 0, 'wraps at 40')
  assert.equal(streakIndex(3, 0, 3), 2, 'wraps at the ladder length')
})

test('state transition: status maps to the closed courier token, next_action to the key', () => {
  // The courier speaks only closed words (Defect B). stateToken names the transition
  // kind; stateKey selects the operator hint — status-authoritative, with next_action
  // disambiguating the few statuses that carry more than one hint. The STATE.md bytes and
  // the atomic write live in the trusted CLI and are proven in state-commit.test.mjs.
  assert.equal(stateToken('ok'), 'advance')
  assert.equal(stateToken('done'), 'advance')
  assert.equal(stateToken('blocked'), 'hold')
  assert.equal(stateToken('held'), 'hold')
  assert.equal(stateToken('degraded'), 'degrade')
  assert.equal(stateToken('law-red'), 'boundary')
  assert.equal(stateToken('transport-failure'), 'boundary')

  assert.equal(stateKey('done', 'Run complete'), 'run-complete')
  assert.equal(stateKey('ok', 'Relaunch the kernel workflow with stage=build'), 'relaunch-build')
  // law-red always reopens its owner, even when the prose reads "Rerun stage build".
  assert.equal(stateKey('law-red', 'Rerun stage build: the LAW is red at the milestone audit of slice s1'), 'reopen-slice')
  assert.equal(stateKey('blocked', 'Operator ruling: gate blocked for slice s1'), 'operator-ruling')
  assert.equal(stateKey('gate-unreachable', 'Rerun stage build after restoring the gate tool'), 'restore-gate')
  assert.equal(stateKey('repair-failed', 'Rerun stage build: the repair pass did not land for slice s1'), 'repair-failed')
  // degraded carries two distinct hints: the milestone audit needs codex; the seal proceeds single-family.
  assert.equal(stateKey('degraded', 'Restore codex, then relaunch stage build: the milestone audit of slice s1 needs the second family'), 'restore-codex')
  assert.equal(stateKey('degraded', 'Acknowledge single-family degradation, then relaunch stage build'), 'acknowledge-degrade')
  // held resolves three hints by its prose; the onboarding transport failure keeps its own key.
  assert.equal(stateKey('held', 'Operator ruling: the ratify reviewer held the LAW'), 'operator-ruling')
  assert.equal(stateKey('held', 'The LAW needs an opposite-family ratifier and codex is not answering — restore codex, then rerun stage law'), 'restore-codex')
  assert.equal(stateKey('held', 'Rerun stage law — a LAW repair pass did not land'), 'repair-failed')
  assert.equal(stateKey('transport-failure', 'Rerun onboarding: .kiln/brief.md is empty'), 'rerun-onboarding')
  // B2: a "Rerun stage X" hint carries its TARGET stage — a build missing its slice list
  // returns to LAW, not to build. rerunKey parses the target; same-stage cases match.
  assert.equal(stateKey('transport-failure', 'Rerun stage law: no slice list at .kiln/slices.json'), 'rerun-law')
  assert.equal(stateKey('slices-invalid', 'Rerun stage law: a slice descriptor is malformed'), 'rerun-law')
  assert.equal(stateKey('transport-failure', 'Rerun stage build'), 'rerun-build')
})

test('state-commit courier: only closed words ride the command, each shell-quoted — no next_action prose', () => {
  const cmd = stateCommitCmd('/abs/plugins/kiln', 'boundary', 'build', 's1', 'reopen-slice', 'engineer', ['.kiln/STATE.md', '.kiln/gate-review.json'])
  // Every word single-quoted (shq) so nothing it contains can break out into live shell.
  assert.equal(cmd, "node '/abs/plugins/kiln/scripts/kiln-review' state-commit .kiln 'boundary' 'build' 's1' 'reopen-slice' 'engineer' '.kiln/STATE.md' '.kiln/gate-review.json'")
  // B1: an injection pointer is DROPPED by the grammar filter — it never reaches the argv.
  const injected = stateCommitCmd('/p', 'boundary', 'build', 's1', 'reopen-slice', 'broad', ['.kiln/LAW.md; echo INJECTED', '.kiln/STATE.md'])
  assert.ok(!injected.includes('INJECTED') && !injected.includes(';'), 'a metacharacter-bearing pointer is filtered before the command build')
  assert.ok(injected.includes("'.kiln/STATE.md'"), 'the safe pointer survives')
  // A malformed slice descriptor can never split the argv — it sanitizes to none.
  assert.ok(stateCommitCmd('/p', 'boundary', 'law', 'bad slice', 'rerun-stage', 'broad', []).includes("'none' 'rerun-stage'"), 'a slice id with a space collapses to none')
  // The hint prose itself never appears — kiln-review derives it from the closed key.
  assert.ok(!cmd.includes('Reopen slice'), 'no next_action prose on the courier')
})

test('gate command: review and recheck route paths per the sealed transport contract', () => {
  // W2-S4: the authoritative closed facts ride argv — the kiln dir, the named slice, and the
  // reviewer-gate model and effort — so the CLI derives law_hash and law_text from the sealed
  // trio; the request rides only as builder hints. B01: every word is shq-quoted.
  // W2-S7a (B-D1): the reviewer alias rides argv adjacent to the model.
  const p = { plugin: 'plugins/kiln', repo: '/p', kilnDir: '.kiln', slice: 's1', model: 'gpt-5.6-sol', alias: 'gpt-sol', effort: 'high', request: '.kiln/review-request.json', gate: '.kiln/gate-review.json', priorGate: '.kiln/gate-review.json', delta: '.kiln/repair-delta.md' }
  assert.equal(gateCmd('review', p), "'plugins/kiln/scripts/kiln-review' 'review' '/p' '.kiln' 's1' 'gpt-5.6-sol' 'gpt-sol' 'high' '.kiln/review-request.json' '.kiln/gate-review.json'")
  assert.equal(gateCmd('recheck', p), "'plugins/kiln/scripts/kiln-review' 'recheck' '/p' '.kiln' 's1' 'gpt-5.6-sol' 'gpt-sol' 'high' '.kiln/review-request.json' '.kiln/gate-review.json' '.kiln/repair-delta.md' '.kiln/gate-review.json'")
})

test('gate command (W2-S4/B01): a resolver model carrying shell metacharacters is one inert argv word — never live shell, never a broken arity', () => {
  // validateTiers accepts any nonempty resolver value, so an injected model must be neutralized by
  // shq, not trusted. A metacharacter payload and a whitespace value each ride as ONE quoted word.
  const evil = 'gpt-x; touch /tmp/pwn'
  const p = { plugin: 'plugins/kiln', repo: '/p', kilnDir: '.kiln', slice: 's1', model: evil, alias: 'gpt-sol', effort: 'high', request: '.kiln/review-request.json', gate: '.kiln/gate-review.json' }
  const cmd = gateCmd('review', p)
  assert.ok(cmd.includes("'" + evil + "'"), 'the injected model is wrapped in single quotes as one argv word — the metacharacters are inert inside the quote')
  // Outside the model quote the surrounding words stay their own quoted tokens — the payload never
  // escapes to become a second shell command.
  assert.ok(cmd.endsWith("'.kiln/gate-review.json'") && cmd.includes("'high' '.kiln/review-request.json'"),
    'the words after the model are still their own quoted argv tokens — the injection did not swallow them')
  const spaced = gateCmd('review', { ...p, model: 'a model with spaces' })
  assert.ok(spaced.includes("'a model with spaces'"), 'a whitespace model stays one word — the fixed arity never splits')
})

// ── K-09/W-01/W-03: the mocked-runtime suite ────────────────────────────────

test('runtime (W-01): string-encoded args parse and run — the walker case', async () => {
  // The string launch skips the object-launch harness injection, so it carries the run-lock
  // facts explicitly — a real conductor blob does exactly this.
  const { ret } = await runKernel(JSON.stringify({ stage: 'validate', projectDir: '/p', run_id: RUN_ID, owner: OWNER, plugin: PLUGIN }), {
    ...VOICE,
    'law:preflight': GREEN,
    'stage:validate': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'validating' },
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'stringified args behave exactly like object args')
})

test('runtime (W-01): malformed string args are a closed-fact error, never the bare path', async () => {
  const { ret, calls } = await runKernel('this is not json', {})
  assert.equal(ret.status, 'bad-args')
  assert.notEqual(ret.status, 'needs-brainstorm', 'malformed input must not read as a bare launch')
  assert.equal(calls.length, 0, 'no agent runs on malformed args')
})

test('runtime: a missing plugin root halts honestly — no relative fallback, no work', async () => {
  const { ret, calls } = await runKernel({ stage: 'validate', projectDir: '/p', plugin: undefined }, {})
  assert.equal(ret.status, 'bad-args')
  assert.ok(ret.beat.includes('absolute'), 'the halt names the absolute-path contract')
  assert.ok(ret.beat.includes('plugin root'), 'and names exactly what is wrong')
  assert.equal(calls.length, 0, 'nothing runs without a plugin root — no silent relative fallback')
})

test('runtime: a relative plugin root halts the same way — a relative root is never guessed at', async () => {
  const { ret, calls } = await runKernel({ stage: 'validate', projectDir: '/p', plugin: 'plugins/kiln' }, {})
  assert.equal(ret.status, 'bad-args')
  assert.ok(ret.beat.includes('absolute'))
  assert.equal(calls.length, 0)
})

test('runtime: an absolute plugin root proceeds — existing behavior preserved', async () => {
  const { ret } = await runKernel({ stage: 'validate', projectDir: '/p', plugin: '/opt/kiln/plugins/kiln' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'stage:validate': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'validating' },
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'a valid absolute root runs exactly as before')
})

test('runtime: an unreachable gate tool halts distinctly — sealed beat, restore-gate key in STATE', async () => {
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p', plugin: '/opt/kiln/plugins/kiln' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 127 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'gate-unreachable')
  // S1 wiring: the beat is the sealed gate-unreachable template; the persisted
  // STATE carries the closed restore-gate key, and kiln-review renders the hint.
  assert.ok(ret.beat.includes('The gate tool would not run'), 'the sealed gate-unreachable template arrives')
  assert.ok(!ret.beat.toLowerCase().includes('transport failed'), 'distinct from the transport-failure wording')
  assert.equal(stateArgs(calls).key, 'restore-gate', 'the gate-unreachable STATE carries the restore-gate key')
})

test('runtime (S1): an unknown stage speaks the sealed bad-args template — the site voice-reads post-root', async () => {
  const { ret, calls } = await runKernel({ stage: 'nonsense', projectDir: '/p' }, { ...VOICE })
  assert.equal(ret.status, 'bad-args')
  assert.ok(ret.beat.includes('Unknown stage in the launch args — the spine knows law, build, validate, report.'), 'the sealed bad-args template arrives')
  assert.ok(calls.some(c => c.label === 'voice:bad-args'), 'the beat came through the voice fetch, not a hardcoded line')
})

test('runtime (S1): a failed stage worker speaks the sealed stage-worker transport variant', async () => {
  const { ret } = await runKernel({ stage: 'validate', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'stage:validate': { facts: { status: 'failed', pointers: [], schema_valid: false }, narration_beat: '' },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'transport-failure')
  assert.ok(ret.beat.includes('The stage worker returned no usable result'), 'the sealed stage-worker variant (entry 1) arrives')
})

test('runtime (S1): a review transport failure speaks the sealed review-call variant', async () => {
  const { ret } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 20 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'transport-failure')
  assert.ok(ret.beat.includes('The review call went out and came back with no verdict'), 'the sealed review-call variant (entry 0) arrives')
})

test('runtime (W-03): a genuine bare launch returns needs-brainstorm with a real beat', async () => {
  const { ret } = await runKernel({ projectDir: '/p' }, { ...VOICE })
  assert.equal(ret.status, 'needs-brainstorm')
  assert.ok(ret.beat.includes('Da Vinci'), 'the sealed brainstorm template arrives')
})

test('runtime (W-04): preflight red on a SEALED owner reopens it, owner persisted', async () => {
  const { ret, calls } = await runKernel({ stage: 'validate', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': { exit: 1, ids: ['s7'] },
    'seal:set': { exit: 0, ids: ['s7'] },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'law-red')
  assert.ok(ret.beat.includes('Slice s7 reopened'), 'the sealed reopen template arrives filled')
  const st = stateArgs(calls)
  assert.equal(st.slice, 's7', 'owner persisted as the active_slice arg')
  assert.equal(st.key, 'reopen-slice', 'STATE carries the reopen-slice key for the owner')
})

test('runtime (W2-S7b, item 9): a reopen WITHDRAWS the slice through the trusted cutoff BEFORE it stops — and a ledger that refuses the cutoff holds instead of claiming a reopen', async () => {
  // Pre-S7b a reopen was a pure stop: the slice kept its rendered membership, the next boot skipped it
  // as sealed, and nothing ever rebuilt it (D1). The cutoff is what makes the reopen mean something.
  const script = (invalidateExit) => ({
    ...VOICE,
    'law:preflight': { exit: 1, ids: ['s7'] },
    'seal:set': { exit: 0, ids: ['s7'] },
    'seal:invalidate': { exit: invalidateExit },
    'state:write': GREEN,
  })
  const { ret, calls } = await runKernel({ stage: 'validate', projectDir: '/p' }, script(0))
  assert.equal(ret.status, 'law-red')
  const cut = calls.find(c => c.label === 'seal:invalidate')
  assert.ok(cut.prompt.includes("kiln-review' invalidate .kiln 's7'"), 'the reopened owner is withdrawn through the trusted verb, shq-quoted')
  assert.ok(calls.indexOf(cut) < calls.findIndex(c => c.label === 'state:write'),
    'the withdrawal is durable before the STATE write — a crash between them retries onto the verbs no-op, never onto a reopen nothing recorded')
  const refused = await runKernel({ stage: 'validate', projectDir: '/p' }, script(20))
  assert.equal(refused.ret.status, 'persist-failed', 'a refused cutoff is the ledger-refused-the-write grammar')
  assert.equal(refused.ret.pointers.failed, 'seal-invalidate')
  assert.ok(!refused.calls.some(c => c.label === 'state:write'), 'and no STATE claims a reopen the ledger did not take')
})

test('runtime (W-04): preflight red on an UNSEALED slice is pre-build state — build dispatches', async () => {
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': { exit: 1, ids: ['s1'] },
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'the expected pre-build red never reopens')
  assert.ok(calls.some(c => c.label === 'slice:s1'), 'the active slice build dispatches')
  assert.ok(ret.beat.includes('Slice s1 sealed — dual. The evidence holds.'), 'the sealed seal template arrives filled')
  // STRIKE 3: the seal leg passes the cwd-relative `.kiln` dir — never an unquoted
  // absolute projectDir, which a whitespace path would split into extra args.
  const sealLeg = calls.find(c => c.label === 'seal:append')
  assert.ok(sealLeg.prompt.includes('append-seal .kiln '), 'the seal leg passes the cwd-relative .kiln dir')
  assert.ok(!sealLeg.prompt.includes('/p/.kiln'), 'never the interpolated absolute projectDir path')
})

test('runtime: ANY pre-seal red blocks the seal unless a sealed owner reopens', async () => {
  const base = (preSeal) => ({
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['s1'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'slice:s1': { facts: { status: 'ok', pointers: ['.kiln/build-notes.md'], schema_valid: true }, narration_beat: '{streak}. Slice `{slice}` takes the anvil.' },
    'law:pre-seal': preSeal,
    'state:write': GREEN,
  })
  // Unowned red — fail-closed.
  const unowned = await runKernel({ stage: 'build', projectDir: '/p' }, base({ exit: 1, ids: [] }))
  assert.equal(unowned.ret.status, 'law-red')
  assert.equal(stateArgs(unowned.calls).slice, 's1')
  assert.ok(!unowned.ret.beat.includes('sealed —'), 'no seal under an unowned red')
  // Red owned by ANOTHER unsealed slice — blocks all the same (full LAW green
  // at every slice boundary, per Sol's boundary ruling).
  const otherOwned = await runKernel({ stage: 'build', projectDir: '/p' }, base({ exit: 1, ids: ['s2'] }))
  assert.equal(otherOwned.ret.status, 'law-red')
  assert.equal(stateArgs(otherOwned.calls).slice, 's1')
  assert.ok(!otherOwned.ret.beat.includes('sealed —'), 'no seal under any red at the boundary')
})

test('runtime: stage-end red on a sealed owner reopens it', async () => {
  const { ret, calls } = await runKernel({ stage: 'validate', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'stage:validate': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'validating' },
    'law:stage-end': { exit: 1, ids: ['s2'] },
    'seal:set': { exit: 0, ids: ['s2'] },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'law-red')
  assert.equal(stateArgs(calls).slice, 's2')
})

test('runtime: a failed STATE write surfaces as persist-failed, never a success status', async () => {
  const { ret } = await runKernel({ stage: 'validate', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'stage:validate': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'validating' },
    'law:stage-end': GREEN,
    'state:write': { exit: 1 },
  })
  assert.equal(ret.status, 'persist-failed')
  assert.equal(ret.pointers.failed, 'state-write')
})

test('runtime: a failed seal append halts before the seal beat or STATE advance', async () => {
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 0 },
    'seal:append': { exit: 1 },
  })
  assert.equal(ret.status, 'persist-failed')
  assert.equal(ret.pointers.failed, 'seal-append')
  assert.ok(!ret.beat.includes('sealed'), 'no seal beat after a failed append')
  assert.equal(calls.filter(c => c.label === 'state:write').length, 0, 'no STATE advance after a failed append')
})

test('runtime: degradation is sticky only when the mark lands; a failed mark surfaces', async () => {
  const base = {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 21 },
  }
  const bad = await runKernel({ stage: 'build', projectDir: '/p' }, { ...base, 'degraded:mark': { exit: 1 } })
  assert.equal(bad.ret.status, 'persist-failed')
  assert.equal(bad.ret.pointers.failed, 'degraded-mark')
  const good = await runKernel({ stage: 'build', projectDir: '/p' }, { ...base, 'degraded:mark': { exit: 0 }, 'state:write': GREEN })
  assert.equal(good.ret.status, 'degraded')
  assert.ok(good.ret.beat.includes('Codex is not answering'), 'the sealed degradation template arrives')
})

test('runtime: stage pointers merge into STATE and the return (never discarded)', async () => {
  const { ret, calls } = await runKernel({ stage: 'validate', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'stage:validate': { facts: { status: 'ok', pointers: ['.kiln/validate-report.md'], schema_valid: true }, narration_beat: 'validating' },
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok')
  assert.ok(ret.pointers.routes.includes('.kiln/validate-report.md'), 'return carries the route')
  assert.ok(lastStateDoc(calls).includes('.kiln/validate-report.md'), 'STATE carries the route')
})

test('runtime (B1): an injection pointer from a stage is dropped before the courier — no live shell, no forged STATE', async () => {
  // An untrusted stage-declared pointer bearing shell metacharacters (here, an attempt to
  // forge a STATE.md line) is filtered against the safe-path grammar before the courier
  // command is built, and every surviving word is single-quoted. Nothing it carries can
  // reach a live shell (Sol reproduced the pre-repair injection at exit 0).
  const evil = '.kiln/x.md; echo INJECTED > .kiln/STATE.md'
  const { ret, calls } = await runKernel({ stage: 'validate', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'stage:validate': { facts: { status: 'ok', pointers: [evil, '.kiln/validate-report.md'], schema_valid: true }, narration_beat: 'validating' },
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok')
  const cmd = lastStateDoc(calls)
  assert.ok(!cmd.includes('INJECTED') && !cmd.includes(';'), 'the injection pointer never reaches the courier command')
  assert.ok(cmd.includes("'.kiln/validate-report.md'"), 'the safe pointer survives, single-quoted')
  assert.ok(!stateArgs(calls).pointers.includes(evil), 'the malformed pointer is not in the STATE pointers')
})

test('runtime: a blocked gate stops with the finding ids as closed facts', async () => {
  const { ret } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 11 },
    'findings:fetch': { exit: 0, ids: ['F1', 'F3'] },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'blocked')
  assert.deepEqual(ret.pointers.finding_ids, ['F1', 'F3'], 'the ruling arrives with its finding ids')
  assert.equal(ret.pointers.gate, '.kiln/gate-review.json')
  assert.ok(ret.beat.includes('Findings F1, F3'), 'the sealed blocked template arrives filled')
})

test('runtime (W-03 residue): an all-sealed build relaunch still speaks', async () => {
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['s1', 's2'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'seal:set': { exit: 0, ids: ['s1', 's2'] },
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok')
  assert.ok(ret.beat.includes('the ledger holds the next step'), 'the sealed resume template arrives')
  assert.equal(calls.filter(c => c.label && c.label.startsWith('slice:')).length, 0, 'no slice work re-runs')
})

test('runtime (C5): dotted / kebab / near twins are NOT falsely sealed — only the exact ledger id skips, the twins build', async () => {
  // The C5 regression, end to end: three near-twin slice ids in one plan. The old `^<id> `
  // grep let a.b false-match a-b and axb (the dot matched any char), skipping them forever.
  // The exact-membership SEALS set skips ONLY the id that is literally on the ledger.
  const twins = (sealedId) => ({
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|a.b|ui', 'obj|a-b|ui', 'obj|axb|ui'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'seal:set': { exit: 0, ids: [sealedId] },
    'slice:a.b': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging a.b' },
    'slice:a-b': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging a-b' },
    'slice:axb': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging axb' },
    'law:pre-seal': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
  })
  // a.b is the ledger id — the dot is not a wildcard, so a-b and axb are distinct and MUST build.
  const dot = await runKernel({ stage: 'build', projectDir: '/p' }, twins('a.b'))
  assert.equal(dot.ret.status, 'ok')
  assert.equal(dot.calls.filter(c => c.label === 'slice:a.b').length, 0, 'the exact sealed id a.b is skipped')
  assert.ok(dot.calls.some(c => c.label === 'slice:a-b'), 'the kebab twin a-b BUILDS — never masked by a.b')
  assert.ok(dot.calls.some(c => c.label === 'slice:axb'), 'the near twin axb BUILDS — never masked by a.b')
  // Mirror: seal the kebab id — only a-b skips; a.b and axb build.
  const kebab = await runKernel({ stage: 'build', projectDir: '/p' }, twins('a-b'))
  assert.equal(kebab.ret.status, 'ok')
  assert.equal(kebab.calls.filter(c => c.label === 'slice:a-b').length, 0, 'the exact sealed id a-b is skipped')
  assert.ok(kebab.calls.some(c => c.label === 'slice:a.b'), 'a.b builds when only a-b is sealed')
  assert.ok(kebab.calls.some(c => c.label === 'slice:axb'), 'axb builds when only a-b is sealed')
})

test('runtime (C5): an UNREADABLE seal ledger HOLDS fail-closed — no slice builds or seals over an untrusted membership set', async () => {
  // The one deliberate behavior addition: a genuine read fault on the ledger (courier death here)
  // makes every membership and reopen-ownership decision unreliable, so the run holds rather than
  // rebuild sealed work or miss a reopen — the audit-path philosophy applied to seals.
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'seal:set': { exit: 20 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'transport-failure', 'an unreadable ledger holds — the membership set cannot be trusted')
  assert.ok(ret.beat.includes('The stage worker returned no usable result'), 'the transport-failure hold beat (entry 1) arrives')
  assert.equal(calls.filter(c => c.label && c.label.startsWith('slice:')).length, 0, 'no slice builds over an untrusted ledger')
  assert.equal(calls.filter(c => c.label === 'seal:append').length, 0, 'no seal appends over an untrusted ledger')
})

test('runtime (W2-S6): the boot ledger reconcile precedes the seal read in source, and a reconcile fault HOLDS before any membership read', async () => {
  // Source wiring: the reconcile leg is seated BEFORE the seal-ledger read, so sealMembers and the
  // audit grep always run over a current-valid projection (a crash-lagged or W1 legacy .log is
  // healed first).
  assert.ok(src.indexOf("'ledger:reconcile'") < src.indexOf("'seal:set'"), 'reconcile is wired before the seal read')
  // Runtime: a reconcile fault is untrusted membership — the run holds fail-closed and never reads
  // the seal ledger or builds a slice over a projection it could not heal.
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'ledger:reconcile': { exit: 20 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'transport-failure', 'a reconcile fault holds the run')
  assert.ok(ret.beat.includes('The stage worker returned no usable result'), 'the transport-failure hold beat arrives')
  assert.equal(calls.filter(c => c.label === 'seal:set').length, 0, 'no membership read over an unreconciled ledger')
  assert.equal(calls.filter(c => c.label && c.label.startsWith('slice:')).length, 0, 'no slice work over an unreconciled ledger')
})

test('runtime (W2-S7a, B-PROVISIONAL-LIVE): a this-pass provisional seal is NOT counted in membership — a stage-end red owned by it does not reopen, since provisional-never-counts', async () => {
  // W2-S7a: the S7a seal is provisional while its Claude builder legs are unresolved, and SEALS now
  // reflects RENDERED membership only — the unconditional SEALS.add is gone. Here NOTHING is sealed
  // on disk at launch (seal:set ids []); both slices build and append PROVISIONAL seals this
  // invocation, then the stage-end LAW check regresses on s1. Pre-fix the live SEALS.add made
  // firstSealed(['s1']) find s1 and reopen; post-fix s1 is not in the membership set, so the reopen
  // never fires — the this-run seal becomes a member only on the next boot, after capture promotes
  // it, and the regression is caught then. (Discriminating pin: reopens pre-fix, does not post-fix.)
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui', 'obj|s2|ui'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'seal:set': { exit: 0, ids: [] },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging s1' },
    'slice:s2': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging s2' },
    'law:pre-seal': GREEN,
    // both slices seal green through the loop; the stage-end check then regresses on s1.
    'law:stage-end': { exit: 1, ids: ['s1'] },
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(calls.filter(c => c.label === 'seal:append').length, 2, 'both slices appended their provisional seals this pass')
  assert.notEqual(ret.status, 'law-red', 'the provisional s1 is not a member, so the stage-end red does not reopen it — firstSealed never sees a this-run provisional seal')
  assert.ok(!ret.beat.includes('reopened'), 'no reopen beat — the provisional seal grants no membership before the conductor capture')
})

test('runtime (K-10): no beat leaves the kernel with an unfilled slot', async () => {
  const gateExits = [10, 0]
  const { ret } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: '{streak}. Slice `{slice}` takes the anvil — {s}/{t}, iteration {i}.' },
    'law:pre-seal': GREEN,
    'law:pre-recheck': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': () => ({ exit: gateExits.shift() }),
    'gate:recheck': () => ({ exit: gateExits.shift() }),
    'findings:fetch': { exit: 0, ids: ['F1', 'F2'] },
    'repair:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'The reviewer blocks the gate — {count} findings ({ids}), pass {passes}. Back to the forge.' },
    'delta:check': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok')
  assert.ok(ret.beat.includes('first-blood. Slice `s1` takes the anvil'), 'streak and slice filled')
  assert.ok(ret.beat.includes('2 findings (F1, F2), pass 1'), 'count, ids, passes filled')
  assert.ok(ret.beat.includes('Slice s1 sealed — dual. The evidence holds.'), 'seal line filled from the sealed template')
  assert.ok(!/\{[A-Za-z_]+\}/.test(ret.beat), 'no unfilled slot of any kind reaches the driver')
})

test('runtime (W6-F/S3): the build-gate reviewLoop honors the dial-keyed cap over a STRICTLY-shrinking cohort — recovery_cap 2 allows two slice repairs, 1 one, both then held at the cap; one dial read per invocation', async () => {
  const build = (recoveryCap) => {
    // W6-S3: to spend a cap use each round the recheck cohort must strictly shrink; a non-shrinking
    // cohort holds on the first recheck. findings:fetch serves the cohort read (once per reject), the
    // repair-beat read (once per repair), and the blocked-beat read (once at the terminal held), so
    // the sequence pairs each round cohort with the read that follows it — the cohort reads (indices
    // 0,2,4) walk {F1,F2,F3} → {F1,F2} → {F1}. cap 2 walks all three; cap 1 holds after the first shrink.
    const findings = [['F1', 'F2', 'F3'], ['F1', 'F2', 'F3'], ['F1', 'F2'], ['F1', 'F2'], ['F1'], ['F1']]
    return {
      ...VOICE,
      'law:preflight': GREEN,
      'slices:fetch': { exit: 0, ids: ['obj|s1|ui'] },
      'ladder:fetch': LADDER,
      'cap:read': { exit: 0, recovery_cap: recoveryCap },
      'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
      'law:pre-seal': GREEN,
      'law:pre-recheck': GREEN,
      'degraded:check': { exit: 1 },
      'gate:review': { exit: 10 },
      'gate:recheck': { exit: 10 },
      'findings:fetch': () => ({ exit: 0, ids: findings.shift() }),
      'repair:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'repairing' },
      'delta:check': { exit: 0 },
      'state:write': GREEN,
    }
  }
  for (const [recoveryCap, repairs, gates] of [[2, 2, 3], [1, 1, 2]]) {
    const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, build(recoveryCap))
    assert.equal(ret.status, 'blocked', 'recovery_cap ' + recoveryCap + ': a non-converging gate blocks at the cap')
    assert.equal(calls.filter(c => c.label === 'repair:s1').length, repairs, 'recovery_cap ' + recoveryCap + ': exactly cap regenerate-slice traversals')
    const gateRounds = calls.filter(c => c.label === 'gate:review' || c.label === 'gate:recheck').length
    assert.equal(gateRounds, gates, 'recovery_cap ' + recoveryCap + ': review plus cap rechecks, never one more')
    assert.equal(calls.filter(c => c.label === 'cap:read').length, 1, 'recovery_cap ' + recoveryCap + ': one dial read per build invocation, reused for the slice gate')
    assert.ok(calls.find(c => c.label === 'cap:read').prompt.includes('gauge-dial.mjs'), 'the cap is read from the gauge-dial projector')
  }
})

test('runtime (W6-07): the ui build gate takes the cwd-relative repo `.` — a whitespace project path never splits the gate argv', async () => {
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/tmp/a project dir' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'a whitespace project path reaches the accept path — the fixed-arity gate never splits into extra argv')
  const cmd = calls.find(c => c.label === 'gate:review').prompt.split('\n').pop() // the command line, after the "Run … in <projectDir>" cwd preamble
  assert.equal(cmd, gateCmd('review', { plugin: PLUGIN, repo: '.', kilnDir: '.kiln', slice: 's1', model: 'gpt-5.6-sol', alias: 'gpt-sol', effort: 'high', request: '.kiln/review-request.json', gate: '.kiln/gate-review.json' }),
    'the review command equals exactly the fixed-arity gate — repo `.`, the cwd-relative kiln dir, the slice, the reviewer-gate model and effort, and the whitespace-safe request/gate paths; any extra argv a bare project path would add breaks equality')
  assert.ok(!cmd.includes('/tmp/a project dir'), 'the project path never reaches the review command as a bare argv token')
})

// ── Tiering seam: the pure resolvers, fail-closed boot, and surface routing ──

// A full valid config (all consumer roles + all routes), cloned so each negative
// mutates exactly one thing. exit is dropped — validateTiers ignores it.
const cfg = () => { const c = JSON.parse(JSON.stringify(TIERS_OK)); delete c.exit; return c }

test('tiers: validateTiers requires the full consumer role set, all three routes, and resolvable gpt aliases', () => {
  assert.equal(validateTiers(cfg()), true)
  assert.equal(validateTiers(null), false)
  const d = cfg(); d.doctrine = undefined; assert.equal(validateTiers(d), false, 'doctrine presence required')
  const e = cfg(); e.roles['kernel-leg'].effort = 'ultra'; assert.equal(validateTiers(e), false, 'ultra rejected by name')
  const f = cfg(); f.roles['builder-ui'].family = 'grok'; assert.equal(validateTiers(f), false, 'family must be claude|gpt')
  const a = cfg(); a.roles['stage-card'].alias = ''; assert.equal(validateTiers(a), false, 'alias must be a nonempty string')
  const mk = cfg(); delete mk.roles['kernel-leg']; assert.equal(validateTiers(mk), false, 'a missing consumer role halts at boot')
  const ms = cfg(); delete ms.roles['stage-card']; assert.equal(validateTiers(ms), false, 'missing stage-card halts at boot')
  const ml = cfg(); delete ml.roles['stage-law']; assert.equal(validateTiers(ml), false, 'missing stage-law halts at boot (INTAKE-19)')
  const mf = cfg(); delete mf.roles['fallback-reviewer']; assert.equal(validateTiers(mf), false, 'missing fallback-reviewer halts at boot — the degraded logic/mixed gate consumes it, so a lacking file must fail closed, never throw mid-run')
  const mrr = cfg(); delete mrr.roles['ratify-reviewer']; assert.equal(validateTiers(mrr), false, 'missing ratify-reviewer halts at boot (Wave 1) — the law-stage ratify gate consumes it, so a tiers.json lacking it fails closed, never throws mid-run')
  const mr = cfg(); delete mr.surface_routing.mixed; assert.equal(validateTiers(mr), false, 'all three routes required')
  const dr = cfg(); dr.surface_routing.ui = 'ghost'; assert.equal(validateTiers(dr), false, 'route targets must be real role keys')
  const gr = cfg(); delete gr.resolver['gpt-sol']; assert.equal(validateTiers(gr), false, 'a gpt alias with no resolver mapping halts at boot')
  const gi = cfg(); gi.roles['reviewer-gate'].alias = 'inherit'; assert.equal(validateTiers(gi), false, 'a gpt role needs a concrete resolvable alias, not inherit')
  // The 48e5fed builder-leg defect shape: a surface routed to a gpt-family role.
  // The agent() spawner is Anthropic-only, so this must halt at boot, never 404 mid-build.
  // Since simple-fire the shipped builder-logic seat is claude (the codex call rides
  // bash inside the card), so the defect shape is recreated by flipping the family back.
  const gp = cfg(); gp.roles['builder-logic'] = { family: 'gpt', alias: 'gpt-sol', effort: 'high' }
  assert.equal(validateTiers(gp), false, 'a gpt-family surface-route target has no agent transport — rejected at boot')
})

test('tiers: resolveTier is family-aware — claude passes through, gpt resolves, resolver never rewrites claude', () => {
  // W2-S7a (B-D1): resolveTier now retains the alias beside the resolved value — the durable tiers
  // fact the identity ledger records. inherit carries the alias but no concrete model key.
  assert.deepEqual(resolveTier(TIERS_OK, 'kernel-leg'), { effort: 'high', alias: 'inherit' }, 'inherit omits the model key but keeps the alias')
  assert.deepEqual(resolveTier(TIERS_OK, 'stage-card'), { effort: 'high', alias: 'inherit' })
  assert.deepEqual(resolveTier(TIERS_OK, 'stage-law'), { effort: 'high', alias: 'fable', model: 'fable' }, 'the thinking seat carries the fable alias (INTAKE-19)')
  assert.deepEqual(resolveTier(TIERS_OK, 'builder-ui'), { effort: 'high', alias: 'opus', model: 'opus' }, 'a claude alias passes through unresolved — opus implements ui from the locked plan')
  assert.deepEqual(resolveTier(TIERS_OK, 'reviewer-gate'), { effort: 'high', alias: 'gpt-sol', model: 'gpt-5.6-sol' }, 'a gpt alias resolves to the concrete id while the alias is retained')
  assert.deepEqual(resolveTier(TIERS_OK, 'builder-logic'), { effort: 'high', alias: 'sonnet', model: 'sonnet' }, 'the logic seat is the claude context-builder — HIGH wrapper effort (INTAKE-14b/Q1); its coder rides a bash call, never this option')
  assert.deepEqual(resolveTier(TIERS_OK, 'fallback-reviewer'), { effort: 'high', alias: 'opus', model: 'opus' }, 'the codex-absent fallback reviewer resolves to opus — a model different from the sonnet builder (duo-pool.json:7 logic_fallback)')
  assert.deepEqual(resolveTier(TIERS_OK, 'ratify-reviewer'), { effort: 'high', alias: 'gpt-sol', model: 'gpt-5.6-sol' }, 'the LAW-ratify reviewer resolves to the concrete codex id — opposite-family to the claude/fable stage-law producer (Wave 1)')
  assert.deepEqual(resolveTier(TIERS_OK, 'haiku-migration'), { effort: 'high', alias: 'sonnet', model: 'sonnet' }, 'raised to the HIGH floor (Wave 3)')
  const c = cfg(); c.resolver['fable'] = 'sneaky-rewrite'
  assert.deepEqual(resolveTier(c, 'stage-law'), { effort: 'high', alias: 'fable', model: 'fable' }, 'a resolver entry cannot rewrite a claude alias')
})

test('tiers: routeBuilder maps each validated surface to its builder opts', () => {
  assert.deepEqual(routeBuilder(TIERS_OK, 'ui'), { effort: 'high', alias: 'opus', model: 'opus' })
  assert.deepEqual(routeBuilder(TIERS_OK, 'logic'), { effort: 'high', alias: 'sonnet', model: 'sonnet' }, 'logic routes to the claude context-builder seat — HIGH wrapper effort; GPT codes through its bash call')
  assert.deepEqual(routeBuilder(TIERS_OK, 'mixed'), { effort: 'high', alias: 'sonnet', model: 'sonnet' }, 'mixed routes to builder-logic too — GPT codes everything but ui (the operator law)')
  // Builder-leg 404 pin (48e5fed): routeBuilder feeds agent() directly, and the
  // agent spawner is Anthropic-only — no routed surface may ever emit the
  // resolver-concrete codex id as the agent model option.
  for (const s of ['ui', 'logic', 'mixed']) {
    assert.notEqual(routeBuilder(TIERS_OK, s).model, 'gpt-5.6-sol', s + ': the concrete codex id must never reach an agent() dispatch')
  }
})

test('tiers: parseSliceEntry validates the object form; only legacy bare strings default to mixed', () => {
  assert.deepEqual(parseSliceEntry('obj|hello-page|ui'), { id: 'hello-page', surface: 'ui', milestone: '', valid: true })
  assert.deepEqual(parseSliceEntry('obj|logic-core|logic'), { id: 'logic-core', surface: 'logic', milestone: '', valid: true })
  assert.deepEqual(parseSliceEntry('obj|m|mixed'), { id: 'm', surface: 'mixed', milestone: '', valid: true })
  assert.equal(parseSliceEntry('obj|s1|bogus').valid, false, 'an unknown object surface is invalid — never silently mixed')
  assert.equal(parseSliceEntry('obj|s1|').valid, false, 'a missing object surface is invalid')
  assert.equal(parseSliceEntry('obj||ui').valid, false, 'a missing object id is invalid')
  assert.deepEqual(parseSliceEntry('bare-legacy'), { id: 'bare-legacy', surface: 'mixed', milestone: '', valid: true }, 'a legacy bare string defaults to mixed')
  assert.equal(parseSliceEntry('').valid, false, 'an empty descriptor is invalid')
})

test('W7-S1: parseSliceEntry pins the ONE slice-id charset shared with append-audit — slash ids pass, whitespace, control and shell-active bytes halt at intake', () => {
  // The id rides an unquoted shell word at seal:append, the grep anchors over
  // seals.log/audits.log, and the audit argv — kernel-valid must equal publishable.
  assert.deepEqual(parseSliceEntry('obj|feature/ui|ui'), { id: 'feature/ui', surface: 'ui', milestone: '', valid: true }, 'a path-like slash id is inside the shared charset')
  assert.deepEqual(parseSliceEntry('feature/ui'), { id: 'feature/ui', surface: 'mixed', milestone: '', valid: true }, 'a legacy slash id stays valid')
  assert.equal(parseSliceEntry('obj|has space|ui').valid, false, 'whitespace in an id would split the unquoted seal append — rejected at intake')
  assert.equal(parseSliceEntry('has space').valid, false, 'a legacy bare id is charset-gated the same way')
  assert.equal(parseSliceEntry('obj|bad;id|ui').valid, false, 'a shell-active byte in an id never reaches an interpolation')
  assert.equal(parseSliceEntry('obj|bad\nid|ui').valid, false, 'a control byte in an id could forge or split a log line — rejected')
})

test('core (C5): sealMembers is EXACT first-field membership — dotted/kebab/near twins are distinct, never a regex match', () => {
  // The seal ledger line is `<id> <label>`; the id carries no whitespace, so the first
  // space-delimited field is the whole id. The old `^<id> ` grep let `a-b` or `axb`
  // false-match `a.b` (the dot matched any char) — this Set is the C5 regression guard.
  const s = sealMembers(['a.b dual'])
  assert.ok(s.has('a.b'), 'the exact dotted id is a member')
  assert.ok(!s.has('a-b'), 'the kebab twin is NOT a member — the dot is not a wildcard here')
  assert.ok(!s.has('axb'), 'a near twin is NOT a member')
  assert.ok(!s.has('a'), 'a prefix is NOT a member')
  assert.ok(!s.has('a.b '), 'the id with a trailing space is NOT a member — the label field is stripped')
  assert.ok(!s.has('a.b dual'), 'the whole raw line is NOT a member — only the first field')
  // Edge cases: empty / null input, blank and whitespace-only lines, extra trailing fields.
  assert.deepEqual([...sealMembers([])], [], 'empty input yields the empty set')
  assert.deepEqual([...sealMembers(null)], [], 'a null line list is the empty set, never a throw')
  assert.deepEqual([...sealMembers(['', '   ', 'a.b dual'])], ['a.b'], 'blank and whitespace-only lines are filtered')
  assert.deepEqual([...sealMembers(['s1 dual extra tail'])], ['s1'], 'only the first space-delimited field is kept')
  const multi = sealMembers(['a.b dual', 'a-b logic', 'axb ui'])
  assert.ok(multi.has('a.b') && multi.has('a-b') && multi.has('axb'), 'each twin is its own distinct member')
  assert.equal(multi.size, 3, 'three distinct ids, no collisions')
})

test('S1 (A9/W5-07): parseSliceEntry parses the optional four-slot milestone label — legacy forms stay valid, a smuggled separator or control char is rejected', () => {
  // 4-slot object: the trailing label is carried.
  assert.deepEqual(parseSliceEntry('obj|scaffold|logic|foundation'),
    { id: 'scaffold', surface: 'logic', milestone: 'foundation', valid: true }, 'the fourth slot is the milestone label')
  assert.deepEqual(parseSliceEntry('obj|home|ui|the shipping table'),
    { id: 'home', surface: 'ui', milestone: 'the shipping table', valid: true }, 'a label may carry spaces')
  // Legacy 3-slot object and bare string: an absent label normalizes to ''.
  assert.deepEqual(parseSliceEntry('obj|s1|ui'),
    { id: 's1', surface: 'ui', milestone: '', valid: true }, 'a legacy 3-slot object reads an absent label as ""')
  assert.equal(parseSliceEntry('bare').milestone, '', 'a legacy bare string carries an absent label')
  // Separator safety: a raw '|' in the label splits into a fifth slot — rejected, never guessed.
  assert.equal(parseSliceEntry('obj|s1|ui|a|b').valid, false, 'a | in the label smuggles the descriptor separator — rejected')
  // Control-char safety: a label cannot smuggle a char that breaks the descriptor transport.
  assert.equal(parseSliceEntry('obj|s1|ui|bad').valid, false, 'a control char in the label is rejected')
  assert.equal(parseSliceEntry('obj|s1|ui|bad\nlabel').valid, false, 'a newline in the label is rejected')
  // An empty fourth slot is a present-but-unlabeled slice — valid, milestone ''.
  assert.deepEqual(parseSliceEntry('obj|s1|ui|'),
    { id: 's1', surface: 'ui', milestone: '', valid: true }, 'an empty trailing slot is an unlabeled slice')
  // W5-S1-01: the label is trimmed to the SAME bytes MILESTONE_PROJECTION_CHECK compares, so a
  // padded cell that passes projection agreement cannot fabricate a spurious seam downstream.
  assert.deepEqual(parseSliceEntry('obj|s1|ui| alpha '),
    { id: 's1', surface: 'ui', milestone: 'alpha', valid: true }, 'a padded label is normalized to its trimmed bytes')
  // W5-S1-03: the control-free invariant covers C1 (U+0080–U+009F), which survives a whitespace trim.
  assert.equal(parseSliceEntry('obj|s1|ui|bad' + String.fromCharCode(0x9f)).valid, false, 'a C1 control char (U+009F) in the label is rejected')
  assert.equal(parseSliceEntry('obj|s1|ui|bad' + String.fromCharCode(0x80)).valid, false, 'a C1 control char (U+0080) in the label is rejected')
})

test('S1 (A9/W5-07): milestoneSeamAfter is the pure seam closed fact — final slice or a label change, never mid-run', () => {
  // Seam after the FINAL slice, always — the last milestone completes at the end.
  assert.equal(milestoneSeamAfter(['a', 'a'], 1), true, 'the final slice always closes a seam')
  assert.equal(milestoneSeamAfter(['solo'], 0), true, 'a single-slice run seams at its one slice')
  // Seam on an ADJACENT label change.
  assert.equal(milestoneSeamAfter(['a', 'b'], 0), true, 'a label change places the seam after the completing milestone')
  // NO seam mid-run of the same label.
  assert.equal(milestoneSeamAfter(['a', 'a', 'a'], 1), false, 'no seam inside a run of one label')
  // NO spurious seam after the first slice when the next slice shares the label.
  assert.equal(milestoneSeamAfter(['a', 'a'], 0), false, 'no seam after the first slice of a continuing milestone')
  // An unlabeled run ('' everywhere) is one whole-build seam at the final slice (A9 implicit final).
  assert.equal(milestoneSeamAfter(['', '', ''], 0), false, 'unlabeled: no early seam')
  assert.equal(milestoneSeamAfter(['', '', ''], 1), false, 'unlabeled: no mid seam')
  assert.equal(milestoneSeamAfter(['', '', ''], 2), true, 'unlabeled: the single whole-build seam is the final slice')
  // Out-of-range / non-array indices never fabricate a seam.
  assert.equal(milestoneSeamAfter(['a'], 5), false, 'an out-of-range index is no seam')
  assert.equal(milestoneSeamAfter(['a'], -1), false, 'a negative index is no seam')
  assert.equal(milestoneSeamAfter([], 0), false, 'an empty label list is no seam')
  assert.equal(milestoneSeamAfter(undefined, 0), false, 'a non-array is no seam')
})

test('S1 (A9/W5-03): MILESTONE_PROJECTION_CHECK is the deterministic agreement leg — matching table/projection pass, any divergence or missing table fails', () => {
  const run = (law, slices) => {
    const dir = mkdtempSync(join(tmpdir(), 'kiln-proj-'))
    mkdirSync(join(dir, '.kiln'))
    writeFileSync(join(dir, '.kiln', 'LAW.md'), law)
    writeFileSync(join(dir, '.kiln', 'slices.json'), JSON.stringify(slices))
    return spawnSync('bash', ['-c', MILESTONE_PROJECTION_CHECK], { cwd: dir }).status
  }
  const PLAN = '# LAW\nfoo · scaffold · runs\n\n## Plan\n| slice | milestone |\n| --- | --- |\n| scaffold | foundation |\n| render | foundation |\n| ship |  |\n'
  const MATCH = [{ id: 'scaffold', surface: 'mixed', milestone: 'foundation' }, { id: 'render', surface: 'ui', milestone: 'foundation' }, { id: 'ship', surface: 'logic' }]
  assert.equal(run(PLAN, MATCH), 0, 'the projection agrees with the authoritative table — proceed')
  // A label divergence halts.
  const badLabel = [{ id: 'scaffold', surface: 'mixed', milestone: 'foundation' }, { id: 'render', surface: 'ui', milestone: 'delivery' }, { id: 'ship', surface: 'logic' }]
  assert.equal(run(PLAN, badLabel), 1, 'a projected label that differs from the table halts')
  // An order/id divergence halts.
  const badOrder = [{ id: 'render', surface: 'ui', milestone: 'foundation' }, { id: 'scaffold', surface: 'mixed', milestone: 'foundation' }, { id: 'ship', surface: 'logic' }]
  assert.equal(run(PLAN, badOrder), 1, 'a projection out of table order halts')
  // A missing authoritative table halts — the projection has nothing to agree with.
  assert.equal(run('# LAW\nno plan table here\n', MATCH), 1, 'a missing plan table halts — the labels have no authority')
  // An all-unlabeled run agrees when both carry empty labels in order.
  const UNLABELED = '## Plan\n| slice | milestone |\n| --- | --- |\n| a |  |\n| b |  |\n'
  assert.equal(run(UNLABELED, [{ id: 'a', surface: 'ui' }, { id: 'b', surface: 'logic', milestone: '' }]), 0, 'an unlabeled table and projection agree')
  // W5-S1-02: the parser is anchored to `## Plan` — an otherwise-matching table with no `## Plan`
  // heading carries no authority and halts.
  const NO_HEADING = '# LAW\n| slice | milestone |\n| --- | --- |\n| a | x |\n'
  assert.equal(run(NO_HEADING, [{ id: 'a', surface: 'ui', milestone: 'x' }]), 1, 'a table not under `## Plan` has no authority — halt')
  // W5-S1-02: a missing GFM delimiter row halts — its first data row is not silently discarded.
  const NO_DELIM = '## Plan\n| slice | milestone |\n| a | x |\n'
  assert.equal(run(NO_DELIM, [{ id: 'a', surface: 'ui', milestone: 'x' }]), 1, 'a missing delimiter row is malformed — halt')
  // W5-S1-02: an extra data cell is malformed — the parser reads exactly two, never the first two.
  const EXTRA_CELL = '## Plan\n| slice | milestone |\n| --- | --- |\n| a | x | injected |\n'
  assert.equal(run(EXTRA_CELL, [{ id: 'a', surface: 'ui', milestone: 'x' }]), 1, 'a row with a third cell is malformed — halt, never truncated to two')
  // W5-S1-02: `##Plan` has no space after the hashes — not a GFM ATX heading, so it is prose and carries no authority.
  const TIGHT_HASH = '##Plan\n| slice | milestone |\n| --- | --- |\n| a | x |\n'
  assert.equal(run(TIGHT_HASH, [{ id: 'a', surface: 'ui', milestone: 'x' }]), 1, '`##Plan` is prose not a heading — the anchor requires `## Plan`, halt')
  // W5-S1-02: an empty `## Plan` section does not bleed into a later `## Other` table — the section boundary holds.
  const SECTION_BLEED = '## Plan\n\n## Other\n| slice | milestone |\n| --- | --- |\n| a | x |\n'
  assert.equal(run(SECTION_BLEED, [{ id: 'a', surface: 'ui', milestone: 'x' }]), 1, 'a table under a later heading is outside the Plan section — halt')
  // W5-S1-02: a GFM delimiter needs at least three hyphens per cell — one- or two-hyphen rows are malformed.
  const THIN_DELIM_1 = '## Plan\n| slice | milestone |\n| - | - |\n| a | x |\n'
  assert.equal(run(THIN_DELIM_1, [{ id: 'a', surface: 'ui', milestone: 'x' }]), 1, 'a single-hyphen delimiter is malformed — halt')
  const THIN_DELIM_2 = '## Plan\n| slice | milestone |\n| -- | -- |\n| a | x |\n'
  assert.equal(run(THIN_DELIM_2, [{ id: 'a', surface: 'ui', milestone: 'x' }]), 1, 'a two-hyphen delimiter is malformed — halt')
})

test('S1 (W8-B): PERCEPTUAL_TABLE_CHECK is the deterministic perceptual gate — validity, coverage, and consistency, or the honest disagree', () => {
  const run = (law, slices, files = {}, links = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'kiln-perc-'))
    mkdirSync(join(dir, '.kiln'))
    writeFileSync(join(dir, '.kiln', 'LAW.md'), law)
    writeFileSync(join(dir, '.kiln', 'slices.json'), JSON.stringify(slices))
    for (const [p, body] of Object.entries(files)) writeFileSync(join(dir, p), body)
    for (const [p, target] of Object.entries(links)) symlinkSync(target, join(dir, p))
    return spawnSync('bash', ['-c', PERCEPTUAL_TABLE_CHECK], { cwd: dir }).status
  }
  const HEAD = '# LAW\ncrit-1 · home · behaviour · cmd · outcome\n\n## Perceptual\n' +
    '| criterion id | owning slice | dim | requirement | proxy command | expected | reference |\n' +
    '| --- | --- | --- | --- | --- | --- | --- |\n'
  const row = (id, owner, dim, req = 'the hero panel reads first', cmd = 'test -f index.html', exp = 'exit 0', ref = '') =>
    `| ${id} | ${owner} | ${dim} | ${req} | ${cmd} | ${exp} | ${ref} |\n`
  const UI = [{ id: 'home', surface: 'ui', milestone: '' }, { id: 'api', surface: 'logic', milestone: '' }]
  const LOGIC = [{ id: 'api', surface: 'logic', milestone: '' }]
  const BARE = '# LAW\ncrit-1 · api · behaviour · cmd · outcome\n'
  const four = HEAD + row('p1', 'home', 'composition-hierarchy') + row('p2', 'home', 'typography') +
    row('p3', 'home', 'color-contrast') + row('p4', 'home', 'fidelity-to-requirement')
  // Absent table, no ui/mixed surface — the dormant run agrees.
  assert.equal(run(BARE, LOGIC), 0, 'absent table with no ui/mixed surfaces agrees — dormant')
  // CONSISTENCY: a ui surface with no table never seals.
  assert.equal(run(BARE, UI), 1, 'a ui slice REQUIRES the perceptual table — absent is a disagree')
  // A well-formed table over its ui owner agrees.
  assert.equal(run(four, UI), 0, 'a valid four-dim table covering the ui slice agrees')
  // COVERAGE: a ui/mixed slice owning no row halts.
  const MIXED = [...UI, { id: 'shell', surface: 'mixed', milestone: '' }]
  assert.equal(run(four, MIXED), 1, 'a mixed slice owning no perceptual row is uncovered — halt')
  // Required cells nonempty after trim.
  assert.equal(run(four + row('', 'home', 'motion-continuity'), UI), 1, 'a blank criterion id halts')
  assert.equal(run(four + row('p5', 'home', 'motion-continuity', ' '), UI), 1, 'a blank requirement halts')
  assert.equal(run(four + row('p5', 'home', 'motion-continuity', 'motion settles', 'test -f index.html', ''), UI), 1, 'a blank expected halts')
  // W8-S1-04: c[4] has no other guard (a blank owner or dim also fails membership), so this
  // negative alone pins the nonempty enforcement on the proxy command.
  assert.equal(run(four + row('p5', 'home', 'motion-continuity', 'motion settles', ' '), UI), 1, 'a blank proxy command halts')
  // Unique criterion ids.
  assert.equal(run(four + row('p1', 'home', 'motion-continuity'), UI), 1, 'a duplicate criterion id halts')
  // Owner membership.
  assert.equal(run(four + row('p5', 'ghost', 'motion-continuity'), UI), 1, 'an owner outside slices.json halts')
  // Dim membership against the shipped rubric ids.
  assert.equal(run(four + row('p5', 'home', 'vibes'), UI), 1, 'a dim outside the shipped rubric halts')
  // DISTINCT dims 4-6: three is too few, seven is too many (a seventh is necessarily unknown).
  const three = HEAD + row('p1', 'home', 'composition-hierarchy') + row('p2', 'home', 'typography') + row('p3', 'home', 'color-contrast')
  assert.equal(run(three, UI), 1, 'three distinct dims are too few — halt')
  const seven = four + row('p5', 'home', 'interaction-feedback') + row('p6', 'home', 'motion-continuity') + row('p7', 'home', 'a-seventh-dim')
  assert.equal(run(seven, UI), 1, 'seven distinct dims are too many — halt')
  // Reference: named but missing halts; named and existing rides.
  const withRef = four + row('p5', 'home', 'motion-continuity', 'the fold settles without reflow', 'grep -q settled film.log', 'exit 0', 'mock.png')
  assert.equal(run(withRef, UI), 1, 'a named reference that does not exist halts — test -e class')
  assert.equal(run(withRef, UI, { 'mock.png': 'bytes' }), 0,
    'the full table — spaced requirement and command cells, an existing reference — agrees')
  // W8-S1-01: cells split on UNESCAPED `|` only — a lawful proxy command carries its pipe as
  // GFM `\|`, stays a seven-cell row, and unescapes to the real operator; a raw pipe still
  // splits the row into eight cells and halts (the escape is the one spelling).
  const piped = four + row('p5', 'home', 'motion-continuity', 'the list holds three items', 'grep -c item list.txt \\| grep -q 3')
  assert.equal(run(piped, UI), 0, 'a GFM-escaped pipe rides inside the proxy command cell')
  const rawPipe = four + row('p5', 'home', 'motion-continuity', 'the list holds three items', 'grep -c item list.txt | grep -q 3')
  assert.equal(run(rawPipe, UI), 1, 'an unescaped pipe splits the row — malformed, halt')
  // W8-S1-03: the reference is CONTAINED in the repo — existence outside the root is no license.
  assert.equal(run(four + row('p5', 'home', 'motion-continuity', 'the fold settles', 'test -f index.html', 'exit 0', '/etc/passwd'), UI), 1,
    'an existing absolute path outside the root halts — containment, not mere existence')
  assert.equal(run(four + row('p5', 'home', 'motion-continuity', 'the fold settles', 'test -f index.html', 'exit 0', '../'.repeat(40) + 'etc/passwd'), UI), 1,
    'a parent-traversal to an existing outside file halts the same way')
  // W2-S8: the cell is LAW text a model wrote, so containment is proven PHYSICALLY too — a link
  // sitting inside the root that lands outside it is an outside path wearing an inside name, and a
  // link that lands nowhere resolves to no existing repo path at all.
  const linkRow = row('p5', 'home', 'motion-continuity', 'the fold settles', 'test -f index.html', 'exit 0', 'ref.png')
  assert.equal(run(four + linkRow, UI, {}, { 'ref.png': '/etc/passwd' }), 1,
    'a symlink inside the root pointing at an outside file halts — realpath containment, not mere existence')
  assert.equal(run(four + linkRow, UI, {}, { 'ref.png': 'nowhere.png' }), 1,
    'a dangling symlink names no existing repo path — halt')
  assert.equal(run(four + linkRow, UI, { 'real.png': 'px' }, { 'ref.png': 'real.png' }), 0,
    'a symlink to a file inside the root rides — the rule judges where the name lands, not that it is a link')
  // A declared perceptual section with no well-formed table under it fails closed.
  assert.equal(run('# LAW\n\n## Perceptual\nno table here\n', LOGIC), 1, 'a bare ## Perceptual heading with no table is malformed — halt')
})

test('S1 (W8-B/D): the check dims and the FIXED shipped instrument cannot drift — six ids, byte-equal in order', () => {
  // The const command cannot read the plugin path, so it duplicates the six rubric ids;
  // this guard pins the duplication to data/perceptual-rubric.json the way the gauge-dial
  // enum guard pins the kernel POSTURE_* copies.
  const rubric = JSON.parse(readFileSync(fileURLToPath(new URL('../data/perceptual-rubric.json', import.meta.url)), 'utf8'))
  const ids = rubric.criteria.map((c) => c.id)
  assert.deepEqual(ids,
    ['composition-hierarchy', 'typography', 'color-contrast', 'interaction-feedback', 'motion-continuity', 'fidelity-to-requirement'],
    'the shipped instrument carries exactly the six fixed dims, in order')
  const m = PERCEPTUAL_TABLE_CHECK.match(/const dims=\[([^\]]+)\]/)
  assert.ok(m, 'the check carries its dims list')
  assert.deepEqual(m[1].split(',').map((s) => s.trim().replace(/"/g, '')), ids,
    'the check dims equal the shipped rubric ids — the duplication cannot drift')
})

test('runtime (W2-S1): every launch joins the run lock BEFORE the boot, with the exact run_id + owner', async () => {
  // The tiers boot is failed so the run stops right after it; the join leg is what we pin.
  const { calls } = await runKernel({ stage: 'build', projectDir: '/p' }, { 'tiers:boot': { exit: 20 } })
  const j = calls.find(c => c.label === 'run-lock:join')
  assert.ok(j, 'the run-lock join leg dispatches')
  assert.ok(j.prompt.includes('run-lock join .kiln'), 'the join runs the kiln-review run-lock join verb over .kiln')
  assert.ok(j.prompt.includes(`'${RUN_ID}'`) && j.prompt.includes(`'${OWNER}'`), 'the exact run_id and owner ride the join, shell-quoted')
  assert.ok(!j.opts.model, 'the pre-boot join carries no tier model — no tier value exists before the boot')
  const order = calls.map(c => c.label)
  assert.ok(order.indexOf('run-lock:join') < order.indexOf('tiers:boot'), 'the join gates the run before any tiers read')
})

test('runtime (W2-S1): a foreign lock holds the run closed, naming the running owner — nothing boots', async () => {
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' },
    { 'run-lock:join': { exit: 12, ids: ['other-run'] } })
  assert.equal(ret.status, 'run-locked', 'a refused join holds the run closed')
  assert.ok(ret.beat.includes('other-run'), 'the honest hold names the run that holds the lock')
  assert.equal(ret.pointers.lock, '.kiln/run.lock', 'the hold points at the run lock')
  assert.deepEqual(calls.map(c => c.label), ['run-lock:join'], 'a foreign lock stops before the boot — no tiers read, no stage work')
})

test('runtime (W2-S1): a launch carrying no lock facts holds before any leg — the legacy-resume clear stop', async () => {
  for (const missing of [{ run_id: undefined }, { owner: undefined }]) {
    const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p', ...missing }, {})
    assert.equal(ret.status, 'run-unlocked', 'a launch with no lock is a clear stop, never a crash')
    assert.ok(ret.beat.includes('run lock'), 'the stop names the missing lock')
    assert.equal(calls.length, 0, 'the unlocked guard returns before any agent leg — not even the join runs')
  }
})

test('runtime (T-02): a nonzero tiers boot fails the run closed — no stage work runs', async () => {
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, { 'tiers:boot': { exit: 20 } })
  assert.equal(ret.status, 'tiers-config-invalid')
  assert.ok(ret.beat.includes('tier file'), 'the halt names the tier file')
  assert.deepEqual(calls.map(c => c.label), ['run-lock:join', 'tiers:boot'], 'the run-lock join precedes the boot; nothing runs after a failed boot')
})

test('runtime (T-02): a malformed tier shape fails closed AT BOOT — the boot is the only call', async () => {
  const mut = {
    'ultra effort': (c) => { c.roles['kernel-leg'].effort = 'ultra' },
    'unknown family': (c) => { c.roles['builder-ui'].family = 'grok' },
    'missing kernel-leg role': (c) => { delete c.roles['kernel-leg'] },
    'missing stage-card role': (c) => { delete c.roles['stage-card'] },
    'missing stage-law role': (c) => { delete c.roles['stage-law'] },
    'missing fallback-reviewer role': (c) => { delete c.roles['fallback-reviewer'] },
    'missing ratify-reviewer role': (c) => { delete c.roles['ratify-reviewer'] },
    'missing mixed route': (c) => { delete c.surface_routing.mixed },
    'unresolved gpt alias': (c) => { delete c.resolver['gpt-sol'] },
    'gpt-routed surface': (c) => { c.roles['builder-logic'] = { family: 'gpt', alias: 'gpt-sol', effort: 'high' } },
    'no doctrine': (c) => { c.doctrine = undefined },
  }
  for (const [name, mutate] of Object.entries(mut)) {
    const boot = JSON.parse(JSON.stringify(TIERS_OK)); mutate(boot)
    const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, { 'tiers:boot': boot })
    assert.equal(ret.status, 'tiers-config-invalid', name + ' must fail closed')
    assert.deepEqual(calls.map(c => c.label), ['run-lock:join', 'tiers:boot'], name + ': the run-lock join precedes the boot; no work after it')
  }
})

test('runtime (T-03): the builder leg is surface-routed — ui→builder-ui, logic/mixed→builder-logic, bare→mixed', async () => {
  const build = (entry) => ({
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: [entry] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 0 },
    'gate:invalidate': { exit: 0 },
    'gate-claude:review': OK_ACK,
    'gate:read': readCandidate(GATE_ACCEPT),
    'gate:publish': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
  })
  const builderOpts = (calls) => calls.find(c => c.label === 'slice:s1').opts
  const ui = await runKernel({ stage: 'build', projectDir: '/p' }, build('obj|s1|ui'))
  assert.equal(ui.ret.status, 'ok')
  assert.equal(builderOpts(ui.calls).model, 'opus', 'ui routes to builder-ui (opus — INTAKE-19 donkey work)')
  assert.equal(builderOpts(ui.calls).effort, 'high')
  const logic = await runKernel({ stage: 'build', projectDir: '/p' }, build('obj|s1|logic'))
  assert.equal(builderOpts(logic.calls).model, 'sonnet', 'logic routes to builder-logic — the claude context-builder seat')
  assert.equal(builderOpts(logic.calls).effort, 'high')
  assert.ok(logic.calls.find(c => c.label === 'slice:s1').prompt.includes('(surface logic)'), 'the build prompt carries the closed surface fact for the card')
  const mixed = await runKernel({ stage: 'build', projectDir: '/p' }, build('obj|s1|mixed'))
  assert.equal(builderOpts(mixed.calls).model, 'sonnet', 'mixed routes to builder-logic — GPT codes mixed (the operator law)')
  assert.equal(builderOpts(mixed.calls).effort, 'high')
  const bare = await runKernel({ stage: 'build', projectDir: '/p' }, build('s1'))
  assert.equal(builderOpts(bare.calls).model, 'sonnet', 'a legacy bare-string slice defaults to mixed → builder-logic')
  // Builder-leg 404 pin (48e5fed): across every dispatch of every surface run,
  // the resolver-concrete codex id never appears as an agent model option —
  // the agent spawner has no codex transport.
  for (const run of [ui, logic, mixed, bare]) {
    for (const c of run.calls) {
      assert.notEqual(c.opts && c.opts.model, 'gpt-5.6-sol', (c.label || '?') + ': the concrete codex id must never reach agent()')
    }
  }
})

test('runtime (INTAKE-19): the LAW leg spawns on stage-law (fable) — validate and report stay on stage-card', async () => {
  const stageRun = (s) => runKernel({ stage: s, projectDir: '/p' }, {
    ...VOICE,
    ...ONBOARDING_OK, // law-only gate; validate/report never consume these
    'law:preflight': GREEN,
    ['stage:' + s]: { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'working' },
    // Wave 1: the law run now ratifies before advancing (accept, sealed); the
    // validate/report runs never reach these labels (the ratify gate is law-only).
    'ratify:request': GREEN,
    'ratify:gate': { exit: 0 },
    'law:milestone-projection': { exit: 0 },
    'law:perceptual-table': { exit: 0 },
    'law:seal': { exit: 0 },
    'law:stage-end': GREEN,
    // Wave 2: the report run reaches the completion existence gate (law/validate never do).
    'report:check': { exit: 0 },
    'state:write': GREEN,
  })
  const law = await stageRun('law')
  const lawLeg = law.calls.find(c => c.label === 'stage:law')
  assert.equal(lawLeg.opts.model, 'fable', 'slice creation is a thinking seat — the law leg carries the fable alias')
  assert.equal(lawLeg.opts.effort, 'high')
  for (const s of ['validate', 'report']) {
    const run = await stageRun(s)
    const leg = run.calls.find(c => c.label === 'stage:' + s)
    assert.equal(leg.opts.model, undefined, s + ' stays on stage-card — inherit carries no model option')
    assert.equal(leg.opts.effort, 'high')
  }
})

// ── Wave 1 (the Second Key): the always-on cross-family LAW-ratify gate ──────

test('runtime (Wave 1): the LAW ratifies, seal-law locks it, and the run advances to build', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    ...ONBOARDING_OK,
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: ['.kiln/LAW.md', '.kiln/slices.json'], schema_valid: true }, narration_beat: 'the law, pinned' },
    'ratify:request': GREEN,
    'ratify:gate': { exit: 0 },
    'law:milestone-projection': { exit: 0 },
    'law:perceptual-table': { exit: 0 },
    'law:seal': { exit: 0 },
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'a ratified LAW advances')
  // The kernel writes the ratify request itself (content-blind), naming the
  // opposite-family reviewer and the repo-relative artifact.
  const req = calls.find(c => c.label === 'ratify:request')
  assert.ok(req, 'the kernel writes the ratify request')
  assert.ok(req.prompt.includes('ratify-request.json'), 'the request lands at the ratify-request path')
  assert.ok(req.prompt.includes('gpt-5.6-sol'), 'the reviewer is the opposite-family ratify-reviewer (codex id)')
  assert.ok(req.prompt.includes('law-ratify'), 'the review_id is kernel-issued')
  // W2-S8: the request names NO rubric — the instrument is the shipped one the family word selects,
  // so a request file the model wrote cannot point the grader at a rubric of its own choosing.
  assert.ok(!req.prompt.includes('rubric'), 'the request carries no rubric path at all')
  // The gate rides the kiln-review ratify verb, and the family word is what selects the instrument.
  const gate = calls.find(c => c.label === 'ratify:gate')
  assert.ok(gate && gate.prompt.includes('kiln-review ratify . '), 'the gate rides the kiln-review ratify verb with the cwd-relative repo arg')
  assert.ok(gate.prompt.trim().endsWith(' ratify'), 'the ratify family word rides argv — the shipped-rubric selector')
  // seal-law is the sealer on the kernel side, and it runs only after accept.
  const seal = calls.find(c => c.label === 'law:seal')
  assert.ok(seal && seal.prompt.includes('seal-law .kiln'), 'seal-law locks the ratified LAW on the cwd-relative kiln dir')
  assert.ok(calls.indexOf(gate) < calls.indexOf(seal), 'the seal follows the accept, never precedes it')
  assert.equal(stateArgs(calls).key, 'relaunch-build', 'next_action advances to build')
})

test('runtime (S1, A9/W5-03): the milestone projection is checked BEFORE the seal — it agrees, then the seal follows', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    ...ONBOARDING_OK,
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'the law, pinned' },
    'ratify:request': GREEN,
    'ratify:gate': { exit: 0 },
    'law:milestone-projection': { exit: 0 },
    'law:perceptual-table': { exit: 0 },
    'law:seal': { exit: 0 },
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'a ratified LAW whose projection agrees seals and advances')
  const proj = calls.find(c => c.label === 'law:milestone-projection')
  assert.ok(proj, 'the projection-agreement leg runs on the sealed branch')
  assert.ok(proj.prompt.includes('slices.json') && proj.prompt.includes('LAW.md'),
    'the leg compares slices.json against the LAW plan table')
  const gate = calls.find(c => c.label === 'ratify:gate')
  const seal = calls.find(c => c.label === 'law:seal')
  assert.ok(calls.indexOf(gate) < calls.indexOf(proj) && calls.indexOf(proj) < calls.indexOf(seal),
    'the projection is checked after the ratify accept and before the seal — a mismatched plan never locks')
})

test('runtime (S1, A9/W5-03): a milestone projection that disagrees with the LAW plan table holds — never a silent seal', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    ...ONBOARDING_OK,
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'the law, pinned' },
    'ratify:request': GREEN,
    'ratify:gate': { exit: 0 },
    'law:milestone-projection': { exit: 1 }, // slices.json disagrees with the authoritative plan table
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'transport-failure', 'a projection mismatch is an honest hold — a reused status, no new beat')
  assert.ok(!calls.some(c => c.label === 'law:seal'), 'the LAW never seals while the projection disagrees with its table')
  assert.ok(!ret.beat.includes('locked') && !ret.beat.toLowerCase().includes('sealed'),
    'no SEALED / locked narration on a projection-mismatch hold')
  const st = stateArgs(calls)
  assert.ok(st.stage === 'law' && st.token !== 'advance' && st.token !== 'seal-advance', 'the run holds at law — never advances to build')
})

test('runtime (S1, W8-B): the perceptual table is checked BEFORE the seal — beside the milestone projection, then the seal follows', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    ...ONBOARDING_OK,
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'the law, pinned' },
    'ratify:request': GREEN,
    'ratify:gate': { exit: 0 },
    'law:milestone-projection': { exit: 0 },
    'law:perceptual-table': { exit: 0 },
    'law:seal': { exit: 0 },
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'a ratified LAW whose perceptual table agrees seals and advances')
  const perc = calls.find(c => c.label === 'law:perceptual-table')
  assert.ok(perc, 'the perceptual-table leg runs on the sealed branch')
  assert.ok(perc.prompt.includes('slices.json') && perc.prompt.includes('LAW.md') && perc.prompt.includes('perceptual'),
    'the leg reads the LAW.md perceptual table against slices.json')
  const proj = calls.find(c => c.label === 'law:milestone-projection')
  const seal = calls.find(c => c.label === 'law:seal')
  assert.ok(calls.indexOf(proj) < calls.indexOf(perc) && calls.indexOf(perc) < calls.indexOf(seal),
    'the perceptual check runs after the milestone projection and before the seal — an unlawful table never locks')
})

test('runtime (S1, W8-B): a perceptual table that disagrees holds — never a silent seal', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    ...ONBOARDING_OK,
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'the law, pinned' },
    'ratify:request': GREEN,
    'ratify:gate': { exit: 0 },
    'law:milestone-projection': { exit: 0 },
    'law:perceptual-table': { exit: 1 }, // an invalid, uncovered, or missing-but-required table
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'transport-failure', 'a perceptual-table disagree is an honest hold — a reused status, no new beat')
  assert.ok(!calls.some(c => c.label === 'law:seal'), 'the LAW never seals over a perceptual table that does not hold')
  assert.ok(!ret.beat.includes('locked') && !ret.beat.toLowerCase().includes('sealed'),
    'no SEALED / locked narration on a perceptual-table hold')
  const st = stateArgs(calls)
  assert.ok(st.stage === 'law' && st.token !== 'advance' && st.token !== 'seal-advance', 'the run holds at law — never advances to build')
})

test('runtime (Wave 1): a LAW ratify reject repairs the law, rechecks, and seals within the cap', async () => {
  const gateExits = [10, 0] // review reject, then recheck accept after one repair
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    ...ONBOARDING_OK,
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'the law, pinned' },
    'ratify:request': GREEN,
    'ratify:gate': () => ({ exit: gateExits.shift() }),
    // S3: the review reject establishes the cohort; the recheck then accepts (the empty subset).
    'ratify:cohort': { exit: 0, ids: ['f1'] },
    'ratify:repair': { facts: { status: 'ok', pointers: ['.kiln/LAW.md'], schema_valid: true }, narration_beat: 'the law, revised' },
    'law:milestone-projection': { exit: 0 },
    'law:perceptual-table': { exit: 0 },
    'law:seal': { exit: 0 },
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'reject then a repaired recheck advances')
  assert.equal(calls.filter(c => c.label === 'ratify:gate').length, 2, 'the gate ran twice — review then recheck')
  assert.equal(calls.filter(c => c.label === 'ratify:repair').length, 1, 'exactly one repair pass landed')
  const repair = calls.find(c => c.label === 'ratify:repair')
  assert.equal(repair.opts.model, 'fable', 'the repair re-runs the LAW card on the stage-law thinking seat')
  assert.ok(repair.prompt.includes('.kiln/gate-review.json'), 'the repair reads the findings from the gate file')
  assert.ok(repair.prompt.includes('.kiln/LAW.md'), 'the repair regenerates the LAW artifact')
  assert.ok(calls.some(c => c.label === 'law:seal'), 'seal-law locks the ratified LAW')
})

test('runtime (Wave 1/S3): a LAW that will not ratify holds after the repair cap over a strictly-shrinking cohort — never a silent advance', async () => {
  // S3: each recheck clears one finding (a strict shrink, so the edge earns a scoped-move), but the
  // cap (2, from the reversible onboarding posture) still exhausts before the cohort empties → held.
  const cohorts = [['f1', 'f2', 'f3'], ['f1', 'f2'], ['f1']]
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    ...ONBOARDING_OK,
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'the law' },
    'ratify:request': GREEN,
    'ratify:gate': { exit: 10 }, // always changes_required
    'ratify:cohort': () => ({ exit: 0, ids: cohorts.shift() }),
    'ratify:repair': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'revised' },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'held', 'a non-converging LAW holds for the operator')
  assert.equal(calls.filter(c => c.label === 'ratify:repair').length, 2, 'exactly two repair passes, never a third')
  assert.equal(calls.filter(c => c.label === 'ratify:gate').length, 3, 'review plus two rechecks — the bounded loop')
  assert.ok(!calls.some(c => c.label === 'law:seal'), 'the LAW never locks unratified')
  assert.ok(!ret.beat.includes('revised'), 'buffered repair-round beats never leak into a held transcript')
  const st = stateArgs(calls)
  assert.equal(st.stage, 'law', 'the run holds at the law stage')
  assert.ok(st.token !== 'advance' && st.token !== 'seal-advance', 'never advances to build on a held LAW')
})

test('runtime (W6-F): a risky posture keys the LAW-ratify cap to 1 — one repair then held; the dial sets the cap, the width never raises it', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    ...ONBOARDING_OK,
    'law:preflight': GREEN,
    // A risky/irreversible posture keys recovery_cap 1. width stays floor so the single-act
    // producer runs (the WIDE dance is orthogonal) — the cap follows recovery_cap, never the width.
    'width:read': { exit: 0, width: 'floor', recovery_cap: 1 },
    'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'the law' },
    'ratify:request': GREEN,
    'ratify:gate': { exit: 10 }, // always changes_required
    // S3: the recheck strictly shrinks (a scoped-move earned), but the cap of 1 exhausts after it.
    'ratify:cohort': (() => { const seq = [['f1', 'f2'], ['f1']]; return () => ({ exit: 0, ids: seq.shift() }) })(),
    'ratify:repair': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'revised' },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'held', 'a non-converging LAW under a cap of 1 holds for the operator')
  assert.equal(calls.filter(c => c.label === 'ratify:repair').length, 1, 'exactly one repair pass — the keyed cap of 1, never the pre-W6 hardcoded two')
  assert.equal(calls.filter(c => c.label === 'ratify:gate').length, 2, 'review plus one recheck — the cap-1 bounded loop, never a third gate')
  assert.equal(calls.filter(c => c.label === 'width:read').length, 1, 'one dial read per LAW invocation carries both the width and the ratify cap — never re-read for the loop')
  assert.ok(!calls.some(c => c.label === 'law:seal'), 'the LAW never locks unratified')
})

test('runtime (W6-S3 dogfood, LAW): a LAW recheck that clears nothing holds immediately — no strict progress, well under the cap, the law never locks', async () => {
  // The recheck re-grade reports the same cohort: nothing cleared, so recoveryDecision holds on the
  // first recheck even though the cap (2, the reversible posture) has an edge left. The edge was
  // still spent — one repair pass ran — but equality earns no credit and the LAW never seals.
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    ...ONBOARDING_OK,
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'the law' },
    'ratify:request': GREEN,
    'ratify:gate': { exit: 10 }, // always changes_required
    'ratify:cohort': { exit: 0, ids: ['f1'] }, // constant — the recheck clears nothing
    'ratify:repair': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'revised' },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'held', 'a non-shrinking LAW recheck holds the law for the operator')
  assert.equal(calls.filter(c => c.label === 'ratify:repair').length, 1, 'exactly one repair edge spent — the equality holds before the cap of 2')
  assert.equal(calls.filter(c => c.label === 'ratify:gate').length, 2, 'review plus one recheck, never the cap-2 third gate')
  assert.ok(!calls.some(c => c.label === 'law:seal'), 'the LAW never locks over a stalled ratify')
})

test('runtime (W6-S3 dogfood, LAW): a recheck introducing a new finding id is rejected by the ratify-recheck transport and holds before the subset — the cohort is read only on the establishing review', async () => {
  // The establishing review pins cohort {f1}. A repaired LAW's recheck re-grade is checked against
  // that pinned cohort by the ratify-recheck verb (allowedFindingIds, scripts/kiln-review): a re-grade
  // finding id OUTSIDE {f1} is rejected closed (exit 20 — the tamper the verb enforces, proven in
  // kiln-review.test.mjs), a re-grade WITHIN it re-grades as an ordinary reject (exit 10). The mock
  // gate computes its recheck exit from that rule, so the exit is a function of the smuggled id, not
  // the recheck mode. Running both re-grades proves the causal link: the out-of-cohort id — the sole
  // difference between the two runs — is what turns the recheck into a terminal transport hold, and
  // the failed recheck holds before any second cohort read (the {f1,f2} escape is never reached).
  const establishingCohort = ['f1']
  const run = (regradeCohort) => {
    const escapes = regradeCohort.some(id => !establishingCohort.includes(id))
    return runKernel({ stage: 'law', projectDir: '/p' }, {
      ...VOICE,
      ...ONBOARDING_OK,
      'law:preflight': GREEN,
      'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'the law' },
      'ratify:request': GREEN,
      'ratify:gate': (prompt) => ({ exit: prompt.includes('ratify-recheck') ? (escapes ? 20 : 10) : 10 }),
      'ratify:cohort': { exit: 0, ids: establishingCohort },
      'ratify:repair': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'revised' },
      'state:write': GREEN,
    })
  }
  // Smuggle: the re-grade introduces f2, an id outside {f1} → the ratify-recheck transport rejects.
  const { ret, calls } = await run(['f1', 'f2'])
  assert.equal(ret.status, 'transport-failure', 'the out-of-cohort recheck fails the transport — a visible terminal hold, never a seal')
  const recheck = calls.find(c => c.label === 'ratify:gate' && c.prompt.includes('ratify-recheck'))
  assert.ok(recheck, 'the recheck is routed through the cohort-enforcing ratify-recheck verb — the transport that rejects the escape')
  assert.equal(calls.filter(c => c.label === 'ratify:cohort').length, 1, 'the cohort is read only on the establishing review — the failed recheck holds before any subset eval')
  assert.ok(!calls.some(c => c.label === 'law:seal'), 'the LAW never locks')
  // Control: an otherwise-identical re-grade confined to {f1} routes through the SAME ratify-recheck
  // verb yet never trips the transport — so the smuggled out-of-cohort id, not the recheck itself, is
  // what causes the terminal hold.
  const control = await run(['f1'])
  assert.ok(control.calls.some(c => c.label === 'ratify:gate' && c.prompt.includes('ratify-recheck')), 'the control still routes the re-grade through the ratify-recheck verb — the only difference from the smuggle run is the introduced id')
  assert.notEqual(control.ret.status, 'transport-failure', 'a within-cohort re-grade never trips the transport fault — the introduced id is the sole cause of the terminal hold')
  assert.ok(!control.calls.some(c => c.label === 'law:seal'), 'the within-cohort re-grade still never seals — it reads as an ordinary held')
})

test('runtime (S4, INTAKE-38): codex unavailable at LAW ratify is the two-marker acknowledgment stop — then the acked re-run seals single-family via the opus fallback', async () => {
  // FIRST detection: the codex ratify gate returns exit 21. The kernel persists BOTH
  // markers and returns the distinct degraded acknowledgment stop — never a silent hold,
  // never a seal. The conductor's literal continue relaunches the law stage.
  const first = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    ...ONBOARDING_OK,
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'the law' },
    'ratify:request': GREEN,
    'ratify:gate': { exit: 21 }, // codex unavailable
    'degraded:mark': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(first.ret.status, 'degraded', 'codex-down at law ratify is the acknowledgment stop — the same stop the build and audit gates take, not a held')
  // W2-S10 (Sol r1 B1): detection records the DETECTION and nothing else. The ack is the operator
  // word and the conductor is its only writer, so a stop that was issued can never be mistaken at a
  // later resume for a stop that was answered.
  const lawMark = first.calls.find(c => c.label === 'degraded:mark')
  assert.ok(lawMark, 'the degraded marker is persisted for the acknowledgment')
  assert.ok(lawMark.prompt.includes('touch .kiln/degraded') && !lawMark.prompt.includes('degraded-ack'),
    'the law detection touches the degraded marker ALONE — never the operator word')
  assert.ok(!first.calls.some(c => c.label === 'ratify:repair'), 'no repair on codex-unavailable')
  assert.ok(!first.calls.some(c => c.label === 'law:seal'), 'the LAW never locks on the first detection')
  assert.ok(first.ret.beat.toLowerCase().includes('codex'), 'the degradation beat is honest about the missing second family')
  assert.ok(!first.ret.beat.includes('sealed'), 'the law never seals on the acknowledgment stop')
  // The ACKED re-run: the marker is present, so the claude OPUS ratifier runs. It echoes
  // the pre-turn LAW digest as law_hash, the post-turn digest is unchanged (no tamper), and
  // the LAW seals single-family with the lock.seal sidecar label.
  const DIGEST = 'a'.repeat(64)
  const verdict = { review_id: 'r-op', law_hash: DIGEST, findings: [], blockers: [], verdict: 'accept' }
  const acked = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    ...ONBOARDING_OK,
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'the law' },
    'law:degraded': { exit: 0 }, // the marker is present — the acked re-run takes the claude seat
    'law:degraded-ack': { exit: 0 }, // and the operator word stands behind it (S10d)
    'law:seal-label': { exit: 0 }, // present at seal time → single-family
    'ratify:digest': { exit: 0, ids: [DIGEST] },
    'ratify:invalidate': { exit: 0 },
    'ratify-claude:review': { ok: true },
    'ratify:read': { exit: 0, ids: [JSON.stringify(verdict)] },
    'ratify:digest-confirm': { exit: 0, ids: [DIGEST] }, // unchanged — no tamper
    'ratify:publish': { exit: 0 },
    'law:milestone-projection': { exit: 0 },
    'law:perceptual-table': { exit: 0 },
    'law:seal': { exit: 0 },
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(acked.ret.status, 'ok', 'the acked re-run ratifies single-family through the opus fallback and advances to build')
  const claudeCall = acked.calls.find(c => c.label === 'ratify-claude:review')
  assert.ok(claudeCall, 'the claude ratify leg ran on the degraded path')
  assert.ok(!acked.calls.some(c => c.label === 'ratify:gate'), 'the codex ratify transport is never called when degraded — one seat, not two')
  assert.equal(claudeCall.opts.model, 'opus', 'the fallback ratifier is the opus seat — opposite model to the fable author, same family')
  const seal = acked.calls.find(c => c.label === 'law:seal')
  assert.ok(seal && seal.prompt.includes('seal-law .kiln single-family'), 'the LAW seals with the single-family label — the lock.seal sidecar records the honest family')
  // W2-S5 production wiring: the claude LAW ratify verdict publishes through the archive-then-publish
  // verb under the ratify family, so its verdict is archived before the content-free overwrite.
  const ratifyPublish = acked.calls.find(c => c.label === 'ratify:publish')
  assert.ok(ratifyPublish && ratifyPublish.prompt.includes('publish-gate .kiln ratify'), 'the claude ratify verdict routes through the W2-S5 publish-gate verb under the ratify family')
})

test('runtime (W2-S10d): an UNANSWERED detection selects no seat — law ratify, the seam audit and the sweep each return their own degraded stop', async () => {
  // The B1 shape at the sites the minting verbs cannot reach. cards/build.md has the builder touch
  // `degraded` mid-build with no stop and no word; the leg dies; the conductor relaunches, and a
  // relaunch JOINS — no minting verb, no probe, no panel. So each marker-keyed seat selector has to
  // refuse locally, or a joined relaunch picks the single-family seat off a stop nobody answered.
  const law = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    ...ONBOARDING_OK,
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'the law' },
    'law:degraded': { exit: 0 },        // a detection stands
    'law:degraded-ack': { exit: 1 },    // and nobody has answered it
    'state:write': GREEN,
  })
  assert.equal(law.ret.status, 'degraded', 'law ratify returns its own acknowledgment stop, not a seat')
  assert.ok(!law.calls.some(c => c.label === 'ratify-claude:review' || c.label === 'ratify:request'),
    'and no ratifier of either family is dispatched over an unworded detection')
  assert.equal(stateArgs(law.calls).key, 'acknowledge-degrade', 'and the persisted next action asks for the word')
  // The seam audit is the sharper of the two: the sealed-skip loop reaches it and continues PAST
  // it, so the build belt never runs first on this path — which is exactly how the belt came to be
  // credited with coverage it did not have.
  const audit = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|logic|A', 'obj|s2|logic|A'] },
    'seal:set': { exit: 0, ids: ['s1', 's2'] }, // all sealed; the s2 seam audit is still owed
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'law:stage-end': GREEN,
    'state:write': GREEN,
    'audit:member': { exit: 1 },
    'law:pre-audit': GREEN,
    'audit:degraded': { exit: 0 },      // a detection stands
    'audit:degraded-ack': { exit: 1 },  // and nobody has answered it
  })
  assert.equal(audit.ret.status, 'degraded', 'the seam audit returns its own acknowledgment stop, not a seat')
  assert.ok(!audit.calls.some(c => c.label === 'audit:review' || c.label === 'audit-claude:review'),
    'and no auditor of either family judges the seam over an unworded detection')
})

test('runtime (W2-S10d): the marker-keyed selectors already covered by ORDER say so, and the control flow says it too', () => {
  // Ground-or-weaken on a COVERAGE claim — the shape that produced this defect. The build
  // reviewerOpts and sealLabel need no ack gate of their own, and the reason is the order of the
  // reads, not luck. Stated here so it can never be assumed again.
  assert.equal((src.match(/test -f ' \+ P\.ack/g) || []).length, 3,
    'exactly three ack reads in the kernel: the build belt, the law ratify guard, the seam audit guard')
  const belt = src.indexOf("const wasDegraded = await hands('test -f ' + P.degraded")
  const beltGuard = src.indexOf("wasDegraded && await hands('test -f ' + P.ack")
  const reviewerOpts = src.indexOf("const reviewerOpts = wasDegraded ? tier('fallback-reviewer')")
  assert.ok(belt !== -1 && beltGuard !== -1 && reviewerOpts !== -1, 'the belt, its ack guard and the build seat selector all stand')
  assert.ok(belt < beltGuard && beltGuard < reviewerOpts,
    'the build seat is selected only PAST the belt and its ack guard — that is why it carries none of its own')
  // sealLabel labels rather than selects. The ordering claim is about its LIVE CALLS, so the pin
  // enumerates them and places each one after the guard that covers it — a pin that checked only
  // the helper definition would leave the promised regression defense absent.
  const calls = [...src.matchAll(/await sealLabel\('([^']+)'\)/g)]
  assert.deepEqual(calls.map((m) => m[1]), ['law:seal-label', 'audit:seal-label', 'degraded:check'],
    'exactly three live sealLabel calls — the law seal, the audit append, and the build seal')
  const lawGuard = src.indexOf("'law:degraded-ack'")
  const auditGuard = src.indexOf("'audit:degraded-ack'")
  const beltGuardAt = src.indexOf("wasDegraded && await hands('test -f ' + P.ack")
  assert.ok(lawGuard !== -1 && auditGuard !== -1 && beltGuardAt !== -1, 'all three ack guards stand')
  assert.ok(lawGuard < calls[0].index, 'the law seal label is read only past the law ack guard')
  assert.ok(auditGuard < calls[1].index, 'the audit append label is read only past the audit ack guard')
  assert.ok(beltGuardAt < calls[2].index, 'the build seal label is read only past the belt ack guard')
  assert.ok(!/sealLabel\([^)]*\)[^\n]*tier\(/.test(src), 'and no seat is chosen from any of their results')
})

test('runtime (S4, INTAKE-38): the degraded LAW claude ratifier holds transport-class on a bad echo, a post-turn tamper, and a stale candidate — never publishes, never seals', async () => {
  // The acked (marker-present) claude ratify seat, with one leg falsified per scenario. The seat
  // computes the candidate LAW digest before the turn, rejects a law_hash that does not echo it,
  // recomputes the digest after the turn (a claude mind can write files) and rejects a tamper, and
  // holds when the reviewer acked but wrote no fresh verdict. Each is the transport-class hold —
  // the LAW never publishes and never seals on a claude verdict the kernel cannot trust.
  const DIGEST = 'a'.repeat(64)
  const accept = { review_id: 'r-op', law_hash: DIGEST, findings: [], blockers: [], verdict: 'accept' }
  const base = (over) => runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    ...ONBOARDING_OK,
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'the law' },
    'law:degraded': { exit: 0 }, // the marker is present — the acked re-run takes the claude seat
    'law:degraded-ack': { exit: 0 }, // and the operator word stands behind it (S10d)
    'ratify:digest': { exit: 0, ids: [DIGEST] },
    'ratify:invalidate': { exit: 0 },
    'ratify-claude:review': { ok: true },
    'ratify:read': { exit: 0, ids: [JSON.stringify(accept)] },
    'ratify:digest-confirm': { exit: 0, ids: [DIGEST] },
    'state:write': GREEN,
    ...over,
  })
  // WRONG ECHO: the reviewer writes a law_hash that does not match the pre-turn candidate digest.
  const wrongEcho = await base({ 'ratify:read': { exit: 0, ids: [JSON.stringify({ ...accept, law_hash: 'b'.repeat(64) })] } })
  assert.equal(wrongEcho.ret.status, 'transport-failure', 'a law_hash that does not echo the candidate digest holds transport-class')
  assert.ok(!wrongEcho.calls.some(c => c.label === 'ratify:publish'), 'the mismatched echo never publishes')
  assert.ok(!wrongEcho.calls.some(c => c.label === 'law:seal'), 'the mismatched echo never seals')
  // TAMPER: the echo is honest, but the LAW bytes changed under the reviewer's turn.
  const tamper = await base({ 'ratify:digest-confirm': { exit: 0, ids: ['b'.repeat(64)] } })
  assert.equal(tamper.ret.status, 'transport-failure', 'a LAW rewritten under the ratify turn holds transport-class')
  assert.ok(!tamper.calls.some(c => c.label === 'ratify:publish'), 'the post-turn tamper never publishes')
  assert.ok(!tamper.calls.some(c => c.label === 'law:seal'), 'the post-turn tamper never seals')
  // STALE CANDIDATE: the reviewer acked {ok:true} but wrote nothing — the read finds no verdict.
  const stale = await base({ 'ratify:read': { exit: 1, ids: [] } })
  assert.equal(stale.ret.status, 'transport-failure', 'an ack with no fresh candidate on disk holds transport-class')
  assert.ok(!stale.calls.some(c => c.label === 'ratify:publish'), 'the stale ack never publishes')
  assert.ok(!stale.calls.some(c => c.label === 'law:seal'), 'the stale ack never seals')
})

test('runtime (S4, INTAKE-38): an untrusted degradation marker HOLDS the family-label read at every seal site — the LAW seal, the milestone audit append, and the build seal never record a family they cannot trust', async () => {
  // S4-D5: the family label is a TRI-STATE read of the degradation marker, reread at each seal
  // site. test -f answers 0 (present → single-family) or 1 (absent → dual); an untrusted exit is
  // neither, so the seal HOLDS transport-class rather than record a family label it cannot trust.
  // LAW seal: an accepted codex ratify, then the seal-label read is untrusted.
  const law = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    ...ONBOARDING_OK,
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'the law' },
    'ratify:request': GREEN,
    'ratify:gate': { exit: 0 },
    'law:milestone-projection': { exit: 0 },
    'law:perceptual-table': { exit: 0 },
    'law:seal-label': { exit: 2 }, // untrusted — neither present nor absent
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(law.ret.status, 'transport-failure', 'an untrusted marker at the LAW seal holds rather than lock an unknown family')
  assert.ok(!law.calls.some(c => c.label === 'law:seal'), 'the LAW seal never runs on an untrusted family label')
  // Milestone audit append: an accepted codex audit, then the append-label read is untrusted.
  const audit = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui|core'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'seal:set': { exit: 0, ids: ['s1'] },
    'law:stage-end': GREEN,
    'state:write': GREEN,
    ...AUDIT_OK,
    'audit:seal-label': { exit: 2 }, // untrusted at the append
  })
  assert.equal(audit.ret.status, 'transport-failure', 'an untrusted marker at the audit append holds rather than record an unknown family')
  assert.ok(!audit.calls.some(c => c.label === 'audit:append'), 'the milestone audit never appends on an untrusted family label')
  // Build seal: an accepted per-slice gate, then the seal-label read is untrusted.
  const build = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui|core'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'slice:s1': auditSlice(),
    'law:pre-seal': GREEN,
    'gate:review': { exit: 0 },
    'degraded:check': { exit: 2 }, // untrusted at the slice seal — S4 rewired the old boolean through sealLabel
    'state:write': GREEN,
  })
  assert.equal(build.ret.status, 'transport-failure', 'an untrusted marker at the build seal holds rather than seal an unknown family')
  assert.ok(!build.calls.some(c => c.label === 'seal:append'), 'the build seal never appends on an untrusted family label')
})

test('runtime (Wave 1, A2): the SEALED-claiming LAW card beat speaks only after ratify+seal — never on a held transcript', async () => {
  // The real cards/law.md beat asserts the law is locked and build starts; on a HELD
  // that beat above the honest hold line is a self-contradicting record. The kernel
  // buffers it and emits it only after a successful ratify AND seal.
  const LAW_SEALED_BEAT = 'The law is locked. Asimov pinned your acceptance criteria into executable Law — sealed before build begins; the forge starts next.'
  const base = {
    ...VOICE,
    ...ONBOARDING_OK,
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: LAW_SEALED_BEAT },
    'ratify:request': GREEN,
    'degraded:mark': { exit: 0 },
    'law:milestone-projection': { exit: 0 },
    'law:perceptual-table': { exit: 0 },
    'state:write': GREEN,
  }
  // DEGRADED (codex down): the acknowledgment stop, whose sealed narration is ABSENT —
  // only the honest degradation line, never the buffered SEALED card beat.
  const held = await runKernel({ stage: 'law', projectDir: '/p' }, { ...base, 'ratify:gate': { exit: 21 } })
  assert.equal(held.ret.status, 'degraded')
  assert.ok(!held.ret.beat.includes('locked') && !held.ret.beat.includes('build begins') && !held.ret.beat.includes('forge starts'),
    'no SEALED / build-starts narration on the degraded acknowledgment transcript — an unratified plan never reads as sealed')
  assert.ok(held.ret.beat.toLowerCase().includes('codex'), 'only the honest degradation line speaks')
  // Accept: the sealed beat appears (past ratify AND seal).
  const accept = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...base, 'ratify:gate': { exit: 0 }, 'law:seal': { exit: 0 }, 'law:stage-end': GREEN,
  })
  assert.equal(accept.ret.status, 'ok')
  assert.ok(accept.ret.beat.includes('The law is locked'), 'the sealed card beat speaks on a genuine accept')
  // Ordering proof: the beat is gated on the seal. A failed seal emits none of it.
  const sealFail = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...base, 'ratify:gate': { exit: 0 }, 'law:seal': { exit: 1 },
  })
  assert.equal(sealFail.ret.status, 'persist-failed')
  assert.ok(!sealFail.ret.beat.includes('locked'), 'the card beat is buffered until the seal lands — a failed seal emits none of it')
})

test('runtime (Wave 1, A9): a project path with a space ratifies — the mandatory gate never interpolates projectDir', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/tmp/a project dir' }, {
    ...VOICE,
    ...ONBOARDING_OK,
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'the law' },
    'ratify:request': GREEN,
    'ratify:gate': { exit: 0 },
    'law:milestone-projection': { exit: 0 },
    'law:perceptual-table': { exit: 0 },
    'law:seal': { exit: 0 },
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'a whitespace project path reaches the accept path — the 3-arg gate never splits into extra argv')
  const gate = calls.find(c => c.label === 'ratify:gate')
  const cmd = gate.prompt.split('\n').pop() // the command line, after the "Run … in <projectDir>" cwd preamble
  assert.ok(cmd.includes('kiln-review ratify . .kiln .kiln/ratify-request.json .kiln/gate-review.json'),
    'the <repo> arg is the cwd-relative `.` and the trust root the explicit .kiln — all whitespace-safe args')
  assert.ok(!cmd.includes('/tmp/a project dir'), 'the project path never reaches the ratify command as a bare argv token')
})

// ── W5-S2 (the WIDE table): the blind-dual planning branch — holds safely on mismatch ──

// The WIDE promote happy path, reused by the promote pin and the content-blind pin. It overrides
// the ONBOARDING_OK floor width with a WIDE reading and scripts the full blind-dual dance.
const WIDE_PROMOTE_RUN = {
  ...VOICE,
  ...ONBOARDING_OK,
  'law:preflight': GREEN,
  'width:read': { exit: 0, width: 'wide' }, // a non-floor width → the WIDE branch (overrides the ONBOARDING_OK floor)
  'wide:prep': { exit: 0 },
  'wide:draft-a': { facts: { status: 'ok', pointers: ['.kiln/.wide/a/LAW.md'], schema_valid: true }, narration_beat: 'draft a' },
  'wide:draft-b': { facts: { status: 'ok', pointers: ['.kiln/.wide/b/LAW.md'], schema_valid: true }, narration_beat: 'draft b' },
  'wide:adjust-a': { facts: { status: 'ok', pointers: ['.kiln/.wide/a-adjusted/LAW.md'], schema_valid: true }, narration_beat: 'The law is locked — the wide plan converged.', converged: true },
  'wide:adjust-b': { facts: { status: 'ok', pointers: ['.kiln/.wide/b-adjusted/LAW.md'], schema_valid: true }, narration_beat: 'adjusted b', converged: true },
  'wide:byte-equal': { exit: 0 }, // the two adjusted LAW.md are identical
  'wide:promote': { exit: 0 },
  'ratify:request': GREEN,
  'ratify:gate': { exit: 0 },
  'law:milestone-projection': { exit: 0 },
  'law:perceptual-table': { exit: 0 },
  'law:seal': { exit: 0 },
  'law:stage-end': GREEN,
  'state:write': GREEN,
}

// ── W5-S3 (the fresh Q-F adjudicator): a residual divergence is adjudicated, not held ──
// The adjudicate happy path (byte-mismatch → residual divergence), reused by the adjudicate pin and
// the content-blind pin. Both authors valid and converged, but the two adjusted LAW.md differ, so
// the cmp is nonzero: the fresh Q-F adjudicator authors the complete canonical LAW and the ordinary
// opposite-family ratify+seal still runs — replacing S2's temporary hold-on-mismatch.
const WIDE_ADJUDICATE_RUN = {
  ...VOICE,
  ...ONBOARDING_OK,
  'law:preflight': GREEN,
  'width:read': { exit: 0, width: 'wide' },
  'wide:prep': { exit: 0 },
  'wide:draft-a': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'a' },
  'wide:draft-b': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'b' },
  'wide:adjust-a': { facts: { status: 'ok', pointers: ['.kiln/.wide/a-adjusted/LAW.md'], schema_valid: true }, narration_beat: 'a2', converged: true },
  'wide:adjust-b': { facts: { status: 'ok', pointers: ['.kiln/.wide/b-adjusted/LAW.md'], schema_valid: true }, narration_beat: 'b2', converged: true },
  'wide:byte-equal': { exit: 1 }, // the two adjusted LAW.md differ — a residual divergence
  'wide:adjudicate': { facts: { status: 'ok', pointers: ['.kiln/LAW.md', '.kiln/law/check.sh', '.kiln/slices.json', '.kiln/decisions.md'], schema_valid: true }, narration_beat: 'The law is locked — the residual divergences were adjudicated.' },
  'wide:adjudicate-check': { exit: 0 }, // the four canonical outputs are all present and nonempty
  'ratify:request': GREEN,
  'ratify:gate': { exit: 0 },
  'law:milestone-projection': { exit: 0 },
  'law:perceptual-table': { exit: 0 },
  'law:seal': { exit: 0 },
  'law:stage-end': GREEN,
  'state:write': GREEN,
}

test('runtime (W5-S2, W5-04): the floor width keeps the single act producer — no WIDE legs, ratify+seal as ever', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    ...ONBOARDING_OK, // carries the floor width read — the untouched pre-W5-S2 path
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: ['.kiln/LAW.md'], schema_valid: true }, narration_beat: 'the law, pinned' },
    'ratify:request': GREEN,
    'ratify:gate': { exit: 0 },
    'law:milestone-projection': { exit: 0 },
    'law:perceptual-table': { exit: 0 },
    'law:seal': { exit: 0 },
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'the floor path ratifies and seals exactly as before W5-S2')
  assert.ok(calls.some(c => c.label === 'stage:law'), 'the EXISTING single act producer runs on the floor')
  for (const l of ['wide:prep', 'wide:draft-a', 'wide:draft-b', 'wide:adjust-a', 'wide:adjust-b', 'wide:byte-equal', 'wide:promote']) {
    assert.ok(!calls.some(c => c.label === l), 'no WIDE leg fires on the floor: ' + l)
  }
  const width = calls.find(c => c.label === 'width:read')
  assert.ok(width && width.prompt.includes('gauge-dial.mjs'), 'width is read via the gauge-dial projector leg (mirroring research-sweep)')
  const si = calls.findIndex(c => c.label === 'stage:law')
  assert.ok(calls.indexOf(width) >= 0 && calls.indexOf(width) < si, 'the width read runs after the input gate, before the producer')
})

test('runtime (W5-S2, W5-01/04): a WIDE width runs two blind authors; both-converged + byte-equal promotes the complete four-output LAW → ratify+seal', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, WIDE_PROMOTE_RUN)
  assert.equal(ret.status, 'ok', 'a converged, byte-equal WIDE plan promotes, ratifies, seals, and advances')
  assert.ok(!calls.some(c => c.label === 'stage:law'), 'the single act producer is skipped on the WIDE path')
  for (const l of ['wide:draft-a', 'wide:draft-b', 'wide:adjust-a', 'wide:adjust-b', 'wide:byte-equal', 'wide:promote']) {
    assert.ok(calls.some(c => c.label === l), 'the WIDE leg ran: ' + l)
  }
  assert.ok(!calls.some(c => c.label === 'wide:adjudicate'), 'the byte-equal skip does NOT run the adjudicator (S3): a converged, byte-equal pair promotes without adjudication')
  // No role #13 (W5-05): the authors are fresh stage-law (fable) legs.
  for (const l of ['wide:draft-a', 'wide:draft-b', 'wide:adjust-a', 'wide:adjust-b']) {
    assert.equal(calls.find(c => c.label === l).opts.model, 'fable', l + ' is a fresh stage-law (fable) leg — no new tier role')
  }
  // Both IMMUTABLE drafts precede either adjustment (each author cross-reads the other's draft).
  const dA = calls.findIndex(c => c.label === 'wide:draft-a')
  const dB = calls.findIndex(c => c.label === 'wide:draft-b')
  const aA = calls.findIndex(c => c.label === 'wide:adjust-a')
  const aB = calls.findIndex(c => c.label === 'wide:adjust-b')
  assert.ok(dA < aA && dB < aA && dA < aB && dB < aB, 'both immutable drafts land before either cross-read adjustment')
  // The promote moves the COMPLETE four-output LAW to canonical, guarded by test -s, before ratify.
  const promote = calls.find(c => c.label === 'wide:promote')
  for (const out of ['.kiln/LAW.md', '.kiln/law/check.sh', '.kiln/slices.json', '.kiln/decisions.md']) {
    assert.ok(promote.prompt.includes(out), 'the promote moves the complete four-output LAW: ' + out)
  }
  assert.ok(promote.prompt.includes('test -s'), 'the promote guards completeness with test -s — an incomplete WIDE result fails closed')
  const gate = calls.find(c => c.label === 'ratify:gate')
  const seal = calls.find(c => c.label === 'law:seal')
  assert.ok(calls.indexOf(promote) < calls.indexOf(gate), 'the promote precedes ratify — the ratify block is rejoined unchanged')
  assert.ok(calls.indexOf(gate) < calls.indexOf(seal), 'the seal follows the accept')
  assert.ok(ret.beat.includes('The law is locked'), 'the promoted candidate beat speaks only after ratify+seal')
  assert.equal(stateArgs(calls).key, 'relaunch-build', 'a promoted+ratified WIDE law advances to build')
})

test('runtime (W5-S3, W5-05): a WIDE byte-mismatch runs the fresh Q-F adjudicator → complete canonical LAW + ADRs → ratify+seal (no hold)', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, WIDE_ADJUDICATE_RUN)
  assert.equal(ret.status, 'ok', 'a residual divergence is adjudicated, ratified, sealed, and advances — S2\'s hold is gone')
  assert.ok(calls.some(c => c.label === 'wide:byte-equal'), 'the byte-equality cmp ran (both legs valid and converged)')
  assert.ok(!calls.some(c => c.label === 'wide:promote'), 'a residual divergence never promotes a candidate unchanged')
  const adj = calls.find(c => c.label === 'wide:adjudicate')
  assert.ok(adj, 'the fresh Q-F adjudicator runs on a residual divergence, replacing S2\'s hold-on-mismatch')
  // A fresh stage-law (fable) leg, labeled distinctly — NO role #13, no new tier role.
  assert.equal(adj.opts.model, 'fable', 'the adjudicator is a fresh stage-law (fable) leg — decorrelated by freshness, not a new tier role')
  for (const l of ['wide:draft-a', 'wide:draft-b', 'wide:adjust-a', 'wide:adjust-b'])
    assert.notEqual(adj.label, l, 'the adjudicator is labeled distinctly from the two author legs')
  // Residual-only: consolidate the agreed, rule ONLY the divergences, never a silent whole-new plan.
  assert.ok(/consolidat/i.test(adj.prompt) && /rule only the surviving divergences/i.test(adj.prompt),
    'the adjudicator scaffold binds consolidate-agreed + rule-only-residuals')
  assert.ok(/never synthesize a wholly new plan/i.test(adj.prompt),
    'the adjudicator is forbidden from silently synthesizing a wholly new plan (ADR A11)')
  // It authors the COMPLETE four-output canonical LAW and records adjudication ADRs in decisions.md.
  for (const out of ['.kiln/LAW.md', '.kiln/law/check.sh', '.kiln/slices.json', '.kiln/decisions.md'])
    assert.ok(adj.prompt.includes(out), 'the adjudicator writes the complete canonical output: ' + out)
  assert.ok(/ADR/.test(adj.prompt) && adj.prompt.includes('.kiln/decisions.md'),
    'the adjudicator appends adjudication ADRs to decisions.md (card/agent-authored — the kernel never writes it)')
  // The ordinary opposite-family ratify STILL runs, rejoined unchanged, and the seal follows accept.
  const gate = calls.find(c => c.label === 'ratify:gate')
  const seal = calls.find(c => c.label === 'law:seal')
  assert.ok(gate && seal, 'the adjudicated LAW still takes the ordinary opposite-family ratify + seal')
  const req = calls.find(c => c.label === 'ratify:request')
  assert.ok(req.prompt.includes('gpt-5.6-sol'), 'the ratify request still names the opposite-family gpt reviewer — the ratify block is unchanged')
  assert.ok(calls.indexOf(adj) < calls.indexOf(gate) && calls.indexOf(gate) < calls.indexOf(seal),
    'adjudicate → ratify → seal: the ratify block is rejoined unchanged')
  // W5-S3-02: the kernel GATES the adjudicated canon before ratify — a test -s on each of the four
  // canonical outputs, mirroring WIDE_PROMOTE. A status-'ok' self-report alone never reaches ratify.
  const canon = calls.find(c => c.label === 'wide:adjudicate-check')
  assert.ok(canon, 'the adjudicated canon passes a completeness gate before ratify')
  for (const out of ['.kiln/LAW.md', '.kiln/law/check.sh', '.kiln/slices.json', '.kiln/decisions.md'])
    assert.ok(canon.prompt.includes('test -s ' + out), 'the completeness gate tests the canonical output nonempty: ' + out)
  assert.ok(calls.indexOf(adj) < calls.indexOf(canon) && calls.indexOf(canon) < calls.indexOf(gate),
    'the completeness gate runs after adjudicate and before ratify — an incomplete adjudicated LAW never ratifies')
  assert.ok(ret.beat.includes('The law is locked'), 'the adjudicated candidate beat speaks only after ratify+seal')
  assert.equal(stateArgs(calls).key, 'relaunch-build', 'an adjudicated+ratified WIDE law advances to build')
})

test('runtime (W5-S3-02): an adjudicator that returns status ok but schema_valid false HOLDS — status ok alone never proves a valid canonical LAW', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...WIDE_ADJUDICATE_RUN,
    'wide:adjudicate': { facts: { status: 'ok', pointers: ['.kiln/LAW.md'], schema_valid: false }, narration_beat: 'x' },
  })
  assert.equal(ret.status, 'transport-failure', 'a status-ok but schema-invalid adjudication holds as a transport failure')
  assert.ok(!calls.some(c => c.label === 'wide:adjudicate-check'), 'the completeness gate is short-circuited when the adjudicator declares its own output invalid')
  assert.ok(!calls.some(c => c.label === 'ratify:gate'), 'an unsound adjudicated LAW never reaches ratify')
  assert.ok(!calls.some(c => c.label === 'law:seal'), 'an unsound adjudicated LAW never seals')
})

test('runtime (W5-S3-02): an adjudicated canon that is incomplete on disk FAILS CLOSED — the four test -s gate blocks ratify, mirroring WIDE_PROMOTE', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...WIDE_ADJUDICATE_RUN,
    'wide:adjudicate-check': { exit: 1 }, // a canonical output is missing or empty
  })
  assert.equal(ret.status, 'persist-failed', 'an incomplete adjudicated canon fails closed — the completeness floor WIDE_PROMOTE enforces on the skip path')
  assert.ok(calls.some(c => c.label === 'wide:adjudicate-check'), 'the completeness gate ran on a schema-valid adjudication')
  assert.ok(!calls.some(c => c.label === 'ratify:gate'), 'an incomplete adjudicated LAW never reaches ratify')
  assert.ok(!calls.some(c => c.label === 'law:seal'), 'an incomplete adjudicated LAW never seals')
})

test('runtime (W5-S3, W5-05): a non-converged WIDE report is adjudicated with the byte-equality cmp short-circuited — the kernel never guesses convergence', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...WIDE_ADJUDICATE_RUN,
    'wide:adjust-a': { facts: { status: 'ok', pointers: ['.kiln/.wide/a-adjusted/LAW.md'], schema_valid: true }, narration_beat: 'a2', converged: false }, // one author still sees a divergence
  })
  assert.equal(ret.status, 'ok', 'a converged:false report is adjudicated regardless of byte-equality')
  assert.ok(!calls.some(c => c.label === 'wide:byte-equal'), 'the byte-equality cmp is short-circuited on a non-converged report — the kernel never guesses convergence')
  assert.ok(calls.some(c => c.label === 'wide:adjudicate'), 'the fresh adjudicator resolves the honest divergence instead of holding')
  assert.ok(calls.some(c => c.label === 'law:seal'), 'the adjudicated law still ratifies and seals')
})

test('runtime (W5-S3): a WIDE author that returns unsound work HOLDS — an invalid leg is never promoted OR adjudicated', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    ...ONBOARDING_OK,
    'law:preflight': GREEN,
    'width:read': { exit: 0, width: 'wide' },
    'wide:prep': { exit: 0 },
    'wide:draft-a': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'a' },
    'wide:draft-b': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'b' },
    'wide:adjust-a': { facts: { status: 'transport-failure', pointers: [], schema_valid: false }, narration_beat: '', converged: false },
    'wide:adjust-b': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'b2', converged: true },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'transport-failure', 'an invalid author leg holds as a transport failure — not a residual divergence to adjudicate')
  assert.ok(!calls.some(c => c.label === 'wide:byte-equal'), 'the cmp is short-circuited when a leg is invalid')
  assert.ok(!calls.some(c => c.label === 'wide:promote'), 'an invalid leg is never promoted')
  assert.ok(!calls.some(c => c.label === 'wide:adjudicate'), 'an invalid leg is never adjudicated — there is no valid candidate pair')
  assert.ok(!calls.some(c => c.label === 'law:seal'), 'the law never seals on an invalid leg')
})

test('runtime (W5-S3, content-blind): the adjudication is the AGENT\'s call recorded in ADRs — the kernel branches only on the width, converged, and byte-equality closed facts', async () => {
  const { calls } = await runKernel({ stage: 'law', projectDir: '/p' }, WIDE_ADJUDICATE_RUN)
  // The kernel's only reads around the divergence are closed facts, never plan content: the width
  // dial and the byte-equality cmp -s. The adjudicator (an agent stage leg) rules and records ADRs.
  const cmp = calls.find(c => c.label === 'wide:byte-equal')
  assert.ok(cmp.prompt.includes('cmp -s') && cmp.prompt.includes('/LAW.md'), 'the divergence signal is a closed cmp -s fact — the kernel never opens the plan to decide')
  // W5-S3-01: the byte gate compares the COMPLETE four-output set — equal LAW.md with a divergent
  // check.sh/slices.json/decisions.md is a residual divergence that adjudicates, never a silent skip.
  for (const out of ['LAW.md', 'law/check.sh', 'slices.json', 'decisions.md'])
    assert.ok(cmp.prompt.includes('.kiln/.wide/a-adjusted/' + out) && cmp.prompt.includes('.kiln/.wide/b-adjusted/' + out),
      'the byte gate compares the full canonical set across both adjusted candidates: ' + out)
  const adj = calls.find(c => c.label === 'wide:adjudicate')
  assert.ok(adj.opts.schema && adj.opts.schema.properties && adj.opts.schema.properties.facts,
    'adjudication is dispatched as an agent stage leg (the kernel reads no plan content to adjudicate)')
  assert.ok(adj.prompt.includes('.kiln/decisions.md') && /ADR/.test(adj.prompt),
    'the residual calls are recorded in decisions.md by the agent — never a kernel content-read')
  // No orchestration family/persona/model token rides the adjudicator scaffold (prompt-level anonymity).
  for (const token of ['fable', 'gpt', 'opus', 'sonnet', 'codex', 'sol'])
    assert.ok(!new RegExp('\\b' + token + '\\b', 'i').test(adj.prompt), 'no orchestration token "' + token + '" in the adjudicator scaffold')
})

test('runtime (W5-S2, W5-06): the two WIDE author scaffolds are isomorphic modulo the A/B paths — cross-read carries no author metadata, no orchestration family token', async () => {
  const { calls } = await runKernel({ stage: 'law', projectDir: '/p', idea: 'a broad reader-facing catalog with many pages' }, {
    ...VOICE,
    ...ONBOARDING_OK,
    'law:preflight': GREEN,
    'width:read': { exit: 0, width: 'wide' },
    'wide:prep': { exit: 0 },
    'wide:draft-a': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'a' },
    'wide:draft-b': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'b' },
    'wide:adjust-a': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'a2', converged: false },
    'wide:adjust-b': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'b2', converged: false },
    // A non-converged pair now runs the adjudicator (S3); this test only inspects the two author
    // scaffolds already captured above, so a held adjudicator leg suffices — no ratify/seal needed.
    'wide:adjudicate': { facts: { status: 'transport-failure', pointers: [], schema_valid: false }, narration_beat: '' },
    'state:write': GREEN,
  })
  // Normalize ONLY the neutral A/B candidate paths; scaffolds that differ solely there are isomorphic.
  const norm = (s) => s
    .split('.kiln/.wide/a-adjusted').join('WIDE_ADJ')
    .split('.kiln/.wide/b-adjusted').join('WIDE_ADJ')
    .split('.kiln/.wide/a').join('WIDE_DIR')
    .split('.kiln/.wide/b').join('WIDE_DIR')
  const dA = calls.find(c => c.label === 'wide:draft-a').prompt
  const dB = calls.find(c => c.label === 'wide:draft-b').prompt
  assert.equal(norm(dA), norm(dB), 'the two draft scaffolds are isomorphic modulo the A/B candidate dir')
  const aA = calls.find(c => c.label === 'wide:adjust-a').prompt
  const aB = calls.find(c => c.label === 'wide:adjust-b').prompt
  assert.equal(norm(aA), norm(aB), 'the two adjust scaffolds are isomorphic modulo the A/B candidate dirs')
  // Each adjust cross-reads ONLY the OTHER draft, with no author identity supplied.
  assert.ok(aA.includes('.kiln/.wide/b') && aA.includes('no author identity'), 'adjust-a cross-reads the b draft with no provenance')
  assert.ok(aB.includes('.kiln/.wide/a') && aB.includes('no author identity'), 'adjust-b cross-reads the a draft with no provenance')
  // No orchestration family/persona/model token rides either author scaffold (prompt-level anonymity).
  for (const p of [dA, dB, aA, aB]) {
    for (const token of ['fable', 'gpt', 'opus', 'sonnet', 'codex', 'sol']) {
      assert.ok(!new RegExp('\\b' + token + '\\b', 'i').test(p), 'no orchestration token "' + token + '" in a WIDE author scaffold')
    }
  }
})

test('runtime (W5-S2, content-blind): the WIDE branch decides on width + converged + byte-equality closed facts — cmp -s on the two adjusted LAW.md, never a plan read', async () => {
  const { calls } = await runKernel({ stage: 'law', projectDir: '/p' }, WIDE_PROMOTE_RUN)
  const cmp = calls.find(c => c.label === 'wide:byte-equal')
  assert.ok(cmp.prompt.includes('cmp -s') && cmp.prompt.includes('/LAW.md'), 'byte-equality is a closed cmp -s fact on the two adjusted LAW.md — the kernel never opens the plan')
  assert.ok(cmp.prompt.includes('.kiln/.wide/a-adjusted/LAW.md') && cmp.prompt.includes('.kiln/.wide/b-adjusted/LAW.md'), 'the cmp compares the two isolated adjusted candidates')
  const width = calls.find(c => c.label === 'width:read')
  assert.ok(width.prompt.includes('the value of the "width" field'), 'the width read is a closed dial projection, never a posture parse in the kernel body')
})

test('runtime (builder-leg 404 pin): a gpt-routed surface fails closed at boot — the codex id never reaches an agent dispatch', async () => {
  // The exact 48e5fed defect shape: surface_routing.logic -> builder-logic with the
  // seat gpt-family. Under the defective kernel this config booted, the slice leg
  // dispatched with model gpt-5.6-sol, and the Anthropic API answered 404
  // model_not_found (cleanroom receipt req_011CdBugiPWMovjbvkCV1L9c) — converted to
  // transport-failure twice, then hard-stop 3. The repaired kernel halts at boot
  // with the named configuration fact; the full build script below stands ready
  // so a regression would run it and trip the assertions. Since simple-fire the
  // SHIPPED builder-logic seat is claude (GPT codes through a bash call in the
  // card), so the defect shape is recreated by flipping the family back to gpt.
  const boot = JSON.parse(JSON.stringify(TIERS_OK))
  boot.surface_routing.logic = 'builder-logic'
  boot.roles['builder-logic'] = { family: 'gpt', alias: 'gpt-sol', effort: 'high' }
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    'tiers:boot': boot,
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|logic'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'tiers-config-invalid', 'the gpt-routed surface halts at boot, never mid-build')
  assert.deepEqual(calls.map(c => c.label), ['run-lock:join', 'tiers:boot'], 'the run-lock join precedes the boot; nothing dispatches after the failed boot')
  for (const c of calls) {
    assert.notEqual(c.opts && c.opts.model, 'gpt-5.6-sol', 'the resolver-concrete codex id must never be an agent model option')
  }
})

test('runtime (T-03): an object slice with an unknown or missing surface halts before any builder dispatch', async () => {
  for (const entry of ['obj|s1|bogus', 'obj|s1|', 'obj||ui']) {
    const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
      ...VOICE, 'law:preflight': GREEN, 'slices:fetch': { exit: 0, ids: [entry] }, 'ladder:fetch': LADDER, 'state:write': GREEN,
    })
    assert.equal(ret.status, 'slices-invalid', entry + ' must halt closed')
    assert.ok(!calls.some(c => c.label && c.label.startsWith('slice:')), entry + ': no builder leg dispatches')
  }
})

test('runtime (B2): a build with no slice list routes the operator back to LAW, not build', async () => {
  // The slice list is authored by the LAW producer; a build that finds none must send the
  // operator to LAW. The hint names the TARGET stage (law), never the current build stage.
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE, 'law:preflight': GREEN, 'slices:fetch': { exit: 0, ids: [] }, 'ladder:fetch': LADDER, 'state:write': GREEN,
  })
  assert.equal(ret.status, 'transport-failure')
  assert.equal(stateArgs(calls).key, 'rerun-law', 'the STATE routes back to LAW, not the current build stage')
})

test('runtime (B4): slices-invalid records active_slice none UNCONDITIONALLY — a malformed descriptor names no in-plan slice', async () => {
  // Two shapes of invalid descriptor: a malformed id ('bad slice'), and a GRAMMAR-VALID id
  // inside an otherwise-invalid descriptor ('obj|s1|bogus', bad surface). Neither is a
  // trustworthy slice, so STATE names none in both — never the id from a rejected
  // descriptor. The second case fails against a `badSlice.id || 'none'` that leaks s1. The
  // CLI rejection of a malformed NON-none slice id is a tamper guard, not this live path.
  for (const entry of ['obj|bad slice|ui', 'obj|s1|bogus']) {
    const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
      ...VOICE, 'law:preflight': GREEN, 'slices:fetch': { exit: 0, ids: [entry] },
      'ladder:fetch': LADDER, 'state:write': GREEN,
    })
    assert.equal(ret.status, 'slices-invalid', entry + ' halts closed')
    assert.equal(stateArgs(calls).slice, 'none', entry + ': STATE names none, never the descriptor id')
  }
})

// ── Simple-fire: the check receipt and the surface-branched gate ────────────

test('core (simple-fire): verdictExit maps claude gate verdicts onto the closed exit table, unknown fails closed', () => {
  assert.equal(verdictExit('accept'), 0)
  assert.equal(verdictExit('changes_required'), 10)
  assert.equal(verdictExit('blocked'), 11)
  assert.equal(verdictExit('maybe'), 20, 'an unrecognized verdict is a transport failure')
  assert.equal(verdictExit(undefined), 20)
})

test('core (simple-fire): LAW_CHECK_RECEIPT captures the full check output verbatim — stdout and exit code survive', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-receipt-'))
  mkdirSync(join(dir, '.kiln/law'), { recursive: true })
  writeFileSync(join(dir, '.kiln/law/check.sh'), 'echo s1\necho boom >&2\nexit 3\n')
  const r = spawnSync('bash', ['-c', LAW_CHECK_RECEIPT], { cwd: dir, encoding: 'utf8' })
  assert.equal(r.status, 3, 'the check exit code survives the capture')
  assert.equal(r.stdout, 's1\nboom\n', 'the full output still reaches stdout for the ids fetch')
  assert.equal(readFileSync(join(dir, '.kiln/check-receipt.txt'), 'utf8'), 's1\nboom\n',
    'the receipt holds the full output verbatim — the evidence the reviewer judges instead of executing')
})

test('core (W2-S3): the LAW check builders wrap the fused run-checks verb — sealed-trio regime, torn-seal hold, pre-seal fallback, and a whitespace-safe plugin path (B05)', () => {
  // B05: a plugin root with a space still builds a command that parses — the path is
  // single-quoted so it stays ONE argv word, asserted via the builder output, not a live spawn.
  const kr = '/DEV/My Kiln/plugins/kiln/scripts/kiln-review'
  const sel = sealedLawCheck(kr)
  assert.ok(sel.includes("node '/DEV/My Kiln/plugins/kiln/scripts/kiln-review' run-checks .kiln"),
    'a sealed trio verifies-and-runs through run-checks with the whitespace plugin path single-quoted — one argv word')
  assert.ok(sel.includes('elif test -f .kiln/law/lock.hash') && sel.includes('exit ' + TRIO_MISMATCH),
    'a sealed law whose trio.hash is gone is a torn seal that exits TRIO_MISMATCH')
  assert.ok(sel.includes('elif test -f .kiln/law/check.sh; then bash .kiln/law/check.sh'),
    'an unsealed law still authoring its trio runs check.sh bare — nothing sealed to verify yet')
  const receipt = lawCheckReceipt(kr)
  assert.ok(receipt.startsWith('( ' + sel + ' )') && receipt.includes('> .kiln/check-receipt.txt'),
    'the receipt wraps the same selector in a subshell so the regime exit still cats and survives')
})

test('core (W2-S3): over a real sealed trio the receipt runs check.sh through run-checks — output verbatim, the exit through, and a tampered member exits TRIO_MISMATCH without running the check', () => {
  const kr = fileURLToPath(new URL('../scripts/kiln-review', import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), 'kiln-fused-'))
  mkdirSync(join(dir, '.kiln/law'), { recursive: true })
  writeFileSync(join(dir, '.kiln/LAW.md'), 'the law\n')
  writeFileSync(join(dir, '.kiln/law/check.sh'), 'echo s1\ntouch .kiln/ran\nexit 1\n')
  writeFileSync(join(dir, '.kiln/slices.json'), '[{"id":"s1","surface":"mixed"}]')
  assert.equal(spawnSync('node', [kr, 'seal-law', '.kiln', 'dual'], { cwd: dir }).status, 0, 'the trio seals')
  const red = spawnSync('bash', ['-c', lawCheckReceipt(kr)], { cwd: dir, encoding: 'utf8' })
  assert.equal(red.status, 1, 'the red check exit passes through the fused receipt')
  assert.equal(red.stdout, 's1\n', 'the owning-slice id reaches stdout verbatim through run-checks')
  assert.equal(readFileSync(join(dir, '.kiln/check-receipt.txt'), 'utf8'), 's1\n', 'the receipt holds the fused output')
  spawnSync('rm', ['-f', join(dir, '.kiln/ran')])
  writeFileSync(join(dir, '.kiln/slices.json'), '[{"id":"other"}]')
  const torn = spawnSync('bash', ['-c', lawCheckReceipt(kr)], { cwd: dir, encoding: 'utf8' })
  assert.equal(torn.status, TRIO_MISMATCH, 'a tampered trio member exits TRIO_MISMATCH through the receipt')
  assert.ok(!existsSync(join(dir, '.kiln/ran')), 'check.sh never ran on the tamper')
})

test('core (W2-S3 B02): the selector treats lock.seal-only residue as a partial seal — the preflight leg holds 22 at the production selector and check.sh NEVER runs', () => {
  const kr = fileURLToPath(new URL('../scripts/kiln-review', import.meta.url))
  const sel = sealedLawCheck(kr)
  // Source pin: the selector enters the sealed regime on ANY of the three seal artifacts, so no
  // partial residue falls to the bare check.sh branch.
  assert.ok(sel.includes('.kiln/law/trio.hash') && sel.includes('.kiln/law/lock.hash') && sel.includes('.kiln/law/lock.seal'),
    'the selector tests all three seal artifacts')
  // Production pin: only lock.seal + a sentinel check.sh on disk — the real selector must hold 22.
  const dir = mkdtempSync(join(tmpdir(), 'kiln-sealonly-'))
  mkdirSync(join(dir, '.kiln/law'), { recursive: true })
  writeFileSync(join(dir, '.kiln/law/lock.seal'), 'a'.repeat(64) + ' dual\n')
  writeFileSync(join(dir, '.kiln/law/check.sh'), 'touch .kiln/ran\nexit 0\n')
  const r = spawnSync('bash', ['-c', sel], { cwd: dir, encoding: 'utf8' })
  assert.equal(r.status, TRIO_MISMATCH, 'lock.seal-only residue holds trio_mismatch, never the bare pre-seal branch')
  assert.ok(!existsSync(join(dir, '.kiln/ran')), 'check.sh never ran — no report can return done over an unchecked partial seal')
})

test('runtime (W2-S3): every post-seal check leg runs the fused run-checks verb, and a torn trio (exit 22) holds fail-closed instead of sealing', async () => {
  const base = (extra) => ({
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|logic'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'gate:invalidate': { exit: 0 },
    'gate-claude:review': OK_ACK,
    'gate:read': readCandidate(GATE_ACCEPT),
    'gate:publish': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
    ...extra,
  })
  // Production wiring: the pre-seal receipt leg runs run-checks over the cwd-relative kiln dir.
  const ok = await runKernel({ stage: 'build', projectDir: '/p' }, base())
  assert.equal(ok.ret.status, 'ok')
  const preSeal = ok.calls.find(c => c.label === 'law:pre-seal')
  assert.ok(preSeal.prompt.includes("node '" + PLUGIN + "/scripts/kiln-review' run-checks .kiln"),
    'the pre-seal leg runs the fused verify-and-run verb with the plugin path shq-quoted, not a bare check')
  assert.ok(preSeal.prompt.includes('> .kiln/check-receipt.txt'), 'and still captures the receipt the reviewer judges')
  // A torn trio at the pre-seal receipt holds fail-closed — no seal, no advance.
  const torn = await runKernel({ stage: 'build', projectDir: '/p' }, base({ 'law:pre-seal': { exit: 22, ids: [] } }))
  assert.equal(torn.ret.status, 'transport-failure', 'a trio_mismatch at the seal holds — a tampered law is never sealed')
  assert.ok(!torn.calls.some(c => c.label === 'seal:append'), 'nothing seals over a torn trio')
})

test('runtime (W2-S3): a torn trio at the resume preflight door holds fail-closed instead of proceeding as a mere law red', async () => {
  const held = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': { exit: 22, ids: [] },
    'state:write': GREEN,
  })
  assert.equal(held.ret.status, 'transport-failure', 'the resume door holds on a trio_mismatch, never proceeds')
  assert.ok(!held.calls.some(c => c.label === 'slices:fetch'), 'the build never begins over a torn trio')
})

test('runtime (W2-S3 B03): a slices.json tampered after preflight holds at the fused build-order fetch — no write-capable builder is dispatched', async () => {
  const held = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 22, ids: [] }, // the fused slices verb held a tampered slices.json
    'state:write': GREEN,
  })
  assert.equal(held.ret.status, 'transport-failure', 'the fused build-order fetch holds on a trio_mismatch')
  assert.ok(!held.calls.some(c => c.label.startsWith('slice:')), 'no builder runs over drifted build-order facts — the repository side effect never happens')
})

test('runtime (simple-fire): the gate branches on the surface — logic and mixed take the claude gate, ui alone keeps codex', async () => {
  const build = (entry, extra) => ({
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: [entry] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
    ...extra,
  })
  const logic = await runKernel({ stage: 'build', projectDir: '/p' }, build('obj|s1|logic', {
    'gate:invalidate': { exit: 0 },
    'gate-claude:review': OK_ACK,
    'gate:read': readCandidate(GATE_ACCEPT),
    'gate:publish': { exit: 0 },
  }))
  assert.equal(logic.ret.status, 'ok')
  assert.ok(!logic.calls.some(c => c.label === 'gate:review' || c.label === 'gate:recheck'),
    'codex never dispatches for a GPT-coded slice — cross-family law')
  const claude = logic.calls.find(c => c.label === 'gate-claude:review')
  assert.ok(claude, 'the claude gate dispatches for the logic surface')
  assert.ok(claude.prompt.includes('.kiln/check-receipt.txt'), 'the claude gate names the kernel-side check receipt')
  assert.ok(claude.prompt.includes('Execute nothing'), 'the reviewer is told to execute nothing')
  assert.ok(claude.prompt.includes('review-schema.json'), 'the strict verdict schema is named')
  assert.ok(claude.prompt.includes('.kiln/.gate-review.reviewer.tmp'),
    'the reviewer is told to write its verdict to the candidate file as the final act of its turn')
  assert.deepEqual(claude.opts.schema, {
    type: 'object', additionalProperties: false,
    properties: { ok: { type: 'boolean' } }, required: ['ok'],
  }, 'the reviewer return is the light {ok} ack — verdict authority lives in the file it writes')
  const invalidate = logic.calls.find(c => c.label === 'gate:invalidate')
  assert.ok(invalidate && invalidate.prompt.includes('rm -f') && invalidate.prompt.includes('.kiln/.gate-review.reviewer.tmp'),
    'the kernel invalidates the candidate before the reviewer runs — stale-candidate prevention')
  assert.ok(logic.calls.findIndex(c => c.label === 'gate:invalidate') < logic.calls.findIndex(c => c.label === 'gate-claude:review'),
    'the invalidation lands before the reviewer is invoked')
  const read = logic.calls.find(c => c.label === 'gate:read')
  assert.ok(read && read.prompt.includes('cat ') && read.prompt.includes('.kiln/.gate-review.reviewer.tmp'),
    'the kernel reads the candidate back as raw bytes — never require()+JSON.stringify')
  const publish = logic.calls.find(c => c.label === 'gate:publish')
  assert.ok(publish && publish.prompt.includes('publish-gate .kiln review') && publish.prompt.includes('.kiln/.gate-review.reviewer.tmp') && publish.prompt.includes('.kiln/gate-review.json'),
    'the kernel promotes the reviewer-written candidate through the W2-S5 archive-then-publish verb — the review-family verdict is archived before the content-free overwrite')
  const preSeal = logic.calls.find(c => c.label === 'law:pre-seal')
  assert.ok(preSeal.prompt.includes(LAW_CHECK_RECEIPT), 'the pre-seal leg runs the receipt-capturing check verbatim')
  assert.ok(logic.ret.beat.includes('Slice s1 sealed — dual'), 'a claude-gated logic slice seals dual')
  const mixed = await runKernel({ stage: 'build', projectDir: '/p' }, build('obj|s1|mixed', {
    'gate:invalidate': { exit: 0 },
    'gate-claude:review': OK_ACK,
    'gate:read': readCandidate(GATE_ACCEPT),
    'gate:publish': { exit: 0 },
  }))
  assert.equal(mixed.ret.status, 'ok')
  assert.ok(mixed.calls.some(c => c.label === 'gate-claude:review'), 'the claude gate dispatches for the mixed surface too — GPT codes mixed')
  assert.ok(!mixed.calls.some(c => c.label === 'gate:review' || c.label === 'gate:recheck'),
    'codex never dispatches for a GPT-coded mixed slice — cross-family law')
  const ui = await runKernel({ stage: 'build', projectDir: '/p' }, build('obj|s1|ui', { 'gate:review': { exit: 0 } }))
  assert.equal(ui.ret.status, 'ok')
  assert.ok(ui.calls.some(c => c.label === 'gate:review'), 'ui keeps the codex gate through scripts/kiln-review')
  assert.ok(!ui.calls.some(c => c.label && c.label.startsWith('gate-claude')), 'no claude gate on the ui surface')
})

const claudeGateScript = (extra) => ({
  ...VOICE,
  'law:preflight': GREEN,
  'slices:fetch': { exit: 0, ids: ['obj|s1|logic'] },
  'ladder:fetch': LADDER,
  'cap:read': { exit: 0, recovery_cap: 2 },
  'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
  'law:pre-seal': GREEN,
  'law:stage-end': GREEN,
  'degraded:check': { exit: 1 },
  'gate:invalidate': { exit: 0 },
  'gate-claude:review': OK_ACK,
  'gate:publish': { exit: 0 },
  'seal:append': { exit: 0 },
  'state:write': GREEN,
  ...extra,
})

test('runtime (W2-S4): the claude gate binds law_hash to the CROSS-BOUND sealed digest — a verdict echoing any other hash fails closed and never publishes', async () => {
  const withHash = (verdictHash) => claudeGateScript({
    'gate-claude:facts': { exit: 0, ids: ['a'.repeat(64)] },
    'gate:read': readCandidate({ review_id: 'r1', law_hash: verdictHash, findings: [], blockers: [], verdict: 'accept' }),
  })
  const good = await runKernel({ stage: 'build', projectDir: '/p' }, withHash('a'.repeat(64)))
  assert.equal(good.ret.status, 'ok', 'a verdict echoing the cross-bound sealed digest validates, publishes and seals')
  const bad = await runKernel({ stage: 'build', projectDir: '/p' }, withHash('b'.repeat(64)))
  assert.equal(bad.ret.status, 'transport-failure', 'a verdict echoing any hash but the sealed one fails the semantic mirror')
  assert.ok(!bad.calls.some(c => c.label === 'gate:publish'), 'the wrong-hash verdict never publishes')
})

test('runtime (W2-S4): a trio mutated across the write-capable claude gate turn fails the post-turn confirm — nothing publishes', async () => {
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, claudeGateScript({
    'gate:read': readCandidate(GATE_ACCEPT),
    // The reviewer turn mutated a trio member: the post-turn confirm differs from the sealed d0.
    'gate-claude:trio-confirm': { exit: 0, ids: ['x1', 'x2', 'x3'] },
  }))
  assert.equal(ret.status, 'transport-failure', 'a trio drift across the claude turn holds fail-closed')
  assert.ok(!calls.some(c => c.label === 'gate:publish'), 'the mutated-trio verdict never publishes')
})

test('runtime (W2-S4): the claude gate derives its facts from the ONE sealed authority via gate-facts (production-wiring pin)', () => {
  // Beside the runtime behavior: the claude gate must route law_hash and the filtered hints through
  // the gate-facts verb (the same buildGateFacts/hintsFrom authority the codex packet uses) — the
  // B02 cross-binding and the B04 hint filtering — and classify a torn seal as the integrity class,
  // never resurrect the bare lock.hash read or feed the reviewer the raw request (the W2-S2
  // helper-plus-wiring lesson).
  assert.ok(src.includes("'gate-claude:facts'") && src.includes('gate-facts .kiln '),
    'the claude gate calls the gate-facts verb for its cross-bound law_hash and filtered hints')
  assert.ok(!src.includes("'gate-claude:lawhash'") && !src.includes("'gate-claude:request'"),
    'the bare un-cross-bound lock.hash leg and the standalone request guard are gone — folded into gate-facts')
  assert.ok(src.includes("trioSealed('gate-claude:trio-sealed')") && src.includes("trioDigest('gate-claude:trio-digest')") && src.includes("trioDigest('gate-claude:trio-confirm')"),
    'the write-capable claude turn is bracketed before and after by the sealed-trio digest')
  assert.ok(src.includes('gate-claude:facts') && src.includes('trioTorn = true'),
    'a torn seal at gate-facts or the bracket sets trioTorn — routed to the both-family TRIO_MISMATCH hold, not transport 20')
  assert.ok(src.includes('Do not read the raw review request'),
    'the reviewer reads the trusted filtered gate-facts file, never the raw request')
  assert.ok(!src.includes("'request:hash'"), 'the original builder-request law_hash fetch is gone from the kernel')
})

test('runtime (W2-S4): a torn or swapped seal at the claude gate holds the integrity class — no reviewer spawns, nothing publishes (B02/B03)', async () => {
  // gate-facts runs buildGateFacts, so a swapped lock.hash or any torn trio exits TRIO_MISMATCH.
  // The claude gate sets trioTorn and the after-loop routes to trioMismatchHold — the integrity
  // hold, both families consistent — before any reviewer spawns.
  const torn = await runKernel({ stage: 'build', projectDir: '/p' }, claudeGateScript({
    'gate-claude:facts': { exit: TRIO_MISMATCH, ids: [] },
  }))
  assert.equal(torn.ret.status, 'transport-failure', 'a torn seal holds the run')
  assert.ok(!torn.calls.some(c => c.label === 'gate-claude:review'), 'no reviewer spawns over a torn seal')
  assert.ok(!torn.calls.some(c => c.label === 'gate:publish'), 'nothing publishes')
  // B03 DISTINCTIVELY: the operator hint must be the INTEGRITY class (trioMismatchHold →
  // 'Rerun the stage after restoring the sealed law' → key rerun-stage), NOT the plain transport
  // hold ('Rerun stage build after fixing the transport' → key rerun-build). Collapsing the torn
  // seal to a bare transport 20 would swap this key and this assertion catches it.
  assert.equal(stateArgs(torn.calls).key, 'rerun-stage', 'a torn seal earns the restore-the-sealed-law hint, never the fix-the-transport hint')
  // A pre-turn trio-digest drift (d0 disagrees with the sealed trio) is the same integrity class.
  const drift = await runKernel({ stage: 'build', projectDir: '/p' }, claudeGateScript({
    'gate-claude:trio-digest': { exit: 0, ids: ['x1', 'x2', 'x3'] },
  }))
  assert.equal(drift.ret.status, 'transport-failure', 'a pre-turn trio drift holds the run')
  assert.ok(!drift.calls.some(c => c.label === 'gate-claude:review'), 'no reviewer spawns over a pre-turn drift')
  assert.equal(stateArgs(drift.calls).key, 'rerun-stage', 'a pre-turn drift earns the integrity-class hint too, not the transport hint')
})

test('runtime (simple-fire): a claude gate reject walks the same repair loop — recheck rides the claude gate too', async () => {
  const reject = {
    review_id: 'r1', law_hash: 'a'.repeat(64), blockers: [], verdict: 'changes_required',
    findings: [{ id: 'F1', criterion: 'c', location: 'x.mjs:1', failure_mode: 'f', evidence: 'e', minimal_fix: 'm' }],
  }
  const reads = [reject, GATE_ACCEPT]
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|logic'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'law:pre-recheck': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'gate:invalidate': { exit: 0 },
    'gate-claude:review': OK_ACK,
    'gate-claude:recheck': OK_ACK,
    // The kernel snapshots the prior gate before the recheck judges: review_id r1, cohort {F1}.
    'recheck:cohort': { exit: 0, ids: ['r1', 'F1'] },
    'gate:read': () => readCandidate(reads.shift()),
    'gate:publish': { exit: 0 },
    'findings:fetch': { exit: 0, ids: ['F1'] },
    'repair:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'repaired' },
    'delta:check': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'reject then repaired recheck seals')
  const recheck = calls.find(c => c.label === 'gate-claude:recheck')
  assert.ok(recheck, 'the recheck rides the claude gate too')
  assert.ok(recheck.prompt.includes('.kiln/repair-delta.md'), 'the recheck reads the repair delta')
  // S2: the receipt is rerun fresh before the recheck round — never a stale
  // pre-repair receipt under any gate family.
  const labels = calls.map(c => c.label)
  assert.ok(labels.indexOf('law:pre-recheck') >= 0, 'the pre-recheck receipt rerun dispatches')
  assert.ok(labels.indexOf('law:pre-recheck') > labels.indexOf('repair:s1'), 'the rerun lands after the repair')
  assert.ok(labels.indexOf('law:pre-recheck') < labels.indexOf('gate-claude:recheck'), 'and before the recheck judges')
  assert.equal(calls.filter(c => c.label === 'gate:publish').length, 2, 'both verdicts published to the gate file')
  assert.ok(!calls.some(c => c.label === 'gate:review' || c.label === 'gate:recheck'), 'codex never dispatches')
  assert.ok(calls.find(c => c.label === 'repair:s1').prompt.includes('(surface logic)'),
    'the repair prompt carries the closed surface fact for the card')
})

test('runtime (W6-S3 dogfood, build): a recheck that clears nothing holds immediately — no strict progress, the edge spent, well under the cap, never a seal', async () => {
  // The review and the recheck report the SAME cohort {F1}: the repair edge was spent but nothing
  // cleared, so recoveryDecision holds on the first recheck even though the cap (2) has an edge
  // left. Equality is no progress — the loop never walks to the cap, and nothing seals over a stall.
  const finding = { id: 'F1', criterion: 'c', location: 'x.mjs:1', failure_mode: 'f', evidence: 'e', minimal_fix: 'm' }
  const reject = { review_id: 'r1', law_hash: 'a'.repeat(64), blockers: [], verdict: 'changes_required', findings: [finding] }
  const reads = [reject, reject] // the recheck clears nothing — an equal cohort
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|logic'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'law:pre-recheck': GREEN,
    'degraded:check': { exit: 1 },
    'gate:invalidate': { exit: 0 },
    'gate-claude:review': OK_ACK,
    'gate-claude:recheck': OK_ACK,
    'recheck:cohort': { exit: 0, ids: ['r1', 'F1'] },
    'gate:read': () => readCandidate(reads.shift()),
    'gate:publish': { exit: 0 },
    'findings:fetch': { exit: 0, ids: ['F1'] },
    'repair:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'repaired' },
    'delta:check': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'blocked', 'a non-shrinking recheck is an operator-ruling hold, not a transport fault')
  assert.equal(calls.filter(c => c.label === 'repair:s1').length, 1, 'exactly one repair edge spent — the equality holds before the cap of 2')
  assert.equal(calls.filter(c => c.label === 'gate:publish').length, 2, 'the review and the one recheck each published; no third gate ran')
  assert.ok(!calls.some(c => c.label === 'seal:append'), 'nothing seals over a stalled gate')
})

test('runtime (W6-XF-01): the claude recheck is bound to the snapshotted prior cohort — a renamed review_id or a new finding fails closed, never publishes, never seals', async () => {
  const finding = (id) => ({ id, criterion: 'c', location: 'x.mjs:1', failure_mode: 'f', evidence: 'e', minimal_fix: 'm' })
  const reject = { review_id: 'r1', law_hash: 'a'.repeat(64), blockers: [], verdict: 'changes_required', findings: [finding('F1')] }
  // The recheck reuses the issued review_id but SMUGGLES a finding id outside the
  // snapshotted prior cohort {F1} — the same tamper scripts/kiln-review rejects.
  const outOfCohort = { ...reject, findings: [finding('F1'), finding('F2')] }
  // The recheck RENAMES the issued review_id — a fresh lineage the kernel rejects.
  const renamedId = { ...reject, review_id: 'r2' }
  const build = (recheckVerdict) => {
    const reads = [reject, recheckVerdict]
    return {
      ...VOICE,
      'law:preflight': GREEN,
      'slices:fetch': { exit: 0, ids: ['obj|s1|logic'] },
      'ladder:fetch': LADDER,
      'cap:read': { exit: 0, recovery_cap: 2 },
      'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
      'law:pre-seal': GREEN,
      'law:pre-recheck': GREEN,
      'degraded:check': { exit: 1 },
      'gate:invalidate': { exit: 0 },
      'gate-claude:review': OK_ACK,
      'gate-claude:recheck': OK_ACK,
      // The prior published gate the kernel snapshots before the recheck judges.
      'recheck:cohort': { exit: 0, ids: ['r1', 'F1'] },
      'gate:read': () => readCandidate(reads.shift()),
      'gate:publish': { exit: 0 },
      'findings:fetch': { exit: 0, ids: ['F1'] },
      'repair:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'repaired' },
      'delta:check': { exit: 0 },
      'seal:append': { exit: 0 },
      'state:write': GREEN,
    }
  }
  for (const [name, verdict] of [['a new out-of-cohort finding', outOfCohort], ['a renamed review_id', renamedId]]) {
    const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, build(verdict))
    const cohort = calls.find(c => c.label === 'recheck:cohort')
    assert.ok(cohort && cohort.prompt.includes('.kiln/gate-review.json'),
      name + ': the kernel snapshots the prior gate before the recheck judges')
    assert.equal(ret.status, 'transport-failure', name + ' fails the recheck closed, exactly as the codex transport rejects it')
    assert.equal(calls.filter(c => c.label === 'gate:publish').length, 1,
      name + ': only the first review published — the tainted recheck never promotes')
    assert.ok(!calls.some(c => c.label === 'seal:append'), name + ': nothing seals')
    assert.ok(!ret.beat.includes('sealed'), name + ': never a seal')
  }
})

test('runtime (S2/S3): a codex-dead logic slice stops for acknowledgment, then convenes the opus fallback gate and seals single-family, never dual', async () => {
  // The builder lost codex at build time, created .kiln/degraded per the build
  // card, and built the slice itself. S3: the kernel discovers the marker
  // pre-gate WITHOUT the acknowledgment record and takes the same degraded
  // hard-stop the exit-21 path takes — never a silent ok seal.
  const base = {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|logic'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
  }
  const stopped = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...base,
    'degraded-ack:check': { exit: 1 },
    'degraded:mark': { exit: 0 },
  })
  assert.equal(stopped.ret.status, 'degraded', 'a builder-marked degradation stops for acknowledgment')
  assert.ok(stopped.ret.beat.includes('Codex is not answering'), 'the sealed degradation template arrives')
  assert.ok(!stopped.calls.some(c => c.label && c.label.startsWith('gate')), 'no gate dispatches on the stop')
  assert.ok(!stopped.calls.some(c => c.label === 'seal:append'), 'nothing seals before acknowledgment')
  assert.ok(!stopped.ret.beat.includes('sealed'), 'never an ok seal over an unacknowledged marker')
  // After acknowledgment (the relaunch) the codex-absent fallback is RESTORED
  // (v3 duo-pool.json:7 logic_fallback): the sonnet-built logic slice STILL faces
  // a gate — a fresh OPUS mind, a different model than the sonnet builder, the
  // best split without a second family. The seal still reads the marker, so it
  // speaks single-family; the codex gate never dispatches (codex is gone).
  const acked = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...base,
    'degraded-ack:check': { exit: 0 },
    'gate:invalidate': { exit: 0 },
    'gate-claude:review': OK_ACK,
    'gate:read': readCandidate(GATE_ACCEPT),
    'gate:publish': { exit: 0 },
  })
  assert.equal(acked.ret.status, 'ok')
  assert.ok(acked.ret.beat.includes('Slice s1 sealed — single-family'), 'the seal speaks single-family')
  assert.ok(!acked.ret.beat.includes('dual'), 'never dual on a codex-dead run')
  const fallbackGate = acked.calls.find(c => c.label === 'gate-claude:review')
  assert.ok(fallbackGate, 'the degraded logic slice convenes the claude gate — review is not skipped')
  assert.equal(fallbackGate.opts.model, 'opus', 'the fallback reviewer is opus — a different model than the sonnet builder (the best split)')
  assert.equal(fallbackGate.opts.effort, 'high', 'the fallback gate runs at the fallback-reviewer effort')
  assert.ok(!acked.calls.some(c => c.label === 'gate:review' || c.label === 'gate:recheck'), 'the codex gate never dispatches — codex is gone, the fallback is a fresh claude mind')
  // A ui slice during a degraded, acknowledged run keeps its honest shape: a
  // cross-family codex gate is impossible without codex and a same-family gate
  // would review claude-built ui with claude, so it skips the gate entirely.
  const ackedUi = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...base,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui'] },
    'degraded-ack:check': { exit: 0 },
  })
  assert.equal(ackedUi.ret.status, 'ok')
  assert.ok(ackedUi.ret.beat.includes('Slice s1 sealed — single-family'), 'the ui degraded seal speaks single-family')
  assert.ok(!ackedUi.calls.some(c => c.label && c.label.startsWith('gate')), 'no gate dispatches on the degraded ui path — review is impossible cross-family without codex')
  // Any gate path: codex died during a repair pass, the builder marked
  // .kiln/degraded and repaired the slice itself, and the claude gate accepted
  // the recheck — the label still reads the marker at seal time.
  const reject = {
    review_id: 'r1', law_hash: 'a'.repeat(64), blockers: [], verdict: 'changes_required',
    findings: [{ id: 'F1', criterion: 'c', location: 'x.mjs:1', failure_mode: 'f', evidence: 'e', minimal_fix: 'm' }],
  }
  const degradedChecks = [1, 0] // absent before the gate, present at seal time
  const midReads = [reject, GATE_ACCEPT]
  const midRun = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|logic'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'law:pre-recheck': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': () => ({ exit: degradedChecks.shift() }),
    'gate:invalidate': { exit: 0 },
    'gate-claude:review': OK_ACK,
    'gate-claude:recheck': OK_ACK,
    'recheck:cohort': { exit: 0, ids: ['r1', 'F1'] },
    'gate:read': () => readCandidate(midReads.shift()),
    'gate:publish': { exit: 0 },
    'findings:fetch': { exit: 0, ids: ['F1'] },
    'repair:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'repaired' },
    'delta:check': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(midRun.ret.status, 'ok')
  assert.ok(midRun.calls.some(c => c.label === 'gate-claude:recheck'), 'a gate ran on this path')
  assert.equal(midRun.calls.find(c => c.label === 'gate-claude:review').opts.model, undefined,
    'the marker appeared AFTER the gate decision, so the normal stage-card (inherit) gate ran, not the opus fallback')
  assert.ok(midRun.ret.beat.includes('Slice s1 sealed — single-family'), 'the marker rules the label even when a gate ran')
  assert.ok(!midRun.ret.beat.includes('— dual'), 'never a dual label over a same-family repair')
})

// ── S1/S2 repairs: the claude-gate semantic mirror and the fresh-receipt law ─

test('core (S1): gateReviewInvalid mirrors the kiln-review semantic law — every named violation', () => {
  const LAW = 'a'.repeat(64)
  const ok = { review_id: 'r1', law_hash: LAW, findings: [], blockers: [], verdict: 'accept' }
  const finding = { id: 'F1', criterion: 'c', location: 'x.mjs:1', failure_mode: 'f', evidence: 'e', minimal_fix: 'm' }
  assert.equal(gateReviewInvalid(ok, LAW), null, 'a sound accept passes')
  assert.equal(gateReviewInvalid({ ...ok, verdict: 'changes_required', findings: [finding] }, LAW), null, 'a sound reject passes')
  assert.equal(gateReviewInvalid({ ...ok, verdict: 'blocked', blockers: ['no repo access'] }, LAW), null, 'a sound block passes')
  assert.equal(gateReviewInvalid(null, LAW), 'not-an-object')
  assert.equal(gateReviewInvalid({ ...ok, verdict: 'maybe' }, LAW), 'verdict-unrecognized', 'the verdict enum is closed')
  assert.equal(gateReviewInvalid({ ...ok, law_hash: 'b'.repeat(64) }, LAW), 'law-hash-mismatch', 'a wrong law hash never passes')
  assert.equal(gateReviewInvalid({ ...ok, law_hash: '' }, LAW), 'law-hash-mismatch')
  assert.equal(gateReviewInvalid({ ...ok, findings: [finding] }, LAW), 'accept-with-findings', 'accept demands empty findings')
  assert.equal(gateReviewInvalid({ ...ok, blockers: ['b'] }, LAW), 'accept-with-findings', 'accept demands empty blockers')
  assert.equal(gateReviewInvalid({ ...ok, blockers: [' '], verdict: 'blocked' }, LAW), 'blockers-shape', 'blockers must be nonempty strings')
  assert.equal(gateReviewInvalid({ ...ok, verdict: 'changes_required' }, LAW), 'changes-required-shape', 'changes_required demands findings')
  assert.equal(gateReviewInvalid({ ...ok, verdict: 'blocked' }, LAW), 'blocked-without-blockers')
})

test('core (S1 residual): gateReviewInvalid mirrors validateGate review_id, law_hash format, and per-finding checks', () => {
  const LAW = 'a'.repeat(64)
  const ok = { review_id: 'r1', law_hash: LAW, findings: [], blockers: [], verdict: 'accept' }
  const finding = () => ({ id: 'F1', criterion: 'c', location: 'x.mjs:1', failure_mode: 'f', evidence: 'e', minimal_fix: 'm' })
  const reject = (findings) => ({ review_id: 'r1', law_hash: LAW, blockers: [], verdict: 'changes_required', findings })
  // review_id must be a nonempty string, exactly as the codex path demands.
  assert.equal(gateReviewInvalid({ ...ok, review_id: '' }, LAW), 'review-id-empty', 'an empty review_id fails closed')
  assert.equal(gateReviewInvalid({ ...ok, review_id: '   ' }, LAW), 'review-id-empty', 'a whitespace review_id fails closed')
  assert.equal(gateReviewInvalid({ ...ok, review_id: 7 }, LAW), 'review-id-empty', 'a non-string review_id fails closed')
  // the field set is exactly the five schema keys — nothing missing, nothing extra.
  const missing = { review_id: 'r1', law_hash: LAW, findings: [], blockers: [] }
  assert.equal(gateReviewInvalid(missing, LAW), 'fields-mismatch', 'a missing schema field fails closed')
  assert.equal(gateReviewInvalid({ ...ok, extra: 1 }, LAW), 'fields-mismatch', 'an extra field fails closed')
  // law_hash must match the lowercase 64-hex digest shape before the equality check.
  assert.equal(gateReviewInvalid({ ...ok, law_hash: 'A'.repeat(64) }, LAW), 'law-hash-mismatch', 'an uppercase digest fails the format gate')
  assert.equal(gateReviewInvalid({ ...ok, law_hash: 'a'.repeat(63) }, LAW), 'law-hash-mismatch', 'a short digest fails the format gate')
  // each finding is an object of exactly the six schema fields, all nonempty
  // strings, with a path:line location and a unique id.
  assert.equal(gateReviewInvalid(reject(['nope']), LAW), 'finding-not-an-object', 'a non-object finding fails closed')
  const shortFinding = { id: 'F1', criterion: 'c', location: 'x.mjs:1', failure_mode: 'f', evidence: 'e' }
  assert.equal(gateReviewInvalid(reject([shortFinding]), LAW), 'finding-fields-mismatch', 'a finding missing a field fails closed')
  assert.equal(gateReviewInvalid(reject([{ ...finding(), extra: 'x' }]), LAW), 'finding-fields-mismatch', 'a finding with an extra field fails closed')
  assert.equal(gateReviewInvalid(reject([{ ...finding(), evidence: '' }]), LAW), 'finding-fields-empty', 'an empty finding field fails closed')
  assert.equal(gateReviewInvalid(reject([{ ...finding(), criterion: '  ' }]), LAW), 'finding-fields-empty', 'a whitespace finding field fails closed')
  assert.equal(gateReviewInvalid(reject([{ ...finding(), id: 5 }]), LAW), 'finding-fields-empty', 'a non-string finding field fails closed')
  assert.equal(gateReviewInvalid(reject([{ ...finding(), location: 'x.mjs' }]), LAW), 'finding-location-shape', 'a location with no line number fails closed')
  assert.equal(gateReviewInvalid(reject([finding(), finding()]), LAW), 'finding-id-duplicate', 'a duplicate finding id fails closed')
  // a well-formed finding still passes — including the path:line:col form.
  assert.equal(gateReviewInvalid(reject([{ ...finding(), location: 'src/a.mjs:12:4' }]), LAW), null, 'a path:line:col location passes')
})

// ── W6 (S1): the recovery-decision core + the OPTIONAL gate cohort ───────────

test('core (W6-B): strictSubsetProgress is true only for a STRICT shrink — equality, superset, and empty-prior are all false', () => {
  assert.equal(strictSubsetProgress(['f1', 'f2', 'f3'], ['f1', 'f2']), true, 'a strict subset (one cleared) is progress')
  assert.equal(strictSubsetProgress(['f1', 'f2'], []), true, 'clearing every finding is the empty strict subset (accept upstream)')
  assert.equal(strictSubsetProgress(['f1', 'f2'], ['f1', 'f2']), false, 'equality clears nothing — no progress')
  assert.equal(strictSubsetProgress(['f1'], ['f1', 'f2']), false, 'a superset (a new id appeared) is not progress')
  assert.equal(strictSubsetProgress(['f1', 'f2'], ['f1', 'f3']), false, 'a renamed id (same size, one not in prior) is not progress')
  assert.equal(strictSubsetProgress([], []), false, 'an empty prior can never shrink')
  assert.equal(strictSubsetProgress([], ['f1']), false, 'no cohort to shrink from')
  assert.equal(strictSubsetProgress('nope', ['f1']), false, 'a non-array prior fails to false, never throws')
  assert.equal(strictSubsetProgress(['f1'], null), false, 'a non-array curr fails to false, never throws')
})

test('core (W6-01/S3): recoveryDecision is the single transition policy — advance, scoped-move, establishment, a missing oracle, and every held path', () => {
  // cohortEstablished true = a measured recheck (a prior cohort is pinned): the base subset case.
  const base = { edgeUses: 0, cap: 2, cohortEstablished: true, priorBlockingIds: ['f1', 'f2'], currBlockingIds: ['f1'], schemaValid: true, transport: true }
  // a machine fault rules first, before the subset is even considered — even on an accept.
  assert.deepEqual(recoveryDecision({ ...base, transport: false, gateOutcome: 'accept' }), { action: 'held', reason: 'transport-failure' }, 'a downed transport holds before any progress read')
  assert.deepEqual(recoveryDecision({ ...base, schemaValid: false, gateOutcome: 'accept' }), { action: 'held', reason: 'schema-invalid' }, 'a malformed verdict holds before the subset eval')
  // accept advances.
  assert.deepEqual(recoveryDecision({ ...base, gateOutcome: 'accept' }), { action: 'advance', reason: 'accept' }, 'accept advances')
  // reject (the gateOutcome return for exit 10) with strict progress and an edge left is a scoped-move.
  assert.deepEqual(recoveryDecision({ ...base, gateOutcome: 'reject' }), { action: 'scoped-move', reason: 'strict-subset-progress' }, 'a shrinking cohort within cap is a scoped-move')
  // equality / no strict progress holds regardless of cap.
  assert.deepEqual(recoveryDecision({ ...base, gateOutcome: 'reject', currBlockingIds: ['f1', 'f2'] }), { action: 'held', reason: 'no-strict-progress' }, 'equality (cleared nothing) holds')
  assert.deepEqual(recoveryDecision({ ...base, gateOutcome: 'reject', currBlockingIds: ['f1', 'f3'] }), { action: 'held', reason: 'no-strict-progress' }, 'a renamed id (no strict shrink) holds')
  // strict progress but the cap is exhausted holds.
  assert.deepEqual(recoveryDecision({ ...base, gateOutcome: 'reject', edgeUses: 2 }), { action: 'held', reason: 'cap-exhausted' }, 'progress with no edge left holds')
  // S3: the establishing reject (no prior cohort pinned) has nothing to disprove — progress by
  // definition, a scoped-move up to the cap with its own reason; the cohort arrays are not consulted.
  assert.deepEqual(recoveryDecision({ ...base, cohortEstablished: false, gateOutcome: 'reject' }), { action: 'scoped-move', reason: 'establishing' }, 'a reject with no prior cohort establishes — a scoped-move, never a subset test')
  assert.deepEqual(recoveryDecision({ ...base, cohortEstablished: false, gateOutcome: 'reject', edgeUses: 2 }), { action: 'held', reason: 'cap-exhausted' }, 'an establishing reject with no edge left holds at the cap')
  // S3: a wired oracle that read no cohort is a missing verdict — held before any subset eval.
  assert.deepEqual(recoveryDecision({ ...base, gateOutcome: 'reject', oracleMissing: true }), { action: 'held', reason: 'oracle-missing' }, 'a missing cohort oracle holds before the subset is weighed')
  // blocked and any unrecognized outcome fall to the held floor.
  assert.deepEqual(recoveryDecision({ ...base, gateOutcome: 'blocked' }), { action: 'held', reason: 'blocked' }, 'a block holds')
  assert.deepEqual(recoveryDecision({ ...base, gateOutcome: 'transport_failure' }), { action: 'held', reason: 'blocked' }, 'an unrecognized outcome falls to the held floor')
})

test('core (W6-03): gateReviewInvalid enforces the OPTIONAL cohort — expected review_id and the allowed-id set, agreeing with the transport', () => {
  const LAW = 'a'.repeat(64)
  const finding = (id) => ({ id, criterion: 'c', location: 'x.mjs:1', failure_mode: 'f', evidence: 'e', minimal_fix: 'm' })
  const reject = (findings) => ({ review_id: 'cohort-1', law_hash: LAW, blockers: [], verdict: 'changes_required', findings })
  const accept = { review_id: 'cohort-1', law_hash: LAW, findings: [], blockers: [], verdict: 'accept' }
  // Absent cohort inputs: the pre-cohort behavior is unchanged — any review_id, any id passes.
  assert.equal(gateReviewInvalid({ ...accept, review_id: 'anything' }, LAW), null, 'no expected id → any review_id passes')
  assert.equal(gateReviewInvalid(reject([finding('brand-new')]), LAW), null, 'no allowed set → any finding id passes')
  // expectedReviewId present: the review_id must equal the issued id.
  assert.equal(gateReviewInvalid(accept, LAW, 'cohort-1'), null, 'a matching review_id passes the lineage check')
  assert.equal(gateReviewInvalid({ ...accept, review_id: 'other' }, LAW, 'cohort-1'), 'review-id-mismatch', 'a mismatched review_id fails closed')
  // allowedFindingIds present: an in-cohort subset passes; an out-of-cohort id fails — the
  // SAME rule scripts/kiln-review validateShape enforces, so kernel and transport agree.
  const cohort = new Set(['f1', 'f2'])
  assert.equal(gateReviewInvalid(reject([finding('f1')]), LAW, 'cohort-1', cohort), null, 'an in-cohort subset passes')
  assert.equal(gateReviewInvalid(accept, LAW, 'cohort-1', cohort), null, 'clearing every finding (accept) passes the cohort')
  assert.equal(gateReviewInvalid(reject([finding('f1'), finding('f3')]), LAW, 'cohort-1', cohort), 'finding-id-out-of-cohort', 'a new/renamed id outside the cohort fails closed')
  // the existing unique-id check still fires ahead of the cohort check.
  assert.equal(gateReviewInvalid(reject([finding('f1'), finding('f1')]), LAW, 'cohort-1', cohort), 'finding-id-duplicate', 'a duplicate id is caught before the cohort check')
})

test('core (W7-01): reconcileAudit derives the audit verdict from the closed arrays — blockers dominant, then findings, else accept', () => {
  assert.deepEqual(reconcileAudit([], []), { verdict: 'accept', blockerIds: [], findingIds: [] }, 'no findings and no blockers is accept')
  assert.deepEqual(reconcileAudit([{ id: 'f1' }, { id: 'f2' }], []),
    { verdict: 'changes_required', blockerIds: [], findingIds: ['f1', 'f2'] }, 'findings with no blockers is changes_required')
  assert.deepEqual(reconcileAudit([{ id: 'f1' }, { id: 'f2' }], ['f2']),
    { verdict: 'blocked', blockerIds: ['f2'], findingIds: ['f1', 'f2'] }, 'any blocker dominates — the verdict is blocked')
})

test('core (W7-01): reconcileAudit dedups by id in first-seen input order, and a duplicated id with any blocker instance stays a blocker (max severity)', () => {
  assert.deepEqual(reconcileAudit([{ id: 'b' }, { id: 'a' }, { id: 'b' }, { id: 'c' }], ['c', 'a', 'c']),
    { verdict: 'blocked', blockerIds: ['c', 'a'], findingIds: ['b', 'a', 'c'] }, 'both arrays dedup preserving first-seen input order')
  assert.deepEqual(reconcileAudit([{ id: 'f1' }, { id: 'f1' }], ['f1']),
    { verdict: 'blocked', blockerIds: ['f1'], findingIds: ['f1'] }, 'a duplicated finding id named by a blocker collapses to one blocker — max severity, blockers dominant')
  assert.deepEqual(reconcileAudit([{ id: 'f1' }, { id: 'f1' }], []),
    { verdict: 'changes_required', blockerIds: [], findingIds: ['f1'] }, 'a duplicated finding id with no blocker collapses to one finding')
})

test('core (W7-01): reconcileAudit rules invalid on the referential breach, malformed inputs, and adversarial shapes — never throws', () => {
  const INVALID = { verdict: 'invalid', blockerIds: [], findingIds: [] }
  assert.deepEqual(reconcileAudit([{ id: 'f1' }], ['f2']), INVALID, 'a blocker naming no finding id is the referential breach')
  assert.deepEqual(reconcileAudit([], ['b1']), INVALID, 'a blocked shape with empty findings has nothing behind its blockers — invalid')
  assert.deepEqual(reconcileAudit([{ id: 'f1' }], ['']), INVALID, 'an empty-string blocker is invalid')
  assert.deepEqual(reconcileAudit([{ id: 'f1' }], [7]), INVALID, 'a non-string blocker is invalid')
  assert.deepEqual(reconcileAudit('nope', []), INVALID, 'a non-array findings input is invalid')
  assert.deepEqual(reconcileAudit([], 'nope'), INVALID, 'a non-array blockers input is invalid')
  assert.deepEqual(reconcileAudit(undefined, undefined), INVALID, 'absent inputs are invalid, never a throw')
  assert.deepEqual(reconcileAudit([{}], []), INVALID, 'a finding without an id is invalid')
  assert.deepEqual(reconcileAudit([{ id: '' }], []), INVALID, 'an empty-string finding id is invalid')
  assert.deepEqual(reconcileAudit([{ id: '   ' }], []), INVALID, 'a whitespace-only finding id is invalid')
  assert.deepEqual(reconcileAudit([{ id: 7 }], []), INVALID, 'a non-string finding id is invalid')
  assert.deepEqual(reconcileAudit(['f1'], []), INVALID, 'a bare-string finding entry is invalid')
  assert.deepEqual(reconcileAudit([null], []), INVALID, 'a null finding entry is invalid')
  assert.deepEqual(reconcileAudit([['f1']], []), INVALID, 'an array finding entry is invalid')
})

test('runtime (S1): a claude verdict failing the semantic mirror never publishes and never seals', async () => {
  const script = (verdict) => ({
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|logic'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'degraded:check': { exit: 1 },
    'gate:invalidate': { exit: 0 },
    'gate-claude:review': OK_ACK,
    'gate:read': readCandidate(verdict),
    'state:write': GREEN,
  })
  const wrongHash = await runKernel({ stage: 'build', projectDir: '/p' },
    script({ ...GATE_ACCEPT, law_hash: 'b'.repeat(64) }))
  assert.equal(wrongHash.ret.status, 'transport-failure', 'a wrong law hash is transport-failure exit semantics')
  assert.ok(!wrongHash.calls.some(c => c.label === 'gate:publish'), 'a failing verdict never reaches the gate file')
  assert.ok(!wrongHash.ret.beat.includes('sealed'), 'never a seal')
  const acceptWithFindings = await runKernel({ stage: 'build', projectDir: '/p' },
    script({ ...GATE_ACCEPT, findings: [{ id: 'F1', criterion: 'c', location: 'x.mjs:1', failure_mode: 'f', evidence: 'e', minimal_fix: 'm' }] }))
  assert.equal(acceptWithFindings.ret.status, 'transport-failure', 'accept-with-findings is rejected, exactly as the codex path rejects it')
  assert.ok(!acceptWithFindings.calls.some(c => c.label === 'gate:publish'), 'nothing publishes')
})

test('runtime (S1 residual): an empty review_id and a malformed finding each fail the claude gate closed — no publish, no seal', async () => {
  const script = (verdict) => ({
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|logic'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'degraded:check': { exit: 1 },
    'gate:invalidate': { exit: 0 },
    'gate-claude:review': OK_ACK,
    'gate:read': readCandidate(verdict),
    'state:write': GREEN,
  })
  const emptyId = await runKernel({ stage: 'build', projectDir: '/p' },
    script({ ...GATE_ACCEPT, review_id: '' }))
  assert.equal(emptyId.ret.status, 'transport-failure', 'an empty review_id is transport-failure exit semantics')
  assert.ok(!emptyId.calls.some(c => c.label === 'gate:publish'), 'an empty review_id never reaches the gate file')
  assert.ok(!emptyId.ret.beat.includes('sealed'), 'never a seal')
  const badFinding = await runKernel({ stage: 'build', projectDir: '/p' },
    script({
      review_id: 'r1', law_hash: 'a'.repeat(64), blockers: [], verdict: 'changes_required',
      findings: [{ id: 'F1', criterion: 'c', location: 'no-line-here', failure_mode: 'f', evidence: 'e', minimal_fix: 'm' }],
    }))
  assert.equal(badFinding.ret.status, 'transport-failure', 'a malformed finding location is rejected exactly as the codex path rejects it')
  assert.ok(!badFinding.calls.some(c => c.label === 'gate:publish'), 'nothing publishes on a malformed finding')
  assert.ok(!badFinding.ret.beat.includes('sealed'), 'never a seal')
})

test('runtime (S1/W2-S4): a missing or malformed review request fails the claude gate closed — the demoted request stays a required deliverable', async () => {
  // W2-S4: the request is demoted to non-authoritative hints, but Sol ruling 3 keeps it a required
  // builder deliverable — its absence or corruption is the existing builder-failure hold. gate-facts
  // runs hintsFrom, so a missing or malformed request exits 20 there (the codex verb takes the same
  // hold), and the claude gate holds before any reviewer runs.
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|logic'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'degraded:check': { exit: 1 },
    'gate-claude:facts': { exit: 20, ids: [] },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'transport-failure')
  assert.ok(!calls.some(c => c.label === 'gate-claude:review'), 'no reviewer dispatches without the required request')
})

test('runtime (S2): the codex recheck also judges a fresh receipt — the rerun lands between repair and recheck', async () => {
  const gateExits = [10, 0]
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'law:pre-recheck': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': () => ({ exit: gateExits.shift() }),
    'gate:recheck': () => ({ exit: gateExits.shift() }),
    'findings:fetch': { exit: 0, ids: ['F1'] },
    'repair:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'repaired' },
    'delta:check': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok')
  const labels = calls.map(c => c.label)
  assert.ok(labels.indexOf('law:pre-recheck') > labels.indexOf('repair:s1'), 'the receipt rerun lands after the repair')
  assert.ok(labels.indexOf('law:pre-recheck') < labels.indexOf('gate:recheck'), 'and before the codex recheck judges')
  const rerun = calls.find(c => c.label === 'law:pre-recheck')
  assert.ok(rerun.prompt.includes(LAW_CHECK_RECEIPT), 'the rerun is the receipt-capturing check verbatim')
})

test('runtime (S2): a red pre-recheck rerun halts law-red — no gate ever judges a stale pre-repair receipt', async () => {
  const reject = {
    review_id: 'r1', law_hash: 'a'.repeat(64), blockers: [], verdict: 'changes_required',
    findings: [{ id: 'F1', criterion: 'c', location: 'x.mjs:1', failure_mode: 'f', evidence: 'e', minimal_fix: 'm' }],
  }
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|logic'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'law:pre-recheck': { exit: 1, ids: [] },
    'degraded:check': { exit: 1 },
    'gate:invalidate': { exit: 0 },
    'gate-claude:review': OK_ACK,
    'gate:read': readCandidate(reject),
    'gate:publish': { exit: 0 },
    'findings:fetch': { exit: 0, ids: ['F1'] },
    'repair:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'repaired' },
    'delta:check': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'law-red', 'a red rerun takes the law door, not the transport door')
  assert.ok(!calls.some(c => c.label === 'gate-claude:recheck'), 'no recheck judges over a red law')
  assert.ok(!ret.beat.includes('sealed'), 'never a seal')
})

test('tier-keys-only: no compiled model id or alias literal lives in the kernel source', () => {
  for (const v of ['gpt-5.6-sol', "'fable'", "'opus'", "'sonnet'", "'gpt-sol'"]) {
    assert.ok(!src.includes(v), `no compiled tier value ${v} in kernel source — models live only in tiers.json`)
  }
})

// ── INTAKE-26: the order-aware boundary predicate (multi-new-slice deadlock) ──

test('core (deadlock, INTAKE-26): redSetIsFuture tolerates only unique strictly-later planned owners', () => {
  const plan = ['s1', 's2', 's3']
  // future-only: every red owner maps to a UNIQUE strictly-later slice → tolerate.
  assert.equal(redSetIsFuture(['s2'], 's1', plan), true)
  assert.equal(redSetIsFuture(['s2', 's3'], 's1', plan), true)
  assert.equal(redSetIsFuture(['s3'], 's2', plan), true)
  // unowned (empty / non-array ids) never tolerates.
  assert.equal(redSetIsFuture([], 's1', plan), false, 'an unowned red never tolerates')
  assert.equal(redSetIsFuture(undefined, 's1', plan), false, 'a non-array red never tolerates')
  // the current slice owning the red halts.
  assert.equal(redSetIsFuture(['s1'], 's1', plan), false, 'the current slice owning the red halts')
  // an earlier owner halts.
  assert.equal(redSetIsFuture(['s1'], 's2', plan), false, 'an earlier owner halts')
  assert.equal(redSetIsFuture(['s2'], 's3', plan), false)
  // an out-of-plan owner halts.
  assert.equal(redSetIsFuture(['s9'], 's1', plan), false, 'an out-of-plan owner halts')
  // a mixed valid/invalid set halts (future+current, future+out-of-plan).
  assert.equal(redSetIsFuture(['s2', 's1'], 's1', plan), false, 'a mixed future+current set halts')
  assert.equal(redSetIsFuture(['s3', 's9'], 's1', plan), false, 'a mixed future+out-of-plan set halts')
  // an ambiguous owner — one that appears more than once in the plan — halts.
  assert.equal(redSetIsFuture(['s2'], 's1', ['s1', 's2', 's2']), false, 'an ambiguous plan owner halts')
  // the current slice absent from the plan halts (defensive).
  assert.equal(redSetIsFuture(['s2'], 'sX', plan), false, 'a current slice absent from the plan halts')
})

test('runtime (deadlock, INTAKE-26): a later-planned pre-seal red is expected pre-build state — both slices seal', async () => {
  // s1 seals while the LAW is still red on the unbuilt later slice s2 (the W-04
  // pre-build state); s2 then builds and its pre-seal is green. The deadlock fix.
  const preSeals = [{ exit: 1, ids: ['s2'] }, GREEN]
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui', 'obj|s2|ui'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging s1' },
    'slice:s2': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging s2' },
    'law:pre-seal': () => preSeals.shift(),
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'the later-planned red tolerates; s1 seals, then s2 seals green')
  assert.ok(calls.some(c => c.label === 'slice:s1') && calls.some(c => c.label === 'slice:s2'), 'both slices build')
  assert.equal(calls.filter(c => c.label === 'seal:append').length, 2, 'both slices seal')
  assert.ok(ret.beat.includes('Slice s2 sealed — dual'), 'the last slice seals dual')
})

test('runtime (deadlock, INTAKE-26): a non-future pre-seal red halts law-red — current, out-of-plan, and mixed sets never seal', async () => {
  const run = (preSealIds) => runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui', 'obj|s2|ui'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': { exit: 1, ids: preSealIds },
    'state:write': GREEN,
  })
  const current = await run(['s1'])
  assert.equal(current.ret.status, 'law-red', 'the current slice owning the red never seals')
  assert.ok(!current.ret.beat.includes('sealed —'), 'no seal under a current-owner red')
  assert.equal(stateArgs(current.calls).slice, 's1', 'the current slice is held')
  const outOfPlan = await run(['s9'])
  assert.equal(outOfPlan.ret.status, 'law-red', 'an out-of-plan owner never seals')
  const mixed = await run(['s2', 's1'])
  assert.equal(mixed.ret.status, 'law-red', 'a mixed future+current set never seals')
})

test('runtime (deadlock, INTAKE-26): a later-planned pre-recheck red tolerates — the recheck judges and the slice seals', async () => {
  const reviewExits = [10, 0]   // s1 review reject, s2 review accept
  const recheckExits = [0]      // s1 recheck accept
  const preRecheck = [{ exit: 1, ids: ['s2'] }] // the fresh receipt before s1's recheck reds on the unbuilt s2
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui', 'obj|s2|ui'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'slice:s2': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'law:pre-recheck': () => preRecheck.shift(),
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': () => ({ exit: reviewExits.shift() }),
    'gate:recheck': () => ({ exit: recheckExits.shift() }),
    'findings:fetch': { exit: 0, ids: ['F1'] },
    'repair:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'repaired' },
    'delta:check': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'the later-planned pre-recheck red tolerates; the recheck judges and both slices seal')
  assert.ok(calls.some(c => c.label === 'gate:recheck'), 'the recheck ran over the tolerated later-planned red')
  assert.equal(calls.filter(c => c.label === 'seal:append').length, 2, 'both slices seal')
})

test('runtime (STRIKE 2): a pre-recheck red owned by an already-SEALED later slice reopens it — future-tolerance never masks a sealed regression', async () => {
  // s1 is on the anvil and reject→repairs; the fresh pre-recheck receipt goes red
  // owned by s2 — a LATER planned slice that is already SEALED (a regression). The
  // pre-recheck must mirror the pre-seal gate: firstSealed is consulted FIRST, so
  // the sealed owner reopens and the recheck never judges a masked regression.
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui', 'obj|s2|ui'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    // s2 is sealed, s1 is not — only s2 sits in the exact-membership seal set.
    'seal:set': { exit: 0, ids: ['s2'] },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'law:pre-recheck': { exit: 1, ids: ['s2'] },
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 10 },
    'findings:fetch': { exit: 0, ids: ['F1'] },
    'repair:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'repaired' },
    'delta:check': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'law-red', 'the sealed later owner reopens instead of being tolerated')
  assert.ok(ret.beat.includes('Slice s2 reopened'), 'the sealed owner s2 is reopened, not masked')
  const st = stateArgs(calls)
  assert.equal(st.slice, 's2', 'the reopened sealed owner is persisted as active_slice')
  assert.equal(st.key, 'reopen-slice', 'STATE carries the reopen-slice key for the reopened owner')
  assert.ok(!calls.some(c => c.label === 'gate:recheck'), 'the recheck never runs over the masked-then-reopened red')
})

// ── INTAKE-27: producer-self-publish — invalid / stale / missing candidate ──

test('runtime (INTAKE-27): an unparseable candidate halts the claude gate — nothing promotes, nothing seals', async () => {
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|logic'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'degraded:check': { exit: 1 },
    'gate:invalidate': { exit: 0 },
    'gate-claude:review': OK_ACK,
    'gate:read': { exit: 0, ids: ['this is not json at all'] },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'transport-failure', 'an unparseable candidate is transport-failure exit semantics')
  assert.ok(!calls.some(c => c.label === 'gate:publish'), 'nothing promotes when the candidate will not parse')
  assert.ok(!ret.beat.includes('sealed'), 'never a seal')
})

test('runtime (INTAKE-27): a stale or missing candidate never promotes — the {ok} ack alone cannot seal', async () => {
  const base = {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|logic'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'degraded:check': { exit: 1 },
    'gate:invalidate': { exit: 0 },
    'state:write': GREEN,
  }
  // (a) the reviewer returns a false ack — the kernel never reads a candidate.
  const falseAck = await runKernel({ stage: 'build', projectDir: '/p' }, { ...base, 'gate-claude:review': { ok: false } })
  assert.equal(falseAck.ret.status, 'transport-failure', 'a false ack seals nothing')
  assert.ok(!falseAck.calls.some(c => c.label === 'gate:read'), 'a false ack short-circuits before the raw read')
  assert.ok(!falseAck.calls.some(c => c.label === 'gate:publish'), 'nothing promotes on a false ack')
  // (b) the reviewer acks ok but wrote no candidate — the invalidated file cannot
  // be read back, so no stale verdict survives to promote.
  const missing = await runKernel({ stage: 'build', projectDir: '/p' }, { ...base, 'gate-claude:review': OK_ACK, 'gate:read': { exit: 1, ids: [] } })
  assert.equal(missing.ret.status, 'transport-failure', 'a missing candidate seals nothing')
  assert.ok(!missing.calls.some(c => c.label === 'gate:publish'), 'nothing promotes over a missing candidate')
  assert.ok(!missing.ret.beat.includes('sealed'), 'never a seal')
})

// ── Wave 2 (the Carriers): the report-stage completion existence gate ────────

test('runtime (Wave 2): report status ok AND .kiln/report.md non-empty seals the run done', async () => {
  const { ret, calls } = await runKernel({ stage: 'report', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'stage:report': { facts: { status: 'ok', pointers: ['.kiln/report.md'], schema_valid: true }, narration_beat: 'the report stands' },
    'law:stage-end': GREEN,
    'report:check': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'done', 'a written report seals the run done')
  assert.ok(ret.beat.includes('the report stands'), 'the report card beat speaks on a genuine completion')
  const check = calls.find(c => c.label === 'report:check')
  assert.ok(check && check.prompt.includes('test -s .kiln/report.md'),
    'the gate is a mechanical content-blind test -s on the report path — no content read')
  const st = stateArgs(calls)
  assert.equal(st.stage, 'report', 'STATE records the report stage')
  assert.equal(st.key, 'run-complete', 'next_action is the terminal Run complete')
})

test('runtime (Wave 2): report status ok BUT .kiln/report.md empty or missing never seals done — transport-failure holds', async () => {
  // The report card claims facts.status ok yet the artifact is absent — from the
  // content-blind kernel that is the report stage failing to deliver sound work, the
  // SAME failure class as a bad return, so it reuses transport-failure: no new status,
  // no false done. The SEALED-claiming report beat must never read above the hold.
  const REPORT_SEALED_BEAT = '`SEALED` **Report** — the report stands'
  const { ret, calls } = await runKernel({ stage: 'report', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'stage:report': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: REPORT_SEALED_BEAT },
    'law:stage-end': GREEN,
    'report:check': { exit: 1 },
    'state:write': GREEN,
  })
  assert.notEqual(ret.status, 'done', 'an empty report never seals a false done')
  assert.equal(ret.status, 'transport-failure', 'the missing artifact reuses transport-failure — the same class as a bad return, no new status')
  assert.ok(ret.beat.includes('The stage worker returned no usable result'),
    'the sealed stage-worker transport variant (entry 1) speaks — the reused beat key, no new voice beat')
  assert.ok(!ret.beat.includes('the report stands'),
    'the SEALED-claiming report beat never reads above the honest hold line (gated before the beat push)')
  assert.equal(ret.pointers.report, '.kiln/report.md', 'the return points at the empty report artifact')
  const st = stateArgs(calls)
  assert.equal(st.stage, 'report', 'STATE records the report stage')
  // The closed key names the rerun; kiln-review renders "Rerun stage report". The former
  // inline "<report.md> is empty" sub-reason is dropped by design — not a durable resume fact.
  assert.equal(st.key, 'rerun-report', 'next_action names the report-specific rerun via its target-stage key')
})

// ── Wave 3 (the Gauge foundation): the LAW input gate. postureToDials (the dial PROJECTOR)
// moved to scripts/gauge-dial.mjs in W4 — its tests live in tests/gauge-dial.test.mjs, and the
// enum-agreement test there pins the kernel's frozen enums against the projector's copy. The
// kernel keeps validatePosture and those frozen enums for the LAW input gate ────

test('core (Wave 3): validatePosture accepts exactly {scope,novelty,reversibility} over the frozen enums', () => {
  assert.equal(validatePosture({ scope: 'small', novelty: 'familiar', reversibility: 'reversible' }), true)
  assert.equal(validatePosture({ scope: 'large', novelty: 'novel', reversibility: 'irreversible' }), true)
  assert.equal(validatePosture({ scope: 'small', novelty: 'novel', reversibility: 'risky' }), true)
})

test('core (Wave 3): validatePosture rejects a malformed or out-of-enum posture — reuses the frozen enums, never throws', () => {
  const good = { scope: 'small', novelty: 'familiar', reversibility: 'reversible' }
  assert.equal(validatePosture(undefined), false, 'a missing posture is rejected')
  assert.equal(validatePosture(null), false)
  assert.equal(validatePosture('small'), false, 'a non-object is rejected')
  assert.equal(validatePosture(['small', 'familiar', 'reversible']), false, 'an array is rejected')
  assert.equal(validatePosture({ scope: 'small', novelty: 'familiar' }), false, 'a missing field is rejected')
  assert.equal(validatePosture({ ...good, extra: 1 }), false, 'an extra field is rejected (exact-field guard)')
  assert.equal(validatePosture({ ...good, scope: 'medium' }), false, 'an unknown scope is rejected')
  assert.equal(validatePosture({ ...good, novelty: 'weird' }), false, 'an unknown novelty is rejected')
  assert.equal(validatePosture({ ...good, reversibility: 'maybe' }), false, 'an unknown reversibility is rejected')
  const ownKeysBomb = new Proxy({}, { ownKeys() { throw new Error('boom') } })
  assert.doesNotThrow(() => validatePosture(ownKeysBomb))
  assert.equal(validatePosture(ownKeysBomb), false, 'a throwing ownKeys trap fails to false, never throws')
})

// ── Wave 3 (the Gauge foundation): the LAW input gate — the deterministic post-producer
// check on the onboarding outputs (brief + posture) before the law card plans ──────────

test('runtime (Wave 3): a present brief and a valid posture pass the LAW input gate BEFORE planning', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'onboarding:brief-check': { exit: 0 },
    'onboarding:posture': { exit: 0, scope: 'large', novelty: 'novel', reversibility: 'irreversible' },
    'onboarding:brownfield-check': { exit: 1 }, // greenfield — no map required
    'width:read': { exit: 0, width: 'floor' }, // W5-S2: the input gate passes, then the floor width keeps the single act
    'stage:law': { facts: { status: 'ok', pointers: ['.kiln/LAW.md'], schema_valid: true }, narration_beat: 'the law' },
    'ratify:request': GREEN,
    'ratify:gate': { exit: 0 },
    'law:milestone-projection': { exit: 0 },
    'law:perceptual-table': { exit: 0 },
    'law:seal': { exit: 0 },
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'the gate passes and the law stage plans, ratifies, and seals')
  const brief = calls.findIndex(c => c.label === 'onboarding:brief-check')
  const posture = calls.findIndex(c => c.label === 'onboarding:posture')
  const plan = calls.findIndex(c => c.label === 'stage:law')
  assert.ok(brief >= 0 && posture >= 0, 'both input checks ran')
  assert.ok(brief < plan && posture < plan, 'the input gate runs BEFORE the law card plans')
  const postureCall = calls.find(c => c.label === 'onboarding:posture')
  assert.ok(postureCall.prompt.includes('posture.json') && postureCall.prompt.includes('node -p'),
    'posture is read via a boot-style node -p projection leg — never a raw parse in the kernel body')
  assert.ok(!postureCall.prompt.includes('scope:p.scope'),
    'the projection carries every on-disk key faithfully — never a hand-picked three-field triple, which would silently strip a persisted dial or effort past the gate')
  assert.equal(postureCall.opts.model, undefined, 'the posture leg carries the kernel-leg tier (inherit → no model option)')
  assert.equal(postureCall.opts.effort, 'high')
})

test('runtime (Wave 3): a missing/empty brief halts the LAW stage — reused transport-failure, never a silent plan', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'onboarding:brief-check': { exit: 1 }, // brief empty or missing
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'transport-failure', 'a missing brief holds the run')
  assert.ok(!calls.some(c => c.label === 'onboarding:posture'), 'the posture is never read once the brief fails')
  assert.ok(!calls.some(c => c.label === 'stage:law'), 'the law stage never plans without its inputs')
  assert.ok(!calls.some(c => c.label === 'ratify:gate'), 'never reaches ratify')
  const st = stateArgs(calls)
  assert.equal(st.key, 'rerun-onboarding', 'next_action names a rerun of onboarding')
  assert.ok(st.token !== 'advance' && st.token !== 'seal-advance', 'never advances to build')
})

test('runtime (Wave 3): an unreadable posture.json halts the LAW stage — reused transport-failure', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'onboarding:brief-check': { exit: 0 },
    'onboarding:posture': { exit: 1 }, // posture.json missing or unreadable
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'transport-failure')
  assert.ok(!calls.some(c => c.label === 'stage:law'), 'no planning on an unreadable posture')
  assert.equal(stateArgs(calls).key, 'rerun-onboarding')
})

test('runtime (Wave 3): an out-of-enum posture halts the LAW stage — validatePosture rejects, transport-failure', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'onboarding:brief-check': { exit: 0 },
    'onboarding:posture': { exit: 0, scope: 'medium', novelty: 'novel', reversibility: 'reversible' }, // scope not in enum
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'transport-failure', 'an invalid posture holds the run')
  assert.ok(!calls.some(c => c.label === 'stage:law'), 'an invalid posture never reaches planning')
})

test('runtime (Wave 3): a posture missing a field halts the LAW stage — the exact-field guard rejects', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'onboarding:brief-check': { exit: 0 },
    'onboarding:posture': { exit: 0, scope: 'small', novelty: 'familiar' }, // reversibility dropped by the projection
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'transport-failure')
  assert.ok(!calls.some(c => c.label === 'stage:law'), 'a partial posture never reaches planning')
})

test('runtime (Wave 3): an EXTRA posture field halts the LAW stage — the faithful projection carries it, the exact-field guard rejects a persisted dial or effort', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'onboarding:brief-check': { exit: 0 },
    // A valid three-field posture with an effort/dial persisted alongside: the faithful
    // {...p} projection carries the extra own key through instead of cherry-picking the
    // three it recognizes, so validatePosture's exact-field guard rejects it. This is the
    // on-disk-extras case the projection used to erase before validatePosture ever ran.
    'onboarding:posture': { exit: 0, scope: 'small', novelty: 'familiar', reversibility: 'reversible', effort: 'high' },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'transport-failure', 'an over-specified posture holds the run — no persisted dials or effort admitted')
  assert.ok(!calls.some(c => c.label === 'stage:law'), 'an extra-field posture never reaches planning')
})

test('runtime (Wave 3, brownfield): a present .kiln/brownfield marker with a nonempty codebase-map passes the gate — the LAW plans', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'onboarding:brief-check': { exit: 0 },
    'onboarding:posture': { exit: 0, scope: 'large', novelty: 'familiar', reversibility: 'reversible' },
    'onboarding:brownfield-check': { exit: 0 }, // the marker is present — a brownfield run
    'onboarding:map-check': { exit: 0 },         // the codebase map is nonempty
    'width:read': { exit: 0, width: 'floor' }, // W5-S2: the input gate passes, then the floor width keeps the single act
    'stage:law': { facts: { status: 'ok', pointers: ['.kiln/LAW.md'], schema_valid: true }, narration_beat: 'the law' },
    'ratify:request': GREEN,
    'ratify:gate': { exit: 0 },
    'law:milestone-projection': { exit: 0 },
    'law:perceptual-table': { exit: 0 },
    'law:seal': { exit: 0 },
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'a brownfield run with a map plans, ratifies, and seals')
  const map = calls.findIndex(c => c.label === 'onboarding:map-check')
  const plan = calls.findIndex(c => c.label === 'stage:law')
  assert.ok(map >= 0 && map < plan, 'the map check runs BEFORE the law card plans')
  const marker = calls.find(c => c.label === 'onboarding:brownfield-check')
  assert.ok(marker.prompt.includes('test -e .kiln/brownfield'), 'the marker is read as a closed fact (test -e), never parsed')
  const mapCheck = calls.find(c => c.label === 'onboarding:map-check')
  assert.ok(mapCheck.prompt.includes('test -s .kiln/docs/codebase-map.md'), 'the map is required nonempty (test -s), content-blind')
})

test('runtime (Wave 3, brownfield): a present marker with a missing/empty codebase-map halts — reused transport-failure, never a blind plan', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'onboarding:brief-check': { exit: 0 },
    'onboarding:posture': { exit: 0, scope: 'small', novelty: 'familiar', reversibility: 'reversible' },
    'onboarding:brownfield-check': { exit: 0 }, // brownfield
    'onboarding:map-check': { exit: 1 },         // but the map is missing or empty
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'transport-failure', 'a brownfield run with no map holds')
  assert.ok(!calls.some(c => c.label === 'stage:law'), 'the law stage never plans over an unmapped codebase')
  assert.ok(!calls.some(c => c.label === 'ratify:gate'), 'never reaches ratify')
  const st = stateArgs(calls)
  assert.equal(st.key, 'rerun-onboarding', 'next_action names a rerun of onboarding')
  assert.ok(st.token !== 'advance' && st.token !== 'seal-advance', 'never advances to build')
})

test('runtime (Wave 3, greenfield): no marker means no map is required — the map check never runs, the LAW plans', async () => {
  const { ret, calls } = await runKernel({ stage: 'law', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'onboarding:brief-check': { exit: 0 },
    'onboarding:posture': { exit: 0, scope: 'small', novelty: 'familiar', reversibility: 'reversible' },
    'onboarding:brownfield-check': { exit: 1 }, // no marker — a greenfield run
    'width:read': { exit: 0, width: 'floor' }, // W5-S2: the input gate passes, then the floor width keeps the single act
    'stage:law': { facts: { status: 'ok', pointers: ['.kiln/LAW.md'], schema_valid: true }, narration_beat: 'the law' },
    'ratify:request': GREEN,
    'ratify:gate': { exit: 0 },
    'law:milestone-projection': { exit: 0 },
    'law:perceptual-table': { exit: 0 },
    'law:seal': { exit: 0 },
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'a greenfield run plans without a codebase map')
  assert.ok(!calls.some(c => c.label === 'onboarding:map-check'), 'the map check never runs when no marker is present — short-circuit, no map required')
})

test('runtime (Wave 3): the LAW input gate is law-only — validate and report never read the onboarding inputs', async () => {
  const run = (s) => runKernel({ stage: s, projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    ['stage:' + s]: { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'working' },
    'law:stage-end': GREEN,
    'report:check': { exit: 0 },
    'state:write': GREEN,
  })
  for (const s of ['validate', 'report']) {
    const { calls } = await run(s)
    assert.ok(!calls.some(c => c.label === 'onboarding:brief-check'), s + ' never runs the brief check')
    assert.ok(!calls.some(c => c.label === 'onboarding:posture'), s + ' never reads posture')
    assert.ok(!calls.some(c => c.label === 'onboarding:brownfield-check'), s + ' never runs the brownfield check')
  }
})

test('tiers (Wave 3): validateTiers enforces the HIGH-effort floor — a sub-HIGH role fails, the all-HIGH config passes', () => {
  assert.equal(validateTiers(cfg()), true, 'the sealed all-HIGH config passes (haiku-migration raised to high)')
  for (const role of ['haiku-migration', 'kernel-leg', 'driver']) {
    for (const sub of ['low', 'medium']) {
      const c = cfg(); c.roles[role].effort = sub
      assert.equal(validateTiers(c), false, role + ' at ' + sub + ' fails the HIGH floor closed — no effort-down route')
    }
  }
  const x = cfg(); x.roles['driver'].effort = 'xhigh'
  assert.equal(validateTiers(x), true, 'xhigh is on the floor — permitted')
  assert.ok(Object.values(cfg().roles).every(r => r.effort === 'high' || r.effort === 'xhigh'),
    'the shipped tier data is now all HIGH/XHIGH')
  // The floor binds route targets too, not just the manual TIER_ROLES list: an
  // ADDITIONAL claude role at a sub-HIGH tier, reached through a surface route, is
  // the same effort-down bypass and must fail closed (else routeBuilder emits a
  // sub-HIGH leg). This role is absent from TIER_ROLES, so only the route check catches it.
  const rt = cfg()
  rt.roles['sub-high-route'] = { family: 'claude', alias: 'sonnet', effort: 'medium' }
  rt.surface_routing.ui = 'sub-high-route'
  assert.equal(validateTiers(rt), false, 'a surface route targeting a sub-HIGH extra role fails the floor — no effort-down route past the manual role list')
  assert.deepEqual(routeBuilder(cfg(), 'ui'), { effort: 'high', alias: 'opus', model: 'opus' }, 'the sealed ui route stays on the HIGH floor')
})

// ── W7-S2: the seam gate — the milestone audit seated in the build loop ──────
const AUDIT = '.kiln/audit-review.json'
const auditFinding = (id) => ({ id, criterion: 'C-1', location: 'src/app.mjs:12', failure_mode: 'broken', evidence: 'secret-audit-prose', minimal_fix: 'mend it' })
const auditVerdict = (verdict, findings = [], blockers = []) => ({ review_id: 'aud-1', law_hash: 'a'.repeat(64), findings, blockers, verdict })
const readAudit = (v) => ({ exit: 0, ids: [JSON.stringify(v)] })
const auditSlice = () => ({ facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' })
// The open-seam happy path: no current audit member, green receipt, an accepting auditor,
// and the trusted promotion leg. W2-S7b (item 11): a seam is audited on the boot AFTER its seal
// renders, so every audit scenario reaches auditSeam through the sealed-skip path.
const AUDIT_OK = {
  'audit:member': { exit: 1 },
  'law:pre-audit': GREEN,
  'audit:review': { exit: 0 },
  'audit:read': readAudit(auditVerdict('accept')),
  'audit:append': { exit: 0 },
}

test('runtime (W7-S2): the seam gate fires at the mid-plan label change and the final slice — each seam audits once through closed argv and promotes through append-audit', async () => {
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui|core', 'obj|s2|ui|core', 'obj|s3|ui|polish'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'seal:set': { exit: 0, ids: ['s1', 's2', 's3'] },
    'law:stage-end': GREEN,
    'state:write': GREEN,
    ...AUDIT_OK,
  })
  assert.equal(ret.status, 'ok')
  const audits = calls.filter(c => c.label === 'audit:review')
  assert.equal(audits.length, 2, 'exactly two seams audit — the label change after s2 and the final s3; s1 never audits')
  assert.ok(audits[0].prompt.includes('kiln-review audit . .kiln s2 gpt-5.6-sol gpt-sol high ' + AUDIT),
    'closed argv only — repo `.`, the cwd-relative kiln dir, the seam slice id, the reviewer-gate model and effort, the artifact path')
  assert.ok(audits[1].prompt.includes('kiln-review audit . .kiln s3 gpt-5.6-sol gpt-sol high ' + AUDIT), 'the final slice is always a seam — the implicit whole-build milestone')
  const appends = calls.filter(c => c.label === 'audit:append')
  assert.equal(appends.length, 2, 'each accepted seam promotes exactly once')
  assert.ok(appends[0].prompt.includes('append-audit .kiln s2'), 'promotion rides the trusted CLI verb, never a bare append')
  assert.ok(appends[1].prompt.includes('append-audit .kiln s3'))
})

test('runtime (W2-S7b, item 11): a FRESH seam seals and RELAUNCHES — no audit is dispatched over a prefix this invocation rebuilt, and the loop never advances past the unaudited seam', async () => {
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui|core', 'obj|s2|ui|core', 'obj|s3|ui|polish'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'slice:s1': auditSlice(), 'slice:s2': auditSlice(), 'slice:s3': auditSlice(),
    'law:pre-seal': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
    ...AUDIT_OK,
  })
  assert.equal(ret.status, 'ok')
  assert.equal(ret.pointers.next_stage, 'build', 'the advance-class return names BUILD again — a conductor that read the pipeline order would launch validate over an unaudited milestone')
  assert.ok(!calls.some(c => c.label === 'audit:member' || c.label === 'law:pre-audit' || c.label === 'audit:review'),
    'the fresh seam dispatches no audit at all — its seal is provisional until the conductor capture promotes it')
  assert.equal(calls.filter(c => c.label === 'seal:append').length, 2, 'the run stops at the s2 seam: s1 and s2 sealed, s3 never started')
  const at = stateArgs(calls)
  assert.equal(at.token, 'seal-advance', 'the durable fact the relaunch resumes from is the seal advance the seam wrote')
  assert.equal(at.key, 'relaunch-build', 'and its next-action key relaunches build')
})

test('runtime (W7-S2): an unlabeled plan pays exactly ONE final audit — the implicit whole-build seam at the last slice', async () => {
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui', 'obj|s2|ui'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'seal:set': { exit: 0, ids: ['s1', 's2'] },
    'law:stage-end': GREEN,
    'state:write': GREEN,
    ...AUDIT_OK,
  })
  assert.equal(ret.status, 'ok')
  const audits = calls.filter(c => c.label === 'audit:review')
  assert.equal(audits.length, 1, 'one whole-build audit — never zero, never per-slice')
  assert.ok(audits[0].prompt.includes('kiln-review audit . .kiln s2 '), 'the final slice is the seam slice')
})

test('runtime (W7-S2): a logged seam skips before any receipt; a sealed-but-unaudited seam re-fires on the all-sealed resume with the receipt refreshed first', async () => {
  // A current audit member AND a boot-sealed prefix: the seam slice was sealed at boot and its audit
  // still covers exactly that prefix, so the skip is honored — no receipt, no audit, no append.
  const logged = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui|core'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'seal:set': { exit: 0, ids: ['s1'] },
    'law:stage-end': GREEN,
    'state:write': GREEN,
    'audit:member': { exit: 0, ids: ['covered:s1'] },
  })
  assert.equal(logged.ret.status, 'ok')
  const check = logged.calls.find(c => c.label === 'audit:member')
  assert.ok(check && check.prompt.includes("kiln-review' audit-member .kiln 's1'"), 'the skip reads the reduction through the trusted verb, shq-quoted — never a grep over the rendered projection')
  assert.ok(!logged.calls.some(c => c.label === 'law:pre-audit' || c.label === 'audit:review'), 'a boot-sealed covered seam neither refreshes the receipt nor audits again')
  // Resume: every slice already sealed, the final seam unaudited — the audit fires on the skip path.
  const resumed = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui|core', 'obj|s2|ui|core'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'seal:set': { exit: 0, ids: ['s1', 's2'] },
    'law:stage-end': GREEN,
    'state:write': GREEN,
    ...AUDIT_OK,
  })
  assert.equal(resumed.ret.status, 'ok')
  assert.equal(resumed.calls.filter(c => c.label && c.label.startsWith('slice:')).length, 0, 'no slice work re-runs on the all-sealed resume')
  assert.equal(resumed.calls.filter(c => c.label === 'audit:review').length, 1, 'the unaudited seam re-fires on the seal-skip path')
  const receiptAt = resumed.calls.findIndex(c => c.label === 'law:pre-audit')
  const auditAt = resumed.calls.findIndex(c => c.label === 'audit:review')
  assert.ok(receiptAt >= 0 && receiptAt < auditAt, 'the LAW check receipt refreshes on the skip path BEFORE the audit')
  assert.ok(resumed.calls[receiptAt].prompt.includes('check-receipt.txt'), 'the refresh is the receipt-writing check run, verbatim evidence for the auditor')
  assert.ok(resumed.calls.some(c => c.label === 'audit:append'), 'the accepted resume audit still promotes')
})

test('runtime (W7-S2): a red receipt at the seam takes the law-red door — no audit over a red law', async () => {
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui|core'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'seal:set': { exit: 0, ids: ['s1'] },
    'state:write': GREEN,
    'audit:member': { exit: 1 },
    'law:pre-audit': { exit: 1, ids: [] },
  })
  assert.equal(ret.status, 'law-red')
  assert.ok(!calls.some(c => c.label === 'audit:review'), 'no audit runs over a red law')
  assert.ok(!calls.some(c => c.label === 'audit:append'), 'nothing promotes')
  const seamRed = stateArgs(calls)
  assert.equal(seamRed.key, 'reopen-slice', 'the seam law-red takes the reopen-slice key')
  assert.equal(seamRed.slice, 's1', 'and names the seam slice as active_slice')
})

test('runtime (W7-S2 / S4): the audit adapter maps the closed exits — 20 transport-failure, 21 the degraded acknowledgment stop, 127 gate-unreachable; none repair, none promote', async () => {
  const base = (exit) => ({
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui|core'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'seal:set': { exit: 0, ids: ['s1'] },
    'state:write': GREEN,
    'audit:member': { exit: 1 },
    'law:pre-audit': GREEN,
    'audit:review': { exit },
    'degraded:mark': { exit: 0 },
  })
  const transport = await runKernel({ stage: 'build', projectDir: '/p' }, base(20))
  assert.equal(transport.ret.status, 'transport-failure')
  const degraded = await runKernel({ stage: 'build', projectDir: '/p' }, base(21))
  assert.equal(degraded.ret.status, 'degraded')
  const auditMark = degraded.calls.find(c => c.label === 'degraded:mark')
  assert.ok(auditMark, 'the degraded stop marks for acknowledgment as the slice gates do')
  assert.ok(auditMark.prompt.includes('touch .kiln/degraded') && !auditMark.prompt.includes('degraded-ack'),
    'the audit detection touches the degraded marker ALONE — the ack is the operator word (S10, Sol r1 B1)')
  const auditDeg = stateArgs(degraded.calls)
  assert.equal(auditDeg.key, 'acknowledge-degrade', 'the audit-degraded STATE takes the acknowledge-degrade key — the acked re-run audits single-family, it never waits on codex')
  assert.equal(auditDeg.slice, 's1', 'and names only the seam slice as active_slice')
  const unreachable = await runKernel({ stage: 'build', projectDir: '/p' }, base(127))
  assert.equal(unreachable.ret.status, 'gate-unreachable')
  for (const r of [transport, degraded, unreachable]) {
    assert.ok(!r.calls.some(c => c.label === 'audit:repair'), 'no repair edge is spent on a non-verdict class')
    assert.ok(!r.calls.some(c => c.label === 'audit:append'), 'no promotion without an accept')
  }
})

test('runtime (S4, INTAKE-38): the degraded claude milestone auditor holds transport-class on an orphan blocker and a malformed finding — never publishes, never appends', async () => {
  // The acked (marker-present) claude auditor seat, given a well-formed echo but an unsound verdict.
  // The seat feeds the SAME reconcileAudit derivation and the SAME referential rule the codex audit
  // enforces — a blocker that names no finding id, or a finding missing its schema fields, is the
  // invalid-artifact hold: no publish, no append, the seam holds transport-class.
  const claudeAuditHold = (auditRead) => runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui|core'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'seal:set': { exit: 0, ids: ['s1'] },
    'law:stage-end': GREEN,
    'state:write': GREEN,
    'audit:member': { exit: 1 }, // open seam
    'law:pre-audit': GREEN,
    'audit:degraded': { exit: 0 }, // the marker is present at the audit — the claude auditor seat
    'audit:degraded-ack': { exit: 0 }, // with the operator word behind it (S10d)
    'audit-claude:lawhash': { exit: 0, ids: ['a'.repeat(64)] },
    'audit-claude:invalidate': { exit: 0 },
    'audit-claude:review': { ok: true },
    'audit-claude:read': auditRead,
  })
  // ORPHAN BLOCKER: a blocked verdict whose blocker names no finding id — one well-formed finding f1.
  const orphan = await claudeAuditHold(readAudit(auditVerdict('blocked', [auditFinding('f1')], ['bz'])))
  assert.equal(orphan.ret.status, 'transport-failure', 'a blocker that names no finding holds the seam transport-class')
  assert.ok(!orphan.calls.some(c => c.label === 'audit-claude:publish'), 'the orphan-blocker verdict never publishes')
  assert.ok(!orphan.calls.some(c => c.label === 'audit:append'), 'the orphan-blocker verdict never appends')
  // MALFORMED FINDINGS: a finding object missing its required schema fields.
  const malformed = await claudeAuditHold(readAudit(auditVerdict('changes_required', [{ id: 'f1' }])))
  assert.equal(malformed.ret.status, 'transport-failure', 'a finding missing its schema fields holds the seam transport-class')
  assert.ok(!malformed.calls.some(c => c.label === 'audit-claude:publish'), 'the malformed verdict never publishes')
  assert.ok(!malformed.calls.some(c => c.label === 'audit:append'), 'the malformed verdict never appends')
})

test('runtime (W2-S3): the degraded claude auditor brackets its turn with the trio digest — a member changed mid-turn fails the audit closed, never publishes', async () => {
  const mutated = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui|core'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'seal:set': { exit: 0, ids: ['s1'] },
    'law:stage-end': GREEN,
    'state:write': GREEN,
    'audit:member': { exit: 1 }, // open seam
    'law:pre-audit': GREEN,
    'audit:degraded': { exit: 0 }, 'audit:degraded-ack': { exit: 0 }, // the claude auditor seat, word on disk (S10d)
    'audit-claude:lawhash': { exit: 0, ids: ['a'.repeat(64)] },
    'audit-claude:invalidate': { exit: 0 },
    'audit-claude:review': { ok: true },
    'audit-claude:read': readAudit(auditVerdict('accept')),
    // The write-capable auditor mutated a trio member during its turn — the after-digest differs.
    'audit-claude:trio-confirm': { exit: 0, ids: ['t1', 't2', 'CHANGED'] },
  })
  assert.ok(mutated.calls.some(c => c.label === 'audit-claude:trio-digest'), 'the trio is digested before the auditor turn')
  assert.ok(mutated.calls.some(c => c.label === 'audit-claude:trio-confirm'), 'and recomputed after the turn (the S4-D1 pattern)')
  assert.equal(mutated.ret.status, 'transport-failure', 'a trio mutated during the turn fails the audit closed')
  assert.ok(!mutated.calls.some(c => c.label === 'audit-claude:publish'), 'the mutated-trio verdict never publishes')
  assert.ok(!mutated.calls.some(c => c.label === 'audit:append'), 'the mutated-trio verdict never appends')
})

test('runtime (W2-S3 B04): the claude screen turn is bracketed by the trio digest — a member changed mid-turn fails the screen closed, never publishes', async () => {
  const { ret, calls } = await runKernel({ stage: 'validate', projectDir: '/p' }, {
    ...CLAUDE_LIVE,
    // The write-capable claude screen reviewer mutated a trio member during its turn.
    'screen-claude:trio-confirm': { exit: 0, ids: ['t1', 't2', 'CHANGED'] },
  })
  assert.ok(calls.some(c => c.label === 'screen-claude:trio-digest') && calls.some(c => c.label === 'screen-claude:trio-confirm'),
    'the claude screen turn is bracketed by a trio digest before review and after, ruled before publish')
  assert.notEqual(ret.status, 'ok', 'a trio mutated during the claude screen turn holds — the run never accepts over tampered law')
  assert.ok(!calls.some(c => c.label === 'screen:publish'), 'the mutated-trio screen verdict never publishes')
})

test('runtime (W2-S3 B04): the claude screen d0 is bound to the SEALED trio.hash — a live trio self-consistent across the turn but OFF the seal never publishes', async () => {
  const { ret, calls } = await runKernel({ stage: 'validate', projectDir: '/p' }, {
    ...CLAUDE_LIVE,
    // The live trio drifted before the turn: d0 === d1 (self-consistent across the turn), but
    // neither matches the SEALED digests read from trio.hash — a d0/d1-only bracket would pass.
    'screen-claude:trio-sealed': { exit: 0, ids: ['s1', 's2', 's3'] },
    'screen-claude:trio-digest': { exit: 0, ids: ['t1', 't2', 't3'] },
    'screen-claude:trio-confirm': { exit: 0, ids: ['t1', 't2', 't3'] },
  })
  assert.ok(calls.some(c => c.label === 'screen-claude:trio-sealed'), 'the bracket reads the sealed trio.hash digests to bind d0')
  assert.notEqual(ret.status, 'ok', 'a live trio off the seal holds even when it stayed self-consistent across the turn')
  assert.ok(!calls.some(c => c.label === 'screen:publish'), 'nothing publishes over a pre-turn drift the seal never authorized')
})

test('runtime (S4-B1, INTAKE-38): the degraded claude milestone auditor is seam-bounded to the kernel projection — an all-sealed resume audits ONLY the closing block and the cumulative prefix, never a later slice', async () => {
  // The divergence Sol named: a labeled plan a,a,b (s1,s2 close milestone A; s3 closes B) resumes
  // with every slice sealed on the ledger but the s2 seam audit still owed. seals.log holds the
  // LATER s3, so a seal-ledger-authoritative auditor could accept the A milestone on s3's work or
  // raise an out-of-prefix finding. The kernel derives the closing block and sealed prefix from its
  // own trim-normalized projection and binds the claude auditor to them — s3 never enters the audit.
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|logic|A', 'obj|s2|logic|A', 'obj|s3|logic|B'] },
    'seal:set': { exit: 0, ids: ['s1', 's2', 's3'] }, // every slice already sealed on the ledger
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'law:stage-end': GREEN,
    'state:write': GREEN,
    // The s3 seam already carries a current audit over its whole prefix; the s2 seam audit is
    // missing — only s2 re-fires.
    'audit:member': (p) => (p.includes("audit-member .kiln 's3'") ? { exit: 0, ids: ['covered:s1,s2,s3'] } : { exit: 1 }),
    'law:pre-audit': GREEN,
    'audit:degraded': { exit: 0 }, 'audit:degraded-ack': { exit: 0 }, // the marker and the word (S10d)
    'audit-claude:lawhash': { exit: 0, ids: ['a'.repeat(64)] },
    'audit-claude:invalidate': { exit: 0 },
    'audit-claude:review': { ok: true },
    'audit-claude:read': readAudit(auditVerdict('accept')),
    'audit-claude:publish': { exit: 0 },
    'audit:read': readAudit(auditVerdict('accept')),
    'audit:seal-label': { exit: 0 }, // present → single-family append
    'audit:append': { exit: 0 },
  })
  assert.equal(ret.status, 'ok', 'the all-sealed resume completes once the owed s2 seam audits single-family')
  const audits = calls.filter(c => c.label === 'audit-claude:review')
  assert.equal(audits.length, 1, 'only the unlogged s2 seam re-fires — the logged s3 seam skips')
  const prompt = audits[0].prompt
  assert.ok(prompt.includes('closes at slice s2'), 'the audit is bound to the s2 seam')
  assert.ok(/closing block is exactly: s1, s2\b/.test(prompt), 'the closing block is the contiguous same-label run ending at s2 — exactly s1, s2')
  assert.ok(/cumulative sealed prefix under audit is exactly: s1, s2\b/.test(prompt), 'the cumulative prefix under audit is exactly s1, s2 — the seam and everything before it')
  assert.ok(!/\bs3\b/.test(prompt), 'the later slice s3 is never named — out of scope, never evidence, never a finding')
  assert.ok(!prompt.includes('seal ledger') && !prompt.includes('.kiln/seals.log'), 'the seal ledger is no longer the prefix authority — the kernel projection is')
  // W2-S5 production wiring: the claude audit verdict publishes through the archive-then-publish verb
  // under the audit family, archiving the verdict before the content-free overwrite of the audit gate.
  const auditPublish = calls.find(c => c.label === 'audit-claude:publish')
  assert.ok(auditPublish && auditPublish.prompt.includes('publish-gate .kiln audit'), 'the claude audit verdict routes through the W2-S5 publish-gate verb under the audit family')
})

// W2-S7b (item 10, the D2 cure): the dedicated audit-repair mutation path is GONE. A non-accept
// withdraws the covered prefix and stops; the ordinary build path rebuilds it on the next boot.
const REJECT_SEAM = (wireExit, verdict) => ({
  ...VOICE,
  'law:preflight': GREEN,
  'slices:fetch': { exit: 0, ids: ['obj|s1|ui|core', 'obj|s2|ui|core'] },
  'ladder:fetch': LADDER,
  'cap:read': { exit: 0, recovery_cap: 2 },
  'seal:set': { exit: 0, ids: ['s1', 's2'] },
  'state:write': GREEN,
  'audit:member': { exit: 1 },
  'law:pre-audit': GREEN,
  'audit:review': { exit: wireExit },
  'audit:read': readAudit(verdict),
  'audit:findings': { exit: 0, ids: ['F1'] },
})

test('runtime (W2-S7b, item 10): a derived non-accept WITHDRAWS the whole covered prefix through ONE batch cutoff, before the STATE write, and stops for the operator ruling', async () => {
  for (const [wireExit, verdict] of [
    [10, auditVerdict('changes_required', [auditFinding('F1')])],
    [11, auditVerdict('blocked', [auditFinding('F1')], ['F1'])],
  ]) {
    const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, REJECT_SEAM(wireExit, verdict))
    assert.equal(ret.status, 'blocked', 'exit ' + wireExit + ': the milestone rejection is the operator-ruling stop')
    const cuts = calls.filter(c => c.label === 'seal:invalidate')
    assert.equal(cuts.length, 1, 'exit ' + wireExit + ': ONE atomic batch cutoff — never one event per slice, so no rejection leaves half a prefix withdrawn')
    assert.ok(cuts[0].prompt.includes("kiln-review' invalidate .kiln 's1,s2'"), 'exit ' + wireExit + ': the whole covered prefix rides one shq-quoted csv')
    assert.ok(calls.findIndex(c => c.label === 'seal:invalidate') < calls.findIndex(c => c.label === 'state:write'),
      'exit ' + wireExit + ': the cutoff lands BEFORE the STATE write — a crash between them relaunches onto a durable withdrawal, never a stale verdict')
    assert.ok(!calls.some(c => c.label === 'audit:repair' || c.label === 'audit:recheck'),
      'exit ' + wireExit + ': no model mutates sealed content behind standing seals — the ordinary build path rebuilds the prefix')
    assert.ok(!calls.some(c => c.label === 'audit:append'), 'exit ' + wireExit + ': nothing promotes')
    assert.deepEqual(ret.pointers.finding_ids, ['F1'], 'exit ' + wireExit + ': the blocked shape carries the closed finding ids')
    assert.equal(ret.pointers.gate, AUDIT, 'exit ' + wireExit + ': and points at the audit artifact')
    const held = stateArgs(calls)
    assert.equal(held.key, 'operator-ruling', 'exit ' + wireExit + ': the rejected seam takes the operator-ruling key')
    assert.equal(held.slice, 's2', 'exit ' + wireExit + ': naming the seam slice as active_slice')
    assert.ok(held.pointers.includes(AUDIT), 'exit ' + wireExit + ': the audit verdict path rides the pointers so the operator still finds it')
    assert.ok(!held.cmd.includes('secret-audit-prose') && !held.cmd.includes('C-1'), 'exit ' + wireExit + ': no verdict prose or finding ids ride the courier — closed facts only')
  }
})

test('runtime (W2-S7b, item 10): a ledger that REFUSES the withdrawal holds the run — never a blocked stop over a prefix that still renders sealed', async () => {
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...REJECT_SEAM(10, auditVerdict('changes_required', [auditFinding('F1')])),
    'seal:invalidate': { exit: 20 },
  })
  assert.equal(ret.status, 'persist-failed', 'the ledger-refused-the-write grammar, not a stop that claims a withdrawal that never landed')
  assert.equal(ret.pointers.failed, 'seal-invalidate')
  assert.ok(!calls.some(c => c.label === 'state:write'), 'and no STATE advances past a rejection the ledger did not record')
})

test('runtime (W7-S2): the kernel branches on its OWN derivation — a wire verdict the closed arrays do not support, or an invalid artifact, is the transport-class hold', async () => {
  for (const [name, wireExit, read] of [
    ['a recompute mismatch (wire accept over nonempty findings)', 0, readAudit(auditVerdict('accept', [auditFinding('F1')]))],
    ['an invalid artifact (blockers behind no findings)', 11, readAudit(auditVerdict('blocked', [], ['ghost']))],
    // W7S2-03: JSON `null` parses clean — the adapter must stay total, never throw.
    ['a null artifact (valid JSON, not an object)', 0, readAudit(null)],
    // W7S2-04: derived accept agrees with exit 0, but the published verdict STRING
    // disagrees — the string is the third party to the agreement, not a bystander.
    ['a wire-string disagreement (a blocked string over empty arrays at exit 0)', 0, readAudit(auditVerdict('blocked'))],
  ]) {
    const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
      ...VOICE,
      'law:preflight': GREEN,
      'slices:fetch': { exit: 0, ids: ['obj|s1|ui|core'] },
      'ladder:fetch': LADDER,
      'cap:read': { exit: 0, recovery_cap: 2 },
      'seal:set': { exit: 0, ids: ['s1'] },
      'state:write': GREEN,
      'audit:member': { exit: 1 },
      'law:pre-audit': GREEN,
      'audit:review': { exit: wireExit },
      'audit:read': read,
    })
    assert.equal(ret.status, 'transport-failure', name + ' holds transport-class — the invalid-artifact wire law')
    assert.ok(!calls.some(c => c.label === 'audit:append'), name + ': never promotes')
    assert.ok(!calls.some(c => c.label === 'seal:invalidate'), name + ': and never withdraws a prefix on a verdict it could not trust — the cutoff rides the derivation, never the wire exit')
  }
})

test('runtime (W2-S7b, item 11): the audited-skip demands coverage that SPANS the verified prefix — a NARROWER covered set re-audits, and the W1 coverage-less member still answers', async () => {
  // The resurrection shape the u1 seat found: nested covered sets for one seam (A1 over s1, A2 over
  // s1+s2). Invalidating s2 stales A2, and the reduction re-elects the NARROWER A1 — which would
  // render the seam audited while s2 rebuilds unjudged. The kernel owns the guard: the rendered
  // audit's coverage must SPAN the prefix it is about to skip.
  const base = (member) => ({
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui|core', 'obj|s2|ui|core'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'seal:set': { exit: 0, ids: ['s1', 's2'] },
    'law:stage-end': GREEN,
    'state:write': GREEN,
    ...AUDIT_OK,
    'audit:member': member,
  })
  const narrow = await runKernel({ stage: 'build', projectDir: '/p' }, base({ exit: 0, ids: ['covered:s1'] }))
  assert.equal(narrow.ret.status, 'ok')
  assert.equal(narrow.calls.filter(c => c.label === 'audit:review').length, 1, 'a covered set narrower than the verified prefix never renders the seam audited')
  const spanning = await runKernel({ stage: 'build', projectDir: '/p' }, base({ exit: 0, ids: ['covered:s1,s2'] }))
  assert.ok(!spanning.calls.some(c => c.label === 'audit:review'), 'the spanning covered set is the only modern answer that skips')
  const legacy = await runKernel({ stage: 'build', projectDir: '/p' }, base({ exit: 0, ids: ['legacy'] }))
  assert.ok(!legacy.calls.some(c => c.label === 'audit:review'), 'the coverage-less W1 member keeps its exact pre-S7b skip — the migration path never quietly retires')
})

test('runtime (W2-S7b, item 11): the member answer is read by its TAG — a modern audit covering exactly a slice NAMED legacy never passes as the coverage-less W1 member', async () => {
  // Sol B1: a slice id may legitimately be the word `legacy`, so an untagged answer put the sentinel
  // and real data in one namespace. The prefix here is [new, legacy] and the current member covers
  // ONLY the slice named legacy — a narrow modern audit. Read by payload it is indistinguishable from
  // the W1 sentinel and skips the milestone; read by tag it is what it is, and the seam re-audits.
  const walk = (member) => runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|new|ui|core', 'obj|legacy|ui|core'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'seal:set': { exit: 0, ids: ['new', 'legacy'] },
    'law:stage-end': GREEN,
    'state:write': GREEN,
    ...AUDIT_OK,
    'audit:member': member,
  })
  const narrow = await walk({ exit: 0, ids: ['covered:legacy'] })
  assert.equal(narrow.calls.filter(c => c.label === 'audit:review').length, 1,
    'the audit covers only the slice named legacy, not the whole prefix — it never buys the skip')
  const spanning = await walk({ exit: 0, ids: ['covered:new,legacy'] })
  assert.ok(!spanning.calls.some(c => c.label === 'audit:review'), 'the genuinely spanning answer still skips over the same plan')
  const migrated = await walk({ exit: 0, ids: ['legacy'] })
  assert.ok(!migrated.calls.some(c => c.label === 'audit:review'), 'and the bare tag is still the W1 member, even in a plan that contains a slice by that name')
})

test('runtime (W2-S7b, item 11): an untrusted audit-member answer holds transport-class — a bad exit and a malformed stdout never read as absence', async () => {
  // W7S2-02, carried to the reduction-backed verb: only a PROVEN absence (exit 1) may re-audit — an
  // unread ledger could hide a current member, and a re-audit would re-append an already-logged seam.
  for (const [name, member] of [
    ['an unreadable ledger (2)', { exit: 2, ids: [] }],
    ['a transport failure (20)', { exit: 20, ids: [] }],
    ['exit 0 with no answer', { exit: 0, ids: [] }],
    ['exit 0 with a split answer', { exit: 0, ids: ['covered:s1', 's2'] }],
  ]) {
    const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
      ...VOICE,
      'law:preflight': GREEN,
      'slices:fetch': { exit: 0, ids: ['obj|s1|ui|core'] },
      'ladder:fetch': LADDER,
      'cap:read': { exit: 0, recovery_cap: 2 },
      'seal:set': { exit: 0, ids: ['s1'] },
      'state:write': GREEN,
      'audit:member': member,
    })
    assert.equal(ret.status, 'transport-failure', name + ': an untrusted membership answer is a hold, never absence')
    assert.ok(!calls.some(c => c.label === 'law:pre-audit' || c.label === 'audit:review'), name + ': no audit over an unread ledger')
    assert.ok(!calls.some(c => c.label === 'audit:append'), name + ': nothing re-appends')
    const membership = stateArgs(calls)
    assert.equal(membership.key, 'rerun-build', name + ': the static next_action reruns the build stage (target-stage key)')
    assert.equal(membership.slice, 's1', name + ': and names the seam slice as active_slice')
  }
})

// ── W7-S3: dogfood — the seam choreography proven whole across invocations ──────
// Cross-gate integration: full build-branch scenarios on the mocked runtime with the MEMBERSHIP leg
// executing for REAL. The launch names the actual repo plugin root, and the audit:member handler runs
// its exact issued command — the trusted read-only verb — inside a real temp project dir, transcribing
// its closed exit law faithfully (0 with one stdout line, otherwise no answer at all).
// W2-S7b: the append verbs are ATTESTED now — a modern candidate binds by reference to a published
// verdict over a real trio, manifest and current seal tuples — so the ledger truth is proven where
// that evidence can be built, in kiln-review.test.mjs. What these scenarios own is the CHOREOGRAPHY:
// which seam audits, in which invocation, with which argv.
const REAL_PLUGIN = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const runReal = (prompt, dir) => ({ exit: spawnSync('sh', ['-c', prompt.split('\n').pop()], { cwd: dir }).status })
const realAuditDisk = (dir) => ({
  'audit:member': (p) => {
    const r = spawnSync('sh', ['-c', p.split('\n').pop()], { cwd: dir, encoding: 'utf8' })
    return { exit: r.status === null ? 20 : r.status, ids: r.status === 0 ? [r.stdout.trim()] : [] }
  },
  'audit:append': { exit: 0 },
})
const mkProject = () => { const dir = mkdtempSync(join(tmpdir(), 'kiln-dogfood-')); mkdirSync(join(dir, '.kiln')); return dir }
// The all-passing build scaffold every dogfood scenario starts from; scenarios
// override the legs their subject exercises.
const dogfoodBase = (dir) => ({
  ...VOICE,
  'law:preflight': GREEN,
  'ladder:fetch': LADDER,
  'cap:read': { exit: 0, recovery_cap: 2 },
  'law:pre-seal': GREEN,
  'law:stage-end': GREEN,
  'degraded:check': { exit: 1 },
  'gate:review': { exit: 0 },
  'seal:append': { exit: 0 },
  'state:write': GREEN,
  'law:pre-audit': GREEN,
  ...realAuditDisk(dir),
})

test('dogfood (W7-S3 / W2-S7b): a labeled two-milestone plan walks its seams ACROSS invocations — each fresh seam relaunches, and the boot that follows audits it over rendered membership', async () => {
  const dir = mkProject()
  // Spaced labels are legal — they live in slices.json and the prompt file, never argv.
  const plan = { exit: 0, ids: ['obj|c1|ui|core engine', 'obj|c2|ui|core engine', 'obj|p1|ui|polish pass', 'obj|p2|ui|polish pass'] }
  // Invocation 1: c1 and c2 build; the c2 seam seals and RELAUNCHES. Nothing is audited over a prefix
  // this invocation rebuilt, and p1 never starts — the loop does not advance past an unaudited seam.
  const first = await runKernel({ stage: 'build', projectDir: dir, plugin: REAL_PLUGIN }, {
    ...dogfoodBase(dir),
    'slices:fetch': plan,
    'slice:c1': auditSlice(), 'slice:c2': auditSlice(),
    'audit:review': { exit: 0 },
    'audit:read': readAudit(auditVerdict('accept')),
  })
  assert.equal(first.ret.status, 'ok')
  assert.equal(first.ret.pointers.next_stage, 'build', 'the fresh seam hands the run straight back to build')
  assert.equal(first.calls.filter(c => c.label === 'gate:review').length, 2, 'every built slice still takes its per-slice gate')
  assert.equal(first.calls.filter(c => c.label === 'seal:append').length, 2, 'c1 and c2 sealed; p1 never started')
  assert.ok(!first.calls.some(c => c.label === 'audit:review'), 'no audit over the provisional prefix')
  assert.ok(first.ret.beat.includes('Slice c2 sealed — dual'), 'the seal beat still speaks for the seam slice')
  // Invocation 2, after the conductor capture promoted c1 and c2: the owed c2 seam audits over
  // RENDERED membership, p1 and p2 build, and the p2 seam relaunches in its turn.
  const second = await runKernel({ stage: 'build', projectDir: dir, plugin: REAL_PLUGIN }, {
    ...dogfoodBase(dir),
    'slices:fetch': plan,
    'seal:set': { exit: 0, ids: ['c1', 'c2'] },
    'slice:p1': auditSlice(), 'slice:p2': auditSlice(),
    'audit:review': { exit: 0 },
    'audit:read': readAudit(auditVerdict('accept')),
  })
  assert.equal(second.ret.status, 'ok')
  const audits = second.calls.filter(c => c.label === 'audit:review')
  assert.equal(audits.length, 1, 'exactly the owed c2 seam audits — p2 is fresh, so it relaunches instead')
  assert.ok(audits[0].prompt.includes('kiln-review audit . .kiln c2 gpt-5.6-sol gpt-sol high ' + AUDIT), 'closed argv only — the seam id, the reviewer-gate model and effort, the artifact path')
  assert.ok(!audits[0].prompt.includes('core engine') && !audits[0].prompt.includes('polish pass'),
    'the spaced labels never ride the audit argv — the CLI derives the closing block from slices.json')
  const member = second.calls.find(c => c.label === 'audit:member')
  assert.ok(member.prompt.includes("audit-member .kiln 'c2'"), 'the membership answer comes from the REAL read-only verb over this project dir')
  assert.equal(member.exit, undefined)
  const append = second.calls.find(c => c.label === 'audit:append')
  assert.ok(append.prompt.includes("append-audit .kiln c2 dual '-' '' 'reviewed'"),
    'the accepted seam promotes through the trusted verb — the codex auditor sentinel, an empty repair-legs word, and its attestation kind, passed unconditionally')
  // Invocation 3: the capture promoted the c2 audit too, so the whole plan is sealed and judged.
  const third = await runKernel({ stage: 'build', projectDir: dir, plugin: REAL_PLUGIN }, {
    ...dogfoodBase(dir),
    'slices:fetch': plan,
    'seal:set': { exit: 0, ids: ['c1', 'c2', 'p1', 'p2'] },
    'audit:member': (p) => (p.includes("audit-member .kiln 'c2'") ? { exit: 0, ids: ['covered:c1,c2'] } : { exit: 1 }),
    'audit:review': { exit: 0 },
    'audit:read': readAudit(auditVerdict('accept')),
  })
  assert.equal(third.calls.filter(c => c.label === 'audit:review').length, 1, 'the judged c2 seam skips; only the owed p2 seam audits')
  assert.ok(third.calls.find(c => c.label === 'audit:review').prompt.includes('kiln-review audit . .kiln p2 '), 'the final seam is the implicit whole-build milestone')
  assert.equal(stateArgs(third.calls).key, 'relaunch-validate', 'with every seam judged, the build stage finally advances to validate')
})

test('dogfood (W2-S7b, item 10): a rejected milestone withdraws its covered prefix on real argv and stops — the next boot rebuilds through the ordinary path', async () => {
  const dir = mkProject()
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: dir, plugin: REAL_PLUGIN }, {
    ...dogfoodBase(dir),
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui|m one', 'obj|s2|ui|m one'] },
    'seal:set': { exit: 0, ids: ['s1', 's2'] },
    'audit:review': { exit: 10 },
    'audit:read': readAudit(auditVerdict('changes_required', [auditFinding('F1'), auditFinding('F2')])),
    'audit:findings': { exit: 0, ids: ['F1', 'F2'] },
  })
  assert.equal(ret.status, 'blocked', 'the milestone rejection is the operator-ruling stop')
  const cut = calls.find(c => c.label === 'seal:invalidate')
  assert.ok(cut.prompt.includes("kiln-review' invalidate .kiln 's1,s2'"), 'ONE batch cutoff over the whole covered prefix')
  assert.ok(!calls.some(c => c.label === 'audit:append'), 'nothing is promoted over a rejected milestone')
  assert.deepEqual(ret.pointers.finding_ids, ['F1', 'F2'], 'the operator gets the finding ids and the verdict path')
  assert.ok(ret.beat.includes('did not accept slice s2') && ret.beat.includes('withdrawn'), 'and the beat says plainly what was withdrawn')
})

test('dogfood (W7-S3): non-contiguous repeated labels are legal — a|b|a raises three seams, and the two a-seams each audit their own closing block', async () => {
  const dir = mkProject()
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: dir, plugin: REAL_PLUGIN }, {
    ...dogfoodBase(dir),
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui|a', 'obj|s2|ui|b', 'obj|s3|ui|a'] },
    'seal:set': { exit: 0, ids: ['s1', 's2', 's3'] },
    'audit:review': { exit: 0 },
    'audit:read': readAudit(auditVerdict('accept')),
  })
  assert.equal(ret.status, 'ok')
  const audits = calls.filter(c => c.label === 'audit:review')
  assert.equal(audits.length, 3, 'every adjacency change is a seam — a|b, b|a, and the final')
  assert.ok(audits[0].prompt.includes('.kiln s1 '), 'the first a-block closes at s1 and audits itself')
  assert.ok(audits[1].prompt.includes('.kiln s2 '), 'the b block closes at s2')
  assert.ok(audits[2].prompt.includes('.kiln s3 '), 'the second a-block closes at s3 — its own audit, never merged with s1')
  const appends = calls.filter(c => c.label === 'audit:append')
  assert.equal(appends.length, 3, 'each accepted seam promotes under its own closing slice id')
  for (const [i, seam] of ['s1', 's2', 's3'].entries()) {
    assert.ok(appends[i].prompt.includes("append-audit .kiln " + seam + " dual '-' '' 'reviewed'"), 'the ' + seam + ' seam appends its attested audit')
  }
})

test('dogfood (W7-S3): ratify, build, and audit gates coexist across one project run — the audit consumes the SAME one-read cap as the build gate, and the recovery machinery elsewhere is untouched', async () => {
  // One project, two sequential launches over the SAME directory — the law
  // stage seals it, then the build stage takes it: the relaunch handoff the
  // STATE next_action names. The law launch first: the unchanged ratify loop
  // rejects once, repairs, rechecks, and seals — recoveryDecision as W6 left it.
  const dir = mkProject()
  const ratifyExits = [10, 0]
  const law = await runKernel({ stage: 'law', projectDir: dir }, {
    ...VOICE,
    ...ONBOARDING_OK,
    'width:read': { exit: 0, width: 'floor', recovery_cap: 1 },
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'the law, pinned' },
    'ratify:request': GREEN,
    'ratify:gate': () => ({ exit: ratifyExits.shift() }),
    'ratify:cohort': { exit: 0, ids: ['R1'] },
    'ratify:repair': { facts: { status: 'ok', pointers: ['.kiln/LAW.md'], schema_valid: true }, narration_beat: 'the law, revised' },
    'law:milestone-projection': { exit: 0 },
    'law:perceptual-table': { exit: 0 },
    'law:seal': { exit: 0 },
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(law.ret.status, 'ok', 'the ratify gate is unperturbed — reject, one repair, recheck, seal')
  assert.equal(law.calls.filter(c => c.label === 'ratify:repair').length, 1)
  assert.ok(law.ret.beat.includes('the law, revised'), 'the buffered repaired-candidate beat speaks only after ratify AND seal')
  assert.equal(stateArgs(law.calls).key, 'relaunch-build',
    'the sealed law hands THIS project to the build launch that follows — the cross-stage transition')
  // The build launch over the same project: ONE dial read (cap 1) serves the
  // slice gate and the seam audit alike. The slice gate spends its one edge and
  // seals — untouched; the audit spends ITS one edge on genuine strict progress
  // and still holds at the same cap, proving both gates drink from the same reading.
  const auditReads = [
    readAudit(auditVerdict('changes_required', [auditFinding('F1'), auditFinding('F2')])),
    readAudit(auditVerdict('changes_required', [auditFinding('F1')])),
  ]
  const auditCohorts = [['F1', 'F2'], ['F1'], ['F1']]
  const run = await runKernel({ stage: 'build', projectDir: dir, plugin: REAL_PLUGIN }, {
    ...dogfoodBase(dir),
    'cap:read': { exit: 0, recovery_cap: 1 },
    // s1 stands sealed at boot and owes its milestone audit; s2 opens the next milestone and is built
    // here — so one invocation carries an audit over rendered membership AND a full slice-gate cycle.
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui|m1', 'obj|s2|ui|m2'] },
    'seal:set': { exit: 0, ids: ['s1'] },
    'slice:s2': auditSlice(),
    'gate:review': { exit: 10 },
    'law:pre-recheck': GREEN,
    'gate:recheck': { exit: 0 },
    'findings:fetch': { exit: 0, ids: ['G1', 'G2'] },
    'repair:s2': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'mended' },
    'delta:check': { exit: 0 },
    'audit:review': { exit: 0 },
    'audit:read': readAudit(auditVerdict('accept')),
  })
  assert.equal(run.calls.filter(c => c.label === 'cap:read').length, 1, 'ONE dial read per build invocation')
  assert.ok(!run.calls.some(c => c.label === 'width:read'), 'the build branch never takes a second dial read')
  // The slice gate, untouched W6 behavior: one repair edge under cap 1, then the seal.
  assert.equal(run.calls.filter(c => c.label === 'repair:s2').length, 1, 'the slice gate spent its one edge and recovered')
  const recheckAt = run.calls.findIndex(c => c.label === 'gate:recheck')
  const sealAt = run.calls.findIndex(c => c.label === 'seal:append')
  assert.ok(recheckAt >= 0 && recheckAt < sealAt, 'recheck-accept preceded the seal — the W6 cycle exactly')
  assert.ok(run.calls[sealAt].prompt.includes('append-seal .kiln s2'), 'the repaired slice sealed as ever')
  // The audit gate spends NO recovery edge at all now (item 10): it judges once and either promotes
  // or withdraws, so the cap is the slice gate's alone.
  assert.equal(run.ret.status, 'ok', 'the judged s1 milestone and the rebuilt s2 both land')
  assert.equal(run.ret.pointers.next_stage, 'build', 'and the fresh s2 seam relaunches for its own audit')
  assert.ok(run.calls.some(c => c.label === 'audit:append'), 'the accepted s1 milestone promoted')
  assert.ok(!run.calls.some(c => c.label === 'audit:repair' || c.label === 'audit:recheck'), 'no recovery edge is spent at the audit')
})

// ── W8-S3: the screening room — the perceptual gate seated in validate ──────
const SCREEN = '.kiln/screen-review.json'
const SCREEN_ESC = '.kiln/screen-escalation.json'
const MF = (n) => '.kiln/evidence/gen-' + n + '/manifest.json'
const screenFinding = (id, criterion) => ({ id, criterion, location: 'viewport-mobile.png', failure_mode: 'clipped hero', evidence: 'secret-screen-prose', minimal_fix: 'unclip it' })
const screenVerdict = (verdict, findings = [], hash = 'b'.repeat(64)) => ({ review_id: 'scr-1', law_hash: hash, findings, blockers: [], verdict })
const validateAct = () => ({ facts: { status: 'ok', pointers: ['.kiln/validate.md'], schema_valid: true }, narration_beat: 'a hundred eyes' })
const DIGEST_B = { exit: 0, ids: ['b'.repeat(64)] }
const ADDENDUM_OK = { 'perceptual:addendum': { facts: { status: 'ok', pointers: ['.kiln/validate.md'], schema_valid: true }, narration_beat: 'rows appended' } }
// A live validate run: table present, the dial says on, the act publishes a complete
// manifest, the belt agrees. Family and grader legs ride per scenario.
const LIVE = {
  ...VOICE,
  'law:preflight': GREEN,
  'perceptual:presence': { exit: 0 },
  'perceptual:dial': { exit: 0, perceptual: 'on', recovery_cap: 2 },
  'stage:validate': validateAct(),
  'perceptual:manifest': { exit: 0, ids: [MF(1)] },
  'perceptual:belt': { exit: 0 },
  'law:stage-end': GREEN,
  'state:write': GREEN,
}
const GPT_LIVE = { ...LIVE, 'perceptual:family': { exit: 0 } }
const CLAUDE_LIVE = {
  ...LIVE,
  'perceptual:family': { exit: 1 },
  'screen:digest': DIGEST_B,
  'screen:criteria': { exit: 0, ids: ['P-1', 'P-2'] },
  'screen:invalidate': { exit: 0 },
  'screen-claude:review': OK_ACK,
  'screen:read': readCandidate(screenVerdict('accept')),
  'screen:publish': { exit: 0 },
}

test('runtime (W8-S3/C): dormant — no table, the dial says dormant, the single-act validate stands and a stale marker is cleared', async () => {
  const { ret, calls } = await runKernel({ stage: 'validate', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'stage:validate': validateAct(),
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok')
  const presence = calls.find(c => c.label === 'perceptual:presence')
  assert.ok(presence && presence.prompt.includes('LAW.md'), 'the activation is a closed table-presence check over the sealed LAW')
  const dial = calls.find(c => c.label === 'perceptual:dial')
  assert.ok(dial.prompt.includes('gauge-dial.mjs --visual false'), 'an absent table feeds --visual false')
  assert.ok(dial.prompt.includes('"perceptual"') && dial.prompt.includes('"recovery_cap"'), 'one dial leg carries both facts')
  for (const label of ['perceptual:manifest', 'perceptual:family', 'perceptual:belt', 'screen:review', 'perceptual:addendum', 'perceptual:marker']) {
    assert.ok(!calls.some(c => c.label === label), 'dormant skips the machinery: ' + label)
  }
  const clear = calls.find(c => c.label === 'perceptual:marker-clear')
  assert.ok(clear && clear.prompt.includes('rm -f .kiln/perceptual-partial'), 'a stale marker from a prior hold is removed by the dormant ok terminal')
  assert.ok(ret.beat.includes('a hundred eyes'), 'the single-act beat is unchanged')
})

test('runtime (W8-S3/C): a present table feeds --visual true — and a failed dial read fails UP to the live machinery, never a silent skip', async () => {
  const live = await runKernel({ stage: 'validate', projectDir: '/p' }, { ...GPT_LIVE, 'screen:review': { exit: 0 }, ...ADDENDUM_OK })
  assert.equal(live.ret.status, 'ok')
  assert.ok(live.calls.find(c => c.label === 'perceptual:dial').prompt.includes('--visual true'), 'a present table feeds --visual true')
  const failed = await runKernel({ stage: 'validate', projectDir: '/p' }, { ...GPT_LIVE, 'perceptual:dial': { exit: 20 }, 'screen:review': { exit: 0 }, ...ADDENDUM_OK })
  assert.equal(failed.ret.status, 'ok')
  assert.ok(failed.calls.some(c => c.label === 'perceptual:manifest'), 'a dial transport failure never reads as dormant — the machinery engages')
})

test('runtime (W8-S3/F-G): live PASS on a ui-owner table — the GPT screen verb grades, the addendum appends PASS rows, no marker', async () => {
  const { ret, calls } = await runKernel({ stage: 'validate', projectDir: '/p' }, { ...GPT_LIVE, 'screen:review': { exit: 0 }, ...ADDENDUM_OK })
  assert.equal(ret.status, 'ok')
  const family = calls.find(c => c.label === 'perceptual:family')
  assert.ok(family.prompt.includes("kiln-review' perceptual-family .kiln"), 'the family rule derives owners over the VERIFIED trio through the fused verb (W2-S3 B04)')
  const review = calls.find(c => c.label === 'screen:review')
  assert.ok(review.prompt.includes('kiln-review screen . .kiln gpt-5.6-sol gpt-sol high ' + SCREEN),
    'closed argv only — repo `.`, the kiln dir, the reviewer-gate tier, the output path')
  const beltAt = calls.findIndex(c => c.label === 'perceptual:belt')
  const reviewAt = calls.findIndex(c => c.label === 'screen:review')
  assert.ok(beltAt >= 0 && beltAt < reviewAt, 'the deterministic belt runs pre-spawn')
  assert.ok(calls[beltAt].prompt.includes(MF(1)), 'the belt checks the CURRENT manifest')
  const add = calls.find(c => c.label === 'perceptual:addendum')
  assert.ok(add.prompt.includes('PASS') && add.prompt.includes(SCREEN), 'the addendum act names grade PASS and the published verdict')
  assert.ok(!calls.some(c => c.label === 'perceptual:marker'), 'no marker on an accept')
  assert.ok(calls.some(c => c.label === 'perceptual:marker-clear'), 'the ok terminal clears any stale marker')
  assert.ok(ret.beat.includes('rows appended'), 'the addendum re-emits the truthful stage beat')
})

test('runtime (W2-S7a, F3): the claude screen recompose that diverges from the pre-dispatch contract HOLDs before publish — the write-capable evidence rebind', async () => {
  const { ret, calls } = await runKernel({ stage: 'validate', projectDir: '/p' }, {
    ...CLAUDE_LIVE,
    'screen:contract': { exit: 0, ids: ['c'.repeat(64)] },
    // The reviewer changed the evidence mid-turn: the post-turn recompose returns a different digest.
    'screen:contract-confirm': { exit: 0, ids: ['d'.repeat(64)] },
    ...ADDENDUM_OK,
  })
  assert.notEqual(ret.status, 'ok', 'a diverged recompose never seals the run')
  assert.ok(!calls.some(c => c.label === 'screen:publish'), 'nothing publishes when the recomposed contract differs from the pre-dispatch digest')
})

test('runtime (W2-S7a, F3): the claude screen leg recomposes its contract before publish and requires the digest unchanged (source)', () => {
  assert.ok(src.includes("'screen:contract-confirm'"), 'the screen leg recomposes the contract after the reviewer turn')
  assert.ok(src.indexOf("'screen:contract-confirm'") < src.indexOf("'screen:publish'"), 'the recompose precedes the publish')
  assert.ok(src.includes('scc.ids[0] !== screenContract'), 'the recomposed digest must equal the pre-dispatch digest or the leg HOLDs')
})

test('runtime (W8-S3/F): an all-logic/mixed table takes the Claude leg — fallback-reviewer tier, closed interpolations, content-free promote', async () => {
  const { ret, calls } = await runKernel({ stage: 'validate', projectDir: '/p' }, { ...CLAUDE_LIVE, ...ADDENDUM_OK })
  assert.equal(ret.status, 'ok')
  assert.ok(!calls.some(c => c.label === 'screen:review'), 'no codex spawn on the Claude family path')
  const leg = calls.find(c => c.label === 'screen-claude:review')
  assert.equal(leg.opts.model, 'opus', 'the primary Claude grader is the fallback-reviewer tier')
  assert.ok(leg.prompt.includes(MF(1)) && leg.prompt.includes('b'.repeat(64)), 'the static prompt carries the manifest path and the pre-leg digest')
  assert.ok(leg.prompt.includes('perceptual-rubric.json') && leg.prompt.includes('.kiln/LAW.md') && leg.prompt.includes('.kiln/.gate-review.reviewer.tmp'),
    'closed interpolations only: the rubric, LAW, and candidate paths')
  const digest = calls.find(c => c.label === 'screen:digest')
  assert.ok(digest.prompt.includes('sha256sum ' + MF(1)), 'the kernel computes the manifest digest pre-leg via a hands sha256sum leg')
  const publish = calls.find(c => c.label === 'screen:publish')
  assert.ok(publish.prompt.includes('publish-gate .kiln screen .kiln/.gate-review.reviewer.tmp ' + SCREEN), 'the validated candidate promotes to the screen gate file through the W2-S5 archive-then-publish verb')
})

test('runtime (W8-S3/F): the kernel recomputes the screen verb rules — a blocked verdict, an off-table criterion, and a digest mismatch each hold transport-class', async () => {
  for (const [name, candidate] of [
    ['blocked verdict', { review_id: 'scr-1', law_hash: 'b'.repeat(64), findings: [], blockers: ['cannot see'], verdict: 'blocked' }],
    ['off-table criterion', screenVerdict('changes_required', [screenFinding('F1', 'P-9')])],
    ['digest mismatch', screenVerdict('accept', [], 'c'.repeat(64))],
  ]) {
    const { ret, calls } = await runKernel({ stage: 'validate', projectDir: '/p' }, { ...CLAUDE_LIVE, 'screen:read': readCandidate(candidate) })
    assert.equal(ret.status, 'transport-failure', name + ' holds transport-class')
    assert.ok(!calls.some(c => c.label === 'screen:publish'), name + ' never publishes')
    assert.ok(!calls.some(c => c.label === 'perceptual:marker'), name + ': no marker on a nonsemantic hold')
    assert.ok(calls.some(c => c.label === 'perceptual:marker-clear'), name + ': the nonsemantic hold clears the marker')
  }
})

test('runtime (W8-S3/F-G): the Claude recheck is digest-fresh — the kernel snapshots the prior verdict and refuses a regrade over the same evidence bytes', async () => {
  const priorVerdict = screenVerdict('changes_required', [screenFinding('F1', 'P-1')])
  const mfSeq = () => { const seq = [{ exit: 0, ids: [MF(1)] }, { exit: 0, ids: [MF(2)] }]; return () => seq.shift() ?? { exit: 0, ids: [MF(2)] } }
  const stale = await runKernel({ stage: 'validate', projectDir: '/p' }, {
    ...CLAUDE_LIVE,
    'perceptual:manifest': mfSeq(),
    'screen:read': readCandidate(priorVerdict),
    'screen:findings': { exit: 0, ids: ['F1'] },
    'perceptual:recapture': validateAct(),
    'perceptual:delta-check': { exit: 0 },
    'screen:prior': readCandidate(priorVerdict),
    ...ADDENDUM_OK,
  })
  assert.equal(stale.ret.status, 'transport-failure', 'digest equality never regrades — the hold is transport-class')
  assert.ok(!stale.calls.some(c => c.label === 'screen-claude:recheck'), 'no recheck leg ever spawns over stale evidence bytes')
  assert.ok(stale.calls.find(c => c.label === 'perceptual:addendum').prompt.includes('PARTIAL'),
    'the published verdict stranded by the stale-digest hold still lands its PARTIAL rows (the iff)')
  const digests = [DIGEST_B, { exit: 0, ids: ['d'.repeat(64)] }]
  const reads = [readCandidate(priorVerdict), readCandidate(screenVerdict('accept', [], 'd'.repeat(64)))]
  const fresh = await runKernel({ stage: 'validate', projectDir: '/p' }, {
    ...CLAUDE_LIVE,
    'perceptual:manifest': mfSeq(),
    'screen:digest': () => digests.shift(),
    'screen-claude:recheck': OK_ACK,
    'screen:read': () => reads.shift(),
    'screen:findings': { exit: 0, ids: ['F1'] },
    'perceptual:recapture': validateAct(),
    'perceptual:delta-check': { exit: 0 },
    'screen:prior': readCandidate(priorVerdict),
    ...ADDENDUM_OK,
  })
  assert.equal(fresh.ret.status, 'ok', 'a fresh digest regrades and the accepted recheck advances')
  const recheckLeg = fresh.calls.find(c => c.label === 'screen-claude:recheck')
  assert.ok(recheckLeg.prompt.includes('d'.repeat(64)) && recheckLeg.prompt.includes(MF(2)), 'the recheck leg binds to the fresh digest and the new manifest')
})

test('runtime (W8-S3/F): the Claude recheck recomputes the FULL prior screen shape — nothing weaker than the CLI lineage rules', async () => {
  for (const [name, prior] of [
    ['accept prior', screenVerdict('accept')],
    ['blocked prior', { review_id: 'scr-1', law_hash: 'b'.repeat(64), findings: [], blockers: ['cannot see'], verdict: 'blocked' }],
    ['off-table prior criterion', screenVerdict('changes_required', [screenFinding('F1', 'P-9')])],
    ['six-field prior', { ...screenVerdict('changes_required', [screenFinding('F1', 'P-1')]), stray: 'x' }],
  ]) {
    const seq = [{ exit: 0, ids: [MF(1)] }, { exit: 0, ids: [MF(2)] }]
    const { ret, calls } = await runKernel({ stage: 'validate', projectDir: '/p' }, {
      ...CLAUDE_LIVE,
      'perceptual:manifest': () => seq.shift() ?? { exit: 0, ids: [MF(2)] },
      'screen:read': readCandidate(screenVerdict('changes_required', [screenFinding('F1', 'P-1')])),
      'screen:findings': { exit: 0, ids: ['F1'] },
      'perceptual:recapture': validateAct(),
      'perceptual:delta-check': { exit: 0 },
      'screen:prior': readCandidate(prior),
      ...ADDENDUM_OK,
    })
    assert.equal(ret.status, 'transport-failure', name + ': prior lineage never trusts a weaker shape than the CLI recomputes')
    assert.ok(!calls.some(c => c.label === 'screen-claude:recheck'), name + ': no recheck leg spawns over an invalid prior')
  }
})

test('runtime (W8-S3/G): the GPT loop recaptures on a reject — fresh generation delta, closed recheck argv, the accepted recheck advances', async () => {
  const seq = [{ exit: 0, ids: [MF(1)] }, { exit: 0, ids: [MF(2)] }]
  const { ret, calls } = await runKernel({ stage: 'validate', projectDir: '/p' }, {
    ...GPT_LIVE,
    'perceptual:manifest': () => seq.shift() ?? { exit: 0, ids: [MF(2)] },
    'screen:review': { exit: 10 },
    'screen:findings': { exit: 0, ids: ['F1'] },
    'perceptual:recapture': validateAct(),
    'perceptual:delta-check': { exit: 0 },
    'screen:recheck': { exit: 0 },
    ...ADDENDUM_OK,
  })
  assert.equal(ret.status, 'ok')
  const recap = calls.find(c => c.label === 'perceptual:recapture')
  assert.ok(recap.prompt.includes('capture step'), 'the repair edge is the recapture act, scoped to the capture step')
  const delta = calls.find(c => c.label === 'perceptual:delta-check')
  assert.ok(delta.prompt.includes('test -s ' + MF(2)), 'the confirmed delta is the NEW manifest path')
  const recheck = calls.find(c => c.label === 'screen:recheck')
  assert.ok(recheck.prompt.includes('kiln-review screen-recheck . .kiln gpt-5.6-sol gpt-sol high ' + SCREEN + ' ' + MF(2) + ' ' + SCREEN),
    'the recheck hands the prior published verdict and the fresh manifest as the digest-bound delta')
})

test('runtime (W8-S3/H-I): a no-progress recheck is the semantic hold — marker FIRST, one bounded Claude escalation, the closed outcome recorded, PARTIAL addendum, static surfaces', async () => {
  const scenario = (escalateAck, escRead) => {
    const seq = [{ exit: 0, ids: [MF(1)] }, { exit: 0, ids: [MF(2)] }]
    return {
      ...GPT_LIVE,
      'perceptual:manifest': () => seq.shift() ?? { exit: 0, ids: [MF(2)] },
      'screen:review': { exit: 10 },
      'screen:recheck': { exit: 10 },
      'screen:findings': { exit: 0, ids: ['F1'] },
      'screen:survivors': { exit: 0, ids: ['P-1'] },
      'perceptual:recapture': validateAct(),
      'perceptual:delta-check': { exit: 0 },
      'perceptual:marker': { exit: 0 },
      'screen:digest': DIGEST_B,
      'screen:criteria': { exit: 0, ids: ['P-1', 'P-2'] },
      'screen:invalidate': { exit: 0 },
      'screen-claude:escalate': escalateAck,
      'screen:read': escRead,
      'screen:publish': { exit: 0 },
      'escalate:record': { exit: 0 },
      ...ADDENDUM_OK,
    }
  }
  for (const [outcome, escRead] of [
    ['CORROBORATED', readCandidate(screenVerdict('changes_required', [screenFinding('E1', 'P-1')]))],
    ['CONTESTED', readCandidate(screenVerdict('accept'))],
  ]) {
    const { ret, calls } = await runKernel({ stage: 'validate', projectDir: '/p' }, scenario(OK_ACK, escRead))
    assert.equal(ret.status, 'blocked', outcome + ': the semantic hold lands the operator-ruling shape')
    const markerAt = calls.findIndex(c => c.label === 'perceptual:marker')
    const escAt = calls.findIndex(c => c.label === 'screen-claude:escalate')
    assert.ok(markerAt >= 0 && markerAt < escAt, outcome + ': the marker is written FIRST, before the escalation')
    assert.ok(calls[markerAt].prompt.includes('touch .kiln/perceptual-partial'), outcome + ': the marker is the closed touch leg')
    assert.ok(calls.find(c => c.label === 'screen:publish').prompt.includes(SCREEN_ESC), outcome + ': the escalation publishes to its own artifact, never the held verdict')
    assert.ok(calls.find(c => c.label === 'escalate:record').prompt.includes(outcome), outcome + ': the closed outcome lands in the record')
    const addAt = calls.findIndex(c => c.label === 'perceptual:addendum')
    assert.ok(escAt < addAt, outcome + ': the escalation precedes the addendum; the held return fires last')
    assert.ok(calls[addAt].prompt.includes('PARTIAL'), outcome + ': the addendum grades PARTIAL for the survivors')
    assert.ok(!calls.some(c => c.label === 'perceptual:marker-clear'), outcome + ': the semantic hold preserves the marker')
    const screenHeld = stateArgs(calls)
    assert.equal(screenHeld.key, 'operator-ruling', outcome + ': the held screen takes the operator-ruling key')
    // Both evidence paths ride the pointers (guardrail 2 / B3): the screen verdict AND the
    // exact evidence-generation manifest bound to the held grade, so after recapture the
    // operator can still identify which generation the hold judged. Only the count is dropped.
    assert.ok(screenHeld.pointers.includes(SCREEN), outcome + ': the screen verdict path rides the pointers')
    assert.ok(screenHeld.pointers.includes(MF(2)), outcome + ': the held evidence-generation manifest path rides the pointers')
    assert.ok(!screenHeld.cmd.includes('secret-screen-prose'), outcome + ': no verdict prose rides the courier')
    assert.equal(ret.pointers.escalation, outcome)
    assert.deepEqual(ret.pointers.finding_ids, ['F1'])
  }
  const dead = await runKernel({ stage: 'validate', projectDir: '/p' }, scenario({ ok: false }, readCandidate(screenVerdict('accept'))))
  assert.equal(dead.ret.status, 'blocked', 'a transport-dead escalation changes nothing — the hold proceeds identically')
  assert.ok(dead.calls.find(c => c.label === 'escalate:record').prompt.includes('escalation unavailable'), 'the closed unavailable line lands in the record')
  assert.ok(dead.calls.some(c => c.label === 'perceptual:marker'), 'the marker stands')
})

test('runtime (W8-S3/H): a Claude-primary semantic hold escalates through the OTHER transport — the GPT screen verb over a separate output', async () => {
  const seq = [{ exit: 0, ids: [MF(1)] }, { exit: 0, ids: [MF(2)] }]
  const digests = [DIGEST_B, { exit: 0, ids: ['d'.repeat(64)] }]
  const reads = [
    readCandidate(screenVerdict('changes_required', [screenFinding('F1', 'P-1')])),
    readCandidate(screenVerdict('changes_required', [screenFinding('F1', 'P-1')], 'd'.repeat(64))),
  ]
  const { ret, calls } = await runKernel({ stage: 'validate', projectDir: '/p' }, {
    ...CLAUDE_LIVE,
    'perceptual:manifest': () => seq.shift() ?? { exit: 0, ids: [MF(2)] },
    'screen:digest': () => digests.shift(),
    'screen-claude:recheck': OK_ACK,
    'screen:read': () => reads.shift(),
    'screen:findings': { exit: 0, ids: ['F1'] },
    'screen:survivors': { exit: 0, ids: ['P-1'] },
    'perceptual:recapture': validateAct(),
    'perceptual:delta-check': { exit: 0 },
    'screen:prior': readCandidate(screenVerdict('changes_required', [screenFinding('F1', 'P-1')])),
    'perceptual:marker': { exit: 0 },
    'escalate:screen': { exit: 10 },
    'escalate:record': { exit: 0 },
    ...ADDENDUM_OK,
  })
  assert.equal(ret.status, 'blocked')
  const esc = calls.find(c => c.label === 'escalate:screen')
  assert.ok(esc.prompt.includes('kiln-review screen-escalate . .kiln gpt-5.6-sol gpt-sol high ' + SCREEN + ' ' + SCREEN_ESC),
    'the escalation rides the survivor-scoped verb — the held verdict on argv, its own output artifact, never the held verdict overwritten')
  assert.ok(calls.find(c => c.label === 'escalate:record').prompt.includes('CORROBORATED'),
    'a scope-valid changes_required corroborates by construction — no post-publication filter')
})

test('runtime (W8-S3/H): the escalation is survivors-scoped ONLY — an off-survivor answer publishes nothing and rules nothing, both families', async () => {
  // Primary GPT, Claude escalation: an off-survivor finding (on-table P-2, outside
  // the surviving {P-1}) invalidates the candidate pre-publish — exit 20, no
  // escalation artifact, the closed outcome stays `escalation unavailable`.
  const seq1 = [{ exit: 0, ids: [MF(1)] }, { exit: 0, ids: [MF(2)] }]
  const offClaude = await runKernel({ stage: 'validate', projectDir: '/p' }, {
    ...GPT_LIVE,
    'perceptual:manifest': () => seq1.shift() ?? { exit: 0, ids: [MF(2)] },
    'screen:review': { exit: 10 },
    'screen:recheck': { exit: 10 },
    'screen:findings': { exit: 0, ids: ['F1'] },
    'screen:survivors': { exit: 0, ids: ['P-1'] },
    'perceptual:recapture': validateAct(),
    'perceptual:delta-check': { exit: 0 },
    'perceptual:marker': { exit: 0 },
    'screen:digest': DIGEST_B,
    'screen:criteria': { exit: 0, ids: ['P-1', 'P-2'] },
    'screen:invalidate': { exit: 0 },
    'screen-claude:escalate': OK_ACK,
    'screen:read': readCandidate(screenVerdict('changes_required', [screenFinding('E1', 'P-2')])),
    'escalate:record': { exit: 0 },
    ...ADDENDUM_OK,
  })
  assert.equal(offClaude.ret.status, 'blocked', 'the hold stands — the out-of-scope answer changes nothing')
  assert.ok(!offClaude.calls.some(c => c.label === 'screen:publish'), 'an off-survivor Claude escalation verdict is invalid and never published')
  assert.ok(offClaude.calls.find(c => c.label === 'escalate:record').prompt.includes('escalation unavailable'),
    'an out-of-scope answer is no usable escalation — the closed outcome set stays closed')
  // Primary Claude, GPT escalation: the survivor-scoped screen-escalate verb packets
  // ONLY the surviving rows and refuses an off-survivor finding PRE-PUBLISH — exit
  // 20, no escalation artifact (the verb contract holds this in the screening-room
  // suite); the kernel maps the refusal to the closed unavailable outcome.
  const seq2 = [{ exit: 0, ids: [MF(1)] }, { exit: 0, ids: [MF(2)] }]
  const digests = [DIGEST_B, { exit: 0, ids: ['d'.repeat(64)] }]
  const reads = [
    readCandidate(screenVerdict('changes_required', [screenFinding('F1', 'P-1')])),
    readCandidate(screenVerdict('changes_required', [screenFinding('F1', 'P-1')], 'd'.repeat(64))),
  ]
  const offGpt = await runKernel({ stage: 'validate', projectDir: '/p' }, {
    ...CLAUDE_LIVE,
    'perceptual:manifest': () => seq2.shift() ?? { exit: 0, ids: [MF(2)] },
    'screen:digest': () => digests.shift(),
    'screen-claude:recheck': OK_ACK,
    'screen:read': () => reads.shift(),
    'screen:findings': { exit: 0, ids: ['F1'] },
    'screen:survivors': { exit: 0, ids: ['P-1'] },
    'perceptual:recapture': validateAct(),
    'perceptual:delta-check': { exit: 0 },
    'screen:prior': readCandidate(screenVerdict('changes_required', [screenFinding('F1', 'P-1')])),
    'perceptual:marker': { exit: 0 },
    'escalate:screen': { exit: 20 },
    'escalate:record': { exit: 0 },
    ...ADDENDUM_OK,
  })
  assert.equal(offGpt.ret.status, 'blocked')
  assert.ok(offGpt.calls.find(c => c.label === 'escalate:record').prompt.includes('escalation unavailable'),
    'an off-survivor GPT escalation publishes nothing at the verb — no usable escalation, the closed outcome set stays closed')
})

test('runtime (W8-S3/H): primary transport unavailable is the degraded-class hold — no marker, no escalation, the stale marker cleared', async () => {
  const degraded = await runKernel({ stage: 'validate', projectDir: '/p' }, { ...GPT_LIVE, 'screen:review': { exit: 21 } })
  assert.equal(degraded.ret.status, 'held')
  assert.equal(stateArgs(degraded.calls).key, 'restore-codex', 'the held STATE takes the restore-codex key — kiln-review renders the codex-restore hint')
  const unreachable = await runKernel({ stage: 'validate', projectDir: '/p' }, { ...GPT_LIVE, 'screen:review': { exit: 127 } })
  assert.equal(unreachable.ret.status, 'gate-unreachable')
  const claudeDead = await runKernel({ stage: 'validate', projectDir: '/p' }, { ...CLAUDE_LIVE, 'screen-claude:review': { ok: false } })
  assert.equal(claudeDead.ret.status, 'transport-failure', 'a Claude leg failure is the same nonsemantic class')
  for (const r of [degraded, unreachable, claudeDead]) {
    assert.ok(!r.calls.some(c => c.label === 'perceptual:marker'), 'no marker without a semantic ruling')
    assert.ok(!r.calls.some(c => c.label === 'screen-claude:escalate' || c.label === 'escalate:screen'), 'no escalation without a semantic ruling')
    assert.ok(r.calls.some(c => c.label === 'perceptual:marker-clear'), 'the nonsemantic hold clears any stale marker')
    assert.ok(!r.calls.some(c => c.label === 'perceptual:addendum'), 'no verdict published — no addendum (the iff)')
  }
})

test('runtime (W8-S3/I): the act doors — capture-act failure, a failed recapture, and addendum failure all clear the marker on their existing holds', async () => {
  const captureFail = await runKernel({ stage: 'validate', projectDir: '/p' }, {
    ...GPT_LIVE,
    'stage:validate': { facts: { status: 'no complete manifest', pointers: [], schema_valid: false }, narration_beat: '' },
  })
  assert.equal(captureFail.ret.status, 'transport-failure')
  assert.ok(captureFail.calls.some(c => c.label === 'perceptual:marker-clear'), 'capture-act failure clears the marker')
  assert.ok(!captureFail.calls.some(c => c.label === 'perceptual:manifest'), 'the act hold fires before any grader machinery')
  assert.ok(!captureFail.calls.some(c => c.label === 'perceptual:addendum'), 'no verdict published — no addendum (the iff)')
  const recapFail = await runKernel({ stage: 'validate', projectDir: '/p' }, {
    ...GPT_LIVE,
    'screen:review': { exit: 10 },
    'screen:findings': { exit: 0, ids: ['F1'] },
    'perceptual:recapture': { facts: { status: 'no runtime', pointers: [], schema_valid: false }, narration_beat: '' },
    ...ADDENDUM_OK,
  })
  assert.equal(recapFail.ret.status, 'repair-failed')
  assert.ok(recapFail.calls.some(c => c.label === 'perceptual:marker-clear'), 'a failed recapture is capture-class — cleared, never marked')
  assert.ok(!recapFail.calls.some(c => c.label === 'perceptual:marker'))
  assert.ok(recapFail.calls.find(c => c.label === 'perceptual:addendum').prompt.includes('PARTIAL'),
    'the published changes_required verdict still lands its PARTIAL rows on repair-failed (the iff)')
  const addFail = await runKernel({ stage: 'validate', projectDir: '/p' }, {
    ...GPT_LIVE,
    'screen:review': { exit: 0 },
    'perceptual:addendum': { facts: { status: 'rows did not land', pointers: [], schema_valid: false }, narration_beat: '' },
  })
  assert.equal(addFail.ret.status, 'transport-failure')
  assert.ok(addFail.calls.some(c => c.label === 'perceptual:marker-clear'), 'addendum failure takes the act transport hold and clears the marker')
})

test('runtime (W8-S3/I): published verdict iff addendum — a recheck transport death after the publish still lands the rows on the degraded hold', async () => {
  const seq = [{ exit: 0, ids: [MF(1)] }, { exit: 0, ids: [MF(2)] }]
  const { ret, calls } = await runKernel({ stage: 'validate', projectDir: '/p' }, {
    ...GPT_LIVE,
    'perceptual:manifest': () => seq.shift() ?? { exit: 0, ids: [MF(2)] },
    'screen:review': { exit: 10 },
    'screen:recheck': { exit: 21 },
    'screen:findings': { exit: 0, ids: ['F1'] },
    'perceptual:recapture': validateAct(),
    'perceptual:delta-check': { exit: 0 },
    ...ADDENDUM_OK,
  })
  assert.equal(ret.status, 'held', 'the degraded recheck stays the degraded-class hold')
  assert.ok(calls.find(c => c.label === 'perceptual:addendum').prompt.includes('PARTIAL'),
    'the published changes_required verdict remains — its PARTIAL rows land before the hold returns')
  assert.ok(calls.some(c => c.label === 'perceptual:marker-clear'), 'still nonsemantic — the marker clears')
})

test('runtime (W8-S3/G): the dial recovery_cap parameterizes the screening loop — cap 1 exhausts where cap 2 recovers', async () => {
  const script = (cap, rechecks, cohorts, mfList) => {
    const seq = mfList.map(p => ({ exit: 0, ids: [p] }))
    const rc = [...rechecks]
    const co = cohorts.map(ids => ({ exit: 0, ids }))
    return {
      ...GPT_LIVE,
      'perceptual:dial': { exit: 0, perceptual: 'on', recovery_cap: cap },
      'perceptual:manifest': () => seq.shift() ?? seq[seq.length - 1],
      'screen:review': { exit: 10 },
      'screen:recheck': () => rc.shift(),
      'screen:findings': () => co.shift() ?? { exit: 0, ids: ['F1'] },
      'perceptual:recapture': validateAct(),
      'perceptual:delta-check': { exit: 0 },
      'perceptual:marker': { exit: 0 },
      'screen:survivors': { exit: 0, ids: ['P-1'] },
      'screen:digest': DIGEST_B,
      'screen:criteria': { exit: 0, ids: ['P-1'] },
      'screen:invalidate': { exit: 0 },
      'screen-claude:escalate': OK_ACK,
      'screen:read': readCandidate(screenVerdict('accept')),
      'screen:publish': { exit: 0 },
      'escalate:record': { exit: 0 },
      ...ADDENDUM_OK,
    }
  }
  const exhausted = await runKernel({ stage: 'validate', projectDir: '/p' },
    script(1, [{ exit: 10 }], [['F1', 'F2'], ['F1'], ['F1']], [MF(1), MF(2)]))
  assert.equal(exhausted.ret.status, 'blocked', 'cap 1: a strictly shrinking recheck still exhausts the budget')
  assert.equal(exhausted.ret.pointers.passes, 1)
  const recovered = await runKernel({ stage: 'validate', projectDir: '/p' },
    script(2, [{ exit: 10 }, { exit: 0 }], [['F1', 'F2'], ['F1']], [MF(1), MF(2), MF(3)]))
  assert.equal(recovered.ret.status, 'ok', 'cap 2: the same trajectory recovers')
  assert.equal(recovered.calls.filter(c => c.label === 'perceptual:recapture').length, 2, 'two recapture edges under cap 2')
})

test('runtime (W8-S3/G): the belt — an incomplete CURRENT manifest at gate() holds transport-class before any spawn', async () => {
  const { ret, calls } = await runKernel({ stage: 'validate', projectDir: '/p' }, { ...GPT_LIVE, 'perceptual:belt': { exit: 1 } })
  assert.equal(ret.status, 'transport-failure')
  assert.ok(!calls.some(c => c.label === 'screen:review'), 'no grader spawns past a failed belt')
  assert.ok(!calls.some(c => c.label === 'perceptual:marker'), 'a belt violation is transport-class, never semantic')
  const belt = calls.find(c => c.label === 'perceptual:belt')
  assert.ok(belt.prompt.includes('realpathSync') && belt.prompt.includes('isFile()'),
    'the belt admits only regular files realpath-contained in the generation dir — the CLI screenEvidence boundary, byte-symmetric families')
})

test('runtime (W8-S3): a missing CURRENT manifest and an untrusted family answer each hold honestly before the loop', async () => {
  const noManifest = await runKernel({ stage: 'validate', projectDir: '/p' }, { ...GPT_LIVE, 'perceptual:manifest': { exit: 1, ids: [] } })
  assert.equal(noManifest.ret.status, 'transport-failure')
  assert.ok(!noManifest.calls.some(c => c.label === 'perceptual:family'), 'no family read without a CURRENT manifest')
  const badFamily = await runKernel({ stage: 'validate', projectDir: '/p' }, { ...LIVE, 'perceptual:family': { exit: 2 } })
  assert.equal(badFamily.ret.status, 'transport-failure', 'an untrusted family answer holds — never a guessed transport')
})

test('runtime (W8-S3): the law-red doors — a validate reopen at preflight or stage end clears the stale marker before the reopen lands (DELTA-10)', async () => {
  const preRed = await runKernel({ stage: 'validate', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': { exit: 1, ids: ['s1'] },
    'seal:set': { exit: 0, ids: ['s1'] },
    'state:write': GREEN,
  })
  assert.equal(preRed.ret.status, 'law-red')
  const preOrder = preRed.calls.map(c => c.label)
  assert.ok(preOrder.indexOf('perceptual:marker-clear') >= 0 && preOrder.indexOf('perceptual:marker-clear') < preOrder.indexOf('state:write'),
    'the preflight reopen removes the marker before the law-red ledger write')
  assert.ok(!preOrder.includes('perceptual:presence'), 'the preflight door fires before any screening machinery')
  const postRed = await runKernel({ stage: 'validate', projectDir: '/p' }, {
    ...GPT_LIVE,
    'screen:review': { exit: 0 },
    ...ADDENDUM_OK,
    'law:stage-end': { exit: 1, ids: ['s1'] },
    'seal:set': { exit: 0, ids: ['s1'] },
  })
  assert.equal(postRed.ret.status, 'law-red')
  const postOrder = postRed.calls.map(c => c.label)
  assert.ok(postOrder.indexOf('perceptual:marker-clear') >= 0 && postOrder.indexOf('perceptual:marker-clear') < postOrder.indexOf('state:write'),
    'the stage-end reopen removes the marker before the law-red ledger write')
  assert.ok(postOrder.indexOf('perceptual:addendum') < postOrder.indexOf('perceptual:marker-clear'),
    'the live-accept addendum already ran — the clear guards the reopen conclusion itself')
})

test('drift (W8-S3): the kernel screen location rule mirrors the CLI SCREEN_LOCATION pattern', () => {
  const cli = readFileSync(fileURLToPath(new URL('../scripts/kiln-review', import.meta.url)), 'utf8')
  const cliPattern = /const SCREEN_LOCATION = \{ pattern: (\/[^,]+\/),/.exec(cli)[1]
  const kernelPattern = /const SCREEN_LOCATION_RULE = (\/[^\n]+\/)\n/.exec(src)[1]
  assert.equal(kernelPattern, cliPattern, 'the Claude path relaxes location byte-symmetrically with the screen family')
})

// ── W8-S4: dogfood — the screening room proven whole, the truth on real disk ──
// The W7-S3 pattern extended to the wave's reading surfaces: full validate → report
// scenarios on the mocked runtime with the DURABLE-FACT legs executing their exact
// issued commands for REAL — the activation presence check reads a real sealed LAW.md,
// the marker legs touch and remove the real .kiln/perceptual-partial, the escalation
// record heredoc lands its real one-line file, the cohort/survivor/criteria fetches read
// the really-published verdict and law, and the addendum + report acts are obedient
// card-followers writing the real .kiln/validate.md rows and the real .kiln/report.md
// variant from the real record. Grader transports stay scripted as W8-S3 scripts them —
// no live codex, no live browser.
const runRealBlock = (prompt, dir) => ({ exit: spawnSync('sh', ['-c', prompt.slice(prompt.indexOf('\n') + 1)], { cwd: dir }).status })
const runRealIds = (prompt, dir) => {
  const r = spawnSync('sh', ['-c', prompt.slice(prompt.indexOf('\n') + 1)], { cwd: dir, encoding: 'utf8' })
  const out = (r.stdout ?? '').trim()
  return { exit: r.status, ids: out.startsWith('[') ? JSON.parse(out) : (out === '' ? [] : [out]) }
}
const LAW_VISUAL = [
  '# LAW', '', '## Perceptual', '',
  '| criterion id | owning slice | dim | requirement | proxy command | expected | reference |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  '| P-1 | s1 | fidelity-to-requirement | the hero renders | test -f index.html | exit 0 | |',
  '| P-2 | s1 | typography | headings hold their scale | test -f index.html | exit 0 | |', '',
].join('\n')
const LAW_PLAIN = '# LAW\n\nexecutable criteria only — no perceptual table\n'
// W2-S3 (B04): the validate/screen derivations (perceptual-family, screen-criteria) now read
// a SEALED trio, so a visual fixture seals its whole trio the real way — the mocked screen legs
// stay transparent, and the ONE real screen:criteria leg derives its ids over verified LAW.md.
const mkVisual = (law) => {
  const dir = mkProject()
  mkdirSync(join(dir, '.kiln/law'), { recursive: true })
  writeFileSync(join(dir, '.kiln/LAW.md'), law)
  writeFileSync(join(dir, '.kiln/law/check.sh'), '#!/usr/bin/env bash\nexit 0\n')
  writeFileSync(join(dir, '.kiln/slices.json'), JSON.stringify([{ id: 's1', surface: 'ui', milestone: 'core' }]))
  assert.equal(spawnSync('node', [REAL_PLUGIN + '/scripts/kiln-review', 'seal-law', join(dir, '.kiln'), 'dual'], { encoding: 'utf8' }).status, 0, 'the visual fixture seals its trio')
  return dir
}
const marker = (dir) => join(dir, '.kiln/perceptual-partial')
// The durable-fact legs, real: activation presence, marker touch/clear, the record heredoc.
const realScreenDisk = (dir) => ({
  'perceptual:presence': (p) => runRealBlock(p, dir),
  'perceptual:marker': (p) => runRealBlock(p, dir),
  'perceptual:marker-clear': (p) => runRealBlock(p, dir),
  'escalate:record': (p) => runRealBlock(p, dir),
})
// The screen verbs publish their verdict file exactly as the CLI would — real bytes on
// disk, the scripted wire exit.
const publishScreen = (dir, verdict, exit) => () => {
  writeFileSync(join(dir, SCREEN), JSON.stringify(verdict))
  return { exit }
}
// Act 1, the capture-inclusive validate act: writes the real base validate.md.
const captureAct = (dir) => () => {
  writeFileSync(join(dir, '.kiln/validate.md'), '# validate — check.sh exit 0\nC-1 · test -f index.html · ran · ✓\n')
  return { facts: { status: 'ok', pointers: ['.kiln/validate.md'], schema_valid: true }, narration_beat: 'a hundred eyes' }
}
// Act 2, the obedient addendum: grades per the kernel's issued instruction, survivors
// from the REALLY-published verdict, rows appended to the real validate.md.
const addendumAct = (dir) => (prompt) => {
  const held = prompt.includes('grade PARTIAL')
  const survivors = held ? [...new Set(JSON.parse(readFileSync(join(dir, SCREEN), 'utf8')).findings.map((f) => f.criterion))] : []
  const dims = { 'P-1': 'fidelity-to-requirement', 'P-2': 'typography' }
  const rows = Object.keys(dims).map((id) => id + ' · ' + dims[id] + ' · proxy exit 0 · ' + (survivors.includes(id) ? 'PARTIAL' : 'PASS'))
  appendFileSync(join(dir, '.kiln/validate.md'), rows.join('\n') + '\n')
  return { facts: { status: 'ok', pointers: ['.kiln/validate.md'], schema_valid: true }, narration_beat: held ? 'the rows land — the screen kept its doubts' : 'the rows land — the screen agreed' }
}
// The obedient report act: cards/report.md's variant rule over the REAL record — the
// marker presence selects held; the disclosure is the real rows + the real record line;
// the meter closes both variants (`beats["completion"]`, `{driver}` left DRIVER-filled),
// and the held meter opens with the card's counted Held line before the completion beat.
const METER_LINE = 'The forge cools. The work remains. Driver spend: {driver} tokens.'
const reportAct = (dir) => () => {
  const held = existsSync(marker(dir))
  const rows = readFileSync(join(dir, '.kiln/validate.md'), 'utf8').split('\n').filter((l) => / · (PASS|PARTIAL)$/.test(l))
  const esc = existsSync(join(dir, '.kiln/screen-escalation.txt')) ? readFileSync(join(dir, '.kiln/screen-escalation.txt'), 'utf8').trim() : ''
  const report = held
    ? ['✓ *Law* · ✓ *Build* · ▶ **Validate** · ○ *Report*',
        '`HELD` **Report — the run stands held at validate: the screen kept its doubts**',
        "## The screen's doubt", ...rows, esc,
        'Held: ' + rows.filter((l) => l.endsWith('PARTIAL')).length + " perceptual criteria stand PARTIAL — the ruling is the operator's.",
        METER_LINE].filter(Boolean).join('\n')
    : ['✓ *Law* · ✓ *Build* · ✓ *Validate* · ✓ *Report*',
        '`SEALED` **Report** — the report stands', ...rows, METER_LINE].join('\n')
  writeFileSync(join(dir, '.kiln/report.md'), report + '\n')
  return { facts: { status: 'ok', pointers: ['.kiln/report.md'], schema_valid: true }, narration_beat: held ? 'held, and told honestly' : 'the report stands' }
}
const runReport = (dir) => runKernel({ stage: 'report', projectDir: dir, plugin: REAL_PLUGIN }, {
  ...VOICE,
  'law:preflight': GREEN,
  'stage:report': reportAct(dir),
  'law:stage-end': GREEN,
  'report:check': (p) => runRealBlock(p, dir),
  'state:write': GREEN,
})
// The live visual validate scaffold; scenarios wire the grader legs.
const visualBase = (dir) => ({
  ...VOICE,
  'law:preflight': GREEN,
  ...realScreenDisk(dir),
  'perceptual:dial': { exit: 0, perceptual: 'on', recovery_cap: 2 },
  'stage:validate': captureAct(dir),
  'perceptual:manifest': { exit: 0, ids: [MF(1)] },
  'perceptual:family': { exit: 0 },
  'perceptual:belt': { exit: 0 },
  'perceptual:addendum': addendumAct(dir),
  'law:stage-end': GREEN,
  'state:write': GREEN,
})
// The no-progress semantic-hold trajectory: reject, recapture, an identical recheck
// cohort, then the blocked branch — the Claude escalation corroborating the survivor.
const noProgressHold = (dir) => {
  const seq = [{ exit: 0, ids: [MF(1)] }, { exit: 0, ids: [MF(2)] }]
  return {
    ...visualBase(dir),
    'perceptual:manifest': () => seq.shift() ?? { exit: 0, ids: [MF(2)] },
    'screen:review': publishScreen(dir, screenVerdict('changes_required', [screenFinding('F1', 'P-1')]), 10),
    'screen:recheck': publishScreen(dir, screenVerdict('changes_required', [screenFinding('F1', 'P-1')]), 10),
    'screen:findings': (p) => runRealIds(p, dir),
    'screen:survivors': (p) => runRealIds(p, dir),
    'perceptual:recapture': validateAct(),
    'perceptual:delta-check': { exit: 0 },
    'screen:digest': DIGEST_B,
    'screen:criteria': (p) => runRealIds(p, dir),
    'screen:invalidate': { exit: 0 },
    'screen-claude:escalate': OK_ACK,
    'screen:read': readCandidate(screenVerdict('changes_required', [screenFinding('E1', 'P-1')])),
    'screen:publish': { exit: 0 },
  }
}

test('dogfood (W8-S4): a visual run passes end-to-end — real table presence, capture act, screen accept, PASS rows on real disk, and the report tells a sealed run', async () => {
  const dir = mkVisual(LAW_VISUAL)
  const v = await runKernel({ stage: 'validate', projectDir: dir, plugin: REAL_PLUGIN }, {
    ...visualBase(dir),
    'screen:review': publishScreen(dir, screenVerdict('accept'), 0),
  })
  assert.equal(v.ret.status, 'ok')
  assert.ok(v.calls.find(c => c.label === 'perceptual:dial').prompt.includes('--visual true'),
    'the REAL presence read over the sealed LAW feeds --visual true')
  assert.ok(v.ret.beat.includes('the rows land — the screen agreed'), 'the addendum re-emits the truthful stage beat')
  const rows = readFileSync(join(dir, '.kiln/validate.md'), 'utf8')
  assert.ok(rows.includes('P-1 · fidelity-to-requirement · proxy exit 0 · PASS') && rows.includes('P-2 · typography · proxy exit 0 · PASS'),
    'the addendum landed real PASS rows for every table criterion')
  assert.ok(!rows.includes('PARTIAL'), 'no PARTIAL on an accepted run')
  assert.ok(!existsSync(marker(dir)), 'the REAL marker-clear leg left no marker — the ok terminal is nonsemantic')
  assert.equal(stateArgs(v.calls).key, 'relaunch-report', 'validate advances to report')
  const r = await runReport(dir)
  assert.equal(r.ret.status, 'done')
  assert.ok(r.calls.find(c => c.label === 'stage:report').prompt.includes('cards/report.md'), 'the report act follows the shipped card')
  const report = readFileSync(join(dir, '.kiln/report.md'), 'utf8')
  assert.ok(report.includes('`SEALED` **Report**') && report.includes('✓ *Law* · ✓ *Build* · ✓ *Validate* · ✓ *Report*'),
    'the sealed-run variant: the SEALED title and the all-sealed strip')
  assert.ok(!report.includes('HELD') && !report.includes("The screen's doubt"), 'no held banner and no disclosure on a clean run')
})

test('dogfood (W8-S4): a PARTIAL hold lands every durable fact on real disk — marker, escalation record, PARTIAL rows — and the operator-launched report tells the held-run variant', async () => {
  const dir = mkVisual(LAW_VISUAL)
  const v = await runKernel({ stage: 'validate', projectDir: dir, plugin: REAL_PLUGIN }, noProgressHold(dir))
  assert.equal(v.ret.status, 'blocked', 'no strict progress is the semantic hold — the operator-ruling shape')
  assert.equal(v.ret.pointers.escalation, 'CORROBORATED')
  assert.ok(existsSync(marker(dir)), 'the REAL marker stands on disk — written by the semantic hold alone')
  assert.equal(readFileSync(join(dir, '.kiln/screen-escalation.txt'), 'utf8'), 'CORROBORATED — 1 surviving criteria\n',
    'the REAL one-line escalation record')
  const rows = readFileSync(join(dir, '.kiln/validate.md'), 'utf8')
  assert.ok(rows.includes('P-1 · fidelity-to-requirement · proxy exit 0 · PARTIAL'),
    'the surviving criterion grades PARTIAL — a real row, derived from the really-published verdict')
  assert.ok(rows.includes('P-2 · typography · proxy exit 0 · PASS'), 'the rest grade PASS')
  const screenHeldV = stateArgs(v.calls)
  assert.equal(screenHeldV.key, 'operator-ruling')
  assert.ok(screenHeldV.pointers.includes(SCREEN))
  // The operator launches report ON the held state: the run reports, honestly.
  const r = await runReport(dir)
  assert.equal(r.ret.status, 'done', 'kernel report semantics unchanged — done means the report act completed; the CONTENT tells the truth')
  const report = readFileSync(join(dir, '.kiln/report.md'), 'utf8')
  assert.ok(report.includes('`HELD` **Report — the run stands held at validate'), 'the held banner — never SEALED')
  assert.ok(report.includes('✓ *Law* · ✓ *Build* · ▶ **Validate** · ○ *Report*'), 'the honest held strip — nothing past validate is sealed')
  assert.ok(!report.includes('SEALED') && !report.includes('✓ *Validate* · ✓ *Report*'),
    'no sealed title and no all-sealed strip anywhere on the held variant')
  assert.ok(report.includes("The screen's doubt") && report.includes('P-1 · fidelity-to-requirement · proxy exit 0 · PARTIAL'),
    'the disclosure carries the PARTIAL row verbatim from the record')
  assert.ok(report.includes('CORROBORATED — 1 surviving criteria'), 'the corroborated line rides the disclosure — the record carries it')
  assert.ok(report.includes("Held: 1 perceptual criteria stand PARTIAL — the ruling is the operator's."),
    "the held meter opens with the card's counted Held line — N from the PARTIAL rows")
  assert.ok(report.includes(METER_LINE) && report.indexOf('Held: 1 perceptual criteria') < report.indexOf(METER_LINE),
    'the completion meter follows the Held line, {driver} left DRIVER-filled — the spend is measured even when the work is held')
  assert.ok(existsSync(marker(dir)) && !r.calls.some(c => c.label === 'perceptual:marker-clear'),
    'the report run never touches the marker — only a validate conclusion may remove it')
})

test('dogfood (W8-S4): a dormant run is byte-identical — the REAL presence read finds no table, no screening leg wakes, and the report carries no variant', async () => {
  const dir = mkVisual(LAW_PLAIN)
  const { ret, calls } = await runKernel({ stage: 'validate', projectDir: dir, plugin: REAL_PLUGIN }, {
    ...VOICE,
    'law:preflight': GREEN,
    ...realScreenDisk(dir),
    'perceptual:dial': { exit: 0, perceptual: 'dormant', recovery_cap: 1 },
    'stage:validate': captureAct(dir),
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok')
  assert.ok(calls.find(c => c.label === 'perceptual:dial').prompt.includes('--visual false'),
    'the REAL presence read over a table-less LAW feeds --visual false')
  for (const label of ['perceptual:manifest', 'perceptual:family', 'perceptual:belt', 'screen:review', 'perceptual:addendum', 'perceptual:marker', 'escalate:record']) {
    assert.ok(!calls.some(c => c.label === label), 'dormant skips the machinery: ' + label)
  }
  assert.equal(ret.beat, 'a hundred eyes', 'the single-act beat crosses unchanged — no addendum re-emit, no variant')
  // Byte identity is claimed, so byte identity is asserted: both complete outputs equal
  // the no-screening baseline bytes — any residue anywhere (rows, notch, meter, foot)
  // fails, not just the substrings a variant would add.
  assert.equal(readFileSync(join(dir, '.kiln/validate.md'), 'utf8'),
    '# validate — check.sh exit 0\nC-1 · test -f index.html · ran · ✓\n',
    "the dormant validate.md is the capture act's exact bytes — no addendum rows, no residue")
  const r = await runReport(dir)
  assert.equal(r.ret.status, 'done')
  assert.equal(readFileSync(join(dir, '.kiln/report.md'), 'utf8'),
    '✓ *Law* · ✓ *Build* · ✓ *Validate* · ✓ *Report*\n`SEALED` **Report** — the report stands\n' + METER_LINE + '\n',
    'the dormant report equals the sealed baseline whole — the variant machinery leaves no byte behind')
  assert.ok(!existsSync(marker(dir)))
})

test('dogfood (W8-S4): relaunch-after-hold reaching accept — the REAL marker is removed by the ok terminal and the report returns to the sealed variant', async () => {
  const dir = mkVisual(LAW_VISUAL)
  const held = await runKernel({ stage: 'validate', projectDir: dir, plugin: REAL_PLUGIN }, noProgressHold(dir))
  assert.equal(held.ret.status, 'blocked')
  assert.ok(existsSync(marker(dir)), 'the hold left its marker')
  // The relaunch: fresh evidence satisfies the screen — the accept clears the doubt.
  const again = await runKernel({ stage: 'validate', projectDir: dir, plugin: REAL_PLUGIN }, {
    ...visualBase(dir),
    'screen:review': publishScreen(dir, screenVerdict('accept'), 0),
  })
  assert.equal(again.ret.status, 'ok', 'the relaunch reaches accept')
  assert.ok(!existsSync(marker(dir)), 'the REAL ok-terminal clear removed the marker — it never outlives the conclusion it describes')
  await runReport(dir)
  const report = readFileSync(join(dir, '.kiln/report.md'), 'utf8')
  assert.ok(report.includes('`SEALED` **Report**') && report.includes('✓ *Law* · ✓ *Build* · ✓ *Validate* · ✓ *Report*'),
    'the sealed-run variant returns')
  assert.ok(!report.includes('HELD') && !report.includes("The screen's doubt"),
    "no held banner, no disclosure — yesterday's doubt does not haunt today's clean run")
})

test('dogfood (W8-S4): the milestone eye and the screening room coexist across one build → validate arc — each gate in its stage, each on its own dial read, no interference', async () => {
  const dir = mkVisual(LAW_VISUAL)
  // The build launch: the boot-sealed seam owes its milestone audit, so the W7 eye fires here.
  const build = await runKernel({ stage: 'build', projectDir: dir, plugin: REAL_PLUGIN }, {
    ...dogfoodBase(dir),
    'cap:read': { exit: 0, recovery_cap: 1 },
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui|m1'] },
    'seal:set': { exit: 0, ids: ['s1'] },
    'audit:review': { exit: 0 },
    'audit:read': readAudit(auditVerdict('accept')),
  })
  assert.equal(build.ret.status, 'ok')
  assert.ok(build.calls.some(c => c.label === 'audit:append'), 'the milestone eye judged and promoted its seam')
  assert.equal(build.calls.filter(c => c.label === 'cap:read').length, 1, 'the build gates drink from the cap:read dial leg')
  for (const label of ['perceptual:presence', 'perceptual:dial', 'perceptual:family', 'screen:review', 'perceptual:addendum']) {
    assert.ok(!build.calls.some(c => c.label === label), 'the screening room never wakes at build: ' + label)
  }
  // The validate launch over the SAME project: the screening loop recovers a reject
  // under ITS OWN dial read — the build cap leg is never consulted here.
  const seq = [{ exit: 0, ids: [MF(1)] }, { exit: 0, ids: [MF(2)] }]
  const v = await runKernel({ stage: 'validate', projectDir: dir, plugin: REAL_PLUGIN }, {
    ...visualBase(dir),
    'perceptual:manifest': () => seq.shift() ?? { exit: 0, ids: [MF(2)] },
    'screen:review': publishScreen(dir, screenVerdict('changes_required', [screenFinding('F1', 'P-1')]), 10),
    'screen:findings': (p) => runRealIds(p, dir),
    'perceptual:recapture': validateAct(),
    'perceptual:delta-check': { exit: 0 },
    'screen:recheck': publishScreen(dir, screenVerdict('accept'), 0),
  })
  assert.equal(v.ret.status, 'ok', 'the same project validates past a recapture — the room recovered in its own stage')
  assert.equal(v.calls.filter(c => c.label === 'perceptual:dial').length, 1, 'the screening loop drinks from the perceptual dial leg')
  assert.equal(v.calls.filter(c => c.label === 'cap:read').length, 0, 'the caps are independent — validate never reads the build cap leg')
  assert.ok(!v.calls.some(c => c.label && c.label.startsWith('audit:')), 'the milestone eye never wakes at validate')
  assert.ok(!existsSync(marker(dir)), 'the recovered run leaves no marker')
})

// ── S4: dogfood — the no-codex acknowledged arc, one shared dir end to end ─────
// The capstone (INTAKE-38): the full degraded lifecycle across BOTH workflows over ONE project
// dir on real disk. The sweep drops the real degradation markers; every later stage READS those
// same real markers (never a mock) and takes the single-family seat, and the trusted CLIs write
// the single-family artifacts for real — the marker one workflow set is the marker the next
// consumes. The model legs stay mocked; the marker reads, the seal, the append, and the promote run.
const SWEEP_SRC = readFileSync(fileURLToPath(new URL('../workflows/research-sweep.js', import.meta.url)), 'utf8')
const runSweepBody = async (dir, script) => {
  const calls = []
  // W2-S1: the real conductor acquires the lock before the sweep and passes run_id + owner;
  // the dogfood answers the pre-boot join green by default so the arc runs as it does live.
  // W2-S7a (FORK 1): the degraded feasibility ratifier composes its canonical contract via the trusted
  // verb before dispatch; the dogfood mocks the digest (its publish leg is mocked too) so the arc runs.
  const full = { 'run-lock:join': { exit: 0, ids: [] }, 'feasibility:contract': { exit: 0, ids: ['d'.repeat(64)] }, ...script }
  // W2-S7a (B-RESEARCH-SWEEP): the degraded feasibility ratifier now mints its identity and runs
  // under the reserved leg label. This dogfood runs against a real dir and the real plugin, so the
  // mint runs the real identity-begin (the real publish validates the leg); the leg-labelled
  // dispatch resolves back to feasibility-claude:<mode> so the scripted answer keys unchanged.
  const legReg = new Map()
  const modeOf = (prompt) => /Recheck only/.test(prompt) ? 'recheck' : 'review'
  const agentMock = async (prompt, opts = {}) => {
    let key = opts.label
    if (typeof key === 'string' && /^leg:[0-9a-f]{32}$/.test(key) && legReg.has(key)) {
      key = legReg.get(key) === 'ratifier' ? 'feasibility-claude:' + modeOf(prompt) : key
    }
    calls.push({ label: key, prompt, opts })
    if (full[key] === undefined && typeof key === 'string' && key.startsWith('identity:')) {
      const m = prompt.match(/identity-begin \.kiln '([^']*)' '([^']*)' '([^']*)'/)
      const rr = spawnSync('sh', ['-c', prompt.split('\n').pop()], { cwd: dir, encoding: 'utf8' })
      const ids = (rr.stdout || '').trim().split(/\s+/).filter(Boolean)
      if (rr.status === 0 && ids.length === 2 && m) legReg.set(ids[1], m[1])
      return { exit: rr.status === null ? 20 : rr.status, ids: rr.status === 0 ? ids : [] }
    }
    const h = full[key]
    if (h === undefined) throw new Error('unmocked sweep label: ' + key)
    return typeof h === 'function' ? await h(prompt) : h
  }
  const body = SWEEP_SRC.replace('export const meta', 'const meta')
  const fn = new AsyncFunction('agent', 'pipeline', 'parallel', 'log', 'phase', 'args', 'budget', 'workflow', body)
  const ret = await fn(agentMock, null, null, () => {}, () => {}, { plugin: REAL_PLUGIN, run_id: RUN_ID, owner: OWNER, projectDir: dir }, null, null)
  return { ret, calls }
}

test('dogfood (S4, INTAKE-38): the acknowledged no-codex arc runs end to end over ONE dir — degraded markers, single-family feasibility, LAW seal, and milestone audit all land on real disk', async () => {
  const dir = mkProject()
  mkdirSync(join(dir, '.kiln/docs'), { recursive: true })
  const CAND = '# Feasibility\nsingle-family read\n'
  const CAND_DIGEST = createHash('sha256').update(CAND).digest('hex')
  const LAW = '# LAW\nthe locked plan\n'
  const LAW_DIGEST = createHash('sha256').update(LAW).digest('hex')
  writeFileSync(join(dir, '.kiln/LAW.md'), LAW)
  // W2-S3: the real seal-law digests the whole trio, so the other two members are on disk.
  mkdirSync(join(dir, '.kiln/law'), { recursive: true })
  writeFileSync(join(dir, '.kiln/law/check.sh'), '#!/usr/bin/env bash\nexit 0\n')
  writeFileSync(join(dir, '.kiln/slices.json'), JSON.stringify([{ id: 's1', surface: 'ui', milestone: 'core' }]))
  const writeCand = () => { writeFileSync(join(dir, '.kiln/docs/feasibility-candidate.md'), CAND); return { facts: { status: 'ok', pointers: ['.kiln/docs/feasibility-candidate.md'], schema_valid: true }, narration_beat: 'the feasibility read is on disk' } }
  const rExit = (p) => runReal(p, dir)

  // (a) The sweep's FIRST codex-down detection — the acknowledgment stop leaves both markers on disk.
  const a = await runSweepBody(dir, {
    'tiers:boot': TIERS_OK,
    'invalidate': rExit,
    'dial:read': { exit: 0, research: 'on', recovery_cap: 2 },
    'producer': writeCand,
    'candidate:check': rExit,
    'feasibility:degraded': rExit, // absent on disk → the codex seat
    'ratify:request': { exit: 0 },
    'ratify:gate': { exit: 21 }, // codex unavailable
    'feasibility:degraded-mark': rExit, // the real touch of the degraded marker
  })
  assert.equal(a.ret.status, 'degraded', 'the first codex-down feasibility ratify is the acknowledgment stop')
  // W2-S10 (Sol r1 B1): on real disk, the detection leaves the marker and NOT the ack. A stop that
  // was issued must stay distinguishable from a stop that was answered, or a later resume reads an
  // unanswered detection as the operator word and runs single-family with no word anywhere.
  assert.ok(existsSync(join(dir, '.kiln/degraded')), 'the degradation marker is on real disk after the acknowledgment stop')
  assert.ok(!existsSync(join(dir, '.kiln/degraded-ack')), 'and the ack is NOT — only the conductor writes it, on the operator word')

  // W2-S10d: the operator answers `continue`, and the CONDUCTOR writes the word — the one Bash from
  // SKILL.md, the only ack write in the tree. Every acked leg below now reads this file for real, so
  // the arc proves what it claims: the single-family seats run because the word is on disk.
  writeFileSync(join(dir, '.kiln/degraded-ack'), '')

  // (b) The acked sweep re-run — the REAL marker routes the opus claude seat and promotes single-family.
  const feasVerdict = { review_id: 'f-op', law_hash: CAND_DIGEST, findings: [], blockers: [], verdict: 'accept' }
  const b = await runSweepBody(dir, {
    'tiers:boot': TIERS_OK,
    'invalidate': rExit,
    'dial:read': { exit: 0, research: 'on', recovery_cap: 2 },
    'producer': writeCand,
    'candidate:check': rExit,
    'feasibility:degraded': rExit, 'feasibility:degraded-ack': rExit, // present on disk → the claude seat, word behind it
    'feasibility:digest': { exit: 0, ids: [CAND_DIGEST] },
    'feasibility:invalidate': { exit: 0 },
    'feasibility-claude:review': { ok: true },
    'feasibility:read': { exit: 0, ids: [JSON.stringify(feasVerdict)] },
    'feasibility:digest-confirm': { exit: 0, ids: [CAND_DIGEST] },
    'feasibility:publish': { exit: 0 },
    'promote': rExit, // the real atomic rename to the canonical path
  })
  assert.equal(b.ret.status, 'accepted', 'the acked re-run promotes single-family through the opus claude seat')
  assert.ok(!b.calls.some(c => c.label === 'ratify:gate'), 'the codex ratify transport is never called once the marker is present')
  assert.equal(b.calls.find(c => c.label === 'feasibility-claude:review').opts.model, 'opus', 'the fallback ratifier is the opus seat')
  assert.equal(readFileSync(join(dir, '.kiln/docs/feasibility.md'), 'utf8'), CAND, 'the ratified candidate is the canonical feasibility read on disk')
  assert.ok(b.ret.beat.toLowerCase().includes('single-family'), 'the promotion beat is honest about the single family')

  // (c) The kernel LAW stage over the SAME dir — the REAL marker routes the claude ratifier; seal-law locks single-family.
  const lawVerdict = { review_id: 'r-op', law_hash: LAW_DIGEST, findings: [], blockers: [], verdict: 'accept' }
  const c = await runKernel({ stage: 'law', projectDir: dir, plugin: REAL_PLUGIN }, {
    ...VOICE,
    ...ONBOARDING_OK,
    'law:preflight': GREEN,
    'stage:law': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'the law' },
    'law:degraded': rExit, 'law:degraded-ack': rExit, // present → the claude ratify seat, word behind it
    'ratify:digest': { exit: 0, ids: [LAW_DIGEST] },
    'ratify:invalidate': { exit: 0 },
    'ratify-claude:review': { ok: true },
    'ratify:read': readCandidate(lawVerdict),
    'ratify:digest-confirm': { exit: 0, ids: [LAW_DIGEST] },
    'ratify:publish': { exit: 0 },
    'law:milestone-projection': { exit: 0 },
    'law:perceptual-table': { exit: 0 },
    'law:seal-label': rExit, // present → single-family
    'law:seal': rExit, // the REAL seal-law verb digests LAW.md and writes the sidecar
    'law:stage-end': GREEN,
    'state:write': GREEN,
  })
  assert.equal(c.ret.status, 'ok', 'the LAW ratifies single-family and seals over the same dir')
  assert.ok(!c.calls.some(x => x.label === 'ratify:gate'), 'the codex ratify transport is never called at the degraded LAW')
  assert.equal(readFileSync(join(dir, '.kiln/law/lock.seal'), 'utf8'), LAW_DIGEST + ' single-family\n',
    'the digest-bound lock.seal sidecar records single-family on real disk')
  assert.equal(readFileSync(join(dir, '.kiln/law/lock.hash'), 'utf8'), LAW_DIGEST + '\n',
    'lock.hash is the bare 64-hex digest the audit and screen verbs require')

  // (d) The kernel build stage — a seam audits through the claude auditor and appends single-family on disk.
  const auditAccept = { review_id: 'aud-1', law_hash: LAW_DIGEST, findings: [], blockers: [], verdict: 'accept' }
  const d = await runKernel({ stage: 'build', projectDir: dir, plugin: REAL_PLUGIN }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui|core'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'seal:set': { exit: 0, ids: ['s1'] }, // the seam stands sealed; it owes its milestone audit
    'law:stage-end': GREEN,
    'state:write': GREEN,
    'audit:member': (p) => runReal(p, dir), // the REAL read-only verb over this dir: no audit ledger yet
    'law:pre-audit': GREEN,
    'audit:degraded': rExit, 'audit:degraded-ack': rExit, // present → the claude auditor seat, word behind it
    'audit-claude:lawhash': { exit: 0, ids: [LAW_DIGEST] },
    'audit-claude:invalidate': { exit: 0 },
    'audit-claude:review': { ok: true },
    'audit-claude:read': readAudit(auditAccept),
    'audit-claude:publish': { exit: 0 },
    'audit:read': readAudit(auditAccept),
    'audit:seal-label': rExit, // present → single-family
    'audit:append': { exit: 0 },
  })
  assert.equal(d.ret.status, 'ok', 'the seam audits single-family over the same dir')
  assert.equal(d.calls.find(c => c.label === 'audit:member').exit, undefined, 'the membership answer came from the real verb, not a script')
  // The marker one workflow set is the marker the next consumes: the audit seat, the family label on
  // the append, and the auditor identity all follow from the degradation markers on real disk.
  const append = d.calls.find(c => c.label === 'audit:append').prompt
  assert.ok(/append-audit \.kiln s1 single-family '[0-9a-f]{32}' '' 'reviewed'$/.test(append.split('\n').pop()),
    'the append records the single-family label read at append time, the real claude auditor leg, and its attestation kind')
})

// ── W2-S7a (ruling A-prime): production-wiring extraction pins ────────────────
// The W2-S1 lesson: no test-only control flow rides trusted code, so the identity wiring is pinned
// by source extraction — the attestation dispatch sites route through the trusted mintLeg and
// dispatch under the minted reserved label, the append and publish call sites carry the leg-
// reference argv, and the conductor runs the capture verb before every beat. W2-S7b (item 10): the
// audit-repair site is GONE with the mutation path it served — six sites, not seven.
test('runtime (W2-S7a): each of the six Claude dispatch sites mints its identity through identity-begin and runs under the minted reserved leg label', () => {
  for (const role of ['builder', 'repair', 'gate-reviewer', 'auditor', 'ratifier', 'screen-grader']) {
    assert.ok(src.includes(`mintLeg('${role}'`), `the ${role} dispatch mints its leg identity`)
  }
  // mintLeg calls the trusted identity-begin verb, shq-quoted, and returns null on a failed mint.
  assert.ok(src.includes("identity-begin .kiln ' + shq(role) + ' ' + shq(alias) + ' ' + shq(subject)"), 'mintLeg builds the shq-quoted identity-begin call')
  // the reserved leg label is the dispatched agent label at every site — never a reusable string.
  assert.ok(src.includes('builderLeg.label, builderOpts') && src.includes('repairLeg.label, builderOpts'), 'the builder and slice repair run under their minted labels')
  for (const bind of ['label: gateLeg.label', 'label: auditLeg.label', 'label: ratifyLeg.label', 'label: screenLeg.label']) {
    assert.ok(src.includes(bind), `the dispatch binds ${bind}`)
  }
  assert.ok(!/'slice:' \+ slice|'repair:' \+ slice|'gate-claude:' \+ mode|'audit-claude:' \+ mode|label: 'audit:repair'|'ratify-claude:' \+ mode|'screen-claude:' \+ mode/.test(src),
    'no attestation dispatch runs under a reusable label — the reserved leg label supplants every one')
})

test('runtime (W2-S7a): the seal, audit, and claude-publish call sites carry the leg-reference argv, shq-quoted, and the generation legs accumulate', () => {
  assert.ok(src.includes("append-seal .kiln ' + slice + ' ' + label + ' ' + shq(builderLegs.join(',')) + ' ' + shq(reviewerLeg || '-')"),
    'the seal carries the builder legs and the reviewer position')
  assert.ok(src.includes('builderLegs.push(builderLeg.legId)') && src.includes('builderLegs.push(repairLeg.legId)'),
    'the builder and repair legs accumulate into the seal builder references')
  assert.ok(src.includes("append-audit .kiln ' + slice + ' ' + auditFamily + ' ' + shq(auditorLeg || '-') + ' ' + shq('') + ' ' + shq('reviewed')"),
    'the audit carries the auditor leg, an always-empty repair-legs word, and its attestation kind')
  assert.ok(!/mintLeg\('audit-repair'|auditRepairLegs|audit-recheck|dirtySlices/.test(src),
    'no audit-repair leg, repair-leg carry, recheck dispatch or dirty-prefix set survives — a half-deleted branch is how a dead mechanism returns')
  for (const pub of [
    "publish-gate .kiln review ' + P.candidate + ' ' + P.gate + ' ' + shq(gateLeg.legId)",
    "publish-gate .kiln ratify ' + P.candidate + ' ' + P.gate + ' ' + shq(ratifyLeg.legId)",
    "publish-gate .kiln audit ' + P.candidate + ' ' + P.audit + ' ' + shq(auditLeg.legId)",
    "publish-gate .kiln screen ' + P.candidate + ' ' + target + ' ' + shq(screenLeg.legId)",
  ]) {
    assert.ok(src.includes(pub), 'the claude publish carries its reviewer leg: ' + pub)
  }
})

test('runtime (W2-S7a, FORK 3): the manifest-start, manifest-prepare, review-publish and seal call sites carry the cwd-relative repo shq-quoted; the audit and screen paths carry NONE', () => {
  assert.ok(src.includes("manifest-start ' + shq('.') + ' .kiln ' + shq(slice)"), 'manifest-start rides the cwd-relative repo and the slice, shq-quoted')
  assert.ok(src.includes("manifest-prepare ' + shq('.') + ' .kiln ' + shq(slice)"), 'manifest-prepare rides the cwd-relative repo and the slice, shq-quoted')
  assert.ok(src.includes("publish-gate .kiln review ' + P.candidate + ' ' + P.gate + ' ' + shq(gateLeg.legId) + ' ' + shq('.') + ' ' + shq(slice)"),
    'the review publish gains the repo and slice after the reviewer leg')
  assert.ok(src.includes("shq(reviewerLeg || '-') + ' ' + shq('.')"), 'the seal gains the cwd-relative repo after the reviewer position')
  // The audit and screen paths judge coverage (S7b) and perceptual evidence, not source — no manifest
  // args ride their publishes or the audit append.
  assert.ok(!src.includes("shq(auditLeg.legId) + ' ' + shq('.')"), 'the audit publish carries no manifest repo/slice')
  assert.ok(!src.includes("shq(screenLeg.legId) + ' ' + shq('.')"), 'the screen publish carries no manifest repo/slice')
  assert.ok(!src.includes("shq('reviewed') + ' ' + shq('.')"), 'the audit append ends at its kind word — no manifest repo rides it')
})

test('runtime (W2-S7a, FORK 1): each claude reviewer leg composes its canonical contract before dispatch and threads the digest into the prompt and the publish-gate binding', () => {
  // The four claude legs run the trusted contract-prepare verb, cwd-relative repo shq-quoted, one per family.
  assert.ok(src.includes("contract-prepare ' + shq('.') + ' .kiln slice-review "), 'the claude gate composes a slice-review contract')
  assert.ok(src.includes("contract-prepare ' + shq('.') + ' .kiln milestone-audit "), 'the claude audit composes a milestone-audit contract')
  assert.ok(src.includes("contract-prepare ' + shq('.') + ' .kiln artifact-ratify "), 'the claude ratify composes an artifact-ratify contract')
  assert.ok(src.includes("contract-prepare ' + shq('.') + ' .kiln perceptual-screen "), 'the claude screen composes a perceptual-screen contract')
  // The digest threads into the reviewer prompt as the authoritative contract file.
  for (const v of ['gateContract', 'auditContract', 'ratifyContract']) {
    assert.ok(src.includes(".kiln/contracts/sha256/' + " + v + " + '.json"), 'the digest names the authoritative contract file in the prompt: ' + v)
  }
  assert.ok(src.includes(".kiln/contracts/sha256/' + contract + '.json"), 'the screen prompt names the authoritative contract file')
  // The digest is the LAST word of each publish-gate call — the review after the manifest pair.
  assert.ok(src.includes("shq(slice) + ' ' + shq(gateContract)"), 'the review publish carries the contract digest after the manifest pair')
  assert.ok(src.includes("shq(auditLeg.legId) + ' ' + shq(auditContract)"), 'the audit publish carries the contract digest after the reviewer leg')
  assert.ok(src.includes("shq(ratifyLeg.legId) + ' ' + shq(ratifyContract)"), 'the ratify publish carries the contract digest after the reviewer leg')
  assert.ok(src.includes("shq(screenLeg.legId) + ' ' + shq(screenContract)"), 'the screen publish carries the contract digest after the reviewer leg')
})

test('runtime (W2-S7a, FORK 1): the claude build gate runs contract-prepare BEFORE the reviewer dispatch and threads the composed digest into the publish argv', async () => {
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, claudeGateScript({
    'gate-claude:facts': { exit: 0, ids: ['a'.repeat(64)] },
    'gate-claude:contract': { exit: 0, ids: ['c'.repeat(64)] },
    'gate:read': readCandidate(GATE_ACCEPT),
  }))
  assert.equal(ret.status, 'ok', 'the logic slice builds through the claude gate and seals')
  const idx = (label) => calls.findIndex((c) => c.label === label)
  assert.ok(idx('gate-claude:contract') >= 0 && idx('gate-claude:contract') < idx('gate-claude:review'), 'the contract is composed before the reviewer dispatch')
  const publish = calls.find((c) => c.label === 'gate:publish')
  assert.ok(publish.prompt.includes(" '" + 'c'.repeat(64) + "'"), 'the composed contract digest rides the publish-gate argv as the last word')
})

test('runtime (W2-S7a, FORK 3): manifest-start precedes the builder, manifest-prepare precedes the gate, and the seal carries the cwd-relative repo', async () => {
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'slice:s1': { facts: { status: 'ok', pointers: [], schema_valid: true }, narration_beat: 'forging' },
    'law:pre-seal': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'ok', 'the ui slice builds, gates, and seals')
  const idx = (label) => calls.findIndex(c => c.label === label)
  assert.ok(idx('manifest:start') >= 0 && idx('manifest:start') < idx('identity:builder'), 'the baseline is captured before the builder identity is minted')
  assert.ok(idx('manifest:start') < idx('slice:s1'), 'and before the builder dispatch — no pre-run dirt is attributed to the slice')
  assert.ok(idx('manifest:prepare') >= 0 && idx('manifest:prepare') < idx('gate:review'), 'a fresh manifest is prepared before the gate dispatch')
  assert.ok(calls.find(c => c.label === 'manifest:start').prompt.includes("manifest-start '.' .kiln 's1'"), 'manifest-start rides the cwd-relative repo and slice, shq-quoted')
  assert.ok(calls.find(c => c.label === 'manifest:prepare').prompt.includes("manifest-prepare '.' .kiln 's1'"), 'manifest-prepare rides the same')
  const seal = calls.find(c => c.label === 'seal:append').prompt.split('\n').pop()
  assert.ok(/append-seal .* '\.' 'reviewed'$/.test(seal), 'the seal command carries the cwd-relative repo and closes on its attestation kind, both shq-quoted')
})

test('runtime (W2-S7a, FORK 3): a manifest-start fault holds the stage before the builder is minted', async () => {
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'law:pre-seal': GREEN,
    'law:stage-end': GREEN,
    'manifest:start': { exit: 20 },
    'state:write': GREEN,
  })
  assert.equal(ret.status, 'transport-failure', 'a nonzero manifest-start holds the stage')
  assert.ok(!calls.some(c => c.label === 'identity:builder'), 'no builder is minted over an uncapturable baseline')
  assert.ok(!calls.some(c => c.label === 'slice:s1'), 'and no slice is built')
})

test('runtime (W2-S7a): the conductor runs capture-and-finalize after every Workflow return, before the beat, holding the line on a nonzero', () => {
  const skill = readFileSync(fileURLToPath(new URL('../skills/kiln-fire/SKILL.md', import.meta.url)), 'utf8')
  assert.ok(skill.includes('capture-and-finalize .kiln'), 'the conductor wires the trusted capture verb')
  assert.ok(skill.includes('BEFORE you emit') && skill.includes('Exit 0 → proceed'), 'it runs before the beat and proceeds only on exit 0')
  assert.ok(/Nonzero →/.test(skill) && skill.includes('hard-stop family'), 'a nonzero capture holds the line as a hard stop')
  // W2-S7b (item 11): the kernel now returns an advancing `ok` that names BUILD again. A conductor
  // following the pipeline order instead of the pointer would launch validate over a milestone
  // nothing has audited — the W7-S2 defect, resurrected in the choreography.
  assert.ok(skill.includes('pointers.next_stage') && skill.includes('never the pipeline order'),
    'the conductor is told to launch the stage the return names, not the one the spine implies')
})

// ── W2-S7a (F1) + W2-S7b (item 11): the milestone audit rests on BOOT-TIME sealed membership ─────
// Seal rendering is deferred to the conductor capture, so an audit can lead the seal projection: a
// covered slice rebuilt this invocation holds only a provisional candidate. The audited-skip is
// honored only over a prefix sealed at boot, and an audit is never DISPATCHED over one that is not —
// its append could only die at the CLI, which refuses an audit covering a slice at no generation.
test('runtime (W2-S7b, item 11): a boot-sealed seam whose covered PREFIX was rebuilt this invocation dispatches no audit — the pre-gate relaunches instead', async () => {
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui|core', 'obj|s2|ui|core'] },  // s2 is the closing seam
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'seal:set': { exit: 0, ids: ['s2'] },    // the seam stands at boot; its covered s1 does not
    'slice:s1': auditSlice(),
    'law:pre-seal': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 0 },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
    'audit:member': { exit: 0, ids: ['covered:s1,s2'] },  // a rendered audit ALREADY covers the seam — the desync
  })
  assert.equal(ret.status, 'ok')
  assert.equal(ret.pointers.next_stage, 'build', 'the pre-gate returns the advance-class relaunch, not the pipeline-next stage')
  assert.equal(calls.filter(c => c.label === 'seal:append').length, 1, 's1 sealed LIVE this invocation — a provisional candidate, not rendered membership')
  assert.ok(!calls.some(c => c.label === 'law:pre-audit' || c.label === 'audit:review'),
    'no audit is dispatched over the provisional prefix, and the stale covering answer never bought a skip — the guard reads the frozen boot snapshot, never the live SEALS set')
})

test('runtime (W2-S7a, F1): a rendered audit whose covered prefix IS in boot membership honors the skip — no redundant re-audit', async () => {
  const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui|core'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'seal:set': { exit: 0, ids: ['s1'] },    // s1 boot-sealed — the whole covered prefix stands
    'law:stage-end': GREEN,
    'state:write': GREEN,
    'audit:member': { exit: 0, ids: ['covered:s1'] },
  })
  assert.equal(ret.status, 'ok')
  assert.ok(!calls.some(c => c.label === 'audit:review' || c.label === 'law:pre-audit'), 'the boot-sealed covered seam honors the skip — no re-audit, no receipt refresh')
})

test('runtime (W2-S7a, F1): the audit-skip guard reads the frozen boot snapshot, and no provisional seal is live-added to membership', () => {
  assert.ok(src.includes('SEALS_AT_BOOT = new Set(SEALS)'), 'the boot snapshot is frozen beside the SEALS init')
  assert.ok(src.includes('SEALS_AT_BOOT.has(id)'), 'the audit-skip validates the covered prefix against the snapshot')
  // W2-S7a (B-PROVISIONAL-LIVE): the unconditional SEALS.add after the provisional seal is GONE —
  // SEALS reflects rendered membership only, so firstSealed and reopen never count an unattested seal.
  assert.ok(!src.includes('SEALS.add('), 'no provisional seal is live-added into the membership set')
  // W2-S7b (the ordering hazard): u2 introduces the only two cutoff callers in the kernel, so the
  // CLI-side withdrawal guard stays unreachable by construction — and that rests on three counts. A
  // second append-seal site, or a cutoff that did not immediately return a stop, would break it.
  assert.equal((src.match(/append-seal \.kiln/g) || []).length, 1, 'append-seal is issued from exactly ONE call site')
  assert.ok(src.includes('if (SEALS.has(slice)) {'), 'and it sits behind the sealed-skip — a slice that renders membership is never re-appended')
  assert.equal((src.match(/auditSeam\(/g) || []).length, 1, 'auditSeam has exactly one call site, behind that same skip')
  assert.equal((src.match(/invalidate \.kiln/g) || []).length, 2, 'the cutoff has exactly two callers: the reopen and the milestone rejection')
})

test('runtime (W2-S7a, B-D2-PIN b): the kernel reads the codex gate sidecar and threads the EXACT read leg into the seal reviewer argv', async () => {
  // Source-extraction (the W2-S1 pin-the-wiring idiom): the kernel reads <gate>.leg after the codex
  // gate and carries the read value into the seal reviewer position.
  assert.ok(src.includes("P.gate + '.leg'") && src.includes('reviewerLeg = legRead.ids[0]'),
    'the kernel reads the gate sidecar and threads the read leg into reviewerLeg')
  assert.ok(src.includes("shq(reviewerLeg || '-')"), 'the seal reviewer argv carries the threaded reviewer leg (- only when absent)')
  // Scenario: a ui-normal (codex-gated) slice whose sidecar read returns a known leg; the seal:append
  // command carries EXACTLY that leg in the reviewer position. (Discriminating: FAILS when the read/
  // thread block is reverted — reviewerLeg stays null and the seal carries the - sentinel.)
  const LEG = 'd'.repeat(32)
  const { calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
    ...VOICE,
    'law:preflight': GREEN,
    'slices:fetch': { exit: 0, ids: ['obj|s1|ui'] },
    'ladder:fetch': LADDER,
    'cap:read': { exit: 0, recovery_cap: 2 },
    'seal:set': { exit: 0, ids: [] },
    'slice:s1': auditSlice(),
    'law:pre-seal': GREEN,
    'law:stage-end': GREEN,
    'degraded:check': { exit: 1 },
    'gate:review': { exit: 0 },
    'gate:leg': { exit: 0, ids: [LEG] },
    'seal:append': { exit: 0 },
    'state:write': GREEN,
  })
  const seal = calls.find(c => c.label === 'seal:append')
  assert.ok(seal && seal.prompt.includes("'" + LEG + "'"), 'the seal:append command carries exactly the codex sidecar leg, shq-quoted, in the reviewer position')
  assert.ok(!seal.prompt.endsWith("'-'\n") && !/append-seal .* '-'$/.test(seal.prompt.split('\n').pop()), 'the codex-gated seal reviewer is the real leg, never the - sentinel')
})

test('runtime (W2-S7a, B-D2-PIN c): a codex-reviewed slice whose sidecar read is missing or malformed HOLDs 20 BEFORE any append — never a silent - fallback', async () => {
  for (const bad of [{ exit: 1 }, { exit: 0, ids: [] }, { exit: 0, ids: ['not-hex'] }]) {
    const { ret, calls } = await runKernel({ stage: 'build', projectDir: '/p' }, {
      ...VOICE,
      'law:preflight': GREEN,
      'slices:fetch': { exit: 0, ids: ['obj|s1|ui'] },
      'ladder:fetch': LADDER,
      'cap:read': { exit: 0, recovery_cap: 2 },
      'seal:set': { exit: 0, ids: [] },
      'slice:s1': auditSlice(),
      'law:pre-seal': GREEN,
      'law:stage-end': GREEN,
      'degraded:check': { exit: 1 },
      'gate:review': { exit: 0 },
      'gate:leg': bad,
      'seal:append': { exit: 0 },
      'state:write': GREEN,
    })
    assert.equal(ret.status, 'transport-failure', 'a missing or malformed codex reviewer sidecar HOLDs')
    assert.equal(calls.filter(c => c.label === 'seal:append').length, 0, 'no seal append before the codex reviewer identity is recovered — never a silent - fallback')
  }
})
