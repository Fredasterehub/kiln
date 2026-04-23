# Kiln Test Harness

Deterministic testing for the Kiln pipeline. Two layers, both run without LLMs.

```
tests/
├── run-all.sh              entrypoint — runs both layers
├── layer1-static/          static lint + hook fixtures (~2s)
└── layer2-replay/          mock-engine replay of kilndev transcripts (~30s)
```

## Quickstart

```bash
bash tests/run-all.sh                     # full harness
bash tests/layer1-static/run.sh           # Layer 1 only (dev loop)
bash tests/layer2-replay/run.sh           # Layer 2 only
```

## What each layer catches

| Layer | Runtime | Scope | Catches from audit (v1.3.0) |
|---|---|---|---|
| **1 — Static** | ~2s | Cross-doc consistency, agent schema, dead code, hook behavior via JSON fixtures | C1, C2, C3, C5, C6, C7, H1, H4, H6, B1, B2, B3, B4, M4, L1, L2 |
| **2 — Replay** | ~30s | Engine state machine, signal routing, sequencing — against frozen kilndev transcripts + synthetic scenarios | C8, C9, C10, C11, C12 |
| **Smoke (kilndev)** | ~37 min | Real LLM behavioral compliance (agents actually emit the right signals) | Residual LLM drift — everything Layer 1+2 can't see |

Use Layers 1+2 on every change. Smoke kilndev only when Layers 1+2 are green and you want the behavioral oracle before tagging a release.

## Layer 1 structure

```
layer1-static/
├── run.sh                          # bash loop over all linters + fixtures
├── lint/
│   ├── _common.py                  # shared md parsers
│   ├── consistency.py              # cross-doc: paths, signals, handlers, names
│   ├── agents.py                   # frontmatter + required sections per agent
│   └── orphans.py                  # unused refs, vestigials, snake_case aliases
└── hook-fixtures/
    ├── run.sh                      # pipe each *.json into its hook, diff against *.expected
    ├── audit-bash/                 # 4 fixtures
    ├── enforce-pipeline/           # 13 fixtures — all 10 hook categories
    └── stop-guard/                 # 10 fixtures (incl. bossman iter-log — C2 regression,
                                    #   moved from audit-milestone in v1.5.3)
```

## Layer 2 structure

```
layer2-replay/
├── run.sh                          # loop over scenarios
├── parse_transcript.py             # thoth-timeline + breadcrumbs → events
├── mock_engine.py                  # Python state machine, versioned handlers
├── replay.py                       # driver: events + scenario → pass/fail
├── transcripts/
│   └── kilndev-YYYYMMDD-HHMMSS/    # frozen snapshot from kilndev smoke
└── scenarios/
    ├── worker-cycling-basic.yaml
    ├── qa-tribunal-pass.yaml
    ├── pm-ready-wrong-recipient.yaml    # synthetic — C9
    └── implementation-complete-drop.yaml # synthetic — C8
```

`mock_engine.py` has versioned handlers so Wave 2 (centralization refactor) can be validated by replaying the same transcript against `pre-centralization` and `post-centralization` engine versions.

## Adding new tests

**New consistency invariant**: add a function to `layer1-static/lint/consistency.py` that returns a list of `Violation` records. Run against v1.3.0 and confirm it catches at least one real issue — if not, the invariant is wrong.

**New hook fixture**: create two files side-by-side under `hook-fixtures/{hook-name}/`: `{case}.json` (stdin JSON) and `{case}.expected` (STDOUT/STDERR/EXIT sections). The runner picks them up automatically.

**New replay scenario**: YAML under `layer2-replay/scenarios/`. See existing examples for shape. Can be `transcript-based` (uses frozen events) or `synthetic` (events-inline).

## Non-goals

- Replacing the kilndev smoke harness — it remains the LLM behavioral oracle.
- Testing LLM agent outputs — those are statistical, use eval-style suites if needed.
- Shipping to the marketplace plugin — `tests/` is at repo root, outside `plugins/`, not distributed.
