export const meta = {
  name: 'kiln-mapping',
  description: 'Kiln brownfield mapping: three parallel scouts (anatomy, health, nervous-system) survey an existing codebase, then Mnemosyne synthesizes .kiln/docs/codebase-map.md for the rest of the pipeline.',
  phases: [
    { title: 'Reconnaissance', detail: 'parallel scouts: structure · health · data-flow' },
    { title: 'The Map', detail: 'Mnemosyne writes codebase-map.md' },
  ],
}

// ── args: { projectPath, kilnDir } ──
// @inline:args:normalizeArgs
const A = normalizeArgs(args)
// @inline:doctrine:PAYLOAD_FIRST
const projectPath = A.projectPath
const kilnDir = A.kilnDir
if (!projectPath || !kilnDir) throw new Error('mapping.js requires args.projectPath and args.kilnDir (absolute paths — the conductor resolves them; never launch with relative paths). Received args of type ' + typeof args)
// pluginRoot is the conductor-resolved absolute $PLUGIN_ROOT (a launched Workflow can't see
// ${CLAUDE_PLUGIN_ROOT}). It locates the kiln-state CLI for this stage's ledger brackets + lore beats
// (mapping.js's first ledger legs — the C1 batch); absence degrades each to a log line, never a failure.
const pluginRoot = A.pluginRoot
const mapFile = `${kilnDir}/docs/codebase-map.md`

// ── MODEL_VOICE shell (Opus only; inlined from src/voice.mjs by the bundler) ──
// @inline:voice:MODEL_VOICE,voice

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
    lens: { type: 'string' },
    highlights: { type: 'array', items: { type: 'string' } },
    findings_md: { type: 'string', description: 'full markdown writeup for this lens' },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['lens', 'highlights', 'findings_md'],
}
const MAP_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    map_file: { type: 'string' },
    stack: { type: 'array', items: { type: 'string' } },
    entry_points: { type: 'array', items: { type: 'string' } },
    key_risks: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['map_file', 'stack', 'summary'],
}
const MISSING_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    missing: { type: 'array', items: { type: 'string' }, description: 'exactly the claimed paths that do not exist on disk' },
    reasoning: { type: 'string', maxLength: 700 },
  },
  required: ['missing'],
}

// ── The run ledger (BLUEPRINT §3.5) — mapping.js's FIRST ledger legs (the C1 lore batch closed the
//    "mapping brackets ride the C1 lore batch" deferral). The vision.js runLedger idiom: Thoth
//    appends; gated on pluginRoot and degrades to a log line — an append failure never fails the
//    stage. stage_completed fires ONLY on the genuine-success path: codebase-map.md written (the
//    existence probe below confirms it); a missing-artifact path emits NOTHING. ──
async function runLedger(type, data, phaseName) {
  if (!pluginRoot) { log(`pluginRoot absent — ${type} not ledgered to events.jsonl`); return }
  const ev = JSON.stringify({ type, stage: 'mapping', data })
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

// ── Lore beats (C1 doctrine §4): cartography — one dispatch at the moment a fact becomes true, carried
//    by runLedger to the operator's transcript (note{kind:'lore'}; deterministic <stage>.<beat> key;
//    args short scalars capped at 80 by the caller; text ≤ 160). PRESENTATION, null-keep. ──
const LORE_MAX = 160
const oneLine = (s, cap = LORE_MAX) => String(s).replace(/[\x00-\x1f\x7f]+/g, ' ').slice(0, cap)
// args are bound HERE (F-1): every string value is capped at 80 mechanically, so a beat can never
// leak an unbounded project-controlled string into the ledger even if a call site forgets to cap.
const boundArgs = (a) => { const o = {}; for (const [k, v] of Object.entries(a)) o[k] = typeof v === 'string' ? oneLine(v, 80) : v; return o }
const lore = (key, text, args, phaseName) =>
  pluginRoot
    ? runLedger('note', { kind: 'lore', key, text: oneLine(text), ...(args ? { args: boundArgs(args) } : {}) }, phaseName)
    : log(oneLine(text))

phase('Reconnaissance')
log('The scouts spread out')
// §3.5 stage bracket: stage_started on entry — a re-run is the stage still in progress.
await runLedger('stage_started', {}, 'Reconnaissance')
// mapping.scouts_out (volume): three scouts spread across the codebase.
await lore('mapping.scouts_out', `Three scouts cross the territory — anatomy, health, nervous system`, null, 'Reconnaissance')
const scouts = (await parallel([
  () => agent(
    `You are the anatomy scout. ${scope}\n\n` +
    `<task>Map the STRUCTURE: top-level layout, directories, modules/packages, entry points, build/config files, and how the ` +
    `pieces fit. Use Bash (ls/find/tree) and read key files. Emit lens, highlights, and findings_md (the markdown writeup) first; reasoning is optional and under 50 words. Write nothing to disk. ${PAYLOAD_FIRST}</task>`,
    { label: 'maiev:anatomy', phase: 'Reconnaissance', model: 'sonnet', schema: SCOUT_SCHEMA }
  ),
  () => agent(
    `You are the health scout. ${scope}\n\n` +
    `<task>Assess HEALTH: dependencies and their manifest(s), test setup + how to run them, CI/CD config, build system, linting, ` +
    `and visible tech debt or risks. Emit lens, highlights, and findings_md (the markdown writeup) first; reasoning is optional and under 50 words. Write nothing to disk. ${PAYLOAD_FIRST}</task>`,
    { label: 'curie:health', phase: 'Reconnaissance', model: 'sonnet', schema: SCOUT_SCHEMA }
  ),
  () => agent(
    `You are the nervous-system scout. ${scope}\n\n` +
    `<task>Trace the FLOW: public APIs/interfaces, data flow, integrations, events, and where state lives. Emit lens, highlights, ` +
    `and findings_md (the markdown writeup) first; reasoning is optional and under 50 words. Write nothing to disk. ${PAYLOAD_FIRST}</task>`,
    { label: 'medivh:flow', phase: 'Reconnaissance', model: 'sonnet', schema: SCOUT_SCHEMA }
  ),
])).filter(Boolean)
log(`${scouts.length}/3 scouts reported`)
// mapping.scouts_back (volume): the recon party returns (straight when a scout fell silent).
await lore('mapping.scouts_back', `${scouts.length}/3 scouts reported${scouts.length < 3 ? ' — a scout fell silent' : ''}`, { scouts: scouts.length }, 'Reconnaissance')

// Zero-scout floor: every scout fell silent — there is no reconnaissance to synthesize. Never let
// Mnemosyne fabricate a map from nothing (the v2 silent empty-map). Return the honest failure shape,
// mirroring the missing-artifact idiom below: NO stage_completed, an explicit reason, map_file null.
if (scouts.length === 0) {
  const reason = 'all three scouts fell silent — no reconnaissance to synthesize; the map was not drawn'
  log(reason)
  return { map_file: null, stack: [], entry_points: [], summary: null, missing: [mapFile], reason }
}

phase('The Map')
log('Mnemosyne catalogues everything')
const map = await agent(
  voice('opus') +
  `You are the codebase cartographer. ${scope}\n\n` +
  `<scout_reports>\n${JSON.stringify(scouts)}\n</scout_reports>\n\n` +
  `<task>Synthesize the reports into ${mapFile} (mkdir -p first): a single coherent codebase map — overview, structure, stack, ` +
  `entry points, how to build/test/run, integrations, and the key risks/constraints the build must respect. Spot-check the repo at ` +
  `${projectPath} to resolve any scout disagreement. Emit map_file, stack, entry_points, key_risks, and a tight summary for the conductor first; reasoning is optional and under 50 words. ${PAYLOAD_FIRST}</task>`,
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
// F-2: a null/malformed existence report is NOT verification (mirror report.js's honest gate). Only
// a real {missing:[...]} array counts as a verdict; a mute verifier withholds the completion.
const verified = existence && Array.isArray(existence.missing)
const missing = verified ? existence.missing : []
if (missing.length) log(`MISSING claimed artifact(s): ${missing.join(', ')}`)

// §3.5 stage bracket: mapping.map_drawn + stage_completed fire ONLY on a POSITIVE verification
// (verified AND nothing missing) — the genuine-success criterion. A mute verifier is not proof of a
// written map: withhold both, log the mute, and let the honest return (missing:[], completion
// withheld) be the signal — matching report.js. mapping is off-table, so the ledgered completion is
// for the telegraph (termination + exact-once + audit), never a state.json projection bump.
if (verified && missing.length === 0) {
  // mapping.map_drawn (keystone): the VERIFIED map is drawn — emit before stage_completed so the beat
  // renders before the telegraph's terminating completion event.
  await lore('mapping.map_drawn', `Mnemosyne remembers it all — the map is drawn: ${oneLine((map && map.stack || []).join(', '), 80)}`, { stack: oneLine((map && map.stack || []).join(', '), 80) }, 'The Map')
  await runLedger('stage_completed', {}, 'The Map')
} else if (!verified) {
  log('existence verifier was mute — map unverified; no stage_completed')
} else log('codebase-map.md missing — no stage_completed (a missing artifact is a failed mapping stage).')
return { map_file: mapFile, stack: (map && map.stack) || [], entry_points: (map && map.entry_points) || [], summary: map && map.summary, missing }
