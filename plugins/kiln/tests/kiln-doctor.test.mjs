import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Pins for the SHIP-era preflight (INTAKE-17): kiln-doctor is ONE self-contained command
// file — registered in the manifest, every check inline (bash / node -e), the tiers shape
// mirrored from the kernel's fail-closed boot gate (its own projection first, then
// validateTiers fact for fact), codex degradation a single-family warning that never
// hard-fails. Zero run cost: static pins are reads of bytes on disk; the one executable
// floor runs the inline validator through node against local fixtures — no model, no net.
const at = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const doctor = () => readFileSync(at('../commands/kiln-doctor.md'), 'utf8')

test('plugin.json: kiln-doctor rides the explicit commands list alongside kiln-fire', () => {
  const manifest = JSON.parse(readFileSync(at('../.claude-plugin/plugin.json'), 'utf8'))
  assert.ok(manifest.commands.includes('./commands/kiln-fire.md'), 'kiln-fire stays registered')
  assert.ok(manifest.commands.includes('./commands/kiln-doctor.md'), 'kiln-doctor is registered')
})

test('doctor: the command file exists and resolves the plugin root by the established newest-valid idiom', () => {
  const text = doctor()
  assert.ok(text.startsWith('---\ndescription:'), 'command frontmatter opens with the description')
  assert.ok(text.includes('skills/kiln-fire/SKILL.md'), 'root resolution keys on the SKILL.md marker')
  assert.ok(text.includes('sort -k1,1V'), 'newest-valid version-sort, never the first glob match')
})

test('doctor: the claude check captures the version exit and value — a mute present CLI is a defect, never a bare pass', () => {
  const text = doctor()
  assert.ok(text.includes('command -v claude'), 'presence probe')
  assert.ok(text.includes('claude --version'), 'version capture')
  assert.ok(text.includes('CLAUDE_EXIT=$?'), 'the version command exit code is captured, not discarded')
  assert.ok(text.includes('[ "$CLAUDE_EXIT" -eq 0 ] && [ -n "$CLAUDE_V" ]'), 'both the exit code and a nonempty value gate the pass token')
  assert.ok(text.includes('{version}'), 'the version is a spoken slot, never pasted terminal output')
  const muteLine = text.split('\n').find((l) => l.includes('`CLAUDE=mute`') && l.includes('→'))
  assert.ok(muteLine, 'the failing-version state maps to its own fixed line')
  assert.ok(muteLine.includes('✗'), 'a present CLI with a failing version command renders a defect line')
})

test('doctor: the codex check reads presence + login state, never calls a model, and degrades to a single-family warning — never a hard fail', () => {
  const text = doctor()
  assert.ok(text.includes('command -v codex'), 'presence probe')
  assert.ok(text.includes('codex login status </dev/null'), 'login state read by exit code, stdin closed — no prompt, no hang')
  assert.ok(!text.includes('codex exec'), 'the doctor never triggers a model call')
  assert.ok(text.includes('never a hard fail'), 'the never-hard-fail semantics are stated')
  const warnLines = text.split('\n').filter((l) => l.includes('▶') && l.includes('single-family'))
  assert.ok(warnLines.length >= 2, 'both degraded codex states (logged-out, absent) speak an explicit single-family warn line')
  for (const line of text.split('\n')) {
    if (line.includes('✗')) assert.ok(!/codex/i.test(line), 'no codex state maps to a hard-fail line')
  }
})

test('doctor: the node-absent branch survives — four data lines suppressed, one unexamined warning', () => {
  const text = doctor()
  assert.ok(text.includes('command -v node'), 'presence probe')
  assert.ok(text.includes('`NODE=absent`'), 'the absent branch is a mapped state, not a deletable path')
  assert.ok(text.includes('do not claim the files broken'), 'the honesty rule survives: unexamined is never spoken as broken')
  assert.ok(text.includes('Replace the four file lines with one'), 'the four data lines (three parses + the shape) are suppressed as one')
  const warn = '▶ My data files went unexamined — without Node I cannot open my own books.'
  assert.equal(text.split(warn).length - 1, 1, 'the single unexamined warning line, exactly once')
})

test('doctor: each of the three data files is parsed as JSON by name', () => {
  const text = doctor()
  assert.ok(text.includes('voice.json lore-quotes.json tiers.json'), 'the three sealed data files, by name')
  assert.ok(text.includes('JSON.parse'), 'a real parse, not a stat')
})

test('doctor: the tiers shape check mirrors the kernel boot gate — same nine roles, same efforts, same surface routes', () => {
  const text = doctor()
  const kernel = readFileSync(at('../workflows/kernel.js'), 'utf8')
  const list = (name) => JSON.parse('[' + kernel.match(new RegExp('const ' + name + ' = \\[([^\\]]+)\\]'))[1].replace(/'/g, '"') + ']')
  const roles = list('TIER_ROLES')
  assert.equal(roles.length, 9, 'the kernel gate carries nine roles')
  for (const role of roles) assert.ok(text.includes('"' + role + '"'), 'doctor mirrors role ' + role)
  for (const effort of list('TIER_EFFORTS')) assert.ok(text.includes('"' + effort + '"'), 'doctor mirrors effort ' + effort)
  const routes = list('TIER_ROUTES')
  assert.deepEqual(routes, ['ui', 'logic', 'mixed'], 'the kernel gate covers ui, logic, and mixed')
  for (const route of routes) assert.ok(text.includes('"' + route + '"'), 'doctor mirrors surface route ' + route)
})

test('doctor: the tiers shape check applies the kernel projection first, then the gate\'s closed facts', () => {
  const text = doctor()
  assert.ok(text.includes('doctrine: x.doctrine !== undefined'), 'the boot projection reduces doctrine to a presence flag, exactly as the kernel does')
  assert.ok(text.includes('Object.keys(x.roles).map'), 'the projection walks every role key — an unprojectable extra role fails, as the kernel boot leg would')
  assert.ok(text.includes('} catch (e) { bad('), 'a projection throw is the invalid verdict, mirroring the kernel\'s fail-closed nonzero exit')
  assert.ok(text.includes('t.doctrine !== true'), 'the projected doctrine flag is validated as validateTiers validates it')
  assert.ok(text.includes('t.resolver'), 'the resolver is validated')
  assert.ok(text.includes('t.surface_routing'), 'surface routing is validated')
  for (const field of ['r.family', 'r.alias', 'r.effort']) {
    assert.ok(text.includes(field), 'every role carries ' + field.slice(2))
  }
  assert.ok(text.includes('r.alias === "inherit"'), 'a GPT alias may never be inherit')
  assert.ok(text.includes('Object.prototype.hasOwnProperty.call(t.resolver, r.alias)'), 'every GPT alias must resolve to a concrete id through the resolver')
})

test('doctor: the inline tiers validator executes — fixture verdicts match the kernel projection + boot gate', () => {
  const text = doctor()
  const m = text.match(/node -e '\n([\s\S]+?)\n' "\$PLUGIN_ROOT\/data\/tiers\.json"/)
  assert.ok(m, 'the inline validator body is extractable from the command file')
  const script = m[1]

  // The kernel side of the equivalence: the real validateTiers (with its TIER_* constants)
  // and the real boot-leg projection, both lifted verbatim from workflows/kernel.js.
  const kernelSrc = readFileSync(at('../workflows/kernel.js'), 'utf8')
  const core = kernelSrc.slice(kernelSrc.indexOf('const TIER_EFFORTS'), kernelSrc.indexOf('function resolveTier'))
  assert.ok(core.includes('function validateTiers'), 'validateTiers is lifted from the kernel core')
  const validateTiers = new Function(core + '\nreturn validateTiers')()
  const projLine = kernelSrc.split('\n').find((l) => l.includes('JSON.stringify(((t)=>'))
  assert.ok(projLine, 'the kernel boot projection is extractable')
  const project = new Function('return ' + projLine.slice(projLine.indexOf('((t)=>'), projLine.lastIndexOf('(require(')))()
  const kernelVerdict = (fixture) => {
    // A projection throw is the kernel's nonzero boot-leg exit: fail closed.
    try { return validateTiers(project(fixture)) ? 'valid' : 'invalid' } catch { return 'invalid' }
  }

  const dir = mkdtempSync(join(tmpdir(), 'kiln-doctor-fixtures-'))
  let n = 0
  const inlineVerdict = (fixture) => {
    const file = join(dir, 'tiers-' + n++ + '.json')
    writeFileSync(file, JSON.stringify(fixture))
    const r = spawnSync(process.execPath, ['-e', script, file], { encoding: 'utf8' })
    assert.equal(r.status, 0, 'the inline validator exits 0 on parseable JSON and speaks its verdict')
    const out = r.stdout.trim()
    assert.match(out, /^TIERS_SHAPE=(valid$|invalid )/, 'the validator speaks the shape token')
    return out === 'TIERS_SHAPE=valid' ? 'valid' : 'invalid'
  }

  const base = () => JSON.parse(readFileSync(at('../data/tiers.json'), 'utf8'))
  const mutate = (fn) => { const t = base(); fn(t); return t }
  const fixtures = [
    ['the shipped tiers.json', base(), 'valid'],
    ['an extra well-formed role', mutate((t) => { t.roles.extra = { family: 'claude', alias: 'sonnet', effort: 'high' } }), 'valid'],
    ['an extra null role — the projection throw the kernel takes', mutate((t) => { t.roles.extra = null }), 'invalid'],
    ['doctrine deleted', mutate((t) => { delete t.doctrine }), 'invalid'],
    ['an unknown effort', mutate((t) => { t.roles['stage-card'].effort = 'ultra' }), 'invalid'],
    ['a GPT alias with no resolver entry', mutate((t) => { t.roles['builder-logic'].alias = 'gpt-ghost' }), 'invalid'],
    ['a GPT alias of inherit', mutate((t) => { t.roles['reviewer-gate'].alias = 'inherit' }), 'invalid'],
    ['a missing surface route', mutate((t) => { delete t.surface_routing.mixed }), 'invalid'],
    ['a missing consumer role', mutate((t) => { delete t.roles['dev-sol'] }), 'invalid'],
    ['roles replaced by null', mutate((t) => { t.roles = null }), 'invalid'],
  ]
  for (const [name, fixture, expected] of fixtures) {
    assert.equal(kernelVerdict(fixture), expected, 'kernel verdict: ' + name)
    assert.equal(inlineVerdict(fixture), expected, 'inline verdict: ' + name)
  }
})
