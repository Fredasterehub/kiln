PLUMBING TEST MODE — CRITICAL RULES:

This is an automated orchestration test. Content quality does not matter.
All artifact content should be MINIMAL — 1-3 paragraphs per file maximum.

SPEED RULES — you MUST follow these:
1. Do NOT read: brand.md, lore-engine.md, lore.json, spinner-verbs.json, agents.json
2. Do NOT render transition banners or call any symlink scripts (omega/alpha, deploy/spies, etc.)
3. Do NOT read team-protocol.md
4. Read ONLY: STATE.md, the skill file (SKILL.md), and the step blueprint
5. When reading SKILL.md, skip past all brand/lore/banner sections — go directly to the step execution logic
6. TIME BUDGET: 5 minutes — if approaching timeout without all artifacts written, write remaining artifacts DIRECTLY yourself (not via agents) and advance STATE.md immediately

You are running one isolated Kiln relay step in automated test mode. No human operator input is available.

Execute ONLY Step 3 (research). Do not continue into architecture. Stop as soon as Step 3 is complete and the state transition has been written.

PLUMBING TARGET:
- Phase A: spawn `thoth`, have it ensure the archive structure exists, and wait for `READY`
- Phase B: spawn `mi6`, have it acknowledge the fixed topics below, and wait for `READY`
- Phase C: `mi6` must request EXACTLY 2 field agents, one per topic listed below
- Each field agent must investigate only its assigned topic, write 1-2 paragraphs of findings, and report `MISSION_COMPLETE` back to `mi6`
- `mi6` must validate the two reports, write progressive synthesis files in `.kiln/docs/research/{slug}.md`, then write final synthesis to `.kiln/docs/research.md`, then signal completion
- If the agent flow stalls, write the topic files and final synthesis directly, then advance state

FIXED TOPICS — DO NOT ANALYZE VISION TO INVENT MORE:
1. `localStorage persistence patterns`
2. `CORS-free favicon fetching`

EXECUTION:
1. Read `.kiln/STATE.md`.
2. Read the file at the `skill` path from STATE.md.
3. Resume from current `stage` (`research`).
4. Execute ONLY Step 3 using the real research orchestration, but constrain MI6 to EXACTLY 2 field agents for the fixed topics above.
5. Write Step 3 artifacts: `.kiln/docs/research.md` and `.kiln/docs/research/localstorage-persistence-patterns.md` plus `.kiln/docs/research/cors-free-favicon-fetching.md`, or equivalent slugged topic files for those two topics.
6. Advance `.kiln/STATE.md` to `stage: architecture` with the Step 4 blueprint path in `roster`.
7. Stop immediately. Do not start Step 4.
