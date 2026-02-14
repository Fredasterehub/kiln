---
name: kiln-status
description: Display kiln project progress and route to next action
user_invocable: true
---
# /kiln:status — Project Status

## Prerequisites

Before displaying status, verify kiln is initialized:
1. Check if `.kiln/` directory exists. If not: print 'Kiln is not initialized for this project. Run /kiln:init first.' and stop.
2. Check if `.kiln/STATE.md` exists. If not: print 'Kiln state file missing. Run /kiln:init to reinitialize.' and stop.
3. Read `.kiln/config.json` to get project settings.

Run these checks from the project root.
Treat missing required files as blocking only where explicitly stated above.
If `.kiln/config.json` is missing, continue with defaults and emit a warning.
Never crash on missing optional files.
Prefer partial status output over failure.

Prerequisite execution order:
1. Validate `.kiln/` exists.
2. Validate `.kiln/STATE.md` exists.
3. Load `.kiln/config.json`.
4. Continue to state gathering.

## Step 1: Read State Files

Read these files using the Read tool:
1. `.kiln/STATE.md` — parse the following fields:
   - Project name (from Project section)
   - Model mode (from Project section)
   - Phase Progress table (list of phases with statuses)
   - Current Track section (phase number, step, step status)
   - Correction Cycles section (mini-verify retries, E2E corrections, review corrections)
   - Regression Suite section (test count, phase count)
   - Session Recovery section (last activity, last completed, next expected)

2. `.kiln/ROADMAP.md` — if it exists, read phase titles. If it doesn't exist yet (pre-roadmap), note that roadmap hasn't been generated.

3. `.kiln/config.json` — read model mode and tooling detection results.

Parsing guidance:
1. Extract sections by heading name first, then parse structured rows or key-value lines.
2. Normalize status values into: completed, in-progress, failed, pending, unknown.
3. Normalize step names into: plan, validate, execute, e2e, review, reconcile.
4. Keep original text for diagnostic warnings when parsing is partial.
5. If both STATE and config include mode, prefer STATE and use config as fallback.

State merge rules:
1. ROADMAP supplies phase title order when available.
2. STATE supplies phase status and current-track runtime data.
3. If a phase is in ROADMAP but absent in STATE, render it as unknown.
4. If ROADMAP is missing, rely on STATE phase progress data.
5. If both are partial, render what is available and add warnings.

## Step 2: Display Status

Format and display the status report. Use this exact format:

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

If no phases exist yet (pre-brainstorm), show only Project/Mode and the next action.

Display rules:
1. Keep column alignment readable in monospace output.
2. Use exact status symbols: `✓`, `►`, `✗`, `·`.
3. Do not introduce additional icons, colors, or emoji.
4. If a field is unavailable, render `'none'` or `'unknown'` as applicable.
5. When current track exists, include step status text exactly.

## Step 3: Route to Next Action

Based on the current state, print ONE of these next-action messages:

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
Also mention: 'For small changes, use /kiln:quick "description".'

Always end with: 'Edit .kiln/config.json to adjust preferences.'

Routing precedence (evaluate top to bottom):
1. Completion with `FINAL_REPORT.md` overrides all other suggestions.
2. Missing `VISION.md` is the earliest initialization step.
3. Missing `ROADMAP.md` follows vision completion.
4. Missing track start follows roadmap completion.
5. Active failed track routes to failure recovery.
6. Active in-progress track routes to resume.
7. Fully complete phases without final report routes to final verification.

Routing constraints:
1. Print exactly one primary next-action message from the list above.
2. Include the quick-task line in addition to the one primary message.
3. End with the config-edit reminder line every time.
4. Avoid conflicting guidance in the same response.

## Edge Cases

- If STATE.md is corrupted or unparseable: print 'Warning: STATE.md appears corrupted. Consider running /kiln:init to reinitialize.' Show whatever info can be extracted.
- If ROADMAP.md references phases not in STATE.md: show phases from ROADMAP.md with status 'unknown'.
- If session recovery shows a stale timestamp (>24 hours old): add a note 'Previous session was interrupted. State may need review.'

Edge-case handling notes:
- Keep rendering best-effort and continue with any successfully parsed sections.
- Missing optional fields should not stop status output.
- When timestamps cannot be parsed, omit stale-session logic and continue.
