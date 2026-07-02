// GENERATED from workflows-src/vision.js — edit the source, run scripts/bundle-workflows.mjs
export const meta = {
  name: 'kiln-vision',
  description: 'Kiln vision-compile leg (BLUEPRINT §10, P4): the tail of the brainstorm stage. The append-only session ledger (.kiln/docs/brainstorm-ledger.jsonl) is the canonical artifact; this workflow gates it mechanically (kiln-vision ledger-gate — an incomplete session can never compile), then ONE fresh-context compiler agent whose SOLE source is the ledger writes .kiln/docs/VISION.md (traceability is structural: the compiler never saw the chat), then the deterministic post-compile gate (kiln-vision validate) rules — with a bounded revise loop (≤2) on typed violations. VISION.md is a DERIVED artifact: regenerable from the ledger at any time, never hand-edited; a re-run recompiles from scratch. On a validator-clean VISION the run ledger gets vision_compiled THEN stage_completed (brainstorm); on exhaustion, neither — vision_valid:false with the typed violations is the conductor\'s escalation payload.',
  phases: [
    { title: 'The Gate', detail: 'kiln-vision ledger-gate — the mechanical pre-compile floor: session_complete terminal, approved section intents, clarify pass, the idea floor' },
    { title: 'The Compilation', detail: 'one fresh-context compiler writes VISION.md from the ledger alone; the validator rules; typed violations drive a bounded revise loop (≤2)' },
    { title: 'The Seal', detail: 'existence verified; vision_compiled + stage_completed (brainstorm) ledgered — only on a validator-clean VISION' },
  ],
}

// ── args from the conductor: { kilnDir, projectPath, pluginRoot } ──
// args may arrive as an object or a JSON string depending on how the caller encoded it. Normalise both.
function normalizeArgs(args) {
  if (typeof args === 'string') {
    try { args = JSON.parse(args) } catch (e) { return { __parse_error: true } }
  }
  return (args && typeof args === 'object') ? args : {}
}
const A = normalizeArgs(args)
const REASONING_FIRST = 'Your ENTIRE final message is ONE StructuredOutput tool call — no prose before or after it. reasoning is its FIRST property and stays CONCISE (a summary, never the carrier of the answer): every other required property must be a real, separately-populated JSON field — the validator hard-rejects a reasoning-only call, each rejection burns one of five attempts, and five failures kill this leg.'
const kilnDir = A.kilnDir
const projectPath = A.projectPath
if (!kilnDir || !projectPath) throw new Error('vision.js requires args.kilnDir and args.projectPath (absolute paths — the conductor resolves them; never launch with relative paths). Received args of type ' + typeof args)
// pluginRoot is the conductor-resolved absolute $CLAUDE_PLUGIN_ROOT (a launched Workflow can't see
// ${CLAUDE_PLUGIN_ROOT}). LOAD-BEARING here — unlike an optional ledger append, the kiln-vision CLI
// IS this workflow's floor and verdict: without it there is no mechanical gate, and a compile
// without a gate would be exactly the self-graded homework §10 retires. Absence fails CLOSED with a
// named reason (the conductor escalates); it never degrades to a gateless compile.
const pluginRoot = A.pluginRoot

const docsDir = `${kilnDir}/docs`
const ledgerFile = `${docsDir}/brainstorm-ledger.jsonl`
const visionFile = `${docsDir}/VISION.md`

// ── MODEL_VOICE shell (Opus only; inlined from src/voice.mjs by the bundler) ──
const MODEL_VOICE = {
  opus: [
    'Be direct. State findings and decisions plainly; do not soften.',
    'Inputs are wrapped in XML tags — read the data block before the task line.',
    'Keep output minimal and specific. Apply every rule to EVERY item in scope, not just the first.',
  ].join('\n'),
}
const voice = (m) => (m === 'opus' ? MODEL_VOICE.opus + '\n\n' : '')

const SPIN = ['The ledger holds every word', 'Nothing enters the vision that the operator did not say', 'The compiler reads the session, never the chat', 'A vision is counted before it is trusted']
const spin = (i) => SPIN[((i % SPIN.length) + SPIN.length) % SPIN.length]

// ── The run ledger (BLUEPRINT §3.5): stage brackets + vision_compiled land in events.jsonl via
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

// ── the kiln-vision transcript schema — Thoth transcribes the CLI's --json verdict VERBATIM ──────
// One shape for BOTH commands (the CLI prints the same payload family); every field required so a
// schema-legal scribe can never drop the violations the revise loop feeds on (the P3.6 discipline).
const GATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
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
// tail; a re-run after a failed gate is the stage still in progress). Ordering (P4 r1 F5): this
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
  return { vision_valid: false, vision_file: visionFile, reason: why, violations: (gate && gate.violations) || [] }
}
const gateSummary = parseSummary(gate) || {}
log(`Ledger gate clean: ${gateSummary.events ?? '?'} events, ${gateSummary.ideas ?? '?'} idea(s), tier ${gateSummary.tier ?? 'unknown'}${gateSummary.express ? ' (express)' : ''}`)

// ═══════════════════════════════════ The Compilation ════════════════════════════════════════════
phase('The Compilation')
log(spin(2))

// The compiler brief is the traceability contract (§10 change 5): SOLE source = the session
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
  `style_probe/clarify_pass events plus the style_probe/clarify_pass trail (T3 ruling 2 — the ` +
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
  `Report the counts you wrote. ${REASONING_FIRST}</task>`
const COMPILE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
    written: { type: 'boolean', description: 'VISION.md was written to disk' },
    counts: { type: 'string', description: 'the counts object you wrote into the frontmatter, as a JSON string' },
  },
  required: ['written', 'counts'],
}

// Bounded like the Law's revise loop: 3 validator passes / ≤2 compiler revisions. VISION.md is
// DERIVED (r1 F5): a re-run recompiles from scratch; a partial or invalid file left on disk is
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
  // fixable artifact defect — revising against no violations is wasted work and a lying reason
  // (T2 review r1). A genuine invalid artifact always carries typed violations at exit 1; a dead
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
    `Report the corrected counts. ${REASONING_FIRST}</task>`,
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
  { label: 'thoth:verify', phase: 'The Seal', model: 'haiku', schema: { type: 'object', additionalProperties: false, properties: { reasoning: { type: 'string' }, exists: { type: 'boolean' } }, required: ['exists'] } }
)
if (!(proof && proof.exists === true)) {
  log('THE SEAL FAILED — the validated VISION is not on disk (a vanished artifact is a failed compile).')
  return { vision_valid: false, vision_file: visionFile, reason: 'validated but missing on disk', violations: [] }
}
// Ordering (r1 F5): vision_compiled THEN stage_completed — and ONLY here, on the clean path.
await runLedger('vision_compiled', { tier: vSummary.tier ?? null, counts: vSummary.counts ?? null, visual_direction: vSummary.visual_direction ?? null, unresolved: vSummary.unresolved ?? null }, 'The Seal')
await runLedger('stage_completed', {}, 'The Seal')
log(`The vision is compiled and gated: tier ${vSummary.tier ?? 'unknown'}, visual direction ${vSummary.visual_direction === true ? 'present' : 'declined'} — the brainstorm stage completes`)

return {
  vision_valid: true,
  vision_file: visionFile,
  tier: vSummary.tier ?? null,
  counts: vSummary.counts ?? null,
  unresolved: vSummary.unresolved ?? 0,
  // The conductor threads this into the architecture launch args (P4 r1 F6) — the mechanical
  // visual-direction path end-to-end; the foundation agent's judgment is only the pre-v3 fallback.
  visual_direction: vSummary.visual_direction ?? null,
}
