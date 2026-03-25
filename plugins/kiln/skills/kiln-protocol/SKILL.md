---
name: kiln-protocol
description: >-
  Core protocol for Kiln pipeline agents. Preloaded into every agent via frontmatter.
  Signal vocabulary, blocking policy, communication rules, shutdown handling.
  Internal Kiln skill — not user-invocable.
user-invocable: false
---

# Kiln Protocol

## Signals

Send via `SendMessage(type: "message", recipient: "team-lead", content: "SIGNAL: details")`.

| Signal | Meaning |
|--------|---------|
| `READY: {summary}` | PM bootstrap complete |
| `REQUEST_WORKERS: {name} (subagent_type: {type}), ...` | Boss needs workers spawned |
| `ONBOARDING_COMPLETE` | Step 1 done (alpha) |
| `BRAINSTORM_COMPLETE` | Step 2 done (da-vinci) |
| `RESEARCH_COMPLETE: {N} topics` | Step 3 done (mi6) |
| `ARCHITECTURE_COMPLETE: milestone_count={N}` | Step 4 done (aristotle) |
| `ITERATION_COMPLETE` | Build iteration done (krs-one) |
| `MILESTONE_COMPLETE: {name}` | Milestone QA passed (krs-one) |
| `BUILD_COMPLETE` | All milestones done (krs-one) |
| `VALIDATE_PASS` / `VALIDATE_FAILED` | Step 6 result (argus) |
| `REPORT_COMPLETE` | Step 7 done (omega) |
| `BLOCKED: {reason}` | Cannot proceed (any) |

Always include context after the signal. `RESEARCH_COMPLETE: 6 topics. Key: RSC viable, Drizzle preferred.` not bare `RESEARCH_COMPLETE`.

## Blocking Policy

**Boss → PM: fire-and-forget.** Send and continue. Never STOP-wait for a persistent mind reply. This rule is absolute — violating it causes deadlocks.

**Worker → PM: consult freely.** Workers are encouraged to message PMs with questions during execution. Send question → STOP → wait for reply → continue. PMs know the codebase so workers avoid redundant scanning. This saves tokens and raises quality.

**Worker → Boss: blocking.** `IMPLEMENTATION_COMPLETE`, `IMPLEMENTATION_BLOCKED`, reviewer verdicts — these are standard blocking exchanges.

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
