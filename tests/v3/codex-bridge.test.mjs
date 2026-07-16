// codex-bridge.test.mjs — the Kiln Dev Protocol bridge over the shared transport.
// REAL_* constants are verbatim local read-only captures from codex-cli 0.144.1:
// a model-unavailable turn.failure, an invalid-effort turn.failure, and
// a clean verdict envelope. They pin the outcome state machine and the exact fallback fingerprint.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  bridgeCodexArgs, classifyBridgeOutcome, inspectBridgeEvents, isAllowlistedCodexError,
  isModelUnavailableFingerprint, isSubstantiveRejection, parseCodexJsonl, validateReviewVerdict,
} from '../../plugins/kiln/scripts/kiln-codex-receipt.mjs'

const CLI = fileURLToPath(new URL('../../plugins/kiln/scripts/kiln-codex-receipt.mjs', import.meta.url))
// The schema + templates the public suite reads live as byte-copied fixtures under tests/v3/fixtures/
// so a clean public clone is self-sufficient (the dev-workspace originals under scripts/dev/ and
// .kiln-dev/ are untracked). The FIXTURE_PARITY tests below pin each copy to its original wherever
// the dev workspace is present.
const SCHEMA = readFileSync(fileURLToPath(new URL('./fixtures/review-verdict-schema.json', import.meta.url)))

const HOOKS_ERR = '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"failed to parse hooks config /home/dev/.codex/hooks.json: unknown field `state`, expected `description` or `hooks` at line 77 column 9"}}'

// Verbatim from probes/mu-events.jsonl (codex exec -m <bogus> --json): exit 1, turn.failed carrying
// a model-unavailability invalid_request_error, verdict absent.
const REAL_MODEL_UNAVAILABLE = `{"type":"thread.started","thread_id":"019f5e8b-da89-7c03-a611-6b263531694b"}
${HOOKS_ERR}
{"type":"item.completed","item":{"id":"item_1","type":"error","message":"Model metadata for \`gpt-5.6-bogus-xyz\` not found. Defaulting to fallback metadata; this can degrade performance and cause issues."}}
{"type":"turn.started"}
{"type":"error","message":"{\\"type\\":\\"error\\",\\"status\\":400,\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"message\\":\\"The 'gpt-5.6-bogus-xyz' model is not supported when using Codex with a ChatGPT account.\\"}}"}
{"type":"turn.failed","error":{"message":"{\\"type\\":\\"error\\",\\"status\\":400,\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"message\\":\\"The 'gpt-5.6-bogus-xyz' model is not supported when using Codex with a ChatGPT account.\\"}}"}}
`

// Verbatim from probes/eff-events.jsonl (invalid reasoning.effort --json): exit 1, turn.failed with
// param reasoning.effort. The old grep -q model admitted this; the exact fingerprint must not.
const REAL_INVALID_EFFORT = `{"type":"thread.started","thread_id":"019f5e94-8084-7572-8023-4f8f6f9a1322"}
${HOOKS_ERR}
{"type":"turn.started"}
{"type":"error","message":"{\\n  \\"type\\": \\"error\\",\\n  \\"error\\": {\\n    \\"type\\": \\"invalid_request_error\\",\\n    \\"code\\": \\"unsupported_value\\",\\n    \\"message\\": \\"Unsupported value: 'minimal' is not supported with the 'gpt-5.6-sol-1p-codexswic-ev3' model. Supported values are: 'none', 'low', 'medium', 'high', and 'xhigh'.\\",\\n    \\"param\\": \\"reasoning.effort\\"\\n  },\\n  \\"status\\": 400\\n}"}
{"type":"turn.failed","error":{"message":"{\\n  \\"type\\": \\"error\\",\\n  \\"error\\": {\\n    \\"type\\": \\"invalid_request_error\\",\\n    \\"code\\": \\"unsupported_value\\",\\n    \\"message\\": \\"Unsupported value: 'minimal' is not supported with the 'gpt-5.6-sol-1p-codexswic-ev3' model. Supported values are: 'none', 'low', 'medium', 'high', and 'xhigh'.\\",\\n    \\"param\\": \\"reasoning.effort\\"\\n  },\\n  \\"status\\": 400\\n}"}}
`

const CLEAN_VERDICT_EVENTS = `{"type":"thread.started","thread_id":"019f5e72-fb8d-7ec3-a592-c02c1d487c70"}
${HOOKS_ERR}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"{}"}}
{"type":"turn.completed","usage":{"input_tokens":19501,"cached_input_tokens":0,"output_tokens":63,"reasoning_output_tokens":0}}
`

const parseEvents = (text) => text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))

const VALID_VERDICT = JSON.stringify({
  findings: [{ id: 'F-1', class: 'BLOCKING', remedy_class: 'NEW_DECISION', location: 'x.mjs:1', defect: 'd', evidence: 'e' }],
  verdict: 'REJECTED',
  notes: 'n',
})

// ── pure functions ────────────────────────────────────────────────────────────────────────────

test('the hooks-config warning is the sole allowlisted error fingerprint', () => {
  assert.equal(isAllowlistedCodexError('failed to parse hooks config /home/dev/.codex/hooks.json: unknown field `state`'), true)
  assert.equal(isAllowlistedCodexError('`[features].codex_hooks` is deprecated. Use `[features].hooks` instead.'), false)
  assert.equal(isAllowlistedCodexError('The model is not supported when using Codex'), false)
  assert.equal(isAllowlistedCodexError(undefined), false)
})

test('the exact fallback fingerprint fires on model-unavailability and never on invalid effort', () => {
  const mu = inspectBridgeEvents(parseEvents(REAL_MODEL_UNAVAILABLE))
  const eff = inspectBridgeEvents(parseEvents(REAL_INVALID_EFFORT))
  assert.equal(mu.failedCount, 1)
  assert.equal(eff.failedCount, 1)
  assert.equal(isModelUnavailableFingerprint(mu), true)
  assert.equal(isModelUnavailableFingerprint(eff), false)
})

test('inspectBridgeEvents reads terminals, thread id, and non-allowlisted error pollution', () => {
  const clean = inspectBridgeEvents(parseEvents(CLEAN_VERDICT_EVENTS))
  assert.equal(clean.completedCount, 1)
  assert.equal(clean.failedCount, 0)
  assert.equal(clean.disallowedErrorCount, 0) // hooks-config is allowlisted
  assert.equal(clean.threadId, '019f5e72-fb8d-7ec3-a592-c02c1d487c70')
  assert.equal(clean.usage.input_tokens + clean.usage.output_tokens, 19564)
  const mu = inspectBridgeEvents(parseEvents(REAL_MODEL_UNAVAILABLE))
  assert.ok(mu.disallowedErrorCount >= 1) // the metadata + request error items are not allowlisted
})

test('the state machine classifies every defined shape and defaults to TRANSPORT', () => {
  const clean = inspectBridgeEvents(parseEvents(CLEAN_VERDICT_EVENTS))
  const mu = inspectBridgeEvents(parseEvents(REAL_MODEL_UNAVAILABLE))
  // VERDICT shape (attestation still pending)
  assert.deepEqual(
    classifyBridgeOutcome({ exitCode: 0, inspect: clean, verdictExists: true, verdictEmpty: false }),
    { status: 'VERDICT', needsAttestation: true },
  )
  // SUPPRESSED = exit 0 + empty verdict + turn.completed
  assert.equal(classifyBridgeOutcome({ exitCode: 0, inspect: clean, verdictExists: true, verdictEmpty: true }).status, 'SUPPRESSED')
  // exit 0 with absent verdict is TRANSPORT, not SUPPRESSED
  assert.equal(classifyBridgeOutcome({ exitCode: 0, inspect: clean, verdictExists: false, verdictEmpty: true }).status, 'TRANSPORT')
  // FAILED_TURN = exit 1 + turn.failed + absent verdict
  assert.equal(classifyBridgeOutcome({ exitCode: 1, inspect: mu, verdictExists: false, verdictEmpty: true }).status, 'FAILED_TURN')
  // WALLCLOCK_TIMEOUT wins outright
  assert.equal(classifyBridgeOutcome({ timedOut: true, exitCode: 0, inspect: clean, verdictExists: true, verdictEmpty: false }).status, 'WALLCLOCK_TIMEOUT')
  // parse failure, conflicting terminals, and odd exits are TRANSPORT
  assert.equal(classifyBridgeOutcome({ exitCode: 0, parseError: 'boom', inspect: clean, verdictExists: true, verdictEmpty: false }).status, 'TRANSPORT')
  const twoTerminals = { ...clean, completedCount: 2 }
  assert.equal(classifyBridgeOutcome({ exitCode: 0, inspect: twoTerminals, verdictExists: true, verdictEmpty: false }).status, 'TRANSPORT')
  assert.equal(classifyBridgeOutcome({ exitCode: 3, inspect: clean, verdictExists: false, verdictEmpty: true }).status, 'TRANSPORT')
  // a completed turn polluted by a non-allowlisted error is TRANSPORT
  assert.equal(classifyBridgeOutcome({ exitCode: 0, inspect: { ...clean, disallowedErrorCount: 1 }, verdictExists: true, verdictEmpty: false }).status, 'TRANSPORT')
})

test('bridgeCodexArgs holds the sandbox, network, resume, and ephemeral invariants', () => {
  const fresh = bridgeCodexArgs({ model: 'gpt-5.6-sol', effort: 'high', schemaFile: 'S', verdictFile: 'V', sandbox: 'read-only' })
  assert.deepEqual(fresh.slice(0, 5), ['exec', '-m', 'gpt-5.6-sol', '--sandbox', 'read-only'])
  assert.ok(fresh.includes('--json') && fresh.includes('-o') && fresh.includes('V') && fresh.includes('--output-schema'))
  assert.equal(fresh.at(-1), '-')

  const net = bridgeCodexArgs({ model: 'm', effort: 'high', schemaFile: 'S', verdictFile: 'V', sandbox: 'workspace-write', network: true })
  assert.ok(net.includes('sandbox_workspace_write.network_access=true'))
  assert.throws(() => bridgeCodexArgs({ model: 'm', effort: 'high', schemaFile: 'S', verdictFile: 'V', sandbox: 'read-only', network: true }), /--network requires --sandbox workspace-write/)

  const resume = bridgeCodexArgs({ model: 'm', effort: 'high', schemaFile: 'S', verdictFile: 'V', resumeThread: 'T9' })
  assert.deepEqual(resume.slice(0, 3), ['exec', 'resume', 'T9'])
  assert.ok(!resume.includes('--sandbox') && !resume.includes('-m'))
  assert.throws(() => bridgeCodexArgs({ model: 'm', effort: 'high', schemaFile: 'S', verdictFile: 'V', resumeThread: 'T9', sandbox: 'read-only' }), /resume cannot set a sandbox/)
  assert.throws(() => bridgeCodexArgs({ model: 'm', effort: 'high', schemaFile: 'S', verdictFile: 'V', resumeThread: 'T9', ephemeral: true }), /resume cannot combine with --ephemeral/)
  assert.throws(() => bridgeCodexArgs({ model: 'm', effort: 'minimal', schemaFile: 'S', verdictFile: 'V', sandbox: 'read-only' }), /unsupported effort 'minimal'/)
})

test('parseCodexJsonl tolerates only the allowlisted error when asked, and stays strict by default', () => {
  const clean = Buffer.from(CLEAN_VERDICT_EVENTS)
  assert.throws(() => parseCodexJsonl(clean), /error event/) // hooks-config rejected by default
  const parsed = parseCodexJsonl(clean, { allowError: isAllowlistedCodexError })
  assert.equal(parsed.tokensUsed, 19564)
  // a non-allowlisted error is still rejected even with the allowlist active
  const polluted = CLEAN_VERDICT_EVENTS.replace(HOOKS_ERR, '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"boom"}}')
  assert.throws(() => parseCodexJsonl(Buffer.from(polluted), { allowError: isAllowlistedCodexError }), /error event/)
})

test('validateReviewVerdict enforces the A2 arithmetic and stamps the invocation round', () => {
  const stamped = validateReviewVerdict(Buffer.from(VALID_VERDICT), { round: 2, schemaBytes: SCHEMA })
  assert.equal(stamped.round, 2)
  assert.equal(isSubstantiveRejection(stamped), true)

  // APPROVED cannot carry a blocking finding
  const approvedBlocking = JSON.stringify({ findings: [{ id: 'F-1', class: 'BLOCKING', remedy_class: 'VERBATIM', location: 'l', defect: 'd', evidence: 'e' }], verdict: 'APPROVED', notes: 'n' })
  assert.throws(() => validateReviewVerdict(Buffer.from(approvedBlocking), { round: 1, schemaBytes: SCHEMA }), /APPROVED cannot carry a BLOCKING/)
  // REJECTED must carry at least one blocking finding
  const rejectedClean = JSON.stringify({ findings: [{ id: 'F-1', class: 'ADVISORY', remedy_class: 'VERBATIM', location: 'l', defect: 'd', evidence: 'e' }], verdict: 'REJECTED', notes: 'n' })
  assert.throws(() => validateReviewVerdict(Buffer.from(rejectedClean), { round: 1, schemaBytes: SCHEMA }), /REJECTED must carry at least one BLOCKING/)
  // duplicate ids are rejected
  const dupIds = JSON.stringify({ findings: [{ id: 'F-1', class: 'ADVISORY', remedy_class: 'VERBATIM', location: 'l', defect: 'd', evidence: 'e' }, { id: 'F-1', class: 'ADVISORY', remedy_class: 'VERBATIM', location: 'l', defect: 'd', evidence: 'e' }], verdict: 'APPROVED', notes: 'n' })
  assert.throws(() => validateReviewVerdict(Buffer.from(dupIds), { round: 1, schemaBytes: SCHEMA }), /ids must be unique/)
  // empty id is rejected (schema enum passes; the validator holds the nonempty rule)
  const emptyId = JSON.stringify({ findings: [{ id: '', class: 'ADVISORY', remedy_class: 'VERBATIM', location: 'l', defect: 'd', evidence: 'e' }], verdict: 'APPROVED', notes: 'n' })
  assert.throws(() => validateReviewVerdict(Buffer.from(emptyId), { round: 1, schemaBytes: SCHEMA }), /nonempty id/)
  // the round is invocation-supplied and never trusted from the model
  assert.throws(() => validateReviewVerdict(Buffer.from(VALID_VERDICT), { round: 0, schemaBytes: SCHEMA }), /round must be an integer/)
  assert.throws(() => validateReviewVerdict(Buffer.from(VALID_VERDICT), { schemaBytes: SCHEMA }), /round must be an integer/)
  // an unknown finding field fails the schema
  const extra = JSON.stringify({ findings: [{ id: 'F-1', class: 'ADVISORY', remedy_class: 'VERBATIM', location: 'l', defect: 'd', evidence: 'e', sneaky: 1 }], verdict: 'APPROVED', notes: 'n' })
  assert.throws(() => validateReviewVerdict(Buffer.from(extra), { round: 1, schemaBytes: SCHEMA }), /violates schema/)
})

test('isSubstantiveRejection is true only for a BLOCKING NEW_DECISION rejection', () => {
  assert.equal(isSubstantiveRejection({ verdict: 'REJECTED', findings: [{ class: 'BLOCKING', remedy_class: 'NEW_DECISION' }] }), true)
  assert.equal(isSubstantiveRejection({ verdict: 'REJECTED', findings: [{ class: 'BLOCKING', remedy_class: 'VERBATIM' }] }), false)
  assert.equal(isSubstantiveRejection({ verdict: 'REJECTED', findings: [{ class: 'ADVISORY', remedy_class: 'NEW_DECISION' }] }), false)
  assert.equal(isSubstantiveRejection({ verdict: 'APPROVED', findings: [] }), false)
})

// ── end-to-end subcommand over a mock 0.144.1 executable ────────────────────────────────────────

function bridgeSandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-bridge-test-'))
  const prompt = join(dir, 'prompt.md')
  const schema = join(dir, 'schema.json')
  writeFileSync(prompt, 'Review the diff and return the verdict envelope.\n')
  writeFileSync(schema, SCHEMA)
  return { dir, prompt, schema, out: join(dir, 'r1') }
}

// A mock @openai/codex 0.144.1 whose behaviour is driven by MOCK_BRIDGE_MODE. It honours the bridge
// argv (-m model, -o verdict, --json to stdout) so the subcommand exercises real capture + classify.
function mockCodex(root, mode) {
  const packageDir = join(root, 'package')
  const packageBin = join(packageDir, 'bin')
  const pathBin = join(root, 'path-bin')
  const executable = join(packageBin, 'codex.js')
  mkdirSync(packageBin, { recursive: true })
  mkdirSync(pathBin, { recursive: true })
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: '@openai/codex', version: '0.144.1', type: 'module' }))
  const hooks = JSON.stringify(HOOKS_ERR)
  const body = `#!${process.execPath}
import { writeFileSync } from 'node:fs'
const a = process.argv.slice(2)
const model = a.includes('-m') ? a[a.indexOf('-m') + 1] : (a.includes('resume') ? 'resumed' : 'none')
const verdictFile = a.includes('-o') ? a[a.indexOf('-o') + 1] : null
const mode = ${JSON.stringify(mode)}
const thread = '{"type":"thread.started","thread_id":"019f5e72-fb8d-7ec3-a592-c02c1d487c70"}'
const hooks = ${hooks}
const usage = '{"type":"turn.completed","usage":{"input_tokens":19501,"cached_input_tokens":0,"output_tokens":63,"reasoning_output_tokens":0}}'
const verdictBody = ${JSON.stringify(VALID_VERDICT)}
const approvedBody = ${JSON.stringify(JSON.stringify({ findings: [], verdict: 'APPROVED', notes: 'ok' }))}
function ok(text) {
  writeFileSync(verdictFile, text)
  process.stdout.write([thread, hooks, '{"type":"turn.started"}', '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":""}}', usage].join('\\n') + '\\n')
  process.exit(0)
}
function failModel() {
  const err = '{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The model is not supported when using Codex with a ChatGPT account."}}'
  const line = JSON.stringify({ type: 'turn.failed', error: { message: err } })
  process.stdout.write([thread, hooks, '{"type":"turn.started"}', line].join('\\n') + '\\n')
  process.exit(1)
}
if (mode === 'verdict') ok(verdictBody)
else if (mode === 'approved') ok(approvedBody)
else if (mode === 'suppressed') ok('')
else if (mode === 'failed') failModel()
else if (mode === 'fallback') { if (model === 'gpt-5.6-sol') failModel(); else ok(verdictBody) }
else process.exit(2)
`
  writeFileSync(executable, body)
  chmodSync(executable, 0o755)
  const candidate = join(pathBin, 'codex')
  rmSync(candidate, { force: true })
  symlinkSync(executable, candidate)
  return { pathBin }
}

function runBridge(files, mode, extraArgs = []) {
  const mock = mockCodex(join(files.dir, `mock-${mode}`), mode)
  const env = { ...process.env, PATH: `${mock.pathBin}${delimiter}${process.env.PATH ?? ''}` }
  const args = [
    CLI, 'bridge', '--prompt', files.prompt, '--out', files.out, '--schema', files.schema,
    '--run-token', 'batch-x', '--keystone', 'dev-review', '--phase', 'p1', '--seat', 'sol', '--attempt', '1',
    ...extraArgs,
  ]
  return spawnSync(process.execPath, args, { encoding: 'utf8', env })
}

const readLedger = (out) => readFileSync(`${out}.ledger.jsonl`, 'utf8').trim().split('\n').map((line) => JSON.parse(line))

test('bridge subcommand: a clean run yields VERDICT with an attested receipt and ledger record', () => {
  const files = bridgeSandbox()
  try {
    const r = runBridge(files, 'verdict')
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /STATUS:VERDICT/)
    assert.match(r.stdout, /SOL_ELIGIBLE:true/)
    const receipt = JSON.parse(readFileSync(`${files.out}.receipt.json`, 'utf8'))
    assert.equal(receipt.transport, 'codex_exec_bridge')
    assert.equal(receipt.requested_model, 'gpt-5.6-sol')
    assert.equal(receipt.sol_seat_eligible, true)
    assert.equal(receipt.exit_code, 0)
    assert.equal(receipt.cli_version, '0.144.1')
    assert.ok(receipt.tokens_used > 0)
    const stamped = validateReviewVerdict(readFileSync(`${files.out}.verdict`), { round: 1, schemaBytes: SCHEMA })
    assert.equal(stamped.verdict, 'REJECTED')
    const ledger = readLedger(files.out)
    assert.equal(ledger.at(-1).status, 'VERDICT')
    assert.equal(ledger.at(-1).sol_seat_eligible, true)
    assert.ok(ledger.at(-1).receipt_sha256)
  } finally { rmSync(files.dir, { recursive: true, force: true }) }
})

test('bridge subcommand: an empty final message is SUPPRESSED, not a verdict', () => {
  const files = bridgeSandbox()
  try {
    const r = runBridge(files, 'suppressed')
    assert.equal(r.status, 10, r.stderr)
    assert.match(r.stdout, /STATUS:SUPPRESSED/)
    assert.ok(!existsSync(`${files.out}.receipt.json`))
    assert.equal(readLedger(files.out).at(-1).status, 'SUPPRESSED')
  } finally { rmSync(files.dir, { recursive: true, force: true }) }
})

test('bridge subcommand: a model-scoped turn.failure is FAILED_TURN and consumes no review rejection', () => {
  const files = bridgeSandbox()
  try {
    const r = runBridge(files, 'failed', ['--no-fallback'])
    assert.equal(r.status, 11, r.stderr)
    assert.match(r.stdout, /STATUS:FAILED_TURN/)
    assert.equal(readLedger(files.out).at(-1).status, 'FAILED_TURN')
  } finally { rmSync(files.dir, { recursive: true, force: true }) }
})

test('bridge subcommand: the model-unavailable fingerprint triggers one gpt-5.5 fallback, ineligible for a Sol seat, primary artifacts preserved', () => {
  const files = bridgeSandbox()
  try {
    const r = runBridge(files, 'fallback')
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /STATUS:VERDICT/)
    assert.match(r.stdout, /MODEL:gpt-5.5/)
    assert.match(r.stdout, /SOL_ELIGIBLE:false/)
    const receipt = JSON.parse(readFileSync(`${files.out}.receipt.json`, 'utf8'))
    assert.equal(receipt.requested_model, 'gpt-5.5')
    assert.equal(receipt.sol_seat_eligible, false)
    // the primary (failed) attempt's artifacts survive under IMMUTABLE attempt-scoped names,
    // not the ad-hoc .primary rename — and its ledger row binds to those bytes with a sha256 map.
    const preserved = readdirSync(files.dir).filter((f) => /\.attempt1\./.test(f))
    assert.ok(preserved.some((f) => f.includes('events.jsonl')), `expected preserved primary attempt1 events, saw ${preserved}`)
    // both attempts are ledgered — no attempt unledgered: primary FAILED_TURN then fallback VERDICT.
    const rows = readLedger(files.out)
    assert.equal(rows.at(-2).status, 'FAILED_TURN')
    assert.equal(rows.at(-2).attempt_index, 1)
    assert.equal(rows.at(-2).requested_model, 'gpt-5.6-sol')
    assert.equal(rows.at(-1).status, 'VERDICT')
    assert.equal(rows.at(-1).attempt_index, 2)
    assert.equal(rows.at(-1).sol_seat_eligible, false)
    // each row references its own immutable attempt-scoped bytes with a per-artifact sha256 map.
    assert.match(rows.at(-1).raw_artifact_refs.verdict, /\.attempt2\.verdict$/)
    assert.ok(rows.at(-1).raw_artifact_sha256.verdict)
  } finally { rmSync(files.dir, { recursive: true, force: true }) }
})

test('bridge subcommand: an unavailable model does NOT fall back when the fingerprint is an effort error', () => {
  // A failed turn without the model fingerprint stays FAILED_TURN even with fallback enabled — the mock
  // "failed" mode uses the model fingerprint, so we assert the fingerprint gate directly on real data.
  assert.equal(isModelUnavailableFingerprint(inspectBridgeEvents(parseEvents(REAL_INVALID_EFFORT))), false)
})

test('bridge subcommand: a duplicate invocation replay-rejects after a VERDICT is on the ledger', () => {
  const files = bridgeSandbox()
  try {
    assert.equal(runBridge(files, 'verdict').status, 0)
    const replay = runBridge(files, 'verdict')
    assert.notEqual(replay.status, 0)
    assert.match(replay.stderr, /replay rejected/)
  } finally { rmSync(files.dir, { recursive: true, force: true }) }
})

// ── resume record-binding + posture recording (/) ────────────────────────────

test('bridge: the receipt and ledger record the full posture tuple + out_prefix', () => {
  const files = bridgeSandbox()
  try {
    runBridge(files, 'verdict')
    const receipt = JSON.parse(readFileSync(`${files.out}.receipt.json`, 'utf8'))
    assert.equal(receipt.sandbox, 'read-only')
    assert.equal(receipt.network, false)
    assert.equal(receipt.web, false)
    const row = readLedger(files.out).at(-1)
    assert.equal(row.network, false)
    assert.equal(row.web, false)
    assert.equal(row.attempt_index, 1)
    assert.equal(row.out_prefix, files.out) // rows carry out_prefix for deterministic attempt-K counting
    assert.match(row.raw_artifact_refs.verdict, /\.attempt1\.verdict$/)
    assert.ok(row.raw_artifact_sha256.verdict)
  } finally { rmSync(files.dir, { recursive: true, force: true }) }
})

test('bridge: --resume binds to the recorded thread and derives model + eligibility from the recorded row, never opts', () => {
  const files = bridgeSandbox()
  try {
    // a SUPPRESSED gpt-5.5 turn (INELIGIBLE for a Sol seat), recorded with its thread id
    const s = runBridge(files, 'suppressed', ['--model', 'gpt-5.5', '--no-fallback'])
    assert.equal(s.status, 10, s.stderr)
    const suppressed = readLedger(files.out).at(-1)
    assert.equal(suppressed.status, 'SUPPRESSED')
    assert.equal(suppressed.requested_model, 'gpt-5.5')
    const thread = suppressed.thread_id
    assert.ok(thread)
    // resume that thread while REQUESTING gpt-5.6-sol — the RECORDED gpt-5.5 governs; the resume can
    // never falsely claim Sol eligibility for a gpt-5.5 thread.
    const r = runBridge(files, 'verdict', ['--resume', thread, '--model', 'gpt-5.6-sol'])
    assert.equal(r.status, 0, r.stderr)
    const receipt = JSON.parse(readFileSync(`${files.out}.receipt.json`, 'utf8'))
    assert.equal(receipt.resumed, true)
    assert.equal(receipt.requested_model, 'gpt-5.5') // recorded, NOT the requested gpt-5.6-sol
    assert.equal(receipt.sol_seat_eligible, false)
  } finally { rmSync(files.dir, { recursive: true, force: true }) }
})

test('bridge: --resume with an unrecorded thread id has no recoverable row and refuses', () => {
  const files = bridgeSandbox()
  try {
    runBridge(files, 'suppressed', ['--no-fallback'])
    const r = runBridge(files, 'verdict', ['--resume', 'not-a-recorded-thread'])
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /no recoverable/)
  } finally { rmSync(files.dir, { recursive: true, force: true }) }
})

test('bridge: --resume refuses to escalate the recorded sandbox posture', () => {
  const files = bridgeSandbox()
  try {
    runBridge(files, 'suppressed', ['--no-fallback'])
    const thread = readLedger(files.out).at(-1).thread_id
    const r = runBridge(files, 'verdict', ['--resume', thread, '--sandbox', 'workspace-write'])
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /recorded sandbox posture/)
  } finally { rmSync(files.dir, { recursive: true, force: true }) }
})

// ── the routing gate (/-5/-7/-8) end-to-end over a real bridge receipt ────────────────

const gsha256 = (b) => createHash('sha256').update(b).digest('hex')
const TPL = (n) => fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url))

const COMMISSION_SECTIONS = `# Review commission — batch-x round 1
## Seat
You are Sol.
## Scope (the diff you rule on)
- Diff: the whole diff
- Sandbox posture: read-only network=0 web=0
## Round discipline
Round 1 of the ladder.
## How to rule (the A2 envelope)
Return ONLY the verdict envelope.
## Payload-first
Your entire final message is the payload.`

// the Fable-terminal instrument is a BOUND WRAPPER — the inner A2 envelope plus the
// diff/batch/round the gate binds against. A bare verdict file is no longer admissible.
const fableWrapper = (diffSha, { batchId = 'batch-x', round = 1, verdict = JSON.parse(VALID_VERDICT) } = {}) =>
  JSON.stringify({ verdict, diff_sha256: diffSha, batch_id: batchId, round })

// Build a REAL bridge VERDICT whose PROMPT is the commission (so receipt.prompt_sha256 == the
// commission bytes), plus the diff / floor receipt / route-ledger the gate consumes.
function gateFixture({ mode = 'verdict', diffContent = 'diff --git a/x b/x\n+one\n', bindLine = true, postureLine = 'read-only network=0 web=0' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-gate-test-'))
  const schema = join(dir, 'schema.json'); writeFileSync(schema, SCHEMA)
  const diff = join(dir, 'r1.diff'); writeFileSync(diff, diffContent)
  const diffSha = gsha256(readFileSync(diff))
  const commission = join(dir, 'r1.commission.md')
  // mirror the real commission-review.md Scope bullet form (`- Diff-sha256: <hex>`), not a bare line.
  // postureLine drives the posture binding; the fixture's bridge always runs default read-only.
  const sections = COMMISSION_SECTIONS.replace('read-only network=0 web=0', postureLine)
  writeFileSync(commission, `${sections}\n${bindLine ? `- Diff-sha256: ${diffSha}\n` : ''}`)
  const out = join(dir, 'r1')
  const mock = mockCodex(join(dir, `mock-${mode}`), mode)
  const env = { ...process.env, PATH: `${mock.pathBin}${delimiter}${process.env.PATH ?? ''}` }
  const br = spawnSync(process.execPath, [
    CLI, 'bridge', '--prompt', commission, '--out', out, '--schema', schema,
    '--run-token', 'batch-x', '--keystone', 'dev-review', '--phase', 'r1', '--seat', 'sol', '--attempt', '1',
  ], { encoding: 'utf8', env })
  assert.equal(br.status, 0, br.stderr)
  const floor = join(dir, 'r1.floor.json')
  writeFileSync(floor, JSON.stringify({ floor_version: 1, pass: true, tally: { tests: 800, pass: 798, fail: 0, skip: 2 }, diff_sha256: diffSha, tap_sha256: 'x', bundle_check_pass: true }))
  return { dir, schema, diff, diffSha, commission, out, floor, routeLedger: join(dir, 'route.jsonl') }
}

function writeManifest(dir, over = {}) {
  const p = join(dir, 'manifest.json')
  writeFileSync(p, JSON.stringify({ batch_id: 'batch-x', lane: 'logic', stage: 'implementation', spec_path: 's', brief_path: 'b', required_terminal: 'sol', ...over }))
  return p
}

function runGate(fx, manifest, { round = '1', extra = [] } = {}) {
  return spawnSync(process.execPath, [
    CLI, 'gate', '--out', fx.out, '--schema', fx.schema, '--round', round,
    '--manifest', manifest, '--route-ledger', fx.routeLedger, '--diff', fx.diff,
    '--floor-receipt', fx.floor, '--commission', fx.commission, ...extra,
  ], { encoding: 'utf8' })
}

test('gate: the sol chain routes a clean r1 REJECTED to implement-r2 (exit 20) and records the route row', () => {
  const fx = gateFixture()
  try {
    const g = runGate(fx, writeManifest(fx.dir))
    assert.equal(g.status, 20, g.stderr)
    assert.match(g.stdout, /DECISION:implement-r2/)
    const dec = JSON.parse(readFileSync(`${fx.out}.decision.json`, 'utf8'))
    assert.equal(dec.decision, 'implement-r2')
    assert.equal(dec.terminal_provenance, 'codex_receipt')
    assert.equal(dec.exit_code, 20)
    const rows = readFileSync(fx.routeLedger, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    assert.equal(rows.at(-1).decision, 'implement-r2')
    assert.equal(rows.at(-1).diff_sha256, fx.diffSha)
    assert.equal(rows.at(-1).substantive, true)
  } finally { rmSync(fx.dir, { recursive: true, force: true }) }
})

test('gate: the sol chain seals an APPROVED verdict (exit 0)', () => {
  const fx = gateFixture({ mode: 'approved' })
  try {
    const g = runGate(fx, writeManifest(fx.dir))
    assert.equal(g.status, 0, g.stderr)
    assert.match(g.stdout, /DECISION:seal/)
  } finally { rmSync(fx.dir, { recursive: true, force: true }) }
})

test('gate: a tampered verdict fails the chain (exit 12, consumes no rung)', () => {
  const fx = gateFixture()
  try {
    writeFileSync(`${fx.out}.verdict`, JSON.stringify({ findings: [], verdict: 'APPROVED', notes: 'forged' }))
    const g = runGate(fx, writeManifest(fx.dir))
    assert.equal(g.status, 12)
    assert.match(g.stderr, /GATE-FAIL/)
    assert.ok(!existsSync(`${fx.out}.decision.json`))
  } finally { rmSync(fx.dir, { recursive: true, force: true }) }
})

test('gate: a floor receipt bound to a different diff, or not green, is rejected (exit 12)', () => {
  const fx = gateFixture()
  try {
    writeFileSync(fx.floor, JSON.stringify({ floor_version: 1, pass: true, tally: {}, diff_sha256: 'deadbeef', tap_sha256: 'x', bundle_check_pass: true }))
    assert.equal(runGate(fx, writeManifest(fx.dir)).status, 12)
    writeFileSync(fx.floor, JSON.stringify({ floor_version: 1, pass: false, tally: {}, diff_sha256: fx.diffSha, tap_sha256: 'x', bundle_check_pass: true }))
    assert.equal(runGate(fx, writeManifest(fx.dir)).status, 12)
  } finally { rmSync(fx.dir, { recursive: true, force: true }) }
})

test('gate: a commission with no Diff-sha256 binding line is rejected (exit 12)', () => {
  const fx = gateFixture({ bindLine: false })
  try {
    const g = runGate(fx, writeManifest(fx.dir))
    assert.equal(g.status, 12)
    assert.match(g.stderr, /Diff-sha256/)
  } finally { rmSync(fx.dir, { recursive: true, force: true }) }
})

test('gate: the fable lane validates a Fable-authored bound wrapper with fable_main_session provenance and no receipt', () => {
  const fx = gateFixture()
  try {
    const fableVerdict = join(fx.dir, 'fable.verdict')
    writeFileSync(fableVerdict, fableWrapper(fx.diffSha))
    const m = writeManifest(fx.dir, { lane: 'codex-authored', required_terminal: 'fable', fable_verdict_path: fableVerdict })
    const g = runGate(fx, m)
    assert.equal(g.status, 20, g.stderr)
    const dec = JSON.parse(readFileSync(`${fx.out}.decision.json`, 'utf8'))
    assert.equal(dec.terminal_provenance, 'fable_main_session')
  } finally { rmSync(fx.dir, { recursive: true, force: true }) }
})

test('gate: a manifest whose required_terminal contradicts its lane, or an unknown stage, is refused (exit 12)', () => {
  const fx = gateFixture()
  try {
    assert.equal(runGate(fx, writeManifest(fx.dir, { lane: 'codex-authored', required_terminal: 'sol' })).status, 12)
    assert.equal(runGate(fx, writeManifest(fx.dir, { stage: 'not-a-stage' })).status, 12)
  } finally { rmSync(fx.dir, { recursive: true, force: true }) }
})

test('gate: the lane is a CLOSED ENUM — an unknown lane refuses, and a /codex/-substring false positive no longer misclassifies', () => {
  const fx = gateFixture()
  try {
    // an unknown lane refuses at the manifest gate (exit 12, GATE-FAIL naming the field)
    const unknown = runGate(fx, writeManifest(fx.dir, { lane: 'banana' }))
    assert.equal(unknown.status, 12)
    assert.match(unknown.stderr, /manifest\.lane/)
    // the false-positive class the /codex/i heuristic admitted: 'codex-adjacent-tooling' would have been
    // misclassified as codex-authored ⇒ fable and PASSED with required_terminal 'fable'. The closed enum
    // now REFUSES it outright rather than granting it a Fable terminal.
    const falsePositive = runGate(fx, writeManifest(fx.dir, { lane: 'codex-adjacent-tooling', required_terminal: 'fable' }))
    assert.equal(falsePositive.status, 12)
    assert.match(falsePositive.stderr, /manifest\.lane/)
    // the two admissible pairs pass classification: codex-authored ⇒ fable, and every other lane ⇒ sol.
    // fresh route-ledger before each so the convergence oracle does not fire on a repeated finding set.
    const fableVerdict = join(fx.dir, 'fable.verdict'); writeFileSync(fableVerdict, fableWrapper(fx.diffSha))
    rmSync(fx.routeLedger, { force: true })
    assert.equal(runGate(fx, writeManifest(fx.dir, { lane: 'codex-authored', required_terminal: 'fable', fable_verdict_path: fableVerdict })).status, 20)
    rmSync(fx.routeLedger, { force: true })
    assert.equal(runGate(fx, writeManifest(fx.dir, { lane: 'logic', required_terminal: 'sol' })).status, 20)
  } finally { rmSync(fx.dir, { recursive: true, force: true }) }
})

test('gate: a keystone stage takes the council path from the start (exit 30) regardless of verdict', () => {
  const fx = gateFixture()
  try {
    const g = runGate(fx, writeManifest(fx.dir, { stage: 'plan-design' }))
    assert.equal(g.status, 30, g.stderr)
    assert.match(g.stdout, /DECISION:twin-council/)
    assert.equal(JSON.parse(readFileSync(`${fx.out}.decision.json`, 'utf8')).keystone, true)
  } finally { rmSync(fx.dir, { recursive: true, force: true }) }
})

test('gate: the convergence oracle precedes the APPROVED seal — an unchanged finding set escalates even on APPROVED', () => {
  const fx = gateFixture({ mode: 'approved' })
  try {
    // an APPROVED verdict has empty findings → finding_set_key '[]'. Seed a prior round (same batch_id)
    // with the same key.
    writeFileSync(fx.routeLedger, JSON.stringify({ batch_id: 'batch-x', round: 1, verdict: 'APPROVED', finding_set_key: JSON.stringify([]), diff_sha256: 'other-sha', substantive: false, decision: 'implement-r2' }) + '\n')
    const g = runGate(fx, writeManifest(fx.dir), { round: '2' })
    assert.equal(g.status, 30, g.stderr) // twin-council, NOT seal — the oracle runs regardless of verdict
    assert.match(g.stdout, /DECISION:twin-council/)
  } finally { rmSync(fx.dir, { recursive: true, force: true }) }
})

test('gate: r2 rejection ALWAYS routes to confirm-each-or-escalate — microfix-r3 is never emitted at r2-time, even with a scope artifact present', () => {
  const fx = gateFixture()
  try {
    const m = writeManifest(fx.dir)
    // no scope artifact ⇒ confirm-each-or-escalate (22)
    assert.equal(runGate(fx, m, { round: '2' }).status, 22)
    // even a valid singleton scope naming the surviving BLOCKING id (F-1) with Fable concurrence does
    // NOT promote r2 to microfix-r3 — concurrence cannot pre-exist the verdict being routed.
    const scope = join(fx.dir, 'scope.json')
    writeFileSync(scope, JSON.stringify({ surviving_blocking_id: 'F-1', sol_verdict_path: `${fx.out}.verdict`, fable_concurrence: true }))
    rmSync(fx.routeLedger, { force: true }) // fresh so the oracle does not fire on the second run
    assert.equal(runGate(fx, m, { round: '2', extra: ['--scope-artifact', scope] }).status, 22)
  } finally { rmSync(fx.dir, { recursive: true, force: true }) }
})

// ── the five surviving-finding invariants ──────────────────────────────────────────

test('gate: current-attempt freshness — a bridge-ledger VERDICT row whose input_sha256 does not match THIS commission+schema is refused (exit 12)', () => {
  const fx = gateFixture()
  try {
    // tamper the recorded input_sha256 while keeping invocation_id intact: the historical chain still
    // "validates" (receipt matches the verdict) but the row was not produced by THIS commission.
    const ledgerFile = `${fx.out}.ledger.jsonl`
    const rows = readFileSync(ledgerFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    rows[rows.length - 1].input_sha256 = 'f'.repeat(64)
    writeFileSync(ledgerFile, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
    const g = runGate(fx, writeManifest(fx.dir))
    assert.equal(g.status, 12, g.stderr)
    assert.match(g.stderr, /input_sha256 mismatch/)
    assert.ok(!existsSync(`${fx.out}.decision.json`))
  } finally { rmSync(fx.dir, { recursive: true, force: true }) }
})

test('gate: route-ledger uniqueness — a duplicate (batch_id, round) route is refused (exit 12), so a mis-relayed replay cannot route twice', () => {
  const fx = gateFixture()
  try {
    const m = writeManifest(fx.dir)
    assert.equal(runGate(fx, m).status, 20) // first r1 route appends the row
    const dup = runGate(fx, m) // same batch_id + round → duplicate
    assert.equal(dup.status, 12, dup.stderr)
    assert.match(dup.stderr, /duplicate route/)
    // the duplicate is refused BEFORE any second append — the ledger still carries exactly one row.
    assert.equal(readFileSync(fx.routeLedger, 'utf8').trim().split('\n').filter(Boolean).length, 1)
  } finally { rmSync(fx.dir, { recursive: true, force: true }) }
})

test('gate: the duplicate check, route computation, and append are ONE locked critical section — racing same-round invocations produce exactly one row', async () => {
  const fx = gateFixture()
  try {
    const m = writeManifest(fx.dir)
    const args = [
      CLI, 'gate', '--out', fx.out, '--schema', fx.schema, '--round', '1',
      '--manifest', m, '--route-ledger', fx.routeLedger, '--diff', fx.diff,
      '--floor-receipt', fx.floor, '--commission', fx.commission,
    ]
    const spawnGate = () => new Promise((res) => {
      const child = spawn(process.execPath, args, { encoding: 'utf8' })
      let stderr = ''
      child.stderr.on('data', (d) => { stderr += d })
      child.on('close', (code) => res({ code, stderr }))
    })
    // Both processes contend for the same route ledger. The shared mkdir lock serializes them: exactly
    // one reads no row and appends (exit 20); the other, next under the lock, sees the row and is refused
    // as a duplicate (exit 12). Without a single locked read+decide+append, both could observe no row.
    const [a, b] = await Promise.all([spawnGate(), spawnGate()])
    assert.deepEqual([a.code, b.code].sort((x, y) => x - y), [20, 12].sort((x, y) => x - y))
    assert.match((a.code === 12 ? a : b).stderr, /duplicate route/)
    assert.equal(readFileSync(fx.routeLedger, 'utf8').trim().split('\n').filter(Boolean).length, 1)
  } finally { rmSync(fx.dir, { recursive: true, force: true }) }
})

test('gate: posture consistency — a commission whose declared posture disagrees with the receipt tuple is refused (exit 12), a matching one passes', () => {
  // the fixture bridge runs read-only/false/false; a commission declaring workspace-write/network is a
  // mismatch the gate must catch. (bindDiff passes because that IS the prompt the bridge ran on.)
  const bad = gateFixture({ postureLine: 'workspace-write network=1 web=0' })
  try {
    const g = runGate(bad, writeManifest(bad.dir))
    assert.equal(g.status, 12, g.stderr)
    assert.match(g.stderr, /posture binding/)
  } finally { rmSync(bad.dir, { recursive: true, force: true }) }
  // the matching default posture routes cleanly (already exercised by every sol-lane test above).
  const good = gateFixture()
  try {
    assert.equal(runGate(good, writeManifest(good.dir)).status, 20)
  } finally { rmSync(good.dir, { recursive: true, force: true }) }
})

test('gate: r3 is a scoped one-item confirmation — valid scope routes microfix-r3 (21), absent scope and an out-of-scope blocking set are refused (exit 12)', () => {
  const fx = gateFixture()
  try {
    const m = writeManifest(fx.dir)
    // round 3 with NO scope artifact is illegal — exit 12
    const noScope = runGate(fx, m, { round: '3' })
    assert.equal(noScope.status, 12, noScope.stderr)
    assert.match(noScope.stderr, /round >= 3 requires a valid joint-heads scope artifact/)
    // a valid singleton scope naming the surviving BLOCKING id (F-1), whose sol_verdict_path is a
    // schema-valid A2 verdict carrying F-1 — round 3 confirms the one item ⇒ microfix-r3 (21)
    const scope = join(fx.dir, 'scope.json')
    writeFileSync(scope, JSON.stringify({ surviving_blocking_id: 'F-1', sol_verdict_path: `${fx.out}.verdict`, fable_concurrence: true }))
    rmSync(fx.routeLedger, { force: true })
    assert.equal(runGate(fx, m, { round: '3', extra: ['--scope-artifact', scope] }).status, 21)
    // a scope naming F-2 (its sol_verdict_path carries F-2) while the CURRENT verdict blocks on F-1 —
    // the blocking set is not ⊆ {F-2}, so the one-item rung refuses (exit 12)
    const otherVerdict = join(fx.dir, 'f2.verdict')
    writeFileSync(otherVerdict, JSON.stringify({ findings: [{ id: 'F-2', class: 'BLOCKING', remedy_class: 'EXACT_CHECK', location: 'l', defect: 'd', evidence: 'e' }], verdict: 'REJECTED', notes: 'n' }))
    const scope2 = join(fx.dir, 'scope2.json')
    writeFileSync(scope2, JSON.stringify({ surviving_blocking_id: 'F-2', sol_verdict_path: otherVerdict, fable_concurrence: true }))
    rmSync(fx.routeLedger, { force: true })
    const outOfScope = runGate(fx, m, { round: '3', extra: ['--scope-artifact', scope2] })
    assert.equal(outOfScope.status, 12, outOfScope.stderr)
    assert.match(outOfScope.stderr, /not a subset/)
  } finally { rmSync(fx.dir, { recursive: true, force: true }) }
})

test('gate: the Fable-terminal wrapper is bound to the current diff/batch/round — a wrong sha, batch, round, or a bare verdict is refused (exit 12)', () => {
  const fx = gateFixture()
  try {
    const path = join(fx.dir, 'fable.verdict')
    const m = writeManifest(fx.dir, { lane: 'codex-authored', required_terminal: 'fable', fable_verdict_path: path })
    // wrong diff_sha256
    writeFileSync(path, fableWrapper('a'.repeat(64)))
    assert.equal(runGate(fx, m).status, 12)
    // wrong batch_id
    rmSync(fx.routeLedger, { force: true })
    writeFileSync(path, fableWrapper(fx.diffSha, { batchId: 'batch-Z' }))
    assert.equal(runGate(fx, m).status, 12)
    // wrong round (wrapper.round=2 while the invocation is round 1)
    rmSync(fx.routeLedger, { force: true })
    writeFileSync(path, fableWrapper(fx.diffSha, { round: 2 }))
    assert.equal(runGate(fx, m).status, 12)
    // a bare A2 verdict (no wrapper envelope) is no longer admissible
    rmSync(fx.routeLedger, { force: true })
    writeFileSync(path, VALID_VERDICT)
    const bare = runGate(fx, m)
    assert.equal(bare.status, 12, bare.stderr)
    assert.match(bare.stderr, /wrapper\.verdict/)
  } finally { rmSync(fx.dir, { recursive: true, force: true }) }
})

// ── the handoff bounce ─────────────────────────────────────────────────────────────

test('check-handoff: the real templates pass their kind (incl. microfix now carrying Allowed tools / inputs), malformed bounces', () => {
  const check = (file, kind) => spawnSync(process.execPath, [CLI, 'check-handoff', file, '--kind', kind], { encoding: 'utf8' })
  assert.equal(check(TPL('brief-implementer.md'), 'brief').status, 0)
  assert.equal(check(TPL('brief-microfix.md'), 'microfix').status, 0) // the field was added
  assert.equal(check(TPL('commission-review.md'), 'commission').status, 0)
  assert.equal(check(TPL('commission-confirm.md'), 'confirm').status, 0)
  const dir = mkdtempSync(join(tmpdir(), 'kiln-handoff-'))
  try {
    const bad = join(dir, 'bad.md')
    writeFileSync(bad, '# Brief\n## Objective\nx\n## Output format\ny\n## Boundaries\nz\n## Effort tier\nw\n')
    const r = check(bad, 'brief') // missing Allowed tools / inputs
    assert.equal(r.status, 1)
    assert.match(r.stdout, /HANDOFF-BOUNCE/)
    assert.match(r.stdout, /allowed tools/)
    const missing = check(join(dir, 'nope.md'), 'brief')
    assert.equal(missing.status, 1)
    assert.match(missing.stdout, /file-not-found/)
    // the confirm instrument now REQUIRES a Scope heading (carrying Diff-sha256 + Sandbox
    // posture) so bindDiff + bindPosture work on the r3 confirmation too — a confirm without it bounces.
    const noScope = join(dir, 'confirm-no-scope.md')
    writeFileSync(noScope, '# Confirm\n## Seat\ns\n## The one item\ni\n## How to rule\nr\n## Payload-first\np\n')
    const bounced = check(noScope, 'confirm')
    assert.equal(bounced.status, 1)
    assert.match(bounced.stdout, /scope/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ── the floor receipt records FAILING TEST NAMES ────────────────────────────────────────────

// Build a stub repo whose `tests/v3/run.sh` emits the given TAP and exit code, with a stub
// `scripts/bundle-workflows.mjs` that always passes, then run the real `gate --floor` over it.
function floorRepo(tap, exitCode) {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-floor-'))
  mkdirSync(join(dir, 'tests', 'v3'), { recursive: true })
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  const runSh = join(dir, 'tests', 'v3', 'run.sh')
  writeFileSync(runSh, `#!/usr/bin/env bash\ncat <<'TAP'\n${tap}\nTAP\nexit ${exitCode}\n`)
  chmodSync(runSh, 0o755)
  writeFileSync(join(dir, 'scripts', 'bundle-workflows.mjs'), 'process.exit(0)\n')
  const diff = join(dir, 'x.diff')
  writeFileSync(diff, 'diff --git a b\n')
  return { dir, diff, out: join(dir, 'floor.json') }
}

function runFloor(fx) {
  return spawnSync(process.execPath, [CLI, 'gate', '--floor', '--repo', fx.dir, '--diff', fx.diff, '--out', fx.out], { encoding: 'utf8' })
}

test('gate --floor: a red floor receipt carries the failing test names, and the FLOOR:FAIL line names them', () => {
  const tap = [
    'TAP version 13',
    'ok 1 - alpha stays green',
    'not ok 2 - beta broke the seam',
    'not ok 3 - gamma regressed # TODO flaky',
    '1..3',
    '# tests 3',
    '# pass 1',
    '# fail 1',
    '# todo 1',
    '# skipped 0',
  ].join('\n')
  const fx = floorRepo(tap, 1)
  try {
    const r = runFloor(fx)
    assert.equal(r.status, 1, r.stderr)
    assert.match(r.stdout, /^FLOOR:FAIL /m)
    // the `# TODO` line is not a genuine failure — node tallies it under # todo, so it is
    // excluded and only the real failure's name reaches the receipt and the FLOOR line
    assert.match(r.stdout, /failing=beta broke the seam$/m)
    const receipt = JSON.parse(readFileSync(fx.out, 'utf8'))
    assert.equal(receipt.pass, false)
    assert.deepEqual(receipt.failing_tests, ['beta broke the seam'])
  } finally { rmSync(fx.dir, { recursive: true, force: true }) }
})

test('gate --floor: a green floor receipt carries failing_tests: [] (schema-stable)', () => {
  const tap = [
    'TAP version 13',
    'ok 1 - alpha',
    'ok 2 - beta',
    '1..2',
    '# tests 2',
    '# pass 2',
    '# fail 0',
    '# skipped 0',
  ].join('\n')
  const fx = floorRepo(tap, 0)
  try {
    const r = runFloor(fx)
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /^FLOOR:PASS /m)
    assert.doesNotMatch(r.stdout, /failing=/)
    const receipt = JSON.parse(readFileSync(fx.out, 'utf8'))
    assert.equal(receipt.pass, true)
    assert.deepEqual(receipt.failing_tests, [])
  } finally { rmSync(fx.dir, { recursive: true, force: true }) }
})

// ── PUBLIC-CLONE PARITY: fixtures are byte-copies of their dev-workspace originals ─────────────────
// The public suite reads its schema + templates from tests/v3/fixtures/ (byte-copies) so a clean
// public clone is self-sufficient — the dev-workspace originals under scripts/dev/ and .kiln-dev/ are
// untracked. This is a DRIFT GUARD, not a public gate: where the dev workspace is present (a dev
// checkout) each fixture MUST equal its original byte-for-byte — a mismatch means a dev contract
// changed without the fixture being re-copied. On a clean public clone the originals are absent and
// the parity check skips, so the harness stays green with nothing to compare against.
const FIXTURE_PARITY = [
  ['review-verdict-schema.json', '../../scripts/dev/review-verdict-schema.json'],
  ['brief-implementer.md', '../../.kiln-dev/templates/brief-implementer.md'],
  ['brief-microfix.md', '../../.kiln-dev/templates/brief-microfix.md'],
  ['commission-review.md', '../../.kiln-dev/templates/commission-review.md'],
  ['commission-confirm.md', '../../.kiln-dev/templates/commission-confirm.md'],
]

for (const [name, originalRel] of FIXTURE_PARITY) {
  test(`fixture parity: tests/v3/fixtures/${name} is a byte-copy of its dev-workspace original`, (t) => {
    const original = fileURLToPath(new URL(originalRel, import.meta.url))
    if (!existsSync(original)) {
      t.skip('dev workspace only — parity runs where the originals live')
      return
    }
    const fixture = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
    assert.ok(
      readFileSync(fixture).equals(readFileSync(original)),
      `${name} drifted from ${originalRel} — re-copy the fixture (cp original tests/v3/fixtures/${name})`,
    )
  })
}
