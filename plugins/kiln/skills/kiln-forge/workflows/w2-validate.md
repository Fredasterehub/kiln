# W2: Validate — Structural Integrity Check

Comprehensive structural validation of the Kiln plugin. Checks agent anatomy, blueprint-agent alignment, hook-agent alignment, data file integrity, and cross-reference consistency.

## Prerequisites

Read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-forge/references/plugin-architecture.md` for the dependency graph and cross-reference matrices.

## Validation Checks

Run all checks, report results as a table. Each check: PASS / WARN / FAIL with details.

### Check 1: Agent Anatomy

For each `.md` file in `plugin/agents/`:

1. **Frontmatter present** — has `---` delimited YAML with required fields
2. **Required fields** — `name`, `description`, `tools`, `model`, `color`
3. **Name matches filename** — `name: codex` in `codex.md`
4. **Model is valid** — one of: `opus`, `sonnet`, `haiku`
5. **Color is valid** — one of: `red`, `green`, `blue`, `yellow`, `magenta`, `cyan`, `white`
6. **Tools list valid** — only known tools (Read, Write, Edit, Bash, Glob, Grep, SendMessage, Agent)
7. **Description mentions "Internal Kiln agent"** — identifies it as non-user-facing
8. **Has security section** — "Never read" patterns for sensitive files
9. **Has shutdown protocol** — mentions `shutdown_response`
10. **Has team-protocol.md reference** — reads team communication protocol

Validate using `agent-anatomy.md` for the full template.

### Check 2: Blueprint-Agent Alignment

For each blueprint in `plugin/skills/kiln-pipeline/references/blueprints/`:

1. **Every agent in roster exists** — has a matching `.md` file in `plugin/agents/`
2. **Phase assignments match step-definitions.md** — Phase A/B/C roles are consistent
3. **Model in blueprint matches agent .md** — no contradictions
4. **Communication model is valid** — all message paths reference real agent names
5. **Team name pattern is correct** — uses `{run_id}-{step_name}` or `{kill_streak_name}`

### Check 3: Hook-Agent Alignment

Read `enforce-pipeline.sh` and verify:

1. **Every hooked agent exists** — agent names in hook conditions match real agents
2. **Hook restrictions match agent instructions** — if hook blocks Write/Edit, agent .md should NOT list Write/Edit in tools
3. **Sequencing gates reference real files** — status-checked files (.kiln/docs/*.md) match artifact-flow.md
4. **No orphan hooks** — every hook condition can actually trigger (agent name spelled correctly, tool name valid)

### Check 4: Data File Integrity

For each file in `plugin/skills/kiln-pipeline/data/`:

1. **Valid JSON** — parses without error
2. **agents.json** — every active (non-retired) agent has a matching `.md` file; every agent `.md` file has an agents.json entry
3. **spinner-verbs.json** — has expected categories (generic, onboarding, brainstorm, research, architecture, build, review, validation); each category has 8 verbs
4. **lore.json** — has `greetings` and step transition quotes
5. **No stale references** — no references to retired agents or removed steps

### Check 5: Cross-Reference Matrix

Build a matrix and check for orphans:

| Entity | Referenced By | Check |
|--------|--------------|-------|
| Agent .md | blueprints, agents.json, hooks, SKILL.md | All references resolve |
| Blueprint | SKILL.md, step-definitions.md | All references resolve |
| Hook condition | agent .md files (tool lists) | Consistent |
| Data file | scripts (kb.sh), SKILL.md (lore-engine.md) | All consumers exist |
| Artifact path | artifact-flow.md, hooks, agent .md files | Consistent paths |

### Check 6: SKILL.md (Pipeline Engine)

1. **State machine completeness** — all stages have transitions defined
2. **Step count matches** — 7 steps, 7 banner mappings, 7 blueprints
3. **Blueprint paths valid** — all `step-{N}-{name}.md` references exist
4. **Signal handling complete** — all signals from step-definitions.md are handled

## Output Format

```
╔══════════════════════════════════════════════╗
║  KILN FORGE — Validation Report              ║
╚══════════════════════════════════════════════╝

Check 1: Agent Anatomy ........................ PASS (23/23)
Check 2: Blueprint-Agent Alignment ............ PASS (7/7)
Check 3: Hook-Agent Alignment ................. PASS (13/13)
Check 4: Data File Integrity .................. WARN (4/5 — 1 stale ref)
Check 5: Cross-Reference Matrix ............... PASS
Check 6: Pipeline Engine ...................... PASS

Details:
  WARN: agents.json contains 10 retired entries — consider cleanup

Overall: PASS with 1 warning
```

After running, append results summary to `run-history.json` as a validation run.
