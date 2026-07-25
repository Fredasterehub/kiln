'use strict'

// The trust cycle kept whole: verdict archive, ledgers and their reduction, identity, manifests, contracts and promotion.
const { createHash, randomBytes, randomUUID } = require('node:crypto')
const { appendFileSync, closeSync, constants: FS, existsSync, fstatSync, lstatSync, mkdirSync, openSync,
  readdirSync, readFileSync, readlinkSync, renameSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { homedir } = require('node:os')
const { spawnSync } = require('node:child_process')
const { TRIO_MEMBERS, sealedAuthority, verifyMember } = require('./authority.js')
const { LAW_HASH, TRANSPORT_FAILURE, bytePathCompare, canonicalBytes, canonicalDigest, canonicalString,
  isObject, repository, stop } = require('./core.js')
const { LOCK_FILE, LOCK_TOKEN, STATE_SLICE_ID, readLockRecord } = require('./run.js')

// ── W2-S5 (C3a / B05 / ruling 3): the immutable verdict archive ─────────────
// Every review family — build review, LAW ratify, feasibility ratify, milestone audit, and
// perceptual screen — publishes its verdict by renaming a candidate over the mutable gate file,
// a content-free overwrite that destroys the prior verdict. This ledger is the archive that
// overwrite never touches: every newly validated verdict is appended here BEFORE the rename, so
// the full reject/changes_required/blocked history of a repair→recheck→accept lineage survives
// the accept that lands. Ruling 3: the mutable gate files and all their readers are UNCHANGED —
// this is archive-only, never a P.gate split.
const REVIEWS_FILE = 'reviews.jsonl'
// The family is the review family the verdict belongs to, not the reviewer model family and not
// the seal's dual/single cohort (a per-seal fact unavailable at per-verdict publish time). The
// build gate and LAW ratify share one gate FILE, so the family is what tells their verdicts apart
// in the archive; feasibility keeps its own family though it reuses the ratify verb.
const REVIEW_FAMILIES = new Set(['review', 'ratify', 'feasibility', 'audit', 'screen'])

// run_id provenance: the CLI reads the CLI-owned run.lock ITSELF and trusts run_id ONLY from a
// record in the W2-S1 shape (run_id + owner in the LOCK_TOKEN grammar, a positive-integer
// conductor_pid). An absent, unreadable, or non-conforming lock records run_id honestly as null
// (a legacy launch), never a model-authorable string dressed as authoritative identity.
function runIdFromLock(kilnDir) {
  const lock = readLockRecord(join(kilnDir, LOCK_FILE)).record
  const conforms = isObject(lock)
    && typeof lock.run_id === 'string' && LOCK_TOKEN.test(lock.run_id)
    && typeof lock.owner === 'string' && LOCK_TOKEN.test(lock.owner)
    && Number.isInteger(lock.conductor_pid) && lock.conductor_pid > 0
  return conforms ? lock.run_id : null
}

// W2-S7a (B08 hash-block prerequisite / Sol ruling): the durable receipt digest, captured AT
// publication. The gate judged .kiln/check-receipt.txt, which is MUTABLE — a later slice reruns the
// checks and overwrites it — so the digest is taken here, at the archive, never reconstructed at
// seal. Only the review and audit families judge a receipt (the kernel runs check.sh into it before
// those gates); ratify grades an artifact against a rubric and screen grades pixels, so they judge
// NO receipt and their receipt digest is an honest null. A receipt-family verdict whose receipt is
// absent records null too (S7b prevents a full reviewed seal on a null digest — honest absence, not
// a fabricated hash). A PRESENT-but-unreadable receipt is untrusted and fails the archive closed,
// the unreadable-is-hold discipline sealMembers and writeProjectionIfStale already follow — never a
// digest that silently reads the anomaly as absence.
const RECEIPT_FAMILIES = new Set(['review', 'audit'])
function receiptDigestAtPublication(kilnDir, family) {
  if (!RECEIPT_FAMILIES.has(family)) return { digest: null }
  const path = join(kilnDir, 'check-receipt.txt')
  // lstat FIRST to tell genuine absence from present-but-unreadable (B002): a dangling symlink is
  // PRESENT (lstat stats the link itself and succeeds) yet its READ fails ENOENT — following that
  // ENOENT to a null digest would forge honest absence over a receipt that exists. lstat ENOENT is
  // the only genuinely-absent case; any other lstat fault, or a read fault after a successful lstat
  // (dangling symlink, EACCES, EISDIR), is present-but-unreadable and HOLDS.
  try {
    lstatSync(path)
  } catch (error) {
    if (error.code === 'ENOENT') return { digest: null }
    return { error: `archive could not stat the check receipt for its durable digest: ${error.message}` }
  }
  let bytes
  try {
    bytes = readFileSync(path)
  } catch (error) {
    return { error: `archive could not read the present check receipt for its durable digest: ${error.message}` }
  }
  return { digest: createHash('sha256').update(bytes).digest('hex') }
}

// Append the validated verdict to the archive, keyed idempotently by (family, review_id,
// verdict_sha256): a retry re-presenting the exact bytes appends nothing, so retries never create
// ambiguous rounds. The round is the COUNT of rows already in the lineage — its true position in
// that history, never a stateful counter a retry could advance. The complete verdict is preserved,
// plus the sha256 of the EXACT original bytes as the integrity digest. The run lock serializes runs,
// so appends never race. Returns null on success or an idempotent no-op, an error string otherwise,
// so the caller fails closed and never publishes an un-archived verdict.
// verdictBytes is the RAW Buffer of the bytes about to be renamed into the gate file, because the
// digest must bind THOSE bytes: hashing a utf8-decoded string would diverge on any byte that is not
// valid utf8 (decoded to U+FFFD, then re-encoded) and the archived digest would no longer cover what
// was published. The readable fields come from the parsed JSON — the archive content, not its
// integrity binding. The four bindings this row carries (receipt, reviewer leg, manifest, contract)
// each ride as their own field and are re-checked on a retry through the one ownership table below.

// The contract FACT SETS, each defined ONCE and fed to both transports. The codex verbs resolve
// their inputs from the packet they already built; contract-prepare resolves the same inputs from
// the sealed law and the request. The sources differ legitimately — the field SET must not, or a
// field added for one transport silently omits itself from the contract the other composes and
// judges. The recheck fields ride as an explicit tail so an initial contract carries none.
const sliceReviewFacts = (kilnDir, base, recheck) => ({
  slice_id: base.slice_id, law_hash: base.law_hash, law_text: base.law_text,
  builder_hints: base.builder_hints, receipt_sha256: base.receipt_sha256,
  reviewed_manifest: reviewedManifestForSlice(kilnDir, base.slice_id),
  ...(recheck || {}),
})
const milestoneAuditFacts = (kilnDir, base, recheck) => ({
  law_hash: base.law_hash, seam_slice: base.seam_slice, milestone: base.milestone,
  closing_block: base.closing_block, sealed_prefix: base.sealed_prefix,
  covered: coverageTuples(kilnDir, base.sealed_prefix), receipt_sha256: base.receipt_sha256,
  ...(recheck || {}),
})

// The ONE publication path both transports take. The gate-file overwrite is content-free and
// destroys the prior verdict, so the archive to the immutable ledger happens BEFORE the rename — the
// archive is the only surviving history, and a failed archive publishes nothing at all. The codex
// path additionally surfaces its minted reviewer leg as a sidecar beside the gate file, written
// before the rename so a sidecar fault fails the publish closed too. The ORDER is the invariant this
// helper exists to hold in one place; the caller words the fault and owns cleanup, because the codex
// path must discard its own temp while the claude path must leave the caller candidate untouched.
function publishVerdict(kilnDir, family, bytes, bindings, from, to) {
  const archiveError = archiveVerdict(kilnDir, family, bytes, bindings.legId, bindings.manifestSha, bindings.contractSha)
  if (archiveError) return { step: 'archive', message: archiveError }
  if (bindings.sidecar) {
    try {
      writeFileSync(bindings.sidecar.path, bindings.sidecar.bytes)
    } catch (error) {
      return { step: 'sidecar', message: error.message }
    }
  }
  try {
    renameSync(from, to)
  } catch (error) {
    return { step: 'rename', message: error.message }
  }
  return null
}

// The content-addressed COMMIT discipline the three durable stores share — baselines, prepared
// manifests, contracts. The name IS the digest, so the write is O_EXCL: an identical name is an
// idempotent no-op ONLY once its bytes are re-read and still hash to it, and a name colliding with
// foreign or corrupt bytes is a torn store that THROWS rather than silently accepting. A concurrent
// writer with different bytes therefore lands a different, inert name and can never overwrite a
// committed one. `what` and `store` name the fault in the words of each caller: a shared helper must
// not flatten an externally surfaced diagnostic, because a fault message is a contract line.
function commitContentAddressed(path, bytes, sha, what, store) {
  try {
    writeFileSync(path, bytes, { flag: 'wx' })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    let existing
    try {
      existing = readFileSync(path)
    } catch (e) {
      throw new Error(`the ${what} could not be read: ${e.message}`)
    }
    if (createHash('sha256').update(existing).digest('hex') !== sha) {
      throw new Error(`a ${what} file does not match its own name — a torn ${store} store`)
    }
  }
}

// The append-only write discipline every JSONL ledger shares: a crash mid-append can leave a torn
// final line with no trailing newline, so a row is prefixed with one when the file is non-empty and
// does not end in one. Both the torn line and the new row then stay independently recoverable. The
// caller passes bytes it has already read, so this is a byte check rather than a re-read, and it
// returns the fault rather than deciding it — each ledger words its own failure and chooses whether
// to hold or report. Directory creation stays with the callers that need it, so no caller gains a
// mkdir it did not have.
function appendJsonlRow(path, raw, row) {
  const prefix = raw.length > 0 && !raw.endsWith('\n') ? '\n' : ''
  try {
    appendFileSync(path, prefix + JSON.stringify(row) + '\n')
    return null
  } catch (error) {
    return error.message
  }
}

function archiveVerdict(kilnDir, family, verdictBytes, reviewerLegId, manifestSha256, contractSha256) {
  if (!REVIEW_FAMILIES.has(family)) return `archive family ${family} is not a review family`
  let verdict
  try {
    verdict = JSON.parse(verdictBytes.toString('utf8'))
  } catch (error) {
    return `archive could not parse the verdict: ${error.message}`
  }
  if (!isObject(verdict) || typeof verdict.review_id !== 'string' || verdict.review_id.trim() === '') {
    return 'archive verdict carries no review_id'
  }
  const sha = createHash('sha256').update(verdictBytes).digest('hex')
  const path = join(kilnDir, REVIEWS_FILE)
  // Read the whole ledger once (absent = empty). A genuine IO fault (not ENOENT) fails closed, but a
  // single TORN line — a partial final append a crash left with no trailing newline, on an append-only
  // ledger that can never be deleted (never-delete) — must NEVER wedge the archive: an aborting parse
  // would hold every future gate publish forever. The scan skips an unparseable line rather than
  // aborting (the tolerant sealMembers degrade), and a skipped line never counts toward the round.
  let raw = ''
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') return `archive could not read the ledger: ${error.message}`
  }
  const lineage = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    let row
    try { row = JSON.parse(line) } catch { continue }
    if (isObject(row) && row.family === family && row.review_id === verdict.review_id) lineage.push(row)
  }
  // W2-S7a: read and validate the receipt the gate judged BEFORE any return — including the
  // idempotent-retry shortcut (B001). A present-but-unreadable receipt fails closed on EVERY publish,
  // so no verdict ever publishes with an untrusted digest.
  const receipt = receiptDigestAtPublication(kilnDir, family)
  if (receipt.error) return receipt.error
  // W2-S7a (FORK 1 ruling: publication REQUIRES the fresh receipt digest == the contract reference):
  // when a contract rides this publish, the receipt digest recomputed HERE must equal the receipt_sha256
  // the contract embedded when it was composed. A write-capable claude reviewer that overwrote
  // .kiln/check-receipt.txt during its turn (outside the FORK-3 manifest, invisible to the drift check)
  // would otherwise archive an incoherent {contract_sha256, receipt_sha256} composite. A non-receipt
  // kind (artifact-ratify, perceptual-screen) carries no receipt reference, so both sides are null; a
  // mismatch HOLDs closed with a distinct message on EVERY publish, before the retry shortcut too.
  if (typeof contractSha256 === 'string' && LAW_HASH.test(contractSha256)) {
    let contractBytes
    try {
      contractBytes = readFileSync(contractStoreFile(kilnDir, contractSha256))
    } catch (error) {
      return `archive could not read the contract for its receipt-coherence check: ${error.message}`
    }
    let contract
    try {
      contract = JSON.parse(contractBytes.toString('utf8'))
    } catch (error) {
      return `archive could not parse the contract for its receipt-coherence check: ${error.message}`
    }
    const contractReceipt = (isObject(contract) && Object.prototype.hasOwnProperty.call(contract, 'receipt_sha256')) ? contract.receipt_sha256 : null
    if (contractReceipt !== receipt.digest) {
      return 'archive: the fresh check-receipt digest no longer matches the receipt_sha256 the judged contract embedded — a receipt overwritten during the review would archive an incoherent contract-receipt binding'
    }
  }
  const prior = lineage.find((row) => row.verdict_sha256 === sha)
  if (prior !== undefined) {
    // A crash retry re-presents the exact verdict bytes. It is a safe no-op ONLY when the receipt on
    // disk NOW still matches the one archived — a retry over a receipt that changed, vanished, or
    // appeared (per the family rules a non-receipt family archives null and reads null, so they
    // match) would republish a STALE binding, so it HOLDS rather than green-republish (B001).
    // B001-R2 + B-RETRY-LEG + FORK 3 + FORK 1: every binding the row carries is preserved under ONE
    // ownership rule, so a new binding joins the table rather than growing a fourth copy of it. The
    // archived row must OWN the field (a MISSING field is not an archived null — it is a row written
    // before that binding existed, so nothing was ever captured to confirm the retry against), the
    // value must be WELL-FORMED (explicit null, or matching the field pattern), and it must EQUAL what
    // this retry supplies. Any of the three failing HOLDs rather than republishing: an exit 0 here
    // would sever a seal from the exact row it will join.
    const bindings = [
      ['receipt_sha256', receipt.digest, LAW_HASH, 'check receipt', 'the current check receipt no longer matches the archived digest — refusing to republish a stale receipt binding',
        'the archived row predates receipt capture or carries a malformed receipt_sha256 — nothing confirms the historical receipt binding, refusing to republish'],
      ['reviewer_leg_id', (typeof reviewerLegId === 'string' && LEG_ID.test(reviewerLegId)) ? reviewerLegId : null, LEG_ID, 'reviewer', 'the supplied reviewer leg differs from the archived reviewer binding — refusing to sever it'],
      ['manifest_sha256', (typeof manifestSha256 === 'string' && LAW_HASH.test(manifestSha256)) ? manifestSha256 : null, LAW_HASH, 'manifest', 'the supplied manifest digest differs from the archived manifest binding — refusing to sever it'],
      ['contract_sha256', (typeof contractSha256 === 'string' && LAW_HASH.test(contractSha256)) ? contractSha256 : null, LAW_HASH, 'contract', 'the supplied contract digest differs from the archived contract binding — refusing to sever it'],
    ]
    // Each row carries its OWN two messages. The table converges the RULE, never the wording: these
    // faults are read by callers and pinned by tests, so flattening them into one phrasing would be a
    // behaviour change wearing the clothes of a refactor.
    for (const [field, supplied, pattern, what, mismatch, unowned] of bindings) {
      const owns = Object.prototype.hasOwnProperty.call(prior, field)
      const archived = owns ? prior[field] : undefined
      const wellFormed = archived === null || (typeof archived === 'string' && pattern.test(archived))
      if (!owns || !wellFormed) {
        return `archive idempotent retry: ${unowned || `the archived row carries no well-formed ${field} — nothing confirms the historical ${what} binding, refusing to republish`}`
      }
      if (archived !== supplied) return `archive idempotent retry: ${mismatch}`
    }
    return null
  }
  const row = {
    family,
    review_id: verdict.review_id,
    round: lineage.length,
    verdict: verdict.verdict,
    findings: Array.isArray(verdict.findings) ? verdict.findings : [],
    blockers: Array.isArray(verdict.blockers) ? verdict.blockers : [],
    law_hash: verdict.law_hash,
    run_id: runIdFromLock(kilnDir),
    published_at: new Date().toISOString(),
    receipt_sha256: receipt.digest,
    reviewer_leg_id: (typeof reviewerLegId === 'string' && LEG_ID.test(reviewerLegId)) ? reviewerLegId : null,
    manifest_sha256: (typeof manifestSha256 === 'string' && LAW_HASH.test(manifestSha256)) ? manifestSha256 : null,
    contract_sha256: (typeof contractSha256 === 'string' && LAW_HASH.test(contractSha256)) ? contractSha256 : null,
    verdict_sha256: sha,
  }
  const appendError = appendJsonlRow(path, raw, row)
  if (appendError) return `archive could not append the verdict: ${appendError}`
  return null
}

// ── W2-S6 (C3b / B06 / B09): the attestation ledger core ────────────────────
// seals.jsonl and audits.jsonl are the append-only TYPED truth; seals.log and audits.log are the
// CURRENT-VALID rendered projection the kernel reads for membership (ruling 4 keeps membership on
// the .log, JSONL parsing deferred to W4). append-seal/append-audit append the JSONL row THEN
// re-render the whole .log from the JSONL as one atomic temp+rename, so a torn .log never
// accumulates. reconcile heals a crash between the JSONL append and the .log render, and migrates a
// W1 project whose .log predates the JSONL. Every JSONL row renders in
// append order (the plan/seam order the appends already carry — A03); W2-S7b turns that render into
// the full state reduction below, where cutoffs and coverage decide what is still current.
const SEAL_LEDGER = { jsonl: 'seals.jsonl', log: 'seals.log', type: 'seal' }
const AUDIT_LEDGER = { jsonl: 'audits.jsonl', log: 'audits.log', type: 'audit' }

// The closed family-label set a FRESH seal or audit row carries — exactly what append-seal and
// append-audit validate on write, so a real fresh row always conforms. A migrated legacy row is
// exempt: it preserves the verbatim W1 record, whose oldest forms carry no label (a bare-slice
// seals.log line, a pre-S4-D4 two-field `<seam> accept` audit line).
const LEDGER_LABELS = new Set(['dual', 'single-family'])

// One projection line for a CONFORMING ledger row — the EXACT legacy grammar, so every rendered
// .log is byte-identical to what the old append wrote: a seal is `<slice> <label>`, an audit is
// `<seam> accept <label>` (the S4-D4 third field, absent on a pre-S4-D4 legacy audit). Returns null
// for a row that does NOT conform to THIS ledger's S6 schema — a wrong-type row (a seal in the audit
// ledger or an audit in the seal ledger), an audit whose outcome is not the sealed `accept`, or a
// FRESH row without a conforming {dual, single-family} label (the label-less form is legitimate ONLY
// for a migrated legacy:true row, so it never leaks to a fresh row as a two-field audit or a
// trailing-space seal). A non-conforming row is a membership ANOMALY (corruption or a future-bug
// row), never a torn line (a torn line marks the JSONL read incomplete); the reduction HOLDS on the
// null. The S7b event rows (promote, invalidate) are handled by the reduction before they reach here.
function ledgerProjectionLine(descriptor, row) {
  if (!isObject(row) || row.type !== descriptor.type) return null
  const legacy = row.legacy === true
  if (descriptor.type === 'seal') {
    if (typeof row.slice !== 'string' || row.slice === '') return null
    // A legacy seal keeps its W1 form: a labelled line renders `<slice> <label>`, a bare-slice line
    // `<slice>`. A fresh seal must carry a conforming label and always renders `<slice> <label>`.
    if (legacy) return typeof row.label === 'string' && row.label !== '' ? row.slice + ' ' + row.label : row.slice
    return LEDGER_LABELS.has(row.label) ? row.slice + ' ' + row.label : null
  }
  if (typeof row.seam !== 'string' || row.seam === '' || row.outcome !== 'accept') return null
  // A legacy audit keeps its W1 form: a three-field line renders `<seam> accept <label>`, a
  // pre-S4-D4 two-field line `<seam> accept`. A fresh audit must carry a conforming label.
  if (legacy) return typeof row.label === 'string' && row.label !== '' ? row.seam + ' accept ' + row.label : row.seam + ' accept'
  return LEDGER_LABELS.has(row.label) ? row.seam + ' accept ' + row.label : null
}

// ── W2-S7b: the modern candidate shape ──────────────────────────────────────
// The closed attestation kinds a MODERN candidate carries. The kind IS the whole no-review reason,
// which is what makes a verdictless seal distinguishable on the wire from a reviewed one (D3) — so a
// verdictless candidate may never carry a review reference, a reviewer leg or a contract, and a
// reviewed candidate always carries the immutable reference that binds its four captures.
const SEAL_KINDS = new Set(['reviewed', 'verdictless-degraded-ui'])
const AUDIT_KINDS = new Set(['reviewed'])
const trioBlockInvalid = (v) => !isObject(v) || Object.keys(v).length !== TRIO_MEMBERS.length || !TRIO_MEMBERS.every((n) => LAW_HASH.test(v[n]))

// The ordered coverage a reviewed audit candidate stores: one {slice, generation, manifest_sha256}
// tuple per covered member, in verified-prefix order — exactly the shape currentSealTuple mints, so
// a canonical digest comparison decides currency without a byte-exact array compare.
// Each covered name is held to STATE_SLICE_ID, the one slice-id grammar the whole system speaks. A
// nonempty-string check was too loose to be honest coverage: a name outside the grammar can never be
// a slice any build sealed, and a name carrying a delimiter makes the coverage AMBIGUOUS wherever it
// is serialized — one slice named `a,b` is otherwise indistinguishable from the two slices a and b.
function coverageInvalid(covered) {
  if (!Array.isArray(covered) || covered.length === 0) return true
  return covered.some((t) => !isObject(t)
    || Object.keys(t).length !== 3
    || typeof t.slice !== 'string' || !STATE_SLICE_ID.test(t.slice)
    || !Number.isSafeInteger(t.generation) || t.generation < 0
    || !(t.manifest_sha256 === null || LAW_HASH.test(t.manifest_sha256)))
}

// The FIELD LAW of a modern candidate, enforced at the append AND again in the reduction — a row is
// trusted through this ONE function, so a hand-written candidate can never buy the membership the
// append verb would have refused. A legacy-shaped row (no attestation_kind) has no field law here;
// the reduction rejects it only AFTER the modern-shape boundary.
// The FIELDS item 8 forbids on a verdictless candidate: its whole point is that NO review stands
// behind it, so a row claiming any part of one is a contradiction, whatever value it carries. The law
// is literal ABSENCE, not an absent-looking value — a null reviewer leg is still a reviewer-leg claim.
const VERDICTLESS_FORBIDDEN = ['family', 'review_id', 'verdict', 'contract', 'contract_sha256', 'review_ref', 'reviewer_leg_id']
const hasField = (row, name) => Object.prototype.hasOwnProperty.call(row, name)

function candidateShapeInvalid(descriptor, row) {
  const kind = row.attestation_kind
  if (kind === undefined) return null
  const kinds = descriptor.type === 'seal' ? SEAL_KINDS : AUDIT_KINDS
  if (typeof kind !== 'string' || !kinds.has(kind)) return 'carries an attestation kind outside the closed set for this ledger'
  if (kind === 'verdictless-degraded-ui') {
    if (row.label !== 'single-family') return 'is verdictless and must carry the single-family label'
    if (VERDICTLESS_FORBIDDEN.some((name) => hasField(row, name))) return 'is verdictless and must carry no review, verdict, contract or reviewer-leg field at all'
    if (trioBlockInvalid(row.trio_sha256)) return 'is verdictless and must carry the three live trio digests'
    if (!LAW_HASH.test(row.receipt_sha256)) return 'is verdictless and must carry the current receipt digest'
    if (!LAW_HASH.test(row.manifest_sha256)) return 'is verdictless and must carry its recomputed manifest digest'
    if (!Array.isArray(row.builder_leg_ids) || row.builder_leg_ids.length === 0 || !row.builder_leg_ids.every((id) => typeof id === 'string' && LEG_ID.test(id))) {
      return 'is verdictless and must carry its complete builder identities'
    }
    return null
  }
  // The reference is family-SPECIFIC: a seal is attested by a slice review and an audit by a
  // milestone audit, never by whatever other family happened to publish an accept. It also names the
  // identity that reviewed — that leg is what promotion waits on, so a reference without it would let
  // membership land while the reviewer it claims is still an unresolved intent.
  const ref = row.review_ref
  if (!isObject(ref)
    || ref.family !== (descriptor.type === 'seal' ? 'review' : 'audit')
    || typeof ref.review_id !== 'string' || ref.review_id.trim() === ''
    || !LAW_HASH.test(ref.verdict_sha256)
    || typeof ref.reviewer_leg_id !== 'string' || !LEG_ID.test(ref.reviewer_leg_id)) {
    return 'is reviewed and must carry an immutable reference naming the family, review_id, verdict digest and reviewer identity of its own ledger'
  }
  if (descriptor.type === 'audit') {
    if (coverageInvalid(row.covered)) return 'is a reviewed audit and must carry its validated ordered coverage'
    // Generation 0 is how a current tuple says ABSENT — the reduction must refuse it here too, or a
    // covered-versus-current comparison of two absences would render an audit over a prefix nothing
    // seals (both sides equal, both sides empty).
    if (row.covered.some((tuple) => tuple.generation < 1)) return 'is a reviewed audit and must not cover a slice at no generation'
  }
  return null
}

// One invalidate event — the ONE atomic batch cutoff both reopen and milestone rejection append.
// Every target names a slice and the ordinal THROUGH which its candidates are excluded. A malformed
// event is a membership anomaly the reduction HOLDs on: a cutoff misread as absent would resurrect
// an invalidated seal, the exact failure D1 and D2 exist to prevent.
function invalidateInvalid(row) {
  if (!Array.isArray(row.targets) || row.targets.length === 0) return true
  return row.targets.some((t) => !isObject(t)
    || typeof t.slice !== 'string' || t.slice === ''
    || !Number.isSafeInteger(t.through_generation) || t.through_generation < 1)
}

// Reduce one ledger to its CURRENT state (W2-S7b items 1-3). Three event classes join the
// candidates: a promote row confers membership on its provisional candidate (S7a); an invalidate row
// carries the batch cutoff; every other row is a candidate. A candidate GENERATION is its 1-based
// POSITIONAL ordinal among the candidates of its key — legacy and provisional candidates COUNT,
// events never do — so an ordinal is never reused and a cutoff excludes every candidate at or below
// it, rendered or provisional. Current membership is the SOLE latest eligible candidate, rendered
// only when non-provisional or validly promoted, so an older seal can never resurrect behind a
// fresher one. An audit is current only when it is finalized AND its stored coverage equals the
// CURRENT seal tuples (a legacy audit carrying no coverage goes inactive after any seal cutoff) —
// derived, never stored, so no cross-ledger partial write can leave a stale audit standing. Any
// non-conforming row is a membership anomaly the reduction HOLDs on rather than drop (which could
// hide a real seal) or misrender (A02).
function reduceLedger(kilnDir, descriptor, read) {
  const anomaly = (why) => stop('transport_failure', `${descriptor.jsonl} ${why} — a membership anomaly; the reduction holds rather than drop or misrender it`, TRANSPORT_FAILURE)
  const promoted = new Set()
  const provisionalIds = new Set()
  const cutoffs = new Map()
  const groups = new Map()
  const order = []
  let modern = false
  for (const row of read.rows) {
    if (!isObject(row)) anomaly('carries a row that is not an object')
    if (row.type === 'promote') {
      if (typeof row.candidate_id !== 'string' || row.candidate_id === '') anomaly('carries a promote row with no candidate id')
      promoted.add(row.candidate_id)
      continue
    }
    if (row.type === 'invalidate') {
      if (descriptor.type !== 'seal') anomaly('carries an invalidate event outside the seal ledger')
      if (invalidateInvalid(row)) anomaly('carries a malformed invalidate event')
      // A cutoff DELETES membership, so the reduction validates every target against the history that
      // existed WHEN THE EVENT LANDED — the candidates seen so far, at this position in the ledger.
      // A target naming a slice with no candidate yet, or a cutoff above the ordinals that existed,
      // is not a validated cutoff: honouring it would let one malformed event withdraw membership no
      // candidate ever had, and would silently cover candidates appended after it.
      const named = new Set()
      for (const target of row.targets) {
        if (named.has(target.slice)) anomaly('carries an invalidate event naming one slice twice')
        named.add(target.slice)
        const history = groups.get(target.slice)
        if (history === undefined) anomaly('carries an invalidate event for a slice with no candidate history at that point')
        if (target.through_generation > history.length) anomaly('carries an invalidate event whose cutoff is above the candidates that existed when it landed')
        cutoffs.set(target.slice, Math.max(cutoffs.get(target.slice) ?? 0, target.through_generation))
      }
      modern = true
      continue
    }
    const line = ledgerProjectionLine(descriptor, row)
    if (line === null) anomaly(`carries a row that does not conform to the ${descriptor.type} ledger schema`)
    const shape = candidateShapeInvalid(descriptor, row)
    if (shape) anomaly(`carries a candidate that ${shape}`)
    // The legacy boundary is IMPLICIT, not versioned: the first valid S7b-shaped event — an
    // invalidate, or a candidate carrying an explicit attestation kind — is the modern boundary, and
    // a legacy-shaped candidate appearing after it is a downgrade the reduction refuses to trust.
    if (row.attestation_kind === undefined) {
      if (modern) anomaly('carries a legacy-shaped candidate after its modern-shape boundary')
    } else modern = true
    if (row.provisional === true) {
      if (typeof row.candidate_id !== 'string' || row.candidate_id === '') anomaly('carries a provisional candidate with no candidate id')
      provisionalIds.add(row.candidate_id)
    }
    const key = descriptor.type === 'seal' ? row.slice : row.seam
    if (!groups.has(key)) { groups.set(key, []); order.push(key) }
    const bucket = groups.get(key)
    bucket.push({ row, line, generation: bucket.length + 1 })
  }
  for (const id of promoted) {
    if (!provisionalIds.has(id)) anomaly('carries a promote row for no provisional candidate')
  }
  const finalized = (candidate) => candidate.row.provisional !== true || promoted.has(candidate.row.candidate_id)
  const seals = descriptor.type === 'audit' ? sealState(kilnDir) : null
  const carriesCoverage = (row) => Object.prototype.hasOwnProperty.call(row, 'covered')
  const auditCurrent = (row) => {
    if (!carriesCoverage(row)) return seals.cutoffs.size === 0
    // Malformed coverage on ANY row is an ANOMALY, never a quiet not-current. The field law above
    // validates coverage only on a row that DECLARES its attestation kind, so a kindless pre-boundary
    // row can still carry a covered field and reach here; answering false would drop it into the
    // no-member answer, and a caller reads that as PROVEN ABSENCE. Coverage that cannot be read has
    // not been judged stale — it has not been judged at all, so the reduction holds on it.
    if (coverageInvalid(row.covered)) anomaly('carries an audit candidate whose coverage cannot be read — unreadable coverage is never judged current, and reporting it as absent would answer for a seam nothing covered')
    return canonicalDigest(row.covered) === canonicalDigest(row.covered.map((t) => currentSealTuple(seals, kilnDir, t.slice)))
  }
  const members = []
  const reasons = new Map()
  const current = new Map()
  let candidateCount = 0
  for (const key of order) {
    const bucket = groups.get(key)
    candidateCount += bucket.length
    if (descriptor.type === 'seal') {
      const eligible = bucket.filter((candidate) => candidate.generation > (cutoffs.get(key) ?? 0))
      if (eligible.length === 0) { reasons.set(key, 'cutoff'); continue }
      const latest = eligible[eligible.length - 1]
      if (!finalized(latest)) { reasons.set(key, 'provisional'); continue }
      members.push(latest)
      current.set(key, latest)
      continue
    }
    const settled = bucket.filter(finalized)
    // Item 3, no resurrection: a coverage-less candidate answers for a seam only while nothing has
    // SUPERSEDED it. Once a LATER settled candidate for this seam carries coverage, the older row is
    // spent — without this, the moment that later audit went stale the reduction would walk backward
    // and re-elect it, and a coverage-less row would then permanently mask the staleness of every
    // audit after it, leaving the seam rendering as audited over a prefix nothing valid ever covered.
    // Chronological supersession only: cutoffs are the OTHER deactivator (they are sufficient, not
    // necessary), and nothing here reaches for one.
    const lastCovered = settled.map((candidate) => carriesCoverage(candidate.row)).lastIndexOf(true)
    const eligible = settled.filter((candidate, position) => carriesCoverage(candidate.row) || position > lastCovered)
    const member = [...eligible].reverse().find((candidate) => auditCurrent(candidate.row))
    if (member === undefined) { reasons.set(key, settled.length > 0 ? 'coverage' : 'provisional'); continue }
    members.push(member)
    current.set(key, member)
  }
  return {
    // An audit reduction is only as complete as the SEAL read it derived its currency from: a hole in
    // the seal truth could mark a live audit inactive, so that incompleteness rides along. The two
    // are reported separately as well as combined, so each refusal names the ledger that actually
    // has the hole rather than inheriting the other guards answer.
    complete: read.complete && (seals === null || seals.complete),
    derived: seals === null || seals.complete,
    modern,
    projection: members.length ? members.map((member) => member.line).join('\n') + '\n' : '',
    candidateCount,
    cutoffs,
    groups,
    promoted,
    reasons,
    current,
  }
}

// Seals reduce FIRST, audits second: audit currency is DERIVED from the seal state, so every audit
// reduction resolves the seal ledger through this one entry. An absent seal ledger is an honest
// empty state (no cutoff, no current member), never a hold — a project may audit nothing yet.
function sealState(kilnDir) {
  const read = readLedgerRows(join(kilnDir, SEAL_LEDGER.jsonl))
  return reduceLedger(kilnDir, SEAL_LEDGER, read === null ? { rows: [], complete: true } : read)
}

// The SOLE current tuple for a slice (W2-S7b item 5): its current rendered generation and that
// generations manifest digest, derived from the reduction. A slice with NO current rendered member —
// unsealed, invalidated, or holding only an unpromoted provisional — is an honest generation 0 with a
// null manifest. A HISTORICAL row count may never author coverage, which is why nothing here counts
// rows. A torn manifest store HOLDs through coveredManifestDigest.
function currentSealTuple(seals, kilnDir, slice) {
  const member = seals.current.get(slice)
  if (member === undefined) return { slice, generation: 0, manifest_sha256: null }
  return { slice, generation: member.generation, manifest_sha256: coveredManifestDigest(kilnDir, slice, member.generation) }
}

// Parse the append-only JSONL truth into rows WITH its completeness (W2-S7b item 4). A line that
// does not parse — a torn final fragment a crash left, or a corrupt interior line — is never a
// silent skip: it marks the read INCOMPLETE, and neither a membership-affecting append nor a
// withdrawal of rendered membership may proceed from input the reduction could not fully see. The
// surviving rows still render, so one torn byte never wedges every future projection.
function parseLedger(raw) {
  const rows = []
  let complete = true
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    let row
    try { row = JSON.parse(line) } catch { complete = false; continue }
    rows.push(row)
  }
  return { rows, complete }
}

// Read the JSONL truth. Returns null when the file is ABSENT (the caller then considers a W1
// migration), distinct from present-but-empty; a genuine IO fault other than ENOENT THROWS.
function readLedgerRows(path) {
  let raw = ''
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  return parseLedger(raw)
}

// Re-render the .log from the rows as one atomic temp+rename, but ONLY when the current .log differs
// — a matching projection (the common reconcile no-op, and every byte-exact migration) is left
// untouched so no spurious write churns the file.
function writeProjectionIfStale(kilnDir, descriptor, reduction) {
  const projection = reduction.projection
  const logPath = join(kilnDir, descriptor.log)
  let current = null
  try {
    current = readFileSync(logPath, 'utf8')
  } catch (error) {
    // ENOENT is a legitimately absent .log (a fresh project). ANY other error — EACCES on a
    // chmod-000 log, EISDIR, a genuine IO fault — is an UNREADABLE membership log, and unreadable is
    // UNTRUSTED: coercing it to null would let the wipe-guard read it as absent, skip the hold, and
    // the kernel would then judge membership over a log it could not read. Hold fail-closed instead,
    // mirroring readLedgerRows and the S3 sealMembers "unreadable ledger = HOLD" discipline.
    if (error.code !== 'ENOENT') {
      stop('transport_failure', `${descriptor.log} could not be read — an unreadable membership log is untrusted; reconcile holds rather than judge it absent`, TRANSPORT_FAILURE)
    }
    current = null
  }
  if (current === projection) return
  // A zero-row projection is legitimate ONLY for a genuinely empty ledger — a fresh project with no
  // .log yet writes nothing, so reconcile never creates an empty seals.log a scenario poll would
  // misread.
  if (projection === '' && current === null) return
  // W2-S7b (item 4): membership is only ever WITHDRAWN with a reason. Any member the .log still
  // claims that the new projection does not carry must be proven inactive by a validated cutoff or by
  // derived coverage invalidity, over a COMPLETE read — otherwise the overwrite silently drops sealed
  // work and the next boot rebuilds it, the exact B09 failure the ledger exists to prevent. An
  // unpromoted provisional explains nothing (its candidate may still promote), a torn or anomalous
  // read explains nothing, and a member the truth never knew explains nothing — each HOLDs. Members
  // are compared by their FIRST FIELD, the membership anchor, so a row that merely changed its family
  // label is not a withdrawal.
  // WHY completeness gates THIS branch and not the whole overwrite (ruled, do not re-raise): a crash
  // between the JSONL append and the .log render leaves exactly an incomplete read, and excluding that
  // torn tail is the CORRECT projection — the row never became durable. Gating every write on
  // completeness would turn each crash-mid-append into a permanent hold instead of the heal reconcile
  // exists to perform. Incompleteness is disqualifying only where it could COST membership, which is
  // this branch.
  const membersOf = (text) => (text === null ? [] : text.split('\n').filter((line) => line !== '').map((line) => line.split(' ')[0]))
  const carried = new Set(membersOf(projection))
  const withdrawn = membersOf(current).filter((key) => !carried.has(key))
  if (withdrawn.length > 0) {
    const explained = reduction.complete && reduction.candidateCount > 0 && withdrawn.every((key) => {
      const why = reduction.reasons.get(key)
      return why === 'cutoff' || why === 'coverage'
    })
    if (!explained) {
      stop('transport_failure', `${descriptor.log} claims members its JSONL truth no longer renders, and no validated cutoff or coverage change accounts for them — refusing to withdraw sealed membership`, TRANSPORT_FAILURE)
    }
  }
  mkdirSync(kilnDir, { recursive: true })
  const temporary = join(kilnDir, '.' + descriptor.log + '.tmp-' + process.pid + '-' + randomUUID())
  writeFileSync(temporary, projection)
  renameSync(temporary, logPath)
}

// Parse one legacy .log line into a LEGACY-marked typed row for the W1->W2 migration (B09). The
// readable fields are recovered; run_id and ts are honestly ABSENT (a legacy line records neither),
// never fabricated. legacy:true lets S7 require re-verification before conferring full-trust
// attestation; for S6 the row still renders and still grants membership, preserving the exact W1
// resume behaviour the migration must never rebuild.
function legacyLedgerRow(descriptor, line) {
  if (descriptor.type === 'seal') {
    const space = line.indexOf(' ')
    return space === -1
      ? { type: 'seal', slice: line, label: '', legacy: true }
      : { type: 'seal', slice: line.slice(0, space), label: line.slice(space + 1), legacy: true }
  }
  const tokens = line.split(' ')
  const row = { type: 'audit', seam: tokens[0], outcome: tokens[1] !== undefined ? tokens[1] : 'accept', legacy: true }
  if (tokens[2] !== undefined) row.label = tokens[2]
  return row
}

// W1->W2 migration (B09). A nonempty legacy .log with no JSONL is a project sealed before the
// ledger existed: import each line as a legacy row so the JSONL becomes the truth WITHOUT rebuilding
// sealed work or fabricating hashes. Written atomically; an absent or empty legacy .log migrates
// nothing (there is no sealed record to preserve).
function migrateLegacyLog(kilnDir, descriptor) {
  let legacy = ''
  try {
    legacy = readFileSync(join(kilnDir, descriptor.log), 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  if (legacy.trim() === '') return
  const rows = []
  for (const line of legacy.split('\n')) {
    if (line === '') continue
    rows.push(legacyLedgerRow(descriptor, line))
  }
  const body = rows.map((row) => JSON.stringify(row) + '\n').join('')
  mkdirSync(kilnDir, { recursive: true })
  const temporary = join(kilnDir, '.' + descriptor.jsonl + '.tmp-' + process.pid + '-' + randomUUID())
  writeFileSync(temporary, body)
  renameSync(temporary, join(kilnDir, descriptor.jsonl))
}

// Reconcile one ledger: the JSONL is truth. Present -> re-render the .log from it if stale. Absent
// -> migrate a legacy .log into JSONL first (a W1 project), then render. Idempotent: a second call
// finds the JSONL present and the .log already matching, and writes nothing. A genuine IO fault
// fails closed through stop so a caller never advances on an unreconciled ledger.
function reconcileLedger(kilnDir, descriptor) {
  try {
    let read = readLedgerRows(join(kilnDir, descriptor.jsonl))
    if (read === null) {
      migrateLegacyLog(kilnDir, descriptor)
      read = readLedgerRows(join(kilnDir, descriptor.jsonl))
      if (read === null) return
    }
    writeProjectionIfStale(kilnDir, descriptor, reduceLedger(kilnDir, descriptor, read))
  } catch (error) {
    stop('transport_failure', `reconcile could not heal the ${descriptor.log} projection: ${error.message}`, TRANSPORT_FAILURE)
  }
}

// W2-S7b (item 2): every membership-affecting operation reduces SEALS FIRST, AUDITS SECOND. Audit
// currency is derived from the seal state, so an audit rendered before its seals would publish a
// judgement one step stale — a seal cutoff or a fresh seal generation must land in the seal
// projection before any audit claims to cover it.
function reconcileLedgers(kilnDir) {
  reconcileLedger(kilnDir, SEAL_LEDGER)
  reconcileLedger(kilnDir, AUDIT_LEDGER)
}

// Append a typed row to the JSONL truth, then re-render the .log from the JSONL. The append prefixes
// a newline when a crash left the ledger without a trailing one, so the new row lands on its own line
// and the torn line stays independently recoverable (the archiveVerdict write discipline). Callers
// reconcile FIRST so a stale .log or an un-migrated W1 log never misleads the render.
function appendLedgerRow(kilnDir, descriptor, row) {
  const jsonlPath = join(kilnDir, descriptor.jsonl)
  let raw = ''
  try {
    raw = readFileSync(jsonlPath, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') stop('transport_failure', `${descriptor.jsonl} could not be read: ${error.message}`, TRANSPORT_FAILURE)
  }
  // W2-S7b (item 4): the append is membership-affecting, so it may never proceed from an INCOMPLETE
  // read. A torn or corrupt line means the reduction cannot see the whole truth — appending a
  // candidate onto it would fix a generation ordinal, or a cutoff, against a history with a hole.
  const before = parseLedger(raw)
  if (!before.complete) {
    stop('transport_failure', `${descriptor.jsonl} carries a torn or unparseable line — no membership-affecting append proceeds from an incomplete ledger read`, TRANSPORT_FAILURE)
  }
  // The row is held to the SAME field law and the SAME modern-shape boundary the reduction applies,
  // BEFORE it lands. The ledger is append-only and nothing is ever deleted from it, so a row the
  // reduction would refuse must never be written at all — otherwise one bad append wedges every
  // future render of a ledger that cannot be repaired.
  const shape = candidateShapeInvalid(descriptor, row)
  if (shape) stop('transport_failure', `${descriptor.jsonl} refuses a candidate that ${shape}`, TRANSPORT_FAILURE)
  const state = reduceLedger(kilnDir, descriptor, before)
  // The same refusal one ledger deeper, and it is a DISTINCT one: this ledger reads whole, but the
  // ledger it derives its state from does not. An audit appended over a seal history with a hole
  // would fix a coverage claim against seals the reduction could not see.
  if (!state.derived) {
    stop('transport_failure', `${descriptor.jsonl} derives its state from a ledger carrying a torn or unparseable line — no membership-affecting append proceeds from an incomplete read`, TRANSPORT_FAILURE)
  }
  if (row.type === descriptor.type && row.attestation_kind === undefined && state.modern) {
    stop('transport_failure', `${descriptor.jsonl} has crossed its modern-shape boundary — a candidate carrying no attestation kind is never appended after it`, TRANSPORT_FAILURE)
  }
  mkdirSync(kilnDir, { recursive: true })
  const appendError = appendJsonlRow(jsonlPath, raw, row)
  if (appendError) {
    stop('transport_failure', `${descriptor.jsonl} could not be appended: ${appendError}`, TRANSPORT_FAILURE)
  }
  try {
    const read = readLedgerRows(jsonlPath)
    writeProjectionIfStale(kilnDir, descriptor, reduceLedger(kilnDir, descriptor, read === null ? { rows: [], complete: true } : read))
  } catch (error) {
    stop('transport_failure', `${descriptor.log} projection could not be rendered: ${error.message}`, TRANSPORT_FAILURE)
  }
}

// ── W2-S7a (ruling A-prime): the driver-closed identity ledger ──────────────
// .kiln/identity.jsonl is an append-only, event-typed truth with NO rendered projection — nothing
// reads identity for membership yet (S7b binds it). Three row types key by {run_id, leg_id}:
//   intent          {type, run_id, leg_id, role, requested_alias, subject, expected_label, ts}
//   codex-identity  {type, run_id, leg_id, role, requested_alias, resolved_model, source, confirmation, subject, ts}
//   resolved        {type, run_id, leg_id, agent_id, resolved_model, source, driver_session, cross_check, ts}
// A leg with an intent row and no resolved row is PENDING; the state is derived, never stored. The
// leg_id is a random 128-bit value (32 lowercase hex) so its expected_label is globally unique, and
// the reserved leg: prefix is minted NOWHERE else in the plugin.
const IDENTITY_FILE = 'identity.jsonl'
const IDENTITY_ROLES = new Set(['builder', 'repair', 'gate-reviewer', 'auditor', 'audit-repair', 'ratifier', 'screen-grader'])
const LEG_ID = /^[0-9a-f]{32}$/
const LEG_LABEL = /^leg:[0-9a-f]{32}$/
const IDENTITY_SOURCE = new Set(['workflow_progress', 'argv'])
// The roles admissible in each candidate leg position (append-seal / append-audit / publish-gate).
// W2-S7a (B-CODEX-ROLE): position validation is UNIFORM — a codex-identity leg occupying a position
// must carry the same reviewer-class role a claude leg would, never a cross-duty substitution.
const BUILDER_LEG_ROLES = new Set(['builder', 'repair', 'audit-repair'])
const REVIEWER_LEG_ROLES = new Set(['gate-reviewer', 'auditor', 'ratifier', 'screen-grader'])
// The codex reviewer role by review family — a codex-identity row always carries a closed
// reviewer-class role, matching the intent side so S7b reads one vocabulary.
const CODEX_ROLE = { review: 'gate-reviewer', audit: 'auditor', ratify: 'ratifier', feasibility: 'ratifier', screen: 'screen-grader' }

// W2-S7a (B-LEDGER-SCHEMA): the semantic schema of one PARSEABLE identity row of a known type.
// Returns a reason string when the row CLAIMS a known type but is malformed — a schema anomaly the
// reduction HOLDs on, never silently resolving or dropping it. A torn (unparseable) line never
// reaches here; a row without a recognized type is not a reduction input and is ignored
// (forward-compat for S7b types). A resolved row counts only with a well-formed leg_id, non-empty
// agent_id and resolved_model, and a closed source; a codex-identity only with a well-formed leg_id,
// a closed role, a non-empty resolved_model; an intent only with a well-formed leg_id, a closed
// role, and the matching reserved expected_label.
function identityRowInvalid(row) {
  if (!isObject(row) || typeof row.type !== 'string') return null
  if (row.type === 'intent') {
    if (typeof row.leg_id !== 'string' || !LEG_ID.test(row.leg_id)) return 'intent row carries a malformed leg_id'
    if (!IDENTITY_ROLES.has(row.role)) return 'intent row carries a role outside the closed set'
    if (row.expected_label !== 'leg:' + row.leg_id) return 'intent row carries a malformed expected_label'
    return null
  }
  if (row.type === 'codex-identity') {
    if (typeof row.leg_id !== 'string' || !LEG_ID.test(row.leg_id)) return 'codex-identity row carries a malformed leg_id'
    if (!IDENTITY_ROLES.has(row.role)) return 'codex-identity row carries a role outside the closed set'
    if (typeof row.resolved_model !== 'string' || row.resolved_model.trim() === '') return 'codex-identity row carries no resolved_model'
    return null
  }
  if (row.type === 'resolved') {
    if (typeof row.leg_id !== 'string' || !LEG_ID.test(row.leg_id)) return 'resolved row carries a malformed leg_id'
    if (typeof row.agent_id !== 'string' || row.agent_id.trim() === '') return 'resolved row carries no agent_id'
    if (typeof row.resolved_model !== 'string' || row.resolved_model.trim() === '') return 'resolved row carries no resolved_model'
    if (!IDENTITY_SOURCE.has(row.source)) return 'resolved row carries an unrecognized source'
    return null
  }
  return null
}

// Read identity.jsonl into rows, tolerating a torn final line (the archiveVerdict degrade). Returns
// [] when ABSENT; a genuine IO fault other than ENOENT THROWS so the caller fails closed.
function readIdentityRows(kilnDir) {
  let raw = ''
  try {
    raw = readFileSync(join(kilnDir, IDENTITY_FILE), 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  const rows = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    try { rows.push(JSON.parse(line)) } catch { continue }
  }
  return rows
}

// Append one identity row, newline-prefixing a torn tail so it lands on its own line (the
// archiveVerdict/appendLedgerRow write discipline). Returns null on success, an error string on
// failure so the caller fails closed.
function appendIdentityRow(kilnDir, row) {
  const path = join(kilnDir, IDENTITY_FILE)
  let raw = ''
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') return `identity ledger could not be read: ${error.message}`
  }
  let appendError = null
  try { mkdirSync(kilnDir, { recursive: true }) } catch (error) { appendError = error.message }
  if (appendError === null) appendError = appendJsonlRow(path, raw, row)
  if (appendError) return `identity ledger could not be appended: ${appendError}`
  return null
}

// Index the identity ledger: for every leg_id its role, run_id, and whether it is RESOLVED (a
// codex-identity row is resolved by construction; an intent becomes resolved when a resolved row
// for its leg_id lands). The first intent for a leg_id wins its role/run_id — an immutable intent
// is never rewritten. Also returns the intent rows for the pending derivation. This is the SINGLE
// reduction point — every consumer reads identity through it. W2-S7a (B-LEDGER-SCHEMA): each
// parseable known-type row is semantically validated; a schema anomaly HOLDs the whole reduction
// fail-closed (the S6 discipline), never silently resolving or dropping it. A genuine IO fault (not
// ENOENT) HOLDs too.
function identityIndex(kilnDir) {
  let rows
  try {
    rows = readIdentityRows(kilnDir)
  } catch (error) {
    stop('transport_failure', `the identity ledger could not be read: ${error.message}`, TRANSPORT_FAILURE)
  }
  const legs = new Map()
  const resolvedIds = new Set()
  // W2-S7b (item 7): promotion requires EXACTLY ONE complete resolved record per referenced pending
  // leg, so the reduction counts them — two resolved rows for one leg are contradictory identity
  // evidence, and membership is never conferred on a leg whose identity is ambiguous.
  const resolvedCounts = new Map()
  const intents = []
  for (const row of rows) {
    const invalid = identityRowInvalid(row)
    if (invalid) stop('transport_failure', `the identity ledger carries a schema anomaly: ${invalid} — the reduction holds rather than resolve or drop it`, TRANSPORT_FAILURE)
    if (!isObject(row) || typeof row.leg_id !== 'string') continue
    if (row.type === 'intent') {
      if (!legs.has(row.leg_id)) legs.set(row.leg_id, { role: row.role, run_id: row.run_id ?? null, kind: 'intent' })
      intents.push({ leg_id: row.leg_id, expected_label: row.expected_label, run_id: row.run_id ?? null, role: row.role })
    } else if (row.type === 'codex-identity') {
      legs.set(row.leg_id, { role: row.role, run_id: row.run_id ?? null, kind: 'codex' })
      resolvedIds.add(row.leg_id)
    } else if (row.type === 'resolved') {
      resolvedIds.add(row.leg_id)
      resolvedCounts.set(row.leg_id, (resolvedCounts.get(row.leg_id) ?? 0) + 1)
    }
  }
  return { legs, resolvedIds, resolvedCounts, intents }
}

// Locate the current driver transcript by session id, the kiln-meter discovery: the munged-cwd dir
// first (the common case), then a scan of every project dir. Returns the path or null (never dies)
// so capture-and-finalize can fall to its recovery scan.
function discoverDriverTranscript() {
  const sid = process.env.CLAUDE_CODE_SESSION_ID
  if (!sid) return null
  const projects = join(homedir(), '.claude', 'projects')
  const munged = process.cwd().replace(/[^A-Za-z0-9]/g, '-')
  const direct = join(projects, munged, `${sid}.jsonl`)
  if (existsSync(direct)) return direct
  let entries = []
  try { entries = readdirSync(projects, { withFileTypes: true }) } catch { return null }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const cand = join(projects, entry.name, `${sid}.jsonl`)
    if (existsSync(cand)) return cand
  }
  return null
}

// Every .jsonl under every project dir — the recovery scan corpus for an outstanding leg whose own
// driver session did not resolve it (a crashed session). Unreadable dirs are skipped.
function allProjectTranscripts() {
  const projects = join(homedir(), '.claude', 'projects')
  const out = []
  let dirs = []
  try { dirs = readdirSync(projects, { withFileTypes: true }) } catch { return out }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue
    let files = []
    try { files = readdirSync(join(projects, dir.name)) } catch { continue }
    for (const file of files) if (file.endsWith('.jsonl')) out.push(join(projects, dir.name, file))
  }
  return out
}

// Scan a driver transcript for the completed workflow_progress rows carrying an exact label. A
// task_progress event carries a workflow_progress snapshot that repeats across events as a leg
// transitions, so the distinct COMPLETED (state done) identities are deduped by {agentId, model}.
// A done row missing either field marks the telemetry malformed. The label is globally unique, so a
// clean resolution is EXACTLY one distinct entry and no malformed row.
function scanTranscriptForLabel(text, label) {
  const done = new Map()
  let malformed = false
  let present = false
  for (const line of text.split('\n')) {
    if (line === '') continue
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    if (!isObject(ev) || ev.type !== 'system' || ev.subtype !== 'task_progress' || !Array.isArray(ev.workflow_progress)) continue
    for (const entry of ev.workflow_progress) {
      if (!isObject(entry) || entry.type !== 'workflow_agent' || entry.label !== label) continue
      // W2-S7a (B-RECOVERY-CORPUS): the label appearing at all — any state, clean or dirty — marks
      // this transcript present in the recovery census; ambiguity never hides a transcript.
      present = true
      if (entry.state !== 'done') continue
      if (typeof entry.agentId !== 'string' || entry.agentId === '' || typeof entry.model !== 'string' || entry.model === '') { malformed = true; continue }
      done.set(entry.agentId + '\0' + entry.model, { agentId: entry.agentId, model: entry.model })
    }
  }
  return { entries: [...done.values()], malformed, present }
}

// The OPTIONAL per-agent cross-check. W2-S7a (B-CROSSCHECK): live Workflow per-agent transcripts sit
// under <driver path WITHOUT its .jsonl suffix>/subagents/workflows/wf_*/agent-<agentId>.jsonl — a
// sibling DIRECTORY named for the session, NOT beside the driver file. A present transcript MUST
// agree with the driver telemetry model (a disagreement HOLDS). GENUINE absence (ENOENT on the wf
// root or the agent file) is cross_check absent, since the optional cross-check simply is not there.
// A PRESENT-but-unreadable source (EACCES, EISDIR, a non-ENOENT fault) is UNTRUSTED evidence and
// HOLDS — the wave discipline, never silently coerced to absent. Returns message.model-agree,
// absent, disagree, or unreadable (the caller HOLDs on disagree and unreadable).
function crossCheckModel(driverPath, agentId, model) {
  if (!/^[A-Za-z0-9_-]+$/.test(agentId)) return 'absent'
  const wfRoot = join(driverPath.replace(/\.jsonl$/, ''), 'subagents', 'workflows')
  let wfDirs
  try {
    wfDirs = readdirSync(wfRoot, { withFileTypes: true })
  } catch (error) {
    return error.code === 'ENOENT' ? 'absent' : 'unreadable'
  }
  for (const dir of wfDirs) {
    if (!dir.isDirectory() || dir.name.slice(0, 3) !== 'wf_') continue
    let text
    try {
      text = readFileSync(join(wfRoot, dir.name, `agent-${agentId}.jsonl`), 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') continue
      return 'unreadable'
    }
    let sawModel = false
    for (const line of text.split('\n')) {
      if (line === '') continue
      let ev
      try { ev = JSON.parse(line) } catch { continue }
      if (isObject(ev) && ev.type === 'assistant' && isObject(ev.message) && typeof ev.message.model === 'string' && ev.message.model !== '') {
        sawModel = true
        if (ev.message.model !== model) return 'disagree'
      }
    }
    return sawModel ? 'message.model-agree' : 'absent'
  }
  return 'absent'
}

// ── W2-S7a (FORK 3): the control-derived working-tree manifests ──────────────
// A slice generation's delta is derived from a TRUSTED before/after snapshot of the working tree,
// never the builder's word. manifest-start captures an immutable baseline before the first builder
// mutation; manifest-prepare captures the after-snapshot before each gate, diffs it against the
// baseline, and publishes a content-addressed manifest; publication and the seal RECOMPUTE the
// after-snapshot and reject any drift. Snapshots hash ACTUAL working-tree bytes, never git index or
// HEAD blobs. All artifacts live under .kiln/manifests/<sha256(slice)>/gen-<N>/ — the slice id is
// hashed so a slash-bearing id cannot walk out of the path.
const MANIFEST_DIR = 'manifests'
const MANIFEST_SCHEMA = 1
const MANIFEST_COVERAGE = 'control-derived-slice-delta'

// Every fault surfaces as a returned { error } (the archiveVerdict/receiptDigestAtPublication
// discipline) so each consumer fails closed and discards its own residue before it stops; the
// snapshot helpers throw on a fault and this wrapper converts the throw to that string. A genuine
// ENOENT that MEANS absence (a tracked path gone from the tree, an unstarted generation) is caught
// at its site and never reaches here as a fault.
function manifestResult(build) {
  try {
    return { value: build() }
  } catch (error) {
    return { error: `manifest: ${error.message}` }
  }
}

const generationDir = (kilnDir, slice, generation) =>
  join(kilnDir, MANIFEST_DIR, createHash('sha256').update(Buffer.from(slice, 'utf8')).digest('hex'), 'gen-' + generation)

// The per-slice generation ordinal: 1 + the count of seal rows for this slice in the append-only
// truth. Provisional rows COUNT — a crashed candidate is a distinct historical attempt, matching the
// S7b "1 + max HISTORICAL ordinal" rule; promote rows are not seals and never count. An absent ledger
// is generation 1; a genuine read fault throws (a hold), never a silent 1. W2-S7b: this stays the
// HISTORICAL allocator and nothing else — an INCOMPLETE read throws, because a hole in the history
// would hand a builder an ordinal an earlier attempt already committed a baseline against, and it
// counts through the REDUCTION so the ordinal it hands out rests on the same candidate schema and
// modern-shape boundary the reduction enforces. Counting parseable rows instead would let a builder
// commit a baseline against a ledger the reduction must hold — one authority, not two.
function sliceGeneration(kilnDir, slice) {
  const read = readLedgerRows(join(kilnDir, SEAL_LEDGER.jsonl))
  if (read === null) return 1
  if (!read.complete) throw new Error('the seal ledger carries a torn or unparseable line — the generation allocator holds rather than reuse an ordinal')
  const history = reduceLedger(kilnDir, SEAL_LEDGER, read).groups.get(slice)
  return 1 + (history === undefined ? 0 : history.length)
}

// Detect the snapshot mode: a real git work tree enumerates through git, anything else (git absent,
// or a directory that is not a work tree) walks deterministically. Any OTHER git failure throws —
// never a silent fallback that would under-cover a broken repo.
function gitWorktree(repo) {
  const r = spawnSync('git', ['-C', repo, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' })
  if (r.error) {
    if (r.error.code === 'ENOENT') return false
    throw new Error(`git probe failed: ${r.error.message}`)
  }
  if (r.status === 0) {
    const out = (r.stdout || '').trim()
    if (out === 'true') return true
    if (out === 'false') return false
    throw new Error(`git probe returned an unexpected result: ${out}`)
  }
  if (/not a git repository/i.test(r.stderr || '')) return false
  throw new Error(`git probe failed: ${(r.stderr || '').trim().slice(-500)}`)
}

// Enumerate NUL-separated paths from git; a spawn error or a nonzero exit throws.
function gitPaths(repo, extra) {
  const r = spawnSync('git', ['-C', repo, 'ls-files', '-z', ...extra], { maxBuffer: 64 * 1024 * 1024 })
  if (r.error) throw new Error(`git ls-files failed: ${r.error.message}`)
  if (r.status !== 0) throw new Error(`git ls-files exited ${r.status}: ${(r.stderr ? r.stderr.toString('utf8') : '').trim().slice(-500)}`)
  return r.stdout.toString('utf8').split('\0').filter((p) => p !== '')
}

// The always-excluded roots: .git and .kiln (and the manifests dir transitively) — the working root's
// VCS metadata and Kiln's own state, never part of a slice delta.
const manifestExcluded = (rel) => rel === '.git' || rel === '.kiln' || rel.slice(0, 5) === '.git/' || rel.slice(0, 6) === '.kiln/'

// One snapshot entry for a working-tree path, hashing ACTUAL bytes. A symlink records its link text
// and is NEVER followed. A regular file is opened O_RDONLY|O_NOFOLLOW and re-verified by fstat (a
// regular file with the same dev+ino the lstat saw) before its bytes are read FROM THE FD, so a
// file-to-symlink or file-to-other-file swap between the lstat and the read is caught rather than
// followed or mis-hashed. ENOENT AFTER ENUMERATION splits by SOURCE (M-04, driver-decided): an
// INDEX-derived tracked path already gone from the working tree is a durable builder deletion — it
// stays out of the snapshot (null) and the diff renders its delete tombstone; a WORKING-TREE-derived
// path (git --others or the non-git walk) that vanishes between enumeration and the snapshot is an
// UNSTABLE read and HOLDs, never a silent drop. A fifo, socket, device, gitlink, a swap, or any other
// lstat/open/read fault HOLDs.
function snapshotEntry(repo, rel, source) {
  const abs = join(repo, rel)
  let st
  try {
    st = lstatSync(abs)
  } catch (error) {
    if (error.code === 'ENOENT') {
      if (source === 'index') return null
      throw new Error(`the working-tree path ${rel} vanished between enumeration and the snapshot — an unstable read`)
    }
    throw new Error(`could not stat ${rel}: ${error.message}`)
  }
  if (st.isSymbolicLink()) {
    let target
    try {
      target = readlinkSync(abs)
    } catch (error) {
      throw new Error(`could not read the symlink ${rel}: ${error.message}`)
    }
    return { path: rel, type: 'symlink', target }
  }
  if (st.isFile()) {
    let fd
    try {
      fd = openSync(abs, FS.O_RDONLY | FS.O_NOFOLLOW)
    } catch (error) {
      throw new Error(`could not open ${rel} without following a link — an unstable path or a file-to-symlink swap: ${error.message}`)
    }
    try {
      const fst = fstatSync(fd)
      if (!fst.isFile()) throw new Error(`${rel} was not a regular file when opened — an unstable path`)
      if (fst.dev !== st.dev || fst.ino !== st.ino) throw new Error(`${rel} was swapped between the stat and the open — an unstable path`)
      const bytes = readFileSync(fd)
      return { path: rel, type: 'file', mode_executable: (st.mode & 0o111) !== 0, sha256: createHash('sha256').update(bytes).digest('hex') }
    } finally {
      try { closeSync(fd) } catch { /* the fd read result stands even if the close fails */ }
    }
  }
  throw new Error(`cannot snapshot an unsupported special path: ${rel}`)
}

// A deterministic, sorted recursive walk of the working root for the non-git mode: every regular file
// and symlink, excluding .git (VCS metadata at any depth) and the root .kiln. Directories recurse in
// sorted order so the enumerated path list is stable across runs. M-04: the walk is a WORKING-TREE
// source — a child that vanishes between the readdir and its lstat is an UNSTABLE read and HOLDs (any
// lstat fault throws, ENOENT included), never a silent continue that would drop a path mid-snapshot.
function walkPaths(repo) {
  const out = []
  const walk = (rel) => {
    let names
    try {
      names = readdirSync(rel === '' ? repo : join(repo, rel))
    } catch (error) {
      throw new Error(`could not read the directory ${rel || '.'}: ${error.message}`)
    }
    for (const name of names.slice().sort()) {
      if (name === '.git' || (rel === '' && name === '.kiln')) continue
      const child = rel === '' ? name : rel + '/' + name
      let st
      try {
        st = lstatSync(join(repo, child))
      } catch (error) {
        throw new Error(`could not stat ${child} during the walk — an unstable read: ${error.message}`)
      }
      if (st.isDirectory()) { walk(child); continue }
      out.push(child)
    }
  }
  walk('')
  return out
}

// The shared enumerator: git tracked + untracked-non-ignored (tracked-ignored INCLUDED, ignored-
// untracked EXCLUDED and declared), else the deterministic walk. Both modes hash working-tree bytes,
// sort entries by UTF-8 path bytes, and exclude .git/** and .kiln/**. Returns { enumerator,
// exclusions, entries } — the canonical snapshot object whose sha256 anchors the baseline and the
// after-digest.
function captureSnapshot(repo) {
  const git = gitWorktree(repo)
  const enumerator = git ? 'git' : 'walk'
  const exclusions = git ? ['.git', '.kiln', 'ignored-untracked'] : ['.git', '.kiln']
  const seen = new Set()
  const tagged = []
  const add = (rel, source) => {
    if (manifestExcluded(rel) || seen.has(rel)) return
    seen.add(rel)
    tagged.push({ rel, source })
  }
  if (git) {
    // M-04: INDEX-derived tracked paths carry the 'index' source (a missing one is a durable
    // deletion); untracked-non-ignored paths carry 'worktree' (a missing one is an unstable read).
    // The seen-dedupe keeps the index source authoritative on the (impossible) overlap.
    for (const p of gitPaths(repo, [])) add(p, 'index')
    for (const p of gitPaths(repo, ['--others', '--exclude-standard'])) add(p, 'worktree')
  } else {
    for (const p of walkPaths(repo)) add(p, 'worktree')
  }
  tagged.sort((a, b) => bytePathCompare(a.rel, b.rel))
  const entries = []
  for (const { rel, source } of tagged) {
    const entry = snapshotEntry(repo, rel, source)
    if (entry !== null) entries.push(entry)
  }
  return { enumerator, exclusions, entries }
}

// Diff two snapshot entry lists into the canonical change list. A path only in the baseline is a
// delete, only in the after is an add, in both with any difference (content, type, or mode) is a
// modify; identical entries yield no change. Renames are a delete plus an add — never inferred.
// Sorted by UTF-8 path bytes.
function diffSnapshots(baseEntries, afterEntries) {
  const index = (list) => { const m = new Map(); for (const e of list) m.set(e.path, e); return m }
  const before = index(baseEntries)
  const after = index(afterEntries)
  const changes = []
  const paths = new Set()
  for (const e of baseEntries) paths.add(e.path)
  for (const e of afterEntries) paths.add(e.path)
  for (const path of paths) {
    const b = before.get(path)
    const a = after.get(path)
    if (b && !a) changes.push({ path, change: 'delete', before: b, after: null })
    else if (!b && a) changes.push({ path, change: 'add', before: null, after: a })
    else if (b && a && canonicalString(b) !== canonicalString(a)) changes.push({ path, change: 'modify', before: b, after: a })
  }
  changes.sort((x, y) => bytePathCompare(x.path, y.path))
  return changes
}

// The content-addressed baseline file for a generation — its name IS its digest, so no write ever
// targets a name a committed key can already reference; a late or concurrent writer with different
// bytes lands a different, inert file rather than clobbering a committed baseline.
const baselineFile = (genDir, sha) => join(genDir, 'baseline-' + sha + '.json')

// ENOENT-only absence at a manifest-store boundary: a path component genuinely absent is a clean
// no-manifest (false); ANY other fault — a file planted where a directory belongs (ENOTDIR), an
// unreadable store (EACCES), a genuine IO fault — is untrusted and throws, so a manifest check never
// falls OPEN into the legacy path over an anomaly it cannot read (the S6 untrusted-read-holds
// discipline on a trust boundary).
function manifestPathPresent(path) {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw new Error(`the manifest store path could not be stated: ${error.message}`)
  }
}

// The exact field set a committed key carries — the sentinel is only trustworthy if it fully declares
// its {slice, generation} identity, so any extra or missing field is a torn key that HOLDs.
const KEY_FIELDS = ['schema_version', 'run_id', 'slice', 'generation', 'enumerator', 'exclusions', 'baseline_sha256', 'created_ts']

// Read and FULLY validate the immutable baseline for a generation (M-03). A missing key means prepare
// or a recompute ran before manifest-start (a wiring bug). The committed key must declare exactly this
// {slice, generation}: its slice and generation must equal the addressed pair, its schema_version must
// be the committed schema, its enumerator must be in the closed set, its exclusions well-formed, its
// baseline_sha256 a 64-hex digest, its run_id string-or-null, and its field set exact — so the sentinel
// reliably establishes the declared key rather than reusing a contradictory one. baseline_sha256 rides
// the key so a truncated baseline is caught here, and the baseline file is content-addressed by it.
function readBaseline(genDir, expectedSlice, expectedGeneration) {
  let key
  try {
    key = JSON.parse(readFileSync(join(genDir, 'key.json'), 'utf8'))
  } catch (error) {
    throw new Error(`the baseline key for this generation is missing or unreadable (manifest-start runs first): ${error.message}`)
  }
  if (!isObject(key)) throw new Error('the baseline key is not a JSON object')
  const keys = Object.keys(key)
  if (keys.length !== KEY_FIELDS.length || KEY_FIELDS.some((f) => !keys.includes(f))) throw new Error('the baseline key field set does not match the committed schema')
  if (key.schema_version !== MANIFEST_SCHEMA) throw new Error('the baseline key schema_version is not the committed schema')
  if (typeof key.slice !== 'string' || key.slice === '') throw new Error('the baseline key slice is malformed')
  if (!Number.isInteger(key.generation)) throw new Error('the baseline key generation is not an integer')
  if (key.enumerator !== 'git' && key.enumerator !== 'walk') throw new Error('the baseline key enumerator is outside the closed set')
  if (!Array.isArray(key.exclusions) || !key.exclusions.every((x) => typeof x === 'string' && x !== '')) throw new Error('the baseline key exclusions are malformed')
  if (!LAW_HASH.test(key.baseline_sha256)) throw new Error('the baseline key baseline_sha256 is not a 64-hex digest')
  if (!(key.run_id === null || typeof key.run_id === 'string')) throw new Error('the baseline key run_id must be a string or null')
  if (typeof key.created_ts !== 'string' || key.created_ts === '') throw new Error('the baseline key created_ts is malformed')
  if (key.slice !== expectedSlice) throw new Error(`the committed baseline key names slice ${key.slice}, not the addressed slice ${expectedSlice}`)
  if (key.generation !== expectedGeneration) throw new Error(`the committed baseline key names generation ${key.generation}, not the addressed generation ${expectedGeneration}`)
  let bytes
  try {
    bytes = readFileSync(baselineFile(genDir, key.baseline_sha256))
  } catch (error) {
    throw new Error(`the baseline snapshot could not be read: ${error.message}`)
  }
  if (createHash('sha256').update(bytes).digest('hex') !== key.baseline_sha256) {
    throw new Error('the baseline snapshot no longer matches its sealed digest — a torn baseline')
  }
  let snapshot
  try {
    snapshot = JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    throw new Error(`the baseline snapshot is not valid JSON: ${error.message}`)
  }
  if (!isObject(snapshot) || !Array.isArray(snapshot.entries)) throw new Error('the baseline snapshot is malformed')
  return { key, snapshot }
}

// Build the canonical manifest for a generation from its immutable baseline and a FRESH after-
// snapshot. The enumerator must match the baseline's (a repo that changed git-ness mid-generation
// throws). Returns the manifest object, its canonical bytes, and its digest — the ONE builder
// manifest-prepare writes and every drift recompute re-runs, so an unchanged tree yields a byte-
// identical digest.
function buildManifest(kilnDir, repo, slice) {
  const generation = sliceGeneration(kilnDir, slice)
  const genDir = generationDir(kilnDir, slice, generation)
  const { key, snapshot } = readBaseline(genDir, slice, generation)
  const after = captureSnapshot(repo)
  if (after.enumerator !== key.enumerator) {
    throw new Error(`the working tree changed enumerator mid-generation: baseline ${key.enumerator}, now ${after.enumerator}`)
  }
  const manifest = {
    schema_version: MANIFEST_SCHEMA,
    coverage_mode: MANIFEST_COVERAGE,
    run_id: key.run_id ?? null,
    slice,
    generation,
    enumerator: key.enumerator,
    exclusions: after.exclusions,
    baseline_sha256: key.baseline_sha256,
    after_sha256: canonicalDigest(after),
    changes: diffSnapshots(snapshot.entries, after.entries),
  }
  const bytes = canonicalBytes(manifest)
  return { generation, genDir, manifest, bytes, sha: createHash('sha256').update(bytes).digest('hex') }
}

// manifest-start: capture the immutable baseline of a generation, or reuse an existing one. A
// committed generation (key.json present) is immutable — a resume or a concurrent-mint loser verifies
// and reuses its baseline rather than re-capturing a tree the builder may already have touched.
// Returns the closed fact `<generation> <baseline_sha256>`.
function manifestStart(kilnDir, repo, slice) {
  return manifestResult(() => {
    const generation = sliceGeneration(kilnDir, slice)
    const genDir = generationDir(kilnDir, slice, generation)
    const keyPath = join(genDir, 'key.json')
    if (existsSync(keyPath)) {
      const { key } = readBaseline(genDir, slice, generation)
      return key.generation + ' ' + key.baseline_sha256
    }
    const snapshot = captureSnapshot(repo)
    const bytes = canonicalBytes(snapshot)
    const baselineSha = createHash('sha256').update(bytes).digest('hex')
    const key = {
      schema_version: MANIFEST_SCHEMA, run_id: runIdFromLock(kilnDir), slice, generation,
      enumerator: snapshot.enumerator, exclusions: snapshot.exclusions, baseline_sha256: baselineSha,
      created_ts: new Date().toISOString(),
    }
    mkdirSync(genDir, { recursive: true })
    // The baseline is CONTENT-ADDRESSED: its name is its own digest, committed 'wx'. An identical name
    // is an idempotent no-op (its bytes are re-verified); a late or concurrent writer whose bytes
    // differ lands a DIFFERENT, inert file and never overwrites a committed baseline. key.json is the
    // O_EXCL commit sentinel and its baseline_sha256 names which baseline file is the committed one, so
    // a loser reuses the intact committed baseline rather than a clobbered one — no generation wedges.
    const baselinePath = baselineFile(genDir, baselineSha)
    commitContentAddressed(baselinePath, bytes, baselineSha, 'content-addressed baseline', 'baseline')
    try {
      writeFileSync(keyPath, canonicalBytes(key), { flag: 'wx' })
    } catch (error) {
      if (error.code === 'EEXIST') {
        const { key: committed } = readBaseline(genDir, slice, generation)
        return committed.generation + ' ' + committed.baseline_sha256
      }
      throw error
    }
    return generation + ' ' + baselineSha
  })
}

// manifest-prepare: capture the after-snapshot, diff it against the baseline, and publish a content-
// addressed manifest plus the current.json pointer (atomic). Returns `<generation> <manifest_sha256>`.
function manifestPrepare(kilnDir, repo, slice) {
  return manifestResult(() => {
    const built = buildManifest(kilnDir, repo, slice)
    const preparedDir = join(built.genDir, 'prepared')
    mkdirSync(preparedDir, { recursive: true })
    // M-01: the prepared manifest is durable content-addressed evidence. An identical name is an
    // idempotent no-op ONLY when its bytes still hash to the name; a name colliding with corrupt or
    // foreign bytes is a torn store that HOLDs, never a silent accept — the baseline commit discipline.
    const preparedPath = join(preparedDir, built.sha + '.json')
    commitContentAddressed(preparedPath, built.bytes, built.sha, 'prepared manifest', 'manifest')
    const tmp = join(built.genDir, '.current.json.tmp-' + process.pid + '-' + randomUUID())
    writeFileSync(tmp, canonicalBytes({ manifest_sha256: built.sha }))
    renameSync(tmp, join(built.genDir, 'current.json'))
    return built.generation + ' ' + built.sha
  })
}

// The drift recompute the publication and seal paths share. A generation NEVER started (no key.json)
// is a legacy pass ({ sha: null }); a STARTED generation whose pointer is missing HOLDs (M-02 — never
// a legacy fall-through). A present pointer requires TWO checks: the durable prepared artifact it
// names must exist and hash to the pointer (M-01), and the freshly recomputed tree digest must equal
// the pointer — either failure throws, so nothing publishes or seals over corrupt evidence or a
// drifted tree.
function manifestRecompute(kilnDir, repo, slice) {
  return manifestResult(() => {
    const generation = sliceGeneration(kilnDir, slice)
    const genDir = generationDir(kilnDir, slice, generation)
    const currentPath = join(genDir, 'current.json')
    if (!manifestPathPresent(currentPath)) {
      if (manifestPathPresent(join(genDir, 'key.json'))) {
        throw new Error('the generation is started but its prepared manifest pointer is missing — refusing to fall through to a legacy publish or seal')
      }
      return { sha: null }
    }
    let current
    try {
      current = JSON.parse(readFileSync(currentPath, 'utf8'))
    } catch (error) {
      throw new Error(`the prepared manifest pointer could not be read: ${error.message}`)
    }
    if (!isObject(current) || !LAW_HASH.test(current.manifest_sha256)) throw new Error('the prepared manifest pointer is malformed')
    let preparedBytes
    try {
      preparedBytes = readFileSync(join(genDir, 'prepared', current.manifest_sha256 + '.json'))
    } catch (error) {
      throw new Error(`the prepared manifest evidence is missing or unreadable: ${error.message}`)
    }
    if (createHash('sha256').update(preparedBytes).digest('hex') !== current.manifest_sha256) {
      throw new Error('the prepared manifest evidence does not match the pointer digest — a torn manifest store')
    }
    const built = buildManifest(kilnDir, repo, slice)
    if (built.sha !== current.manifest_sha256) {
      throw new Error('the working tree drifted from the prepared manifest — refusing to publish or seal a review the diff no longer matches')
    }
    return { sha: built.sha }
  })
}

// The bypass guard (M-02): a generation is STARTED once its key.json exists. A publish or seal that
// omits the repo while a started generation exists would silence the required manifest recompute, so
// the caller HOLDs — a started generation always requires a manifest, never a legacy fall-through.
function manifestGenerationStarted(kilnDir, slice) {
  return manifestResult(() => manifestPathPresent(join(generationDir(kilnDir, slice, sliceGeneration(kilnDir, slice)), 'key.json')))
}

// ── W2-S7a (FORK 1): the canonical contract — the ONE authoritative facts block every transport
// judges ─────────────────────────────────────────────────────────────────────────────────────────
// A contract is the exact set of authoritative facts a review family judged, serialized once through
// canonicalBytes and content-addressed under .kiln/contracts/sha256/<sha>.json. Codex embeds those
// bytes verbatim; the claude legs judge the stored file; publication recomputes the digest and binds
// it beside receipt_sha256 on the reviews row. review_id, timestamps, output paths, model identity,
// transport family and raw mode are EXCLUDED — they are transport, not judged facts. operation is a
// closed value the invoking verb synthesizes: the authorized finding/evidence scope differs per
// operation, so omitting it is rejected.
const CONTRACT_VERSION = 1
const CONTRACT_DIR = 'contracts'
const CONTRACT_OPERATIONS = {
  'slice-review': ['initial', 'recheck'],
  'milestone-audit': ['initial', 'recheck'],
  'artifact-ratify': ['initial', 'recheck'],
  'perceptual-screen': ['initial', 'recheck', 'escalation'],
}
// finding_ids are an insertion-ordered SET in the packet; the contract SORTS them by UTF-8 bytes so
// two composes over the same cohort in any discovery order are byte-identical. prior_findings and
// every other ordered array keep their order.
const sortedFindingIds = (ids) => [...ids].sort(bytePathCompare)

// Read and digest-verify the prepared manifest for a generation dir. A current.json genuinely absent
// with no started key is a legacy pass (null). A started generation whose pointer is missing, a
// malformed pointer, or prepared bytes that no longer hash to it is a torn store that THROWS — the
// untrusted-read-holds discipline (manifestRecompute), never a silent legacy fall-through.
function readPreparedManifest(genDir) {
  const currentPath = join(genDir, 'current.json')
  if (!manifestPathPresent(currentPath)) {
    if (manifestPathPresent(join(genDir, 'key.json'))) {
      throw new Error('the generation is started but its prepared manifest pointer is missing')
    }
    return null
  }
  let current
  try {
    current = JSON.parse(readFileSync(currentPath, 'utf8'))
  } catch (error) {
    throw new Error(`the prepared manifest pointer could not be read: ${error.message}`)
  }
  if (!isObject(current) || !LAW_HASH.test(current.manifest_sha256)) throw new Error('the prepared manifest pointer is malformed')
  let bytes
  try {
    bytes = readFileSync(join(genDir, 'prepared', current.manifest_sha256 + '.json'))
  } catch (error) {
    throw new Error(`the prepared manifest evidence is missing or unreadable: ${error.message}`)
  }
  if (createHash('sha256').update(bytes).digest('hex') !== current.manifest_sha256) {
    throw new Error('the prepared manifest evidence does not match the pointer digest — a torn manifest store')
  }
  let manifest
  try {
    manifest = JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    throw new Error(`the prepared manifest is not valid JSON: ${error.message}`)
  }
  if (!isObject(manifest)) throw new Error('the prepared manifest is not a JSON object')
  return { sha: current.manifest_sha256, manifest }
}

// The reviewed_manifest a slice-review contract embeds: the COMPLETE prepared manifest object for the
// slice's CURRENT generation, digest-verified. A legacy generation with no manifest is an honest null.
function reviewedManifestForSlice(kilnDir, slice) {
  const built = readPreparedManifest(generationDir(kilnDir, slice, sliceGeneration(kilnDir, slice)))
  return built === null ? null : built.manifest
}

// The manifest digest bound to a covered slice generation: the pointer digest when the store exists,
// an honest null for a legacy/pre-manifest sealed generation, a HOLD (throws) on a torn store.
// generation 0 (no current member) is null with no store lookup.
function coveredManifestDigest(kilnDir, slice, generation) {
  if (generation < 1) return null
  const built = readPreparedManifest(generationDir(kilnDir, slice, generation))
  return built === null ? null : built.sha
}

// The milestone-audit coverage tuples over the sealed prefix, in slices.json order — the ONE
// reducer-derived helper (W2-S7b item 5) called for every ordered verified-prefix member. Each tuple
// is the slices SOLE CURRENT rendered generation and that generations manifest digest. A historical
// row count may never author coverage: an invalidated or still-provisional candidate is not
// membership, so it contributes an honest generation 0 rather than a number no seal stands behind.
function coverageTuples(kilnDir, sealedPrefix) {
  const seals = sealState(kilnDir)
  if (!seals.complete) throw new Error('the seal ledger carries a torn or unparseable line — coverage is never authored from a history with a hole')
  return sealedPrefix.map((slice) => currentSealTuple(seals, kilnDir, slice))
}

// Hash the RAW bytes of an evidence image for a perceptual-screen contract — a Buffer digest, so a
// 0xff byte is covered exactly and never utf8-decoded. Unreadable HOLDs (throws); the image paths are
// already realpath-contained by screenEvidence, so this is the byte-capture the manifest digest alone
// cannot prove.
function hashImageBytes(abs) {
  let bytes
  try {
    bytes = readFileSync(abs)
  } catch (error) {
    throw new Error(`a screen evidence image could not be read for its digest: ${error.message}`)
  }
  return createHash('sha256').update(bytes).digest('hex')
}

// The perceptual-screen contract facts: the screen packet body with the attached and reference images
// resolved to ORDERED {name, sha256} arrays (evidence order preserved) and the evidence-manifest
// digest named distinctly from any FORK-3 control manifest.
function screenContractFacts(packetBody, generation, evidence) {
  const attached_images = evidence.imageNames.map((name, i) => ({ name, sha256: hashImageBytes(evidence.images[i]) }))
  const reference_images = attached_images.slice(evidence.imageNames.length - evidence.references.length)
  return {
    law_lock_hash: packetBody.law_lock_hash,
    evidence_manifest_sha256: generation.digest,
    generation: generation.number,
    perceptual_criteria: packetBody.perceptual_criteria,
    rubric: packetBody.rubric,
    attached_images,
    reference_images,
    meta: packetBody.meta,
    console_log: packetBody.console_log,
    dom_excerpt: packetBody.dom_excerpt,
  }
}

// The ONE composer every transport shares: assemble the closed payload for a kind+operation from
// trusted facts, canonicalize, digest. A kind or operation outside the closed set THROWS (a caller
// bug, never a silent accept). Returns { contract, bytes, sha }.
function composeContract(kind, operation, facts) {
  const ops = CONTRACT_OPERATIONS[kind]
  if (!ops) throw new Error(`contract kind ${kind} is outside the closed set`)
  if (!ops.includes(operation)) throw new Error(`contract operation ${operation} is not valid for ${kind}`)
  let payload
  if (kind === 'slice-review') {
    payload = {
      contract_version: CONTRACT_VERSION,
      contract_kind: kind,
      operation,
      slice_id: facts.slice_id,
      law_hash: facts.law_hash,
      law_text: facts.law_text,
      builder_hints: facts.builder_hints,
      receipt_sha256: facts.receipt_sha256,
      reviewed_manifest: facts.reviewed_manifest,
    }
    if (operation === 'recheck') {
      payload.finding_ids = sortedFindingIds(facts.finding_ids)
      payload.prior_findings = facts.prior_findings
      payload.repair_delta = facts.repair_delta
    }
  } else if (kind === 'milestone-audit') {
    payload = {
      contract_version: CONTRACT_VERSION,
      contract_kind: kind,
      operation,
      law_hash: facts.law_hash,
      seam_slice: facts.seam_slice,
      milestone: facts.milestone,
      closing_block: facts.closing_block,
      sealed_prefix: facts.sealed_prefix,
      covered: facts.covered,
      receipt_sha256: facts.receipt_sha256,
    }
    if (operation === 'recheck') {
      payload.finding_ids = sortedFindingIds(facts.finding_ids)
      payload.prior_findings = facts.prior_findings
      payload.repair_delta = facts.repair_delta
    }
  } else if (kind === 'artifact-ratify') {
    // W2-S7a (F4): purpose is a CLOSED set — the ratify family word, never an arbitrary review family.
    // Enforced HERE so both transports (the codex ratify verbs and contract-prepare) reject uniformly;
    // a caller copying a review family like screen into purpose is a caller bug, never a silent accept.
    if (facts.purpose !== 'ratify' && facts.purpose !== 'feasibility') {
      throw new Error(`artifact-ratify purpose must be ratify or feasibility, not ${facts.purpose}`)
    }
    payload = {
      contract_version: CONTRACT_VERSION,
      contract_kind: kind,
      operation,
      purpose: facts.purpose,
      artifact_path: facts.artifact_path,
      artifact_sha256: facts.artifact_sha256,
      artifact: facts.artifact,
      rubric: facts.rubric,
      receipt_sha256: null,
    }
    if (operation === 'recheck') {
      payload.finding_ids = sortedFindingIds(facts.finding_ids)
      payload.prior_findings = facts.prior_findings
    }
  } else {
    // perceptual-screen: escalation carries the survivor rows in perceptual_criteria (the caller filters
    // them), and — W2-S7a (F1) — ALSO the scoped cohort exactly as recheck does: the sorted finding_ids
    // and ordered prior_findings drawn from the held verdict. Without the cohort two held verdicts with
    // different findings but identical surviving criteria compose identical bytes, and the kernel would
    // have to recover the missing authority from the mutable prior gate.
    payload = {
      contract_version: CONTRACT_VERSION,
      contract_kind: kind,
      operation,
      law_lock_hash: facts.law_lock_hash,
      evidence_manifest_sha256: facts.evidence_manifest_sha256,
      generation: facts.generation,
      perceptual_criteria: facts.perceptual_criteria,
      rubric: facts.rubric,
      attached_images: facts.attached_images,
      reference_images: facts.reference_images,
      meta: facts.meta,
      console_log: facts.console_log,
      dom_excerpt: facts.dom_excerpt,
    }
    if (operation === 'recheck' || operation === 'escalation') {
      payload.finding_ids = sortedFindingIds(facts.finding_ids)
      payload.prior_findings = facts.prior_findings
    }
  }
  const bytes = canonicalBytes(payload)
  return { contract: payload, bytes, sha: createHash('sha256').update(bytes).digest('hex') }
}

const contractStoreFile = (kilnDir, sha) => join(kilnDir, CONTRACT_DIR, 'sha256', sha + '.json')

// ── W2-S7b (items 6-8): the candidate attestations ───────────────────────────────────────────────
// A MODERN candidate is only ever appended over evidence this CLI validated itself. A REVIEWED
// candidate binds BY REFERENCE to exactly one fully valid reviews.jsonl row: that single reference
// carries all four S7a captures — the check receipt, the reviewer identity, the control-derived
// manifest and the canonical contract — so none of their bodies is duplicated onto the ledger row
// (D4 closes by reference, not by copy). A VERDICTLESS candidate had no gate at all, so it carries
// its own validated digests instead, and the kind itself is the whole no-review reason (D3). Every
// non-pending validation happens ONCE, here at the append; promotion later re-checks only what can
// still change — pending identity, eligibility, coverage — and never rehashes an advanced tree.
const GATE_FILE = { review: 'gate-review.json', audit: 'audit-review.json' }

// The LIVE trio, verified in the act of reading it (the run-checks discipline): a drifted member is
// the integrity class and holds at 22, so no candidate is ever attested over a law that moved.
function liveTrioDigests(kilnDir, label) {
  const auth = sealedAuthority(kilnDir)
  if (!auth.sealed) stop('transport_failure', `${label} requires the sealed law`, TRANSPORT_FAILURE)
  const digests = {}
  for (const name of TRIO_MEMBERS) digests[name] = createHash('sha256').update(verifyMember(auth, kilnDir, name, label)).digest('hex')
  return { lockHash: auth.lockHash, digests }
}

// Parse the FIXED gate file of a family into the reference key a reviewed candidate binds by. The
// published verdict must be an ACCEPT — a candidate attested by a verdict that did not pass is the
// forgery this reference exists to make impossible. verdict_sha256 digests the EXACT published bytes
// (the Buffer, never a utf8 re-encode), the same key archiveVerdict filed the row under.
function reviewedReference(kilnDir, family) {
  let bytes
  try {
    bytes = readFileSync(join(kilnDir, GATE_FILE[family]))
  } catch (error) {
    return { error: `the published ${family} verdict could not be read for the candidate reference: ${error.message}` }
  }
  let verdict
  try {
    verdict = JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    return { error: `the published ${family} verdict could not be parsed for the candidate reference: ${error.message}` }
  }
  if (!isObject(verdict) || typeof verdict.review_id !== 'string' || verdict.review_id.trim() === '') {
    return { error: `the published ${family} verdict carries no review_id` }
  }
  if (verdict.verdict !== 'accept') {
    return { error: `the published ${family} verdict is not an accept — no candidate is attested by a verdict that did not pass` }
  }
  return { ref: { family, review_id: verdict.review_id, verdict_sha256: createHash('sha256').update(bytes).digest('hex') } }
}

// Select EXACTLY ONE archive row by the reference key. Zero rows means the verdict on disk was never
// archived (a torn publish); more than one is contradictory history. Either way the append HOLDs
// rather than bind a candidate to a row it cannot name uniquely.
function referencedArchiveRow(kilnDir, ref) {
  let raw = ''
  try {
    raw = readFileSync(join(kilnDir, REVIEWS_FILE), 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') return { error: `the review archive could not be read: ${error.message}` }
  }
  const matched = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    let row
    try { row = JSON.parse(line) } catch { continue }
    if (isObject(row) && row.family === ref.family && row.review_id === ref.review_id && row.verdict_sha256 === ref.verdict_sha256) matched.push(row)
  }
  if (matched.length !== 1) return { error: 'the referenced verdict does not match exactly one archived review row' }
  return { row: matched[0] }
}

// The evidence a reviewed archive row must OWN before it can attest anything: the accept verdict, a
// reviewer identity this ledger knows in the reviewer-class role of its family, a NON-NULL receipt
// digest, and the canonical contract the gate judged, still whole in the store. A missing or
// malformed field is a row written before a capture existed or outside the trusted path — it attests
// nothing, so the append HOLDs rather than seal on a reference that proves less than it claims.
function archiveRowEvidenceInvalid(kilnDir, row, family) {
  if (row.verdict !== 'accept') return 'the archived row is not an accept'
  if (typeof row.reviewer_leg_id !== 'string' || !LEG_ID.test(row.reviewer_leg_id)) return 'the archived row carries no reviewer identity'
  const leg = identityIndex(kilnDir).legs.get(row.reviewer_leg_id)
  if (!leg) return 'the archived reviewer identity is unknown to the identity ledger'
  if (leg.role !== CODEX_ROLE[family]) return 'the archived reviewer identity does not carry the reviewer role of its family'
  if (!LAW_HASH.test(row.receipt_sha256)) return 'the archived row carries no check-receipt digest'
  if (!LAW_HASH.test(row.contract_sha256)) return 'the archived row carries no canonical contract digest'
  return verifyContractStore(kilnDir, row.contract_sha256)
}

function readStoredContract(kilnDir, sha) {
  let contract
  try {
    contract = JSON.parse(readFileSync(contractStoreFile(kilnDir, sha), 'utf8'))
  } catch (error) {
    return { error: `the referenced contract could not be read: ${error.message}` }
  }
  if (!isObject(contract)) return { error: 'the referenced contract is not a JSON object' }
  return { contract }
}

// The reviewed SEAL attestation, validated before the manifest recompute so the recompute stays the
// last operation before the append. It returns the reference the row carries and the manifest digest
// the archive row bound — the caller proves that digest is still what the tree yields. The contract
// SEMANTICS are parsed, not trusted: the judged contract must name THIS slice, the law sealed right
// now, the same receipt the row bound, and the same manifest, so a contract that judged something
// else can never attest this candidate.
function reviewedSealAttestation(kilnDir, slice, lockHash) {
  const reference = reviewedReference(kilnDir, 'review')
  if (reference.error) return reference
  const archived = referencedArchiveRow(kilnDir, reference.ref)
  if (archived.error) return archived
  const row = archived.row
  const evidence = archiveRowEvidenceInvalid(kilnDir, row, 'review')
  if (evidence) return { error: evidence }
  if (!LAW_HASH.test(row.manifest_sha256)) return { error: 'the archived row carries no control-derived manifest digest' }
  const read = readStoredContract(kilnDir, row.contract_sha256)
  if (read.error) return read
  const contract = read.contract
  if (contract.contract_kind !== 'slice-review') return { error: 'the referenced contract is not a slice review' }
  if (contract.slice_id !== slice) return { error: 'the referenced contract judged another slice' }
  if (contract.law_hash !== lockHash) return { error: 'the referenced contract judged another law than the one sealed now' }
  if (contract.receipt_sha256 !== row.receipt_sha256) return { error: 'the referenced contract judged another check receipt than the archived row bound' }
  let judged
  try {
    judged = canonicalDigest(contract.reviewed_manifest)
  } catch (error) {
    return { error: `the referenced contract carries an unserializable reviewed manifest: ${error.message}` }
  }
  if (judged !== row.manifest_sha256) return { error: 'the referenced contract judged another working-tree manifest than the archived row bound' }
  // The reference names the identity the ARCHIVE ROW owns, never the one argv offered: that is the
  // leg that actually reviewed, and it is what promotion is made to wait on.
  return { ref: { ...reference.ref, reviewer_leg_id: row.reviewer_leg_id }, manifestSha256: row.manifest_sha256 }
}

// The reviewed AUDIT attestation, the symmetric form. An audit binds no manifest of its own: its
// working-tree evidence IS the ordered coverage its contract judged, and the serialized append RELIES
// on that just-prepared contract rather than re-deriving the current tuples a second time — currency
// is re-proved once, at promotion, and the reduction refuses membership to any audit whose coverage
// has stopped matching. What IS validated here is the coverage the row will carry: well-formed
// tuples, and every covered member at a real generation — a generation 0 is an absence, and an audit
// never claims to have covered a slice nothing seals.
function reviewedAuditAttestation(kilnDir, seam, lockHash) {
  const reference = reviewedReference(kilnDir, 'audit')
  if (reference.error) return reference
  const archived = referencedArchiveRow(kilnDir, reference.ref)
  if (archived.error) return archived
  const row = archived.row
  const evidence = archiveRowEvidenceInvalid(kilnDir, row, 'audit')
  if (evidence) return { error: evidence }
  if (!LAW_HASH.test(row.receipt_sha256)) return { error: 'the archived row carries no check-receipt digest' }
  const read = readStoredContract(kilnDir, row.contract_sha256)
  if (read.error) return read
  const contract = read.contract
  if (contract.contract_kind !== 'milestone-audit') return { error: 'the referenced contract is not a milestone audit' }
  if (contract.seam_slice !== seam) return { error: 'the referenced contract judged another seam' }
  if (contract.law_hash !== lockHash) return { error: 'the referenced contract judged another law than the one sealed now' }
  if (contract.receipt_sha256 !== row.receipt_sha256) return { error: 'the referenced contract judged another check receipt than the archived row bound' }
  if (coverageInvalid(contract.covered)) return { error: 'the referenced contract carries no well-formed ordered coverage' }
  if (contract.covered.some((tuple) => tuple.generation < 1)) return { error: 'the referenced contract covers a slice with no current sealed membership' }
  return { ref: { ...reference.ref, reviewer_leg_id: row.reviewer_leg_id }, covered: contract.covered }
}

// Is a stored ordered coverage still exactly the current seal tuples? The PROMOTION check (item 7):
// seals may have moved while an audit identity resolved, so the one moment membership is conferred is
// the one moment currency is re-proved. The comparison is canonical, not byte-exact: two structurally
// identical tuple lists compare equal whatever key order they were written in. A torn manifest store
// surfaces as an error, never as a silent mismatch.
function coverageStillCurrent(kilnDir, covered) {
  try {
    const seals = sealState(kilnDir)
    if (!seals.complete) return { error: 'the seal ledger carries a torn or unparseable line — coverage is never proven against a history with a hole' }
    const fresh = covered.map((tuple) => currentSealTuple(seals, kilnDir, tuple.slice))
    return { current: canonicalDigest(covered) === canonicalDigest(fresh) }
  } catch (error) {
    return { error: `the current seal tuples could not be derived for the coverage check: ${error.message}` }
  }
}

// Join the archive-bound reviewer identity to the candidate. The identity that actually reviewed is
// the one promotion must wait on, so an argv leg naming anyone else is a claim the append refuses
// outright, and a bound leg that is still a pending intent makes the row PROVISIONAL whatever argv
// offered. Without this a candidate could take membership while the reviewer its reference names was
// never resolved — a seal whose review nobody can prove happened. The bound leg rides the reference,
// so promotion tracks it from the row itself.
function bindAttestedIdentity(kilnDir, row, argvLeg, verb) {
  const bound = row.review_ref.reviewer_leg_id
  if (typeof argvLeg === 'string' && LEG_ID.test(argvLeg) && argvLeg !== bound) {
    stop('transport_failure', `${verb} was handed a reviewer identity the referenced review does not name — refusing to bind a review to another leg`, TRANSPORT_FAILURE)
  }
  const idx = identityIndex(kilnDir)
  const leg = idx.legs.get(bound)
  if (!leg) stop('transport_failure', `${verb} cannot find the referenced reviewer identity in the identity ledger`, TRANSPORT_FAILURE)
  if (leg.kind === 'intent' && !idx.resolvedIds.has(bound)) {
    row.provisional = true
    if (typeof row.candidate_id !== 'string') row.candidate_id = randomBytes(16).toString('hex')
  }
}

// The VERDICTLESS attestation (item 8): the kind IS the reason, so there is no gate file, no review
// row and no contract to reference. The candidate carries its own validated evidence instead — the
// live trio digests, the current check receipt, and (checked by the caller after the recompute) the
// manifest of this generation. Its builder identities are validated in the leg block, exactly as any
// other seal, so a degraded seal still names who built it.
function verdictlessAttestation(kilnDir, trio) {
  const receipt = receiptDigestAtPublication(kilnDir, 'review')
  if (receipt.error) return receipt
  if (receipt.digest === null) return { error: 'no check receipt stands behind the verdictless seal' }
  return { fields: { trio_sha256: trio, receipt_sha256: receipt.digest } }
}

// Commit the contract bytes CONTENT-ADDRESSED (wx), the baseline/prepared discipline: an identical
// name whose bytes still hash to it is an idempotent no-op; a name colliding with foreign bytes is a
// torn store that THROWS, never a silent accept.
function writeContractStore(kilnDir, bytes, sha) {
  const dir = join(kilnDir, CONTRACT_DIR, 'sha256')
  mkdirSync(dir, { recursive: true })
  const path = contractStoreFile(kilnDir, sha)
  commitContentAddressed(path, bytes, sha, 'content-addressed contract', 'contract')
}

// Compose and store in one step; the built { bytes, sha } feed the embed and the publication binding.
function prepareContract(kilnDir, kind, operation, facts) {
  const built = composeContract(kind, operation, facts)
  writeContractStore(kilnDir, built.bytes, built.sha)
  return built
}

// The publication binding every transport runs before it archives and renames: the store entry named
// by the supplied digest must exist and its bytes must re-hash to that digest. Returns null on match,
// an error string on any fault so the caller fails closed.
function verifyContractStore(kilnDir, sha) {
  if (typeof sha !== 'string' || !LAW_HASH.test(sha)) return `the supplied contract digest is not a 64-hex digest`
  let bytes
  try {
    bytes = readFileSync(contractStoreFile(kilnDir, sha))
  } catch (error) {
    return `the contract store entry is missing or unreadable: ${error.message}`
  }
  if (createHash('sha256').update(bytes).digest('hex') !== sha) {
    return 'the contract store entry does not match the supplied digest — a torn or mismatched contract'
  }
  return null
}


module.exports = { AUDIT_KINDS, AUDIT_LEDGER, BUILDER_LEG_ROLES, CODEX_ROLE, CONTRACT_DIR, IDENTITY_ROLES,
  LEG_ID, MANIFEST_DIR, SEAL_KINDS, SEAL_LEDGER, allProjectTranscripts, appendIdentityRow, appendLedgerRow,
  bindAttestedIdentity, composeContract, coverageStillCurrent, crossCheckModel, discoverDriverTranscript,
  identityIndex, liveTrioDigests, manifestGenerationStarted, manifestPathPresent, manifestPrepare,
  manifestRecompute, manifestResult, manifestStart, milestoneAuditFacts, prepareContract, publishVerdict,
  readLedgerRows, receiptDigestAtPublication, reconcileLedger, reconcileLedgers, reduceLedger,
  reviewedAuditAttestation, reviewedSealAttestation, runIdFromLock, scanTranscriptForLabel,
  screenContractFacts, sliceReviewFacts, verdictlessAttestation, verifyContractStore, writeContractStore }