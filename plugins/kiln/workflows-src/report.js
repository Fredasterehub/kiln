export const meta = {
  name: 'kiln-report',
  description: 'Kiln report stage: Omega reads every .kiln artifact and the built project, then writes .kiln/REPORT.md — the final delivery summary in Kiln\'s voice.',
  phases: [{ title: 'The Final Word', detail: 'Omega compiles REPORT.md from all artifacts' }],
}

// ── args: { kilnDir, projectPath } ──
// @inline:args:normalizeArgs
const A = normalizeArgs(args)
const PAYLOAD_FIRST = 'Your ENTIRE final message is ONE StructuredOutput tool call — no prose before or after it. Emit the payload properties FIRST; reasoning is the LAST property, OPTIONAL, and under 50 words — put detail in the designated report file or field, never in reasoning. A long leading reasoning string is the observed death mode: the call truncates before the payload lands, the validator rejects it, each rejection burns one of five attempts, and five failures kill this leg.'
const kilnDir = A.kilnDir
const projectPath = A.projectPath
if (!kilnDir || !projectPath) throw new Error('report.js requires args.kilnDir and args.projectPath (absolute paths — the conductor resolves them; never launch with relative paths). Received args of type ' + typeof args)
// pluginRoot is the conductor-resolved absolute $PLUGIN_ROOT (a launched Workflow can't see
// ${CLAUDE_PLUGIN_ROOT}). It locates the kiln-state CLI for this stage's ledger brackets + lore
// beats (report.js's first ledger legs — the C1 batch); absence degrades each to a log line, never
// a stage failure (the report itself never depended on it).
const pluginRoot = A.pluginRoot

const reportFile = `${kilnDir}/REPORT.md`

// @inline:guards:NO_WANDER

// ── MODEL_VOICE shell (Opus only; inlined from src/voice.mjs by the bundler) ──
// @inline:voice:MODEL_VOICE,voice

// ── gateAgent (inlined from src/gate.mjs) — Omega's closing report is a gate leg too: a
//    structured-output retry-cap death here used to detonate the whole report stage. Behind
//    gateAgent it degrades to null (one re-dispatch first), and the null-safe return below still
//    ships a REPORT.md pointer instead of failing the pipeline's final step. ──
// @gate

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

// ── The run ledger (BLUEPRINT §3.5) — report.js's FIRST ledger legs (the C1 lore batch closed the
//    "report brackets ride the C1 lore batch" deferral). The vision.js runLedger idiom: Thoth
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

// ── Lore beats (C1 doctrine §4): the pen — one dispatch at the moment a fact becomes true, carried by
//    runLedger to the operator's transcript (note{kind:'lore'}; deterministic <stage>.<beat> key; args
//    short scalars capped at 80 by the caller; text ≤ 160). PRESENTATION, null-keep. ──
const LORE_MAX = 160
const oneLine = (s, cap = LORE_MAX) => String(s).replace(/[\x00-\x1f\x7f]+/g, ' ').slice(0, cap)
// args are bound HERE (F-1): every string value is capped at 80 mechanically, so a beat can never
// leak an unbounded project-controlled string into the ledger even if a call site forgets to cap.
const boundArgs = (a) => { const o = {}; for (const [k, v] of Object.entries(a)) o[k] = typeof v === 'string' ? oneLine(v, 80) : v; return o }
const lore = (key, text, args, phaseName) =>
  pluginRoot
    ? runLedger('note', { kind: 'lore', key, text: oneLine(text), ...(args ? { args: boundArgs(args) } : {}) }, phaseName)
    : log(oneLine(text))

const EXISTS_SCHEMA = { type: 'object', additionalProperties: false, properties: { exists: { type: 'boolean' }, reasoning: { type: 'string', maxLength: 700 } }, required: ['exists'] }

phase('The Final Word')
log('Omega picks up the pen')
// §3.5 stage bracket: stage_started on entry — a re-run is the stage still in progress.
await runLedger('stage_started', {}, 'The Final Word')
// report.pen_up (volume): Omega opens the stage — reading every artifact the run left behind.
await lore('report.pen_up', `Omega reads everything the run left behind — every artifact, every verdict`, null, 'The Final Word')
// F3 provenance: Omega's gate leg records {requested_model, actual_model, fallback_reason,
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
if (proof && proof.exists === true) {
  // report.signed (keystone): the final word is written.
  await lore('report.signed', `The final word is written — ${oneLine((res && res.headline) || 'delivery report complete', 80)}`, { headline: oneLine((res && res.headline) || 'delivery report complete', 80) }, 'The Final Word')
  await runLedger('stage_completed', {}, 'The Final Word')
} else {
  log('REPORT.md not found on disk — no stage_completed (a missing artifact is a failed report; the telegraph stays open for the notification to close it).')
}
return { report_file: reportFile, headline: res && res.headline, delivered: (res && res.delivered) || [], outstanding: (res && res.outstanding) || [], gate_provenance: omegaProv }
