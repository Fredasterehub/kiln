# DECISIONS — T07: Verification + Review

## D-01: Separate kiln-track skill vs embedding in orchestrator
- **Decision:** Create separate `skills/kiln-track/kiln-track.md` skill
- **Rationale:** The track loop logic is complex enough to warrant its own file. The orchestrator references it but stays thin. The skill defines the auto-advance protocol; the orchestrator executes it.
- **Alternatives considered:** Embedding directly in orchestrator — rejected because it would bloat the orchestrator beyond its 15% context budget role.

## D-02: E2E test framework selection strategy
- **Decision:** Match the project's existing test framework. Defaults: Playwright (web-ui), native fetch (api-server), child_process (cli-tool), direct import (library).
- **Rationale:** Using the project's own tooling reduces friction and produces tests that live naturally in the project's test suite.
- **Alternatives considered:** Always use a universal runner (e.g., Playwright for everything) — rejected because it's overkill for API/CLI/library projects.

## D-03: E2E startup timeout
- **Decision:** Default 30 seconds, configurable via `config.json preferences.e2eTimeout`.
- **Rationale:** 30s handles most dev server startups. Projects with slow builds can increase it.

## D-04: Reviewer model assignment
- **Decision:** Opus 4.6 for reviewer (not Sonnet).
- **Rationale:** Code review requires deep reasoning about correctness, security, and architectural coherence. Opus provides the judgment quality needed for a quality gate.

## D-05: Correction task format
- **Decision:** Reviewer generates correction tasks in the same format as PLAN.md task packets (goal, AC, file hints).
- **Rationale:** This allows corrections to flow through the same sharpen → implement → mini-verify pipeline as original tasks.
