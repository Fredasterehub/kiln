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

Send via `SendMessage(type: "message", recipient: "team-lead", content: "SIGNAL: details")`.

| Signal | Meaning |
|--------|---------|
| `READY: {summary}` | PM bootstrap complete |
| `REQUEST_WORKERS: {name} (subagent_type: {type}), ...` | Boss needs workers spawned |
| `CYCLE_WORKERS: scenario={default\|fallback\|ui}, duo_id={duo_id}, coder_name={name}, reviewer_name={name}, reason={reason}, chunk={summary}` | Boss requests fresh worker pair (blocking — waits for WORKERS_SPAWNED) |
| `WORKERS_SPAWNED: {builder_name}, {reviewer_name}` | Engine confirms new worker pair ready |
| `WORKERS_REJECTED: {reason}` | Engine rejected REQUEST_WORKERS |
| `ONBOARDING_COMPLETE` | Step 1 done (alpha) |
| `BRAINSTORM_COMPLETE` | Step 2 done (da-vinci) |
| `RESEARCH_COMPLETE: {N} topics` | Step 3 done (mi6) |
| `ARCHITECTURE_COMPLETE: milestone_count={N}` | Step 4 done (aristotle) |
| `ITERATION_UPDATE: {summary}` | Chunk complete, update state files (blocking, 60s) — boss→PM |
| `ITERATION_COMPLETE` | Build iteration done — legacy/internal (krs-one) |
| `MILESTONE_COMPLETE: {name}` | Milestone QA passed (krs-one) |
| `BUILD_COMPLETE` | All milestones done (krs-one) |
| `MILESTONE_TRANSITION: completed={name}, next={name}` | KRS-One notifies persistent minds of milestone boundary (blocking) |
| `VALIDATE_PASS` / `VALIDATE_FAILED` | Step 6 result (argus) |
| `REPORT_COMPLETE` | Step 7 done (omega) |
| `BLOCKED: {reason}` | Cannot proceed (any) |

Always include context after the signal. `RESEARCH_COMPLETE: 6 topics. Key: RSC viable, Drizzle preferred.` not bare `RESEARCH_COMPLETE`.

## Worker Signals (peer-to-peer)

These signals go to teammates, NOT to team-lead.

| Signal | Meaning | Sender → Receiver |
|--------|---------|-------------------|
| `REVIEW_REQUEST: {summary}` | Builder requests review of implementation | Builder → Reviewer |
| `APPROVED: {summary}` | Reviewer approves implementation | Reviewer → Builder |
| `REJECTED: {issues}` | Reviewer rejects with specific issues | Reviewer → Builder |
| `IMPLEMENTATION_COMPLETE: {summary}` | Builder reports completion to boss | Builder → Boss |
| `IMPLEMENTATION_BLOCKED: {reason}` | Builder cannot proceed | Builder → Boss |

## Blocking Policy

**Boss → PM (ITERATION_UPDATE): blocking, 60s timeout.** KRS-One sends ITERATION_UPDATE to rakim+sentinel between worker cycles and waits for READY back from each. This is safe because it happens between cycles, not mid-execution. Timeout prevents deadlock — if a PM doesn't respond within 60s, KRS-One proceeds.

**Boss → PM (other): fire-and-forget.** All other boss→PM communication is send-and-continue. Never STOP-wait for a PM reply outside the ITERATION_UPDATE seam.

**Boss → Engine (CYCLE_WORKERS): blocking.** KRS-One sends CYCLE_WORKERS to team-lead and waits for WORKERS_SPAWNED. Engine shuts down current workers, spawns fresh pair, responds with names.

**Engine → Boss (WORKERS_SPAWNED): blocking.** Engine confirms fresh worker pair to KRS-One. KRS-One proceeds to dispatch the next chunk assignment.

**Boss → PM (MILESTONE_TRANSITION): blocking.** KRS-One notifies persistent minds of milestone boundary before signaling MILESTONE_COMPLETE to the engine. PMs acknowledge with READY and reset milestone-scoped state.

**Worker → PM: consult freely.** Workers are encouraged to message PMs with questions during execution. Send question → STOP → wait for reply → continue. PMs know the codebase so workers avoid redundant scanning. This saves tokens and raises quality.

**Worker → Boss: blocking.** `IMPLEMENTATION_COMPLETE` and `IMPLEMENTATION_BLOCKED` — builder reports completion or blockers to KRS-One. Standard blocking exchanges.

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

## Hook Gate (PM Blocking Seam)

A PreToolUse hook enforces a hard gate on **krs-one** specifically. The gate blocks two actions until both persistent mind files have `<!-- status: complete -->` as their exact first line:

1. Any SendMessage from krs-one to a recipient outside `rakim`, `sentinel`, `thoth`, or `team-lead` (i.e., builder/reviewer dispatch)
2. Any `REQUEST_WORKERS` or `CYCLE_WORKERS` signal from krs-one to `team-lead`

Files checked:
- `.kiln/docs/codebase-state.md` — owned by rakim
- `.kiln/docs/patterns.md` — owned by sentinel

**What this means in practice:**
- Persistent minds (rakim, sentinel) MUST write `<!-- status: complete -->` as the first line of their owned files **immediately on spawn** — as a minimal skeleton, before full content is populated. This opens the gate before bootstrap completes.
- The hook enforces this mechanically — no instructions can override it.
- This gate fires at **milestone start** (bootstrap). The per-iteration synchronization seam is the `ITERATION_UPDATE → READY` flow, documented in § Blocking Seam below.

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
- Every IMPLEMENTATION_COMPLETE, BLOCKED, ESCALATION
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
