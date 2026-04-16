# Kiln v1.3.0 Plumbing Audit

**Status**: Audit only — no changes applied.
**Scope**: Logic / message-flow gaps surfaced after smoke tests on the kilndev → Kiln migration.
**Method**: Cross-read engine SKILL.md, kiln-protocol, all step blueprints, every agent body, and the 4 hook scripts. Compared against kilndev v0.3.1 SOP (the source of truth Kiln adopted from).
**Date**: 2026-04-16

> Findings are sorted by **severity**, then by category. Each finding cites file:line so a fix pass can target precisely. No code changes made.

---

## CRITICAL — broken plumbing (will deadlock or silently fail)

### C1. Judge Dredd file/signal mismatch — denzel writes one place, judge-dredd reads another

Three different file paths and two different signal names for the same artifact, depending on which doc you read:

| Source | denzel writes | denzel signals | judge-dredd reads |
|---|---|---|---|
| `agents/the-negotiator.md:36,53` | `.kiln/tmp/qa-reconciled-report.md` | `RECONCILIATION_READY` | — |
| `agents/i-am-the-law.md:24` | — | — | `.kiln/tmp/qa-reconciliation.md` |
| `skills/kiln-pipeline/SKILL.md:343,346,355` | `.kiln/tmp/qa-reconciliation.md` | `RECONCILIATION_COMPLETE` | `.kiln/tmp/qa-reconciliation.md` |
| `skills/kiln-pipeline/references/blueprints/step-5-build.md:79,200,207` | `.kiln/tmp/qa-synthesis.md` | `RECONCILIATION_COMPLETE` | `.kiln/tmp/qa-synthesis.md` |

**Effect**: As written, denzel writes `qa-reconciled-report.md` and signals `RECONCILIATION_READY`. The engine waits for `RECONCILIATION_COMPLETE`. judge-dredd then fails to find `qa-reconciliation.md` (or `qa-synthesis.md` per the blueprint). Tribunal collapses every milestone unless the engine's malformed-signal recovery catches the name drift — and even then, the file path mismatch will stick.

**Pick one** for path AND signal name and propagate. Recommended: `qa-reconciliation.md` + `RECONCILIATION_COMPLETE` (matches engine SKILL.md, the most authoritative file).

---

### C2. `audit-milestone.sh` agent-type filter never matches

`scripts/audit-milestone.sh:80-83` filters by `AGENT == "krs-one"`. But `AGENT` is sourced from `tool_input.agent_type` (the subagent_type, prefix-stripped), which is `bossman`, not the spawn name `krs-one`.

**Effect**: The MILESTONE_COMPLETE → iter-log.md verification check is dead. krs-one can falsely claim milestone completion with no ledger entry and the audit silently skips. All other Kiln hooks consistently use the agent_type — this is the only one that confused spawn name with agent type.

**Fix scope**: Change `krs-one` to `bossman` (one line).

---

### C3. ken / ryu spawn prompt missing `CHECKER_ID` and `RUN_NUMBER`

`agents/team-red.md:22-24` and `agents/team-blue.md:46-49` both expect three runtime variables (`CHECKER_ID`, `RUN_NUMBER`, proof location). The engine spawn prompt at `skills/kiln-pipeline/SKILL.md:308-326` and `step-5-build.md:177-193` provides none of them.

**Effect**: ken/ryu will either substitute literal `{CHECKER_ID}` strings into filenames (broken paths like `.kiln/tmp/qa-report-{CHECKER_ID}-r{RUN_NUMBER}.md`) or improvise. The engine's anonymization step (`SKILL.md:333`) is supposed to write `qa-report-a.md` and `qa-report-b.md` — but the engine has to reverse-engineer where ken/ryu actually wrote, parsed from the QA_REPORT_READY signal text. Brittle.

**Either**: pass deterministic vars in the spawn prompt, OR change ken/ryu to write to fixed paths the engine knows.

---

### C4. bossman terminal signaling on the final milestone is ambiguous

`agents/bossman.md:219`: "SendMessage to team-lead: `MILESTONE_COMPLETE` (or `BUILD_COMPLETE`)" — implies one OR the other.
`skills/kiln-pipeline/SKILL.md:284`: "wait for BUILD_COMPLETE from krs-one (sent **before** MILESTONE_COMPLETE in the final milestone)" — implies BOTH, in order.

**Effect**: If krs-one reads his own agent body and sends only `BUILD_COMPLETE`, the engine never observes the final `MILESTONE_COMPLETE`. The `milestones_complete` counter never matches `milestone_count` and the milestone-end persistent-mind reset never runs cleanly.

**Fix scope**: Pick one contract and align both files.

---

### C5. `MILESTONE_DONE` handler in thoth never fires

`agents/lore-keepah.md:107-127` defines a full `MILESTONE_DONE` handler that generates `.kiln/docs/milestones/milestone-{N}.md` — the per-milestone summary doc.

`agents/bossman.md:216` sends `MILESTONE_DONE` only to **rakim**, never to thoth.
`rakim` (`dropping-science.md`) has no handler for MILESTONE_DONE — it's vestigial in his protocol.

**Effect**: Per-milestone summary docs are never written. thoth's BUILD_COMPLETE README/CHANGELOG step (`lore-keepah.md:129-160`) tries to read these summaries; it falls back to the scratchpad but loses milestone-grain narration.

**Fix scope**: Either send MILESTONE_DONE to thoth (in addition to or instead of rakim), or remove the dead handler from thoth.

---

### C6. `REQUEST_WORKERS` has no engine handler outside step 5

Five bosses (`mnemosyne`, `mi6`, `aristotle`, `argus`, plus krs-one's first request) send `REQUEST_WORKERS` and **STOP, waiting for `WORKERS_SPAWNED`**. See:
- `the-discovery-begins.md:69`
- `alpha-team-deploy.md:67`
- `the-plan-maker.md:45,72,85,99` (4 separate waits)
- `release-the-giant.md:95`
- `bossman.md:103`

The engine's SKILL.md describes `WORKERS_SPAWNED` only for `CYCLE_WORKERS` (lines 188-194). Generic `REQUEST_WORKERS` handling is mentioned only as "validate in step 5" (line 157) with no spawn protocol or confirmation contract.

**Effect**: Engine LLM has to extrapolate that it must echo `WORKERS_SPAWNED` after every `REQUEST_WORKERS` spawn. If it doesn't, every non-step-5 boss deadlocks at its first worker request.

**Fix scope**: Add an explicit "REQUEST_WORKERS protocol" section in `SKILL.md` + a unified spawn confirmation contract.

---

### C7. `subagent_type` prefix inconsistency in REQUEST_WORKERS payloads

Two bosses send REQUEST_WORKERS without the `kiln:` prefix on subagent_type:
- `the-discovery-begins.md:65`: `subagent_type: the-anatomist`
- `alpha-team-deploy.md:60`: `subagent_type: unit-deployed`

Engine SKILL.md examples and bossman use `kiln:` prefix consistently (`SKILL.md:309-321`, `bossman.md` Scenario Roster).

**Effect**: Engine has to normalize. If it doesn't strip-or-add the prefix, the spawn fails with "agent type not found" because the actual template is `kiln:the-anatomist`.

**Fix scope**: Pick a normalization rule — either the engine always adds `kiln:` if missing, or all bosses always include it. Document in team-protocol.md.

---

## HIGH — wrong contract / spec drift (likely runtime confusion)

### H1. Vestigial / undefined signals still in agent bodies

| Signal | Sent by | Defined in protocol? | Receiver handles it? |
|---|---|---|---|
| `MILESTONE_DONE` | `bossman.md:216,233` (→ rakim) | No | No (only thoth has handler — see C5) |
| `QA_ISSUES` | `bossman.md:222,233` (→ rakim) | No | rakim handles (`dropping-science.md:163`) but signal not in vocab |
| `MILESTONE_TRANSITION` to thoth | `bossman.md:215` | kiln-protocol says "→ rakim+sentinel" only | thoth handles (`lore-keepah.md:90`), blueprint mentions thoth too — protocol/blueprint disagree |
| `ITERATION_COMPLETE` | flagged "legacy" everywhere but still on the books | Yes — but marked "internal/legacy" | Engine has handler (`SKILL.md:272`) "wait for next CYCLE_WORKERS" |

**Effect**: Three different agents could read kiln-protocol, find no entry for MILESTONE_DONE / QA_ISSUES, and reject the message via "malformed signal recovery." Or accept it inconsistently.

**Fix scope**: For each row, either (a) promote to first-class signal in `kiln-protocol/SKILL.md` § Signals + team-protocol.md vocab table, or (b) delete from agent bodies.

---

### H2. `RECONCILIATION_COMPLETE` vs `RECONCILIATION_READY` (related to C1)

denzel sends `RECONCILIATION_READY` (`the-negotiator.md:53`).
Engine waits for `RECONCILIATION_COMPLETE` (`SKILL.md:346`).
Blueprint and team-protocol use `RECONCILIATION_COMPLETE` (`step-5-build.md:79`, `team-protocol.md:173`).

**Effect**: Will require malformed-signal recovery on every milestone QA. Adds 1 round-trip per milestone.

---

### H3. Architecture step uses signal vocabulary not in `kiln-protocol`

The whole step 4 communication chain uses **internal** signals never published in `kiln-protocol/SKILL.md`:
`PLAN_READY`, `DIVERGENCE_READY`, `SYNTHESIS_COMPLETE`, `VALIDATION_PASS`, `VALIDATION_FAIL`, `DOCS_UPDATED`, `UPDATE_FROM_MASTER_PLAN`, `BLOCKED:` (peer-style).

Same for step 1: `DEEP_SCAN`, `SCOUT_REPORT`, `MAPPING_COMPLETE`.
Same for step 2: `VISION_UPDATE`, `SERIALIZE_AND_SHUTDOWN`, `SERIALIZATION_COMPLETE`.
Same for step 3: `MISSION_COMPLETE`, `REVISION_NEEDED`.
Same for step 6: `DESIGN_QA_COMPLETE`.

These ARE documented in each step's blueprint, and aristotle/mi6/etc. agents know the signals through their bodies. The issue is that **`kiln-protocol` claims to be "the" signal vocabulary** (`SKILL.md:11-37`) but it's only the cross-step subset. There is no central registry.

**Effect**: Per-step adapters are fine in practice, but the malformed-signal recovery in the engine (`SKILL.md:421`) can mistake step-local signals for "wrong" signals because they're not in the global table. Also makes onboarding a new contributor harder.

**Fix scope**: Either (a) merge step-local signals into `kiln-protocol`, marked by step, or (b) clarify in kiln-protocol that step-local signals exist and live in blueprints.

---

### H4. `PostToolUse` advisory hooks exit 0 — model never sees the warning

`audit-bash.sh`, `audit-status-marker.sh` write to stderr but exit 0. Per Claude Code v2.1.89 conventions, `PostToolUse` hook stderr is only surfaced to the agent on **non-zero exit**. Exit 0 = warnings invisible.

This is already noted in `TWEAKS.md` A-Items but not yet fixed.

**Effect**: All "AUDIT WARNING" messages are silent. The hooks fire but the agent never knows.

**Fix scope**: Change exit codes — exit 2 (the "blocking-but-still-allow" code) per TWEAKS A-item.

---

### H5. `audit-milestone.sh` injects `additionalContext` into the **sender**, not the engine

When krs-one sends `MILESTONE_COMPLETE`, the hook injects "SIGNAL RECEIVED: ... advance the pipeline state machine" — but the additionalContext goes back to **krs-one's** session, not the engine's. krs-one has no state machine to advance.

Same for the `REQUEST_WORKERS` and `CYCLE_WORKERS` injections (lines 36-52) — they tell the sender to spawn workers, but the sender is the boss who already cannot spawn.

**Effect**: The hook is essentially a no-op for routing. Whatever signal-priming it intended for the engine never arrives. Mostly harmless but burns a hook slot and is misleading docs-wise.

**Fix scope**: Either remove the misdirected injections, or replace with a different mechanism (e.g., the engine reads its inbox queue on every wake-up rather than relying on hook priming).

---

### H6. `argus` and `aristotle` write `STATE.md` themselves, racing the engine

- `release-the-giant.md:142`: argus does `sed -i 's/\*\*stage\*\*: .*/\*\*stage\*\*: report/' .kiln/STATE.md` before signaling VALIDATE_PASS.
- `the-plan-maker.md:143`: aristotle updates STATE.md `stage: build, milestone_count: N` before signaling ARCHITECTURE_COMPLETE.

Engine SKILL.md `§ 6` (line 256-295) explicitly says the engine writes STATE.md transitions on signal receipt.

**Effect**: kilndev's "engine is dumb relay, owns state" principle is broken — bosses pre-empt. Race conditions are subtle: engine reads STATE.md after signal, sees the boss-written stage, then writes it again. Probably benign today but breaks the contract.

**Fix scope**: Remove the boss-side STATE.md updates. The engine is the only writer.

---

### H7. Engine's worker-pair shutdown doesn't notify `thoth`

Engine SKILL.md `§ MILESTONE_QA_READY` step 9 (line 362): shuts down ken, ryu, denzel, judge-dredd. Engine SKILL.md MILESTONE_COMPLETE step 3 (line 277): shuts down "ALL agents (PMs, KRS-One, any remaining workers)."

But `MILESTONE_TRANSITION` is sent only to rakim+sentinel by bossman. thoth's MILESTONE_TRANSITION handler (`lore-keepah.md:90`) does the per-milestone archive sweep — without that handler firing, `.kiln/tmp/` isn't cleaned at milestone boundaries (only at `MILESTONE_DONE`, which never fires per C5).

(See also kiln-protocol vs blueprint disagreement noted in H1.)

**Fix scope**: Confirm whether thoth gets MILESTONE_TRANSITION (blueprint says yes, protocol says no) and align.

---

## MEDIUM — robustness / edge-case concerns

### M1. `bossman` claims engine validates agent types in `CYCLE_WORKERS`

`bossman.md:101`: "The engine validates agent types against the Scenario Roster."
But `CYCLE_WORKERS` payload doesn't carry agent types — only `scenario`. The engine maps scenario → types itself (`SKILL.md:171-178`). The validation is on `scenario` alone.

REQUEST_WORKERS DOES carry agent types and the engine validates those (`SKILL.md:157`). The instruction in bossman is for the wrong signal.

**Effect**: Mostly cosmetic — krs-one can't really request invalid types via CYCLE_WORKERS. But if his understanding ports to non-step-5 calls, confusion.

---

### M2. `WORKERS_SPAWNED` payload format inconsistencies

Three different formats in three docs:
- kiln-protocol: `WORKERS_SPAWNED: {builder_name}, {reviewer_name}` (bare names)
- team-protocol.md:161: `WORKERS_SPAWNED: duo_id={id}, {builder_name} (subagent_type: {type}), {reviewer_name} (subagent_type: {type})`
- engine SKILL.md:193: same as team-protocol but adds "Fresh context, awaiting assignment."
- step-5-build.md:69: same as team-protocol

**Effect**: bossman parses for `builder_name` and `reviewer_name` from the message (`bossman.md:103`). If engine sends bare names per kiln-protocol, parsing still works. If with `subagent_type`, also works. But the parsing logic in bossman isn't formalized — it relies on free-form text matching. Brittle.

**Fix scope**: Normalize on one format; commit it everywhere.

---

### M3. Worker `WORKER_READY` signal: kilndev pattern dropped silently

kilndev workers send `WORKER_READY: {role} available` to boss after spawn. Kiln workers (`dial-a-coder.md:41`, `critical-drinker.md:27`) explicitly do **not** announce — they wait silently for assignment.

This is intentional (engine confirms WORKERS_SPAWNED to boss already, so a second worker→boss handshake is redundant), but it diverges from kilndev SOP and removes a liveness signal. If a worker spawn appears to succeed but the worker is stuck, krs-one dispatches into a void and the only recovery is the engine's 5-min idle nudge.

**Effect**: Adds latency to detect dead workers. Not a deadlock — just slow.

**Fix scope**: Decision call — keep current behavior (faster happy path) or restore WORKER_READY (better failure detection). Worth documenting either way.

---

### M4. Stop-guard whitelist incomplete for non-build steps

`stop-guard.sh:67-73` whitelists ~16 signals. Missing:
- `QA_REPORT_READY`, `RECONCILIATION_READY/COMPLETE`, `QA_PASS`, `QA_FAIL` (Step 5 QA tribunal)
- `DESIGN_QA_COMPLETE` (Step 6)
- `PLAN_READY`, `DIVERGENCE_READY`, `SYNTHESIS_COMPLETE`, `VALIDATION_PASS`, `VALIDATION_FAIL`, `DOCS_UPDATED` (Step 4)
- `MAPPING_COMPLETE`, `SCOUT_REPORT` (Step 1)
- `MISSION_COMPLETE`, `REVISION_NEEDED` (Step 3)

Today these agents fall through to "allow stop" (no per-role check), so it works by accident. But if anyone adds a per-role check for these agents, the missing whitelist entries become deadlocks.

**Fix scope**: Add the missing signals to the whitelist for completeness.

---

### M5. `pitie-pas-les-crocos` blocked from stopping until architecture.md is `complete`

stop-guard.sh:98-104 requires `<!-- status: complete -->` on architecture.md line 1. Engine seeds the file with `<!-- status: writing -->` (`SKILL.md:114`).

If pitie-pas-les-crocos (numerobis) bootstraps but doesn't yet have full content, she might write `status: writing` as an intermediate state — and then can't stop. Per dropping-science's pattern (`dropping-science.md:35-45`: "go straight to complete with a skeleton"), numerobis should also write the skeleton-with-complete-status. Need to verify.

(Did not read pitie-pas-les-crocos.md — flagging as possible inconsistency.)

---

### M6. mnemosyne acts as sub-coordinator (sends REQUEST_WORKERS), violating "boss drives" SOP

`the-discovery-begins.md:60-66`: mnemosyne (a Phase A persistent mind) sends REQUEST_WORKERS to engine after alpha sends `DEEP_SCAN`.

kilndev SOP rule: "Boss drives everything. Persistent minds own knowledge only — never read the plan, never request workers." Kiln's onboarding step uses mnemosyne as a sub-coordinator for scouts.

**Effect**: Works in practice, but mnemosyne is doing two jobs (PM + sub-boss). The engine has to accept REQUEST_WORKERS from non-boss agents. A future engine refactor that tightens "only the boss can request workers" would break onboarding.

**Fix scope**: Either accept the divergence as a documented Kiln pattern, or refactor alpha to relay REQUEST_WORKERS for mnemosyne.

---

### M7. STATE.md `**build_iteration**: N` field — bossman sed pattern fragility

`bossman.md:55`: `sed -i "s/build_iteration: [0-9]*/build_iteration: ${ITER}/" .kiln/STATE.md`

The actual STATE.md line is `- **build_iteration**: 0`. The sed pattern matches the inner substring (works), but `[0-9]*` can match zero characters, leading to ambiguity if the file is malformed. Should be `[0-9]\+`.

Same pattern with `**stage**` in argus (`release-the-giant.md:142`) — matches but is fragile.

**Effect**: Minor. Edge cases on weird file states.

---

### M8. `denzel` agent body expects `REPORT_A`/`REPORT_B` as text in spawn prompt

`the-negotiator.md:20-21`: lists `REPORT_A — full text of anonymized Report A` and `REPORT_B — full text of anonymized Report B` as runtime variables.

But engine spawns denzel with **paths** to the files, not text (`SKILL.md:339-343`).

**Effect**: denzel reads the prompt, sees "REPORT_A — full text", and either expects text in the prompt (gets paths instead) or adapts and reads the files. Adaptive in practice but the contract is wrong.

**Fix scope**: Update denzel agent body to "REPORT_A_PATH" and "REPORT_B_PATH".

---

## LOW — cosmetic, vestigial, doc drift

### L1. Step numbering bug in aristotle

`the-plan-maker.md:141` Phase 7 starts at "19" — duplicates the numbering used in Phase 6 (line 141 onward says 19, 20, 21, 22, 23 but Phase 6 already used 21-24). Harmless reading, just sloppy.

### L2. `enforce-pipeline.sh` matchers include snake_case tool aliases

Lines 41, 162, 220, 259: `Bash|run_terminal_command`, `SendMessage|send_message`, `Write|write_to_file`. These snake_case names don't match any current Claude Code v2.1.89 tools. Already noted in script comments as "harmless future-proofing." Confirms but worth flagging.

### L3. ARCHIVE signal not in central protocol

`team-protocol.md:51` mentions "Any → thoth: ARCHIVE requests" as fire-and-forget. Not in the kiln-protocol vocabulary table or the team-protocol.md `§ 7 Signal Vocabulary` table. Used pervasively in agent bodies (see grep).

### L4. `the-foundation` SERIALIZE_AND_SHUTDOWN protocol is opaque

stop-guard.sh:108-119 has a special handler for `the-foundation` requiring SERIALIZATION_COMPLETE in last_assistant_message before stopping. Did not verify that `the-foundation.md` agent body actually emits this signal correctly. Likely fine (engine SKILL.md doesn't mention it directly, but step-2 blueprint references it).

### L5. `lore-keepah.md:21` Teammate Names section says "(receives ARCHIVE from krs-one, builders, and reviewers — never replies)"

But thoth also receives ARCHIVE from mi6, sun-tzu, plato, confucius, diogenes, judge-dredd, denzel per the various blueprints. The list is incomplete — minor.

### L6. `teammate names` in critical-drinker says only `{BUILDER_NAME}` for outbound, but reviewer also messages thoth/rakim/sentinel

`critical-drinker.md:19-23` lists 4 teammates. Consistent. Just noting that the omission of `team-lead` is correct (reviewer never messages engine directly).

---

## CRITICAL — confirmed by live smoke tests (operator notes)

### C8. Builder swallows IMPLEMENTATION_COMPLETE — krs-one never wakes

**Confirmed in two smoke runs (M2-C1, M2-C4)** — builder finishes, sends `REVIEW_REQUEST` to reviewer, gets `APPROVED`, then **stops without sending `IMPLEMENTATION_COMPLETE` to krs-one**. KRS-One sits idle indefinitely. Required external nudges to recover.

**Root cause** (operator analysis): The reviewer is the builder's immediate collaborator — once APPROVED arrives, the builder treats the chunk as "done" and stops. The follow-up message to a *different* recipient (krs-one) requires one more wake-up cycle that gets dropped.

`dial-a-coder.md:138`:
> 14. **APPROVED**: SendMessage to "krs-one": "IMPLEMENTATION_COMPLETE: ..." STOP.

The instruction exists. Problem is the model treats it as part of the same "round" as APPROVED handling and doesn't always emit it. Agents in the wild conflate "received APPROVED" with "krs-one already knows."

**Engine workaround insufficient**: stagnation rule (3 consecutive idle notifications) takes ~3-5 min to trigger. Per-milestone cost is high.

**Fix options** (all worth considering):
- (a) Stronger prompt anchoring in dial-a-coder/backup-coder/la-peintresse: explicit "This is the SINGLE action that unblocks krs-one. Without this message krs-one will deadlock and the milestone fails." Place at end of file as terminal reminder, not buried in handler.
- (b) Reviewer sends `IMPLEMENTATION_APPROVED` to **both** the builder and krs-one in parallel — krs-one learns from the reviewer rather than the builder. Reverses the chain and removes the dropped step.
- (c) Engine adds a per-chunk wait-set: after APPROVED is observed, expect IMPLEMENTATION_COMPLETE within 60s, else nudge the builder directly with "Send IMPLEMENTATION_COMPLETE: krs-one is waiting."

Operator suggested (a) + a "send to BOTH" pattern at REVIEW_REQUEST time, but that's premature (work isn't approved yet). Option (b) is cleaner — let the reviewer be the gate.

---

### C9. PM `READY` reply routed to team-lead instead of krs-one — 4-min deadlock

**Confirmed in resume scenario**: rakim replied to `ITERATION_UPDATE` with `READY` sent to `team-lead` instead of `krs-one`. Pipeline deadlocked ~4 min until operator caught it.

`dropping-science.md:143`:
> 7. SendMessage to krs-one: `READY: codebase-state updated. ...`

Instruction is correct in the body. But on resume, the persistent mind's bootstrap is to send READY to **team-lead** (line 47-52 of agent body), not krs-one. The two `READY` patterns get conflated:
- Bootstrap READY → team-lead (engine knows PM is alive)
- ITERATION_UPDATE READY → krs-one (boss knows PM has updated)

Same mistake possible in sentinel (`algalon-the-observer.md`).

**Fix scope**: Either (a) use distinct signal names — `READY_BOOTSTRAP` to team-lead, `READY_UPDATED` to krs-one — or (b) put a strong "REPLY TO THE SENDER" reminder in the ITERATION_UPDATE handler, since the sender is krs-one not team-lead.

This is a special case of name-binding (the "#1 cause of deadlocks" per kilndev SOP): the agent picks the wrong recipient because two near-identical patterns exist with different routing.

---

### C10. `build_iteration` field has two meanings — ambiguous accounting

`STATE.md` `build_iteration` is used for:
- **Team naming**: kill-streak index (first-blood=1 for M1, spark-of-life=2 for M2, signal-fire=3 for M3) — increments per milestone
- **Chunk counting**: `bossman.md:51-56` increments it on every CYCLE_WORKERS within a milestone

**Effect**: `build_iteration` after milestone 2 chunk 5 is "7" or "2" depending on which agent reads it. Operator confirmed the ambiguity is live: "i dont think iteration 1 was done in milestone 2 but they will tell you."

**Fix scope**: Decouple. Either rename to `team_iteration` (one per milestone, used only for team naming) and add a separate `chunk_count` for within-milestone chunks, or pick a clear semantics and update everyone.

Affects: bossman.md, blueprints, kill-streaks.md, thoth's archive paths (`iter-{N}-summary.md`), engine STATE.md tracking.

---

### C11. **CENTRALIZATION DIRECTIVE** — agents should signal krs-one, not team-lead

**Operator directive**: "centralize all communication to the boss not to the teamlead."

Current pattern (signals routed through engine):
- rakim/sentinel/thoth bootstrap READY → **team-lead**
- ken/ryu QA_REPORT_READY → **team-lead** (engine anonymizes, dispatches denzel)
- denzel RECONCILIATION_COMPLETE → **team-lead** (engine spawns judge-dredd)
- judge-dredd QA_PASS / QA_FAIL → **team-lead** (engine relays as QA_VERDICT to krs-one)

**Operator's preferred pattern**: Boss owns all milestone context. Agents send results directly to krs-one. Engine receives only boss-level commands (CYCLE_WORKERS, MILESTONE_QA_READY, MILESTONE_COMPLETE, BUILD_COMPLETE) and emits responses (WORKERS_SPAWNED, QA_VERDICT).

**Rationale**: Two-hop routing adds latency, loses context at each hop, and makes the engine a dumb relay (which it should be). Boss has full milestone state and can react directly to PM/QA results.

**Effect today**: Multiple plumbing bugs in this audit are symptoms of the engine doing too much routing — engine has to anonymize, sequence, relay verdicts, all in free-form prompt logic. Brittle.

**Affected files** (refactor scope):
- `step-5-build.md` signal vocabulary + communication model diagrams
- `dropping-science.md` (rakim), `algalon-the-observer.md` (sentinel) — bootstrap READY target
- `team-red.md` (ken), `team-blue.md` (ryu) — QA_REPORT_READY target
- `the-negotiator.md` (denzel) — RECONCILIATION_COMPLETE target
- `i-am-the-law.md` (judge-dredd) — QA_PASS / QA_FAIL target
- `kiln-pipeline/SKILL.md` — MILESTONE_QA_READY protocol (engine becomes a spawner only; krs-one waits for QA_VERDICT from judge-dredd directly)
- `kiln-protocol/SKILL.md` § Signals — recipient column updated

**Engine becomes**:
- Receives: CYCLE_WORKERS, REQUEST_WORKERS, MILESTONE_QA_READY, MILESTONE_COMPLETE, BUILD_COMPLETE, terminal step signals (ONBOARDING_COMPLETE, etc.)
- Sends: WORKERS_SPAWNED, banners, shutdown_request

This is a **substantial refactor** but aligns with kilndev's "engine is dumb relay" principle (which the audit's O1 noted Kiln had drifted from).

---

### C12. WORKERS_SPAWNED slack — engine forgets, workers self-announce instead

**Confirmed live**: engine sometimes skips WORKERS_SPAWNED after CYCLE_WORKERS. Workers self-announce on their first wake ("[to krs-one] tintin ready, awaiting XML assignment"). Boss unblocks via the side channel; no deadlock surfaces.

**The bug is the mixed state**: spec says blocking handshake, runtime allows two paths, neither is rigorous.

**Fix options**:
- (a) Make WORKERS_SPAWNED truly mandatory — engine TaskList item that fails loudly if skipped — and stop workers self-announcing.
- (b) Formally demote WORKERS_SPAWNED to optional and make worker self-announce the canonical signal (kilndev's WORKER_READY pattern, see M3).

Both are valid. (b) is closer to kilndev SOP. (a) keeps the engine-as-coordinator pattern.

---

## BLOAT — vestigial code, dead paths, doc drift

The shipped plugin is 821K total — clean overall (34 agents all referenced, dev artifacts properly gitignored, KILNDEV-MIGRATION.md doesn't ship). But ~250 lines of dead code/docs are still riding along. Worth sweeping.

### B1. ~~`references/design/design-qa.md` (112 lines, 0 refs)~~ → REWIRE, not delete

**Originally flagged as orphan** — no references, mentions deleted `sphinx` agent role as if active. But operator confirmed this is the right home for **UI design QA** content; needs to be wired to `obscur` (spawn name for `the-curator`, the UI reviewer).

**Required edits**:
1. Update `design-qa.md` content: remove `sphinx` references (deleted v0.99). Reframe automated checks under `the-curator` (build-time UI review) and manual review under `hephaestus` (validation-time, per `style-maker`).
2. Add `Read ${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/design/design-qa.md` instruction in `agents/the-curator.md` body — with a one-line description of what it contains and when to apply checks.
3. Mention the path in the engine's UI-reviewer spawn prompt (belt-and-suspenders, per kilndev SOP).

This **upgrades UI review quality** by giving obscur a real rubric instead of relying on the file being silently present.

### B2. `ITERATION_COMPLETE` — vestigial signal in 4 places

Marked "legacy/internal — replaced by CYCLE_WORKERS" but still present in:
- `kiln-protocol/SKILL.md:29` (signal table)
- `references/team-protocol.md:51,169` (two mentions, vocab + flow)
- `kiln-pipeline/SKILL.md:272` (engine handler with comment "wait for next CYCLE_WORKERS to determine the scenario" — dead code path, krs-one never sends this signal)

Nothing emits it. The engine handler is dead.

**Fix**: full removal across all 4 files. If you want a deprecation grace period, replace the engine handler with a one-line warning + redirect, but krs-one's body has no path that emits ITERATION_COMPLETE — purely safe to delete.

### B3. Hook tombstones in `enforce-pipeline.sh` (4 lines)

```
# (Hook 2 was plato Write/Edit — removed v1.0.4: ...)
# (Hooks 3,4 — sequencing gates — removed v1.3.0: redundant with agent instructions)
# (Hook 13 was memory isolation — removed v1.0: ...)
```

Plus the `Sequencing (3,4): (removed v1.3.0)` line in the file header.

Useful as historical context but bloats the live file. **Move to a CHANGELOG section** at the bottom of the script (so a reader can find it in one place) or to git history via commit messages.

### B4. Snake_case tool aliases never matched

Across 4 hook scripts, matchers include snake_case aliases that don't exist in Claude Code v2.1.89:
- `Bash|run_terminal_command` (audit-bash.sh, enforce-pipeline.sh)
- `SendMessage|send_message` (audit-milestone.sh, enforce-pipeline.sh)
- `Write|write_to_file` (audit-status-marker.sh)
- `WebFetch|web_fetch` (enforce-pipeline.sh)

Comments label these "harmless future-proofing" but it's been multiple Claude Code versions with no aliases ever appearing. **Strip the snake_case alternatives**; keep only PascalCase. If aliases ever land, add them in a focused PR.

### B5. `check-cache.sh` — 92 lines, TWEAKS Track D pending

TWEAKS.md (2026-03-29 audit) flagged this as "PENDING simplify" — Track D was never executed. The script does git lock + fetch + remote ref discovery + version comparison; could be ~30 lines with a simpler "fetch quietly, compare versions" approach. The lock mechanism alone is ~25 lines.

**Fix scope**: refactor following the original Track D plan in `reference_plugin_structure_audit.md`.

### B6. `release.sh` — v9→master mirror still pending (TWEAKS Track B)

Per TWEAKS.md and memory, Track B (remove v9→master mirror from release.sh) is also pending. Not "bloat" in the audit-doc sense but a related cleanup that lives in the same backlog.

---

## RENAME — `critical-drinker` → `critical-thinker`

**Operator request**: rename the structural reviewer agent. Touches every layer.

### Scope (estimated based on previous audit pattern)

- `agents/critical-drinker.md` → `agents/critical-thinker.md` (file rename)
- All bossman / dial-a-coder / backup-coder runtime prompts referencing the reviewer type
- `references/duo-pool.md` (pool table — Builder/Reviewer Type column for default + fallback rows)
- `references/team-protocol.md` (signal vocabulary, build scenarios table, step definitions)
- `references/blueprints/step-5-build.md` (agent roster, canonical pairs, runtime prompt templates, communication model)
- `kiln-pipeline/SKILL.md` (CYCLE_WORKERS scenario table, validation table)
- `kiln-protocol/SKILL.md` if mentioned anywhere
- `scripts/enforce-pipeline.sh` (Hook 9 spawn whitelist + Hook 5 agent_type case statements — both copies)
- `scripts/audit-bash.sh` (agent whitelist)
- `scripts/audit-status-marker.sh` (none — only checks PMs)
- `hooks/stop-guard.sh` (agent whitelist)
- `hooks.json` (no — uses tool names not agent names)
- `README.md` if mentioned (probably not — README is user-facing)

This is a **mechanical rename** but spans ~15 files. Best done as one atomic commit so no partial state ships.

### Approach

1. **Rename the .md file** (`critical-drinker.md` → `critical-thinker.md`)
2. **Bulk find-and-replace** `critical-drinker` → `critical-thinker` across all the above files. No semantic changes.
3. **Search for stale references** post-rename: `grep -rn "critical-drinker" plugins/` should return zero hits.
4. **Smoke test the next milestone** to confirm no broken spawns / hook denials.

Risk: if any agent prompt has hardcoded "critical-drinker" outside the rename targets, runtime spawn will fail with "agent type not found." The whitelist hooks (Hook 9, stop-guard.sh) would deny spawns of `critical-thinker` until updated. **All four whitelists must update in the same commit as the file rename.**

---

## ATTACK STRATEGY — global plan to fix everything cleanly

12 critical + 7 high + 8 medium + 6 low + 6 bloat + 1 rename = ~40 items. They cluster into **5 coordinated waves**. Each wave is a coherent commit (or small commit series) — small enough to review, big enough to leave the system in a coherent state.

### Two-track rule — plugin + harness in the same commit

Every wave has **two tracks** that MUST ship together in the same commit:

1. **Plugin edits** — the actual fix under `plugins/kiln/`.
2. **Test harness updates** — linters and scenarios under `tests/` that encode the new contract.

Rationale: the harness (`tests/run-all.sh`) is a **living spec**, not a frozen snapshot. When we change what "correct" means, we change what the linters/scenarios check for. Shipping only the plugin leaves the harness lying; shipping only the tests leaves the plugin lying. Atomic commits keep both sides honest.

**Workflow per wave**:

```
1. Write plugin changes.
2. Run `bash tests/run-all.sh` — see what fails.
3. For each failure, decide:
   - Does the test catch a real bug in my plugin change? → fix plugin.
   - Does the test encode an OLD contract that this wave overrides? → update the test to the new contract.
4. Optionally add NEW tests that lock in the wave's invariants going forward.
5. Re-run harness. Green on intended items, still-red on audit items deferred to later waves.
6. Commit plugin + test changes together with one message.
```

Two-track checklist (use per wave):

- [ ] `tests/layer1-static/lint/*.py` — any invariant rules that changed meaning?
- [ ] `tests/layer1-static/hook-fixtures/` — any `.json` / `.expected` that still reflect old behavior?
- [ ] `tests/layer2-replay/mock_engine.py` — any handler that encoded the old contract? Any new signal to route?
- [ ] `tests/layer2-replay/scenarios/*.yaml` — any assertion or event sequence that must change?
- [ ] New scenario added to lock in the wave's deliverable?
- [ ] Acceptance: the target audit findings disappear from linter output, previously-intentional-fail hook fixtures now pass.

### Wave 0 — Surgical bug fixes (1-2 hours, no behavior change risk)

Independent one-line / one-file fixes that unblock smoke tests immediately.

**Plugin edits:**

| Item | File | Edit |
|---|---|---|
| C2 | `audit-milestone.sh:80-83` | `krs-one` → `bossman` |
| H4 | `audit-bash.sh`, `audit-status-marker.sh` | `exit 0` → `exit 2` on stderr warning paths |
| H6 | `release-the-giant.md:142`, `the-plan-maker.md:143` | Remove the `sed` calls + "Update STATE.md" prose that update STATE.md from the boss side |
| L1 | `the-plan-maker.md:141` | Renumber Phase 7 steps |
| L2/B4 | 4 scripts | Strip snake_case tool aliases |
| B3 | `enforce-pipeline.sh` | Move tombstones to a CHANGELOG section at bottom of script |

**Test harness updates:**

| File | Change | Why |
|---|---|---|
| `tests/layer1-static/hook-fixtures/audit-milestone/bossman-no-ledger.expected` | no change | Was intentional-fail; becomes natural pass after C2 fix |
| `tests/layer1-static/hook-fixtures/audit-milestone/bossman-no-pass.expected` | no change | Same (C2) |
| `tests/layer1-static/hook-fixtures/audit-status-marker/rakim-*.expected` | no change | Was intentional-fail; becomes natural pass after H4 fix (exit 2) |
| `tests/layer1-static/hook-fixtures/audit-bash/dial-a-coder-source-write.expected` | no change | Same (H4) |
| `tests/layer1-static/lint/consistency.py::check_boss_state_md_writes` | no change | Becomes green automatically when argus/aristotle no longer edit STATE.md |
| `tests/layer1-static/lint/orphans.py::check_tombstones` | no change | Becomes green automatically when tombstones move to CHANGELOG |
| `tests/layer1-static/lint/orphans.py::check_snake_case_aliases` | no change | Becomes green automatically |

**Post-wave verification:**

```bash
bash tests/run-all.sh
```

Expected output changes from v1.3.0 baseline:
- `BOSS_WRITES_STATE` ×2 → 0
- `TOMBSTONE` → 0
- `SNAKE_CASE_ALIAS` ×3 → 0
- 5 previously-intentional-fail hook fixtures now PASS (C2 + H4 series)
- Still red: C1, C3, C4, B1, B2, `DELETED_ROLE_RESIDUE`, `MISSING_RUNTIME_VAR` — deferred to later waves

### Wave 1 — QA tribunal alignment (~2 hours, high-leverage)

Fix the QA tribunal end-to-end. Single coordinated commit.

**Plugin edits:**

1. **C1 + H2**: pick **`qa-reconciliation.md`** as the path and **`RECONCILIATION_COMPLETE`** as the signal (matches engine SKILL.md, the most authoritative source). Update:
   - `agents/the-negotiator.md` (path + signal name + heredoc EOL marker)
   - `agents/i-am-the-law.md` (already correct)
   - `references/blueprints/step-5-build.md` (signal table + communication model + runtime prompt template)
   - `references/team-protocol.md` (vocab table)
   - `kiln-pipeline/SKILL.md` (already correct)
2. **C3 + M8**: ken/ryu spawn prompts. Either:
   - (a) Pass `CHECKER_ID=red`, `RUN_NUMBER={milestone_iter}`, plus matching `REPORT_A_PATH`/`REPORT_B_PATH` to denzel — preserves current architecture, OR
   - (b) Move ken/ryu to fixed paths (`.kiln/tmp/qa-report-red.md`, `.kiln/tmp/qa-report-blue.md`) — engine doesn't need to parse paths from QA_REPORT_READY messages.
   - Pick (b) — simpler, deterministic.

**Test harness updates:**

| File | Change | Why |
|---|---|---|
| `tests/layer1-static/lint/consistency.py::check_path_symmetry` | no change | Becomes green automatically when all files converge on `qa-reconciliation.md` |
| `tests/layer1-static/lint/consistency.py::check_runtime_vars` | no change | Becomes green when ken/ryu/denzel drop the runtime-var declarations (option b) OR engine spawn prompt provides them (option a) |
| `tests/layer2-replay/scenarios/qa-tribunal-pass.yaml` | no change | Already asserts the correct path `qa-reconciliation.md` — stays green |
| `tests/layer2-replay/scenarios/qa-tribunal-fail.yaml` | no change | Same |
| **NEW** `tests/layer2-replay/scenarios/qa-tribunal-naming-regression.yaml` | create | Assert that a `RECONCILIATION_READY` event (wrong name) triggers malformed-signal-recovery warn — locks in the unified naming |

**Post-wave verification:**

```bash
bash tests/run-all.sh
```

Expected:
- `PATH_SYMMETRY` ×2 → 0
- `MISSING_RUNTIME_VAR` ×3 → 0
- All Layer 2 QA scenarios still pass
- New regression scenario catches any future reintroduction of old name

### Wave 2 — Centralization (CENTRALIZATION DIRECTIVE — C11 + family)

The architectural shift. Roughly half a day. Do this as **one commit** with a clear message — multiple commits leave the system in a half-routed state where some agents talk to engine, others to boss.

**Plugin edits** — agents send results directly to krs-one; engine becomes pure spawner + boss-command relay.

| Phase | Edits |
|---|---|
| Boss inbox | `bossman.md`: add handlers for the new direct messages — `READY` from PMs (already), `QA_REPORT_READY` from ken/ryu, `RECONCILIATION_COMPLETE` from denzel, `QA_PASS`/`QA_FAIL` from judge-dredd. krs-one collects them, runs the QA tribunal sequence himself instead of waiting for engine to relay QA_VERDICT |
| PM bootstrap routing | `dropping-science.md`, `algalon-the-observer.md`: add C9 fix — bootstrap `READY_BOOTSTRAP` to team-lead; subsequent `READY` (after ITERATION_UPDATE/MILESTONE_TRANSITION) to krs-one. Distinct signal names prevent the rakim-deadlock pattern |
| QA recipients | `team-red.md`, `team-blue.md`, `the-negotiator.md`, `i-am-the-law.md`: change `team-lead` → `krs-one` in all signal targets. Update Teammate Names sections accordingly |
| Engine simplification | `kiln-pipeline/SKILL.md` § MILESTONE_QA_READY: engine spawns ken/ryu/denzel/judge-dredd on krs-one's request, anonymizes between checkers and reconciler (still engine's job — that's the point of cross-model independence), then krs-one waits for QA_PASS/QA_FAIL directly. Engine no longer emits QA_VERDICT |
| Protocol vocab | `kiln-protocol/SKILL.md` + `references/team-protocol.md`: update recipient column on every signal moved to krs-one. Remove QA_VERDICT signal. Document the new "engine talks only to bosses" rule explicitly |
| Communication diagrams | `step-5-build.md`: redraw Phase D communication model |

**Test harness updates** — this is where the harness earns its cost. `mock_engine.py` already has `post-centralization` mode stubs; flip them on and refine.

| File | Change | Why |
|---|---|---|
| `tests/layer2-replay/mock_engine.py` | Flip default `engine_version` to `post-centralization` for NEW scenarios; leave `pre-centralization` accessible for regression | Both contracts live side-by-side; new scenarios target the new world |
| `tests/layer2-replay/mock_engine.py::_on_ready` | Post-centralization branch: no warn, always accept direct-to-krs-one | The "two READY patterns" bug (C9) goes away when there's only one recipient |
| `tests/layer2-replay/mock_engine.py::_on_qa_verdict` | Post-centralization: no `QA_VERDICT` send; engine only shuts down QA agents | Engine no longer relays |
| `tests/layer2-replay/mock_engine.py::_on_qa_report_ready`, `_on_reconciliation_complete` | Post-centralization: no spawn of next tribunal agent (krs-one drives it); engine role = anonymize only | Centralization moves orchestration to boss |
| `tests/layer2-replay/scenarios/qa-tribunal-pass.yaml` | bump `engine-version: post-centralization`, remove the `QA_VERDICT` assertion, add assertion that judge-dredd's verdict flows to krs-one directly | Contract change |
| `tests/layer2-replay/scenarios/qa-tribunal-fail.yaml` | same | same |
| `tests/layer2-replay/scenarios/pm-ready-wrong-recipient.yaml` | Either delete OR keep under `pre-centralization` as a regression lock for the old contract | After centralization, misrouted READY no longer has a "correct" bootstrap target to compare to |
| **NEW** `tests/layer2-replay/scenarios/centralized-qa-tribunal.yaml` | create — full flow with all QA signals direct to krs-one | Locks in the new contract |
| **NEW** `tests/layer1-static/lint/consistency.py::check_centralized_recipients` | add invariant: PM and QA agents must NOT signal `team-lead` except for bootstrap | Prevents regression toward old two-hop routing |

**Resolves**: C11, C9, partially C3 (if QA goes direct, the file path mess matters less), partially C12 (clearer who owns spawn confirmation).

**Post-wave verification:**

```bash
bash tests/run-all.sh
```

Expected:
- New invariant `check_centralized_recipients` green
- `qa-tribunal-pass` / `qa-tribunal-fail` green under post-centralization
- New `centralized-qa-tribunal` scenario green
- Full kilndev smoke run to confirm LLM behavior follows the new contract

**Cross-contract validation** (the harness's killer feature):

```bash
python3 tests/layer2-replay/replay.py --scenario scenarios/centralized-qa-tribunal.yaml
# Edit the scenario to set engine-version: pre-centralization
# Re-run — should FAIL, proving the two contracts are materially different
```

If scenarios pass identically under both versions, you haven't actually changed the routing model.

### Wave 3 — Build loop hardening (C8 + C12 + C10)

Fix the smoke-test friction in worker cycling.

**Plugin edits:**

1. **C8 (IMPLEMENTATION_COMPLETE drop)**: change reviewer pattern. On APPROVED, reviewer sends `APPROVED` to builder AND `IMPLEMENTATION_APPROVED: {summary}` to krs-one. krs-one no longer waits on the builder for the final signal. Update:
   - `critical-thinker.md` (the renamed reviewer)
   - `the-curator.md` (UI reviewer)
   - `dial-a-coder.md`, `backup-coder.md`, `la-peintresse.md`: simplify — on APPROVED, just commit and STOP. The reviewer signals krs-one.
   - `bossman.md`: rewire to expect `IMPLEMENTATION_APPROVED` from reviewer (or `IMPLEMENTATION_REJECTED` after 3 cycles).
   - `kiln-protocol/SKILL.md` Worker Signals table: add `IMPLEMENTATION_APPROVED` reviewer→boss.

2. **C12 (WORKERS_SPAWNED slack)**: pick the canonical path. Recommended: keep WORKERS_SPAWNED mandatory but **also** have workers send a brief `WORKER_READY: ready for assignment` to krs-one on first wake (kilndev SOP pattern). Belt-and-suspenders — engine + worker both confirm. Document explicitly that either signal unblocks krs-one.

3. **C10 (build_iteration ambiguity)**: rename. `build_iteration` → `team_iteration` (one per milestone, used for kill-streak naming + team naming). Add new `chunk_count` field for within-milestone CYCLE_WORKERS counter. Update bossman, blueprints, kill-streaks.md, thoth's archive paths (`iter-{N}-summary.md` → `chunk-{N}-summary.md`).

**Test harness updates:**

| File | Change | Why |
|---|---|---|
| `tests/layer2-replay/mock_engine.py::_dispatch_table` | Already routes `IMPLEMENTATION_APPROVED`; confirm handler is correct for post-centralization | New signal becomes first-class |
| `tests/layer2-replay/scenarios/implementation-complete-drop.yaml` | Rename to `reviewer-approves-to-boss.yaml`; assert full chain: REVIEW_REQUEST → APPROVED → IMPLEMENTATION_APPROVED(→ krs-one) | Lock in the new C8 flow |
| **NEW** `tests/layer2-replay/scenarios/worker-ready-belt-suspenders.yaml` | create — assert both `WORKERS_SPAWNED` and `WORKER_READY` can independently unblock krs-one | C12 validation |
| `tests/layer1-static/lint/_common.py::FIXED_NAMES` | no change | |
| `tests/layer1-static/lint/agents.py` | Add `IMPLEMENTATION_APPROVED` to the reviewers' expected signal table if we add an invariant | Optional — confirms reviewers have the new signal |
| **NEW** `tests/layer1-static/lint/consistency.py::check_iteration_field_rename` | add invariant: no agent body references `build_iteration`; must use `team_iteration` or `chunk_count` | C10 regression guard |
| `tests/layer1-static/hook-fixtures/` | Audit any fixture that referenced `build_iteration` in mock state — update to `team_iteration` | Mock pipeline must match new STATE.md schema |

**Post-wave verification:**

```bash
bash tests/run-all.sh
```

Expected:
- `check_iteration_field_rename` green
- `reviewer-approves-to-boss` scenario green under post-centralization
- `worker-ready-belt-suspenders` green
- No `build_iteration` references anywhere

### Wave 4 — Renaming + cleanup (mechanical, low-risk)

**Plugin edits:**

1. **RENAME `critical-drinker` → `critical-thinker`** (see RENAME section above) — atomic commit across ~15 files.
2. **B1 design-qa.md REWIRE**: rewrite content (remove sphinx, target the-curator/hephaestus), add Read instruction in the-curator.md body, mention path in spawn prompt.
3. **B2 ITERATION_COMPLETE removal**: delete from 4 files.
4. **C4 + C5 + H1 (milestone-end signal contract)**: definitive pass on milestone-end vocabulary. Decide MILESTONE_DONE's owner (recommend: send to thoth so per-milestone docs generate). Decide BUILD_COMPLETE → MILESTONE_COMPLETE order on final milestone (recommend: BUILD_COMPLETE only on final, no terminal MILESTONE_COMPLETE). Remove QA_ISSUES (replace with structured ITERATION_UPDATE that already carries QA findings).
5. **C6 + C7**: write the formal `REQUEST_WORKERS` engine protocol in SKILL.md; normalize `kiln:` prefix (rule: agents send bare names, engine adds prefix when spawning).
6. **B5 check-cache.sh simplification**: TWEAKS Track D.

**Test harness updates:**

| File | Change | Why |
|---|---|---|
| `tests/layer1-static/lint/agents.py::TOOL_POLICY` | Rename key `"critical-drinker"` → `"critical-thinker"` | Rename propagation |
| `tests/layer2-replay/mock_engine.py::BUILD_SCENARIO_PAIRS` | Rename `"critical-drinker"` → `"critical-thinker"` for default + fallback | Rename propagation |
| `tests/layer1-static/lint/orphans.py::DELETED_ROLES` | Add `"critical-drinker"` to list — catches future accidental resurrection | Regression guard |
| `tests/layer2-replay/scenarios/cycle-workers-basic.yaml` | Update `subagent_type: dial-a-coder` pairing reviewer from `critical-drinker` → `critical-thinker` | Spec update |
| `tests/layer2-replay/scenarios/cycle-workers-rejected.yaml` | Same | Same |
| `tests/layer1-static/lint/orphans.py::check_orphan_references` | no change | design-qa.md now referenced from the-curator → auto-green |
| `tests/layer1-static/lint/orphans.py::DELETED_ROLES` | Add `"sphinx"` to confirm it stays out | Already flagged; reinforces |
| `tests/layer1-static/lint/consistency.py::check_signal_handlers` | no change | MILESTONE_DONE becomes properly plumbed (thoth handler + bossman sender) → ORPHAN_HANDLER goes away |
| `tests/layer1-static/lint/orphans.py::check_vestigial_signals` | no change | ITERATION_COMPLETE / QA_ISSUES removed from vocab → no longer flagged |
| `tests/layer1-static/lint/consistency.py::check_request_workers_handler` | no change | Engine now documents the protocol → becomes green |
| `tests/layer1-static/lint/consistency.py::check_prefix_consistency` | no change | Normalized by C7 fix |
| **NEW** `tests/layer2-replay/scenarios/milestone-done-archives.yaml` | create — assert bossman sends MILESTONE_DONE to thoth on milestone-complete, thoth writes milestone-{N}.md | Locks in C5 resolution |

**Post-wave verification:**

```bash
bash tests/run-all.sh
```

Expected:
- Zero mentions of `critical-drinker` in agent bodies (confirm with `grep -rn "critical-drinker" plugins/`)
- All scenarios reference `critical-thinker` correctly
- No `ORPHAN_HANDLER`, no `VESTIGIAL_SIGNAL`, no `ORPHAN_REFERENCE` remaining
- `milestone-done-archives` scenario green

### Wave 5 — Polish (M-tier + L-tier)

Once the architecture is solid, sweep the remaining medium/low items in a single cleanup PR. None of these block correctness — they harden against future drift.

**Test harness updates:**

- No contract changes — just confirmations.
- If any M/L item involves adding a new invariant (e.g., M1 scenario-validation claim in bossman), encode it as a new `consistency.py` check.
- Re-run full harness; confirm `bash tests/run-all.sh` exits 0 for the first time since Wave 0.

**Victory condition for the whole campaign**: after Wave 5, `bash tests/run-all.sh` → `exit 0`, with zero audit findings flagged. That's the green light to tag **v1.4.0**.

---

### Dependencies and ordering rationale

- **Wave 0 first**: zero behavior change, biggest unblock-per-effort ratio.
- **Wave 1 before Wave 2**: align QA tribunal data model first; then refactor the routing on top of a clean base.
- **Wave 2 (centralization) before Wave 3**: build loop hardening assumes the boss is the central listener — easier to add IMPLEMENTATION_APPROVED reviewer→boss when the reviewer already talks to boss instead of engine.
- **Wave 4 (rename + cleanup) last**: mechanical changes are easier when the underlying contracts are settled. Renaming critical-drinker AFTER C8 means the new IMPLEMENTATION_APPROVED signal lives in the renamed agent from day one.
- **Wave 5 polish**: assumes everything important is done.

### Recommended cadence

- Wave 0 + Wave 1 = a single half-day session, two commits.
- Wave 2 = its own session, one commit, **smoke after**.
- Wave 3 = its own session, one commit per item OR one bundled commit, **smoke after each**.
- Wave 4 = batched into 2-3 commits over a session.
- Wave 5 = one cleanup PR whenever.

Each wave should produce a tagged version (v1.3.1 = Wave 0+1, v1.3.2 = Wave 2 = the centralization release, v1.3.3 = Wave 3, v1.4.0 = Wave 4 since the rename is a public-surface change).

---

## OBSERVATIONS — design tensions, not defects

### O1. kilndev's "boss drives, engine is dumb relay" is partially abandoned

Compared to kilndev v0.3.1, Kiln has the engine doing more:
- Engine orchestrates the entire QA tribunal (anonymization, sequencing of denzel/judge-dredd) instead of the boss
- Engine writes STATE.md across step transitions
- Engine performs cache-health checks, scaffolding, banner rendering

This is a deliberate Kiln choice for the production pipeline. Worth keeping in mind during refactors — "kilndev says X" doesn't always apply because Kiln runs more centralized.

### O2. Three layers of agent identity (subagent_type vs spawn name vs runtime MY_NAME)

Already documented as intentional but it's the source of multiple bugs in this audit (C2, C3, C7). The complexity is real. Consider whether a future iteration could collapse one layer.

### O3. The engine LLM is doing a lot of free-form parsing

WORKERS_SPAWNED parsing, anonymization, REQUEST_WORKERS validation, malformed-signal recovery — all happen in the engine's LLM context as it reads incoming messages. Hard to make deterministic. The engine SKILL.md's malformed-signal recovery section (line 421) tries to add resilience but may also paper over real bugs (like C1 / H2).

---

## Suggested fix order (if you want a tuyauterie sweep)

**Architecture-first** (do these together — they reshape the contract):

1. **C11 (CENTRALIZATION)**: refactor signal recipients from team-lead → krs-one for PMs and QA tribunal. Engine becomes pure spawner+relay for boss-level commands only. This subsumes C12 (resolve WORKERS_SPAWNED slack with the cleaner contract) and partly fixes O1.

2. **C8 (IMPLEMENTATION_COMPLETE drop)**: pick a routing model — preferred is reviewer→{builder, krs-one} on APPROVED, removing the builder's missed follow-up. Coordinate with C11.

3. **C10 (build_iteration meaning)**: decouple team-name index from chunk count. Pick semantics, propagate to bossman/blueprints/kill-streaks/thoth.

**Targeted bug fixes** (one-liners or scoped edits):

4. **C1 + H2**: pick the single QA-tribunal file path + signal name and fix denzel/judge-dredd/blueprint/SKILL together. **One coordinated edit.**
5. **C2**: one-line fix in `audit-milestone.sh` (`krs-one` → `bossman`).
6. **C9**: distinct READY signal names for bootstrap vs ITERATION_UPDATE reply, OR explicit "REPLY TO SENDER" hardening in PM handlers.
7. **C3**: pass CHECKER_ID/RUN_NUMBER OR change ken/ryu to fixed paths. Coordinate with engine spawn prompts. (Largely subsumed by C11 if QA goes direct to krs-one.)
8. **C4 + C5 + H1**: full pass on the milestone-end signal contract. Decide MILESTONE_DONE's owner and fate. Decide BUILD_COMPLETE vs MILESTONE_COMPLETE order.
9. **C6 + C7**: write the formal `REQUEST_WORKERS` engine protocol; normalize `kiln:` prefix.

**Cleanup**:

10. **H4**: flip exit codes on the two PostToolUse advisory hooks.
11. **H5**: revisit `audit-milestone.sh` injection logic — currently dead.
12. **H6**: remove boss-side STATE.md updates in argus + aristotle.
13. **M1-M8 + L***: cleanup pass once core flow is right.

The first three items (C11 + C8 + C10) are the **architectural sweep** — they fix the systemic plumbing model. Items 4-9 are surgical follow-ups.

**Quick-win shortlist for the next smoke run** (no big refactors):
- C2 (one-line audit fix)
- C1 (file path + signal alignment for QA tribunal)
- C9 (PM READY recipient clarification — prevent the 4-min deadlock)
- C8 mitigation (a): bolt a terminal reminder onto dial-a-coder that explicit-IMPLEMENTATION_COMPLETE-or-deadlock
