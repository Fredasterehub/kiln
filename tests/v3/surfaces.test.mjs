// surfaces.test.mjs — P5 T2 acceptance: the sanctioned surfaces (BLUEPRINT §11 items 2/4/5).
// The theater lives in labels and lazy-loaded data, never in always-loaded context — so this
// guard is static + one behavioral leg per hook. It locks the shapes a future edit could
// silently break: the theme palette, the output-style frontmatter, the hooks.json wrapper +
// matchers, and — load-bearing — the SessionStart sessionTitle envelope + its kiln-only gate.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PLUGIN = join(ROOT, 'plugins', 'kiln')
const HEX = /^#[0-9a-fA-F]{6}$/

test('theme: kiln.json is valid JSON in the {name, base, overrides} shape', () => {
  const theme = JSON.parse(readFileSync(join(PLUGIN, 'themes', 'kiln.json'), 'utf8'))
  assert.equal(typeof theme.name, 'string')
  assert.equal(theme.base, 'dark') // warm accent on a dark base
  assert.equal(typeof theme.overrides, 'object')
  assert.match(theme.overrides.claude, HEX) // the forge accent
})

test('output style: kiln.md ships with a name + description frontmatter', () => {
  const raw = readFileSync(join(PLUGIN, 'output-styles', 'kiln.md'), 'utf8')
  assert.ok(raw.startsWith('---\n'), 'frontmatter block present')
  const fm = raw.slice(4, raw.indexOf('\n---', 4))
  assert.match(fm, /^name:\s*\S/m)
  assert.match(fm, /^description:\s*\S/m)
})

test('hooks: hooks.json uses the plugin wrapper {description, hooks}', () => {
  const h = JSON.parse(readFileSync(join(PLUGIN, 'hooks', 'hooks.json'), 'utf8'))
  assert.equal(typeof h.description, 'string')
  assert.equal(typeof h.hooks, 'object')
})

test('hooks: exactly two — a Notification ping and a SessionStart title, both command type', () => {
  const h = JSON.parse(readFileSync(join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks
  assert.deepEqual(Object.keys(h).sort(), ['Notification', 'SessionStart'])

  const notif = h.Notification[0]
  assert.match(notif.matcher, /permission_prompt/)
  assert.match(notif.matcher, /idle_prompt/)
  assert.equal(notif.hooks[0].type, 'command')
  assert.match(notif.hooks[0].command, /notify\.sh/)

  const start = h.SessionStart[0]
  assert.match(start.matcher, /startup/)
  assert.match(start.matcher, /resume/)
  assert.equal(start.hooks[0].type, 'command')
  assert.match(start.hooks[0].command, /session-title\.sh/)
})

test('hooks: both hook scripts exist on disk', () => {
  assert.ok(existsSync(join(PLUGIN, 'hooks', 'notify.sh')))
  assert.ok(existsSync(join(PLUGIN, 'hooks', 'session-title.sh')))
})

test('session-title.sh: silent + exit 0 in a repo that is not a Kiln run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-surf-'))
  try {
    const r = spawnSync('sh', [join(PLUGIN, 'hooks', 'session-title.sh')],
      { env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: 'utf8' })
    assert.equal(r.status, 0)
    assert.equal(r.stdout.trim(), '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('session-title.sh: emits the sessionTitle envelope inside a Kiln project', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-surf-'))
  try {
    mkdirSync(join(dir, '.kiln'), { recursive: true })
    writeFileSync(join(dir, '.kiln', 'STATE.md'),
      '# Kiln State\n\n- **stage**: build\n- **project_name**: Acme CLI\n')
    const r = spawnSync('sh', [join(PLUGIN, 'hooks', 'session-title.sh')],
      { env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: 'utf8' })
    assert.equal(r.status, 0)
    const out = JSON.parse(r.stdout)
    assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart')
    assert.equal(out.hookSpecificOutput.sessionTitle, 'kiln: Acme CLI — build')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('session-title.sh: hostile STATE.md values (quotes, backslashes, control chars) never break the JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-surf-'))
  try {
    mkdirSync(join(dir, '.kiln'), { recursive: true })
    writeFileSync(join(dir, '.kiln', 'STATE.md'),
      '# Kiln State\n\n- **stage**: build\n- **project_name**: Acme\t"CLI"\\v2\n')
    const r = spawnSync('sh', [join(PLUGIN, 'hooks', 'session-title.sh')],
      { env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: 'utf8' })
    assert.equal(r.status, 0)
    const out = JSON.parse(r.stdout) // the r1 repro: a raw tab here was a JSON parse error
    assert.equal(out.hookSpecificOutput.sessionTitle, 'kiln: AcmeCLIv2 — build')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('notify.sh: exits 0 with one branded line at a human-needed moment', () => {
  const r = spawnSync('sh', [join(PLUGIN, 'hooks', 'notify.sh')],
    { input: '{"notification_type":"permission_prompt"}', encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.match(r.stderr, /kiln ·/)
})
