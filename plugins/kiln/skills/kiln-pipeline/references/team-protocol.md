# Team Protocol Reference

Detailed reference for the kiln-protocol skill. Bosses are the primary consumers and run at xhigh — they reach for this file when they need the definitive wire spec for spawn ordering, bootstrap, message flow, dispatch, peer consultation, shutdown, signal vocabulary, worker cycling, and per-step roster. Workers consult it secondarily, receiving the path via their runtime prompt. On-demand load, not preloaded; the host session does not read it.

Read the policy sections before the tables. Policy tells each agent what it is responsible for; the Blocking Signals and Signal Vocabulary tables that follow are reference lookups for exact signal strings and routing.

## Three-Phase Spawn

Every step follows a three-phase spawn sequence. Some steps skip Phase C.

**Phase A — Persistent Minds.** Spawned first (`run_in_background: true`). They bootstrap autonomously — read files, update state, signal READY to team-lead with a content summary — without waiting for an assignment. Phase A completing first is what lets Phase B bosses receive the READY summaries in their runtime prompt rather than having to poll for them.

**Phase B — Boss.** Spawned only after every Phase A agent has signalled READY. Interactive bosses run in the foreground (`run_in_background: false`); background bosses run in the background. The READY summaries arrive as part of the runtime prompt.

**Phase C — Workers.** Spawned when the boss sends `REQUEST_WORKERS` (initial spawn) or `CYCLE_WORKERS` (subsequent chunks). Each worker joins the same team with full SendMessage access, and the boss dispatches individual assignments one per worker after spawn. In step 5, Phase C workers are cycled dynamically per implementation chunk — see **Worker Cycling Pattern** below.

Not every step uses all three phases. Step 7 is Phase B only; Step 2 has no Phase C. The step's blueprint carries the exact roster.

## 1. Bootstrap Sequence

Every agent follows a two-phase bootstrap.

**Phase 1 — Read and confirm:**
1. Read your agent `.md` file (loaded automatically via `subagent_type`).
2. Read any owned files listed in your `.md`.
3. Confirm what you found — your first message should reference specific content from those files, so downstream agents can tell a genuine read from a guess.

**Phase 2 — Receive assignment:**
- **Bosses**: receive READY summaries from persistent minds in the runtime prompt, then evaluate scope.
- **Workers**: wait for assignment from the boss via SendMessage. Acting before an assignment arrives produces work that was never scoped.
- **Persistent minds**: skip Phase 2. They bootstrap immediately on spawn, read their files, update state if needed, then signal READY — no inbound message required.

## 2. Message Flow Control

Messages arrive one at a time; each wake-up delivers exactly one message. Process it fully before acting, because interleaved handling of a half-read message is how protocol conversations desynchronise.

**Blocking exchanges** — send, stop your turn, wait for reply:
- Chunk completion: `IMPLEMENTATION_APPROVED` (reviewer → boss) on success, `IMPLEMENTATION_BLOCKED` or `IMPLEMENTATION_REJECTED` (builder → boss) on failure paths.
- Reviewer verdict: APPROVED / REJECTED (reviewer → builder).
- Worker → PM consultation: worker sends question, stops, waits for reply.
- Shutdown: `shutdown_response` (any agent → engine).
- Worker cycling: `CYCLE_WORKERS` (KRS-One → engine, unblocks only after the engine observes `SubagentStart` for both fresh workers; `WORKERS_SPAWNED` is audit/logging after readiness).
- Milestone transition: `MILESTONE_TRANSITION` (KRS-One → rakim+sentinel, waits for `READY`).

**Blocking between worker cycles** — send and wait for READY:
- Boss → PM: `ITERATION_UPDATE` to rakim+sentinel (60s timeout). This blocks between worker CYCLES, not between worker operations within a cycle, so state files are current before the next chunk is scoped.

**Fire-and-forget** — send and continue on the same turn:
- Boss → thoth: `MILESTONE_DONE` triggers a per-milestone summary doc write; waiting for a reply would hang, since thoth never sends one. (Wave 4 C5: retargeted from rakim to thoth — rakim had no handler, so per-milestone docs never wrote.)
- Any → thoth: `ARCHIVE` requests.
- Terminal signals → engine: `MILESTONE_COMPLETE` on every milestone except the final, and `BUILD_COMPLETE` as the sole terminal on the final milestone (Wave 4 C4 contract — never paired). QA failure context now flows through structured `ITERATION_UPDATE` to rakim+sentinel; the pre-Wave-4 direct-to-rakim fire-and-forget channel for QA findings (see audit item H1) is gone.

**Final blocking archival check** — final milestone only:
- KRS-One → thoth: `FINAL_ARCHIVE_CHECK` after QA_PASS and before BUILD_COMPLETE. Thoth replies `ARCHIVE_READY` or `ARCHIVE_BLOCKED`. BUILD_COMPLETE is illegal until archive readiness is proven.

### Blocking Signals (Build Step)

| Signal | Sender → Receiver | What triggers reply | Timeout behavior |
|--------|-------------------|---------------------|-----------------|
| `IMPLEMENTATION_APPROVED` | Reviewer → KRS-One | Reviewer emits APPROVED (paired with APPROVED to builder). Wave 3 success handoff. | Engine nudges if idle >5 min |
| `IMPLEMENTATION_BLOCKED` / `IMPLEMENTATION_REJECTED` | Builder → KRS-One | Builder hits tooling blocker, or exhausts 3 reject/fix cycles | Engine nudges if idle >5 min |
| Reviewer verdict (APPROVED/REJECTED) | Reviewer → Builder | Builder sends REVIEW_REQUEST | Engine nudges if idle >5 min |
| `shutdown_response` | Any agent → Engine | Engine sends shutdown_request | Forced after 30s |
| `ITERATION_UPDATE` | KRS-One → rakim, sentinel | Chunk complete, PMs update state | Proceed after 60s (no deadlock) |
| `CYCLE_WORKERS` | KRS-One → Engine | Request fresh worker pair | Engine shuts down old workers, spawns the pair, observes `SubagentStart` for both, then resumes KRS-One; `WORKERS_SPAWNED` is audit/logging |
| `MILESTONE_TRANSITION` | KRS-One → rakim, sentinel | Milestone boundary, PMs archive+reset | Proceed after 60s (no deadlock) |
| `MILESTONE_QA_READY` | KRS-One → Engine | Milestone deliverables verified | Engine spawns Judge Dredd Tribunal (ken+ryu with random slot assignment → denzel → judge-dredd). KRS-One waits for QA_PASS / QA_FAIL direct from judge-dredd (300s timeout) |
| `FINAL_ARCHIVE_CHECK` | KRS-One → thoth | Final milestone QA_PASS, before BUILD_COMPLETE | Proceed only on `ARCHIVE_READY`; `ARCHIVE_BLOCKED` keeps build open |
| `QA_REPORT_READY` | ken/ryu → Engine | Individual QA report written to .kiln/tmp/qa-report-{a\|b}.md (slot assigned at spawn) | Engine tracks per-sender (two distinct waits) |
| `RECONCILIATION_COMPLETE` | denzel → engine | Reconciliation written to .kiln/tmp/qa-reconciliation.md; engine spawns judge-dredd | Engine tracks single wait |
| `QA_PASS` / `QA_FAIL: {findings}` | judge-dredd → KRS-One | Final verdict, direct (Wave 2 — engine no longer relays as QA_VERDICT) | KRS-One treats timeout as QA_FAIL |
| `DIVERGENCE_READY` | diogenes → aristotle | Divergence analysis written | Peer signal, not engine-routed |

### Blocking Policy Rules

1. **Boss → PM is fire-and-forget except at seam points.** `ITERATION_UPDATE` and `MILESTONE_TRANSITION` are the two blocking seams with 60s timeouts — KRS-One waits for READY between worker cycles and at milestone boundaries. Blocking outside these seams stalls the build against a PM reply that was never coming.
2. **Worker → PM consultation is encouraged.** Workers send a question, stop, wait for reply (60s timeout — if nothing comes back, proceed with best judgment and note the gap), continue. PMs carry codebase context, so consulting them is cheaper than re-scanning files.
3. **Terminal signals to the engine are fire-and-forget.** The boss sends and stops; the engine processes on its next turn. A reply is not coming — waiting for one deadlocks against an engine that has already moved on.
4. **Duplicate handling:** if a reviewer sends IMPLEMENTATION_APPROVED twice for the same chunk, the boss processes the first and ignores the rest. Same rule for any stray builder IMPLEMENTATION_BLOCKED/REJECTED.
5. **The reviewer is the quality gate and owns the success signal.** The reviewer emits IMPLEMENTATION_APPROVED to krs-one on every APPROVED verdict — no SubagentStop checks on builder commit history, because the hook layer is not the gate.

## 3. Dynamic Roster

Bosses request workers from the engine (team-lead) once they have evaluated scope and know the shape they need:

```
SendMessage(
  type: "message",
  recipient: "team-lead",
  content: "REQUEST_WORKERS: {name} (subagent_type: {type}), {name} (subagent_type: {type})"
)
```

The engine spawns each worker onto the same team, waits for `SubagentStart` acknowledgement for the full requested set, then sends `REQUEST_WORKERS_READY`. Workers appear as teammates with full SendMessage access. The boss then dispatches assignments individually — one message per worker. `WORKERS_SPAWNED` is audit/logging only after readiness.

**Worker cycling (step 5).** After the initial `REQUEST_WORKERS`, subsequent chunks use `CYCLE_WORKERS` instead — the engine shuts down the current pair and spawns a fresh one. See **Worker Cycling Pattern** for the full flow.

**Naming.** Workers are spawned from the duo pool (see `references/duo-pool.md`). The `name` parameter is the boss-selected character for this cycle (e.g., `name: "tintin"`, `subagent_type: "kiln:dial-a-coder"`). Hook enforcement fires on the agent type (subagent_type stripped of the `kiln:` prefix), not the spawn name. The engine injects the paired partner's spawn name and type into each worker's runtime prompt.

**`kiln:` prefix rule (Wave 4 C7).** Agents send **bare** subagent types in REQUEST_WORKERS payloads (e.g., `(subagent_type: the-anatomist)`, not `(subagent_type: kiln:the-anatomist)`). The engine adds the `kiln:` prefix when calling the `Agent(...)` tool and echoes the prefixed form back in `REQUEST_WORKERS_READY` and audit `WORKERS_SPAWNED`, so the boss sees exactly what was spawned. A bare-vs-prefixed regression is no longer possible — the engine owns normalisation on both the receive and echo sides, so bosses cannot accidentally send unprefixed types to an engine that expects prefixed ones.

## 4. Dispatch Pattern

When assigning work to a teammate:

1. **Scope first.** Define what to do and why, not how. The worker decides implementation approach — dictating mechanism produces worse output than scoping the goal.
2. **Package context.** Include relevant summaries from persistent minds, file paths, constraints. Making workers hunt for context across multiple files burns cycles and produces inconsistent interpretation.
3. **One message, one assignment.** Send the full assignment in a single SendMessage. Drip-feeding instructions across multiple messages violates the chunk-scope-is-immutable rule below and causes the worker to re-start mid-task.
4. **Stop after dispatch.** After sending, stop your turn immediately and wait for the reply. Continuing to work after dispatch races the reply and produces interleaved turn state.

```
SendMessage(
  type: "message",
  recipient: "{worker}",
  content: "ASSIGNMENT: {scope}\n\nContext:\n{packaged context}\n\nAcceptance criteria:\n{criteria}"
)
```

## 5. Peer Consultation

Communication permissions are phased by spawn stage.

**Before dispatch (Phase A/B):** only the boss sends messages. Persistent minds respond to the boss only. Workers do not exist yet.

**After dispatch (Phase C):** workers can consult persistent minds directly for technical questions. The boss does not need to relay.

Consultation pattern:
1. Send the question via SendMessage to the persistent mind.
2. Stop. Wait for the reply before continuing — polling races the reply.
3. Incorporate the answer and continue.
4. Use sparingly — each consultation costs a full turn, so batch related questions when you can.

```
SendMessage(
  type: "message",
  recipient: "{persistent_mind}",
  content: "QUESTION: {specific technical question with context}"
)
```

## 6. Shutdown Protocol

When a `shutdown_request` arrives, approve it immediately with this exact tool call:

```
SendMessage(type: "shutdown_response", request_id: "{request_id}", approve: true)
```

The `{request_id}` is extracted from the shutdown request message you received.

**Why this shape:**
- Approval is unconditional. Follow-up questions, "anything else?", or delay leave the engine waiting and stall the next cycle.
- Do not ask the requester if they are sure, do not summarize your work, do not offer to continue. The engine has already decided.
- After approving, you will be terminated — this is normal and expected.
- Ignoring or delaying a shutdown request forces the engine to kill you after 30s, which loses any graceful cleanup you could have done in-protocol.

## 7. Signal Vocabulary

Standard signals sent via SendMessage to team-lead (the engine), unless a different recipient is noted in the row.

| Signal | Meaning | Sent by |
|--------|---------|---------|
| `READY_BOOTSTRAP: {summary}` | Bootstrap complete, available for consultation (one-time at milestone start, recipient: team-lead) | Persistent minds |
| `READY: {summary}` | Post-iteration reply after ITERATION_UPDATE or MILESTONE_TRANSITION (recipient: krs-one) | Persistent minds |
| `REQUEST_WORKERS: {list}` | Need workers spawned on team (initial) | Boss |
| `CYCLE_WORKERS: scenario={s}, duo_id={id}, coder_name={name}, reviewer_name={name}, reason={r}, chunk={c}` | Shut down current workers, spawn fresh pair from duo pool | KRS-One |
| `WORKERS_SPAWNED: duo_id={id}, {builder_name} (subagent_type: {type}), {reviewer_name} (subagent_type: {type})` | Audit/log after `SubagentStart` readiness for both fresh workers | Engine |
| `WORKERS_REJECTED: {reason}` | Engine rejected REQUEST_WORKERS | Engine |
| `ONBOARDING_COMPLETE` | Step 1 done | Alpha |
| `BRAINSTORM_COMPLETE` | Step 2 done | Da Vinci |
| `RESEARCH_COMPLETE: {N} topics` | Step 3 done | MI6 |
| `ARCHITECTURE_COMPLETE: milestone_count={N}` | Step 4 done | Aristotle |
| `PLAN_BLOCKED` | Architecture validation failed 3x | Aristotle |
| `ITERATION_UPDATE: {summary}` | Chunk complete, update state files (blocking, 60s). Also the channel for QA failure findings on QA_FAIL / timeout (Wave 4 H1 replaces the pre-Wave-4 direct-to-rakim fire-and-forget channel). | KRS-One |
| `MILESTONE_DONE: milestone={N}, name={name}` | Per-milestone summary trigger — thoth writes `.kiln/docs/milestones/milestone-{N}.md` | KRS-One |
| `IMPLEMENTATION_APPROVED: {summary}` | Reviewer reports a successful chunk to the boss on APPROVED (Wave 3 — recipient: krs-one) | Reviewers (critical-thinker, the-curator) |
| `IMPLEMENTATION_BLOCKED: {blocker}` | Builder hit tooling/technical blocker (recipient: krs-one) | Builders |
| `IMPLEMENTATION_REJECTED: {issues}` | Builder exhausted 3 reject/fix cycles (recipient: krs-one) | Builders |
| `ARCHIVE: step={step}, [milestone={N},] [chunk={N},] file={filename}, source={path}` | File the named artifact under `.kiln/archive/` and log it to the guide scratchpad. Milestone+chunk targets canonical build evidence under `.kiln/archive/milestone-{N}/chunk-{M}/`. Fire-and-forget — thoth never replies to ARCHIVE. | krs-one, builders, reviewers |
| `MILESTONE_TRANSITION: completed={name}, next={name}` | Milestone boundary — PMs archive + reset (blocking) | KRS-One |
| `MILESTONE_QA_READY: {milestone_name}` | Deliverables verified, requesting independent QA | KRS-One |
| `REQUEST_WORKERS_READY: {workers}` | Active readiness signal after all REQUEST_WORKERS spawns receive `SubagentStart` acknowledgements | Engine |
| `QA_REPORT_READY` | Individual QA report written to .kiln/tmp/qa-report-{a\|b}.md; engine tracks per-sender (recipient: team-lead) | ken / ryu |
| `RECONCILIATION_COMPLETE` | Reconciliation written to .kiln/tmp/qa-reconciliation.md; engine spawns judge-dredd (recipient: team-lead) | denzel |
| `QA_PASS` | Final verdict: all criteria satisfied — direct to krs-one, no engine relay (Wave 2) | judge-dredd |
| `QA_FAIL: {findings}` | Final verdict: issues found — direct to krs-one, no engine relay (Wave 2) | judge-dredd |
| `DIVERGENCE_READY` | Divergence analysis written; peer signal to aristotle | diogenes |
| `MILESTONE_COMPLETE: {name}` | Milestone done, QA passed | KRS-One |
| `FINAL_ARCHIVE_CHECK: milestone_count={n}, chunk_count={n}` | Final blocking archive readiness check before BUILD_COMPLETE | KRS-One |
| `ARCHIVE_READY` | Final archive check passed | thoth |
| `ARCHIVE_BLOCKED: {missing}` | Final archive check failed; missing archives must be resolved before BUILD_COMPLETE | thoth |
| `BUILD_COMPLETE` | All milestones done after `ARCHIVE_READY` | KRS-One |
| `VALIDATE_PASS` | Validation succeeded | Argus |
| `VALIDATE_FAILED` | Validation failed, correction needed | Argus |
| `REPORT_COMPLETE` | Step 7 done | Omega |
| `BLOCKED: {reason}` | Cannot proceed, need intervention | Any agent |

Include context after the signal name. A bare signal name tells the receiver something happened but not what to do with it, which forces them back to scanning state files:
- Bad: `RESEARCH_COMPLETE`
- Good: `RESEARCH_COMPLETE: 6 topics researched. Key findings: RSC viable, Drizzle preferred over Prisma.`

## 8. Worker Cycling Pattern

### Why

Fresh context per implementation chunk prevents context pollution. Builders and reviewers accumulate irrelevant context from previous chunks, and that residue leads to confused implementations where earlier-chunk assumptions leak into later-chunk code. Cycling gives each chunk a clean-slate worker pair.

### How

1. KRS-One scopes a chunk and determines the appropriate scenario.
2. KRS-One sends `CYCLE_WORKERS` to team-lead (engine) with:
   - `scenario`: default | fallback | ui
   - `duo_id`: selected duo from pool (e.g., `tintin-milou`)
   - `coder_name`: builder's spawn name for this cycle (e.g., `tintin`)
   - `reviewer_name`: reviewer's spawn name for this cycle (e.g., `milou`)
   - `reason`: why this scenario was chosen
   - `chunk`: brief description of the work
3. Engine sends `shutdown_request` to the current builder+reviewer.
4. Engine waits for shutdown confirmation (60s timeout).
5. Engine spawns a fresh builder+reviewer pair per scenario:
   - default: dial-a-coder + critical-thinker (spawn names from duo pool)
   - fallback: backup-coder + critical-thinker (spawn names from duo pool)
   - ui: la-peintresse + the-curator (spawn names from duo pool)
6. Engine waits for `SubagentStart` hook acknowledgement for both workers, then may send `WORKERS_SPAWNED` to KRS-One as audit/logging.
7. KRS-One dispatches the assignment to the fresh builder. Assignment XML includes `assignment_id`, `milestone_id`, `chunk`, `head_sha`, `dirty_status`, `codebase_state_head_sha`, timestamp, and source artifact paths.

### Persistent Minds

rakim, sentinel, thoth persist across all worker cycles within a milestone. They accumulate knowledge and respond to `ITERATION_UPDATE` with `READY` after updating their state files.

### Blocking Seam

`ITERATION_UPDATE` from KRS-One to rakim+sentinel is blocking with a 60s timeout, ensuring state files are current before the next chunk is scoped. This is a different seam from the v9 fire-and-forget concern — v9 was worried about blocking between worker operations; this blocks between worker CYCLES, which is safe.

## Communication Rules (Universal)

These apply to every agent in every step:

1. **SendMessage is the only way to reach teammates.** Plain text output is invisible to other agents (though visible to the operator, who can view your session via shift+arrow). Anything a teammate needs to act on goes through SendMessage.
2. **Do not send messages before bootstrap is complete.** Read your files first — a message that references content you have not read is a guess, and downstream agents cannot distinguish that from a quote.
3. **After sending a message that expects a reply, stop your turn.** The platform wakes you when the reply arrives. Sleep-polling or continuing to work races the reply and burns tokens for no gain.
4. **Plain text for operator, SendMessage for agents.** Bosses in INTERACTIVE steps talk to the operator via plain text output. All agent-to-agent communication uses SendMessage exclusively, since plain text cannot reach another agent.
5. **One message at a time.** You wake up with one message. Process it fully before deciding your next action — partial handling is how protocol conversations desynchronise.
6. **Chunk scope is immutable after dispatch.** New information discovered mid-chunk is incorporated into the next chunk's assignment, never patched into the current one. The boss does not message an active worker mid-task, because a mid-task patch invalidates the acceptance criteria the worker is already executing against.

## Build Scenarios

| Scenario | Builder | Reviewer | When |
|----------|---------|----------|------|
| Default | `dial-a-coder` | `critical-thinker` | `codex_available=true` and structural work. |
| Fallback | `backup-coder` | `critical-thinker` | `codex_available=false` (structural fallback). |
| UI | `la-peintresse` | `the-curator` | Components, pages, layouts, design tokens. |

Workers are spawned with duo pool names (e.g., `name: "tintin"`, `subagent_type: "kiln:dial-a-coder"`). Hook enforcement fires on the agent type, not the spawn name.

critical-thinker (opus) is the single structural reviewer for Default and Fallback. the-curator (sonnet) reviews UI only.

**Dormant spawn names:** tetsuo, daft, punk — duo pool names only, no agent `.md` files.

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
- **Workers**: one builder+reviewer pair per chunk via CYCLE_WORKERS, duo pool names per cycle (default: dial-a-coder+critical-thinker, fallback: backup-coder+critical-thinker, ui: la-peintresse+the-curator)
- **QA**: ken/team-red (opus), ryu/team-blue (sonnet), denzel/the-negotiator (opus), judge-dredd/i-am-the-law (sonnet) — spawned on MILESTONE_QA_READY, Judge Dredd Tribunal, dynamic
- **Signals**: CYCLE_WORKERS, ITERATION_UPDATE (blocking 60s), MILESTONE_TRANSITION (blocking 60s), MILESTONE_QA_READY (blocking 300s, waits for direct QA_PASS / QA_FAIL from judge-dredd), FINAL_ARCHIVE_CHECK (blocking 60s on final milestone), MILESTONE_COMPLETE, BUILD_COMPLETE
- **Done**: BUILD_COMPLETE → stage: validate

### Step 6: Validate
- **Boss**: argus (sonnet)
- **PMs**: zoxea (sonnet, Phase A)
- **Workers**: hephaestus (sonnet, conditional — design QA)
- **Done**: VALIDATE_PASS → stage: report | VALIDATE_FAILED → correction cycle (max 3)

### Step 7: Report
- **Boss**: omega (opus, solo)
- **Done**: REPORT_COMPLETE → stage: complete
