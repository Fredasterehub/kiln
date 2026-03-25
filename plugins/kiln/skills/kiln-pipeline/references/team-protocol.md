# Team Protocol Reference

Detailed reference for kiln-protocol skill. On-demand — bosses read when they need the full playbook. Workers receive the path in their runtime prompt.

## Three-Phase Spawn

Every step follows a three-phase spawn sequence (some steps skip Phase C):

**Phase A — Persistent Minds**: Spawned first (`run_in_background: true`). Bootstrap autonomously — read files, update state, signal READY to team-lead with a content summary. No assignment needed.

**Phase B — Boss**: Spawned after ALL Phase A agents signal READY. Interactive bosses run in foreground (`run_in_background: false`); background bosses run in background. Receives READY summaries in runtime prompt.

**Phase C — Workers**: Spawned when the boss sends `REQUEST_WORKERS`. Each worker joins the same team with full SendMessage access. Boss dispatches individual assignments after workers are spawned.

Not every step uses all three phases. Step 7 is Phase B only. Step 2 has no Phase C. See the step's blueprint for the exact roster.

## 1. Bootstrap Sequence

All agents follow a two-phase bootstrap:

**Phase 1 — Read and Confirm:**
1. Read your agent `.md` file (loaded automatically via `subagent_type`)
2. Read any owned files listed in your `.md`
3. Confirm what you found — your first message should reference specific content from your files

**Phase 2 — Receive Assignment:**
- **Bosses**: receive READY summaries from persistent minds in your runtime prompt, then evaluate scope
- **Workers**: wait for assignment from boss via SendMessage — do NOT act until you receive one
- **Persistent minds**: bootstrap autonomously → signal READY to team-lead with content summary. No assignment needed.

Persistent minds skip Phase 2. They bootstrap immediately on spawn, read their files, update state if needed, then signal READY. They don't wait for a message to start.

## 2. Message Flow Control

You receive messages ONE AT A TIME. Each wake-up delivers exactly one message. Process it fully before acting.

**Blocking exchanges** (STOP and wait for reply):
- Worker completion: `IMPLEMENTATION_COMPLETE` / `IMPLEMENTATION_BLOCKED` (builder → boss)
- Reviewer verdict: APPROVED / REJECTED (reviewer → builder)
- Worker → PM consultation: worker sends question, STOPs, waits for reply
- Shutdown: `shutdown_response` (any agent → engine)

**Fire-and-forget** (send and continue immediately):
- Boss → PM: `ITERATION_UPDATE`, `MILESTONE_DONE`, `QA_ISSUES` — never wait for PM reply
- Any → thoth: `ARCHIVE` requests
- Terminal signals → engine: `ITERATION_COMPLETE`, `MILESTONE_COMPLETE`, `BUILD_COMPLETE`

See `blocking-policy.md` for the full source of truth.

## 3. Dynamic Roster

Bosses request workers from the engine (team-lead) when they've evaluated scope and know what they need:

```
SendMessage(
  type: "message",
  recipient: "team-lead",
  content: "REQUEST_WORKERS: {name} (subagent_type: {type}), {name} (subagent_type: {type})"
)
```

Workers are spawned into the team. The engine manages isolation.

The engine spawns each worker on the same team. Workers appear as teammates with full SendMessage access. The boss then dispatches assignments individually — one message per worker.

**Naming**: Names are assigned by the engine at spawn via runtime prompt. Build-step workers get tier-themed duo names chosen by krs-one from per-tier pools (Codex = explorer/adventure, Sonnet = Musketeers, Opus = iconic power duos, UI = art/design duality). The engine injects both names (own + partner) into each agent's runtime prompt.

## 4. Dispatch Pattern

When assigning work to a teammate:

1. **Scope first** — define WHAT to do and WHY, not HOW. The worker decides implementation approach.
2. **Package context** — include relevant summaries from persistent minds, file paths, constraints. Don't make workers hunt for context across multiple files.
3. **One message, one assignment** — send the full assignment in a single SendMessage. Don't drip-feed instructions across multiple messages.
4. **STOP after dispatch** — after sending, stop your turn immediately and wait for the reply.

```
SendMessage(
  type: "message",
  recipient: "{worker}",
  content: "ASSIGNMENT: {scope}\n\nContext:\n{packaged context}\n\nAcceptance criteria:\n{criteria}"
)
```

## 5. Peer Consultation

Communication permissions are phased:

**Before dispatch (Phase A/B):** Only the boss sends messages. Persistent minds respond to boss only. Workers don't exist yet.

**After dispatch (Phase C):** Workers can consult persistent minds directly for technical questions. The boss doesn't need to relay.

Consultation pattern:
1. Send your question via SendMessage to the persistent mind
2. STOP. Wait for their reply before continuing.
3. Incorporate the answer and continue your work.
4. Use sparingly — each consultation costs a full turn.

```
SendMessage(
  type: "message",
  recipient: "{persistent_mind}",
  content: "QUESTION: {specific technical question with context}"
)
```

## 6. Shutdown Protocol

When you receive a `shutdown_request`, approve it immediately with this exact tool call:

```
SendMessage(type: "shutdown_response", request_id: "{request_id}", approve: true)
```

Where `{request_id}` is extracted from the shutdown request message you received.

**Rules:**
- Approve immediately — no follow-up questions, no "anything else?", no delay
- Do not ask the requester if they're sure, do not summarize your work, do not offer to continue
- After approving, you will be terminated — this is normal and expected
- Never ignore or delay a shutdown request

## 7. Signal Vocabulary

Standard signals sent via SendMessage to team-lead (the engine):

| Signal | Meaning | Sent by |
|--------|---------|---------|
| `READY: {summary}` | Bootstrap complete, available for consultation | Persistent minds |
| `REQUEST_WORKERS: {list}` | Need workers spawned on team | Boss |
| `WORKERS_SPAWNED: {names}` | Engine confirms workers on team | Engine |
| `WORKERS_REJECTED: {reason}` | Engine rejected REQUEST_WORKERS | Engine |
| `ONBOARDING_COMPLETE` | Step 1 done | Alpha |
| `BRAINSTORM_COMPLETE` | Step 2 done | Da Vinci |
| `RESEARCH_COMPLETE: {N} topics` | Step 3 done | MI6 |
| `ARCHITECTURE_COMPLETE: milestone_count={N}` | Step 4 done | Aristotle |
| `PLAN_BLOCKED` | Architecture validation failed 3x | Aristotle |
| `ITERATION_COMPLETE` | Build iteration done, more work needed | KRS-One |
| `MILESTONE_COMPLETE: {name}` | Milestone done, QA passed | KRS-One |
| `BUILD_COMPLETE` | All milestones done | KRS-One |
| `VALIDATE_PASS` | Validation succeeded | Argus |
| `VALIDATE_FAILED` | Validation failed, correction needed | Argus |
| `REPORT_COMPLETE` | Step 7 done | Omega |
| `BLOCKED: {reason}` | Cannot proceed, need intervention | Any agent |

Always include context after the signal name. A bare signal is less useful than one with specifics:
- Bad: `RESEARCH_COMPLETE`
- Good: `RESEARCH_COMPLETE: 6 topics researched. Key findings: RSC viable, Drizzle preferred over Prisma.`

## Communication Rules (Universal)

These apply to ALL agents in every step:

1. **SendMessage is the ONLY way to communicate with teammates.** Plain text output is invisible to other agents. It IS visible to the operator (who can view your session via shift+arrow).
2. **Never send messages before your bootstrap is complete.** Read your files first.
3. **After sending a message expecting a reply, STOP your turn.** Never sleep-poll. Never continue working while waiting for a response.
4. **Plain text for operator, SendMessage for agents.** Bosses in INTERACTIVE steps talk to the operator via plain text output. All agent-to-agent communication uses SendMessage exclusively.
5. **One message at a time.** You wake up with one message. Process it fully before deciding your next action.
