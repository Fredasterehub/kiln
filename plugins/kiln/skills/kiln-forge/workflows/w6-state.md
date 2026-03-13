# W6: State — Plugin Status Snapshot

Quick overview of the current plugin state.

## Workflow

### Step 1: Read State

Read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-forge/data/plugin-state.json` for the current snapshot.

### Step 2: Supplement with Live Data

Count actual files to verify state accuracy:

```bash
# Agent count
ls ${CLAUDE_PLUGIN_ROOT}/../agents/*.md | wc -l

# Blueprint count
ls ${CLAUDE_PLUGIN_ROOT}/../skills/kiln-pipeline/references/blueprints/*.md | wc -l

# Hook count (grep for "Hook" comments in enforce-pipeline.sh)
grep -c '^# Hook' ${CLAUDE_PLUGIN_ROOT}/../skills/kiln-pipeline/scripts/enforce-pipeline.sh
```

### Step 3: Check for Open Findings

Read `/DEV/kilntop/TWEAKS.md` and count:
- Open findings (unchecked `- [ ]` items)
- Active tasks (non-done rows in Active Tasks table)

### Step 4: Recent Test Results

Read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-forge/data/run-history.json` — show last 3 runs.

### Step 5: Recent Changes

Read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-forge/data/evolution-log.json` — show last 5 changes.

### Step 6: Display

```
╔══════════════════════════════════════════════╗
║  KILN FORGE — Plugin State                   ║
╚══════════════════════════════════════════════╝

Plugin Version: 1.0.5
Forge Version:  0.1.0

Components:
  Agents .............. 23 (5 retired in agents.json)
  Blueprints .......... 7
  Hooks ............... 13
  Data files .......... 5
  Scripts ............. 2

Health:
  Last validation ..... {date} — {result}
  Open findings ....... {count}
  Active tasks ........ {count}

Recent Runs:
  {date} S5 — {result} ({duration})
  {date} S1 — {result} ({duration})
  {date} S6 — {result} ({duration})

Recent Changes:
  {date} {file} — {change summary}
  {date} {file} — {change summary}
  {date} {file} — {change summary}
```
