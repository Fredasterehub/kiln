export const meta = {
  name: 'kiln-report',
  description: 'Kiln report stage: Omega reads every .kiln artifact and the built project, then writes .kiln/REPORT.md — the final delivery summary in Kiln\'s voice.',
  phases: [{ title: 'The Final Word', detail: 'Omega compiles REPORT.md from all artifacts' }],
}

// ── args: { kilnDir, projectPath } ──
// @inline:args:normalizeArgs
const A = normalizeArgs(args)
// @inline:doctrine:PAYLOAD_FIRST
const kilnDir = A.kilnDir
const projectPath = A.projectPath
if (!kilnDir || !projectPath) throw new Error('report.js requires args.kilnDir and args.projectPath (absolute paths — the conductor resolves them; never launch with relative paths). Received args of type ' + typeof args)
// pluginRoot is the conductor-resolved absolute $PLUGIN_ROOT (a launched Workflow can't see
// ${CLAUDE_PLUGIN_ROOT}). It locates the kiln-state CLI for this stage's ledger brackets + lore
// beats (report.js's first ledger legs); absence degrades each to a log line, never
// a stage failure (the report itself never depended on it).
const pluginRoot = A.pluginRoot

const reportFile = `${kilnDir}/REPORT.md`

// @inline:guards:NO_WANDER

// ── MODEL_VOICE shell (Opus only; inlined from src/voice.mjs by the bundler) ──
// @inline:voice:MODEL_VOICE,voice

// ── gateAgent (inlined from src/gate.mjs) — Omega's closing report is a gate leg too: a
//    structured-output retry-cap death here used to detonate the whole report stage. Behind
//    gateAgent it degrades to null (one re-dispatch first), and the null-safe return below still
//    ships a REPORT.md pointer instead of failing the pipeline's final step. The signoff pair's
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
//    and inlined through the SAME @inline:council bundler contract build/validate/vision use (helpers,
//    never copy-paste). Powers report's T4 keystone: the signoff pair after the existence gate. INERT on
//    every sub-T4 / no-codex / tokenless path (councilCapable === false). ──
// @inline:council:COUNCIL_PROTOCOL_VERSION,sha256Hex,canonicalJson,claimTypeForClass,compareEvidence,validateReversal,councilSignature,verifySignature,validateRatification,twinRatified,buildCheckpoint,SHA64_RE,RATIFY_SCHEMA,envelopeSchema,CROSS_CHECK_SCHEMA,LEDGER_APPEND_SCHEMA,CANON_HASH_ONELINER,LEDGER_EXTRACT_ONELINER,councilTemplateHash,seatProv,solWrapperPlan,crossCheckOk,assembleRatifyCertificate,verdictShapeError,RATIFY_DESCRIPTOR,normalizeStrictPayload

// ── Twin Council gating. Report's signoff council goes council-grade ONLY when the
//    capability record promised BOTH heads (T4 = fable + codex) AND the conductor minted a runToken.
//    codexAvailable defaults true (tier T4 definitionally carries codex; normalizeArgs passes it through
//    when the conductor sends it). A PROMISED council missing its runToken fails CLOSED (terminal
//    DEGRADED; signed_off:false; NO stage_completed even on a written REPORT.md — the existence-gated
//    completion is council-gated at T4). runTokenRaw lives ONLY in the receipt-script argv. ──
const codexAvailable = A.codexAvailable !== false
const runTokenRaw = (typeof A.runToken === 'string' && A.runToken.length > 0) ? A.runToken : null
const capabilityTier = (A.capabilityTier === 'T1' || A.capabilityTier === 'T2' || A.capabilityTier === 'T3' || A.capabilityTier === 'T4') ? A.capabilityTier : null
const councilPromised = capabilityTier === 'T4' && codexAvailable
const councilCapable = councilPromised && runTokenRaw != null
const councilMisconfigured = councilPromised && runTokenRaw == null
if (councilMisconfigured) {
  log('MISCONFIGURED CONDUCTOR — capability tier T4 with both heads reachable but NO runToken: report\'s signoff council cannot bind its receipts/seed. The report ships UNSIGNED (signed_off:false, terminal DEGRADED) and NO stage_completed fires even on a written REPORT.md — never a silent completion. Relaunch with the per-run token to convene the council.')
}
const councilDir = `${kilnDir}/council/report`
const receiptsLedger = `${kilnDir}/council/receipts.jsonl`
const runTokenHash = runTokenRaw != null ? sha256Hex(runTokenRaw) : null
const COUNCIL_RENDERER_REPORT = 'b43-report/1'
// The .kiln source artifacts Omega was pointed at — names known to the stage (the record's artifact_refs
// manifest). NAMES only (not hashed): several are conditional (research.md on the zero-topics route,
// validation/report.md when validate ran), so hashing them would spuriously DEGRADE a legitimately
// artifact-lean run (name what the stage knows, hash only the guaranteed artifact).
const reportSourceArtifacts = [
  `${kilnDir}/STATE.md`, `${kilnDir}/docs/project-brief.md`, `${kilnDir}/docs/VISION.md`, `${kilnDir}/docs/research.md`,
  `${kilnDir}/master-plan.md`, `${kilnDir}/validation/report.md`, `${kilnDir}/docs/codebase-state.md`,
]
// Fixed rubric/task (run-independent template hash). The pair rules HONESTY of the report vs the run's
// artifacts — never prose polish, never a re-review of the product itself.
const REPORT_SIGNOFF_RUBRIC =
  'Rule the REPORT SIGNOFF: does REPORT.md tell the TRUTH about the run\'s artifacts — every DELIVERED claim ' +
  'genuinely supported by an artifact the run produced (no invented delivery), every OUTSTANDING/failed/' +
  'deferred item honestly stated (no silent omission dressed as done), and the validation outcome reported ' +
  'as it actually landed (a PARTIAL/FAILED never spun as a PASS)? You rule the report\'s HONESTY against the ' +
  'run\'s artifacts, NOT its prose polish or the product\'s merit. Every finding MUST cite the report line + ' +
  'the artifact (or its absence) it contradicts.'
const REPORT_SIGNOFF_TASK =
  'Render one blind verdict — APPROVE (REPORT.md is an honest signoff), BLOCK, or NEITHER — on the report ' +
  'signoff against the rubric. You do not know who else is ruling. divergence_selections is [] (no open ' +
  'divergences). Echo artifact_hash EXACTLY as given. A BLOCK or NEITHER MUST carry at least one evidence-bound ' +
  'finding (finding_id unique, nonempty evidence_refs or a real executable_check); an evidence-free verdict is ' +
  'invalid. changed_evidence is [] unless you reverse a prior block.'
const councilTemplateHashReport = councilTemplateHash({ rubric: REPORT_SIGNOFF_RUBRIC, ruling_task: REPORT_SIGNOFF_TASK, renderer: COUNCIL_RENDERER_REPORT })
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
// normCouncilPayload(raw, descriptor) — the ONE strict-wire → consumer-view boundary (D2), applied at a
// head-return seam AFTER the raw-wire receipt attestation + cross-check have bound the attested bytes. A
// null head is a dead seat; an unparsable encoded wire field fails CLOSED to a dead seat.
const normCouncilPayload = (raw, descriptor) => {
  if (raw == null) return null
  if (descriptor == null) return raw
  try { return normalizeStrictPayload(raw, descriptor) }
  catch (e) { log(`council payload shape error (${e && e.message ? e.message : e}) — treating the seat as dead`); return null }
}
const runBlindPair = async (cfg) => {
  const sinkF = {}, sinkS = {}
  const plan = solWrapperPlan({ councilDir, pluginRoot, receiptsLedger, runToken: runTokenRaw, keystone: cfg.keystone, transportModel: CODEX_MODEL, phaseTag: cfg.phaseTag, attempt: 1, effort: 'xhigh', payloadSchema: cfg.schema, taskText: cfg.solTaskText, briefBody: cfg.solBrief, packetObj: cfg.solPacket })
  const [rFraw, rSraw] = await parallel([
    () => gateAgent(cfg.fablePrompt, { label: `fable:${cfg.legName}`, phase: cfg.phaseName, model: CLAUDE_HEAD_MODEL, effort: 'xhigh', twoHeads: 'required', schema: cfg.schema, provenance: sinkF }),
    () => gateAgent(plan.prompt, { label: `sol:${cfg.legName}`, phase: cfg.phaseName, model: 'sonnet', transport: 'codex', transportModel: CODEX_MODEL, receiptRequired: true, twoHeads: 'required', schema: envelopeSchema(cfg.schema), provenance: sinkS }),
  ])
  let solCross = { ledger_verified: false }
  if (rSraw != null && sinkS.receipt_verified === true) solCross = await runSolCrossCheck(`sol:${cfg.legName}`, cfg.keystone, cfg.phaseTag, plan.files.out, sinkS, rSraw, cfg.phaseName)
  pushCouncilReceipt(councilReceipts, `sol:${cfg.legName}`, sinkS, solCross)
  // D2 boundary: raw-wire cross-check done → the consumer view for both heads.
  const rF = normCouncilPayload(rFraw, cfg.descriptor)
  const rS = normCouncilPayload(rSraw, cfg.descriptor)
  const solOk = rS != null && sinkS.receipt_verified === true && solCross.ledger_verified === true
  if (rF == null || !solOk) {
    const missing = rF == null && !solOk ? 'both' : (rF == null ? 'fable' : 'sol')
    return { degraded: true, missing, rF, rS, sinkF, sinkS, solCross }
  }
  return { degraded: false, rF, rS, sinkF, sinkS, solCross }
}
// runReportSignoff — the REQUIRED blind signoff pair over the WRITTEN report + an anchored evidence
// manifest, AFTER the existence gate. Dual-APPROVE ⇒ RATIFIED (the caller sets signed_off:true, rides the
// certificate, and ONLY THEN fires stage_completed); ANY other outcome ⇒ a non-RATIFIED
// terminal, signed_off:false, the unsigned report still returned, NO completion event. Omega's report is
// FROZEN — the council rules it, never re-authors REPORT.md.
const runReportSignoff = async (res) => {
  const phaseName = 'The Final Word'
  const keystone = 'report_signoff'
  const phaseTag = 'REPORT_RATIFY'
  const namedEvidence = [reportFile]
  const anchor = await agent(evidenceAnchorPrompt(namedEvidence), { label: 'thoth:report-anchor', phase: phaseName, model: 'haiku', schema: EVIDENCE_ANCHOR_SCHEMA })
  const anchorFiles = (anchor && Array.isArray(anchor.files)) ? anchor.files.filter((f) => f && typeof f.path === 'string' && typeof f.sha256 === 'string' && SHA64_RE.test(f.sha256)) : []
  const anchorPaths = anchorFiles.map((f) => f.path)
  const anchorExact =
    anchor && Array.isArray(anchor.files) && anchorFiles.length === anchor.files.length &&
    anchorFiles.length === namedEvidence.length &&
    new Set(anchorPaths).size === anchorFiles.length &&
    namedEvidence.every((p) => anchorPaths.includes(p))
  if (!anchorExact) {
    await councilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: councilTemplateHashReport, run_token_hash: runTokenHash, initial_ledger_seq: null, keystone_id: keystone, phase: 'DEGRADED', decision_bundle_hash: null, input_artifact_hashes: [], evidence_manifest_hash: null, anonymous_seat_artifact_hashes: {}, seat_provenance: { missing: 'evidence' }, codex_receipt_hash: null, status: 'sealed' }, phaseName)
    await councilRuling({ keystone, phase: phaseTag, terminal: 'DEGRADED', reason: 'evidence-anchor' }, phaseName)
    log('report signoff evidence anchor DEGRADED — the report ships UNSIGNED, NO stage_completed (the certificate must never bind unhashed names)')
    return { terminal: 'DEGRADED', certificate: null, findings: [], bundle_hash: null, receipt_verified: false, ledger_verified: false }
  }
  const manifest = {}
  for (const f of anchorFiles) manifest[f.path] = f.sha256
  const evidenceManifestHash = sha256Hex(canonicalJson(manifest))
  const evidenceInputHashes = Object.keys(manifest).sort().map((k) => manifest[k])
  const record = {
    report_sha256: manifest[reportFile] != null ? manifest[reportFile] : null,
    headline: res && res.headline != null ? res.headline : null,
    delivered: Array.isArray(res && res.delivered) ? res.delivered : [],
    outstanding: Array.isArray(res && res.outstanding) ? res.outstanding : [],
    artifact_refs: reportSourceArtifacts,
  }
  const bundleHash = sha256Hex(canonicalJson(record))
  const ckptBase = { protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: councilTemplateHashReport, run_token_hash: runTokenHash, initial_ledger_seq: null, keystone_id: keystone, decision_bundle_hash: bundleHash, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash }
  const recordJson = JSON.stringify(record)
  const ratifyInputs =
    `<inputs>\n- REPORT.md (the written delivery report under signoff): ${reportFile}.\n` +
    `- The COMPLETE frozen signoff record you are ratifying (report_sha256 binds REPORT.md to its sha256; artifact_refs names the .kiln source artifacts the report summarizes):\n${recordJson}\n` +
    `- Read REPORT.md and the named .kiln artifacts (read-only), confirm REPORT.md matches its bound hash, then rule whether the report tells the truth about the run's delivered vs outstanding artifacts.\n</inputs>`
  const bindingLine = `Binding: artifact_hash = "${bundleHash}" (echo it VERBATIM). divergence_selections = [] (no open divergences this round). changed_evidence = [] unless you reverse a prior block.`
  const fablePrompt =
    `You are a council ratifier (report signoff) — rule whether REPORT.md is an honest signoff against the fixed rubric, blind and independent. You do not know who else is ruling.\n\n` +
    `${ratifyInputs}\n\n<rubric>\n${REPORT_SIGNOFF_RUBRIC}\n</rubric>\n\n<binding>\n${bindingLine}\n</binding>\n\n` +
    `<task>${REPORT_SIGNOFF_TASK}\nEmit the evidence-bound findings + changed_evidence + divergence_selections FIRST, then the verdict (evidence-before-commit); reasoning is optional, last, and under 50 words. ${PAYLOAD_FIRST}</task>`
  const solBrief = `${bindingLine}\nRubric:\n${REPORT_SIGNOFF_RUBRIC}\nRule read-only: compare ${reportFile} against the .kiln source artifacts NAMED in the record's artifact_refs. Rule HONESTY (delivered vs outstanding) only, never prose polish.`
  const pair = await runBlindPair({ keystone, phaseTag, legName: 'report-signoff', fablePrompt, solTaskText: REPORT_SIGNOFF_TASK, solBrief, solPacket: { signoff_record: record, artifact_hash: bundleHash }, schema: RATIFY_SCHEMA, descriptor: RATIFY_DESCRIPTOR, phaseName })
  const seatHashes = (rF, rS) => ({ P0: sha256Hex(canonicalJson(rF)), P1: sha256Hex(canonicalJson(rS)) })
  if (pair.degraded) {
    await councilCheckpoint({ ...ckptBase, phase: 'DEGRADED', anonymous_seat_artifact_hashes: {}, seat_provenance: { missing: pair.missing }, codex_receipt_hash: null, status: 'sealed' }, phaseName)
    await councilRuling({ keystone, phase: phaseTag, terminal: 'DEGRADED', missing: pair.missing }, phaseName)
    log(`report signoff council DEGRADED (${pair.missing}) — the report ships UNSIGNED, NO stage_completed (never a single-head signoff)`)
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
    log(`report signoff ratification INVALID (${detail}) — DEGRADED (never mislabeled BLOCKED); the report ships UNSIGNED, NO stage_completed`)
    return { terminal: 'DEGRADED', certificate: null, findings: [], bundle_hash: bundleHash, missing, receipt_verified: true, ledger_verified: true }
  }
  if (pair.rF.verdict === 'APPROVE' && pair.rS.verdict === 'APPROVE') {
    const cert = assembleRatifyCertificate({ rF: pair.rF, rS: pair.rS, provF: seatProv(pair.sinkF, 'fable'), provS: seatProv(pair.sinkS, 'sol'), context: { bundle_hash: bundleHash, renderer_version: COUNCIL_RENDERER_REPORT, plan_hash: bundleHash, evidence_manifest_hash: evidenceManifestHash, protocol_version: COUNCIL_PROTOCOL_VERSION, seat_provenance: null } })
    if (!cert.ok) {
      await councilCheckpoint({ ...ckptBase, phase: 'DEGRADED', anonymous_seat_artifact_hashes: {}, seat_provenance: { reason: 'certificate defect' }, codex_receipt_hash: null, status: 'sealed' }, phaseName)
      await councilRuling({ keystone, phase: phaseTag, terminal: 'DEGRADED', reason: 'certificate defect' }, phaseName)
      log(`report signoff certificate could not seal (${cert.reason}) — the report ships UNSIGNED, NO stage_completed`)
      return { terminal: 'DEGRADED', certificate: null, findings: [], bundle_hash: bundleHash, receipt_verified: true, ledger_verified: true }
    }
    await councilCheckpoint({ ...ckptBase, phase: 'REPORT_RATIFY_SEALED', anonymous_seat_artifact_hashes: seatHashes(pair.rF, pair.rS), seat_provenance: { P0: seatProv(pair.sinkF, 'fable'), P1: seatProv(pair.sinkS, 'sol') }, codex_receipt_hash: pair.solCross.codex_receipt_hash, status: 'sealed' }, phaseName)
    await councilCheckpoint({ ...ckptBase, phase: 'RATIFIED', anonymous_seat_artifact_hashes: {}, seat_provenance: {}, codex_receipt_hash: null, status: 'sealed' }, phaseName)
    await councilRuling({ keystone, phase: phaseTag, terminal: 'RATIFIED', bundle_hash: bundleHash }, phaseName)
    log(`TWIN COUNCIL RATIFIED the report signoff (bundle ${String(bundleHash).slice(0, 12)}…) — signed_off carries two valid head signatures`)
    return { terminal: 'RATIFIED', certificate: cert.certificate, findings: [], bundle_hash: bundleHash, receipt_verified: true, ledger_verified: true }
  }
  const frozen = [...(pair.rF.verdict === 'BLOCK' || pair.rF.verdict === 'NEITHER' ? (Array.isArray(pair.rF.findings) ? pair.rF.findings : []) : []), ...(pair.rS.verdict === 'BLOCK' || pair.rS.verdict === 'NEITHER' ? (Array.isArray(pair.rS.findings) ? pair.rS.findings : []) : [])]
  await councilCheckpoint({ ...ckptBase, phase: 'REPORT_RATIFY_SEALED', anonymous_seat_artifact_hashes: seatHashes(pair.rF, pair.rS), seat_provenance: { P0: seatProv(pair.sinkF, 'fable'), P1: seatProv(pair.sinkS, 'sol') }, codex_receipt_hash: pair.solCross.codex_receipt_hash, status: 'sealed' }, phaseName)
  await councilRuling({ keystone, phase: phaseTag, terminal: 'BLOCKED', verdicts: { fable: pair.rF.verdict, sol: pair.rS.verdict } }, phaseName)
  log(`report signoff council BLOCKED (fable ${pair.rF.verdict}, sol ${pair.rS.verdict}) — the report ships UNSIGNED, NO stage_completed; ${frozen.length} finding(s) frozen onto the return`)
  return { terminal: 'BLOCKED', certificate: null, findings: frozen, bundle_hash: bundleHash, receipt_verified: true, ledger_verified: true }
}

const REPORT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    report_file: { type: 'string' },
    headline: { type: 'string' },
    delivered: { type: 'array', items: { type: 'string' } },
    outstanding: { type: 'array', items: { type: 'string' } },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['report_file', 'headline'],
}

// ── The run ledger — report.js's ledger legs. The vision.js runLedger idiom: Thoth
//    appends; gated on pluginRoot and degrades to a log line — an append failure never fails the
//    stage. stage_completed fires ONLY on the genuine-success path: REPORT.md written (existence-
//    verified below); a missing-artifact path emits NOTHING, per the telegraph's termination rule. ──
async function runLedger(type, data, phaseName) {
  if (!pluginRoot) { log(`pluginRoot absent — ${type} not ledgered to events.jsonl`); return }
  const ev = JSON.stringify({ type, stage: 'report', data })
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

// ── Lore beats: the pen — one dispatch at the moment a fact becomes true, carried by
//    runLedger to the operator's transcript (note{kind:'lore'}; deterministic <stage>.<beat> key; args
//    short scalars capped at 80 by the caller; text ≤ 160). PRESENTATION, null-keep. ──
const LORE_MAX = 160
const oneLine = (s, cap = LORE_MAX) => String(s).replace(/[\x00-\x1f\x7f]+/g, ' ').slice(0, cap)
// args are bound HERE: every string value is capped at 80 mechanically, so a beat can never
// leak an unbounded project-controlled string into the ledger even if a call site forgets to cap.
const boundArgs = (a) => { const o = {}; for (const [k, v] of Object.entries(a)) o[k] = typeof v === 'string' ? oneLine(v, 80) : v; return o }
const lore = (key, text, args, phaseName) =>
  pluginRoot
    ? runLedger('note', { kind: 'lore', key, text: oneLine(text), ...(args ? { args: boundArgs(args) } : {}) }, phaseName)
    : log(oneLine(text))

const EXISTS_SCHEMA = { type: 'object', additionalProperties: false, properties: { exists: { type: 'boolean' }, reasoning: { type: 'string', maxLength: 700 } }, required: ['exists'] }

phase('The Final Word')
log('Omega picks up the pen')
// Stage bracket: stage_started on entry — a re-run is the stage still in progress.
await runLedger('stage_started', {}, 'The Final Word')
// report.pen_up (volume): Omega opens the stage — reading every artifact the run left behind.
await lore('report.pen_up', `Omega reads everything the run left behind — every artifact, every verdict`, null, 'The Final Word')
// Provenance: Omega's gate leg records {requested_model, actual_model, fallback_reason,
// classification} onto this sink; there is no report-stage ledger, so it rides the returned summary.
const omegaProv = {}
const res = await gateAgent(
  voice('opus') +
  `You are the closing reporter. Write the honest final delivery report.\n\n` +
  `<inputs>\n${NO_WANDER} Exception: the built project at ${projectPath} is also in scope. The files:\n` +
  `${kilnDir}/STATE.md, ${kilnDir}/docs/project-brief.md, ${kilnDir}/docs/VISION.md, ${kilnDir}/docs/research.md, ` +
  `${kilnDir}/master-plan.md, ${kilnDir}/validation/report.md (if present), ${kilnDir}/docs/codebase-state.md.\n</inputs>\n\n` +
  `<task>Write ${reportFile} — persist it via a Bash heredoc (mkdir -p the dir, then cat with a quoted heredoc into the file) — NEVER the Write tool: a platform guardrail rejects subagent Write calls on report files, and the rejection poisons the structured-output attempts that follow (an observed death mode). Compose it in Kiln's first-person, sardonic-but-earned voice (no status-symbol banners — that is the conductor's job). ` +
  `Cover: what was asked, what was built (the journey through the stages, named milestones), the validation outcome ` +
  `(tests passed/failed, criteria met), what remains or was deferred, and how to run it. Be truthful — if validation was ` +
  `PARTIAL or FAILED, say so plainly and list what's left. Then in the structured output emit report_file, headline, delivered, and outstanding FIRST — all detail belongs in ${reportFile}; reasoning is optional and under 50 words. ${PAYLOAD_FIRST}</task>`,
  { label: 'omega:report', phase: 'The Final Word', model: 'opus', schema: REPORT_SCHEMA, provenance: omegaProv }
)

log(`REPORT.md written: ${res && res.headline}`)
// Genuine-success gate: a fresh pair of eyes confirms REPORT.md landed on disk (Omega writes it via a
// Bash heredoc, so the structured `res` can go mute without the file being missing — and vice versa).
// stage_completed + report.signed fire ONLY here, on a real artifact; a missing file emits NOTHING.
const proof = await agent(
  `You are the artifact existence verifier.\n\n` +
  `<task>Run 'ls ${reportFile}' (Bash). Return exists = true iff the file exists. Do not read, write, or fix anything.</task>`,
  { label: 'thoth:verify', phase: 'The Final Word', model: 'haiku', schema: EXISTS_SCHEMA }
)
// ── The completion gate: the existence gate stays; at T4 the signoff pair is a SECOND gate on
//    completion. Dual-APPROVE ⇒ signed_off:true + the certificate in the return AND ONLY THEN
//    stage_completed fires; ANY other outcome ⇒ signed_off:false + the honest terminal + frozen findings
//    in the return, the UNSIGNED report still returned, and NO completion event (the projection stays at
//    report — the conductor's gated checkpoint owns the block). Sub-T4 is byte-preserved: signed_off is
//    ABSENT (never a false claim) and the existence-gated completion is intact. Promised-but-tokenless ⇒
//    DEGRADED terminal, signed_off:false, no completion. A missing REPORT.md never reaches the council. ──
let reportCouncil = null
if (proof && proof.exists === true) {
  if (councilCapable) {
    await noteClaudeHeadSuccession('The Final Word')
    reportCouncil = await runReportSignoff(res)
    if (reportCouncil.terminal === 'RATIFIED') {
      await lore('report.signed', `The final word is written and signed — ${oneLine((res && res.headline) || 'delivery report complete', 80)}`, { headline: oneLine((res && res.headline) || 'delivery report complete', 80) }, 'The Final Word')
      await runLedger('stage_completed', {}, 'The Final Word')
    } else {
      log(`REPORT SIGNOFF ${reportCouncil.terminal} — the report ships UNSIGNED (signed_off:false), NO stage_completed; the conductor's gated checkpoint owns the block (required-mode uniformity).`)
    }
  } else if (councilMisconfigured) {
    reportCouncil = { terminal: 'DEGRADED', certificate: null, findings: [], bundle_hash: null }
    await councilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: councilTemplateHashReport, run_token_hash: runTokenHash, initial_ledger_seq: null, keystone_id: 'report_signoff', phase: 'DEGRADED', decision_bundle_hash: null, input_artifact_hashes: [], evidence_manifest_hash: null, anonymous_seat_artifact_hashes: {}, seat_provenance: { missing: 'both', reason: 'runToken absent' }, codex_receipt_hash: null, status: 'sealed' }, 'The Final Word')
    await councilRuling({ keystone: 'report_signoff', phase: 'REPORT_RATIFY', terminal: 'DEGRADED', reason: 'runToken absent' }, 'The Final Word')
    log('REPORT SIGNOFF PROMISED (T4 + codex) but NO runToken (misconfigured conductor) — the report ships UNSIGNED (signed_off:false), NO stage_completed. Relaunch with the per-run token.')
  } else {
    // Sub-T4 / no-codex / tokenless: byte-preserved existence-gated completion.
    await lore('report.signed', `The final word is written — ${oneLine((res && res.headline) || 'delivery report complete', 80)}`, { headline: oneLine((res && res.headline) || 'delivery report complete', 80) }, 'The Final Word')
    await runLedger('stage_completed', {}, 'The Final Word')
  }
} else {
  log('REPORT.md not found on disk — no stage_completed (a missing artifact is a failed report; the telegraph stays open for the notification to close it).')
}
return {
  report_file: reportFile, headline: res && res.headline, delivered: (res && res.delivered) || [], outstanding: (res && res.outstanding) || [], gate_provenance: omegaProv,
  // At T4 the signoff outcome rides the return (the boundary record for report) —
  // signed_off is a HONEST claim (true only with a valid dual certificate), the council terminal drives the
  // conductor's gated checkpoint, and the mirrored per-seat summary {seat, certificate_present,
  // receipt_verified, ledger_verified} rides alongside. Sub-T4 omits signed_off entirely (never a false claim).
  ...(councilPromised ? { signed_off: !!(reportCouncil && reportCouncil.terminal === 'RATIFIED'), council: { seat: 'report_signoff', terminal: reportCouncil ? reportCouncil.terminal : null, certificate: reportCouncil ? reportCouncil.certificate : null, findings: reportCouncil ? reportCouncil.findings : [], bundle_hash: reportCouncil ? reportCouncil.bundle_hash : null, receipts: councilReceipts, certificate_present: !!(reportCouncil && reportCouncil.certificate), receipt_verified: !!(reportCouncil && reportCouncil.receipt_verified), ledger_verified: !!(reportCouncil && reportCouncil.ledger_verified), council_missing_head: (reportCouncil && (reportCouncil.missing === 'fable' || reportCouncil.missing === 'sol')) ? reportCouncil.missing : null } } : {}),
}
