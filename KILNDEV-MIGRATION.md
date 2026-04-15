# Kiln ← kilndev Migration Plan

## Status: COMPLETE (2026-04-15)

All 5 phases executed. 34 agents, kilndev skeleton applied, all wiring updated.
- Phase 1: Foundations (protocol, duo-pool, i-am-the-law, agents.json)
- Phase 2: Agent file operations (29 renames, 7 deletes, 4 creates)
- Phase 3: Wiring updates (22 files — scripts, engine, blueprints, refs)
- Phase 4: Agent content purification (34 agents, kilndev skeleton)
- Phase 5: Cosmetic, documentation & final QA sweep

**Date**: 2026-04-14
**Source of truth**: kilndev v0.3.1 (POC + SOP, validated across 6 test runs)
**Target**: Kiln v1.3.0 — purify agent defs using kilndev patterns, keep all domain knowledge

## Philosophy

kilndev = proven team management patterns (POC + SOP). Kiln = the product with domain knowledge.
**Purify kiln by applying kilndev patterns. Not a rewrite — a structural alignment.**

- Keep: all domain logic, 7-step pipeline, step definitions, design system support, multi-milestone, state persistence
- Purify: agent def structure, signal vocabulary, communication patterns, spawn format
- Centralize: duplicated content (security sections, hook gate docs, blocking seam explanations)

## Critical Platform Constraint

**Skills frontmatter is ignored for team agents** (`team_name=something`). The `skills: [...]` field in agent frontmatter is silently dropped when the agent is spawned as part of a team. This is a confirmed Claude Code limitation.

**Belt-and-suspenders (3 layers) is mandatory for ALL agents:**
1. Frontmatter `skills: ["kiln-protocol"]` — works for standalone, harmless for teams
2. Explicit `Read ${CLAUDE_PLUGIN_ROOT}/skills/kiln-protocol/SKILL.md` instruction in agent body — primary layer
3. `Skill: /path/to/kiln-protocol.md` in spawn prompt — backup reference

## Agent Type vs Spawn Name Separation

kilndev pattern: `subagent_type` (the .md filename/template) is a creative descriptive name, separate from `name` (the character spawned). This enables:
- Duo pool rotation for cycled workers (same template, different character names)
- Clear distinction between what an agent IS vs who it IS this cycle
- Better spawn output showing both type and character

### Full Agent Type Roster — LOCKED

**Step 1 — Onboarding**

| Spawn Name | Agent Type | Role |
|---|---|---|
| `alpha` | `the-beginning-of-the-end` | Onboarding lead |
| `mnemosyne` | `the-discovery-begins` | Codebase cartographer / scout coordinator |
| `maiev` | `the-anatomist` | Anatomy scout |
| `curie` | `trust-the-science` | Health scout |
| `medivh` | `follow-the-scent` | Nervous system scout |

**Step 2 — Brainstorm**

| Spawn Name | Agent Type | Role |
|---|---|---|
| `da-vinci` | `the-creator` | Brainstorm facilitator |
| `asimov` | `the-foundation` | Vision curator (replaces clio) |

**Step 3 — Research**

| Spawn Name | Agent Type | Role |
|---|---|---|
| `mi6` | `alpha-team-deploy` | Research director |
| *cycled* | `unit-deployed` | Field researcher |

**Step 4 — Architecture**

| Spawn Name | Agent Type | Role |
|---|---|---|
| `aristotle` | `the-plan-maker` | Architecture coordinator |
| `numerobis` | `pitie-pas-les-crocos` | Technical authority (persistent mind) |
| `confucius` | `mystical-inspiration` | Claude planner |
| `sun-tzu` | `art-of-war` | GPT planner (codex exec wrapper) |
| `diogenes` | `divergences-converge` | Divergence extractor |
| `plato` | `e-pluribus-unum` | Plan synthesizer |
| `athena` | `straight-outta-olympia` | Plan validator |
| `miyamoto` | `gracefully-degrading` | Claude planner fallback (no codex) |

**Step 5 — Build**

| Spawn Name | Agent Type | Role |
|---|---|---|
| `krs-one` | `bossman` | Build boss |
| `rakim` | `dropping-science` | Codebase mind (persistent) |
| `sentinel` | `algalon-the-observer` | Quality mind (persistent) |
| `thoth` | `lore-keepah` | Archivist (persistent) |
| *duo pool* | `dial-a-coder` | GPT builder (codex exec wrapper) |
| *duo pool* | `backup-coder` | Direct builder (Write/Edit) |
| *duo pool* | `la-peintresse` | UI builder |
| *duo pool* | `critical-drinker` | Structural reviewer |
| *duo pool* | `the-curator` | UI reviewer |

**Step 5 — QA Tribunal (Judge Dredd team)**

| Spawn Name | Agent Type | Role |
|---|---|---|
| `ken` | `team-red` | QA checker Sonnet |
| `ryu` | `team-blue` | QA checker GPT |
| `denzel` | `the-negotiator` | QA reconciler |
| `judge-dredd` | `i-am-the-law` | QA judge (final verdict) |

**Step 6 — Validate**

| Spawn Name | Agent Type | Role |
|---|---|---|
| `argus` | `release-the-giant` | Validator |
| `zoxea` | `le-plexus-exploseur` | Architecture verifier |
| `hephaestus` | `style-maker` | Design QA (conditional) |

**Step 7 — Report**

| Spawn Name | Agent Type | Role |
|---|---|---|
| `omega` | `the-end-of-the-beginning` | Final reporter |

**Dormants — No agent .md files, kept in duo pool only**

| Spawn Names | Pool | Status |
|---|---|---|
| `daft` / `punk` | `opus: reserved` | Roster placeholder |
| `tetsuo` / `kaneda` | `fallback` alt duo | Active in duo pool as spawn names |

## QA Tribunal — Egyptian → Judge Dredd

Replace the Egyptian mythology tribunal (maat, anubis, osiris) with the kilndev Judge Dredd team:
- `maat` → `team-red` (ken) — Sonnet checker
- `anubis` → `team-blue` (ryu) — GPT checker (codex exec)
- `osiris` → `the-negotiator` (denzel) — reconciler (NEW: was combined with judge in osiris)
- *(new)* → `i-am-the-law` (judge-dredd) — judge (NEW: separated from reconciler)

Structural gain: 4 agents with 4 distinct roles (check, check, reconcile, judge) instead of 3 agents where osiris did reconciler+judge.

Engine handles anonymization between checkers and reconciler/judge (strip agent names, randomize A/B).

## Duo Pool — Worker Naming Rotation

Adopt kilndev's duo pool for cycled workers (step 5 build iterations):

| Pool | Duo ID | Builder Name | Reviewer Name | Builder Type | Reviewer Type |
|---|---|---|---|---|---|
| `default` | `codex-sphinx` | `codex` | `sphinx` | `dial-a-coder` | `critical-drinker` |
| `default` | `tintin-milou` | `tintin` | `milou` | `dial-a-coder` | `critical-drinker` |
| `default` | `mario-luigi` | `mario` | `luigi` | `dial-a-coder` | `critical-drinker` |
| `default` | `lucky-luke` | `lucky` | `luke` | `dial-a-coder` | `critical-drinker` |
| `fallback` | `kaneda-tetsuo` | `kaneda` | `tetsuo` | `backup-coder` | `critical-drinker` |
| `fallback` | `athos-porthos` | `athos` | `porthos` | `backup-coder` | `critical-drinker` |
| `ui` | `clair-obscur` | `clair` | `obscur` | `la-peintresse` | `the-curator` |
| `ui` | `yin-yang` | `yin` | `yang` | `la-peintresse` | `the-curator` |

Boss picks duo from pool with timestamp-seeded rotation. Engine spawns with boss-selected names.

## Agent Def Skeleton — kilndev Pattern

Every agent follows this structure:

```markdown
---
name: {agent-type-name}
model: sonnet
color: {functional-group-color}
description: "{one-line role description}"
skills: ["{protocol-skill}"]
---

**Bootstrap:** Read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-protocol/SKILL.md`.
You are `{MY_NAME}`, {one sentence role description}.

## Shared Protocol
Read `${CLAUDE_PLUGIN_ROOT}/skills/kiln-protocol/SKILL.md` for signal vocabulary and rules.

## Teammate Names
{List every agent this one can message, with exact names}

## Protocol
{Numbered steps. Exact signal formats. Every target uses spawn prompt variables.}

## Rules
- NEVER {hard interdicts with specific tools and targets}
- MAY {explicit whitelist of what IS allowed despite NEVER rules}
```

Key changes from current kiln agents:
- Identity in bootstrap line, not buried later
- Teammate Names section (currently missing in all 36 agents)
- NEVER/MAY structured rules (currently narrative in most agents)
- Duplicated content moved to kiln-protocol (security, hook gates, blocking seam)

## Spawn Output Format

Adopt kilndev's spawn indicator showing type + name + personality quote:

```
◆ Spawning → `rakim` + `sentinel` + `thoth`
  → `rakim` (`dropping-science`) — "Follow the leader — the codebase remembers."
  → `sentinel` (`algalon-the-observer`) — "Quality is not negotiable."
  → `thoth` (`lore-keepah`) — "Every signal, every breadcrumb — I keep the record."
```

Kiln's existing lore (transition voices, step banners, kill streak banners) stays. The spawn indicator format changes to show the type/name/quote triplet. Lore wraps around the mechanical output:

```
KRS-One takes the stage...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▸ **HYPER COMBO** · *Iteration 4* · **Milestone 2/5**
`"Knowledge reigns supreme over nearly everyone."` — *KRS-One*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

◆ Spawning → `tintin` + `milou`
  → `tintin` (`dial-a-coder`) — "One prompt, one invocation, one verified output."
  → `milou` (`critical-drinker`) — "Show me the file. I'll show you the verdict."
```

## Centralization — Move to kiln-protocol

Content currently duplicated across agents that should live once in kiln-protocol:

1. **Security section** (18 agents): `Never read: .env, *.pem, *_rsa, *.key, credentials.json, secrets.*, .npmrc`
2. **Hook gate documentation** (3 agents): `<!-- status: complete -->` explanation
3. **Blocking seam explanation** (5 agents): wait for READY from both minds
4. **ARCHIVE thoth pattern** (12+ agents): SendMessage template
5. **Bash sed/git inline** (4+ agents): STATE.md update commands

## Hooks — Belt-and-Suspenders Backup

The enforce-pipeline.sh hook for codex Write/Edit blocking has never fired in kilndev (agents comply via instructions). Keep it as belt-and-suspenders backup but primary enforcement is via agent defs + NEVER/MAY rules.

## Spawn Name vs Agent Type — Wiring Rules

**Critical distinction that affects ALL wiring:**

- **Agent type** = the `.md` filename = the `subagent_type:` parameter at spawn = what the agent IS
- **Spawn name** = the `name:` parameter at spawn = who the agent IS this cycle = what other agents use in SendMessage

**SendMessage always uses spawn names, never agent types.** When codex does `SendMessage(recipient: "krs-one")`, "krs-one" is the spawn name, not the agent type "bossman".

**For persistent agents** (krs-one, rakim, sentinel, thoth, etc.): spawn name is fixed and well-known. SendMessage targets in agent defs DON'T change — they already use spawn names.

**Exception — clio → asimov**: The only persistent agent whose spawn name changes. ALL `recipient: "clio"` must become `recipient: "asimov"` across agent defs and blueprints.

**For cycled workers** (duo pool): spawn names are dynamic (`{MY_NAME}`, `{BOSS_NAME}`, `{REVIEWER_NAME}` from spawn prompt). Agent defs already use variables — no wiring change needed.

## Wiring Impact — Full File Audit

### CRITICAL — Pipeline breaks without these

| File | What changes | Why |
|---|---|---|
| `plugins/kiln/agents/*.md` (33 files) | Rename files to new agent type names | subagent_type = filename |
| `agents.json` | Rename ALL top-level JSON keys to new agent types | Engine looks up quotes by subagent_type |
| `enforce-pipeline.sh` lines 91-96 | Update agent whitelist (pipeline context gate) | Unknown agents bypass enforcement |
| `enforce-pipeline.sh` lines 282-287 | Update subagent_type whitelist (spawn validation) | Unknown types get rejected |
| `enforce-pipeline.sh` Hook 1 (line 109) | `$AGENT == "codex"` → `$AGENT == "dial-a-coder"` | Write/Edit block for codex wrapper |
| `enforce-pipeline.sh` Hook 2 (line 124) | `$AGENT == "sun-tzu"` → `$AGENT == "art-of-war"` | Write/Edit block for GPT planner |
| `enforce-pipeline.sh` Hook 7 (line 238) | `$AGENT == "argus"` → `$AGENT == "release-the-giant"` | Write/Edit restriction for validator |
| `enforce-pipeline.sh` Hook 7 (line 252) | `$AGENT == "krs-one"` → `$AGENT == "bossman"` | Write/Edit restriction for boss |
| `SKILL.md` (engine) | Update all `subagent_type:` references in spawn logic, worker pair validation, CYCLE_WORKERS, QA tribunal | Engine spawns by type name |
| All 7 blueprint files | Update agent roster tables and `subagent_type:` in spawn instructions | Blueprints define who gets spawned |
| `clio.md` internal refs | All `recipient: "clio"` → `recipient: "asimov"` | Only spawn name that changes for persistents |

### HIGH — Deadlocks if missed

| File | What changes | Why |
|---|---|---|
| `team-protocol.md` | Update agent type references in signal vocabulary docs, step definitions | Documentation accuracy for agents reading protocol |
| `lore-engine.md` | Update agent display names in banner examples, spawning indicators | Operator-facing presentation |
| Blueprint step-2 | `clio` → `asimov` in spawn name references, signal vocabulary sender/receiver | Spawn name changed |

### MEDIUM — Inconsistent but not breaking

| File | What changes | Why |
|---|---|---|
| `brand.md` | Update spawning indicator examples | Cosmetic consistency |
| `audit-bash.sh`, `audit-status-marker.sh` | Update any hardcoded agent names | Audit coverage |
| `gpt54-prompt-guide.md` | Update agent name references | Documentation |
| `design/*.md` | Update hephaestus/clair/obscur references | Documentation |
| `kiln-doctor.md` | Update any agent name references | Diagnostics |

### LOW — Documentation only

| File | What changes | Why |
|---|---|---|
| `README.md` (plugin + root) | Update agent names in docs | Accuracy |
| `validation-strategies.md` | Update agent references | Documentation |

## New Files to Create

| File | Purpose |
|---|---|
| `plugins/kiln/agents/i-am-the-law.md` | QA judge (new role, separated from osiris) |
| `plugins/kiln/skills/kiln-pipeline/references/duo-pool.md` | Worker naming rotation pool |

## Files to Delete

| File | Why |
|---|---|
| `plugins/kiln/agents/daft.md` | Dormant, never activated. Kept in duo pool as name only. |
| `plugins/kiln/agents/punk.md` | Dormant, never activated. Kept in duo pool as name only. |
| `plugins/kiln/agents/tetsuo.md` | Dormant, never activated. Kept in duo pool as spawn name only. |
| `plugins/kiln/agents/maat.md` | Replaced by `team-red.md` |
| `plugins/kiln/agents/anubis.md` | Replaced by `team-blue.md` |
| `plugins/kiln/agents/osiris.md` | Replaced by `the-negotiator.md` + `i-am-the-law.md` |
| `plugins/kiln/agents/clio.md` | Replaced by `the-foundation.md` (spawn name: asimov) |

## What We Do NOT Touch

- Pipeline engine LOGIC (7 steps, state machine, resume, watchdog) — only agent NAME references change
- Hook LOGIC in enforce-pipeline.sh — only agent name strings in whitelists and conditionals
- Reference files content (gpt54-prompt-guide, tdd-protocol, design refs) — only agent name references
- Data files (lore.json, brainstorming-techniques.json, elicitation-methods.json)
- brand.md design principles (only update spawn indicator examples)
- lore-engine.md transition voices (content stays, only agent name references update)
