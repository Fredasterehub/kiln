// architecture-council.test.mjs — B4-1b-ii acceptance: the GENERATED workflows/architecture.js wires
// the Twin Council at capability tier T4 on the FULL path (fable ∥ receipt-attested Sol drafts →
// blind dual ratification → one bounded answer exchange → blind re-verdict → honest terminal), and
// BYTE-PRESERVES the v3.0.1 paths everywhere else (lite, T1–T3, no-runToken). Same runWorkflow idiom
// as posture-args.test.mjs: the workflow body is an AsyncFunction over the runtime globals, `agent` is
// a programmable mock keyed on label, gateAgent is INLINED into the generated file so it drives the
// same mock. FIXTURE DISCIPLINE (Sol F11): every hash that appears on both sides of a comparison is
// DERIVED from deterministic artifact bytes with real hashing helpers — output hashes from the payload
// bytes, receipt hashes from the receipt bytes, canonical hashes via sha256Hex(canonicalJson(...)).
// Only pure IDENTITY echoes (session uuid, invocation id, prompt/packet/stderr shas) stay constants.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sha256Hex, canonicalJson, buildDecisionBundle, COUNCIL_PROTOCOL_VERSION } from '../../plugins/kiln/src/council.mjs'

const ARCHITECTURE = fileURLToPath(new URL('../../plugins/kiln/workflows/architecture.js', import.meta.url))
const ARCH_SRC = fileURLToPath(new URL('../../plugins/kiln/workflows-src/architecture.js', import.meta.url))

const AsyncFunction = (async () => {}).constructor
const bodyOf = (file) => readFileSync(file, 'utf8').replace(/^export const meta\b/m, 'const meta')

async function runWorkflow(file, args, respond) {
  const log = []
  const calls = []
  const agent = async (prompt, opts) => {
    const label = (opts && opts.label) || ''
    calls.push({ label, prompt })
    return respond(label, prompt)
  }
  const stubs = {
    args,
    phase: () => {},
    log: (s) => log.push(String(s)),
    agent,
    parallel: async (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null))),
    pipeline: async (items, ...stages) => {
      const out = []
      for (const [i, it] of items.entries()) {
        let v = it
        for (const s of stages) { v = await Promise.resolve(s(v, it, i)).catch(() => null); if (v === null) break }
        out.push(v)
      }
      return out
    },
    budget: undefined,
    workflow: async () => null,
  }
  const keys = Object.keys(stubs)
  const run = new AsyncFunction(...keys, bodyOf(file))
  const result = await run(...keys.map((k) => stubs[k]))
  return { result, log, calls }
}

const labelsIn = (calls) => calls.map((c) => c.label)
const promptOf = (calls, label) => (calls.find((c) => c.label === label) || {}).prompt || ''
const countLabel = (calls, label) => calls.filter((c) => c.label === label).length
const KILN = '/tmp/nonexistent-kiln/.kiln'
const PROJECT = '/tmp/nonexistent-kiln'
const RUNTOKEN = 'RUNTOKEN-SECRET-zzz'
const masterPlanFile = `${KILN}/master-plan.md`

// ── derived-hash fixture helpers (Sol F11): real bytes, real hashers ──
const shaBytes = (buf) => createHash('sha256').update(buf).digest('hex')
const oshaOf = (payload) => shaBytes(Buffer.from(JSON.stringify(payload)))   // the pinned byte form
const rshaOf = (receipt) => shaBytes(Buffer.from(JSON.stringify(receipt)))
// pure identity echoes (exist only to be echoed between fixture sides — allowed constants)
const SESSION = '019f5a46-fc83-7181-8303-f516494485ac'
const INV = '3'.repeat(64), PSHA = '1'.repeat(64), XSHA = '5'.repeat(64)
const validReceipt = (payload, over = {}) => ({
  receipt_version: 1, parser_version: 'kiln-codex-receipt/1', transport: 'codex_exec', invocation_id: INV,
  prompt_sha256: PSHA, packet_sha256: XSHA, cli_version: '0.144.1', requested_model: 'gpt-5.6-sol',
  reported_model: 'gpt-5.6-sol', session_id: SESSION, exit_code: 0, tokens_used: 18747,
  output_sha256: oshaOf(payload), stderr_sha256: XSHA, ...over,
})
const solEnvelope = (payload, receiptOver) => ({ payload, codex_receipt: validReceipt(payload, receiptOver || {}), raw_artifact_refs: { stderr: 's', output: 'o' } })
// crossOk(payload, phaseTag, over) — the invocation-exact thoth:receipt-check transcription the SCRIPT
// verifies against the sink + reservation + payload. over.{disk,canon,verified,reservation} inject
// mismatches; every honest field is DERIVED from the same payload bytes the receipt attested.
const crossOk = (payload, phaseTag, over = {}) => ({
  output_sha256_disk: over.disk !== undefined ? over.disk : oshaOf(payload),
  output_canonical_sha256: over.canon !== undefined ? over.canon : sha256Hex(canonicalJson(payload)),
  ledger: {
    verified: over.verified === null ? null : {
      status: 'verified', invocation_id: INV, receipt_sha256: rshaOf(validReceipt(payload)),
      output_sha256: oshaOf(payload), session_id: SESSION, reported_model: 'gpt-5.6-sol',
      tokens_used: 18747, exit_code: 0, receipt_verified: true, ...(over.verified || {}),
    },
    reservation: over.reservation === null ? null : {
      invocation_id: INV, keystone: 'master_plan', phase: phaseTag, seat: 'sol', attempt: 1,
      run_token: RUNTOKEN, prompt_sha256: PSHA, packet_sha256: XSHA, ...(over.reservation || {}),
    },
  },
})

// ── plan / synth / foundation fixtures ──
const foundation = (scope) => ({ reasoning: 'f', architecture_file: `${KILN}/docs/architecture.md`, tech_stack_file: `${KILN}/docs/tech-stack.md`, arch_constraints_file: `${KILN}/docs/arch-constraints.md`, has_visual_direction: false, scope, estimated_milestones: 2, summary: 'sum' })
const planResult = (slot) => ({ reasoning: 'p', slot, plan_file: `${KILN}/plans/plan-${slot}.md`, approach_summary: 'a', milestones: [{ id: 'M1', title: 'T', summary: 's' }], key_decisions: [] })
const solDraftPayload = { approach_summary: 'sol-a', milestones: [{ id: 'M1', title: 'T', summary: 's' }], key_decisions: [], plan_markdown: '# plan b\n' }
const synthResult = { reasoning: 's', master_plan_file: masterPlanFile, milestone_count: 1, milestones: [{ id: 'M1', title: 'T', surface: 'logic', confidence: 'high' }], confidence_summary: 'c' }
const divergenceResult = { reasoning: 'd', analysis_file: `${KILN}/plans/div.md`, consensus: [], divergences: [], unique_insights: [] }
const validateResult = (v) => ({ reasoning: 'v', verdict: v, failed_dimensions: v === 'FAIL' ? ['x'] : [], fixes: [] })
// F6 exact coverage: the anchor manifest must cover EXACTLY the frozen inputs (research.md included —
// the default responder reports it present). Each digest is a REAL sha256 of distinct known preimage
// bytes (F11 discipline — never a hand-typed sha-shaped constant).
const FROZEN = [`${KILN}/docs/VISION.md`, `${KILN}/docs/architecture.md`, `${KILN}/docs/tech-stack.md`, `${KILN}/docs/arch-constraints.md`, `${KILN}/docs/research.md`]
const ANCHOR_FILES = FROZEN.map((path) => ({ path, sha256: shaBytes(Buffer.from(`fixture:${path}`)) }))
const evidenceManifestHash = (() => { const m = {}; for (const f of ANCHOR_FILES) m[f.path] = f.sha256; return sha256Hex(canonicalJson(m)) })()
// bundle hashes — replicate the workflow's decision-bundle construction EXACTLY so ratify verdicts
// echo the hash validateRatification checks against.
const bundleFor = (planHash) => buildDecisionBundle({ common_trunk: { master_plan_file: masterPlanFile, plan_sha256: planHash, milestones: synthResult.milestones }, settled_decisions: {}, open_divergences: [], renderer_version: 'v301-plato/1', evidence_manifest_hash: evidenceManifestHash }).hash
const PLAN_HASH_1 = shaBytes(Buffer.from('fixture:plan-r1')), PLAN_HASH_2 = shaBytes(Buffer.from('fixture:plan-r2'))
const BUNDLE_1 = bundleFor(PLAN_HASH_1), BUNDLE_2 = bundleFor(PLAN_HASH_2)

const rat = (bundleH, over = {}) => ({ reasoning: 'r', artifact_hash: bundleH, verdict: 'APPROVE', divergence_selections: [], findings: [], changed_evidence: [], ...over })

const t4Args = (extra = {}) => ({ kilnDir: KILN, projectPath: PROJECT, pluginRoot: '/plugin', codexAvailable: true, capabilityTier: 'T4', runToken: RUNTOKEN, planning: 'dual', ...extra })

// makeResponder(cfg) — a label→result mock. Sol legs return envelopes whose receipts derive from the
// leg's payload; the matching cross-checks are AUTO-DERIVED from the same payload + phase tag, so a
// test that overrides a Sol payload gets a coherent invocation-exact ledger for free.
const PHASE_OF = { 'sol:draft': 'DRAFTS', 'sol:ratify:r1': 'RATIFY_1', 'sol:answer': 'ANSWER_EXCHANGE', 'sol:ratify:r2': 'RATIFY_2' }
function makeResponder(cfg = {}) {
  const solPayloads = {
    'sol:draft': cfg.solDraftPayload !== undefined ? cfg.solDraftPayload : solDraftPayload,
    'sol:ratify:r1': cfg.rS1 !== undefined ? cfg.rS1 : rat(BUNDLE_1),
    'sol:answer': cfg.solAnswer !== undefined ? cfg.solAnswer : { answers: [] },
    'sol:ratify:r2': cfg.rS2 !== undefined ? cfg.rS2 : rat(BUNDLE_2),
  }
  return (label) => {
    if (label === 'thoth:research-check') return { reasoning: 'ls', missing: [] }
    if (label === 'numerobis:foundation') return foundation(cfg.scope || 'standard')
    if (label === 'thoth:council-anchor') return cfg.anchor !== undefined ? cfg.anchor : { reasoning: 'a', files: ANCHOR_FILES, initial_ledger_seq: 5 }
    if (label === 'confucius:plan') return planResult('a')
    if (label === 'sun-tzu:plan' || label === 'miyamoto:plan') return planResult('b')
    if (label === 'fable:draft') return cfg.fableDraft !== undefined ? cfg.fableDraft : planResult('a')
    if (label === 'sol:draft') return cfg.solDraft !== undefined ? cfg.solDraft : solEnvelope(solPayloads['sol:draft'])
    if (label === 'sol:ratify:r1') return cfg.sR1 !== undefined ? cfg.sR1 : solEnvelope(solPayloads['sol:ratify:r1'])
    if (label === 'sol:answer') return solEnvelope(solPayloads['sol:answer'])
    if (label === 'sol:ratify:r2') return solEnvelope(solPayloads['sol:ratify:r2'])
    if (label.startsWith('thoth:receipt-check:')) {
      const leg = label.slice('thoth:receipt-check:'.length)
      if (cfg.cross && cfg.cross[leg] !== undefined) return cfg.cross[leg]
      return crossOk(solPayloads[leg], PHASE_OF[leg])
    }
    if (label === 'thoth:seat-hashes') return { plan_a_sha256: 'a1'.repeat(32), plan_b_sha256: 'b2'.repeat(32) }
    if (label === 'diogenes:divergence') return divergenceResult
    if (label === 'plato:synthesis' || label.startsWith('plato:revise')) return synthResult
    if (label.startsWith('athena:validate')) return validateResult(cfg.athena || 'PASS')
    if (label === 'thoth:ratify-anchor:r1') return cfg.anchorR1 !== undefined ? cfg.anchorR1 : { plan_sha256: PLAN_HASH_1 }
    if (label === 'thoth:ratify-anchor:r2') return cfg.anchorR2 !== undefined ? cfg.anchorR2 : { plan_sha256: PLAN_HASH_2 }
    if (label.startsWith('thoth:exec-check:')) return cfg.execCheck ? cfg.execCheck(label) : { finding_id: label.slice('thoth:exec-check:'.length), exit: 0, stdout_tail: '', stderr_tail: '' }
    if (label === 'fable:ratify:r1') return cfg.rF1 !== undefined ? cfg.rF1 : rat(BUNDLE_1)
    if (label === 'fable:answer') return cfg.fableAnswer !== undefined ? cfg.fableAnswer : { answers: [] }
    if (label === 'fable:ratify:r2') return cfg.rF2 !== undefined ? cfg.rF2 : rat(BUNDLE_2)
    if (label === 'thoth:council-ledger') return cfg.ledgerAppend !== undefined ? cfg.ledgerAppend : { appended: true }
    if (label === 'asimov:law') return cfg.asimov !== undefined ? cfg.asimov : null
    if (label === 'numerobis:handoff') return null
    if (label === 'thoth:verify') return { reasoning: 'ok', missing: [] }
    return null
  }
}

// parseCheckpoints — pull every buildCheckpoint `data` payload out of the thoth:council-ledger append
// commands (the kiln-state append JSON rides verbatim in the prompt; skip any quote-mangled one).
const CKPT_KEYS = ['anonymous_seat_artifact_hashes', 'codex_receipt_hash', 'decision_bundle_hash', 'evidence_manifest_hash', 'initial_ledger_seq', 'input_artifact_hashes', 'keystone_id', 'kind', 'phase', 'protocol_version', 'run_token_hash', 'seat_provenance', 'status', 'template_hash']
function parseCheckpoints(calls) {
  const out = []
  for (const c of calls) {
    if (c.label !== 'thoth:council-ledger') continue
    const m = c.prompt.match(/kiln-state\.mjs append \S+ '(.*)'\n/)
    if (!m) continue
    try { out.push(JSON.parse(m[1].replace(/'\\''/g, "'")).data) } catch { /* quote-mangled — skip */ }
  }
  return out
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// v3.0.1 PRESERVATION
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// NOTE (scope ruling item 6): a full-path T4 launch missing its runToken is NO LONGER a v301 route —
// it rules DEGRADED (dedicated test below). Lite and sub-T4 stay v301, token or not.
const v301Cases = [
  ['no capabilityTier', { kilnDir: KILN, projectPath: PROJECT, codexAvailable: false, planning: 'dual' }, 'sub-T4 tier'],
  ['T3 tier', { kilnDir: KILN, projectPath: PROJECT, codexAvailable: true, capabilityTier: 'T3', runToken: RUNTOKEN, planning: 'dual' }, 'sub-T4 tier'],
  ['T4 but codexAvailable:false', { kilnDir: KILN, projectPath: PROJECT, codexAvailable: false, capabilityTier: 'T4', runToken: RUNTOKEN, planning: 'dual' }, 'sub-T4 tier'],
  ['T4 lite path', { kilnDir: KILN, projectPath: PROJECT, codexAvailable: true, capabilityTier: 'T4', runToken: RUNTOKEN, planning: 'single' }, 'lite path'],
  ['T4 lite path, runToken absent', { kilnDir: KILN, projectPath: PROJECT, codexAvailable: true, capabilityTier: 'T4', planning: 'single' }, 'lite path'],
]
for (const [name, args, reason] of v301Cases) {
  test(`v3.0.1 preservation: ${name} ⇒ path:'v301' (${reason}), no council legs`, async () => {
    const { result, calls } = await runWorkflow(ARCHITECTURE, args, makeResponder({ scope: args.planning === 'single' ? 'trivial' : 'standard' }))
    const labels = labelsIn(calls)
    assert.equal(result.council.path, 'v301', 'a non-council route is labeled v301')
    assert.equal(result.council.reason, reason)
    assert.equal(result.council.eligible, false)
    assert.equal(result.council.terminal, null)
    assert.equal(result.council.certificate, null)
    assert.equal(result.council.terminal_record, null)
    assert.deepEqual(result.council.receipts, [])
    for (const l of labels) assert.ok(!/^fable:|^sol:|^thoth:(council-anchor|council-ledger|receipt-check|seat-hashes|ratify-anchor|exec-check)/.test(l), `no council leg on the v301 path (saw ${l})`)
    if (args.planning === 'dual') assert.ok(labels.includes('confucius:plan') && (labels.includes('sun-tzu:plan') || labels.includes('miyamoto:plan')), 'the v3.0.1 anonymized pair runs on the dual v301 path')
  })
}

test('item 6: a FULL-path T4 launch missing runToken ⇒ council DEGRADED (never a silent v301 downgrade), draft still produced, Law blocked', async () => {
  const args = { kilnDir: KILN, projectPath: PROJECT, pluginRoot: '/plugin', codexAvailable: true, capabilityTier: 'T4', planning: 'dual' } // NO runToken
  const { result, calls } = await runWorkflow(ARCHITECTURE, args, makeResponder())
  const labels = labelsIn(calls)
  assert.equal(result.council.path, 'twin_council', 'a PROMISED council is never relabeled v301 by a missing token')
  assert.equal(result.council.eligible, true)
  assert.equal(result.council.reason, 'runToken absent')
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.equal(result.council.terminal_record.missing, 'both')
  assert.match(result.council.blocked_reason, /runToken absent/)
  // the v3.0.1 pair still drafts (a DRAFT plan for the operator) — no council seats ever convene
  assert.ok(labels.includes('confucius:plan') && labels.includes('sun-tzu:plan'), 'the v3.0.1 pair still produces a draft')
  assert.ok(labels.includes('plato:synthesis'), 'a draft master plan is still synthesized')
  assert.ok(!labels.includes('fable:draft') && !labels.includes('sol:draft') && !labels.includes('fable:ratify:r1'), 'no council seat runs without the token')
  // the DEGRADED checkpoint is ledgered with a NULL run_token_hash (no phantom-hash)
  const deg = parseCheckpoints(calls).find((d) => d.phase === 'DEGRADED')
  assert.ok(deg, 'the DEGRADED terminal checkpoint is ledgered')
  assert.equal(deg.run_token_hash, null, 'no token ⇒ run_token_hash null, never a hash of a phantom string')
  // the Law is BLOCKED on the promised path
  assert.equal(result.law_locked, false)
  assert.match(result.law_reason, /not council-ratified \(DEGRADED\)/)
})

test('v3.0.1 preservation: the EXACT ordered v3.0.1 label sequence and the 13 legacy return keys deep-equal their fixtures (F12)', async () => {
  const { result, calls } = await runWorkflow(ARCHITECTURE, { kilnDir: KILN, projectPath: PROJECT, codexAvailable: false, planning: 'dual' }, makeResponder())
  assert.deepEqual(labelsIn(calls), [
    'thoth:research-check', 'numerobis:foundation', 'confucius:plan', 'miyamoto:plan',
    'diogenes:divergence', 'plato:synthesis', 'athena:validate:r0', 'asimov:law',
    'numerobis:handoff', 'thoth:verify',
  ], 'the v3.0.1 call flow is byte-identical — exact labels, exact order, nothing extra')
  const { council, ...legacy } = result
  assert.deepEqual(legacy, {
    master_plan_file: masterPlanFile,
    milestone_count: 1,
    validation: 'PASS',
    failed_dimensions: [],
    has_visual_direction: false,
    scope: 'standard',
    lite_path: false,
    surfaces: [{ id: 'M1', surface: 'logic' }],
    law_locked: false,
    law_reason: 'Asimov produced no check manifest',
    law_file: `${KILN}/law.json`,
    law_check_count: 0,
    missing: [],
  }, 'the 13 legacy return keys carry their exact v3.0.1 values')
  assert.equal(council.path, 'v301')
})

test('v3.0.1 preservation: existing return keys are unchanged and council is the ONE additive field', async () => {
  const { result } = await runWorkflow(ARCHITECTURE, { kilnDir: KILN, projectPath: PROJECT, codexAvailable: false, planning: 'dual' }, makeResponder())
  for (const k of ['master_plan_file', 'milestone_count', 'validation', 'failed_dimensions', 'has_visual_direction', 'scope', 'lite_path', 'surfaces', 'law_locked', 'law_reason', 'law_file', 'law_check_count', 'missing', 'council']) {
    assert.ok(Object.prototype.hasOwnProperty.call(result, k), `return has ${k}`)
  }
  assert.equal(Object.keys(result).length, 14, 'exactly the 13 v3.0.1 keys + council')
})

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// T4 CLEAN RATIFICATION
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('T4 clean: fable:draft + sol:draft replace the planners; twin ratification seals a certificate', async () => {
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder())
  const labels = labelsIn(calls)
  assert.ok(labels.includes('fable:draft') && labels.includes('sol:draft'), 'the T4 draft pair replaces the planners')
  assert.ok(!labels.includes('confucius:plan') && !labels.includes('sun-tzu:plan') && !labels.includes('miyamoto:plan'), 'the v3.0.1 planners do NOT run on the council path')
  assert.ok(labels.includes('thoth:receipt-check:sol:draft'), 'the draft Sol cross-check fires')
  assert.ok(labels.includes('fable:ratify:r1') && labels.includes('sol:ratify:r1') && labels.includes('thoth:receipt-check:sol:ratify:r1'), 'the blind ratify pair + its cross-check fire')
  assert.equal(result.council.path, 'twin_council')
  assert.equal(result.council.eligible, true)
  assert.equal(result.council.tier, 'T4')
  assert.equal(result.council.reason, null)
  assert.equal(result.council.terminal, 'RATIFIED')
  assert.equal(result.council.terminal_record, null, 'RATIFIED carries no degraded/deadlock record — the certificate IS the record')
  const cert = result.council.certificate
  assert.ok(cert && cert.label === 'twin_ratified', 'the certificate is a twin_ratified label')
  assert.equal(cert.signatures.length, 2)
  assert.notEqual(canonicalJson(cert.signatures[0].seat_provenance), canonicalJson(cert.signatures[1].seat_provenance), 'the two signatures carry DISTINCT seat provenance')
  assert.equal(cert.artifact_hash, BUNDLE_1, 'the certificate binds the decision-bundle hash the script derived')
  assert.equal(cert.plan_hash, PLAN_HASH_1)
  const ckpts = parseCheckpoints(calls)
  const phases = ckpts.map((d) => d.phase)
  for (const p of ['DRAFTS_SEALED', 'RATIFY_1_SEALED', 'RATIFIED']) assert.ok(phases.includes(p), `${p} checkpoint ledgered`)
  for (const d of ckpts) {
    assert.equal(d.kind, 'council_state')
    assert.deepEqual(Object.keys(d).sort(), CKPT_KEYS, 'buildCheckpoint emits its exact field list')
    assert.equal(d.protocol_version, COUNCIL_PROTOCOL_VERSION)
  }
  assert.equal(result.council.checkpoints, countLabel(calls, 'thoth:council-ledger'), 'every confirmed append is counted')
  assert.ok(result.council.checkpoints >= 3)
  // receipts: every Sol leg carries a ledger-verified receipt row, invocation-exact
  const draftRec = result.council.receipts.find((r) => r.leg === 'sol:draft')
  assert.ok(draftRec && draftRec.receipt_verified === true && draftRec.ledger_verified === true, 'sol:draft receipt is ledger-verified')
  assert.equal(draftRec.invocation_id, INV)
  assert.ok(result.council.receipts.find((r) => r.leg === 'sol:ratify:r1' && r.ledger_verified === true), 'sol:ratify:r1 receipt is ledger-verified')
  assert.ok(labels.includes('asimov:law'), 'the Law compilation runs behind a valid certificate')
})

test('T4 checkpoint accounting (F10): unconfirmed appends are NOT counted', async () => {
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ ledgerAppend: null }))
  assert.equal(result.council.terminal, 'RATIFIED', 'a mute scribe never fails the stage')
  assert.ok(countLabel(calls, 'thoth:council-ledger') >= 3, 'the append legs were attempted')
  assert.equal(result.council.checkpoints, 0, 'a mute/unconfirmed append is never counted')
})

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// BLINDNESS RAILS — clean round + the full exchange/r2 legs (F12)
// ══════════════════════════════════════════════════════════════════════════════════════════════════
const blockFinding = { finding_id: 'F-001-P1-001', claim: 'milestone M1 hides an unbounded unknown', required_change: 'split M1 into two verifiable slices', evidence_refs: ['master-plan.md'], evidence_class: 'scenario', executable_check: null }
const solBlockFinding = { finding_id: 'F-010-P0-001', claim: 'a decision violates the constraints', required_change: 'align M1 with the constraint doc', evidence_refs: ['arch-constraints.md'], evidence_class: 'repo_state', executable_check: null }

test('T4 blindness: fable prompts hide codex/receipt/session and the run token; sol prompts hide the peer; the seed never leaves the script', async () => {
  // both heads BLOCK so every exchange/r2 leg runs — the blindness rails must hold on ALL of them (F12)
  const cfg = {
    rF1: rat(BUNDLE_1, { verdict: 'BLOCK', findings: [blockFinding] }),
    rS1: rat(BUNDLE_1, { verdict: 'BLOCK', findings: [solBlockFinding] }),
    solAnswer: { answers: [{ finding_id: blockFinding.finding_id, answer: 'REFUTE', evidence_refs: ['x'] }] },
    fableAnswer: { answers: [{ finding_id: solBlockFinding.finding_id, answer: 'REFUTE', evidence_refs: ['y'] }] },
    rF2: rat(BUNDLE_2, { verdict: 'BLOCK', findings: [blockFinding] }),
    rS2: rat(BUNDLE_2, { verdict: 'BLOCK', findings: [solBlockFinding] }),
  }
  const { calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  for (const lbl of ['fable:draft', 'fable:ratify:r1', 'fable:answer', 'fable:ratify:r2']) {
    const p = promptOf(calls, lbl)
    assert.ok(p, `${lbl} ran`)
    assert.doesNotMatch(p, /codex/i, `${lbl} never mentions codex`)
    assert.doesNotMatch(p, /receipt/i, `${lbl} never mentions receipt`)
    assert.doesNotMatch(p, /session/i, `${lbl} never mentions session`)
    assert.ok(!p.includes(RUNTOKEN), `${lbl} never carries the raw run token`)
  }
  // the sol WRAPPER prompt never names the peer (fable); the RAW run token rides ONLY the receipt-script
  // argv (a trusted process boundary, brief §c), so it is EXPECTED in the wrapper and not asserted absent.
  for (const lbl of ['sol:draft', 'sol:ratify:r1', 'sol:answer', 'sol:ratify:r2']) {
    const p = promptOf(calls, lbl)
    assert.ok(p, `${lbl} ran`)
    assert.doesNotMatch(p, /\bfable\b/i, `${lbl} never names the peer seat`)
    assert.ok(p.includes(RUNTOKEN), `${lbl} carries the run token in the receipt-script argv (the trusted boundary)`)
    assert.ok(p.includes('kiln-codex-receipt.mjs'), `${lbl} runs the receipt transport`)
  }
  // F7 exchange evidence reaches BOTH round-two heads, still blind
  assert.match(promptOf(calls, 'fable:ratify:r2'), /<exchange-evidence>/, 'the fable r2 prompt carries the exchange-evidence block')
  assert.match(promptOf(calls, 'fable:ratify:r2'), /other_head_answer/, 'the fable r2 exchange carries the peer answer, attributed only as the other head')
  assert.match(promptOf(calls, 'sol:ratify:r2'), /"exchange":\{/, 'the sol r2 packet carries the exchange field')
  // the seed digest never appears in ANY prompt (source rail: no line naming it carries a template-
  // literal backtick, which every agent prompt uses).
  const src = readFileSync(ARCH_SRC, 'utf8')
  const seedLines = src.split('\n').filter((l) => l.includes('councilSeedDigest') && !l.trim().startsWith('//'))
  assert.ok(seedLines.length >= 2, 'councilSeedDigest is declared + assigned')
  for (const l of seedLines) assert.ok(!l.includes('`'), 'councilSeedDigest is NEVER interpolated into a prompt template literal')
})

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// BLOCK → exchange → re-verdict → the anti-capitulation rail (both origins — F12)
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('T4 FABLE-origin BLOCK→exchange→re-verdict: a re-approve WITH changed_evidence seals over the AMENDED bundle (+ F10 exchange checkpoint)', async () => {
  const solAnswerPayload = { answers: [{ finding_id: blockFinding.finding_id, answer: 'ACCEPT', evidence_refs: ['ok'] }] }
  const cfg = {
    rF1: rat(BUNDLE_1, { verdict: 'BLOCK', findings: [blockFinding] }),
    solAnswer: solAnswerPayload,
    rF2: rat(BUNDLE_2, { changed_evidence: [{ class: 'scenario', refs: ['re-ran the risk model'] }] }),
  }
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  const labels = labelsIn(calls)
  assert.ok(labels.includes('sol:answer'), 'the OTHER head (Sol) answers fable\'s blocking finding')
  assert.ok(labels.includes('thoth:receipt-check:sol:answer'), 'the answer leg is receipt cross-checked')
  assert.ok(labels.some((l) => l.startsWith('plato:revise:council')), 'the accepted change drives one plato revision')
  assert.ok(labels.includes('thoth:ratify-anchor:r2'), 'the amended plan is re-hashed by the second anchor')
  assert.ok(labels.includes('fable:ratify:r2') && labels.includes('sol:ratify:r2'), 'a blind re-verdict runs')
  assert.equal(result.council.terminal, 'RATIFIED')
  assert.equal(result.council.certificate.artifact_hash, BUNDLE_2, 'the certificate binds the AMENDED bundle hash')
  assert.equal(result.council.certificate.plan_hash, PLAN_HASH_2)
  // F10: ANSWER_EXCHANGE_SEALED carries the paired answer artifacts + the Sol answer receipt hash
  const ex = parseCheckpoints(calls).find((d) => d.phase === 'ANSWER_EXCHANGE_SEALED')
  assert.ok(ex, 'ANSWER_EXCHANGE_SEALED is ledgered')
  assert.equal(ex.anonymous_seat_artifact_hashes.P0, sha256Hex(canonicalJson({ answers: [] })), 'P0 = the (empty) fable answer set, hashed honestly')
  assert.equal(ex.anonymous_seat_artifact_hashes.P1, sha256Hex(canonicalJson(solAnswerPayload)), 'P1 = the sol answer payload hash')
  assert.equal(ex.codex_receipt_hash, rshaOf(validReceipt(solAnswerPayload)), 'the Sol answer leg\'s LEDGER receipt hash rides the checkpoint')
  assert.equal(ex.seat_provenance.P1.head, 'sol', 'the sol answer-leg provenance rides the checkpoint')
  // item 3 (scope ruling): the exchange barrier is bound to bundle₁ — the artifact the answers were
  // RENDERED AGAINST — and seals BEFORE Plato consumes the answers and before the rehash.
  assert.equal(ex.decision_bundle_hash, BUNDLE_1, 'ANSWER_EXCHANGE_SEALED binds the PRE-amendment bundle hash')
  const sealIdx = calls.findIndex((c) => c.label === 'thoth:council-ledger' && c.prompt.includes('ANSWER_EXCHANGE_SEALED'))
  const reviseIdx = calls.findIndex((c) => c.label === 'plato:revise:council')
  const rehashIdx = calls.findIndex((c) => c.label === 'thoth:ratify-anchor:r2')
  assert.ok(sealIdx !== -1 && reviseIdx !== -1 && rehashIdx !== -1, 'all three legs ran')
  assert.ok(sealIdx < reviseIdx && sealIdx < rehashIdx, 'the exchange seals BEFORE the plato revision and BEFORE the rehash')
})

test('T4 SOL-origin BLOCK→exchange→re-verdict: fable answers; sol\'s re-approve WITH changed_evidence ratifies (F12)', async () => {
  const cfg = {
    rS1: rat(BUNDLE_1, { verdict: 'BLOCK', findings: [solBlockFinding] }),
    fableAnswer: { answers: [{ finding_id: solBlockFinding.finding_id, answer: 'ACCEPT', evidence_refs: ['ok'] }] },
    rS2: rat(BUNDLE_2, { changed_evidence: [{ class: 'repo_state', refs: ['constraint aligned'] }] }),
  }
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.ok(labelsIn(calls).includes('fable:answer'), 'the OTHER head (Fable) answers sol\'s blocking finding')
  assert.ok(!labelsIn(calls).includes('sol:answer'), 'no sol answer leg when fable raised nothing')
  assert.equal(result.council.terminal, 'RATIFIED')
  assert.equal(result.council.certificate.artifact_hash, BUNDLE_2)
})

test('T4 anti-capitulation (fable origin): a re-approve WITHOUT changed_evidence ⇒ COUNCIL_DEADLOCK, RATIFY_2_SEALED first, Law blocked', async () => {
  const cfg = {
    rF1: rat(BUNDLE_1, { verdict: 'BLOCK', findings: [blockFinding] }),
    solAnswer: { answers: [{ finding_id: blockFinding.finding_id, answer: 'REFUTE', evidence_refs: ['nope'] }] },
    rF2: rat(BUNDLE_2), // fable APPROVES but carries NO changed_evidence — the prior block STANDS
  }
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.equal(result.council.terminal, 'COUNCIL_DEADLOCK')
  assert.equal(result.council.certificate, null, 'no certificate on a deadlock')
  // F10: round two is a completed paired barrier — sealed BEFORE the deadlock terminal
  const phases = parseCheckpoints(calls).map((d) => d.phase)
  assert.ok(phases.includes('RATIFY_2_SEALED'), 'RATIFY_2_SEALED is ledgered on the deadlock path')
  assert.ok(phases.indexOf('RATIFY_2_SEALED') < phases.indexOf('COUNCIL_DEADLOCK'), 'RATIFY_2_SEALED lands BEFORE the COUNCIL_DEADLOCK terminal')
  // F10: the structured deadlock record (the cards) is RETAINED
  assert.ok(result.council.terminal_record && result.council.terminal_record.label === 'council_deadlock', 'the councilDeadlock record is retained')
  assert.ok(result.council.terminal_record.divergences.length >= 1, 'the disagreement cards ride the record')
  assert.equal(result.law_locked, false)
  assert.match(result.law_reason, /not council-ratified \(COUNCIL_DEADLOCK\)/)
})

test('T4 anti-capitulation (sol origin): sol\'s re-approve WITHOUT changed_evidence ⇒ COUNCIL_DEADLOCK (F12)', async () => {
  const cfg = {
    rS1: rat(BUNDLE_1, { verdict: 'BLOCK', findings: [solBlockFinding] }),
    fableAnswer: { answers: [{ finding_id: solBlockFinding.finding_id, answer: 'REFUTE', evidence_refs: ['no'] }] },
    rS2: rat(BUNDLE_2), // sol APPROVES without changed_evidence — its own block stands
  }
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.equal(result.council.terminal, 'COUNCIL_DEADLOCK')
  assert.equal(result.council.certificate, null)
})

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// F2 — empty / duplicate / evidence-free BLOCK verdicts are INVALID (⇒ DEGRADED)
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('T4 F2: an empty BLOCK is an invalid verdict ⇒ DEGRADED (a standing-free block can never be approved past)', async () => {
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ rF1: rat(BUNDLE_1, { verdict: 'BLOCK' }) }))
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.equal(result.council.terminal_record.missing, 'fable')
  assert.match(result.council.blocked_reason, /no findings/)
})

test('T4 F2: duplicate finding ids within one verdict ⇒ DEGRADED', async () => {
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ rF1: rat(BUNDLE_1, { verdict: 'BLOCK', findings: [blockFinding, blockFinding] }) }))
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.match(result.council.blocked_reason, /duplicate finding_id/)
})

test('T4 F2: an evidence-free finding (no refs, no check) invalidates the verdict ⇒ DEGRADED', async () => {
  const bare = { ...blockFinding, evidence_refs: [], executable_check: null }
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ rF1: rat(BUNDLE_1, { verdict: 'BLOCK', findings: [bare] }) }))
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.match(result.council.blocked_reason, /evidence-free/)
})

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// F4 — seat-scoped finding identity: a same-string id across heads never aliases
// ══════════════════════════════════════════════════════════════════════════════════════════════════
const checkedFinding = { finding_id: 'F-002-P0-001', claim: 'the CLI check is broken', required_change: 'fix it', evidence_refs: [], evidence_class: 'proposed_check', executable_check: 'test -f /nope' }

test('T4 F4: fable\'s refuted check does NOT retire sol\'s same-id finding — the unreversed sol block still deadlocks', async () => {
  const solSameId = { finding_id: 'F-002-P0-001', claim: 'a DIFFERENT defect under the same id', required_change: 'fix the other thing', evidence_refs: ['doc'], evidence_class: 'scenario', executable_check: null }
  const cfg = {
    rF1: rat(BUNDLE_1, { verdict: 'BLOCK', findings: [checkedFinding] }),
    rS1: rat(BUNDLE_1, { verdict: 'BLOCK', findings: [solSameId] }),
    execCheck: () => ({ finding_id: 'F-002-P0-001', exit: 1, stdout_tail: '', stderr_tail: 'nope' }), // refutes FABLE's finding only
    fableAnswer: { answers: [{ finding_id: 'F-002-P0-001', answer: 'REFUTE', evidence_refs: ['z'] }] }, // fable answers SOL's finding
    rF2: rat(BUNDLE_2),
    rS2: rat(BUNDLE_2), // sol approves WITHOUT changed_evidence — under aliasing this would ratify
  }
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.ok(!labelsIn(calls).includes('sol:answer'), 'fable\'s check-refuted finding never enters the exchange')
  assert.ok(labelsIn(calls).includes('fable:answer'), 'sol\'s same-id finding is NOT retired — fable must answer it')
  assert.equal(result.council.terminal, 'COUNCIL_DEADLOCK', 'sol\'s unreversed standing block deadlocks — no cross-head aliasing')
})

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// EXECUTABLE-CHECK FLOOR (F9 semantics)
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('T4 exec-check floor: a nonzero id-matched exit REFUTES the finding (retired mechanically); the runner is file-bound', async () => {
  const cfg = {
    rF1: rat(BUNDLE_1, { verdict: 'BLOCK', findings: [checkedFinding] }),
    execCheck: () => ({ finding_id: 'F-002-P0-001', exit: 1, stdout_tail: '', stderr_tail: 'not found' }),
    rF2: rat(BUNDLE_2),
  }
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  const labels = labelsIn(calls)
  assert.ok(labels.includes('thoth:exec-check:F-002-P0-001'), 'the bounded executor runs the proposed check')
  // F9: the check text is written VERBATIM to a script file and ONE timeout wraps the whole file
  const runnerPrompt = promptOf(calls, 'thoth:exec-check:F-002-P0-001')
  assert.match(runnerPrompt, /WRITE the check text/, 'the runner writes the check to a file first')
  assert.match(runnerPrompt, /timeout 120 bash /, 'one timeout boundary wraps the WHOLE check file — compounds included')
  assert.ok(!labels.includes('sol:answer'), 'a check-refuted finding never enters the answer exchange')
  assert.equal(result.council.terminal, 'RATIFIED')
})

test('T4 exec-check floor: exit 0 CONFIRMS the finding — it stands as executed_check into RATIFY_2 (typed exchange evidence, no tails)', async () => {
  const cfg = {
    rF1: rat(BUNDLE_1, { verdict: 'BLOCK', findings: [checkedFinding] }),
    execCheck: () => ({ finding_id: 'F-002-P0-001', exit: 0, stdout_tail: 'SECRET-STDOUT-TAIL', stderr_tail: 'SECRET-STDERR-TAIL' }),
    solAnswer: { answers: [{ finding_id: 'F-002-P0-001', answer: 'REFUTE', evidence_refs: ['disagree'] }] },
    rF2: rat(BUNDLE_2), // approve without changed_evidence — the CONFIRMED (executed_check) block stands
  }
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.ok(labelsIn(calls).includes('sol:answer'), 'a confirmed finding is answered by the OTHER head')
  assert.equal(result.council.terminal, 'COUNCIL_DEADLOCK', 'a confirmed block not reversed with evidence deadlocks')
  // item 5 (scope ruling): the round-two head sees its OWN finding (claim/required_change/refs/class),
  // the peer's answer, and the TYPED check state (state + exit code ONLY) — raw tails NEVER enter any
  // head prompt (they stay on disk / in the runner leg's transcript).
  const fr2 = promptOf(calls, 'fable:ratify:r2')
  assert.match(fr2, /"claim":"the CLI check is broken"/, 'the head sees its OWN finding claim')
  assert.match(fr2, /"required_change":"fix it"/, 'the head sees its own required_change')
  assert.match(fr2, /"evidence_class"/, 'the head sees its declared evidence class')
  assert.match(fr2, /"state":"confirmed"/, 'the TYPED check state rides the exchange')
  assert.match(fr2, /"exit":0/, 'the check exit code rides the exchange')
  for (const lbl of ['fable:ratify:r2', 'sol:ratify:r2', 'fable:answer', 'sol:answer']) {
    const p = promptOf(calls, lbl)
    if (!p) continue
    assert.ok(!p.includes('SECRET-STDOUT-TAIL') && !p.includes('SECRET-STDERR-TAIL'), `${lbl} never carries raw check tails`)
    assert.ok(!p.includes('stdout_tail') && !p.includes('stderr_tail'), `${lbl} carries no tail fields at all`)
  }
})

test('item 2: infra exits 124/126/127 ⇒ UNRUN — the finding STANDS as proposed_check (never refuted, never executed)', async () => {
  for (const infraExit of [124, 126, 127]) {
    const cfg = {
      rF1: rat(BUNDLE_1, { verdict: 'BLOCK', findings: [checkedFinding] }),
      execCheck: () => ({ finding_id: 'F-002-P0-001', exit: infraExit, stdout_tail: '', stderr_tail: '' }),
      solAnswer: { answers: [{ finding_id: 'F-002-P0-001', answer: 'REFUTE', evidence_refs: ['x'] }] },
      rF2: rat(BUNDLE_2), // approve without changed_evidence — the standing proposed_check block deadlocks
    }
    const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
    assert.ok(labelsIn(calls).includes('sol:answer'), `exit ${infraExit} retired NOTHING — the finding enters the exchange`)
    assert.equal(result.council.terminal, 'COUNCIL_DEADLOCK', `exit ${infraExit} leaves the block standing (unrun ⇒ proposed_check) — deadlock when unreversed`)
    // the TYPED state reaches the round-two head: unrun + the infra exit code
    assert.match(promptOf(calls, 'fable:ratify:r2'), /"state":"unrun"/, `exit ${infraExit} is typed unrun for the head`)
    assert.match(promptOf(calls, 'fable:ratify:r2'), new RegExp(`"exit":${infraExit}`), 'the infra exit code is visible')
  }
})

test('item 2: a clean nonzero exit (not 124/126/127) still REFUTES mechanically', async () => {
  const cfg = {
    rF1: rat(BUNDLE_1, { verdict: 'BLOCK', findings: [checkedFinding] }),
    execCheck: () => ({ finding_id: 'F-002-P0-001', exit: 3, stdout_tail: '', stderr_tail: '' }),
    rF2: rat(BUNDLE_2),
  }
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.ok(!labelsIn(calls).includes('sol:answer'), 'a check-refuted finding never enters the exchange')
  assert.equal(result.council.terminal, 'RATIFIED')
})

test('item 1: a garbled ledger receipt_sha256 (a promoted field) fails the cross-check ⇒ DEGRADED', async () => {
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ cross: { 'sol:draft': crossOk(solDraftPayload, 'DRAFTS', { verified: { receipt_sha256: 'not-a-hash' } }) } }))
  assert.equal(result.council.terminal, 'DEGRADED', 'a ledger-promoted field is shape-validated before promotion')
})

test('item 4: every path argument in the pinned commands is shell-quoted (cross-check, runner, extractor)', async () => {
  const cfg = {
    rF1: rat(BUNDLE_1, { verdict: 'BLOCK', findings: [checkedFinding] }),
    execCheck: () => ({ finding_id: 'F-002-P0-001', exit: 3, stdout_tail: '', stderr_tail: '' }),
    rF2: rat(BUNDLE_2),
  }
  const { calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  const OUT = `${KILN}/council/master_plan/DRAFTS-sol-a1.out`
  const cross = promptOf(calls, 'thoth:receipt-check:sol:draft')
  assert.ok(cross.includes(`sha256sum "${OUT}"`), 'the sha256sum path is quoted')
  assert.ok(cross.includes(`"${OUT}"`), 'the canonical-hash one-liner path is quoted')
  assert.ok(cross.includes(`"${KILN}/council/receipts.jsonl"`), 'the ledger path is quoted')
  const runner = promptOf(calls, 'thoth:exec-check:F-002-P0-001')
  assert.ok(runner.includes(`cd "${PROJECT}" && timeout 120 bash "`), 'the runner cd + check-file paths are quoted')
  assert.ok(runner.includes(`mkdir -p "${KILN}/council/master_plan"`), 'the runner mkdir path is quoted')
  const wrapper = promptOf(calls, 'sol:draft')
  assert.ok(wrapper.includes(`"${OUT}" "${KILN}/plans/plan-b.md"`), 'the extractor paths are quoted')
})

test('T4 F9: an id-MISMATCHED executor transcript leaves the finding standing as proposed_check (never refuted, never executed)', async () => {
  const cfg = {
    rF1: rat(BUNDLE_1, { verdict: 'BLOCK', findings: [checkedFinding] }),
    execCheck: () => ({ finding_id: 'WRONG-ID', exit: 1, stdout_tail: '', stderr_tail: '' }), // garbled transcript
    solAnswer: { answers: [{ finding_id: 'F-002-P0-001', answer: 'REFUTE', evidence_refs: ['x'] }] },
    rF2: rat(BUNDLE_2), // approve without changed_evidence — the standing proposed_check block deadlocks
  }
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.ok(labelsIn(calls).includes('sol:answer'), 'the id-mismatched check retired NOTHING — the finding enters the exchange')
  assert.equal(result.council.terminal, 'COUNCIL_DEADLOCK', 'the standing block (proposed_check) is observable as deadlock when unreversed')
})

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// F8 — relationally-validated answer sets
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('T4 F8: a schema-valid-but-EMPTY answer set is a failed exchange duty ⇒ DEGRADED naming the answering head', async () => {
  const cfg = {
    rF1: rat(BUNDLE_1, { verdict: 'BLOCK', findings: [blockFinding] }),
    solAnswer: { answers: [] }, // sol fails its duty
  }
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.equal(result.council.terminal_record.missing, 'sol')
  assert.match(result.council.blocked_reason, /unanswered/)
})

test('T4 F8: an evidence-free REFUTE answer ⇒ DEGRADED naming the answering head', async () => {
  const cfg = {
    rS1: rat(BUNDLE_1, { verdict: 'BLOCK', findings: [solBlockFinding] }),
    fableAnswer: { answers: [{ finding_id: solBlockFinding.finding_id, answer: 'REFUTE', evidence_refs: [] }] },
  }
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.equal(result.council.terminal_record.missing, 'fable')
  assert.match(result.council.blocked_reason, /carries no evidence/)
})

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// PERSISTENT SPLIT / DUAL NEITHER
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('T4 dual NEITHER at RATIFY_1 survives to RATIFY_2 ⇒ COUNCIL_DEADLOCK, stage still returns, Law blocked', async () => {
  const nF = { verdict: 'NEITHER', findings: [{ finding_id: 'F-003-P0-001', claim: 'both readings are defective', required_change: 'redesign', evidence_refs: ['vision'], evidence_class: 'scenario', executable_check: null }] }
  const cfg = {
    rF1: rat(BUNDLE_1, nF),
    rS1: rat(BUNDLE_1, nF),
    fableAnswer: { answers: [{ finding_id: 'F-003-P0-001', answer: 'REFUTE', evidence_refs: ['x'] }] },
    solAnswer: { answers: [{ finding_id: 'F-003-P0-001', answer: 'REFUTE', evidence_refs: ['y'] }] },
    rF2: rat(BUNDLE_2, nF),
    rS2: rat(BUNDLE_2, nF),
  }
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.equal(result.council.terminal, 'COUNCIL_DEADLOCK')
  assert.equal(result.council.certificate, null)
  assert.equal(result.law_locked, false)
  assert.match(result.law_reason, /not council-ratified \(COUNCIL_DEADLOCK\)/)
  assert.ok(typeof result.master_plan_file === 'string', 'the stage still returns a plan file')
})

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// DEAD SEATS — Sol at draft/ratify; FABLE at draft (F13 symmetry) and at ratify (F12)
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('T4 dead Sol seat at DRAFT (invalid receipt) ⇒ DEGRADED, a draft plan still produced from Fable, Law blocked', async () => {
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ solDraft: solEnvelope(solDraftPayload, { reported_model: 'gpt-5.5' }) }))
  const labels = labelsIn(calls)
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.equal(result.council.terminal_record.missing, 'sol')
  assert.equal(result.council.certificate, null)
  assert.ok(labels.includes('plato:synthesis'), 'the surviving head still seeds a draft master plan')
  assert.match(promptOf(calls, 'plato:synthesis'), /plan-a\.md/, 'the Fable survivor seeds the draft')
  assert.ok(!labels.includes('fable:ratify:r1'), 'ratification never runs after a draft-death degrade')
  const rec = result.council.receipts.find((r) => r.leg === 'sol:draft')
  assert.ok(rec && rec.receipt_verified === false && rec.ledger_verified === false, 'the dead Sol draft is recorded receipt_verified:false')
  assert.equal(result.law_locked, false)
  assert.match(result.law_reason, /not council-ratified \(DEGRADED\)/)
})

test('T4 F13 draft-death symmetry: dead FABLE + fully-verified Sol ⇒ DEGRADED, the ATTESTED plan-b survives into the single-plan draft', async () => {
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ fableDraft: null }))
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.equal(result.council.terminal_record.missing, 'fable')
  assert.ok(!labelsIn(calls).includes('fable:ratify:r1'), 'ratification never runs after a draft-death degrade')
  // the verified Sol plan-b shim survives — the single-plan synthesis reads plan-b.md
  assert.match(promptOf(calls, 'plato:synthesis'), /plan-b\.md/, 'the attested Sol survivor seeds the draft')
  const rec = result.council.receipts.find((r) => r.leg === 'sol:draft')
  assert.ok(rec && rec.ledger_verified === true, 'the surviving Sol seat was fully ledger-verified')
  assert.equal(result.law_locked, false, 'a promised head died — the Law still blocks')
})

test('T4 dead Sol seat at RATIFY (invalid receipt) ⇒ DEGRADED, Law blocked, never a sonnet stand-in', async () => {
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ sR1: solEnvelope(rat(BUNDLE_1), { reported_model: 'gpt-5.5' }) }))
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.equal(result.council.certificate, null)
  assert.ok(labelsIn(calls).includes('fable:ratify:r1'), 'the ratify pair was attempted')
  const rec = result.council.receipts.find((r) => r.leg === 'sol:ratify:r1')
  assert.ok(rec && rec.receipt_verified === false, 'the dead Sol ratify seat is receipt_verified:false')
  assert.equal(result.law_locked, false)
  assert.match(result.law_reason, /not council-ratified \(DEGRADED\)/)
})

test('T4 dead FABLE seat at RATIFY ⇒ DEGRADED missing fable (F12)', async () => {
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ rF1: null }))
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.equal(result.council.terminal_record.missing, 'fable')
  assert.equal(countLabel(calls, 'fable:ratify:r1'), 1, 'the required fable seat dies without re-dispatch (twoHeads:required)')
  assert.equal(result.law_locked, false)
})

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// F3 — anchors: a mute/invalid FIRST or SECOND anchor degrades; never a stale hash
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('T4 F3: a mute FIRST ratify-anchor ⇒ DEGRADED (never a guessed hash)', async () => {
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ anchorR1: null }))
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.match(result.council.blocked_reason, /no valid plan hash/)
  assert.ok(!labelsIn(calls).includes('fable:ratify:r1'), 'no verdict is solicited without a bound plan hash')
})

test('T4 F3: a mute SECOND (post-revision) anchor ⇒ DEGRADED — the stale pre-revision hash is NEVER reused', async () => {
  const cfg = {
    rF1: rat(BUNDLE_1, { verdict: 'BLOCK', findings: [blockFinding] }),
    solAnswer: { answers: [{ finding_id: blockFinding.finding_id, answer: 'ACCEPT', evidence_refs: ['ok'] }] },
    anchorR2: { plan_sha256: 'not-a-hash' },
  }
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.match(result.council.blocked_reason, /never binding the stale pre-revision hash/)
  assert.equal(result.council.certificate, null, 'no certificate can bind a stale hash')
  assert.ok(!labelsIn(calls).includes('fable:ratify:r2'), 'no re-verdict without a valid amended-plan hash')
})

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// F1 — invocation-exact cross-check mismatches; mute cross-check re-dispatch
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('T4 F1: a replayed stale row (right shape, WRONG phase) ⇒ DEGRADED', async () => {
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ cross: { 'sol:draft': crossOk(solDraftPayload, 'DRAFTS', { reservation: { phase: 'RATIFY_1' } }) } }))
  assert.equal(result.council.terminal, 'DEGRADED', 'a reservation bound to another phase can never bless this leg')
})

test('T4 F1: a garbled verified invocation_id ⇒ DEGRADED', async () => {
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ cross: { 'sol:draft': crossOk(solDraftPayload, 'DRAFTS', { verified: { invocation_id: 'zz'.repeat(32) } }) } }))
  assert.equal(result.council.terminal, 'DEGRADED', 'a non-hex invocation id fails the 64-hex floor')
})

test('T4 F1: a reservation/verified invocation-id mismatch ⇒ DEGRADED', async () => {
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ cross: { 'sol:draft': crossOk(solDraftPayload, 'DRAFTS', { reservation: { invocation_id: 'a'.repeat(64) } }) } }))
  assert.equal(result.council.terminal, 'DEGRADED', 'the verified row must trace to ITS OWN reservation')
})

test('T4 F1: a wrong run_token in the reservation ⇒ DEGRADED (the receipt binds THIS run)', async () => {
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ cross: { 'sol:draft': crossOk(solDraftPayload, 'DRAFTS', { reservation: { run_token: 'OTHER-RUN' } }) } }))
  assert.equal(result.council.terminal, 'DEGRADED')
})

test('T4 cross-check mismatch: wrong ledger output_sha256 ⇒ DEGRADED; payload-integrity break ⇒ DEGRADED', async () => {
  const wrongOut = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ cross: { 'sol:draft': crossOk(solDraftPayload, 'DRAFTS', { verified: { output_sha256: '9'.repeat(64) } }) } }))
  assert.equal(wrongOut.result.council.terminal, 'DEGRADED', 'a ledger that disagrees with the relayed receipt is a dead Sol seat')
  const wrongCanon = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ cross: { 'sol:draft': crossOk(solDraftPayload, 'DRAFTS', { canon: '0'.repeat(64) }) } }))
  assert.equal(wrongCanon.result.council.terminal, 'DEGRADED', 'a payload whose canonical hash mismatches is a dead Sol seat')
})

test('T4 F12: a mute cross-check leg gets exactly ONE re-dispatch (two calls), then DEGRADED', async () => {
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ cross: { 'sol:draft': null } }))
  assert.equal(countLabel(calls, 'thoth:receipt-check:sol:draft'), 2, 'exactly two dispatches — one re-dispatch, then fail closed')
  assert.equal(result.council.terminal, 'DEGRADED')
})

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// Invalid ratification / anchor coverage
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('T4 F12: a wrong artifact_hash echo is an invalid ratification ⇒ DEGRADED', async () => {
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ rF1: rat('0'.repeat(64)) }))
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.equal(result.council.terminal_record.missing, 'fable')
  assert.match(result.council.blocked_reason, /invalid ratification at RATIFY_1/)
})

test('T4 F6: a PARTIAL/extra/bad-digest evidence anchor ⇒ DEGRADED — never a certificate missing VISION/constraints', async () => {
  const partial = { reasoning: 'a', files: ANCHOR_FILES.slice(1), initial_ledger_seq: 5 } // VISION dropped
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ anchor: partial }))
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.match(result.council.blocked_reason, /exact evidence manifest/)
  const extra = { reasoning: 'a', files: [...ANCHOR_FILES, { path: '/tmp/extra.md', sha256: 'f'.repeat(64) }], initial_ledger_seq: 5 }
  const r2 = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ anchor: extra }))
  assert.equal(r2.result.council.terminal, 'DEGRADED', 'an extra path is not exact coverage')
  const badSha = { reasoning: 'a', files: ANCHOR_FILES.map((f, i) => i === 0 ? { ...f, sha256: 'xyz' } : f), initial_ledger_seq: 5 }
  const r3 = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ anchor: badSha }))
  assert.equal(r3.result.council.terminal, 'DEGRADED', 'a non-64-hex digest is not a binding')
})

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// LAW GATING
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('T4 Law gating: a RATIFIED plan passes the Law precondition; sub-T4 keeps the v3.0.1 precondition', async () => {
  const t4 = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder())
  assert.equal(t4.result.council.terminal, 'RATIFIED')
  assert.ok(labelsIn(t4.calls).includes('asimov:law'), 'T4 + certificate ⇒ the Law leg runs')
  const sub = await runWorkflow(ARCHITECTURE, { kilnDir: KILN, projectPath: PROJECT, pluginRoot: '/plugin', codexAvailable: false, planning: 'dual' }, makeResponder())
  assert.ok(labelsIn(sub.calls).includes('asimov:law'), 'sub-T4 Law precondition is byte-identical to v3.0.1 (Athena PASS ⇒ Law compiles)')
  assert.doesNotMatch(String(sub.result.law_reason), /council/, 'a sub-T4 law_reason never mentions the council')
})

test('T4 Athena FAIL ⇒ ratification never runs and the Law precondition is unchanged (Athena, not the council)', async () => {
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ athena: 'FAIL' }))
  assert.ok(!labelsIn(calls).includes('fable:ratify:r1'), 'no ratification without an Athena PASS')
  assert.equal(result.council.terminal, null, 'no terminal when the council never convened at ratify')
  assert.match(result.law_reason, /never reached Athena PASS/, 'the pre-existing Athena precondition still fires first')
})

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// DETERMINISM
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('determinism: workflows-src/architecture.js has no Date.now / Math.random / new Date', () => {
  const src = readFileSync(ARCH_SRC, 'utf8')
  assert.doesNotMatch(src, /Date\.now\(/, 'no Date.now()')
  assert.doesNotMatch(src, /Math\.random\(/, 'no Math.random()')
  assert.doesNotMatch(src, /new Date\(/, 'no new Date()')
})
