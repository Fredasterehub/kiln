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
import { createHash } from 'node:crypto'
import { sha256Hex, canonicalJson } from '../../plugins/kiln/src/council.mjs'

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

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// ── (+): report at capability tier T4 — the signoff pair after the existence gate.
//    Omega still AUTHORS. Dual-APPROVE ⇒ signed_off:true + certificate AND ONLY THEN stage_completed;
//    ANY other outcome ⇒ signed_off:false + honest terminal + the UNSIGNED report returned + NO
//    stage_completed. Sub-T4 omits signed_off (never a false claim) and keeps the existence-gated
//    completion. Every Sol leg rides a receipt-attested envelope + an invocation-exact cross-check.
// ══════════════════════════════════════════════════════════════════════════════════════════════════
const CODEX_MODEL = 'gpt-5.6-sol'
const T4TOKEN = 'REP-RUNTOKEN-xyz'
const REPORT_FILE = '/tmp/rep-x/.kiln/REPORT.md'
const t4args = (extra = {}) => ({ ...baseArgs, codexAvailable: true, capabilityTier: 'T4', runToken: T4TOKEN, ...extra })
const shaB = (buf) => createHash('sha256').update(buf).digest('hex')
const oshaOf = (p) => shaB(Buffer.from(JSON.stringify(p)))
const rshaOf = (r) => shaB(Buffer.from(JSON.stringify(r)))
const SESSION = '019f5a46-fc83-7181-8303-f516494485ac', INV = '3'.repeat(64), PSHA = '1'.repeat(64), XSHA = '5'.repeat(64)
const validReceipt = (payload, over = {}) => ({
  receipt_version: 1, parser_version: 'kiln-codex-receipt/1', transport: 'codex_exec', invocation_id: INV,
  prompt_sha256: PSHA, packet_sha256: XSHA, cli_version: '0.144.1', requested_model: CODEX_MODEL,
  reported_model: CODEX_MODEL, session_id: SESSION, exit_code: 0, tokens_used: 18747,
  output_sha256: oshaOf(payload), stderr_sha256: XSHA, ...over,
})
const solEnv = (payload, rOver) => ({ payload, codex_receipt: validReceipt(payload, rOver || {}), raw_artifact_refs: { stderr: 's', output: 'o' } })
const crossOk = (payload, keystone, phaseTag, over = {}) => ({
  output_sha256_disk: over.disk !== undefined ? over.disk : oshaOf(payload),
  output_canonical_sha256: over.canon !== undefined ? over.canon : sha256Hex(canonicalJson(payload)),
  ledger: {
    verified: over.verified === null ? null : { status: 'verified', invocation_id: INV, receipt_sha256: rshaOf(validReceipt(payload)), output_sha256: oshaOf(payload), session_id: SESSION, reported_model: CODEX_MODEL, tokens_used: 18747, exit_code: 0, receipt_verified: true, ...(over.verified || {}) },
    reservation: over.reservation === null ? null : { invocation_id: INV, keystone, phase: phaseTag, seat: 'sol', attempt: 1, run_token: T4TOKEN, prompt_sha256: PSHA, packet_sha256: XSHA, ...(over.reservation || {}) },
  },
})
const rat = (h, over = {}) => ({ reasoning: 'r', artifact_hash: h, verdict: 'APPROVE', divergence_selections: [], findings: [], changed_evidence: [], ...over })
const SIGN_FINDING = { finding_id: 'RS-1', claim: 'delivered claims an app that was never built', required_change: 'move it to outstanding', evidence_refs: ['REPORT.md'], evidence_class: 'repo_state', executable_check: null }
const anchorFilesFromPrompt = (prompt) => { const m = prompt.match(/sha256sum ([^\n']+)/); const paths = m ? m[1].trim().split(/\s+/).filter(Boolean) : []; return paths.map((p) => ({ path: p, sha256: sha256Hex(p) })) }

function t4Respond(cfg = {}) {
  let sigHash = null
  return (label, prompt) => {
    if (label === 'omega:report') return cfg.omega !== undefined ? cfg.omega : omegaOk
    if (label === 'thoth:verify') return cfg.verify !== undefined ? cfg.verify : { exists: true }
    if (label === 'thoth:report-anchor') return cfg.anchor !== undefined ? cfg.anchor : { reasoning: 'a', files: anchorFilesFromPrompt(prompt) }
    if (label === 'fable:report-signoff') { const m = prompt.match(/artifact_hash = "([0-9a-f]{64})"/); if (m) sigHash = m[1]; return cfg.fableSig ? cfg.fableSig(sigHash) : rat(sigHash) }
    if (label === 'sol:report-signoff') { const m = prompt.match(/"artifact_hash":"([0-9a-f]{64})"/); if (m) sigHash = m[1]; if (cfg.solSig === 'dead') return {}; return cfg.solSig ? solEnv(cfg.solSig(sigHash)) : solEnv(rat(sigHash)) }
    if (label === 'thoth:receipt-check:sol:report-signoff') return crossOk(cfg.solSig && cfg.solSig !== 'dead' ? cfg.solSig(sigHash) : rat(sigHash), 'report_signoff', 'REPORT_RATIFY')
    return null
  }
}

test('report signoff: at T4 a written REPORT.md convenes the blind Fable/Sol signoff pair; dual-APPROVE ⇒ signed_off:true + a b43-report/1 certificate AND stage_completed', async () => {
  const { result, ledgerCmds } = await runReport(t4args(), t4Respond())
  const evs = ledgerCmds.map(eventOf)
  assert.equal(result.signed_off, true)
  assert.equal(result.council.terminal, 'RATIFIED')
  assert.equal(result.council.seat, 'report_signoff', 'the b42-mirrored per-seat summary rides the return (the boundary record for report)')
  assert.equal(result.council.certificate.label, 'twin_ratified')
  assert.equal(result.council.certificate.signatures[0].renderer_version, 'b43-report/1')
  assert.equal(evs.filter((e) => e.type === 'stage_completed').length, 1, 'stage_completed fires ONLY after a dual valid APPROVE + certificate')
  const keys = evs.filter((e) => e.type === 'note').map((e) => e.data.key)
  assert.ok(keys.includes('report.signed'), 'the signed beat rides on a RATIFIED signoff')
})

test('report signoff: a BLOCK ⇒ signed_off:false, the UNSIGNED report still returned, NO stage_completed (completion is council-gated at T4)', async () => {
  const { result, ledgerCmds } = await runReport(t4args(), t4Respond({ fableSig: (h) => ({ ...rat(h), verdict: 'BLOCK', findings: [SIGN_FINDING] }) }))
  const evs = ledgerCmds.map(eventOf)
  assert.equal(result.signed_off, false)
  assert.equal(result.council.terminal, 'BLOCKED')
  assert.ok(result.council.findings.some((f) => f && f.finding_id === 'RS-1'), 'the frozen finding rides the return')
  assert.equal(result.report_file, REPORT_FILE, 'the unsigned report is STILL returned')
  assert.equal(evs.filter((e) => e.type === 'stage_completed').length, 0, 'a BLOCKED signoff withholds completion — the projection stays at report')
})

test('report signoff: a DEAD Sol seat (no receipt) ⇒ DEGRADED, signed_off:false, NO stage_completed', async () => {
  const { result, ledgerCmds } = await runReport(t4args(), t4Respond({ solSig: 'dead' }))
  assert.equal(result.signed_off, false)
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.equal(ledgerCmds.map(eventOf).filter((e) => e.type === 'stage_completed').length, 0)
})

test('report signoff promised-but-tokenless: T4 + codex but NO runToken ⇒ signed_off:false + DEGRADED + NO stage_completed', async () => {
  const { result, ledgerCmds } = await runReport({ ...baseArgs, codexAvailable: true, capabilityTier: 'T4' }, t4Respond())
  assert.equal(result.signed_off, false)
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.equal(ledgerCmds.map(eventOf).filter((e) => e.type === 'stage_completed').length, 0)
})

test('report signoff sub-T4 byte-preservation: at T3 (no council) a written REPORT.md keeps the existence-gated completion, signed_off ABSENT (never a false claim)', async () => {
  const { result, ledgerCmds } = await runReport({ ...baseArgs, codexAvailable: true, capabilityTier: 'T3' }, t4Respond())
  const evs = ledgerCmds.map(eventOf)
  assert.equal(result.signed_off, undefined, 'sub-T4 never claims signed_off')
  assert.equal(result.council, undefined, 'sub-T4 adds no council field')
  assert.equal(evs.filter((e) => e.type === 'stage_completed').length, 1, 'byte-preserved existence-gated completion')
  assert.ok(evs.filter((e) => e.type === 'note').map((e) => e.data.key).includes('report.signed'))
})

test('report signoff: a missing REPORT.md never reaches the council — signed_off:false, terminal null, NO completion', async () => {
  const { result, ledgerCmds } = await runReport(t4args(), t4Respond({ verify: { exists: false } }))
  assert.equal(result.signed_off, false)
  assert.equal(result.council.terminal, null, 'the existence gate precedes the council — a missing artifact never convenes it')
  assert.equal(ledgerCmds.map(eventOf).filter((e) => e.type === 'stage_completed').length, 0)
})
