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

const [file, dir, argsOverlayRaw] = process.argv.slice(2)
if (!file || !dir) {
  process.stderr.write('usage: node dry-run-runner.mjs <script-file> <sandbox-dir> [args-overlay-json]\n')
  process.exit(2)
}
// Optional third arg: a JSON object merged over the base args (e.g. '{"gateOnly":true}') so the
// harness can smoke a workflow's argument-gated branch (the gateOnly path) under the exact
// runtime poison stubs. A malformed overlay is a usage error (exit 2) — never a silent no-op.
let argsOverlay = {}
if (argsOverlayRaw) {
  try { argsOverlay = JSON.parse(argsOverlayRaw) } catch (e) {
    process.stderr.write(`dry-run-runner: malformed args overlay JSON: ${e.message}\n`)
    process.exit(2)
  }
}

function makeStubs(sandbox) {
  return {
    args: { kilnDir: join(sandbox, '.kiln'), projectPath: sandbox, codexAvailable: false, testingRigor: 'standard', ...argsOverlay },
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
    // Determinism poison — mirrors the Workflow runtime's guard (plain node
    // allows Date.now/Math.random, so the smoke test passed scripts the real runtime rejects).
    // Shadowed via the same parameter mechanism as the other globals: Date.now(), Math.random(),
    // and argless `new Date()` throw exactly like the engine; new Date(value) stays legal.
    Date: new Proxy(Date, {
      construct(target, dateArgs) {
        if (dateArgs.length === 0) throw new Error('new Date() is unavailable in workflow scripts (breaks resume)')
        return new target(...dateArgs)
      },
      get(target, prop) {
        if (prop === 'now') return () => { throw new Error('Date.now() is unavailable in workflow scripts (breaks resume)') }
        const v = target[prop]
        return typeof v === 'function' ? v.bind(target) : v
      },
    }),
    Math: Object.freeze(Object.assign(Object.create(Math), {
      random: () => { throw new Error('Math.random() is unavailable in workflow scripts (breaks resume)') },
    })),
    // Host-global poison — mirrors the Workflow runtime's ACTUAL surface (the runtime has no
    // `process`, so validate.js's bare process.env read crashed at module scope while
    // the plain-node smoke sailed through). setTimeout/clearTimeout
    // and console EXIST in the runtime (so they stay native here); everything below is undefined
    // there and is therefore shadowed to undefined here — a script touching one fails the smoke
    // exactly as it would fail the engine. typeof-guards (the sanctioned escape-hatch pattern)
    // behave identically under this shadowing.
    process: undefined,
    Buffer: undefined,
    fetch: undefined,
    URL: undefined,
    setInterval: undefined,
    queueMicrotask: undefined,
    structuredClone: undefined,
    setImmediate: undefined,
    AbortController: undefined,
    atob: undefined,
    TextEncoder: undefined,
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
