You are GPT-5.3-codex operating in the repo root at `/tank/dump/DEV/kiln`. Implement the task exactly as specified. Do not assume any prior context. Do not create or modify any files other than the one explicitly listed.

# Task: T03-T03 — Write `/kiln:status` skill

## Goal
Write the `/kiln:status` slash command skill that reads project state and displays a formatted progress report with intelligent next-action routing.

## Acceptance Criteria (AC-03)
- Reads `.kiln/STATE.md` and `.kiln/ROADMAP.md`.
- Displays phase progress with statuses.
- Shows correction cycle counts and regression suite size.
- Routes to next action with a specific command suggestion.

## Files
- Add: `skills/kiln-status/kiln-status.md`
  - Rationale: The `/kiln:status` slash command — progress reporting and next-action routing

## Context (must be included/assumed by the skill)
Kiln stores all its state in a `.kiln/` directory at the project root. The two key files for status are:
- `.kiln/STATE.md` — tracks current phase, step, correction cycles, regression test count, session recovery info
- `.kiln/ROADMAP.md` — lists all phases with their titles

The status command reads these files, formats a human-readable progress display, and tells the user what to do next.

## Implementation Requirements (file content specification)
Create `skills/kiln-status/kiln-status.md` with the following structure and exact headings/strings.

### 0) YAML frontmatter (must be the first lines, exact)
```yaml
---
name: kiln-status
description: Display kiln project progress and route to next action
user_invocable: true
---
```

### 1) Title (must be the next line after frontmatter)
`# /kiln:status — Project Status`

### 2) Section 1: Prerequisites Check
Add heading: `## Prerequisites`

Include this exact content (verbatim intent; preserve the numbered items and quoted strings):
“Before displaying status, verify kiln is initialized:
1. Check if `.kiln/` directory exists. If not: print 'Kiln is not initialized for this project. Run /kiln:init first.' and stop.
2. Check if `.kiln/STATE.md` exists. If not: print 'Kiln state file missing. Run /kiln:init to reinitialize.' and stop.
3. Read `.kiln/config.json` to get project settings.”

### 3) Section 2: Gather State
Add heading: `## Step 1: Read State Files`

Include this exact content (verbatim intent; preserve list structure and field names):
“Read these files using the Read tool:
1. `.kiln/STATE.md` — parse the following fields:
   - Project name (from Project section)
   - Model mode (from Project section)
   - Phase Progress table (list of phases with statuses)
   - Current Track section (phase number, step, step status)
   - Correction Cycles section (mini-verify retries, E2E corrections, review corrections)
   - Regression Suite section (test count, phase count)
   - Session Recovery section (last activity, last completed, next expected)

2. `.kiln/ROADMAP.md` — if it exists, read phase titles. If it doesn't exist yet (pre-roadmap), note that roadmap hasn't been generated.

3. `.kiln/config.json` — read model mode and tooling detection results.”

### 4) Section 3: Display Format
Add heading: `## Step 2: Display Status`

Include this exact content and the exact monospace block (including box-drawing characters and symbols):
“Format and display the status report. Use this exact format:

```
╔══════════════════════════════════════╗
║         Kiln Project Status          ║
╠══════════════════════════════════════╣

  Project:  <project_name>
  Mode:     <multi-model | claude-only>

  ── Phases ──────────────────────────

  <For each phase in roadmap/STATE.md:>
  Phase <N>: <title>          [<status>]
  <where status is one of: completed ✓, in-progress ►, failed ✗, pending ·>

  Example:
  Phase 1: Project scaffolding     [completed ✓]
  Phase 2: Core data model         [completed ✓]
  Phase 3: Authentication          [in-progress ►] (review)
  Phase 4: API endpoints           [pending ·]

  ── Current Track ───────────────────

  Phase <N>: <title>
  Step:  <plan|validate|execute|e2e|review|reconcile> (<status>)
  Corrections: <E2E_count>/3 E2E, <review_count>/3 review

  ── Regression Suite ────────────────

  <test_count> tests from <phase_count> completed phases

  ── Tooling ─────────────────────────

  Test runner:   <value or 'none'>
  Linter:        <value or 'none'>
  Type checker:  <value or 'none'>
  Start command: <value or 'none'>

╚══════════════════════════════════════╝
```

If the roadmap hasn't been generated yet, show:
```
  ── Phases ──────────────────────────
  Roadmap not generated yet.
```

If no phases exist yet (pre-brainstorm), show only Project/Mode and the next action.”

### 5) Section 4: Next Action Routing
Add heading: `## Step 3: Route to Next Action`

Include this exact routing logic text and the exact quoted output strings. Ensure the skill instructs to print ONE (and only one) of the next-action messages, chosen by state:

“Based on the current state, print ONE of these next-action messages:

**No .kiln/VISION.md exists:**
'Next: Run /kiln:brainstorm to start the brainstorming session.'

**VISION.md exists but no ROADMAP.md:**
'Next: Run /kiln:roadmap to generate the implementation roadmap.'

**ROADMAP.md exists but no track has started:**
'Next: Run /kiln:track to start building.'

**A track is in progress (step status = in-progress):**
'Phase <N> is currently at the <step> stage. Run /kiln:track to resume.'

**A track has failed (step status = failed):**
'Phase <N> halted at <step> after <count> correction cycles. Review .kiln/tracks/phase-<N>/<results_file> for details. Options: fix manually and resume, adjust criteria, or replan.'

**All phases complete but no FINAL_REPORT.md:**
'All phases complete. Final integration E2E pending. Run /kiln:track to trigger final verification.'

**FINAL_REPORT.md exists:**
'Project complete! See .kiln/FINAL_REPORT.md for the full test report.'

**For quick tasks:**
Also mention: 'For small changes, use /kiln:quick \"description\".'

Always end with: 'Edit .kiln/config.json to adjust preferences.'”

### 6) Section 5: Edge Cases
Add heading: `## Edge Cases`

Include these exact bullets:
“- If STATE.md is corrupted or unparseable: print 'Warning: STATE.md appears corrupted. Consider running /kiln:init to reinitialize.' Show whatever info can be extracted.
- If ROADMAP.md references phases not in STATE.md: show phases from ROADMAP.md with status 'unknown'.
- If session recovery shows a stale timestamp (>24 hours old): add a note 'Previous session was interrupted. State may need review.'”

## Non-functional constraints
- Target total file length: ~150 lines (must land roughly 120–180 lines).
- Display must work in a monospace terminal; do not introduce extra emoji/icons beyond the specified symbols in the format block.
- Be robust to partially initialized projects; do not crash—prefer warnings and partial output.

## Verification Commands (run these locally after writing the file)
- `test -f skills/kiln-status/kiln-status.md`
- `wc -l skills/kiln-status/kiln-status.md` (should be ~120–180 lines)

## Deliverable
- A single new file: `skills/kiln-status/kiln-status.md` matching all headings, sections, and exact strings/format blocks above.