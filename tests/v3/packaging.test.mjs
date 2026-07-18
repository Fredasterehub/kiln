// packaging.test.mjs — acceptance: the honest shopfront (+ the stale-string riders).
// Static guards over the manifest, the doctor command, the root README, and .gitignore. These lock
// the shapes a future edit could silently un-modernize or re-introduce a lying count into — the
// doctor's probe semantics are letter-for-letter, the manifest carries the explicit rework surface
// (one command, one agent, no userConfig knobs), and the root README FOOTER is byte-stable
// (operator-only). The shipped plugin carries no README until the SHIP copy pass authors a fresh
// one — that pass re-adds the README and its pins together.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PLUGIN = join(ROOT, 'plugins', 'kiln')
const manifest = JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8'))
const doctor = readFileSync(join(PLUGIN, 'commands', 'kiln-doctor.md'), 'utf8')
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
  assert.deepEqual(manifest.commands, ['./commands/kiln-fire.md'])
  assert.deepEqual(manifest.agents, ['./agents/da-vinci.md'])
})

test('manifest: no userConfig knobs — the rework carries none', () => {
  assert.equal('userConfig' in manifest, false)
})

test('manifest: description is the 8-stage / GPT-5.6 truth — no lying count', () => {
  assert.match(manifest.description, /8 stages/)
  assert.match(manifest.description, /GPT-5\.6/)
  assert.doesNotMatch(manifest.description, /in 7 steps/)
  assert.doesNotMatch(manifest.description, BARE_GPT5)
})

// ── kiln-doctor v3: probe semantics, letter-for-letter ────────────────────────────────────────
test('doctor: version floor require >= 2.1.198, recommend latest', () => {
  assert.match(doctor, /2\.1\.198/)
  assert.match(doctor, /RECOMMEND latest/)
})

test('doctor: the capability probes are present verbatim', () => {
  assert.match(doctor, /codex login status/)                                   // credential-presence arm
  assert.match(doctor, /not logged in/)                                        // re-auth advice gated on the explicit fingerprint
  assert.match(doctor, /timeout 60 codex exec --skip-git-repo-check --ignore-user-config -m gpt-5\.6-sol/) // pinned-model functional arm, isolated config, 60s budget
  assert.match(doctor, /KILN-PREFLIGHT-OK/)                                    // output validation token — the -o file, never exit-0 alone
  assert.match(doctor, /-o "\$pf"/)                                            // last-message file channel (prompt echo makes stream-grep unsafe)
  assert.match(doctor, /KILN-PREFLIGHT-OK" <\/dev\/null/)                      // stdin closed — an open non-TTY stdin hangs codex exec (A/B receipt)
  assert.match(doctor, /OK on retry/)                                          // retry recovery reported distinctly
  assert.match(doctor, /functional pipeline unavailable/)                      // the honest three-state failure label
  assert.doesNotMatch(doctor, /timeout [12]?\d codex/)                         // no sub-30s codex budget, ever
  assert.match(doctor, /@playwright\/mcp/)          // playwright arm 1
  assert.match(doctor, /npx --no-install playwright --version/) // playwright arm 2
  assert.match(doctor, /ToolSearch/)                // web probe
  assert.match(doctor, /leak-scan/)                 // browser-leak pre-flight (reused, not reinvented)
})

test('doctor: renders resolved tier + verification class into the capability record (singular)', () => {
  assert.match(doctor, /T1[\s\S]*T2[\s\S]*T3[\s\S]*T4/)
  assert.match(doctor, /static-only/)
  assert.match(doctor, /state\.json\.capability\b/)
  assert.doesNotMatch(doctor, /state\.json\.capabilities/) // the plural typo never ships
})

test('doctor: Miyamoto ladder credit survives verbatim', () => {
  assert.match(doctor, /the ladder is Miyamoto's design/)
  assert.match(doctor, /is a complete instrument, not a degraded one\./)
})

test('doctor: documents the sandbox-first + power-user stance', () => {
  assert.match(doctor, /sandbox-first/)
  assert.match(doctor, /--dangerously-skip-permissions/)
})

// ── root README: counts verified, FOOTER byte-stable (operator-only) ─────────────────────────
test('root README: persona/workflow counts are the shipped truth', () => {
  assert.match(rootReadme, /34 personas/)
  assert.match(rootReadme, /8 workflows/)
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
