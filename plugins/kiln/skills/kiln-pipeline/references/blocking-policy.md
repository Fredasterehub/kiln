# Blocking Policy

Which messages block (STOP and wait for reply), which are fire-and-forget, and what happens on timeout. This is the single source of truth for message-flow control.

## Three Blocking Signals (Build Step)

Only these messages require STOP-and-wait:

| Signal | Sender → Receiver | What triggers reply | Timeout behavior |
|--------|-------------------|---------------------|-----------------|
| `IMPLEMENTATION_COMPLETE` / `IMPLEMENTATION_BLOCKED` | Builder → KRS-One | Builder finishes or hits blocker | Engine nudges if idle >5 min |
| Reviewer verdict (APPROVED/REJECTED) | Reviewer → Builder | Builder sends REVIEW_REQUEST | Engine nudges if idle >5 min |
| `shutdown_response` | Any agent → Engine | Engine sends shutdown_request | Forced after 30s |

**Everything else is fire-and-forget.** Specifically:

## Fire-and-Forget Messages (Never Wait)

| Message | Sender → Receiver | Purpose |
|---------|-------------------|---------|
| `ITERATION_UPDATE` | KRS-One → rakim, sentinel | Notify PMs of iteration results |
| `MILESTONE_DONE` | KRS-One → rakim | Mark milestone complete in state |
| `QA_ISSUES` | KRS-One → rakim | Note issues in state |
| `ARCHIVE` | Any → thoth | Archive file request |
| `ITERATION_COMPLETE` | KRS-One → engine | Signal iteration done |
| `MILESTONE_COMPLETE` | KRS-One → engine | Signal milestone done |
| `BUILD_COMPLETE` | KRS-One → engine | Signal all milestones done |
| `READY` | PM → engine | Bootstrap complete |
| `REQUEST_WORKERS` | Boss → engine | Request worker spawn |

## Worker ↔ PM Consultation (Promoted)

Workers are **encouraged** to consult persistent minds directly during execution. This is the primary value of PMs — they already know the codebase and patterns, so workers avoid redundant scanning. This saves tokens and raises quality.

- Worker sends question to PM → STOP → waits for PM reply → continues work.
- This is a **standard blocking exchange** (worker waits for PM). It does NOT block the pipeline because it's a single worker waiting on a focused answer during its own execution.
- PMs should reply promptly with specifics (file paths, patterns, known issues).

**Example:** Builder asks rakim "What files own the auth module?" instead of scanning the entire project. Rakim replies with exact paths. Builder proceeds with precision.

## Rules

1. **Boss → PM: always fire-and-forget.** Boss sends updates to PMs and continues immediately. PMs reply best-effort. Boss NEVER blocks on a PM reply. This is the rule that prevents the ST22 deadlock class.
2. **Worker → PM: standard consultation.** Workers may and SHOULD consult PMs for codebase knowledge, patterns, or file locations. Worker sends question, STOPs, waits for reply, continues. This is promoted — it raises quality and lowers cost.
3. **Terminal signals to engine are always fire-and-forget.** Boss sends and STOPs. Engine processes on its next turn.
4. **Duplicate handling:** If a worker sends IMPLEMENTATION_COMPLETE twice, boss processes the first, ignores duplicates. If a late PM reply arrives after boss already signaled, boss ignores it.
5. **The reviewer is the quality gate, not a hook.** No SubagentStop checks on builder commit history.
