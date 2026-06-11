// src-modules.test.mjs — unit floor for plugins/kiln/src/*.mjs (BLUEPRINT §13).
// These are the pure blocks the bundler inlines into every workflow: tested ONCE here, trusted
// everywhere they land. denzelReconcile expectations are ported from the v2 build.js behavior
// (the lift is verbatim — these tests pin that truth against future edits).

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeArgs } from '../../plugins/kiln/src/args.mjs'
import { denzelReconcile, SEV_RANK, norm } from '../../plugins/kiln/src/reconcile.mjs'
import { NO_WANDER, repoRule } from '../../plugins/kiln/src/guards.mjs'
import { MODEL_VOICE, voice } from '../../plugins/kiln/src/voice.mjs'

// ── args.mjs ─────────────────────────────────────────────────────────────────────────────────────
test('normalizeArgs: an object passes through untouched', () => {
  const a = { kilnDir: '/tmp/.kiln', depth: 2 }
  assert.equal(normalizeArgs(a), a)
})

test('normalizeArgs: a JSON string parses to its object', () => {
  assert.deepEqual(normalizeArgs('{"kilnDir":"/tmp/.kiln"}'), { kilnDir: '/tmp/.kiln' })
})

test('normalizeArgs: a malformed string fails LOUD — { __parse_error: true }, not v2 silent {}', () => {
  assert.deepEqual(normalizeArgs('{not json'), { __parse_error: true })
})

test('normalizeArgs: non-object inputs (and strings parsing to non-objects) normalize to {}', () => {
  for (const x of [null, undefined, 42, true, '42', '"quoted"', 'null', 'true']) {
    assert.deepEqual(normalizeArgs(x), {})
  }
})

// ── reconcile.mjs — the deterministic tribunal reconciler ───────────────────────────────────────
const f = (text, severity) => ({ text, severity })

test('denzelReconcile: dedupes by normalized text across both reports', () => {
  const out = denzelReconcile(
    { findings: [f('SQL injection in login!', 'high')] },
    { findings: [f('sql  injection in login', 'high')] },
  )
  assert.equal(out.findings.length, 1)
  assert.equal(out.findings[0].severity, 'high')
})

test('denzelReconcile: max severity wins on a dupe', () => {
  const out = denzelReconcile(
    { findings: [f('race condition on save', 'low')] },
    { findings: [f('Race condition on save.', 'critical')] },
  )
  assert.equal(out.findings.length, 1)
  assert.equal(out.findings[0].severity, 'critical')
})

test('denzelReconcile: blocking threshold is high — critical|high block, medium|low never do', () => {
  const out = denzelReconcile(
    { findings: [f('a', 'critical'), f('b', 'high')] },
    { findings: [f('c', 'medium'), f('d', 'low')] },
  )
  assert.deepEqual(out.blocking.map((x) => x.severity), ['critical', 'high'])
  assert.equal(out.hasBlocking, true)
  const calm = denzelReconcile({ findings: [f('c', 'medium')] }, { findings: [f('d', 'low')] })
  assert.equal(calm.hasBlocking, false)
  assert.deepEqual(calm.blocking, [])
})

test('denzelReconcile: merged findings sort by severity rank, descending', () => {
  const out = denzelReconcile(
    { findings: [f('d', 'low'), f('a', 'critical')] },
    { findings: [f('c', 'medium'), f('b', 'high')] },
  )
  assert.deepEqual(out.findings.map((x) => x.severity), ['critical', 'high', 'medium', 'low'])
})

test('denzelReconcile: null reports, empty findings, and textless entries yield a clean empty verdict', () => {
  const empties = [
    denzelReconcile(null, null),
    denzelReconcile({}, { findings: [] }),
    denzelReconcile({ findings: [null, { severity: 'critical' }] }, null), // no .text → skipped
  ]
  for (const out of empties) {
    assert.deepEqual(out, { findings: [], blocking: [], hasBlocking: false, summaryLines: [] })
  }
})

test('denzelReconcile: an unknown severity ranks as low (1) and never blocks', () => {
  const out = denzelReconcile({ findings: [f('weird', 'catastrophic')] }, null)
  assert.equal(out.findings[0].rank, 1)
  assert.equal(out.hasBlocking, false)
})

test('denzelReconcile: summaryLines render "[severity] text" in merged order', () => {
  const out = denzelReconcile({ findings: [f('boom', 'high')] }, { findings: [f('meh', 'low')] })
  assert.deepEqual(out.summaryLines, ['[high] boom', '[low] meh'])
})

test('SEV_RANK and norm match the v2 build.js originals', () => {
  assert.deepEqual(SEV_RANK, { critical: 4, high: 3, medium: 2, low: 1 })
  // lowercase, strip non-[a-z0-9 ], collapse whitespace, trim — punctuation joins, spaces split
  assert.equal(norm('  SQL—Injection!!  in   /login  '), 'sqlinjection in login')
  assert.equal(norm(null), '')
})

// ── guards.mjs ───────────────────────────────────────────────────────────────────────────────────
test('NO_WANDER is the ONE canonical scope line (v2 shipped four drifted variants)', () => {
  assert.equal(NO_WANDER, 'Read ONLY the files named in this brief (absolute paths). Do not search the filesystem or read other projects.')
})

test('repoRule embeds the project path and the sequential-build + gitignore discipline', () => {
  const rule = repoRule('/srv/demo-app')
  assert.ok(rule.startsWith('Project repo: /srv/demo-app.'))
  assert.match(rule, /do NOT create a detached git worktree/)
  assert.match(rule, /NEVER commit generated artifacts/)
})

// ── voice.mjs ────────────────────────────────────────────────────────────────────────────────────
test('voice: opus gets the MODEL_VOICE header plus a blank line; every other model gets nothing', () => {
  assert.equal(voice('opus'), MODEL_VOICE.opus + '\n\n')
  for (const m of ['sonnet', 'haiku', 'codex', '', undefined]) assert.equal(voice(m), '')
})

test('MODEL_VOICE: current shape is opus-only', () => {
  assert.deepEqual(Object.keys(MODEL_VOICE), ['opus'])
})
