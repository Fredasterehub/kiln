export const meta = {
  name: 'kiln-validate',
  description: 'Kiln validate stage — the real L3 backstop. A parallel fan-out: zoxea checks architecture drift + interface seams ∥ argus runs the DETERMINISTIC Law floor (fresh install per product type, then kiln-law verify = tamper gate, kiln-law run FULL over every SC incl. probes, kiln-law suite) and exercises each acceptance criterion by actually running the app ∥ hephaestus static design QA (self-detected from disk; advisory). For a UI scope, a Tier-2 BOUNDED browser traversal runs (the ban is repealed): ONE fresh cross-family evaluator walks every UI acceptance criterion against the served app via the scripted one-shot kiln-probe ONLY — each criterion is one launch→assert→close process, hard-killed at 90s, runId-tokened under the stage VALIDATE_RUN_TOKEN so the pre/post sweeps reap it, and LEASE-GATED so the ≤10-min cap is enforced on the CAPABILITY: the workflow takes a kiln-probe browser lease before spawning the evaluator and every probe refuses (exit 77) once the lease expires, so an evaluator alive past the deadline can do no further browser work (a workflow cannot cancel a spawned agent — the deadline lives on the tool, not the prose). A detached self-terminating watchdog sweeps the token + deletes the lease at expiry; the stage finally releases the lease (kill watchdog + immediate sweep). Playwright MCP is NOT driven by autonomous validate — an MCP server is a persistent browser service, which the bounded-browser discipline forbids in-loop; it remains a doctor-detected capability for the operator\'s INTERACTIVE/manual visual QA only (named in the emitted visual_qa_checklist). Absence of the scripted oracle degrades honestly to PARTIAL_PASS_STATIC_ONLY (verification_class recorded end-to-end), never silently green. A goal-backward final audit works backward from the VISION success criteria over the WHOLE deliverable. The verdict is computed DETERMINISTICALLY FIRST (validateVerdict, a pure fn) over the evidence files — PASS requires the Law run + suite at exit 0 AND no blocking findings AND, for a UI scope, a clean Tier-2 traversal (a UI scope with only honestly-degraded static-only evidence is PARTIAL_PASS_STATIC_ONLY, never PASS) — never a prose self-grade. The browser is a subprocess with a deadline, never a service; the D8=2 posture adds an adversarial probe pass + a second validator family.',
  phases: [
    { title: 'Measuring Drift', detail: 'zoxea ∥ argus ∥ hephaestus fan out — drift + seams, the deterministic Law floor, static design QA' },
    { title: 'The Traversal', detail: 'one fresh cross-family evaluator walks every UI criterion against the served app — bounded scripted kiln-probe under a lease-enforced 10-min cap, swept' },
    { title: 'Goal Backward', detail: 'the whole deliverable judged backward from the VISION success criteria' },
    { title: 'The Verdict', detail: 'PASS/PARTIAL/FAILED computed deterministically over the evidence' },
  ],
}

// ── args: { kilnDir, projectPath, testingRigor, codexAvailable, designPresent, posture, pluginRoot, runToken } ──
// @inline:args:normalizeArgs
const A = normalizeArgs(args)
// @inline:doctrine:PAYLOAD_FIRST
const kilnDir = A.kilnDir
const projectPath = A.projectPath
if (!kilnDir || !projectPath) throw new Error('validate.js requires args.kilnDir and args.projectPath (absolute paths — the conductor resolves them; never launch with relative paths). Received args of type ' + typeof args)
const codexAvailable = A.codexAvailable !== false
// designPresent is a conductor HINT; the workflow self-detects design/ from disk (self-validation
// — solve, don't punt) so a wrong/absent hint never silently skips or runs the design-QA leg.
const designHint = A.designPresent === true
// NO Playwright MCP in autonomous validate: an MCP server is a
// PERSISTENT browser service the workflow cannot bound or reap by token — the bounded-browser discipline forbids it in-loop. The
// Tier-2 traversal drives the scripted, lease-gated, one-shot kiln-probe ONLY. MCP stays a
// doctor-detected capability for the operator's INTERACTIVE/manual visual QA (named in the emitted
// visual_qa_checklist), never driven by this workflow.
// pluginRoot is the conductor-resolved absolute $PLUGIN_ROOT (a launched Workflow can't see
// ${CLAUDE_PLUGIN_ROOT}). LOAD-BEARING here: the kiln-law CLI (the Law floor + the deterministic
// run/suite evidence) and kiln-probe (the Tier-2 scripted path + the token sweeps) and the kiln-state
// ledger all live under it. Its absence degrades the deterministic floor to the static-only path —
// honestly, with verification_class recorded — never a silent skip.
const pluginRoot = A.pluginRoot

// ── VALIDATE_RUN_TOKEN — this validate stage's
//    own browser kill token. The Tier-2 traversal is the one place validate spawns browsers; every
//    scripted kiln-probe it fires runs under a runId prefixed with this token, so the pre/post
//    sweeps reap exactly this stage's survivors and nothing else (never a concurrent Kiln run's, let
//    alone the operator's own browser — blanket pkill -f chrome stays forbidden). Inert charset
//    (it becomes a pkill -f / readdir pattern). ──
//    Date.now()/Math.random are FORBIDDEN in workflow scripts (runtime determinism guard) — token
//    from args.runToken (conductor-minted) with a deterministic projectPath-hash fallback; see the
//    build.js token note for the uniqueness argument. ──
const valTokenHash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36) }
const VALIDATE_RUN_TOKEN = `kval-${String(A.runToken || valTokenHash(String(projectPath))).replace(/[^A-Za-z0-9._-]/g, '-')}`

// ── The Tier-2 traversal deadline (the ≤10 min / Tier-2 session cap) — a
//    CAPABILITY-ENFORCED hard cap. A workflow cannot CANCEL a spawned agent, so
//    the cap lives on the TOOL: before the traversal the workflow takes a kiln-probe browser lease for
//    TRAVERSAL_DEADLINE_MS/1000 seconds keyed by VALIDATE_RUN_TOKEN, and every scripted probe the
//    evaluator fires refuses (exit 77 LEASE_EXPIRED) once that lease expires — an evaluator alive past
//    the deadline is harmless because it can do no further browser work, and a detached watchdog sweeps
//    its survivors at expiry. The withDeadline() timer below is the BELT to that suspenders: it stops
//    the workflow AWAITING a wedged evaluator (a stuck codex subprocess) so the stage resolves and folds
//    static-only, rather than blocking on it forever. The lease is the hard browser bound; withDeadline
//    is the await bound. The budget is shared across passes (adversarial = a 2nd pass must fit the same
//    session cap — and the SAME lease, so a 2nd pass past the cap is refused too).
//    KILN_VALIDATE_TRAVERSAL_MS is a harness escape hatch ONLY — never set it in a run. The Workflow
//    runtime exposes NO `process` global (a bare read crashes the stage at module scope;
//    setTimeout/clearTimeout exist, process/Buffer/fetch do not),
//    so the escape hatch is typeof-guarded: harness plain-node reads it, the runtime falls through. ──
const TRAVERSAL_DEADLINE_MS = (() => {
  const v = (typeof process !== 'undefined' && process.env) ? Number(process.env.KILN_VALIDATE_TRAVERSAL_MS) : NaN
  return Number.isInteger(v) && v >= 1 ? v : 10 * 60 * 1000 // hard bound: 10 min / Tier-2 session
})()
// withDeadline(thunk, ms, onLate) + the TRAVERSAL_TIMEOUT sentinel now live in src/gate.mjs and are
// inlined by the @gate marker below (one implementation, unit-tested there, shared with the shipped
// wrapper so the two can never drift). Semantics are unchanged: value | timeout
// sentinel | rejected sentinel, unref'd timer, onLate for a late completion, never itself rejects.

// ── gateAgent — the single gate wrapper, inlined from src/gate.mjs. A mute gate reviewer DEGRADES
//    to null, never detonates the run; every gate call site below folds a null through a FAIL-CLOSED
//    path: a null argus yields null exit codes (fail closed in validateVerdict); a null traversal
//    pass folds static-only (the PARTIAL ceiling); a null arch-check or null goal audit rides the
//    dedicated unruled_gates channel into validateVerdict (the gate never ruled — coverage UNKNOWN
//    caps at PARTIAL, the Law-floor doctrine: a mute reporter is epistemic absence, not proven
//    breakage). validate matches the same NARROW union build uses, no wider. ──
// @gate

// ── The Gauge posture (the validate row) — passed by the conductor from state.json.
//    Accepts an object or a JSON string; anything else ⇒ null ⇒ every dial falls back to its legacy
//    default, so a run without a posture behaves exactly like the pre-posture path plus the deterministic Law floor
//    (unconditional when pluginRoot is present). The validate dials (D8=2 extras): ──
//      validate.adversarial_pass — run a second adversarial probe/criterion pass (extra scrutiny).
//      validate.second_family    — spawn a second cross-family validator over the same evidence.
const postureArg = (() => {
  let p = A.posture
  if (typeof p === 'string') { try { p = JSON.parse(p) } catch (e) { return null } }
  return (p && typeof p === 'object' && !Array.isArray(p)) ? p : null
})()
const PV = (postureArg && postureArg.validate && typeof postureArg.validate === 'object') ? postureArg.validate : {}
const posture = {
  adversarial_pass: PV.adversarial_pass === true,
  second_family: PV.second_family === true,
}

const docsDir = `${kilnDir}/docs`
const valDir = `${kilnDir}/validation`
const qaDir = `${kilnDir}/tmp/qa`
const masterPlanFile = `${kilnDir}/master-plan.md`
const visionFile = `${docsDir}/VISION.md`
const lawFile = `${kilnDir}/law.json`
const archCheckFile = `${valDir}/architecture-check.md`
const reportFile = `${valDir}/report.md`
// @inline:guards:NO_WANDER
const scope = `${NO_WANDER} Exception: the built project at ${projectPath} is also in scope.`

// ── MODEL_VOICE shell (Opus only; inlined from src/voice.mjs by the bundler) ──
// @inline:voice:MODEL_VOICE,voice
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
async function noteClaudeHeadSuccession() {
  if (CLAUDE_HEAD_MODEL !== CLAUDE_HEAD_FALLBACK || claudeHeadSuccessionNoted) return
  claudeHeadSuccessionNoted = true
  try { await ledger('note', { kind: 'capability', event: 'claude_head_demoted', head: 'fable', claude_head: CLAUDE_HEAD_MODEL }) } catch { /* best-effort beat */ }
}
// ── Twin Council pure core — the SEALED call-site machinery, lifted to
//    src/council.mjs and inlined here through the SAME @inline:council bundler contract build.js and
//    architecture.js use (helpers, never copy-paste). Powers validate's T4 keystone: the final-ruling
//    blind Fable/Sol pair over the ASSEMBLED deterministic verdict and the receipt-attested
//    second-family attestation leg. Every leg is DEFINED unconditionally but CALLED only on the
//    councilCapable path — sub-T4 / no-codex / tokenless runs are byte-preserved. ──
// @inline:council:COUNCIL_PROTOCOL_VERSION,sha256Hex,canonicalJson,claimTypeForClass,compareEvidence,validateReversal,councilSignature,verifySignature,validateRatification,twinRatified,buildCheckpoint,SHA64_RE,RATIFY_SCHEMA,envelopeSchema,CROSS_CHECK_SCHEMA,LEDGER_APPEND_SCHEMA,CANON_HASH_ONELINER,LEDGER_EXTRACT_ONELINER,councilTemplateHash,seatProv,solWrapperPlan,crossCheckOk,assembleRatifyCertificate,verdictShapeError

// ── Twin Council gating. Validate's final-ruling
//    council + the receipt-based second-family attestation go council-grade ONLY when the capability
//    record promised BOTH heads (T4 = fable + codex) AND the conductor minted a runToken. A PROMISED
//    council missing its runToken is NOT a clean run: the keystone ruling fails CLOSED (terminal
//    DEGRADED; no stage_completed even on a VALIDATE_PASS — never a silent completion). runTokenRaw
//    is the RAW per-run token; it lives ONLY in the receipt-script argv (a trusted process boundary),
//    never in any head-visible prompt/packet. capabilityTier is T1|T2|T3|T4; anything else ⇒ null. ──
const runTokenRaw = (typeof A.runToken === 'string' && A.runToken.length > 0) ? A.runToken : null
const capabilityTier = (A.capabilityTier === 'T1' || A.capabilityTier === 'T2' || A.capabilityTier === 'T3' || A.capabilityTier === 'T4') ? A.capabilityTier : null
const councilPromised = capabilityTier === 'T4' && codexAvailable
const councilCapable = councilPromised && runTokenRaw != null
const councilMisconfigured = councilPromised && runTokenRaw == null
if (councilMisconfigured) {
  log('MISCONFIGURED CONDUCTOR — capability tier T4 with both heads reachable but NO runToken: validate\'s final-ruling council cannot bind its receipts/seed. The keystone ruling fails CLOSED (terminal DEGRADED; no stage_completed even on a VALIDATE_PASS — never a silent completion). Relaunch with the per-run token to convene the council.')
}
// ONE receipts ledger SHARED with architecture/build (architecture.js:341-343) so the receipt script's
// replay rejection spans every council invocation of the run; validate council artifacts live under
// ${councilDir}. runTokenHash rides checkpoints only (never the raw token).
const councilDir = `${kilnDir}/council/validate`
const receiptsLedger = `${kilnDir}/council/receipts.jsonl`
const runTokenHash = runTokenRaw != null ? sha256Hex(runTokenRaw) : null
const COUNCIL_RENDERER_VALIDATE = 'b43-validate/1'
// Fixed rubric/task (NO per-run interpolation, so the template hash is run-independent). The council
// CONFIRMS or BLOCKS an assembled deterministic verdict — it never authors one (the monotonicity rail).
const VALIDATE_RULING_RUBRIC =
  'Rule the validate FINAL VERDICT on whether the ASSEMBLED deterministic ruling is HONEST and SOUND ' +
  'against the transcribed evidence: (1) the PASS/PARTIAL/FAILED verdict genuinely follows from the ' +
  'Law-run + suite exit codes, the per-criterion results, install_ok, and the recorded blocking findings; ' +
  '(2) no blocking defect, unmet critical criterion, or unruled gate is being waved through; (3) for a UI ' +
  'scope, the browser verdict matches the recorded traversal (a static-only UI verdict is never a clean ' +
  'PASS). You CONFIRM or BLOCK an ASSEMBLED verdict — you NEVER author a different one; a deterministic red ' +
  'is never yours to green. Every finding MUST be evidence-bound (a file/line, an executable check, or a ' +
  'named evidence artifact in the record).'
const VALIDATE_RULING_TASK =
  'Render one blind verdict — APPROVE (the assembled verdict is honest and evidence-supported), BLOCK, or ' +
  'NEITHER — on the validate final ruling against the rubric. You do not know who else is ruling. ' +
  'divergence_selections is [] (no open divergences). Echo artifact_hash EXACTLY as given. A BLOCK or NEITHER ' +
  'MUST carry at least one evidence-bound finding (finding_id unique, nonempty evidence_refs or a real ' +
  'executable_check); an evidence-free verdict is invalid. changed_evidence is [] unless you reverse a prior block.'
const councilTemplateHashValidate = councilTemplateHash({ rubric: VALIDATE_RULING_RUBRIC, ruling_task: VALIDATE_RULING_TASK, renderer: COUNCIL_RENDERER_VALIDATE })
// GOAL_SECOND_PAYLOAD_SCHEMA — the receipt-attested second-family goal audit: codex runs
// --sandbox read-only and CANNOT write goal-backward-final-second.md, so the report content rides
// report_markdown (extracted by the wrapper via extractTo) alongside the overall/findings the
// deterministic reconcile reads.
const GOAL_SECOND_PAYLOAD_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    overall: { type: 'string', enum: ['pass', 'fail'], description: 'does the WHOLE deliverable genuinely deliver the VISION success criteria? \'fail\' MUST be backed by at least one critical or high finding' },
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { text: { type: 'string' }, severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] } },
        required: ['text', 'severity'],
      },
    },
    report_file: { type: 'string' },
    reasoning: { type: 'string', maxLength: 700 },
    report_markdown: { type: 'string', description: 'the FULL goal-backward-final-second content (the wrapper writes it to disk; codex runs read-only and cannot write files)' },
  },
  required: ['overall', 'findings', 'report_markdown'],
}
// EVIDENCE_ANCHOR_SCHEMA / evidenceAnchorPrompt — a Thoth transcription leg hashes
// the NAMED evidence artifacts into a {path, sha256} manifest. A dead/garbled/partial anchor ⇒ the ruling
// DEGRADES fail-closed — the certificate must never bind unhashed names; the anchor gates BEFORE the
// record freezes.
const EVIDENCE_ANCHOR_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { reasoning: { type: 'string', maxLength: 400 }, files: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, sha256: { type: 'string' } }, required: ['path', 'sha256'] } } },
  required: ['files'],
}
const evidenceAnchorPrompt = (inputs) =>
  `You are Thoth, the scribe — transcribe hashes, never judge, never fix.\n\n` +
  `<task>Run (Bash): 'sha256sum ${inputs.join(' ')}'. Transcribe each input file's sha256 into files[] as {path, sha256} (VERBATIM, lowercase hex, the path exactly as given). Do not read file contents, do not write or fix anything.</task>`
// crossCheckPrompt — the receipt-ledger cross-check transcription (thoth:receipt-check); mirrors
// architecture/build. Every path argument is SHELL-QUOTED; neither one-liner carries a single quote.
const crossCheckPrompt = (outFile, outputSha, sessionId) =>
  `You are Thoth, the receipt cross-checker — transcribe, never compose, never judge. Run these three EXACT commands (Bash) and transcribe their output.\n\n` +
  `<task>\n` +
  `1. run EXACTLY: sha256sum "${outFile}" — output_sha256_disk = the 64-hex digest (the first field only).\n` +
  `2. run EXACTLY: node -e '${CANON_HASH_ONELINER}' "${outFile}" — output_canonical_sha256 = its stdout (a 64-hex digest).\n` +
  `3. run EXACTLY: node -e '${LEDGER_EXTRACT_ONELINER}' "${receiptsLedger}" "${outputSha}" "${sessionId}" — ledger = the { verified, reservation } JSON it prints (this leg's verified row + its reservation; nulls where unmatched).\n` +
  `Emit output_sha256_disk, output_canonical_sha256, and the ledger object. Do not read the files for content, do not write or fix anything.</task>`
// runSolCrossCheck — the structural→LEDGER-VERIFIED upgrade. A mute/garbled leg gets ONE
// re-dispatch, then fails closed; crossCheckOk binds the whole INVOCATION-EXACT chain.
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
// councilCheckpoint — a buildCheckpoint row via the stage ledger (note{kind:'council_state'}); FAIL-OPEN
// telemetry (an append failure never fails the stage). councilRuling emits note{kind:'council_ruling'}.
const councilReceipts = []
const pushCouncilReceipt = (bucket, leg, sink, cross) => bucket.push({
  leg, invocation_id: cross && cross.invocation_id ? cross.invocation_id : null,
  receipt_verified: !!(sink && sink.receipt_verified), ledger_verified: !!(cross && cross.ledger_verified),
  session_id: sink && sink.session_id != null ? sink.session_id : null, tokens_used: sink && sink.tokens_used != null ? sink.tokens_used : null,
})
const councilCheckpoint = async (fields) => {
  try { await ledger('note', buildCheckpoint(fields)) }
  catch (e) { log(`council checkpoint ${fields && fields.phase} not ledgered (non-fatal): ${e && e.message ? e.message : e}`) }
}
const councilRuling = async (data) => {
  try { await ledger('note', { kind: 'council_ruling', ...data }) }
  catch (e) { log(`council ruling not ledgered (non-fatal): ${e && e.message ? e.message : e}`) }
}
// runBlindPair — the sealed-before-exposed pair: Fable and receipt-attested Sol rule blind, in parallel,
// over a given schema (xhigh, council-grade). Sol death / invalid receipt / failed cross-check ⇒
// degraded. Blindness rails: the fable prompt never mentions codex/receipt/session/Sol; the sol packet
// never mentions fable or the run token. Returns { degraded, missing, rF, rS, sinkF, sinkS, solCross }.
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
// runValidateRuling — the REQUIRED blind Fable/Sol pair over the ASSEMBLED deterministic verdict
// record, at T4, for EVERY computed verdict (PASS incl. prospective, PARTIAL, FAILED). The frozen record
// IS the rendered artifact — no second render, so bundle_hash = plan_hash. Dual-APPROVE + valid ⇒ a
// twin_ratified certificate; ANY other outcome ⇒ the DETERMINISTIC verdict STANDS UNALTERED with an
// honest terminal (DEGRADED naming heads / BLOCKED with frozen findings). The monotonicity rail is
// ABSOLUTE: this function returns council fields ONLY — v.verdict/blocking/correction_tasks are never
// touched; the caller gates stage_completed on RATIFIED and rides the terminal on the records.
const runValidateRuling = async (v, verdictInput, secondFamily, goalReportFiles) => {
  const phaseName = 'The Verdict'
  const keystone = 'validate_ruling'
  const phaseTag = 'VALIDATE_RATIFY'
  const namedEvidence = [reportFile, lawFile].concat(Array.isArray(goalReportFiles) ? goalReportFiles : [])
  const anchor = await agent(evidenceAnchorPrompt(namedEvidence), { label: 'thoth:validate-anchor', phase: phaseName, model: 'haiku', schema: EVIDENCE_ANCHOR_SCHEMA })
  const anchorFiles = (anchor && Array.isArray(anchor.files)) ? anchor.files.filter((f) => f && typeof f.path === 'string' && typeof f.sha256 === 'string' && SHA64_RE.test(f.sha256)) : []
  const anchorPaths = anchorFiles.map((f) => f.path)
  const anchorExact =
    anchor && Array.isArray(anchor.files) && anchorFiles.length === anchor.files.length &&
    anchorFiles.length === namedEvidence.length &&
    new Set(anchorPaths).size === anchorFiles.length &&
    namedEvidence.every((p) => anchorPaths.includes(p))
  if (!anchorExact) {
    await councilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: councilTemplateHashValidate, run_token_hash: runTokenHash, initial_ledger_seq: null, keystone_id: keystone, phase: 'DEGRADED', decision_bundle_hash: null, input_artifact_hashes: [], evidence_manifest_hash: null, anonymous_seat_artifact_hashes: {}, seat_provenance: { missing: 'evidence' }, codex_receipt_hash: null, status: 'sealed' })
    await councilRuling({ keystone, phase: phaseTag, terminal: 'DEGRADED', reason: 'evidence-anchor' })
    log('validate final-ruling evidence anchor DEGRADED — the certificate must never bind unhashed names; verdict fields UNCHANGED, stage_completed gated')
    return { terminal: 'DEGRADED', certificate: null, findings: [], bundle_hash: null, receipt_verified: false, ledger_verified: false }
  }
  const manifest = {}
  for (const f of anchorFiles) manifest[f.path] = f.sha256
  const evidenceRefs = Object.keys(manifest).sort().map((p) => ({ path: p, sha256: manifest[p] }))
  const evidenceManifestHash = sha256Hex(canonicalJson(manifest))
  const evidenceInputHashes = Object.keys(manifest).sort().map((k) => manifest[k])
  // The FROZEN verdict record. Every field is a COPY of the deterministic assembly — the council
  // rules this record, it can never alter it.
  const record = {
    verdict: v.verdict,
    verification_class: v.verification_class,
    browser_verdict: v.browser_verdict,
    verdict_input: {
      law_run_exit: verdictInput.law_run_exit,
      suite_exit: verdictInput.suite_exit,
      install_ok: verdictInput.install_ok,
      criteria: (Array.isArray(verdictInput.criteria) ? verdictInput.criteria : []).map((c) => ({ id: c && c.id != null ? c.id : null, met: !!(c && c.met), critical: !(c && c.critical === false) })),
      blocking_findings: Array.isArray(verdictInput.blocking_findings) ? verdictInput.blocking_findings : [],
      unruled_gates: Array.isArray(verdictInput.unruled_gates) ? verdictInput.unruled_gates : [],
      ui_scope: verdictInput.ui_scope === true,
      browser_path: verdictInput.browser_path != null ? verdictInput.browser_path : '',
      missing_creds: verdictInput.missing_creds === true,
    },
    second_family: { requested: !!(secondFamily && secondFamily.requested), verified: !!(secondFamily && secondFamily.verified), degraded: !!(secondFamily && secondFamily.degraded) },
    evidence_refs: evidenceRefs,
  }
  const bundleHash = sha256Hex(canonicalJson(record))
  const ckptBase = { protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: councilTemplateHashValidate, run_token_hash: runTokenHash, initial_ledger_seq: null, keystone_id: keystone, decision_bundle_hash: bundleHash, input_artifact_hashes: evidenceInputHashes, evidence_manifest_hash: evidenceManifestHash }
  const recordJson = JSON.stringify(record)
  const ratifyInputs =
    `<inputs>\n- The deterministic verdict under ruling: ${v.verdict} (verification_class ${v.verification_class}, browser_verdict ${v.browser_verdict}).\n` +
    `- The COMPLETE frozen verdict record you are ratifying (evidence_refs bind each NAMED artifact to its sha256):\n${recordJson}\n` +
    `- The live repo + built app at ${projectPath}; read each evidence_refs path and confirm it matches its bound hash, then judge whether the assembled verdict is honest against the transcribed evidence.\n</inputs>`
  const bindingLine = `Binding: artifact_hash = "${bundleHash}" (echo it VERBATIM). divergence_selections = [] (no open divergences this round). changed_evidence = [] unless you reverse a prior block.`
  const fablePrompt =
    `You are a council ratifier (validate final ruling) — rule the assembled deterministic verdict against the fixed rubric, blind and independent. You do not know who else is ruling.\n\n` +
    `${ratifyInputs}\n\n<rubric>\n${VALIDATE_RULING_RUBRIC}\n</rubric>\n\n<binding>\n${bindingLine}\n</binding>\n<constraints>\n- Rule from the repo + the persisted deterministic evidence NAMED in the record's evidence_refs; NEVER launch a browser (the bounded Tier-2 traversal already ran; its verdict is in the record).\n</constraints>\n\n` +
    `<task>${VALIDATE_RULING_TASK}\nEmit the evidence-bound findings + changed_evidence + divergence_selections FIRST, then the verdict (evidence-before-commit); reasoning is optional, last, and under 50 words. ${PAYLOAD_FIRST}</task>`
  const solBrief = `${bindingLine}\nRubric:\n${VALIDATE_RULING_RUBRIC}\nRule read-only from the repo + the persisted deterministic evidence NAMED in the record's evidence_refs (each bound to its sha256); NEVER launch a browser.`
  const pair = await runBlindPair({ keystone, phaseTag, legName: 'validate-ruling', fablePrompt, solTaskText: VALIDATE_RULING_TASK, solBrief, solPacket: { verdict_record: record, artifact_hash: bundleHash }, schema: RATIFY_SCHEMA, phaseName })
  const seatHashes = (rF, rS) => ({ P0: sha256Hex(canonicalJson(rF)), P1: sha256Hex(canonicalJson(rS)) })
  if (pair.degraded) {
    await councilCheckpoint({ ...ckptBase, phase: 'DEGRADED', anonymous_seat_artifact_hashes: {}, seat_provenance: { missing: pair.missing }, codex_receipt_hash: null, status: 'sealed' })
    await councilRuling({ keystone, phase: phaseTag, terminal: 'DEGRADED', missing: pair.missing })
    log(`validate final-ruling council DEGRADED (${pair.missing}) — verdict fields UNCHANGED, stage_completed gated (never a single-head ruling)`)
    return { terminal: 'DEGRADED', certificate: null, findings: [], bundle_hash: bundleHash, missing: pair.missing, receipt_verified: !!(pair.sinkS && pair.sinkS.receipt_verified), ledger_verified: !!(pair.solCross && pair.solCross.ledger_verified) }
  }
  // Validity logic: compute vF/vS + shapeF/shapeS FIRST; ANY invalid/shape-bad
  // ratification ⇒ DEGRADED naming the head(s) (never BLOCKED, never a frozen-findings carry from an
  // invalid verdict); ONLY live, VALID BLOCK/NEITHER verdicts ⇒ BLOCKED with frozen findings.
  const vF = validateRatification(pair.rF, { bundle_hash: bundleHash, open_divergence_ids: [] })
  const vS = validateRatification(pair.rS, { bundle_hash: bundleHash, open_divergence_ids: [] })
  const shapeF = verdictShapeError(pair.rF), shapeS = verdictShapeError(pair.rS)
  const fBad = !vF.valid || !!shapeF, sBad = !vS.valid || !!shapeS
  if (fBad || sBad) {
    const missing = fBad && sBad ? 'both' : (fBad ? 'fable' : 'sol')
    const detail = [fBad ? `fable${shapeF ? `: ${shapeF}` : ''}` : null, sBad ? `sol${shapeS ? `: ${shapeS}` : ''}` : null].filter(Boolean).join('; ')
    await councilCheckpoint({ ...ckptBase, phase: 'DEGRADED', anonymous_seat_artifact_hashes: {}, seat_provenance: { missing, reason: 'invalid ratification' }, codex_receipt_hash: null, status: 'sealed' })
    await councilRuling({ keystone, phase: phaseTag, terminal: 'DEGRADED', missing, invalid: { fable: fBad, sol: sBad } })
    log(`validate final-ruling ratification INVALID (${detail}) — DEGRADED (never mislabeled BLOCKED); verdict fields UNCHANGED, stage_completed gated`)
    return { terminal: 'DEGRADED', certificate: null, findings: [], bundle_hash: bundleHash, missing, receipt_verified: true, ledger_verified: true }
  }
  if (pair.rF.verdict === 'APPROVE' && pair.rS.verdict === 'APPROVE') {
    const cert = assembleRatifyCertificate({ rF: pair.rF, rS: pair.rS, provF: seatProv(pair.sinkF, 'fable'), provS: seatProv(pair.sinkS, 'sol'), context: { bundle_hash: bundleHash, renderer_version: COUNCIL_RENDERER_VALIDATE, plan_hash: bundleHash, evidence_manifest_hash: evidenceManifestHash, protocol_version: COUNCIL_PROTOCOL_VERSION, seat_provenance: null } })
    if (!cert.ok) {
      await councilCheckpoint({ ...ckptBase, phase: 'DEGRADED', anonymous_seat_artifact_hashes: {}, seat_provenance: { reason: 'certificate defect' }, codex_receipt_hash: null, status: 'sealed' })
      await councilRuling({ keystone, phase: phaseTag, terminal: 'DEGRADED', reason: 'certificate defect' })
      log(`validate final-ruling certificate could not seal (${cert.reason}) — DEGRADED, stage_completed gated`)
      return { terminal: 'DEGRADED', certificate: null, findings: [], bundle_hash: bundleHash, receipt_verified: true, ledger_verified: true }
    }
    await councilCheckpoint({ ...ckptBase, phase: 'VALIDATE_RATIFY_SEALED', anonymous_seat_artifact_hashes: seatHashes(pair.rF, pair.rS), seat_provenance: { P0: seatProv(pair.sinkF, 'fable'), P1: seatProv(pair.sinkS, 'sol') }, codex_receipt_hash: pair.solCross.codex_receipt_hash, status: 'sealed' })
    await councilCheckpoint({ ...ckptBase, phase: 'RATIFIED', anonymous_seat_artifact_hashes: {}, seat_provenance: {}, codex_receipt_hash: null, status: 'sealed' })
    await councilRuling({ keystone, phase: phaseTag, terminal: 'RATIFIED', bundle_hash: bundleHash, certificate: cert.certificate })
    log(`TWIN COUNCIL RATIFIED the validate final ruling (bundle ${String(bundleHash).slice(0, 12)}…) — the ${v.verdict} verdict carries two valid head signatures`)
    return { terminal: 'RATIFIED', certificate: cert.certificate, findings: [], bundle_hash: bundleHash, receipt_verified: true, ledger_verified: true }
  }
  // Both valid but not dual-APPROVE ⇒ a live, VALID BLOCK/NEITHER ⇒ honest BLOCKED; FREEZE the findings.
  const frozen = [...(pair.rF.verdict === 'BLOCK' || pair.rF.verdict === 'NEITHER' ? (Array.isArray(pair.rF.findings) ? pair.rF.findings : []) : []), ...(pair.rS.verdict === 'BLOCK' || pair.rS.verdict === 'NEITHER' ? (Array.isArray(pair.rS.findings) ? pair.rS.findings : []) : [])]
  await councilCheckpoint({ ...ckptBase, phase: 'VALIDATE_RATIFY_SEALED', anonymous_seat_artifact_hashes: seatHashes(pair.rF, pair.rS), seat_provenance: { P0: seatProv(pair.sinkF, 'fable'), P1: seatProv(pair.sinkS, 'sol') }, codex_receipt_hash: pair.solCross.codex_receipt_hash, status: 'sealed' })
  await councilRuling({ keystone, phase: phaseTag, terminal: 'BLOCKED', verdicts: { fable: pair.rF.verdict, sol: pair.rS.verdict }, findings: frozen })
  log(`validate final-ruling council BLOCKED (fable ${pair.rF.verdict}, sol ${pair.rS.verdict}) — verdict fields UNCHANGED, stage_completed gated; ${frozen.length} finding(s) frozen onto the records`)
  return { terminal: 'BLOCKED', certificate: null, findings: frozen, bundle_hash: bundleHash, receipt_verified: true, ledger_verified: true }
}

// SPIN carries the per-phase worker-tree lines; several promoted lines ride the beats below
// ('Intent versus reality' → validate.fanout, 'The traversal sweeps its own ashes' →
// validate.traversal_done, 'The letter passes; does the spirit?' → validate.goal_read).
const SPIN = {
  drift: ['Zoxea checks the seams'],
  validate: ['The Law runs fresh — confirmation, not discovery'],
  traverse: ['One evaluator, one browser, one deadline'],
  goal: ['Working backward from the promise', 'Does the whole thing deliver the goal?'],
  verdict: ['The evidence rules — exit codes do not negotiate'],
}
const spin = (k, i) => { const a = SPIN[k] || []; return a.length ? a[((i % a.length) + a.length) % a.length] : '' }

// The wrapper TRANSLATES a brief into a Codex-native prompt — never forwards it verbatim. The full
// discipline lives in references/codex-prompt-guide.md — point at it, don't duplicate it.
const codexGuide = pluginRoot ? `${pluginRoot}/references/codex-prompt-guide.md` : null
const codexGuideNote = codexGuide
  ? `Read ${codexGuide} first and follow it for the full codex-prompt discipline (per-role flags — run codex at the model_reasoning_effort this prompt specifies — the --output-schema/reasoning-first/flat-schema rules, the heredoc-to-stdin invocation, and the exit-0 and #15451 caveats). `
  : ``

// ── Schemas (additionalProperties:false; payload fields FIRST, reasoning LAST + optional + capped — a long leading reasoning string truncated tool calls before the payload landed and blew the 5-attempt retry cap) ──
const ARCHCHECK_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    check_file: { type: 'string' },
    drift: { type: 'array', items: { type: 'string' }, description: 'places the implementation diverges from architectural intent' },
    seam_issues: { type: 'array', items: { type: 'string' }, description: 'interface-boundary / cross-module contract mismatches (the regressions that hide under N commits)' },
    blocking: { type: 'array', items: { type: 'string' }, description: 'the drift/seam findings severe enough to block a PASS (a broken seam, a violated load-bearing constraint) — these gate the verdict' },
    summary: { type: 'string' },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['check_file', 'summary'],
}
// The deterministic-first evidence schema: argus ORCHESTRATES the install + the three
// kiln-law commands and the per-criterion exercise, and TRANSCRIBES what they printed. The verdict
// is computed from these fields (validateVerdict) — the agent does not self-grade PASS/PARTIAL/FAILED.
const VALIDATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    report_file: { type: 'string' },
    product_type: { type: 'string', enum: ['cli', 'api', 'web', 'extension', 'electron', 'library', 'mobile'] },
    install_ok: { type: 'boolean', description: 'the app installed/built cleanly (false ⇒ a build error — the verdict FAILS)' },
    law_run_exit: { type: 'number', description: 'the EXACT exit code of `kiln-law run` FULL (all SCs incl. probes) — the Law floor; non-zero = the Law is red (-1 if you could not run it)' },
    suite_cmd: { type: 'string', description: 'the exact command kiln-law suite ran (incl. any install step)' },
    suite_exit: { type: 'number', description: 'the EXACT exit code of the project suite via `kiln-law suite` (-1 if not run)' },
    tests_passed: { type: 'number' }, tests_failed: { type: 'number' },
    run_id: { type: 'string', description: 'the kiln-law run id whose evidence dir holds results.jsonl + the probe artifacts' },
    verification_class_full: { type: 'boolean', description: 'the kiln-law run finalized verification_class:"full" (true) vs "static-only" (false — a probe deferred: playwright absent or an un-instantiated template)' },
    criteria: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string' },
          met: { type: 'boolean', description: 'the criterion was exercised and genuinely met (not just trusting the suite)' },
          critical: { type: 'boolean', description: 'a criterion whose failure is fatal — true unless the plan marks it optional/non-critical' },
          browser_only: { type: 'boolean', description: 'this criterion can ONLY be confirmed by driving the live UI in a browser (its met value is provisional until the Tier-2 traversal)' },
          note: { type: 'string' },
        },
        required: ['id', 'met'],
      },
    },
    ui_scope: { type: 'boolean', description: 'true iff the deliverable has UI/web behavioral criteria (web/extension/electron product, a design/ dir, or any browser_only criterion)' },
    missing_creds: { type: 'boolean', description: 'a credentials/env gap blocked some check — caps the verdict at PARTIAL, never FAILED on its own' },
    coverage_gaps: { type: 'array', items: { type: 'string' } },
    blocking_findings: { type: 'array', items: { type: 'string' }, description: 'any failure severe enough to block a PASS that is not already captured by an exit code or an unmet critical criterion' },
    correction_tasks: { type: 'array', items: { type: 'string' } },
    reasoning: { type: 'string', maxLength: 700 },
  },
  // Exit codes are transcribed EXACTLY and the verdict rules over them — so the two Law-floor
  // exit codes are MANDATORY (a missing suite_exit folds to null and FAILS CLOSED in validateVerdict;
  // requiring it forces the honest transcription, -1 in the no-pluginRoot degraded branch). suite_cmd
  // is required alongside so the transcribed suite exit is always traceable to the command that produced it.
  required: ['report_file', 'install_ok', 'law_run_exit', 'suite_exit', 'suite_cmd', 'criteria', 'ui_scope'],
}
const TRAVERSAL_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    tool: { type: 'string', enum: ['kiln-probe', 'none'], description: 'the browser path you actually used (kiln-probe = the scripted one-shot oracle, the ONLY autonomous path; none = no browser available — playwright absent)' },
    browser_result: { type: 'string', enum: ['full', 'failed', 'static-only'], description: 'full = every UI criterion exercised live and clean via the scripted oracle; failed = a real UI defect found; static-only = no browser path available OR the lease expired before all criteria were confirmed (honest degradation)' },
    criteria: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string' },
          met: { type: 'boolean', description: 'confirmed by actually driving the UI (or UNVERIFIED when no browser path — set verified:false)' },
          verified: { type: 'boolean', description: 'a browser actually exercised this criterion (false = UNVERIFIED, static-only)' },
          note: { type: 'string' },
        },
        required: ['id', 'met', 'verified'],
      },
    },
    findings: { type: 'array', items: { type: 'string' }, description: 'UI defects found by the live traversal (each one blocks a clean UI PASS)' },
    report_file: { type: 'string' },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['tool', 'browser_result', 'criteria', 'findings'],
}
const GOAL_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    overall: { type: 'string', enum: ['pass', 'fail'], description: 'does the WHOLE deliverable genuinely deliver the VISION success criteria? \'fail\' MUST be backed by at least one critical or high finding' },
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { text: { type: 'string' }, severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] } },
        required: ['text', 'severity'],
      },
    },
    report_file: { type: 'string' },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['overall', 'findings'],
}
const DETECT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { design_present: { type: 'boolean', description: 'true iff a non-empty design/ directory exists under .kiln' }, reasoning: { type: 'string', maxLength: 700 } },
  required: ['design_present'],
}

// ── The deterministic verdict + reconcile blocking arithmetic — inlined pure
//    logic, unit-tested in src/spine.mjs and src/reconcile.mjs. The PASS/PARTIAL/FAILED ruling runs
//    IN THE SCRIPT over the evidence files, never in an agent. ──
// @inline:spine:validateVerdict
// @inline:reconcile:SEV_RANK,norm,denzelReconcile

// ── Ledger: posture + sweep + verdict events into events.jsonl via the kiln-state
//    CLI. Only called when pluginRoot is known (the CLI path is resolvable); absence degrades the
//    append to a no-op log line, never a thrown stage. ──
async function ledger(type, data) {
  if (!pluginRoot) { log(`(ledger skipped — pluginRoot absent) ${type}`); return }
  const ev = JSON.stringify({ type, stage: 'validate', data })
  await agent(
    `You are Thoth, the scribe — "write it down or it never happened". Append ONE event to the Kiln run ledger.\n\n` +
    `<task>Run this exact command (Bash), substituting the JSON verbatim — do not edit it:\n` +
    '```\n' +
    `node ${pluginRoot}/scripts/kiln-state.mjs append ${kilnDir} '${ev.replace(/'/g, `'\\''`)}'\n` +
    '```\n' +
    `If it exits non-zero (e.g. no events.jsonl yet — the run was not initialised), report the error in your summary; do NOT create or repair any file. Report only whether the append succeeded.</task>`,
    { label: 'thoth:ledger', phase: 'The Verdict', model: 'haiku' }
  )
}

// ── Lore beats: a trial/evidence dispatch at the moment a fact becomes true, carried
//    by the ledger to the operator's transcript between the banners (note{kind:'lore'}; deterministic
//    <stage>.<beat> key; args short scalars capped at 80 by the caller; text ≤ 160). PRESENTATION,
//    null-keep: pluginRoot absent ⇒ a plain log() line, never a stage failure. validate's ledger()
//    takes no phaseName (its Thoth leg is labeled 'The Verdict'), so lore rides the same two-arg call. ──
const LORE_MAX = 160
const oneLine = (s, cap = LORE_MAX) => String(s).replace(/[\x00-\x1f\x7f]+/g, ' ').slice(0, cap)
// args are bound HERE: every string value is capped at 80 mechanically, so a beat can never
// leak an unbounded project-controlled string into the ledger even if a call site forgets to cap.
const boundArgs = (a) => { const o = {}; for (const [k, v] of Object.entries(a)) o[k] = typeof v === 'string' ? oneLine(v, 80) : v; return o }
const lore = (key, text, args) =>
  pluginRoot
    ? ledger('note', { kind: 'lore', key, text: oneLine(text), ...(args ? { args: boundArgs(args) } : {}) })
    : log(oneLine(text))

// ── Stage-level browser sweep — the OUTER bracket
//    around the Tier-2 traversal. The browser is a subprocess with a deadline, never a service:
//    kiln-probe brackets its own per-run sweep, but a wrapper SIGKILLed at an OUTER deadline never
//    runs its exit handler. THIS stage bracket is the backstop, ONE arm now (the MCP arm is gone —
//    autonomous validate no longer drives Playwright MCP per the ruling, so no host browser exists to
//    reap): `kiln-probe sweep VALIDATE_RUN_TOKEN` — RUN-TOKEN scoped to the scripted oracle's own
//    `kiln-pw-<token>` trees (never the whole namespace, never the operator's browser; blanket
//    pkill -f chrome stays forbidden). Used pre-flight before the first traversal probe (defends
//    against a prior crashed run's orphans). The stage-END teardown is leaseRelease() below, which
//    kills the watchdog AND sweeps the same token in one shot. Ledgered; the sweep CLI always exits 0
//    so cleanup never fails a stage. ──
// SWEEP_SCAN_SCHEMA — the sweep leg now runs TWO commands (sweep, then the READ-ONLY leak-scan) and
// reports both: the SWEEP line (owned-namespace cleanup, as before) and the LEAK_SCAN json (a foreign
// browser we do not own). leak_suspects rides the baseline
// browser_sweep event on EVERY bracket; the suspect/profile-dir detail rides a separate
// browser_leak_suspect event ONLY when count>0 (a lean ledger — zero-suspect scans ride the count).
const SWEEP_SCAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    sweep_line: { type: 'string', description: 'the SWEEP … line the sweep command printed, verbatim' },
    leak_scan_line: { type: 'string', description: 'the LEAK_SCAN {json} line leak-scan printed, verbatim' },
    leak_suspects: { type: 'integer', description: "the LEAK_SCAN json's counts.suspects — foreign browsers alive (0 when none)" },
    suspects: {
      type: 'array', description: "the LEAK_SCAN json's suspects array ([] when none)",
      items: {
        type: 'object', additionalProperties: false,
        properties: { pid: { type: 'integer' }, arg0: { type: 'string' }, namespace: { type: 'string' }, user_data_dir: { type: 'string' } },
        required: ['pid', 'arg0', 'namespace', 'user_data_dir'],
      },
    },
    profile_dirs: {
      type: 'array', description: "the LEAK_SCAN json's profile_dirs array — abandoned temp profiles ([] when none)",
      items: {
        type: 'object', additionalProperties: false,
        properties: { path: { type: 'string' }, mtime: { type: 'string' } },
        required: ['path', 'mtime'],
      },
    },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['sweep_line', 'leak_scan_line', 'leak_suspects', 'suspects', 'profile_dirs'],
}
async function stageSweep(when) {
  if (!pluginRoot) { log(`(browser sweep skipped — pluginRoot absent) ${when}`); return }
  const r = await agent(
    `You are the browser-leak sweeper — the stage-level bracket of the bounded-browser discipline (the browser is a subprocess with a deadline, never a service). You run TWO commands and report what they found; you never launch a browser, never edit, never judge, and never kill anything yourself.\n\n` +
    `<task>Run these TWO exact commands in order (Bash):\n` +
    '```\n' +
    `node ${pluginRoot}/scripts/kiln-probe.mjs sweep ${VALIDATE_RUN_TOKEN}\n` +
    `node ${pluginRoot}/scripts/kiln-probe.mjs leak-scan\n` +
    '```\n' +
    `The FIRST sweeps THIS validate stage's own scripted-probe browser trees ONLY — the prefix '${VALIDATE_RUN_TOKEN}' can never touch a concurrent Kiln run or the operator's own browser; blanket 'pkill -f chrome' is forbidden. It ALWAYS exits 0.\n` +
    `The SECOND is a STRICTLY READ-ONLY scan for a FOREIGN browser we do not own (a stray Playwright temp-profile or Playwright-MCP browser) — it kills NOTHING, removes NOTHING, and ALWAYS exits 0. It prints ONE 'LEAK_SCAN {json}' line.\n` +
    `Report: sweep_line = the 'SWEEP …' line verbatim; leak_scan_line = the 'LEAK_SCAN …' line verbatim; leak_suspects = the LEAK_SCAN json's counts.suspects; suspects = its suspects array ([] when none); profile_dirs = its profile_dirs array ([] when none). Do not run anything else.</task>`,
    { label: `sentinel:sweep:${when}`, phase: 'The Traversal', model: 'haiku', schema: SWEEP_SCAN_SCHEMA }
  )
  const leakSuspects = (r && Number.isInteger(r.leak_suspects)) ? r.leak_suspects : 0
  const suspects = (r && Array.isArray(r.suspects)) ? r.suspects : []
  const profileDirs = (r && Array.isArray(r.profile_dirs)) ? r.profile_dirs : []
  // Baseline proof for BOTH arms on every bracket: leak_suspects AND
  // leak_profile_dirs ride browser_sweep, so the ledger records that disk evidence existed
  // even when no foreign browser is alive. The detail event stays gated on LIVE suspects —
  // stale /tmp profile dirs from unrelated work would make a dirs-only alarm cry wolf; their
  // detail rides whenever the alarm fires, and the LEAK_SCAN line is in the transcript anyway.
  await ledger('browser_sweep', { stage: 'validate', when, token: VALIDATE_RUN_TOKEN, leak_suspects: leakSuspects, leak_profile_dirs: profileDirs.length })
  if (leakSuspects > 0) {
    await ledger('browser_leak_suspect', { stage: 'validate', when, token: VALIDATE_RUN_TOKEN, suspects, profile_dirs: profileDirs })
  }
}

// ── The browser lease — the CAPABILITY deadline. A workflow
//    cannot CANCEL a spawned agent, so the ≤10-min Tier-2 cap lives on the TOOL: leaseTake() writes
//    a kiln-probe lease keyed by VALIDATE_RUN_TOKEN for the traversal budget (seconds), spawning a
//    detached self-terminating watchdog (PID recorded) that sweeps + deletes the lease at expiry; every
//    scripted probe the evaluator fires carries `--lease VALIDATE_RUN_TOKEN` and so REFUSES (exit 77)
//    once the lease expires — an evaluator alive past the deadline can do no further browser work.
//    leaseRelease() is the stage-END teardown: it kills the watchdog (teardown is NOW, not at the cap)
//    and sweeps the token immediately, then deletes the lease so it can never block a later run. Both
//    ledgered; both CLIs always exit 0 so the lease bracket never fails a stage. Skipped (with an
//    honest log line) when pluginRoot is absent — there is no scripted oracle then, so nothing to
//    lease; the verdict degrades to static-only. The seconds budget is ceil(ms/1000), floored at 1. ──
async function leaseTake() {
  if (!pluginRoot) { log('(browser lease skipped — pluginRoot absent; no scripted oracle to lease)'); return }
  const seconds = Math.max(1, Math.ceil(TRAVERSAL_DEADLINE_MS / 1000))
  await agent(
    `You are the lease-taker — you authorize the Tier-2 browser capability for a bounded window, then report. You never launch a browser, never edit, never judge.\n\n` +
    `<task>Run this exact command (Bash):\n` +
    '```\n' +
    `node ${pluginRoot}/scripts/kiln-probe.mjs lease ${kilnDir} ${VALIDATE_RUN_TOKEN} ${VALIDATE_RUN_TOKEN} ${seconds}\n` +
    '```\n' +
    `It writes the browser lease (token '${VALIDATE_RUN_TOKEN}', a ${seconds}s expiry) and spawns a detached self-terminating watchdog that sweeps the token + deletes the lease at expiry. The Tier-2 evaluator's scripted probes run with '--lease ${VALIDATE_RUN_TOKEN}' and refuse (exit 77) once it expires — that is how the ≤10-min cap is enforced on the capability. It ALWAYS exits 0. Transcribe the 'LEASE …' line it prints. Do not run anything else.</task>`,
    { label: 'sentinel:lease-take', phase: 'The Traversal', model: 'haiku' }
  )
  await ledger('browser_lease', { stage: 'validate', action: 'take', token: VALIDATE_RUN_TOKEN, seconds })
}
async function leaseRelease() {
  if (!pluginRoot) { log('(browser lease-release skipped — pluginRoot absent)'); return }
  await agent(
    `You are the lease-releaser — the stage-end teardown of the bounded-browser capability. You run the cleanup command below and report; you never launch a browser, never edit, never judge.\n\n` +
    `<task>Run this exact command (Bash):\n` +
    '```\n' +
    `node ${pluginRoot}/scripts/kiln-probe.mjs lease-release ${kilnDir} ${VALIDATE_RUN_TOKEN}\n` +
    '```\n' +
    `It kills the lease watchdog (teardown is now, not at the deadline), sweeps the '${VALIDATE_RUN_TOKEN}' browser trees, and deletes the lease file — so no Tier-2 browser outlives this stage and no stale lease blocks a later run. It ALWAYS exits 0. Transcribe the 'LEASE_RELEASE …' line it prints. Do not run anything else.</task>`,
    { label: 'sentinel:lease-release', phase: 'The Traversal', model: 'haiku' }
  )
  await ledger('browser_lease', { stage: 'validate', action: 'release', token: VALIDATE_RUN_TOKEN })
}

// ── Prompt builders ──
function driftPrompt() {
  return voice('sonnet') +
    `You are the architecture-drift verifier. ${scope}\n\n` +
    `<inputs>\n- Architectural intent: ${docsDir}/architecture.md, ${docsDir}/arch-constraints.md\n- What was built: ${docsDir}/codebase-state.md and the actual source under ${projectPath}\n</inputs>\n\n` +
    `<task>Compare what was BUILT against the architectural intent and constraints. Then check the interface SEAMS — where modules meet, do the contracts (signatures, shapes, events, shared state) actually line up, or did a later slice break an earlier one's interface? Write ${archCheckFile} (mkdir -p first): list any drift (constraint violations, structural divergence, missing seams), any seam/regression issues, and a BLOCKING subset — only the findings severe enough to block a PASS (a broken seam, a violated load-bearing constraint). Be concrete and file-specific — the full detail lives in that file. Emit check_file, drift, seam_issues, blocking, and summary first; reasoning is optional and under 50 words. ${PAYLOAD_FIRST}</task>`
}

function argusPrompt() {
  const lawNote = pluginRoot
    ? `<deterministic_floor>\nThe Law is your ORACLE — run it, do not re-derive it. The exact commands (Bash, cwd anywhere; they take absolute paths):\n` +
      `1. node ${pluginRoot}/scripts/kiln-law.mjs verify ${projectPath} ${kilnDir} — the TAMPER gate. If it exits 2, locked Law paths were touched: record that as a blocking finding and note it; the build should never have shipped tampered locks.\n` +
      `2. node ${pluginRoot}/scripts/kiln-law.mjs run ${projectPath} ${kilnDir} --run-prefix ${VALIDATE_RUN_TOKEN} — the FULL Law run: EVERY SC incl. probe checks (instantiated probes EXECUTE here — one bounded browser subprocess each, swept under this stage's token). law_run_exit = its EXACT exit code (0 = every check green; non-zero = the Law is red). From its 'RUN <runId> HEAD <head>' line report run_id. A 'VERIFICATION_CLASS static-only' line means a probe deferred (playwright absent / un-instantiated template) — set verification_class_full=false; otherwise true.\n` +
      `3. node ${pluginRoot}/scripts/kiln-law.mjs suite ${projectPath} ${kilnDir} <run_id> --cmd '<the project test command>' — persists the project suite as hashed evidence. suite_exit = its 'SUITE <runId> exit=<n>' value; suite_cmd = the command; tests_passed/tests_failed from the suite output.\n` +
      `These three commands produce the deterministic evidence the verdict is computed from — transcribe their exit codes EXACTLY (a wrong exit code is the one error that cannot be caught downstream). Then EXERCISE every acceptance criterion beyond what the checks express.\n</deterministic_floor>\n\n`
    : `<deterministic_floor>\nThe kiln-law CLI is unavailable in this run (pluginRoot absent), so the deterministic Law floor cannot run. Set law_run_exit=-1 and suite_exit=-1 (both are REQUIRED — -1 is the agreed sentinel meaning 'not run because the oracle was structurally unavailable', distinct from a dropped exit; the verdict reads it as an HONEST degradation and caps this run at PARTIAL — never a silent PASS, and never a hard FAILED on the missing floor alone), set suite_cmd to the suite command you ran yourself (or '(unavailable)' if you could not run one), install/run the suite yourself the best you can, and report install_ok + tests_passed/tests_failed honestly.\n</deterministic_floor>\n\n`
  return voice('opus') +
    `You are the end-to-end validator — the real backstop. Your job is to ORCHESTRATE the deterministic Law floor and then exercise what it cannot express; you do NOT self-grade the final verdict (that is computed mechanically from your transcribed evidence). ${scope}\n\n` +
    `<inputs>\n- Master plan (acceptance criteria — SC-xx and per-milestone): ${masterPlanFile}\n- The Law index: ${lawFile}\n- The built application at ${projectPath}\n</inputs>\n\n` +
    `<procedure>\n` +
    `1. DETECT THE PRODUCT TYPE, then INSTALL CORRECTLY FIRST. If it is a Python package (pyproject.toml/setup.py, likely src/ layout), create a venv and 'pip install -e .[dev]' (or '.') BEFORE testing — never a bare 'pytest' from root (it fails ModuleNotFound on src-layout). Use the build's recorded test_command if one exists. install_ok=false on a build failure (still attempt the rest).\n` +
    `2. Run the DETERMINISTIC LAW FLOOR (below) and transcribe its exit codes EXACTLY.\n` +
    `3. EXERCISE EVERY ACCEPTANCE CRITERION by actually running the app (cli: run commands with real inputs; api: start it, send real HTTP, check shapes, stop it; library: exercise entry points). Mark each met/unmet with concrete evidence, and class it: critical (failure is fatal) unless the plan marks it optional; browser_only (can ONLY be confirmed by driving the live UI — its met is provisional until the Tier-2 traversal).\n` +
    `4. Set ui_scope=true iff there are UI/web behavioral criteria (a web/extension/electron product, a design/ dir, or any browser_only criterion). For UI behavioral criteria you do NOT launch a browser here — the bounded Tier-2 traversal owns that (a separate phase). Verify everything statically you can (structure, wired handlers, asset wiring, a11y attributes in markup).\n` +
    `5. Missing credentials/env: set missing_creds=true, note it, continue — NEVER FAIL solely for missing creds.\n` +
    `</procedure>\n\n` +
    lawNote +
    `<output>Persist the full prose report to ${reportFile} via Bash — mkdir -p first, then a heredoc (cat <<'EOF' > file); do NOT use the Write tool for it (the platform may nudge-reject subagent Write calls for report files; Bash writes are the engine's normal artifact channel). The report carries: product type, install result, the three Law exit codes + run_id, suite summary, per-criterion results with full evidence, coverage_gaps, blocking_findings (any failure that blocks a PASS not already an exit code or unmet critical criterion), and a prioritized correction_tasks list (one per distinct failure: failure, evidence, affected files, suggested fix).\n` +
    `STRUCTURED-OUTPUT DISCIPLINE (a failed schema is a failed stage — the verdict computes from these fields): emit report_file, install_ok, law_run_exit, suite_cmd, suite_exit, criteria, and ui_scope first; the criteria array is REQUIRED and must carry EVERY criterion you exercised as {id, met, critical} with note ≤ 1 line — the full prose evidence lives in the report file, never in the schema; omitting the array (or flooding notes until the output truncates) is an observed death mode. reasoning is optional and under 50 words. ${PAYLOAD_FIRST} The transcribed fields ride as their own properties.</output>`
}

function hephaestusPrompt() {
  return `You are the design-QA reviewer. ${scope}\n\n` +
    `<inputs>\n- Design system: ${kilnDir}/design/ artifacts\n- The built UI source under ${projectPath}\n</inputs>\n\n` +
    `<task>Do a 5-axis design review (visual hierarchy, consistency/tokens, spacing/rhythm, typography, polish) by reading the code STATICALLY — do NOT launch a browser (the bounded Tier-2 traversal owns live rendering). Note any check that genuinely needs a render as an explicit coverage gap for the traversal. Write ${valDir}/design-review.md. Scores are ADVISORY — never the sole cause of a FAIL.</task>`
}

// traversalPrompt — the Tier-2 bounded browser traversal. ONE fresh evaluator (cross-family from
// the build's Opus UI builder when codexAvailable — translate per the codex guide; else fresh
// context). It walks EVERY UI acceptance criterion against the SERVED app.
//
// THE BOUNDED-BROWSER LAW: the browser is a subprocess with a
// deadline, never a service. The ONLY browser path in autonomous validate is the scripted kiln-probe
// BOUNDED ORACLE: each criterion is ONE one-shot launch→assert→close process under a hard
// 'timeout 90 --kill-after=10', running under a runId prefixed with VALIDATE_RUN_TOKEN, so the stage
// pre/post sweeps mechanically SIGKILL any survivor and rm its /tmp/kiln-pw-<token> profile. Every
// probe carries '--lease VALIDATE_RUN_TOKEN' (the workflow took the lease before this agent spawned),
// so the ≤10-min cap is enforced on the CAPABILITY: once the lease expires the probe REFUSES (exit 77)
// and an evaluator alive past the deadline can do no further browser work. A clean UI PASS
// (browser_result='full') is establishable ONLY through this swept, leased, scripted path.
//
// Playwright MCP is REMOVED from autonomous validate: an MCP server
// is a PERSISTENT browser service the workflow can neither lease-bound nor reap by token — the
// bounded-browser discipline forbids it in-loop. The evaluator NEVER drives MCP here. MCP stays a doctor-detected capability for the
// operator's INTERACTIVE/manual visual QA only, named in the emitted visual_qa_checklist as the manual
// alternative — it is not a path this agent may take. The withDeadline() timer the workflow wraps this
// agent in is the await-bound belt to the lease's capability-bound suspenders: it stops the workflow
// blocking on a wedged evaluator, while the lease guarantees no browser the evaluator launches outlives
// the cap. No persistent browser/MCP service backs a green verdict; nothing the evaluator spawns
// outlives the stage.
function traversalPrompt(scsForProbe) {
  const probePath = pluginRoot ? `${pluginRoot}/scripts/kiln-probe.mjs` : null
  // The scripted oracle is the ONLY browser path. It exists whenever pluginRoot is known.
  const probeArm = probePath
    ? `- SCRIPTED BOUNDED ORACLE (the ONLY browser path — run it for EVERY UI criterion): 'node ${probePath} run ${projectPath} ${kilnDir} <SC-id> ${traversalPassRunId} --lease ${VALIDATE_RUN_TOKEN}'. The runId is EXACTLY '${traversalPassRunId}' for EVERY probe call this pass — script-assigned, never your own (MANDATORY: the stage pre/post sweeps reap exactly this id, the wrapper hard-kills each probe at a 90s deadline, and the correction briefs name this run's evidence paths deterministically; the per-SC files never collide). The '--lease ${VALIDATE_RUN_TOKEN}' is MANDATORY too: it is the browser lease the workflow took for you, and it expires at the ≤10-min Tier-2 cap — a probe fired after the cap REFUSES with exit 77 LEASE_EXPIRED (the capability deadline), so do NOT loop or re-launch. Each call is one launch→assert→close OS process; it writes evidence (probe-<SC>.json + screenshot + log) into ${kilnDir}/evidence/${traversalPassRunId}/ and exits 0 pass · 1 assert-fail · 77 lease-expired (the cap was reached) · 78 unavailable (playwright absent) · 79 timeout. The Law's probe checks already carry specs (kind:'probe' in ${lawFile}); these SCs map to UI criteria: ${scsForProbe.length ? scsForProbe.join(', ') : '(none in law.json — author a minimal spec inline only if a criterion truly needs one)'}. If a 78 (PROBE_UNAVAILABLE) comes back, playwright is absent — there is NO browser path: stop, set browser_result='static-only', mark every UI criterion verified:false (UNVERIFIED). If a 77 (LEASE_EXPIRED) comes back you have hit the cap — stop immediately and report what you confirmed so far (criteria you did NOT confirm live stay verified:false).\n`
    : `- The kiln-probe CLI is unavailable (pluginRoot absent) — there is NO browser path. Set tool='none', browser_result='static-only', mark every UI criterion verified:false (UNVERIFIED) — honest degradation, never a clean UI pass invented from static review.\n`
  const how = codexAvailable
    ? `<how>${codexGuideNote}You are a CROSS-FAMILY evaluator — translate this brief into a Codex-native prompt and delegate the analysis to ${CODEX_MODEL} via 'codex exec' at model_reasoning_effort="high" (the build's UI builder is Opus, so a different family genuinely re-checks the work). The scripted kiln-probe calls run as Bash either way; if codex errors, evaluate directly.</how>\n\n`
    : ''
  return voice('opus') +
    `You are the Tier-2 bounded browser evaluator — a FRESH context, the only agent in this pipeline that drives a real browser, and you do it under a hard deadline. THE LAW: the browser is a subprocess with a deadline, never a service; one one-shot process per check; nothing you spawn may outlive you. You do NOT use Playwright MCP or any persistent browser tool — only the scripted one-shot kiln-probe below. "Out of the box, Claude is a poor QA agent" — do NOT talk yourself into approving superficially-tested work.\n\n` +
    `<inputs>\n- Master plan (acceptance criteria): ${masterPlanFile}. VISION: ${visionFile}.\n- The Law index (probe specs): ${lawFile}. The built app at ${projectPath}.\n- The deterministic validator's report: ${reportFile} (read its ui criteria — these are what you confirm LIVE).\n</inputs>\n\n` +
    `<procedure>\n` +
    `1. The scripted probe serves the app for you per its spec (http, never file://) — you do not start a server yourself.\n` +
    probeArm +
    `2. Walk EVERY UI acceptance criterion via the scripted probe: navigate, exercise the literal action (click the button → assert the state change), traverse states (empty/loading/error/success), capture console errors (zero expected), capture failed first-party requests (4xx/5xx), screenshot ≥2 viewports (1440×900 + 390×844). Judge each screenshot by a BINARY RUBRIC only — is the key content/nav visible? is text clipped/overlapping? does it match the stated design language? — NEVER a numeric/aesthetic score (VLMs rank reliably but score unreliably).\n` +
    `3. browser_result: 'full' iff EVERY UI criterion was exercised LIVE and clean THROUGH THE SCRIPTED ORACLE (no console errors, no failed first-party requests, no failed rubric, no broken interaction); 'failed' iff the scripted traversal found a real UI defect (list it in findings — a defect blocks a clean UI PASS); 'static-only' iff no scripted oracle was available OR the lease expired before every criterion was confirmed (mark the unconfirmed criteria verified:false). Set tool to 'kiln-probe' when the scripted oracle ran, else 'none' if no browser ran at all.\n` +
    `4. THE DEADLINE (capability-enforced, not goodwill): each scripted probe is hard-killed at 90s, and the lease expires at the ≤10-minute Tier-2 cap — a probe after the cap is REFUSED (exit 77), and the workflow also stops awaiting you at the cap and folds this pass static-only (UI criteria UNVERIFIED). So work efficiently and do NOT loop or re-launch. When done, let scripted probes exit cleanly (the stage sweeps and releases their kiln-pw- token / lease).\n` +
    `</procedure>\n\n` +
    how +
    `<task>Write ${valDir}/traversal.md — persist it via a Bash heredoc (mkdir -p the dir, then cat with a quoted heredoc into the file) — NEVER the Write tool: a platform guardrail rejects subagent Write calls on report files, and the rejection poisons the structured-output attempts that follow (an observed death mode). Emit tool, browser_result, per-criterion criteria {id, met, verified, note}, findings (live UI defects), and report_file first; reasoning is optional and under 50 words — the full detail lives in the report file. ${PAYLOAD_FIRST}</task>`
}

// goalBody — the shared audit body (no role line, no voice header) so the first auditor and the
// D8=2 second-family auditor share identical inputs/task and only differ in their role preamble.
const goalBody = (reportName) =>
  `<inputs>\n- VISION success criteria (SC-xx, the promise): ${visionFile}. Master plan: ${masterPlanFile}.\n- The live repo at ${projectPath}: git log/diff, read the files, and EXERCISE the product the way a user would (run the CLI, call the API, render the page statically — no browser; the Tier-2 traversal owns live UI).\n</inputs>\n\n` +
  `<task>Hunt the "checks pass, goal broken" class across the whole product: success criteria met by the letter but broken in spirit, features that exist but cannot be reached from the entry points, slices that pass alone but never connect, hardcoded/stub behavior behind green checks. Write ${qaDir}/${reportName} — persist it via a Bash heredoc (mkdir -p the dir, then cat with a quoted heredoc into the file) — NEVER the Write tool: a platform guardrail rejects subagent Write calls on report files, and the rejection poisons the structured-output attempts that follow (an observed death mode). Emit overall ('pass' = the deliverable genuinely delivers the VISION; 'fail' MUST be backed by at least one critical or high finding), findings (each {text, severity}), and report_file first; reasoning is optional and under 50 words — the full detail lives in the report file. Read-only on source. ${PAYLOAD_FIRST}</task>`
function goalPrompt() {
  return voice('opus') +
    `You are the goal-backward final auditor over the WHOLE deliverable. Your one question: does the finished product genuinely deliver the VISION success criteria? Work BACKWARD from the goal — never forward from the checks (they pass; that comfort is exactly what you distrust). This runs over the entire deliverable, not one milestone (per-milestone goal-backward already ran in build).\n\n` +
    goalBody('goal-backward-final.md')
}

// ── Measuring Drift — the parallel fan-out (lever 9): zoxea ∥ argus ∥ hephaestus ─────────────────
phase('Measuring Drift')
log(spin('drift', 0))
// Stage bracket: the validate stage is entered. ledger() gates on pluginRoot itself
// and degrades to a log line when the CLI is absent — never a stage failure.
await ledger('stage_started', { stage: 'validate' })
// validate.fanout: the stage opens — three lenses fan out over the deliverable.
await lore('validate.fanout', `Intent versus reality — drift ∥ the Law floor ∥ design QA fan out`, null)

// hephaestus runs iff design/ exists on disk (self-validation — the conductor's designPresent is
// only a hint; a cheap detect probe is authoritative). A no-pluginRoot run still detects via the
// agent's own ls. We resolve it via a cheap haiku probe so a wrong hint never silently mis-routes.
const detect = await agent(
  `You are the design-dir detector — one fact, no edits.\n\n` +
  `<task>Run 'ls -A ${kilnDir}/design 2>/dev/null' (Bash). Report design_present = true iff the directory exists AND lists at least one entry; false otherwise (a missing dir prints nothing — that is false). Do not read or write anything else.</task>`,
  { label: 'hephaestus:detect', phase: 'Measuring Drift', model: 'haiku', schema: DETECT_SCHEMA }
)
const designPresent = detect ? detect.design_present === true : designHint

// Provenance sinks: gateAgent records {requested_model, actual_model,
// fallback_reason, classification} per keystone leg; they ride the existing validate_verdict event.
const archProv = {}, argusProv = {}, goalProv = {}, goalSecondProv = {}
// The traversal is the one MULTI-PASS gate (primary ∥ adversarial). Its provenance is APPEND-ONLY: every
// pass appends its OWN {pass, requested_model, actual_model, fallback_reason, classification, …} record
// and nothing overwrites — a late completion of a timed-out pass appends {pass, late:true, …} rather than
// mutating the timeout record already written. Declared out here (not in the uiScope block) so the verdict
// ledger below can read it.
const traversalProvLog = []
// Settled-flags: a pass that TIMED OUT is booked here until its late completion arrives. A
// late completion that lands BEFORE the verdict snapshot appends its late:true record and clears the flag;
// one that never arrives (or arrives after the snapshot) leaves the flag set, so validate_verdict — the
// CLOSING record — appends {pass, late_status:'unsettled_at_verdict'} for it. The book always closes
// truthfully: every timed-out pass ends as late:true OR unsettled_at_verdict, never silently unledgered.
const traversalUnsettled = new Map()
const fanLegs = [
  () => gateAgent(driftPrompt(), { label: 'zoxea:arch-check', phase: 'Measuring Drift', model: 'sonnet', schema: ARCHCHECK_SCHEMA, provenance: archProv }),
  () => gateAgent(argusPrompt(), { label: 'argus:validate', phase: 'Measuring Drift', model: 'opus', schema: VALIDATE_SCHEMA, provenance: argusProv }),
]
if (designPresent) fanLegs.push(() => agent(hephaestusPrompt(), { label: 'hephaestus:design-qa', phase: 'Measuring Drift', model: 'sonnet' }))
const fan = await parallel(fanLegs)
const arch = fan[0]
const argus = fan[1]
log(`Arch-check: ${(arch && arch.drift || []).length} drift, ${(arch && arch.seam_issues || []).length} seam(s), ${(arch && arch.blocking || []).length} blocking`)
// validate.drift_read (volume): zoxea returned — drift + seams read.
await lore('validate.drift_read', `Zoxea reads the seams — ${(arch && arch.drift || []).length} drift, ${(arch && arch.seam_issues || []).length} seam(s), ${(arch && arch.blocking || []).length} blocking`, { drift: (arch && arch.drift || []).length, seams: (arch && arch.seam_issues || []).length, blocking: (arch && arch.blocking || []).length })
log(`${spin('validate', 0)} — law_run_exit=${argus && argus.law_run_exit} · suite_exit=${argus && argus.suite_exit} · ${(argus && argus.criteria || []).length} criterion(s) exercised`)
// validate.law_floor (volume): argus returned — the deterministic Law floor ran.
await lore('validate.law_floor', `The Law runs fresh — exit ${argus && argus.law_run_exit}, suite ${argus && argus.suite_exit}, ${(argus && argus.criteria || []).length} criterion(s) exercised`, { law_run_exit: argus && argus.law_run_exit, suite_exit: argus && argus.suite_exit, criteria: (argus && argus.criteria || []).length })
if (designPresent) log('Design QA complete (advisory)')

// ui_scope: argus's own determination, OR (fail toward scrutiny) a design/ dir, OR any browser_only
// criterion — a UI deliverable is never silently treated as logic-only.
const argusCriteria = (argus && Array.isArray(argus.criteria)) ? argus.criteria : []
const uiScope = (argus && argus.ui_scope === true) || designPresent || argusCriteria.some((c) => c && c.browser_only === true)

// ── The Traversal — the Tier-2 bounded browser pass (ui scope only) ───────────────────────────
let traversal = null
let traversalRan = false
const traversalSuffixes = posture.adversarial_pass ? ['', ':adversarial'] : [''] // D8=2: a second adversarial pass
// The traversal run ids are SCRIPT-ASSIGNED — one deterministic id per
// pass, derived from the stage token — so the correction assembly below can emit CONCRETE artifact
// paths. An evaluator-invented runId would leave build re-entry briefs pointing at a '<runId>'
// placeholder no builder can resolve. traversalPassRunId is set per pass immediately before the
// evaluator spawns (passes run sequentially, so the prompt always reads its own pass's id);
// launchedRunIds records every pass that actually launched, for the evidence hint.
const traversalRunIdOf = (sfx) => `${VALIDATE_RUN_TOKEN}-traversal${sfx ? '-adversarial' : ''}`
let traversalPassRunId = traversalRunIdOf('')
const launchedRunIds = []
try {
  if (uiScope) {
    phase('The Traversal')
    log(`${spin('traverse', 0)} — UI scope: one bounded evaluator walks every UI criterion (${pluginRoot ? 'scripted kiln-probe oracle, lease-gated' : 'no browser path — pluginRoot absent'})`)
    await stageSweep('pre-flight') // defend against a prior crashed run's orphans
    await leaseTake() // capability deadline: take the browser lease BEFORE the evaluator spawns — its probes refuse (exit 77) once it expires
    const uiScs = (() => {
      // the probe-kind SCs argus saw map to the live UI criteria the scripted path drives. We pass
      // the law.json probe ids argus did not contradict; the evaluator reads law.json itself for specs.
      const ids = argusCriteria.filter((c) => c && c.browser_only === true && typeof c.id === 'string').map((c) => c.id)
      return Array.from(new Set(ids))
    })()
    // The ≤10-min session cap, enforced per pass by the WORKFLOW deadline race — cumulative
    // wall-clock tracking is impossible in-script (Date.now is forbidden by the runtime determinism
    // guard), so the CUMULATIVE enforcer is the browser LEASE: its watchdog kills every browser at
    // lease expiry no matter how many passes are in flight. A timed-out pass is discarded as a
    // sentinel → folds 'static-only' and we stop launching further passes; the sweep reaps survivors.
    const passes = []
    let deadlineHit = false
    for (const sfx of traversalSuffixes) {
      const pass = sfx || 'primary'
      // Assign THIS pass's deterministic run id before the evaluator spawns —
      // traversalPrompt reads it, and the correction assembly emits its concrete evidence paths.
      traversalPassRunId = traversalRunIdOf(sfx)
      launchedRunIds.push(traversalPassRunId)
      // A FRESH per-pass provenance object: gateAgent records into it; the workflow snapshots it into the
      // append-only traversalProvLog. Because each pass owns its own object and the log holds snapshots, a
      // late writer (a timed-out pass that completes later) can never mutate a prior pass's record.
      const passProv = {}
      // The EXTERNAL deadline keeps its own duty (the cap); the INNER gateAgent still degrades a
      // seat-death to a fail-closed null via its provenance sink — the null-pass fold below routes that
      // through the returned classification, same as every other gate leg. onLate: if this pass times out
      // and later finishes, APPEND its late record (never overwrite the timeout record already written).
      const t = await withDeadline(
        () => gateAgent(traversalPrompt(uiScs), { label: `argus:traversal${sfx}`, phase: 'The Traversal', model: 'opus', schema: TRAVERSAL_SCHEMA, provenance: passProv }),
        TRAVERSAL_DEADLINE_MS,
        // the late completion arrived: clear the settled-flag so the verdict does not book it unsettled, then
        // APPEND its late record (never overwrite the timeout record already written).
        (lateErr) => { traversalUnsettled.delete(pass); traversalProvLog.push({ pass, late: true, ...passProv, ...(lateErr ? { error: String((lateErr && lateErr.message) || lateErr).slice(0, 200) } : {}) }) }
      )
      if (t === TRAVERSAL_TIMEOUT) {
        // the DEADLINE degrade (distinct from a gateAgent seat-death): APPEND a truthful timeout record and
        // book the pass UNSETTLED until its late completion arrives (verdict closes the book if it never does).
        traversalUnsettled.set(pass, true)
        traversalProvLog.push({ pass, requested_model: 'opus', actual_model: null, fallback_reason: 'deadline', classification: 'timeout' })
        // A deadline is a DEGRADATION (static-only ceiling → PARTIAL), never a UI DEFECT (→ FAILED):
        // the work is unproven, not proven-broken. So the sentinel folds 'static-only' with NO finding
        // (findings are blocking and would wrongly force FAILED) — the verdict caps at PARTIAL exactly
        // as an absent browser path does, honestly degraded, never silently green.
        deadlineHit = true
        log(`Traversal pass '${sfx || 'primary'}' hit the ${Math.round(TRAVERSAL_DEADLINE_MS / 1000)}s Tier-2 deadline — discarded (folds static-only, PARTIAL ceiling); the stage sweep reaps its browser`)
        passes.push({ browser_result: 'static-only', tool: 'none', criteria: [], findings: [] })
        break // the session cap is hit; no further passes
      }
      if (t && t.__kiln_rejected === true) {
        // DESIGNED EXCEPTION to gateAgent's 'other' rethrow rule: a Tier-2
        // traversal leg's rejection is ABSORBED to static-only — it must never kill validate. But provenance
        // NEVER lies: gateAgent already recorded {classification:'other', fallback_reason:'rethrow'} into
        // passProv before throwing; we APPEND that with a bounded (first 200 chars) error message, then fold
        // the pass static-only exactly as a dead pass does (push null → resultOf → static-only, no finding).
        traversalProvLog.push({ pass, ...passProv, error: String((t.error && t.error.message) || t.error).slice(0, 200) })
        passes.push(null)
        continue
      }
      // a resolved value (a clean result OR gateAgent's fail-closed null): snapshot its truthful record.
      traversalProvLog.push({ pass, ...passProv })
      passes.push(t)
    }
    traversalRan = true
    // MECHANICAL bounded-browser guard: a clean 'full' is only believable through the swept,
    // leased scripted oracle — the one browser path the workflow spawns under a deadline and reaps by
    // VALIDATE_RUN_TOKEN. A pass that claims 'full' WITHOUT the scripted oracle (tool!='kiln-probe') is
    // downgraded to 'static-only' here, in the workflow, not left to the agent's word — the deterministic
    // teeth behind the prompt's "the scripted oracle is the ONLY browser path". Scrutiny only rises.
    const resultOf = (t) => {
      const r = (t && (t.browser_result === 'full' || t.browser_result === 'failed' || t.browser_result === 'static-only')) ? t.browser_result : 'static-only'
      if (r === 'full' && !(t && t.tool === 'kiln-probe')) return 'static-only' // a 'full' not proven by the scripted oracle is unprovable → degrade honestly
      return r
    }
    // fold the passes: the WORST result wins (failed > static-only > full — scrutiny only rises),
    // findings union. A null pass (dead agent) folds as static-only (no proof of a clean traversal).
    const worst = passes.reduce((acc, t) => {
      const r = resultOf(t)
      if (acc === 'failed' || r === 'failed') return 'failed'
      if (acc === 'static-only' || r === 'static-only') return 'static-only'
      return 'full'
    }, 'full')
    const findings = Array.from(new Set(passes.flatMap((t) => (t && Array.isArray(t.findings)) ? t.findings.filter((f) => typeof f === 'string' && f.trim()) : [])))
    traversal = { browser_result: worst, findings, tool: passes[0] && passes[0].tool, criteria: passes.flatMap((t) => (t && Array.isArray(t.criteria)) ? t.criteria : []) }
    log(`Traversal: ${traversal.browser_result}${traversal.tool ? ` via ${traversal.tool}` : ''} — ${findings.length} UI finding(s)${deadlineHit ? ` (deadline hit — ${Math.round(TRAVERSAL_DEADLINE_MS / 1000)}s cap)` : ''}`)
    // validate.traversal_done: the bounded Tier-2 traversal closed and swept itself.
    await lore('validate.traversal_done', `The traversal sweeps its own ashes — ${traversal.browser_result}, ${findings.length} UI finding(s)`, { browser_result: traversal.browser_result, findings: findings.length })
    // gate_provenance here is an INTERIM point-in-time snapshot (a late completion of a timed-out pass may
    // still be in flight); validate_verdict below emits the CLOSING record that books any pass still unsettled.
    await ledger('tier2_traversal', { ui_scope: true, tool: traversal.tool || null, browser_result: traversal.browser_result, findings: findings.length, passes_run: passes.length, passes_planned: traversalSuffixes.length, deadline_hit: deadlineHit, deadline_ms: TRAVERSAL_DEADLINE_MS, gate_provenance: traversalProvLog.map((p) => ({ ...p })) })
  }

  // ── Goal Backward — the whole-deliverable audit vs the VISION success criteria ─────────────────
  phase('Goal Backward')
  log(`${spin('goal', 0)} — judging the whole deliverable backward from the VISION`)
  const goalLegs = [() => gateAgent(goalPrompt(), { label: 'aristotle:goal-final', phase: 'Goal Backward', model: 'opus', schema: GOAL_SCHEMA, provenance: goalProv })]
  // Receipt-based second-family attestation: the D8=2 second cross-family auditor becomes a
  // RECEIPT-ATTESTED envelope leg (solWrapperPlan + invocation-exact cross-check) when the posture asked
  // for it AND codex is on board AND the conductor minted a runToken — a SINGLE-seat attestation, not a
  // council (it gates on codex + token, NOT the T4 tier gate). With codex but NO runToken the leg keeps
  // the CURRENT prompt-delegated form (verified=false + no_run_token_no_attestation below); no codex keeps
  // the opus form (never verified — both legs would be opus). The wrapper mechanically extracts the report
  // content (codex runs --sandbox read-only and cannot write the file).
  const attestSecond = posture.second_family && codexAvailable && runTokenRaw != null
  let secondPlan = null
  let secondFamilyLedgerVerified = false
  if (posture.second_family) {
    if (attestSecond) {
      const goalSecondBrief =
        `<inputs>\n- VISION success criteria (SC-xx, the promise): ${visionFile}. Master plan: ${masterPlanFile}.\n- The live repo at ${projectPath}: read the files and reason about how a user would exercise the product (you run READ-ONLY — reason from the code + git state; you cannot start servers or write files).\n</inputs>\n\n` +
        `<task>Hunt the "checks pass, goal broken" class across the whole product: success criteria met by the letter but broken in spirit, features that exist but cannot be reached from the entry points, slices that pass alone but never connect, hardcoded/stub behavior behind green checks. Return overall ('pass' = the deliverable genuinely delivers the VISION; 'fail' MUST be backed by at least one critical or high finding), findings (each {text, severity}), and report_markdown = the FULL goal-backward-final-second report content (you run read-only and cannot write the file; the wrapper writes it for you). Read-only on source.</task>`
      secondPlan = solWrapperPlan({
        councilDir, pluginRoot, receiptsLedger, runToken: runTokenRaw, keystone: 'validate_ruling', transportModel: CODEX_MODEL,
        phaseTag: 'GOAL_SECOND', attempt: 1, effort: 'high', payloadSchema: GOAL_SECOND_PAYLOAD_SCHEMA,
        taskText: 'You are the SECOND-FAMILY goal-backward auditor over the WHOLE deliverable — an independent cross-family second judgment. Work BACKWARD from the VISION success criteria; stay independent (you never see the first auditor\'s report).',
        briefBody: goalSecondBrief, packetObj: { vision: visionFile, master_plan: masterPlanFile, project: projectPath },
        extractTo: `${qaDir}/goal-backward-final-second.md`, extractField: 'report_markdown', extractLabel: 'report',
      })
      goalLegs.push(() => gateAgent(secondPlan.prompt, { label: 'aristotle:goal-final:second-family', phase: 'Goal Backward', model: 'sonnet', transport: 'codex', transportModel: CODEX_MODEL, receiptRequired: true, twoHeads: 'required', schema: envelopeSchema(GOAL_SECOND_PAYLOAD_SCHEMA), provenance: goalSecondProv }))
    } else {
      // codex-no-token OR no-codex: the CURRENT prompt-delegated form — byte-preserved.
      goalLegs.push(() => gateAgent(
        (codexAvailable
          ? `You are the SECOND-FAMILY goal-backward auditor over the WHOLE deliverable, delegating to ${CODEX_MODEL} via 'codex exec' for a genuinely cross-family second judgment — run codex at model_reasoning_effort="high". ${codexGuideNote}If it errors, audit directly. Work BACKWARD from the VISION success criteria; do NOT read the first auditor's report — stay independent.\n\n`
          : `You are the SECOND goal-backward auditor over the WHOLE deliverable — an independent second perspective. Work BACKWARD from the VISION success criteria; do NOT read the first auditor's report — stay independent.\n\n`) +
        goalBody('goal-backward-final-second.md'),
        { label: 'aristotle:goal-final:second-family', phase: 'Goal Backward', model: codexAvailable ? 'sonnet' : 'opus', schema: GOAL_SCHEMA, provenance: goalSecondProv, transport: codexAvailable ? 'codex' : undefined }
      ))
    }
  }
  const goalReports = await parallel(goalLegs)
  const goal = goalReports[0]
  const goalSecond = goalReports[1] || null
  // The receipt-attested second-family leg gets the invocation-exact ledger cross-check upgrade. A
  // dead/receiptless seat or a failed cross-check leaves secondFamilyLedgerVerified false (the claim
  // fails closed below); the audit CONTENT still rides the reconcile — a null-keep work product.
  if (attestSecond) {
    let cross = { ledger_verified: false }
    if (goalSecond != null && goalSecondProv.receipt_verified === true) cross = await runSolCrossCheck('goal-final:second-family', 'validate_ruling', 'GOAL_SECOND', secondPlan.files.out, goalSecondProv, goalSecond, 'Goal Backward')
    pushCouncilReceipt(councilReceipts, 'goal-final:second-family', goalSecondProv, cross)
    secondFamilyLedgerVerified = cross.ledger_verified === true
  }
  // the goal audit's findings join the blocking arithmetic via the same deterministic reconcile the
  // milestone gate uses (dedupe by normalized text, max severity wins, blocking = any critical|high).
  const goalRec = denzelReconcile(goal, goalSecond)
  log(`${spin('goal', 1)} — goal-backward: ${(goal && goal.overall) || 'no report'}${goalSecond ? ` ∥ ${(goalSecond && goalSecond.overall) || 'no report'}` : ''}, ${goalRec.findings.length} finding(s), ${goalRec.blocking.length} blocking`)
  // validate.goal_read (volume): the whole deliverable judged backward from the VISION promise.
  await lore('validate.goal_read', `The letter passes; does the spirit? — ${(goal && goal.overall) || 'no report'}, ${goalRec.findings.length} finding(s), ${goalRec.blocking.length} blocking`, { overall: (goal && goal.overall) || 'no report', findings: goalRec.findings.length, blocking: goalRec.blocking.length })

  // ── The Verdict — computed DETERMINISTICALLY (validateVerdict) over all the evidence ───────────
  phase('The Verdict')
  log(`${spin('verdict', 0)}`)
  // browser_path for the verdict: the traversal's folded result when it ran; '' (⇒ static-only for a
  // UI scope) when it did not. A non-UI scope has no browser gap.
  const browserPath = traversalRan ? traversal.browser_result : (uiScope ? 'static-only' : '')
  // blocking findings the verdict gates on: arch-check blocking ∪ argus blocking_findings ∪ the
  // goal-backward critical|high reconcile ∪ the live UI traversal's defects (a UI defect is fatal —
  // browserPath==='failed' also gates, but the finding text is what the report shows).
  // UNRULED GATES: a DEAD gate never
  // rules green, but a mute reporter is epistemic ABSENCE, not proven breakage. arch===null (zoxea and
  // its re-dispatch both died on the structured-output cap), goal===null (aristotle and its re-dispatch
  // both died), or a posture-required second-family leg that never ruled (goalSecond===null) rides the
  // dedicated unruled_gates channel into validateVerdict — the PARTIAL ceiling, same doctrine as the
  // Law-floor-unavailable sentinel: VALIDATE_PASS stays impossible, yet no synthetic blocking finding
  // masquerades as product breakage (a FAILED would route the conductor into a product-correction loop
  // with nothing to fix — the remedy for a mute gate is re-running validate).
  const unruledGates = [
    ...(arch ? [] : ['the arch-check gate (zoxea:arch-check and its re-dispatch died on the structured-output retry cap) — drift/seam status UNKNOWN']),
    ...(goal ? [] : ['the goal-backward gate (aristotle:goal-final and its re-dispatch died on the structured-output retry cap) — VISION delivery UNKNOWN']),
    ...((posture.second_family && !goalSecond) ? ['the second-family goal gate (aristotle:goal-final:second-family and its re-dispatch died on the structured-output retry cap) — the posture-required independent cross-family judgment UNKNOWN'] : []),
  ]
  const blockingFindings = [
    ...((arch && Array.isArray(arch.blocking)) ? arch.blocking : []),
    ...((argus && Array.isArray(argus.blocking_findings)) ? argus.blocking_findings : []),
    ...goalRec.blocking.map((f) => `[goal-backward] ${f.text}`),
    ...((traversal && Array.isArray(traversal.findings)) ? traversal.findings.map((f) => `[ui-traversal] ${f}`) : []),
  ].filter((s) => typeof s === 'string' && s.trim())

  const verdictInput = {
    install_ok: argus ? argus.install_ok === true : false,
    law_run_exit: (argus && typeof argus.law_run_exit === 'number') ? argus.law_run_exit : null,
    suite_exit: (argus && typeof argus.suite_exit === 'number') ? argus.suite_exit : null,
    tests_passed: (argus && typeof argus.tests_passed === 'number') ? argus.tests_passed : null,
    tests_failed: (argus && typeof argus.tests_failed === 'number') ? argus.tests_failed : null,
    criteria: argusCriteria.map((c) => ({ id: c.id, met: c.met === true, critical: c.critical !== false, note: c.note })),
    blocking_findings: blockingFindings,
    unruled_gates: unruledGates,
    ui_scope: uiScope,
    browser_path: browserPath,
    missing_creds: argus ? argus.missing_creds === true : false,
  }
  const v = validateVerdict(verdictInput)
  log(`VERDICT: ${v.verdict} · verification_class=${v.verification_class} · browser=${v.browser_verdict}${v.blocking.length ? ` · ${v.blocking.length} blocking` : ''}`)

  // The out-of-loop visual checklist still ships — it is the one-shot
  // operator pass that upgrades a static-only UI verdict, AND a record even when Tier-2 ran (an
  // independent human re-check of the live render). MCP is named HERE (and only here) as the
  // interactive/manual tool for this human pass — autonomous validate never drives it (the ruling).
  // The correction tasks join argus's.
  const visual_qa_checklist = uiScope
    ? [
        'Serve over http (NEVER file://) and open the app — interactively, e.g. via Playwright MCP (browser_* tools) if you have it configured, or any browser. This is the MANUAL re-check; the autonomous Tier-2 traversal used scripted one-shot probes only.',
        'Click every wired interaction; traverse empty / loading / error / success states.',
        'Capture console errors (expect zero) and failed first-party network requests (4xx/5xx).',
        'Run axe-core a11y; gate on critical/serious violations.',
        'Screenshot ≥2 viewports (1440×900 desktop + 390×844 mobile).',
        'Scroll-and-capture each scroll-reveal section (a fullPage headless shot renders IntersectionObserver sections as a blank void — force them visible or scroll first).',
        'If you used Playwright MCP: browser_close when done — leave no browser session alive.',
      ]
    : []
  // A probe-derived correction task (a [ui-traversal] UI defect the
  // Tier-2 scripted oracle found) inherits the traversal's on-disk evidence as CONCRETE paths — the
  // run ids are script-assigned per pass (launchedRunIds above) and the probe SCs are argus's
  // browser_only criteria, so every path is fully resolved here (never a '<runId>'/'<SC>' placeholder
  // a build re-entry cannot follow). Reading artifacts is NOT browser authority — the builder still
  // never spawns a browser. The paths ride the existing string field; no schema
  // change. When the SC ids are unknown to the script (no browser_only criteria), the hint names the
  // concrete evidence dir(s) and their probe-*.json/.log + screenshot files instead.
  const probeSCs = argusCriteria.filter((c) => c && c.browser_only === true && typeof c.id === 'string').map((c) => c.id)
  const traversalEvidenceDirs = launchedRunIds.map((rid) => `${kilnDir}/evidence/${rid}`)
  const traversalArtifactPaths = traversalEvidenceDirs.flatMap((d) => probeSCs.map((sc) => `${d}/probe-${sc}.json (+ ${d}/probe-${sc}.log and the screenshot(s) it names)`))
  const traversalEvidenceHint = !traversalEvidenceDirs.length ? '' : (traversalArtifactPaths.length
    ? ` — probe evidence on disk: read ${traversalArtifactPaths.join('; ')} before changing a line (reading artifacts is not browser authority — never launch a browser)`
    : ` — probe evidence on disk under ${traversalEvidenceDirs.join(' and ')}: read every probe-*.json (result) and probe-*.log (console/stderr) there, plus the screenshot(s) each result names, before changing a line (reading artifacts is not browser authority — never launch a browser)`)
  const withEvidence = (t) => (typeof t === 'string' && t.includes('[ui-traversal]')) ? t + traversalEvidenceHint : t
  const correction_tasks = Array.from(new Set([
    ...((argus && Array.isArray(argus.correction_tasks)) ? argus.correction_tasks : []).map(withEvidence),
    ...v.reasons.map(withEvidence),
  ]))

  // Cross-family honesty: a posture-required second-family goal leg earns a cross-family
  // verification claim ONLY if it actually ruled on its requested model. If gateAgent substituted
  // (actual_model != requested_model) or the leg failed closed (no ruling / null actual_model), the
  // claim DOWNGRADES — a degraded second head is not a genuine cross-family judgment. We record the
  // honest verified flag AND ride the EXISTING verification_degraded event (no new type);
  // the ledger below never labels a degraded run as cross-family verified.
  // A genuine cross-family second judgment now requires RECEIPT ATTESTATION: codex was actually
  // available AND the conductor minted a runToken (attestSecond), the leg ruled (goalSecond present), its
  // provenance proves it ran clean on its OWN requested model (actual === requested, no fallback, no
  // seat-death), AND the codex receipt is BOTH structurally verified (receipt_verified) and
  // invocation-exact ledger-verified (secondFamilyLedgerVerified). codexAvailable===false OR no runToken
  // ⇒ attestSecond false ⇒ NEVER verified — the unattested claim can never masquerade as second-family.
  const secondFamilyVerified = attestSecond &&
    goalSecond != null &&
    goalSecondProv.actual_model != null &&
    goalSecondProv.actual_model === goalSecondProv.requested_model &&
    goalSecondProv.fallback_reason == null &&
    goalSecondProv.classification == null &&
    goalSecondProv.receipt_verified === true &&
    secondFamilyLedgerVerified === true
  const secondFamilyDegraded = posture.second_family && !secondFamilyVerified
  if (secondFamilyDegraded) {
    // A posture-required second family with codex present but NO runToken cannot be attested at all —
    // the leg ran unattested; its claim fails closed with the distinct no_run_token_no_attestation reason,
    // honest, never a regression into unattested second-family claims.
    const noTokenAttest = posture.second_family && codexAvailable && runTokenRaw == null
    const reason = noTokenAttest
      ? 'the second-family goal leg ran but NO runToken was minted — its codex receipt cannot be attested (no_run_token_no_attestation); the verification claim is downgraded (never labeled second_family/cross-family)'
      : 'the posture-required second-family goal-backward leg degraded — no genuine cross-family second judgment; the verification claim is downgraded (never labeled second_family/cross-family)'
    log(`Second-family goal gate DEGRADED (${noTokenAttest ? 'no runToken — unattested' : 'substitution, fail-closed, or unverified receipt'}) — the cross-family verification claim is downgraded; ledgering verification_degraded`)
    await ledger('verification_degraded', {
      gate: 'goal-final:second-family',
      requested_model: goalSecondProv.requested_model != null ? goalSecondProv.requested_model : null,
      actual_model: goalSecondProv.actual_model != null ? goalSecondProv.actual_model : null,
      classification: goalSecondProv.classification != null ? goalSecondProv.classification : 'null_result',
      reason,
      ...(noTokenAttest ? { no_attestation: 'no_run_token_no_attestation' } : {}),
    })
  }

  // validate.degraded (keystone): any degradation — a downgraded verification is recorded, never
  // silently green (static-only UI verification, a mute gate that never ruled, or a degraded second head).
  if (v.verification_class !== 'full' || secondFamilyDegraded || unruledGates.length) {
    const degradeReason = secondFamilyDegraded ? 'the cross-family second head degraded'
      : unruledGates.length ? `${unruledGates.length} gate(s) never ruled`
      : `verification_class ${v.verification_class}`
    await lore('validate.degraded', `Verification DEGRADED — ${degradeReason}; the claim is downgraded, never silently green`, { verification_class: v.verification_class, reason: oneLine(degradeReason, 80) })
  }

  // ── The T4 final-ruling council over the ASSEMBLED deterministic verdict. It CONFIRMS or BLOCKS
  //    the frozen record for EVERY computed verdict (PASS incl. prospective, PARTIAL, FAILED) — the
  //    monotonicity rail is ABSOLUTE: v.verdict and every return field are UNTOUCHED; the council gates
  //    ONLY stage_completed (RATIFIED + VALIDATE_PASS at T4) and rides its terminal on the records.
  //    Sub-T4 / no-codex / tokenless: no council convened, byte-preserved. Promised-but-tokenless:
  //    fail-closed DEGRADED (no stage_completed even on a PASS — never a silent completion). ──
  let councilTerminal = null, councilCertificate = null, councilFindings = [], councilBundleHash = null, councilReceiptVerified = false, councilLedgerVerified = false
  // The failed-Claude-head discriminator the conductor keys the
  // succession retry on — 'fable' | 'sol' | null (a 'both'/evidence/certificate DEGRADED is no single
  // head death and folds to null; runToken-absent leaves it null). Rides the authoritative councilField.
  let councilMissingHead = null
  if (councilCapable) {
    await noteClaudeHeadSuccession()
    // The certificate binds only goal narratives CONFIRMED on disk: a goal auditor can return a
    // valid {overall,findings} object yet skip its heredoc write, so anchoring a path from
    // return-object presence alone would let a missing advisory file wedge a correct VALIDATE_PASS
    // into DEGRADED (the anchor's sha256sum misses, anchorExact fails). Existence-gate each path —
    // the goal FINDINGS are already frozen in the record (verdict_input.blocking_findings); this
    // binds the narrative only when it is truly present (the vision.js existence-gate discipline).
    const goalCandidates = [
      ...(goal != null ? [`${qaDir}/goal-backward-final.md`] : []),
      ...(goalSecond != null ? [`${qaDir}/goal-backward-final-second.md`] : []),
    ]
    const goalReportFiles = []
    for (const p of goalCandidates) {
      const proof = await agent(
        `You are the artifact existence verifier.\n\n` +
        `<task>Run 'ls ${p}' (Bash). Return exists = true iff the file exists. Do not read, write, or fix anything.</task>`,
        { label: 'thoth:goal-anchor-verify', phase: 'The Verdict', model: 'haiku', schema: { type: 'object', additionalProperties: false, properties: { exists: { type: 'boolean' }, reasoning: { type: 'string', maxLength: 700 } }, required: ['exists'] } }
      )
      if (proof && proof.exists === true) goalReportFiles.push(p)
    }
    const cr = await runValidateRuling(v, verdictInput, { requested: posture.second_family, verified: secondFamilyVerified, degraded: secondFamilyDegraded }, goalReportFiles)
    councilTerminal = cr.terminal; councilCertificate = cr.certificate; councilFindings = cr.findings; councilBundleHash = cr.bundle_hash
    councilReceiptVerified = cr.receipt_verified; councilLedgerVerified = cr.ledger_verified
    councilMissingHead = (cr.missing === 'fable' || cr.missing === 'sol') ? cr.missing : null
  } else if (councilMisconfigured) {
    councilTerminal = 'DEGRADED'
    await councilCheckpoint({ protocol_version: COUNCIL_PROTOCOL_VERSION, template_hash: councilTemplateHashValidate, run_token_hash: runTokenHash, initial_ledger_seq: null, keystone_id: 'validate_ruling', phase: 'DEGRADED', decision_bundle_hash: null, input_artifact_hashes: [], evidence_manifest_hash: null, anonymous_seat_artifact_hashes: {}, seat_provenance: { missing: 'both', reason: 'runToken absent' }, codex_receipt_hash: null, status: 'sealed' })
    await councilRuling({ keystone: 'validate_ruling', phase: 'VALIDATE_RATIFY', terminal: 'DEGRADED', reason: 'runToken absent' })
    log('validate final ruling PROMISED (T4 + codex) but NO runToken (misconfigured conductor) — fail-closed DEGRADED; no stage_completed even on a VALIDATE_PASS')
  }
  // Authoritative council record: ONE object rides the EXISTING validate_verdict
  // boundary event AND the return — the same truth on the event, the return, and the council_ruling note.
  // It carries the payload {terminal, certificate, findings, bundle_hash, receipts} PLUS the mirrored
  // per-seat summary {seat, certificate_present, receipt_verified, ledger_verified} alongside it.
  // certificate_present is the honesty floor (a twin_ratified claim needs a real cert).
  const councilField = councilPromised
    ? { seat: 'validate_ruling', terminal: councilTerminal, certificate: councilCertificate, findings: councilFindings, bundle_hash: councilBundleHash, receipts: councilReceipts, certificate_present: councilCertificate != null, receipt_verified: councilReceiptVerified, ledger_verified: councilLedgerVerified, council_missing_head: councilMissingHead }
    : null

  await ledger('validate_verdict', {
    verdict: v.verdict,
    verification_class: v.verification_class,
    browser_verdict: v.browser_verdict,
    ui_scope: uiScope,
    law_run_exit: verdictInput.law_run_exit,
    suite_exit: verdictInput.suite_exit,
    blocking: v.blocking.length,
    unruled_gates: unruledGates,
    adversarial_pass: posture.adversarial_pass,
    second_family: posture.second_family,
    // Cross-family honesty: the posture requested a second family (second_family), but the claim
    // is VERIFIED only if that leg actually ruled on its own model — a substitution or fail-closed
    // leg downgrades second_family_verified to false and is flagged second_family_degraded.
    second_family_verified: secondFamilyVerified,
    second_family_degraded: secondFamilyDegraded,
    // Per-keystone provenance rides the existing event (no new type): requested vs actual
    // model, the fallback reason, and the failure class for each gate leg that fed this verdict.
    gate_provenance: [
      { gate: 'arch-check', ...archProv },
      { gate: 'argus', ...argusProv },
      // the traversal is multi-pass: every appended per-pass record rides as its own gate entry (the full
      // append-only array, never a single collapsed object) — a late/timeout/absorbed pass all show.
      ...(traversalRan ? traversalProvLog.map((p) => ({ gate: 'traversal', ...p })) : []),
      // CLOSING record: any timed-out pass whose late completion never arrived by this snapshot
      // is booked truthfully here — the verdict is the last word, so the ledger never leaves a pass unaccounted.
      ...(traversalRan ? Array.from(traversalUnsettled.keys()).map((pass) => ({ gate: 'traversal', pass, late_status: 'unsettled_at_verdict' })) : []),
      { gate: 'goal-final', ...goalProv },
      ...(posture.second_family ? [{ gate: 'goal-final:second-family', ...goalSecondProv }] : []),
    ],
    // The authoritative council record (certificate + frozen findings included) + honest
    // per-Sol-leg receipts ride the existing boundary event (no new type).
    ...(councilField ? { council: councilField, ...(councilReceipts.length ? { council_receipts: councilReceipts } : {}) } : {}),
  })

  // validate.verdict (keystone): the deterministic verdict is assembled over all the evidence.
  await lore('validate.verdict', `A hundred eyes rule — ${v.verdict} · ${v.verification_class}${v.blocking.length ? ` · ${v.blocking.length} blocking` : ''}`, { verdict: v.verdict, verification_class: v.verification_class, blocking: v.blocking.length })

  // Stage bracket + completion gate: validate COMPLETES only on a clean VALIDATE_PASS —
  // a PARTIAL/FAILED verdict leaves the projection at 'validate' (the conductor loops corrections back to
  // build, or escalates). At T4 the final-ruling council adds a second gate: a PASS whose council did NOT
  // RATIFY (BLOCKED/DEGRADED, or a promised-but-tokenless run) leaves the projection at 'validate' too —
  // the deterministic verdict STANDS UNALTERED, but stage_completed is council-gated (the conductor's
  // gated checkpoint owns the block). Sub-T4 is byte-preserved (councilPromised false ⇒ no council gate).
  const councilBlocksCompletion = councilPromised && councilTerminal !== 'RATIFIED'
  if (v.verdict === 'VALIDATE_PASS' && !councilBlocksCompletion) await ledger('stage_completed', { stage: 'validate' })

  return {
    verdict: v.verdict,
    verification_class: v.verification_class,
    browser_verdict: v.browser_verdict,
    report_file: reportFile,
    product_type: argus && argus.product_type,
    tests_passed: verdictInput.tests_passed,
    tests_failed: verdictInput.tests_failed,
    law_run_exit: verdictInput.law_run_exit,
    suite_exit: verdictInput.suite_exit,
    criteria: verdictInput.criteria,
    visual_qa_checklist,
    correction_tasks,
    blocking: v.blocking,
    unruled_gates: v.unruled_gates,
    coverage_gaps: (argus && argus.coverage_gaps) || [],
    drift: (arch && arch.drift) || [],
    seam_issues: (arch && arch.seam_issues) || [],
    goal_backward: goal && goal.overall,
    // The additive council field — the SAME authoritative record the boundary event
    // carries (terminal + certificate + frozen findings + the per-seat summary) so the conductor's gated
    // checkpoint sees the honest terminal (never a twin_ratified claim without a cert).
    ...(councilPromised ? { council: councilField } : {}),
  }
} finally {
  // UNCONDITIONAL stage-end teardown
  // on EVERY exit path. TWO arms, both run-token scoped to VALIDATE_RUN_TOKEN, each try/guarded so a
  // cleanup failure can never mask a real error propagating out:
  //   (1) leaseRelease() — kill the lease watchdog (teardown is NOW, not at the deadline), sweep the
  //       token, delete the lease file. This is the lease's symmetric close: a watchdog left running
  //       would needlessly re-sweep at expiry, and a stale lease could block a later run.
  //   (2) stageSweep('stage-end') — the belt to lease-release's suspenders: reaps any survivor (an
  //       outer-deadline SIGKILL of a probe wrapper, a crash mid-traversal) even if the lease was
  //       never taken (lease-take agent failed) or already self-released at expiry.
  if (uiScope) {
    try { await leaseRelease() } catch (e) { log(`stage-end lease-release failed (non-fatal): ${e && e.message ? e.message : e}`) }
    try { await stageSweep('stage-end') } catch (e) { log(`stage-end browser sweep failed (non-fatal): ${e && e.message ? e.message : e}`) }
  }
}
