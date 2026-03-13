---
name: kiln-forge
description: >-
  Kiln plugin development toolkit. Agent refinement, structural validation,
  smoke test scenarios, metrics tracking, diagnosis, plugin state queries.
  Use for: refining agents, validating plugin structure, running test scenarios,
  tracking metrics, diagnosing issues, checking plugin state.
  Do NOT use for: /kiln-fire, pipeline runs, general coding tasks.
version: 0.1.0
user_invocable: false
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent
---

# Kiln Forge — Plugin Development Toolkit

Development toolkit for the Kiln v5 pipeline plugin. Provides structured workflows for agent refinement, structural validation, smoke testing, metrics tracking, and diagnosis.

## Core Principles

1. **One change at a time** — test each fix before layering the next. Never batch unrelated changes.
2. **Explain the why** — every change logged with rationale. "Fixed codex prompt" is not enough — "Fixed codex prompt: skeleton sections were instruction-based but GPT-5.4 ignores instructions mid-context, switched to structural template" is.
3. **Data over vibes** — metrics, artifact checks, before/after comparison. "It feels better" is not a finding.
4. **Track everything** — evolution-log.json captures every change. run-history.json captures every test. Decisions go in decision-log.md.

## Intent Router

Detect the user's intent and dispatch to the appropriate workflow. Read the workflow file, then execute it.

### 1. REFINE — Agent or component improvement

**Triggers**: "refine", "fix", "improve", "update agent", "change prompt", "adjust", mentions of a specific agent name + desired change

**Dispatch**: Read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-forge/workflows/w1-refine.md`, then execute.

### 2. VALIDATE — Structural integrity check

**Triggers**: "validate", "check", "audit", "verify structure", "is everything consistent", "cross-reference"

**Dispatch**: Read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-forge/workflows/w2-validate.md`, then execute.

### 3. TEST — Run smoke test scenario

**Triggers**: "test", "run scenario", "smoke test", "S1", "S5", "S6", "run the build cycle test"

**Dispatch**: Read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-forge/workflows/w3-test.md`, then execute.

### 4. TRACK — View metrics and history

**Triggers**: "metrics", "history", "show results", "how did it go", "compare", "baseline", "trend"

**Dispatch**: Read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-forge/workflows/w4-track.md`, then execute.

### 5. DIAGNOSE — Root cause analysis

**Triggers**: "diagnose", "why did", "root cause", "investigate", "what went wrong", "trace"

**Dispatch**: Read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-forge/workflows/w5-diagnose.md`, then execute.

### 6. STATE — Plugin status snapshot

**Triggers**: "status", "state", "overview", "what version", "how many agents", "last test", "open findings"

**Dispatch**: Read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-forge/workflows/w6-state.md`, then execute.

## Data Files

All forge data lives in `${CLAUDE_PLUGIN_ROOT}/skills/kiln-forge/data/`:

- `plugin-state.json` — current plugin snapshot (version, counts, health)
- `evolution-log.json` — append-only changelog of every plugin modification
- `run-history.json` — smoke test run results with metrics

## References

Architecture knowledge lives in `${CLAUDE_PLUGIN_ROOT}/skills/kiln-forge/references/`:

- `plugin-architecture.md` — complete file inventory, dependency graph, hook-agent matrix, conventions
- `agent-anatomy.md` — template and validation rules for agent .md files
- `metrics.md` — what we measure, thresholds, definitions
- `patterns.md` — validated patterns from smoke tests, anti-patterns

Always read `plugin-architecture.md` before performing REFINE or VALIDATE workflows — it contains the cross-reference matrix that prevents breaking changes.

## Quick Reference: File Counts

| Component | Count | Location |
|-----------|-------|----------|
| Agent .md files | 23 | `plugin/agents/` |
| Blueprints | 7 | `plugin/skills/kiln-pipeline/references/blueprints/` |
| Hooks | 13 (in 1 script) | `plugin/hooks/hooks.json` → `enforce-pipeline.sh` |
| Data files | 5 | `plugin/skills/kiln-pipeline/data/` |
| Reference docs | 6 | `plugin/skills/kiln-pipeline/references/` |
| Commands | 2 | `plugin/commands/` |
| Scripts | 2 | `plugin/skills/kiln-pipeline/scripts/` |
