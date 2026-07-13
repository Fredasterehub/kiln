#!/usr/bin/env node
// kiln-codex-receipt.mjs — the receipt-bearing Codex transport. Zero dependencies, plain node ≥18.
//
// The process boundary, not the requesting wrapper, owns prompt delivery, raw capture, receipt
// fields, verification, and replay state. Plain stderr is the 0.144.1 attestation surface: JSONL
// omits the model header and usage footer, so parser version 1 cannot combine both modes without
// weakening rules 1–4. JSONL verification remains fail-closed for callers that capture it elsewhere.
// Capability tiering stays above this boundary: only a run that promised both council heads treats
// a failed invocation as twin degradation; lower tiers must not use it to claim a council receipt.
//
// Usage:
//   kiln-codex-receipt.mjs <prompt-file> <model> <effort> <packet-file> <schema-file> <output-file> <stderr-file> <receipt-ledger-jsonl> <run-token> <keystone> <phase> <seat> <attempt>
//   kiln-codex-receipt.mjs unlock <receipt-ledger-jsonl>
// Exit codes: 0 verified receipt on stdout · 1 transport/verification failure · 2 usage.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { basename, delimiter, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CODEX_MODEL } from '../src/models.mjs'

const RECEIPT_VERSION = 1
const PARSER_VERSION = 'kiln-codex-receipt/1'
const CLI_VERSION = '0.144.1'
const TRANSPORT = 'codex_exec'
const EXACT_NUMBER = Symbol('kiln.exactNumber')
const SHA_RE = /^[0-9a-f]{64}$/
const MODEL_RE = /^[a-z0-9][a-z0-9._-]*$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const RECEIPT_KEYS = [
  'receipt_version', 'parser_version', 'transport', 'invocation_id', 'prompt_sha256',
  'packet_sha256', 'cli_version', 'requested_model', 'reported_model', 'session_id',
  'exit_code', 'tokens_used', 'output_sha256', 'stderr_sha256',
]
const USAGE = 'usage: kiln-codex-receipt.mjs <prompt-file> <model> <effort> <packet-file> <schema-file> <output-file> <stderr-file> <receipt-ledger-jsonl> <run-token> <keystone> <phase> <seat> <attempt> | kiln-codex-receipt.mjs unlock <receipt-ledger-jsonl>'
const die = (msg, code = 1) => { console.error(`kiln-codex-receipt: ${msg}`); process.exit(code) }
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
const isExactNumber = (x) => isObj(x) && x[EXACT_NUMBER] === true
const isJsonObj = (x) => isObj(x) && !isExactNumber(x)
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

function decodeUtf8(bytes, label) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new Error(`${label}: not valid UTF-8`) }
}

function atomicWrite(file, bytes) {
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, bytes)
  renameSync(tmp, file)
}

function oneMatch(lines, regex, label) {
  const matches = lines.map((line) => line.match(regex)).filter(Boolean)
  if (matches.length !== 1) throw new Error(`stderr format drift: expected exactly one ${label}, found ${matches.length}`)
  return matches[0][1]
}

export function parseCodexStderr(stderrBytes) {
  const lines = decodeUtf8(stderrBytes, 'stderr').split(/\r?\n/)
  const cliVersion = oneMatch(lines, /^OpenAI Codex v(\d+\.\d+\.\d+)$/, 'Codex semver header')
  if (cliVersion !== CLI_VERSION) throw new Error(`stderr format drift: parser ${PARSER_VERSION} only accepts Codex ${CLI_VERSION}`)
  const reportedModel = oneMatch(lines, /^model: ([a-z0-9][a-z0-9._-]*)$/, 'model line')
  const sessionId = oneMatch(lines, new RegExp(`^session id: (${UUID_RE.source.slice(1, -1)})$`), 'session id')
  const usageIndexes = []
  lines.forEach((line, i) => { if (line === 'tokens used') usageIndexes.push(i) })
  if (usageIndexes.length !== 1) throw new Error(`stderr format drift: expected exactly one tokens used footer, found ${usageIndexes.length}`)
  const tokenLine = lines[usageIndexes[0] + 1]
  if (tokenLine === undefined || !/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/.test(tokenLine)) {
    throw new Error('stderr format drift: tokens used must be followed immediately by a numeric line')
  }
  const tokensUsed = Number(tokenLine.replaceAll(',', ''))
  if (!Number.isSafeInteger(tokensUsed) || tokensUsed < 0) throw new Error('stderr format drift: token count is outside the safe integer range')
  return { cliVersion, reportedModel, sessionId, tokensUsed }
}

function containsErrorEvent(value) {
  if (Array.isArray(value)) return value.some(containsErrorEvent)
  if (!isObj(value)) return false
  if (value.type === 'error') return true
  return Object.values(value).some(containsErrorEvent)
}

export function parseCodexJsonl(jsonlBytes) {
  const raw = decodeUtf8(jsonlBytes, 'JSONL capture')
  const lines = raw.split(/\r?\n/).filter((line) => line !== '')
  if (!lines.length) throw new Error('JSONL capture is empty')
  const events = lines.map((line, i) => {
    try { return JSON.parse(line) } catch { throw new Error(`JSONL line ${i + 1} is malformed`) }
  })
  if (events.some(containsErrorEvent)) throw new Error('JSONL capture contains an error event')
  const terminals = events.filter((event) => event?.type === 'turn.completed' && isObj(event.usage))
  if (terminals.length !== 1) throw new Error(`JSONL capture must contain exactly one terminal usage object, found ${terminals.length}`)
  const usage = terminals[0].usage
  for (const key of ['input_tokens', 'output_tokens']) {
    if (!Number.isSafeInteger(usage[key]) || usage[key] < 0) throw new Error(`JSONL terminal usage.${key} must be a nonnegative safe integer`)
  }
  const tokensUsed = usage.input_tokens + usage.output_tokens
  if (!Number.isSafeInteger(tokensUsed)) throw new Error('JSONL terminal token total is outside the safe integer range')
  return { events, tokensUsed, usage }
}

function exactNumber(raw) {
  const match = raw.match(/^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/)
  if (!match) throw new Error(`invalid JSON number '${raw}'`)
  const fraction = match[3] ?? ''
  let digits = `${match[2]}${fraction}`.replace(/^0+/, '')
  if (digits === '') return Object.freeze({ [EXACT_NUMBER]: true, sign: 0, digits: '0', exponent: 0n })
  let exponent = BigInt(match[4] ?? '0') - BigInt(fraction.length)
  const trailingZeros = digits.match(/0+$/)?.[0].length ?? 0
  if (trailingZeros) {
    digits = digits.slice(0, -trailingZeros)
    exponent += BigInt(trailingZeros)
  }
  return Object.freeze({ [EXACT_NUMBER]: true, sign: match[1] === '-' ? -1 : 1, digits, exponent })
}

function compareExactNumbers(a, b) {
  if (a.sign !== b.sign) return a.sign < b.sign ? -1 : 1
  if (a.sign === 0) return 0
  const magnitudeA = BigInt(a.digits.length) + a.exponent
  const magnitudeB = BigInt(b.digits.length) + b.exponent
  let comparison
  if (magnitudeA !== magnitudeB) comparison = magnitudeA < magnitudeB ? -1 : 1
  else {
    const width = Math.max(a.digits.length, b.digits.length)
    const digitsA = a.digits.padEnd(width, '0')
    const digitsB = b.digits.padEnd(width, '0')
    comparison = digitsA === digitsB ? 0 : digitsA < digitsB ? -1 : 1
  }
  return a.sign < 0 ? -comparison : comparison
}

const exactInteger = (value) => isExactNumber(value) && (value.sign === 0 || value.exponent >= 0n)
const exactNonnegativeInteger = (value) => exactInteger(value) && value.sign >= 0
const exactLength = (length) => exactNumber(String(length))

function schemaTypeMatches(value, type) {
  if (type === 'null') return value === null
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return isJsonObj(value)
  if (type === 'integer') return exactInteger(value)
  if (type === 'number') return isExactNumber(value)
  return typeof value === type
}

function canonicalJson(value) {
  if (isExactNumber(value)) return `n:${value.sign}:${value.digits}e${value.exponent}`
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isJsonObj(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function codePointLength(value) {
  let length = 0
  for (const _character of value) length += 1
  return length
}

function schemaErrors(value, schema, path = '$') {
  if (!isJsonObj(schema)) return [`${path}: schema node must be an object`]
  const supported = new Set([
    '$schema', 'title', 'description', 'default', 'examples', 'type', 'const', 'enum', 'anyOf',
    'oneOf', 'allOf', 'properties', 'required', 'additionalProperties', 'items', 'minItems',
    'maxItems', 'uniqueItems', 'minLength', 'maxLength', 'pattern', 'minimum', 'maximum',
    'exclusiveMinimum', 'exclusiveMaximum',
  ])
  const errors = []
  for (const key of Object.keys(schema)) if (!supported.has(key)) errors.push(`${path}: unsupported schema keyword '${key}'`)
  if (Object.hasOwn(schema, 'const') && canonicalJson(value) !== canonicalJson(schema.const)) errors.push(`${path}: does not equal const`)
  if (Object.hasOwn(schema, 'enum') && (!Array.isArray(schema.enum) || !schema.enum.some((x) => canonicalJson(x) === canonicalJson(value)))) errors.push(`${path}: not in enum`)
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    if (!Object.hasOwn(schema, key)) continue
    if (!Array.isArray(schema[key]) || !schema[key].length) { errors.push(`${path}: ${key} must be a nonempty array`); continue }
    const branchErrors = schema[key].map((branch) => schemaErrors(value, branch, path))
    const passing = branchErrors.filter((branch) => branch.length === 0).length
    if (key === 'anyOf' && passing === 0) errors.push(`${path}: matches no anyOf branch`)
    if (key === 'oneOf' && passing !== 1) errors.push(`${path}: must match exactly one oneOf branch`)
    if (key === 'allOf') branchErrors.forEach((branch) => errors.push(...branch))
  }
  if (Object.hasOwn(schema, 'type')) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.length || types.some((type) => !['null', 'boolean', 'object', 'array', 'number', 'integer', 'string'].includes(type))) errors.push(`${path}: unsupported schema type`)
    else if (!types.some((type) => schemaTypeMatches(value, type))) errors.push(`${path}: expected type ${types.join('|')}`)
  }
  if (isJsonObj(value)) {
    const properties = Object.hasOwn(schema, 'properties') ? schema.properties : {}
    if (!isJsonObj(properties)) errors.push(`${path}: properties must be an object`)
    const required = Object.hasOwn(schema, 'required') ? schema.required : []
    if (!Array.isArray(required) || required.some((key) => typeof key !== 'string')) errors.push(`${path}: required must be an array of strings`)
    else required.forEach((key) => { if (!Object.hasOwn(value, key)) errors.push(`${path}: missing required property '${key}'`) })
    if (isJsonObj(properties)) {
      for (const [key, child] of Object.entries(value)) {
        if (Object.hasOwn(properties, key)) errors.push(...schemaErrors(child, properties[key], `${path}.${key}`))
        else if (Object.hasOwn(schema, 'additionalProperties') && schema.additionalProperties === false) errors.push(`${path}: unknown property '${key}'`)
        else if (Object.hasOwn(schema, 'additionalProperties') && isJsonObj(schema.additionalProperties)) errors.push(...schemaErrors(child, schema.additionalProperties, `${path}.${key}`))
      }
    }
    if (Object.hasOwn(schema, 'additionalProperties') && schema.additionalProperties !== true && schema.additionalProperties !== false && !isJsonObj(schema.additionalProperties)) errors.push(`${path}: additionalProperties must be boolean or schema`)
  }
  if (Array.isArray(value)) {
    if (Object.hasOwn(schema, 'minItems') && (!exactNonnegativeInteger(schema.minItems) || compareExactNumbers(exactLength(value.length), schema.minItems) < 0)) errors.push(`${path}: fewer than minItems`)
    if (Object.hasOwn(schema, 'maxItems') && (!exactNonnegativeInteger(schema.maxItems) || compareExactNumbers(exactLength(value.length), schema.maxItems) > 0)) errors.push(`${path}: more than maxItems`)
    if (Object.hasOwn(schema, 'uniqueItems') && schema.uniqueItems === true && new Set(value.map(canonicalJson)).size !== value.length) errors.push(`${path}: items are not unique`)
    if (Object.hasOwn(schema, 'items')) value.forEach((item, i) => errors.push(...schemaErrors(item, schema.items, `${path}[${i}]`)))
  }
  if (typeof value === 'string') {
    const length = exactLength(codePointLength(value))
    if (Object.hasOwn(schema, 'minLength') && (!exactNonnegativeInteger(schema.minLength) || compareExactNumbers(length, schema.minLength) < 0)) errors.push(`${path}: shorter than minLength`)
    if (Object.hasOwn(schema, 'maxLength') && (!exactNonnegativeInteger(schema.maxLength) || compareExactNumbers(length, schema.maxLength) > 0)) errors.push(`${path}: longer than maxLength`)
    if (Object.hasOwn(schema, 'pattern')) {
      try { if (typeof schema.pattern !== 'string' || !new RegExp(schema.pattern, 'u').test(value)) errors.push(`${path}: does not match pattern`) } catch { errors.push(`${path}: invalid schema pattern`) }
    }
  }
  if (isExactNumber(value)) {
    if (Object.hasOwn(schema, 'minimum') && (!isExactNumber(schema.minimum) || compareExactNumbers(value, schema.minimum) < 0)) errors.push(`${path}: below minimum`)
    if (Object.hasOwn(schema, 'maximum') && (!isExactNumber(schema.maximum) || compareExactNumbers(value, schema.maximum) > 0)) errors.push(`${path}: above maximum`)
    if (Object.hasOwn(schema, 'exclusiveMinimum') && (!isExactNumber(schema.exclusiveMinimum) || compareExactNumbers(value, schema.exclusiveMinimum) <= 0)) errors.push(`${path}: not above exclusiveMinimum`)
    if (Object.hasOwn(schema, 'exclusiveMaximum') && (!isExactNumber(schema.exclusiveMaximum) || compareExactNumbers(value, schema.exclusiveMaximum) >= 0)) errors.push(`${path}: not below exclusiveMaximum`)
  }
  return errors
}

function exactJsonNumbers(text, parsed) {
  let marker = '\u0000kiln-exact-number:'
  const markerUsed = (value) => {
    if (typeof value === 'string') return value.startsWith(marker)
    if (Array.isArray(value)) return value.some(markerUsed)
    if (isObj(value)) return Object.values(value).some(markerUsed)
    return false
  }
  while (markerUsed(parsed)) marker += ':'

  let transformed = ''
  let index = 0
  for (let i = 0; i < text.length;) {
    if (text[i] === '"') {
      const start = i++
      while (i < text.length) {
        if (text[i] === '\\') i += 2
        else if (text[i++] === '"') break
      }
      transformed += text.slice(start, i)
      continue
    }
    if (text[i] === '-' || /\d/.test(text[i])) {
      const raw = text.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/)[0]
      transformed += JSON.stringify(`${marker}${index++}:${raw}`)
      i += raw.length
      continue
    }
    transformed += text[i++]
  }

  const restore = (value) => {
    if (typeof value === 'string' && value.startsWith(marker)) {
      const separator = value.indexOf(':', marker.length)
      return exactNumber(value.slice(separator + 1))
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) value[i] = restore(value[i])
    } else if (isObj(value)) {
      for (const key of Object.keys(value)) value[key] = restore(value[key])
    }
    return value
  }
  return restore(JSON.parse(transformed))
}

function parseJsonFile(bytes, label, withExactNumbers = false) {
  const text = decodeUtf8(bytes, label)
  try {
    const value = JSON.parse(text)
    return withExactNumbers ? { value, exactValue: exactJsonNumbers(text, value) } : value
  } catch (e) { throw new Error(`${label}: ${e.message}`) }
}

function canonicalInvocationInput(promptSha256, packetSha256) {
  return sha256(Buffer.from(JSON.stringify({ parser_version: PARSER_VERSION, prompt_sha256: promptSha256, packet_sha256: packetSha256 })))
}

function codexTransportInput(promptBytes, packetBytes, packetSha256) {
  decodeUtf8(promptBytes, 'prompt')
  decodeUtf8(packetBytes, 'packet')
  return Buffer.concat([
    promptBytes,
    Buffer.from(`\n\n## Frozen input packet\nSHA-256: ${packetSha256}\n\n`),
    packetBytes,
    Buffer.from('\n'),
  ])
}

export function resolveCodexExecutable(options = {}) {
  const home = options.home ?? userInfo().homedir
  const pathValue = options.path ?? process.env.PATH ?? ''
  const standardRoots = options.standardRoots ?? [
    join(home, '.npm-global', 'bin', 'codex'),
    join(home, '.local', 'bin', 'codex'),
    '/usr/local/bin/codex',
    '/usr/bin/codex',
  ]
  const candidates = pathValue.split(delimiter).filter(Boolean).map((dir) => join(dir, 'codex'))
  candidates.push(...standardRoots)
  const nvmRoot = join(home, '.nvm', 'versions', 'node')
  if (existsSync(nvmRoot)) {
    for (const version of readdirSync(nvmRoot).sort().reverse()) candidates.push(join(nvmRoot, version, 'bin', 'codex'))
  }
  for (const candidate of new Set(candidates)) {
    if (!existsSync(candidate)) continue
    let executable
    try { executable = realpathSync(candidate) } catch { continue }
    if (basename(executable) !== 'codex.js') continue
    const packageFile = join(dirname(executable), '..', 'package.json')
    if (!existsSync(packageFile)) continue
    let pkg
    try { pkg = JSON.parse(readFileSync(packageFile, 'utf8')) } catch { continue }
    if (pkg.name === '@openai/codex' && pkg.version === CLI_VERSION) return executable
  }
  throw new Error(`trusted @openai/codex ${CLI_VERSION} executable not found on PATH or in standard install roots`)
}

function canonicalFile(file) {
  if (existsSync(file)) return realpathSync(file)
  return join(realpathSync(dirname(file)), basename(file))
}

function requireDistinctFiles(namedFiles) {
  const seen = new Map()
  for (const [label, file] of Object.entries(namedFiles)) {
    const canonical = canonicalFile(file)
    if (seen.has(canonical)) throw new Error(`${label} aliases ${seen.get(canonical)}: ${canonical}`)
    seen.set(canonical, label)
  }
}

export function deriveInvocationId({ runToken, keystone, phase, seat, attempt, inputSha256 }) {
  if (![runToken, keystone, phase, seat].every((x) => typeof x === 'string' && x.length > 0)) throw new Error('invocation binding fields must be nonempty strings')
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('invocation attempt must be an integer >= 1')
  if (!SHA_RE.test(inputSha256)) throw new Error('invocation input hash must be sha256')
  return sha256(Buffer.from(JSON.stringify({
    parser_version: PARSER_VERSION,
    run_token: runToken,
    keystone,
    phase,
    seat,
    attempt,
    input_sha256: inputSha256,
  })))
}

export function verifyReceipt(receipt, context) {
  if (!isObj(receipt)) throw new Error('receipt is not an object')
  const keys = Object.keys(receipt)
  for (const key of keys) if (!RECEIPT_KEYS.includes(key)) throw new Error(`receipt has unknown key '${key}'`)
  for (const key of RECEIPT_KEYS) if (!Object.hasOwn(receipt, key)) throw new Error(`receipt is missing '${key}'`)
  if (receipt.receipt_version !== RECEIPT_VERSION) throw new Error('receipt version drift')
  if (receipt.parser_version !== PARSER_VERSION) throw new Error('parser version drift')
  if (receipt.transport !== TRANSPORT) throw new Error('transport mismatch')
  if (!SHA_RE.test(receipt.invocation_id)) throw new Error('invocation_id is not sha256')
  for (const key of ['prompt_sha256', 'packet_sha256', 'output_sha256', 'stderr_sha256']) if (!SHA_RE.test(receipt[key])) throw new Error(`${key} is not sha256`)

  const promptSha256 = sha256(context.promptBytes)
  const packetSha256 = sha256(context.packetBytes)
  const outputSha256 = sha256(context.outputBytes)
  const stderrSha256 = sha256(context.stderrBytes)
  for (const [key, actual] of Object.entries({ prompt_sha256: promptSha256, packet_sha256: packetSha256, output_sha256: outputSha256, stderr_sha256: stderrSha256 })) {
    if (receipt[key] !== actual) throw new Error(`${key} mismatch`)
  }
  const inputSha256 = canonicalInvocationInput(promptSha256, packetSha256)
  const expectedInvocationId = deriveInvocationId({ ...context.invocation, inputSha256 })
  if (receipt.invocation_id !== expectedInvocationId) throw new Error('invocation_id binding mismatch')

  const parsed = parseCodexStderr(context.stderrBytes)
  if (receipt.cli_version !== parsed.cliVersion) throw new Error('cli_version mismatch')
  if (receipt.reported_model !== parsed.reportedModel) throw new Error('reported_model mismatch')
  if (receipt.session_id !== parsed.sessionId) throw new Error('session_id mismatch')
  if (receipt.tokens_used !== parsed.tokensUsed) throw new Error('tokens_used mismatch')
  if (receipt.exit_code !== context.actualExitCode || receipt.exit_code !== 0) throw new Error(`Codex exited ${context.actualExitCode}`)
  if (receipt.requested_model !== context.requestedModel) throw new Error('requested_model mismatch')
  if (receipt.reported_model !== receipt.requested_model || receipt.requested_model !== CODEX_MODEL) throw new Error(`required Sol seat must use pinned model ${CODEX_MODEL}`)

  const outputText = decodeUtf8(context.outputBytes, 'output')
  if (outputText.trim() === '') throw new Error('Codex output is empty')
  const { value: payload, exactValue } = parseJsonFile(context.outputBytes, 'Codex output', true)
  const { exactValue: schema } = parseJsonFile(context.schemaBytes, 'output schema', true)
  const violations = schemaErrors(exactValue, schema)
  if (violations.length) throw new Error(`Codex output violates schema:\n  ${violations.join('\n  ')}`)
  if (context.jsonlBytes !== undefined) {
    const jsonl = parseCodexJsonl(context.jsonlBytes)
    if (jsonl.tokensUsed !== receipt.tokens_used) throw new Error('JSONL terminal usage disagrees with stored usage')
  }
  return payload
}

function readLedger(file) {
  if (!existsSync(file)) return []
  const raw = readFileSync(file, 'utf8')
  return raw.split('\n').filter(Boolean).map((line, i) => {
    try {
      const entry = JSON.parse(line)
      if (!isObj(entry) || !SHA_RE.test(entry.invocation_id)) throw new Error('invalid invocation_id')
      return entry
    } catch (e) { throw new Error(`receipt ledger line ${i + 1} is corrupt: ${e.message}`) }
  })
}

// mkdir is the atomic gate. There is NO hot-path steal: contenders retry for five seconds, while
// a crashed holder is cleared only by the PID-gated `unlock` command below.
const LOCK_DEADLINE_MS = 5000
const LOCK_RETRY_MS = 25
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
let lockCounter = 0

function acquireLedgerLock(file) {
  const lockDir = `${file}.lock`
  const token = `${process.pid}-${Date.now()}-${lockCounter++}-${Math.random().toString(36).slice(2)}`
  const deadline = Date.now() + LOCK_DEADLINE_MS
  for (;;) {
    try {
      mkdirSync(lockDir)
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      if (Date.now() >= deadline) {
        let who = 'owner.json unreadable'
        try {
          const owner = JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8'))
          who = `held by pid ${owner.pid} since ${owner.ts}`
        } catch { /* owner missing or corrupt */ }
        throw new Error(`could not acquire receipt ledger lock ${lockDir} within ${LOCK_DEADLINE_MS}ms — ${who}. If that process is dead, clear it with: kiln-codex-receipt.mjs unlock ${file} (refuses while the holder is alive)`)
      }
      sleep(LOCK_RETRY_MS)
      continue
    }
    try {
      writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, ts: new Date().toISOString(), token }))
    } catch (e) {
      try { rmdirSync(lockDir) } catch { /* nothing to unwind */ }
      throw new Error(`acquired receipt ledger lock ${lockDir} but could not write owner.json (${e.message}) — released it rather than hold a tokenless lock`)
    }
    return { lockDir, token }
  }
}

function lockStillOurs(lockDir, token) {
  let owner
  try { owner = JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8')) } catch { return false }
  return isObj(owner) && owner.token === token
}

function releaseLedgerLock(lockDir, token) {
  let owner
  try { owner = JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8')) } catch { return }
  if (!isObj(owner) || owner.token !== token) return
  try { rmSync(join(lockDir, 'owner.json'), { force: true }) } catch { /* already gone */ }
  try { rmdirSync(lockDir) } catch { /* already released */ }
}

function withLedgerLock(file, fn) {
  const { lockDir, token } = acquireLedgerLock(file)
  const assertOwned = () => {
    if (!lockStillOurs(lockDir, token)) throw new Error(`receipt ledger lock lost before write: ${lockDir}`)
  }
  try { return fn(assertOwned) } finally { releaseLedgerLock(lockDir, token) }
}

function reserveInvocation(file, reservation) {
  withLedgerLock(file, (assertOwned) => {
    const prior = readLedger(file).filter((entry) => entry.invocation_id === reservation.invocation_id)
    if (prior.length) {
      const conflict = prior.some((entry) => entry.prompt_sha256 !== reservation.prompt_sha256 || entry.packet_sha256 !== reservation.packet_sha256)
      throw new Error(conflict ? `invocation_id hash conflict: ${reservation.invocation_id}` : `replay rejected: ${reservation.invocation_id}`)
    }
    assertOwned()
    appendFileSync(file, JSON.stringify({ parser_version: PARSER_VERSION, status: 'started', ...reservation }) + '\n')
  })
}

function ledgerVerified(file, receipt, outputFile, stderrFile) {
  withLedgerLock(file, (assertOwned) => {
    const prior = readLedger(file).filter((entry) => entry.invocation_id === receipt.invocation_id)
    if (prior.length !== 1 || prior[0].status !== 'started') throw new Error('receipt ledger reservation is missing or ambiguous')
    assertOwned()
    appendFileSync(file, JSON.stringify({
      parser_version: PARSER_VERSION,
      status: 'verified',
      invocation_id: receipt.invocation_id,
      raw_artifact_refs: { stderr: stderrFile, output: outputFile },
      prompt_sha256: receipt.prompt_sha256,
      packet_sha256: receipt.packet_sha256,
      output_sha256: receipt.output_sha256,
      stderr_sha256: receipt.stderr_sha256,
      receipt_sha256: sha256(Buffer.from(JSON.stringify(receipt))),
      cli_version: receipt.cli_version,
      requested_model: receipt.requested_model,
      reported_model: receipt.reported_model,
      session_id: receipt.session_id,
      exit_code: receipt.exit_code,
      tokens_used: receipt.tokens_used,
      receipt_verified: true,
    }) + '\n')
  })
}

function ledgerInvalid(file, invocationId, outputFile, stderrFile, captured, reason) {
  withLedgerLock(file, (assertOwned) => {
    const prior = readLedger(file).filter((entry) => entry.invocation_id === invocationId)
    if (prior.length !== 1 || prior[0].status !== 'started') throw new Error('receipt ledger reservation is missing or ambiguous')
    const entry = {
      parser_version: PARSER_VERSION,
      status: 'invalid',
      invocation_id: invocationId,
      raw_artifact_refs: captured ? { stderr: stderrFile, output: outputFile } : null,
      receipt_verified: false,
      failure: reason,
    }
    if (captured) {
      entry.output_sha256 = sha256(captured.outputBytes)
      entry.stderr_sha256 = sha256(captured.stderrBytes)
      entry.exit_code = captured.actualExitCode
    }
    assertOwned()
    appendFileSync(file, JSON.stringify(entry) + '\n')
  })
}

function cmdUnlock(ledgerArg) {
  const file = canonicalFile(resolve(ledgerArg))
  const lockDir = `${file}.lock`
  if (!existsSync(lockDir)) { console.log(`kiln-codex-receipt: no lock at ${lockDir} — nothing to clear`); return }
  let owner = null
  try { owner = JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8')) } catch { /* tokenless or corrupt lock is clearable */ }
  if (isObj(owner) && Number.isInteger(owner.pid)) {
    let alive = false
    try { process.kill(owner.pid, 0); alive = true } catch (e) { alive = e.code === 'EPERM' }
    if (alive) throw new Error(`unlock: ${lockDir} is held by a LIVE process (pid ${owner.pid} since ${owner.ts}) — refusing to clear it; stop that process first`)
  }
  rmSync(lockDir, { recursive: true, force: true })
  console.log(`kiln-codex-receipt: cleared stale lock ${lockDir} — was ${isObj(owner) ? `pid ${owner.pid} (ts ${owner.ts})` : 'a tokenless/unreadable owner'}`)
}

function stripStdoutTerminator(bytes) {
  if (bytes.length && bytes[bytes.length - 1] === 0x0a) return bytes.subarray(0, bytes.length - (bytes.length > 1 && bytes[bytes.length - 2] === 0x0d ? 2 : 1))
  return bytes
}

function main(argv) {
  if (argv.length !== 13) die(USAGE, 2)
  const [promptArg, requestedModel, effort, packetArg, schemaArg, outputArg, stderrArg, ledgerArg, runToken, keystone, phase, seat, attemptArg] = argv
  if (!MODEL_RE.test(requestedModel) || !/^[a-z][a-z0-9_-]*$/.test(effort)) die(USAGE, 2)
  const attempt = Number(attemptArg)
  if (!Number.isSafeInteger(attempt) || attempt < 1) die(USAGE, 2)
  const promptFile = canonicalFile(resolve(promptArg))
  const packetFile = canonicalFile(resolve(packetArg))
  const schemaFile = canonicalFile(resolve(schemaArg))
  const outputFile = canonicalFile(resolve(outputArg))
  const stderrFile = canonicalFile(resolve(stderrArg))
  const ledgerFile = canonicalFile(resolve(ledgerArg))
  const invocation = { runToken, keystone, phase, seat, attempt }
  let tempOutput = `${outputFile}.codex-${process.pid}.tmp`
  let reservation = null
  let captured = null
  try {
    const promptBytes = readFileSync(promptFile)
    const packetBytes = readFileSync(packetFile)
    const schemaBytes = readFileSync(schemaFile)
    if (!promptBytes.length) throw new Error('prompt file is empty')
    parseJsonFile(schemaBytes, 'output schema')
    requireDistinctFiles({
      promptFile,
      packetFile,
      schemaFile,
      outputFile,
      stderrFile,
      ledgerFile,
      codexOutputTemp: tempOutput,
      outputAtomicTemp: `${outputFile}.tmp-${process.pid}`,
      stderrAtomicTemp: `${stderrFile}.tmp-${process.pid}`,
      ledgerLock: `${ledgerFile}.lock`,
    })

    const promptSha256 = sha256(promptBytes)
    const packetSha256 = sha256(packetBytes)
    const inputSha256 = canonicalInvocationInput(promptSha256, packetSha256)
    const invocationId = deriveInvocationId({ ...invocation, inputSha256 })
    const reservationData = {
      invocation_id: invocationId,
      input_sha256: inputSha256,
      prompt_sha256: promptSha256,
      packet_sha256: packetSha256,
      run_token: runToken,
      keystone,
      phase,
      seat,
      attempt,
    }
    reserveInvocation(ledgerFile, reservationData)
    reservation = reservationData

    const codexExecutable = resolveCodexExecutable()
    const transportInput = codexTransportInput(promptBytes, packetBytes, packetSha256)
    rmSync(tempOutput, { force: true })
    const child = spawnSync(codexExecutable, [
      'exec', '-m', requestedModel,
      '-c', `model_reasoning_effort=${JSON.stringify(effort)}`,
      '--sandbox', 'read-only',
      '--skip-git-repo-check',
      '--color', 'never',
      '--output-schema', schemaFile,
      '--output-last-message', tempOutput,
      '-',
    ], { input: transportInput, encoding: null, maxBuffer: 64 * 1024 * 1024 })
    const stdoutBytes = Buffer.isBuffer(child.stdout) ? child.stdout : Buffer.alloc(0)
    const stderrBytes = Buffer.isBuffer(child.stderr) ? child.stderr : Buffer.alloc(0)
    const outputCapturePresent = existsSync(tempOutput)
    const outputBytes = outputCapturePresent ? readFileSync(tempOutput) : stripStdoutTerminator(stdoutBytes)
    atomicWrite(outputFile, outputBytes)
    atomicWrite(stderrFile, stderrBytes)
    rmSync(tempOutput, { force: true })
    tempOutput = null
    const actualExitCode = Number.isInteger(child.status) ? child.status : -1
    captured = { outputBytes, stderrBytes, actualExitCode }
    if (child.error) throw new Error(`could not spawn codex: ${child.error.message}`)
    if (!outputCapturePresent) throw new Error('Codex did not create the --output-last-message capture')
    if (actualExitCode === 0 && !stripStdoutTerminator(stdoutBytes).equals(outputBytes)) throw new Error('Codex stdout disagrees with --output-last-message')

    const parsed = parseCodexStderr(stderrBytes)
    const receipt = {
      receipt_version: RECEIPT_VERSION,
      parser_version: PARSER_VERSION,
      transport: TRANSPORT,
      invocation_id: invocationId,
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
    verifyReceipt(receipt, { promptBytes, packetBytes, outputBytes, stderrBytes, schemaBytes, requestedModel, actualExitCode, invocation })
    ledgerVerified(ledgerFile, receipt, outputFile, stderrFile)
    reservation = null
    process.stdout.write(JSON.stringify(receipt) + '\n')
  } catch (e) {
    if (reservation) {
      try { ledgerInvalid(ledgerFile, reservation.invocation_id, outputFile, stderrFile, captured, e.message) } catch (ledgerError) {
        throw new Error(`${e.message}; additionally could not ledger invalid receipt: ${ledgerError.message}`)
      }
    }
    throw e
  } finally {
    if (tempOutput) rmSync(tempOutput, { force: true })
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  try {
    const argv = process.argv.slice(2)
    if (argv[0] === 'unlock') {
      if (argv.length !== 2) die(USAGE, 2)
      cmdUnlock(argv[1])
    } else main(argv)
  } catch (e) { die(e.message) }
}
