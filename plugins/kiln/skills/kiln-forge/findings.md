# Kiln Forge — Open Findings

Active findings from smoke tests and validation runs. Complements TWEAKS.md (which tracks the full backlog). This file tracks findings relevant to kiln-forge workflows.

## From ST11 / ST11.5 (Task 20 in TWEAKS.md)

| # | Finding | Category | Status |
|---|---------|----------|--------|
| 1 | KRS-One scopes correctly for parallel but blueprint forces sequential codex | Architecture | Open |
| 2 | Codex prompt skeleton compliance: 0/6 sections in M3 despite instructions | Enforcement | Open |
| 3 | Engine context burn on resume: 21+ file reads before useful work | Efficiency | Open |
| 4 | Teardown doesn't kill background workers | Lifecycle | Open |
| 5 | bun PATH missing — agents can't find non-standard binaries | Environment | Open |
| 6 | Codex bootstrap-before-inbox pattern (starts executing before receiving assignment) | Sequencing | Open |
| 7 | Engine startup friction: 8-10 turns on resume before any step work | Efficiency | Open |
| 8 | shift+arrow nudge missing for interactive agents | UX | Open |
| 9 | Progressive MI6 synthesis not implemented | Architecture | Open |
| 10 | Hook 4 recurrence (n=2) — triggered twice in some runs | Hooks | Open |

## From ST10

| # | Finding | Category | Status |
|---|---------|----------|--------|
| 11 | ST10 timeout (resolved — raised to 30 min) | Configuration | Resolved |
| 12 | Spinner verbs DOA (resolved — schema fix in 4cfae88) | Data | Resolved |

## From ST12

| # | Finding | Category | Status |
|---|---------|----------|--------|
| 13 | Boss goes idle after REQUEST_WORKERS — no wake-up when workers spawn. Needs manual nudge. Root cause: no WORKERS_SPAWNED confirmation message from engine to boss. | Sequencing | **Fixed** — SKILL.md patched with WORKERS_SPAWNED message after Phase C spawn |
| 14 | 1 correction cycle — artifact checks missing from runner.rs, caught by Argus | Build quality | Resolved (pipeline self-corrected) |

## From Validation Runs

_No validation runs yet — run w2-validate to populate._
