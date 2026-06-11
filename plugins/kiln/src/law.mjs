// law.mjs — THE LAW pure core (BLUEPRINT §5/§5.1): law.json shape validation, the per-slice
// flip plan (expected RED→GREEN set + regression set), and the law summary. Consumed two ways:
// imported by scripts/kiln-law.mjs (which validates .kiln/law.json against the schema on every
// command — validateLaw mirrors schemas/law.schema.json field-for-field, no ajv, no deps), and
// inlinable into workflows by scripts/bundle-workflows.mjs. Pure functions only: no I/O, no
// Date.now/Math.random — workflow determinism rules apply here.
//
// Bundler discipline: each export is a self-contained block (no shared module-level helpers —
// they would not survive inlining).

// validateLaw(law) — the .kiln/law.json contract (BLUEPRINT §5.1), mirroring
// schemas/law.schema.json plus the cross-field invariants a JSON schema cannot express:
// duplicate check ids are rejected, and the document must sit in one of its two legal states —
// pre-lock (lock_commit null, every sha256 map EMPTY — as Asimov writes it) or locked
// (lock_commit a git sha, every check's sha256 map covering EXACTLY its files — as kiln-law
// index rewrites it). Returns { ok, errors } with typed errors ({ code, path, message }) so
// callers can report precisely.
export function validateLaw(law) {
  // codes: not_object | unknown_key | invalid_value | missing_key | duplicate_id | lock_state
  const errors = []
  const err = (code, path, message) => errors.push({ code, path, message })
  if (!law || typeof law !== 'object' || Array.isArray(law)) {
    return { ok: false, errors: [{ code: 'not_object', path: 'law', message: 'law.json must be a JSON object' }] }
  }
  for (const k of Object.keys(law)) if (!['schema', 'lock_commit', 'checks'].includes(k)) err('unknown_key', k, `unknown top-level key '${k}'`)
  for (const k of ['schema', 'lock_commit', 'checks']) if (!(k in law)) err('missing_key', k, `missing top-level key '${k}'`)
  if (law.schema !== 1) err('invalid_value', 'schema', 'schema must be 1')
  const locked = typeof law.lock_commit === 'string'
  if (law.lock_commit !== null && !(locked && /^[0-9a-f]{7,40}$/.test(law.lock_commit))) {
    err('invalid_value', 'lock_commit', 'lock_commit must be a 7-40 char hex git sha or null (pre-lock)')
  }
  if (!Array.isArray(law.checks) || law.checks.length === 0) {
    err('invalid_value', 'checks', 'checks must be a non-empty array')
    return { ok: errors.length === 0, errors }
  }
  const KEYS = ['id', 'milestone', 'kind', 'cmd', 'files', 'sha256', 'expected', 'timeout_s', 'pre_satisfied']
  const KINDS = ['shell', 'pytest', 'http', 'probe']
  const seen = []
  law.checks.forEach((c, i) => {
    const at = `checks[${i}]`
    if (!c || typeof c !== 'object' || Array.isArray(c)) { err('invalid_value', at, `${at} must be an object`); return }
    for (const k of Object.keys(c)) if (!KEYS.includes(k)) err('unknown_key', `${at}.${k}`, `${at}: unknown key '${k}'`)
    for (const k of ['id', 'milestone', 'kind', 'cmd', 'files', 'sha256', 'expected', 'timeout_s']) if (!(k in c)) err('missing_key', `${at}.${k}`, `${at}: missing key '${k}'`)
    if (typeof c.id !== 'string' || !/^SC-\d+$/.test(c.id)) err('invalid_value', `${at}.id`, `${at}: id must match SC-<digits> (got ${JSON.stringify(c.id)})`)
    else if (seen.includes(c.id)) err('duplicate_id', `${at}.id`, `${at}: duplicate check id '${c.id}' — every SC has exactly ONE check entry`)
    else seen.push(c.id)
    if (typeof c.milestone !== 'string' || c.milestone === '') err('invalid_value', `${at}.milestone`, `${at}: milestone must be a nonempty string`)
    if (!KINDS.includes(c.kind)) err('invalid_value', `${at}.kind`, `${at}: kind must be one of ${KINDS.join('|')}`)
    // cmd is the exact command run from the project root; only probe TEMPLATES (P3 instantiates
    // them) may carry an empty cmd.
    if (typeof c.cmd !== 'string' || (c.cmd === '' && c.kind !== 'probe')) err('invalid_value', `${at}.cmd`, `${at}: cmd must be a nonempty string (empty allowed only for kind 'probe')`)
    if (!Array.isArray(c.files) || c.files.length === 0) err('invalid_value', `${at}.files`, `${at}: files must be a non-empty array of paths`)
    else c.files.forEach((p, j) => {
      // locked paths are projectPath-relative and may never escape it — they are hash-map keys
      // and git pathspecs, so an absolute or '..' path would break the tamper model.
      if (typeof p !== 'string' || p === '' || p.startsWith('/') || p.split('/').includes('..')) {
        err('invalid_value', `${at}.files[${j}]`, `${at}: files[${j}] must be a relative path inside the project (no leading '/', no '..')`)
      }
    })
    if (!c.sha256 || typeof c.sha256 !== 'object' || Array.isArray(c.sha256)) err('invalid_value', `${at}.sha256`, `${at}: sha256 must be an object mapping path → hash`)
    else {
      const files = Array.isArray(c.files) ? c.files : []
      for (const [p, h] of Object.entries(c.sha256)) {
        if (!files.includes(p)) err('invalid_value', `${at}.sha256`, `${at}: sha256 has key '${p}' which is not in files`)
        if (typeof h !== 'string' || !/^[0-9a-f]{64}$/.test(h)) err('invalid_value', `${at}.sha256`, `${at}: sha256['${p}'] must be a 64-char hex digest`)
      }
      // the two legal states (§5.1): pre-lock ⇒ EMPTY map; locked ⇒ every file hashed.
      if (locked) {
        for (const p of files) if (typeof p === 'string' && !(p in c.sha256)) err('lock_state', `${at}.sha256`, `${at}: locked law must hash every file — '${p}' missing from sha256`)
      } else if (Object.keys(c.sha256).length) {
        err('lock_state', `${at}.sha256`, `${at}: pre-lock law (lock_commit null) must have an EMPTY sha256 map — only kiln-law index writes hashes`)
      }
    }
    if (c.expected !== 'exit0') err('invalid_value', `${at}.expected`, `${at}: expected must be 'exit0'`)
    if (!Number.isInteger(c.timeout_s) || c.timeout_s < 1) err('invalid_value', `${at}.timeout_s`, `${at}: timeout_s must be an integer ≥ 1`)
    if ('pre_satisfied' in c && typeof c.pre_satisfied !== 'boolean') err('invalid_value', `${at}.pre_satisfied`, `${at}: pre_satisfied must be a boolean when present`)
  })
  return { ok: errors.length === 0, errors }
}

// flipPlan(law, sliceScIds, statusBefore) — the §5.1 red/green lifecycle arithmetic for ONE
// slice. sliceScIds are the SC ids the slice declares it flips; statusBefore maps check id →
// 'green'|'red'|'deferred' (the kiln-law status fold of the last run before the slice; a
// missing entry reads as 'red' — every check is expected RED at lock). Returns, all in law.json
// check order:
//   flip          — ids that must go RED→GREEN for the slice to be DONE
//   regression    — ids GREEN before the slice (status green, or pre_satisfied at lock) that
//                   must STAY GREEN — no previously-GREEN check may regress
//   pre_satisfied — slice ids excluded from flip accounting (§5.1: GREEN-at-lock / already
//                   green before the slice); they also appear in regression
//   deferred      — slice ids whose check cannot run yet (probe templates in P2) — neither
//                   flip nor regression accounting applies
//   unknown       — slice ids with NO law.json entry: coverage is arithmetic, not judgment —
//                   returned, never thrown; the caller escalates
export function flipPlan(law, sliceScIds, statusBefore) {
  const checks = (law && Array.isArray(law.checks)) ? law.checks.filter((c) => c && typeof c.id === 'string') : []
  const status = (statusBefore && typeof statusBefore === 'object' && !Array.isArray(statusBefore)) ? statusBefore : {}
  const ids = Array.isArray(sliceScIds) ? [...new Set(sliceScIds)] : []
  const known = checks.map((c) => c.id)
  const unknown = ids.filter((id) => !known.includes(id))
  const flip = []
  const regression = []
  const preSatisfied = []
  const deferred = []
  for (const c of checks) {
    const before = status[c.id]
    const greenBefore = before === 'green' || c.pre_satisfied === true
    const inSlice = ids.includes(c.id)
    if (greenBefore) {
      regression.push(c.id)
      if (inSlice) preSatisfied.push(c.id)
    } else if (inSlice) {
      if (before === 'deferred') deferred.push(c.id)
      else flip.push(c.id)
    }
  }
  return { flip, regression, pre_satisfied: preSatisfied, deferred, unknown }
}

// lawSummary(law) — fold the law into log/ledger-ready counts: total checks, unique locked
// files, per-kind and per-milestone tallies (in first-appearance order), lock state, and a
// one-line rendering. Tolerates a malformed law (counts what it can) — summarising never throws.
export function lawSummary(law) {
  const checks = (law && Array.isArray(law.checks)) ? law.checks.filter((c) => c && typeof c === 'object') : []
  const byKind = {}
  const byMilestone = {}
  const files = []
  for (const c of checks) {
    if (typeof c.kind === 'string') byKind[c.kind] = (byKind[c.kind] || 0) + 1
    if (typeof c.milestone === 'string') byMilestone[c.milestone] = (byMilestone[c.milestone] || 0) + 1
    if (Array.isArray(c.files)) for (const p of c.files) if (typeof p === 'string' && !files.includes(p)) files.push(p)
  }
  const lockCommit = (law && typeof law.lock_commit === 'string') ? law.lock_commit : null
  const kinds = Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(', ')
  const line = `${checks.length} check(s)${kinds ? ` (${kinds})` : ''} across ${Object.keys(byMilestone).length} milestone(s), ${files.length} locked file(s) — ${lockCommit ? `locked @ ${lockCommit.slice(0, 7)}` : 'UNLOCKED'}`
  return { checks: checks.length, files: files.length, by_kind: byKind, by_milestone: byMilestone, locked: lockCommit !== null, lock_commit: lockCommit, line }
}
