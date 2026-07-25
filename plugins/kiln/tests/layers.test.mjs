import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

// The CLI is layered: an entry that dispatches, and five modules beneath it. The direction is
// enforced as an ALLOWED-EDGE table rather than as mere acyclicity, because a cycle-only check
// accepts a graph that is acyclic in the WRONG direction — core reaching up into gate inverts the
// layering the split exists to create while adding no cycle at all. Acyclicity is then proven
// separately rather than inferred from the table, so that editing the table cannot reintroduce one.
const ALLOWED = {
  entry: ['core', 'authority', 'attestation', 'gate', 'run'],
  gate: ['authority', 'attestation', 'run', 'core'],
  attestation: ['authority', 'run', 'core'],
  authority: ['core'],
  run: ['core'],
  core: [],
}

const moduleName = (file) => (basename(file) === 'kiln-review' ? 'entry' : basename(file).replace(/\.js$/, ''))

function checkLayers(root) {
  const libDir = join(root, 'lib')
  const files = [join(root, 'kiln-review')]
  if (existsSync(libDir)) for (const f of readdirSync(libDir).filter((x) => x.endsWith('.js'))) files.push(join(libDir, f))

  const edges = []
  const violations = []
  for (const file of files) {
    const from = moduleName(file)
    // Only INTERNAL requires are layer edges; node: builtins and bare specifiers are not. BOTH quote
    // forms count: a matcher bound to the quote the source happens to use enforces a spelling rather
    // than the direction, and the edge it misses is an edge nobody is stopped from writing.
    for (const m of readFileSync(file, 'utf8').matchAll(/require\(\s*(['"])(\.[^'"]*)\1\s*\)/g)) {
      const to = moduleName(m[2])
      if (to === from) continue
      edges.push([from, to])
      if (!ALLOWED[from]) violations.push(`${from} is not a known layer (requires ${m[2]})`)
      else if (!ALLOWED[from].includes(to)) violations.push(`${from} -> ${to} is outside the ruled direction`)
    }
  }

  const graph = new Map()
  for (const [from, to] of edges) graph.set(from, [...(graph.get(from) || []), to])
  const state = new Map()
  const stack = []
  const visit = (n) => {
    if (state.get(n) === 'done') return
    if (state.get(n) === 'open') return void violations.push(`CYCLE: ${[...stack.slice(stack.indexOf(n)), n].join(' -> ')}`)
    state.set(n, 'open')
    stack.push(n)
    for (const d of graph.get(n) || []) visit(d)
    stack.pop()
    state.set(n, 'done')
  }
  for (const n of graph.keys()) visit(n)
  return { files, edges, violations }
}

const fixture = (modules) => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-layers-'))
  mkdirSync(join(dir, 'lib'))
  writeFileSync(join(dir, 'kiln-review'), modules.entry || '')
  for (const [name, body] of Object.entries(modules)) {
    if (name !== 'entry') writeFileSync(join(dir, 'lib', `${name}.js`), body)
  }
  return dir
}

test('layers: the shipped CLI holds the ruled direction and is acyclic', () => {
  const root = fileURLToPath(new URL('../scripts', import.meta.url))
  const { files, edges, violations } = checkLayers(root)
  assert.deepEqual(violations, [], 'every internal require sits inside the ruled direction')
  assert.equal(files.length, 6, 'the entry and its five modules — a sixth module is a boundary the ruling did not draw')
  assert.ok(edges.length >= 10, `the layers really do depend on each other (${edges.length} internal edges)`)
})

test('layers: the modules are importable, never executable entrypoints', () => {
  const libDir = fileURLToPath(new URL('../scripts/lib', import.meta.url))
  for (const f of readdirSync(libDir)) {
    const src = readFileSync(join(libDir, f), 'utf8')
    assert.ok(!src.startsWith('#!'), `${f} carries no shebang`)
    assert.equal(statSync(join(libDir, f)).mode & 0o111, 0, `${f} is not executable`)
    assert.ok(src.includes('module.exports = {'), `${f} exports rather than runs`)
  }
})

test('layers: a cycle is named', () => {
  const dir = fixture({
    entry: `require('./lib/core.js')\n`,
    core: `require('./run.js')\n`,
    run: `require('./core.js')\n`,
  })
  const { violations } = checkLayers(dir)
  assert.ok(violations.some((v) => v.startsWith('CYCLE:')), `a cycle is reported: ${JSON.stringify(violations)}`)
})

// The discrimination that proves this is a DIRECTION check and not a cycle check wearing its name:
// core requiring gate is perfectly acyclic, and it is exactly the inversion the split forbids.
test('layers: an acyclic edge in the wrong direction is still named', () => {
  const dir = fixture({
    entry: `require('./lib/core.js')\n`,
    core: `require('./gate.js')\n`,
    gate: `const x = 1\n`,
  })
  const { violations } = checkLayers(dir)
  assert.ok(!violations.some((v) => v.startsWith('CYCLE:')), 'the graph really is acyclic, so a cycle check would pass it')
  assert.deepEqual(violations, ['core -> gate is outside the ruled direction'])
})

// Wave-QA W2QA-B1: the four fixtures above are all written in the source's own quote style, so they
// ranged over the spelling rather than the answer space, and this exact edge — the authority -> run
// inversion the split's record names as its discriminating case — passed the check unseen when it was
// spelled with the other quote. The counterexample is the fixture now.
test('layers: an out-of-table edge is caught in either quote form', () => {
  for (const q of ["'", '"']) {
    const dir = fixture({
      entry: `require('./lib/authority.js')\n`,
      authority: `require('./core.js')\nconst { LOCK_FILE } = require(${q}./run.js${q})\n`,
      run: `require('./core.js')\n`,
      core: `const x = 1\n`,
    })
    const { edges, violations } = checkLayers(dir)
    assert.ok(edges.some(([f, t]) => f === 'authority' && t === 'run'), `the ${q}-quoted require is an edge at all`)
    assert.deepEqual(violations, ['authority -> run is outside the ruled direction'])
  }
})

test('layers: a graph inside the table passes, and node: builtins are not edges', () => {
  const dir = fixture({
    entry: `require('node:fs')\nrequire('./lib/gate.js')\n`,
    gate: `require('./attestation.js')\nrequire('./core.js')\n`,
    attestation: `require('./run.js')\n`,
    run: `require('./core.js')\n`,
    core: `require('node:path')\n`,
  })
  const { edges, violations } = checkLayers(dir)
  assert.deepEqual(violations, [])
  assert.equal(edges.length, 5, 'the two node: requires are not counted as layer edges')
})
