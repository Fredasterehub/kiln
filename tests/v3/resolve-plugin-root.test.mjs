// resolve-plugin-root.test.mjs — acceptance: NEWEST-VALID-WINS plugin-root resolution.
// With several versions cached at once under ~/.claude/plugins/cache/*/kiln/<version>/, the four
// resolution sites must pick the HIGHEST version, never the first glob match (which is the lexically
// OLDEST). One behavioral leg drives the real resolver against a fixture cache; one drift-pin leg
// locks the canonical selection pipeline string into all four sites so a future edit cannot silently
// fork the logic at one place.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, chmodSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PLUGIN = join(ROOT, 'plugins', 'kiln')
const RESOLVER = join(PLUGIN, 'scripts', 'resolve-plugin-root.sh')

// The canonical newest-valid selection pipeline (semantics PINNED by the brief).
const PIPELINE = /sort -k1,1V \| tail -1 \| cut -f2/

// Build a fixture $HOME whose cache holds the given versions; marker present only in `withMarker`.
// Returns the fixture home dir. Caller cleans up.
function buildFixture(versions, withMarker) {
  const home = mkdtempSync(join(tmpdir(), 'kiln-rpr-'))
  for (const v of versions) {
    const dir = join(home, '.claude', 'plugins', 'cache', 'mp', 'kiln', v)
    mkdirSync(dir, { recursive: true })
    if (withMarker.includes(v)) {
      const marker = join(dir, 'skills', 'kiln-fire')
      mkdirSync(marker, { recursive: true })
      writeFileSync(join(marker, 'SKILL.md'), '---\nname: kiln-fire\n---\n')
    }
  }
  return home
}

// Copy the resolver to a location whose self-location rung (grandparent) CANNOT satisfy the marker,
// so resolution must fall through to the cache glob (rung 3). Returns the runnable script path.
function isolatedResolver() {
  const box = mkdtempSync(join(tmpdir(), 'kiln-rpr-box-'))
  const scriptsDir = join(box, 'runner', 'scripts')
  mkdirSync(scriptsDir, { recursive: true })
  const dest = join(scriptsDir, 'resolve-plugin-root.sh')
  copyFileSync(RESOLVER, dest)
  chmodSync(dest, 0o755)
  return { box, dest }
}

// Run the isolated resolver with HOME pointed at `home` and CLAUDE_PLUGIN_ROOT scrubbed (so rung 2
// cannot answer either — only the cache glob remains).
function runResolver(dest, home) {
  const env = { ...process.env, HOME: home }
  delete env.CLAUDE_PLUGIN_ROOT
  return spawnSync('bash', [dest], { env, encoding: 'utf8' })
}

test('resolver: newest valid version wins — 3.1.0, not the first glob match (3.0.0) nor 1.5.7', () => {
  const home = buildFixture(['1.5.7', '3.0.0', '3.0.2', '3.1.0'], ['3.0.0', '3.0.2', '3.1.0'])
  const { box, dest } = isolatedResolver()
  try {
    const r = runResolver(dest, home)
    assert.equal(r.status, 0, `exit 0; stderr=${r.stderr}`)
    const cache = join(home, '.claude', 'plugins', 'cache', 'mp', 'kiln')
    assert.equal(r.stdout.trim(), join(cache, '3.1.0'))            // (a) newest-valid
    assert.notEqual(r.stdout.trim(), join(cache, '1.5.7'))         // (b) lexically-first never wins
    assert.notEqual(r.stdout.trim(), join(cache, '3.0.0'))         //     first-VALID-match never wins
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(box, { recursive: true, force: true })
  }
})

test('resolver: empty cache → exit 1 with the loud diagnostic on stderr', () => {
  const home = mkdtempSync(join(tmpdir(), 'kiln-rpr-empty-')) // no .claude/plugins/cache at all
  const { box, dest } = isolatedResolver()
  try {
    const r = runResolver(dest, home)
    assert.equal(r.status, 1)                                     // (c) loud failure
    assert.equal(r.stdout.trim(), '')
    assert.match(r.stderr, /Kiln plugin root not found/)
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(box, { recursive: true, force: true })
  }
})

test('drift-pin: the canonical newest-valid pipeline appears in ALL FOUR resolution sites', () => {
  const sites = {
    'scripts/resolve-plugin-root.sh': readFileSync(RESOLVER, 'utf8'),
    'skills/kiln-fire/SKILL.md': readFileSync(join(PLUGIN, 'skills', 'kiln-fire', 'SKILL.md'), 'utf8'),
    'commands/kiln-doctor.md': readFileSync(join(PLUGIN, 'commands', 'kiln-doctor.md'), 'utf8'),
    'commands/kiln-fire.md': readFileSync(join(PLUGIN, 'commands', 'kiln-fire.md'), 'utf8'),
  }
  for (const [name, body] of Object.entries(sites)) {
    assert.match(body, PIPELINE, `${name} carries the canonical selection pipeline`)
  }
})

test('drift-pin: both prose sites carry the canonical codex preflight (credential arm + pinned-model 60s functional arm + output validation + retry, no sub-30s budget)', () => {
  const sites = {
    'commands/kiln-doctor.md': readFileSync(join(PLUGIN, 'commands', 'kiln-doctor.md'), 'utf8'),
    'skills/kiln-fire/SKILL.md': readFileSync(join(PLUGIN, 'skills', 'kiln-fire', 'SKILL.md'), 'utf8'),
  }
  for (const [name, body] of Object.entries(sites)) {
    assert.match(body, /codex login status/, `${name} carries the credential arm`)
    assert.match(body, /timeout 60 codex exec --skip-git-repo-check --ignore-user-config -m gpt-5\.6-sol/, `${name} carries the pinned-model 60s functional arm`)
    assert.match(body, /KILN-PREFLIGHT-OK/, `${name} carries the output-validation token`)
    assert.match(body, /KILN-PREFLIGHT-OK" <\/dev\/null/, `${name} closes stdin on the functional arm`)
    assert.match(body, /OK on retry/, `${name} reports retry recovery distinctly`)
    assert.doesNotMatch(body, /timeout [12]?\d codex/, `${name} carries no sub-30s codex budget`)
  }
})

test('drift-pin: the codex prompt guide teaches the strict schema tongue (recursive rules + exact-required + stdin discipline)', () => {
  const guide = readFileSync(join(PLUGIN, 'references', 'codex-prompt-guide.md'), 'utf8')
  assert.match(guide, /Every schema node carries an explicit `type`; the root is `type: "object"`/, 'explicit-type rule (R1) present')
  assert.match(guide, /Every object node carries `additionalProperties: false`/, 'recursive additionalProperties rule (R2) present')
  assert.match(guide, /`required` array lists EXACTLY its property names — every property appears, none extra, no dangling names/, 'exact bidirectional required rule (R3) present')
  assert.match(guide, /"type": \["string", "null"\]/, 'nullable-union optionality idiom present')
  assert.match(guide, /`maxItems`, `minItems` — nothing else/, 'keyword allowlist (R5) closed')
  assert.match(guide, /<\/dev\/null/, 'stdin discipline present')
  assert.doesNotMatch(guide, /only truly-required fields required/i, 'the pre-strict requiredness sentence never returns')
})
