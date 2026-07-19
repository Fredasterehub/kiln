// dry-run.test.mjs — child-process smoke test for the shipped workflow script (tests/v3 harness).
// `node --check` only proves syntax: a name mismatch (helper renamed in the pure core but the call
// site not) survives it and only explodes at runtime inside Claude Code's Workflow engine. This
// test actually EXECUTES the shipped workflows/kernel.js by spawning dry-run-runner.mjs —
// strip/wrap/stub semantics live in the runner (see its header). With valid args supplied, ANY
// exception escaping the workflow — any class — fails the smoke test; a clean resolve is the only
// pass. Each child runs under a HARD deadline: spawnSync's timeout delivers SIGKILL, which no
// microtask-starvation loop can outrun (an in-process Promise.race timer would never fire — timers
// are macrotasks and a `while (true) await Promise.resolve()` loop never drains past the microtask
// queue). The detector-proof test injects an undefined identifier into a copy of kernel.js, shows
// node --check still passes it, and asserts the dry-run flags it; the timeout-proof test feeds the
// harness exactly that starvation loop and asserts the child is killed and reported as a TIMEOUT
// failure.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const PLUGIN = join(root, 'plugins/kiln')
const WORKFLOWS = join(PLUGIN, 'workflows')
const RUNNER = fileURLToPath(new URL('./dry-run-runner.mjs', import.meta.url))
const files = readdirSync(WORKFLOWS).filter((f) => f.endsWith('.js')).sort()

const TIMEOUT_MS = 10_000

// dryRun — spawn the child runner on one script with a hard wall-clock deadline. spawnSync kills
// the child with SIGKILL at the deadline, unconditionally. Returns { timedOut, status, failure }:
// timedOut when the kill fired, failure as the runner's {name, message} JSON when an exception
// escaped (raw output as a fallback when the child died without reporting).
function dryRun(file, dir, timeoutMs = TIMEOUT_MS, argsOverlay = null) {
  const argv = argsOverlay ? [RUNNER, file, dir, JSON.stringify(argsOverlay)] : [RUNNER, file, dir]
  const res = spawnSync(process.execPath, argv, {
    encoding: 'utf8',
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
  })
  const timedOut = (res.error && res.error.code === 'ETIMEDOUT') || res.signal === 'SIGKILL'
  let failure = null
  if (!timedOut && res.status !== 0) {
    try {
      failure = JSON.parse(res.stdout.trim().split('\n').pop())
    } catch {
      failure = { name: 'unknown', message: (res.stderr || res.stdout || '').trim() }
    }
  }
  return { timedOut, status: res.status, failure }
}

const inSandbox = async (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-dry-run-'))
  mkdirSync(join(dir, '.kiln'), { recursive: true })
  try { return await fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('the harness sees exactly one shipped workflow — the hand-authored kernel', () => {
  assert.deepEqual(files, ['kernel.js'])
})

test('dry-run: kernel.js executes with valid kernel args — no exception escapes', async () => {
  await inSandbox(async (dir) => {
    // The real launch shape: stage + projectDir + idea + the ABSOLUTE plugin root. Past the arg
    // gate the kernel runs its boot leg under the poison stubs (agent resolves null → the tier
    // read fails closed) — the whole path must resolve cleanly, never throw.
    const r = dryRun(join(WORKFLOWS, 'kernel.js'), dir, TIMEOUT_MS,
      { stage: 'law', projectDir: dir, idea: 'smoke', plugin: PLUGIN })
    assert.ok(!r.timedOut, `kernel.js: TIMEOUT — child killed at the ${TIMEOUT_MS}ms deadline`)
    assert.equal(r.status, 0,
      `kernel.js: ${r.failure && r.failure.name}: ${r.failure && r.failure.message} — with valid args, any escaping exception is a failure`)
  })
})

test('dry-run: kernel.js tolerates conductor-contract violations without throwing — bad args resolve to an honest return, never an exception', async () => {
  await inSandbox(async (dir) => {
    // No stage/idea/plugin at all: the kernel must take its bad-args/needs-brainstorm returns
    // cleanly. A throw here would crash the live engine on the exact malformed-launch class the
    // parse-and-hop + absolute-or-halt guards exist for.
    const r = dryRun(join(WORKFLOWS, 'kernel.js'), dir)
    assert.ok(!r.timedOut, `kernel.js (bare args): TIMEOUT — child killed at the ${TIMEOUT_MS}ms deadline`)
    assert.equal(r.status, 0,
      `kernel.js (bare args): ${r.failure && r.failure.name}: ${r.failure && r.failure.message} — contract violations return honestly, never throw`)
  })
})

test('detector proof: an undefined identifier passes node --check but the dry-run flags it', async () => {
  await inSandbox(async (dir) => {
    // The exact bug class this test exists for: rename a helper at its call site only. Still
    // perfectly valid syntax; fatal the moment the script runs.
    const original = readFileSync(join(WORKFLOWS, 'kernel.js'), 'utf8')
    const sabotaged = original.replace(/^const parsed = parseArgs\(args\)$/m, 'const parsed = parseArgsRenamed(args)')
    assert.notEqual(sabotaged, original, 'injection target line not found in kernel.js')
    const probeFile = join(dir, 'kernel-sabotaged.js')
    writeFileSync(probeFile, sabotaged)
    const check = spawnSync(process.execPath, ['--check', probeFile], { encoding: 'utf8' })
    assert.equal(check.status, 0, `node --check should be blind to the name mismatch: ${check.stderr}`)
    const r = dryRun(probeFile, dir)
    assert.ok(!r.timedOut, 'the sabotaged script must fail, not hang')
    assert.equal(r.failure && r.failure.name, 'ReferenceError',
      `the dry-run must surface the injected ReferenceError, got: ${JSON.stringify(r.failure)}`)
    assert.match((r.failure && r.failure.message) || '', /parseArgsRenamed/)
  })
})

test('timeout proof: an infinite async microtask loop is killed and reported as a TIMEOUT failure', async () => {
  await inSandbox(async (dir) => {
    // The exact hang class the child-process runner exists for: awaiting an already-resolved
    // promise forever never yields to the timer queue, so no in-process deadline could fire.
    // Only the parent's SIGKILL ends it.
    const fixture = [
      "export const meta = { name: 'kiln-microtask-spin' }",
      'while (true) await Promise.resolve()',
    ].join('\n')
    const probeFile = join(dir, 'microtask-loop.js')
    writeFileSync(probeFile, fixture)
    const r = dryRun(probeFile, dir, 2_000)
    assert.ok(r.timedOut, 'the harness must kill the spinning child at the deadline and report a TIMEOUT failure')
  })
})

test('determinism-poison proof: Date.now() / Math.random() / argless new Date() fail the dry-run exactly like the Workflow runtime', async () => {
  await inSandbox(async (dir) => {
    // The exact blind spot the live dogfood hit: plain node allows Date.now, the runtime forbids
    // it — a workflow crashed in 27ms in the real engine after a green smoke. Each violation class
    // must now fail in the harness too.
    const cases = [
      ['date-now.js', 'const t = Date.now()', /Date\.now\(\) is unavailable/],
      ['math-random.js', 'const r = Math.random()', /Math\.random\(\) is unavailable/],
      ['new-date.js', 'const d = new Date()', /new Date\(\) is unavailable/],
    ]
    for (const [name, line, re] of cases) {
      const fixture = [`export const meta = { name: 'kiln-poison-${name}' }`, line].join('\n')
      const probeFile = join(dir, name)
      writeFileSync(probeFile, fixture)
      const r = dryRun(probeFile, dir)
      assert.ok(!r.timedOut, `${name}: must fail fast, not hang`)
      assert.ok(r.failure, `${name}: the poisoned global must surface a failure`)
      assert.match((r.failure && r.failure.message) || '', re, `${name}: wrong failure: ${JSON.stringify(r.failure)}`)
    }
    // and the legal form stays legal: new Date(value) must NOT trip the poison
    const legal = ["export const meta = { name: 'kiln-legal-date' }", "const d = new Date('2026-06-11T00:00:00Z'); if (d.getUTCFullYear() !== 2026) throw new Error('bad date')"].join('\n')
    const legalFile = join(dir, 'legal-date.js')
    writeFileSync(legalFile, legal)
    const ok = dryRun(legalFile, dir)
    assert.ok(!ok.failure && !ok.timedOut, `new Date(value) must remain legal, got: ${JSON.stringify(ok.failure)}`)
  })
})
