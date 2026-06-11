// dry-run-runner.mjs — child-process executor for ONE generated workflow script (tests/v3 harness).
// Spawned by dry-run.test.mjs (`node dry-run-runner.mjs <script-file> <sandbox-dir>`), never by the
// test runner directly (no .test. in the name, and index.js does not import it). Running the script
// in a disposable child is what makes the harness timeout HARD: a microtask-starvation loop
// (`while (true) await Promise.resolve()`) never yields to timers, so no in-process deadline can
// fire — but the parent's spawnSync timeout + SIGKILL ends the child unconditionally.
//
// Execution mirrors the Workflow engine's shape: the leading `export ` is stripped off
// `export const meta`, the body becomes an AsyncFunction whose parameters are the workflow
// globals, and the stubs are passed as arguments. agent resolves null — every script must
// tolerate an absent result. budget stays undefined (build.js guards it with typeof). args is
// the plausible minimum every script accepts; extras are ignored. parallel/pipeline mirror the
// runtime's per-item fault isolation by mapping failures to null.
//
// Exit contract: 0 on a clean resolve; 1 with one JSON line `{"name":...,"message":...}` on
// stdout when any exception escapes. Errors are native-realm here, so .name is authoritative.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const [file, dir] = process.argv.slice(2)
if (!file || !dir) {
  process.stderr.write('usage: node dry-run-runner.mjs <script-file> <sandbox-dir>\n')
  process.exit(2)
}

function makeStubs(sandbox) {
  return {
    args: { kilnDir: join(sandbox, '.kiln'), projectPath: sandbox, codexAvailable: false, testingRigor: 'standard' },
    phase: () => {},
    log: () => {},
    agent: async () => null,
    parallel: async (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null))),
    pipeline: async (items, ...stages) => {
      const out = []
      for (const [i, it] of items.entries()) {
        let v = it
        for (const s of stages) {
          v = await Promise.resolve(s(v, it, i)).catch(() => null)
          if (v === null) break
        }
        out.push(v)
      }
      return out
    },
    budget: undefined,
    workflow: async () => null,
  }
}

const stubs = makeStubs(dir)
const GLOBALS = Object.keys(stubs)
const body = readFileSync(file, 'utf8').replace(/^export const meta\b/m, 'const meta')
const AsyncFunction = (async () => {}).constructor

try {
  const run = new AsyncFunction(...GLOBALS, body)
  await run(...GLOBALS.map((k) => stubs[k]))
} catch (e) {
  process.stdout.write(JSON.stringify({ name: (e && e.name) || 'unknown', message: (e && e.message) || String(e) }) + '\n')
  process.exit(1)
}
process.exit(0)
