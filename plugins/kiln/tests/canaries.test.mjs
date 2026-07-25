import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// W2-S11: the wave gate's SMOKE — five end-to-end walks through the real verbs, no mocks and no
// source extraction. The suites beside this one prove each mechanism in depth; these prove the
// mechanisms still meet each other. Where an S9+S10 test already walks a path end to end, the walk
// here is deliberately thin: a second copy of a proof is a second thing to drift.
const REVIEW = fileURLToPath(new URL('../scripts/kiln-review', import.meta.url))

// HERMETICITY: the two lock-minting verbs probe for codex, so every walk that reaches one STATES its
// availability rather than inheriting this machine. CODEX_DIR holds one stub answering --version and
// is PREPENDED, so it answers ahead of any real codex; node is named by its absolute path because a
// stub-only PATH has nothing to resolve it with.
const CODEX_DIR = mkdtempSync(join(tmpdir(), 'kiln-canary-codex-'))
writeFileSync(join(CODEX_DIR, 'codex'), `#!${process.execPath}\nprocess.stdout.write('canary-codex 0.0.0\\n')\n`, { mode: 0o755 })
const WITH_CODEX = { ...process.env, PATH: `${CODEX_DIR}:${process.env.PATH}` }

// EVERY spawn in this file goes through this ONE helper, and PATH is applied LAST so no caller can
// override it back to the real machine — a counting pin over env spellings could not have stopped
// that, which is why the binding is structural rather than textual.
const kilnIn = (envOverride, ...args) => {
  const r = spawnSync(process.execPath, [REVIEW, ...args],
    { encoding: 'utf8', env: { ...WITH_CODEX, ...envOverride, PATH: WITH_CODEX.PATH } })
  return { status: r.status, out: (r.stdout || '').trim(), err: r.stderr || '' }
}
const kiln = (...args) => kilnIn({}, ...args)
const fresh = () => freshRepo().dir
// The modern writer needs the REPO beside the .kiln — the manifest baseline, the composed contract
// and the seal all bind to working-tree bytes, so the walk needs somewhere for the slice to be built.
const freshRepo = () => {
  const repo = mkdtempSync(join(tmpdir(), 'kiln-canary-'))
  const dir = join(repo, '.kiln')
  mkdirSync(join(dir, 'law'), { recursive: true })
  return { dir, repo }
}
// The sealed trio every post-seal verb verifies against.
const sealTrio = (dir, slice = 's1') => {
  writeFileSync(join(dir, 'LAW.md'), `crit-1 · slice ${slice} · behaviour · true · exit 0\n`)
  writeFileSync(join(dir, 'law', 'check.sh'), '#!/usr/bin/env bash\nexit 0\n')
  writeFileSync(join(dir, 'slices.json'), JSON.stringify([{ id: slice, surface: 'logic' }]))
  assert.equal(kiln('seal-law', dir, 'dual').status, 0, 'the trio seals')
}
const rows = (dir, file) => readFileSync(join(dir, file), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))

// The modern attested seal, end to end through the real verbs — the exact contract production runs:
// sealed trio, run lock, manifest baseline and prepared snapshot, the receipt the contract binds,
// the composed contract, the published verdict, real builder and reviewer legs, and finally the
// seven-word append kernel.js issues. Returned whole so a second fixture costs one call.
const attestedSeal = (slice) => {
  const { dir, repo } = freshRepo()
  sealTrio(dir, slice)
  const lock = kiln('run-lock', 'acquire', dir, 'follow-ladders', String(process.pid))
  assert.equal(lock.status, 0, lock.err)
  const [runId] = lock.out.split(' ')
  writeFileSync(join(repo, 'request.json'), JSON.stringify({ criteria: 'x', paths: [], failures: [], commands: [] }))
  assert.equal(kiln('manifest-start', repo, dir, slice).status, 0, 'the baseline is captured before any mutation')
  writeFileSync(join(repo, 'work.txt'), 'the slice, built\n')
  assert.equal(kiln('manifest-prepare', repo, dir, slice).status, 0, 'the prepared manifest publishes')
  // The receipt is written BEFORE the contract is composed, because the contract embeds its digest —
  // a receipt appearing or changing afterwards archives a verdict bound to evidence it was not
  // reached on, and the publish refuses exactly that.
  writeFileSync(join(dir, 'check-receipt.txt'), 'checks ok\n')
  const contract = kiln('contract-prepare', repo, dir, 'slice-review', 'initial', slice, join(repo, 'request.json'))
  assert.equal(contract.status, 0, contract.err)
  const reviewer = kiln('identity-begin', dir, 'gate-reviewer', 'opus', slice).out.split(' ')[0]
  const candidate = join(dir, '.gate-review.reviewer.tmp')
  const digest = readFileSync(join(dir, 'law', 'lock.hash'), 'utf8').trim()
  writeFileSync(candidate, JSON.stringify({ review_id: 'rv-1', law_hash: digest, findings: [], blockers: [], verdict: 'accept' }))
  const publish = kiln('publish-gate', dir, 'review', candidate, join(dir, 'gate-review.json'), reviewer, repo, slice, contract.out)
  assert.equal(publish.status, 0, publish.err)
  const builder = kiln('identity-begin', dir, 'builder', 'sonnet', slice).out.split(' ')[0]
  const sealed = kiln('append-seal', dir, slice, 'dual', builder, reviewer, repo, 'reviewed')
  assert.equal(sealed.status, 0, sealed.err)
  const home = mkdtempSync(join(tmpdir(), 'kiln-canary-home-'))
  const ev = (leg, state) => JSON.stringify({
    type: 'system', subtype: 'task_progress',
    workflow_progress: [{ type: 'workflow_agent', label: `leg:${leg}`, agentId: `agent-${leg.slice(0, 6)}`, model: 'claude-sonnet-5', state }],
  })
  return { dir, repo, slice, runId, builder, reviewer, home, transcript: join(dir, 'driver.jsonl'), ev, sealBefore: rows(dir, 'seals.jsonl').at(-1) }
}

test('canary — TAMPER: a sealed law file edited after the seal refuses to run, and the seal is what notices', () => {
  const { dir, repo } = freshRepo()
  const ran = join(repo, 'check-ran.txt')
  sealTrio(dir)
  assert.equal(kiln('run-checks', dir).status, 0, 'the intact seal verifies and runs the law')
  // One byte of a sealed member, changed after sealing. The claim is that check.sh never RUNS over
  // tampered law — an exit code alone cannot prove that, since a verb that ran the checker and then
  // reported the mismatch would produce the same code. The tampered checker therefore leaves a
  // trace if it executes, and the absence of that trace is the proof.
  writeFileSync(join(dir, 'law', 'check.sh'), `#!/usr/bin/env bash\ntouch ${JSON.stringify(ran)}\nexit 0\n`)
  const tampered = kiln('run-checks', dir)
  assert.equal(tampered.status, 22, 'a drifted member is the integrity class, not a transport failure')
  assert.equal(tampered.out, 'trio_mismatch', 'and it says so as a closed fact')
  assert.ok(!existsSync(ran), 'and the tampered checker never executed — the seal is checked BEFORE anything runs')
})

test('canary — OVERLAP: one lock wins, the exact token joins, and only a genuinely stale lock is taken over', () => {
  const dir = fresh()
  const first = kiln('run-lock', 'acquire', dir, 'follow-ladders', String(process.pid))
  assert.equal(first.status, 0, 'the first acquire mints')
  const [runId, owner] = first.out.split(' ')
  const second = kiln('run-lock', 'acquire', dir, 'follow-ladders', String(process.pid))
  assert.equal(second.status, 12, 'the second is refused — one run holds this forge')
  assert.equal(second.out, runId, 'and the refusal names the holder so the conductor can report it')
  assert.equal(kiln('run-lock', 'join', dir, runId, owner).status, 0, 'the exact token joins')
  assert.equal(kiln('run-lock', 'join', dir, runId, 'not-the-owner').status, 12, 'a near-miss token does not')
  // Both stale conditions, each falsified ALONE — a takeover needs a dead holder AND an aged lock, so
  // proving only the pair leaves either half deletable. live+old and dead+young must both refuse.
  assert.equal(kiln('run-lock', 'takeover', dir, 'follow-ladders', '777').status, 12,
    'LIVE holder, OLD lock: refused — age alone never earns a takeover')
  const young = join(mkdtempSync(join(tmpdir(), 'kiln-canary-')), '.kiln')
  mkdirSync(young, { recursive: true })
  writeFileSync(join(young, 'run.lock'), JSON.stringify({
    run_id: 'young-run', owner: 'young-owner', conductor_pid: 2147480000,
    started_at: new Date().toISOString(), ladder_choice: 'follow-ladders', plugin_version: '0.0.0',
  }) + '\n')
  assert.equal(kiln('run-lock', 'takeover', young, 'follow-ladders', '777').status, 12,
    'DEAD holder, YOUNG lock: refused — a dead pid alone never earns one either')
  assert.equal(JSON.parse(readFileSync(join(young, 'run.lock'), 'utf8')).run_id, 'young-run',
    'and the young lock is untouched by the refusal')
  // The COMPLETE pre-release record, so the archive is compared against everything it must preserve —
  // checking only lock_event would accept a truncated row that lost the run identity it exists to keep.
  const held = JSON.parse(readFileSync(join(dir, 'run.lock'), 'utf8'))
  assert.equal(kiln('run-lock', 'release', dir, runId, owner).status, 0, 'the holder releases')
  const archived = rows(dir, 'run-history.jsonl').at(-1)
  for (const [k, v] of Object.entries(held)) {
    assert.deepEqual(archived[k], v, `the archived row preserves ${k} exactly — the record is never trimmed on its way to history`)
  }
  assert.deepEqual(Object.keys(archived).sort(), [...Object.keys(held), 'archived_at', 'lock_event'].sort(),
    'and adds only the archive metadata — nothing else is invented on the way')
  assert.equal(archived.lock_event, 'released', 'marked with how it ended')
})

test('canary — RESUME: a crashed run resumes through acquire-then-takeover, and the displaced record survives', () => {
  const dir = fresh()
  // A crashed run: a lock left by a process that is gone, aged past the floor.
  const DEAD_PID = 2147480000
  const crashed = {
    run_id: 'crashed-run', owner: 'crashed-owner', conductor_pid: DEAD_PID,
    started_at: '2020-01-01T00:00:00.000Z', ladder_choice: 'follow-ladders', plugin_version: '0.0.0',
  }
  writeFileSync(join(dir, 'run.lock'), JSON.stringify(crashed) + '\n')
  // The conductor ladder: acquire first — a healthy released directory ends there — then takeover
  // only on the lock-exists refusal.
  assert.equal(kiln('run-lock', 'acquire', dir, 'follow-ladders', String(process.pid)).status, 12,
    'acquire reports the lock that is already there')
  const took = kiln('run-lock', 'takeover', dir, 'follow-ladders', String(process.pid))
  assert.equal(took.status, 0, 'takeover claims the genuinely stale lock')
  const [freshRun] = took.out.split(' ')
  assert.notEqual(freshRun, 'crashed-run', 'the resumed run carries fresh facts')
  const archived = rows(dir, 'run-history.jsonl').filter((r) => r.run_id === 'crashed-run')
  assert.equal(archived.length, 1, 'the displaced record is archived exactly once')
  for (const [k, v] of Object.entries(crashed)) {
    assert.deepEqual(archived[0][k], v, `the displaced record keeps ${k} exactly — a truncated archive loses the run it was meant to preserve`)
  }
  assert.deepEqual(Object.keys(archived[0]).sort(), [...Object.keys(crashed), 'archived_at', 'lock_event'].sort(),
    'and gains only the archive metadata')
  assert.equal(archived[0].lock_event, 'taken_over', 'marked with how it ended')
  // State parity across the kill: the commit reads the run identity from the lock, not from argv.
  assert.equal(kiln('state-commit', dir, 'advance', 'build', 's1', 'relaunch-validate', 'broad').status, 0, 'state commits')
  const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'))
  assert.equal(state.run_id, freshRun, 'the ledger stamps the run that is actually holding the lock now')
  assert.ok(readFileSync(join(dir, 'STATE.md'), 'utf8').includes('stage: build'), 'and the rendered view agrees with it')
})

test('canary — IDENTITY: a leg is minted as an intent and RESOLVED, carrying its run, role, requested alias and the exact model that answered', () => {
  const dir = fresh()
  const lock = kiln('run-lock', 'acquire', dir, 'follow-ladders', String(process.pid))
  assert.equal(lock.status, 0)
  const [runId] = lock.out.split(' ')
  const begun = kiln('identity-begin', dir, 'builder', 'sonnet', 's1')
  assert.equal(begun.status, 0, 'the intent is minted')
  const [legId, label] = begun.out.split(' ')
  assert.match(legId, /^[0-9a-f]{32}$/, 'the leg id is a closed 128-bit token')
  assert.equal(label, `leg:${legId}`, 'and the reserved label is the id the capture matches on')
  // The RAW bytes before the capture. Parsed snapshots compared with deepEqual cannot see a ledger
  // rewritten with reordered or respaced rows — the objects match while the append-only file does not.
  const beforeBytes = readFileSync(join(dir, 'identity.jsonl'), 'utf8')
  const intent = rows(dir, 'identity.jsonl').at(-1)
  assert.equal(intent.type, 'intent', 'the mint records an INTENT — what was asked for, before anything answered')
  assert.equal(intent.run_id, runId, 'it belongs to the run that holds the lock')
  assert.equal(intent.role, 'builder', 'it records the seat')
  assert.equal(intent.requested_alias, 'sonnet', 'and the alias the tiers asked for')
  assert.equal(intent.subject, 's1', 'against the subject it was minted for')
  assert.equal(intent.resolved_model, undefined, 'an intent names no model — nothing has answered it yet')
  // The resolution half, which is the whole point of requested-VS-resolved: a driver transcript
  // carrying one completed row for the reserved label. HOME is pinned to an empty dir so the
  // discovery scan can never reach a real session transcript.
  const home = mkdtempSync(join(tmpdir(), 'kiln-canary-home-'))
  const transcript = join(dir, 'driver.jsonl')
  const progress = (state) => JSON.stringify({
    type: 'system', subtype: 'task_progress',
    workflow_progress: [{ type: 'workflow_agent', label, agentId: 'agent-canary', model: 'claude-sonnet-5', state }],
  })
  writeFileSync(transcript, `${progress('start')}\n${progress('done')}\n`)
  const captured = kilnIn({ HOME: home, CLAUDE_CODE_SESSION_ID: '' }, 'capture-and-finalize', dir, transcript)
  assert.equal(captured.status, 0, captured.err)
  assert.equal(captured.out, 'resolved 1 pending 0 promoted 0', 'the pending intent resolves, and nothing was owed a promotion')
  // Re-read the ledger AFTER the capture: the claim is that the resolved row lands BESIDE the intent,
  // and only a fresh read can prove the intent SURVIVED. Asserting the resolved row alone would pass
  // just as happily against a ledger that replaced the intent instead of appending to it.
  const afterBytes = readFileSync(join(dir, 'identity.jsonl'), 'utf8')
  assert.ok(afterBytes.startsWith(beforeBytes),
    'the pre-capture BYTES are an exact prefix of the post-capture bytes — the ledger was appended to, not rewritten')
  const addedLines = afterBytes.slice(beforeBytes.length).split('\n').filter(Boolean)
  assert.equal(addedLines.length, 1, 'and exactly one row was added')
  const resolved = JSON.parse(addedLines[0])
  assert.equal(resolved.type, 'resolved', 'the one addition is the resolved row')
  assert.equal(resolved.leg_id, legId, 'for this leg')
  assert.equal(resolved.run_id, runId, 'linked to the same run')
  assert.equal(resolved.resolved_model, 'claude-sonnet-5', 'and it names the EXACT model that answered')
  assert.equal(resolved.agent_id, 'agent-canary', 'with the agent that carried it')
  assert.notEqual(resolved.resolved_model, intent.requested_alias,
    'requested and resolved are different facts, and the ledger keeps both — the alias asked, the model answered')
})

test('canary — MODERN-WRITER PARITY: an attested seal renders membership only once its legs resolve, and the render agrees with its JSONL truth through a cutoff', () => {
  // Sol r1 005: a wave canary is the standing proof of the contract PRODUCTION runs on, so this walks
  // the modern attested writer end to end — the seven-word append the kernel actually issues, with
  // real identity legs, a published verdict and a composed contract behind it. Legacy-boundary
  // parity is not duplicated here; it stands on the migration tests and the boundary pins at unit
  // level, and an end-to-end legacy walk would couple the wave gate to a writer production no longer
  // uses.
  const slice = 's1'
  const { dir, repo, runId, builder, reviewer, home, transcript, ev, sealBefore } = attestedSeal(slice)
  // The promotion boundary: a candidate whose legs are still pending intents grants NO membership.
  // This is the crash window the attested writer exists to close.
  assert.equal(sealBefore.attestation_kind, 'reviewed', 'the row declares its attestation kind — the modern shape')
  assert.equal(sealBefore.run_id, runId, 'and the run that holds the lock')
  assert.ok(sealBefore.candidate_id, 'the row lands PROVISIONAL while a referenced leg is unresolved')
  assert.ok(!existsSync(join(dir, 'seals.log')), 'and renders no membership yet — an unattested generation is never a member')
  // BOTH one-leg-pending states, each proven separately. Resolving both together cannot distinguish a
  // promotion gated on ALL legs from one gated on whichever leg resolves last, and testing only one
  // order cannot distinguish it from one gated on a single named leg. So the REVIEWER resolves first
  // here — the state a reviewer-gated promotion would wrongly promote on — and the builder-first
  // state is proven on its own fixture below.
  writeFileSync(transcript, [ev(reviewer, 'start'), ev(reviewer, 'done')].join('\n') + '\n')
  const onlyReviewer = kilnIn({ HOME: home, CLAUDE_CODE_SESSION_ID: '' }, 'capture-and-finalize', dir, transcript)
  assert.equal(onlyReviewer.status, 0, onlyReviewer.err)
  assert.match(onlyReviewer.out, /promoted 0$/, 'REVIEWER resolved, builder still pending: NO promotion')
  assert.ok(!existsSync(join(dir, 'seals.log')), 'and still no membership')
  writeFileSync(transcript, [ev(builder, 'start'), ev(builder, 'done')].join('\n') + '\n')
  const captured = kilnIn({ HOME: home, CLAUDE_CODE_SESSION_ID: '' }, 'capture-and-finalize', dir, transcript)
  assert.equal(captured.status, 0, captured.err)
  assert.match(captured.out, /^resolved 1 pending 0 promoted 1$/,
    'only with the LAST leg resolved does the candidate promote — and exactly once')
  const rendered = () => readFileSync(join(dir, 'seals.log'), 'utf8')
  assert.equal(rendered(), `${slice} dual\n`, 'membership renders only now, once every referenced leg is attested')
  assert.deepEqual(rows(dir, 'seals.jsonl').filter((r) => r.type === 'seal').map((r) => [r.slice, r.label]), [[slice, 'dual']],
    'and the render is the projection of the JSONL truth, not a second record')
  // The claim is that the render is RE-DERIVED from the JSONL truth, so the projection is DAMAGED
  // first and reconcile must restore it. Running reconcile over an intact render proves only that it
  // left things alone — a reconcile that did nothing at all would satisfy that just as well.
  // The exact crash this heals: a JSONL append landed and its render did not. Removing the
  // projection is the honest damage — an unparseable one reconcile REFUSES rather than rebuilds,
  // which is correct and would prove nothing about re-derivation.
  rmSync(join(dir, 'seals.log'))
  assert.equal(kiln('reconcile', dir).status, 0, 'reconcile runs clean over a missing projection')
  assert.equal(rendered(), `${slice} dual\n`, 'and rebuilds it byte for byte from the JSONL truth — the render is derived, never a second record')
  // The OTHER one-leg-pending state, on its own fixture: builder resolved, reviewer pending. Between
  // this and the reviewer-first case above, a promotion gated on any single named leg is excluded.
  const b = attestedSeal('s1')
  writeFileSync(b.transcript, [b.ev(b.builder, 'start'), b.ev(b.builder, 'done')].join('\n') + '\n')
  const onlyBuilder = kilnIn({ HOME: b.home, CLAUDE_CODE_SESSION_ID: '' }, 'capture-and-finalize', b.dir, b.transcript)
  assert.equal(onlyBuilder.status, 0, onlyBuilder.err)
  assert.match(onlyBuilder.out, /promoted 0$/, 'BUILDER resolved, reviewer still pending: NO promotion either')
  assert.ok(!existsSync(join(b.dir, 'seals.log')), 'and no membership renders on a half-attested generation')
  // A cutoff withdraws membership without editing history.
  assert.equal(kiln('invalidate', dir, slice).status, 0, 'the cutoff lands')
  assert.equal(rendered(), '', 'the withdrawn slice leaves the rendered membership')
  const sealAfter = rows(dir, 'seals.jsonl').filter((r) => r.type === 'seal')
  assert.deepEqual(sealAfter, [sealBefore],
    'while the original row survives in the truth COMPLETE and unedited — a withdrawal appends its cutoff, it never rewrites what happened')
})

test('harness: each scenario runner names a slice the fixture LAW actually assigns criteria to (S11/001)', () => {
  // Sol 001: the runners passed the fixture DIRECTORY name as the slice id while the LAW assigned
  // its criteria to another. Nothing in the scenario can catch that — a compliant reviewer scopes
  // the sealed LAW to the supplied slice_id and would simply find no criterion, and a stubbed
  // reviewer returns its canned verdict regardless. So the coupling is held HERE, statically, where
  // a drift in either file reddens instead of silently producing a reviewer with nothing to judge.
  const scenarios = fileURLToPath(new URL('./scenarios', import.meta.url))
  const fixtures = fileURLToPath(new URL('./fixtures', import.meta.url))
  const pairs = [['run-s2.sh', 'slice-defect'], ['run-s3.sh', 'slice-clean']]
  for (const [runner, fixture] of pairs) {
    const src = readFileSync(join(scenarios, runner), 'utf8')
    const slice = (src.match(/^SLICE=(\S+)/m) || [])[1]
    assert.ok(slice, `${runner} names a slice id`)
    const law = readFileSync(join(fixtures, fixture, 'LAW.md'), 'utf8')
    // EXACT owning-slice match, not a substring of the file: `slice s2` occurs inside
    // `slice s2-median`, so a prefix would satisfy a naive includes() while owning no criterion at
    // all — recreating the very defect this pin exists to catch, under a green pin.
    const owners = [...law.matchAll(/·\s*slice\s+(\S+)\s*·/g)].map((m) => m[1])
    assert.ok(owners.length > 0, `the ${fixture} LAW names the slices its criteria belong to`)
    assert.ok(owners.includes(slice),
      `${runner} passes "${slice}", which must be one of the slices the ${fixture} LAW actually assigns criteria to (${owners.join(', ')})`)
    assert.notEqual(slice, fixture, `${runner} does not pass the fixture directory name as the slice id`)
  }
})

test('harness: every post-seal law run in the scenario harness goes through the fused verb (S11/002)', () => {
  // Sol 002, and it is the SAME defect class the cards pin closed one part earlier — the harness had
  // it too, and fixing the cards did not surface it. So the harness joins the pinned corpus on the
  // same terms: post-seal, the law runs through run-checks; a direct execution would let the harness
  // attest a green receipt over a checker the seal never vouched for. Demonstrated, not assumed: with
  // the direct run restored, a tampered post-seal checker still yields a green receipt.
  // The WHOLE harness, not just lib.sh — a runner is as able to execute the checker as a helper is,
  // and `./.kiln/law/check.sh` needs no interpreter word at all. So rather than enumerate spellings
  // (`bash`, `sh`, `/bin/sh`, `$SHELL`, `source`, `.`, a bare path — a list that is never finished),
  // the rule is inverted: EVERY mention of the checker path must be a WRITE target. Anything else,
  // however spelled, is an execution.
  const scenarios = fileURLToPath(new URL('./scenarios', import.meta.url))
  let runChecks = 0
  for (const file of readdirSync(scenarios).filter((f) => f.endsWith('.sh'))) {
    const src = readFileSync(join(scenarios, file), 'utf8')
    const code = src.split('\n').filter((l) => !l.trim().startsWith('#'))
    runChecks += (code.join('\n').match(/run-checks \.kiln/g) || []).length
    for (const line of code.filter((l) => l.includes('law/check.sh'))) {
      assert.match(line, />\s*"?[^"]*law\/check\.sh/,
        `${file}: every mention of the sealed checker is a write target, never an execution — got: ${line.trim()}`)
    }
  }
  assert.equal(runChecks, 2,
    'the two post-seal law runs in the harness — the S1 fresh-LAW rerun and the kernel-side receipt capture — go through the verb')
})

test('canary: the walks that reach a minting verb state their codex availability rather than inherit it', () => {
  // The pin for this file's own hermeticity. Every spawn here goes through kiln(), which carries the
  // stub PATH — so a machine with no codex runs these walks identically to this one.
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  // STRUCTURAL, not textual: there is exactly ONE spawn in the file and it is inside kilnIn, so a
  // walk cannot acquire an unstated spawn at all. Counting env spellings could not see a caller
  // handing back the real PATH in an options object; applying PATH LAST makes that unreachable.
  assert.equal((src.match(/\bspawn(?:Sync)?\s*\(/g) || []).length, 1, 'exactly one spawn site in this file')
  assert.match(src, /const kilnIn = \(envOverride, \.\.\.args\) => \{\n {2}const r = spawnSync\(/,
    'and it is the shared helper — every walk reaches the verbs through it')
  assert.match(src, /env: \{ \.\.\.WITH_CODEX, \.\.\.envOverride, PATH: WITH_CODEX\.PATH \}/,
    'PATH is applied LAST, so no caller can override the stub back to this machine')
  assert.ok(existsSync(join(CODEX_DIR, 'codex')), 'the stub the walks lean on is really there')
})
