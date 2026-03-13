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

You are running one isolated Kiln relay step in automated test mode. A human operator is watching but will not type responses.

Execute ONLY Step 1 (onboarding) in BROWNFIELD mode. Do not continue into brainstorm. Stop as soon as Step 1 is complete and the state transition has been written.

PROJECT INFORMATION:
- Name: TodoApp
- Type: existing web app (brownfield)
- Path: use current working directory
- Description: Simple todo list app with localStorage persistence — pre-existing codebase to scan
- Stack: HTML/CSS/JavaScript (vanilla)
- Testing: none

PLUMBING TARGET — BROWNFIELD SPECIFIC:
- Phase A: spawn `mnemosyne`. It must detect existing source files (index.html, script.js, style.css, package.json), identify this as BROWNFIELD, and signal `READY` with brownfield summary
- Phase B: spawn `alpha`. Alpha receives mnemosyne's READY summary indicating brownfield. Alpha must send `DEEP_SCAN` to mnemosyne to deploy scouts
- Phase C (REQUIRED — this is the whole point of this test): mnemosyne must request 3 scout workers: `maiev`, `curie`, `medivh`. Each scout scans the codebase and reports `SCOUT_REPORT` back to mnemosyne. mnemosyne synthesizes all 3 reports and signals `MAPPING_COMPLETE` to alpha
- Alpha writes artifacts including brownfield-specific `pitfalls.md`, then signals `ONBOARDING_COMPLETE`
- If scouts stall past 3 minutes, mnemosyne should synthesize what it has and signal MAPPING_COMPLETE anyway

HEADLESS PROTOCOL — CRITICAL:

When spawning agents for Step 1 (onboarding):
Include this EXACT text at the START of alpha's runtime prompt, replacing `[current working directory]` with the actual project path from `.kiln/STATE.md`:
"AUTOMATED TEST MODE: Do NOT interview the operator. Use these values directly without asking:
- project_name: TodoApp
- project_path: [current working directory]
- description: Simple todo list app with localStorage persistence
- stack: HTML/CSS/JavaScript (vanilla)
- greenfield: false
- BROWNFIELD: true — approve deep scan IMMEDIATELY. Send DEEP_SCAN to mnemosyne without asking the operator. This is an automated test."

If any agent asks a question or appears to wait for a human response, answer it immediately yourself using the values above. Never wait for human input.

EXECUTION:
1. Read `.kiln/STATE.md`.
2. Read the file at the `skill` path from STATE.md.
3. Resume from current `stage` (`onboarding`).
4. Execute ONLY Step 1 in brownfield mode with ALL THREE PHASES (A, B, C).
5. Write Step 1 artifacts: `.kiln/STATE.md`, `.kiln/MEMORY.md`, `.kiln/docs/codebase-snapshot.md`, `.kiln/docs/decisions.md`, `.kiln/docs/pitfalls.md`.
6. Advance `.kiln/STATE.md` to `stage: brainstorm` with the Step 2 blueprint path in `roster`.
7. Stop immediately. Do not start Step 2.
