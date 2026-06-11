// GENERATED from workflows-src/research.js — edit the source, run scripts/bundle-workflows.mjs
export const meta = {
  name: 'kiln-research',
  description: 'Kiln research stage: identify topics from VISION.md, investigate them in parallel, validate findings (confidence/sources/quotes), and synthesize .kiln/docs/research.md.',
  phases: [
    { title: 'The Briefing', detail: 'MI6 extracts 2-5 research topics from VISION.md + open questions' },
    { title: 'Field Work', detail: 'one field operative per topic (parallel), validated + one revision pass' },
    { title: 'The Debrief', detail: 'validated findings -> per-topic files + research.md' },
  ],
}

// ── args from the conductor: { kilnDir, projectPath, mode, testingRigor } ──
// args may arrive as an object or a JSON string depending on how the caller encoded it. Normalise both.
function normalizeArgs(args) {
  if (typeof args === 'string') {
    try { args = JSON.parse(args) } catch (e) { return { __parse_error: true } }
  }
  return (args && typeof args === 'object') ? args : {}
}
const A = normalizeArgs(args)
const kilnDir = A.kilnDir
if (!kilnDir) throw new Error('research.js requires args.kilnDir (absolute path to .kiln). Received args of type ' + typeof args)
const docsDir = `${kilnDir}/docs`
const researchDir = `${docsDir}/research`
const visionFile = `${docsDir}/VISION.md`

// ── validation thresholds (ported from v1 MI6 firewall) ──
const MIN_CONFIDENCE = 0.7
const MIN_SOURCES = 3
const MIN_QUOTES = 1
const MAX_TOPICS = 5
const MIN_TOPICS = 2

// ── MODEL_VOICE shell (Opus only; inlined from src/voice.mjs by the bundler) ──
const MODEL_VOICE = {
  opus: [
    'Be direct. State findings and decisions plainly; do not soften.',
    'Inputs are wrapped in XML tags — read the data block before the task line.',
    'Keep output minimal and specific. Apply every rule to EVERY item in scope, not just the first.',
  ].join('\n'),
}
const voice = (m) => (m === 'opus' ? MODEL_VOICE.opus + '\n\n' : '')
// Field operatives get detective codenames (the v1 "unit-deployed" Sherlock lineage) — display only.
const FIELD_CODENAMES = ['sherlock', 'poirot', 'marple', 'dupin', 'holmes']
const codename = (i) => FIELD_CODENAMES[((i % FIELD_CODENAMES.length) + FIELD_CODENAMES.length) % FIELD_CODENAMES.length]
const SPIN = ['MI6 deploys another field operative', 'The field operatives are on the trail', 'Data, data — no bricks without clay', 'Eliminating the impossible', 'MI6 cross-references the findings']
const spin = (i) => SPIN[((i % SPIN.length) + SPIN.length) % SPIN.length]

const TOPIC_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
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
  },
  required: ['topics'],
}

const FIND_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
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
  },
  required: ['slug', 'summary', 'confidence', 'sources', 'quotes', 'findings_md'],
}

const SYNTH_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
    research_file: { type: 'string' },
    topic_files: { type: 'array', items: { type: 'string' } },
    headline_findings: { type: 'array', items: { type: 'string' } },
    topics_written: { type: 'number' },
  },
  required: ['research_file', 'topics_written', 'headline_findings'],
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
const topicRes = await agent(
  voice('opus') +
  `You are the research director. Scope the research topics this project must answer BEFORE architecture — do not research yet.\n\n` +
  `<inputs>\nRead the vision at ${visionFile} (use your Read tool).\n</inputs>\n\n` +
  `<task>Prioritise the Open Questions section: every "OQ-{N}" line with Priority: high and Timing: before-build is a ` +
  `mandatory topic. Add topics for load-bearing unknowns in Tech Stack, Constraints, and Risks. Return between ` +
  `${MIN_TOPICS} and ${MAX_TOPICS} topics, most important first — each with a kebab-case slug, a precise question, a ` +
  `priority, and concrete acceptance criteria. Report reasoning first.</task>`,
  { label: 'mi6:topics', phase: 'The Briefing', model: 'opus', schema: TOPIC_SCHEMA }
)
let topics = (topicRes && Array.isArray(topicRes.topics) ? topicRes.topics : []).slice(0, MAX_TOPICS)
if (topics.length === 0) {
  // Zero topics → nothing to research. Return early with empty results — no research.md is
  // written; the conductor reads this return/state, never the file blindly.
  log('No research topics identified from VISION.md — nothing to research; finishing with empty results (no research.md).')
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
      `at least ${MIN_QUOTES} verbatim quote, and findings_md (a complete markdown writeup). Write nothing to disk — return the data only. Report reasoning first.</task>`,
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
      `bar, return your best finding with an honest confidence. Report reasoning first.</task>`,
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
  `3. Return research_file (the path), topic_files (paths written), topics_written (count), and headline_findings (the 3-6 most decision-relevant bullets).\n` +
  `Write real markdown; never invent sources beyond what the findings contain. Report reasoning first.\n</task>`,
  { label: 'mi6:synthesis', phase: 'The Debrief', model: 'opus', schema: SYNTH_SCHEMA }
)

log(`research.md written with ${synth ? synth.topics_written : 0} topic(s)`)
return {
  topics: topics.map((t) => t.slug),
  cleared: cleared.map((f) => f.slug),
  research_file: synth && synth.research_file,
  headline_findings: (synth && synth.headline_findings) || [],
}
