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

This skill defines the wire protocol that every Kiln pipeline agent follows: signal vocabulary, blocking semantics, communication rules, shutdown handling, security scope, name-binding discipline, and thoth-logging. Its audience is team-agent bodies — each agent Reads this file on spawn as the second of three belt-and-suspenders layers (see Skill Loading at the bottom). The host session does not read this skill; it reads `kiln-pipeline/SKILL.md`.

Read the policy sections first — they are the rules each agent is responsible for honouring. The signal and hook tables below the policy serve as reference lookups.

## Policy

### Communication

- `SendMessage` is the only way to reach teammates. Plain text is visible to the operator but invisible to other agents, so anything you need a teammate to act on goes through `SendMessage`.
- After sending a message you expect a reply to, STOP your turn. Polling wastes tokens and can race the reply; the platform wakes you when the reply arrives.
  You cannot send AND continue in the same turn — these are mutually exclusive operations.

  Sending a message and continuing in the same turn races the platform's wake-up.
  The recipient reads disk-state via Read tool; any edit between dispatch and the recipient's read produces stale-read responses unrelated to your actual position.
  STOP immediately after sending; the platform wakes you when the reply arrives.
  This applies to every blocking SendMessage — not just REVIEW_REQUEST.
- Process one inbound message per wake-up fully before acting on the next. Partial handling of a message is how interleaved protocol conversations desynchronise.

### Blocking Policy

The rules below name each send-path in the pipeline and state whether it blocks. Blocking means "send, STOP, wait"; fire-and-forget means "send and continue on the same turn." Mixing these is the #1 source of pipeline deadlocks, which is why every path is named explicitly.

**Boss → PM (ITERATION_UPDATE): blocking, 60s timeout.** KRS-One sends ITERATION_UPDATE to rakim and sentinel between worker cycles and waits for READY back from each. Blocking is safe here because it happens between cycles, not mid-execution. The 60s timeout keeps a silent PM from deadlocking the build — if a PM does not respond within the window, KRS-One proceeds.

**Boss → PM (other): fire-and-forget.** All other boss→PM sends are send-and-continue. STOP-waiting for a PM reply outside the ITERATION_UPDATE seam is what causes the boss to hang on a signal the PM was never going to send.

**Boss → Engine (CYCLE_WORKERS): blocking.** KRS-One sends CYCLE_WORKERS to team-lead and waits. The unblock is the `SubagentStart` platform hook: it emits `additionalContext` for each spawned worker, deterministically, before the worker's first `PreToolUse`. `WORKERS_SPAWNED` is emitted by the engine in parallel as an operator-visible logging signal — it is not the unblock gate. Treating it as one re-introduces the race P1 was designed to remove.

**Engine → Boss (WORKERS_SPAWNED): operator-visible logging.** The engine emits WORKERS_SPAWNED carrying `duo_id` and the authoritative subagent_types when a fresh worker pair is spawned. As of P1 this is no longer the CYCLE_WORKERS unblock gate — that role moved to the SubagentStart hook additionalContext. By the time the message arrives, the boss has already been unblocked by the hook, so the boss proceeds to dispatch and treats the WORKERS_SPAWNED message as informational confirmation rather than a gate.

**[DEPRECATED — P1] Worker → Boss (WORKER_READY): fire-and-forget fallback.** Retired in SIMPLIFY-v1.4.0 P1. The `SubagentStart` hook now provides deterministic spawn ack before the subagent's first turn, which removes the need for a worker-emitted fallback. The WORKER_READY emissions were removed from builder and reviewer agent bodies. The deprecation anchor is preserved here so the retirement is discoverable via grep.

**Boss → PM (MILESTONE_TRANSITION): blocking.** KRS-One notifies persistent minds of a milestone boundary before signalling MILESTONE_COMPLETE to the engine. PMs acknowledge with READY and reset milestone-scoped state. Blocking here is what keeps the next milestone from starting against pre-transition PM context.

**Worker → PM: consult freely.** Workers are encouraged to message PMs mid-execution. Send the question, STOP, wait for reply, continue. PMs carry the codebase in working memory, so consulting them costs less than re-scanning files — this raises quality and saves tokens.

**Worker → Boss: blocking.** Post-review completion signals reach krs-one on these paths:
- `IMPLEMENTATION_APPROVED` (Reviewer → Boss) — the paired reviewer emits this on every APPROVED verdict, alongside the APPROVED message to the builder. This is the Wave 3 success path — the reviewer owns the handoff so a dropped builder cannot stall the build loop.
- `IMPLEMENTATION_BLOCKED` (Builder → Boss) — the builder hit a tooling or technical blocker before producing reviewable output.
- `IMPLEMENTATION_REJECTED` (Builder → Boss) — the builder exhausted 3 reject/fix cycles without an APPROVED verdict (Wave 3 terminal failure path).
Builders do not send any success signal to krs-one themselves; silence after commit on APPROVED is intentional and avoids duplicate handoffs.

**Worker → Worker: blocking.** `REVIEW_REQUEST`, `APPROVED`, `REJECTED` — builder↔reviewer exchanges. Builder sends REVIEW_REQUEST and STOPs until the verdict arrives; reviewing out-of-band breaks the paired-cycle contract.

**Terminal signals → engine: fire-and-forget.** Send and STOP. The engine processes on its next turn; waiting for a reply would deadlock against an engine that has already moved on.

### Shutdown

On a `shutdown_request` message, approve immediately:

```
SendMessage(type: "shutdown_response", request_id: "{request_id}", approve: true)
```

No follow-up, no summary, no delay. Approving terminates your process — this is the normal path. Delaying the response holds the whole team in teardown.

### Security

Do not read or write files matching: `.env`, `*.pem`, `*_rsa`, `*.key`, `credentials.json`, `secrets.*`, `.npmrc`.

This rule is universal across every pipeline agent regardless of role or step. Secrets in these files have no role in the build loop, and once read into context they can leak into downstream artifacts, logs, or messages — the prohibition is absolute because the exfiltration surface is the entire team.

Tool frontmatter and skill `allowed-tools` lists are capability declarations and routing hints, not a security boundary. Real restriction comes from Claude Code permission deny rules and Kiln's `PreToolUse` hooks. If host permissions are bypassed, deny rules and hooks must still protect secrets and destructive commands.

### Freshness Proofs

Any artifact that scopes, implements, reviews, or summarises build work must carry a measurable freshness proof:

- `assignment_id`
- `milestone_id`
- `chunk_id`
- `head_sha` or `current_head_sha_before` / `current_head_sha_after`
- `dirty_status` or an explicit `git status --short` summary
- source artifact paths used for scoping

KRS-One includes these fields in every assignment. Builders copy them into TDD evidence. Reviewers record their observed `HEAD` in verdicts and flag any unexpected movement between assignment and review. Persistent minds include `head_sha` in their owned state and report whether it matches current repo state on every consult or update.

### TDD Evidence Contract

TDD is evidenced by an artifact, not by a claim in chat. For every testable build chunk, the builder creates:

`.kiln/archive/milestone-<N>/chunk-<M>/tdd-evidence.md`

Builders stage the file in `.kiln/tmp/`, send it to thoth with `ARCHIVE`, and include the staged path plus archive target in `REVIEW_REQUEST`. The artifact schema is literal:

```
testable: yes|no
no_test_waiver_reason: {required when testable=no}
assignment_id: {id}
milestone_id: {id}
chunk_id: {id}
current_head_sha_before: {sha}
current_head_sha_after: {sha}
red_command: {command or N/A}
red_result_summary: {summary}
green_command: {command or N/A}
green_result_summary: {summary}
refactor_command: {command or N/A}
refactor_result_summary: {summary}
test_files_added_or_changed: {paths}
production_files_changed: {paths}
reviewer_reran_commands: {filled by reviewer or N/A before review}
reviewer_rerun_results: {filled by reviewer or N/A before review}
limitations: {known limits}
```

For `testable: yes`, RED/GREEN/REFACTOR commands and summaries must be non-empty. For `testable: no`, the waiver reason must be specific enough for a reviewer to challenge. A testable chunk without TDD evidence cannot receive a full approval.

### Review Verdict Contract

Reviewers must separate what the builder reported from what they independently verified. Every build review verdict archived as `review.md` or `fix-N-review.md` includes these fields:

```
verdict: APPROVED|REJECTED|PARTIAL_PASS_STATIC_ONLY|BLOCKED_BROWSER_VALIDATION_MISSING|FAIL_BROWSER_EVIDENCE_MISSING
assignment_id: {id}
milestone_id: {id}
chunk_id: {id}
observed_head_sha: {sha}
assignment_head_sha: {sha from assignment}
head_changed_unexpectedly: yes|no
test_requirements: {summary or none}
tdd_evidence_path: {path or N/A}
builder_reported_commands: {commands from REVIEW_REQUEST}
builder_reported_results: {results from REVIEW_REQUEST}
reviewer_reran_commands: ["{command rerun by reviewer}", "..."] or []
reviewer_rerun_results: {substantive rerun results, or "not independently rerun: ..." with limitation}
independent_verification_status: verified|partial|not_verified
lsp_diagnostics: {used/not available/not applicable + summary}
limitations: {what was not independently checked; required when reviewer_reran_commands is []}
```

An APPROVED verdict for testable work requires a readable TDD evidence artifact, `independent_verification_status: verified`, at least one command in `reviewer_reran_commands`, and substantive `reviewer_rerun_results`. A no-rerun limitation is visible to downstream QA and can only support a partial/degraded verdict unless a repo-approved explicit exception is recorded.

### Browser Validation Contract

Static UI review is not browser validation. When acceptance criteria require browser behavior, visual rendering, interaction, keyboard flow, layout, or accessibility behavior in a rendered app, a reviewer or validator must use Playwright/browser automation or mark the verdict honestly:

- `BLOCKED_BROWSER_VALIDATION_MISSING` — browser validation was required and no usable browser capability existed.
- `PARTIAL_PASS_STATIC_ONLY` — static checks passed, but browser-only criteria remain unverified.
- `FAIL_BROWSER_EVIDENCE_MISSING` — the chunk claimed browser acceptance without producing required browser evidence.

No agent may emit a clean full PASS/APPROVED for browser-scoped work based only on static review.

### Task DAG and State Hooks

Kiln uses native Claude Code task hooks where available:

- `TaskCreated` blocks malformed critical tasks that omit milestone/chunk/role metadata.
- `TaskCompleted` blocks completion of implementation/review/QA/build-complete tasks when visible metadata proves the workflow is premature.
- `FileChanged` surfaces invalid persistent-state files immediately; it cannot block writes, so `PostToolUse` also runs the validator for critical writes.

Hook input does not expose the full hidden task graph, so the task hooks enforce visible invariants and require missing links to be represented in task metadata (`review_task_id`, `verdict_path`, `qa_verdict_path`, `open_blocking_tasks`, `final_archive_check`).

### Status Marker Convention

Persistent minds write `<!-- status: complete -->` as the exact first line of their owned files immediately on spawn, as a minimal skeleton before full content is populated. The marker is what lets downstream agents detect "PM is ready" without racing against mid-write file reads.

Files and owners:
- `.kiln/docs/codebase-state.md` — owned by rakim
- `.kiln/docs/patterns.md` — owned by sentinel
- `.kiln/docs/architecture.md` — owned by numerobis

**Enforcement.** A SubagentStop hook (`stop-guard.sh`) prevents these agents from stopping before the marker is written. The hook is advisory — it warns and blocks the stop, but does not gate dispatch. The primary guarantee is the 3-wave spawn pattern: persistent minds bootstrap in Wave 1, the boss spawns in Wave 2, workers in Wave 3. By construction, PMs are ready before the boss can dispatch.

### Blocking Seam (Persistent Minds)

The persistent-mind seam is the synchronisation point between every build iteration. KRS-One's loop:

1. Send `ITERATION_UPDATE: {summary}` to rakim AND sentinel — describing what was just implemented.
2. STOP. Wait for `READY` from both (60s timeout each).
3. Only after both reply `READY` may the boss scope and dispatch the next chunk.

**Why this is blocking.** Persistent minds update their files (codebase-state.md, patterns.md) between worker cycles. Workers rely on those files for accurate context. Dispatching before PMs finish the update causes stale context, which is the root cause of implementation drift and missed deliverables.

**Timeout handling.** If a PM does not reply within 60s, log a warning to `.kiln/docs/iter-log.md` and proceed. Deadlocking the whole build on a silent PM is strictly worse than proceeding with slightly stale context.

### Name Binding

Name binding is the #1 cause of deadlocks observed in the pipeline, because a message sent to the wrong name is silently dropped — the sender waits forever for a reply that will never route.

- Use only the exact teammate names from your spawn prompt or the Teammate Names section in your agent definition.
- Never guess or abbreviate names. Abbreviating or guessing produces a routing miss, not a fuzzy match.
- When replying to a message, reply to the sender by their exact name.
- Never default to `team-lead` unless team-lead actually sent the message — doing so strands the real sender.
- `thoth` is a fixed name — always available for logging.
- Boss-selected duo names are authoritative. Use the exact `coder_name` and `reviewer_name` values from your own CYCLE_WORKERS payload — these are the canonical names. WORKERS_SPAWNED echoes them back as a logging signal (P1 — no longer the name-binding source).

### Thoth Logging

Every agent messages `thoth` at every significant event. Thoth is the pipeline's audit log — if it does not see an event, post-run diagnosis cannot reconstruct what happened, which is what makes these log calls load-bearing rather than cosmetic.

Format: `SendMessage(recipient: "thoth", content: "LOG: {EVENT_TYPE} | {detail}")`

Thoth is fire-and-forget — send and continue, do not STOP-wait. Waiting for a reply would serialise every log call and deadlock the team if thoth is busy.

Log at minimum:
- READY (WORKER_READY retired in P1 — SubagentStart hook replaces it)
- Every assignment received
- Every file written (CODEX_EXEC, FILE_WRITTEN)
- Every REVIEW_REQUEST, APPROVED, REJECTED
- Every IMPLEMENTATION_APPROVED (reviewer), IMPLEMENTATION_BLOCKED, IMPLEMENTATION_REJECTED, ESCALATION
- Every CONSULTATION sent/received
- Every ITERATION_UPDATE and READY
- Every QA signal (QA_PASS, QA_FAIL)
- Every DUO_SELECTED (boss only)

## Reference

### Signals

Send via `SendMessage(type: "message", recipient: "{target}", content: "SIGNAL: details")`. The recipient depends on the signal — most route to `team-lead` (the engine), but Wave 2 centralisation routes a few directly to the boss (`krs-one`) or to persistent minds. Check the **Recipient** column below before picking a target; guessing is what produces the C9 and C11 deadlocks this table exists to prevent.

Always include context after the signal. `RESEARCH_COMPLETE: 6 topics. Key: RSC viable, Drizzle preferred.` carries diagnosis-ready detail; bare `RESEARCH_COMPLETE` forces the recipient to go looking.

| Signal | Meaning | Recipient |
|--------|---------|-----------|
| `READY_BOOTSTRAP: {summary}` | PM bootstrap complete (rakim / sentinel / thoth one-time at milestone start) | team-lead (engine) |
| `READY: {summary}` | PM post-iteration reply (ITERATION_UPDATE or MILESTONE_TRANSITION) | krs-one (boss) |
| `REQUEST_WORKERS: {name} (subagent_type: {type}), ...` | Boss needs workers spawned | team-lead |
| `REQUEST_WORKERS_READY: {workers}` | Active readiness reply after all REQUEST_WORKERS spawns receive `SubagentStart` acknowledgements. Bosses wait on this, not WORKERS_SPAWNED. | boss (response) |
| `CYCLE_WORKERS: scenario={default\|fallback\|ui}, duo_id={duo_id}, coder_name={name}, reviewer_name={name}, reason={reason}, chunk={summary}` | Boss requests fresh worker pair (blocking — unblocks solely on the `SubagentStart` hook `additionalContext` injection; P1 — deterministic, fires ~90ms after the Agent tool call, ~30ms before the subagent's first `PreToolUse`). `WORKERS_SPAWNED` is emitted by the engine as an operator-visible logging signal, NOT an unblock path. | team-lead |
| `WORKERS_SPAWNED: {workers}` | Operator-visible logging signal emitted after spawn readiness — carries names and subagent_types for debug/tracing. It is never an active unblock gate. | boss (logging) |
| `WORKERS_REJECTED: {reason}` | Engine rejected REQUEST_WORKERS | boss (response) |
| `WORKER_READY: ready for assignment` | [DEPRECATED — P1] Worker self-announce on first wake — retired in P1; `SubagentStart` hook now provides deterministic spawn ack | krs-one (boss) [retired] |
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
| `FINAL_ARCHIVE_CHECK: milestone_count={N}, chunk_count={N}` | KRS-One asks thoth for a final blocking archive readiness check before BUILD_COMPLETE. | thoth |
| `ARCHIVE_READY` | Thoth's final archive readiness pass reply. | krs-one |
| `ARCHIVE_BLOCKED: {missing}` | Thoth's final archive readiness failure reply. Prevents BUILD_COMPLETE until corrected. | krs-one |
| `VALIDATE_PASS` / `VALIDATE_FAILED` | Step 6 result | team-lead (argus) |
| `REPORT_COMPLETE` | Step 7 done | team-lead (omega) |
| `BLOCKED: {reason}` | Cannot proceed | team-lead |

### Engine-internal hook mechanisms

These are not `SendMessage` signals. They are platform hooks the engine reads directly; agents do not emit them. They are documented here so agent authors do not accidentally reimplement a path the platform already covers.

| Mechanism | Meaning | Source |
|-----------|---------|--------|
| `SubagentStart` hook → `additionalContext` `[hook — engine internal]` | Platform hook fires ~90ms after Agent tool call returns, ~30ms before the subagent's first `PreToolUse`. Hook emits `{"additionalContext": "SubagentStart: agent_type={name} agent_id={id} — spawn acknowledged"}`. Engine reads `additionalContext` and advances CYCLE_WORKERS unblock. Replaces the retired WORKER_READY self-announce fallback as of P1. | `plugins/kiln/hooks/subagent-start-ack.sh` |
| `TeammateIdle` / `SubagentStart` / `SubagentStop` / `PreToolUse` / `PostToolUse` / `UserPromptSubmit` hooks → `activity.json` heartbeat `[hook — engine internal]` | `activity-update.sh` maintains `.kiln/tmp/activity.json` (7 fields: last_activity_ts, last_activity_source, active_teammates, epoch, last_nudge_ts, nudge_count, pipeline_phase). Written atomically on every relevant hook fire. `active_teammates` map: add on `SubagentStart`, remove on `SubagentStop` + `TeammateIdle`. `teammate-idle-feedback.sh` runs first on `TeammateIdle` and exits 2 with actionable stderr when the teammate is still marked active, giving the teammate direct intervention instead of waiting for a pending nudge. `nudge-inject.sh` (registered on `PreToolUse`/`UserPromptSubmit`) emits `.kiln/tmp/pending-nudge.json` content via `additionalContext` on the next hook fire after a nudge is staged, then deletes the pending file. `async-rewake-watchdog.sh` is the native asyncRewake bridge for cases where there may not be a next ordinary hook fire. | `plugins/kiln/hooks/activity-update.sh`, `teammate-idle-feedback.sh`, `nudge-inject.sh`, `async-rewake-watchdog.sh` |
| `SessionStart` / fresh `PostToolUse:Write/Edit` → watchdog spawn; `SessionEnd` → watchdog cleanup `[hook — engine internal]` | `spawn-watchdog.sh` (on `SessionStart`) detects `.kiln/DEADLOCK.flag` (if present: appends a [!NOTE] KILN DEADLOCK RECOVERY block to STATE.md, resets nudge_count/last_nudge_ts + bumps epoch in activity.json, removes flag), kills any stale watchdog PID, then spawns `watchdog-loop.sh` via `nohup + disown`. `ensure-watchdog.sh` runs after `Write`/`Edit` so fresh runs that create `.kiln/STATE.md` after SessionStart still get a watchdog. Loop polls every 60s: applies deadlock rule (active_teammates empty AND idle>300s AND since_nudge>600s AND phase not in {idle,awaiting_user,complete}); stages nudge in `.kiln/tmp/pending-nudge.json`; escalates to `.kiln/DEADLOCK.flag` after 3 nudges then exits. `async-rewake-watchdog.sh` is launched as an `asyncRewake` hook from the same SessionStart and fresh-STATE paths; it runs one background bridge per pipeline and exits 2 with the staged nudge to wake idle Claude Code sessions. `session-cleanup.sh` (on `SessionEnd`) kills the watchdog PID and removes `activity.json`, `watchdog.pid`, and async-rewake transient files. See `plugins/kiln/skills/kiln-pipeline/references/deadlock-detection.md` for the full contract. | `plugins/kiln/hooks/spawn-watchdog.sh`, `ensure-watchdog.sh`, `watchdog-loop.sh`, `deadlock-check.sh`, `async-rewake-watchdog.sh`, `session-cleanup.sh` |
| `StopFailure` hook → `pending-nudge.json` + optional `DEADLOCK.flag` `[hook — engine internal]` | Platform hook fires instead of `Stop` when the main-session turn ends due to an API error. Payload carries `error` (enum: `rate_limit`, `authentication_failed`, `billing_error`, `server_error`, `invalid_request`, `max_output_tokens`, `unknown`) and optional `error_details` / `last_assistant_message`. Hook never fires for subagents — `SubagentStop` has no error field. Fire-and-forget: exit code ignored. Handler routes by category: `rate_limit` → stages `pending-nudge.json` (does NOT bump `nudge_count` — separate from the P2 deadlock-escalation counter); `authentication_failed` / `billing_error` → stages nudge AND writes `.kiln/DEADLOCK.flag` directly (unrecoverable; reuses P2 SessionStart recovery pathway); `server_error` / `invalid_request` / `max_output_tokens` → stages nudge only (retryable class, engine decides on escalation); `unknown` / unexpected → stages nudge only (unclassified; no policy prescribed). | `plugins/kiln/hooks/stop-failure-handler.sh` |

**SubagentStop vs StopFailure.** `SubagentStop` fires on both clean finish AND error-terminated subagents — its payload has no `error` field, so Kiln cannot distinguish the two from `SubagentStop` alone. `StopFailure` fires only on main-session API-induced death (never for subagents). Together they cover the full agent-death surface: subagent death is observed via `SubagentStop` (clean finish assumed unless a higher-level signal indicates otherwise); main-session API death is observed via `StopFailure` with categorised error context.

### Worker Signals (peer-to-peer)

These signals go to teammates, not to team-lead. Routing them to team-lead is the most common misrouting error in pipeline traces.

| Signal | Meaning | Sender → Receiver |
|--------|---------|-------------------|
| `REVIEW_REQUEST: {summary}` | Builder requests review of implementation | Builder → Reviewer |
| `APPROVED: {summary}` | Reviewer approves implementation — paired with IMPLEMENTATION_APPROVED to krs-one | Reviewer → Builder |
| `ALREADY_APPROVED: assignment_id={X} chunk_id={Y}; verdict at .kiln/archive/milestone-{N}/chunk-{M}/review.md. No re-review needed.` | Reviewer received a duplicate REVIEW_REQUEST for an assignment_id already APPROVED in this session; verdict at the canonical archive path filed via thoth ARCHIVE on the original APPROVED. Reviewer also re-emits IMPLEMENTATION_APPROVED to krs-one (idempotent per Blocking Policy Rule 4). See critical-thinker.md / the-curator.md § APPROVED for the detection procedure. | Reviewer → Builder |
| `REJECTED: {issues}` | Reviewer rejects with specific issues (no boss signal; builder owns the reject/fix cycle) | Reviewer → Builder |
| `IMPLEMENTATION_APPROVED: {summary}` | Reviewer reports a successful chunk to the boss on APPROVED (Wave 3 — owns the success handoff so a dropped builder can't stall the build loop) (dual-channel: in-memory message primary, disk archive `.kiln/archive/milestone-{N}/chunk-{M}/review.md` filed via thoth ARCHIVE is the authoritative fallback when the message is missing/late — see bossman § Out-of-band wake recovery) | Reviewer → Boss |
| `IMPLEMENTATION_BLOCKED: {reason}` | Builder hit a tooling or technical blocker that kept them from producing reviewable output | Builder → Boss |
| `IMPLEMENTATION_REJECTED: {latest issues}` | Builder exhausted 3 reject/fix cycles without an APPROVED verdict (Wave 3 terminal failure path) | Builder → Boss |
| `ARCHIVE: step={step}, [milestone={N},] [chunk={N},] file={filename}, source={path}` | Archive a pipeline artifact — thoth files it under `.kiln/archive/` and logs to the guide scratchpad. When milestone+chunk are present, thoth writes the canonical build-evidence path `.kiln/archive/milestone-{N}/chunk-{M}/`. Fire-and-forget (thoth never replies). | Any agent → thoth |

## Skill Loading (Belt-and-Suspenders)

The platform silently drops the `skills:` frontmatter list for team agents, so a skill named there alone will not load inside a teammate. Three layers cover the gap — if any one fails, the others still load the protocol:

1. **Frontmatter** `skills: ["kiln-protocol"]` — works for standalone agents, harmless when dropped for teams.
2. **Explicit Read** `Read ${CLAUDE_PLUGIN_ROOT}/skills/kiln-protocol/SKILL.md` — the primary layer, emitted from the agent body.
3. **Spawn prompt** reference — backup, provided by the engine at spawn time.

Every agent definition keeps all three layers. The redundancy is the point: no single layer is trusted to load the protocol on its own.
