// council-resume.test.mjs — B3a acceptance for W6 (resume barriers). The GENERATED architecture.js
// makes the council checkpoint chain LOAD-BEARING for resume: a haiku reads prior SEALED council_state
// checkpoints, the initial ledger seq is FROZEN from the original anchor (a capability refresh never
// reschedules), and matchCheckpoint decides whether a sealed matching front-half barrier
// (DIVERGENCES_BUILT / NEGOTIATION_SKIPPED) lets the workflow REUSE the debate (skip W1/W2/W3) or rerun
// the whole front half. Round-trip discipline: the workflow's OWN fresh-run checkpoint is fed back as
// the prior, so the template/manifest/seq identity matchCheckpoint compares is real, never hand-typed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sha256Hex, canonicalJson, buildDecisionBundle, buildCheckpoint, matchCheckpoint } from '../../plugins/kiln/src/council.mjs'

const ARCHITECTURE = fileURLToPath(new URL('../../plugins/kiln/workflows/architecture.js', import.meta.url))
const AsyncFunction = (async () => {}).constructor
const bodyOf = (file) => readFileSync(file, 'utf8').replace(/^export const meta\b/m, 'const meta')

async function runWorkflow(file, args, respond) {
  const log = []
  const calls = []
  const agent = async (prompt, opts) => { const label = (opts && opts.label) || ''; calls.push({ label, prompt }); return respond(label, prompt) }
  const stubs = {
    args, phase: () => {}, log: (s) => log.push(String(s)), agent,
    parallel: async (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null))),
    pipeline: async () => [], budget: undefined, workflow: async () => null,
  }
  const keys = Object.keys(stubs)
  const run = new AsyncFunction(...keys, bodyOf(file))
  const result = await run(...keys.map((k) => stubs[k]))
  return { result, log, calls }
}

const labelsIn = (calls) => calls.map((c) => c.label)
// B3R1-7: the persisted decision-bundle bytes a fresh run wrote (thoth:bundle-scribe) — fed to a resumed
// run so its reload leg rehydrates the SAME bundle whose sha equals the reused barrier's decision_bundle_hash.
const persistedBytesOf = (calls) => { const c = calls.find((x) => x.label === 'thoth:bundle-scribe'); if (!c) return null; const m = c.prompt.match(/\n("(?:[^"\\]|\\.)*")\nReport written = true/); return m ? JSON.parse(m[1]) : null }
const KILN = '/tmp/nonexistent-kiln/.kiln'
const PROJECT = '/tmp/nonexistent-kiln'
const RUNTOKEN = 'RUNTOKEN-SECRET-zzz'
const masterPlanFile = `${KILN}/master-plan.md`

const shaBytes = (buf) => createHash('sha256').update(buf).digest('hex')
const oshaOf = (payload) => shaBytes(Buffer.from(JSON.stringify(payload)))
const SESSION = '019f5a46-fc83-7181-8303-f516494485ac'
const INV = '3'.repeat(64), PSHA = '1'.repeat(64), XSHA = '5'.repeat(64)
const validReceipt = (payload, over = {}) => ({
  receipt_version: 1, parser_version: 'kiln-codex-receipt/1', transport: 'codex_exec', invocation_id: INV,
  prompt_sha256: PSHA, packet_sha256: XSHA, cli_version: '0.144.1', requested_model: 'gpt-5.6-sol',
  reported_model: 'gpt-5.6-sol', session_id: SESSION, exit_code: 0, tokens_used: 18747,
  output_sha256: oshaOf(payload), stderr_sha256: XSHA, ...over,
})
const solEnvelope = (payload) => ({ payload, codex_receipt: validReceipt(payload), raw_artifact_refs: { stderr: 's', output: 'o' } })
const crossOk = (payload, phaseTag, over = {}) => ({
  output_sha256_disk: oshaOf(payload), output_canonical_sha256: sha256Hex(canonicalJson(payload)),
  ledger: {
    verified: { status: 'verified', invocation_id: INV, receipt_sha256: shaBytes(Buffer.from(JSON.stringify(validReceipt(payload)))), output_sha256: oshaOf(payload), session_id: SESSION, reported_model: 'gpt-5.6-sol', tokens_used: 18747, exit_code: 0, receipt_verified: true },
    reservation: { invocation_id: INV, keystone: 'master_plan', phase: phaseTag, seat: 'sol', attempt: 1, run_token: RUNTOKEN, prompt_sha256: PSHA, packet_sha256: XSHA, ...(over.reservation || {}) },
  },
})
// byte-owned Sol helpers (⟨DSGN-B3-2⟩): extract the exact codex prompt + packet the workflow rendered
// out of the wrapper prompt and derive the matching receipt/reservation hashes, so the happy path
// passes the byte-ownership check.
const extractByteOwn = (wrapperPrompt) => {
  const re = /the JSON-decoded text of: ("(?:[^"\\]|\\.)*")/g
  const out = []; let m
  while ((m = re.exec(wrapperPrompt))) out.push(JSON.parse(m[1]))
  return { codexPrompt: out[0], packetStr: out[1] }
}
const solByteEnvelope = (payload, promptSha, packetSha) => ({ payload, codex_receipt: validReceipt(payload, { prompt_sha256: promptSha, packet_sha256: packetSha }), raw_artifact_refs: { stderr: 's', output: 'o' } })

const foundation = { reasoning: 'f', architecture_file: `${KILN}/docs/architecture.md`, tech_stack_file: `${KILN}/docs/tech-stack.md`, arch_constraints_file: `${KILN}/docs/arch-constraints.md`, has_visual_direction: false, scope: 'standard', estimated_milestones: 2, summary: 'sum' }
const planResult = (slot) => ({ reasoning: 'p', slot, plan_file: `${KILN}/plans/plan-${slot}.md`, approach_summary: 'a', milestones: [{ id: 'M1', title: 'T', summary: 's' }], key_decisions: [] })
const solDraftPayload = { approach_summary: 'sol-a', milestones: [{ id: 'M1', title: 'T', summary: 's' }], key_decisions: [], plan_markdown: '# plan b\n' }
const synthResult = { reasoning: 's', master_plan_file: masterPlanFile, milestone_count: 1, milestones: [{ id: 'M1', title: 'T', surface: 'logic', confidence: 'high' }], confidence_summary: 'c' }
const divergenceResult = { reasoning: 'd', analysis_file: `${KILN}/plans/div.md`, consensus: [], divergences: [], unique_insights: [] }
const FROZEN = [`${KILN}/docs/VISION.md`, `${KILN}/docs/architecture.md`, `${KILN}/docs/tech-stack.md`, `${KILN}/docs/arch-constraints.md`, `${KILN}/docs/research.md`]
const ANCHOR_FILES = FROZEN.map((path) => ({ path, sha256: shaBytes(Buffer.from(`fixture:${path}`)) }))
const evidenceManifestHash = (() => { const m = {}; for (const f of ANCHOR_FILES) m[f.path] = f.sha256; return sha256Hex(canonicalJson(m)) })()
// B3R1-7: the resume path now REHYDRATES the structured bundle, so the T4 RENDER path is ACTIVE on both a
// fresh run AND a reuse (the renderer authors master-plan.md; ratify binds the real b3-bundle/1 bundle) —
// the mock is render-aware. The converged front-half settles nothing ⇒ the EMPTY bundle.
const t4BundleOf = (over = {}) => buildDecisionBundle({ common_trunk: { vision_sc_ids: over.visionScIds || [] }, settled_decisions: over.settled || [], open_divergences: over.open || [], renderer_version: 'b3-bundle/1', evidence_manifest_hash: evidenceManifestHash })
const T4_BUNDLE = t4BundleOf().hash
const rat = (bundleH) => ({ reasoning: 'r', artifact_hash: bundleH, verdict: 'APPROVE', divergence_selections: [], findings: [], changed_evidence: [] })

const t4Args = (extra = {}) => ({ kilnDir: KILN, projectPath: PROJECT, pluginRoot: '/plugin', codexAvailable: true, capabilityTier: 'T4', runToken: RUNTOKEN, planning: 'dual', ...extra })
const PHASE_OF = { 'sol:critique': 'CRITIQUE', 'sol:revise': 'REVISION', 'sol:negotiate': 'NEGOTIATION' }
// B3R1-5: a finding-based divergence now surfaces a negotiation card (the authoritative divergence can
// never disappear), so the negotiate legs must SELECT each card. The cards ride the prompts verbatim (the
// fable prompt inside <cards>…</cards>, the sol codex prompt after "Open divergence cards: "); both heads
// pick the PRESENT side (both agree ⇒ settle/leave) so the diverged front-half still seals cleanly.
const cardsFromFable = (p) => { const m = p.match(/<cards>\n([\s\S]*?)\n<\/cards>/); return m ? JSON.parse(m[1]) : [] }
const cardsFromSolCodex = (cp) => { const m = cp.match(/Open divergence cards: (.*)\n/); return m ? JSON.parse(m[1]) : [] }
const presentSide = (card) => (card.position_0 && typeof card.position_0 === 'object' && card.position_0.absent === true) ? 'P1' : 'P0'
const negSelections = (cards) => ({ selections: cards.map((c) => ({ divergence_id: c.divergence_id, selection: presentSide(c) })) })
// a one-sided unresolved finding keeps the mechanical divergence set NON-empty ⇒ the negotiation runs and
// seals NEGOTIATION_SEALED (the negotiated front-half terminal barrier). B3R1-5: the finding-based
// divergence now surfaces a NEGOTIATION CARD (the authoritative divergence can never disappear), which the
// heads select present-side (⇒ settle/leave), so the diverged front-half still seals cleanly.
const critFinding = { target_decision_id: 'M1', claim: 'M1 hides an unbounded unknown', required_change: 'split M1', severity: 'blocking', evidence: { class: 'scenario', refs: ['vision'] } }

// A converged T4 responder that reaches RATIFIED; cfg.priorCheckpoints seeds the resume read, cfg.anchorSeq
// sets the fresh anchor's ledger seq.
function makeResponder(cfg = {}) {
  const byteOwn = {}
  const solCritiquePayload = cfg.diverge ? { findings: [critFinding] } : { findings: [] }
  const solRevisePayload = { dispositions: [], decisions: [], milestones: [], revised_plan_markdown: '# revised plan b\n' }
  const payloadFor = (label, prompt) => label === 'sol:critique' ? solCritiquePayload : label === 'sol:revise' ? solRevisePayload : negSelections(cardsFromSolCodex(prompt))
  // B3R1-7: capture the rendered master-plan bytes (render-scribe) + the persisted bundle bytes
  // (bundle-scribe) so the file-hash / persist-hash / reload legs answer deterministically.
  let renderedHash = null, persistedBundleBytes = null
  const captureScribe = (prompt) => { const m = prompt.match(/\n("(?:[^"\\]|\\.)*")\nReport written = true/); if (m) renderedHash = sha256Hex(JSON.parse(m[1])) }
  const captureBundleScribe = (prompt) => { const m = prompt.match(/\n("(?:[^"\\]|\\.)*")\nReport written = true/); if (m) persistedBundleBytes = JSON.parse(m[1]) }
  const artifactHashOf = (p) => { const m = p.match(/artifact_hash = "([0-9a-f]{64})"/) || p.match(/"artifact_hash":"([0-9a-f]{64})"/); return m ? m[1] : null }
  return (label, prompt) => {
    if (label === 'thoth:research-check') return { reasoning: 'ls', missing: [] }
    if (label === 'numerobis:foundation') return foundation
    if (label === 'thoth:council-anchor') return { reasoning: 'a', files: ANCHOR_FILES, initial_ledger_seq: cfg.anchorSeq !== undefined ? cfg.anchorSeq : 5 }
    if (label === 'thoth:council-resume') return { checkpoints: cfg.priorCheckpoints !== undefined ? cfg.priorCheckpoints : [] }
    if (label === 'thoth:vision-scids') return { sc_text: '' }
    if (label === 'fable:draft') return planResult('a')
    if (label === 'sol:draft') return solEnvelope(solDraftPayload)
    if (label === 'fable:critique') return { findings: [] }
    if (label === 'fable:revise') {
      // B3R1-1: the slot is seed-assigned, so dispose EXACTLY the finding ids the prompt lists (parse
      // `- F-<seq>-<slot>-<nnn>: …`) instead of hardcoding a slot label.
      const ids = [...prompt.matchAll(/- (F-\d+-P[01]-\d+):/g)].map((m) => m[1])
      return { dispositions: ids.map((id) => ({ finding_id: id, disposition: 'unresolved' })), decisions: [], milestones: [] }
    }
    if (label === 'fable:negotiate') return negSelections(cardsFromFable(prompt))
    if (label === 'sol:critique' || label === 'sol:revise' || label === 'sol:negotiate') {
      const { codexPrompt, packetStr } = extractByteOwn(prompt)
      const promptSha = sha256Hex(codexPrompt), packetSha = sha256Hex(packetStr)
      const payload = payloadFor(label, codexPrompt)
      byteOwn[label] = { promptSha, packetSha, payload }
      return solByteEnvelope(payload, promptSha, packetSha)
    }
    if (label === 'thoth:seat-hashes') return { plan_a_sha256: 'a1'.repeat(32), plan_b_sha256: 'b2'.repeat(32) }
    if (label === 'diogenes:divergence') return divergenceResult
    if (label === 'plato:synthesis' || label.startsWith('plato:revise')) return synthResult
    if (label.startsWith('athena:validate')) return { reasoning: 'v', verdict: 'PASS', failed_dimensions: [], fixes: [] }
    // B3R1-7: the render leg (One From Many) + the persist leg (front-half barrier) + the reload leg (reuse).
    if (label === 'thoth:render-scribe') { captureScribe(prompt); return { written: true } }
    if (label === 'thoth:render-hash') return { plan_sha256: renderedHash }
    if (label === 'thoth:bundle-scribe') { captureBundleScribe(prompt); return { written: true } }
    if (label === 'thoth:bundle-persist-hash') return { plan_sha256: persistedBundleBytes != null ? sha256Hex(persistedBundleBytes) : null }
    if (label === 'thoth:bundle-reload') return cfg.persistedBundle !== undefined ? { content: cfg.persistedBundle, sha256: sha256Hex(cfg.persistedBundle) } : { content: '', sha256: null }
    if (label === 'thoth:ratify-anchor:r1') return { plan_sha256: renderedHash }
    if (label === 'fable:ratify:r1') return rat(artifactHashOf(prompt) || T4_BUNDLE)
    if (label === 'sol:ratify:r1') return solEnvelope(rat(artifactHashOf(prompt) || T4_BUNDLE))
    if (label.startsWith('thoth:receipt-check:')) {
      const leg = label.slice('thoth:receipt-check:'.length)
      if (leg === 'sol:critique' || leg === 'sol:revise' || leg === 'sol:negotiate') {
        const bo = byteOwn[leg] || {}
        return crossOk(bo.payload, PHASE_OF[leg], { reservation: { prompt_sha256: bo.promptSha, packet_sha256: bo.packetSha } })
      }
      if (leg === 'sol:draft') return crossOk(solDraftPayload, 'DRAFTS')
      if (leg === 'sol:ratify:r1') return crossOk(rat(T4_BUNDLE), 'RATIFY_1')
      return null
    }
    if (label === 'thoth:council-ledger') return { appended: true }
    if (label === 'asimov:law') return null
    if (label === 'numerobis:handoff') return null
    if (label === 'thoth:verify') return { reasoning: 'ok', missing: [] }
    return null
  }
}

const DEBATE_LEGS = ['fable:critique', 'sol:critique', 'fable:revise', 'sol:revise']
const ranDebate = (calls) => DEBATE_LEGS.some((l) => labelsIn(calls).includes(l))
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
// the front-half TERMINAL barrier is NEGOTIATION_SEALED (negotiated) or NEGOTIATION_SKIPPED (converged);
// DIVERGENCES_BUILT is now an INTERMEDIATE (the negotiation follows it) and is NOT a reusable terminal.
const frontHalfBarrierOf = (calls) => parseCheckpoints(calls).find((d) => d.phase === 'NEGOTIATION_SKIPPED' || d.phase === 'NEGOTIATION_SEALED')

// ── The fresh-run baseline: a converged T4 run seals a NEGOTIATION_SKIPPED front-half barrier we can
//    feed back as the prior. Its identity fields are the workflow's OWN (template/manifest/seq). ──
test('W6 baseline: a fresh converged T4 run seals NEGOTIATION_SKIPPED and runs the debate', async () => {
  const { calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder())
  assert.ok(ranDebate(calls), 'a fresh run runs the debate front-half')
  const barrier = frontHalfBarrierOf(calls)
  assert.ok(barrier && barrier.phase === 'NEGOTIATION_SKIPPED', 'the converged front half seals NEGOTIATION_SKIPPED')
  assert.equal(barrier.status, 'sealed')
})

test('W6 post-barrier REUSE: a prior SEALED matching front-half barrier + its persisted bundle ⇒ the debate is skipped, the bundle REHYDRATES, the render path stays ACTIVE (B3R1-7)', async () => {
  const fresh = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder())
  const barrier = frontHalfBarrierOf(fresh.calls)
  const resumed = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ priorCheckpoints: [barrier], persistedBundle: persistedBytesOf(fresh.calls) }))
  assert.ok(labelsIn(resumed.calls).includes('thoth:council-resume'), 'the resume read fires')
  assert.ok(!ranDebate(resumed.calls), 'the debate front-half is REUSED — none of the critique/revision legs re-run')
  assert.ok(labelsIn(resumed.calls).includes('thoth:bundle-reload'), 'the persisted bundle is reloaded on reuse')
  assert.ok(resumed.log.some((l) => /rehydrated|render path stays ACTIVE/.test(l)), 'the rehydration is logged')
  // B3R1-7: the render path is ACTIVE after reuse (the renderer authors, NOT plato) — councilBundle rehydrated
  assert.ok(labelsIn(resumed.calls).includes('thoth:render-scribe'), 'the deterministic renderer authors master-plan.md after reuse (T4 rendering enabled)')
  assert.ok(!labelsIn(resumed.calls).includes('plato:synthesis'), 'plato never authors after a rehydrated reuse')
  assert.equal(resumed.result.council.terminal, 'RATIFIED')
})

test('W6 tampered persisted bundle ⇒ RERUN: a reused barrier whose persisted bytes do not rehydrate (sha mismatch) reruns the WHOLE front half (never advances on an unrehydratable barrier)', async () => {
  const fresh = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder())
  const barrier = frontHalfBarrierOf(fresh.calls)
  const resumed = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ priorCheckpoints: [barrier], persistedBundle: '{"tampered":true}' }))
  assert.ok(ranDebate(resumed.calls), 'a persisted bundle whose sha does not match the barrier hash fails to rehydrate ⇒ the whole front half reruns')
  assert.ok(resumed.log.some((l) => /did NOT rehydrate|rerunning the whole front half/.test(l)), 'the rerun-on-mismatch is logged')
})

test('W6 half-pair crash ⇒ paired RERUN: a prior sealed CRITIQUES_SEALED but NO front-half barrier ⇒ the whole front half reruns (no partial reuse)', async () => {
  const fresh = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder())
  const critiques = parseCheckpoints(fresh.calls).find((d) => d.phase === 'CRITIQUES_SEALED')
  assert.ok(critiques, 'the fresh run sealed a CRITIQUES_SEALED barrier to feed back')
  const resumed = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ priorCheckpoints: [critiques] }))
  assert.ok(ranDebate(resumed.calls), 'without a sealed front-half TERMINAL barrier the whole front half reruns — a half-pair has no partial-output authority')
})

test('W6 template/pin change ⇒ INVALIDATION: a prior barrier whose template_hash drifted fails matchCheckpoint ⇒ rerun', async () => {
  const fresh = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder())
  const barrier = frontHalfBarrierOf(fresh.calls)
  const drifted = { ...barrier, template_hash: 'DRIFTED-TEMPLATE-HASH' }
  const resumed = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ priorCheckpoints: [drifted] }))
  assert.ok(ranDebate(resumed.calls), 'a drifted template invalidates the reusable cache — the debate reruns')
  // and matchCheckpoint agrees at the unit level: identical → reuse, drifted → rerun
  assert.equal(matchCheckpoint(buildCheckpoint(barrier), buildCheckpoint(barrier)), true)
  assert.equal(matchCheckpoint(buildCheckpoint(drifted), buildCheckpoint(barrier)), false)
})

test('W6 frozen initial ledger seq: on resume the seq is FROZEN from the prior checkpoint (a capability refresh never reschedules)', async () => {
  // the prior council checkpoint recorded seq 99; THIS run's fresh anchor reports a DIFFERENT seq (42),
  // yet every checkpoint this run writes must carry the frozen 99. A CRITIQUES_SEALED-only prior also
  // forces a rerun (no front-half barrier), so the freeze is observable on the re-sealed DRAFTS/CRITIQUES.
  const fresh = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder())
  const critiques = { ...parseCheckpoints(fresh.calls).find((d) => d.phase === 'CRITIQUES_SEALED'), initial_ledger_seq: 99 }
  const resumed = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ priorCheckpoints: [critiques], anchorSeq: 42 }))
  assert.ok(resumed.log.some((l) => /FROZEN at 99/.test(l)), 'the seq is frozen from the prior checkpoint, not the fresh anchor')
  for (const d of parseCheckpoints(resumed.calls)) {
    assert.equal(d.initial_ledger_seq, 99, `${d.phase} carries the FROZEN seq 99, never the fresh anchor's 42`)
  }
})

test('W6 fresh run keeps the anchor seq: with no prior checkpoint the anchor seq stands (no false freeze)', async () => {
  const { calls } = await runWorkflow(ARCHITECTURE, t4Args({}), makeResponder({ anchorSeq: 7 }))
  for (const d of parseCheckpoints(calls)) assert.equal(d.initial_ledger_seq, 7, `${d.phase} uses the anchor's own seq on a fresh run`)
})

// ── B3b2-iiA: the negotiated front-half terminal barrier (NEGOTIATION_SEALED) joins the resume algebra
//    exactly like the converged NEGOTIATION_SKIPPED barrier (a paired phase — 2 seat hashes). ──
test('W6 NEGOTIATION_SEALED REUSE: a prior SEALED negotiated barrier ⇒ the whole debate front-half is reused (not re-run)', async () => {
  const fresh = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ diverge: true }))
  const barrier = frontHalfBarrierOf(fresh.calls)
  assert.ok(barrier && barrier.phase === 'NEGOTIATION_SEALED', 'a non-empty divergence set runs the negotiation and seals NEGOTIATION_SEALED')
  assert.equal(barrier.status, 'sealed')
  // B3R1-5: the finding-based divergence surfaces a real negotiation card (never zero cards) — the
  // fable:negotiate prompt carries at least one DV card built FROM divSet, so the divergence can't vanish.
  const negPrompt = fresh.calls.find((c) => c.label === 'fable:negotiate')
  assert.ok(negPrompt && cardsFromFable(negPrompt.prompt).length >= 1, 'the authoritative finding divergence yields a negotiation card (derived from divSet, not the registry-only join)')
  const resumed = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ diverge: true, priorCheckpoints: [barrier], persistedBundle: persistedBytesOf(fresh.calls) }))
  assert.ok(labelsIn(resumed.calls).includes('thoth:council-resume'), 'the resume read fires')
  assert.ok(!ranDebate(resumed.calls), 'the sealed NEGOTIATION_SEALED barrier ⇒ the debate front-half is REUSED')
  assert.ok(!labelsIn(resumed.calls).includes('fable:negotiate'), 'the negotiation itself is reused, not re-run')
  assert.ok(labelsIn(resumed.calls).includes('thoth:bundle-reload'), 'the persisted negotiated bundle rehydrates on reuse')
  assert.equal(resumed.result.council.terminal, 'RATIFIED')
})

test('W6 DIVERGENCES_BUILT half-pair ⇒ RERUN: a prior sealed DIVERGENCES_BUILT (the intermediate) but NO negotiation seal ⇒ the whole front half reruns', async () => {
  const fresh = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ diverge: true }))
  const built = parseCheckpoints(fresh.calls).find((d) => d.phase === 'DIVERGENCES_BUILT')
  assert.ok(built, 'the diverged run ledgered DIVERGENCES_BUILT as the intermediate')
  const resumed = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ diverge: true, priorCheckpoints: [built] }))
  assert.ok(ranDebate(resumed.calls), 'DIVERGENCES_BUILT is an intermediate, not a terminal barrier — the whole front half reruns (no partial authority)')
})

// ── B3c: the W5 fresh-round ladder barriers join the matchCheckpoint resume algebra. FRESH_CARDS_SEALED
//    is a PAIRED barrier (both heads' frozen 2×2 card sets — exactly 2 seat hashes, a half-pair never
//    resumes); FRESH_CELLS_SETTLED / REFERENCE_REDUCTION / RUBRIC_CHECK are SCRIPT-only (0 seat hashes). ──
const freshCards = (over = {}) => ({ kind: 'council_state', protocol_version: 'twin-council/3', template_hash: 'th', run_token_hash: 'rth', initial_ledger_seq: 5, keystone_id: 'master_plan', phase: 'FRESH_CARDS_SEALED', decision_bundle_hash: 'bh', input_artifact_hashes: [], evidence_manifest_hash: 'emh', anonymous_seat_artifact_hashes: { P0: 'a', P1: 'b' }, seat_provenance: { P0: { head: 'fable' }, P1: { head: 'sol' } }, codex_receipt_hash: null, status: 'sealed', ...over })
const cellsSettled = (over = {}) => ({ ...freshCards(), phase: 'FRESH_CELLS_SETTLED', anonymous_seat_artifact_hashes: {}, seat_provenance: {}, ...over })

test('W6 FRESH_CARDS_SEALED is a paired barrier: identical 2-seat checkpoints match; a half-pair (1 seat) or a zero-seat "sealed" one never resumes', async () => {
  const paired = freshCards()
  assert.equal(matchCheckpoint(buildCheckpoint(paired), buildCheckpoint(paired)), true, 'identical 2-seat FRESH_CARDS_SEALED reuse')
  assert.equal(matchCheckpoint(buildCheckpoint(freshCards({ anonymous_seat_artifact_hashes: { P0: 'a' } })), buildCheckpoint(paired)), false, 'a lone half-pair never resumes')
  assert.equal(matchCheckpoint(buildCheckpoint(freshCards({ anonymous_seat_artifact_hashes: {} })), buildCheckpoint(paired)), false, 'a zero-seat "sealed" paired checkpoint never resumes')
  assert.equal(matchCheckpoint(buildCheckpoint(freshCards({ status: 'open' })), buildCheckpoint(paired)), false, 'only a sealed prior is reusable')
})

test('W6 FRESH_CELLS_SETTLED is a script-only barrier: identical 0-seat checkpoints match; a spurious 2-seat one never resumes', async () => {
  const script = cellsSettled()
  assert.equal(matchCheckpoint(buildCheckpoint(script), buildCheckpoint(script)), true, 'identical 0-seat FRESH_CELLS_SETTLED reuse')
  assert.equal(matchCheckpoint(buildCheckpoint(cellsSettled({ anonymous_seat_artifact_hashes: { P0: 'a', P1: 'b' } })), buildCheckpoint(script)), false, 'a script-only phase carrying seat hashes is never reusable')
  assert.equal(matchCheckpoint(buildCheckpoint(cellsSettled({ template_hash: 'DRIFT' })), buildCheckpoint(script)), false, 'a drifted template invalidates the reusable cache')
})
