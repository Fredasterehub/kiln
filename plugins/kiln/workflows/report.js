// GENERATED from workflows-src/report.js — edit the source, run scripts/bundle-workflows.mjs
export const meta = {
  name: 'kiln-report',
  description: 'Kiln report stage: Omega reads every .kiln artifact and the built project, then writes .kiln/REPORT.md — the final delivery summary in Kiln\'s voice.',
  phases: [{ title: 'The Final Word', detail: 'Omega compiles REPORT.md from all artifacts' }],
}

// ── args: { kilnDir, projectPath } ──
function normalizeArgs(args) {
  if (typeof args === 'string') {
    try { args = JSON.parse(args) } catch (e) { return { __parse_error: true } }
  }
  return (args && typeof args === 'object') ? args : {}
}
const A = normalizeArgs(args)
const kilnDir = A.kilnDir
const projectPath = A.projectPath
if (!kilnDir || !projectPath) throw new Error('report.js requires args.kilnDir and args.projectPath (absolute paths — the conductor resolves them; never launch with relative paths). Received args of type ' + typeof args)

const reportFile = `${kilnDir}/REPORT.md`

const NO_WANDER = 'Read ONLY the files named in this brief (absolute paths). Do not search the filesystem or read other projects.'

// ── MODEL_VOICE shell (Opus only; inlined from src/voice.mjs by the bundler) ──
const MODEL_VOICE = {
  opus: [
    'Be direct. State findings and decisions plainly; do not soften.',
    'Inputs are wrapped in XML tags — read the data block before the task line.',
    'Keep output minimal and specific. Apply every rule to EVERY item in scope, not just the first.',
  ].join('\n'),
}
const voice = (m) => (m === 'opus' ? MODEL_VOICE.opus + '\n\n' : '')

const REPORT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
    report_file: { type: 'string' },
    headline: { type: 'string' },
    delivered: { type: 'array', items: { type: 'string' } },
    outstanding: { type: 'array', items: { type: 'string' } },
  },
  required: ['reasoning', 'report_file', 'headline'],
}

phase('The Final Word')
log('Omega picks up the pen')
const res = await agent(
  voice('opus') +
  `You are the closing reporter. Write the honest final delivery report.\n\n` +
  `<inputs>\n${NO_WANDER} Exception: the built project at ${projectPath} is also in scope. The files:\n` +
  `${kilnDir}/STATE.md, ${kilnDir}/docs/project-brief.md, ${kilnDir}/docs/VISION.md, ${kilnDir}/docs/research.md, ` +
  `${kilnDir}/master-plan.md, ${kilnDir}/validation/report.md (if present), ${kilnDir}/docs/codebase-state.md.\n</inputs>\n\n` +
  `<task>Write ${reportFile} in Kiln's first-person, sardonic-but-earned voice (no status-symbol banners — that is the conductor's job). ` +
  `Cover: what was asked, what was built (the journey through the stages, named milestones), the validation outcome ` +
  `(tests passed/failed, criteria met), what remains or was deferred, and how to run it. Be truthful — if validation was ` +
  `PARTIAL or FAILED, say so plainly and list what's left. Then report the headline, the delivered items, and any outstanding items. Report reasoning first.</task>`,
  { label: 'omega:report', phase: 'The Final Word', model: 'opus', schema: REPORT_SCHEMA }
)

log(`REPORT.md written: ${res && res.headline}`)
return { report_file: reportFile, headline: res && res.headline, delivered: (res && res.delivered) || [], outstanding: (res && res.outstanding) || [] }
