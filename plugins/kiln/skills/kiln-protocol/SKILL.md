---
name: kiln-protocol
description: >-
  Core protocol for Kiln pipeline agents. Preloaded into every agent via frontmatter.
  Signal vocabulary, blocking policy, communication rules, shutdown handling.
  Internal Kiln skill — not user-invocable.
version: 1.1.0
user-invocable: false
---

# Kiln Protocol

## Signals

Send via `SendMessage(type: "message", recipient: "{target}", content: "SIGNAL: details")`. The recipient depends on the signal — most route to `team-lead` (the engine), but Wave 2 centralisation routes a few directly to the boss (`krs-one`) or to persistent minds. Always check the **Recipient** column of the table below before picking a target; guessing is the #1 cause of the C9 / C11 deadlocks this table exists to prevent.

| Signal | Meaning | Recipient |
|--------|---------|-----------|
| `READY_BOOTSTRAP: {summary}` | PM bootstrap complete (rakim / sentinel / thoth one-time at milestone start) | team-lead (engine) |
| `READY: {summary}` | PM post-iteration reply (ITERATION_UPDATE or MILESTONE_TRANSITION) | krs-one (boss) |
| `REQUEST_WORKERS: {name} (subagent_type: {type}), ...` | Boss needs workers spawned | team-lead |
| `CYCLE_WORKERS: scenario={default\|fallback\|ui}, duo_id={duo_id}, coder_name={name}, reviewer_name={name}, reason={reason}, chunk={summary}` | Boss requests fresh worker pair (blocking — unblocks on WORKERS_SPAWNED from engine OR WORKER_READY from a worker, whichever arrives first) | team-lead |
| `WORKERS_SPAWNED: duo_id={duo_id}, {builder_name} (subagent_type: {builder_type}), {reviewer_name} (subagent_type: {reviewer_type})` | Engine confirms new worker pair ready (canonical payload — duo_id and subagent types authoritative for Wave 3 dispatch) | boss (response) |
| `WORKERS_REJECTED: {reason}` | Engine rejected REQUEST_WORKERS | boss (response) |
| `WORKER_READY: ready for assignment` | Worker self-announces on first wake — belt-and-suspenders fallback unblock for CYCLE_WORKERS if WORKERS_SPAWNED is lost/delayed (Wave 3) | krs-one (boss) |
| `ONBOARDING_COMPLETE` | Step 1 done | team-lead (alpha) |
| `BRAINSTORM_COMPLETE` | Step 2 done | team-lead (da-vinci) |
| `RESEARCH_COMPLETE: {N} topics` | Step 3 done | team-lead (mi6) |
| `ARCHITECTURE_COMPLETE: milestone_count={N}` | Step 4 done | team-lead (aristotle) |
| `ITERATION_UPDATE: {summary}` | Chunk complete, update state files (blocking, 60s). Also carries QA failure findings on QA_FAIL / timeout so PM pitfalls.md and patterns.md ingest the surfaced issues deterministically (Wave 4 H1 — supersedes the pre-Wave-4 direct-to-rakim fire-and-forget channel in favour of this single structured channel). | rakim, sentinel |
| `QA_REPORT_READY: report at {path}` | ken / ryu finished milestone QA run (tribunal internal) | team-lead |
| `RECONCILIATION_COMPLETE: report at {path}` | denzel finished reconciling the two tribunal reports | team-lead |
| `QA_PASS` / `QA_FAIL: {findings}` | Judge-dredd final tribunal verdict — direct, no engine relay (Wave 2 centralisation) | krs-one |
| `MILESTONE_COMPLETE: {name}` | Per-milestone QA passed — KRS-One's terminal signal for the milestone (sent on every milestone EXCEPT the final one, where `BUILD_COMPLETE` alone terminates). | team-lead (krs-one) |
| `BUILD_COMPLETE` | All milestones done — sole terminal signal on the final milestone. Never paired with MILESTONE_COMPLETE. | team-lead (krs-one) |
| `MILESTONE_TRANSITION: completed={name}, next={name}` | KRS-One notifies persistent minds of milestone boundary (blocking for rakim+sentinel, fire-and-forget for thoth). | rakim, sentinel, thoth |
| `MILESTONE_DONE: milestone={N}, name={name}` | KRS-One tells thoth to write the per-milestone summary doc `.kiln/docs/milestones/milestone-{N}.md` (fire-and-forget). Wave 4 C5: routed to thoth, not rakim — rakim had no handler and the per-milestone docs never wrote. | thoth |
| `VALIDATE_PASS` / `VALIDATE_FAILED` | Step 6 result | team-lead (argus) |
| `REPORT_COMPLETE` | Step 7 done | team-lead (omega) |
| `BLOCKED: {reason}` | Cannot proceed | team-lead |

Always include context after the signal. `RESEARCH_COMPLETE: 6 topics. Key: RSC viable, Drizzle preferred.` not bare `RESEARCH_COMPLETE`.

## Worker Signals (peer-to-peer)

These signals go to teammates, NOT to team-lead.

| Signal | Meaning | Sender → Receiver |
|--------|---------|-------------------|
| `REVIEW_REQUEST: {summary}` | Builder requests review of implementation | Builder → Reviewer |
| `APPROVED: {summary}` | Reviewer approves implementation — paired with IMPLEMENTATION_APPROVED to krs-one | Reviewer → Builder |
| `REJECTED: {issues}` | Reviewer rejects with specific issues (no boss signal; builder owns the reject/fix cycle) | Reviewer → Builder |
| `IMPLEMENTATION_APPROVED: {summary}` | Reviewer reports a successful chunk to the boss on APPROVED (Wave 3 — owns the success handoff so a dropped builder can't stall the build loop) | Reviewer → Boss |
| `IMPLEMENTATION_BLOCKED: {reason}` | Builder hit a tooling or technical blocker that kept them from producing reviewable output | Builder → Boss |
| `IMPLEMENTATION_REJECTED: {latest issues}` | Builder exhausted 3 reject/fix cycles without an APPROVED verdict (Wave 3 terminal failure path) | Builder → Boss |
| `ARCHIVE: step={step}, [chunk={N},] file={filename}, source={path}` | Archive a pipeline artifact — thoth files it under `.kiln/archive/` and logs to the guide scratchpad. Fire-and-forget (thoth never replies). | Any agent → thoth |

## Blocking Policy

**Boss → PM (ITERATION_UPDATE): blocking, 60s timeout.** KRS-One sends ITERATION_UPDATE to rakim+sentinel between worker cycles and waits for READY back from each. This is safe because it happens between cycles, not mid-execution. Timeout prevents deadlock — if a PM doesn't respond within 60s, KRS-One proceeds.

**Boss → PM (other): fire-and-forget.** All other boss→PM communication is send-and-continue. Never STOP-wait for a PM reply outside the ITERATION_UPDATE seam.

**Boss → Engine (CYCLE_WORKERS): blocking — belt-and-suspenders unblock.** KRS-One sends CYCLE_WORKERS to team-lead and waits. Two independent signals unblock him: `WORKERS_SPAWNED` from the engine (canonical — carries duo_id and authoritative subagent_types), OR `WORKER_READY` from one of the freshly-spawned workers (Wave 3 fallback — the worker's own first-wake announce). Whichever arrives first unblocks. If only WORKER_READY arrives, krs-one uses the `coder_name`/`reviewer_name` he sent in his own CYCLE_WORKERS payload.

**Engine → Boss (WORKERS_SPAWNED): blocking.** Engine confirms fresh worker pair to KRS-One. KRS-One proceeds to dispatch the next chunk assignment.

**Worker → Boss (WORKER_READY): fire-and-forget fallback.** BOTH members of each freshly-spawned build-step duo — builder (dial-a-coder, backup-coder, la-peintresse) AND reviewer (critical-thinker, the-curator) — send exactly one `WORKER_READY: ready for assignment` to krs-one as their first action on wake. This is NOT a reply to anything; it is a redundant self-announce that guarantees krs-one can unblock CYCLE_WORKERS even when the engine's WORKERS_SPAWNED path fails or is delayed. Either worker's WORKER_READY is sufficient to unblock.

**Boss → PM (MILESTONE_TRANSITION): blocking.** KRS-One notifies persistent minds of milestone boundary before signaling MILESTONE_COMPLETE to the engine. PMs acknowledge with READY and reset milestone-scoped state.

**Worker → PM: consult freely.** Workers are encouraged to message PMs with questions during execution. Send question → STOP → wait for reply → continue. PMs know the codebase so workers avoid redundant scanning. This saves tokens and raises quality.

**Worker → Boss: blocking.** Post-review completion signals reach krs-one on these paths:
- `IMPLEMENTATION_APPROVED` (Reviewer → Boss) — the paired reviewer emits this on every APPROVED verdict, alongside the APPROVED message to the builder. This is the Wave 3 success path — the reviewer owns the handoff so a dropped builder can't stall the build loop.
- `IMPLEMENTATION_BLOCKED` (Builder → Boss) — builder hit a tooling/technical blocker before producing reviewable output.
- `IMPLEMENTATION_REJECTED` (Builder → Boss) — builder exhausted 3 reject/fix cycles without an APPROVED verdict (Wave 3 terminal failure path).
Builders do NOT send any success signal to krs-one themselves — silence after commit on APPROVED is intentional.

**Worker → Worker: blocking.** `REVIEW_REQUEST`, `APPROVED`, `REJECTED` — builder↔reviewer exchanges. Builder sends REVIEW_REQUEST and waits for verdict.

**Terminal signals → engine: fire-and-forget.** Send and STOP. Engine processes on its next turn.

## Communication

- `SendMessage` is the only way to reach teammates. Plain text output is invisible to agents (visible to operator).
- After sending a message expecting a reply, STOP your turn. Never sleep-poll.
- One message in per wake-up. Process fully before acting.

## Shutdown

On `shutdown_request`, approve immediately:
```
SendMessage(type: "shutdown_response", request_id: "{request_id}", approve: true)
```
No follow-up, no summary, no delay. After approving you will be terminated — this is normal.

## Security

NEVER read or write files matching: `.env`, `*.pem`, `*_rsa`, `*.key`, `credentials.json`, `secrets.*`, `.npmrc`.

This rule is universal — all pipeline agents regardless of role or step.

## Status Marker Convention

Persistent minds MUST write `<!-- status: complete -->` as the exact first line of their owned files **immediately on spawn** — a minimal skeleton before full content is populated.

Files and owners:
- `.kiln/docs/codebase-state.md` — owned by rakim
- `.kiln/docs/patterns.md` — owned by sentinel
- `.kiln/docs/architecture.md` — owned by numerobis

**Enforcement:** A SubagentStop hook (`stop-guard.sh`) prevents these agents from stopping before the marker is written. This is an advisory guard — it warns and blocks the stop, but does not prevent dispatch. The primary guarantee is the 3-wave spawn pattern: persistent minds bootstrap in Wave 1, the boss spawns in Wave 2, workers in Wave 3. By design, PMs are ready before the boss can dispatch.

## Blocking Seam (Persistent Minds)

The persistent mind seam is the synchronization point between every build iteration. KRS-One MUST:

1. Send `ITERATION_UPDATE: {summary}` to rakim AND sentinel — describe what was just implemented.
2. STOP. Wait for `READY` from BOTH (60s timeout each).
3. Only after both reply `READY` may the boss scope and dispatch the next chunk.

**Why this is blocking:** Persistent minds update their files (codebase-state.md, patterns.md) between worker cycles. Workers rely on these files for accurate context. Dispatching before PMs finish causes stale context — the root cause of implementation drift and missed deliverables.

**Timeout handling:** If a PM does not reply within 60s, log a warning to `.kiln/docs/iter-log.md` and proceed. Do not deadlock waiting indefinitely.

## Name Binding

**CRITICAL — the #1 cause of deadlocks.**

- Use ONLY the exact teammate names from your spawn prompt or the Teammate Names section in your agent definition
- Never guess or abbreviate names
- When replying to a message, reply to the SENDER by their exact name
- Never default to `team-lead` unless team-lead actually sent the message
- `thoth` is a fixed name — always available for logging
- **Boss-selected duo names are authoritative.** The engine echoes them back unchanged in WORKERS_SPAWNED. Use the exact names from that message.

## Thoth Logging

**Every agent MUST message `thoth` at every significant event.**

Format: `SendMessage(recipient: "thoth", content: "LOG: {EVENT_TYPE} | {detail}")`

Thoth is fire-and-forget — do NOT wait for a reply. Just send and continue.

Log at minimum:
- WORKER_READY / READY
- Every assignment received
- Every file written (CODEX_EXEC, FILE_WRITTEN)
- Every REVIEW_REQUEST, APPROVED, REJECTED
- Every IMPLEMENTATION_APPROVED (reviewer), IMPLEMENTATION_BLOCKED, IMPLEMENTATION_REJECTED, ESCALATION
- Every CONSULTATION sent/received
- Every ITERATION_UPDATE and READY
- Every QA signal (QA_PASS, QA_FAIL)
- Every DUO_SELECTED (boss only)

## Skill Loading (Belt-and-Suspenders)

Skills frontmatter is silently dropped for team agents. Three layers ensure protocol is always loaded:

1. **Frontmatter** `skills: ["kiln-protocol"]` — works for standalone agents, harmless when dropped for teams
2. **Explicit Read** `Read ${CLAUDE_PLUGIN_ROOT}/skills/kiln-protocol/SKILL.md` — primary layer, in agent body
3. **Spawn prompt** reference — backup, provided by engine at spawn time

All three layers MUST exist in every agent definition. If any single layer fails, the other two cover it.
