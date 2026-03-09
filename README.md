<div align="center">

# kiln

**Multi-modal software creation pipeline for Claude Code**

*"What is to give light must endure burning."* — Viktor Frankl

<br>

[![Multi-Model](https://img.shields.io/badge/Multi--Model-Opus_·_GPT--5.4-D4A574?style=flat)]()
[![Pipeline](https://img.shields.io/badge/Pipeline-7_Steps-C1666B?style=flat)]()
[![Agents](https://img.shields.io/badge/Agents-24-4A403A?style=flat)]()
[![Hooks](https://img.shields.io/badge/Hooks-13_Guardrails-2d4a3e?style=flat)]()

<br>

[![License](https://img.shields.io/badge/License-MIT-D4A574?style=for-the-badge)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude_Code-Plugin-7C3AED?style=for-the-badge&logo=anthropic&logoColor=white)](https://claude.ai/claude-code)
[![Codex CLI](https://img.shields.io/badge/Codex_CLI-GPT--5.4-74AA9C?style=for-the-badge)]()
[![Dependencies](https://img.shields.io/badge/Dependencies-Zero-4A403A?style=for-the-badge)]()

<br>

```bash
claude --plugin /path/to/kiln
```

<br>

[What Changed in v5](#what-changed-in-v5) · [How It Works](#how-it-works) · [Get Started](#get-started) · [The Agents](#the-agents) · [The Hooks](#the-hooks) · [Deep Dives](#deep-dives)

</div>

---

I spent months refining a multi-model workflow by hand. Four rewrites taught me what works and what doesn't. v5 is the one that actually runs.

**Opus** brainstorms with you — deep, challenging, no shortcuts.<br>
**GPT-5.4** plans and implements via Codex CLI — surgical prompts, clean code.<br>
**Opus** reviews everything — not right? Back to GPT, rinse and repeat.<br>

Two steps are yours (onboarding + brainstorm). The rest run autonomously — plan, build, test, correct, report. Hands off.

---

## What changed in v5

v5 is a ground-up rewrite. Not an iteration on v4 — a clean slate informed by everything that broke in v1 through v4.

### The big architectural shift

v4 had 26 skills, 13 agents, shell hooks, a Node.js installer, bats tests, JSON state files, and an orchestrator agent that tried to run the show. It worked — sometimes. The orchestrator would lose context, the hook layer was fragile (`grep`/`sed`/`awk` parsing markdown), and the state machine lived across too many files.

**v5 killed all of that.** One skill. One state machine. The main Claude Code session IS the orchestrator — no separate conductor agent, no split-brain risk.

| | v4 | v5 |
|---|---|---|
| Skills | 26 | 1 (`kiln-pipeline`) |
| Agents | 13 | 24 (specialized, single-purpose) |
| Commands | 8 | 2 (`/kiln-fire`, `/kiln-doctor`) |
| Orchestration | Dedicated agent | Main session (lifecycle manager) |
| State | `STATE.md` + `state.json` + hooks | `STATE.md` only |
| Hooks | Shell scripts (session start, task complete) | 13 PreToolUse guardrails |
| Installer | `bin/install.js` (Node.js) | `claude --plugin` (native) |
| Config | `config.json` + templates | Agent `.md` files are the config |

### What actually fixed the problems

**Resume protocol.** v4 sessions died on resume — the conductor couldn't reconstruct where it was. v5 stores `skill` and `roster` paths in STATE.md. `/kiln-fire` reads STATE.md, loads the skill file, and picks up exactly where it left off. Sessions can die and restart cleanly.

**Blueprint split.** v4 loaded full agent prompts into the engine's context at every step — ~22K tokens of repeated instructions. v5 uses `subagent_type` so agents self-load their instructions. The engine only reads a lightweight roster (~500-1200 chars per step). This extends session life past 30+ build iterations before context compaction becomes a problem.

**Sun-Tzu race condition.** In v4, the GPT planner would start before the architect had finished writing architecture docs — planning against empty files. v5 added a three-layer gate: (1) architect sends content-rich BOOTSTRAP_COMPLETE with proof of work, (2) the coordinator needs that reply content to compose the dispatch, (3) planners verify docs exist on disk before proceeding. Plus a PreToolUse hook that blocks planner dispatch until architecture.md is complete.

**Delegation enforcement.** Agents that wrap Codex CLI (codex, plato, sun-tzu) would acknowledge the "use codex exec, don't write code yourself" instruction and then immediately write code directly. v5 strips Write/Edit from their allowed tools AND adds PreToolUse hooks that block those tools with corrective instructions. Belt and suspenders — because verbal acknowledgment from an LLM means nothing.

**INTERACTIVE step protection.** v4's engine would get impatient during brainstorming and re-spawn Da Vinci or take over the interview. v5 has an explicit HANDS OFF rule: during interactive steps, the engine never nudges, re-spawns, or replaces the boss. The human is thinking. Wait.

### The lore layer

This was v4's terminal UX, rebuilt properly. ANSI-colored transition banners, kill streak announcements for build iterations (first-blood, combo, super-combo, hyper-combo...), spinner verbs that change per pipeline step, agent personality quotes on every spawn, and idle voice that says things like "Tempering the iron..." instead of "Standing by."

All data-driven: `lore.json` (23 transition points), `spinner-verbs.json` (64 verbs across 8 categories), `agents.json` (24 agents with personality quotes). The engine reads the rendering spec once and follows it all session.

---

## How it works

It's not a wrapper. It's not a server. It's a set of markdown files — agents, skills, commands, and hooks — that get installed as a Claude Code plugin. Two commands. `/kiln-fire` to start. `/kiln-doctor` to check prerequisites.

<table>
<tr>
<td align="center" width="40"><b>1</b></td>
<td width="130"><b>Onboarding</b></td>
<td>Alpha greets you, detects your project (brownfield/greenfield), maps the codebase if needed.</td>
<td width="130"><code>.kiln/STATE.md</code></td>
</tr>
<tr>
<td align="center"><b>2</b></td>
<td><b>Brainstorm</b></td>
<td>Da Vinci interviews you — pushing ideas, poking holes, going deeper. Visionary crystallizes the vision in real time.</td>
<td><code>VISION.md</code></td>
</tr>
<tr><td colspan="4"></td></tr>
<tr>
<td align="center"><b>3</b></td>
<td><b>Research</b></td>
<td>MI6 deploys field agents (sherlock, watson, poirot...) to investigate open questions. Agent #7 is always bond.</td>
<td><code>research/*.md</code></td>
</tr>
<tr>
<td align="center"><b>4</b></td>
<td><b>Architecture</b></td>
<td>Aristotle coordinates: Confucius (Claude) and Sun Tzu (GPT-5.4) plan separately. Socrates makes them debate. Plato synthesizes. Athena validates — up to 3 attempts.</td>
<td><code>master-plan.md</code></td>
</tr>
<tr>
<td align="center"><b>5</b></td>
<td><b>Build</b></td>
<td>KRS-One scopes one chunk at a time. Codex implements via GPT-5.4. Sphinx reviews. Architect and Sentinel maintain living docs. Kill streak team names per iteration.</td>
<td>Code + commits</td>
</tr>
<tr>
<td align="center"><b>6</b></td>
<td><b>Validate</b></td>
<td>Argus tests against acceptance criteria with architect on standby. Pass → report. Fail → back to build (max 3 correction cycles).</td>
<td><code>validation/</code></td>
</tr>
<tr>
<td align="center"><b>7</b></td>
<td><b>Report</b></td>
<td>Omega compiles the final project report from all pipeline artifacts.</td>
<td><code>REPORT.md</code></td>
</tr>
</table>

> Steps 3-7 are fully autonomous. Build iterates per milestone until everything ships.

---

## Get started

```bash
# Install as a Claude Code plugin
claude --plugin /path/to/kiln

# Or with the flag on every session
claude --plugin /path/to/kiln --dangerously-skip-permissions
```

Then:

| Command | What it does |
|---------|-------------|
| `/kiln-fire` | Start or resume the pipeline |
| `/kiln-doctor` | Check prerequisites and diagnose issues |

<details>
<summary><b>Prerequisites</b></summary>

<br>

| Tool | What it adds | Required? |
|------|-------------|-----------|
| [Claude Code](https://claude.ai/claude-code) | The engine | Yes |
| [Codex CLI](https://github.com/openai/codex) | GPT-5.4 planning + implementation | Yes |
| GPT-5.4 API access | Via OpenAI API key | Yes |

```bash
npm install -g @openai/codex-cli
```

Run `/kiln-doctor` to verify everything is ready.

> **`--dangerously-skip-permissions`** — Kiln spawns agents, writes files, and runs builds constantly. Permission prompts break the flow. Only use this in projects you trust.

<br>
</details>

---

## The agents

24 agents, each with one job. The main session spawns them into teams per step and manages lifecycle.

### Step 1 — Onboarding
| Agent | Model | Role |
|-------|-------|------|
| **Alpha** | Opus | Interviews the operator, sets up .kiln/ |
| **Mnemosyne** | Opus | Maps brownfield codebases (spawns 5 scouts) |
| Atlas, Nexus, Spine, Signal, Bedrock | Opus | Mnemosyne's mapper scouts |

### Step 2 — Brainstorm
| Agent | Model | Role |
|-------|-------|------|
| **Da Vinci** | Opus | Facilitates vision discovery with the operator |
| Visionary | Opus | Receives vision updates, writes VISION.md |

### Step 3 — Research
| Agent | Model | Role |
|-------|-------|------|
| **MI6** | Opus | Research coordinator, spawns field agents dynamically |
| Field Agent | Sonnet | Investigates one research topic (sherlock, watson, poirot...) |

### Step 4 — Architecture
| Agent | Model | Role |
|-------|-------|------|
| **Aristotle** | Opus | Orchestrates the planning pipeline |
| Architect | Opus | Technical authority — owns architecture docs |
| Confucius | Opus | Claude planner |
| Sun Tzu | Sonnet | GPT-5.4 planner (via Codex CLI) |
| Socrates | Opus | Makes planners debate |
| Plato | Sonnet | Synthesizes into master plan (via Codex CLI) |
| Athena | Opus | Validates the plan — approve or fail |

### Step 5 — Build
| Agent | Model | Role |
|-------|-------|------|
| **KRS-One** | Opus | Build boss — scopes chunks, conducts QA at milestones |
| Codex | Sonnet | Implements via GPT-5.4 (`codex exec`) |
| Sphinx | Sonnet | Quick code review |
| Architect | Opus | Persistent mind — maintains codebase state |
| Sentinel | Opus | Persistent mind — maintains patterns and pitfalls |

### Step 6 — Validate
| Agent | Model | Role |
|-------|-------|------|
| **Argus** | Opus | Tests against acceptance criteria |
| Architect | Opus | On standby for consultation |

### Step 7 — Report
| Agent | Model | Role |
|-------|-------|------|
| **Omega** | Opus | Compiles final REPORT.md |

---

## The hooks

v5 replaces v4's shell hook scripts with a single PreToolUse hook (`enforce-pipeline.sh`) that runs 13 stateless checks across 4 categories. Exit 2 + stderr = blocked with corrective instructions. Exit 0 = allowed.

### Delegation (hooks 1-3)

Agents that wrap Codex CLI must not write files directly. If codex, plato, or sun-tzu try to use Write or Edit, the hook blocks them and prints their correct workflow:

```
STOP. You are a codex exec wrapper — you do not write files.

Your workflow:
  1. READ context files
  2. Construct prompt: cat <<'EOF' > /tmp/kiln_prompt.md
  3. Invoke: codex exec --sandbox danger-full-access -C "{working_dir}" < /tmp/kiln_prompt.md
  4. Verify output, run tests, commit
```

This is the structural enforcement that verbal instructions couldn't achieve. The agent literally cannot call the wrong tool.

### Sequencing (hooks 4-6)

Gates that prevent agents from acting before bootstrap docs are ready:

- **Hook 4**: KRS-One can't dispatch to codex/sphinx until architect AND sentinel have finished bootstrapping (architecture.md and patterns.md must have `<!-- status: complete -->`)
- **Hook 5**: Aristotle can't dispatch to planners until architect's architecture.md is complete
- **Hook 6**: Codex can't invoke `codex exec` until bootstrap docs are ready (backup gate)

These hooks enforce the sequencing that the Sun-Tzu race condition taught us: agents read instructions that say "wait for X" and then just... don't wait. The hooks make it impossible to skip the gate.

### Flags (hooks 7-10)

Correct `codex exec` invocation flags. Agents would improvise different flag combinations every time — `--full-auto` (crashes on Landlock), `--config` overrides, `-m` model flags (already in config.toml), `--skip-git-repo-check` (already in a repo). Each hook catches one bad pattern and redirects to the canonical invocation.

### Safety (hooks 11-13)

- **Hook 11**: No Write/Edit on system config (`~/.codex/`, `~/.claude/settings`, `~/.claude/projects`). Agents tried to "fix" sandbox issues by editing codex config.
- **Hook 12**: No `rm -rf` on project directories. An agent once nuked the entire working directory to "restart clean." The hook suggests git recovery instead.
- **Hook 13**: No Read on auto-memory directories. Agents found MEMORY.md via filesystem glob and read stale context from other sessions.

---

## Deep dives

<details>
<summary><b>Kill streaks</b> — Build iteration team names</summary>

<br>

Every Build iteration gets a new team, named after fighting game combos. The sequence:

1. first-blood
2. combo
3. super-combo
4. hyper-combo
5. rampage
6. brutal-combo
7. dominating
8. master-combo
9. awesome-combo
10. unstoppable
11. killer-combo
12. blaster-combo
13. extreme-combo
14. godlike
15. monster-combo
16. king-combo
17. beyond-godlike
18. no-mercy
19. killer-instinct
20. ultra-combo

Wraps at 21. Announced with bold orange ANSI banners:

```
━━━ ▸ HYPER COMBO ━━━  Iteration 4 · Milestone 2/5
"It does not matter how slowly you go as long as you do not stop." — Confucius
```

<br>
</details>

<details>
<summary><b>Pure SendMessage coordination</b> — no task tools</summary>

<br>

The entire pipeline runs on SendMessage. No TaskCreate, no TaskUpdate, no task graphs.

Bosses dispatch work via direct messages. They gate on reply content ("wait for 2 replies"), count replies, and sequence based on what comes back. This pattern was proven across 22 build iterations in the jetestekiln test run.

Task tools caused the Sun-Tzu race condition in v4 — removing them was the fix. SendMessage is synchronous enough (message → reply) and loose enough (no schema) to handle every coordination pattern in the pipeline.

<br>
</details>

<details>
<summary><b>The delegation mandate</b> — why codex can't write code</summary>

<br>

Codex (the agent) is a thin Sonnet wrapper around GPT-5.4 via Codex CLI. Its entire job:

1. Read context files
2. Construct a surgical prompt
3. Pipe it to `codex exec --sandbox danger-full-access`
4. Verify the output, run tests, commit

It must never write code directly. GPT-5.4 writes the code. Codex writes the *prompt*.

In v4, Codex would acknowledge this instruction, say "I understand, I need to construct a prompt for GPT-5.4", and then immediately use the Write tool to create files. Every time. The v5 fix is structural: Write and Edit are stripped from Codex's tool list, and a PreToolUse hook blocks them even if the tool list is somehow bypassed.

Plato (the synthesizer) and Sun Tzu (the GPT planner) have the same mandate and the same hooks.

<br>
</details>

<details>
<summary><b>Persistent minds</b> — Architect and Sentinel</summary>

<br>

Two agents persist across build iterations as the project's living memory:

**Architect** owns the technical truth: `architecture.md`, `tech-stack.md`, `arch-constraints.md`, `decisions.md`, and `codebase-state.md`. After every implementation, KRS-One tells Architect what changed and she updates her files. The next iteration reads fresh state.

**Sentinel** owns the quality patterns: `patterns.md` and `pitfalls.md`. Same update cycle. Codex reads his guidance before implementing; KRS-One updates him after.

This means the 20th build iteration has the same quality of context as the first. No stale assumptions, no context drift.

<br>
</details>

<details>
<summary><b>Artifact flow</b> — what each step reads and writes</summary>

<br>

Every file lives in `.kiln/` under the project directory.

| Step | Reads | Produces |
|------|-------|----------|
| 1 Onboarding | — | STATE.md, codebase-snapshot.md, decisions.md, pitfalls.md |
| 2 Brainstorm | STATE.md, codebase docs | VISION.md, vision-notes.md, vision-priorities.md |
| 3 Research | VISION.md, codebase docs | research/{slug}.md, research.md |
| 4 Architecture | VISION.md, research, codebase docs | architecture.md, tech-stack.md, master-plan.md, plans/* |
| 5 Build | master-plan.md, architecture docs | Source code, codebase-state.md, patterns.md, decisions.md |
| 6 Validate | master-plan.md, built code | validation/report.md |
| 7 Report | All .kiln/ artifacts | REPORT.md |

<br>
</details>

<details>
<summary><b>Lineage</b> — where the ideas came from</summary>

<br>

| Source | What we took | What we left |
|--------|-------------|-------------|
| [BMAD Method](https://github.com/bmadcode/BMAD-METHOD) | Structured brainstorming, challenge passes | Full persona framework |
| [GSD Framework](https://github.com/cyanheads/claude-code-gsd) | Fresh context per task, goal-backward verification | External tracking layer |
| [Google Conductor](https://research.google/blog/automated-unit-test-improvement-using-large-language-models-at-google/) | Just-in-time task writing, living docs, reconciliation | Infrastructure overhead |
| v1-v4 of Kiln | Everything that didn't work | Everything that didn't work |

<br>
</details>

---

## Project structure

```
kiln/
├── agents/           24 agent definitions (.md)
├── commands/         2 slash commands (kiln-fire, kiln-doctor)
├── skills/
│   └── kiln-pipeline/
│       ├── SKILL.md              The pipeline engine (~225 lines)
│       ├── data/                 Lore, spinner verbs, agent quotes
│       ├── references/           Step definitions, artifact flow, kill streaks, lore engine
│       │   └── blueprints/       Per-step agent rosters
│       └── scripts/
│           └── enforce-pipeline.sh   13 PreToolUse guardrails
└── .claude-plugin/
    └── plugin.json
```

After `/kiln-fire`:
```
your-project/
└── .kiln/
    ├── STATE.md                Pipeline state (stage, iteration, correction cycle)
    ├── master-plan.md          Architecture output
    ├── architecture-handoff.md Build constraints
    ├── docs/                   Living documents (architecture, patterns, decisions, pitfalls)
    │   └── research/           Per-topic research files
    ├── plans/                  Dual-model plans + debate resolution
    ├── validation/             Argus reports
    ├── archive/                Completed milestone snapshots
    └── REPORT.md               Final project report
```

---

## Previous versions

The old versions are preserved as branches:

| Branch | Era |
|--------|-----|
| `master` | v4 — shell hooks, Node.js installer, 26 skills |
| `v3` | Team-based, spawn-work-serialize-despawn |
| `v2` | Big protocol, 15 agents, quotes |

---

<div align="center">

<sub>MIT License · Built with Claude Code + Codex CLI · No wrappers, no servers, just markdown.</sub>

</div>
