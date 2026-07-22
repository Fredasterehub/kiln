import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// research-sweep.js is a Workflow async-body (exports only meta), evaluated by the runtime with
// injected globals — not an importable module. The suite evaluates the marked pure-core region
// directly and runs the full body under a mocked runtime, exactly the way the runtime wraps it
// (the same technique tests/kernel.test.mjs uses for the kernel).
const src = readFileSync(
  fileURLToPath(new URL('../workflows/research-sweep.js', import.meta.url)), 'utf8',
)
const srcLines = src.split('\n')
const coreSrc = srcLines.slice(
  srcLines.findIndex(l => l.includes('RESEARCH_CORE_BEGIN')) + 1,
  srcLines.findIndex(l => l.includes('RESEARCH_CORE_END')),
).join('\n')
const core = new Function(coreSrc + `
  return { parseArgs, gateOutcome, resolveTier, researchTiersValid, ratifyLoop }`)()
const { parseArgs, gateOutcome, resolveTier, researchTiersValid, ratifyLoop } = core

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const PLUGIN = '/abs/plugins/kiln'
// The focused boot config: research-sweep validates only the three roles it consumes. The full
// kernel boot gate still rules the whole config at the law stage.
const TIERS_OK = {
  exit: 0, doctrine: true,
  resolver: { 'gpt-sol': 'gpt-5.6-sol' },
  surface_routing: { ui: 'builder-ui', logic: 'builder-logic', mixed: 'builder-logic' },
  roles: {
    'kernel-leg': { family: 'claude', alias: 'inherit', effort: 'high' },
    'stage-law': { family: 'claude', alias: 'fable', effort: 'high' },
    'ratify-reviewer': { family: 'gpt', alias: 'gpt-sol', effort: 'high' },
  },
}
async function runSweep(kargs, script) {
  const launch = (kargs && typeof kargs === 'object' && !Array.isArray(kargs))
    ? { plugin: PLUGIN, ...kargs }
    : kargs
  // invalidate is the top-of-run freshness hand; it passes by default so the label harness reaches
  // the path under test, and a test that cares about it overrides the entry.
  const full = { 'tiers:boot': TIERS_OK, invalidate: OK, 'invalidate:repair': OK, ...script }
  const calls = []
  const agentMock = async (prompt, opts = {}) => {
    calls.push({ label: opts.label, prompt, opts })
    const h = full[opts.label]
    if (h === undefined) throw new Error('unmocked label: ' + opts.label)
    return typeof h === 'function' ? h(prompt, calls) : h
  }
  const body = src.replace('export const meta', 'const meta')
  const fn = new AsyncFunction('agent', 'pipeline', 'parallel', 'log', 'phase', 'args', 'budget', 'workflow', body)
  const ret = await fn(agentMock, null, null, () => {}, () => {}, launch, null, null)
  assert.ok(typeof ret.beat === 'string' && ret.beat.length > 0, `empty beat on status "${ret.status}"`)
  assert.ok(ret.pointers && typeof ret.pointers === 'object' && !Array.isArray(ret.pointers), 'pointers is an object')
  return { ret, calls }
}
const labels = (calls) => calls.map(c => c.label)
const DIAL_ON = { exit: 0, research: 'on' }
const DIAL_OFF = { exit: 0, research: 'off' }
const OK = { exit: 0 }
const PRODUCER_CANDIDATE = { facts: { status: 'ok', pointers: ['.kiln/docs/feasibility-candidate.md'], schema_valid: true }, narration_beat: 'the feasibility read is on disk' }
const PRODUCER_NONE = { facts: { status: 'no-qualifying-question', pointers: [], schema_valid: true }, narration_beat: 'no assumption qualifies — straight to the law' }
// The default happy-path ratify script: dial on → candidate → accept → promote.
const ACCEPT_RUN = {
  'dial:read': DIAL_ON,
  'producer': PRODUCER_CANDIDATE,
  'candidate:check': OK,
  'ratify:request': OK,
  'ratify:gate': { exit: 0 },
  'promote': OK,
}

// ── The pure core ───────────────────────────────────────────────────────────

test('core: parse-and-hop accepts both arg shapes; malformed input never takes the bare path', () => {
  assert.deepEqual(parseArgs({ projectDir: '/p' }), { ok: true, value: { projectDir: '/p' } })
  assert.deepEqual(parseArgs(undefined), { ok: true, value: {} })
  assert.equal(parseArgs(JSON.stringify({ projectDir: '/p', plugin: '/x' })).ok, true)
  assert.equal(parseArgs('not json').ok, false)
  assert.equal(parseArgs('"bare"').ok, false)
  assert.equal(parseArgs('[1,2]').ok, false)
})

test('core: gateOutcome maps the ratify exit table to closed outcomes, unknown fails closed', () => {
  assert.equal(gateOutcome(0), 'accept')
  assert.equal(gateOutcome(10), 'reject')
  assert.equal(gateOutcome(11), 'blocked')
  assert.equal(gateOutcome(21), 'codex_unavailable')
  assert.equal(gateOutcome(127), 'gate_unreachable')
  assert.equal(gateOutcome(126), 'gate_unreachable')
  assert.equal(gateOutcome(20), 'transport_failure')
  assert.equal(gateOutcome(1), 'transport_failure')
})

test('core: resolveTier is family-aware — claude passes through, gpt resolves, inherit omits the model', () => {
  assert.deepEqual(resolveTier(TIERS_OK, 'kernel-leg'), { effort: 'high' })
  assert.deepEqual(resolveTier(TIERS_OK, 'stage-law'), { effort: 'high', model: 'fable' })
  assert.deepEqual(resolveTier(TIERS_OK, 'ratify-reviewer'), { effort: 'high', model: 'gpt-5.6-sol' })
})

test('core: researchTiersValid holds the three consumed roles to the HIGH floor and a resolvable gpt alias', () => {
  const cfg = () => JSON.parse(JSON.stringify(TIERS_OK))
  assert.equal(researchTiersValid(cfg()), true)
  assert.equal(researchTiersValid(null), false)
  const nd = cfg(); nd.doctrine = false; assert.equal(researchTiersValid(nd), false, 'doctrine must be true')
  const sub = cfg(); sub.roles['stage-law'].effort = 'medium'; assert.equal(researchTiersValid(sub), false, 'a sub-HIGH role fails the floor')
  const gi = cfg(); gi.roles['ratify-reviewer'].alias = 'inherit'; assert.equal(researchTiersValid(gi), false, 'a gpt role may not be inherit')
  const gr = cfg(); delete gr.resolver['gpt-sol']; assert.equal(researchTiersValid(gr), false, 'a gpt alias with no resolver mapping fails')
  const mk = cfg(); delete mk.roles['kernel-leg']; assert.equal(researchTiersValid(mk), false, 'a missing consumed role fails closed')
})

test('core: ratifyLoop is bounded at one repair — accept, a 2nd reject, and every transport outcome', async () => {
  const mk = (exits) => ({ gate: async () => exits.shift(), repair: async () => true })
  assert.deepEqual(await ratifyLoop(mk([0])), { result: 'accepted', repairs: 0 }, 'clean accept, no repair')
  assert.deepEqual(await ratifyLoop(mk([10, 0])), { result: 'accepted', repairs: 1 }, 'reject then a repaired accept')
  assert.deepEqual(await ratifyLoop(mk([10, 10])), { result: 'rejected', repairs: 1 }, 'a 2nd reject stops at the cap — never a 3rd gate')
  assert.equal((await ratifyLoop(mk([11]))).result, 'blocked')
  assert.equal((await ratifyLoop(mk([21]))).result, 'codex-unavailable')
  assert.equal((await ratifyLoop(mk([127]))).result, 'gate-unreachable')
  assert.equal((await ratifyLoop(mk([20]))).result, 'transport-failure')
  const failedRepair = await ratifyLoop({ gate: async () => 10, repair: async () => false })
  assert.deepEqual(failedRepair, { result: 'repair-failed', repairs: 1 }, 'an unconfirmed repair halts visibly')
})

// ── The mocked runtime ────────────────────────────────────────────────────────

test('runtime: malformed string args are a closed-fact error, never the bare path', async () => {
  const { ret, calls } = await runSweep('this is not json', {})
  assert.equal(ret.status, 'bad-args')
  assert.equal(calls.length, 0, 'no leg runs on malformed args')
})

test('runtime: a missing or relative plugin root halts honestly — no work runs', async () => {
  for (const plugin of [undefined, 'plugins/kiln']) {
    const { ret, calls } = await runSweep({ projectDir: '/p', plugin }, {})
    assert.equal(ret.status, 'bad-args')
    assert.ok(ret.beat.includes('absolute'), 'the halt names the absolute-path contract')
    assert.equal(calls.length, 0, 'nothing runs without an absolute plugin root')
  }
})

test('runtime: a malformed tier file holds the law closed — never a sweep on unknown tiers', async () => {
  const { ret, calls } = await runSweep({ projectDir: '/p' }, { 'tiers:boot': { exit: 20 } })
  assert.equal(ret.status, 'held', 'a bad boot holds the law')
  assert.deepEqual(labels(calls), ['tiers:boot'], 'nothing runs after a failed boot — no dial, no producer')
})

test('runtime: research OFF stands down immediately — no producer, no gate, no ratify', async () => {
  const { ret, calls } = await runSweep({ projectDir: '/p' }, { 'dial:read': DIAL_OFF })
  assert.equal(ret.status, 'stood-down', 'the dial off is a stand-down')
  assert.ok(!calls.some(c => c.label === 'producer'), 'no producer runs on stand-down')
  assert.ok(!calls.some(c => c.label === 'ratify:gate'), 'no ratify on stand-down')
  const dial = calls.find(c => c.label === 'dial:read')
  assert.ok(dial.prompt.includes('gauge-dial.mjs'), 'the dial is read from the gauge-dial projector')
})

test('runtime: research ON with no qualifying question — one producer call, no artifact, no gate', async () => {
  const { ret, calls } = await runSweep({ projectDir: '/p' }, { 'dial:read': DIAL_ON, 'producer': PRODUCER_NONE })
  assert.equal(ret.status, 'no-qualifying-question')
  assert.equal(calls.filter(c => c.label === 'producer').length, 1, 'exactly one producer call')
  assert.ok(!calls.some(c => c.label === 'candidate:check'), 'no candidate check — nothing was written')
  assert.ok(!calls.some(c => c.label === 'ratify:gate'), 'no ratify — there is nothing to grade')
  assert.ok(!calls.some(c => c.label === 'promote'), 'no promotion')
})

test('runtime: a qualifying question runs producer → ratify → accept → atomic promotion, in that order', async () => {
  const { ret, calls } = await runSweep({ projectDir: '/p' }, ACCEPT_RUN)
  assert.equal(ret.status, 'accepted')
  const producer = calls.findIndex(c => c.label === 'producer')
  const gate = calls.findIndex(c => c.label === 'ratify:gate')
  const promote = calls.findIndex(c => c.label === 'promote')
  assert.ok(producer >= 0 && gate >= 0 && promote >= 0, 'all three legs ran')
  assert.ok(producer < gate, 'the producer writes the candidate before the ratify gate grades it')
  assert.ok(gate < promote, 'the accept precedes the promotion — never the other way')
  const gateCall = calls.find(c => c.label === 'ratify:gate')
  assert.ok(gateCall.prompt.includes('/scripts/kiln-review') && gateCall.prompt.includes(' ratify . .kiln/feasibility-ratify-request.json .kiln/feasibility-gate.json'),
    'the gate rides the shell-quoted kiln-review ratify verb with the cwd-relative repo arg')
  const req = calls.find(c => c.label === 'ratify:request')
  assert.ok(req.prompt.includes('feasibility-rubric.json'), 'the request names the feasibility rubric')
  assert.ok(req.prompt.includes('gpt-5.6-sol'), 'the reviewer is the opposite-family ratify-reviewer (codex id)')
  const promoteCall = calls.find(c => c.label === 'promote')
  assert.ok(promoteCall.prompt.includes('mv -f .kiln/docs/feasibility-candidate.md .kiln/docs/feasibility.md'),
    'the promotion is a single atomic rename of the ratified candidate to the canonical path — no digest dance, no temp copy')
  assert.equal(ret.pointers.feasibility, '.kiln/docs/feasibility.md', 'the return points at the promoted read')
})

test('runtime: a reject then a repaired re-ratify accepts and promotes — exactly one repair, one promotion', async () => {
  const gateExits = [10, 0]
  const { ret, calls } = await runSweep({ projectDir: '/p' }, {
    ...ACCEPT_RUN,
    'ratify:gate': () => ({ exit: gateExits.shift() }),
    'producer:repair': PRODUCER_CANDIDATE,
    'candidate:recheck': OK,
  })
  assert.equal(ret.status, 'accepted', 'reject then a repaired accept advances')
  assert.equal(calls.filter(c => c.label === 'ratify:gate').length, 2, 'the gate ran twice — grade then re-grade')
  assert.equal(calls.filter(c => c.label === 'producer:repair').length, 1, 'exactly one repair pass')
  assert.equal(calls.filter(c => c.label === 'promote').length, 1, 'the accepted candidate is promoted once')
  const repair = calls.find(c => c.label === 'producer:repair')
  assert.ok(repair.prompt.includes('.kiln/feasibility-gate.json'), 'the repair reads the findings from the feasibility gate file')
  assert.equal(repair.opts.model, 'fable', 'the repair re-runs the producer on the stage-law thinking seat')
})

test('runtime: a rejected candidate NEVER reaches .kiln/docs/feasibility.md — a 2nd reject holds the law', async () => {
  const { ret, calls } = await runSweep({ projectDir: '/p' }, {
    ...ACCEPT_RUN,
    'ratify:gate': { exit: 10 }, // always changes_required
    'producer:repair': PRODUCER_CANDIDATE,
    'candidate:recheck': OK,
  })
  assert.equal(ret.status, 'held', 'a non-converging feasibility read holds the law')
  assert.equal(calls.filter(c => c.label === 'ratify:gate').length, 2, 'grade plus one re-grade — the bounded loop, never a 3rd')
  assert.ok(!calls.some(c => c.label === 'promote'), 'a rejected candidate is never promoted to the canonical path')
})

test('runtime: blocked, transport, gate-unreachable, and codex-unavailable each HOLD the law — never a promotion', async () => {
  for (const exit of [11, 20, 127, 21]) {
    const { ret, calls } = await runSweep({ projectDir: '/p' }, { ...ACCEPT_RUN, 'ratify:gate': { exit } })
    assert.equal(ret.status, 'held', 'ratify exit ' + exit + ' holds the law')
    assert.ok(!calls.some(c => c.label === 'promote'), 'exit ' + exit + ': never promoted')
    assert.ok(!calls.some(c => c.label === 'producer:repair'), 'exit ' + exit + ': no repair on a non-reject outcome')
  }
})

test('runtime: a codex-unavailable ratify holds — never the build degraded single-family continue', async () => {
  const { ret, calls } = await runSweep({ projectDir: '/p' }, { ...ACCEPT_RUN, 'ratify:gate': { exit: 21 } })
  assert.equal(ret.status, 'held')
  assert.ok(ret.beat.toLowerCase().includes('codex'), 'the hold is honest about the missing second family')
  assert.ok(!calls.some(c => c.label && c.label.startsWith('degraded')), 'the feasibility read never advances single-family')
})

test('runtime: a producer that returns no sound work holds the law before any ratify', async () => {
  const { ret, calls } = await runSweep({ projectDir: '/p' }, {
    'dial:read': DIAL_ON,
    'producer': { facts: { status: 'transport-failure', pointers: [], schema_valid: false }, narration_beat: '' },
  })
  assert.equal(ret.status, 'held')
  assert.ok(!calls.some(c => c.label === 'ratify:gate'), 'no ratify on a failed producer')
  assert.ok(!calls.some(c => c.label === 'promote'), 'no promotion on a failed producer')
})

test('runtime: a producer claiming a candidate that is not on disk holds the law — never ratify a phantom', async () => {
  const { ret, calls } = await runSweep({ projectDir: '/p' }, {
    'dial:read': DIAL_ON,
    'producer': PRODUCER_CANDIDATE,
    'candidate:check': { exit: 1 }, // the claimed candidate is empty or missing
  })
  assert.equal(ret.status, 'held')
  assert.ok(!calls.some(c => c.label === 'ratify:gate'), 'no ratify when the candidate is absent')
})

// ── The filesystem guarantees: real mechanical hands over a real .kiln sandbox ──
// The mocked runtime above proves control flow by label; these prove the on-disk invariants the
// findings turn on. The model/bridge legs stay mocked, but the mechanical hands (invalidate,
// test -s, the request write, the atomic-rename promote) RUN against a temp project dir, and the
// producer/gate mocks write exactly the files the real legs would — so freshness and the promotion
// are tested as executed bytes, not inspected labels.
const REAL_HANDS = new Set(['invalidate', 'invalidate:repair', 'candidate:check', 'ratify:request', 'candidate:recheck', 'promote'])
const CAND = '.kiln/docs/feasibility-candidate.md'
const FEAS = '.kiln/docs/feasibility.md'
const GATE = '.kiln/feasibility-gate.json'
const digestOf = (b) => createHash('sha256').update(b).digest('hex')

async function runSweepFs(script, { seedCandidate, seedFeasibility } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-sweep-fs-'))
  mkdirSync(join(dir, '.kiln/docs'), { recursive: true })
  const p = (rel) => join(dir, rel)
  if (seedCandidate !== undefined) writeFileSync(p(CAND), seedCandidate)
  if (seedFeasibility !== undefined) writeFileSync(p(FEAS), seedFeasibility)
  const full = { 'tiers:boot': TIERS_OK, ...script }
  const calls = []
  const agentMock = async (prompt, opts = {}) => {
    calls.push({ label: opts.label, prompt, opts })
    if (REAL_HANDS.has(opts.label)) {
      const cmd = prompt.slice(prompt.indexOf('\n') + 1)
      const r = spawnSync('bash', ['-c', cmd], { cwd: dir, encoding: 'utf8' })
      return { exit: r.status == null ? 20 : r.status }
    }
    const h = full[opts.label]
    if (h === undefined) throw new Error('unmocked label: ' + opts.label)
    return typeof h === 'function' ? h(p) : h
  }
  const body = src.replace('export const meta', 'const meta')
  const fn = new AsyncFunction('agent', 'pipeline', 'parallel', 'log', 'phase', 'args', 'budget', 'workflow', body)
  const ret = await fn(agentMock, null, null, () => {}, () => {}, { plugin: PLUGIN, projectDir: dir }, null, null)
  const files = {
    candidate: existsSync(p(CAND)) ? readFileSync(p(CAND), 'utf8') : null,
    feasibility: existsSync(p(FEAS)) ? readFileSync(p(FEAS), 'utf8') : null,
  }
  rmSync(dir, { recursive: true, force: true })
  return { ret, calls, files }
}

// A producer mock that writes fresh candidate bytes then reports the ok facts — the real
// producer's on-disk side effect the test -s gate and the atomic-rename promotion depend on.
const producerWriting = (bytes) => (p) => { writeFileSync(p(CAND), bytes); return PRODUCER_CANDIDATE }
// A ratify:gate mock standing in for kiln-review: it publishes the gate.json the real verb would —
// law_hash bound to the CURRENT candidate bytes — and returns the scripted exit code.
const gateWriting = (exit) => (p) => {
  const bytes = existsSync(p(CAND)) ? readFileSync(p(CAND)) : Buffer.from('')
  writeFileSync(p(GATE), JSON.stringify({
    review_id: 'feasibility-ratify', law_hash: digestOf(bytes),
    findings: [], blockers: [], verdict: exit === 0 ? 'accept' : 'changes_required',
  }))
  return { exit }
}

test('fs: an accepted sweep promotes the exact ratified bytes to the canonical path, candidate consumed', async () => {
  const bytes = '# Feasibility\nfresh ratified bytes\n'
  const { ret, files } = await runSweepFs({
    'dial:read': DIAL_ON, 'producer': producerWriting(bytes), 'ratify:gate': gateWriting(0),
  })
  assert.equal(ret.status, 'accepted')
  assert.equal(files.feasibility, bytes, 'the canonical read is byte-for-byte the ratified candidate')
  assert.equal(files.candidate, null, 'the candidate is renamed, not copied — nothing stale left behind')
})

test('fs: a producer that writes no candidate over a stale prior one holds — the stale bytes are invalidated, never ratified', async () => {
  const { ret, calls, files } = await runSweepFs(
    { 'dial:read': DIAL_ON, 'producer': PRODUCER_CANDIDATE }, // claims ok, writes nothing
    { seedCandidate: '# Feasibility\nSTALE prior-run bytes\n' },
  )
  assert.equal(ret.status, 'held', 'no fresh candidate on disk holds the law')
  assert.ok(!calls.some(c => c.label === 'ratify:gate'), 'the stale bytes never reach the ratify gate')
  assert.equal(files.candidate, null, 'the stale candidate was invalidated at the top of the run, not ratified')
  assert.equal(files.feasibility, null, 'nothing is promoted')
})

test('fs: research OFF invalidates a prior canonical feasibility.md — the law never reads a prior desk as current', async () => {
  const { ret, files } = await runSweepFs({ 'dial:read': DIAL_OFF }, { seedFeasibility: '# Feasibility\nprior-run advice\n' })
  assert.equal(ret.status, 'stood-down')
  assert.equal(files.feasibility, null, 'the stale canonical read is cleared before the stand-down')
})

test('fs: a no-qualifying sweep invalidates a prior canonical feasibility.md', async () => {
  const { ret, files } = await runSweepFs(
    { 'dial:read': DIAL_ON, 'producer': PRODUCER_NONE },
    { seedFeasibility: '# Feasibility\nprior-run advice\n' },
  )
  assert.equal(ret.status, 'no-qualifying-question')
  assert.equal(files.feasibility, null, 'a no-qualifying run leaves no stale canonical read behind')
})

test('fs: a twice-rejected candidate never lands at the canonical path — and a prior read is invalidated', async () => {
  const cand = '# Feasibility\ncandidate under review\n'
  const { ret, calls, files } = await runSweepFs({
    'dial:read': DIAL_ON, 'producer': producerWriting(cand),
    'producer:repair': producerWriting(cand), 'ratify:gate': gateWriting(10),
  }, { seedFeasibility: '# Feasibility\nprior-run advice\n' })
  assert.equal(ret.status, 'held')
  assert.equal(calls.filter(c => c.label === 'ratify:gate').length, 2, 'grade then one re-grade — the bounded loop, never a 3rd')
  assert.equal(files.feasibility, null, 'a rejected read never becomes canonical advice and the stale prior read is gone')
})

test('fs: a repair that reports ok without rewriting the candidate cannot re-ratify or promote the stale first-round bytes', async () => {
  const gateExits = [10, 0] // reject, then a would-be accept only a freshly rewritten candidate could earn
  const { ret, calls, files } = await runSweepFs({
    'dial:read': DIAL_ON, 'producer': producerWriting('# Feasibility\nrejected first-round bytes\n'),
    'producer:repair': PRODUCER_CANDIDATE, // claims ok, writes NOTHING
    'ratify:gate': (p) => gateWriting(gateExits.shift())(p),
  })
  assert.equal(ret.status, 'held', 'a repair that writes no fresh candidate halts the loop — the stale rejected bytes never re-ratify')
  assert.equal(calls.filter(c => c.label === 'ratify:gate').length, 1, 'the empty repair never reaches the would-be accept — only the first grade ran')
  assert.equal(files.feasibility, null, 'the rejected first-round bytes are never promoted')
  assert.equal(files.candidate, null, 'the first-round candidate is invalidated before the repair, not carried into a re-grade')
})

// ── The conductor wiring: research runs before the law on BOTH paths ──────────

test('conductor: SKILL.md launches the research sweep before the kernel law launch on both paths', () => {
  const skill = readFileSync(fileURLToPath(new URL('../skills/kiln-fire/SKILL.md', import.meta.url)), 'utf8')
  assert.ok(skill.includes('workflows/research-sweep.js'), 'the conductor launches research-sweep.js by path')
  const directLaw = skill.indexOf('stage: "law", projectDir, idea, plugin')
  const brainLaw = skill.indexOf('stage: "law", projectDir, idea: <essence>')
  assert.ok(directLaw > 0, 'the direct-path law launch is present')
  assert.ok(brainLaw > 0, 'the brainstorm-path law launch is present')
  const sweepBeforeDirect = skill.lastIndexOf('research sweep', directLaw)
  const sweepBeforeBrain = skill.lastIndexOf('research sweep', brainLaw)
  assert.ok(sweepBeforeDirect > 0 && sweepBeforeDirect < directLaw, 'the direct path runs the research sweep before its law launch')
  assert.ok(sweepBeforeBrain > 0 && sweepBeforeBrain < brainLaw, 'the brainstorm path runs the research sweep before its law launch')
})

test('conductor: a held research sweep is a hard stop — held never proceeds and its branch forbids the law launch', () => {
  const skill = readFileSync(fileURLToPath(new URL('../skills/kiln-fire/SKILL.md', import.meta.url)), 'utf8')
  const proceedIdx = skill.indexOf('proceed to the kernel law launch')
  assert.ok(proceedIdx > 0, 'the cleared statuses proceed to the law')
  const proceedLine = skill.slice(skill.lastIndexOf('\n', proceedIdx), proceedIdx)
  assert.ok(proceedLine.includes('stood-down') && proceedLine.includes('no-qualifying-question') && proceedLine.includes('accepted'),
    'only stood-down, no-qualifying-question, and accepted clear to the law')
  assert.ok(!proceedLine.includes('held'), 'held is not among the proceed statuses')
  const heldIdx = skill.indexOf('`held`')
  assert.ok(heldIdx > 0, 'the conductor documents the held branch')
  assert.ok(/do not\s+launch law/i.test(skill.slice(heldIdx, heldIdx + 300)),
    'the held branch forbids the kernel law launch — an unratified feasibility read never reaches the law')
})
