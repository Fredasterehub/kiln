'use strict'

// Consumption of the sealed trio: the digests every other layer treats as the fixed point it is judged against.
const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { LAW_HASH, TRANSPORT_FAILURE, TRIO_MISMATCH, stop } = require('./core.js')

// W2-S3: the sealed trio, in the fixed order seal-law writes and every reader checks.
// LAW.md and slices.json sit at the kiln root; the executable check.sh sits under law/.
const TRIO_MEMBERS = ['LAW.md', 'check.sh', 'slices.json']
const trioMemberPath = (kilnDir, name) => (name === 'check.sh' ? join(kilnDir, 'law', name) : join(kilnDir, name))
const trioHashPath = (kilnDir) => join(kilnDir, 'law', 'trio.hash')

// W2-S3 (B01): the sealed law is ONE coherent authority, not three loose files. seal-law
// writes trio.hash (per-member digests), lock.hash (the LAW.md digest) and the lock.seal
// sidecar (`<digest> <label>`); a crashed reseal could otherwise promote a new trio.hash
// beside stale locks. sealedAuthority admits ONLY a whole, cross-bound seal — all three
// present and well-formed, and trio[LAW.md] === lock.hash === the lock.seal digest — and
// returns its verified facts. Any PARTIAL or MISMATCHED combination is a TRIO_MISMATCH hold,
// the integrity class (B02) every sealed consumer holds on. NONE of the three present is an
// honest unsealed law (returns {sealed:false}) for the pre-seal flows. This is the single
// gate so the rule cannot drift per-site.
function sealedAuthority(kilnDir) {
  const read = (p) => {
    try {
      return readFileSync(p, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') return null
      stop('trio_mismatch', `the sealed law could not be read: ${error.message}`, TRIO_MISMATCH)
    }
  }
  const trioRaw = read(trioHashPath(kilnDir))
  const lockRaw = read(join(kilnDir, 'law', 'lock.hash'))
  const sealRaw = read(join(kilnDir, 'law', 'lock.seal'))
  if (trioRaw === null && lockRaw === null && sealRaw === null) return { sealed: false }
  // Some seal artifact exists — the law claims to be sealed, so ALL THREE must be whole.
  const fail = (why) => stop('trio_mismatch', `the sealed law is not whole: ${why} — reseal the law before it is consumed`, TRIO_MISMATCH)
  if (trioRaw === null) fail('law/trio.hash is absent beside a lock')
  const lines = trioRaw.split('\n')
  if (lines.length !== TRIO_MEMBERS.length + 1 || lines[TRIO_MEMBERS.length] !== '') fail('law/trio.hash is not three trailing-newline lines')
  const trio = {}
  for (let i = 0; i < TRIO_MEMBERS.length; i += 1) {
    const parts = lines[i].split(' ')
    if (parts.length !== 2 || parts[0] !== TRIO_MEMBERS[i] || !LAW_HASH.test(parts[1])) fail(`law/trio.hash line ${i + 1} is malformed`)
    trio[TRIO_MEMBERS[i]] = parts[1]
  }
  // The authority gate holds the legacy locks to their BYTE-EXACT shipped shapes — no trim, no
  // first-token parse — so an extra newline, surrounding space, wrong label, or trailing
  // garbage is a torn seal, never a whole one. (The ratify and audit consumers that trim their
  // OWN lock.hash reads stay as they are; only this gate is byte-exact.)
  if (lockRaw === null) fail('law/lock.hash is absent beside the trio')
  if (!/^[0-9a-f]{64}\n$/.test(lockRaw)) fail('law/lock.hash is not exactly a 64-hex digest and one newline')
  const lockHash = lockRaw.slice(0, 64)
  if (sealRaw === null) fail('law/lock.seal is absent beside the trio')
  if (!/^[0-9a-f]{64} (?:dual|single-family)\n$/.test(sealRaw)) fail('law/lock.seal is not exactly <digest> <dual|single-family> and one newline')
  const sealDigest = sealRaw.slice(0, 64)
  if (trio['LAW.md'] !== lockHash || lockHash !== sealDigest) fail('trio.hash, lock.hash and lock.seal disagree on the LAW digest')
  return { sealed: true, trio, lockHash, sealDigest }
}

// Read the bytes a verb is about to parse and, if the law is sealed, confirm they still match
// the sealed trio digest BEFORE the parse — verification and consumption are ONE operation
// over the SAME bytes (B04), never a verify call a tamper can slip between and a separate
// read. auth is the sealedAuthority result: sealed verifies, unsealed passes bytes through for
// the pre-seal flows. A member that vanished from a sealed law is a torn seal (TRIO_MISMATCH).
function verifyMember(auth, kilnDir, name, label) {
  let bytes
  try {
    bytes = readFileSync(trioMemberPath(kilnDir, name))
  } catch (error) {
    stop(auth.sealed ? 'trio_mismatch' : 'transport_failure', `${label} could not read ${name}: ${error.message}`, auth.sealed ? TRIO_MISMATCH : TRANSPORT_FAILURE)
  }
  if (auth.sealed && createHash('sha256').update(bytes).digest('hex') !== auth.trio[name]) {
    stop('trio_mismatch', `${label}: ${name} no longer matches the sealed law/trio.hash digest`, TRIO_MISMATCH)
  }
  return bytes
}
function readSealedMember(kilnDir, name, label) {
  return verifyMember(sealedAuthority(kilnDir), kilnDir, name, label)
}


module.exports = { TRIO_MEMBERS, sealedAuthority, trioHashPath, trioMemberPath, verifyMember }