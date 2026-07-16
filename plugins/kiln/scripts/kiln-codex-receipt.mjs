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
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { userInfo } from 'node:os'
import { basename, delimiter, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CODEX_FALLBACK, CODEX_MODEL } from '../src/models.mjs'

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

function collectErrorObjects(value, acc = []) {
  if (Array.isArray(value)) { for (const item of value) collectErrorObjects(item, acc); return acc }
  if (!isObj(value)) return acc
  if (value.type === 'error') acc.push(value)
  for (const item of Object.values(value)) collectErrorObjects(item, acc)
  return acc
}

export function parseCodexJsonl(jsonlBytes, options = {}) {
  const allowError = options.allowError ?? (() => false)
  const raw = decodeUtf8(jsonlBytes, 'JSONL capture')
  const lines = raw.split(/\r?\n/).filter((line) => line !== '')
  if (!lines.length) throw new Error('JSONL capture is empty')
  const events = lines.map((line, i) => {
    try { return JSON.parse(line) } catch { throw new Error(`JSONL line ${i + 1} is malformed`) }
  })
  const disallowed = collectErrorObjects(events).filter((item) => !allowError(item?.message))
  if (disallowed.length) throw new Error('JSONL capture contains an error event')
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
// a crashed holder is cleared only by the PID-gated `unlock` command below. The five-second
// deadline is the shipped default; KILN_RECEIPT_LOCK_DEADLINE_MS overrides it with a STRICT
// positive-integer string of milliseconds (/^[0-9]+$/ and > 0) so integration tests can widen or
// shorten the retry window. Anything else preserves the 5000 default — absent, empty, NaN, a
// decimal (3.5), an exponent (1e3), or a unit-suffixed prefix (300ms) — because Number.parseInt
// would silently accept those malformed prefixes; production behavior is unchanged.
export function parseLockDeadlineMs(raw) {
  if (typeof raw === 'string' && /^[0-9]+$/.test(raw)) {
    const n = Number(raw)
    if (n > 0) return n
  }
  return 5000
}
const LOCK_DEADLINE_MS = parseLockDeadlineMs(process.env.KILN_RECEIPT_LOCK_DEADLINE_MS)
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

// ── The dev bridge ──────────────────────────────────────────────────────────────────────────────
// A second entry point over the SAME trust base. Where main() attests the plain-stderr council
// surface, the bridge attests the `--json` surface (thread_id + usage + terminal events) and runs
// the VALIDATED OUTCOME STATE MACHINE. It reuses the crypto, ledger lock, schema validator, and
// invocation-id derivation, so there is one codebase of trust in both directions. sol-review.sh is
// a thin policy wrapper over this subcommand; no verdict authority lives in bash.
const BRIDGE_VERSION = 1
const BRIDGE_TRANSPORT = 'codex_exec_bridge'
const BRIDGE_SANDBOXES = ['read-only', 'workspace-write', 'danger-full-access']
const BRIDGE_EFFORTS = ['low', 'medium', 'high', 'xhigh'] // sol rejects 'minimal'; 'ultra' never existed
const BRIDGE_EXIT = { VERDICT: 0, SUPPRESSED: 10, FAILED_TURN: 11, TRANSPORT: 12, WALLCLOCK_TIMEOUT: 124 }
const BRIDGE_USAGE = 'usage: kiln-codex-receipt.mjs bridge --prompt <f> --out <prefix> --schema <f> --run-token <t> --keystone <k> --phase <p> --seat <s> --attempt <n> [--model id] [--effort low|medium|high|xhigh] [--sandbox read-only|workspace-write|danger-full-access] [--network] [--web] [--ephemeral] [--resume <thread_id>] [--wallclock <seconds>] [--ledger <f>] [--no-fallback]'
// A broken ~/.codex/hooks.json injects one item-level error on every run; --ignore-user-config
// skips config.toml ONLY, never hooks.json. This is the SOLE tolerated error fingerprint.
const HOOKS_CONFIG_ERROR_RE = /^failed to parse hooks config .*\/hooks\.json:/
// A turn.failed whose model-scoped error matches this — and is NOT a reasoning.effort rejection — is the
// exact model-unavailable/entitlement fingerprint that admits the one gpt-5.5 fallback rung.
const MODEL_UNAVAILABLE_RE = /\bmodel\b[^.]{0,80}?\b(is not supported when using|not found|not available|is unavailable|does not exist)\b/i
const EFFORT_ERROR_RE = /Unsupported value:|reasoning\.effort/

export function isAllowlistedCodexError(message) {
  return typeof message === 'string' && HOOKS_CONFIG_ERROR_RE.test(message)
}

// Structural read of the --json event stream: no I/O, no verdict authority — just the terminal shape
// the state machine needs. `disallowedErrorCount` counts error items that are NOT allowlisted.
export function inspectBridgeEvents(events, options = {}) {
  const allowError = options.allowError ?? isAllowlistedCodexError
  const errorObjects = collectErrorObjects(events)
  const started = events.find((event) => event?.type === 'thread.started')
  const completed = events.filter((event) => event?.type === 'turn.completed' && isObj(event.usage))
  const failed = events.filter((event) => event?.type === 'turn.failed')
  return {
    threadId: typeof started?.thread_id === 'string' ? started.thread_id : null,
    completedCount: completed.length,
    failedCount: failed.length,
    disallowedErrorCount: errorObjects.filter((item) => !allowError(item?.message)).length,
    usage: completed.length === 1 ? completed[0].usage : null,
    failureMessages: failed.map((event) => event?.error?.message).filter((m) => typeof m === 'string'),
  }
}

// The VALIDATED OUTCOME STATE MACHINE — pure. A VERDICT-shaped run still needs attestation
// (schema-valid output + usage) before it is a VERDICT; the orchestrator downgrades to TRANSPORT
// on any attestation failure. Everything that is not one of the four defined shapes is TRANSPORT,
// which consumes no review rejection.
export function classifyBridgeOutcome(input) {
  if (input.timedOut) return { status: 'WALLCLOCK_TIMEOUT' }
  if (input.parseError) return { status: 'TRANSPORT', reason: `event stream did not parse: ${input.parseError}` }
  const ins = input.inspect
  if (input.exitCode === 0) {
    if (ins.disallowedErrorCount > 0) return { status: 'TRANSPORT', reason: 'exit 0 but the stream carried a non-allowlisted error item' }
    if (ins.completedCount !== 1 || ins.failedCount !== 0) return { status: 'TRANSPORT', reason: `exit 0 with missing/conflicting terminals (completed=${ins.completedCount} failed=${ins.failedCount})` }
    if (!input.verdictExists) return { status: 'TRANSPORT', reason: 'exit 0 but the verdict artifact is absent' }
    if (input.verdictEmpty) return { status: 'SUPPRESSED' }
    return { status: 'VERDICT', needsAttestation: true }
  }
  if (input.exitCode === 1) {
    if (ins.completedCount === 0 && ins.failedCount === 1 && !input.verdictExists) return { status: 'FAILED_TURN' }
    return { status: 'TRANSPORT', reason: `exit 1 without a clean turn.failed (completed=${ins.completedCount} failed=${ins.failedCount} verdict=${input.verdictExists})` }
  }
  return { status: 'TRANSPORT', reason: `unexpected codex exit ${input.exitCode}` }
}

function extractCodexError(raw) {
  if (typeof raw !== 'string') return null
  try {
    const parsed = JSON.parse(raw)
    if (isObj(parsed?.error)) return parsed.error
    if (isObj(parsed)) return parsed
  } catch { /* not a JSON envelope — treat the raw string as the message below */ }
  return { message: raw }
}

// EXACT fingerprint: fires the fallback ONLY on a model-unavailable/entitlement
// turn.failure, and NEVER on the reasoning.effort rejection that the old `grep -q model` admitted.
export function isModelUnavailableFingerprint(inspect) {
  for (const raw of inspect.failureMessages || []) {
    const err = extractCodexError(raw)
    const text = err && typeof err.message === 'string' ? err.message : (typeof raw === 'string' ? raw : '')
    const param = err && typeof err.param === 'string' ? err.param : ''
    if (param === 'reasoning.effort' || EFFORT_ERROR_RE.test(text)) continue
    if (MODEL_UNAVAILABLE_RE.test(text)) return true
  }
  return false
}

// Render the codex argv. Pure and total, so the sandbox/network/resume invariants are held by a
// helper, not by caller discipline. Resume cannot carry -s or --ephemeral.
export function bridgeCodexArgs({ model, effort, schemaFile, verdictFile, sandbox, ephemeral, web, network, resumeThread }) {
  if (!BRIDGE_EFFORTS.includes(effort)) throw new Error(`bridge: unsupported effort '${effort}' (use ${BRIDGE_EFFORTS.join('|')})`)
  const tail = [
    '-c', `model_reasoning_effort=${JSON.stringify(effort)}`,
    '--ignore-user-config', '--skip-git-repo-check', '--color', 'never',
    '--json', '-o', verdictFile, '--output-schema', schemaFile,
  ]
  if (resumeThread) {
    if (ephemeral) throw new Error('bridge: --resume cannot combine with --ephemeral (recovery is not a fresh one-shot)')
    if (sandbox) throw new Error('bridge: --resume cannot set a sandbox; codex resume inherits the recorded posture')
    if (network) throw new Error('bridge: --resume cannot add a network capability; it inherits the recorded posture')
    // web is a posture capability too: resume inherits the recorded posture, so the whole tuple
    // (sandbox, network, web) rides on the thread — the caller renders none of it (cmdBridge enforces
    // the recorded tuple and records it in the receipt).
    return ['exec', 'resume', resumeThread, ...tail, '-']
  }
  if (!BRIDGE_SANDBOXES.includes(sandbox)) throw new Error(`bridge: unknown sandbox '${sandbox}' (use ${BRIDGE_SANDBOXES.join('|')})`)
  if (network && sandbox !== 'workspace-write') throw new Error('bridge: --network requires --sandbox workspace-write')
  const head = ['exec', '-m', model, '--sandbox', sandbox]
  if (network) head.push('-c', 'sandbox_workspace_write.network_access=true')
  if (web) tail.push('-c', 'tools.web_search=true')
  if (ephemeral) tail.push('--ephemeral')
  return [...head, ...tail, '-']
}

// The A2 review-verdict validator: structural (against the supplied output schema) + the cross-field
// arithmetic the ladder depends on, then STAMPS the invocation-supplied round (never model-supplied).
export function validateReviewVerdict(verdictBytes, options = {}) {
  const round = options.round
  if (!Number.isInteger(round) || round < 1) throw new Error('review verdict: invocation round must be an integer >= 1')
  const { exactValue: schema } = parseJsonFile(options.schemaBytes, 'review schema', true)
  const { value, exactValue } = parseJsonFile(verdictBytes, 'review verdict', true)
  const violations = schemaErrors(exactValue, schema)
  if (violations.length) throw new Error(`review verdict violates schema:\n  ${violations.join('\n  ')}`)
  if (!Array.isArray(value.findings)) throw new Error('review verdict: findings must be an array')
  const ids = value.findings.map((finding) => finding.id)
  if (ids.some((id) => typeof id !== 'string' || id === '')) throw new Error('review verdict: every finding needs a nonempty id')
  if (new Set(ids).size !== ids.length) throw new Error('review verdict: finding ids must be unique')
  const blocking = value.findings.filter((finding) => finding.class === 'BLOCKING')
  if (value.verdict === 'APPROVED' && blocking.length) throw new Error('review verdict: APPROVED cannot carry a BLOCKING finding')
  if (value.verdict === 'REJECTED' && !blocking.length) throw new Error('review verdict: REJECTED must carry at least one BLOCKING finding')
  return { ...value, round }
}

// The ladder's SUBSTANTIVE oracle (A2): script-decidable, no prose judgment.
export function isSubstantiveRejection(verdict) {
  return isObj(verdict) && verdict.verdict === 'REJECTED' && Array.isArray(verdict.findings)
    && verdict.findings.some((finding) => finding.class === 'BLOCKING' && finding.remedy_class === 'NEW_DECISION')
}

function canonicalBridgeInput(promptSha256, schemaSha256) {
  return sha256(Buffer.from(JSON.stringify({ parser_version: PARSER_VERSION, transport: BRIDGE_TRANSPORT, prompt_sha256: promptSha256, schema_sha256: schemaSha256 })))
}

function bridgeReplayGuard(file, invocationId) {
  withLedgerLock(file, () => {
    if (readLedger(file).some((entry) => entry.invocation_id === invocationId && entry.status === 'VERDICT')) {
      throw new Error(`bridge replay rejected: ${invocationId} already produced a VERDICT`)
    }
  })
}

// a resume must bind to a SPECIFIC recorded row — the recoverable row's thread_id must equal
// the caller's --resume <thread_id> AND the prompt+schema input must match. The recorded row alone
// carries the resumed turn's model + eligibility (codex resume takes no -m); opts.model never does.
function bridgeRecoverable(file, invocationInput, threadId) {
  if (typeof threadId !== 'string' || threadId === '') return null
  let match = null
  withLedgerLock(file, () => {
    for (const entry of readLedger(file)) {
      if (entry.input_sha256 === invocationInput && entry.thread_id === threadId && (entry.status === 'SUPPRESSED' || entry.status === 'FAILED_TURN')) match = entry
    }
  })
  return match
}

function parseBridgeArgs(argv) {
  const opts = {
    model: CODEX_MODEL, effort: 'high', sandbox: 'read-only', wallclock: 1800,
    ephemeral: false, web: false, network: false, resume: '', fallback: true,
  }
  const need = (i) => { if (i + 1 >= argv.length) die(BRIDGE_USAGE, 2); return argv[i + 1] }
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case '--prompt': opts.prompt = need(i); i += 1; break
      case '--out': opts.out = need(i); i += 1; break
      case '--schema': opts.schema = need(i); i += 1; break
      case '--ledger': opts.ledger = need(i); i += 1; break
      case '--model': opts.model = need(i); i += 1; break
      case '--effort': opts.effort = need(i); i += 1; break
      case '--sandbox': opts.sandbox = need(i); opts.sandboxExplicit = true; i += 1; break
      case '--resume': opts.resume = need(i); i += 1; break
      case '--wallclock': opts.wallclock = Number(need(i)); i += 1; break
      case '--run-token': opts.runToken = need(i); i += 1; break
      case '--keystone': opts.keystone = need(i); i += 1; break
      case '--phase': opts.phase = need(i); i += 1; break
      case '--seat': opts.seat = need(i); i += 1; break
      case '--attempt': opts.attempt = Number(need(i)); i += 1; break
      case '--ephemeral': opts.ephemeral = true; break
      case '--web': opts.web = true; break
      case '--network': opts.network = true; break
      case '--no-fallback': opts.fallback = false; break
      default: die(`${BRIDGE_USAGE}\nbridge: unknown arg '${argv[i]}'`, 2)
    }
  }
  for (const key of ['prompt', 'out', 'schema', 'runToken', 'keystone', 'phase', 'seat']) {
    if (typeof opts[key] !== 'string' || opts[key] === '') die(`${BRIDGE_USAGE}\nbridge: --${key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())} is required`, 2)
  }
  if (!MODEL_RE.test(opts.model)) die(`${BRIDGE_USAGE}\nbridge: invalid --model`, 2)
  if (!Number.isInteger(opts.attempt) || opts.attempt < 1) die(`${BRIDGE_USAGE}\nbridge: --attempt must be an integer >= 1`, 2)
  if (!Number.isFinite(opts.wallclock) || opts.wallclock <= 0) die(`${BRIDGE_USAGE}\nbridge: --wallclock must be a positive number of seconds`, 2)
  return opts
}

function runBridgeCodex({ codexExecutable, promptBytes, argv, wallMs, verdictFile, eventsFile, stderrFile }) {
  rmSync(verdictFile, { force: true })
  const child = spawnSync(codexExecutable, argv, { input: promptBytes, encoding: null, maxBuffer: 64 * 1024 * 1024, timeout: wallMs, killSignal: 'SIGKILL' })
  const stdoutBytes = Buffer.isBuffer(child.stdout) ? child.stdout : Buffer.alloc(0)
  const stderrBytes = Buffer.isBuffer(child.stderr) ? child.stderr : Buffer.alloc(0)
  atomicWrite(eventsFile, stdoutBytes)
  atomicWrite(stderrFile, stderrBytes)
  const timedOut = child.error?.code === 'ETIMEDOUT' || child.signal === 'SIGKILL'
  const exitCode = Number.isInteger(child.status) ? child.status : -1
  let events = null
  let parseError = null
  try {
    events = decodeUtf8(stdoutBytes, 'event stream').split(/\r?\n/).filter((line) => line !== '').map((line) => JSON.parse(line))
  } catch (e) { parseError = e.message }
  if (child.error && !timedOut) parseError = parseError ?? `could not spawn codex: ${child.error.message}`
  return { stdoutBytes, stderrBytes, timedOut, exitCode, events, parseError }
}

function bridgeVerdictState(verdictFile) {
  if (!existsSync(verdictFile)) return { exists: false, empty: true, bytes: Buffer.alloc(0) }
  const bytes = readFileSync(verdictFile)
  return { exists: true, empty: decodeUtf8(bytes, 'verdict').trim() === '', bytes }
}

function attestBridgeVerdict({ run, verdict, schemaBytes }) {
  // A VERDICT requires non-empty schema-valid output AND a clean --json attestation.
  const violations = schemaErrors(parseJsonFile(verdict.bytes, 'bridge verdict', true).exactValue, parseJsonFile(schemaBytes, 'output schema', true).exactValue)
  if (violations.length) throw new Error(`verdict violates the output schema:\n  ${violations.join('\n  ')}`)
  const jsonl = parseCodexJsonl(run.stdoutBytes, { allowError: isAllowlistedCodexError })
  return { tokensUsed: jsonl.tokensUsed, usage: jsonl.usage }
}

// every attempt's raw artifacts survive AND its ledger row binds to immutable bytes. After
// an attempt is classified, its stable verdict/events/stderr/receipt files are ARCHIVE-COPIED to
// <prefix>.attempt<K>.* (K = 1 + count of existing ledger rows for this outprefix — deterministic,
// no clock) and the row records raw_artifact_refs pointing at those attempt-scoped paths together
// with a per-artifact sha256 map. The stable <prefix>.* paths remain the LATEST attempt's copy only;
// nothing authoritative points at them. Counting + archive + append happen under one ledger lock so
// K is race-free and the row's bytes are never reused or overwritten by a later attempt.
function finalizeBridgeAttempt(ledgerFile, outPrefix, files, hasReceipt, row) {
  withLedgerLock(ledgerFile, (assertOwned) => {
    const K = readLedger(ledgerFile).filter((e) => e.out_prefix === outPrefix).length + 1
    const refs = {}
    const shas = {}
    for (const [name, src, suffix] of [
      ['verdict', files.verdictFile, 'verdict'],
      ['events', files.eventsFile, 'events.jsonl'],
      ['stderr', files.stderrFile, 'stderr.log'],
      ['receipt', hasReceipt ? files.receiptFile : null, 'receipt.json'],
    ]) {
      if (src && existsSync(src)) {
        const dest = `${outPrefix}.attempt${K}.${suffix}`
        const bytes = readFileSync(src)
        atomicWrite(dest, bytes)
        refs[name] = dest
        shas[name] = sha256(bytes)
      } else {
        refs[name] = null
      }
    }
    assertOwned()
    appendFileSync(ledgerFile, JSON.stringify({ ...row, out_prefix: outPrefix, attempt_index: K, raw_artifact_refs: refs, raw_artifact_sha256: shas }) + '\n')
  })
}

function cmdBridge(argv) {
  const opts = parseBridgeArgs(argv)
  const promptFile = canonicalFile(resolve(opts.prompt))
  const schemaFile = canonicalFile(resolve(opts.schema))
  const outPrefix = resolve(opts.out)
  const verdictFile = canonicalFile(`${outPrefix}.verdict`)
  const eventsFile = canonicalFile(`${outPrefix}.events.jsonl`)
  const stderrFile = canonicalFile(`${outPrefix}.stderr.log`)
  const receiptFile = canonicalFile(`${outPrefix}.receipt.json`)
  const ledgerFile = canonicalFile(resolve(opts.ledger ?? `${outPrefix}.ledger.jsonl`))
  requireDistinctFiles({ promptFile, schemaFile, verdictFile, eventsFile, stderrFile, receiptFile, ledgerFile })

  const promptBytes = readFileSync(promptFile)
  const schemaBytes = readFileSync(schemaFile)
  if (!promptBytes.length) throw new Error('bridge: prompt file is empty')
  parseJsonFile(schemaBytes, 'output schema')
  const promptSha256 = sha256(promptBytes)
  const schemaSha256 = sha256(schemaBytes)
  const inputSha256 = canonicalBridgeInput(promptSha256, schemaSha256)
  const binding = { runToken: opts.runToken, keystone: opts.keystone, phase: opts.phase, seat: opts.seat, attempt: opts.attempt }
  const invocationId = deriveInvocationId({ ...binding, inputSha256 })
  const wallMs = Math.round(opts.wallclock * 1000)
  const files = { verdictFile, eventsFile, stderrFile, receiptFile }
  const resumed = Boolean(opts.resume)

  // ── Posture + model resolution: on resume the RECORDED row governs the whole posture
  // tuple (sandbox, network, web) and the resumed turn's model + eligibility — never opts.model. ──
  let recordedSandbox = opts.sandbox
  let recordedNetwork = opts.network
  let recordedWeb = opts.web
  let usedModel = opts.model
  let solSeatEligible = opts.model === CODEX_MODEL

  if (resumed) {
    const prior = bridgeRecoverable(ledgerFile, inputSha256, opts.resume)
    if (!prior) throw new Error(`bridge: --resume <thread_id> '${opts.resume}' has no recoverable SUPPRESSED/FAILED_TURN row matching this prompt+schema in ${ledgerFile}`)
    recordedSandbox = prior.sandbox
    recordedNetwork = prior.network === true
    recordedWeb = prior.web === true
    if (opts.sandboxExplicit && opts.sandbox !== recordedSandbox) {
      throw new Error(`bridge: --resume must keep the recorded sandbox posture '${recordedSandbox}', not '${opts.sandbox}' — refusing (start a fresh turn to change posture)`)
    }
    if (opts.network && !recordedNetwork) throw new Error('bridge: --resume cannot add a network capability the recorded turn did not have (start a fresh turn)')
    if (opts.web && !recordedWeb) throw new Error('bridge: --resume cannot add web the recorded turn did not have (start a fresh turn)')
    usedModel = typeof prior.requested_model === 'string' ? prior.requested_model : opts.model
    solSeatEligible = prior.sol_seat_eligible === true
  } else {
    bridgeReplayGuard(ledgerFile, invocationId)
  }

  const codexExecutable = resolveCodexExecutable()

  // One attempt: render argv, run codex, classify, and (on VERDICT) attest + write the stable receipt.
  const runAttempt = ({ model, solEligible, sandbox, network, web }) => {
    rmSync(receiptFile, { force: true })
    const argvCodex = bridgeCodexArgs({
      model, effort: opts.effort, schemaFile, verdictFile,
      sandbox: resumed ? '' : sandbox, ephemeral: opts.ephemeral,
      web: resumed ? false : web, network: resumed ? false : network,
      resumeThread: resumed ? opts.resume : undefined,
    })
    const run = runBridgeCodex({ codexExecutable, promptBytes, argv: argvCodex, wallMs, verdictFile, eventsFile, stderrFile })
    const inspect = run.events ? inspectBridgeEvents(run.events) : { threadId: null, completedCount: 0, failedCount: 0, disallowedErrorCount: 0, usage: null, failureMessages: [] }
    const verdict = bridgeVerdictState(verdictFile)
    let decision = classifyBridgeOutcome({ timedOut: run.timedOut, exitCode: run.exitCode, parseError: run.parseError, inspect, verdictExists: verdict.exists, verdictEmpty: verdict.empty })
    let receipt = null
    if (decision.status === 'VERDICT') {
      try {
        const attest = attestBridgeVerdict({ run, verdict, schemaBytes })
        receipt = {
          bridge_version: BRIDGE_VERSION,
          parser_version: PARSER_VERSION,
          transport: BRIDGE_TRANSPORT,
          invocation_id: invocationId,
          prompt_sha256: promptSha256,
          schema_sha256: schemaSha256,
          output_sha256: sha256(verdict.bytes),
          events_sha256: sha256(run.stdoutBytes),
          stderr_sha256: sha256(run.stderrBytes),
          cli_version: CLI_VERSION,
          requested_model: model,
          sol_seat_eligible: solEligible,
          sandbox,
          network,
          web,
          ephemeral: opts.ephemeral,
          resumed,
          thread_id: inspect.threadId,
          exit_code: 0,
          tokens_used: attest.tokensUsed,
        }
        atomicWrite(receiptFile, Buffer.from(JSON.stringify(receipt) + '\n'))
      } catch (e) {
        decision = { status: 'TRANSPORT', reason: `verdict shape failed attestation: ${e.message}` }
      }
    }
    return { run, inspect, verdict, decision, receipt }
  }

  const ledgerRow = (model, solEligible, sandbox, network, web, inspect, decision, receipt) => ({
    parser_version: PARSER_VERSION,
    transport: BRIDGE_TRANSPORT,
    status: decision.status,
    invocation_id: invocationId,
    input_sha256: inputSha256,
    prompt_sha256: promptSha256,
    schema_sha256: schemaSha256,
    sandbox,
    network,
    web,
    requested_model: model,
    sol_seat_eligible: solEligible,
    resumed,
    thread_id: inspect.threadId,
    tokens_used: inspect.usage ? inspect.usage.input_tokens + inspect.usage.output_tokens : null,
    receipt_sha256: receipt ? sha256(Buffer.from(JSON.stringify(receipt))) : null,
    reason: decision.reason ?? null,
  })

  // ── PRIMARY attempt — archived + ledgered before any fallback overwrites the stable files ──
  let attempt = runAttempt({ model: usedModel, solEligible: solSeatEligible, sandbox: recordedSandbox, network: recordedNetwork, web: recordedWeb })
  const doFallback = attempt.decision.status === 'FAILED_TURN' && opts.fallback && !resumed && usedModel === CODEX_MODEL && isModelUnavailableFingerprint(attempt.inspect)
  finalizeBridgeAttempt(ledgerFile, outPrefix, files, Boolean(attempt.receipt),
    ledgerRow(usedModel, solSeatEligible, recordedSandbox, recordedNetwork, recordedWeb, attempt.inspect, attempt.decision, attempt.receipt))

  let finalModel = usedModel
  let finalEligible = solSeatEligible
  if (doFallback) {
    // The single fallback rung: fresh turn only, exact model-unavailable fingerprint only, the primary
    // attempt already preserved under attempt1.*, and the fallback verdict is INELIGIBLE for a Sol seat.
    attempt = runAttempt({ model: CODEX_FALLBACK, solEligible: false, sandbox: recordedSandbox, network: recordedNetwork, web: recordedWeb })
    finalModel = CODEX_FALLBACK
    finalEligible = false
    finalizeBridgeAttempt(ledgerFile, outPrefix, files, Boolean(attempt.receipt),
      ledgerRow(CODEX_FALLBACK, false, recordedSandbox, recordedNetwork, recordedWeb, attempt.inspect, attempt.decision, attempt.receipt))
  }

  const { decision, inspect, run } = attempt
  const line = `STATUS:${decision.status} MODEL:${finalModel} SOL_ELIGIBLE:${finalEligible} THREAD:${inspect.threadId ?? 'none'} EXIT:${run.exitCode} VERDICT_FILE:${verdictFile}${decision.reason ? ` REASON:${decision.reason}` : ''}`
  process.stdout.write(line + '\n')
  process.exit(BRIDGE_EXIT[decision.status])
}

// ── The routing gate ────────────────────────────────────────────────────────────────────────────
// The routing AUTHORITY: deterministic, no model input. It verifies the verdict chain, requires a
// green floor receipt, binds the reviewed diff to the receipt, validates+stamps the verdict, owns
// the ladder arithmetic from ARTIFACTS (manifest + append-only route-ledger — never caller args),
// appends the route row, writes <prefix>.decision.json, and exits with the decision code. The
// workflow relays the code; the files are the authority (the return is a courtesy copy).
const GATE_STAGES = ['plan-design', 'implementation', 'release', 'report-signoff', 'correction-escalation']
const GATE_KEYSTONE_STAGES = new Set(['plan-design', 'release', 'report-signoff', 'correction-escalation'])
const GATE_LANES = ['logic', 'ui-creative', 'codex-authored', 'micro-fix', 'qa-audit']
const GATE_EXIT = { seal: 0, 'implement-r2': 20, 'microfix-r3': 21, 'confirm-each-or-escalate': 22, 'twin-council': 30 }
const GATE_FAIL = 12
const GATE_USAGE = 'usage: kiln-codex-receipt.mjs gate --out <prefix> --schema <f> --round <n> --manifest <f> --route-ledger <f> --diff <f> --floor-receipt <f> [--commission <f>] [--scope-artifact <f>] [--bridge-ledger <f>] [--fable-verdict <f>]\n   or: kiln-codex-receipt.mjs gate --floor --repo <path> --diff <f> --out <receipt.json>'
const FLOOR_VERSION = 1

// A gate failure is TRANSPORT-class: it consumes no rung. Print and exit 12 — never a review verdict.
function gateFail(msg) { writeSync(2, `kiln-codex-receipt gate: GATE-FAIL ${msg}\n`); process.exit(GATE_FAIL) }

function parseGateArgs(argv) {
  const opts = { floor: false }
  const need = (i) => { if (i + 1 >= argv.length) die(GATE_USAGE, 2); return argv[i + 1] }
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case '--floor': opts.floor = true; break
      case '--repo': opts.repo = need(i); i += 1; break
      case '--out': opts.out = need(i); i += 1; break
      case '--diff': opts.diff = need(i); i += 1; break
      case '--schema': opts.schema = need(i); i += 1; break
      case '--round': opts.round = Number(need(i)); i += 1; break
      case '--manifest': opts.manifest = need(i); i += 1; break
      case '--route-ledger': opts.routeLedger = need(i); i += 1; break
      case '--commission': opts.commission = need(i); i += 1; break
      case '--scope-artifact': opts.scopeArtifact = need(i); i += 1; break
      case '--floor-receipt': opts.floorReceipt = need(i); i += 1; break
      case '--bridge-ledger': opts.bridgeLedger = need(i); i += 1; break
      case '--fable-verdict': opts.fableVerdict = need(i); i += 1; break
      default: die(`${GATE_USAGE}\ngate: unknown arg '${argv[i]}'`, 2)
    }
  }
  if (opts.floor) {
    for (const k of [['repo', '--repo'], ['diff', '--diff'], ['out', '--out']]) if (!opts[k[0]]) die(`${GATE_USAGE}\ngate --floor: ${k[1]} is required`, 2)
  } else {
    for (const k of [['out', '--out'], ['schema', '--schema'], ['manifest', '--manifest'], ['routeLedger', '--route-ledger'], ['diff', '--diff'], ['floorReceipt', '--floor-receipt']]) if (!opts[k[0]]) die(`${GATE_USAGE}\ngate: ${k[1]} is required`, 2)
    if (!Number.isInteger(opts.round) || opts.round < 1) die(`${GATE_USAGE}\ngate: --round must be an integer >= 1`, 2)
  }
  return opts
}

// The node --test TAP tally footer: `# tests N`, `# pass N`, `# fail N`, `# skipped N`.
function parseTapTally(tap) {
  const g = (re) => { const m = tap.match(re); return m ? Number(m[1]) : null }
  return { tests: g(/^# tests (\d+)$/m) ?? 0, pass: g(/^# pass (\d+)$/m) ?? 0, fail: g(/^# fail (\d+)$/m) ?? 0, skip: g(/^# skipped (\d+)$/m) ?? 0 }
}

// A red floor must record WHICH tests failed. The node --test TAP failing lines are
// `not ok <N> - <name>` (possibly indented for nested subtests). Collect the names only — bounded to
// the first 20 so a runaway red floor can't bloat the receipt. A `not ok` line carrying a TODO or
// SKIP directive is NOT a genuine failure — node tallies it under `# todo`/`# skipped`, never
// `# fail` — so exclude it entirely (never a failing name). Returns [] when nothing failed
// (schema-stable).
export function parseFailingTests(tap) {
  const names = []
  const re = /^[ \t]*not ok \d+ - (.+?)[ \t]*$/gm
  let m
  while ((m = re.exec(tap)) !== null) {
    const name = m[1]
    if (/\s#\s+(TODO|SKIP)\b/i.test(name)) continue
    names.push(name.trim())
    if (names.length >= 20) break
  }
  return names
}

// The floor is a trusted-CLI mode, not a relayed claim. `gate --floor` itself spawns the
// harness + bundler, parses the TAP tally, and writes a floor receipt bound to the reviewed diff's
// sha. The routing gate later REQUIRES a floor receipt whose pass===true and whose diff_sha256 equals
// the reviewed diff's — a mis-relayed floor claim is caught mechanically at the gate.
function cmdGateFloor(opts) {
  const repo = resolve(opts.repo)
  const diffFile = canonicalFile(resolve(opts.diff))
  if (!existsSync(diffFile)) gateFail(`--floor: diff ${diffFile} is absent`)
  const diffBytes = readFileSync(diffFile)
  const harness = spawnSync('bash', ['tests/v3/run.sh'], { cwd: repo, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })
  const tap = `${harness.stdout ?? ''}${harness.stderr ?? ''}`
  const tally = parseTapTally(tap)
  const harnessPass = harness.status === 0
  const bundle = spawnSync('node', ['scripts/bundle-workflows.mjs', '--check'], { cwd: repo, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  const bundlePass = bundle.status === 0
  const pass = harnessPass && bundlePass && tally.fail === 0 && tally.tests > 0
  const failingTests = pass ? [] : parseFailingTests(tap)
  const receipt = { floor_version: FLOOR_VERSION, pass, tally, failing_tests: failingTests, diff_sha256: sha256(diffBytes), tap_sha256: sha256(Buffer.from(tap)), bundle_check_pass: bundlePass }
  atomicWrite(canonicalFile(resolve(opts.out)), Buffer.from(JSON.stringify(receipt) + '\n'))
  const failingTail = failingTests.length ? ` failing=${failingTests.slice(0, 3).join(' | ')}` : ''
  writeSync(1, `FLOOR:${pass ? 'PASS' : 'FAIL'} tests=${tally.tests} pass=${tally.pass} fail=${tally.fail} skip=${tally.skip} bundle=${bundlePass}${failingTail}\n`)
  process.exit(pass ? 0 : 1)
}

// the head supplies FACTS; the gate holds the CLASSIFICATION. keystone is derived from the pinned
// stage taxonomy (unforgeable by the caller); required_terminal must be consistent with the lane.
function classifyManifest(manifest) {
  if (!isObj(manifest)) gateFail('manifest is not an object')
  const batchId = manifest.batch_id
  if (typeof batchId !== 'string' || batchId === '') gateFail('manifest.batch_id must be a nonempty string (route rows and the ladder are keyed on it)')
  const stage = manifest.stage
  if (!GATE_STAGES.includes(stage)) gateFail(`manifest.stage '${stage}' is not in the pinned taxonomy ${GATE_STAGES.join('|')}`)
  const requiredTerminal = manifest.required_terminal
  if (requiredTerminal !== 'sol' && requiredTerminal !== 'fable') gateFail("manifest.required_terminal must be 'sol' or 'fable'")
  const lane = manifest.lane
  if (!GATE_LANES.includes(lane)) gateFail(`manifest.lane '${lane}' is not in the pinned lane enum ${GATE_LANES.join('|')}`)
  const expectedTerminal = lane === 'codex-authored' ? 'fable' : 'sol'
  if (requiredTerminal !== expectedTerminal) gateFail(`manifest.required_terminal '${requiredTerminal}' is inconsistent with lane '${lane}' (codex-authored ⇒ fable, every other lane ⇒ sol; expected '${expectedTerminal}')`)
  return { keystone: GATE_KEYSTONE_STAGES.has(stage), requiredTerminal, stage, lane, batchId }
}

// sol lane: a codex receipt is the ONLY admissible proof. verdict non-empty; receipt
// present; receipt output/schema hashes match the reviewed bytes; the LAST bridge-ledger row for this
// outprefix is a VERDICT whose invocation_id matches the receipt; and the receipt is Sol-seat eligible
// (a fallback or non-pinned model can NEVER sign a Sol seat).
function verifySolChain(outPrefix, schemaBytes, bridgeLedgerFile, commissionBytes) {
  const verdictFile = `${outPrefix}.verdict`
  const receiptFile = `${outPrefix}.receipt.json`
  if (!existsSync(verdictFile)) gateFail(`sol lane: ${verdictFile} is absent`)
  const verdictBytes = readFileSync(verdictFile)
  if (decodeUtf8(verdictBytes, 'verdict').trim() === '') gateFail('sol lane: verdict artifact is empty')
  if (!existsSync(receiptFile)) gateFail(`sol lane: ${receiptFile} is absent`)
  const receipt = parseJsonFile(readFileSync(receiptFile), 'bridge receipt')
  if (!isObj(receipt)) gateFail('sol lane: receipt is not an object')
  if (receipt.output_sha256 !== sha256(verdictBytes)) gateFail('sol lane: receipt.output_sha256 does not match the verdict bytes')
  if (receipt.schema_sha256 !== sha256(schemaBytes)) gateFail('sol lane: receipt.schema_sha256 does not match the gate schema')
  if (!existsSync(bridgeLedgerFile)) gateFail(`sol lane: bridge ledger ${bridgeLedgerFile} is absent`)
  const rows = readLedger(bridgeLedgerFile).filter((r) => r.out_prefix === outPrefix)
  const last = rows.at(-1)
  if (!last || last.status !== 'VERDICT') gateFail('sol lane: the last bridge-ledger row for this outprefix is not a VERDICT')
  if (last.invocation_id !== receipt.invocation_id) gateFail('sol lane: bridge-ledger invocation_id does not match the receipt')
  if (receipt.sol_seat_eligible !== true) gateFail('sol lane: receipt is not Sol-seat eligible (fallback or non-pinned model) — cannot sign a Sol seat')
  // current-attempt freshness: the last VERDICT row's input MUST equal canonicalBridgeInput of
  // THIS commission + THIS schema — the chain was produced by the review being routed now, not a stale,
  // fallback, or replayed chain the runner mis-relayed as success. Historical validity is not freshness.
  const expectedInput = canonicalBridgeInput(sha256(commissionBytes), sha256(schemaBytes))
  if (last.input_sha256 !== expectedInput) gateFail('sol lane: the last bridge-ledger VERDICT row was not produced by THIS commission+schema (input_sha256 mismatch — stale/foreign/replayed chain, not the current attempt)')
  return { verdictBytes, receipt }
}

// fable lane (mirrored Codex-authored): the terminal is a FABLE-AUTHORED A2 verdict file at
// the manifest-named path — validated by the SAME validateReviewVerdict, recorded with provenance
// fable_main_session. A codex receipt can NEVER stand in for a Fable seat (no cross-labeling).
// The Fable-terminal instrument is a BOUND WRAPPER file
// `{"verdict": <A2 envelope>, "diff_sha256", "batch_id", "round"}`. The gate validates the inner
// envelope (via validateReviewVerdict in the common path) and requires diff_sha256 == the reviewed
// diff's sha, batch_id == the manifest's, and round == the invocation round — any miss ⇒ exit 12. This
// binds the terminal ruling to the current diff/batch/round so stale or foreign schema-valid bytes can
// never masquerade as the current Fable-authored ruling.
function verifyFableChain(fableVerdictPath, { diffSha, batchId, round }) {
  if (!fableVerdictPath) gateFail('fable lane: manifest.fable_verdict_path (or --fable-verdict) is required')
  const p = canonicalFile(resolve(fableVerdictPath))
  if (!existsSync(p)) gateFail(`fable lane: fable terminal wrapper ${p} is absent`)
  const wrapper = parseJsonFile(readFileSync(p), 'fable terminal wrapper')
  if (!isObj(wrapper)) gateFail('fable lane: terminal wrapper is not an object')
  if (!isObj(wrapper.verdict)) gateFail('fable lane: wrapper.verdict (the inner A2 envelope) is missing')
  if (wrapper.diff_sha256 !== diffSha) gateFail('fable lane: wrapper.diff_sha256 does not match the reviewed diff')
  if (wrapper.batch_id !== batchId) gateFail('fable lane: wrapper.batch_id does not match the manifest batch_id')
  if (wrapper.round !== round) gateFail('fable lane: wrapper.round does not match the invocation round')
  return { verdictBytes: Buffer.from(JSON.stringify(wrapper.verdict)) }
}

function requireFloorReceipt(floorReceiptFile, diffSha) {
  if (!floorReceiptFile || !existsSync(floorReceiptFile)) gateFail('floor receipt is absent (run gate --floor first)')
  const fr = parseJsonFile(readFileSync(floorReceiptFile), 'floor receipt')
  if (!isObj(fr)) gateFail('floor receipt is not an object')
  if (fr.pass !== true) gateFail('floor receipt is not green (pass !== true)')
  if (fr.bundle_check_pass !== true) gateFail('floor receipt bundle_check_pass !== true')
  if (fr.diff_sha256 !== diffSha) gateFail('floor receipt diff_sha256 does not match the reviewed diff — the floor was measured against different bytes')
}

// Bind the reviewed diff to the receipt. The commission must carry `Diff-sha256: <hex>`
// equal to the diff bytes, and the receipt.prompt_sha256 must equal the commission bytes — so the
// reviewer demonstrably ruled on THIS diff; a snapshot agent that lied about the sha is caught here.
function bindDiff(commissionBytes, diffBytes, receipt) {
  // Tolerate the rendered template's markdown list-item form (`- Diff-sha256: <hex>`) as well as a
  // bare line — the real commission-review.md carries it as a Scope bullet.
  const m = decodeUtf8(commissionBytes, 'commission').match(/^\s*(?:[-*]\s*)?Diff-sha256:\s*([0-9a-f]{64})\s*$/m)
  if (!m) gateFail('diff binding: the commission has no `Diff-sha256: <hex>` line')
  if (m[1] !== sha256(diffBytes)) gateFail('diff binding: the commission Diff-sha256 does not match the reviewed diff bytes')
  if (receipt.prompt_sha256 !== sha256(commissionBytes)) gateFail('diff binding: receipt.prompt_sha256 does not match the commission bytes (the reviewer ruled on a different prompt)')
}

// The posture the commission DECLARES must equal the posture the transport actually ran under
// (the receipt tuple). The `Sandbox posture:` line is script-supplied by the workflow (never
// agent-chosen) and encodes the whole tuple as `<sandbox> network=<0|1> web=<0|1>`; the gate parses it
// and requires consistency with receipt.{sandbox, network, web} — any disagreement ⇒ exit 12. Without
// this a commission could declare workspace-write while the transport ran read-only (or vice versa) and
// the gate would never notice.
function bindPosture(commissionBytes, receipt) {
  const m = decodeUtf8(commissionBytes, 'commission').match(/^\s*(?:[-*]\s*)?Sandbox posture:\s*(\S+)\s+network=([01])\s+web=([01])\s*$/m)
  if (!m) gateFail('posture binding: the commission has no `Sandbox posture: <sandbox> network=<0|1> web=<0|1>` line')
  const [, sandbox, net, web] = m
  if (receipt.sandbox !== sandbox) gateFail(`posture binding: commission sandbox '${sandbox}' does not match receipt.sandbox '${receipt.sandbox}'`)
  if (receipt.network !== (net === '1')) gateFail(`posture binding: commission network=${net} does not match receipt.network ${receipt.network}`)
  if (receipt.web !== (web === '1')) gateFail(`posture binding: commission web=${web} does not match receipt.web ${receipt.web}`)
}

function readRouteLedger(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line, i) => {
    try { return JSON.parse(line) } catch { throw new Error(`route ledger line ${i + 1} is corrupt`) }
  })
}

// The joint-heads scope artifact (A2): a written SINGLETON naming exactly one surviving blocking id,
// with Fable concurrence on record. Route authority comes from THIS file, never a caller count.
function readScopeArtifact(file, schemaBytes) {
  if (!file || !existsSync(file)) return null
  let obj
  try { obj = parseJsonFile(readFileSync(file), 'scope artifact') } catch { return null }
  if (!isObj(obj)) return null
  if (typeof obj.surviving_blocking_id !== 'string' || obj.surviving_blocking_id === '') return null
  if (obj.fable_concurrence !== true) return null
  if (typeof obj.sol_verdict_path !== 'string' || obj.sol_verdict_path === '') return null
  // sol_verdict_path is not a bare string to be discarded — it MUST exist, parse as a
  // schema-valid A2 verdict, and actually carry the surviving id as a BLOCKING finding. The scope's
  // authority is thereby bound to a real Sol verdict, not a caller-asserted id.
  let solVerdict
  try {
    const vp = canonicalFile(resolve(obj.sol_verdict_path))
    if (!existsSync(vp)) return null
    solVerdict = validateReviewVerdict(readFileSync(vp), { round: 1, schemaBytes })
  } catch { return null }
  if (!solVerdict.findings.some((f) => f.class === 'BLOCKING' && f.id === obj.surviving_blocking_id)) return null
  return { survivingId: obj.surviving_blocking_id }
}

function findingSetKey(verdict) {
  return JSON.stringify(verdict.findings.map((f) => [f.id, f.class, f.remedy_class]).sort())
}

// The ladder arithmetic, derived from artifacts. Decision order: keystone ⇒
// council FIRST; then APPROVED ⇒ seal; then the convergence oracle (a REJECTED round whose finding set
// OR diff repeats the prior row). The APPROVED seal precedes the oracle so a chain-verified APPROVED
// always seals — the oracle fires only on a genuinely stuck REJECTION loop, never on a multi-confirm
// that converges over one frozen diff (the b42 false-fire class). Then the substantive count and rung
// legality. The r3 rung is legal ONLY with a valid singleton scope artifact.
function routeGate({ round, diffSha, keystone, ledgerRows, scopeArtifactFile, verdict, batchId, schemaBytes }) {
  const key = findingSetKey(verdict)
  // the ladder is per-batch. Prior rounds are the route-ledger rows FOR THIS batch_id —
  // never a foreign batch's rows (a cross-batch row with the same diff hash used to trip the oracle).
  const priorRows = ledgerRows.filter((r) => r.batch_id === batchId)
  // route-ledger uniqueness — exactly one row per (batch_id, round). A duplicate is a
  // non-idempotent gate re-run (e.g. a replay the runner mis-relayed as success) and is refused before
  // any routing decision, so a stale chain can never be routed twice. The read, this check, the route
  // computation, and the append run under ONE ledger lock in cmdGate, so two concurrent same-round
  // invocations cannot both observe no row and serialize two appends. Refusals THROW (never gateFail)
  // so the finally releases the lock; cmdGate's catch converts the throw to a GATE-FAIL exit 12.
  if (priorRows.some((r) => r.round === round)) throw new Error(`route ledger already carries a row for batch '${batchId}' round ${round} — duplicate route (non-idempotent re-run), refusing`)
  const priorLast = priorRows.at(-1)
  const substantive = isSubstantiveRejection(verdict)
  const substantiveCount = priorRows.filter((r) => r.substantive === true).length + (substantive ? 1 : 0)

  // round >= 3 is legal ONLY as a scoped one-item confirmation. It REQUIRES a valid
  // singleton scope artifact, and (when it carries blocking findings) the current verdict's blocking
  // set MUST be ⊆ {surviving_blocking_id}. This is a legality precondition of any r3 invocation —
  // checked before any routing decision, absent/invalid ⇒ exit 12.
  let scope = null
  if (round >= 3) {
    scope = readScopeArtifact(scopeArtifactFile, schemaBytes)
    if (!scope) throw new Error('round >= 3 requires a valid joint-heads scope artifact (present, Fable-concurred, naming one surviving blocking id whose sol_verdict_path is a schema-valid A2 verdict carrying that id) — absent or invalid, refusing')
    const blockingIds = verdict.findings.filter((f) => f.class === 'BLOCKING').map((f) => f.id)
    if (!blockingIds.every((id) => id === scope.survivingId)) throw new Error(`round >= 3 verdict blocking set is not a subset of {${scope.survivingId}} — the one-item confirmation admits only the surviving finding, refusing`)
  }

  let next, why
  if (keystone) { next = 'twin-council'; why = 'keystone — council path from the start' }
  // APPROVED seals FIRST — a chain-verified APPROVED is a CONVERGED round, never a stuck loop, so it
  // must never be diverted to council by the oracle even when its (empty) finding set or its diff
  // repeats a prior confirm round (the b42 multi-confirm-over-one-frozen-diff false-fire).
  else if (verdict.verdict === 'APPROVED') { next = 'seal'; why = 'APPROVED — dual-key and seal' }
  // The convergence oracle fires only on TWO CONSECUTIVE REJECTED rounds (A13) whose finding set OR
  // diff repeats — the anti-loop rail for a rejection that is not making progress. The current round
  // is already REJECTED here (the APPROVED branch sealed above), so the guard adds the prior round:
  // priorLast.verdict must ALSO be REJECTED AND priorLast.round must be round - 1 (round adjacency).
  // "Consecutive" is a claim about ROUNDS, not merely about the last recorded row — an r1 REJECTED
  // with the r2 row absent and the current round r3 is NOT two consecutive rejections, so the oracle
  // must not fire on it. A prior APPROVED followed by a REJECTED over the same key/diff is likewise
  // NOT a stuck loop — it is a regression the ladder must route as a fresh rejection, not divert to
  // council.
  else if (priorLast && priorLast.verdict === 'REJECTED' && priorLast.round === round - 1 && (priorLast.finding_set_key === key || priorLast.diff_sha256 === diffSha)) {
    next = 'twin-council'; why = 'convergence oracle (two consecutive REJECTED rounds; unchanged finding set or unchanged diff vs the prior round)'
  }
  else if (substantiveCount >= 3) { next = 'twin-council'; why = '3rd SUBSTANTIVE rejection — correction escalation' }
  else if (round === 1) { next = 'implement-r2'; why = 'r1 REJECTED — author the self-contained r2 fix brief' }
  // round-2 REJECTED (non-oracle, non-3rd-substantive) ALWAYS routes to the joint-heads
  // rule — concurrence cannot pre-exist the verdict being routed, so the microfix-r3 decision is NEVER
  // emitted at r2-time. The heads write the scope artifact AFTER this ruling; r3 then confirms it.
  else if (round === 2) { next = 'confirm-each-or-escalate'; why = 'rejection 2 — joint-heads scope rule next (concurrence cannot pre-exist the verdict being routed; microfix-r3 is never emitted at r2)' }
  else { next = 'microfix-r3'; why = `round >= 3 REJECTED on the one surviving item (${scope.survivingId}) — microfix and re-confirm` }
  return { next, why, key, substantive, substantiveCount }
}

function cmdGate(argv) {
  const opts = parseGateArgs(argv)
  if (opts.floor) return cmdGateFloor(opts)
  try {
    const outPrefix = resolve(opts.out)
    const schemaBytes = readFileSync(canonicalFile(resolve(opts.schema)))
    parseJsonFile(schemaBytes, 'gate schema')
    const round = opts.round
    const manifest = parseJsonFile(readFileSync(canonicalFile(resolve(opts.manifest))), 'batch manifest')
    const cls = classifyManifest(manifest)

    const diffFile = canonicalFile(resolve(opts.diff))
    if (!existsSync(diffFile)) gateFail(`diff ${diffFile} is absent`)
    const diffBytes = readFileSync(diffFile)
    const diffSha = sha256(diffBytes)

    requireFloorReceipt(canonicalFile(resolve(opts.floorReceipt)), diffSha)

    const batchId = cls.batchId
    let verdictBytes
    let terminalProvenance
    if (cls.requiredTerminal === 'sol') {
      if (!opts.commission) gateFail('sol lane: --commission is required for diff + posture binding')
      const commissionBytes = readFileSync(canonicalFile(resolve(opts.commission)))
      const bridgeLedger = canonicalFile(resolve(opts.bridgeLedger ?? `${outPrefix}.ledger.jsonl`))
      const chain = verifySolChain(outPrefix, schemaBytes, bridgeLedger, commissionBytes)
      verdictBytes = chain.verdictBytes
      bindDiff(commissionBytes, diffBytes, chain.receipt)
      bindPosture(commissionBytes, chain.receipt)
      terminalProvenance = 'codex_receipt'
    } else {
      verdictBytes = verifyFableChain(opts.fableVerdict ?? manifest.fable_verdict_path, { diffSha, batchId, round }).verdictBytes
      terminalProvenance = 'fable_main_session'
    }

    const verdict = validateReviewVerdict(verdictBytes, { round, schemaBytes })
    const routeLedgerFile = canonicalFile(resolve(opts.routeLedger))
    const scopeArtifactFile = opts.scopeArtifact ? canonicalFile(resolve(opts.scopeArtifact)) : null

    // the duplicate (batch_id, round) check, the route computation, and the append are ONE
    // locked critical section — a concurrent same-round invocation cannot observe no row, decide, and
    // then serialize a second append. routeGate throws on any refusal so the finally releases the lock;
    // the catch below converts the throw to gateFail (exit 12) only AFTER the lock is gone.
    let r
    withLedgerLock(routeLedgerFile, (assertOwned) => {
      const ledgerRows = readRouteLedger(routeLedgerFile)
      r = routeGate({ round, diffSha, keystone: cls.keystone, ledgerRows, scopeArtifactFile, verdict, batchId, schemaBytes })
      assertOwned()
      appendFileSync(routeLedgerFile, JSON.stringify({ batch_id: batchId, round, verdict: verdict.verdict, finding_set_key: r.key, diff_sha256: diffSha, substantive: r.substantive, decision: r.next, terminal_provenance: terminalProvenance }) + '\n')
    })

    const decision = {
      batch_id: batchId,
      round, verdict: verdict.verdict, decision: r.next, why: r.why, finding_set_key: r.key,
      diff_sha256: diffSha, substantive: r.substantive, substantive_count: r.substantiveCount,
      terminal_provenance: terminalProvenance, keystone: cls.keystone, exit_code: GATE_EXIT[r.next],
    }
    atomicWrite(`${outPrefix}.decision.json`, Buffer.from(JSON.stringify(decision) + '\n'))
    process.stdout.write(`DECISION:${r.next} VERDICT:${verdict.verdict} ROUND:${round} SUBSTANTIVE:${r.substantive} COUNT:${r.substantiveCount} PROVENANCE:${terminalProvenance} WHY:${r.why}\n`)
    process.exit(GATE_EXIT[r.next])
  } catch (e) {
    gateFail(e.message)
  }
}

// ── The handoff bounce ──────────────────────────────────────────────────────────────────────────
// The mechanical pre-model gate. A handoff missing a required section is bounced BEFORE any
// model reads it. Verified by heading match (normalized prefix), exit 0 clean / 1 bounce.
const HANDOFF_REQUIRED = {
  brief: ['objective', 'output format', 'allowed tools / inputs', 'boundaries', 'effort tier'],
  microfix: ['objective', 'output format', 'allowed tools / inputs', 'boundaries', 'effort tier'],
  commission: ['seat', 'scope', 'round discipline', 'how to rule', 'payload-first'],
  confirm: ['seat', 'the one item', 'scope', 'how to rule', 'payload-first'],
}
const CHECK_USAGE = 'usage: kiln-codex-receipt.mjs check-handoff <file> --kind brief|microfix|commission|confirm'

function cmdCheckHandoff(argv) {
  let file = null
  let kind = null
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--kind') { kind = argv[i + 1]; i += 1 }
    else if (file === null) file = argv[i]
    else die(CHECK_USAGE, 2)
  }
  if (!file || !kind || !Object.hasOwn(HANDOFF_REQUIRED, kind)) die(CHECK_USAGE, 2)
  const path = canonicalFile(resolve(file))
  if (!existsSync(path)) { process.stdout.write(`HANDOFF-BOUNCE kind=${kind} missing=["file-not-found"]\n`); process.exit(1) }
  const headings = decodeUtf8(readFileSync(path), 'handoff').split(/\r?\n/)
    .filter((l) => /^#{1,6}\s/.test(l)).map((l) => l.replace(/^#{1,6}\s+/, '').trim().toLowerCase())
  const missing = HANDOFF_REQUIRED[kind].filter((req) => !headings.some((h) => h.startsWith(req)))
  if (missing.length) { process.stdout.write(`HANDOFF-BOUNCE kind=${kind} missing=${JSON.stringify(missing)}\n`); process.exit(1) }
  process.stdout.write(`HANDOFF-OK kind=${kind}\n`)
  process.exit(0)
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
    } else if (argv[0] === 'bridge') {
      cmdBridge(argv.slice(1))
    } else if (argv[0] === 'gate') {
      cmdGate(argv.slice(1))
    } else if (argv[0] === 'check-handoff') {
      cmdCheckHandoff(argv.slice(1))
    } else main(argv)
  } catch (e) { die(e.message) }
}
