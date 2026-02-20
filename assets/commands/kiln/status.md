---
name: kiln:status
description: Display current pipeline progress and project status
allowed-tools:
  - Read
  - Bash
  - Glob
---

<objective>
Read MEMORY.md and display a comprehensive, formatted progress summary. This is a read-only command that never modifies any files.
</objective>

<process>

<step name="detect">
Use `Bash` to run `pwd` and capture `PROJECT_PATH`.
Compute `ENCODED_PATH` and `MEMORY_DIR` using the same path contract as other commands.
Set `CLAUDE_HOME="$HOME/.claude"` and `KILN_DIR="$PROJECT_PATH/.kiln"`.
</step>

<step name="read-memory">
Read `$MEMORY_DIR/MEMORY.md`. If missing, display:
```
[kiln:status] No memory found. Run /kiln:start to begin.
```
Extract all canonical fields.
</step>

<step name="read-supplementary">
Read these files if they exist (skip silently if missing):
- `$MEMORY_DIR/vision.md` - extract project name and problem statement
- `$MEMORY_DIR/master-plan.md` - extract phase count and names
- `$KILN_DIR/config.json` - extract model mode and preferences
- `$KILN_DIR/validation/report.md` - extract latest verdict if exists
</step>

<step name="display">
Display a formatted status block:

```
=== Kiln Status ===
Project:    [project_name]
Path:       [PROJECT_PATH]
Mode:       [project_mode]
Model:      [model_mode from config, or "multi-model" default]
Started:    [date_started]
Updated:    [last_updated]

Stage:      [stage] ([status])
Debate:     mode [debate_mode]
Brainstorm: [brainstorm_depth]

[If stage is planning:]
Planning:   [planning_sub_stage]

[If stage is execution:]
Phase:      [phase_number]/[phase_total] - [phase_name]

[If correction_cycle > 0:]
Correction: cycle [correction_cycle]/3

## Phase Progress
[For each phase in Phase Statuses:]
  [checkmark/spinner/x] Phase [N]: [name] - [status]

[If validation report exists:]
## Validation
Verdict: [verdict]
Report:  $KILN_DIR/validation/report.md

## Handoff
[handoff_note]

## Next Action
[Derive recommended next action based on stage/status:]
- brainstorm + in_progress -> "Continue brainstorming with /kiln:resume"
- planning + paused -> "Review master plan with /kiln:resume"
- execution + in_progress -> "Continue execution with /kiln:resume"
- validation + blocked -> "Review validation failures, then /kiln:resume"
- complete -> "Project is done. Start a new one with /kiln:start"
====================
```
</step>

</process>

<success_criteria>
- [ ] Memory directory detected correctly
- [ ] All available information displayed
- [ ] No files modified
- [ ] Graceful handling of missing files
- [ ] Recommended next action is accurate
</success_criteria>
