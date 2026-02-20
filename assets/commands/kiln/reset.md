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
Set `CLAUDE_HOME="$HOME/.claude"`. Store the encoded output as `ENCODED`, then construct `MEMORY_DIR="$CLAUDE_HOME/projects/$ENCODED/memory"` to match the Kiln memory convention.

Check whether the memory directory exists with `[ -d "$MEMORY_DIR" ]`. If it does not exist, create it with `mkdir -p "$MEMORY_DIR"`.

If `"$MEMORY_DIR/MEMORY.md"` exists, use the `Read` tool to load it and extract current canonical fields (`project_name`, `date_started`, `stage`, `status`, `planning_sub_stage`, `debate_mode`, `phase_number`, `phase_name`, `phase_total`, `handoff_note`, and `## Phase Statuses` entries). If it does not exist, continue with canonical defaults:
- `stage: brainstorm`
- `status: paused`
- `planning_sub_stage: null`
- `debate_mode: 2`
- `phase_number: null`
- `phase_name: null`
- `phase_total: null`
</step>

<step name="save-state">
Use `Bash` to generate a UTC reset timestamp:
```bash
date -u +"%Y-%m-%dT%H:%M:%SZ"
```
Store the result and write a complete memory snapshot to `"$MEMORY_DIR/MEMORY.md"` using the `Write` tool with this exact canonical structure:

```markdown
# Kiln Project Memory

## Metadata
project_name: <existing value, or basename of $PROJECT_PATH>
project_path: <$PROJECT_PATH>
date_started: <existing value, or today's date YYYY-MM-DD>
last_updated: <ISO-8601 timestamp from `date -u +"%Y-%m-%dT%H:%M:%SZ"`>

## Runtime
stage: <current stage using only: brainstorm|planning|execution|validation|complete; default brainstorm>
status: paused
planning_sub_stage: <dual_plan|debate|synthesis|null>
debate_mode: <1|2|3; default 2>
phase_number: <integer or null>
phase_name: <string or null>
phase_total: <integer or null>

## Handoff
handoff_note: <non-empty warm handoff summary that includes what was in progress and the concrete next action>
handoff_context: |
  <2-4 sentence narrative describing current session state in detail: what phase/stage
  is active, what tasks have been completed, what branch is checked out, what the operator
  was working on, and what specific action should happen next. Include file paths and
  function names where relevant.>

## Phase Statuses
<Preserve existing phase status lines in this exact format when present:>
- phase_number: <int> | phase_name: <string> | phase_status: <pending|in_progress|failed|completed>

## Resume Log
<Preserve existing lines if present, then append:>
- Reset: <ISO-8601 timestamp from `date -u +"%Y-%m-%dT%H:%M:%SZ"`>

## Reset Notes
what_was_being_worked_on: <1-3 concrete sentences naming file/function/feature in progress>
agent_context: <active agents and pending work, or "No active agents">
operator_note: <2-4 sentence plain-language summary for the operator>
next_action: <single concrete next action to run on resume>
```

Populate all fields using current session context. Do not use stub text. For enum fields, never invent values outside the canonical sets above.
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

After agent shutdown, delete the session team if it exists: check for `$CLAUDE_HOME/teams/kiln-session/config.json` — if present, call `TeamDelete("kiln-session")`.
</step>

<step name="append-memory-entries">
For each of `decisions.md` and `pitfalls.md`:
- Use `Read` to check whether `"$MEMORY_DIR/<file>"` exists. If it exists, read it and compare existing entries against content from this session.
- If no new relevant content was identified this session, do not modify the file and do not create it.
- If new content exists, append a dated entry using the same format already in the file:
  - For `decisions.md`: append a `## Decision: <title>` block with Date, Context, Decision, Rationale, and Alternatives considered.
  - For `pitfalls.md`: append a `## Pitfall: <title>` block with Discovered, Symptom, Cause, Workaround/Fix, and Affects.
- If the file does not exist but new content was found, create it first with a minimal H1 header (`# Decisions` or `# Pitfalls`) before appending.
</step>

<step name="confirm">
After state persistence and optional updates are complete, display this block with actual values substituted:

```text
=== Kiln Reset ===
State saved to memory.

Memory directory: <$MEMORY_DIR>
Files written:
  - MEMORY.md        (canonical schema, status: paused, handoff note recorded)
  - decisions.md     (<N new decisions recorded> | not modified)
  - pitfalls.md      (<N new pitfalls recorded> | not modified)

Active agents: <"shut down" with agent names | "N still running (no acknowledgment)" | "none">

What was preserved:
  - Current stage and phase fields (canonical schema)
  - Warm handoff note (current work + next action)
  - Agent context and pending tasks
  - Operator note and explicit next action

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
- [ ] MEMORY.md uses canonical `stage` values: `brainstorm|planning|execution|validation|complete`
- [ ] MEMORY.md uses canonical `status` values: `in_progress|paused|blocked|complete`
- [ ] MEMORY.md contains a non-empty `handoff_note`
- [ ] MEMORY.md contains a non-empty `next_action` in `## Reset Notes`
- [ ] decisions.md updated if new decisions were made this session
- [ ] pitfalls.md updated if new pitfalls were discovered this session
- [ ] Active agents received shutdown_request (or "none" confirmed)
- [ ] Confirmation block displayed to operator
- [ ] Operator informed that /clear must be run manually
</success_criteria>
