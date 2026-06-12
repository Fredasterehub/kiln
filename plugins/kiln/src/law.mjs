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
// index rewrites it). kind:'probe' checks may carry a `spec` — the declarative browser-probe
// contract (BLUEPRINT §7 Tier-1) that kiln-probe executes: url path, landmarks by role+name,
// interaction steps, viewports, and the serve arrangement; spec is legal ONLY on probes, and a
// spec-less probe is an un-instantiated template (the runner defers it, never errors). Returns
// { ok, errors } with typed errors ({ code, path, message }) so callers can report precisely.
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
  const KEYS = ['id', 'milestone', 'kind', 'cmd', 'files', 'sha256', 'expected', 'timeout_s', 'pre_satisfied', 'spec']
  const KINDS = ['shell', 'pytest', 'http', 'probe']
  // the probe spec contract (§7 Tier-1) — declarative assertions only, never browser code
  const SPEC_KEYS = ['url', 'landmarks', 'interactions', 'viewports', 'serve_cmd', 'base_url', 'serve_dir']
  const ACTIONS = ['click', 'fill', 'press', 'expect']
  const nonempty = (v) => typeof v === 'string' && v !== ''
  const validateSpec = (s, at) => {
    if (!s || typeof s !== 'object' || Array.isArray(s)) { err('invalid_value', at, `${at} must be an object (the §7 probe spec)`); return }
    for (const k of Object.keys(s)) if (!SPEC_KEYS.includes(k)) err('unknown_key', `${at}.${k}`, `${at}: unknown spec key '${k}'`)
    if (!nonempty(s.url) || !s.url.startsWith('/')) err('invalid_value', `${at}.url`, `${at}: url must be a path starting with '/' (joined to the served base URL)`)
    if (!Array.isArray(s.landmarks) || s.landmarks.length === 0) err('invalid_value', `${at}.landmarks`, `${at}: landmarks must be a non-empty array of {role, name} — the SC's key UI elements by role+name`)
    else s.landmarks.forEach((lm, j) => {
      const lat = `${at}.landmarks[${j}]`
      if (!lm || typeof lm !== 'object' || Array.isArray(lm)) { err('invalid_value', lat, `${lat} must be an object {role, name}`); return }
      for (const k of Object.keys(lm)) if (!['role', 'name'].includes(k)) err('unknown_key', `${lat}.${k}`, `${lat}: unknown landmark key '${k}'`)
      if (!nonempty(lm.role) || !nonempty(lm.name)) err('invalid_value', lat, `${lat}: role and name must be nonempty strings (selectors by role+name, never CSS)`)
    })
    if ('interactions' in s) {
      if (!Array.isArray(s.interactions)) err('invalid_value', `${at}.interactions`, `${at}: interactions must be an array of steps`)
      else s.interactions.forEach((step, j) => {
        const iat = `${at}.interactions[${j}]`
        if (!step || typeof step !== 'object' || Array.isArray(step)) { err('invalid_value', iat, `${iat} must be an object`); return }
        for (const k of Object.keys(step)) if (!['action', 'role', 'name', 'value', 'key'].includes(k)) err('unknown_key', `${iat}.${k}`, `${iat}: unknown interaction key '${k}'`)
        if (!ACTIONS.includes(step.action)) { err('invalid_value', `${iat}.action`, `${iat}: action must be one of ${ACTIONS.join('|')}`); return }
        if ((step.action === 'click' || step.action === 'expect') && (!nonempty(step.role) || !nonempty(step.name))) err('invalid_value', iat, `${iat}: ${step.action} requires role and name`)
        if (step.action === 'fill' && (!nonempty(step.role) || !nonempty(step.name) || typeof step.value !== 'string')) err('invalid_value', iat, `${iat}: fill requires role, name, and a string value`)
        if (step.action === 'press' && !nonempty(step.key)) err('invalid_value', iat, `${iat}: press requires key (e.g. 'Enter')`)
      })
    }
    if ('viewports' in s) {
      if (!Array.isArray(s.viewports) || s.viewports.length === 0) err('invalid_value', `${at}.viewports`, `${at}: viewports must be a non-empty array of {width, height}`)
      else s.viewports.forEach((vp, j) => {
        const vat = `${at}.viewports[${j}]`
        if (!vp || typeof vp !== 'object' || Array.isArray(vp)) { err('invalid_value', vat, `${vat} must be an object {width, height}`); return }
        for (const k of Object.keys(vp)) if (!['width', 'height'].includes(k)) err('unknown_key', `${vat}.${k}`, `${vat}: unknown viewport key '${k}'`)
        if (!Number.isInteger(vp.width) || vp.width < 1 || !Number.isInteger(vp.height) || vp.height < 1) err('invalid_value', vat, `${vat}: width and height must be integers ≥ 1`)
      })
    }
    if ('serve_cmd' in s && !nonempty(s.serve_cmd)) err('invalid_value', `${at}.serve_cmd`, `${at}: serve_cmd must be a nonempty command string`)
    if ('base_url' in s && !(typeof s.base_url === 'string' && /^https?:\/\/\S+$/.test(s.base_url))) err('invalid_value', `${at}.base_url`, `${at}: base_url must be an http(s) URL`)
    if ('serve_cmd' in s && !('base_url' in s)) err('invalid_value', `${at}.base_url`, `${at}: serve_cmd requires base_url (where the served app listens)`)
    if ('base_url' in s && !('serve_cmd' in s)) err('invalid_value', `${at}.base_url`, `${at}: base_url is only legal with serve_cmd — without one, kiln serves the statics itself`)
    if ('serve_dir' in s) {
      if ('serve_cmd' in s) err('invalid_value', `${at}.serve_dir`, `${at}: serve_dir is only legal without serve_cmd (it roots kiln's built-in static server)`)
      if (!nonempty(s.serve_dir) || s.serve_dir.startsWith('/') || s.serve_dir.split('/').includes('..')) err('invalid_value', `${at}.serve_dir`, `${at}: serve_dir must be a relative path inside the project (no leading '/', no '..')`)
    }
  }
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
    if ('spec' in c) {
      if (c.kind !== 'probe') err('invalid_value', `${at}.spec`, `${at}: spec is legal only on kind 'probe' (the §7 Tier-1 browser-probe contract)`)
      else validateSpec(c.spec, `${at}.spec`)
    }
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

// classifyDryrun(kind, exit, signal, timedOut) — the P3.5 T1 deterministic PRE-LOCK dry-run
// classification (dogfood finding 1: checks are code; they execute before we trust them —
// reading is not executing). This table is the verdict the EXIT CODE carries mechanically,
// before any judgment; the downstream judge (Athena, over the transcript tails) rules only
// what the code cannot:
//   'green'        — exit 0: the check passes already (brownfield pre_satisfied candidate; on
//                    a greenfield deliverable a green pre-lock check gates nothing — judged
//                    downstream, never silently accepted).
//   'honest-red'   — pytest exit 1: tests RAN and assertions failed on the missing feature —
//                    exactly what a pre-lock check must do (pytest's own taxonomy: 1 = tests
//                    collected and failed).
//   'broken-check' — the check crashed on its own machinery and produced NO verdict: pytest
//                    2/3/4/5 (interrupted / internal error / usage error / collected nothing —
//                    pytest's taxonomy), exit 126/127 (not executable / command not found —
//                    any kind: every cmd runs through bash), a timeout, any signal-death, or
//                    a missing exit code with no recorded signal.
//   'ambiguous'    — every other nonzero exit (shell exit 1, http failures): the exit code
//                    does not say WHY — transcribed with its tails, judged downstream.
// Pure: no I/O, no clocks. Probes never reach this table — the dry-run defers them (§7 owns
// probe exit semantics, exit-78 included; a dry-run executes no browser).
export function classifyDryrun(kind, exit, signal, timedOut) {
  if (timedOut === true || (typeof signal === 'string' && signal !== '')) return 'broken-check'
  if (exit === 0) return 'green'
  if (!Number.isInteger(exit)) return 'broken-check' // died with neither exit nor signal recorded — no verdict was produced
  if (exit === 126 || exit === 127) return 'broken-check'
  if (kind === 'pytest') {
    if (exit === 1) return 'honest-red'
    if (exit >= 2 && exit <= 5) return 'broken-check'
  }
  return 'ambiguous'
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
