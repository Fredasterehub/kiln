# W1: Refine — Agent or Component Improvement

Structured workflow for making targeted improvements to the Kiln plugin. Every change follows: identify → understand → check history → propose → implement → validate → track.

## Prerequisites

Read these before starting:
- `${CLAUDE_PLUGIN_ROOT}/skills/kiln-forge/references/plugin-architecture.md` — dependency graph, cross-references
- `${CLAUDE_PLUGIN_ROOT}/skills/kiln-forge/data/evolution-log.json` — what was changed before and why

## Workflow

### Step 1: Identify Target

Clarify with the user:
- **What** to change (specific agent, hook, blueprint, data file, script)
- **Why** it needs changing (observed behavior, failed test, user report)
- **Scope**: single file or cross-cutting concern?

### Step 2: Read Current State

Read the target file(s). For agents, also read:
- The agent's `.md` file in `plugin/agents/`
- The blueprint that references it (see plugin-architecture.md § Agent-Blueprint Matrix)
- Any hooks that constrain it (see plugin-architecture.md § Hook-Agent Matrix)
- Related data files (agents.json entry, spinner-verbs.json category)

### Step 3: Check History

Read `evolution-log.json` — filter for entries touching the same file or component. Understand:
- Was this changed before? What happened?
- Is there a pattern of repeated fixes (symptom of a deeper issue)?
- Are there related changes that might conflict?

Also check `${CLAUDE_PLUGIN_ROOT}/../../../TWEAKS.md` for open findings related to this component.

### Step 4: Propose Fix

Present to the user:
1. **Root cause** — why the current state is wrong
2. **Proposed change** — specific edits, with diffs if complex
3. **Impact analysis** — which other files are affected (from cross-reference matrix)
4. **Risk** — what could break, how to verify

Wait for user approval before implementing.

### Step 5: Implement

Make the change. Follow conventions from `agent-anatomy.md` for agent files.

If the change touches:
- An agent `.md` → check if its blueprint needs updating
- A blueprint → check if step-definitions.md needs updating
- A hook in `enforce-pipeline.sh` → check if affected agents' instructions reference the hook behavior
- A data file → check if any script or agent reads it (see plugin-architecture.md § Data Consumers)
- `SKILL.md` (pipeline) → this is the engine — tread carefully, verify state machine logic

### Step 6: Validate

Run `w2-validate.md` checks on the affected component:
- Agent anatomy check (if agent file changed)
- Blueprint-agent alignment (if blueprint or agent changed)
- Hook-agent alignment (if hook or agent changed)
- Data file integrity (if data file changed)

### Step 7: Track

Append to `evolution-log.json`:
```json
{
  "timestamp": "{ISO 8601}",
  "file": "{path relative to plugin/}",
  "component": "{agent|blueprint|hook|data|script|skill}",
  "change": "{what was changed — specific and concise}",
  "rationale": "{why — the root cause and reasoning}",
  "impact": ["{list of other files affected}"],
  "smoke_test": "{ST number that motivated this, or 'manual'}",
  "verified": false
}
```

Set `verified: true` after the next smoke test confirms the fix works.

Update `plugin-state.json` → `last_change` timestamp.

## Common Refinement Patterns

### Prompt Wording Fix
Target is usually instruction clarity. Check if the agent correctly interprets the instruction by reading the agent's recent behavior from TWEAKS.md findings.

### Structural Fix
The instruction says the right thing but the agent doesn't follow it. Usually means the information is in the wrong place (too deep in the prompt, after conflicting instructions) or the format doesn't match how the model processes it (instruction-based vs structural/template-based).

### Cross-Reference Fix
A change in one file broke an assumption in another. Use plugin-architecture.md to trace all dependents before fixing.

### Hook Tuning
Hooks block or allow too aggressively. Check the hook's regex/condition against actual tool call inputs from smoke test logs.
