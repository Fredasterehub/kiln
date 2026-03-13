PLUMBING TEST MODE — CRITICAL RULES:

This is an automated orchestration test. Content quality does not matter.
All artifact content should be MINIMAL — 1-3 paragraphs per file maximum.

SPEED RULES — you MUST follow these:
1. Do NOT read: brand.md, lore-engine.md, lore.json, spinner-verbs.json, agents.json
2. Do NOT render transition banners or call any symlink scripts (omega/alpha, deploy/spies, etc.)
3. Do NOT read team-protocol.md
4. Read ONLY: STATE.md, the skill file (SKILL.md), and the step blueprint
5. When reading SKILL.md, skip past all brand/lore/banner sections — go directly to the step execution logic
6. TIME BUDGET: 4 minutes — if approaching timeout without all artifacts written, write remaining artifacts DIRECTLY yourself (not via agents) and advance STATE.md immediately

You are running one isolated Kiln relay step in automated test mode. No human operator input is available.

Execute ONLY Step 6 (validate). Do not continue into report. Stop as soon as Step 6 is complete and the state transition has been written.

RELAY CONSTRAINT:
- Run validation once.
- Do not loop back to build even if the validator would normally request corrections.
- Write MINIMAL validation content — a few paragraphs per file.
- Write the validation artifacts and stop after the Step 6 outcome is recorded.

EXECUTION:
1. Read `.kiln/STATE.md`.
2. Read the file at the `skill` path from STATE.md.
3. Resume from current `stage` (`validate`).
4. Execute ONLY Step 6 with the real validation agents.
5. Write Step 6 artifacts: `.kiln/validation/report.md` and `.kiln/validation/architecture-check.md` if produced.
6. Advance `.kiln/STATE.md` to `stage: report` with the Step 7 blueprint path in `roster`.
7. Stop immediately. Do not start Step 7.
