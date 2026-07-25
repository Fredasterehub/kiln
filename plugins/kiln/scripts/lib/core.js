'use strict'

// The exit law, the shared readers and path containment, and canonical serialization — the layer everything else is allowed to reach.
const { createHash } = require('node:crypto')
const { existsSync, lstatSync, readFileSync, realpathSync, statSync, unlinkSync } = require('node:fs')
const { dirname, join, resolve, sep } = require('node:path')

const ACCEPT = 0
// W2-S7b (item 11): the read-only membership answer for a PROVEN absence — the exit grammar the
// audited-skip check has always spoken (0 present, 1 absent, anything else untrusted and held).
const NO_MEMBER = 1
const REJECT = 10
const BLOCKED = 11
const TRANSPORT_FAILURE = 20
const CODEX_UNAVAILABLE = 21
// W2-S3 (C2 / B04 / ruling 2): the LAW seal covers all THREE trio files — LAW.md, the
// executable law/check.sh, and the slice plan slices.json — each digested individually into
// .kiln/law/trio.hash. TRIO_MISMATCH is the closed exit a live file that no longer matches
// its sealed digest earns; it is DISTINCT from a transport failure (an absent or torn
// trio.hash) so a caller can tell a tamper apart from a missing seal.
const TRIO_MISMATCH = 22
const LAW_HASH = /^[0-9a-f]{64}$/
const BROKEN_CODEX = /(?:unknown|unrecognized|unexpected|invalid).*(?:argument|option|subcommand)|(?:argument|option).*(?:not found|not recognized)/i
function stop(fact, message, code) {
  process.stdout.write(`${fact}\n`)
  process.stderr.write(`kiln-review: ${message}\n`)
  process.exit(code)
}

function discard(file) {
  try {
    if (existsSync(file)) unlinkSync(file)
  } catch {
    // The original failure remains the machine fact.
  }
}

function readJson(file, label, discardOnFailure) {
  try {
    return JSON.parse(readFileSync(resolve(file), 'utf8'))
  } catch (error) {
    if (discardOnFailure) discard(discardOnFailure)
    stop('transport_failure', `${label}: ${error.message}`, TRANSPORT_FAILURE)
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

// W2-S8: the ONE containment gate for a path that reaches the filesystem from model-written
// content. It answers with an absolute path INSIDE root or it HOLDs — never a falsy value a caller
// could read as absence. Containment is proven twice: lexically against the root, then PHYSICALLY
// over the deepest EXISTING ancestor of the target, so a link is an outside path wearing an inside
// name whether it stands at the target or at a directory above it, while the not-yet-created tail
// carries no link to follow — one gate serves a read and a first write alike. A root, an ancestor
// or a dangling link that cannot be resolved HOLDs: a containment question that cannot be answered
// is never answered yes. It proves the PATH, not the open; a caller needing race-proof bytes opens
// by descriptor, as the manifest apparatus already does for its own reads.
function containedPath(root, rel, label) {
  const fail = (why) => stop('transport_failure', `${label}: ${why}`, TRANSPORT_FAILURE)
  // The boundary is the root plus exactly one separator, so a sibling whose name merely begins with
  // the root is outside. A root that ALREADY ends in a separator — the filesystem root itself — must
  // not grow a second one, or the check would refuse its own children.
  const within = (path, base) => path === base || path.startsWith(base.endsWith(sep) ? base : base + sep)
  if (typeof rel !== 'string' || rel.trim() === '') fail('the path must be a nonempty string')
  const rootAbs = resolve(root)
  const abs = resolve(rootAbs, rel)
  if (!within(abs, rootAbs)) fail(`${rel} resolves outside ${rootAbs}`)
  let rootReal
  try {
    rootReal = realpathSync(rootAbs)
  } catch (error) {
    fail(`the containment root ${rootAbs} is unresolvable: ${error.message}`)
  }
  // The walk is bounded by the lexical proof above: abs lies under rootAbs, which exists.
  let probe = abs
  while (probe !== rootAbs) {
    try {
      lstatSync(probe)
      break
    } catch (error) {
      if (error.code !== 'ENOENT') fail(`${probe} could not be examined: ${error.message}`)
      probe = dirname(probe)
    }
  }
  let real
  try {
    real = realpathSync(probe)
  } catch (error) {
    fail(`${rel} does not physically resolve: ${error.message}`)
  }
  if (!within(real, rootReal)) fail(`${rel} physically resolves outside ${rootAbs}`)
  return abs
}

function classifyFailure(run) {
  if (run.error && ['ENOENT', 'EACCES', 'ENOEXEC'].includes(run.error.code)) return CODEX_UNAVAILABLE
  if (run.error) return TRANSPORT_FAILURE
  const stderr = run.stderr || ''
  const incompatibleCli = BROKEN_CODEX.test(stderr) && /Usage:\s+codex(?: exec)?\b/i.test(stderr)
  if ([126, 127].includes(run.status) || incompatibleCli) return CODEX_UNAVAILABLE
  return TRANSPORT_FAILURE
}

function repository(path) {
  try {
    const root = realpathSync(resolve(path))
    if (!statSync(root).isDirectory()) throw new Error('not a directory')
    return root
  } catch (error) {
    stop('transport_failure', `invalid repository: ${error.message}`, TRANSPORT_FAILURE)
  }
}

// Canonical serialization (FORK 1 rules, reused): UTF-8 compact JSON, no BOM, no trailing newline;
// object keys recursively sorted; arrays kept in order; undefined, non-finite numbers and unsafe
// integers rejected (a caller bug, never silently coerced). No Unicode or newline normalization —
// JSON.stringify escapes deterministically and preserves the exact string content, so the digest is
// byte-stable across two runs on identical input.
function canonicalString(value) {
  const encode = (v) => {
    if (v === null) return 'null'
    if (typeof v === 'boolean') return v ? 'true' : 'false'
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new Error('canonical serialization rejects a non-finite number')
      if (Number.isInteger(v) && !Number.isSafeInteger(v)) throw new Error('canonical serialization rejects an unsafe integer')
      return JSON.stringify(v)
    }
    if (typeof v === 'string') return JSON.stringify(v)
    if (Array.isArray(v)) return '[' + v.map((e) => encode(e)).join(',') + ']'
    if (isObject(v)) return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + encode(v[k])).join(',') + '}'
    throw new Error('canonical serialization rejects an unserializable value')
  }
  return encode(value)
}
const canonicalBytes = (value) => Buffer.from(canonicalString(value), 'utf8')
const canonicalDigest = (value) => createHash('sha256').update(canonicalBytes(value)).digest('hex')

// Sort by the UTF-8 byte order of a path — NOT the default UTF-16 code-unit order, which diverges on
// non-BMP characters; every snapshot and every change list orders on this so a digest is byte-stable.
const bytePathCompare = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))


module.exports = { ACCEPT, BLOCKED, CODEX_UNAVAILABLE, LAW_HASH, NO_MEMBER, REJECT, TRANSPORT_FAILURE,
  TRIO_MISMATCH, bytePathCompare, canonicalBytes, canonicalDigest, canonicalString, classifyFailure,
  containedPath, discard, isObject, readJson, repository, stop, stringArray }