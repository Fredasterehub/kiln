// packaging.test.mjs — P6 T3 acceptance: the honest shopfront (BLUEPRINT §12 + the stale-string
// riders). Static guards over the manifest, the doctor command, the two READMEs, agents.json's
// model-tag audit, and .gitignore. These lock the shapes a future edit could silently un-modernize
// or re-introduce a lying count into — the doctor's probe semantics are §12 letter-for-letter, the
// manifest carries the userConfig surface, and the root README FOOTER is byte-stable (operator-only).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PLUGIN = join(ROOT, 'plugins', 'kiln')
const manifest = JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8'))
const doctor = readFileSync(join(PLUGIN, 'commands', 'kiln-doctor.md'), 'utf8')
const pluginReadme = readFileSync(join(PLUGIN, 'README.md'), 'utf8')
const rootReadme = readFileSync(join(ROOT, 'README.md'), 'utf8')
const agents = JSON.parse(readFileSync(join(PLUGIN, 'data', 'agents.json'), 'utf8'))
const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8')
const BARE_GPT5 = /GPT-5(?!\.5)/ // "GPT-5" not followed by ".5" — the stale-model string

// ── plugin.json modernization (§12) ─────────────────────────────────────────────────────────────
test('manifest: $schema + displayName + keeps its identity', () => {
  assert.equal(manifest.$schema, 'https://anthropic.com/claude-code/plugin.schema.json')
  assert.equal(manifest.displayName, 'Kiln')
  assert.equal(manifest.name, 'kiln')
  assert.equal(typeof manifest.version, 'string') // T4 owns the 3.0.0 bump — T3 leaves it a string
})

test('manifest: the userConfig knobs (posture + theaterIntensity — both consumed by the conductor), each a valid option shape', () => {
  const uc = manifest.userConfig
  assert.ok(uc && typeof uc === 'object', 'userConfig present')
  for (const key of ['posture', 'theaterIntensity']) {
    const opt = uc[key]
    assert.ok(opt, `userConfig.${key} present`)
    assert.ok(['string', 'number', 'boolean', 'directory', 'file'].includes(opt.type), `${key}.type valid`)
    assert.equal(typeof opt.title, 'string')
    assert.equal(typeof opt.description, 'string')
  }
})

test('manifest: description is the 8-stage / GPT-5.5 truth — no lying count', () => {
  assert.match(manifest.description, /8 stages/)
  assert.match(manifest.description, /GPT-5\.5/)
  assert.doesNotMatch(manifest.description, /in 7 steps/)
  assert.doesNotMatch(manifest.description, BARE_GPT5)
})

// ── kiln-doctor v3: §12 probe semantics, letter-for-letter ────────────────────────────────────────
test('doctor: version floor require >= 2.1.198, recommend latest', () => {
  assert.match(doctor, /2\.1\.198/)
  assert.match(doctor, /RECOMMEND latest/)
})

test('doctor: the §12 capability probes are present verbatim', () => {
  assert.match(doctor, /codex exec "echo ok"/)      // codex functional preflight
  assert.match(doctor, /timeout 15 codex exec/)     // the 15s bound
  assert.match(doctor, /@playwright\/mcp/)          // playwright arm 1
  assert.match(doctor, /npx --no-install playwright --version/) // playwright arm 2
  assert.match(doctor, /ToolSearch/)                // web probe
  assert.match(doctor, /leak-scan/)                 // browser-leak pre-flight (reused, not reinvented)
})

test('doctor: renders resolved tier + verification class into the capability record (singular)', () => {
  assert.match(doctor, /T1[\s\S]*T2[\s\S]*T3[\s\S]*T4/)
  assert.match(doctor, /static-only/)
  assert.match(doctor, /state\.json\.capability\b/)
  assert.doesNotMatch(doctor, /state\.json\.capabilities/) // the plural §12 typo never ships
})

test('doctor: Miyamoto ladder credit survives verbatim (P5 T4)', () => {
  assert.match(doctor, /the ladder is Miyamoto's design/)
  assert.match(doctor, /is a complete instrument, not a degraded one\./)
})

test('doctor: documents the sandbox-first + power-user stance (§12)', () => {
  assert.match(doctor, /sandbox-first/)
  assert.match(doctor, /--dangerously-skip-permissions/)
})

// ── plugins/kiln/README.md: the v3 pass ───────────────────────────────────────────────────────────
test('plugin README: v2 framing is gone, v3 + GPT-5.5 are in', () => {
  assert.doesNotMatch(pluginReadme, /How it's built \(v2\)/)
  assert.match(pluginReadme, /How it's built \(v3\)/)
  assert.match(pluginReadme, /GPT-5\.5/)
  assert.doesNotMatch(pluginReadme, BARE_GPT5)
  assert.match(pluginReadme, /## Sandbox & permissions/)
})

// ── root README: counts verified, FOOTER byte-stable (operator-only) ─────────────────────────────
test('root README: persona/workflow counts are the v3 truth', () => {
  assert.match(rootReadme, /34 personas/)
  assert.match(rootReadme, /8 workflows/)
})

test('root README: the footer is untouched — byte-identical (operator law)', () => {
  const footerPoem = `<p align="center">
  <em>"I orchestrate 27 named entities across multiple model families to build software<br>
  from a conversation. I persist as markdown files in a folder.<br>
  I am installed by pointing a flag at my directory.<br>
  I have existed since before your star ignited.<br>
  The universe has an extraordinary sense of humor."</em><br>
  <sub>&mdash; Kiln</sub>
</p>`
  const mitFooter = `<p align="center">
  <sub>MIT &middot; Claude Code required &middot; Codex optional &middot; Node 18+ &middot; Built entirely by things that don't technically exist</sub>
</p>`
  assert.ok(rootReadme.includes(footerPoem), 'the footer poem is byte-stable (27 named entities is the operator\'s to change)')
  assert.ok(rootReadme.includes(mitFooter), 'the MIT sub-footer is byte-stable')
})

// ── agents.json model-tag audit (P5 T4 flag 6): every tag verified true against a live v3 seat ────
test('agents.json: audited model tags are TRUE against live v3 seats (all stay)', () => {
  const byName = agents
  // Sphinx reviews logic slices → routing().reviewModel = 'opus'
  assert.match(byName['critical-thinker'].role, /\(opus\)/)
  // Clair builds ui/mixed → routing().buildModel = 'opus'
  assert.match(byName['la-peintresse'].role, /\(opus\)/)
  // Obscur reviews ui/mixed → routing().reviewModel = 'sonnet' (the thin cross-family wrapper)
  assert.match(byName['the-curator'].role, /\(sonnet\)/)
  // Kaneda is the fallback logic builder → buildModel 'sonnet'
  assert.match(byName['backup-coder'].role, /sonnet builder/)
})

// ── housekeeping ──────────────────────────────────────────────────────────────────────────────────
test('.gitignore: .playwright-mcp/ is ignored', () => {
  assert.match(gitignore, /^\.playwright-mcp\/$/m)
})
