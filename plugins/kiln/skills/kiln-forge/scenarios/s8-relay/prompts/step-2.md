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

Execute ONLY Step 2 (brainstorm). Do not continue into research. Stop as soon as Step 2 is complete and the state transition has been written.

PROJECT INFORMATION:
- Name: Linkah
- Type: single-page web app (greenfield)
- Path: use current working directory
- Description: Personal link dashboard — paste URLs, auto-fetch title + favicon, tag links, filter by tag, localStorage persistence
- Stack: HTML/CSS/JavaScript (vanilla), no framework, no build tools, static files
- Testing: none specified

VISION:
- Core: paste URL → auto-fetch title + favicon → save to list
- Tags: add tags to links, filter by tag
- Persistence: localStorage (no backend)
- UI: clean, minimal, responsive
- P1: Core link management (add, view, delete)
- P2: Tagging and filtering
- P3: Visual polish (favicons, smooth interactions)

PLUMBING TARGET:
- Phase A: spawn `clio`, bootstrap from onboarding artifacts, and wait for `READY`
- Phase B: spawn `da-vinci`, have it write the vision artifacts, then send `SERIALIZE_AND_SHUTDOWN` to `clio`
- `clio` must respond with `SERIALIZATION_COMPLETE`
- `da-vinci` must then signal `BRAINSTORM_COMPLETE`
- If the agent flow stalls, write the three vision files yourself, serialize directly if needed, and advance state

HEADLESS PROTOCOL — CRITICAL:

When spawning agents for Step 2 (brainstorm):
Include this EXACT text at the START of da-vinci's runtime prompt:
"AUTOMATED TEST MODE: Do NOT interview the operator. Do NOT facilitate brainstorming.
Use depth=Standard. Use the following vision content directly to write all artifacts:
- Core: paste URL → auto-fetch title + favicon → save to list
- Tags: add tags to links, filter by tag
- Persistence: localStorage (no backend)
- UI: clean, minimal, responsive
- P1: Core link management (add, view, delete)
- P2: Tagging and filtering
- P3: Visual polish (favicons, smooth interactions)
Skip technique selection, idea gathering, and section-by-section approval.
Da-vinci must write ALL THREE vision files — VISION.md, vision-notes.md, vision-priorities.md — even if minimal. Each can be 5-10 lines.
Write VISION.md with all 11 sections, send SERIALIZE_AND_SHUTDOWN to clio, wait for SERIALIZATION_COMPLETE, then signal BRAINSTORM_COMPLETE."

If any agent asks a question or appears to wait for a human response, answer it immediately yourself using the values above. Never wait for human input.

EXECUTION:
1. Read `.kiln/STATE.md`.
2. Read the file at the `skill` path from STATE.md.
3. Resume from current `stage` (`brainstorm`).
4. Execute ONLY Step 2.
5. Write Step 2 artifacts: `.kiln/docs/VISION.md`, `.kiln/docs/vision-notes.md`, `.kiln/docs/vision-priorities.md`.
6. Advance `.kiln/STATE.md` to `stage: research` with the Step 3 blueprint path in `roster`.
7. Stop immediately. Do not start Step 3.
