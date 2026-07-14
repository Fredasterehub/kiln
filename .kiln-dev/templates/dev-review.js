// dev-review.js — the Kiln Dev Protocol review cycle as a HOST-LEGAL dynamic-workflow script
// (Piece 2, rewritten per ADOPT-4 / design D1). PATTERN FILE: it is NOT bundled into the plugin and
// NOT wired into kiln-fire; it is the canonical shape a dev-review workflow takes so that freeze/thaw,
// the floor, verdict parsing, and rejection arithmetic stop being prose the conductor performs and
// become STAGES that execute. The runtime primitives agent()/log()/args are injected by the
// dynamic-workflow host, exactly as Kiln's own stages assume them.
//
// The whole shape in one sentence (design D1): trust lives in the ONE CLI
// (kiln-codex-receipt.mjs); this workflow is a HOST-LEGAL orchestrator that executes script-rendered
// argv through A7 runner legs and routes on the CLI's EXIT CODES and FILES — never on model prose.
//   • NO imports, NO fs/child_process. The host gives scripts no filesystem or Node API access
//     (Workflow tool contract), so every file op and every trusted-CLI call is an A7 runner leg: an
//     agent() that executes ONLY this script's rendered argv and relays exit code + a status line.
//   • Model-relayed values are CLAIMS. The next trusted-CLI call mechanically re-verifies them:
//     the snapshot's diff sha is re-hashed by the gate's diff binding; the floor claim is re-checked
//     against the floor receipt; the verdict is re-validated from the on-disk bytes. A lying relay is
//     caught, not trusted.
//   • ⟨DSGN-1a⟩ the FLOOR is a trusted-CLI mode (`gate --floor`), not a relayed claim — the CLI itself
//     spawns the harness + bundler, parses the TAP tally, and writes a floor receipt the routing gate
//     later REQUIRES (pass===true, diff_sha256 == the reviewed diff's).
//   • ⟨DSGN-1b⟩ this workflow's RETURN is a COURTESY COPY, never authority. Every consumer of the
//     routing decision (Fable ruling between invocations, the seal step) reads
//     <outPrefix>.decision.json + the route-ledger row DIRECTLY; a mismatch between the relay and the
//     files is a TRANSPORT failure.
//   • Per A11 each ladder round is a FRESH invocation of this cycle with Fable ruling between
//     invocations; the implementer is a fresh agent() stage inside it. Continuity lives in FILES
//     (brief, diff, verdict) — nothing persists by agent identity. Handoffs carry full artifacts —
//     the whole diff, the whole verdict — never summaries (Cognition P1).

export const meta = {
  name: 'kiln-dev-review',
  description: 'One HOST-LEGAL dev-review batch cycle: a fresh implementer, a frozen-diff snapshot, a trusted-CLI floor receipt, a fresh Sol verdict through the bridge (A7), and the routing gate — the CLI owns every trust decision and exits with the decision code; the workflow relays it, the files are the authority.',
  phases: [
    { title: 'Implement', detail: 'a fresh implementer fed a self-contained brief (A11)', model: 'opus' },
    { title: 'Snapshot', detail: 'cut the frozen diff and render the diff-bound commission' },
    { title: 'Floor', detail: 'gate --floor writes the floor receipt the routing gate requires' },
    { title: 'Review', detail: 'a fresh Sol verdict through the trusted bridge (A7)' },
    { title: 'Route', detail: 'the gate owns the ladder arithmetic and exits with the decision code' },
  ],
}

// ── args (all PATHS + scalars — the workflow never reads a file itself) ──────────────────────────
//   { repoPath, cliPath, batchId, round, briefPath, spawnPreamblePath, manifestPath, routeLedgerPath,
//     bridgeLedgerPath, scopeArtifactPath, priorVerdictPath, seat, keystoneTag, effort,
//     reviewsDir, schemaPath, commissionTemplatePath, sandboxPosture, network, web }
const A = args
const round = A.round
const CLI = `${A.repoPath}/plugins/kiln/scripts/kiln-codex-receipt.mjs`
const REVIEWS = A.reviewsDir ?? `${A.repoPath}/.kiln-dev/reviews`
const OUT = `${REVIEWS}/${A.batchId}-r${round}`
const DIFF = `${OUT}.diff`
const COMMISSION = `${OUT}.commission.md`
const FLOOR_RECEIPT = `${OUT}.floor.json`
const SCHEMA = A.schemaPath ?? `${A.repoPath}/scripts/dev/review-verdict-schema.json`

// ⟨ADOPT-6⟩ The posture is SCRIPT-SUPPLIED end to end: review() renders the wrapper flags from these
// args, and snapshot() renders the SAME tuple verbatim into the commission's `Sandbox posture:` line so
// the routing gate can require the declared posture to equal the receipt tuple {sandbox, network, web}.
// Encoding is the gate's canonical form `<sandbox> network=<0|1> web=<0|1>` — never agent-chosen.
const SANDBOX = A.sandboxPosture ?? 'read-only'
const POSTURE = `${SANDBOX} network=${A.network ? 1 : 0} web=${A.web ? 1 : 0}`

// The decision code the routing gate exits with IS the routing authority (design D2 step 5). This
// map is a human-readable COURTESY label for the relay; the file <outPrefix>.decision.json carries
// the authoritative code that Fable reads between invocations.
const GATE_NEXT = { 0: 'seal', 20: 'implement-r2', 21: 'microfix-r3', 22: 'confirm-each-or-escalate', 30: 'twin-council', 12: 'gate-failure' }

// A runner leg return: the exit code + the CLI's terminal status line. Schema-typed so the script
// branches on a typed value, never on free prose (design D1).
const RUNNER_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { exit_code: { type: 'integer' }, status_line: { type: 'string' } },
  required: ['exit_code', 'status_line'],
}

// The one runner idiom: execute EXACTLY the rendered argv (Bash), then report the process exit code
// and the last status line the CLI printed. The leg relays NO verdict of its own — the files + the
// trusted CLI are the truth; a mis-relayed exit code is caught when the consumer reads the file.
async function runner(label, phase, argv, model = 'haiku') {
  const cmd = argv.map((a) => JSON.stringify(a)).join(' ')
  const out = await agent(
    `Run EXACTLY this command with the Bash tool — do not edit a single token. Then report its\n` +
    `process exit code (echo $? immediately after) and the LAST status line it printed on stdout.\n` +
    `You relay no judgement of your own; the files the command wrote are the truth.\n\n` +
    '```\n' + cmd + '\n```',
    { label, phase, model, schema: RUNNER_SCHEMA }
  )
  if (out == null) throw new Error(`${label} returned null (died/skipped) — TRANSPORT-class; no rung consumed, re-run this leg`)
  return out
}

// ── Stage 0 — Implement (A11: workflows, not teammates) ─────────────────────────────────────────
// EVERY round dispatches a FRESH implementer: one agent() pointed at a SELF-CONTAINED brief file (the
// whole prior verdict rides inside a fix-round brief — never a summary). Model pinned opus. Its
// return IS the freeze; the snapshot stage cuts the diff immediately after, so no drift window opens.
// briefPath null = a review-only/recovery invocation over a tree an earlier invocation already froze.
// The mechanical handoff bounce for the DISPATCH brief (ADOPT-9): the brief is validated against its
// required-section skeleton by the trusted CLI BEFORE any implementer reads it. A malformed brief is
// bounced (format-error reprompt) and never dispatched. round>=3 dispatches a microfix brief; earlier
// rounds a full brief.
async function checkBrief() {
  if (!A.briefPath) return
  const kind = round >= 3 ? 'microfix' : 'brief'
  const out = await runner('check-handoff:brief', 'Implement', ['node', CLI, 'check-handoff', A.briefPath, '--kind', kind])
  if (out.exit_code !== 0) throw new Error(`brief handoff bounced (${out.status_line}) — the dispatch brief is missing a required section; reprompt with ${A.repoPath}/.kiln-dev/templates/format-error.md before any implementer reads it (no rung consumed)`)
}

async function implement() {
  if (!A.briefPath) return null
  const preamble = A.spawnPreamblePath ? `Read the dispatch preamble at ${A.spawnPreamblePath} FIRST, then ` : ''
  const report = await agent(
    `${preamble}read your brief at ${A.briefPath} and implement it end-to-end. Your FINAL MESSAGE is\n` +
    `your report (no report file). Finish, verify the floor, then reply once — your reply is the FREEZE.`,
    { label: 'implementer', phase: 'Implement', model: 'opus' }
  )
  if (report == null) throw new Error('implementer returned null (died/skipped) — TRANSPORT-class; no rung consumed, re-dispatch the same brief')
  return report
}

// ── Stage 1 — Snapshot (frozen diff + diff-bound commission) ─────────────────────────────────────
// The diff is cut only after the implementer's FROZEN reply. The void check is DECIDABLE, not a
// judgement call (VEHICLE-1 ruling): the batch's uncommitted changes ARE the expected work product, so
// their PRESENCE is normal — a single `git status` can never tell "unchanged since the frozen reply"
// from "the batch's own expected changes" (the observed void-on-expected-changes, run wf_c166168a). The
// snapshot voids ONLY when the tree is still MOVING, observed as two `git status --porcelain` reads a
// few seconds apart that DIFFER (recut, never reconcile). The cut stages every change (`git add -A` —
// untracked files included) then reads the STAGED diff, so a brand-new file is never dropped; commits
// stay forbidden. The leg also renders the review commission from the fixed template with the diff's
// sha embedded (`Diff-sha256:`) — the ADOPT-5 binding the routing gate later re-verifies against the
// diff bytes AND the receipt. `void`/`diff_sha256` are typed CLAIMS; the gate is what makes them binding.
const SNAPSHOT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { void: { type: 'boolean' }, diff_sha256: { type: 'string' }, commission_path: { type: 'string' } },
  required: ['void', 'diff_sha256', 'commission_path'],
}
async function snapshot() {
  const out = await agent(
    `The implementer for ${A.batchId} reported and FROZE. Do EXACTLY this with the Bash tool:\n` +
    `1. Decide whether the tree is still MOVING. The batch's own uncommitted changes ARE the expected\n` +
    `   work product — their PRESENCE is normal and is NEVER a void. Run \`git -C ${A.repoPath} status\n` +
    `   --porcelain\`, wait a few seconds (\`sleep 3\`), then run \`git -C ${A.repoPath} status --porcelain\`\n` +
    `   again. Return void:true and STOP (the snapshot is recut) ONLY if the two observations DIFFER —\n` +
    `   the tree is still changing after the freeze. If they are IDENTICAL, continue; do NOT void merely\n` +
    `   because uncommitted changes exist.\n` +
    `2. Cut the scoped diff, staging every change first so untracked files are captured (never a summary):\n` +
    `   \`git -C ${A.repoPath} add -A && git -C ${A.repoPath} diff --cached > ${DIFF}\` (stage, then read the\n` +
    `   staged diff — do NOT commit).\n` +
    `3. Compute its sha: \`sha256sum ${DIFF}\`.\n` +
    `4. Render the review commission from the fixed template ${A.commissionTemplatePath} into ${COMMISSION},\n` +
    `   filling every {{blank}} — in particular \`Diff-sha256:\` MUST be exactly the sha from step 3, and\n` +
    `   \`Sandbox posture:\` MUST be exactly \`${POSTURE}\` (script-supplied — copy it verbatim, do not alter it).\n` +
    `   Change no section headings.\n` +
    `Return void:false, the diff_sha256, and commission_path=${COMMISSION}.`,
    { label: 'snapshot', phase: 'Snapshot', model: 'haiku', schema: SNAPSHOT_SCHEMA }
  )
  if (out == null) throw new Error('snapshot returned null (died/skipped) — TRANSPORT-class; no rung consumed, re-run the cycle')
  if (out.void) throw new Error('snapshot voided — the tree moved after the freeze; recut before reviewing')
  return out
}

// The mechanical handoff bounce (ADOPT-9): the commission is validated against its required-section
// skeleton by the trusted CLI BEFORE the reviewer reads it. A non-zero exit routes to the
// format-error reprompt (recut the commission) — a malformed handoff never reaches Sol.
async function checkCommission() {
  // round>=3 renders the one-item confirm instrument; earlier rounds the full review commission.
  const kind = round >= 3 ? 'confirm' : 'commission'
  const out = await runner('check-handoff:commission', 'Snapshot', ['node', CLI, 'check-handoff', COMMISSION, '--kind', kind])
  if (out.exit_code !== 0) throw new Error(`commission handoff bounced (${out.status_line}) — reprompt with ${A.repoPath}/.kiln-dev/templates/format-error.md, recut, and re-run (no rung consumed)`)
}

// ── Stage 2 — Floor ⟨DSGN-1a⟩ ────────────────────────────────────────────────────────────────────
// The floor is a trusted-CLI mode, not a relayed claim: `gate --floor` itself spawns the harness +
// bundler, parses the TAP tally, and writes a floor receipt bound to the reviewed diff's sha. The
// routing gate REQUIRES that receipt (pass===true, bundle_check_pass===true, diff_sha256 == the
// reviewed diff's). A green floor is a precondition of spawning any reviewer.
async function floor() {
  const out = await runner('floor:gate', 'Floor', ['node', CLI, 'gate', '--floor', '--repo', A.repoPath, '--diff', DIFF, '--out', FLOOR_RECEIPT])
  if (out.exit_code !== 0) throw new Error(`floor is red (${out.status_line}) — the implementer fixes it; no reviewer is spawned until the floor receipt is green`)
}

// ── Stage 3 — Review through the A7 execution boundary ──────────────────────────────────────────
// No model-authored or model-relayed VERDICT couriers. The runner executes ONLY this script-rendered
// argv and relays NO authority; the verdict file + receipt + the trusted validator are authoritative.
// A fresh reviewer every round (a supported OpenHands pattern), fed the written prior verdict via the
// commission — never a resumed thread (resume is recovery-only, never across rounds).
async function review() {
  const argv = [
    `${A.repoPath}/scripts/dev/sol-review.sh`, COMMISSION, OUT,
    '--schema', SCHEMA,
    '--effort', A.effort ?? (round >= 3 ? 'medium' : 'high'),
    '--sandbox', SANDBOX,
    '--run-token', A.batchId, '--keystone', A.keystoneTag ?? 'dev-review',
    '--phase', `r${round}`, '--seat', A.seat, '--attempt', '1',
  ]
  // ⟨ADOPT-6⟩ the network/web capabilities the review runs under — the SAME tuple snapshot() rendered
  // into the commission, so the gate's posture binding (commission == receipt) holds.
  if (A.network) argv.push('--network')
  if (A.web) argv.push('--web')
  if (round >= 3) argv.push('--ephemeral') // the one-item confirmation is a one-shot, never resumable
  const out = await runner('sol:review-runner', 'Review', argv)
  // STATUS:VERDICT (bridge exit 0) is the only outcome that carries a verdict; SUPPRESSED/FAILED_TURN/
  // TRANSPORT/WALLCLOCK consume NO review rejection (they are transport failures, not a Sol ruling).
  if (out.exit_code !== 0) throw new Error(`review did not produce a VERDICT (${out.status_line}) — transport-class, consumes no rung; re-run the review leg`)
  return out
}

// ── Stage 4 — Route (the gate owns the ladder arithmetic) ────────────────────────────────────────
// The routing AUTHORITY is the CLI, not this script (ADOPT-1/-5/-7/-8): the gate verifies the verdict
// chain, requires the floor receipt, binds the diff, validates+stamps the verdict, owns the ladder
// arithmetic from the MANIFEST (lane/keystone) and the append-only route-ledger (prior rounds), writes
// <outPrefix>.decision.json + the route row, and EXITS with the decision code. The workflow relays the
// code as a courtesy; ⟨DSGN-1b⟩ the consumer (Fable, the seal step) reads decision.json + the route
// row directly, and a relay/file mismatch is a TRANSPORT failure.
async function route() {
  const argv = [
    'node', CLI, 'gate',
    '--out', OUT, '--schema', SCHEMA, '--round', String(round),
    '--manifest', A.manifestPath, '--route-ledger', A.routeLedgerPath,
    '--diff', DIFF, '--floor-receipt', FLOOR_RECEIPT, '--commission', COMMISSION,
  ]
  if (A.bridgeLedgerPath) argv.push('--bridge-ledger', A.bridgeLedgerPath)
  if (A.scopeArtifactPath) argv.push('--scope-artifact', A.scopeArtifactPath)
  const out = await runner('gate:route', 'Route', argv)
  return { exit_code: out.exit_code, next: GATE_NEXT[out.exit_code] ?? 'gate-failure', status_line: out.status_line }
}

// ── The run ─────────────────────────────────────────────────────────────────────────────────────
await checkBrief() // ADOPT-9: bounce a malformed dispatch brief BEFORE the implementer reads it
const implementerReport = await implement()
const snap = await snapshot()
await checkCommission()
await floor()
const reviewLeg = await review()
const decision = await route()
log(`dev-review ${A.batchId} r${round}: gate exit ${decision.exit_code} → ${decision.next} (authority: ${OUT}.decision.json + the route-ledger row; this return is a courtesy copy)`)
// ⟨DSGN-1b⟩ COURTESY COPY. The authority is ${OUT}.decision.json + the route-ledger row, which Fable
// reads directly between invocations; a mismatch between this relay and those files is a TRANSPORT failure.
return {
  batchId: A.batchId,
  round,
  next: decision.next,
  gate_exit: decision.exit_code,
  decision_file: `${OUT}.decision.json`,
  route_ledger: A.routeLedgerPath,
  diff_path: DIFF,
  commission_path: snap.commission_path,
  review_status: reviewLeg.status_line,
  implementerReport,
}
