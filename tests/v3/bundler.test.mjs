// bundler.test.mjs — golden test for scripts/bundle-workflows.mjs (BLUEPRINT §13).
// The bundler resolves its tree from its own file location (dirname/..), so each test clones it
// into a throwaway sandbox mirroring the repo layout — scripts/ + plugins/kiln/{src,workflows-src,
// workflows} — and drives it there. One test runs --check against the REAL repo so the harness
// itself proves every shipped workflow is in sync with its source.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const BUNDLER = join(root, 'scripts/bundle-workflows.mjs')

// ── Fixtures: a two-export src module, a marker-bearing workflow source, the expected output. ──
// demo.mjs exercises the block-parser edges: a const block whose trailing blank + comment lines
// must be trimmed, then a multi-line function block running to EOF.
const FIXTURE_SRC = `// demo.mjs — fixture module for the bundler golden test.

export const GREETING = 'bonjour'

// greet — fixture function; the comment above belongs to it, not to GREETING.
export function greet(name) {
  return GREETING + ' ' + name
}
`

const FIXTURE_WF = `// golden.js — fixture workflow source.
// @inline:demo:GREETING,greet
return greet('kiln')
`

const GOLDEN = `// GENERATED from workflows-src/golden.js — edit the source, run scripts/bundle-workflows.mjs
// golden.js — fixture workflow source.
const GREETING = 'bonjour'
function greet(name) {
  return GREETING + ' ' + name
}
return greet('kiln')
`

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-bundler-test-'))
  mkdirSync(join(dir, 'scripts'))
  mkdirSync(join(dir, 'plugins/kiln/src'), { recursive: true })
  mkdirSync(join(dir, 'plugins/kiln/workflows-src'), { recursive: true })
  mkdirSync(join(dir, 'plugins/kiln/workflows'), { recursive: true })
  copyFileSync(BUNDLER, join(dir, 'scripts/bundle-workflows.mjs'))
  writeFileSync(join(dir, 'plugins/kiln/src/demo.mjs'), FIXTURE_SRC)
  writeFileSync(join(dir, 'plugins/kiln/workflows-src/golden.js'), FIXTURE_WF)
  return dir
}

const runBundler = (dir, ...args) =>
  spawnSync(process.execPath, [join(dir, 'scripts/bundle-workflows.mjs'), ...args], { encoding: 'utf8' })
const outFile = (dir) => join(dir, 'plugins/kiln/workflows/golden.js')

test('golden: markers are replaced with the exact export declarations under the GENERATED header', () => {
  const dir = sandbox()
  try {
    const res = runBundler(dir)
    assert.equal(res.status, 0, res.stderr)
    assert.equal(readFileSync(outFile(dir), 'utf8'), GOLDEN)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('emitted file passes node --check (top-level return is legal in a .js workflow body)', () => {
  const dir = sandbox()
  try {
    assert.equal(runBundler(dir).status, 0)
    const check = spawnSync(process.execPath, ['--check', outFile(dir)], { encoding: 'utf8' })
    assert.equal(check.status, 0, check.stderr)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('deterministic + idempotent: --check is green after bundling; a corrupted output regenerates byte-identical', () => {
  const dir = sandbox()
  try {
    assert.equal(runBundler(dir).status, 0)
    assert.equal(runBundler(dir, '--check').status, 0)
    // corrupt one line, regenerate: same input → byte-identical output
    writeFileSync(outFile(dir), readFileSync(outFile(dir), 'utf8').replace("'bonjour'", "'sabotage'"))
    assert.equal(runBundler(dir).status, 0)
    assert.equal(readFileSync(outFile(dir), 'utf8'), GOLDEN)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('--check fails non-zero on a one-line corruption of a generated workflow, naming the file', () => {
  const dir = sandbox()
  try {
    assert.equal(runBundler(dir).status, 0)
    writeFileSync(outFile(dir), readFileSync(outFile(dir), 'utf8').replace("'bonjour'", "'sabotage'"))
    const res = runBundler(dir, '--check')
    assert.notEqual(res.status, 0)
    assert.match(res.stderr, /OUT OF SYNC/)
    assert.match(res.stderr, /golden\.js/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('--check fails non-zero when a generated file is missing entirely', () => {
  const dir = sandbox()
  try {
    const res = runBundler(dir, '--check')
    assert.notEqual(res.status, 0)
    assert.match(res.stderr, /golden\.js/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a marker naming an unknown module or export exits non-zero with the offender named', () => {
  const dir = sandbox()
  try {
    writeFileSync(join(dir, 'plugins/kiln/workflows-src/bad-module.js'), '// @inline:nope:thing\n')
    let res = runBundler(dir)
    assert.notEqual(res.status, 0)
    assert.match(res.stderr, /unknown module 'nope'/)
    rmSync(join(dir, 'plugins/kiln/workflows-src/bad-module.js'))
    writeFileSync(join(dir, 'plugins/kiln/workflows-src/bad-export.js'), '// @inline:demo:missingThing\n')
    res = runBundler(dir)
    assert.notEqual(res.status, 0)
    assert.match(res.stderr, /no export 'missingThing'/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ── The duo-pool step (defect fix 10): `// @duo-pool` regenerates DUO_POOL from the JSON. ──
const FIXTURE_DUO_JSON = JSON.stringify({
  pools: {
    default: [{ builder: { name: 'a' }, reviewer: { name: 'b' } }, { builder: { name: 'c' }, reviewer: { name: 'd' } }],
    ui: [{ builder: { name: 'e' }, reviewer: { name: 'f' } }],
  },
})

const FIXTURE_DUO_WF = `// duo.js — fixture workflow exercising the duo-pool step.
// @duo-pool
return DUO_POOL
`

const DUO_GOLDEN = `// GENERATED from workflows-src/duo.js — edit the source, run scripts/bundle-workflows.mjs
// duo.js — fixture workflow exercising the duo-pool step.
const DUO_POOL = {
  default: [['a', 'b'], ['c', 'd']],
  ui: [['e', 'f']],
}
return DUO_POOL
`

function withDuo(dir) {
  mkdirSync(join(dir, 'plugins/kiln/data'), { recursive: true })
  writeFileSync(join(dir, 'plugins/kiln/data/duo-pool.json'), FIXTURE_DUO_JSON)
  writeFileSync(join(dir, 'plugins/kiln/workflows-src/duo.js'), FIXTURE_DUO_WF)
}

test('duo-pool step: the @duo-pool marker emits a DUO_POOL const derived from data/duo-pool.json', () => {
  const dir = sandbox()
  try {
    withDuo(dir)
    const res = runBundler(dir)
    assert.equal(res.status, 0, res.stderr)
    assert.equal(readFileSync(join(dir, 'plugins/kiln/workflows/duo.js'), 'utf8'), DUO_GOLDEN)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('duo-pool step: --check fails when data/duo-pool.json drifts from the generated DUO_POOL', () => {
  const dir = sandbox()
  try {
    withDuo(dir)
    assert.equal(runBundler(dir).status, 0)
    assert.equal(runBundler(dir, '--check').status, 0)
    writeFileSync(join(dir, 'plugins/kiln/data/duo-pool.json'), FIXTURE_DUO_JSON.replace('"a"', '"renamed"'))
    const res = runBundler(dir, '--check')
    assert.notEqual(res.status, 0)
    assert.match(res.stderr, /OUT OF SYNC/)
    assert.match(res.stderr, /duo\.js/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ── The gauge-config step (T2): `// @gauge-config` regenerates GAUGE_CONFIG from gauge-config.json,
//    stripping the _doc/_doc_* commentary keys. Same drift discipline as duo-pool. ──
const FIXTURE_GAUGE_JSON = JSON.stringify({
  _doc: 'top-level commentary — must be stripped',
  h80_human_hours: 2,
  _doc_h80_human_hours: 'commentary for the above — must be stripped',
  effort_bias_dims: ['D3', 'D4', 'D8'],
})

const FIXTURE_GAUGE_WF = `// gtest.js — fixture workflow exercising the gauge-config step.
// @gauge-config
return GAUGE_CONFIG
`

const GAUGE_GOLDEN = `// GENERATED from workflows-src/gtest.js — edit the source, run scripts/bundle-workflows.mjs
// gtest.js — fixture workflow exercising the gauge-config step.
const GAUGE_CONFIG = {"h80_human_hours":2,"effort_bias_dims":["D3","D4","D8"]}
return GAUGE_CONFIG
`

function withGauge(dir) {
  writeFileSync(join(dir, 'plugins/kiln/gauge-config.json'), FIXTURE_GAUGE_JSON)
  writeFileSync(join(dir, 'plugins/kiln/workflows-src/gtest.js'), FIXTURE_GAUGE_WF)
}

test('gauge-config step: the @gauge-config marker emits a GAUGE_CONFIG const with the _doc keys stripped', () => {
  const dir = sandbox()
  try {
    withGauge(dir)
    const res = runBundler(dir)
    assert.equal(res.status, 0, res.stderr)
    assert.equal(readFileSync(join(dir, 'plugins/kiln/workflows/gtest.js'), 'utf8'), GAUGE_GOLDEN)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('gauge-config step: --check fails when gauge-config.json drifts from the generated GAUGE_CONFIG', () => {
  const dir = sandbox()
  try {
    withGauge(dir)
    assert.equal(runBundler(dir).status, 0)
    assert.equal(runBundler(dir, '--check').status, 0)
    writeFileSync(join(dir, 'plugins/kiln/gauge-config.json'), FIXTURE_GAUGE_JSON.replace('"h80_human_hours":2', '"h80_human_hours":3'))
    const res = runBundler(dir, '--check')
    assert.notEqual(res.status, 0)
    assert.match(res.stderr, /OUT OF SYNC/)
    assert.match(res.stderr, /gtest\.js/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('REAL repo: the shipped workflows are in sync with workflows-src', () => {
  const res = spawnSync(process.execPath, [BUNDLER, '--check'], { encoding: 'utf8' })
  assert.equal(res.status, 0, res.stderr)
})
