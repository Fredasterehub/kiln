// surfaces.test.mjs — P5 T2 acceptance: the sanctioned surfaces (BLUEPRINT §11 items 2/4/5),
// carried to platform currency in P6.1 T2. The theater lives in labels and lazy-loaded data,
// never in always-loaded context — so this guard is static + behavioral legs per hook. It locks
// the shapes a future edit could silently break: the theme palette, the output-style frontmatter,
// the hooks.json wrapper, the exec-form command shape, the Notification matchers (incl. the 2.1.198
// background-agent events), notify.sh's TOP-LEVEL terminalSequence (BEL) envelope, and — load-bearing
// — the SessionStart sessionTitle envelope, its kiln-only gate, and the operator-title guard.

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
const BEL = String.fromCharCode(7) // U+0007; kept escape-free so no editor mangles a raw control char

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

test('hooks: exactly two — Notification ping + SessionStart title, both exec-form command hooks', () => {
  const h = JSON.parse(readFileSync(join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks
  assert.deepEqual(Object.keys(h).sort(), ['Notification', 'SessionStart'])

  const notif = h.Notification[0]
  assert.match(notif.matcher, /permission_prompt/)
  assert.match(notif.matcher, /idle_prompt/)
  // 2.1.198 background-agent events: the ping also fires when a backgrounded run needs a human or finishes.
  assert.match(notif.matcher, /agent_needs_input/)
  assert.match(notif.matcher, /agent_completed/)
  const nh = notif.hooks[0]
  assert.equal(nh.type, 'command')
  // Exec form: `command` is the bare executable, the script path rides in `args`, so a space in the
  // ${CLAUDE_PLUGIN_ROOT} cache path can never split the invocation.
  assert.equal(nh.command, 'sh')
  assert.ok(Array.isArray(nh.args))
  assert.match(nh.args[0], /\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/notify\.sh$/)

  const start = h.SessionStart[0]
  assert.match(start.matcher, /startup/)
  assert.match(start.matcher, /resume/)
  const sh = start.hooks[0]
  assert.equal(sh.type, 'command')
  assert.equal(sh.command, 'sh')
  assert.ok(Array.isArray(sh.args))
  assert.match(sh.args[0], /\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/session-title\.sh$/)
})

test('hooks: both hook scripts exist on disk', () => {
  assert.ok(existsSync(join(PLUGIN, 'hooks', 'notify.sh')))
  assert.ok(existsSync(join(PLUGIN, 'hooks', 'session-title.sh')))
})

test('session-title.sh: silent + exit 0 in a repo that is not a Kiln run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-surf-'))
  try {
    const r = spawnSync('sh', [join(PLUGIN, 'hooks', 'session-title.sh')],
      { env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, input: '{"source":"startup"}', encoding: 'utf8' })
    assert.equal(r.status, 0)
    assert.equal(r.stdout.trim(), '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('session-title.sh: emits the sessionTitle envelope inside a Kiln project (no title set)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-surf-'))
  try {
    mkdirSync(join(dir, '.kiln'), { recursive: true })
    writeFileSync(join(dir, '.kiln', 'STATE.md'),
      '# Kiln State\n\n- **stage**: build\n- **project_name**: Acme CLI\n')
    const r = spawnSync('sh', [join(PLUGIN, 'hooks', 'session-title.sh')],
      { env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, input: '{"source":"startup"}', encoding: 'utf8' })
    assert.equal(r.status, 0)
    const out = JSON.parse(r.stdout)
    assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart')
    assert.equal(out.hookSpecificOutput.sessionTitle, 'kiln: Acme CLI — build')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('session-title.sh: an operator-set title is never clobbered — silent exit 0 even in a Kiln project', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-surf-'))
  try {
    mkdirSync(join(dir, '.kiln'), { recursive: true })
    writeFileSync(join(dir, '.kiln', 'STATE.md'),
      '# Kiln State\n\n- **stage**: build\n- **project_name**: Acme CLI\n')
    const r = spawnSync('sh', [join(PLUGIN, 'hooks', 'session-title.sh')],
      { env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
        input: '{"source":"resume","session_title":"my own name"}', encoding: 'utf8' })
    assert.equal(r.status, 0)
    assert.equal(r.stdout.trim(), '') // the documented guard: check session_title before emitting sessionTitle
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('session-title.sh: our own "kiln:" title is refreshed to the live stage, not preserved', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-surf-'))
  try {
    mkdirSync(join(dir, '.kiln'), { recursive: true })
    writeFileSync(join(dir, '.kiln', 'STATE.md'),
      '# Kiln State\n\n- **stage**: validate\n- **project_name**: Acme CLI\n')
    const r = spawnSync('sh', [join(PLUGIN, 'hooks', 'session-title.sh')],
      { env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
        input: '{"source":"resume","session_title":"kiln: Acme CLI — build"}', encoding: 'utf8' })
    assert.equal(r.status, 0)
    const out = JSON.parse(r.stdout)
    assert.equal(out.hookSpecificOutput.sessionTitle, 'kiln: Acme CLI — validate')
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
      { env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, input: '{"source":"startup"}', encoding: 'utf8' })
    assert.equal(r.status, 0)
    const out = JSON.parse(r.stdout) // the r1 repro: a raw tab here was a JSON parse error
    assert.equal(out.hookSpecificOutput.sessionTitle, 'kiln: AcmeCLIv2 — build')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('notify.sh: emits the TOP-LEVEL terminalSequence (BEL) on stdout + the branded stderr line, exit 0', () => {
  const r = spawnSync('sh', [join(PLUGIN, 'hooks', 'notify.sh')],
    { input: '{"notification_type":"permission_prompt"}', encoding: 'utf8' })
  assert.equal(r.status, 0)
  const out = JSON.parse(r.stdout)             // stdout must be valid JSON (a raw BEL byte would not parse)
  assert.equal(out.terminalSequence, BEL) // a bare BEL — the /dev/tty era ended in 2.1.139
  assert.equal(out.hookSpecificOutput, undefined) // TOP-LEVEL field, not the event envelope
  assert.match(r.stderr, /kiln ·/)             // the branded flavor line, the log trace
})

test('notify.sh: tolerates the 2.1.198 background-agent payloads — valid envelope + exit 0 for each', () => {
  for (const t of ['agent_needs_input', 'agent_completed', 'idle_prompt']) {
    const r = spawnSync('sh', [join(PLUGIN, 'hooks', 'notify.sh')],
      { input: `{"notification_type":"${t}"}`, encoding: 'utf8' })
    assert.equal(r.status, 0, `${t} exits 0`)
    assert.equal(JSON.parse(r.stdout).terminalSequence, BEL, `${t} still rings the bell`)
    assert.match(r.stderr, /kiln ·/, `${t} still branded`)
  }
})
