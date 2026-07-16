export const meta = {
  name: 'kiln-vision',
  description: 'Kiln vision-compile leg: the tail of the brainstorm stage. The append-only session ledger (.kiln/docs/brainstorm-ledger.jsonl) is the canonical artifact; this workflow gates it mechanically (kiln-vision ledger-gate — an incomplete session can never compile), then ONE fresh-context compiler agent whose SOLE source is the ledger writes .kiln/docs/VISION.md (traceability is structural: the compiler never saw the chat), then the deterministic post-compile gate (kiln-vision validate) rules — with a bounded revise loop (≤2) on typed violations. VISION.md is a DERIVED artifact: regenerable from the ledger at any time, never hand-edited; a re-run recompiles from scratch. On a validator-clean VISION the run ledger gets vision_compiled THEN stage_completed (brainstorm); on exhaustion, neither — vision_valid:false with the typed violations is the conductor\'s escalation payload.',
  phases: [
    { title: 'The Gate', detail: 'kiln-vision ledger-gate — the mechanical pre-compile floor: session_complete terminal, approved section intents, clarify pass, the idea floor' },
    { title: 'The Compilation', detail: 'one fresh-context compiler writes VISION.md from the ledger alone; the validator rules; typed violations drive a bounded revise loop (≤2)' },
    { title: 'The Seal', detail: 'existence verified; vision_compiled + stage_completed (brainstorm) ledgered — only on a validator-clean VISION' },
  ],
}

// ── args from the conductor: { kilnDir, projectPath, pluginRoot } ──
// args may arrive as an object or a JSON string depending on how the caller encoded it. Normalise both.
// @inline:args:normalizeArgs
const A = normalizeArgs(args)
// @inline:doctrine:PAYLOAD_FIRST
const kilnDir = A.kilnDir
const projectPath = A.projectPath
if (!kilnDir || !projectPath) throw new Error('vision.js requires args.kilnDir and args.projectPath (absolute paths — the conductor resolves them; never launch with relative paths). Received args of type ' + typeof args)
// pluginRoot is the conductor-resolved absolute $CLAUDE_PLUGIN_ROOT (a launched Workflow can't see
// ${CLAUDE_PLUGIN_ROOT}). LOAD-BEARING here — unlike an optional ledger append, the kiln-vision CLI
// IS this workflow's floor and verdict: without it there is no mechanical gate, and a compile
// without a gate would be exactly the self-graded homework this leg retires. Absence fails CLOSED with a
// named reason (the conductor escalates); it never degrades to a gateless compile.
const pluginRoot = A.pluginRoot

const docsDir = `${kilnDir}/docs`
const ledgerFile = `${docsDir}/brainstorm-ledger.jsonl`
const visionFile = `${docsDir}/VISION.md`

// ── MODEL_VOICE shell (Opus only; inlined from src/voice.mjs by the bundler) ──
// @inline:voice:MODEL_VOICE,voice
// ── The single gateAgent (+ receipt attestation), whole src/gate.mjs inlined — the fidelity pair's
//    Sol seat is a Sonnet wrapper over transport:'codex'; gateAgent STRUCTURALLY validates the receipt. ──
// @gate
// ── Codex model pins (CODEX_MODEL default + CODEX_FALLBACK, inlined from src/models.mjs) ──
// @models
// ── The Claude council head, resolved once per run. The conductor threads args.claudeHead from the
//    run's capability record; only the fallback engine id (CLAUDE_HEAD_FALLBACK) demotes the seat —
//    absent, 'fable', or any other value keeps the preferred head (CLAUDE_HEAD), byte-compatible with a
//    launch that threads no head. Every Claude-head SEAT model and the model field of each Claude-half
//    seat_provenance resolves through this ONE constant; the head LABELS (head:'fable', slot keys) are
//    seat names and never move — CLAUDE_HEAD_MODEL names the engine, 'fable' names the seat. ──
const CLAUDE_HEAD_MODEL = A.claudeHead === CLAUDE_HEAD_FALLBACK ? CLAUDE_HEAD_FALLBACK : CLAUDE_HEAD
// When the head is held by the fallback engine, record the succession ONCE at council convening so the
// demotion is never silent — the checkpoints carry the resolved model in seat_provenance; this is the
// human-readable ledger beat beside them. Best-effort: a failed append never blocks the council.
let claudeHeadSuccessionNoted = false
async function noteClaudeHeadSuccession(phaseName) {
  if (CLAUDE_HEAD_MODEL !== CLAUDE_HEAD_FALLBACK || claudeHeadSuccessionNoted) return
  claudeHeadSuccessionNoted = true
  try { await runLedger('note', { kind: 'capability', event: 'claude_head_demoted', head: 'fable', claude_head: CLAUDE_HEAD_MODEL }, phaseName) } catch { /* best-effort beat */ }
}
// ── Twin Council pure core — the SEALED call-site machinery, lifted to src/council.mjs
//    and inlined through the SAME @inline:council bundler contract build/validate use (helpers, never
//    copy-paste). Powers vision's T4 keystone: the fidelity pair between the mechanical checks and the
//    seal events. INERT on every sub-T4 / no-codex / tokenless path (councilCapable === false). ──
// @inline:council:COUNCIL_PROTOCOL_VERSION,sha256Hex,canonicalJson,claimTypeForClass,compareEvidence,validateReversal,councilSignature,verifySignature,validateRatification,twinRatified,buildCheckpoint,SHA64_RE,RATIFY_SCHEMA,envelopeSchema,CROSS_CHECK_SCHEMA,LEDGER_APPEND_SCHEMA,CANON_HASH_ONELINER,LEDGER_EXTRACT_ONELINER,councilTemplateHash,seatProv,solWrapperPlan,crossCheckOk,assembleRatifyCertificate,verdictShapeError

// ── Twin Council gating. Vision's fidelity council goes council-grade ONLY when the
//    capability record promised BOTH heads (T4 = fable + codex) AND the conductor minted a runToken.
//    codexAvailable defaults true (tier T4 definitionally carries codex; normalizeArgs passes it through
//    when the conductor sends it). A PROMISED council missing its runToken fails CLOSED (terminal DEGRADED;
//    NEITHER seal event — never a silent compile). runTokenRaw lives ONLY in the receipt-script argv. ──
const codexAvailable = A.codexAvailable !== false
const runTokenRaw = (typeof A.runToken === 'string' && A.runToken.length > 0) ? A.runToken : null
const capabilityTier = (A.capabilityTier === 'T1' || A.capabilityTier === 'T2' || A.capabilityTier === 'T3' || A.capabilityTier === 'T4') ? A.capabilityTier : null
const councilPromised = capabilityTier === 'T4' && codexAvailable
const councilCapable = councilPromised && runTokenRaw != null
const councilMisconfigured = councilPromised && runTokenRaw == null
if (councilMisconfigured) {
  log('MISCONFIGURED CONDUCTOR — capability tier T4 with both heads reachable but NO runToken: vision\'s fidelity council cannot bind its receipts/seed. The compile fidelity seal fails CLOSED (terminal DEGRADED; NEITHER vision_compiled nor stage_completed — never a silent compile). Relaunch with the per-run token to convene the council.')
}
const councilDir = `${kilnDir}/council/vision`
const receiptsLedger = `${kilnDir}/council/receipts.jsonl`
const runTokenHash = runTokenRaw != null ? sha256Hex(runTokenRaw) : null
const COUNCIL_RENDERER_VISION = 'b43-vision/1'
// Fixed rubric/task (run-independent template hash). The pair rules COMPILE FIDELITY — never a quality
// re-review of the product idea.
const VISION_FIDELITY_RUBRIC =
  'Rule VISION FIDELITY: is VISION.md a FAITHFUL compile of the brainstorm session ledger — nothing ' +
  'INVENTED (no requirement, success criterion, or claim that is absent from the ledger), nothing DROPPED ' +
  '(every operator-attributed idea/theme/decision the ledger carries is represented), operator meaning ' +
  'preserved? This is the COMPILE-FIDELITY question ONLY — NOT a quality/ambition re-review of the product ' +
  'idea; you rule the compile, not the vision\'s merit. Every finding MUST cite the ledger entry (or the ' +
  'exact invented line) it turns on.'
const VISION_FIDELITY_TASK =
  'Render one blind verdict — APPROVE (VISION.md is a faithful compile of the ledger), BLOCK, or NEITHER — ' +
  'on the vision fidelity against the rubric. You do not know who else is ruling. divergence_selections is ' +
  '[] (no open divergences). Echo artifact_hash EXACTLY as given. A BLOCK or NEITHER MUST carry at least one ' +
  'evidence-bound finding (finding_id unique, nonempty evidence_refs or a real executable_check); an ' +
  'evidence-free verdict is invalid. changed_evidence is [] unless you reverse a prior block.'
const councilTemplateHashVision = councilTemplateHash({ rubric: VISION_FIDELITY_RUBRIC, ruling_task: VISION_FIDELITY_TASK, renderer: COUNCIL_RENDERER_VISION })
// EVIDENCE_ANCHOR_SCHEMA / evidenceAnchorPrompt — the anchor: hash the NAMED artifacts into a
// {path, sha256} manifest; a dead/partial anchor ⇒ DEGRADED (the certificate never binds unhashed names).
const EVIDENCE_ANCHOR_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { reasoning: { type: 'string', maxLength: 400 }, files: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, sha256: { type: 'string' } }, required: ['path', 'sha256'] } } },
  required: ['files'],
}
const evidenceAnchorPrompt = (inputs) =>
  `You are Thoth, the scribe — transcribe hashes, never judge, never fix.\n\n` +
  `<task>Run (Bash): 'sha256sum ${inputs.join(' ')}'. Transcribe each input file's sha256 into files[] as {path, sha256} (VERBATIM, lowercase hex, the path exactly as given). Do not read file contents, do not write or fix anything.</task>`
const crossCheckPrompt = (outFile, outputSha, sessionId) =>
  `You are Thoth, the receipt cross-checker — transcribe, never compose, never judge. Run these three EXACT commands (Bash) and transcribe their output.\n\n` +
  `<task>\n` +
  `1. run EXACTLY: sha256sum "${outFile}" — output_sha256_disk = the 64-hex digest (the first field only).\n` +
  `2. run EXACTLY: node -e '${CANON_HASH_ONELINER}' "${outFile}" — output_canonical_sha256 = its stdout (a 64-hex digest).\n` +
  `3. run EXACTLY: node -e '${LEDGER_EXTRACT_ONELINER}' "${receiptsLedger}" "${outputSha}" "${sessionId}" — ledger = the { verified, reservation } JSON it prints.\n` +
  `Emit output_sha256_disk, output_canonical_sha256, and the ledger object. Do not read the files for content, do not write or fix anything.</task>`
const runSolCrossCheck = async (legLabel, keystone, phaseTag, outFile, sink, payload, phaseName) => {
  const canon = sha256Hex(canonicalJson(payload))
  const relayed = sink && sink.output_hash
  const dispatch = () => agent(crossCheckPrompt(outFile, relayed, sink && sink.session_id), { label: `thoth:receipt-check:${legLabel}`, phase: phaseName, model: 'haiku', schema: CROSS_CHECK_SCHEMA })
  let cc = await dispatch()
  if (!(cc && cc.ledger)) cc = await dispatch()
  if (!(cc && cc.ledger)) return { ledger_verified: false, reason: 'cross-check leg produced no ledger extract' }
  const res = crossCheckOk(cc, { relayedOutputHash: relayed, canonicalHash: canon, sink, keystone, phaseTag, seat: 'sol', attempt: 1, runToken: runTokenRaw })
  return res.ok
    ? { ledger_verified: true, codex_receipt_hash: res.codex_receipt_hash, invocation_id: res.invocation_id }
    : { ledger_verified: false, invocation_id: res.invocation_id, reason: res.reason }
}
const councilReceipts = []
const pushCouncilReceipt = (bucket, leg, sink, cross) => bucket.push({
  leg, invocation_id: cross && cross.invocation_id ? cross.invocation_id : null,
  receipt_verified: !!(sink && sink.receipt_verified), ledger_verified: !!(cross && cross.ledger_verified),
  session_id: sink && sink.session_id != null ? sink.session_id : null, tokens_used: sink && sink.tokens_used != null ? sink.tokens_used : null,
})
const councilCheckpoint = async (fields, phaseName) => {
  try { await runLedger('note', buildCheckpoint(fields), phaseName) }
  catch (e) { log(`council checkpoint ${fields && fields.phase} not ledgered (non-fatal): ${e && e.message ? e.message : e}`) }
}
const councilRuling = async (data, phaseName) => {
  try { await runLedger('note', { kind: 'council_ruling', ...data }, phaseName) }
  catch (e) { log(`council ruling not ledgered (non-fatal): ${e && e.message ? e.message : e}`) }
}
// runBlindPair — Fable ∥ receipt-attested Sol rule blind over a schema (xhigh, council-grade).
const runBlindPair = async (cfg) => {
  const sinkF = {}, sinkS = {}
  const plan = solWrapperPlan({ councilDir, pluginRoot, receiptsLedger, runToken: runTokenRaw, keystone: cfg.keystone, transportModel: CODEX_MODEL, phaseTag: cfg.phaseTag, attempt: 1, effort: 'xhigh', payloadSchema: cfg.schema, taskText: cfg.solTaskText, briefBody: cfg.solBrief, packetObj: cfg.solPacket })
  const [rF, rS] = await parallel([
    () => gateAgent(cfg.fablePrompt, { label: `fable:${cfg.legName}`, phase: cfg.phaseName, model: CLAUDE_HEAD_MODEL, effort: 'xhigh', twoHeads: 'required', schema: cfg.schema, provenance: sinkF }),
    () => gateAgent(plan.prompt, { label: `sol:${cfg.legName}`, phase: cfg.phaseName, model: 'sonnet', transport: 'codex', transportModel: CODEX_MODEL, receiptRequired: true, twoHeads: 'required', schema: envelopeSchema(cfg.schema), provenance: sinkS }),
  ])
  let solCross = { ledger_verified: false }
  if (rS != null && sinkS.receipt_verified === true) solCross = await runSolCrossCheck(`sol:${cfg.legName}`, cfg.keystone, cfg.phaseTag, plan.files.out, sinkS, rS, cfg.phaseName)
  pushCouncilReceipt(councilReceipts, `sol:${cfg.legName}`, sinkS, solCross)
  const solOk = rS != null && sinkS.receipt_verified === true && solCross.ledger_verified === true
  if (rF == null || !solOk) {
    const missing = rF == null && !solOk ? 'both' : (rF == null ? 'fable' : 'sol')
    return { degraded: true, missing, rF, rS, sinkF, sinkS, solCross }
  }
  return { degraded: false, rF, rS, sinkF, sinkS, solCross }
}
// runVisionFidelity — the REQUIRED blind fidelity pair over {VISION.md hash, ledger hash, validator
// verdict}. Dual-APPROVE ⇒ RATIFIED (the caller fires both seal events + rides the certificate); ANY other
// outcome ⇒ a non-RATIFIED terminal and the caller fires NEITHER seal event (the existing invalid-VISION
// escalation shape). The compile is FROZEN — the council rules it, never re-authors VISION.md.
const runVisionFidelity = async (vSummary) => {
  const phaseName = 'The Seal'
  const keystone = 'vision_fidelity'
  const phaseTag = 'VISION_RATIFY'
  const namedEvidence = [visionFile, ledgerFile]
  const anchor = await agent(evidenceAnchorPrompt(namedEvidence), { label: 'thoth:vision-anchor', phase: phaseName, model: 'haiku', schema: EVIDENCE_ANCHOR_SCHEMA })
  const anchorFiles = (anchor && Array.isArray(anchor.files)) ? anchor.files.filter((f) => f && typeof f.path === 'string' && typeof f.sha256 === 'string' && SHA64_RE.test(f.sha256)) : []
  const anchorPaths = anchorFiles.map((f) => f.path)
  const anchorExact =
    anchor && Array.isArray(anchor.files) && anchorFiles.length === anchor.files.length &&
    anchorFiles.length === namedEvidence.length &&
    new Set(anchorPaths).size === anchorFiles.length &&
    namedEvidence.every((p) => anchorPaths.includes(p))
  if (!anchorExact) {
    await councilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: councilTemplateHashVision, run_token_hash: runTokenHash, initial_ledger_seq: null, keystone_id: keystone, phase: 'DEGRADED', decision_bundle_hash: null, input_artifact_hashes: [], evidence_manifest_hash: null, anonymous_seat_artifact_hashes: {}, seat_provenance: { missing: 'evidence' }, codex_receipt_hash: null, status: 'sealed' }, phaseName)
    await councilRuling({ keystone, phase: phaseTag, terminal: 'DEGRADED', reason: 'evidence-anchor' }, phaseName)
    log('vision fidelity evidence anchor DEGRADED — NEITHER seal event fires (the certificate must never bind unhashed names)')
    return { terminal: 'DEGRADED', certificate: null, findings: [], bundle_hash: null, receipt_verified: false, ledger_verified: false }
  }
  const manifest = {}
  for (const f of anchorFiles) manifest[f.path] = f.sha256
  const evidenceRefs = Object.keys(manifest).sort().map((p) => ({ path: p, sha256: manifest[p] }))
  const evidenceManifestHash = sha256Hex(canonicalJson(manifest))
  const evidenceInputHashes = Object.keys(manifest).sort().map((k) => manifest[k])
  const s = vSummary || {}
  const record = {
    vision_sha256: manifest[visionFile] != null ? manifest[visionFile] : null,
    ledger_sha256: manifest[ledgerFile] != null ? manifest[ledgerFile] : null,
    validator: { tier: s.tier != null ? s.tier : null, counts: s.counts != null ? s.counts : null, unresolved: s.unresolved != null ? s.unresolved : null },
    evidence_refs: evidenceRefs,
  }
  const bundleHash = sha256Hex(canonicalJson(record))
  const ckptBase = { protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: councilTemplateHashVision, run_token_hash: runTokenHash, initial_ledger_seq: null, keystone_id: keystone, decision_bundle_hash: bundleHash, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash }
  const recordJson = JSON.stringify(record)
  const ratifyInputs =
    `<inputs>\n- VISION.md (the compiled artifact under fidelity ruling): ${visionFile}.\n` +
    `- The brainstorm session ledger (the SOLE source VISION.md must faithfully compile): ${ledgerFile}.\n` +
    `- The COMPLETE frozen fidelity record you are ratifying (evidence_refs bind VISION.md + the ledger to their sha256):\n${recordJson}\n` +
    `- Read both files (read-only), confirm each evidence_refs path matches its bound hash, then rule whether VISION.md is a faithful compile of the ledger.\n</inputs>`
  const bindingLine = `Binding: artifact_hash = "${bundleHash}" (echo it VERBATIM). divergence_selections = [] (no open divergences this round). changed_evidence = [] unless you reverse a prior block.`
  const fablePrompt =
    `You are a council ratifier (vision fidelity) — rule whether VISION.md faithfully compiles the session ledger against the fixed rubric, blind and independent. You do not know who else is ruling.\n\n` +
    `${ratifyInputs}\n\n<rubric>\n${VISION_FIDELITY_RUBRIC}\n</rubric>\n\n<binding>\n${bindingLine}\n</binding>\n\n` +
    `<task>${VISION_FIDELITY_TASK}\nEmit the evidence-bound findings + changed_evidence + divergence_selections FIRST, then the verdict (evidence-before-commit); reasoning is optional, last, and under 50 words. ${PAYLOAD_FIRST}</task>`
  const solBrief = `${bindingLine}\nRubric:\n${VISION_FIDELITY_RUBRIC}\nRule read-only: compare ${visionFile} against the session ledger NAMED in the record's evidence_refs (each bound to its sha256). Rule COMPILE FIDELITY only, never the product's merit.`
  const pair = await runBlindPair({ keystone, phaseTag, legName: 'vision-fidelity', fablePrompt, solTaskText: VISION_FIDELITY_TASK, solBrief, solPacket: { fidelity_record: record, artifact_hash: bundleHash }, schema: RATIFY_SCHEMA, phaseName })
  const seatHashes = (rF, rS) => ({ P0: sha256Hex(canonicalJson(rF)), P1: sha256Hex(canonicalJson(rS)) })
  if (pair.degraded) {
    await councilCheckpoint({ ...ckptBase, phase: 'DEGRADED', anonymous_seat_artifact_hashes: {}, seat_provenance: { missing: pair.missing }, codex_receipt_hash: null, status: 'sealed' }, phaseName)
    await councilRuling({ keystone, phase: phaseTag, terminal: 'DEGRADED', missing: pair.missing }, phaseName)
    log(`vision fidelity council DEGRADED (${pair.missing}) — NEITHER seal event fires (never a single-head ruling)`)
    return { terminal: 'DEGRADED', certificate: null, findings: [], bundle_hash: bundleHash, missing: pair.missing, receipt_verified: !!(pair.sinkS && pair.sinkS.receipt_verified), ledger_verified: !!(pair.solCross && pair.solCross.ledger_verified) }
  }
  const vF = validateRatification(pair.rF, { bundle_hash: bundleHash, open_divergence_ids: [] })
  const vS = validateRatification(pair.rS, { bundle_hash: bundleHash, open_divergence_ids: [] })
  const shapeF = verdictShapeError(pair.rF), shapeS = verdictShapeError(pair.rS)
  const fBad = !vF.valid || !!shapeF, sBad = !vS.valid || !!shapeS
  if (fBad || sBad) {
    const missing = fBad && sBad ? 'both' : (fBad ? 'fable' : 'sol')
    const detail = [fBad ? `fable${shapeF ? `: ${shapeF}` : ''}` : null, sBad ? `sol${shapeS ? `: ${shapeS}` : ''}` : null].filter(Boolean).join('; ')
    await councilCheckpoint({ ...ckptBase, phase: 'DEGRADED', anonymous_seat_artifact_hashes: {}, seat_provenance: { missing, reason: 'invalid ratification' }, codex_receipt_hash: null, status: 'sealed' }, phaseName)
    await councilRuling({ keystone, phase: phaseTag, terminal: 'DEGRADED', missing, invalid: { fable: fBad, sol: sBad } }, phaseName)
    log(`vision fidelity ratification INVALID (${detail}) — DEGRADED (never mislabeled BLOCKED); NEITHER seal event fires`)
    return { terminal: 'DEGRADED', certificate: null, findings: [], bundle_hash: bundleHash, missing, receipt_verified: true, ledger_verified: true }
  }
  if (pair.rF.verdict === 'APPROVE' && pair.rS.verdict === 'APPROVE') {
    const cert = assembleRatifyCertificate({ rF: pair.rF, rS: pair.rS, provF: seatProv(pair.sinkF, 'fable'), provS: seatProv(pair.sinkS, 'sol'), context: { bundle_hash: bundleHash, renderer_version: COUNCIL_RENDERER_VISION, plan_hash: bundleHash, evidence_manifest_hash: evidenceManifestHash, protocol_version: COUNCIL_PROTOCOL_VERSION, seat_provenance: null } })
    if (!cert.ok) {
      await councilCheckpoint({ ...ckptBase, phase: 'DEGRADED', anonymous_seat_artifact_hashes: {}, seat_provenance: { reason: 'certificate defect' }, codex_receipt_hash: null, status: 'sealed' }, phaseName)
      await councilRuling({ keystone, phase: phaseTag, terminal: 'DEGRADED', reason: 'certificate defect' }, phaseName)
      log(`vision fidelity certificate could not seal (${cert.reason}) — DEGRADED; NEITHER seal event fires`)
      return { terminal: 'DEGRADED', certificate: null, findings: [], bundle_hash: bundleHash, receipt_verified: true, ledger_verified: true }
    }
    await councilCheckpoint({ ...ckptBase, phase: 'VISION_RATIFY_SEALED', anonymous_seat_artifact_hashes: seatHashes(pair.rF, pair.rS), seat_provenance: { P0: seatProv(pair.sinkF, 'fable'), P1: seatProv(pair.sinkS, 'sol') }, codex_receipt_hash: pair.solCross.codex_receipt_hash, status: 'sealed' }, phaseName)
    await councilCheckpoint({ ...ckptBase, phase: 'RATIFIED', anonymous_seat_artifact_hashes: {}, seat_provenance: {}, codex_receipt_hash: null, status: 'sealed' }, phaseName)
    await councilRuling({ keystone, phase: phaseTag, terminal: 'RATIFIED', bundle_hash: bundleHash }, phaseName)
    log(`TWIN COUNCIL RATIFIED the vision fidelity (bundle ${String(bundleHash).slice(0, 12)}…) — the compile carries two valid head signatures`)
    return { terminal: 'RATIFIED', certificate: cert.certificate, findings: [], bundle_hash: bundleHash, receipt_verified: true, ledger_verified: true }
  }
  const frozen = [...(pair.rF.verdict === 'BLOCK' || pair.rF.verdict === 'NEITHER' ? (Array.isArray(pair.rF.findings) ? pair.rF.findings : []) : []), ...(pair.rS.verdict === 'BLOCK' || pair.rS.verdict === 'NEITHER' ? (Array.isArray(pair.rS.findings) ? pair.rS.findings : []) : [])]
  await councilCheckpoint({ ...ckptBase, phase: 'VISION_RATIFY_SEALED', anonymous_seat_artifact_hashes: seatHashes(pair.rF, pair.rS), seat_provenance: { P0: seatProv(pair.sinkF, 'fable'), P1: seatProv(pair.sinkS, 'sol') }, codex_receipt_hash: pair.solCross.codex_receipt_hash, status: 'sealed' }, phaseName)
  await councilRuling({ keystone, phase: phaseTag, terminal: 'BLOCKED', verdicts: { fable: pair.rF.verdict, sol: pair.rS.verdict } }, phaseName)
  log(`vision fidelity council BLOCKED (fable ${pair.rF.verdict}, sol ${pair.rS.verdict}) — NEITHER seal event fires; ${frozen.length} finding(s) frozen onto the records`)
  return { terminal: 'BLOCKED', certificate: null, findings: frozen, bundle_hash: bundleHash, receipt_verified: true, ledger_verified: true }
}

// SPIN carries the two staged worker-tree lines; 'The ledger holds every word' rides the
// vision.gate_clean beat and 'A vision is counted before it is trusted' the vision.sealed
// keystone's texture.
const SPIN = ['Nothing enters the vision that the operator did not say', 'The compiler reads the session, never the chat']
const spin = (i) => SPIN[((i % SPIN.length) + SPIN.length) % SPIN.length]

// ── The run ledger: stage brackets + vision_compiled land in events.jsonl via
//    the kiln-state CLI. Thoth appends; gated on pluginRoot and degrades to a log line — an
//    append failure never fails the stage (unlike the VISION gate itself, which is load-bearing). ──
async function runLedger(type, data, phaseName) {
  if (!pluginRoot) { log(`pluginRoot absent — ${type} not ledgered to events.jsonl`); return }
  const ev = JSON.stringify({ type, stage: 'brainstorm', data })
  await agent(
    `You are Thoth, the scribe — "write it down or it never happened". Append ONE event to the Kiln run ledger.\n\n` +
    `<task>Run this exact command (Bash), substituting the JSON verbatim — do not edit it:\n` +
    '```\n' +
    `node ${pluginRoot}/scripts/kiln-state.mjs append ${kilnDir} '${ev.replace(/'/g, `'\\''`)}'\n` +
    '```\n' +
    `If it exits non-zero (e.g. no events.jsonl yet — the run was not initialised), report the error in your summary; do NOT create or repair any file. Report only whether the append succeeded.</task>`,
    { label: 'thoth:ledger', phase: phaseName, model: 'haiku' }
  )
}

// ── Lore beats: a dispatch from inside the fire — one line at the moment a fact
//    becomes true, carried by runLedger to the operator's transcript between the banners (note{kind:
//    'lore'}; deterministic <stage>.<beat> key; args are short scalars capped at 80 by the caller;
//    text ≤ 160). PRESENTATION, null-keep: pluginRoot absent ⇒ a plain log() line, never a failure. ──
const LORE_MAX = 160
const oneLine = (s, cap = LORE_MAX) => String(s).replace(/[\x00-\x1f\x7f]+/g, ' ').slice(0, cap)
// args are bound HERE: every string value is capped at 80 mechanically, so a beat can never
// leak an unbounded project-controlled string into the ledger even if a call site forgets to cap.
const boundArgs = (a) => { const o = {}; for (const [k, v] of Object.entries(a)) o[k] = typeof v === 'string' ? oneLine(v, 80) : v; return o }
const lore = (key, text, args, phaseName) =>
  pluginRoot
    ? runLedger('note', { kind: 'lore', key, text: oneLine(text), ...(args ? { args: boundArgs(args) } : {}) }, phaseName)
    : log(oneLine(text))

// ── the kiln-vision transcript schema — Thoth transcribes the CLI's --json verdict VERBATIM ──────
// One shape for BOTH commands (the CLI prints the same payload family); every field required so a
// schema-legal scribe can never drop the violations the revise loop feeds on.
const GATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    exit: { type: 'number', description: 'the kiln-vision process exit code' },
    valid: { type: 'boolean', description: "the payload's valid field (false when the command died without JSON)" },
    violations: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { code: { type: 'string' }, path: { type: 'string' }, message: { type: 'string' } },
        required: ['code', 'path', 'message'],
      },
      description: 'the typed violations, transcribed VERBATIM — empty when valid (or when the command itself died)',
    },
    summary: { type: 'string', description: "the payload's summary object as a JSON string, verbatim; '' when the command died" },
    error: { type: 'string', description: 'verbatim stderr when the command itself failed (nonzero without JSON); empty otherwise' },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['exit', 'valid', 'violations', 'summary', 'error'],
}
const gatePrompt = (cmd, file) =>
  `You are Thoth, the scribe — transcribe, never judge, never fix.\n\n` +
  `<task>Run (Bash): node ${pluginRoot}/scripts/kiln-vision.mjs ${cmd} ${file} --json\n` +
  `It prints ONE JSON object {schema, valid, violations, summary} on stdout whichever way the ` +
  `verdict goes (an infra failure dies to stderr with no JSON instead). Transcribe valid and ` +
  `violations VERBATIM, summary as the JSON string of the summary object, and exit = the process ` +
  `exit code. If the command itself failed (nonzero, no JSON), report exit, valid=false, empty ` +
  `violations, empty summary, and its stderr verbatim in error. Do not edit or fix anything.</task>`
const parseSummary = (r) => { try { return JSON.parse(r.summary) } catch { return null } }

// ═══════════════════════════════════════ The Gate ═══════════════════════════════════════════════
phase('The Gate')
log(spin(0))

// stage_started on EVERY entry — re-entry is accurate (the compile leg is the brainstorm stage's
// tail; a re-run after a failed gate is the stage still in progress). Ordering: this
// bracket precedes every other event this workflow appends.
await runLedger('stage_started', { leg: 'vision-compile' }, 'The Gate')

if (!pluginRoot) {
  log('VISION CANNOT COMPILE — pluginRoot absent, the kiln-vision gate CLI cannot be located. Fix: relaunch with args.pluginRoot = the absolute $PLUGIN_ROOT the conductor resolved at onboarding (${CLAUDE_PLUGIN_ROOT} is unset inside a launched Workflow). A gateless compile is self-graded homework.')
  return { vision_valid: false, vision_file: visionFile, reason: 'pluginRoot absent — the kiln-vision gate CLI is load-bearing for this leg', violations: [] }
}

const gate = await agent(gatePrompt('ledger-gate', ledgerFile), { label: 'thoth:ledger-gate', phase: 'The Gate', model: 'sonnet', schema: GATE_SCHEMA })
// Fail CLOSED: a dead scribe, a dead command, or a refusing gate all block the compile. The typed
// violations ride the return — the conductor's escalation payload names exactly what the session
// still owes (an incomplete ledger can never compile, whoever launched this workflow).
if (!(gate && gate.exit === 0 && gate.valid === true)) {
  const why = gate
    ? (gate.violations.length ? `the session ledger is incomplete: ${gate.violations.map((v) => v.code).join(', ')}` : `ledger-gate failed — ${gate.error || `exit ${gate.exit}`}`)
    : 'the gate scribe produced no report'
  log(`THE LEDGER GATE REFUSED — ${why}. No compiler spawns against an incomplete session.`)
  await lore('vision.gate_refused', `The ledger gate refused — ${oneLine(why, 80)}; no compiler spawns against an incomplete session`, { reason: oneLine(why, 80) }, 'The Gate')
  return { vision_valid: false, vision_file: visionFile, reason: why, violations: (gate && gate.violations) || [] }
}
const gateSummary = parseSummary(gate) || {}
log(`Ledger gate clean: ${gateSummary.events ?? '?'} events, ${gateSummary.ideas ?? '?'} idea(s), tier ${gateSummary.tier ?? 'unknown'}${gateSummary.express ? ' (express)' : ''}`)
// vision.gate_clean: the ledger held — the mechanical pre-compile floor is clean.
await lore('vision.gate_clean', `The ledger holds every word — ${gateSummary.events ?? '?'} events, ${gateSummary.ideas ?? '?'} idea(s), tier ${gateSummary.tier ?? 'unknown'}`, { events: gateSummary.events ?? null, ideas: gateSummary.ideas ?? null, tier: gateSummary.tier ?? null }, 'The Gate')

// ═══════════════════════════════════ The Compilation ════════════════════════════════════════════
phase('The Compilation')
log(spin(1))

// The compiler brief is the traceability contract: SOLE source = the session
// ledger + the format template. It never sees the conversation — an idea absent from the ledger
// cannot reach the vision, which turns "every idea traces to the operator" from a vibe into a
// structural property. Opus seat: the VISION is the cross-stage contract every downstream stage
// plans against; compilation fidelity is worth the workhorse.
const compileBrief =
  voice('opus') +
  `You are the vision compiler — a fresh context, deliberately: your ONLY sources are the two ` +
  `files below. You compile; you never invent. An entry absent from the ledger does not exist.\n\n` +
  `<inputs>\n` +
  `- The brainstorm session ledger (append-only JSONL, the canonical record): ${ledgerFile}\n` +
  `- The VISION v3 format template (structure + line grammars + frontmatter shape): ${pluginRoot}/templates/VISION.md\n` +
  `</inputs>\n\n` +
  `<task>Write ${visionFile} (the Write tool, whole file) — the VISION v3 document compiled from ` +
  `the ledger:\n` +
  `1. Every section's content comes from its approved section_intent entries plus the ideas/` +
  `themes/decisions the ledger attributes to the operator. The three DERIVED sections compile ` +
  `directly from events: Open Questions from unresolved-but-acknowledged clarifications and any ` +
  `question-shaped decisions (each an OQ entry in BOTH the frontmatter list — with priority/` +
  `timing/context — and the body mirror), Assumptions Ledger from assumption events (- **A-N**: ` +
  `entries), Elicitation Log from the DISTINCT data.method fields across the theme/decision/` +
  `style_probe/clarify_pass events plus the style_probe/clarify_pass trail (the ` +
  `methods the session actually used; an unlogged method never happened).\n` +
  `2. The frontmatter is arithmetic you compute from what you write: status: gated (the ledger ` +
  `passed its gate; zero [NEEDS CLARIFICATION markers may remain — acknowledged unknowns are ` +
  `assumptions or OQs now), tier from session_meta, session.ideas = the ledger's idea count, ` +
  `visual_direction true only when the Visual Direction intent carries real content (a declined ` +
  `probe compiles to the exact decline line the template shows, with visual_direction: false), ` +
  `every counts.* equal to the grammar lines you actually wrote.\n` +
  `3. Follow the template's line grammars EXACTLY (- **FR-N**:, - **SC-N**:, - **S-N (P1)**:, ` +
  `- **A-N**:, - **OQ-N**:) — a validator counts them mechanically. All 16 section titles, ` +
  `byte-stable, each exactly once. No HTML comments in your output — those are template ` +
  `scaffolding.\n` +
  `Emit written and counts (the counts you wrote) FIRST; reasoning is optional and under 50 words. ${PAYLOAD_FIRST}</task>`
const COMPILE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    written: { type: 'boolean', description: 'VISION.md was written to disk' },
    counts: { type: 'string', description: 'the counts object you wrote into the frontmatter, as a JSON string' },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['written', 'counts'],
}

// Bounded like the Law's revise loop: 3 validator passes / ≤2 compiler revisions. VISION.md is
// DERIVED: a re-run recompiles from scratch; a partial or invalid file left on disk is
// harmless — the next pass overwrites it, and nothing downstream reads an ungated VISION.
const COMPILE_PASSES = 3
let verdict = null
let compiled = await agent(compileBrief, { label: 'aristotle:compile', phase: 'The Compilation', model: 'opus', schema: COMPILE_SCHEMA })
for (let round = 0; round < COMPILE_PASSES; round++) {
  if (!(compiled && compiled.written === true)) {
    log('THE COMPILER PRODUCED NO FILE — vision_valid:false; the conductor must escalate.')
    return { vision_valid: false, vision_file: visionFile, reason: 'the compiler produced no file', violations: [] }
  }
  verdict = await agent(gatePrompt('validate', visionFile), { label: `thoth:validate:r${round}`, phase: 'The Compilation', model: 'sonnet', schema: GATE_SCHEMA })
  if (!verdict) {
    log('THE VALIDATE SCRIBE PRODUCED NO REPORT — vision_valid:false (a dead gate is a blocked gate, never a shrug).')
    return { vision_valid: false, vision_file: visionFile, reason: 'the validate scribe produced no report', violations: [] }
  }
  // An INFRA-failed validate (the command died: nonzero exit, NO typed violations) is not a
  // fixable artifact defect — revising against no violations is wasted work and a lying reason.
  // A genuine invalid artifact always carries typed violations at exit 1; a dead
  // command carries none. Fail CLOSED with the command's own error.
  if (verdict.exit !== 0 && verdict.violations.length === 0) {
    log(`THE VALIDATE COMMAND ITSELF FAILED — ${verdict.error || `exit ${verdict.exit}`}; vision_valid:false (an infra failure is never a revise trigger).`)
    return { vision_valid: false, vision_file: visionFile, reason: `validate command failed — ${verdict.error || `exit ${verdict.exit}`}`, violations: [] }
  }
  if (verdict.exit === 0 && verdict.valid === true) break
  if (round === COMPILE_PASSES - 1) {
    log(`VISION STILL INVALID after ${COMPILE_PASSES} validator pass(es): ${verdict.violations.map((v) => v.code).join(', ') || verdict.error || `exit ${verdict.exit}`}. Neither vision_compiled nor stage_completed is ledgered — the conductor escalates with the typed violations.`)
    return { vision_valid: false, vision_file: visionFile, reason: `invalid after ${COMPILE_PASSES} passes`, violations: verdict.violations }
  }
  log(`Validator: ${verdict.violations.length} violation(s) [${verdict.violations.map((v) => v.code).join(', ')}] — compiler revision ${round + 1}`)
  await lore('vision.violations', `Vision invalid — ${verdict.violations.length} violation(s) [${oneLine(verdict.violations.map((v) => v.code).join(', '), 80)}]; compiler revision ${round + 1}`, { violations: verdict.violations.length, round: round + 1 }, 'The Compilation')
  compiled = await agent(
    voice('opus') +
    `You are the vision compiler — revising YOUR OWN output. The validator refused ${visionFile}; ` +
    `its typed violations are below. Your sources are unchanged: the ledger + the template — you ` +
    `still never invent content.\n\n` +
    `<inputs>\nViolations (typed, verbatim from kiln-vision):\n` +
    verdict.violations.map((v) => `- [${v.code}] ${v.path}: ${v.message}`).join('\n') + `\n` +
    `The ledger: ${ledgerFile}. The template: ${pluginRoot}/templates/VISION.md. The file to fix: ${visionFile}.\n</inputs>\n\n` +
    `<task>Fix EXACTLY the named violations in ${visionFile} — recompute the frontmatter ` +
    `arithmetic from what the body actually carries, never bend the body to dodge a count. ` +
    `Emit written and the corrected counts FIRST; reasoning is optional and under 50 words. ${PAYLOAD_FIRST}</task>`,
    { label: `aristotle:compile-revise:r${round + 1}`, phase: 'The Compilation', model: 'opus', schema: COMPILE_SCHEMA }
  )
}

// ═══════════════════════════════════════ The Seal ═══════════════════════════════════════════════
phase('The Seal')
const vSummary = parseSummary(verdict) || {}
// The existence/status belt: the validator already read the file, but the verdict that leaves
// this workflow is checked by a fresh pair of eyes, never taken from the transcript alone.
const proof = await agent(
  `You are the artifact existence verifier.\n\n` +
  `<task>Run 'ls ${visionFile}' (Bash). Return exists = true iff the file exists. Do not read, write, or fix anything.</task>`,
  { label: 'thoth:verify', phase: 'The Seal', model: 'haiku', schema: { type: 'object', additionalProperties: false, properties: { exists: { type: 'boolean' }, reasoning: { type: 'string', maxLength: 700 } }, required: ['exists'] } }
)
if (!(proof && proof.exists === true)) {
  log('THE SEAL FAILED — the validated VISION is not on disk (a vanished artifact is a failed compile).')
  return { vision_valid: false, vision_file: visionFile, reason: 'validated but missing on disk', violations: [] }
}

// ── The fidelity pair — between the mechanical existence/validator checks and the seal events.
//    Dual-APPROVE ⇒ vision_compiled THEN stage_completed fire (order preserved) + the certificate rides
//    the return; ANY other outcome ⇒ NEITHER event (the existing invalid-VISION escalation shape — the
//    conductor escalates with the honest terminal). Sub-T4 / no-codex / tokenless: byte-preserved (no
//    council convened). Promised-but-tokenless: fail-closed DEGRADED, NEITHER seal event. ──
let visionCouncilTerminal = null, visionCouncilCertificate = null, visionCouncilBundleHash = null, visionCouncilReceiptVerified = false, visionCouncilLedgerVerified = false
if (councilCapable) {
  await noteClaudeHeadSuccession('The Seal')
  const cr = await runVisionFidelity(vSummary)
  visionCouncilTerminal = cr.terminal; visionCouncilCertificate = cr.certificate; visionCouncilBundleHash = cr.bundle_hash
  visionCouncilReceiptVerified = cr.receipt_verified; visionCouncilLedgerVerified = cr.ledger_verified
  if (cr.terminal !== 'RATIFIED') {
    log(`VISION FIDELITY ${cr.terminal} — neither vision_compiled nor stage_completed is ledgered; the conductor escalates with the honest terminal (required-mode uniformity).`)
    await lore('vision.violations', `Vision fidelity ${cr.terminal} — the compile is not sealed as faithful; ${cr.findings.length} finding(s), the conductor escalates`, { terminal: cr.terminal, findings: cr.findings.length }, 'The Seal')
    // The return IS the boundary record for vision — the mirrored per-seat summary rides it
    // alongside the terminal/certificate/findings fields.
    return { vision_valid: false, vision_file: visionFile, reason: `vision fidelity council ${cr.terminal}`, violations: [], council: { seat: 'vision_fidelity', terminal: cr.terminal, certificate: null, findings: cr.findings, bundle_hash: cr.bundle_hash, receipts: councilReceipts, certificate_present: false, receipt_verified: cr.receipt_verified, ledger_verified: cr.ledger_verified, council_missing_head: (cr.missing === 'fable' || cr.missing === 'sol') ? cr.missing : null } }
  }
} else if (councilMisconfigured) {
  visionCouncilTerminal = 'DEGRADED'
  await councilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: councilTemplateHashVision, run_token_hash: runTokenHash, initial_ledger_seq: null, keystone_id: 'vision_fidelity', phase: 'DEGRADED', decision_bundle_hash: null, input_artifact_hashes: [], evidence_manifest_hash: null, anonymous_seat_artifact_hashes: {}, seat_provenance: { missing: 'both', reason: 'runToken absent' }, codex_receipt_hash: null, status: 'sealed' }, 'The Seal')
  await councilRuling({ keystone: 'vision_fidelity', phase: 'VISION_RATIFY', terminal: 'DEGRADED', reason: 'runToken absent' }, 'The Seal')
  log('VISION FIDELITY PROMISED (T4 + codex) but NO runToken (misconfigured conductor) — fail-closed DEGRADED; NEITHER vision_compiled nor stage_completed. Relaunch with the per-run token.')
  await lore('vision.violations', 'Vision fidelity DEGRADED — promised council with no runToken; the compile is not sealed, the conductor escalates', { terminal: 'DEGRADED', findings: 0 }, 'The Seal')
  return { vision_valid: false, vision_file: visionFile, reason: 'vision fidelity council PROMISED but no runToken — fail-closed DEGRADED', violations: [], council: { seat: 'vision_fidelity', terminal: 'DEGRADED', certificate: null, findings: [], bundle_hash: null, receipts: councilReceipts, certificate_present: false, receipt_verified: false, ledger_verified: false, council_missing_head: null } }
}

// Ordering: vision_compiled THEN stage_completed — and ONLY here, on the clean (T4: RATIFIED) path.
await runLedger('vision_compiled', { tier: vSummary.tier ?? null, counts: vSummary.counts ?? null, visual_direction: vSummary.visual_direction ?? null, unresolved: vSummary.unresolved ?? null }, 'The Seal')
// vision.sealed (keystone): the seal succeeded — the vision is counted before it is trusted. Emit
// BEFORE stage_completed so the beat renders before the telegraph's terminating completion event.
await lore('vision.sealed', `Counted before trusted — the vision seals at tier ${vSummary.tier ?? 'unknown'}, visual direction ${vSummary.visual_direction === true ? 'present' : 'declined'}`, { tier: vSummary.tier ?? null, visual_direction: vSummary.visual_direction === true ? 'present' : 'declined' }, 'The Seal')
await runLedger('stage_completed', {}, 'The Seal')
log(`The vision is compiled and gated: tier ${vSummary.tier ?? 'unknown'}, visual direction ${vSummary.visual_direction === true ? 'present' : 'declined'} — the brainstorm stage completes`)

return {
  vision_valid: true,
  vision_file: visionFile,
  tier: vSummary.tier ?? null,
  counts: vSummary.counts ?? null,
  unresolved: vSummary.unresolved ?? 0,
  // The conductor threads this into the architecture launch args — the mechanical
  // visual-direction path end-to-end; the foundation agent's judgment is only the legacy fallback.
  visual_direction: vSummary.visual_direction ?? null,
  // The additive council field — the T4 fidelity terminal + certificate (twin_ratified only with
  // a cert) PLUS the mirrored per-seat summary {seat, certificate_present, receipt_verified, ledger_verified}.
  ...(councilPromised ? { council: { seat: 'vision_fidelity', terminal: visionCouncilTerminal, certificate: visionCouncilCertificate, findings: [], bundle_hash: visionCouncilBundleHash, receipts: councilReceipts, certificate_present: visionCouncilCertificate != null, receipt_verified: visionCouncilReceiptVerified, ledger_verified: visionCouncilLedgerVerified } } : {}),
}
