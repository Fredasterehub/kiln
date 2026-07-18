// mapping-workflow.test.mjs — C1: mapping.js's FIRST ledger legs. The GENERATED workflows/mapping.js
// is run exactly as the runtime evaluates it (leading `export ` stripped, body → AsyncFunction, stubs
// positional). The `agent` mock keys off the call `label` and captures every kiln-state append. The
// three scouts run through the `parallel` stub. Asserts: the stage brackets (stage_started at entry;
// stage_completed ONLY when codebase-map.md is on disk), the scouts_out / scouts_back / map_drawn lore
// beats, and that a MISSING map emits NEITHER stage_completed NOR the map_drawn beat.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const WORKFLOW = fileURLToPath(new URL('../../plugins/kiln/workflows/mapping.js', import.meta.url))
const AsyncFunction = (async () => {}).constructor
const wfBody = readFileSync(WORKFLOW, 'utf8').replace(/^export const meta\b/m, 'const meta')

const eventOf = (cmd) => JSON.parse(cmd.slice(cmd.indexOf("'") + 1, cmd.lastIndexOf("'")).replace(/'\\''/g, "'"))

async function runMapping(args, respond) {
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

const baseArgs = { projectPath: '/tmp/map-x', kilnDir: '/tmp/map-x/.kiln', pluginRoot: '/plug' }
const scout = (lens) => ({ lens, highlights: ['h'], findings_md: '# ' + lens })
const mapOk = { map_file: '/tmp/map-x/.kiln/docs/codebase-map.md', stack: ['node', 'esm'], entry_points: ['index.js'], key_risks: [], summary: 's' }

const respondBase = (label) => {
  if (label === 'maiev:anatomy') return scout('anatomy')
  if (label === 'curie:health') return scout('health')
  if (label === 'medivh:flow') return scout('flow')
  if (label === 'mnemosyne:synthesis') return mapOk
  return null
}

test('mapping.js success: stage_started at entry, scouts_out/scouts_back/map_drawn beats, stage_completed on a written map', async () => {
  const { ledgerCmds } = await runMapping(baseArgs, (label) => {
    if (label === 'thoth:verify') return { missing: [] }
    return respondBase(label)
  })
  const evs = ledgerCmds.map(eventOf)
  const lifecycle = evs.filter((e) => e.type !== 'note')
  assert.deepEqual(lifecycle.map((e) => e.type), ['stage_started', 'stage_completed'], 'the run is bracketed start → complete')
  for (const e of evs) assert.equal(e.stage, 'mapping', 'every event carries stage:mapping (recorded verbatim by the reducer; off-table, so no STAGE_ORDER bump follows)')
  const keys = evs.filter((e) => e.type === 'note').map((e) => e.data.key)
  assert.ok(keys.includes('mapping.scouts_out'), 'scouts_out opens the recon')
  assert.ok(keys.includes('mapping.scouts_back'), 'scouts_back on the party return')
  assert.ok(keys.includes('mapping.map_drawn'), 'map_drawn on a verified map')
  // the map_drawn keystone precedes the terminating stage_completed (telegraph ordering)
  const drawnIdx = evs.findIndex((e) => e.type === 'note' && e.data.key === 'mapping.map_drawn')
  const doneIdx = evs.findIndex((e) => e.type === 'stage_completed')
  assert.ok(drawnIdx > -1 && drawnIdx < doneIdx, 'map_drawn precedes stage_completed')
})

test('mapping.js missing artifact: map absent → stage_started but NO stage_completed and NO map_drawn beat', async () => {
  const { ledgerCmds } = await runMapping(baseArgs, (label) => {
    if (label === 'thoth:verify') return { missing: ['/tmp/map-x/.kiln/docs/codebase-map.md'] }
    return respondBase(label)
  })
  const evs = ledgerCmds.map(eventOf)
  assert.equal(evs.filter((e) => e.type === 'stage_started').length, 1, 'the stage WAS entered')
  assert.equal(evs.filter((e) => e.type === 'stage_completed').length, 0, 'a missing map never completes the stage')
  const keys = evs.filter((e) => e.type === 'note').map((e) => e.data.key)
  assert.ok(keys.includes('mapping.scouts_out'), 'scouts_out still fired at entry')
  assert.ok(!keys.includes('mapping.map_drawn'), 'no map_drawn beat when the map is missing')
})

test('mapping.js mute verifier (F-2): a null existence report is NOT verification → stage_started only, NO stage_completed, NO map_drawn', async () => {
  const { result, ledgerCmds } = await runMapping(baseArgs, (label) => {
    if (label === 'thoth:verify') return null // the verifier went mute — no {missing:[...]} verdict
    return respondBase(label)
  })
  const evs = ledgerCmds.map(eventOf)
  assert.equal(evs.filter((e) => e.type === 'stage_started').length, 1, 'the stage WAS entered')
  assert.equal(evs.filter((e) => e.type === 'stage_completed').length, 0, 'a mute verifier is not proof of a written map — the completion is withheld')
  const keys = evs.filter((e) => e.type === 'note').map((e) => e.data.key)
  assert.ok(keys.includes('mapping.scouts_out'), 'scouts_out still fired at entry')
  assert.ok(!keys.includes('mapping.map_drawn'), 'no map_drawn beat when the map is unverified')
  // the return stays honest: a mute verifier fabricates no missing list
  assert.deepEqual(result.missing, [], 'a mute verifier returns missing:[] — the withheld completion is the honesty signal')
})

test('mapping.js pluginRoot absent: brackets + beats degrade to log lines — no kiln-state append attempted', async () => {
  const { ledgerCmds } = await runMapping({ ...baseArgs, pluginRoot: undefined }, (label) => {
    if (label === 'thoth:verify') return { missing: [] }
    return respondBase(label)
  })
  assert.equal(ledgerCmds.length, 0, 'no pluginRoot ⇒ no kiln-state append (presentation null-keep, degrade to log)')
})
