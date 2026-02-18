---
name: kiln:reset
description: Save session state to memory and prepare for context reset (/clear)
allowed-tools:
  - Read
  - Write
  - Bash
  - Task
  - SendMessage
---

<objective>
Save all session state to persistent memory files before a context reset so no critical work is lost. Capture a complete warm handoff in MEMORY.md, because that handoff note is what /kiln:resume uses to restore context in the next session. Ensure decisions and pitfalls are conditionally updated when new information exists. After this command finishes, the operator must run /clear manually because Claude Code cannot execute /clear programmatically.
</objective>

<process>

<step name="detect">
Use `Bash` to run `pwd` and capture the absolute current working directory as `PROJECT_PATH`.

Use `Bash` to compute the encoded project path exactly as:
```bash
echo "$PROJECT_PATH" | sed 's|/|-|g'
```
Store that output as `ENCODED`, then construct `MEMORY_DIR="$HOME/.claude/projects/$ENCODED/memory"` to match the Kiln memory convention.

Check whether the memory directory exists with `[ -d "$MEMORY_DIR" ]`. If it does not exist, create it with `mkdir -p "$MEMORY_DIR"`.

If `"$MEMORY_DIR/MEMORY.md"` exists, use the `Read` tool to load it and extract current state details such as stage, phase, active tasks, and recent handoff context. If it does not exist, continue with sensible defaults such as `stage: unknown` and `phase: unknown`.
</step>

<step name="save-state">
Use `Bash` to generate a UTC reset timestamp:
```bash
date -u +"%Y-%m-%dT%H:%M:%SZ"
```
Store the result and write a complete memory snapshot to `"$MEMORY_DIR/MEMORY.md"` using the `Write` tool with this exact structure:

```markdown
# Kiln Project Memory

## Status

status: paused
reset_at: <ISO-8601 timestamp from `date -u +"%Y-%m-%dT%H:%M:%SZ"`>
project: <$PROJECT_PATH>

## Current Position

stage: <current stage, e.g. "planning", "implementation", "review" - infer from context>
phase: <current phase name or number if known, otherwise "unknown">

## Warm Handoff

### What Was Being Worked On

<1-3 sentences describing the specific task or step in progress at time of reset. Be concrete: name the file, function, or feature being implemented or discussed.>

### Agent Context

<List any active sub-agents by name/role that were running or recently used. List any pending tasks that were queued but not yet started. If no agents were active, write "No active agents at time of reset.">

### Operator Note

<A plain-language message for the human operator. Summarize what happened this session in 2-4 sentences. What was accomplished? What is the current state of the work? What should they be aware of before resuming?>

### Next Action

<The single most important next action to take when resuming. Be specific: name the exact command, file, or function to start with. This must be concrete enough that a fresh Claude Code session with no other context can act on it.>

## Notes

<Any other relevant context that does not fit above. Can be left empty.>
```

Populate all fields using current session context. Do not use stub text; if a value cannot be determined, write an honest `unknown` value where appropriate.
</step>

<step name="shutdown-agents">
Determine whether any Kiln sub-agents are active by using the `Task` tool to list running tasks and by checking recently spawned agent context in the current session.

If active agents are found, use `SendMessage` to send each one a `shutdown_request` with this exact message:
```text
Shutdown requested. Please save any work in progress and acknowledge.
A context reset is about to occur. Note your current state before stopping.
```

Wait up to 10 seconds for acknowledgment from each agent. If an agent does not acknowledge within 10 seconds, mark it as `no acknowledgment received`.

Record each agent name and final status as one of: `acknowledged`, `timed out`, or `not started`.

If no active agents are found, skip shutdown messaging and record `No active agents`.
</step>

<step name="write-decisions">
Use `Read` to check whether `"$MEMORY_DIR/decisions.md"` exists. If it exists, read it and compare existing entries against decisions made or referenced in this session.

For each new decision not already recorded, append this block:
```markdown

---

## Decision: <title>

**Date:** <today's date>
**Context:** <brief description of the situation that prompted this decision>
**Decision:** <what was decided>
**Rationale:** <why>
**Alternatives considered:** <other options that were weighed, or "none">
```

If `decisions.md` does not exist and at least one new decision was made this session, create it with:
```markdown
# Decisions

Project decisions, rationale, and context for future reference.
```
Then append the new decision entries.

If no new decisions were made this session, do not modify an existing file and do not create a new file.
</step>

<step name="write-pitfalls">
Use `Read` to check whether `"$MEMORY_DIR/pitfalls.md"` exists. If it exists, read it and compare existing entries against pitfalls discovered in this session.

For each newly discovered pitfall not already recorded, append this block:
```markdown

---

## Pitfall: <title>

**Discovered:** <today's date>
**Symptom:** <what the problem looked like when encountered>
**Cause:** <root cause, if known>
**Workaround / Fix:** <how to handle or avoid it>
**Affects:** <which files, systems, or workflows are impacted>
```

If `pitfalls.md` does not exist and at least one new pitfall was discovered this session, create it with:
```markdown
# Pitfalls

Known issues, gotchas, and things to avoid in this project.
```
Then append the new pitfall entries.

If no new pitfalls were discovered this session, do not modify an existing file and do not create a new file.
</step>

<step name="confirm">
After state persistence and optional updates are complete, display this block with actual values substituted:

```text
=== Kiln Reset ===
State saved to memory.

Memory directory: <$MEMORY_DIR>
Files written:
  - MEMORY.md        (status: paused, handoff note recorded)
  - decisions.md     (<N new decisions recorded> | not modified)
  - pitfalls.md      (<N new pitfalls recorded> | not modified)

Active agents: <"shut down" with agent names | "N still running (no acknowledgment)" | "none">

What was preserved:
  - Current stage and phase
  - Warm handoff note (what was being worked on)
  - Agent context and pending tasks
  - Operator note and next action

What will be lost after /clear:
  - Full conversation history
  - In-memory reasoning and intermediate results
  - Any tool call outputs not written to disk

Next steps:
  1. Type /clear to reset context
  2. Type /kiln:resume to continue from where you left off
====================
```

After displaying the block, add exactly one reminder sentence: Claude Code cannot run /clear automatically - you must type it yourself after this message.
</step>

</process>

<success_criteria>
- [ ] `$MEMORY_DIR` exists on disk
- [ ] MEMORY.md has been written with `status: paused`
- [ ] MEMORY.md contains a non-empty "What Was Being Worked On" section
- [ ] MEMORY.md contains a non-empty "Next Action" section
- [ ] decisions.md updated if new decisions were made this session
- [ ] pitfalls.md updated if new pitfalls were discovered this session
- [ ] Active agents received shutdown_request (or "none" confirmed)
- [ ] Confirmation block displayed to operator
- [ ] Operator informed that /clear must be run manually
</success_criteria>
