// defect-fixes.test.mjs — regression pins for the v2 defect fixes (BLUEPRINT §15 / P0 T4).
// The fixes are content-targeted edits inside generated workflows and reference docs — none is a
// reusable pure block worth extracting into src/ (each lives in exactly one branch of one file),
// so each pin reads the SHIPPED file and asserts the fix's fingerprint is present and the
// defect's is gone. The DUO_POOL pin is the real dual-source check: the inline display copy in
// build.js must equal what data/duo-pool.json derives, character for character.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const read = (p) => readFileSync(join(root, p), 'utf8')

const WORKFLOWS = ['architecture', 'build', 'mapping', 'report', 'research', 'validate']
const arch = read('plugins/kiln/workflows/architecture.js')
const mapping = read('plugins/kiln/workflows/mapping.js')
const research = read('plugins/kiln/workflows/research.js')
const report = read('plugins/kiln/workflows/report.js')
const build = read('plugins/kiln/workflows/build.js')

test('fix 1 — Athena fail-closed: a null validator becomes FAIL [validator-failure], never a silent PASS', () => {
  assert.ok(arch.includes("|| { verdict: 'FAIL', failed_dimensions: ['validator-failure'], fixes: [] }"))
  assert.ok(!arch.includes("if (!val || val.verdict === 'PASS')"))
})

test('fix 2 — council guard: fewer than 2 surviving plans skips divergence, routes to single-plan synthesis', () => {
  assert.ok(arch.includes('if (plans.length < 2)'))
  assert.ok(arch.includes('skipping divergence; single-plan synthesis'))
})

test('fix 3 — revise null-keep: a crashed plato:revise keeps the prior good synthesis', () => {
  assert.match(arch, /\)\) \|\| synth\n\}/)
})

test('fix 4 — codex temp file is mktemp-minted; the fixed collision path is gone everywhere', () => {
  const files = [...WORKFLOWS.map((w) => `plugins/kiln/workflows/${w}.js`), 'plugins/kiln/references/codex-prompt-guide.md']
  for (const f of files) assert.ok(!read(f).includes('/tmp/kiln-codex.md'), `${f} still names the fixed temp path`)
  assert.ok(arch.includes('mktemp /tmp/kiln-codex.XXXXXX.md'))
  assert.ok(read('plugins/kiln/references/codex-prompt-guide.md').includes('mktemp /tmp/kiln-codex.XXXXXX.md'))
})

test('fix 5 — report.js throws early when projectPath is missing, same style as the kilnDir check', () => {
  assert.ok(report.includes("throw new Error('report.js requires args.kilnDir and args.projectPath (absolute paths — the conductor resolves them; never launch with relative paths). Received args of type ' + typeof args)"))
})

test('fix 6 — research.js zero-topics path returns early with empty results and an honest log', () => {
  assert.ok(research.includes('return { topics: [], cleared: [], research_file: null, headline_findings: [] }'))
  assert.ok(!research.includes('writing an empty research.md'))
})

test('fix 7 — mapping + architecture verify claimed artifacts with a haiku checker and return missing[]', () => {
  for (const txt of [mapping, arch]) {
    assert.ok(txt.includes("model: 'haiku', schema: MISSING_SCHEMA"))
    assert.ok(txt.includes('const missing = (existence && existence.missing) || []'))
    assert.ok(txt.includes('MISSING claimed artifact(s)'))
  }
  assert.ok(mapping.includes(', missing }'))
  // architecture returns missing[] as a top-level return key. v3.0.2 B4-1b-ii appends ONE additive
  // `council` field AFTER it (brief §h), so missing is no longer the return's last line — assert it is
  // a standalone return key (the fix-7 intent) and that the additive council field follows it.
  assert.ok(arch.includes('\n  missing,\n'))
  assert.ok(arch.includes('\n  council: {\n'))
})

test('fix 8 — kill-streaks re-keyed to the ladder-position formula, drops chunk_count, wraps per % 40', () => {
  const ks = read('plugins/kiln/references/kill-streaks.md')
  assert.ok(!ks.includes('team_iteration') && !ks.includes('chunk_count'))
  assert.ok(ks.includes('max(build_iteration + correction_cycle, 1)'))
  assert.ok(ks.includes('(ladder_position - 1) % 40'))
  assert.ok(ks.includes('wraps back to `first-blood` (#1)'))
  assert.ok(!ks.includes('cycle from `kiln-of-the-first`'))
})

test('fix 9 — design-patterns names Opus 4.8, no stale 4.7', () => {
  const dp = read('plugins/kiln/references/design/design-patterns.md')
  assert.ok(dp.includes('Opus 4.8'))
  assert.ok(!/\b4\.7\b/.test(dp))
})

test('fix 10 — build.js inline DUO_POOL is byte-equal to what data/duo-pool.json derives', () => {
  const pools = JSON.parse(read('plugins/kiln/data/duo-pool.json')).pools
  const row = (k) => `  ${k}: [${pools[k].map((d) => `['${d.builder.name}', '${d.reviewer.name}']`).join(', ')}],`
  assert.ok(build.includes(`const DUO_POOL = {\n${Object.keys(pools).map(row).join('\n')}\n}`))
})
