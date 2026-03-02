# /kiln:resume (v3)

Resume from `.kiln/STATE.md` canonical fields.

## Steps

1. Read `.kiln/config.json` and `.kiln/STATE.md`.
2. Reconciliation checks before routing:
- Ensure all unresolved gates remain unresolved (no skipping).
- If current/last phase is implemented but missing Stage 5 verification, route to `testing` first (backfill).
- If fix loop is open (`BUGS_FOUND` flow), route to Stage 4 correction path before any new phase.
3. Route by `stage` and `status` via delegation only:
- `init` -> spawn `kiln3-init-coordinator`
- `mapping` -> spawn `kiln3-codebase-mapper`
- `brainstorm` -> spawn `kiln3-brainstormer` and restore direct operator handoff
- `research` -> spawn `kiln3-research-coordinator`
- `architecture` -> spawn `kiln3-architecture-coordinator`
- `implementation` -> spawn `kiln3-implementation-coordinator`
- `testing` -> spawn `kiln3-testing-coordinator`
- `deployment` -> spawn `kiln3-deployment-coordinator`
- `presentation` -> spawn `kiln3-presentation-coordinator`
4. Top-level session must not execute stage internals.
5. Update `.kiln/STATE.md` after each resumed transition.
