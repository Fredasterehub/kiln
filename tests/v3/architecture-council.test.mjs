// architecture-council.test.mjs — acceptance: the GENERATED workflows/architecture.js wires
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
import { sha256Hex, canonicalJson, buildDecisionBundle, renderMasterPlan, COUNCIL_PROTOCOL_VERSION } from '../../plugins/kiln/src/council.mjs'

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

// ── byte-owned Sol leg helpers: the workflow RENDERS the codex prompt + packet and
// the courier writes them VERBATIM. The stateful responder pulls those exact bytes back out of the
// wrapper prompt (each embedded as a JSON string after "the JSON-decoded text of: ") and DERIVES the
// receipt + reservation hashes from them (Sol F11 discipline) — so the happy path passes byte-ownership
// and a `byteAlter` override models a courier that changed a prompt byte (a wrong-but-consistent hash).
const extractByteOwn = (wrapperPrompt) => {
  const re = /the JSON-decoded text of: ("(?:[^"\\]|\\.)*")/g
  const out = []; let m
  while ((m = re.exec(wrapperPrompt))) out.push(JSON.parse(m[1]))
  return { codexPrompt: out[0], packetStr: out[1] }
}
const solByteEnvelope = (payload, promptSha, packetSha) => ({ payload, codex_receipt: validReceipt(payload, { prompt_sha256: promptSha, packet_sha256: packetSha }), raw_artifact_refs: { stderr: 's', output: 'o' } })

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
// SWAP: the ratify authority is now the REAL front-half decision bundle (renderer b3-bundle/1),
// not a plato stand-in. t4BundleOf reconstructs it EXACTLY as finalizeFrontHalf does — a settled-entry
// array + common_trunk:{vision_sc_ids} + open cards; renderedPlanHashOf mirrors renderScribeCompare
// (renderMasterPlan over the same view → sha of the markdown), so a mock row answers the file-hash scribe
// leg deterministically. The DEFAULT converged front-half settles nothing ⇒ the empty bundle.
const t4BundleOf = (over = {}) => buildDecisionBundle({ common_trunk: { vision_sc_ids: over.visionScIds || [] }, settled_decisions: over.settled || [], open_divergences: over.open || [], renderer_version: 'b3-bundle/1', evidence_manifest_hash: evidenceManifestHash })
const renderedPlanHashOf = (over = {}) => sha256Hex(renderMasterPlan({ ...t4BundleOf(over).bundle, settled: over.settled || [] }, { visionScIds: over.visionScIds || [] }).markdown)
const T4_BUNDLE = t4BundleOf().hash
// The no-amendment BLOCK path leaves the bundle UNCHANGED, so both rounds echo the same real bundle hash;
// the render hash is the rendered-bytes sha (the scribe fidelity anchor). Rows that settle/amend override.
const PLAN_HASH_1 = renderedPlanHashOf()
const BUNDLE_1 = T4_BUNDLE
// on the LITE path the plan artifact IS the bundle (no decision bundle) — bundle_hash =
// plan_hash = the plan-file sha, so the lite ratify verdicts echo THIS hash as artifact_hash.
const LITE_HASH = shaBytes(Buffer.from('fixture:lite-plan'))

const rat = (bundleH, over = {}) => ({ reasoning: 'r', artifact_hash: bundleH, verdict: 'APPROVE', divergence_selections: [], findings: [], changed_evidence: [], ...over })

const t4Args = (extra = {}) => ({ kilnDir: KILN, projectPath: PROJECT, pluginRoot: '/plugin', codexAvailable: true, capabilityTier: 'T4', runToken: RUNTOKEN, planning: 'dual', ...extra })

// makeResponder(cfg) — a label→result mock. Sol legs return envelopes whose receipts derive from the
// leg's payload; the matching cross-checks are AUTO-DERIVED from the same payload + phase tag, so a
// test that overrides a Sol payload gets a coherent invocation-exact ledger for free.
const PHASE_OF = { 'sol:draft': 'DRAFTS', 'sol:critique': 'CRITIQUE', 'sol:revise': 'REVISION', 'sol:negotiate': 'NEGOTIATION', 'sol:ratify:r1': 'RATIFY_1', 'sol:answer': 'ANSWER_EXCHANGE', 'sol:ratify:r2': 'RATIFY_2', 'sol:ratify:rFresh': 'RATIFY_FRESH', 'sol:ratify:lite': 'LITE_RATIFY' }
// negotiation helpers: the workflow embeds the A2 cards VERBATIM in both heads' prompts (the
// fable prompt inside <cards>…</cards>, the sol codex prompt after "Open divergence cards: "). The
// responder parses those exact cards back out and returns one selection per DV id (a deterministic
// strategy → both heads agree → settle; a cfg.negotiate(card, leg) override drives disagreement/absent).
const cardsFromFable = (p) => { const m = p.match(/<cards>\n([\s\S]*?)\n<\/cards>/); return m ? JSON.parse(m[1]) : [] }
const cardsFromSolCodex = (cp) => { const m = cp.match(/Open divergence cards: (.*)\n/); return m ? JSON.parse(m[1]) : [] }
const presentSide = (card) => (card.position_0 && typeof card.position_0 === 'object' && card.position_0.absent === true) ? 'P1' : 'P0'
// ── W5 fresh-round ladder mock helpers. A fresh cell embeds its two options as `Option K: <json>` /
// `Option M: <json>` (mapped per the hidden cell mapping); the responder reads them back and votes by
// CONTENT (merit), exactly as a counterbalanced model would — so a `freshPrefer` value normalizes to one
// canonical outcome across all four cells regardless of mapping. phaseTagOf pulls the byte-owned Sol
// leg's dynamic phaseTag out of the receipt-script argv so the cross-check reservation phase matches.
const parseFreshOptions = (src) => { const km = {}; for (const l of ['K', 'M']) { const m = src.match(new RegExp(`Option ${l}: (.*)`)); if (m) { try { km[l] = JSON.parse(m[1]) } catch { /* skip */ } } } return km }
const phaseTagOf = (wrapperPrompt) => { const m = wrapperPrompt.match(/(\S+) sol (\d+)/); return m ? m[1] : null }
function makeResponder(cfg = {}) {
  const solPayloads = {
    'sol:draft': cfg.solDraftPayload !== undefined ? cfg.solDraftPayload : solDraftPayload,
    'sol:ratify:r1': cfg.rS1 !== undefined ? cfg.rS1 : rat(null),
    'sol:answer': cfg.solAnswer !== undefined ? cfg.solAnswer : { answers: [] },
    'sol:ratify:r2': cfg.rS2 !== undefined ? cfg.rS2 : rat(null),
    'sol:ratify:lite': cfg.rSlite !== undefined ? cfg.rSlite : rat(LITE_HASH),
  }
  // debate default payloads — a converged debate (no findings ⇒ empty dispositions ⇒ empty
  // divergence set ⇒ NEGOTIATION_SKIPPED), so every inherited T4 full-path row proceeds to ratify.
  const solCritiquePayload = cfg.solCritique !== undefined ? cfg.solCritique : { findings: [] }
  const solRevisePayload = cfg.solRevise !== undefined ? cfg.solRevise : { dispositions: [], decisions: [], revised_plan_markdown: '# revised plan b\n' }
  const byteOwn = {} // leg → { promptSha, packetSha, payload } derived from the byte-owned wrapper prompt
  // The Thoth scribe writes the RENDERED master-plan bytes; the file-hash leg + the ratify anchor read
  // the same file. The mock derives the file hash from the EXACT rendered markdown embedded in the scribe
  // prompt (scribePlanPrompt) — so the in-script byte-compare always proves fidelity for any front-half.
  let renderedHash = null, renderHashCount = 0, athenaCallN = 0, persistedBundleBytes = null
  const captureScribe = (prompt) => { const m = prompt.match(/\n("(?:[^"\\]|\\.)*")\nReport written = true/); if (m) renderedHash = sha256Hex(JSON.parse(m[1])) }
  // capture the persisted decision-bundle bytes (thoth:bundle-scribe) so the persist-hash / reload
  // legs answer deterministically (the front-half barrier now persists the bundle for resume rehydration).
  const captureBundleScribe = (prompt) => { const m = prompt.match(/\n("(?:[^"\\]|\\.)*")\nReport written = true/); if (m) persistedBundleBytes = JSON.parse(m[1]) }
  // the DEADLOCK_RESOLVED certificate is persisted reloadably (scribe + persist-hash) — capture the
  // scribed bytes so the persist-hash leg answers with their sha (else sealProvisional escalates fail-closed).
  let persistedCertBytes = null
  const captureCertScribe = (prompt) => { const m = prompt.match(/\n("(?:[^"\\]|\\.)*")\nReport written = true/); if (m) persistedCertBytes = JSON.parse(m[1]) }
  // The heads ECHO the bundle hash the binding line pins (validateRatification checks the echo) — the
  // responder reads it back out of each ratify prompt/packet so a row NEVER hardcodes the (front-half-
  // dependent) bundle hash: an empty converged bundle and a populated one both get the right echo for free.
  const artifactHashOf = (p) => { const m = p.match(/artifact_hash = "([0-9a-f]{64})"/) || p.match(/"artifact_hash":"([0-9a-f]{64})"/); return m ? m[1] : null }
  // inj — a ratify override with a null artifact_hash inherits the pinned echo (so a BLOCK/re-verdict row
  // never hardcodes the front-half-dependent — or post-amendment — bundle hash; it just declares extras).
  // It ALSO fills divergence_selections from the OPEN cards the binding pins (their DV ids are seed-bound —
  // the test can't hardcode them): a leg with null selections resolves every open card with `sel` (both
  // heads agree ⇒ settle; MERGED ⇒ gated escalation; 'omit' ⇒ an uncovered divergence ⇒ DEGRADED).
  const openCardsOf = (p) => { const m = p.match(/the open cards:\n(\[[\s\S]*?\])\n<\/binding>/) || p.match(/"open_divergences":(\[[\s\S]*?\]),"exchange"/); if (!m) return []; try { return JSON.parse(m[1]) } catch { return [] } }
  const ratSels = (p, sel) => sel === 'omit' ? [] : openCardsOf(p).map((c) => ({ divergence_id: c.divergence_id, selection: sel }))
  const inj = (o, p, sel) => {
    if (!o) return o
    let out = o
    if (out.artifact_hash == null) out = { ...out, artifact_hash: artifactHashOf(p) }
    if (sel !== undefined && Array.isArray(out.divergence_selections) && out.divergence_selections.length === 0) out = { ...out, divergence_selections: ratSels(p, sel) }
    return out
  }
  const solRatify = {} // leg → the echoing ratify payload (so the receipt-check derives a matching hash)
  // negSelections(cards, leg) — one selection per card; default is the PRESENT side (both heads agree ⇒
  // settle); cfg.negotiate(card, leg) overrides (e.g. both pick the absent side ⇒ the entry leaves).
  const negSelections = (cards, leg) => ({ selections: cards.map((c) => (cfg.negotiate ? cfg.negotiate(c, leg) : { divergence_id: c.divergence_id, selection: presentSide(c) })) })
  // W5 fresh-cell vote: freshCell(head, K, M) overrides; else the freshPrefer VALUE wins by content (both
  // heads converge on the canonical position holding it); an undefined vote defaults to Option K.
  const freshVote = (head, opts) => {
    if (cfg.freshCell) return cfg.freshCell(head, opts.K, opts.M)
    if (cfg.freshPrefer !== undefined) { const t = canonicalJson(cfg.freshPrefer); if (canonicalJson(opts.K) === t) return { choice: 'K' }; if (canonicalJson(opts.M) === t) return { choice: 'M' } }
    return { choice: 'K' }
  }
  const solByteLeg = (label, prompt, payload) => { const { codexPrompt, packetStr } = extractByteOwn(prompt); const promptSha = sha256Hex(codexPrompt), packetSha = sha256Hex(packetStr); byteOwn[label] = { promptSha, packetSha, payload, phaseTag: phaseTagOf(prompt) }; return solByteEnvelope(payload, promptSha, packetSha) }
  return (label, prompt) => {
    if (label.startsWith('fable:fresh:')) { const v = freshVote('fable', parseFreshOptions(prompt)); return v === null ? null : v }
    if (label.startsWith('sol:fresh:')) { const { codexPrompt } = extractByteOwn(prompt); const v = freshVote('sol', parseFreshOptions(codexPrompt)); return v === null ? null : solByteLeg(label, prompt, v) }
    if (label.startsWith('thoth:reference-reduction:')) return cfg.referenceReduction !== undefined ? cfg.referenceReduction(label) : { settles: false, adopt: null, reference: null, executable_check: null }
    if (label.startsWith('fable:rubric-amend:')) return cfg.rubricAmend !== undefined ? cfg.rubricAmend('fable') : { sign: false, clarification: null }
    if (label.startsWith('sol:rubric-amend:')) { const p = cfg.rubricAmend !== undefined ? cfg.rubricAmend('sol') : { sign: false, clarification: null }; return p === null ? null : solByteLeg(label, prompt, p) }
    if (label.startsWith('fable:reversibility:')) return cfg.reversibility !== undefined ? cfg.reversibility('fable') : { P0: 'irreversible', P1: 'irreversible' }
    if (label.startsWith('sol:reversibility:')) { const p = cfg.reversibility !== undefined ? cfg.reversibility('sol') : { P0: 'irreversible', P1: 'irreversible' }; return p === null ? null : solByteLeg(label, prompt, p) }
    if (label === 'thoth:render-scribe') { captureScribe(prompt); return cfg.renderScribe !== undefined ? cfg.renderScribe : { written: true } }
    if (label === 'thoth:render-hash') { renderHashCount++; if (cfg.renderHash !== undefined) return cfg.renderHash; if (cfg.badSecondRender && renderHashCount === 2) return { plan_sha256: 'f'.repeat(64) }; return { plan_sha256: renderedHash } }
    if (label === 'thoth:bundle-scribe') { captureBundleScribe(prompt); return cfg.bundleScribe !== undefined ? cfg.bundleScribe : { written: true } }
    if (label === 'thoth:bundle-persist-hash') { if (cfg.bundlePersistHash !== undefined) return cfg.bundlePersistHash; return { plan_sha256: persistedBundleBytes != null ? sha256Hex(persistedBundleBytes) : null } }
    if (label === 'thoth:bundle-reload') return cfg.persistedBundle !== undefined ? { content: cfg.persistedBundle, sha256: sha256Hex(cfg.persistedBundle) } : { content: '', sha256: null }
    if (label === 'thoth:deadlock-cert-scribe') { captureCertScribe(prompt); return cfg.certScribe !== undefined ? cfg.certScribe : { written: true } }
    if (label === 'thoth:deadlock-cert-persist-hash') { if (cfg.certPersistHash !== undefined) return cfg.certPersistHash; return { plan_sha256: persistedCertBytes != null ? sha256Hex(persistedCertBytes) : null } }
    if (label === 'thoth:research-check') return { reasoning: 'ls', missing: [] }
    if (label === 'numerobis:foundation') return foundation(cfg.scope || 'standard')
    if (label === 'thoth:council-anchor') return cfg.anchor !== undefined ? cfg.anchor : { reasoning: 'a', files: ANCHOR_FILES, initial_ledger_seq: 5 }
    if (label === 'thoth:council-resume') return { checkpoints: cfg.priorCheckpoints !== undefined ? cfg.priorCheckpoints : [] }
    if (label === 'thoth:lite-council-anchor') return cfg.liteAnchor !== undefined ? cfg.liteAnchor : { reasoning: 'a', files: ANCHOR_FILES, initial_ledger_seq: 5 }
    if (label === 'thoth:lite-ratify-anchor') return cfg.liteRatifyAnchor !== undefined ? cfg.liteRatifyAnchor : { plan_sha256: LITE_HASH }
    if (label === 'fable:ratify:lite') return cfg.rFlite !== undefined ? cfg.rFlite : rat(LITE_HASH)
    if (label === 'sol:ratify:lite') return cfg.sRlite !== undefined ? cfg.sRlite : solEnvelope(solPayloads['sol:ratify:lite'])
    if (label === 'confucius:plan') return planResult('a')
    if (label === 'sun-tzu:plan' || label === 'miyamoto:plan') return planResult('b')
    if (label === 'fable:ratify:r1') return inj(cfg.rF1 !== undefined ? cfg.rF1 : rat(artifactHashOf(prompt)), prompt, cfg.ratSelFable !== undefined ? cfg.ratSelFable : cfg.ratSel)
    if (label === 'fable:ratify:r2') return inj(cfg.rF2 !== undefined ? cfg.rF2 : rat(artifactHashOf(prompt)), prompt, cfg.ratSel)
    // fable:ratify:rFresh — the fresh RATIFY round AFTER the ladder adopts (fully-settled bundle, no open cards)
    if (label === 'fable:ratify:rFresh') return inj(cfg.rFfresh !== undefined ? cfg.rFfresh : rat(artifactHashOf(prompt)), prompt)
    if (label === 'sol:ratify:r1' || label === 'sol:ratify:r2' || label === 'sol:ratify:rFresh') {
      const env = label === 'sol:ratify:r1' ? cfg.sR1 : label === 'sol:ratify:r2' ? cfg.sR2 : cfg.sRfresh
      if (env !== undefined) return env
      const over = label === 'sol:ratify:r1' ? cfg.rS1 : label === 'sol:ratify:r2' ? cfg.rS2 : cfg.rSfresh
      const payload = inj(over !== undefined ? over : rat(artifactHashOf(prompt)), prompt, cfg.ratSel)
      solRatify[label] = payload
      return solEnvelope(payload)
    }
    if (label === 'fable:draft') return cfg.fableDraft !== undefined ? cfg.fableDraft : planResult('a')
    if (label === 'sol:draft') return cfg.solDraft !== undefined ? cfg.solDraft : solEnvelope(solPayloads['sol:draft'])
    if (label === 'thoth:vision-scids') return { sc_text: cfg.visionScText !== undefined ? cfg.visionScText : '' }
    if (label === 'fable:critique') return cfg.fableCritique !== undefined ? cfg.fableCritique : { findings: [] }
    if (label === 'fable:revise') return cfg.fableRevise !== undefined ? cfg.fableRevise : { dispositions: [], decisions: [] }
    if (label === 'fable:negotiate') return cfg.fableNegotiate !== undefined ? cfg.fableNegotiate : negSelections(cardsFromFable(prompt), 'fable:negotiate')
    if (label === 'sol:critique' || label === 'sol:revise' || label === 'sol:negotiate') {
      const { codexPrompt, packetStr } = extractByteOwn(prompt)
      let promptSha = sha256Hex(codexPrompt)
      const packetSha = sha256Hex(packetStr)
      if (cfg.byteAlter && cfg.byteAlter[label] !== undefined) promptSha = cfg.byteAlter[label] // a courier altered the prompt
      const payload = label === 'sol:critique' ? solCritiquePayload : label === 'sol:revise' ? solRevisePayload : (cfg.solNegotiate !== undefined ? cfg.solNegotiate : negSelections(cardsFromSolCodex(codexPrompt), 'sol:negotiate'))
      byteOwn[label] = { promptSha, packetSha, payload }
      return solByteEnvelope(payload, promptSha, packetSha)
    }
    if (label === 'sol:answer') return solEnvelope(solPayloads['sol:answer'])
    if (label.startsWith('thoth:receipt-check:')) {
      const leg = label.slice('thoth:receipt-check:'.length)
      if (cfg.cross && cfg.cross[leg] !== undefined) return cfg.cross[leg]
      if (leg === 'sol:critique' || leg === 'sol:revise' || leg === 'sol:negotiate') {
        const bo = byteOwn[leg] || {}
        return crossOk(bo.payload, PHASE_OF[leg], { reservation: { prompt_sha256: bo.promptSha, packet_sha256: bo.packetSha } })
      }
      if (leg.startsWith('sol:fresh:') || leg.startsWith('sol:rubric-amend:') || leg.startsWith('sol:reversibility:')) {
        const bo = byteOwn[leg]
        if (cfg.freshCrossDead && leg.startsWith('sol:fresh:')) return null // a receiptless/mute Sol cell — the cross-check finds no ledger
        return bo ? crossOk(bo.payload, bo.phaseTag, { reservation: { prompt_sha256: bo.promptSha, packet_sha256: bo.packetSha } }) : null
      }
      if (leg === 'sol:ratify:r1' || leg === 'sol:ratify:r2' || leg === 'sol:ratify:rFresh') return crossOk(solRatify[leg] || solPayloads[leg], PHASE_OF[leg])
      return crossOk(solPayloads[leg], PHASE_OF[leg])
    }
    if (label === 'thoth:seat-hashes') return { plan_a_sha256: 'a1'.repeat(32), plan_b_sha256: 'b2'.repeat(32) }
    if (label === 'diogenes:divergence') return divergenceResult
    if (label === 'plato:synthesis' || label.startsWith('plato:revise')) return synthResult
    if (label.startsWith('athena:validate')) { athenaCallN++; if (cfg.athenaFailFirst !== undefined && athenaCallN === 1) return { reasoning: 'v', verdict: 'FAIL', failed_dimensions: ['x'], fixes: [], amendments: cfg.athenaFailFirst }; return validateResult(cfg.athena || 'PASS') }
    if (label === 'thoth:ratify-anchor:r1') return cfg.anchorR1 !== undefined ? cfg.anchorR1 : { plan_sha256: renderedHash }
    if (label === 'thoth:ratify-anchor:r2') return cfg.anchorR2 !== undefined ? cfg.anchorR2 : { plan_sha256: renderedHash }
    if (label.startsWith('thoth:exec-check:')) return cfg.execCheck ? cfg.execCheck(label) : { finding_id: label.slice('thoth:exec-check:'.length), exit: 0, stdout_tail: '', stderr_tail: '' }
    if (label === 'fable:answer') return cfg.fableAnswer !== undefined ? cfg.fableAnswer : { answers: [] }
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

// the anonymous P0/P1 slots are SEED-ASSIGNED (parity of councilSeedDigest), never seat identity.
// A template edit shifts templateHash → the seed → potentially the slot, so the finding-id rows below
// DISCOVER which slot fable drew for THIS run's fixed inputs instead of hardcoding it. The DRAFTS_SEALED
// checkpoint's seat_provenance records head-per-slot (audit) — fableSlotOf reads it back.
const fableSlotOf = (calls) => { const d = parseCheckpoints(calls).find((c) => c.phase === 'DRAFTS_SEALED'); const sp = (d && d.seat_provenance) || {}; return Object.keys(sp).find((k) => sp[k] && sp[k].head === 'fable') || 'P0' }
const _slotProbe = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder())
const FSLOT = fableSlotOf(_slotProbe.calls)
const SSLOT = FSLOT === 'P0' ? 'P1' : 'P0'

// proving row: the slot assignment VARIES with the seed (not seat identity), and provenance still
// audits head-per-slot on every run. Across a spread of runTokens both P0 and P1 appear as fable's slot,
// yet every run maps exactly one slot→fable and the other→sol (blind to peers, honest to the ledger).
test('slot blindness: P0/P1 are seed-assigned (vary with the seed), never seat identity; provenance still audits head-per-slot', async () => {
  const seen = new Set()
  // The seed folds the initial ledger seq (a real seed input the receipt mock tolerates — unlike the run
  // token, which the cross-check binds). Across seqs the parity flips, so fable draws BOTH slots.
  for (let seq = 0; seq < 16; seq++) {
    const { calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ anchor: { reasoning: 'a', files: ANCHOR_FILES, initial_ledger_seq: seq } }))
    const d = parseCheckpoints(calls).find((c) => c.phase === 'DRAFTS_SEALED')
    const sp = (d && d.seat_provenance) || {}
    const fk = Object.keys(sp).find((k) => sp[k] && sp[k].head === 'fable')
    const sk = Object.keys(sp).find((k) => sp[k] && sp[k].head === 'sol')
    assert.ok(fk && sk && fk !== sk, `seq ${seq}: exactly one slot→fable and one→sol (provenance audits)`)
    assert.deepEqual([fk, sk].sort(), ['P0', 'P1'], `seq ${seq}: the two slots are P0 and P1`)
    seen.add(fk)
  }
  assert.deepEqual([...seen].sort(), ['P0', 'P1'], 'fable draws BOTH slots across seeds — the mapping is seed-derived, not fixed to seat identity')
})

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// v3.0.1 PRESERVATION
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// NOTE: a full-path T4 launch missing its runToken is NO LONGER a v301 route —
// it rules DEGRADED (dedicated test below). NOTE: T4-lite is NO LONGER a v301 route either —
// the lite plan now takes the blind required pair (dedicated section below). Only SUB-T4 (incl. sub-T4
// lite) stays v301, token or not.
const v301Cases = [
  ['no capabilityTier', { kilnDir: KILN, projectPath: PROJECT, codexAvailable: false, planning: 'dual' }, 'sub-T4 tier'],
  ['T3 tier', { kilnDir: KILN, projectPath: PROJECT, codexAvailable: true, capabilityTier: 'T3', runToken: RUNTOKEN, planning: 'dual' }, 'sub-T4 tier'],
  ['T4 but codexAvailable:false', { kilnDir: KILN, projectPath: PROJECT, codexAvailable: false, capabilityTier: 'T4', runToken: RUNTOKEN, planning: 'dual' }, 'sub-T4 tier'],
  ['sub-T4 lite (T3 + planning single)', { kilnDir: KILN, projectPath: PROJECT, codexAvailable: true, capabilityTier: 'T3', runToken: RUNTOKEN, planning: 'single' }, 'sub-T4 tier'],
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
// T4-LITE RATIFICATION — the lite pair over the SINGLE lite master plan
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// The two former v301 lite rows move HERE: T4-lite is now a council path. planning:'single' forces the
// lite fork; a token-bearing run takes ONE blind required round (no drafts, no divergence, no exchange).
const liteArgs = (extra = {}) => ({ kilnDir: KILN, projectPath: PROJECT, pluginRoot: '/plugin', codexAvailable: true, capabilityTier: 'T4', runToken: RUNTOKEN, planning: 'single', ...extra })

test('T4-lite clean: the single lite plan takes the blind required pair; dual-APPROVE seals a b42-lite/1 twin_ratified certificate', async () => {
  const { result, calls } = await runWorkflow(ARCHITECTURE, liteArgs(), makeResponder({ scope: 'trivial' }))
  const labels = labelsIn(calls)
  // the LITE fork: The Council (drafts/divergence) is SKIPPED — Plato authors alone, then the pair rules
  assert.ok(!labels.includes('fable:draft') && !labels.includes('sol:draft') && !labels.includes('confucius:plan') && !labels.includes('diogenes:divergence'), 'the lite path skips The Council + divergence')
  assert.ok(labels.includes('plato:synthesis'), 'Plato authors the single lite plan')
  // the blind lite pair + its evidence/plan anchors + the Sol cross-check all fire
  assert.ok(labels.includes('thoth:lite-council-anchor') && labels.includes('thoth:lite-ratify-anchor'), 'the lite evidence + plan anchors fire')
  assert.ok(labels.includes('fable:ratify:lite') && labels.includes('sol:ratify:lite') && labels.includes('thoth:receipt-check:sol:ratify:lite'), 'the blind lite pair + its cross-check fire')
  assert.ok(!labels.includes('fable:ratify:r1') && !labels.includes('sol:answer'), 'the lite form runs ONE round — no answer exchange, no r1/r2 legs')
  assert.equal(result.lite_path, true)
  assert.equal(result.council.path, 'twin_council', 'T4-lite is a council path (never a v301 downgrade)')
  assert.equal(result.council.eligible, true)
  assert.equal(result.council.tier, 'T4')
  assert.equal(result.council.reason, null)
  assert.equal(result.council.terminal, 'RATIFIED')
  assert.equal(result.council.terminal_record, null, 'RATIFIED carries no degraded/block record — the certificate IS the record')
  const cert = result.council.certificate
  assert.ok(cert && cert.label === 'twin_ratified', 'a lite twin_ratified certificate seals')
  assert.equal(cert.signatures.length, 2)
  assert.notEqual(canonicalJson(cert.signatures[0].seat_provenance), canonicalJson(cert.signatures[1].seat_provenance), 'the two signatures carry DISTINCT seat provenance')
  // the plan artifact IS the bundle on lite: bundle_hash = plan_hash = the plan-file sha; renderer b42-lite/1
  assert.equal(cert.artifact_hash, LITE_HASH, 'the certificate binds the lite plan-file sha as the bundle hash')
  assert.equal(cert.plan_hash, LITE_HASH, 'plan_hash equals the bundle hash on the lite path')
  assert.equal(cert.signatures[0].renderer_version, 'b42-lite/1', 'the lite signatures bind renderer b42-lite/1')
  assert.equal(cert.signatures[0].bundle_hash, LITE_HASH)
  assert.equal(cert.signatures[0].evidence_manifest_hash, evidenceManifestHash, 'the manifest hash is computed exactly as the full path (never null)')
  // the LITE_RATIFY_SEALED + RATIFIED checkpoints land; every checkpoint carries buildCheckpoint's field list
  const ckpts = parseCheckpoints(calls)
  const phases = ckpts.map((d) => d.phase)
  for (const p of ['LITE_RATIFY_SEALED', 'RATIFIED']) assert.ok(phases.includes(p), `${p} checkpoint ledgered`)
  for (const d of ckpts) {
    assert.equal(d.kind, 'council_state')
    assert.deepEqual(Object.keys(d).sort(), CKPT_KEYS, 'buildCheckpoint emits its exact field list on the lite path too')
    assert.equal(d.protocol_version, COUNCIL_PROTOCOL_VERSION)
  }
  // the Sol lite receipt is ledger-verified, invocation-exact
  const rec = result.council.receipts.find((r) => r.leg === 'sol:ratify:lite')
  assert.ok(rec && rec.receipt_verified === true && rec.ledger_verified === true, 'the sol:ratify:lite receipt is ledger-verified')
  assert.equal(rec.invocation_id, INV)
  // the Law compiles behind a valid lite certificate (precondition met)
  assert.ok(labels.includes('asimov:law'), 'the Law leg runs behind a valid lite certificate')
})

test('T4-lite tokenless: a PROMISED lite run missing runToken ⇒ council DEGRADED (never a silent v301 downgrade), plan still synthesized, Law blocked', async () => {
  const { result, calls } = await runWorkflow(ARCHITECTURE, liteArgs({ runToken: undefined }), makeResponder({ scope: 'trivial' }))
  const labels = labelsIn(calls)
  assert.equal(result.lite_path, true)
  assert.equal(result.council.path, 'twin_council', 'a PROMISED lite council is never relabeled v301 by a missing token')
  assert.equal(result.council.eligible, true)
  assert.equal(result.council.reason, 'runToken absent')
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.equal(result.council.terminal_record.missing, 'both')
  assert.match(result.council.blocked_reason, /runToken absent/)
  // a draft lite plan is still authored for the operator; NO council seat convenes without the token
  assert.ok(labels.includes('plato:synthesis'), 'the lite plan is still synthesized')
  assert.ok(!labels.includes('fable:ratify:lite') && !labels.includes('sol:ratify:lite') && !labels.includes('thoth:lite-council-anchor'), 'no lite council seat runs without the token')
  // the DEGRADED checkpoint is ledgered with a NULL run_token_hash (no phantom hash)
  const deg = parseCheckpoints(calls).find((d) => d.phase === 'DEGRADED')
  assert.ok(deg && deg.run_token_hash === null, 'the DEGRADED terminal is ledgered with a null run_token_hash')
  assert.equal(result.law_locked, false)
  assert.match(result.law_reason, /not council-ratified \(DEGRADED\)/)
})

test('T4-lite BLOCK: a live, valid seat blocks the lite plan ⇒ terminal BLOCKED (no exchange), certificate null, Law blocked', async () => {
  const blk = rat(LITE_HASH, { verdict: 'BLOCK', findings: [blockFinding] })
  const { result, calls } = await runWorkflow(ARCHITECTURE, liteArgs(), makeResponder({ scope: 'trivial', rFlite: blk }))
  const labels = labelsIn(calls)
  assert.ok(labels.includes('fable:ratify:lite') && labels.includes('sol:ratify:lite'), 'the blind lite pair ran')
  assert.equal(result.council.terminal, 'BLOCKED', 'a live valid BLOCK on the single lite plan is BLOCKED (not DEGRADED, not DEADLOCK — the lite form has no re-adjudication ladder)')
  assert.equal(result.council.certificate, null, 'no certificate on a blocked lite plan')
  assert.ok(result.council.terminal_record && result.council.terminal_record.label === 'council_blocked', 'the BLOCKED record is retained')
  assert.ok(result.council.terminal_record.findings.length >= 1, 'the blocking finding rides the record')
  assert.ok(parseCheckpoints(calls).some((d) => d.phase === 'BLOCKED'), 'the BLOCKED terminal checkpoint is ledgered')
  assert.equal(result.law_locked, false)
  assert.match(result.law_reason, /not council-ratified \(BLOCKED\)/)
})

test('T4-lite F2: an empty BLOCK is a shape-invalid verdict ⇒ DEGRADED (a missing head, never a silent BLOCKED)', async () => {
  const { result } = await runWorkflow(ARCHITECTURE, liteArgs(), makeResponder({ scope: 'trivial', rFlite: rat(LITE_HASH, { verdict: 'BLOCK' }) }))
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.equal(result.council.terminal_record.missing, 'fable')
  assert.match(result.council.blocked_reason, /no findings/)
})

test('T4-lite dead Sol seat: an invalid receipt on the lite Sol leg ⇒ DEGRADED, certificate null, Law blocked, never a sonnet stand-in', async () => {
  const { result, calls } = await runWorkflow(ARCHITECTURE, liteArgs(), makeResponder({ scope: 'trivial', sRlite: solEnvelope(rat(LITE_HASH), { reported_model: 'gpt-5.5' }) }))
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.equal(result.council.terminal_record.missing, 'sol')
  assert.equal(result.council.certificate, null)
  assert.ok(labelsIn(calls).includes('fable:ratify:lite'), 'the lite pair was attempted')
  const rec = result.council.receipts.find((r) => r.leg === 'sol:ratify:lite')
  assert.ok(rec && rec.receipt_verified === false, 'the dead Sol lite seat is receipt_verified:false')
  assert.equal(result.law_locked, false)
  assert.match(result.law_reason, /not council-ratified \(DEGRADED\)/)
})

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// BLINDNESS RAILS — clean round + the full exchange/r2 legs (F12)
// ══════════════════════════════════════════════════════════════════════════════════════════════════
const blockFinding = { finding_id: 'F-001-P1-001', claim: 'milestone M1 hides an unbounded unknown', required_change: 'split M1 into two verifiable slices', evidence_refs: ['master-plan.md'], evidence_class: 'scenario', executable_check: null }
const solBlockFinding = { finding_id: 'F-010-P0-001', claim: 'a decision violates the constraints', required_change: 'align M1 with the constraint doc', evidence_refs: ['arch-constraints.md'], evidence_class: 'repo_state', executable_check: null }
// the SCRIPT re-keys ratify findings to canonical R-<round>-<slot>-<nnn> (slot P0 = fable,
// P1 = sol) — the identity through the exchange/exec-check/standing-block/RATIFY_2. The model finding_id is
// a label. A single fable block ⇒ R-1-<fableSlot>-001, a single sol block ⇒ R-1-<solSlot>-001 (the
// slots are seed-assigned — discovered as FSLOT/SSLOT above, never hardcoded to seat identity).
const R1P0 = `R-1-${FSLOT}-001`, R1P1 = `R-1-${SSLOT}-001`
// execCheck echoing the R-key the runner leg was asked to report (label = thoth:exec-check:<R-key>).
const execExit = (exit) => (label) => ({ finding_id: label.slice('thoth:exec-check:'.length), exit, stdout_tail: '', stderr_tail: '' })
// amend fixtures: an ACCEPTED ratify-exchange correction amends the BUNDLE structurally
// via its typed { target_kind, key, replacement } descriptor (plato is retired). A converged front-half
// SETTLES one organic decision ('palette') both heads authored identically — the target the correction
// amends. The re-render (render-scribe/render-hash) rehashes the amended bundle; RATIFY_2 rules the new hash.
const paletteEntry = (choice) => ({ topic: 'palette', value: { choice }, slot: 'P0P1', ordinal: 0 })
const paletteDecision = { id: 'd1', topic: 'palette', value: { choice: 'dark' } }
const amendRevise = { fableRevise: { dispositions: [], decisions: [paletteDecision] }, solRevise: { dispositions: [], decisions: [paletteDecision], revised_plan_markdown: '# revised b\n' } }
const PALETTE_AMENDED = t4BundleOf({ settled: [paletteEntry('light')] }).hash
const PALETTE_AMENDED_PLAN = renderedPlanHashOf({ settled: [paletteEntry('light')] })
const blockWithDescriptor = { ...blockFinding, target_kind: 'settled_decision', key: 'palette', replacement: { choice: 'light' } }
const solBlockWithDescriptor = { ...solBlockFinding, target_kind: 'settled_decision', key: 'palette', replacement: { choice: 'light' } }

test('T4 blindness: fable prompts hide codex/receipt/session and the run token; sol prompts hide the peer; the seed never leaves the script', async () => {
  // both heads BLOCK so every exchange/r2 leg runs — the blindness rails must hold on ALL of them (F12)
  const cfg = {
    rF1: rat(null, { verdict: 'BLOCK', findings: [blockFinding] }),
    rS1: rat(null, { verdict: 'BLOCK', findings: [solBlockFinding] }),
    solAnswer: { answers: [{ finding_id: R1P0, answer: 'REFUTE', evidence_refs: ['x'] }] },
    fableAnswer: { answers: [{ finding_id: R1P1, answer: 'REFUTE', evidence_refs: ['y'] }] },
    rF2: rat(null, { verdict: 'BLOCK', findings: [blockFinding] }),
    rS2: rat(null, { verdict: 'BLOCK', findings: [solBlockFinding] }),
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
test('T4 FABLE-origin BLOCK→exchange→re-verdict: an ACCEPTED correction amends the bundle STRUCTURALLY; a re-approve WITH changed_evidence seals over the AMENDED bundle (+ F10 exchange checkpoint)', async () => {
  const solAnswerPayload = { answers: [{ finding_id: R1P0, answer: 'ACCEPT', evidence_refs: ['ok'] }] }
  const cfg = {
    ...amendRevise,
    rF1: rat(null, { verdict: 'BLOCK', findings: [blockWithDescriptor] }),
    solAnswer: solAnswerPayload,
    rF2: rat(null, { changed_evidence: [{ finding_id: R1P0, class: 'scenario', refs: ['re-ran the risk model'] }] }),
  }
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  const labels = labelsIn(calls)
  assert.ok(labels.includes('sol:answer'), 'the OTHER head (Sol) answers fable\'s blocking finding')
  assert.ok(labels.includes('thoth:receipt-check:sol:answer'), 'the answer leg is receipt cross-checked')
  assert.ok(!labels.some((l) => l.startsWith('plato:revise')), 'plato is retired — the accepted correction amends the bundle, it never triggers a free rewrite')
  // the accepted descriptor drives a SECOND render-scribe (the amended bundle re-renders + rehashes)
  assert.equal(countLabel(calls, 'thoth:render-scribe'), 2, 'the amendment re-renders master-plan.md from the amended bundle (a second scribe leg)')
  assert.ok(labels.includes('fable:ratify:r2') && labels.includes('sol:ratify:r2'), 'a blind re-verdict runs')
  assert.equal(result.council.terminal, 'RATIFIED')
  assert.equal(result.council.certificate.artifact_hash, PALETTE_AMENDED, 'the certificate binds the AMENDED bundle hash')
  assert.equal(result.council.certificate.plan_hash, PALETTE_AMENDED_PLAN, 'the certificate binds the RESULTING (re-rendered) plan hash')
  // F10: ANSWER_EXCHANGE_SEALED carries the paired answer artifacts + the Sol answer receipt hash
  const ex = parseCheckpoints(calls).find((d) => d.phase === 'ANSWER_EXCHANGE_SEALED')
  assert.ok(ex, 'ANSWER_EXCHANGE_SEALED is ledgered')
  assert.equal(ex.anonymous_seat_artifact_hashes.P0, sha256Hex(canonicalJson({ answers: [] })), 'P0 = the (empty) fable answer set, hashed honestly')
  assert.equal(ex.anonymous_seat_artifact_hashes.P1, sha256Hex(canonicalJson(solAnswerPayload)), 'P1 = the sol answer payload hash')
  assert.equal(ex.codex_receipt_hash, rshaOf(validReceipt(solAnswerPayload)), 'the Sol answer leg\'s LEDGER receipt hash rides the checkpoint')
  assert.equal(ex.seat_provenance.P1.head, 'sol', 'the sol answer-leg provenance rides the checkpoint')
  // the exchange barrier is bound to the PRE-amendment bundle and seals BEFORE the
  // correction amends + rehashes (the sealed record never absorbs a post-hoc amendment).
  const sealIdx = calls.findIndex((c) => c.label === 'thoth:council-ledger' && c.prompt.includes('ANSWER_EXCHANGE_SEALED'))
  const scribeIdxs = calls.map((c, i) => c.label === 'thoth:render-scribe' ? i : -1).filter((i) => i !== -1)
  assert.ok(sealIdx !== -1 && scribeIdxs.length === 2, 'the exchange seal + the two render legs ran')
  assert.ok(sealIdx < scribeIdxs[1], 'the exchange seals BEFORE the amendment re-render')
})

test('T4 SOL-origin BLOCK→exchange→re-verdict: fable answers; an ACCEPTED correction amends the bundle; sol\'s re-approve WITH changed_evidence ratifies (F12)', async () => {
  const cfg = {
    ...amendRevise,
    rS1: rat(null, { verdict: 'BLOCK', findings: [solBlockWithDescriptor] }),
    fableAnswer: { answers: [{ finding_id: R1P1, answer: 'ACCEPT', evidence_refs: ['ok'] }] },
    rS2: rat(null, { changed_evidence: [{ finding_id: R1P1, class: 'repo_state', refs: ['constraint aligned'] }] }),
  }
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.ok(labelsIn(calls).includes('fable:answer'), 'the OTHER head (Fable) answers sol\'s blocking finding')
  assert.ok(!labelsIn(calls).includes('sol:answer'), 'no sol answer leg when fable raised nothing')
  assert.equal(result.council.terminal, 'RATIFIED')
  assert.equal(result.council.certificate.artifact_hash, PALETTE_AMENDED, 'the certificate binds the AMENDED bundle hash')
})

test('T4 anti-capitulation (fable origin): a re-approve WITHOUT changed_evidence ⇒ COUNCIL_DEADLOCK, RATIFY_2_SEALED first, Law blocked', async () => {
  const cfg = {
    rF1: rat(null, { verdict: 'BLOCK', findings: [blockFinding] }),
    solAnswer: { answers: [{ finding_id: R1P0, answer: 'REFUTE', evidence_refs: ['nope'] }] },
    rF2: rat(null), // fable APPROVES but carries NO changed_evidence — the prior block STANDS
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
    rS1: rat(null, { verdict: 'BLOCK', findings: [solBlockFinding] }),
    fableAnswer: { answers: [{ finding_id: R1P1, answer: 'REFUTE', evidence_refs: ['no'] }] },
    rS2: rat(null), // sol APPROVES without changed_evidence — its own block stands
  }
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.equal(result.council.terminal, 'COUNCIL_DEADLOCK')
  assert.equal(result.council.certificate, null)
})

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// F2 — empty / duplicate / evidence-free BLOCK verdicts are INVALID (⇒ DEGRADED)
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('T4 F2: an empty BLOCK is an invalid verdict ⇒ DEGRADED (a standing-free block can never be approved past)', async () => {
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ rF1: rat(null, { verdict: 'BLOCK' }) }))
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.equal(result.council.terminal_record.missing, 'fable')
  assert.match(result.council.blocked_reason, /no findings/)
})

test('T4 F2: duplicate finding ids within one verdict ⇒ DEGRADED', async () => {
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ rF1: rat(null, { verdict: 'BLOCK', findings: [blockFinding, blockFinding] }) }))
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.match(result.council.blocked_reason, /duplicate finding_id/)
})

test('T4 F2: an evidence-free finding (no refs, no check) invalidates the verdict ⇒ DEGRADED', async () => {
  const bare = { ...blockFinding, evidence_refs: [], executable_check: null }
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ rF1: rat(null, { verdict: 'BLOCK', findings: [bare] }) }))
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
    rF1: rat(null, { verdict: 'BLOCK', findings: [checkedFinding] }),
    rS1: rat(null, { verdict: 'BLOCK', findings: [solSameId] }),
    execCheck: execExit(1), // refutes FABLE's finding only
    fableAnswer: { answers: [{ finding_id: R1P1, answer: 'REFUTE', evidence_refs: ['z'] }] }, // fable answers SOL's finding
    rF2: rat(null),
    rS2: rat(null), // sol approves WITHOUT changed_evidence — under aliasing this would ratify
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
    rF1: rat(null, { verdict: 'BLOCK', findings: [checkedFinding] }),
    execCheck: execExit(1),
    rF2: rat(null),
  }
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  const labels = labelsIn(calls)
  assert.ok(labels.includes(`thoth:exec-check:${R1P0}`), 'the bounded executor runs the proposed check')
  // F9: the check text is written VERBATIM to a script file and ONE timeout wraps the whole file
  const runnerPrompt = promptOf(calls, `thoth:exec-check:${R1P0}`)
  assert.match(runnerPrompt, /WRITE the check text/, 'the runner writes the check to a file first')
  assert.match(runnerPrompt, /timeout 120 bash /, 'one timeout boundary wraps the WHOLE check file — compounds included')
  assert.ok(!labels.includes('sol:answer'), 'a check-refuted finding never enters the answer exchange')
  assert.equal(result.council.terminal, 'RATIFIED')
})

test('T4 exec-check floor: exit 0 CONFIRMS the finding — it stands as executed_check into RATIFY_2 (typed exchange evidence, no tails)', async () => {
  const cfg = {
    rF1: rat(null, { verdict: 'BLOCK', findings: [checkedFinding] }),
    execCheck: (label) => ({ finding_id: label.slice('thoth:exec-check:'.length), exit: 0, stdout_tail: 'SECRET-STDOUT-TAIL', stderr_tail: 'SECRET-STDERR-TAIL' }),
    solAnswer: { answers: [{ finding_id: R1P0, answer: 'REFUTE', evidence_refs: ['disagree'] }] },
    rF2: rat(null), // approve without changed_evidence — the CONFIRMED (executed_check) block stands
  }
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.ok(labelsIn(calls).includes('sol:answer'), 'a confirmed finding is answered by the OTHER head')
  assert.equal(result.council.terminal, 'COUNCIL_DEADLOCK', 'a confirmed block not reversed with evidence deadlocks')
  // the round-two head sees its OWN finding (claim/required_change/refs/class),
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
      rF1: rat(null, { verdict: 'BLOCK', findings: [checkedFinding] }),
      execCheck: execExit(infraExit),
      solAnswer: { answers: [{ finding_id: R1P0, answer: 'REFUTE', evidence_refs: ['x'] }] },
      rF2: rat(null), // approve without changed_evidence — the standing proposed_check block deadlocks
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
    rF1: rat(null, { verdict: 'BLOCK', findings: [checkedFinding] }),
    execCheck: execExit(3),
    rF2: rat(null),
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
    rF1: rat(null, { verdict: 'BLOCK', findings: [checkedFinding] }),
    execCheck: execExit(3),
    rF2: rat(null),
  }
  const { calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  const OUT = `${KILN}/council/master_plan/DRAFTS-sol-a1.out`
  const cross = promptOf(calls, 'thoth:receipt-check:sol:draft')
  assert.ok(cross.includes(`sha256sum "${OUT}"`), 'the sha256sum path is quoted')
  assert.ok(cross.includes(`"${OUT}"`), 'the canonical-hash one-liner path is quoted')
  assert.ok(cross.includes(`"${KILN}/council/receipts.jsonl"`), 'the ledger path is quoted')
  const runner = promptOf(calls, 'thoth:exec-check:R-1-P0-001')
  assert.ok(runner.includes(`cd "${PROJECT}" && timeout 120 bash "`), 'the runner cd + check-file paths are quoted')
  assert.ok(runner.includes(`mkdir -p "${KILN}/council/master_plan"`), 'the runner mkdir path is quoted')
  const wrapper = promptOf(calls, 'sol:draft')
  assert.ok(wrapper.includes(`"${OUT}" "${KILN}/plans/plan-b.md"`), 'the extractor paths are quoted')
})

test('T4 F9: an id-MISMATCHED executor transcript leaves the finding standing as proposed_check (never refuted, never executed)', async () => {
  const cfg = {
    rF1: rat(null, { verdict: 'BLOCK', findings: [checkedFinding] }),
    execCheck: () => ({ finding_id: 'WRONG-ID', exit: 1, stdout_tail: '', stderr_tail: '' }), // garbled transcript
    solAnswer: { answers: [{ finding_id: R1P0, answer: 'REFUTE', evidence_refs: ['x'] }] },
    rF2: rat(null), // approve without changed_evidence — the standing proposed_check block deadlocks
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
    rF1: rat(null, { verdict: 'BLOCK', findings: [blockFinding] }),
    solAnswer: { answers: [] }, // sol fails its duty
  }
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.equal(result.council.terminal_record.missing, 'sol')
  assert.match(result.council.blocked_reason, /unanswered/)
})

test('T4 F8: an evidence-free REFUTE answer ⇒ DEGRADED naming the answering head', async () => {
  const cfg = {
    rS1: rat(null, { verdict: 'BLOCK', findings: [solBlockFinding] }),
    fableAnswer: { answers: [{ finding_id: R1P1, answer: 'REFUTE', evidence_refs: [] }] },
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
    rF1: rat(null, nF),
    rS1: rat(null, nF),
    fableAnswer: { answers: [{ finding_id: R1P1, answer: 'REFUTE', evidence_refs: ['x'] }] },
    solAnswer: { answers: [{ finding_id: R1P0, answer: 'REFUTE', evidence_refs: ['y'] }] },
    rF2: rat(null, nF),
    rS2: rat(null, nF),
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
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ sR1: solEnvelope(rat(null), { reported_model: 'gpt-5.5' }) }))
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

test('T4 F3: the amendment RE-RENDER byte-compare fails (a stale/wrong post-amendment hash) ⇒ DEGRADED scribe-write failure — the stale pre-amendment hash is NEVER reused', async () => {
  const cfg = {
    ...amendRevise,
    rF1: rat(null, { verdict: 'BLOCK', findings: [blockWithDescriptor] }),
    solAnswer: { answers: [{ finding_id: R1P0, answer: 'ACCEPT', evidence_refs: ['ok'] }] },
    badSecondRender: true, // the amended bundle's re-render file-hash disagrees with the rendered bytes
  }
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.match(result.council.blocked_reason, /scribe-write failure/)
  assert.equal(result.council.certificate, null, 'no certificate can bind an unverified amended plan')
  assert.ok(!labelsIn(calls).includes('fable:ratify:r2'), 'no re-verdict when the amended-plan re-render fails its byte-compare')
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
  // on the T4-full RENDERED path an Athena FAIL that carries NO typed bundle amendment
  // cannot be expressed structurally ⇒ GATED_ESCALATION (the honest terminal — never a free plato rewrite);
  // the council never reaches ratify (Athena, not the council, blocked it) and the Law precondition holds.
  assert.equal(result.council.terminal, 'GATED_ESCALATION', 'an Athena FAIL with no typed amendment gates the escalation, before ratify')
  assert.match(result.law_reason, /never reached Athena PASS/, 'the pre-existing Athena precondition still fires first')
})

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// DEBATE FRONT-HALF — W1 critique · W2 revision · W3 mechanical divergence (+ byte-ownership)
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// A P0-targeting critique (sol critiques P0 = fable's draft), keyed F-001-P0-001 by canonicalizeFindings.
const critFindingP0 = { target_decision_id: 'M1', claim: 'milestone M1 hides an unbounded unknown', required_change: 'split M1 into two verifiable slices', severity: 'blocking', evidence: { class: 'scenario', refs: ['vision'] } }

test('clean: the critique→revision→divergence front-half runs before The Lantern; a converged debate ⇒ NEGOTIATION_SKIPPED, then ratify (RATIFIED)', async () => {
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder())
  const labels = labelsIn(calls)
  for (const l of ['thoth:council-resume', 'fable:critique', 'sol:critique', 'thoth:receipt-check:sol:critique', 'fable:revise', 'sol:revise', 'thoth:receipt-check:sol:revise']) {
    assert.ok(labels.includes(l), `${l} runs on the T4 full path`)
  }
  // the debate revises the drafts BEFORE the deterministic renderer authors master-plan.md (the swap:
  // the renderer replaced plato on the T4-full path — no plato:synthesis leg runs here anymore)
  assert.ok(calls.findIndex((c) => c.label === 'sol:revise') < calls.findIndex((c) => c.label === 'diogenes:divergence'), 'the revision seals before The Lantern reads the plans')
  assert.ok(!labels.includes('plato:synthesis'), 'plato is retired on the T4-full path — the renderer authors the plan')
  assert.ok(calls.findIndex((c) => c.label === 'sol:revise') < calls.findIndex((c) => c.label === 'thoth:render-scribe'), 'the revised drafts feed the deterministic renderer where plato once sat')
  const ck = parseCheckpoints(calls).map((d) => d.phase)
  for (const p of ['DRAFTS_SEALED', 'CRITIQUES_SEALED', 'REVISIONS_SEALED', 'NEGOTIATION_SKIPPED']) assert.ok(ck.includes(p), `${p} checkpoint ledgered`)
  assert.ok(!ck.includes('DIVERGENCES_BUILT'), 'a converged debate early-stops (empty divergence set) — no DIVERGENCES_BUILT')
  assert.equal(result.council.terminal, 'RATIFIED', 'rejoins the existing ratify flow unchanged')
  // the two new byte-owned Sol legs each carry a ledger-verified receipt
  assert.ok(result.council.receipts.find((r) => r.leg === 'sol:critique' && r.receipt_verified === true && r.ledger_verified === true), 'sol:critique is ledger-verified')
  assert.ok(result.council.receipts.find((r) => r.leg === 'sol:revise' && r.receipt_verified === true && r.ledger_verified === true), 'sol:revise is ledger-verified')
  for (const d of parseCheckpoints(calls)) assert.deepEqual(Object.keys(d).sort(), CKPT_KEYS, 'every debate checkpoint emits buildCheckpoint\'s exact field list')
})

test('W1: findings are SCRIPT-canonicalized (F-<seq>-<slot>-<NNN>); each head disposes ONLY its own-slot findings', async () => {
  const F1 = `F-001-${FSLOT}-001`
  const cfg = { solCritique: { findings: [critFindingP0] }, fableRevise: { dispositions: [{ finding_id: F1, disposition: 'accepted', incorporated_at: ['M1a'] }], decisions: [] } }
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  // sol critiqued fable's draft; the SCRIPT keys the finding F-001-<fableSlot>-001 and shows it to fable (revising its OWN slot)
  assert.match(promptOf(calls, 'fable:revise'), new RegExp(F1), 'fable (revising its own slot) sees the script-canonical finding id against it')
  assert.doesNotMatch(promptOf(calls, 'sol:revise'), new RegExp(F1), 'sol (revising the other slot) never sees fable\'s-slot finding — exact per-slot coverage')
  // fable ACCEPTED + incorporated the only finding ⇒ retired ⇒ empty divergence set ⇒ NEGOTIATION_SKIPPED
  assert.ok(parseCheckpoints(calls).map((d) => d.phase).includes('NEGOTIATION_SKIPPED'), 'an accepted+incorporated finding retires — the set is empty')
  assert.equal(result.council.terminal, 'RATIFIED')
})

test('W3: an UNRESOLVED finding builds a mechanical divergence set ⇒ DIVERGENCES_BUILT + note{kind:divergence} carrying a seed-bound DV id', async () => {
  const cfg = { solCritique: { findings: [critFindingP0] }, fableRevise: { dispositions: [{ finding_id: `F-001-${FSLOT}-001`, disposition: 'unresolved' }], decisions: [] } }
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  const ck = parseCheckpoints(calls).map((d) => d.phase)
  assert.ok(ck.includes('DIVERGENCES_BUILT'), 'a live divergence seals DIVERGENCES_BUILT (now an intermediate — the negotiation follows)')
  assert.ok(!ck.includes('NEGOTIATION_SKIPPED'), 'a non-empty set does not early-stop')
  assert.ok(ck.includes('NEGOTIATION_SEALED'), 'a non-empty divergence set runs the one negotiation and seals NEGOTIATION_SEALED')
  assert.ok(ck.indexOf('DIVERGENCES_BUILT') < ck.indexOf('NEGOTIATION_SEALED'), 'DIVERGENCES_BUILT is the intermediate before the negotiation seal')
  const divNotes = calls.filter((c) => c.label === 'thoth:ledger' && /"kind":"divergence"/.test(c.prompt))
  assert.equal(divNotes.length, 1, 'exactly one note{kind:divergence} is emitted')
  assert.match(divNotes[0].prompt, /DV-[0-9a-f]{12}/, 'the divergence carries a seed-bound DV-<12hex> id')
  assert.match(divNotes[0].prompt, /join_accounting/, 'the divergence note carries the join accounting')
  assert.equal(result.council.terminal, 'RATIFIED', 'rejoins ratify unchanged (the populated bundle is ratify\'s to consume)')
})

test('W2: an invalid disposition set (a frozen finding left uncovered) ⇒ DEGRADED naming the head', async () => {
  // fable must dispose F-001-<fableSlot>-001 but returns an EMPTY set ⇒ missing coverage ⇒ invalid ⇒ DEGRADED fable
  const cfg = { solCritique: { findings: [critFindingP0] }, fableRevise: { dispositions: [], decisions: [] } }
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.equal(result.council.terminal_record.missing, 'fable')
  assert.match(result.council.blocked_reason, /invalid disposition set at REVISION/)
  assert.ok(!labelsIn(calls).includes('fable:ratify:r1'), 'no ratification after a debate degrade')
  assert.equal(result.law_locked, false)
})

test('byte-ownership: a wrapper-altered codex-prompt byte fails the reservation-hash check ⇒ DEGRADED sol (a dead seat)', async () => {
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ byteAlter: { 'sol:critique': '9'.repeat(64) } }))
  assert.equal(result.council.terminal, 'DEGRADED', 'a byte-disowned Sol leg is a dead seat even with a consistent (altered) receipt+reservation')
  assert.equal(result.council.terminal_record.missing, 'sol')
  const rec = result.council.receipts.find((r) => r.leg === 'sol:critique')
  assert.ok(rec && rec.ledger_verified === false, 'the byte-disowned Sol critique is NOT ledger-verified')
  assert.ok(!labelsIn(calls).includes('fable:ratify:r1'), 'no ratification after the debate degrade')
})

test('required-head failure fires at EACH new phase (fable/sol × critique/revision)', async () => {
  const cases = [
    ['CRITIQUE fable', { fableCritique: null }, 'fable', /CRITIQUE/],
    ['CRITIQUE sol', { cross: { 'sol:critique': null } }, 'sol', /CRITIQUE/],
    ['REVISION fable', { fableRevise: null }, 'fable', /REVISION/],
    ['REVISION sol', { cross: { 'sol:revise': null } }, 'sol', /REVISION/],
  ]
  for (const [name, cfg, missing, re] of cases) {
    const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
    assert.equal(result.council.terminal, 'DEGRADED', `${name} ⇒ DEGRADED`)
    assert.equal(result.council.terminal_record.missing, missing, `${name} names the missing head`)
    assert.match(result.council.blocked_reason, re, `${name} reason names the phase`)
  }
})

test('blindness: the debate legs hide codex/receipt/session and the peer; the seed leaves the script for no head; the run token rides only the receipt argv', async () => {
  const { calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ solCritique: { findings: [critFindingP0] } }))
  for (const l of ['fable:critique', 'fable:revise']) {
    const p = promptOf(calls, l)
    assert.ok(p, `${l} ran`)
    assert.doesNotMatch(p, /codex/i, `${l} never mentions codex`)
    assert.doesNotMatch(p, /receipt/i, `${l} never mentions receipt`)
    assert.doesNotMatch(p, /session/i, `${l} never mentions session`)
    assert.ok(!p.includes(RUNTOKEN), `${l} never carries the raw run token`)
  }
  for (const l of ['sol:critique', 'sol:revise']) {
    const p = promptOf(calls, l)
    assert.ok(p, `${l} ran`)
    assert.doesNotMatch(p, /\bfable\b/i, `${l} never names the peer seat`)
    assert.ok(p.includes(RUNTOKEN), `${l} carries the run token in the receipt-script argv (the trusted boundary)`)
  }
})

test('preservation: neither the T4-lite path nor sub-T4 runs the debate front-half or the resume read', async () => {
  const lite = await runWorkflow(ARCHITECTURE, liteArgs(), makeResponder({ scope: 'trivial' }))
  const sub = await runWorkflow(ARCHITECTURE, { kilnDir: KILN, projectPath: PROJECT, codexAvailable: false, planning: 'dual' }, makeResponder())
  for (const r of [lite, sub]) {
    for (const l of ['fable:critique', 'sol:critique', 'fable:revise', 'sol:revise', 'thoth:council-resume', 'thoth:receipt-check:sol:critique']) {
      assert.ok(!labelsIn(r.calls).includes(l), `${l} never runs off the T4 full path`)
    }
  }
  assert.equal(lite.result.council.terminal, 'RATIFIED', 'the lite path still ratifies (byte-preserved)')
})

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// structured authorship · projection/join · negotiation · settlement · bundle (the DISCLOSED
// intermediate: plato/Athena/ratify still run unchanged; the populated bundle rides council.front_half)
// ══════════════════════════════════════════════════════════════════════════════════════════════════
const M_CORE = { title: 'Core', summary: 's', order: 1, surface: 'logic', confidence: 'high' }
// two heads authoring the SAME milestone value (different ids) with the SAME adopted SC-01 — the join
// collapses the milestone onto a shared eq: topic and the adopted SC onto sc:SC-01 (a converged run).
const convergedRevise = () => ({
  visionScText: 'SC-01\n',
  fableRevise: { dispositions: [], decisions: [], milestones: [{ id: 'M1', ...M_CORE, acceptance: [{ sc_id: 'SC-01', criterion: 'boots', executable_check: 'run' }] }] },
  solRevise: { dispositions: [], decisions: [], milestones: [{ id: 'MB1', ...M_CORE, acceptance: [{ sc_id: 'SC-01', criterion: 'boots', executable_check: 'run' }] }], revised_plan_markdown: '# revised b\n' },
})
// a P0-only unresolved finding keeps the mechanical divergence set NON-empty (so the negotiation runs).
const divergeCfg = (over = {}) => ({ solCritique: { findings: [critFindingP0] }, fableRevise: { dispositions: [{ finding_id: `F-001-${FSLOT}-001`, disposition: 'unresolved' }], decisions: [], milestones: [], ...over.fableRevise }, solRevise: { dispositions: [], decisions: [], milestones: [], revised_plan_markdown: '# b\n', ...over.solRevise }, ...over.rest })

test('projection/join happy path: structured revisions project + join (milestone→eq, adopted SC→sc:SC-01), the note carries join accounting, NEGOTIATION_SKIPPED ⇒ RATIFIED', async () => {
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(convergedRevise()))
  const labels = labelsIn(calls)
  assert.ok(labels.includes('thoth:vision-scids'), 'the VISION SC-id extraction leg fires on the T4 full path')
  const divNote = calls.find((c) => c.label === 'thoth:ledger' && /"kind":"divergence"/.test(c.prompt))
  assert.ok(divNote, 'the divergence note is emitted')
  assert.match(divNote.prompt, /"join_accounting":\[\{"kind":"milestone"/, 'the note carries the join accounting — the identical milestones joined')
  assert.match(divNote.prompt, /milestone:eq:/, 'the joined milestone rides the shared eq: topic')
  const ck = parseCheckpoints(calls).map((d) => d.phase)
  assert.ok(ck.includes('NEGOTIATION_SKIPPED'), 'a converged registry pair early-stops to NEGOTIATION_SKIPPED')
  assert.equal(result.council.terminal, 'RATIFIED', 'the flow rejoins ratify unchanged')
  const fh = result.council.front_half
  assert.ok(fh && Array.isArray(fh.settled_decisions), 'the front-half bundle rides the return with a settled ENTRIES ARRAY')
  const topics = fh.settled_decisions.map((e) => e.topic)
  assert.ok(topics.some((t) => t.startsWith('milestone:eq:')), 'the joined milestone is settled')
  assert.ok(topics.includes('sc:SC-01'), 'the adopted VISION SC settles on the shared namespace')
  assert.deepEqual(fh.open_divergences, [], 'a converged run opens no divergences')
})

test('projection typed-throw: a head\'s duplicate milestone id ⇒ DEGRADED naming the head (a per-head validation before any cross-head interaction)', async () => {
  const dupMil = [{ id: 'M1', ...M_CORE, acceptance: [] }, { id: 'M1', ...M_CORE, acceptance: [] }]
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ fableRevise: { dispositions: [], decisions: [], milestones: dupMil } }))
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.equal(result.council.terminal_record.missing, 'fable', 'the projection throw names the offending head')
  assert.match(result.council.blocked_reason, /projection failed/)
  assert.ok(!labelsIn(calls).includes('fable:ratify:r1'), 'no ratification after a projection degrade')
})

test('negotiation gate: a converged (empty divergence) run runs NO negotiation legs (skip), a non-empty set runs exactly ONE (no loop)', async () => {
  const converged = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder())
  assert.ok(!labelsIn(converged.calls).includes('fable:negotiate') && !labelsIn(converged.calls).includes('sol:negotiate'), 'a converged run skips the negotiation entirely')
  const oneSided = { id: 'M1', title: 'Solo', summary: 's', order: 1, surface: 'logic', confidence: 'high', acceptance: [{ sc_id: 'X9', criterion: 'c', executable_check: 'e' }] }
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(divergeCfg({ fableRevise: { milestones: [oneSided] } })))
  assert.equal(countLabel(calls, 'fable:negotiate'), 1, 'exactly ONE fable negotiation leg — structurally no loop')
  assert.equal(countLabel(calls, 'sol:negotiate'), 1, 'exactly ONE sol negotiation leg')
  assert.ok(labelsIn(calls).includes('thoth:receipt-check:sol:negotiate'), 'the byte-owned Sol negotiation leg is receipt cross-checked')
  assert.equal(result.council.terminal, 'RATIFIED', 'both heads settle the one-sided milestone + its SC present ⇒ closure holds ⇒ ratify')
  // anonymity end-to-end (binding invariant): the fable negotiation packet hides codex/receipt/session
  // and the run token; the sol codex prompt never names the peer; the token rides only the receipt argv.
  const fp = promptOf(calls, 'fable:negotiate')
  assert.doesNotMatch(fp, /codex/i, 'fable:negotiate never mentions codex')
  assert.doesNotMatch(fp, /receipt/i, 'fable:negotiate never mentions receipt')
  assert.doesNotMatch(fp, /session/i, 'fable:negotiate never mentions session')
  assert.ok(!fp.includes(RUNTOKEN), 'fable:negotiate never carries the raw run token')
  const sp = promptOf(calls, 'sol:negotiate')
  assert.doesNotMatch(sp, /\bfable\b/i, 'sol:negotiate never names the peer seat')
  assert.ok(sp.includes(RUNTOKEN) && sp.includes('kiln-codex-receipt.mjs'), 'the sol negotiation token rides only the receipt-script argv (the trusted boundary)')
})

test('A2 one-sided round-trip + agreed-absent settlement: a P0-only milestone renders a {absent:true} card; both heads pick the absent side ⇒ the entry LEAVES the settled array', async () => {
  const solo = { id: 'M2', title: 'Leaves', summary: 's', order: 2, surface: 'ui', confidence: 'low', acceptance: [] }
  const cfg = divergeCfg({ fableRevise: { milestones: [solo] }, rest: { negotiate: (card) => ({ divergence_id: card.divergence_id, selection: 'P1' }) } })
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.match(promptOf(calls, 'fable:negotiate'), /"position_1":\{"absent":true\}/, 'the one-sided card renders the {absent:true} A2 marker on the empty side')
  assert.equal(result.council.terminal, 'RATIFIED')
  const fh = result.council.front_half
  assert.ok(fh && Array.isArray(fh.settled_decisions))
  assert.ok(!fh.settled_decisions.some((e) => e.topic === 'milestone:P0:M2'), 'the agreed-absent entry LEAVES the plan — never in the settled array')
  assert.equal(fh.settled_decisions.length, 0, 'nothing else settled (the finding is not a registry entry)')
})

test('packet preflight: an over-limit negotiation packet (25 cards > the 24 ceiling) ⇒ GATED_ESCALATION before dispatch (never truncated), Law blocked', async () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ id: 'M' + i, title: 'T' + i, summary: 's', order: i, surface: 'logic', confidence: 'high', acceptance: [] }))
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(divergeCfg({ fableRevise: { milestones: many } })))
  assert.equal(result.council.terminal, 'GATED_ESCALATION', 'over-limit escalates honestly (not DEGRADED, not a truncated packet)')
  assert.match(result.council.blocked_reason, /over the ceiling/)
  assert.ok(!labelsIn(calls).includes('fable:negotiate'), 'the escalation fires BEFORE any head is dispatched — the packet is never sent')
  assert.ok(parseCheckpoints(calls).some((d) => d.phase === 'GATED_ESCALATION'), 'the GATED_ESCALATION terminal is ledgered')
  assert.equal(result.law_locked, false)
  assert.match(result.law_reason, /not council-ratified \(GATED_ESCALATION\)/)
})

test('negotiation seat-death: a dead fable negotiation seat ⇒ DEGRADED naming fable, Law blocked', async () => {
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(divergeCfg({ rest: { fableNegotiate: null } })))
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.equal(result.council.terminal_record.missing, 'fable')
  assert.match(result.council.blocked_reason, /NEGOTIATION/)
  assert.ok(!labelsIn(calls).includes('fable:ratify:r1'), 'no ratification after a negotiation degrade')
  assert.equal(result.law_locked, false)
})

test('closure(a) violation: settling an SC whose parent milestone was ruled absent ⇒ orphan_sc ⇒ DEGRADED loud', async () => {
  const milWithSc = { id: 'M1', title: 'Solo', summary: 's', order: 1, surface: 'logic', confidence: 'high', acceptance: [{ sc_id: 'X9', criterion: 'c', executable_check: 'e' }] }
  const cfg = divergeCfg({ fableRevise: { milestones: [milWithSc] }, rest: { negotiate: (card) => ({ divergence_id: card.divergence_id, selection: card.topic.startsWith('milestone:') ? 'P1' : 'P0' }) } })
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.equal(result.council.terminal, 'DEGRADED', 'a settled SC orphaned by its absent parent milestone fails closure closed')
  assert.equal(result.council.terminal_record.missing, 'both')
  assert.match(result.council.blocked_reason, /closure violated/)
})

test('bundle determinism: the same settlement ⇒ the same bundle hash; settled_decisions IS the entries array; the front-half barrier carries the hash', async () => {
  const r1 = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(convergedRevise()))
  const r2 = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(convergedRevise()))
  const fh1 = r1.result.council.front_half, fh2 = r2.result.council.front_half
  assert.equal(fh1.bundle_hash, fh2.bundle_hash, 'the same settlement re-derives the same bundle hash')
  assert.ok(Array.isArray(fh1.settled_decisions) && fh1.settled_decisions.length >= 1, 'settled_decisions is the settled ENTRIES ARRAY')
  for (const e of fh1.settled_decisions) assert.ok(typeof e.topic === 'string' && Object.prototype.hasOwnProperty.call(e, 'value') && typeof e.slot === 'string', 'each settled entry carries topic/value/slot provenance')
  const skip = parseCheckpoints(r1.calls).find((d) => d.phase === 'NEGOTIATION_SKIPPED')
  assert.equal(skip.decision_bundle_hash, fh1.bundle_hash, 'the front-half barrier carries the decision_bundle_hash')
})

test('dup organic decision id: a head\'s duplicate revised decision id ⇒ DEGRADED naming the head (no silent dedupe on the T4 path)', async () => {
  const cfg = { fableRevise: { dispositions: [], decisions: [{ id: 'D1', topic: 't', value: 1 }, { id: 'D1', topic: 't2', value: 2 }], milestones: [] } }
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.equal(result.council.terminal_record.missing, 'fable', 'the duplicate-id throw names the offending head')
  assert.match(result.council.blocked_reason, /duplicate organic decision id 'D1'/)
  assert.ok(!labelsIn(calls).includes('fable:ratify:r1'), 'no ratification after a dup-id degrade — the divergence/projection never runs on a silent dedupe')
})

test('agreed NEITHER stays OPEN: both heads NEITHER a card ⇒ it rides open_divergences (never a silent deletion); an agreed absent side still rules an entry out', async () => {
  // a real two-sided card (palette dark vs light): both heads select NEITHER at the negotiation ⇒ the card
  // stays OPEN in the front-half bundle (ratify then resolves it). Before the fix NEITHER silently dropped it.
  const cfg = {
    fableRevise: { dispositions: [], decisions: [{ id: 'd1', topic: 'palette', value: { c: 'dark' } }], milestones: [] },
    solRevise: { dispositions: [], decisions: [{ id: 'd1', topic: 'palette', value: { c: 'light' } }], milestones: [], revised_plan_markdown: '# b\n' },
    negotiate: (card) => ({ divergence_id: card.divergence_id, selection: 'NEITHER' }),
    ratSel: 'P0', // ratify then resolves the surviving open card so the run reaches a terminal
  }
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  const fh = result.council.front_half
  assert.ok(fh && fh.open_divergences.length >= 1, 'an agreed NEITHER keeps the card OPEN — it rides open_divergences to ratification')
})

test('cardinality-neutral RATIFY_TASK: the ratify task no longer hardcodes "[]" — it covers EXACTLY the bound open set', async () => {
  const { calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder())
  const p = promptOf(calls, 'fable:ratify:r1')
  assert.match(p, /divergence_selections must cover EXACTLY the open divergences named in the binding/, 'the ratify task is cardinality-neutral')
  assert.doesNotMatch(p, /divergence_selections is \[\] \(no open divergences this round\)/, 'the old contradictory hardcoded-[] text is gone')
})

test('zero-adds final render: cards existed but every ratify selection is NEITHER (zero adds) ⇒ the bundle rebuilds open_divergences:[] + RE-RENDERS (no OPEN blocks in the certified plan)', async () => {
  const cfg = {
    fableRevise: { dispositions: [], decisions: [{ id: 'd1', topic: 'palette', value: { c: 'dark' } }], milestones: [] },
    solRevise: { dispositions: [], decisions: [{ id: 'd1', topic: 'palette', value: { c: 'light' } }], milestones: [], revised_plan_markdown: '# b\n' },
    negotiate: (card) => ({ divergence_id: card.divergence_id, selection: 'NEITHER' }), // the card stays open into ratify
    ratSel: 'NEITHER', // both heads APPROVE but select NEITHER for the open card ⇒ zero adds
  }
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.equal(result.council.terminal, 'RATIFIED', 'a zero-adds dual-APPROVE still ratifies over the deterministic FINAL render')
  assert.ok(countLabel(calls, 'thoth:render-scribe') >= 2, 'the FINAL plan is re-rendered (open_divergences:[]) even with zero adds — a second render-scribe fires, so no OPEN block survives into the certificate')
})

test('schema bounds: an organic decision value over the per-value projection ceiling ⇒ DEGRADED (never truncated/summarized)', async () => {
  const big = 'x'.repeat(9000) // > the 8 KiB per-value ceiling
  const cfg = { fableRevise: { dispositions: [], decisions: [{ id: 'D1', topic: 't', value: { pad: big } }], milestones: [] } }
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.match(result.council.blocked_reason, /over the .* per-value ceiling/)
})

test('per-sample probe framing (high tier): the three samples of a cell get DISTINCT prompts (framing varies + rides the frozen packet)', async () => {
  const { calls } = await runWorkflow(ARCHITECTURE, t4Args({ freshRoundTier: 'high' }), makeResponder(ladderCfg({ freshPrefer: { choice: 'dark' } })))
  const fableFresh = calls.filter((c) => c.label.startsWith('fable:fresh:'))
  assert.equal(fableFresh.length, 12, 'high tier: 3 samples × 4 cells = 12 fable cells')
  const s0 = fableFresh.filter((c) => c.prompt.includes('sample 0'))
  const s2 = fableFresh.filter((c) => c.prompt.includes('sample 2'))
  assert.ok(s0.length >= 1 && s2.length >= 1, 'the low (sample 0) and moderate (sample 2) framings are both present')
  assert.ok(s2.every((c) => /MODERATE variance/.test(c.prompt)), 'sample 2 is the moderate-variance instability probe — genuinely varied, never a byte-identical duplicate')
  assert.notEqual(s0[0].prompt, s2[0].prompt, 'the samples of a cell are byte-distinct')
})

test('rubric rung: the Sol rubric-amend leg is byte-owned (cross-checked), the dual-signed clarification rides every RERULE cell + its hash is frozen in RUBRIC_CHECK', async () => {
  const clar = 'axis 4 ranks executable checks above prose'
  let ruleN = 0
  const cfg = ladderCfg({
    freshCell: (head, K, M) => { const dark = canonicalJson(K) === canonicalJson({ choice: 'dark' }); ruleN++; return ruleN > 8 ? { choice: dark ? 'K' : 'M' } : (head === 'fable' ? { choice: dark ? 'K' : 'M' } : { choice: dark ? 'M' : 'K' }) },
    referenceReduction: () => ({ settles: false, adopt: null, reference: null, executable_check: null }),
    rubricAmend: () => ({ sign: true, clarification: clar }),
  })
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.ok(labelsIn(calls).some((l) => l.startsWith('thoth:receipt-check:sol:rubric-amend:')), 'the Sol rubric-amend leg is invocation-exact cross-checked (ledger_verified, not receipt_verified alone)')
  const rubricIdx = calls.findIndex((c) => c.label.startsWith('fable:rubric-amend:'))
  const rerule = calls.filter((c, i) => i > rubricIdx && c.label.startsWith('fable:fresh:'))
  assert.ok(rerule.length >= 1 && rerule.every((c) => c.prompt.includes(clar)), 'every rerule cell rules under COUNCIL_RUBRIC + the identical dual-signed clarification')
  const rc = parseCheckpoints(calls).find((d) => d.phase === 'RUBRIC_CHECK')
  assert.ok(rc && rc.seat_provenance.dual_signed === true && typeof rc.seat_provenance.clarification_hash === 'string', 'the RUBRIC_CHECK barrier freezes the dual-signed clarification hash')
  assert.equal(result.council.terminal, 'RATIFIED')
})

test('provisional resolution exposes a certificate + seals a DEADLOCK_RESOLVED master_plan row (build detects exactly this row)', async () => {
  const cfg = ladderCfg({
    freshCell: (head, K, M) => { const dark = canonicalJson(K) === canonicalJson({ choice: 'dark' }); return head === 'fable' ? { choice: dark ? 'K' : 'M' } : { choice: dark ? 'M' : 'K' } },
    referenceReduction: () => ({ settles: false, adopt: null, reference: null, executable_check: null }),
    rubricAmend: () => ({ sign: false, clarification: null }),
    reversibility: () => ({ P0: 'reversible', P1: 'irreversible' }),
  })
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.equal(result.council.terminal, 'DEADLOCK_RESOLVED')
  assert.ok(result.council.certificate && result.council.certificate.adopted_side === 'P0', 'the provisional resolution EXPOSES its canonical certificate (never null)')
  const dr = parseCheckpoints(calls).find((d) => d.phase === 'DEADLOCK_RESOLVED' && d.keystone_id === 'master_plan')
  assert.ok(dr && dr.status === 'sealed', 'a sealed DEADLOCK_RESOLVED master_plan checkpoint is emitted (build\'s legacy-detection reads exactly this row — no misclassification as legacy)')
})

test('ladder partition: EVERY reference-unsettled card proceeds through reversibility (loop, not [0]); TWO opposed divergences both adopt provisionally ⇒ ONE twin_deadlock_resolved over the FULL combination (neither dropped)', async () => {
  // two two-sided decisions, both opposed at negotiation AND ratify AND the fresh round (stable opposition);
  // reference fails, rubric unsigned, reversibility one-reversible on BOTH ⇒ both must reach reversibility.
  const cfg = ladderCfg({
    fableRevise: { dispositions: [], decisions: [{ id: 'd1', topic: 'palette', value: { c: 'dark' } }, { id: 'd2', topic: 'layout', value: { l: 'a' } }] },
    solRevise: { dispositions: [], decisions: [{ id: 'd1', topic: 'palette', value: { c: 'light' } }, { id: 'd2', topic: 'layout', value: { l: 'b' } }], revised_plan_markdown: '# b\n' },
    // stable opposition on ANY decision: fable adopts the lexicographically-first option's content, sol the other
    freshCell: (head, K, M) => { const first = canonicalJson(K) < canonicalJson(M) ? K : M; const kFirst = canonicalJson(K) === canonicalJson(first); return head === 'fable' ? { choice: kFirst ? 'K' : 'M' } : { choice: kFirst ? 'M' : 'K' } },
    referenceReduction: () => ({ settles: false, adopt: null, reference: null, executable_check: null }),
    rubricAmend: () => ({ sign: false, clarification: null }),
    reversibility: () => ({ P0: 'reversible', P1: 'irreversible' }),
  })
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.equal(result.council.terminal, 'DEADLOCK_RESOLVED')
  assert.equal(calls.filter((c) => c.label.startsWith('fable:reversibility:')).length, 2, 'BOTH opposed cards reach reversibility — the loop processes every reference-unsettled card, never just refUnsettled[0]')
  assert.equal(result.council.certificate.adopted.length, 2, 'the certificate NAMES both provisional adoptions — neither divergence is silently dropped')
  assert.equal(result.council.terminal_record.certificate.mel.open_issues.length, 4, 'the combined MEL carries two open issues per provisional card')
})

test('fresh-ratify rails: a live BLOCK at RATIFY_FRESH ⇒ honest COUNCIL_DEADLOCK (never a certificate); a shape-invalid verdict ⇒ DEGRADED', async () => {
  const liveBlock = rat(null, { verdict: 'BLOCK', findings: [{ finding_id: 'x', claim: 'the adopted plan is still broken', required_change: 'reconsider', evidence_refs: ['e'], evidence_class: 'scenario', executable_check: null }] })
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(ladderCfg({ freshPrefer: { choice: 'dark' }, rFfresh: liveBlock, rSfresh: liveBlock })))
  assert.equal(result.council.terminal, 'COUNCIL_DEADLOCK', 'a valid live BLOCK at the fresh ratify is an honest deadlock — never certificate degradation')
  assert.equal(result.council.certificate, null, 'no certificate is minted on a live fresh-round block')
  const malformed = rat(null, { verdict: 'BLOCK', findings: [{ finding_id: 'y', claim: 'defect', required_change: 'fix', evidence_refs: [], evidence_class: 'scenario', executable_check: null }] }) // evidence-free ⇒ shape-invalid
  const r2 = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(ladderCfg({ freshPrefer: { choice: 'dark' }, rFfresh: malformed, rSfresh: malformed })))
  assert.equal(r2.result.council.terminal, 'DEGRADED', 'a shape-invalid fresh verdict is a missing head ⇒ DEGRADED (the full ratification rails apply)')
})

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// Slot-assignment timing and divergence-card invariants
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('slot timing: the P0/P1 parity is assigned AFTER both drafts + the Sol receipt/cross-check validate, BEFORE the first slot-keyed checkpoint (full + lite) — a source-order invariant', () => {
  const src = readFileSync(ARCH_SRC, 'utf8')
  // full path: the assignment lands inside the both-alive else branch (after the solAlive check), before DRAFTS_SEALED
  const fullAssign = src.indexOf("fableSlot = (parseInt(councilSeedDigest.slice(0, 8), 16) % 2 === 0)")
  const solAliveCheck = src.indexOf('const solAlive = solPayload != null && sinkS.receipt_verified === true && solCross.ledger_verified === true')
  const draftsSealed = src.indexOf("phase: 'DRAFTS_SEALED'")
  assert.ok(solAliveCheck > -1 && fullAssign > solAliveCheck && fullAssign < draftsSealed, 'full path: fableSlot is assigned after the Sol receipt/cross-check validate and before DRAFTS_SEALED')
  // the bare seed mint no longer assigns the slot (the old pre-dispatch assignment is gone)
  assert.doesNotMatch(src, /councilSeed\(\{ protocolVersion: COUNCIL_PROTOCOL_VERSION, runToken, initialSeq: councilInitialSeq, keystoneId, templateHash \}\)\n\s*fableSlot = /, 'the pre-dispatch (seed-mint) slot assignment is removed')
  // lite path: the assignment lands after the fBad/sBad ratification-validity gate, before LITE_RATIFY_SEALED
  const liteAssign = src.lastIndexOf("fableSlot = (parseInt(councilSeedDigest.slice(0, 8), 16) % 2 === 0)")
  const liteValid = src.indexOf('invalid ratification at LITE_RATIFY')
  const liteSealed = src.indexOf("phase: 'LITE_RATIFY_SEALED'")
  assert.ok(liteAssign > liteValid && liteAssign < liteSealed && liteAssign !== fullAssign, 'lite path: fableSlot is assigned after the LITE_RATIFY validity gate and before LITE_RATIFY_SEALED')
})

test('no topic suppression: TWO unresolved findings against ONE decision surface TWO DISTINCT negotiation cards (neither authoritative divergence vanishes)', async () => {
  const cf1 = { target_decision_id: 'M1', claim: 'M1 hides an unbounded unknown', required_change: 'split M1', severity: 'blocking', evidence: { class: 'scenario', refs: ['r1'] } }
  const cf2 = { target_decision_id: 'M1', claim: 'M1 lacks a rollback path', required_change: 'add a rollback', severity: 'blocking', evidence: { class: 'scenario', refs: ['r2'] } }
  const cfg = { solCritique: { findings: [cf1, cf2] }, fableRevise: { dispositions: [{ finding_id: `F-001-${FSLOT}-001`, disposition: 'unresolved' }, { finding_id: `F-001-${FSLOT}-002`, disposition: 'unresolved' }], decisions: [], milestones: [] }, solRevise: { dispositions: [], decisions: [], milestones: [], revised_plan_markdown: '# b\n' } }
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  const cards = cardsFromFable(promptOf(calls, 'fable:negotiate'))
  assert.equal(cards.length, 2, 'BOTH authoritative finding divergences surface as cards — the second is NOT suppressed by the shared topic')
  assert.equal(new Set(cards.map((c) => c.divergence_id)).size, 2, 'the two cards carry two DISTINCT divSet divergence ids (verbatim, never merged)')
  assert.notDeepEqual(cards[0].evidence_refs, cards[1].evidence_refs, 'each card carries its OWN finding\'s evidence refs')
  assert.equal(result.council.terminal, 'RATIFIED', 'both cards settle present-side ⇒ the diverged front-half seals')
})

test('exact-byte dual-sign: clarifications that differ ONLY by case/whitespace are NOT dual-signed (no norm()) ⇒ no rerule under a clarification; the RUBRIC_CHECK records dual_signed:false', async () => {
  const cfg = ladderCfg({
    freshCell: (head, K, M) => { const dark = canonicalJson(K) === canonicalJson({ choice: 'dark' }); return head === 'fable' ? { choice: dark ? 'K' : 'M' } : { choice: dark ? 'M' : 'K' } },
    referenceReduction: () => ({ settles: false, adopt: null, reference: null, executable_check: null }),
    rubricAmend: (head) => ({ sign: true, clarification: head === 'fable' ? 'Use P0' : 'use   p0' }), // same meaning, DIFFERENT bytes
    reversibility: () => ({ P0: 'reversible', P1: 'irreversible' }),
  })
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  const rc = parseCheckpoints(calls).find((d) => d.phase === 'RUBRIC_CHECK')
  assert.ok(rc && rc.seat_provenance.dual_signed === false && rc.seat_provenance.clarification_hash === null, 'byte-differing clarifications are NOT dual-signed — nothing is frozen')
  const rubricIdx = calls.findIndex((c) => c.label.startsWith('fable:rubric-amend:'))
  const rerule = calls.filter((c, i) => i > rubricIdx && c.label.startsWith('fable:fresh:'))
  assert.ok(rerule.every((c) => !c.prompt.includes('Dual-signed clarification')), 'no rerule cell rules under a clarification (the byte-differing pair never signed the same text)')
  assert.equal(result.council.terminal, 'DEADLOCK_RESOLVED', 'the cascade falls through to reversibility ⇒ provisional adoption (never a false dual-sign)')
})

test('combination map: the ladder is threaded the ratify-agreed selection identities + ALL edges of the complete open-card partition (a source-order invariant — the atomic check spans agreed AND laddered)', () => {
  const src = readFileSync(ARCH_SRC, 'utf8')
  assert.match(src, /await runFreshRoundLadder\(disagreed, adds, agreedSel, edgesOf\(cards\), ph\)/, 'the ladder is called with the agreed selection identities AND the edges of the WHOLE open-card partition')
  assert.match(src, /const comboSel = \[\.\.\.\(Array\.isArray\(agreedSel\) \? agreedSel : \[\]\)\]/, 'the combination selection map STARTS with the ratify-agreed selections (not an empty list)')
  assert.match(src, /const edges = Array\.isArray\(allEdges\) \? allEdges : \[\]/, 'the final atomic check reads ALL edges of the partition, not just the disagreed subset')
  assert.doesNotMatch(src, /await runFreshRoundLadder\(disagreed, adds, ph\)/, 'the old 3-arg ladder call (agreed selections dropped) is gone')
  assert.doesNotMatch(src, /const edges = cards\.flatMap\(\(c\) => Array\.isArray\(c\.compatibility_edges\)/, 'the old disagreed-only edge gather is gone')
  // residual: EVERY agreed card's identity joins agreedSel BEFORE the value-specific continues, so a
  // NEITHER agreement and an agreed-absent selection are BOTH in the final selection map the ladder validates.
  const merged = src.indexOf('an agreed MERGED selection at ratify has no value channel')
  const push = src.indexOf('agreedSel.push({ divergence_id: String(card.divergence_id), selection: a })')
  const neither = src.indexOf("if (a === 'NEITHER') continue")
  const absent = src.indexOf('if (v && typeof v === \'object\' && v.absent === true) continue')
  assert.ok(merged > -1 && push > -1 && neither > -1 && absent > -1, 'all four sealFromSelections anchors are present')
  assert.ok(push > merged, 'the agreed-MERGED escalation guard still fires BEFORE any push (an agreed MERGED escalates, never joins the map)')
  assert.ok(push < neither, 'a NEITHER agreement is pushed to agreedSel BEFORE the NEITHER continue (its identity is in the final map)')
  assert.ok(push < absent, 'an agreed-absent selection is pushed to agreedSel BEFORE the absent-value continue (its identity is in the final map)')
})

test('architecture side: the DEADLOCK_RESOLVED certificate is PERSISTED reloadably (scribe + persist-hash) and binds template+run-token; the row records the certificate_hash', async () => {
  const cfg = ladderCfg({
    freshCell: (head, K, M) => { const dark = canonicalJson(K) === canonicalJson({ choice: 'dark' }); return head === 'fable' ? { choice: dark ? 'K' : 'M' } : { choice: dark ? 'M' : 'K' } },
    referenceReduction: () => ({ settles: false, adopt: null, reference: null, executable_check: null }),
    rubricAmend: () => ({ sign: false, clarification: null }),
    reversibility: () => ({ P0: 'reversible', P1: 'irreversible' }),
  })
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.equal(result.council.terminal, 'DEADLOCK_RESOLVED')
  assert.equal(countLabel(calls, 'thoth:deadlock-cert-scribe'), 1, 'the certificate is scribed to its councilDir file (reloadable persistence)')
  assert.equal(countLabel(calls, 'thoth:deadlock-cert-persist-hash'), 1, 'the persisted file is hash-verified before the terminal seals')
  const cert = result.council.certificate
  assert.ok(/^[0-9a-f]{64}$/.test(cert.template_hash) && /^[0-9a-f]{64}$/.test(cert.run_token_hash), 'the certificate binds template + run-token hashes (build re-verifies all five)')
  const dr = parseCheckpoints(calls).find((d) => d.phase === 'DEADLOCK_RESOLVED' && d.keystone_id === 'master_plan')
  assert.ok(dr && /^[0-9a-f]{64}$/.test(dr.seat_provenance.certificate_hash), 'the DEADLOCK_RESOLVED row binds the certificate_hash (build reloads the file and matches it)')
  assert.equal(dr.seat_provenance.certificate_hash, sha256Hex(canonicalJson(cert)), 'the bound certificate_hash equals the sha of the certificate\'s canonical bytes')
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

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// SWAP — the renderer/scribe, typed amendments, populated-bundle ratify (deliverable 7)
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('renderer swap: on the T4-full path the deterministic renderer + Thoth scribe author master-plan.md — plato:synthesis is retired, the render legs run', async () => {
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder())
  const labels = labelsIn(calls)
  assert.ok(labels.includes('thoth:render-scribe') && labels.includes('thoth:render-hash'), 'the render + file-hash legs run')
  assert.ok(!labels.includes('plato:synthesis'), 'plato:synthesis is retired on the T4-full path')
  assert.equal(result.council.terminal, 'RATIFIED')
  // the certificate binds the rendered plan hash (the scribe fidelity anchor)
  assert.equal(result.council.certificate.plan_hash, renderedPlanHashOf(), 'the cert binds the rendered plan hash')
  assert.equal(result.council.certificate.artifact_hash, T4_BUNDLE, 'the cert binds the front-half bundle hash')
})

test('scribe fidelity: a render-hash that disagrees with the rendered bytes ⇒ DEGRADED scribe-write failure (never a plan the scribe did not faithfully write)', async () => {
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder({ renderHash: { plan_sha256: 'a'.repeat(64) } }))
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.match(result.council.blocked_reason, /scribe-write failure/)
  assert.ok(!labelsIn(calls).includes('fable:ratify:r1'), 'a failed scribe never reaches ratification')
})

test('typed-amendment happy path: an Athena FAIL with a valid descriptor amends the bundle, rerenders, and re-validates PASS ⇒ RATIFIED over the AMENDED bundle', async () => {
  const cfg = { ...amendRevise, athenaFailFirst: [{ target_kind: 'settled_decision', key: 'palette', replacement: { choice: 'light' } }] }
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.equal(result.council.terminal, 'RATIFIED')
  assert.equal(countLabel(calls, 'thoth:render-scribe'), 2, 'the amendment triggers a second render')
  assert.equal(result.council.certificate.artifact_hash, PALETTE_AMENDED, 'the ratified bundle is the amended one')
  assert.ok(!labelsIn(calls).some((l) => l.startsWith('plato:revise')), 'no plato revision on the T4-full path')
})

for (const [name, amendments, re] of [
  ['non-descriptor', [{ note: 'free text' }], /not a valid typed descriptor/],
  ['unknown settled key', [{ target_kind: 'settled_decision', key: 'ghost', replacement: { choice: 'x' } }], /unknown settled decision/],
  ['illegal replacement shape', [{ target_kind: 'settled_decision', key: 'palette', replacement: 'a bare string' }], /illegal replacement shape/],
  ['conflicting duplicate', [{ target_kind: 'settled_decision', key: 'palette', replacement: { choice: 'x' } }, { target_kind: 'settled_decision', key: 'palette', replacement: { choice: 'y' } }], /conflicting duplicate/],
]) {
  test(`typed-amendment gated branch: ${name} ⇒ GATED_ESCALATION (never a free rewrite)`, async () => {
    const cfg = { ...amendRevise, athenaFailFirst: amendments }
    const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
    assert.equal(result.council.terminal, 'GATED_ESCALATION', `${name} gates the escalation`)
    assert.match(result.council.blocked_reason, re)
  })
}

test('descriptor-less ACCEPTED correction ⇒ GATED_ESCALATION (an accepted BLOCK finding with no structural descriptor cannot be a free rewrite)', async () => {
  const cfg = {
    ...amendRevise,
    rF1: rat(null, { verdict: 'BLOCK', findings: [blockFinding] }), // blockFinding carries NO descriptor
    solAnswer: { answers: [{ finding_id: R1P0, answer: 'ACCEPT', evidence_refs: ['ok'] }] },
  }
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.equal(result.council.terminal, 'GATED_ESCALATION')
  assert.match(result.council.blocked_reason, /no typed \{ target_kind, key, replacement \} descriptor/)
})

test('manifest-vs-Law: Asimov may not MINT an SC absent from the rendered manifest ⇒ the Law is BLOCKED before the lock (DEGRADED loud)', async () => {
  const cfg = { ...convergedRevise(), asimov: { law_file: `${KILN}/law.json`, checks: [{ id: 'SC-01', milestone: 'M1', kind: 'shell' }, { id: 'SC-99', milestone: 'M1', kind: 'shell' }], plan_sc_ids: ['SC-01', 'SC-99'] } }
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.equal(result.council.terminal, 'RATIFIED', 'the plan itself ratified — the Law mismatch is Asimov\'s, caught before the lock')
  assert.equal(result.law_locked, false)
  assert.match(result.law_reason, /manifest-vs-Law mismatch/)
})

test('manifest-vs-Law: Asimov may not OMIT a rendered SC ⇒ the Law is BLOCKED before the lock', async () => {
  const cfg = { ...convergedRevise(), asimov: { law_file: `${KILN}/law.json`, checks: [], plan_sc_ids: [] } }
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.equal(result.council.terminal, 'RATIFIED')
  assert.equal(result.law_locked, false)
  // an empty check manifest is caught by the pre-existing "no check manifest" gate (an omit of everything)
  assert.match(result.law_reason, /no check manifest|manifest-vs-Law/)
})

test('manifest-vs-Law happy: Asimov\'s inventory matching the rendered manifest passes the render gate (SC-01 → M1)', async () => {
  const cfg = { ...convergedRevise(), asimov: { law_file: `${KILN}/law.json`, checks: [{ id: 'SC-01', milestone: 'M1', kind: 'shell', cmd: 'true', files: [], timeout_s: 30 }], plan_sc_ids: ['SC-01'] } }
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.equal(result.council.terminal, 'RATIFIED')
  assert.doesNotMatch(String(result.law_reason || ''), /manifest-vs-Law|closure\(b\)/, 'the manifest matched — no render-gate block')
})

// An open-divergence front-half: both heads author 'palette' with DIFFERENT values (a two-sided card),
// then DISAGREE at negotiation (fable P0 / sol P1) so the card survives OPEN into the ratified bundle.
const openDivergeCfg = (over = {}) => ({
  fableRevise: { dispositions: [], decisions: [{ id: 'd1', topic: 'palette', value: { choice: 'dark' } }] },
  solRevise: { dispositions: [], decisions: [{ id: 'd1', topic: 'palette', value: { choice: 'light' } }], revised_plan_markdown: '# b\n' },
  negotiate: (card, leg) => ({ divergence_id: card.divergence_id, selection: leg === 'fable:negotiate' ? 'P0' : 'P1' }),
  ...over,
})

test('populated ratify: an OPEN divergence resolved by AGREED selections settles the bundle → FINAL render → the certificate binds the RESULTING plan hash', async () => {
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(openDivergeCfg({ ratSel: 'P0' })))
  const ck = parseCheckpoints(calls).map((d) => d.phase)
  assert.ok(ck.includes('NEGOTIATION_SEALED'), 'the disagreement produced a negotiated (open-carrying) bundle')
  assert.equal(result.council.terminal, 'RATIFIED')
  assert.equal(countLabel(calls, 'thoth:render-scribe'), 2, 'the agreed-selection settlement re-renders the FINAL plan (a second scribe leg)')
  const settled = [{ topic: 'palette', value: { choice: 'dark' }, slot: 'P0', ordinal: null }]
  assert.equal(result.council.certificate.plan_hash, renderedPlanHashOf({ settled }), 'the certificate binds the RESULTING (settled + re-rendered) plan hash')
  assert.match(result.council.certificate.artifact_hash, /^[0-9a-f]{64}$/, 'the certificate binds the input bundle hash the heads signed over')
})

test('populated ratify: an AGREED MERGED selection at ratify ⇒ GATED_ESCALATION (no value channel — the negotiation was the merging venue)', async () => {
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(openDivergeCfg({ ratSel: 'MERGED' })))
  assert.equal(result.council.terminal, 'GATED_ESCALATION')
  assert.match(result.council.blocked_reason, /MERGED selection at ratify/)
})

test('populated ratify: a head that leaves an open divergence UNCOVERED ⇒ DEGRADED (an incomplete selection set is a missing head)', async () => {
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(openDivergeCfg({ ratSelFable: 'omit', ratSel: 'P0' })))
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.match(result.council.blocked_reason, /invalid ratification at RATIFY_1/)
})

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// — the W5 fresh-context re-adjudication ladder
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// The heads DISAGREE on the open card's resolution at ratify (fable P0=dark / sol P1=light) — dual
// APPROVE but opposed selections ⇒ the ladder rules the still-open divergence.
const ladderCfg = (over = {}) => openDivergeCfg({ ratSelFable: 'P0', ratSel: 'P1', ...over })
const P0_ADD = [{ topic: 'palette', value: { choice: 'dark' }, slot: 'P0', ordinal: null }]

test('W5 stable fresh agreement: both heads decisively adopt P0 ⇒ bundle amendment → a FRESH RATIFY round over the amended bundle → RATIFIED (the certificate binds the AMENDED hashes)', async () => {
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(ladderCfg({ freshPrefer: { choice: 'dark' } })))
  const ck = parseCheckpoints(calls).map((d) => d.phase)
  assert.ok(ck.includes('FRESH_CARDS_SEALED') && ck.includes('FRESH_CELLS_SETTLED'), 'both fresh-round barriers sealed')
  assert.equal(countLabel(calls, 'fable:ratify:rFresh'), 1, 'the ladder re-enters ratification (a fresh round) — never a direct certificate')
  assert.equal(result.council.terminal, 'RATIFIED')
  assert.equal(result.council.certificate.plan_hash, renderedPlanHashOf({ settled: P0_ADD }), 'the certificate binds the AMENDED (adopted P0) plan hash')
  assert.equal(result.council.certificate.artifact_hash, t4BundleOf({ settled: P0_ADD }).hash, 'the certificate binds the AMENDED bundle hash')
  // 8 base fresh calls per divergence (4 per head)
  assert.equal(calls.filter((c) => c.label.startsWith('fable:fresh:')).length, 4, '4 fresh fable cells')
  assert.equal(calls.filter((c) => c.label.startsWith('sol:fresh:')).length, 4, '4 fresh sol cells (byte-owned)')
})

test('W5 deterministic replay: the same seed ⇒ the same fresh-round card ids + schedule (identical fresh-cell label set across two runs)', async () => {
  const r1 = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(ladderCfg({ freshPrefer: { choice: 'dark' } })))
  const r2 = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(ladderCfg({ freshPrefer: { choice: 'dark' } })))
  const freshOf = (calls) => calls.map((c) => c.label).filter((l) => l.startsWith('fable:fresh:') || l.startsWith('sol:fresh:')).sort()
  const a = freshOf(r1.calls)
  assert.ok(a.length === 8 && a.every((l) => /:(fable|sol):fresh:FC-[0-9a-f]{24}$/.test('x:' + l)), 'the fresh cards carry seed-bound FC-<24hex> ids')
  assert.deepEqual(a, freshOf(r2.calls), 'the same seed replays the same fresh card-id set')
})

test('W5 unstable head ⇒ ambiguity terminal (recorded): a within-head cell split is never majority-washed ⇒ COUNCIL_DEADLOCK (unattended), no certificate', async () => {
  // fable splits its cells (C00 one way, the rest the other) ⇒ aggregateHead UNSTABLE ⇒ ambiguity route
  const cfg = ladderCfg({ freshCell: (head, K, M) => head === 'fable' ? { choice: 'K' } : (canonicalJson(K) === canonicalJson({ choice: 'dark' }) ? { choice: 'K' } : { choice: 'M' }) })
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.equal(result.council.terminal, 'COUNCIL_DEADLOCK', 'an unstable fresh head terminates as the honest ambiguity deadlock (unattended)')
  assert.match(result.council.blocked_reason, /AMBIGUOUS/)
  assert.equal(result.council.certificate, null)
  assert.ok(!calls.map((c) => c.label).includes('fable:ratify:rFresh'), 'no adoption / re-ratify on an ambiguous round')
})

test('W5 decisive-vs-no_decision ⇒ ambiguity: one head decisive P0, the other a stable NO_DECISION ⇒ ambiguity terminal', async () => {
  const cfg = ladderCfg({ freshCell: (head, K, M) => head === 'sol' ? { choice: 'no_decision' } : (canonicalJson(K) === canonicalJson({ choice: 'dark' }) ? { choice: 'K' } : { choice: 'M' }) })
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.equal(result.council.terminal, 'COUNCIL_DEADLOCK')
  assert.match(result.council.blocked_reason, /AMBIGUOUS/)
})

test('W5 ambiguity attended ⇒ GATED_ESCALATION (the operator-attended launch gets the gated checkpoint, not the auto deadlock)', async () => {
  const cfg = ladderCfg({ freshCell: (head) => head === 'fable' ? { choice: 'K' } : { choice: 'M' } })
  const { result } = await runWorkflow(ARCHITECTURE, t4Args({ attended: true }), makeResponder(cfg))
  assert.equal(result.council.terminal, 'GATED_ESCALATION', 'attended mode routes the ambiguity to the gated operator checkpoint')
})

test('W5 reference reduction settles ⇒ re-ratify: a stable opposition that an existing controlling reference resolves ⇒ adopt via the amendment→fresh-RATIFY path', async () => {
  // stable opposition: fable decisive P0(dark), sol decisive P1(light); reference reduction adopts P0
  const cfg = ladderCfg({
    freshCell: (head, K, M) => { const dark = canonicalJson(K) === canonicalJson({ choice: 'dark' }); return head === 'fable' ? { choice: dark ? 'K' : 'M' } : { choice: dark ? 'M' : 'K' } },
    referenceReduction: () => ({ settles: true, adopt: 'P0', reference: 'VISION §goals', executable_check: null }),
  })
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  const ck = parseCheckpoints(calls).map((d) => d.phase)
  assert.ok(ck.includes('REFERENCE_REDUCTION'), 'the reference-reduction leg sealed a checkpoint')
  assert.equal(result.council.terminal, 'RATIFIED')
  assert.equal(result.council.certificate.plan_hash, renderedPlanHashOf({ settled: P0_ADD }), 'reference reduction adopted P0 and re-ratified over the amended plan')
})

test('W5 rubric rerule (dual-signed): reference reduction fails, both heads sign the SAME rubric clarification ⇒ one rerule; the rerule agrees P0 ⇒ adopt + re-ratify', async () => {
  let ruleN = 0
  const cfg = ladderCfg({
    // first round: stable opposition; after the dual-signed rubric, the rerule agrees on P0(dark)
    freshCell: (head, K, M) => { const dark = canonicalJson(K) === canonicalJson({ choice: 'dark' }); ruleN++; return ruleN > 8 ? { choice: dark ? 'K' : 'M' } : (head === 'fable' ? { choice: dark ? 'K' : 'M' } : { choice: dark ? 'M' : 'K' }) },
    referenceReduction: () => ({ settles: false, adopt: null, reference: null, executable_check: null }),
    rubricAmend: () => ({ sign: true, clarification: 'axis 4 ranks executable checks above prose' }),
  })
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  const ck = parseCheckpoints(calls).map((d) => d.phase)
  assert.ok(ck.includes('RUBRIC_CHECK'), 'the rubric-amendment barrier sealed')
  assert.equal(result.council.terminal, 'RATIFIED', 'the dual-signed rerule reached agreement and re-ratified')
})

test('W5 one-reversible ⇒ MEL + twin_deadlock_resolved: reference + rubric fail, exactly one option is a two-way door ⇒ provisional adoption, terminal class ≠ twin_ratified', async () => {
  const cfg = ladderCfg({
    freshCell: (head, K, M) => { const dark = canonicalJson(K) === canonicalJson({ choice: 'dark' }); return head === 'fable' ? { choice: dark ? 'K' : 'M' } : { choice: dark ? 'M' : 'K' } },
    referenceReduction: () => ({ settles: false, adopt: null, reference: null, executable_check: null }),
    rubricAmend: () => ({ sign: false, clarification: null }),
    reversibility: () => ({ P0: 'reversible', P1: 'irreversible' }), // both heads agree ⇒ P0 the single two-way door
  })
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.equal(result.council.terminal, 'DEADLOCK_RESOLVED')
  assert.equal(result.council.terminal_record.label, 'twin_deadlock_resolved', 'the terminal class is twin_deadlock_resolved, NEVER twin_ratified')
  assert.equal(result.council.terminal_record.resolution, 'reversibility_rule')
  const mel = result.council.terminal_record.certificate.mel
  assert.equal(mel.kind, 'council_mel')
  assert.ok(mel.valid && mel.review_trigger && mel.dissent_verbatim && mel.open_issues.length === 2, 'the MEL carries dissent, a time-boxed review trigger, and two open issues')
  // the Law gate lets a deadlock-resolved plan through the COUNCIL precondition (exceptional authority) —
  // it no longer blocks with "not council-ratified" (a real lock additionally needs Asimov + the CLI).
  assert.doesNotMatch(String(result.law_reason || ''), /not council-ratified/, 'twin_deadlock_resolved passes the council precondition of the Law')
})

test('W5 both-reversible ⇒ parity tie-break adoption + MEL ⇒ twin_deadlock_resolved', async () => {
  const cfg = ladderCfg({
    freshCell: (head, K, M) => { const dark = canonicalJson(K) === canonicalJson({ choice: 'dark' }); return head === 'fable' ? { choice: dark ? 'K' : 'M' } : { choice: dark ? 'M' : 'K' } },
    referenceReduction: () => ({ settles: false, adopt: null, reference: null, executable_check: null }),
    rubricAmend: () => ({ sign: false, clarification: null }),
    reversibility: () => ({ P0: 'reversible', P1: 'reversible' }),
  })
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.equal(result.council.terminal, 'DEADLOCK_RESOLVED')
  assert.equal(result.council.terminal_record.certificate.door, 'parity_tie_break')
})

test('W5 both-one-way ⇒ gated (attended) and COUNCIL_DEADLOCK (unattended, no stage_completed)', async () => {
  const base = {
    freshCell: (head, K, M) => { const dark = canonicalJson(K) === canonicalJson({ choice: 'dark' }); return head === 'fable' ? { choice: dark ? 'K' : 'M' } : { choice: dark ? 'M' : 'K' } },
    referenceReduction: () => ({ settles: false, adopt: null, reference: null, executable_check: null }),
    rubricAmend: () => ({ sign: false, clarification: null }),
    reversibility: () => ({ P0: 'irreversible', P1: 'costly' }),
  }
  const auto = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(ladderCfg(base)))
  assert.equal(auto.result.council.terminal, 'COUNCIL_DEADLOCK', 'unattended: honest COUNCIL_DEADLOCK')
  assert.equal(auto.result.council.terminal_record.stage_completed, false, 'NO stage_completed on the deadlock')
  assert.equal(auto.result.law_locked, false, 'a COUNCIL_DEADLOCK keeps the Law blocked')
  const att = await runWorkflow(ARCHITECTURE, t4Args({ attended: true }), makeResponder(ladderCfg(base)))
  assert.equal(att.result.council.terminal, 'GATED_ESCALATION', 'attended: the gated operator checkpoint')
})

test('W5 receiptless-sol cell degradation: a folded Sol cell is NOT a council seat-death — the ladder continues (the sol head is schedule-incomplete ⇒ ambiguity), never DEGRADED', async () => {
  const cfg = ladderCfg({ freshPrefer: { choice: 'dark' }, freshCrossDead: true })
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.notEqual(result.council.terminal, 'DEGRADED', 'a folded fresh Sol cell never DEGRADES the council')
  assert.equal(result.council.terminal, 'COUNCIL_DEADLOCK', 'the folded sol cells leave the sol head schedule-incomplete ⇒ ambiguity')
  assert.match(result.council.blocked_reason, /AMBIGUOUS/)
})

test('W5 missing-fable cell ⇒ schedule-incomplete ⇒ no decisive head ⇒ ambiguity', async () => {
  const cfg = ladderCfg({ freshCell: (head, K, M) => head === 'fable' ? null : (canonicalJson(K) === canonicalJson({ choice: 'dark' }) ? { choice: 'K' } : { choice: 'M' }) })
  const { result } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.equal(result.council.terminal, 'COUNCIL_DEADLOCK')
  assert.match(result.council.blocked_reason, /AMBIGUOUS/)
})

test('W5 divergence cap: more than 4 still-open opposed divergences ⇒ GATED_ESCALATION before any fresh dispatch (a flood is a decision, never a budget explosion)', async () => {
  // five two-sided decisions, all opposed at negotiation AND at ratify (fable P0 / sol P1)
  const five = Array.from({ length: 5 }, (_, i) => ({ id: 'd' + i, topic: 'k' + i, value: { v: 'a' } }))
  const fiveSol = five.map((d) => ({ ...d, value: { v: 'b' } }))
  const cfg = ladderCfg({
    fableRevise: { dispositions: [], decisions: five },
    solRevise: { dispositions: [], decisions: fiveSol, revised_plan_markdown: '# b\n' },
  })
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.equal(result.council.terminal, 'GATED_ESCALATION')
  assert.match(result.council.blocked_reason, /over the cap of 4/)
  assert.ok(!calls.map((c) => c.label).some((l) => l.startsWith('fable:fresh:')), 'the cap fires BEFORE any fresh cell is dispatched')
})

test('W5 oversize card ⇒ rejected before dispatch (never summarized by any model) ⇒ GATED_ESCALATION', async () => {
  // each value stays UNDER the per-value projection cap (8 KiB) but the CARD (two positions) blows
  // the per-card ladder ceiling (8 KiB) — the ladder's own oversize rail must reject it before dispatch.
  const big = 'x'.repeat(7500)
  const cfg = ladderCfg({
    fableRevise: { dispositions: [], decisions: [{ id: 'd1', topic: 'palette', value: { choice: 'dark', pad: big } }] },
    solRevise: { dispositions: [], decisions: [{ id: 'd1', topic: 'palette', value: { choice: 'light', pad: big } }], revised_plan_markdown: '# b\n' },
  })
  const { result, calls } = await runWorkflow(ARCHITECTURE, t4Args(), makeResponder(cfg))
  assert.equal(result.council.terminal, 'GATED_ESCALATION')
  assert.match(result.council.blocked_reason, /over the .* per-card ceiling/)
  assert.ok(!calls.map((c) => c.label).some((l) => l.startsWith('fable:fresh:')), 'an oversize card is rejected before dispatch')
})
