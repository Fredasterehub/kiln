export const meta = {
  name: 'kiln-research',
  description: 'Kiln research stage: identify topics from VISION.md, investigate them in parallel, validate findings (confidence/sources/quotes), and synthesize .kiln/docs/research.md.',
  phases: [
    { title: 'The Briefing', detail: 'MI6 extracts 2-5 research topics from VISION.md + open questions' },
    { title: 'Field Work', detail: 'one field operative per topic (parallel), validated + one revision pass' },
    { title: 'The Debrief', detail: 'validated findings -> per-topic files + research.md' },
  ],
}

// ── args from the conductor: { kilnDir, projectPath, mode, testingRigor, topicsMax, pluginRoot } ──
// args may arrive as an object or a JSON string depending on how the caller encoded it. Normalise both.
// @inline:args:normalizeArgs
const A = normalizeArgs(args)
// pluginRoot is the conductor-resolved absolute $CLAUDE_PLUGIN_ROOT (a launched Workflow cannot see
// the env var). It locates the kiln-state CLI for the stage brackets below; absence degrades each
// bracket to a log line — never a stage failure.
const pluginRoot = A.pluginRoot
const PAYLOAD_FIRST = 'Your ENTIRE final message is ONE StructuredOutput tool call — no prose before or after it. Emit the payload properties FIRST; reasoning is the LAST property, OPTIONAL, and under 50 words — put detail in the designated report file or field, never in reasoning. A long leading reasoning string is the observed death mode: the call truncates before the payload lands, the validator rejects it, each rejection burns one of five attempts, and five failures kill this leg.'
const kilnDir = A.kilnDir
if (!kilnDir) throw new Error('research.js requires args.kilnDir (absolute path to .kiln). Received args of type ' + typeof args)
const docsDir = `${kilnDir}/docs`
const researchDir = `${docsDir}/research`
const visionFile = `${docsDir}/VISION.md`

// ── validation thresholds (ported from v1 MI6 firewall) ──
const MIN_CONFIDENCE = 0.7
const MIN_SOURCES = 3
const MIN_QUOTES = 1
// topicsMax is the Gauge's posture.research_topics_max — the §3.2 research-row CAP (2 + D3 + D5),
// which gauge.mjs always computes as a positive integer (research_topics_base ≥ 2 + non-negative
// dims). Its PRESENCE is the signal that the Gauge ran: it is what makes this a posture-driven run.
//
// Two regimes, switched on that presence — so T3's "no behavior change when the arg is absent"
// (tasks.md §T3) holds AND the BLUEPRINT §3.2 research row is encoded when a posture IS supplied:
//   • POSTURE ABSENT (no valid topicsMax) ⇒ v2 behavior, byte-for-byte: scope from the OQs PLUS
//     load-bearing unknowns (Tech Stack / Constraints / Risks), floor of 2, cap of 5, and the
//     zero-topics branch is unreachable (the floor guarantees ≥ 2). A run without the Gauge is
//     identical to v2 — the contract default equals current behavior.
//   • POSTURE PRESENT (valid topicsMax) ⇒ the §3.2 rule the Gauge delegates here:
//     `topics = 0 if no high-priority before-build OQs; else min(OQ-count, cap)`. OQs are the SOLE
//     topic source, there is NO lower floor (a floor would force topics the formula forbids and
//     would zero out the 0-if-no-OQs branch), and zero qualifying OQs ⇒ zero topics. The Gauge
//     never sends topicsMax: 0 — the "drop to 0" decision is made HERE, given the posture cap.
const HISTORICAL_MAX_TOPICS = 5
const HISTORICAL_MIN_TOPICS = 2
const postureGated = Number.isInteger(A.topicsMax) && A.topicsMax > 0
const MAX_TOPICS = postureGated ? A.topicsMax : HISTORICAL_MAX_TOPICS

// ── MODEL_VOICE shell (Opus only; inlined from src/voice.mjs by the bundler) ──
// @inline:voice:MODEL_VOICE,voice
// Field operatives get detective codenames (the v1 "unit-deployed" Sherlock lineage) — display only.
const FIELD_CODENAMES = ['sherlock', 'poirot', 'marple', 'dupin', 'holmes']
const codename = (i) => FIELD_CODENAMES[((i % FIELD_CODENAMES.length) + FIELD_CODENAMES.length) % FIELD_CODENAMES.length]
const SPIN = ['MI6 deploys another field operative', 'The field operatives are on the trail', 'Data, data — no bricks without clay', 'Eliminating the impossible', 'MI6 cross-references the findings']
const spin = (i) => SPIN[((i % SPIN.length) + SPIN.length) % SPIN.length]

const TOPIC_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    topics: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          slug: { type: 'string', description: 'kebab-case filename stem' },
          title: { type: 'string' },
          question: { type: 'string', description: 'the precise question to answer' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          acceptance_criteria: { type: 'string', description: 'what a complete answer must contain' },
        },
        required: ['slug', 'title', 'question', 'priority', 'acceptance_criteria'],
      },
    },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['topics'],
}

const FIND_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    slug: { type: 'string' },
    summary: { type: 'string', description: '2-4 sentence answer to the topic question' },
    confidence: { type: 'number', description: '0.0-1.0 confidence the question is answered' },
    sources: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { title: { type: 'string' }, url: { type: 'string' } },
        required: ['title', 'url'],
      },
    },
    quotes: { type: 'array', items: { type: 'string' }, description: 'direct quotes from sources' },
    findings_md: { type: 'string', description: 'full markdown writeup for this topic file' },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['slug', 'summary', 'confidence', 'sources', 'quotes', 'findings_md'],
}

const SYNTH_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    research_file: { type: 'string' },
    topic_files: { type: 'array', items: { type: 'string' } },
    headline_findings: { type: 'array', items: { type: 'string' } },
    topics_written: { type: 'number' },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['research_file', 'topics_written', 'headline_findings'],
}

// ── The run ledger (BLUEPRINT §3.5): stage brackets land in events.jsonl via the kiln-state CLI —
//    the vision.js runLedger idiom. Thoth appends; gated on pluginRoot and degrades to a log line —
//    an append failure never fails the stage. stage_completed fires ONLY on the genuine-success
//    paths (both returns below — the zero-topics route IS a completion); a failed stage emits
//    nothing, per the telegraph's termination rule. report/mapping brackets ride the C1 lore batch,
//    not this one. ──
async function runLedger(type, data, phaseName) {
  if (!pluginRoot) { log(`pluginRoot absent — ${type} not ledgered to events.jsonl`); return }
  const ev = JSON.stringify({ type, stage: 'research', data })
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

const webHowto =
  'Scope: research THIS topic from the open web only. Do NOT read project files or search the local ' +
  'filesystem — the question and acceptance criteria below are your complete brief; the project owns ' +
  'no files you need, and wandering the disk risks pulling context from an unrelated project. ' +
  'Load a web tool on demand via ToolSearch (query "web search" then use a brave-search or WebFetch ' +
  'tool); if none is available, say so in the finding and lower confidence. ' +
  'Do NOT fabricate sources or quotes — every source needs a real URL and every quote must be verbatim.'

const valid = (f) =>
  f &&
  typeof f.confidence === 'number' && f.confidence >= MIN_CONFIDENCE &&
  Array.isArray(f.sources) && f.sources.length >= MIN_SOURCES &&
  Array.isArray(f.quotes) && f.quotes.length >= MIN_QUOTES

// ── The Briefing: identify topics (MI6) ──
phase('The Briefing')
log('MI6 deploys the field team')
// §3.5 stage bracket: stage_started on every entry — a re-run is the stage still in progress.
await runLedger('stage_started', {}, 'The Briefing')
// The scoping brief switches on the same posture-presence gate (see MAX_TOPICS above): the §3.2
// OQ-only rule when the Gauge supplied a cap, the verbatim v2 brief otherwise.
const postureBrief =
  `<task>The research scope is set by the project's high-priority before-build Open Questions, capped. ` +
  `First, identify the QUALIFYING OQs: every "OQ-{N}" line (or YAML frontmatter OQ entry) with Priority: high ` +
  `AND Timing: before-build — these are the questions that MUST be answered before architecture. ` +
  `If there are NONE, return an EMPTY topics list — nothing needs researching before architecture, and the ` +
  `stage will finish with no research. ` +
  `Otherwise return one topic per qualifying OQ, most important first, up to a hard ceiling of ${MAX_TOPICS} ` +
  `topic(s): never return more topics than there are qualifying OQs, and never exceed ${MAX_TOPICS}. ` +
  `Do NOT invent topics beyond the qualifying OQs to pad the list; only when a qualifying OQ is itself ` +
  `under-specified may you sharpen it into a concrete research question. Each topic: a kebab-case slug, a precise ` +
  `question, a priority, and concrete acceptance criteria. Emit topics first; reasoning is optional and under 50 words. ${PAYLOAD_FIRST}</task>`
const historicalBrief =
  `<task>Prioritise the Open Questions section: every "OQ-{N}" line (or YAML frontmatter OQ entry) with Priority: high and Timing: before-build is a ` +
  `mandatory topic. Add topics for load-bearing unknowns in Tech Stack, Constraints, and Risks. Return between ` +
  `${HISTORICAL_MIN_TOPICS} and ${MAX_TOPICS} topics, most important first — each with a kebab-case slug, a precise question, a ` +
  `priority, and concrete acceptance criteria. Emit topics first; reasoning is optional and under 50 words. ${PAYLOAD_FIRST}</task>`
const topicRes = await agent(
  voice('opus') +
  `You are the research director. Scope the research topics this project must answer BEFORE architecture — do not research yet.\n\n` +
  `<inputs>\nRead the vision at ${visionFile} (use your Read tool).\n</inputs>\n\n` +
  (postureGated ? postureBrief : historicalBrief),
  { label: 'mi6:topics', phase: 'The Briefing', model: 'opus', schema: TOPIC_SCHEMA }
)
let topics = (topicRes && Array.isArray(topicRes.topics) ? topicRes.topics : []).slice(0, MAX_TOPICS)
if (topics.length === 0) {
  // Zero topics → nothing to research. Return early with empty results — no research.md is
  // written; the conductor reads this return/state, never the file blindly.
  log('No research topics identified from VISION.md — nothing to research; finishing with empty results (no research.md).')
  // §3.5 stage bracket: the zero-topics route is a GENUINE completion (§3.2 says so), so it closes
  // the stage like any other success.
  await runLedger('stage_completed', {}, 'The Briefing')
  return { topics: [], cleared: [], research_file: null, headline_findings: [] }
}
log(`${topics.length} research topic(s) scoped`)

// ── Field Work: investigate each topic in parallel, validate + one revision ──
phase('Field Work')
const investigated = await pipeline(
  topics,
  // stage 1 — investigate
  (t, _orig, i) => {
    log(`${spin(i)} — ${t.slug}`)
    return agent(
      `You are a research field operative investigating ONE topic.\n\n` +
      `<inputs>\n- Topic: "${t.title}" (slug: ${t.slug})\n- Question: ${t.question}\n- Acceptance criteria: ${t.acceptance_criteria}\n</inputs>\n\n` +
      `<constraints>\n${webHowto}\n</constraints>\n\n` +
      `<task>Return a finding: a 2-4 sentence summary, a confidence 0-1, at least ${MIN_SOURCES} sources (title + real URL), ` +
      `at least ${MIN_QUOTES} verbatim quote, and findings_md (a complete markdown writeup). Write nothing to disk — return the data only. ` +
      `Emit slug, summary, confidence, sources, quotes, and findings_md first — put the full writeup in findings_md; reasoning is optional and under 50 words. ${PAYLOAD_FIRST}</task>`,
      { label: `${codename(i)}:field:${t.slug}`, phase: 'Field Work', model: 'sonnet', schema: FIND_SCHEMA }
    )
  },
  // stage 2 — validate, and revise once if below the firewall bar
  (find, t, i) => {
    if (valid(find)) return find
    log(`${codename(i)}:field:${t.slug} below bar (conf=${find && find.confidence}, src=${find && (find.sources || []).length}) — one revision`)
    return agent(
      `Your prior findings on "${t.title}" failed Kiln's validation firewall ` +
      `(need confidence >= ${MIN_CONFIDENCE}, >= ${MIN_SOURCES} sources with URLs, >= ${MIN_QUOTES} quote).\n\n` +
      `<prior_attempt>\n${JSON.stringify(find)}\n</prior_attempt>\n\n<constraints>\n${webHowto}\n</constraints>\n\n` +
      `<task>Re-investigate harder, find more/better sources, and meet the bar. If the topic genuinely cannot clear the ` +
      `bar, return your best finding with an honest confidence. ` +
      `Emit slug, summary, confidence, sources, quotes, and findings_md first — put the full writeup in findings_md; reasoning is optional and under 50 words. ${PAYLOAD_FIRST}</task>`,
      { label: `${codename(i)}:field-revise:${t.slug}`, phase: 'Field Work', model: 'sonnet', schema: FIND_SCHEMA }
    ).then((rev) => rev || find)
  }
)
const findings = investigated.filter(Boolean)
const cleared = findings.filter(valid)
log(`${cleared.length}/${findings.length} topic(s) cleared the validation bar`)

// ── The Debrief: synthesize — an agent writes the per-topic files + research.md ──
phase('The Debrief')
const synth = await agent(
  voice('opus') +
  `You are the research director, synthesising the stage. You will WRITE files (Bash 'mkdir -p ${researchDir}' first, then write each file).\n\n` +
  `<validated_findings>\n${JSON.stringify(findings)}\n</validated_findings>\n\n` +
  `<task>\n1. For each finding, write ${researchDir}/<slug>.md containing its findings_md, a Sources list (title + URL), and a Quotes list.\n` +
  `2. Write ${docsDir}/research.md: a synthesis with a one-paragraph executive summary, a "Key Findings" bullet list across all topics, ` +
  `a "Decisions this enables" section, any unresolved gaps (topics that did not clear confidence ${MIN_CONFIDENCE}), and a "Sources" appendix. ` +
  `Flag low-confidence topics explicitly so architecture treats them as open.\n` +
  `3. Return research_file (the path), topic_files (paths written), topics_written (count), and headline_findings (the 3-6 most decision-relevant bullets) — ` +
  `emit those fields first; the detail lives in the files you wrote, and reasoning is optional and under 50 words.\n` +
  `Write real markdown; never invent sources beyond what the findings contain. ${PAYLOAD_FIRST}\n</task>`,
  { label: 'mi6:synthesis', phase: 'The Debrief', model: 'opus', schema: SYNTH_SCHEMA }
)

log(`research.md written with ${synth ? synth.topics_written : 0} topic(s)`)
// §3.5 stage bracket: the synthesis landed — the stage genuinely completed.
await runLedger('stage_completed', {}, 'The Debrief')
return {
  topics: topics.map((t) => t.slug),
  cleared: cleared.map((f) => f.slug),
  research_file: synth && synth.research_file,
  headline_findings: (synth && synth.headline_findings) || [],
}
