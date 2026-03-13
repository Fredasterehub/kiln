PLUMBING TEST MODE — CRITICAL RULES:

This is an automated orchestration test. Content quality does not matter.
All artifact content should be MINIMAL — 1-3 paragraphs per file maximum.

SPEED RULES — you MUST follow these:
1. Do NOT read: brand.md, lore-engine.md, lore.json, spinner-verbs.json, agents.json
2. Do NOT render transition banners or call any symlink scripts (omega/alpha, deploy/spies, etc.)
3. Do NOT read team-protocol.md
4. Read ONLY: STATE.md, the skill file (SKILL.md), and the step blueprint
5. When reading SKILL.md, skip past all brand/lore/banner sections — go directly to the step execution logic
6. TIME BUDGET: 7 minutes — if approaching timeout without all artifacts written, write remaining artifacts DIRECTLY yourself (not via agents) and advance STATE.md immediately

You are running one isolated Kiln relay step in automated test mode. No human operator input is available.

Execute ONLY Step 4 (architecture). Do not continue into build. Stop as soon as Step 4 is complete and the state transition has been written.

Seed note: the ST10 golden artifact set does not preserve Step 3 research files. If `.kiln/docs/research.md` or `.kiln/docs/research/` are absent in this seeded workspace, proceed with the remaining available Step 1-2 inputs instead of blocking.

PLUMBING TARGET:
- Phase A: spawn `numerobis` and `thoth`
- `numerobis` must read the available research inputs and write MINIMAL architecture docs: `.kiln/docs/architecture.md`, `.kiln/docs/tech-stack.md`, and `.kiln/docs/arch-constraints.md` with roughly 5-10 lines each
- `thoth` should handle the archive/support role and remain available for the normal orchestration plumbing
- Phase B: spawn `aristotle`
- Wave 1: `aristotle` must request `confucius` and `sun-tzu`; each writes a minimal 1-page plan for a simple vanilla HTML/JS link dashboard
- Wave 2: after both plans arrive, `aristotle` must request `plato`; `plato` synthesizes a minimal 1-page `.kiln/master-plan.md`
- Skip the athena validation wave entirely for this plumbing test
- After `plato` completes, have `plato` or `aristotle` write `.kiln/plans/plan_validation.md` with the message `Validation skipped for plumbing test — PASS`
- `aristotle` must then write `.kiln/architecture-handoff.md` directly and signal `ARCHITECTURE_COMPLETE`
- If the agent flow stalls, write any missing architecture or planning artifacts directly and advance state

CRITICAL OVERRIDES:
- All plan content should target a simple vanilla HTML/JS link dashboard
- For this plumbing test, skip the validation wave. After plato completes synthesis, write architecture-handoff.md directly and signal ARCHITECTURE_COMPLETE

EXECUTION:
1. Read `.kiln/STATE.md`.
2. Read the file at the `skill` path from STATE.md.
3. Resume from current `stage` (`architecture`).
4. Execute ONLY Step 4 with the constrained plumbing flow above.
5. Write Step 4 artifacts: `.kiln/docs/architecture.md`, `.kiln/docs/tech-stack.md`, `.kiln/docs/arch-constraints.md`, `.kiln/plans/claude_plan.md`, `.kiln/plans/codex_plan.md`, `.kiln/plans/plan_validation.md`, `.kiln/master-plan.md`, `.kiln/architecture-handoff.md`.
6. Advance `.kiln/STATE.md` to `stage: build` with the Step 5 blueprint path in `roster`.
7. Stop immediately. Do not start Step 5.
