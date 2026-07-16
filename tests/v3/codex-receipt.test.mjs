// codex-receipt.test.mjs — transport-attestation floor for codex-cli 0.144.1.
// REAL_* constants are verbatim local read-only captures. SYNTHETIC_* constants
// are labeled derivations used only where distinct plain and JSON invocations must agree in a test.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deriveInvocationId, parseCodexJsonl, parseCodexStderr, resolveCodexExecutable, verifyReceipt } from '../../plugins/kiln/scripts/kiln-codex-receipt.mjs'

const CLI = fileURLToPath(new URL('../../plugins/kiln/scripts/kiln-codex-receipt.mjs', import.meta.url))
const MODEL = 'gpt-5.6-sol'
const SESSION_ID = '019f5a46-fc83-7181-8303-f516494485ac'
const OUTPUT = '{"ok":true}'
const SCHEMA = JSON.stringify({
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: false,
})

// Plain-mode stderr from codex-cli 0.144.1. Warnings are non-authoritative transcript lines;
// the parser pins the exact header/model/session/footer shapes around them.
const REAL_STDERR_01441 = `OpenAI Codex v0.144.1
--------
workdir: /DEV/kiln
model: gpt-5.6-sol
provider: openai
approval: never
sandbox: read-only
reasoning effort: low
reasoning summaries: none
session id: ${SESSION_ID}
--------
user
Return exactly this JSON object and nothing else: {"ok":true}

deprecated: \`[features].codex_hooks\` is deprecated. Use \`[features].hooks\` instead.
Enable it with \`--enable hooks\` or \`[features].hooks\` in config.toml. See https://developers.openai.com/codex/config-basic#feature-flags for details.
warning: failed to parse hooks config /home/dev/.codex/hooks.json: unknown field \`state\`, expected \`description\` or \`hooks\` at line 77 column 9
codex
{"ok":true}
tokens used
10,044
`

// JSON mode from the same local CLI release. It emits no model header or plain usage footer and
// classifies the locally installed hook warnings as error items, which rule 10 must reject.
const REAL_JSONL_ERROR_01441 = `{"type":"thread.started","thread_id":"019f5a47-fd77-7f20-b714-888d3780ad90"}
{"type":"item.completed","item":{"id":"item_0","type":"error","message":"\`[features].codex_hooks\` is deprecated. Use \`[features].hooks\` instead. (Enable it with \`--enable hooks\` or \`[features].hooks\` in config.toml. See https://developers.openai.com/codex/config-basic#feature-flags for details.)"}}
{"type":"item.completed","item":{"id":"item_1","type":"error","message":"failed to parse hooks config /home/dev/.codex/hooks.json: unknown field \`state\`, expected \`description\` or \`hooks\` at line 77 column 9"}}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"{\\"ok\\":true}"}}
{"type":"turn.completed","usage":{"input_tokens":20019,"cached_input_tokens":9984,"output_tokens":9,"reasoning_output_tokens":0}}
`

// Captured with a throwaway clean CODEX_HOME containing only auth.json. SHA-256:
// 8703d46fe73edfd6e69d90ae0b1cdc7b1206ade75b6c82c3805d4afd9bda85a2 (326 bytes).
const REAL_JSONL_CLEAN_01441 = `{"type":"thread.started","thread_id":"019f5a74-385c-70e1-b813-8e59ba19c477"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"{\\"ok\\":true}"}}
{"type":"turn.completed","usage":{"input_tokens":12143,"cached_input_tokens":9984,"output_tokens":9,"reasoning_output_tokens":0}}
`

// Plain and JSON modes cannot come from one invocation. This derivation changes only the clean
// capture's input token count so verifyReceipt can exercise agreement with REAL_STDERR_01441.
const SYNTHETIC_JSONL_RECEIPT_AGREEMENT = REAL_JSONL_CLEAN_01441.replace('"input_tokens":12143', '"input_tokens":10035')

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-codex-receipt-test-'))
  const files = {
    dir,
    prompt: join(dir, 'prompt.md'),
    packet: join(dir, 'packet.json'),
    schema: join(dir, 'schema.json'),
    output: join(dir, 'output.json'),
    stderr: join(dir, 'stderr.log'),
    ledger: join(dir, 'receipts.jsonl'),
  }
  writeFileSync(files.prompt, 'Return exactly this JSON object and nothing else: {"ok":true}\n')
  writeFileSync(files.packet, '{"keystone":"architecture"}\n')
  writeFileSync(files.schema, SCHEMA)
  return files
}

function withSandbox(fn) {
  const files = sandbox()
  try { return fn(files) } finally { rmSync(files.dir, { recursive: true, force: true }) }
}

async function withAsyncSandbox(fn) {
  const files = sandbox()
  try { return await fn(files) } finally { rmSync(files.dir, { recursive: true, force: true }) }
}

function fixture(files, options = {}) {
  const promptBytes = readFileSync(files.prompt)
  const packetBytes = readFileSync(files.packet)
  const schemaBytes = readFileSync(files.schema)
  const outputBytes = Buffer.from(options.output ?? OUTPUT)
  const stderrBytes = Buffer.from(options.stderr ?? REAL_STDERR_01441)
  const requestedModel = options.requestedModel || MODEL
  const actualExitCode = options.actualExitCode ?? 0
  const invocation = options.invocation || { runToken: 'run-302', keystone: 'architecture', phase: 'ratify', seat: 'sol', attempt: 1 }
  const promptSha256 = sha256(promptBytes)
  const packetSha256 = sha256(packetBytes)
  const inputSha256 = sha256(Buffer.from(JSON.stringify({
    parser_version: 'kiln-codex-receipt/1',
    prompt_sha256: promptSha256,
    packet_sha256: packetSha256,
  })))
  const parsed = parseCodexStderr(stderrBytes)
  const receipt = {
    receipt_version: 1,
    parser_version: 'kiln-codex-receipt/1',
    transport: 'codex_exec',
    invocation_id: deriveInvocationId({ ...invocation, inputSha256 }),
    prompt_sha256: promptSha256,
    packet_sha256: packetSha256,
    cli_version: parsed.cliVersion,
    requested_model: requestedModel,
    reported_model: parsed.reportedModel,
    session_id: parsed.sessionId,
    exit_code: actualExitCode,
    tokens_used: parsed.tokensUsed,
    output_sha256: sha256(outputBytes),
    stderr_sha256: sha256(stderrBytes),
  }
  const context = { promptBytes, packetBytes, schemaBytes, outputBytes, stderrBytes, requestedModel, actualExitCode, invocation }
  return { receipt, context, inputSha256 }
}

function cliArgs(files, overrides = {}) {
  const binding = overrides.binding || { runToken: 'run-302', keystone: 'architecture', phase: 'ratify', seat: 'sol', attempt: 1 }
  return [
    CLI, files.prompt, MODEL, 'high', files.packet, files.schema,
    overrides.output || files.output, overrides.stderr || files.stderr, files.ledger,
    binding.runToken, binding.keystone, binding.phase, binding.seat, String(binding.attempt),
  ]
}

function runCli(files, overrides = {}) {
  return spawnSync(process.execPath, cliArgs(files, overrides), { encoding: 'utf8', env: overrides.env })
}

function runCliAsync(files, overrides = {}) {
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, cliArgs(files, overrides), { env: overrides.env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => resolveResult({ code, stdout, stderr }))
  })
}

function mockCodex(root, { name = '@openai/codex', version = '0.144.1', runnable = false } = {}) {
  const packageDir = join(root, 'package')
  const packageBin = join(packageDir, 'bin')
  const pathBin = join(root, 'path-bin')
  const executable = join(packageBin, 'codex.js')
  const candidate = join(pathBin, 'codex')
  mkdirSync(packageBin, { recursive: true })
  mkdirSync(pathBin, { recursive: true })
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name, version, type: 'module' }))
  const body = runnable
    ? `#!${process.execPath}\nimport { writeFileSync } from 'node:fs'\nconst args = process.argv.slice(2)\nconst output = args[args.indexOf('--output-last-message') + 1]\nconst body = ${JSON.stringify(OUTPUT)}\nwriteFileSync(output, body)\nprocess.stdout.write(body + '\\n')\nprocess.stderr.write(${JSON.stringify(REAL_STDERR_01441)})\n`
    : `#!${process.execPath}\n`
  writeFileSync(executable, body)
  chmodSync(executable, 0o755)
  symlinkSync(executable, candidate)
  return { pathBin, candidate, executable }
}

test('valid 0.144.1 stderr verifies the exact receipt schema and envelope inputs', () => withSandbox((files) => {
  const { receipt, context } = fixture(files)
  assert.deepEqual(Object.keys(receipt), [
    'receipt_version', 'parser_version', 'transport', 'invocation_id', 'prompt_sha256',
    'packet_sha256', 'cli_version', 'requested_model', 'reported_model', 'session_id',
    'exit_code', 'tokens_used', 'output_sha256', 'stderr_sha256',
  ])
  assert.equal(receipt.cli_version, '0.144.1')
  assert.equal(receipt.session_id, SESSION_ID)
  assert.equal(receipt.tokens_used, 10044)
  assert.deepEqual(verifyReceipt(receipt, context), { ok: true })
  const envelope = { payload: JSON.parse(OUTPUT), codex_receipt: receipt, raw_artifact_refs: { stderr: files.stderr, output: files.output } }
  assert.deepEqual(Object.keys(envelope), ['payload', 'codex_receipt', 'raw_artifact_refs'])
}))

test('receipt fields inherited from the prototype fail closed', () => withSandbox((files) => {
  const { receipt, context } = fixture(files)
  assert.throws(() => verifyReceipt(Object.create(receipt), context), /receipt is missing 'receipt_version'/)
}))

test('real clean 0.144.1 JSONL capture parses with one terminal usage and no error events', () => {
  const bytes = Buffer.from(REAL_JSONL_CLEAN_01441)
  assert.equal(bytes.length, 326)
  assert.equal(sha256(bytes), '8703d46fe73edfd6e69d90ae0b1cdc7b1206ade75b6c82c3805d4afd9bda85a2')
  const parsed = parseCodexJsonl(bytes)
  assert.equal(parsed.events.length, 4)
  assert.equal(parsed.tokensUsed, 12152)
  assert.deepEqual(parsed.usage, { input_tokens: 12143, cached_input_tokens: 9984, output_tokens: 9, reasoning_output_tokens: 0 })
})

test('JSONL error events are rejected', () => {
  assert.throws(() => parseCodexJsonl(Buffer.from(REAL_JSONL_ERROR_01441)), /error event/)
})

test('synthetic clean-capture derivation enforces terminal usage agreement with the receipt', () => withSandbox((files) => {
  const { receipt, context } = fixture(files)
  assert.equal(parseCodexJsonl(Buffer.from(SYNTHETIC_JSONL_RECEIPT_AGREEMENT)).tokensUsed, 10044)
  assert.deepEqual(verifyReceipt(receipt, { ...context, jsonlBytes: Buffer.from(SYNTHETIC_JSONL_RECEIPT_AGREEMENT) }), { ok: true })
  const disagreeing = SYNTHETIC_JSONL_RECEIPT_AGREEMENT.replace('"input_tokens":10035', '"input_tokens":10034')
  assert.throws(() => verifyReceipt(receipt, { ...context, jsonlBytes: Buffer.from(disagreeing) }), /disagrees/)
}))

test('multiple model lines fail closed', () => withSandbox((files) => {
  const stderr = REAL_STDERR_01441.replace('model: gpt-5.6-sol\n', 'model: gpt-5.6-sol\nmodel: gpt-5.6-sol\n')
  assert.throws(() => parseCodexStderr(Buffer.from(stderr)), /exactly one model line, found 2/)
}))

test('missing usage fails closed', () => {
  const stderr = REAL_STDERR_01441.replace('tokens used\n10,044\n', '')
  assert.throws(() => parseCodexStderr(Buffer.from(stderr)), /tokens used footer, found 0/)
})

test('comma-formatted token counts normalize to an integer', () => {
  assert.equal(parseCodexStderr(Buffer.from(REAL_STDERR_01441)).tokensUsed, 10044)
})

test('hash tampering invalidates an otherwise verified receipt', () => withSandbox((files) => {
  const { receipt, context } = fixture(files)
  assert.throws(() => verifyReceipt(receipt, { ...context, outputBytes: Buffer.from('{"ok":false}') }), /output_sha256 mismatch/)
  assert.throws(() => verifyReceipt({ ...receipt, prompt_sha256: '0'.repeat(64) }, context), /prompt_sha256 mismatch/)
}))

test('empty output and a nonzero exit are honest failures', () => withSandbox((files) => {
  const empty = fixture(files, { output: '' })
  assert.throws(() => verifyReceipt(empty.receipt, empty.context), /output is empty/)
  const failed = fixture(files, { actualExitCode: 7 })
  assert.throws(() => verifyReceipt(failed.receipt, failed.context), /Codex exited 7/)
}))

test('wrong reported model and fallback requests cannot sign the required Sol seat', () => withSandbox((files) => {
  const fallbackStderr = REAL_STDERR_01441.replace('model: gpt-5.6-sol', 'model: gpt-5.5')
  const wrong = fixture(files, { stderr: fallbackStderr })
  assert.throws(() => verifyReceipt(wrong.receipt, wrong.context), /required Sol seat must use pinned model/)
  const fallback = fixture(files, { stderr: fallbackStderr, requestedModel: 'gpt-5.5' })
  assert.throws(() => verifyReceipt(fallback.receipt, fallback.context), /required Sol seat must use pinned model/)
}))

test('duplicate invocation IDs replay-reject before Codex can spawn; attempt is bound into the ID', () => withSandbox((files) => {
  const first = fixture(files)
  writeFileSync(files.ledger, JSON.stringify({
    parser_version: 'kiln-codex-receipt/1',
    status: 'started',
    invocation_id: first.receipt.invocation_id,
    prompt_sha256: first.receipt.prompt_sha256,
    packet_sha256: first.receipt.packet_sha256,
  }) + '\n')
  const replay = runCli(files)
  assert.notEqual(replay.status, 0)
  assert.equal(replay.stdout, '')
  assert.match(replay.stderr, /replay rejected/)
  assert.equal(readFileSync(files.ledger, 'utf8').trim().split('\n').length, 1)
  const next = fixture(files, { invocation: { ...first.context.invocation, attempt: 2 } })
  assert.notEqual(next.receipt.invocation_id, first.receipt.invocation_id)
}))

test('two concurrent receipt reservations on one ledger retry the lock and both verify', async () => withAsyncSandbox(async (files) => {
  const mock = mockCodex(join(files.dir, 'valid-codex'), { runnable: true })
  const env = { ...process.env, PATH: `${mock.pathBin}${delimiter}${process.env.PATH ?? ''}` }
  const lockDir = `${files.ledger}.lock`
  mkdirSync(lockDir)
  writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, ts: new Date().toISOString(), token: 'test-gate' }))

  const first = runCliAsync(files, {
    output: join(files.dir, 'output-1.json'),
    stderr: join(files.dir, 'stderr-1.log'),
    binding: { runToken: 'run-302', keystone: 'architecture', phase: 'ratify', seat: 'sol', attempt: 1 },
    env,
  })
  const second = runCliAsync(files, {
    output: join(files.dir, 'output-2.json'),
    stderr: join(files.dir, 'stderr-2.log'),
    binding: { runToken: 'run-302', keystone: 'architecture', phase: 'ratify', seat: 'sol', attempt: 2 },
    env,
  })
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 150))
  rmSync(lockDir, { recursive: true, force: true })

  const results = await Promise.all([first, second])
  for (const result of results) assert.equal(result.code, 0, result.stderr)
  const entries = readFileSync(files.ledger, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(entries.filter((entry) => entry.status === 'started').length, 2)
  assert.equal(entries.filter((entry) => entry.status === 'verified').length, 2)
  assert.equal(new Set(entries.map((entry) => entry.invocation_id)).size, 2)
  assert.ok(!existsSync(lockDir))
}))

test('wedged receipt lock reports dead owner and safe out-of-band recovery', () => withSandbox((files) => {
  const lockDir = `${files.ledger}.lock`
  mkdirSync(lockDir)
  const deadPid = spawnSync(process.execPath, ['-e', 'process.exit(0)']).pid
  const ownerTs = new Date().toISOString()
  writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: deadPid, ts: ownerTs, token: 'dead-holder' }))

  const started = Date.now()
  const blocked = runCli(files)
  const waited = Date.now() - started
  assert.equal(blocked.status, 1, blocked.stdout)
  assert.ok(waited >= 4500, `must hold the lock deadline, waited ${waited}ms`)
  assert.match(blocked.stderr, /could not acquire receipt ledger lock/)
  assert.ok(blocked.stderr.includes(lockDir))
  assert.match(blocked.stderr, new RegExp(`pid ${deadPid}`))
  assert.ok(blocked.stderr.includes(ownerTs))
  assert.match(blocked.stderr, /kiln-codex-receipt\.mjs unlock/)
  assert.match(blocked.stderr, /refuses while the holder is alive/)

  const unlocked = spawnSync(process.execPath, [CLI, 'unlock', files.ledger], { encoding: 'utf8' })
  assert.equal(unlocked.status, 0, unlocked.stderr)
  assert.ok(!existsSync(lockDir))

  mkdirSync(lockDir)
  writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, ts: ownerTs, token: 'live-holder' }))
  const refused = spawnSync(process.execPath, [CLI, 'unlock', files.ledger], { encoding: 'utf8' })
  assert.equal(refused.status, 1)
  assert.match(refused.stderr, /LIVE process/)
  assert.ok(existsSync(lockDir))
}))

test('PATH Codex discovery accepts only a verified package name and version', () => withSandbox((files) => {
  const valid = mockCodex(join(files.dir, 'valid'))
  const wrongName = mockCodex(join(files.dir, 'wrong-name'), { name: '@example/codex' })
  const wrongVersion = mockCodex(join(files.dir, 'wrong-version'), { version: '0.145.0' })
  const isolated = { home: join(files.dir, 'empty-home'), standardRoots: [] }

  assert.throws(
    () => resolveCodexExecutable({ ...isolated, path: `${wrongName.pathBin}${delimiter}${wrongVersion.pathBin}` }),
    /trusted @openai\/codex 0\.144\.1 executable not found/,
  )
  assert.equal(
    resolveCodexExecutable({ ...isolated, path: `${wrongName.pathBin}${delimiter}${wrongVersion.pathBin}${delimiter}${valid.pathBin}` }),
    realpathSync(valid.candidate),
  )
}))

test('parser version 1 rejects future CLI semver and malformed header drift', () => {
  assert.throws(() => parseCodexStderr(Buffer.from(REAL_STDERR_01441.replace('v0.144.1', 'v0.145.0'))), /only accepts Codex 0.144.1/)
  assert.throws(() => parseCodexStderr(Buffer.from(REAL_STDERR_01441.replace('v0.144.1', 'v0.144.1-dev'))), /semver header/)
})

test('schema-invalid output and aliased artifact paths fail closed', () => withSandbox((files) => {
  const invalid = fixture(files, { output: '{"ok":"yes"}' })
  assert.throws(() => verifyReceipt(invalid.receipt, invalid.context), /violates schema/)
  const aliased = runCli(files, { output: files.stderr })
  assert.notEqual(aliased.status, 0)
  assert.equal(aliased.stdout, '')
  assert.match(aliased.stderr, /stderrFile aliases outputFile/)
}))

test('required checks only own payload properties', () => withSandbox((files) => {
  writeFileSync(files.schema, JSON.stringify({ type: 'object', required: ['toString'] }))
  const inheritedOnly = fixture(files, { output: '{}' })
  assert.throws(
    () => verifyReceipt(inheritedOnly.receipt, inheritedOnly.context),
    /missing required property 'toString'/,
  )
}))

test('string length bounds count Unicode code points', () => withSandbox((files) => {
  writeFileSync(files.schema, JSON.stringify({ type: 'string', minLength: 2 }))
  const tooShort = fixture(files, { output: JSON.stringify('😀') })
  assert.throws(() => verifyReceipt(tooShort.receipt, tooShort.context), /shorter than minLength/)

  writeFileSync(files.schema, JSON.stringify({ type: 'string', maxLength: 1 }))
  const tooLong = fixture(files, { output: JSON.stringify('😀a') })
  assert.throws(() => verifyReceipt(tooLong.receipt, tooLong.context), /longer than maxLength/)

  const oneCodePoint = fixture(files, { output: JSON.stringify('😀') })
  assert.equal(verifyReceipt(oneCodePoint.receipt, oneCodePoint.context), '😀')
}))

test('properties dispatch treats prototype-named payload keys as own schema keys only', () => withSandbox((files) => {
  for (const key of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
    writeFileSync(files.schema, JSON.stringify({ type: 'object', properties: {}, additionalProperties: false }))
    const unknown = fixture(files, { output: JSON.stringify({ [key]: 'value' }) })
    assert.throws(() => verifyReceipt(unknown.receipt, unknown.context), new RegExp(`unknown property '${key}'`))

    writeFileSync(files.schema, JSON.stringify({
      type: 'object',
      properties: { [key]: { type: 'string' } },
      additionalProperties: false,
    }))
    const declared = fixture(files, { output: JSON.stringify({ [key]: 'value' }) })
    assert.deepEqual(verifyReceipt(declared.receipt, declared.context), { [key]: 'value' })

    const wrongType = fixture(files, { output: JSON.stringify({ [key]: 1 }) })
    assert.throws(() => verifyReceipt(wrongType.receipt, wrongType.context), /expected type string/)
  }
}))

test('numeric validation preserves exact JSON decimal semantics', () => withSandbox((files) => {
  writeFileSync(files.schema, JSON.stringify({ type: 'integer' }))
  const roundedFraction = fixture(files, { output: '4500000000000000.1' })
  assert.throws(() => verifyReceipt(roundedFraction.receipt, roundedFraction.context), /expected type integer/)

  writeFileSync(files.schema, '{"const":9007199254740992}')
  const distinctConst = fixture(files, { output: '9007199254740993' })
  assert.throws(() => verifyReceipt(distinctConst.receipt, distinctConst.context), /does not equal const/)

  writeFileSync(files.schema, '{"enum":[9007199254740992]}')
  const distinctEnum = fixture(files, { output: '9007199254740993' })
  assert.throws(() => verifyReceipt(distinctEnum.receipt, distinctEnum.context), /not in enum/)

  writeFileSync(files.schema, '{"type":"array","uniqueItems":true}')
  const distinctItems = fixture(files, { output: '[9007199254740992,9007199254740993]' })
  assert.doesNotThrow(() => verifyReceipt(distinctItems.receipt, distinctItems.context))

  writeFileSync(files.schema, '{"maximum":9007199254740992}')
  const aboveMaximum = fixture(files, { output: '9007199254740993' })
  assert.throws(() => verifyReceipt(aboveMaximum.receipt, aboveMaximum.context), /above maximum/)

  writeFileSync(files.schema, '{"minimum":1e-400}')
  const belowMinimum = fixture(files, { output: '0' })
  assert.throws(() => verifyReceipt(belowMinimum.receipt, belowMinimum.context), /below minimum/)

  writeFileSync(files.schema, '{"exclusiveMaximum":1e400}')
  const overflowedMaximum = fixture(files, { output: '2e400' })
  assert.throws(() => verifyReceipt(overflowedMaximum.receipt, overflowedMaximum.context), /not below exclusiveMaximum/)
}))

test('uniqueItems rejects duplicate objects whose keys have different insertion order', () => withSandbox((files) => {
  writeFileSync(files.schema, JSON.stringify({ type: 'array', uniqueItems: true }))
  const invalid = fixture(files, { output: '[{"a":1,"b":2},{"b":2,"a":1}]' })
  assert.throws(() => verifyReceipt(invalid.receipt, invalid.context), /items are not unique/)
}))

test('const and enum accept equal objects whose keys have different insertion order', () => withSandbox((files) => {
  writeFileSync(files.schema, JSON.stringify({ const: { a: 1, nested: { b: 2, c: 3 } } }))
  const constMatch = fixture(files, { output: '{"nested":{"c":3,"b":2},"a":1}' })
  assert.deepEqual(verifyReceipt(constMatch.receipt, constMatch.context), { nested: { c: 3, b: 2 }, a: 1 })

  writeFileSync(files.schema, JSON.stringify({ enum: [{ a: 1, nested: { b: 2, c: 3 } }] }))
  const enumMatch = fixture(files, { output: '{"nested":{"c":3,"b":2},"a":1}' })
  assert.deepEqual(verifyReceipt(enumMatch.receipt, enumMatch.context), { nested: { c: 3, b: 2 }, a: 1 })
}))
