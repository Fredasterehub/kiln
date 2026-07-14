// report-workflow.test.mjs — C1: report.js's FIRST ledger legs. The GENERATED workflows/report.js is
// run exactly as the runtime evaluates it (leading `export ` stripped off `export const meta`, the body
// becomes an AsyncFunction whose parameters are the workflow globals, stubs passed positionally). The
// `agent` mock keys off the call `label` and captures every kiln-state append the Thoth ledger leg
// receives. Asserts: the stage brackets (stage_started at entry; stage_completed ONLY on a written
// REPORT.md, existence-verified), the pen_up + signed lore beats, and that a MISSING REPORT.md emits
// NEITHER stage_completed NOR the signed beat (the telegraph's failed-stages-emit-nothing rule).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const WORKFLOW = fileURLToPath(new URL('../../plugins/kiln/workflows/report.js', import.meta.url))
const AsyncFunction = (async () => {}).constructor
const wfBody = readFileSync(WORKFLOW, 'utf8').replace(/^export const meta\b/m, 'const meta')

// eventOf — parse the kiln-state event JSON embedded (single-quoted, shell-escaped) in a ledger cmd.
const eventOf = (cmd) => JSON.parse(cmd.slice(cmd.indexOf("'") + 1, cmd.lastIndexOf("'")).replace(/'\\''/g, "'"))

async function runReport(args, respond) {
  const ledgerCmds = []
  const agent = async (prompt, opts) => {
    const label = (opts && opts.label) || ''
    if (label === 'thoth:ledger') {
      const m = prompt.match(/```\n([\s\S]*?)\n```/)
      if (m) ledgerCmds.push(m[1])
      return { ok: true }
    }
    return respond(label, prompt)
  }
  const stubs = {
    args, phase: () => {}, log: () => {}, agent,
    parallel: async (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null))),
    pipeline: async () => [], budget: undefined, workflow: async () => null,
  }
  const keys = Object.keys(stubs)
  const run = new AsyncFunction(...keys, wfBody)
  const result = await run(...keys.map((k) => stubs[k]))
  return { result, ledgerCmds }
}

const baseArgs = { kilnDir: '/tmp/rep-x/.kiln', projectPath: '/tmp/rep-x', pluginRoot: '/plug' }
const omegaOk = { report_file: '/tmp/rep-x/.kiln/REPORT.md', headline: 'It shipped.', delivered: ['the app'], outstanding: [] }

test('report.js success: stage_started at entry, pen_up + signed beats, stage_completed on a written REPORT.md', async () => {
  const { ledgerCmds } = await runReport(baseArgs, (label) => {
    if (label === 'omega:report') return omegaOk
    if (label === 'thoth:verify') return { exists: true }
    return null
  })
  const evs = ledgerCmds.map(eventOf)
  const lifecycle = evs.filter((e) => e.type !== 'note')
  assert.deepEqual(lifecycle.map((e) => e.type), ['stage_started', 'stage_completed'], 'the run is bracketed start → complete')
  for (const e of evs) assert.equal(e.stage, 'report', 'every event carries stage:report (drives the projection fold)')
  const keys = evs.filter((e) => e.type === 'note').map((e) => e.data.key)
  assert.ok(keys.includes('report.pen_up'), 'report.pen_up opens the stage')
  assert.ok(keys.includes('report.signed'), 'report.signed rides on a written report')
  // the signed keystone precedes the terminating stage_completed (telegraph ordering)
  const signedIdx = evs.findIndex((e) => e.type === 'note' && e.data.key === 'report.signed')
  const doneIdx = evs.findIndex((e) => e.type === 'stage_completed')
  assert.ok(signedIdx > -1 && signedIdx < doneIdx, 'report.signed precedes stage_completed')
})

test('report.js missing artifact: REPORT.md absent → stage_started but NO stage_completed and NO signed beat', async () => {
  const { ledgerCmds } = await runReport(baseArgs, (label) => {
    if (label === 'omega:report') return omegaOk
    if (label === 'thoth:verify') return { exists: false }
    return null
  })
  const evs = ledgerCmds.map(eventOf)
  assert.equal(evs.filter((e) => e.type === 'stage_started').length, 1, 'the stage WAS entered')
  assert.equal(evs.filter((e) => e.type === 'stage_completed').length, 0, 'a missing artifact never completes the stage')
  const keys = evs.filter((e) => e.type === 'note').map((e) => e.data.key)
  assert.ok(keys.includes('report.pen_up'), 'pen_up still fired at entry')
  assert.ok(!keys.includes('report.signed'), 'no signed beat when REPORT.md is missing')
})

test('report.js pluginRoot absent: brackets + beats degrade to log lines — no kiln-state append attempted', async () => {
  const { ledgerCmds } = await runReport({ ...baseArgs, pluginRoot: undefined }, (label) => {
    if (label === 'omega:report') return omegaOk
    if (label === 'thoth:verify') return { exists: true }
    return null
  })
  assert.equal(ledgerCmds.length, 0, 'no pluginRoot ⇒ no kiln-state append (presentation null-keep, degrade to log)')
})
