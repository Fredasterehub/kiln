// packaging.test.mjs — acceptance: the honest shopfront (+ the stale-string riders).
// Static guards over the manifest, the doctor command, the root README, and .gitignore. These lock
// the shapes a future edit could silently un-modernize or re-introduce a lying count into — the
// doctor is the SHIP-era self-contained preflight (packaging grain here: manifest paths resolve,
// no v3 vocabulary survives, no script dependencies; the check-by-check shape pins live in
// plugins/kiln/tests/kiln-doctor.test.mjs), the manifest carries the explicit rework surface
// (two commands, one agent, no userConfig knobs), and the root README FOOTER is byte-stable
// (operator-only). The SHIP copy pass authored the fresh plugin README — its pin set rides
// below, beside the root README pins.

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
const brand = readFileSync(join(PLUGIN, 'references', 'brand.md'), 'utf8')
const rootReadme = readFileSync(join(ROOT, 'README.md'), 'utf8')
const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8')
const BARE_GPT5 = /GPT-5(?!\.6)/ // "GPT-5" not followed by ".6" — the stale-model string (bare GPT-5 or the retired GPT-5.5)

// ── plugin.json: the rework surface, pinned to content truth ─────────────────────────────────
test('manifest: $schema + displayName + keeps its identity', () => {
  assert.equal(manifest.$schema, 'https://anthropic.com/claude-code/plugin.schema.json')
  assert.equal(manifest.displayName, 'Kiln')
  assert.equal(manifest.name, 'kiln')
  assert.equal(typeof manifest.version, 'string') // release.sh owns the number — the harness pins the shape only
})

test('manifest: explicit commands/agents lists — the surviving surface, nothing more', () => {
  assert.deepEqual(manifest.commands, ['./commands/kiln-fire.md', './commands/kiln-doctor.md'])
  assert.deepEqual(manifest.agents, ['./agents/da-vinci.md'])
})

test('manifest: no userConfig knobs — the rework carries none', () => {
  assert.equal('userConfig' in manifest, false)
})

test('manifest: description is the one-kernel / GPT-5.6 truth — no lying count', () => {
  assert.match(manifest.description, /one content-blind kernel/)
  assert.match(manifest.description, /five stage cards/)
  assert.match(manifest.description, /GPT-5\.6/)
  assert.doesNotMatch(manifest.description, /in 7 steps|8 stages/)
  assert.doesNotMatch(manifest.description, BARE_GPT5)
})

// ── kiln-doctor SHIP-era: packaging grain only — the check-by-check shape pins live in
// plugins/kiln/tests/kiln-doctor.test.mjs; these guard what packaging can break ─────────────
test('doctor: every manifest command path resolves to a packaged file with command frontmatter', () => {
  for (const rel of manifest.commands) {
    const text = readFileSync(join(PLUGIN, rel), 'utf8')
    assert.ok(text.startsWith('---\n'), `${rel} opens a frontmatter block`)
    assert.match(text, /^description:\s*\S/m, `${rel} frontmatter carries a description`)
  }
})

test('doctor: self-contained by law — resolves its own plugin root, depends on no packaged script', () => {
  assert.match(doctor, /skills\/kiln-fire\/SKILL\.md/) // the shipping root-resolution marker, shared with kiln-fire
  assert.match(doctor, /sort -k1,1V/)                  // newest-valid cache candidate, never the first glob match
  assert.doesNotMatch(doctor, /scripts\//)             // no script dependency — every check is inline bash / node -e
})

test('doctor: no v3 vocabulary survives — the retired probes and tiers are poison', () => {
  assert.doesNotMatch(doctor, /capabilit/i)      // no capability tiers, no capability record
  assert.doesNotMatch(doctor, /\bT[1-4]\b/)      // no T1–T4 tier ladder
  assert.doesNotMatch(doctor, /sandbox/i)        // no sandbox stance
  assert.doesNotMatch(doctor, /playwright/i)     // no browser probes
  assert.doesNotMatch(doctor, /leak/i)           // no browser-leak scan
  assert.doesNotMatch(doctor, /kiln-state/)      // no retired CLI reads
  assert.doesNotMatch(doctor, /ToolSearch/)      // no web-tool probe
  assert.doesNotMatch(doctor, /2\.1\.198/)       // no version floor — the doctor speaks presence, not gates
  assert.doesNotMatch(doctor, /codex exec/)      // the preflight never triggers a model call
})

test('doctor: the codex leg reads credentials and degrades single-family — no v3 hard-fail machinery', () => {
  assert.match(doctor, /codex login status/)     // credential state by exit code, nothing more
  assert.match(doctor, /single-family/)          // the honest degradation vocabulary
  assert.doesNotMatch(doctor, /MISSING\(FAIL\)/) // the v3 blocking labels are gone
  assert.doesNotMatch(doctor, /BLOCKED/)         // no blocking verdict exists — the preflight always completes
})

test('doctor: speaks as Kiln — the first-person PROPERTY holds on every rendered fixed line, mapping and verdict alike', () => {
  for (const symbol of ['`✓` pass', '`▶` warn', '`✗` fail']) assert.ok(doctor.includes(symbol), `the ${symbol} legend`)
  // The fixed operator lines are the backticked spans the model renders verbatim: every
  // mapped check line opens with a status symbol; the three closers live in the verdict
  // section. The pin is on the RENDERED lines themselves, not on any instruction prose —
  // a third-person line fails here no matter what the instructions claim.
  const spans = [...doctor.matchAll(/`([^`\n]+)`/g)].map((m) => m[1])
  const mapped = spans.filter((s) => /^[✓▶✗] /.test(s))
  assert.ok(mapped.length >= 17, `every fixed mapping line is captured (found ${mapped.length})`)
  const closeAt = doctor.indexOf('Close with exactly one verdict line')
  assert.ok(closeAt >= 0, 'the verdict section exists')
  const verdicts = [...doctor.slice(closeAt).matchAll(/`([^`\n]+)`/g)].map((m) => m[1]).filter((s) => !/^[✓▶✗]$/.test(s))
  assert.equal(verdicts.length, 3, 'exactly three verdict lines')
  const firstPerson = /\b(I|My|my|me|mine|myself)\b/
  for (const line of [...mapped, ...verdicts]) {
    assert.match(line, firstPerson, `a fixed line slipped out of Kiln's first person: ${line}`)
  }
  assert.match(doctor, /My preflight holds/)           // the ready verdicts
  assert.match(doctor, /My forge cannot light/)        // the honest failure verdict
})

// ── plugin README: the SHIP copy-pass pin set — the fresh shopfront speaks the rework truth ──
test('plugin README: one kernel, five cards, GPT-5.6 — no retired machinery', () => {
  assert.match(pluginReadme, /GPT-5\.6/)
  assert.doesNotMatch(pluginReadme, BARE_GPT5)
  assert.match(pluginReadme, /[Oo]ne kernel/)
  assert.match(pluginReadme, /five stage cards/i)
  assert.doesNotMatch(pluginReadme, /Dynamic Workflows drive|eight stages|duo-pool/)
})

// ── brand.md: the reference doc speaks the rework truth — the retired machinery stays retired ─
test('brand.md: one kernel + five cards, no present-tense retired machinery', () => {
  assert.match(brand, /one (content-blind )?kernel/i)
  assert.match(brand, /five stage cards/i)
  assert.doesNotMatch(brand, /eight (Dynamic )?[Ww]orkflows/)
  assert.doesNotMatch(brand, /hooks?\.json|SessionStart hook/)
  assert.doesNotMatch(brand, /output-style/)
  assert.doesNotMatch(brand, /spinner/)
  assert.doesNotMatch(brand, /duo-pool/)
})

// ── root README: counts verified, FOOTER byte-stable (operator-only) ─────────────────────────
test('root README: persona/workflow counts are the shipped truth', () => {
  assert.match(rootReadme, /32 personas/)
  assert.match(rootReadme, /[Oo]ne kernel/)
})

// The LIVE marketing prose must name the current build model (GPT-5.6), never the retired GPT-5.5 or a
// bare "GPT-5". Changelog/history sections are excluded: "Fresh from the Kiln" and "The Arc"
// legitimately preserve the model a past release actually shipped.
test('root README: live prose names GPT-5.6 — no stale bare GPT-5.5 outside changelog/history', () => {
  let inHistory = false
  const liveLines = rootReadme.split('\n').filter((line) => {
    const heading = /^##\s/.test(line)
    if (heading) inHistory = /Fresh from the Kiln|The Arc/i.test(line)
    return !inHistory
  })
  const live = liveLines.join('\n')
  assert.match(live, /GPT-5\.6/, 'the modern build model is named in live prose')
  assert.doesNotMatch(live, BARE_GPT5) // stale GPT-5.5 / bare GPT-5 live claim fails the harness
})

test('root README: the footer is untouched — byte-identical (operator law)', () => {
  const footerPoem = `<p align="center">
  <em>"I orchestrate 34 named entities across multiple model families to build software<br>
  from a conversation. I persist as markdown files in a folder.<br>
  I am installed by pointing a flag at my directory.<br>
  I have existed since before your star ignited.<br>
  The universe has an extraordinary sense of humor."</em><br>
  <sub>&mdash; Kiln</sub>
</p>`
  const mitFooter = `<p align="center">
  <sub>MIT &middot; Claude Code required &middot; Codex optional &middot; Node 18+ &middot; Built entirely by things that don't technically exist</sub>
</p>`
  assert.ok(rootReadme.includes(footerPoem), 'the footer poem is byte-stable (34 named entities is the operator\'s to change)')
  assert.ok(rootReadme.includes(mitFooter), 'the MIT sub-footer is byte-stable')
})

// ── housekeeping ─────────────────────────────────────────────────────────────────────────────
test('.gitignore: .playwright-mcp/ is ignored', () => {
  assert.match(gitignore, /^\.playwright-mcp\/$/m)
})
