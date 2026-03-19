# Team Protocol Reference

Shared behavior patterns for all Kiln pipeline agents. Every boss reads this at startup alongside their own `.md` file. Workers receive the path in their runtime prompt.

Read this file ONCE at the start of each step. Do not re-read mid-step.

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
2. Read this file (`team-protocol.md`)
3. Read any owned files listed in your `.md`
4. Confirm what you found — your first message should reference specific content from your files

**Phase 2 — Receive Assignment:**
- **Bosses**: receive READY summaries from persistent minds in your runtime prompt, then evaluate scope
- **Workers**: wait for assignment from boss via SendMessage — do NOT act until you receive one
- **Persistent minds**: bootstrap autonomously → signal READY to team-lead with content summary. No assignment needed.

Persistent minds skip Phase 2. They bootstrap immediately on spawn, read their files, update state if needed, then signal READY. They don't wait for a message to start.

## 2. Reply Counting

You receive replies ONE AT A TIME. Each time you wake up, you get exactly one message. Track expected replies:

1. Before dispatching, note how many agents you expect replies from
2. Each wake-up: identify the sender, process the reply, decrement your count
3. If count > 0: **STOP and wait.** Do NOT take any other action.
4. If count == 0: all replies in, proceed to next phase

**Never re-message an agent who already replied.** If you need additional info, message them with a NEW question — but count that as a new expected reply.

## 3. Dynamic Roster

Bosses request workers from the engine (team-lead) when they've evaluated scope and know what they need:

```
SendMessage(
  type: "message",
  recipient: "team-lead",
  content: "REQUEST_WORKERS: {name} (subagent_type: {type}), {name} (subagent_type: {type})"
)
```

**Worktree isolation**: Workers that write code can request git worktree isolation. This uses Claude Code's native `isolation: "worktree"` parameter, which gives the agent its own copy of the repository in a temporary git worktree. Add `isolation: worktree` to the worker spec:

```
REQUEST_WORKERS: codex (subagent_type: codex, isolation: worktree), sphinx (subagent_type: sphinx)
```

The engine passes `isolation: "worktree"` to the Agent() call. The isolated agent works on a separate branch — if it makes changes, the worktree path and branch are returned to the engine. SendMessage works normally across worktree boundaries.

The engine spawns each worker on the same team. Workers appear as teammates with full SendMessage access. The boss then dispatches assignments individually — one message per worker.

**Naming**: Use the naming convention from your `.md` file. Workers get descriptive names, not sequential numbers.

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
