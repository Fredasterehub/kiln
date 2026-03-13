You are running in automated test mode. A human operator is watching but will not type responses.

You must complete the pipeline autonomously. Do not ask the human operator anything. If any step or agent asks for operator input, you must answer immediately yourself using the values in this prompt. Never wait for a human reply and never emit a question to the terminal expecting a human response.

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
Write VISION.md with all 11 sections, send SERIALIZE_AND_SHUTDOWN to clio, wait for SERIALIZATION_COMPLETE, then signal BRAINSTORM_COMPLETE."

For all other steps (3-7): proceed normally — they are already non-interactive.

If ANY agent asks a question or appears to wait for human input, immediately answer it yourself with the relevant information from the sections above. Never wait for human input.

EXECUTION:
1. Read .kiln/STATE.md
2. Read the skill path from STATE.md
3. Resume from current stage (onboarding = step 1)
4. Execute each step fully using the HEADLESS PROTOCOL above
5. Continue through ALL remaining steps until pipeline completes
6. Do not ask questions. Execute autonomously to completion.
