// validate-workflow.test.mjs — P3.6 T4 acceptance for validate's stage brackets (RUN-B FINDING 2).
// The GENERATED workflows/validate.js is driven through its INLINED deterministic verdict
// (validateVerdict) with every agent MOCKED, over a NON-UI scope (so the Tier-2 traversal / lease /
// sweep legs are skipped and the path is the lean drift ∥ Law-floor ∥ goal-backward → verdict one).
// The contract under test: stage_started fires at stage entry; stage_completed fires ONLY on a clean
// VALIDATE_PASS verdict — a PARTIAL/FAILED verdict leaves the projection at 'validate' (accurate: the
// conductor loops corrections back to build).
//
// The workflow runs exactly as the runtime evaluates it (and as dry-run-runner.mjs does): the leading
// `export ` is stripped off `export const meta`, the body becomes an AsyncFunction whose parameters
// are the workflow globals, and stubs are passed positionally. `agent` is a programmable mock keyed
// off the call's `label`; every call records {label, prompt}.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { sha256Hex, canonicalJson } from '../../plugins/kiln/src/council.mjs'

const WORKFLOW = fileURLToPath(new URL('../../plugins/kiln/workflows/validate.js', import.meta.url))
const AsyncFunction = (async () => {}).constructor
const wfBody = readFileSync(WORKFLOW, 'utf8').replace(/^export const meta\b/m, 'const meta')

async function runValidate(args, respond) {
  const calls = []
  const agent = async (prompt, opts) => {
    const label = (opts && opts.label) || ''
    calls.push({ label, prompt })
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
  return { result, calls }
}

const baseArgs = { kilnDir: '/tmp/val-x/.kiln', projectPath: '/tmp/val-x', codexAvailable: false, pluginRoot: '/plug' }
const ledgersOf = (calls, type) => calls.filter((c) => c.label === 'thoth:ledger' && c.prompt.includes(`"type":"${type}"`))

// A clean NON-UI (cli) validator report → VALIDATE_PASS: install ok, Law green, suite green, the one
// criterion met, no blocking, ui_scope false.
const argusPass = {
  reasoning: 'r', report_file: 'report.md', product_type: 'cli',
  install_ok: true, law_run_exit: 0, suite_cmd: 'pytest', suite_exit: 0,
  tests_passed: 5, tests_failed: 0, run_id: 'RUN1', verification_class_full: true,
  criteria: [{ id: 'SC-001', met: true, critical: true }],
  ui_scope: false, missing_creds: false, coverage_gaps: [], blocking_findings: [], correction_tasks: [],
}
const respondPass = (label) => {
  if (label === 'thoth:ledger') return { ok: true }
  if (label === 'hephaestus:detect') return { reasoning: 'r', design_present: false }
  if (label === 'zoxea:arch-check') return { reasoning: 'r', check_file: 'ac.md', summary: 's', drift: [], seam_issues: [], blocking: [] }
  if (label === 'argus:validate') return argusPass
  if (label === 'aristotle:goal-final') return { reasoning: 'r', overall: 'pass', findings: [] }
  return null
}

test('P3.6 T4 validate brackets: stage_started fires on entry; a clean VALIDATE_PASS emits exactly one stage_completed', async () => {
  const { result, calls } = await runValidate(baseArgs, respondPass)
  assert.equal(result.verdict, 'VALIDATE_PASS')
  const started = ledgersOf(calls, 'stage_started')
  const completed = ledgersOf(calls, 'stage_completed')
  assert.equal(started.length, 1, 'the entry bracket fires once at Measuring Drift')
  assert.match(started[0].prompt, /"stage":"validate"/)
  assert.equal(completed.length, 1, 'a clean VALIDATE_PASS completes the stage — projection bumps to report')
  assert.match(completed[0].prompt, /"stage":"validate"/)
  // ordering: stage_started precedes the deterministic validator; stage_completed follows the verdict
  const startedIdx = calls.indexOf(started[0])
  const argusIdx = calls.findIndex((c) => c.label === 'argus:validate')
  const verdictIdx = calls.findIndex((c) => c.label === 'thoth:ledger' && c.prompt.includes('"type":"validate_verdict"'))
  const completedIdx = calls.indexOf(completed[0])
  assert.ok(startedIdx > -1 && startedIdx < argusIdx, 'stage_started brackets the stage before the Law-floor validator')
  assert.ok(completedIdx > verdictIdx, 'stage_completed lands after the verdict is computed and ledgered')
})

test('P3.6 T4 validate brackets: a non-PASS verdict (red Law) emits stage_started but NO stage_completed — the stage stays current', async () => {
  const { result, calls } = await runValidate(baseArgs, (label) => {
    if (label === 'argus:validate') return { ...argusPass, law_run_exit: 1 } // the Law is RED → VALIDATE_FAILED
    return respondPass(label)
  })
  assert.notEqual(result.verdict, 'VALIDATE_PASS')
  assert.equal(ledgersOf(calls, 'stage_started').length, 1, 'the entry bracket still fires — the stage was entered')
  assert.equal(ledgersOf(calls, 'stage_completed').length, 0, 'a non-PASS verdict never completes the stage')
})

test('P3.6 T4 validate brackets: a PARTIAL verdict (missing creds) also withholds stage_completed', async () => {
  const { result, calls } = await runValidate(baseArgs, (label) => {
    if (label === 'argus:validate') return { ...argusPass, missing_creds: true } // caps at PARTIAL
    return respondPass(label)
  })
  assert.equal(result.verdict, 'VALIDATE_PARTIAL')
  assert.equal(ledgersOf(calls, 'stage_completed').length, 0, 'PARTIAL is not completion — the conductor still owns the next move')
})

// ── D2: a UI-traversal defect's correction task inherits the traversal's on-disk probe artifacts ──
// A UI scope whose Tier-2 traversal finds a defect ([ui-traversal] finding) — the correction task
// that rides back to a build re-entry must NAME the probe evidence paths so the builder reads the
// real DOM/console/screenshot state before re-attempting (reading artifacts is not browser authority).
const argusUi = {
  reasoning: 'r', report_file: 'report.md', product_type: 'web',
  install_ok: true, law_run_exit: 0, suite_cmd: 'npm test', suite_exit: 0,
  tests_passed: 3, tests_failed: 0, run_id: 'RUN1', verification_class_full: true,
  criteria: [{ id: 'SC-UI-1', met: true, critical: true, browser_only: true }],
  ui_scope: true, missing_creds: false, coverage_gaps: [], blocking_findings: [], correction_tasks: [],
}
const traversalFail = { reasoning: 'r', tool: 'kiln-probe', browser_result: 'failed', criteria: [{ id: 'SC-UI-1', met: false, verified: true }], findings: ['the primary nav is clipped below 400px'] }

test('D2 validate (Sol r1-2): a [ui-traversal] correction task carries CONCRETE probe artifact paths — the traversal run id is SCRIPT-ASSIGNED, and no placeholder survives into the build re-entry brief', async () => {
  const { result, calls } = await runValidate(baseArgs, (label) => {
    if (label === 'thoth:ledger') return { ok: true }
    if (label === 'hephaestus:detect') return { reasoning: 'r', design_present: false }
    if (label === 'zoxea:arch-check') return { reasoning: 'r', check_file: 'ac.md', summary: 's', drift: [], seam_issues: [], blocking: [] }
    if (label === 'argus:validate') return argusUi
    if (label.startsWith('argus:traversal')) return traversalFail
    if (label === 'aristotle:goal-final') return { reasoning: 'r', overall: 'pass', findings: [] }
    return null // sentinel lease/sweep legs degrade gracefully
  })
  assert.equal(result.verdict, 'VALIDATE_FAILED', 'a live UI defect fails the verdict')
  // the traversal PROMPT carries the script-assigned run id — the evaluator is never allowed to invent one
  const tp = calls.find((c) => c.label === 'argus:traversal')
  assert.ok(tp, 'the traversal evaluator spawned')
  assert.match(tp.prompt, /run \/tmp\/val-x \/tmp\/val-x\/\.kiln <SC-id> kval-[A-Za-z0-9._-]+-traversal --lease/, 'the probe invocation names the concrete script-assigned runId')
  assert.match(tp.prompt, /script-assigned, never your own/)
  const uiTask = result.correction_tasks.find((t) => t.includes('[ui-traversal]'))
  assert.ok(uiTask, 'the traversal defect became a correction task')
  assert.doesNotMatch(uiTask, /<runId>|<SC>/, 'a placeholder path is useless to a build re-entry — every path must be concrete (Sol r1-2)')
  assert.match(uiTask, /\/tmp\/val-x\/\.kiln\/evidence\/kval-[A-Za-z0-9._-]+-traversal\/probe-SC-UI-1\.json/, 'the per-SC result path is fully resolved: evidence dir + script-assigned runId + SC id')
  assert.match(uiTask, /probe-SC-UI-1\.log/, 'the console/stderr log path is fully resolved too')
  assert.match(uiTask, /screenshot/)
  assert.match(uiTask, /not browser authority/, 'reading artifacts is not browser authority')
})

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// ── B4-3 D2/D3: validate at capability tier T4 — the final-ruling council over the ASSEMBLED verdict
//    (every computed verdict; monotonicity both directions; completion gating) + the receipt-based
//    second-family attestation. Every Sol leg rides a receipt-attested codex envelope + an
//    invocation-exact ledger cross-check (the inlined gate.mjs + council.mjs machinery). Fixtures derive
//    every cross-side hash from real bytes (the build-spine.test.mjs discipline).
// ══════════════════════════════════════════════════════════════════════════════════════════════════
const CODEX_MODEL = 'gpt-5.6-sol'
const T4TOKEN = 'VAL-RUNTOKEN-xyz'
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
const RULE_FINDING = { finding_id: 'VR-1', claim: 'the PASS is not supported by the exit codes', required_change: 'fix the failing check', evidence_refs: ['law.json'], evidence_class: 'test_output', executable_check: null }
const anchorFilesFromPrompt = (prompt) => { const m = prompt.match(/sha256sum ([^\n']+)/); const paths = m ? m[1].trim().split(/\s+/).filter(Boolean) : []; return paths.map((p) => ({ path: p, sha256: sha256Hex(p) })) }
// B43-3: GOAL_SECOND_PAYLOAD_SCHEMA = GOAL_SCHEMA fields verbatim (overall/findings/report_file/reasoning
// maxLength 700) + report_markdown — the fixture exercises the full shape (report_file present).
const secondPayloadDefault = { reasoning: 'r', overall: 'pass', findings: [], report_file: 'goal-backward-final-second.md', report_markdown: '# second' }

// t4Respond(cfg) — layers the council legs over respondPass; captures the ruling artifact_hash from the
// fable/sol prompts so the payloads + their cross-checks echo whatever hash the workflow computed.
function t4Respond(cfg = {}) {
  let rulingHash = null
  const secondPayload = cfg.secondPayload !== undefined ? cfg.secondPayload : secondPayloadDefault
  return (label, prompt) => {
    if (label === 'thoth:validate-anchor') return cfg.anchor !== undefined ? cfg.anchor : { reasoning: 'a', files: anchorFilesFromPrompt(prompt) }
    if (label === 'fable:validate-ruling') { const m = prompt.match(/artifact_hash = "([0-9a-f]{64})"/); if (m) rulingHash = m[1]; return cfg.fableRuling ? cfg.fableRuling(rulingHash) : rat(rulingHash) }
    if (label === 'sol:validate-ruling') { const m = prompt.match(/"artifact_hash":"([0-9a-f]{64})"/); if (m) rulingHash = m[1]; if (cfg.solRuling === 'dead') return {}; return cfg.solRuling ? solEnv(cfg.solRuling(rulingHash)) : solEnv(rat(rulingHash)) }
    if (label === 'thoth:receipt-check:sol:validate-ruling') return crossOk(cfg.solRuling && cfg.solRuling !== 'dead' ? cfg.solRuling(rulingHash) : rat(rulingHash), 'validate_ruling', 'VALIDATE_RATIFY')
    if (label === 'aristotle:goal-final:second-family') { if (cfg.secondDead) return null; if (!prompt.includes('Sol transport wrapper')) return { reasoning: 'r', overall: 'pass', findings: [] }; return cfg.secondNoReceipt ? { payload: secondPayload, raw_artifact_refs: { stderr: 's', output: 'o' } } : solEnv(secondPayload) }
    if (label === 'thoth:receipt-check:goal-final:second-family') return crossOk(secondPayload, cfg.secondBadCross ? 'wrong:keystone' : 'validate_ruling', 'GOAL_SECOND')
    return respondPass(label, prompt)
  }
}
const verdictEventOf = (calls) => calls.find((c) => c.label === 'thoth:ledger' && c.prompt.includes('"type":"validate_verdict"'))
// the ledger prompt embeds JSON.stringify({type,stage,data}) as the single-quoted argv to kiln-state
// append; the payload carries no single quotes (hashes/labels only), so this recovers it verbatim.
const parseLedgerEvent = (call) => JSON.parse(call.prompt.match(/kiln-state\.mjs append \S+ '(.+)'/)[1])
const postureSecond = JSON.stringify({ validate: { second_family: true } })

test('B4-3 D2 validate ruling: at T4 a VALIDATE_PASS convenes the blind Fable/Sol final-ruling pair; dual-APPROVE ⇒ RATIFIED + stage_completed + a b43-validate/1 certificate', async () => {
  const { result, calls } = await runValidate(t4args(), t4Respond())
  const exact = (l) => calls.filter((c) => c.label === l).length
  assert.equal(result.verdict, 'VALIDATE_PASS')
  assert.equal(exact('fable:validate-ruling'), 1, 'the blind Fable ruling seat is dispatched once')
  assert.equal(exact('sol:validate-ruling'), 1, 'the receipt-attested Sol ruling seat is dispatched once')
  assert.equal(exact('thoth:receipt-check:sol:validate-ruling'), 1, 'the Sol ruling leg is cross-checked invocation-exact')
  assert.equal(result.council.terminal, 'RATIFIED')
  assert.equal(result.council.seat, 'validate_ruling', 'B43-2: the b42-mirrored seat rides the return council field')
  assert.equal(result.council.certificate.label, 'twin_ratified')
  assert.equal(result.council.certificate.signatures[0].renderer_version, 'b43-validate/1')
  assert.equal(ledgersOf(calls, 'stage_completed').length, 1, 'a RATIFIED PASS completes the stage')
  // the authoritative council record rides the existing validate_verdict boundary event (no new type)
  const evCouncil = parseLedgerEvent(verdictEventOf(calls)).data.council
  assert.equal(evCouncil.seat, 'validate_ruling', 'B43-2: the per-seat summary (seat) rides the boundary event')
  assert.equal(evCouncil.terminal, 'RATIFIED')
  // B43-1: the certificate + frozen findings ride the EVENT payload too — the same truth on event + return
  assert.equal(evCouncil.certificate.label, 'twin_ratified', 'B43-1: the RATIFIED certificate rides the boundary event')
  assert.deepEqual(evCouncil.findings, [], 'B43-1: the frozen findings ride the boundary event (empty on RATIFIED)')
  assert.equal(evCouncil.terminal, result.council.terminal, 'the event council and the return council carry the same truth')
  assert.equal(evCouncil.certificate.label, result.council.certificate.label)
})

test('B4-3 D2 validate ruling: a BLOCK on a prospective VALIDATE_PASS leaves the verdict UNALTERED but gates stage_completed (red monotonicity + completion gate)', async () => {
  const { result, calls } = await runValidate(t4args(), t4Respond({ fableRuling: (h) => ({ ...rat(h), verdict: 'BLOCK', findings: [RULE_FINDING] }) }))
  assert.equal(result.verdict, 'VALIDATE_PASS', 'the deterministic verdict STANDS — a council BLOCK never softens it to PARTIAL')
  assert.equal(result.council.terminal, 'BLOCKED')
  assert.equal(result.council.certificate, null, 'twin_ratified appears ONLY with a valid certificate')
  assert.ok(result.council.findings.some((f) => f && f.finding_id === 'VR-1'), 'the frozen BLOCK finding rides the return')
  // B43-1: the frozen findings ride the EVENT payload too (the same truth on event + return)
  const evCouncil = parseLedgerEvent(verdictEventOf(calls)).data.council
  assert.equal(evCouncil.terminal, 'BLOCKED')
  assert.equal(evCouncil.certificate, null, 'B43-1: a BLOCKED event carries no certificate')
  assert.ok(evCouncil.findings.some((f) => f && f.finding_id === 'VR-1'), 'B43-1: the frozen BLOCK finding rides the boundary event')
  assert.equal(ledgersOf(calls, 'stage_completed').length, 0, 'a BLOCKED PASS does NOT complete the stage — the projection stays at validate')
})

test('B4-3 D2 validate ruling: the council convenes on a FAILED verdict too (every computed verdict), and a dual-APPROVE cannot LIFT a deterministic red — verdict stays VALIDATE_FAILED, no stage_completed', async () => {
  const base = t4Respond()
  const { result, calls } = await runValidate(t4args(), (label, prompt) => {
    if (label === 'argus:validate') return { ...argusPass, law_run_exit: 1 } // red Law → VALIDATE_FAILED
    return base(label, prompt)
  })
  assert.equal(result.verdict, 'VALIDATE_FAILED')
  assert.equal(calls.filter((c) => c.label === 'fable:validate-ruling').length, 1, 'the pair convenes on a FAILED verdict too')
  assert.equal(result.council.terminal, 'RATIFIED', 'the pair ruled the assembled FAILED record — but the verdict is not lifted')
  assert.equal(ledgersOf(calls, 'stage_completed').length, 0, 'a FAILED verdict never completes the stage, RATIFIED or not')
})

test('B4-3 D2 validate ruling (B43-4a): the council convenes on a PARTIAL verdict too — it rules the assembly, the verdict stays VALIDATE_PARTIAL (untouched), and PARTIAL never completes the stage', async () => {
  const base = t4Respond()
  const { result, calls } = await runValidate(t4args(), (label, prompt) => {
    if (label === 'argus:validate') return { ...argusPass, missing_creds: true } // caps at PARTIAL
    return base(label, prompt)
  })
  assert.equal(result.verdict, 'VALIDATE_PARTIAL', 'the deterministic verdict STANDS — the council never authors PARTIAL up or down')
  assert.equal(calls.filter((c) => c.label === 'fable:validate-ruling').length, 1, 'the pair convenes on a PARTIAL verdict too (every computed verdict)')
  assert.equal(result.council.terminal, 'RATIFIED', 'the pair ruled the assembled PARTIAL record')
  assert.equal(result.council.seat, 'validate_ruling', 'B43-2: the per-seat summary rides the return')
  const evCouncil = parseLedgerEvent(verdictEventOf(calls)).data.council
  assert.equal(evCouncil.terminal, 'RATIFIED', 'the council record rides the boundary event on a PARTIAL verdict too')
  assert.equal(ledgersOf(calls, 'stage_completed').length, 0, 'PARTIAL is not completion, RATIFIED or not — the conductor still owns the next move')
})

test('B4-3 D2 validate ruling: a DEAD Sol ruling seat (no receipt) ⇒ DEGRADED, verdict UNCHANGED, NO stage_completed (never a single-head ruling)', async () => {
  const { result, calls } = await runValidate(t4args(), t4Respond({ solRuling: 'dead' }))
  assert.equal(result.verdict, 'VALIDATE_PASS')
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.equal(ledgersOf(calls, 'stage_completed').length, 0)
})

test('B4-3 D2 promised-but-tokenless: T4 + codex but NO runToken ⇒ the ruling fails CLOSED (DEGRADED), NO pair dispatched, NO stage_completed even on a PASS', async () => {
  const { result, calls } = await runValidate({ ...baseArgs, codexAvailable: true, capabilityTier: 'T4' }, t4Respond())
  assert.equal(result.verdict, 'VALIDATE_PASS')
  assert.equal(calls.filter((c) => c.label === 'fable:validate-ruling').length, 0, 'no council convenes without a runToken')
  assert.equal(result.council.terminal, 'DEGRADED')
  assert.equal(ledgersOf(calls, 'stage_completed').length, 0, 'a promised-but-tokenless PASS never completes — no silent v3.0.1 completion')
})

test('B4-3 D2 sub-T4 byte-preservation: at T3 (no council) a VALIDATE_PASS completes the stage with NO council pair and NO council return field', async () => {
  const { result, calls } = await runValidate({ ...baseArgs, codexAvailable: true, capabilityTier: 'T3' }, t4Respond())
  assert.equal(result.verdict, 'VALIDATE_PASS')
  assert.equal(calls.filter((c) => c.label === 'fable:validate-ruling').length, 0)
  assert.equal(result.council, undefined, 'sub-T4 adds no council field (byte-preserved)')
  assert.equal(ledgersOf(calls, 'stage_completed').length, 1, 'byte-preserved: a PASS completes the stage')
})

test('B4-3 D3 second-family: a receipt-attested second-family goal leg with a clean cross-check ⇒ second_family_verified in the validate_verdict event', async () => {
  const { calls } = await runValidate(t4args({ posture: postureSecond }), t4Respond())
  assert.equal(calls.filter((c) => c.label === 'aristotle:goal-final:second-family').length, 1)
  assert.equal(calls.filter((c) => c.label === 'thoth:receipt-check:goal-final:second-family').length, 1, 'the second-family receipt is cross-checked invocation-exact')
  const vv = verdictEventOf(calls)
  assert.match(vv.prompt, /"second_family_verified":true/)
  assert.match(vv.prompt, /"second_family_degraded":false/)
})

test('B4-3 D3 second-family: a FAILED cross-check ⇒ second_family_verified false + verification_degraded (the audit content still rides the reconcile — null-keep)', async () => {
  const { calls } = await runValidate(t4args({ posture: postureSecond }), t4Respond({ secondBadCross: true }))
  const vv = verdictEventOf(calls)
  assert.match(vv.prompt, /"second_family_verified":false/)
  assert.match(vv.prompt, /"second_family_degraded":true/)
  assert.ok(calls.some((c) => c.label === 'thoth:ledger' && c.prompt.includes('"type":"verification_degraded"')), 'the degraded second family rides the existing verification_degraded event')
})

test('B4-3 D3 second-family (B43-4b): a MISSING-RECEIPT envelope (receiptRequired ⇒ dead Sol seat) ⇒ second_family_verified false + verification_degraded — distinct from the failed-cross-check row (no cross-check leg even runs)', async () => {
  const { calls } = await runValidate(t4args({ posture: postureSecond }), t4Respond({ secondNoReceipt: true }))
  const vv = verdictEventOf(calls)
  assert.match(vv.prompt, /"second_family_verified":false/)
  assert.match(vv.prompt, /"second_family_degraded":true/)
  const degraded = calls.find((c) => c.label === 'thoth:ledger' && c.prompt.includes('"type":"verification_degraded"'))
  assert.ok(degraded, 'a receiptless second-family leg degrades honestly')
  assert.doesNotMatch(degraded.prompt, /no_run_token_no_attestation/, 'a runToken WAS minted — this is a missing receipt, not a tokenless leg')
  assert.equal(calls.filter((c) => c.label === 'thoth:receipt-check:goal-final:second-family').length, 0, 'the leg fell CLOSED at the missing receipt — no cross-check runs (distinct from the failed-cross-check row)')
})

test('B4-3 D3 second-family: codex present but NO runToken ⇒ second_family NOT verified, degraded with no_run_token_no_attestation (never an unattested claim)', async () => {
  const { calls } = await runValidate({ ...baseArgs, codexAvailable: true, capabilityTier: 'T4', posture: postureSecond }, t4Respond())
  const vv = verdictEventOf(calls)
  assert.match(vv.prompt, /"second_family_verified":false/)
  const degraded = calls.find((c) => c.label === 'thoth:ledger' && c.prompt.includes('"type":"verification_degraded"'))
  assert.ok(degraded, 'a codex-but-tokenless second family degrades honestly')
  assert.match(degraded.prompt, /no_run_token_no_attestation/)
})

test('B4-3 D3 second-family: codexAvailable=false ⇒ NEVER verified (both legs opus) — second_family_degraded, and no ruling council convenes', async () => {
  const { calls } = await runValidate({ ...baseArgs, codexAvailable: false, capabilityTier: 'T4', runToken: T4TOKEN, posture: postureSecond }, t4Respond())
  const vv = verdictEventOf(calls)
  assert.match(vv.prompt, /"second_family_verified":false/)
  assert.equal(calls.filter((c) => c.label === 'fable:validate-ruling').length, 0, 'codex absent ⇒ councilPromised false ⇒ no ruling pair')
})
