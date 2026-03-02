# /kiln:start (v3)

Run Kiln v3 protocol using Claude Code native teams.

## Inputs

- `PROJECT_PATH`: absolute project path
- `KILN_DIR`: `${PROJECT_PATH}/.kiln`
- `AUTONOMY`: `supervised|guided|autonomous` (default from config)

## Workflow

1. Initialize workspace.
- Ensure `${KILN_DIR}` exists.
- Ensure all required memory files exist from templates.
- Detect `project_mode`: `greenfield` or `brownfield`.
- Write `.kiln/config.json` and `.kiln/STATE.md`.

2. Run Stage 0.5 only if brownfield.
- Spawn mapping team and synthesize outputs.
- Seed Architect and Sentinel checkpoints.

3. Spawn Stage 1 brainstorm team.
- Operator talks directly to Brainstormer.
- Gate on `VISION.md` approval.
- Birth Visionary from approved vision.

4. Spawn Stage 2 research team.
- Compute researcher count from `VISION.md` complexity score.
- Spawn `Researcher-1..N` in parallel.
- Require each researcher to write one owned output file.
- Mechanical merge to `research-findings.md`.
- Architect and Visionary process findings into own files.

5. Spawn Stage 3 architecture team.
- Parallel perspective generation from Visionary and Architect.
- Parallel dual planning from Confucius + Sun Tzu via two separate planner subagents:
  - Confucius (Opus 4.6 planner subagent)
  - Sun Tzu (Sonnet 4.6 wrapper subagent that calls Codex CLI)
- Confucius and Sun Tzu must be spawned as teammates, not simulated by coordinator reasoning.
- Coordinator must not draft either plan file.
- Plato synthesis to `master-plan.md`.
- Athena validation loop with learning retries.
- Apply autonomy gate for `master-plan.md`.

6. Implementation loop.
- For each pending phase in `master-plan.md`:
  - Stage 4 team performs JIT phase planning + implementation loop.
  - Stage 4 must use native teammate/subagent spawning, never nested `claude` CLI.
  - In greenfield, skip Sherlock indexing; Sharpener plans directly from current repo state.
  - Stage 5 team performs milestone testing.
  - If Stage 5 fails, re-enter Stage 4 with `test-results.md` input.
  - Max 3 fix loops per milestone.

7. Deployment (Stage 6).
- Run deployment checks with Coordinator + Architect.
- Apply deployment autonomy gate.

8. Presentation (Stage 7).
- Coordinator writes final report and updates state complete.

## Required Files

- `.kiln/config.json`
- `.kiln/STATE.md`
- `.kiln/VISION.md`
- `.kiln/master-plan.md`
- `.kiln/plans/phase-plan-NN.md`
- `.kiln/test-results.md`

## Failure Policy

- Any ambiguous requirement: stop and ask operator.
- Any gate rejection: pause and set `status: blocked` in STATE.
- Any test loop >3: escalate with concise failure bundle.
