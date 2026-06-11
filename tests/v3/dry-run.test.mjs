// dry-run.test.mjs — child-process smoke test for the GENERATED workflow scripts (tests/v3 harness).
// `node --check` only proves syntax: a name mismatch (helper renamed in src/ but the call site not,
// a typo'd workflow global) survives it and only explodes at runtime inside Claude Code's Workflow
// engine. This test actually EXECUTES each shipped workflows/*.js by spawning dry-run-runner.mjs
// per script — strip/wrap/stub semantics live in the runner (see its header). With valid args
// supplied, ANY exception escaping the workflow — any class — fails the smoke test; a clean
// resolve is the only pass. Each child runs under a HARD deadline: spawnSync's timeout delivers
// SIGKILL, which no microtask-starvation loop can outrun (an in-process Promise.race timer would
// never fire — timers are macrotasks and a `while (true) await Promise.resolve()` loop never
// drains past the microtask queue). The detector-proof test injects an undefined identifier into
// a copy of a real workflow, shows node --check still passes it, and asserts the dry-run flags
// it; the timeout-proof test feeds the harness exactly that starvation loop and asserts the
// child is killed and reported as a TIMEOUT failure.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const WORKFLOWS = join(root, 'plugins/kiln/workflows')
const RUNNER = fileURLToPath(new URL('./dry-run-runner.mjs', import.meta.url))
const files = readdirSync(WORKFLOWS).filter((f) => f.endsWith('.js')).sort()

const TIMEOUT_MS = 10_000

// dryRun — spawn the child runner on one script with a hard wall-clock deadline. spawnSync kills
// the child with SIGKILL at the deadline, unconditionally. Returns { timedOut, status, failure }:
// timedOut when the kill fired, failure as the runner's {name, message} JSON when an exception
// escaped (raw output as a fallback when the child died without reporting).
function dryRun(file, dir, timeoutMs = TIMEOUT_MS) {
  const res = spawnSync(process.execPath, [RUNNER, file, dir], {
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

test('the harness sees all seven shipped workflows', () => {
  assert.deepEqual(files, ['architecture.js', 'build.js', 'gauge.js', 'mapping.js', 'report.js', 'research.js', 'validate.js'])
})

for (const file of files) {
  test(`dry-run: ${file} executes with valid args — no exception escapes`, async () => {
    await inSandbox(async (dir) => {
      const r = dryRun(join(WORKFLOWS, file), dir)
      assert.ok(!r.timedOut, `${file}: TIMEOUT — child killed at the ${TIMEOUT_MS}ms deadline`)
      assert.equal(r.status, 0,
        `${file}: ${r.failure && r.failure.name}: ${r.failure && r.failure.message} — with valid args, any escaping exception is a failure`)
    })
  })
}

test('detector proof: an undefined identifier passes node --check but the dry-run flags it', async () => {
  await inSandbox(async (dir) => {
    // The exact bug class this test exists for: rename a helper at its call site only. Still
    // perfectly valid syntax; fatal the moment the script runs.
    const original = readFileSync(join(WORKFLOWS, 'report.js'), 'utf8')
    const sabotaged = original.replace(/^const A = normalizeArgs\(args\)$/m, 'const A = normalizeArgsRenamed(args)')
    assert.notEqual(sabotaged, original, 'injection target line not found in report.js')
    const probeFile = join(dir, 'report-sabotaged.js')
    writeFileSync(probeFile, sabotaged)
    const check = spawnSync(process.execPath, ['--check', probeFile], { encoding: 'utf8' })
    assert.equal(check.status, 0, `node --check should be blind to the name mismatch: ${check.stderr}`)
    const r = dryRun(probeFile, dir)
    assert.ok(!r.timedOut, 'the sabotaged script must fail, not hang')
    assert.equal(r.failure && r.failure.name, 'ReferenceError',
      `the dry-run must surface the injected ReferenceError, got: ${JSON.stringify(r.failure)}`)
    assert.match((r.failure && r.failure.message) || '', /normalizeArgsRenamed/)
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
