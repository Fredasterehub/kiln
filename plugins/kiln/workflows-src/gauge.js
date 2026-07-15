export const meta = {
  name: 'kiln-gauge',
  description: 'Kiln gauge stage (BLUEPRINT §3): Alpha the Assessor scores the 8-dimension complexity profile from VISION (+ codebase-map), the deterministic non-compensatory mapping runs IN THE SCRIPT, and the posture is ledgered. The profile sets posture; this stage never builds.',
  phases: [
    { title: 'The Assessment', detail: 'Alpha scores the 8-dimension profile from VISION (+ codebase-map) with per-dimension evidence' },
    { title: 'The Mapping', detail: 'the deterministic posture() mapping runs in-script — never in an agent' },
    { title: 'The Ledger', detail: 'Thoth appends posture_set (posture + profile + evidence) to events.jsonl' },
  ],
}

// ── args from the conductor: { kilnDir, projectPath, postureOverride, assessorModel, codexAvailable, pluginRoot } ──
// args may arrive as an object or a JSON string depending on how the caller encoded it. Normalise both.
// @inline:args:normalizeArgs
const A = normalizeArgs(args)
// @inline:doctrine:PAYLOAD_FIRST
const kilnDir = A.kilnDir
if (!kilnDir) throw new Error('gauge.js requires args.kilnDir (absolute path to .kiln). Received args of type ' + typeof args)
const projectPath = A.projectPath
// postureOverride: 'max' forces every dial to its ceiling, 'fast' to the leanest posture the
// mapping yields; both still respect the §3.4 floors (posture() only governs ABOVE the floor).
// null/absent ⇒ the Gauge decides from the assessed profile. Anything else is treated as null.
const postureOverride = (A.postureOverride === 'max' || A.postureOverride === 'fast') ? A.postureOverride : null
// The model that scores the profile (§8 Assessor slot, resolved by the conductor per capability
// tier). Default 'opus' — the workhorse; a Sonnet-only run passes 'sonnet'.
const assessorModel = A.assessorModel || 'opus'
const codexAvailable = A.codexAvailable !== false // default true; conductor passes kiln-doctor's probe result
// pluginRoot is the conductor-resolved absolute $CLAUDE_PLUGIN_ROOT (a launched Workflow can't see
// ${CLAUDE_PLUGIN_ROOT}). It locates the kiln-state CLI for the ledger append; absence degrades the
// append to a log line (never a stage failure).
const pluginRoot = A.pluginRoot

const docsDir = `${kilnDir}/docs`
const visionFile = `${docsDir}/VISION.md`
const mapFile = `${docsDir}/codebase-map.md`

// ── The ledger (BLUEPRINT §3.5): the gauge stage brackets + the posture_set event land in
//    events.jsonl via the kiln-state CLI. Thoth appends; every caller gates on pluginRoot (a
//    launched Workflow can't see ${CLAUDE_PLUGIN_ROOT}) and degrades to a log line when it is
//    absent — a missing CLI never fails the gauge (the §3 floors run regardless; the posture still
//    returns to the conductor, which persists it to STATE.md). ──
async function ledger(type, data, phaseName) {
  const ev = JSON.stringify({ type, stage: 'gauge', data })
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

// ── Lore beats (C1 doctrine §4): a dispatch from inside the fire — one line, emitted the moment a
//    fact becomes true, carried by the ledger to the operator's transcript between the conductor's
//    banners. Rides the ledger idiom above as note{kind:'lore'} (deterministic <stage>.<beat> key;
//    the structured `args` are short scalars — project-controlled strings capped at 80 by the caller;
//    text ≤ 160). PRESENTATION, null-keep: pluginRoot absent ⇒ a plain log() line, never a stage
//    failure — a beat can never gate, retry, or wedge a run. ──
const LORE_MAX = 160
const oneLine = (s, cap = LORE_MAX) => String(s).replace(/[\x00-\x1f\x7f]+/g, ' ').slice(0, cap)
// args are bound HERE (F-1): every string value is capped at 80 mechanically, so a beat can never
// leak an unbounded project-controlled string into the ledger even if a call site forgets to cap.
const boundArgs = (a) => { const o = {}; for (const [k, v] of Object.entries(a)) o[k] = typeof v === 'string' ? oneLine(v, 80) : v; return o }
const lore = (key, text, args, phaseName) =>
  pluginRoot
    ? ledger('note', { kind: 'lore', key, text: oneLine(text), ...(args ? { args: boundArgs(args) } : {}) }, phaseName)
    : log(oneLine(text))

// ── The Gauge pure core (validateProfile + posture, inlined from src/gauge.mjs) ──
// The §3.2 non-compensatory mapping runs HERE, in the script — never in an agent (BLUEPRINT §3.2).
// @inline:gauge:validateProfile,posture
// ── The Gauge config (GAUGE_CONFIG, inlined from gauge-config.json by the bundler — workflow
//    scripts cannot import JSON; the canonical file stays the single source of truth, --check
//    guards the inline copy against drift, and the _doc commentary keys are stripped) ──
// @gauge-config

// ── Codex model pins (CODEX_MODEL default + CODEX_FALLBACK, inlined from src/models.mjs) ──
// @models

// ── MODEL_VOICE shell (Opus only; inlined from src/voice.mjs by the bundler) ──
// @inline:voice:MODEL_VOICE,voice
// Opus prose voice only when the assessor IS opus; other slots get the bare brief.
const assessorVoice = assessorModel === 'opus' ? voice('opus') : ''

// SPIN flattened to the one intentional worker-tree line (C1 §6): entry 0 duplicated the brand.md
// gauge transition; 'Eight readings, one posture' is promoted to the gauge.posture_set beat below.
const SPIN = ['No dimension hides from the gauge']
const spin = (i) => SPIN[((i % SPIN.length) + SPIN.length) % SPIN.length]

// ── Schemas (additionalProperties:false; payload fields FIRST, reasoning LAST + optional + capped — a long leading reasoning string truncated tool calls before the payload landed and blew the 5-attempt retry cap) ──
const DIM_KEYS = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8']
const DIM_LABELS = {
  D1: 'Scope size — 0: ≤5 features/screens/endpoints · 1: 6–15 · 2: >15',
  D2: 'Requirements ambiguity — 0: ACs statable now · 1: some discovery · 2: major unknowns',
  D3: 'Novelty — 0: known-stack CRUD · 1: uncommon patterns · 2: unprecedented algorithm/domain',
  D4: 'Architectural fork risk — 0: one obvious approach · 1: 1–2 real forks · 2: many load-bearing forks',
  D5: 'Integration surface — 0: none · 1: 1–2 external systems · 2: auth/payments/protocols/multi-system',
  D6: 'Data & state — 0: static/none · 1: single store, simple schema · 2: migrations/concurrency/multi-tenant',
  D7: 'Verifiability — 0: fully executable checks · 1: partly browser/visual · 2: mostly human-judgment',
  D8: 'Failure penalty — 0: toy/internal · 1: real users · 2: money/health/security/compliance',
}
const dimProps = {}
for (const k of DIM_KEYS) {
  dimProps[k] = {
    type: 'object', additionalProperties: false,
    properties: {
      score: { type: 'integer', enum: [0, 1, 2], description: DIM_LABELS[k] },
      evidence: { type: 'string', description: 'one verbatim quote from VISION/codebase-map that anchors this score' },
    },
    required: ['score', 'evidence'],
  }
}
const PROFILE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    profile: { type: 'object', additionalProperties: false, properties: dimProps, required: DIM_KEYS },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['profile'],
}

// The brief the Assessor scores against. Names BOTH VISION formats explicitly: the P4 YAML
// frontmatter OQ fields and the v2 §9 'Open Questions' prose — the agent handles whichever exists.
const assessBrief =
  `You are Alpha, the Assessor (BLUEPRINT §3.1). You SCORE the work's complexity; you never build, and you ` +
  `never decide the pipeline's posture — a deterministic function does that from your scores.\n\n` +
  `<inputs>\nRead the vision at ${visionFile} (use your Read tool).` +
  (projectPath ? ` If ${mapFile} exists (brownfield codebase map), read it too — 'ls ${mapFile}' first.` : '') +
  `\nVISION may carry Open Questions in EITHER form — handle both: a YAML frontmatter block with ` +
  `structured OQ entries (priority/timing fields — the P4 format), OR a §9 'Open Questions' prose section ` +
  `with 'OQ-{N}' lines (the v2 format). Treat them as the same signal for ambiguity (D2) and novelty (D3).\n</inputs>\n\n` +
  `<rubric>\nScore each of the 8 dimensions 0, 1 or 2 against these anchors:\n` +
  DIM_KEYS.map((k) => `- ${k}: ${DIM_LABELS[k]}`).join('\n') + `\n</rubric>\n\n` +
  `<task>For EVERY dimension D1..D8 return { score, evidence } where evidence is ONE verbatim quote from ` +
  `VISION/codebase-map that anchors the score (this counters anchoring on the vision's own self-framing — ` +
  `quote the text, do not paraphrase). If a dimension has no direct quote, quote the closest relevant line and ` +
  `score conservatively. Apply the rubric to EVERY dimension, not just the first. ${PAYLOAD_FIRST} Emit the profile FIRST as its own property; reasoning is optional and under 50 words.</task>`

// ── The Assessment: ONE Alpha agent scores the profile ──
phase('The Assessment')
log(spin(0))
// §3.5 stage bracket (P3.6 T4): the gauge stage is entered — mark it in the ledger so state.json's
// projection is stage-accurate from the gauge boundary onward. Gated on pluginRoot like every ledger
// leg; absence degrades to a log line, never a stage failure.
if (pluginRoot) await ledger('stage_started', {}, 'The Assessment')
else log('pluginRoot absent — gauge stage_started not ledgered')
const askAlpha = (label, extra) => agent(
  assessorVoice + assessBrief + (extra || ''),
  { label, phase: 'The Assessment', model: assessorModel, schema: PROFILE_SCHEMA }
)
let res = await askAlpha('alpha:assess')
let profile = res && res.profile
let validation = validateProfile(profile)

// Invalid profile → ONE re-ask with the exact validation errors (assessor flakiness, not a stage
// failure). The profile is schema-forced, so this mainly catches a dropped dimension or a leaked key.
if (!validation.ok) {
  log(`Alpha's profile failed validation (${validation.errors.length} issue(s)) — one re-ask with the errors`)
  await lore('gauge.profile_reask', `Profile rejected — ${validation.errors.length} validation issue(s); one re-ask`, { issues: validation.errors.length }, 'The Assessment')
  res = await askAlpha('alpha:assess-retry',
    `\n\n<correction>Your previous profile was rejected: ${validation.errors.map((e) => e.message).join('; ')}. ` +
    `Return EXACTLY D1..D8, each { score: 0|1|2, evidence: nonempty quote } — no extra keys inside the profile object.</correction>`)
  profile = res && res.profile
  validation = validateProfile(profile)
}

// Still invalid → conservative default profile (all dims at mid, 1) with a ledgered warning. The
// posture from an all-1 profile sits one notch up from the floor on the optional dials — never
// fail the stage on assessor flakiness (BLUEPRINT §3: floors always run regardless).
let degraded = false
if (!validation.ok) {
  degraded = true
  log(`WARNING: Alpha's profile still invalid after a re-ask — falling back to a conservative all-mid profile (posture errs toward more scrutiny).`)
  await lore('gauge.profile_fallback', `Profile invalid after re-ask — conservative all-mid fallback; the posture errs toward more scrutiny`, null, 'The Assessment')
  profile = {}
  for (const k of DIM_KEYS) profile[k] = { score: 1, evidence: 'CONSERVATIVE DEFAULT — assessor produced no valid profile; scored mid (1) so posture errs toward scrutiny.' }
}

// ── High-stakes second opinion: at failure-penalty D8=2, a SECOND independent scorer + deterministic
//    per-dimension max-reconcile (the higher score wins; both evidence strings kept). Cross-family
//    when codex is available (translate via the codex-prompt-guide discipline), else a fresh-context
//    same-family scorer. Skipped on the degraded fallback (no real first profile to reconcile). ──
let secondScored = false
if (!degraded && profile.D8.score === 2) {
  const codexGuide = pluginRoot ? `${pluginRoot}/references/codex-prompt-guide.md` : null
  // codex --output-schema is reasoning-FIRST (reason-before-commit token order; codex-prompt-guide.md:102) —
  // the OPPOSITE of Kiln's Claude payload-first PROFILE_SCHEMA; only this codex emission ordering flips.
  const crossHowto = codexAvailable
    ? (codexGuide
      ? `You score this independently via ${CODEX_MODEL} (cross-family) using 'codex exec'. Read ${codexGuide} and follow it — TRANSLATE the brief into a Codex-native prompt (do not forward it verbatim), use --output-schema for the flat shape with the reasoning field FIRST (~50 words, reason-before-commit) then the profile — this codex ordering OVERRIDES the payload-first note in the brief below — and the heredoc-to-stdin invocation. If ${CODEX_MODEL} is unavailable retry with -m ${CODEX_FALLBACK}; if codex yields nothing usable, score directly as the independent second reader.`
      : `You score this independently via ${CODEX_MODEL} (cross-family) using 'codex exec': TRANSLATE the brief into a Codex-native prompt (do not forward it verbatim), force the flat shape with the reasoning field FIRST (~50 words) then the profile via --output-schema (this codex ordering OVERRIDES the payload-first note in the brief below), pipe via stdin. If ${CODEX_MODEL} is unavailable retry with -m ${CODEX_FALLBACK}; if codex yields nothing usable, score directly.`)
    : `You are a FRESH, independent second reader — do NOT see or anchor on any prior scoring. Score the profile from the inputs alone.`
  log('Failure penalty is maximal (D8=2) — a second independent scorer cross-checks the profile')
  await lore('gauge.second_scorer', `Failure penalty maximal (D8=2) — a second scorer takes the measure again (${codexAvailable ? 'cross-family' : 'fresh reader'})`, { d8: 2, scorer: codexAvailable ? 'cross-family' : 'fresh' }, 'The Assessment')
  const second = await agent(
    (codexAvailable ? '' : assessorVoice) +
    `<cross_scoring>${crossHowto}</cross_scoring>\n\n` + assessBrief,
    { label: codexAvailable ? 'alpha:assess-cross-codex' : 'alpha:assess-cross-fresh', phase: 'The Assessment', model: codexAvailable ? 'sonnet' : assessorModel, schema: PROFILE_SCHEMA }
  )
  const secondProfile = second && second.profile
  if (validateProfile(secondProfile).ok) {
    secondScored = true
    // deterministic max-reconcile: per dimension the higher score wins; keep BOTH evidence quotes.
    for (const k of DIM_KEYS) {
      const a = profile[k]
      const b = secondProfile[k]
      const hi = b.score > a.score ? b : a
      const lo = b.score > a.score ? a : b
      profile[k] = { score: hi.score, evidence: hi.evidence === lo.evidence ? hi.evidence : `${hi.evidence} ‖ ${lo.evidence}` }
    }
    log('Second scorer reconciled (per-dimension max; both evidence strings kept)')
  } else {
    log('Second scorer produced no valid profile — keeping the primary scoring')
  }
}

// ── The Mapping: the deterministic §3.2 posture runs IN-SCRIPT (never an agent) ──
phase('The Mapping')
// Override semantics (T2.1): 'max' maps an all-ceiling profile (every optional dial at its top),
// 'fast' an all-floor profile (the leanest posture the mapping yields). Both still respect the
// §3.4 floors — posture() only governs ABOVE the floor, so an all-zero profile is exactly the
// always-run floor posture, never below it. null ⇒ the Gauge's assessed profile decides.
const mappingProfile = postureOverride === 'max' ? overrideProfile(2)
  : postureOverride === 'fast' ? overrideProfile(0)
    : profile
const post = posture(mappingProfile, GAUGE_CONFIG)
log(`Posture: planning=${post.planning} · research_cap=${post.research_topics_max} · plan_rounds=${post.plan_validation_rounds} · slice_budget_h=${post.slice_budget_hours} · review=${post.review.ui_effort_base} · tier2=${post.browser.tier2_per_milestone} · effort_bias=${post.effort_bias}${postureOverride ? ` (override: ${postureOverride})` : ''}`)

// overrideProfile(score) — a synthetic profile pinning every dimension to one score, for the
// 'max'/'fast' override paths. Declared after use is fine (function hoisting); kept here next to
// its only callers for readability.
function overrideProfile(score) {
  const p = {}
  for (const k of DIM_KEYS) p[k] = { score, evidence: `posture override '${postureOverride}' — dimension pinned to ${score}, profile not consulted` }
  return p
}

// ── The Ledger: Thoth appends posture_set + the stage-completed bracket to events.jsonl via the
//    kiln-state CLI (BLUEPRINT §3.5). Each append is gated on pluginRoot; absence degrades it to a
//    log line, never a stage failure. ──
phase('The Ledger')
const postureData = { posture: post, profile, override_applied: postureOverride, source: degraded ? 'conservative_default' : (secondScored ? 'two_scorer_max_reconcile' : 'single_scorer') }
if (pluginRoot) await ledger('posture_set', postureData, 'The Ledger')
else log(`pluginRoot absent — posture not ledgered to events.jsonl. posture_set data: ${JSON.stringify(postureData)}`)
// gauge.posture_set (keystone): the posture is ledgered — the whole gauge stage in one dispatch.
await lore('gauge.posture_set', `Eight readings, one posture — planning=${post.planning} · slices ${post.slice_budget_hours}h · review ${post.review.ui_effort_base}`, { planning: post.planning, slice_budget_hours: post.slice_budget_hours, ui_effort_base: post.review.ui_effort_base }, 'The Ledger')
// §3.5 stage bracket (P3.6 T4): the gauge stage completes — the posture is set. stage_completed
// bumps the projection to 'research' (STAGE_ORDER); like the entry bracket it degrades to a log line.
if (pluginRoot) await ledger('stage_completed', {}, 'The Ledger')
else log('pluginRoot absent — gauge stage_completed not ledgered')

// Return the conductor's hand-off: the assessed profile, the resolved posture, and which override
// (if any) shaped it. The conductor stores the summary line and passes posture-derived args
// downstream (research topicsMax, architecture planning/validationRounds).
return { profile, posture: post, override_applied: postureOverride }
