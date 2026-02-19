<div align="center">

# kiln

**The ultra-lightweight multi-model pipeline for Claude Code**

*"Perfection is achieved, not when there is nothing more to add, but when there is nothing left to take away."* — Antoine de Saint-Exupery

<br>

[![Multi-Model](https://img.shields.io/badge/Multi--Model-Opus_·_GPT--5-D4A574?style=flat)]()
[![Debate](https://img.shields.io/badge/Debate-Models_Argue-C1666B?style=flat)]()
[![Zero Deps](https://img.shields.io/badge/Dependencies-Zero-4A403A?style=flat)]()
[![Native](https://img.shields.io/badge/Claude_Code-Native_Only-7C3AED?style=flat)]()

<br>

[![License](https://img.shields.io/badge/License-MIT-D4A574?style=for-the-badge)](LICENSE)
[![Node](https://img.shields.io/badge/Node-18+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Claude Code](https://img.shields.io/badge/Claude_Code-Native-7C3AED?style=for-the-badge&logo=anthropic&logoColor=white)](https://claude.ai/claude-code)

<br>

[The Story](#the-story) · [The Forest](#the-forest) · [Recent Changes](#recent-changes) · [The Crew](#the-crew) · [Get Started](#get-started) · [Commands](#commands)

</div>

---

## The Story

> I was working on Kiln, and started realizing that Claude was following the whole workflow *extremely* easily. Even with all the scaffolding and robustness and steering I was cooking in, sometimes it felt like Claude would behave best when I only said, in a prompt-style:
>
> *Hey, from now on be proactive with your use of sub-agents, tasks, tasklists, memory and teams. You are my Maestro so try to keep your context lean so you can stick around as long as possible. When we plan something, always use 2 agents — one `Opus 4.6` and one `GPT-5.2` with reasoning high — then synthesize with another `Opus 4.6` agent and present the results to me.*
>
> Once we were happy I'd tell him: *ok use our flow please — take that plan and ask `GPT-5.2` to create the optimal number of prompts, optimize each one following [the guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide), then hand them to `GPT-5.3-codex` for implementation. QA review his work and give feedback until satisfied. Rinse and repeat until done...*
>
> A few months ago we all know this would have gone nowhere. But since the most recent shadow stealth releases and upgrades on memory, tasks, tasklists and teams...
>
> He was pretty much executing the flow *flawlessly*.
>
> And so here I am, trying to structure it a bit more efficiently to promote proper behavior and reproducibility...
>
> It's really weird... the *less* restriction I give him but the *better* definition I give him... the better he behaves...
>
> *To be continued...*
>
> > This is the lightweight rewrite of [kiln v1](https://github.com/Fredasterehub/kiln/tree/master). Same workflow, fraction of the weight. Where v1 had 35 skills and 13 agents with deep guardrails, this has 11 agents, 3 commands, and a protocol block. The models got better. The framework got smaller.

---

## The Forest

KilnTwo is an NPM package you install into a project that turns Claude Code into a multi-model development pipeline. Instead of one model doing everything, it orchestrates Claude Opus 4.6, GPT-5.2, and GPT-5.3-codex — each doing what they're best at: planning, debating, translating prompts, writing code, and reviewing.

The core idea: the models are good enough now that the bottleneck isn't intelligence, it's coordination. KilnTwo provides the coordination layer.

### The Tree — How It's Structured

**Installation (`src/`)**

When you run `kilntwo install` in a project:

1. It copies **11 agent definitions** into `~/.claude/agents/` — markdown files with YAML frontmatter that Claude Code recognizes as spawnable sub-agents
2. It copies **3 slash commands** (`/kiln:start`, `/kiln:resume`, `/kiln:reset`) into `~/.claude/commands/`
3. It copies **5 memory templates** into `~/.claude/kilntwo/templates/`
4. It copies **1 shared skill** into `~/.claude/kilntwo/skills/` — single source of truth for path contracts, memory schema, event schema, and conventions
5. It copies **2 data files** (61 brainstorming techniques + 50 elicitation methods) into `~/.claude/kilntwo/data/`
6. It injects a **protocol block** into the project's `CLAUDE.md` — behavioral rules that the orchestrator must follow
7. It writes a **manifest** tracking every file it installed (with SHA-256 checksums) so it can cleanly uninstall, update, or health-check later

Everything is manifest-driven. `update` diffs checksums to skip user-edited files. `uninstall` reads the manifest to know exactly what to remove. `doctor` verifies everything is intact.

**The Pipeline (`assets/`)**

When you run `/kiln:start` in Claude Code, it kicks off a 5-stage pipeline:

**Stage 1 — Brainstorm** (you + Claude, interactive)
You describe what you want to build. Da Vinci (the brainstormer) facilitates a structured session using 61 creative techniques across 10 categories, 50 elicitation methods, and anti-bias protocols. You pick a depth (light/standard/deep) that sets the idea floor. This produces `vision.md` — the project goal document with 11 structured sections.

**Stage 2 — Planning** (automated, dual-model)
Two planners work in parallel:
- **Confucius** (Claude Opus 4.6) writes a plan from the Claude perspective
- **Sun Tzu** (GPT-5.2 via Codex CLI) writes an independent plan

Then **Socrates** (Opus) debates the disagreements between the two plans. Finally **Plato** (Opus) synthesizes both plans + the debate resolution into one `master-plan.md` broken into phases.

The dual-plan approach exists because different model families catch different things. The debate step forces explicit resolution of conflicts rather than silent averaging.

**Stage 3 — Execution** (automated, phase by phase)
For each phase in the master plan, **Maestro** (the phase executor) runs a lifecycle:

1. **Plan** — Confucius + Sun Tzu plan the phase (same dual pattern, smaller scope)
2. **Prompt** — Scheherazade (GPT-5.2) converts the plan into task-level prompts optimized for GPT-5.3-codex. This is the "same-family translator" — GPT-5.2 knows how to write prompts that GPT-5.3 understands best.
3. **Implement** — Codex (GPT-5.3-codex) executes each task prompt, writing actual code. Each task gets its own git commit.
4. **Review** — Sphinx (Opus 4.6) reviews all changes against the phase plan. If rejected, it writes a fix prompt and the implementer tries again (up to 3 rounds).
5. **Merge** — Phase branch merges to main.

Maestro is deliberately thin — it coordinates but never writes code, plans, or reviews itself. Everything is delegated to specialists.

**Stage 4 — Validation** (automated)
Argus runs end-to-end tests and writes a validation report.

**Stage 5 — Delivery** (interactive)
Summary back to you for review.

**Memory & State**

The pipeline is designed to survive context resets (`/kiln:reset` + `/kiln:resume`). All state lives in files:

- `MEMORY.md` — canonical runtime state (stage, phase, status)
- `vision.md` — project goal (written once in Stage 1)
- `master-plan.md` — the approved execution plan
- `decisions.md` — append-only decision log
- `pitfalls.md` — append-only failure log
- `phase_<N>_state.md` — per-phase audit trail
- `phase_summary.md` — phase digest written after each merge
- `archive/` — completed phase artifacts, moved out of working dirs

When you resume, the orchestrator reads these files and picks up where it left off.

**The Key Insight**

The whole thing is basically a coordination protocol that lives in markdown files. The agents are markdown documents. The slash commands are markdown documents. The protocol rules are a markdown block in CLAUDE.md. The pipeline state is markdown files.

There's no runtime, no daemon, no server. You install some files, and Claude Code's existing agent/command infrastructure does the rest. The Node.js package is just the installer and health checker.

---

## Recent Changes

**Brainstorm Module** ([`b5391dd`](https://github.com/Fredasterehub/kiln/commit/b5391dd)) — Imported BMAD's creative brainstorming engine as the Da Vinci agent. 61 techniques across 10 categories, 50 elicitation methods, anti-bias protocols (domain pivot every 10 ideas, configurable idea floor). Updated `start.md` flow, `vision.md` template (now 11 sections), and install pipeline to copy data files. 22 new tests (106 total).

**v0.2.1 Simplification** ([`c6f1acb`](https://github.com/Fredasterehub/kiln/commit/c6f1acb)) — Extracted shared schema to a single `kiln-core` skill. Compressed all agent specs by 52.6% (1,094 → 518 lines). Trimmed protocol by 51.4%. 4 bug fixes, 6 new tests.

<details>
<summary><b>Older</b></summary>

- [`997e1a3`](https://github.com/Fredasterehub/kiln/commit/997e1a3) — v0.2.0: structured trajectory log, phase archive, dual-layer handoff
- [`118e91f`](https://github.com/Fredasterehub/kiln/commit/118e91f) — v0.1.1: contract tightening, security hardening, QA fixes
- [`ad9e4c4`](https://github.com/Fredasterehub/kiln/commit/ad9e4c4) — Hardening pass: unified memory schema, path contract, lossless update, cross-platform doctor
- [`4e2cc00`](https://github.com/Fredasterehub/kiln/commit/4e2cc00) — Brand rename: kw → kiln across entire project
- [`62620a3`](https://github.com/Fredasterehub/kiln/commit/62620a3) — Agent enforcement: auto-spawn execution loop, Codex CLI delegation rules
- [`63df0ec`](https://github.com/Fredasterehub/kiln/commit/63df0ec) — README rewrite with humanized intro and agent crew

</details>

---

## The Crew

Every agent has a name. Not for decoration — for the logs.

| Alias | Agent | Model | Job |
|---|---|---|---|
| **Da Vinci** | kiln-brainstormer | Opus 4.6 | Guides structured brainstorm sessions with creative techniques |
| **Confucius** | kiln-planner-claude | Opus 4.6 | Plans from the Claude side — architecture, edge cases, big picture |
| **Sun Tzu** | kiln-planner-codex | GPT-5.2 | Plans from the GPT side — catches what Opus misses |
| **Socrates** | kiln-debater | Opus 4.6 | Makes the two plans argue until they agree |
| **Plato** | kiln-synthesizer | Opus 4.6 | Merges plans into one coherent master plan |
| **Scheherazade** | kiln-prompter | GPT-5.2 | Turns plans into surgical per-task prompts |
| **Codex** | kiln-implementer | GPT-5.3-codex | Writes the actual code, task by task |
| **Sphinx** | kiln-reviewer | Opus 4.6 | Reviews everything — correctness, security, completeness |
| **Maestro** | kiln-phase-executor | Opus 4.6 | Runs the full phase lifecycle |
| **Argus** | kiln-validator | Opus 4.6 | E2E validation — runs your tests, writes the report |
| **Sherlock** | kiln-researcher | Haiku | Fast lookups — docs, codebase, web |

---

## Get Started

```bash
git clone https://github.com/Fredasterehub/kiln.git
cd kiln && git checkout v2
npm install -g .
kilntwo install
```

Then in Claude Code:

```
/kiln:start
```

> [!NOTE]
> Not published to npm yet. Clone and install manually for now.

<details>
<summary><b>Prerequisites</b></summary>
<br>

| Tool | Install | Required? |
|------|---------|-----------|
| [Claude Code](https://claude.ai/claude-code) | `npm i -g @anthropic-ai/claude-code` | Yes |
| [Codex CLI](https://github.com/openai/codex) | `npm i -g @openai/codex` | Yes |
| Node.js 18+ | [nodejs.org](https://nodejs.org) | Yes |

Run with `--dangerously-skip-permissions` — Kiln spawns agents, writes files, and runs tests constantly. Permission prompts break the flow.

```bash
claude --dangerously-skip-permissions
```

> [!CAUTION]
> Only use this in projects you trust.
</details>

<details>
<summary><b>Verify installation</b></summary>
<br>

```bash
kilntwo doctor
```

Checks Node version, Claude CLI, Codex CLI, directory permissions, and manifest integrity. Works on macOS, Linux, and Windows.
</details>

---

## Commands

| Command | What it does |
|---------|-------------|
| `/kiln:start` | Light the kiln — brainstorm, plan, execute, ship |
| `/kiln:resume` | Pick up where you left off after a context reset |
| `/kiln:reset` | Save state to memory and prepare for `/clear` |

| CLI | What it does |
|-----|-------------|
| `kilntwo install` | Drops agents, commands, and protocol into `~/.claude/` |
| `kilntwo uninstall` | Deterministic removal — targets the correct project |
| `kilntwo update` | Lossless upgrade — preserves your agent edits |
| `kilntwo doctor` | Cross-platform pre-flight check |

---

<details>
<summary><b>Project structure</b></summary>
<br>

```
kilntwo/
├── bin/kilntwo.js          CLI entry point
├── src/
│   ├── paths.js            Path resolution (~/.claude/*)
│   ├── manifest.js         Install tracking with checksums
│   ├── markers.js          Protocol block in CLAUDE.md
│   ├── install.js          Idempotent, manifest-aware install
│   ├── uninstall.js        Manifest-driven clean removal
│   ├── update.js           Lossless version-aware upgrade
│   └── doctor.js           Cross-platform health checks
├── assets/
│   ├── agents/             11 agent definitions
│   ├── commands/kiln/      3 slash commands
│   ├── data/               Brainstorming techniques + elicitation methods
│   ├── skills/             Shared schema skill (kiln-core)
│   ├── templates/          Memory file templates
│   ├── protocol.md         Behavioral rules for CLAUDE.md
│   └── names.json          Agent alias registry
└── test/                   106 tests, zero deps
```

After install, your `~/.claude/` gets the agents and commands. Your project's `CLAUDE.md` gets the protocol block. That's all Kiln touches.
</details>

<details>
<summary><b>v1 vs v2</b></summary>
<br>

| | v1 (kiln) | v2 (kilntwo) |
|---|---|---|
| Agents | 13 | 11 |
| Skills | 26 | 1 (shared skill) |
| Commands | 8 | 3 |
| Hooks | 3 scripts | 0 |
| State tracking | STATE.md + state.json | Memory files |
| Install | Custom installer | npm package + CLI |
| Dependencies | Zero | Zero |
| Lines of config | ~4,000 | ~1,200 |

Same pipeline. Same multi-model debate. Same QA gates. A third of the surface area.
</details>

<details>
<summary><b>Troubleshooting</b></summary>
<br>

**`codex: command not found`** — `npm install -g @openai/codex`, then verify with `codex --version`.

**Commands don't show in Claude Code** — Run `kilntwo install` and restart Claude Code. Still nothing? `kilntwo doctor`.

**`model_reasoning_effort` flag rejected** — Older Codex CLI. Upgrade: `npm install -g @openai/codex`.

**Pipeline halts with "escalate to operator"** — A phase failed 3 QA rounds. Check `.kiln/reviews/fix_round_3.md`, fix manually, then `/kiln:resume`.

**`uninstall` didn't remove protocol** — Prior to v0.1.1, uninstall targeted `process.cwd()` instead of the installed project. Upgrade and re-run `kilntwo uninstall`.
</details>

---

<div align="center">

<sub>MIT License · Zero dependencies · Built with Claude Code + Codex CLI</sub>

<sub>*Less framework. More trust. The models are ready.*</sub>

</div>
