import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The --detail toggle is a closed launch fact, not content: A.detail present raises
// the run's render density from broad (the default) to engineer. It rides the
// stage-card prompt as the kernel's `Density:` directive and lands in STATE.md as
// the density line. These tests pin both directive strings and both STATE lines by
// evaluating the pure core directly and by running the full body under a mocked
// runtime — the same two surfaces kernel.test.mjs exercises.
const src = readFileSync(
  fileURLToPath(new URL('../workflows/kernel.js', import.meta.url)), 'utf8',
)
const srcLines = src.split('\n')
const coreSrc = srcLines.slice(
  srcLines.findIndex(l => l.includes('KERNEL_CORE_BEGIN')) + 1,
  srcLines.findIndex(l => l.includes('KERNEL_CORE_END')),
).join('\n')
const { stateDoc } = new Function(coreSrc + '\nreturn { stateDoc }')()

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const PLUGIN = '/abs/plugins/kiln'
const TIERS_OK = {
  exit: 0, doctrine: true,
  resolver: { 'gpt-sol': 'gpt-5.6-sol' },
  surface_routing: { ui: 'builder-ui', logic: 'builder-ui', mixed: 'builder-ui' },
  roles: {
    'driver': { family: 'claude', alias: 'inherit', effort: 'high' },
    'kernel-leg': { family: 'claude', alias: 'inherit', effort: 'high' },
    'stage-card': { family: 'claude', alias: 'inherit', effort: 'high' },
    'stage-law': { family: 'claude', alias: 'fable', effort: 'high' },
    'builder-ui': { family: 'claude', alias: 'opus', effort: 'high' },
    'builder-logic': { family: 'gpt', alias: 'gpt-sol', effort: 'high' },
    'reviewer-gate': { family: 'gpt', alias: 'gpt-sol', effort: 'high' },
    'fallback-reviewer': { family: 'claude', alias: 'opus', effort: 'high' },
    'ratify-reviewer': { family: 'gpt', alias: 'gpt-sol', effort: 'high' },
    'brainstorm-facilitator': { family: 'claude', alias: 'inherit', effort: 'high' },
    // Wave 3: the HIGH-effort floor — the kernel boot gate now rejects any sub-HIGH role.
    'haiku-migration': { family: 'claude', alias: 'sonnet', effort: 'high' },
    'dev-sol': { family: 'gpt', alias: 'gpt-sol', effort: 'high' },
  },
}
const GREEN = { exit: 0, ids: [] }

// Run the law stage — the simplest stage-card dispatch — and capture the prompt
// the kernel composed for the stage-card agent plus the STATE.md write body.
async function runLaw(detail) {
  const calls = []
  const script = {
    'tiers:boot': TIERS_OK,
    'law:preflight': GREEN,
    'law:stage-end': GREEN,
    // Wave 3: the LAW input gate reads the onboarding brief + posture before planning.
    'onboarding:brief-check': { exit: 0 },
    'onboarding:posture': { exit: 0, scope: 'small', novelty: 'familiar', reversibility: 'reversible' },
    // Wave 3 (brownfield arm): greenfield here — no marker, so the map-check never runs.
    'onboarding:brownfield-check': { exit: 1 },
    'stage:law': { facts: { status: 'ok', pointers: ['.kiln/LAW.md'], schema_valid: true }, narration_beat: 'law beat' },
    // Wave 1: the law stage ratifies before advancing — accept, seal, advance.
    'ratify:request': { exit: 0 },
    'ratify:gate': { exit: 0 },
    // S1: the milestone projection is confirmed before the seal.
    'law:milestone-projection': { exit: 0 },
    'law:seal': { exit: 0 },
    'state:write': { exit: 0 },
  }
  const agentMock = async (prompt, opts = {}) => {
    calls.push({ label: opts.label, prompt })
    const h = script[opts.label]
    if (h === undefined) throw new Error('unmocked label: ' + opts.label)
    return h
  }
  const launch = { stage: 'law', projectDir: '/proj', idea: 'an idea', plugin: PLUGIN }
  if (detail) launch.detail = true
  const body = src.replace('export const meta', 'const meta')
  const fn = new AsyncFunction('agent', 'pipeline', 'parallel', 'log', 'phase', 'args', 'budget', 'workflow', body)
  await fn(agentMock, null, null, () => {}, () => {}, launch, null, null)
  const cardPrompt = calls.find(c => c.label === 'stage:law').prompt
  const stateWrite = calls.filter(c => c.label === 'state:write').pop().prompt
  return { cardPrompt, stateWrite }
}

test('stateDoc: density line reads engineer when the fact is engineer, broad when absent', () => {
  assert.match(stateDoc({ stage: 'law', density: 'engineer' }), /density: engineer/)
  assert.match(stateDoc({ stage: 'law' }), /density: broad/)
  // any non-engineer value collapses to the default
  assert.match(stateDoc({ stage: 'law', density: 'nonsense' }), /density: broad/)
})

test('--detail raises the stage-card directive to engineer and stamps STATE.md engineer', async () => {
  const { cardPrompt, stateWrite } = await runLaw(true)
  assert.ok(cardPrompt.includes('Density: engineer'), 'card carries Density: engineer')
  assert.ok(!cardPrompt.includes('Density: broad'), 'engineer run never emits the broad directive')
  assert.match(stateWrite, /density: engineer/)
})

test('without --detail the directive stays broad, the default, and STATE.md reads broad', async () => {
  const { cardPrompt, stateWrite } = await runLaw(false)
  assert.ok(cardPrompt.includes('Density: broad'), 'card carries Density: broad')
  assert.ok(!cardPrompt.includes('Density: engineer'), 'broad run never emits the engineer directive')
  assert.match(stateWrite, /density: broad/)
})
