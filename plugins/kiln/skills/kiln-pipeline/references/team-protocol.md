# Team Protocol Reference

Shared behavior patterns for all Kiln pipeline agents. Every boss reads this at startup alongside their own `.md` file. Workers receive the path in their runtime prompt.

Read this file ONCE at the start of each step. Do not re-read mid-step.

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

The engine spawns each worker on the same team. Workers appear as teammates with full SendMessage access. The boss then dispatches assignments individually — one message per worker.

**Naming**: Use the naming convention from your `.md` file. Workers get descriptive names, not sequential numbers.

## 4. Dispatch Pattern

When assigning work to a teammate:

1. **Scope first** — define WHAT to do and WHY, not HOW. The worker decides implementation approach.
2. **Package ALL context upfront** — include rakim's codebase state summary, sentinel's patterns/pitfalls excerpt, relevant architecture decisions, file paths, and constraints DIRECTLY in the assignment. The worker should have everything they need in your message. This eliminates consultation round-trips and saves 1-2 turns per worker.
3. **One message, one assignment** — send the full assignment in a single SendMessage. Don't drip-feed instructions across multiple messages.
4. **STOP after dispatch** — after sending, stop your turn immediately and wait for the reply.

```
SendMessage(
  type: "message",
  recipient: "{worker}",
  content: "ASSIGNMENT: {scope}\n\nContext:\n- Architecture: {key decisions from architecture.md}\n- Patterns: {relevant patterns from sentinel}\n- Codebase state: {relevant files/modules from rakim}\n- Constraints: {tech-stack constraints}\n\nAcceptance criteria:\n{criteria}"
)
```

## 5. Peer Consultation

**Before dispatch (Phase A/B):** Only the boss sends messages. Persistent minds respond to boss only.

**After dispatch (Phase C):** Workers can consult persistent minds directly — but the boss should have packaged enough context to make this rare. Consultation costs a full turn.

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

Persistent minds signal `READY` after bootstrap to share their state summaries with the engine. Bosses receive these summaries pre-injected in their runtime prompt — they already have full context on spawn. After reading protocol files, evaluate scope and send `REQUEST_WORKERS`.

Always include context after the signal name. A bare signal is less useful than one with specifics:
- Bad: `RESEARCH_COMPLETE`
- Good: `RESEARCH_COMPLETE: 6 topics researched. Key findings: RSC viable, Drizzle preferred over Prisma.`

## Communication Rules (Universal)

See `shared-rules.md` for security, shutdown, and communication rules that apply to all agents. Additional protocol-specific rules:

1. **Never send messages before your bootstrap is complete.** Read your files first.
2. **Plain text for operator, SendMessage for agents.** Bosses in INTERACTIVE steps talk to the operator via plain text output. All agent-to-agent communication uses SendMessage exclusively.
3. **One message at a time.** You wake up with one message. Process it fully before deciding your next action.
