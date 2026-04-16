# Team Protocol Reference

Detailed reference for kiln-protocol skill. On-demand — bosses read when they need the full playbook. Workers receive the path in their runtime prompt.

## Three-Phase Spawn

Every step follows a three-phase spawn sequence (some steps skip Phase C):

**Phase A — Persistent Minds**: Spawned first (`run_in_background: true`). Bootstrap autonomously — read files, update state, signal READY to team-lead with a content summary. No assignment needed.

**Phase B — Boss**: Spawned after ALL Phase A agents signal READY. Interactive bosses run in foreground (`run_in_background: false`); background bosses run in background. Receives READY summaries in runtime prompt.

**Phase C — Workers**: Spawned when the boss sends `REQUEST_WORKERS` (initial spawn) or `CYCLE_WORKERS` (subsequent chunks). Each worker joins the same team with full SendMessage access. Boss dispatches individual assignments after workers are spawned. In step 5, Phase C workers are cycled dynamically per implementation chunk — see **Worker Cycling Pattern** below.

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
- Worker cycling: `CYCLE_WORKERS` (KRS-One → engine, waits for `WORKERS_SPAWNED`)
- Milestone transition: `MILESTONE_TRANSITION` (KRS-One → rakim+sentinel, waits for `READY`)

**Blocking between worker cycles** (STOP and wait for READY):
- Boss → PM: `ITERATION_UPDATE` to rakim+sentinel (60s timeout) — ensures state files are current before the next chunk is scoped. This blocks between worker CYCLES, not between worker operations within a cycle.

**Fire-and-forget** (send and continue immediately):
- Boss → PM: `MILESTONE_DONE`, `QA_ISSUES` — never wait for PM reply
- Any → thoth: `ARCHIVE` requests
- Terminal signals → engine: `MILESTONE_COMPLETE`, `BUILD_COMPLETE` (`ITERATION_COMPLETE` is legacy/internal)

### Blocking Signals (Build Step)

| Signal | Sender → Receiver | What triggers reply | Timeout behavior |
|--------|-------------------|---------------------|-----------------|
| `IMPLEMENTATION_COMPLETE` / `IMPLEMENTATION_BLOCKED` | Builder → KRS-One | Builder finishes or hits blocker | Engine nudges if idle >5 min |
| Reviewer verdict (APPROVED/REJECTED) | Reviewer → Builder | Builder sends REVIEW_REQUEST | Engine nudges if idle >5 min |
| `shutdown_response` | Any agent → Engine | Engine sends shutdown_request | Forced after 30s |
| `ITERATION_UPDATE` | KRS-One → rakim, sentinel | Chunk complete, PMs update state | Proceed after 60s (no deadlock) |
| `CYCLE_WORKERS` | KRS-One → Engine | Request fresh worker pair | Engine responds with WORKERS_SPAWNED |
| `MILESTONE_TRANSITION` | KRS-One → rakim, sentinel | Milestone boundary, PMs archive+reset | Proceed after 60s (no deadlock) |
| `MILESTONE_QA_READY` | KRS-One → Engine | Milestone deliverables verified | Engine spawns Judge Dredd Tribunal (ken+ryu with random slot assignment → denzel → judge-dredd). KRS-One waits for QA_PASS / QA_FAIL direct from judge-dredd (300s timeout) |
| `QA_REPORT_READY` | ken/ryu → Engine | Individual QA report written to .kiln/tmp/qa-report-{a\|b}.md (slot assigned at spawn) | Engine tracks per-sender (two distinct waits) |
| `RECONCILIATION_COMPLETE` | denzel → engine | Reconciliation written to .kiln/tmp/qa-reconciliation.md; engine spawns judge-dredd | Engine tracks single wait |
| `QA_PASS` / `QA_FAIL: {findings}` | judge-dredd → KRS-One | Final verdict, direct (Wave 2 — engine no longer relays as QA_VERDICT) | KRS-One treats timeout as QA_FAIL |
| `DIVERGENCE_READY` | diogenes → aristotle | Divergence analysis written | Peer signal, not engine-routed |

### Blocking Policy Rules

1. **Boss → PM: fire-and-forget EXCEPT at seam points.** `ITERATION_UPDATE` and `MILESTONE_TRANSITION` are blocking with 60s timeout — KRS-One waits for READY between worker cycles and at milestone boundaries.
2. **Worker → PM: standard consultation.** Workers may and SHOULD consult PMs. Worker sends question, STOPs, waits for reply (60s timeout — if no response, proceed with best judgment and note the gap), continues.
3. **Terminal signals to engine are always fire-and-forget.** Boss sends and STOPs. Engine processes on its next turn.
4. **Duplicate handling:** If a worker sends IMPLEMENTATION_COMPLETE twice, boss processes the first, ignores duplicates.
5. **The reviewer is the quality gate, not a hook.** No SubagentStop checks on builder commit history.

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

**Worker cycling (step 5):** After the initial `REQUEST_WORKERS`, subsequent chunks use `CYCLE_WORKERS` instead — the engine shuts down the current pair and spawns a fresh one. See **Worker Cycling Pattern** for the full flow.

**Naming**: Workers are spawned from the duo pool (see `references/duo-pool.md`). The `name` parameter is the boss-selected character for this cycle (e.g., `name: "tintin"`, `subagent_type: "kiln:dial-a-coder"`). Hook enforcement fires on the agent type (subagent_type stripped of `kiln:` prefix) — not the spawn name. The engine injects the paired partner's spawn name and type into each worker's runtime prompt.

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
| `READY_BOOTSTRAP: {summary}` | Bootstrap complete, available for consultation (one-time at milestone start, recipient: team-lead) | Persistent minds |
| `READY: {summary}` | Post-iteration reply after ITERATION_UPDATE or MILESTONE_TRANSITION (recipient: krs-one) | Persistent minds |
| `REQUEST_WORKERS: {list}` | Need workers spawned on team (initial) | Boss |
| `CYCLE_WORKERS: scenario={s}, duo_id={id}, coder_name={name}, reviewer_name={name}, reason={r}, chunk={c}` | Shut down current workers, spawn fresh pair from duo pool | KRS-One |
| `WORKERS_SPAWNED: duo_id={id}, {builder_name} (subagent_type: {type}), {reviewer_name} (subagent_type: {type})` | Engine confirms fresh pair on team | Engine |
| `WORKERS_REJECTED: {reason}` | Engine rejected REQUEST_WORKERS | Engine |
| `ONBOARDING_COMPLETE` | Step 1 done | Alpha |
| `BRAINSTORM_COMPLETE` | Step 2 done | Da Vinci |
| `RESEARCH_COMPLETE: {N} topics` | Step 3 done | MI6 |
| `ARCHITECTURE_COMPLETE: milestone_count={N}` | Step 4 done | Aristotle |
| `PLAN_BLOCKED` | Architecture validation failed 3x | Aristotle |
| `ITERATION_UPDATE: {summary}` | Chunk complete, update state files (blocking, 60s) | KRS-One |
| `ITERATION_COMPLETE` | Build iteration done — legacy/internal, replaced by CYCLE_WORKERS | KRS-One |
| `MILESTONE_TRANSITION: completed={name}, next={name}` | Milestone boundary — PMs archive + reset (blocking) | KRS-One |
| `MILESTONE_QA_READY: {milestone_name}` | Deliverables verified, requesting independent QA | KRS-One |
| `QA_REPORT_READY` | Individual QA report written to .kiln/tmp/qa-report-{a\|b}.md; engine tracks per-sender (recipient: team-lead) | ken / ryu |
| `RECONCILIATION_COMPLETE` | Reconciliation written to .kiln/tmp/qa-reconciliation.md; engine spawns judge-dredd (recipient: team-lead) | denzel |
| `QA_PASS` | Final verdict: all criteria satisfied — direct to krs-one, no engine relay (Wave 2) | judge-dredd |
| `QA_FAIL: {findings}` | Final verdict: issues found — direct to krs-one, no engine relay (Wave 2) | judge-dredd |
| `DIVERGENCE_READY` | Divergence analysis written; peer signal to aristotle | diogenes |
| `MILESTONE_COMPLETE: {name}` | Milestone done, QA passed | KRS-One |
| `BUILD_COMPLETE` | All milestones done | KRS-One |
| `VALIDATE_PASS` | Validation succeeded | Argus |
| `VALIDATE_FAILED` | Validation failed, correction needed | Argus |
| `REPORT_COMPLETE` | Step 7 done | Omega |
| `BLOCKED: {reason}` | Cannot proceed, need intervention | Any agent |

Always include context after the signal name. A bare signal is less useful than one with specifics:
- Bad: `RESEARCH_COMPLETE`
- Good: `RESEARCH_COMPLETE: 6 topics researched. Key findings: RSC viable, Drizzle preferred over Prisma.`

## 8. Worker Cycling Pattern

### Why

Fresh context per implementation chunk prevents context pollution. Builders and reviewers accumulate irrelevant context from previous chunks, leading to confused implementations. Cycling gives each chunk a clean-slate worker pair.

### How

1. KRS-One scopes a chunk and determines the appropriate scenario
2. KRS-One sends `CYCLE_WORKERS` to team-lead (engine) with:
   - `scenario`: default | fallback | ui
   - `duo_id`: selected duo from pool (e.g., `tintin-milou`)
   - `coder_name`: builder's spawn name for this cycle (e.g., `tintin`)
   - `reviewer_name`: reviewer's spawn name for this cycle (e.g., `milou`)
   - `reason`: why this scenario was chosen
   - `chunk`: brief description of the work
3. Engine sends `shutdown_request` to current builder+reviewer
4. Engine waits for shutdown confirmation (60s timeout)
5. Engine spawns fresh builder+reviewer pair per scenario:
   - default: dial-a-coder + critical-drinker (spawn names from duo pool)
   - fallback: backup-coder + critical-drinker (spawn names from duo pool)
   - ui: la-peintresse + the-curator (spawn names from duo pool)
6. Engine sends `WORKERS_SPAWNED` to KRS-One with agent names
7. KRS-One dispatches assignment to fresh builder

### Persistent Minds

rakim, sentinel, thoth persist across all worker cycles within a milestone. They accumulate knowledge and respond to `ITERATION_UPDATE` with `READY` after updating their state files.

### Blocking Seam

`ITERATION_UPDATE` from KRS-One to rakim+sentinel is BLOCKING (60s timeout). This ensures state files are current before the next chunk is scoped. This is a different seam point than the v9 fire-and-forget concern — v9 was worried about blocking BETWEEN worker operations, this blocks BETWEEN worker CYCLES.

## Communication Rules (Universal)

These apply to ALL agents in every step:

1. **SendMessage is the ONLY way to communicate with teammates.** Plain text output is invisible to other agents. It IS visible to the operator (who can view your session via shift+arrow).
2. **Never send messages before your bootstrap is complete.** Read your files first.
3. **After sending a message expecting a reply, STOP your turn.** Never sleep-poll. Never continue working while waiting for a response.
4. **Plain text for operator, SendMessage for agents.** Bosses in INTERACTIVE steps talk to the operator via plain text output. All agent-to-agent communication uses SendMessage exclusively.
5. **One message at a time.** You wake up with one message. Process it fully before deciding your next action.
6. **Chunk scope is immutable after dispatch.** Any new information discovered during a chunk is incorporated in the next chunk's assignment, never patched into the current one. Boss NEVER messages an active worker mid-task.

## Build Scenarios

| Scenario | Builder | Reviewer | When |
|----------|---------|----------|------|
| Default | `dial-a-coder` | `critical-drinker` | `codex_available=true` and structural work. |
| Fallback | `backup-coder` | `critical-drinker` | `codex_available=false` (structural fallback). |
| UI | `la-peintresse` | `the-curator` | Components, pages, layouts, design tokens. |

Workers are spawned with duo pool names (e.g., `name: "tintin"`, `subagent_type: "kiln:dial-a-coder"`). Hook enforcement fires on the agent type, not the spawn name.

critical-drinker (opus) is the single structural reviewer for Default and Fallback. the-curator (sonnet) reviews UI only.

**Dormant spawn names:** tetsuo, daft, punk — duo pool names only, no agent .md files.

## Step Definitions

### Step 1: Onboarding
- **Boss**: alpha (opus, INTERACTIVE)
- **PMs**: mnemosyne (opus, Phase A)
- **Workers**: maiev, curie, medivh (sonnet, Phase C, brownfield only)
- **Done**: ONBOARDING_COMPLETE → stage: brainstorm

### Step 2: Brainstorm
- **Boss**: da-vinci (opus, INTERACTIVE)
- **PMs**: asimov (opus, Phase A)
- **Done**: BRAINSTORM_COMPLETE → stage: research

### Step 3: Research
- **Boss**: mi6 (opus)
- **PMs**: thoth (opus, Phase A)
- **Workers**: 2-5 field agents (sonnet, dynamic via REQUEST_WORKERS)
- **Done**: RESEARCH_COMPLETE → stage: architecture

### Step 4: Architecture
- **Boss**: aristotle (opus, INTERACTIVE)
- **PMs**: numerobis (opus), thoth (opus) — both Phase A
- **Workers**: confucius (opus), sun-tzu (sonnet), diogenes (sonnet), plato (opus), athena (opus) — requested in waves (Wave 1: planners, Wave 1.5: diogenes, Wave 2: plato, Wave 3: athena)
- **Done**: ARCHITECTURE_COMPLETE → stage: build, milestone_count=N
- **Blocked**: PLAN_BLOCKED (validation failed 3x)

### Step 5: Build (milestone-scoped)
- **Boss**: krs-one (opus, BACKGROUND, persists per milestone)
- **PMs**: rakim (opus), sentinel (sonnet), thoth (opus) — all persist per milestone
- **Workers**: one builder+reviewer pair per chunk via CYCLE_WORKERS, duo pool names per cycle (default: dial-a-coder+critical-drinker, fallback: backup-coder+critical-drinker, ui: la-peintresse+the-curator)
- **QA**: ken/team-red (opus), ryu/team-blue (sonnet), denzel/the-negotiator (opus), judge-dredd/i-am-the-law (sonnet) — spawned on MILESTONE_QA_READY, Judge Dredd Tribunal, dynamic
- **Signals**: CYCLE_WORKERS, ITERATION_UPDATE (blocking 60s), MILESTONE_TRANSITION (blocking 60s), MILESTONE_QA_READY (blocking 300s, waits for direct QA_PASS / QA_FAIL from judge-dredd), MILESTONE_COMPLETE, BUILD_COMPLETE
- **Done**: BUILD_COMPLETE → stage: validate

### Step 6: Validate
- **Boss**: argus (sonnet)
- **PMs**: zoxea (sonnet, Phase A)
- **Workers**: hephaestus (sonnet, conditional — design QA)
- **Done**: VALIDATE_PASS → stage: report | VALIDATE_FAILED → correction cycle (max 3)

### Step 7: Report
- **Boss**: omega (opus, solo)
- **Done**: REPORT_COMPLETE → stage: complete
