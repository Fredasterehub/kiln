PLUMBING TEST MODE — CRITICAL RULES:

This is an automated orchestration test. Content quality does not matter.
All artifact content should be MINIMAL — 1-3 paragraphs per file maximum.

SPEED RULES — you MUST follow these:
1. Do NOT read: brand.md, lore-engine.md, lore.json, spinner-verbs.json, agents.json
2. Do NOT render transition banners or call any symlink scripts (omega/alpha, deploy/spies, etc.)
3. Do NOT read team-protocol.md
4. Read ONLY: STATE.md, the skill file (SKILL.md), and the step blueprint
5. When reading SKILL.md, skip past all brand/lore/banner sections — go directly to the step execution logic
6. TIME BUDGET: 6 minutes — if approaching timeout without all artifacts written, write remaining artifacts DIRECTLY yourself (not via agents) and advance STATE.md immediately

You are running one isolated Kiln relay step in automated test mode. No human operator input is available.

Execute ONLY Step 5 (build). Do not continue into validate. Stop as soon as this single relay iteration is complete and the state transition has been written.

RELAY CONSTRAINT — CRITICAL:
- Run exactly ONE build iteration
- Spawn the real Step 5 team and exercise the normal `KRS-One -> Codex -> Sphinx -> living-doc` flow
- Do not loop for additional chunks, milestones, or correction cycles
- Do NOT install npm packages or run any build tools
- Ignore any React/Vite assumptions in the seeded master plan
- Override the implementation scope: `krs-one` must assign `codex` exactly one task, using a structured XML assignment, to write `index.html` with basic HTML structure, a heading, and a paragraph
- `krs-one` must delegate to `codex`; do not let `krs-one` write `index.html` directly
- `codex` writes ONE source file: `index.html`
- After writing `index.html`, `codex` must signal `sphinx` for review
- `sphinx` must review the file and return `APPROVED`
- `codex` then reports `IMPLEMENTATION_COMPLETE` to `krs-one`
- `krs-one` updates the living docs, emits `BUILD_COMPLETE`, advances `.kiln/STATE.md` to `stage: validate` with the Step 6 blueprint path in `roster`, then stops immediately
- If the agent flow stalls, preserve the delegation attempt, then write remaining artifacts directly and advance state

EXECUTION:
1. Read `.kiln/STATE.md`.
2. Read the file at the `skill` path from STATE.md.
3. Resume from current `stage` (`build`).
4. Execute ONLY the single Step 5 plumbing iteration described above.
5. Write Step 5 artifacts: `index.html`, `AGENTS.md`, `.kiln/docs/codebase-state.md`, `.kiln/docs/patterns.md`, and any updated `.kiln/docs/decisions.md` or `.kiln/docs/pitfalls.md`.
6. Stop immediately after `BUILD_COMPLETE`. Do not start Step 6.
