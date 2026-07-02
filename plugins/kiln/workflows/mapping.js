// GENERATED from workflows-src/mapping.js — edit the source, run scripts/bundle-workflows.mjs
export const meta = {
  name: 'kiln-mapping',
  description: 'Kiln brownfield mapping: three parallel scouts (anatomy, health, nervous-system) survey an existing codebase, then Mnemosyne synthesizes .kiln/docs/codebase-map.md for the rest of the pipeline.',
  phases: [
    { title: 'Reconnaissance', detail: 'parallel scouts: structure · health · data-flow' },
    { title: 'The Map', detail: 'Mnemosyne writes codebase-map.md' },
  ],
}

// ── args: { projectPath, kilnDir } ──
function normalizeArgs(args) {
  if (typeof args === 'string') {
    try { args = JSON.parse(args) } catch (e) { return { __parse_error: true } }
  }
  return (args && typeof args === 'object') ? args : {}
}
const A = normalizeArgs(args)
const REASONING_FIRST = 'Your ENTIRE final message is ONE StructuredOutput tool call — no prose before or after it. reasoning is its FIRST property and stays CONCISE (a summary, never the carrier of the answer): every other required property must be a real, separately-populated JSON field — the validator hard-rejects a reasoning-only call, each rejection burns one of five attempts, and five failures kill this leg.'
const projectPath = A.projectPath
const kilnDir = A.kilnDir
if (!projectPath || !kilnDir) throw new Error('mapping.js requires args.projectPath and args.kilnDir (absolute paths — the conductor resolves them; never launch with relative paths). Received args of type ' + typeof args)
const mapFile = `${kilnDir}/docs/codebase-map.md`

// ── MODEL_VOICE shell (Opus only; inlined from src/voice.mjs by the bundler) ──
const MODEL_VOICE = {
  opus: [
    'Be direct. State findings and decisions plainly; do not soften.',
    'Inputs are wrapped in XML tags — read the data block before the task line.',
    'Keep output minimal and specific. Apply every rule to EVERY item in scope, not just the first.',
  ].join('\n'),
}
const voice = (m) => (m === 'opus' ? MODEL_VOICE.opus + '\n\n' : '')

const scope =
  `Survey ONLY the codebase at ${projectPath}. Do not read other projects or wander outside it. ` +
  `This may be a LARGE repo — work top-down and SAMPLE intelligently: read manifests, entry points, ` +
  `docs, and the top of key modules; do NOT try to read every file. SKIP vendored/generated/bulky ` +
  `dirs entirely (node_modules, .venv, venv, dist, build, .git, __pycache__, logs, coverage, ` +
  `.next, target) and skip binary/asset files (images, .png/.jpg, .zip). Prefer 'git ls-files' and ` +
  `scoped 'find ... -not -path' over a raw recursive listing.`

const SCOUT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
    lens: { type: 'string' },
    highlights: { type: 'array', items: { type: 'string' } },
    findings_md: { type: 'string', description: 'full markdown writeup for this lens' },
  },
  required: ['lens', 'highlights', 'findings_md'],
}
const MAP_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
    map_file: { type: 'string' },
    stack: { type: 'array', items: { type: 'string' } },
    entry_points: { type: 'array', items: { type: 'string' } },
    key_risks: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['map_file', 'stack', 'summary'],
}
const MISSING_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
    missing: { type: 'array', items: { type: 'string' }, description: 'exactly the claimed paths that do not exist on disk' },
  },
  required: ['missing'],
}

phase('Reconnaissance')
log('The scouts spread out')
const scouts = (await parallel([
  () => agent(
    `You are the anatomy scout. ${scope}\n\n` +
    `<task>Map the STRUCTURE: top-level layout, directories, modules/packages, entry points, build/config files, and how the ` +
    `pieces fit. Use Bash (ls/find/tree) and read key files. Return lens, highlights, and a markdown writeup. Write nothing to disk. ${REASONING_FIRST}</task>`,
    { label: 'maiev:anatomy', phase: 'Reconnaissance', model: 'sonnet', schema: SCOUT_SCHEMA }
  ),
  () => agent(
    `You are the health scout. ${scope}\n\n` +
    `<task>Assess HEALTH: dependencies and their manifest(s), test setup + how to run them, CI/CD config, build system, linting, ` +
    `and visible tech debt or risks. Return lens, highlights, and a markdown writeup. Write nothing to disk. ${REASONING_FIRST}</task>`,
    { label: 'curie:health', phase: 'Reconnaissance', model: 'sonnet', schema: SCOUT_SCHEMA }
  ),
  () => agent(
    `You are the nervous-system scout. ${scope}\n\n` +
    `<task>Trace the FLOW: public APIs/interfaces, data flow, integrations, events, and where state lives. Return lens, highlights, ` +
    `and a markdown writeup. Write nothing to disk. ${REASONING_FIRST}</task>`,
    { label: 'medivh:flow', phase: 'Reconnaissance', model: 'sonnet', schema: SCOUT_SCHEMA }
  ),
])).filter(Boolean)
log(`${scouts.length}/3 scouts reported`)

phase('The Map')
log('Mnemosyne catalogues everything')
const map = await agent(
  voice('opus') +
  `You are the codebase cartographer. ${scope}\n\n` +
  `<scout_reports>\n${JSON.stringify(scouts)}\n</scout_reports>\n\n` +
  `<task>Synthesize the reports into ${mapFile} (mkdir -p first): a single coherent codebase map — overview, structure, stack, ` +
  `entry points, how to build/test/run, integrations, and the key risks/constraints the build must respect. Spot-check the repo at ` +
  `${projectPath} to resolve any scout disagreement. Report the stack, entry_points, key_risks, and a tight summary for the conductor. ${REASONING_FIRST}</task>`,
  { label: 'mnemosyne:synthesis', phase: 'The Map', model: 'opus', schema: MAP_SCHEMA }
)
log(`codebase-map.md written: ${map && (map.stack || []).join(', ')}`)

// Artifact existence check: v2 returned the constructed map path without confirming the write
// landed. One cheap haiku verifier ls-es the claimed file; a miss surfaces in the log + return value.
const existence = await agent(
  `You are the artifact existence verifier.\n\n` +
  `<task>Run 'ls ${mapFile}' (Bash). Return missing = ["${mapFile}"] if it does not exist, else []. Do not read, write, or fix anything.</task>`,
  { label: 'thoth:verify', phase: 'The Map', model: 'haiku', schema: MISSING_SCHEMA }
)
const missing = (existence && existence.missing) || []
if (missing.length) log(`MISSING claimed artifact(s): ${missing.join(', ')}`)

return { map_file: mapFile, stack: (map && map.stack) || [], entry_points: (map && map.entry_points) || [], summary: map && map.summary, missing }
