# The Door — preflight

The first thing the door does, before the settings interview ever asks a question. I check my own room before the fire is lit, and I check it with real processes, never with an impression. This is a **scripted flow, not Maestro dialogue** — onboarding writes straight to state: every check below runs as a real subprocess or a real session-introspection read, its result is written straight into `.kiln/state.json` and `.kiln/ledger.jsonl`, and nothing here is Maestro narrating a judgment call. A worker (or the onboarding module script) executes this file's checks verbatim — no paraphrase, no "looks fine to me."

**Ordering**: runs immediately after `scaffold.scaffoldTree()` has created the tree (`state.json`/`ledger.jsonl` must already exist to write into) and before the settings interview's first `AskUserQuestion` call.

## The check-honesty gate pattern

Every check that is a real subprocess uses `machine/src/check-honesty.js`'s `runGate({ gateId, cmd, ledgerPath })` — the sole sanctioned producer of gate evidence in this codebase (`machine/src/check-honesty.js:329-356`). `runGate` actually executes `cmd` via `spawnSync` and records the **real exit code the process returned**, never a caller-supplied one; a signal-killed process is recorded as a failure. It writes a `kind: "gate"` record to the ledger through `stream.appendRecord` (the common JSONL header — `machine/src/stream.js:27-53`) and returns `{ gateId, cmd, exitCode, seq, stdout, stderr }`.

`machine/src/check-honesty.js`'s own audit (`checkHonesty()`, lines 214-327) is what makes a "pass" claim checkable rather than self-reported: a `state.json.gates[]` entry with `last_result: "pass"` is only honest if the **latest** `kind: "gate"` ledger record for that exact `gate_id` both has `exit_code: 0` and names the **same** `cmd` the state entry declares (`hasGateEvidence`, lines 44-52). This preflight writes into that exact contract — `state.json`'s top-level `gates` array, never a nested copy — so a fresh Maestro session's `check-honesty` run audits the door's own preflight the same way it audits every later phase gate.

Two of the five checks below (Workflow tool, agent-teams) are **not** subprocess-checkable — there is no shell command that answers "is `Workflow` in this session's tool list," it is a fact the running session reads about itself. Those two are recorded honestly as session-reported capability facts (`kind: "preflight"` ledger records, `machine/src/stream.js`'s `appendRecord`, not `runGate`) and never written into `state.json.gates[]` — `gates[]` is reserved for checks that have a real subprocess exit code behind them, so `check-honesty`'s audit never has to guess which kind of evidence a gate id claims.

## The five checks, in run order

### 1. Node present

- **Command**: `node --version`
- **Mechanism**: `runGate({ gateId: 'preflight-node', cmd: 'node --version', ledgerPath })`
- **Pass criterion**: `exitCode === 0`. (If Node were actually absent this script could not be running at all — this check is the version-of-record for the build, not a live risk.)
- **Failure action**: none possible in practice; if it ever fails, treat identically to the codex-absent path below — report plainly, do not silently continue.
- **State**: append `{ name: 'preflight-node', cmd: 'node --version', last_result: exitCode === 0 ? 'pass' : 'fail' }` to `state.json.gates[]` — conditional on the real exit code `runGate` returned, never hardcoded to `'pass'` (a review finding: a script that always wrote `'pass'` here would make the "none possible in practice" claim above unfalsifiable instead of merely rare).
- **Ledger evidence**: the `kind: "gate"` record `runGate` writes, `gate_id: "preflight-node"`.

### 2. Codex present + responsive (GPT-5.6-Sol via Codex CLI)

- **Command** — the same base command that proved Codex reachable at this project's own kickoff, execution-proven in the dev record, with one addition: the pipeline now ends in an exact-match test against the expected reply, so the gate's own exit code proves responsiveness rather than merely proving the shell pipeline didn't crash (a cross-family review finding — see Pass criterion below):
  ```
  timeout 30 codex exec -m gpt-5.6-sol -c 'model_reasoning_effort="low"' -s read-only --skip-git-repo-check --ephemeral "Reply with exactly: codex-ok" 2>/dev/null | tail -1 | grep -qx codex-ok
  ```
- **Mechanism**: `runGate({ gateId: 'codex-preflight', cmd: <above>, ledgerPath })`.
- **Pass criterion — one layer, ledger-provable on its own**: `exitCode === 0`, exactly what `check-honesty` audits, and nothing else. `tail -1` still isolates the reply's last line, but `grep -qx codex-ok` now makes that line's exact content the pipeline's own exit status: found and exactly `codex-ok` → exit 0; empty, wrong, or absent output → exit 1 (verified directly: a matching line exits 0, a wrong line exits 1, empty input exits 1, and an upstream Codex failure feeding nothing to the pipe also exits 1). There is no second, script-side comparison left to get right or get wrong — the executable gate's exit code *is* the semantic check, closing the exact hole named in the prior design ("a false semantic pass written into state is indistinguishable from a real one in the ledger").
- **Failure action — DEGRADED CLAUDE-ONLY MODE, the build completes, nothing parks**: Codex is not answering the door — the dual key takes two families, and on a nonzero exit I hold one. On failure (`exitCode !== 0`), say this plainly to the operator as one honest sentence before anything else in onboarding proceeds: without Codex access, cross-family becomes cross-model (Opus↔Sonnet↔Fable), and the notice below is how that cost gets named rather than absorbed —
  > "GPT-5.6-Sol isn't reachable right now, so this build runs in degraded Claude-only mode: Opus 5, Sonnet 5, and Fable 5 check each other's work instead of a second model family doing it. The build still completes end to end — every seat gets a same-family substitute — but single-family mode loses cross-family error decorrelation: the benefit of two different model families being wrong in different, uncorrelated ways is gone until Codex is reachable again."
  Every routing seat the active config's `seats` section names as GPT-5.6-Sol-only — `implementer`, `coverage_check`, `chunk_review_of_claude_work`, half of `agreement_pass` — gets a same-family Claude substitute from that same config's `degraded_seats` table (`machine/routing/active.json`'s active config; e.g. `machine/routing/routing-2026-07-27-2.json`) rather than being skipped: `implementer` → Opus 5 (the Fable-never-implements ban still holds — Opus already owns UI/creative implementation and becomes the sole degraded-mode implementer); `coverage_check` → Sonnet 5 at high effort, scoped; `chunk_review_of_claude_work` → a Claude model different from the chunk's own author (Opus-authored work reviewed by Sonnet 5, Sonnet-authored work reviewed by Opus 5); `agreement_pass` → Fable 5 + Opus 5, two distinct Claude models standing in for the two distinct families. No seat parks and no step is skipped because Codex is unreachable — the quality caveat above is said plainly, not treated as a reason to stop or defer work (SKILL.md step 1, same law, restated here because preflight is where the fact is first established).
- **State**: append `{ name: 'codex-preflight', cmd: <above>, last_result: exitCode === 0 ? 'pass' : 'fail' }` to `state.json.gates[]`; set `state.json.preflight.mode` to `'full-cross-family'` (exitCode 0) or `'degraded-claude-only'` (exitCode nonzero); if degraded, set `state.json.preflight.notice` to the sentence above verbatim.
- **Ledger evidence**: the `kind: "gate"` record `runGate` writes, `gate_id: "codex-preflight"` — on its own now sufficient for `check-honesty`'s existing audit (latest record, `exit_code: 0`, matching `cmd`) to prove responsiveness, not merely that the pipeline ran. If the mode is degraded, additionally append a `kind: "preflight"` record via `stream.appendRecord` with `payload: { check: 'codex-responsive', ok: false, mode: 'degraded-claude-only' }` and `correlation_id: 'codex-preflight'` — the mode decision itself is a fact worth its own ledger line, distinct from the raw gate's exit code.

### 3. The Workflow tool

- **Mechanism**: session-introspection, not a subprocess. Only the MAIN session can perform it — a worker's own toolset answers a different question — so Maestro reads it and supplies the result as flags (`product/onboarding/flow.md`'s Entry step 1, which names the exact source: the session's own **resolved tool-schema block**, not the static `tools:` frontmatter and not `ToolSearch`, which searches deferred tools while `Workflow` is a built-in). `preflight.js run` takes it as a PAIR of flags: `--workflow-tool <present|absent>` (routing) and `--workflow-tool-observed <present|absent|unknown>` (what was actually seen).
- **Pass criterion**: n/a — this is a fact, not a pass/fail gate. Both outcomes are legitimate operating modes.
- **Failure action (Workflow absent)**: note that phase/chunk sequencing runs through plain Node scripts via Bash instead — the fallback already built and proven for exactly this case. Missing muscle changes the label, never the truth: not blocking.
- **Unknown**: a host that exposes no resolved tool-schema block to the session at all yields `observed: "unknown"`, which routes as `present: false` (degraded, identical downstream behavior to a measured absence) and obliges the report below to say so in its own sentence. Recording only `present: false` would make "the session could not look" indistinguishable from "the session looked and it was not there."
- **State**: `state.json.preflight.capabilities.workflow_tool = { present: <bool>, source: 'session-tool-list', observed: 'present' | 'absent' | 'unknown' }`.
- **Ledger evidence**: a `kind: "preflight"` record carrying `payload: { check: 'workflow-tool', present: <bool>, source: 'session-tool-list', observed: <token> }` and `correlation_id: 'workflow-tool'` — written by `preflight.js run` itself, never by a second hand-rolled append.

### 4. Agent teams / a team window

- **Mechanism**: session-introspection, same shape as check 3 — whether the team-enablement flag and a real team-spawn surface are available in this session — but a genuinely **separate probe**, never derived from check 3's result. `SendMessage` being present does not prove a team window exists, and the two capabilities imply nothing about each other in either direction. Supplied as its own flag pair: `--agent-teams <present|absent>` and `--agent-teams-observed <present|absent|unknown>`.
- **Pass criterion**: n/a, same reasoning as check 3.
- **Failure action (absent)**: this product USES agent teams (the sketchbook's team window), and they ship disabled by default — so absence is not merely noted, it carries an instruction the report must deliver verbatim (a ruled operator-facing trap: an unset switch must never read as a missing feature):
  > "Agent teams are off in this session. To turn them on, set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` — in your environment or in your Claude Code settings.json — and expect to restart your Claude Code session before the change takes. I can build without them: the brainstorm facilitator falls back to its file-mailbox channel. The live team window is the room the sketchbook was designed for, and it is not open here."
  No fallback *decision* is owed at this entry point — the sketchbook's facilitator reads this fact when it opens its own team window; this preflight records the fact and delivers the instruction, never the choice.
- **Unknown**: same rule as check 3 — `observed: "unknown"` routes as `present: false` and carries its own operator sentence in the report below.
- **State**: `state.json.preflight.capabilities.agent_teams = { present: <bool>, source: 'session-tool-list', observed: 'present' | 'absent' | 'unknown' }`.
- **Ledger evidence**: a `kind: "preflight"` record carrying `payload: { check: 'agent-teams', present: <bool>, source: 'session-tool-list', observed: <token> }` and `correlation_id: 'agent-teams'` — written by `preflight.js run` itself.

### 5. Git present + repo state

- **Command**: `git rev-parse --is-inside-work-tree`
- **Mechanism**: `runGate({ gateId: 'preflight-git', cmd: 'git rev-parse --is-inside-work-tree', ledgerPath })`. If `git` itself is absent, `spawnSync` cannot start the process; `runGate` treats that the same as any other non-zero outcome (`outcome.status === null` maps to `exitCode: 1`), so "git absent" and "present but not a repo" both surface as the same clean failure rather than an uncaught throw.
- **Pass criterion**: `exitCode === 0` (implies both git is on `PATH` and the target directory is inside a work tree).
- **Failure action**: advisory, non-blocking — the per-chunk commit/rollback machinery on the anvil needs a repo eventually, but a brand-new greenfield project legitimately may not have one yet at the door. Note it plainly in the report; `git init` can happen later, at the first chunk-commit boundary, not here.
- **State**: append `{ name: 'preflight-git', cmd: 'git rev-parse --is-inside-work-tree', last_result: 'pass' | 'fail' }` to `state.json.gates[]`. On pass, additionally capture branch context via `runGate({ gateId: 'preflight-git-branch', cmd: 'git rev-parse --abbrev-ref HEAD', ledgerPath })` and store its trimmed stdout at `state.json.preflight.repo.branch`. This second call is informational only — it never gets a `state.json.gates[]` entry of its own, because "what branch" has no pass/fail meaning; the ledger record from `runGate` is still real evidence that the read actually happened.
- **Ledger evidence**: the `kind: "gate"` record(s) `runGate` writes, `gate_id: "preflight-git"` (and `"preflight-git-branch"` when run).

## The `state.json.preflight` block

Written once, after all five checks resolve, alongside their individual `state.json.gates[]` entries:

```json
{
  "preflight": {
    "ran_utc": "<RFC3339 UTC>",
    "mode": "full-cross-family" | "degraded-claude-only",
    "notice": "<the exact degraded-mode sentence, or null when not degraded>",
    "capabilities": {
      "workflow_tool": { "present": true, "source": "session-tool-list", "observed": "present" },
      "agent_teams": { "present": true, "source": "session-tool-list", "observed": "present" }
    },
    "repo": { "branch": "p3-onboarding" }
  }
}
```

`state.json.gates[]` (top-level, shared with every later phase gate) carries the three real subprocess checks: `preflight-node`, `codex-preflight`, `preflight-git`. Nothing in this block is read by `check-honesty.js` except `gates[]` itself — `preflight` is reporting surface for the operator-facing narration, composed in the one voice `product/voice/kiln.md` fixes, never a second source of truth for a claim `gates[]` already makes.

## Report to the operator

Same order as `SKILL.md` step 1 already promises, restated here as this file's own contract since `SKILL.md` now points here instead of sketching it inline: state every result plainly, one line each, no silent gaps, no assumed capabilities, no jargon toward the operator. The degraded-mode sentence (check 2) is said **before** anything else in onboarding proceeds if it applies — never buried after the settings interview has already started. The agent-teams enablement instruction (check 4) is delivered in the same report whenever teams are absent — same never-buried rule.

**Whenever a capability's `observed` token is `unknown`** (checks 3 and 4), the report carries one additional sentence for that capability, naming the uncertainty rather than reporting a measured absence that never happened: that this session could not determine whether the capability is available, that the build is proceeding as though it were absent, and what that costs (plain-Node sequencing instead of the Workflow tool; the facilitator's second-terminal fallback instead of a live team window). Same never-buried rule as the two above.

### The effort warning — unconditional, every run

This report always carries the following two facts, whatever the five checks found. They are not conditional on a detected state, because what makes them true is measured Claude Code behavior, never this environment's configuration — execution-proven in the dev record:

1. **Agent-frontmatter `effort:` is non-authoritative.** Every agent file in this product declares an `effort:` value, and on a host with any settings-scope `effortLevel` set — at either scope — that declaration does not take effect. The CLI flag is the only reliable carrier of a seat's specified tier, which is why every direct-launch line this product ever prints to the operator carries `--effort` explicitly: root `SKILL.md`'s `claude --agent maestro --effort high`, and `product/brainstorm/flow.md`'s fallback `claude --agent brainstorm-facilitator --effort high`. An operator who drops the flag gets whatever their settings say, silently.
2. **Effort enforcement on subagent and teammate paths is unproven.** Nothing in this build has live-proven that a spawned subagent or teammate actually runs at its declared tier — there is no printed command line to carry a flag on those paths, and no session primitive this product can name that would let a seat read back its own effective effort. This is reported as unknown, never as an enforced guarantee.

No sixth check is added for either fact. A check that asked the session to report its own effective effort would rest on exactly the introspection ability checks 3 and 4 already have to say `unknown` about — so the honest move is the unconditional warning above, and an effective-effort check only once a concrete session primitive exists and has been live-proven. A check I cannot run is reported as not run, never as passed.
