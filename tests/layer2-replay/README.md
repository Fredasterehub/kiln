# Layer 2 — Mock-engine replay

Runtime: ~30 seconds. No LLM calls, no network. Pure Python 3.11+ stdlib.

Replay frozen kilndev transcripts (or synthetic event sequences) against
a deterministic Python mirror of the engine state machine. Validates
routing, sequencing, and step transitions — exactly the class of bugs
that are invisible to Layer 1's static linters.

## What this catches

| Component | Target |
|---|---|
| `parse_transcript.py` | Reads `thoth-timeline.md` + `breadcrumbs/*.md`, emits chronological event list |
| `mock_engine.py` | Python state machine mirroring engine SKILL.md. Versioned handlers: `pre-centralization` (v1.3.0 current) vs `post-centralization` (Wave 2 target) |
| `replay.py` | Loads a scenario YAML, feeds events through MockEngine, asserts expected decisions |
| `scenarios/*.yaml` | Concrete test cases — transcript-based or synthetic |

Map to audit findings:

| Finding | Scenario |
|---|---|
| C8 IMPLEMENTATION_COMPLETE drop | `reviewer-approves-to-boss.yaml` (post-centralization — asserts reviewer owns the success handoff via IMPLEMENTATION_APPROVED; builder stays silent on APPROVED; engine stays spectator on REVIEW_REQUEST/APPROVED/IMPLEMENTATION_APPROVED) |
| C9 READY misrouted | `pm-ready-wrong-recipient.yaml` (warns on second READY to team-lead after bootstrap) |
| C11 centralization refactor | every scenario can run under both engine versions — compare decisions |
| C12 WORKERS_SPAWNED slack | The original C12 contract was two-path unblock for `CYCLE_WORKERS`: canonical `WORKERS_SPAWNED` from the engine, plus `WORKER_READY` as a self-announce fallback from each freshly-spawned worker (engine logs a `worker_announce` decision per announcement, proving the signal is observed and routed, not swallowed). The dedicated scenario `worker-ready-belt-suspenders.yaml` was retired in P1 (deleted). Current coverage: `cycle-workers-basic.yaml` for the canonical `WORKERS_SPAWNED` path; `subagent-start-cycle-unblock.yaml` for the P1 replacement — `SubagentStart` deterministic spawn-ack drives the unblock via `additionalContext` injection, and the scenario retains per-worker `worker_announce` assertions as a regression guard that `WORKER_READY` (still emitted until retired in a later pass) is not swallowed. |

## Running

```bash
bash run.sh                                         # all scenarios
python3 replay.py --scenario scenarios/qa-tribunal-pass.yaml   # one
python3 parse_transcript.py transcripts/kilndev-20260414-060726  # dump events as JSON
```

## Scenario YAML shape

```yaml
name: my-scenario
description: >
  What this exercises.
engine-version: pre-centralization    # or post-centralization
transcript: transcripts/xyz/          # either this…
events-inline:                        # …or this (synthetic)
  - {sender: krs-one, signal: CYCLE_WORKERS, recipient: team-lead, payload: "scenario=default, ...", timestamp: "00:00:01"}
assertions:
  - after-event: "krs-one | CYCLE_WORKERS"   # sender | SIGNAL marker
    expected-decisions:
      - type: spawn
        name: mario
        subagent_type: dial-a-coder
      - type: send
        signal: WORKERS_SPAWNED
        content-contains: duo_id   # `-contains` suffix = substring match
```

Decision types understood by MockEngine: `spawn`, `shutdown`, `send`,
`write_file`, `transition`, `warn`, `pm_ready`, `worker_announce`.

## Engine versions

`mock_engine.py` has a `version` flag. Switch between:

- `pre-centralization` (the v1.3.0 shape Wave 2 retired) — engine
  relays `QA_VERDICT` to krs-one; PMs have two READY patterns that can
  be confused (the C9 deadlock).
- `post-centralization` (Wave 2 shipped) — judge-dredd sends
  `QA_PASS` / `QA_FAIL` directly to krs-one, engine only shuts down
  the tribunal. PMs use `READY_BOOTSTRAP` to team-lead at startup and
  plain `READY` to krs-one for post-iteration replies (distinct names,
  no conflation).

Existing pre-centralization scenarios are kept as regression locks so
the old contract stays testable. New scenarios added in Wave 2 (e.g.
`centralized-qa-tribunal.yaml`) target the post-centralization
contract.

## Transcripts

Frozen snapshots from kilndev runs live under `transcripts/`. Each
subdirectory should contain:

- `thoth-timeline.md` — chronological aggregated log
- `breadcrumbs/*.md` — per-agent logs (supplement recipient info)
- `SOURCE.md` — origin, commit, what scenarios the transcript exercises

To add a new transcript:
1. Identify a meaningful smoke run in `/DEV/kilndev/test-results/`.
2. `cp -r` into `transcripts/`.
3. Write `SOURCE.md` documenting what it exercises.
4. Add transcript-based scenario(s) that reference it.
