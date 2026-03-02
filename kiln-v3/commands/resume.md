# /kiln:resume (v3)

Resume from `.kiln/STATE.md` canonical fields.

## Steps

1. Read `.kiln/config.json` and `.kiln/STATE.md`.
2. Route by `stage` and `status`:
- `init` -> rerun Stage 0 checks
- `mapping` -> continue Stage 0.5
- `brainstorm` -> respawn brainstorm team and continue direct operator session
- `research` -> resume incomplete researcher tasks, then merge and mind updates
- `architecture` -> resume at sub-step from `planning_sub_stage`
- `implementation` -> continue current phase loop using phase state
- `testing` -> continue testing or fix loop
- `deployment` -> continue deployment gate
- `presentation` -> regenerate final report
3. Never skip unresolved gates.
4. Update `.kiln/STATE.md` after each resumed transition.
