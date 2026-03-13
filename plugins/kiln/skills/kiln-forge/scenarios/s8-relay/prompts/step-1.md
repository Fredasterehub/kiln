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

You are running one isolated Kiln relay step in automated test mode. A human operator is watching but will not type responses.

Execute ONLY Step 1 (onboarding). Do not continue into brainstorm. Stop as soon as Step 1 is complete and the state transition has been written.

PROJECT INFORMATION:
- Name: Linkah
- Type: single-page web app (greenfield)
- Path: use current working directory
- Description: Personal link dashboard — paste URLs, auto-fetch title + favicon, tag links, filter by tag, localStorage persistence
- Stack: HTML/CSS/JavaScript (vanilla), no framework, no build tools, static files
- Testing: none specified

PLUMBING TARGET:
- Phase A: spawn `mnemosyne`, have it initialize minimal memory context, and wait for `READY`
- Phase B: spawn `alpha`, pass the injected project information below, have it write the onboarding artifacts, and wait for `ONBOARDING_COMPLETE`
- Because `greenfield: true`, skip Phase C scouts entirely
- If either agent stalls, finish the remaining files directly and advance state

HEADLESS PROTOCOL — CRITICAL:

When spawning agents for Step 1 (onboarding):
Include this EXACT text at the START of alpha's runtime prompt, replacing `[current working directory]` with the actual project path from `.kiln/STATE.md`:
"AUTOMATED TEST MODE: Do NOT interview the operator. Use these values directly without asking:
- project_name: Linkah
- project_path: [current working directory]
- description: Personal link dashboard — paste URLs, auto-fetch title + favicon, tag links, filter by tag, localStorage persistence
- stack: HTML/CSS/JavaScript (vanilla), no framework, no build tools
- greenfield: true
Skip all questions. This is a greenfield project, so do not request deep scan approval or deploy scouts. Proceed directly to artifact writing and signaling ONBOARDING_COMPLETE."

If any agent asks a question or appears to wait for a human response, answer it immediately yourself using the values above. Never wait for human input.

EXECUTION:
1. Read `.kiln/STATE.md`.
2. Read the file at the `skill` path from STATE.md.
3. Resume from current `stage` (`onboarding`).
4. Execute ONLY Step 1.
5. Write Step 1 artifacts: `.kiln/STATE.md`, `.kiln/MEMORY.md`, `.kiln/docs/codebase-snapshot.md`, `.kiln/docs/decisions.md`, and `.kiln/docs/pitfalls.md` if the step chooses to emit it.
6. Advance `.kiln/STATE.md` to `stage: brainstorm` with the Step 2 blueprint path in `roster`.
7. Stop immediately. Do not start Step 2.
