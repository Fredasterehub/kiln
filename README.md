<div align="center">

<br>

```
  ██╗  ██╗██╗██╗     ███╗   ██╗
  ██║ ██╔╝██║██║     ████╗  ██║
  █████╔╝ ██║██║     ██╔██╗ ██║
  ██╔═██╗ ██║██║     ██║╚██╗██║
  ██║  ██╗██║███████╗██║ ╚████║
  ╚═╝  ╚═╝╚═╝╚══════╝╚═╝  ╚═══╝
```

**Multi-model orchestration for Claude Code**

*The models are ready. They just need a conductor.*

<br>

[![npm](https://img.shields.io/badge/npm-kilntwo-D4A574?style=flat-square&logo=npm)](https://www.npmjs.com/package/kilntwo)
[![Tests](https://img.shields.io/badge/tests-134_passing-4A403A?style=flat-square)]()
[![Zero Deps](https://img.shields.io/badge/dependencies-0-4A403A?style=flat-square)]()
[![License](https://img.shields.io/badge/license-MIT-4A403A?style=flat-square)](LICENSE)

<br>

[Quick Start](#quick-start) · [How It Works](#how-it-works) · [The Crew](#the-crew) · [Commands](#commands) · [The Story](#the-story)

</div>

<br>

---

<br>

## What Is This

Kiln is an npm package that installs a multi-model development protocol into [Claude Code](https://claude.ai/claude-code). Instead of one model doing everything, it orchestrates **Claude Opus 4.6**, **GPT-5.2**, and **GPT-5.3-codex** — each doing what they're best at.

```
 You describe it ──→ Models brainstorm it ──→ Two models plan it ──→ They debate it
                                                                          │
 You review it ←── Models validate it ←── Models review it ←── Models build it
```

No runtime. No daemon. No server. You install some markdown files, and Claude Code's native agent infrastructure does the rest.

<br>

## Quick Start

```bash
git clone https://github.com/Fredasterehub/kiln.git
cd kiln && git checkout v2
npm install -g .
```

```bash
# In your project directory:
kilntwo install
```

```bash
# In Claude Code:
/kiln:start
```

> **Note** — Not published to npm yet. Clone and install manually for now.

<details>
<summary><b>Prerequisites</b></summary>
<br>

| Requirement | Install |
|:---|:---|
| **Node.js 18+** | [nodejs.org](https://nodejs.org) |
| **Claude Code** | `npm i -g @anthropic-ai/claude-code` |
| **Codex CLI** | `npm i -g @openai/codex` |

Claude Code should run with `--dangerously-skip-permissions` — Kiln spawns agents, writes files, and runs tests constantly. Permission prompts break the flow.

> **Caution** — Only use this in projects you trust.

</details>

<details>
<summary><b>Verify installation</b></summary>
<br>

```bash
kilntwo doctor
```

Checks Node version, Claude CLI, Codex CLI, directory permissions, and manifest integrity.

</details>

<br>

## How It Works

Kiln runs a 5-stage pipeline. Each stage uses different models for different jobs.

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│   STAGE 1          STAGE 2          STAGE 3         STAGE 4         │
│   Brainstorm       Plan             Execute         Validate        │
│                                                                     │
│   You + Da Vinci   Confucius ─┐     For each        Argus builds,  │
│   61 techniques    Sun Tzu ───┤     phase:          deploys, and    │
│   50 methods       Socrates ──┤     ┌─────────┐     tests the real  │
│   Anti-bias        Plato ─────┘     │ Index   │     running app.    │
│   protocols                         │ Plan    │                     │
│                    Two models       │ Sharpen │     Failures →      │
│   Produces:        plan. They       │ Build   │     correction      │
│   vision.md        debate. One      │ Review  │     phases that     │
│                    synthesizes.     │ Merge   │     re-enter        │
│                                     │ Learn   │     Stage 3.        │
│                    Produces:        └─────────┘     Max 3 cycles.   │
│                    master-plan.md                                    │
│                                     Produces:       Produces:       │
│                                     working code    report.md       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

<details>
<summary><b>Stage 1 — Brainstorm</b> (interactive, you + Claude)</summary>
<br>

You describe what you want to build. **Da Vinci** facilitates a structured brainstorm session — 61 techniques across 10 categories, 50 elicitation methods, anti-bias protocols (domain pivot every 10 ideas, configurable idea floor). You pick a depth:

| Depth | Idea Floor | Intensity |
|:---|:---|:---|
| Light | 10 ideas | Quick and focused |
| Standard | 30 ideas | Balanced exploration |
| Deep | 100 ideas | Comprehensive |

Brownfield projects get auto-detected. **Mnemosyne** maps the existing codebase before brainstorming begins.

Produces `vision.md` — 11 structured sections covering problem, users, goals, constraints, tech stack, and success criteria.

</details>

<details>
<summary><b>Stage 2 — Plan</b> (automated, dual-model with debate)</summary>
<br>

Two planners work in parallel on the same vision:
- **Confucius** (Opus 4.6) — plans from the Claude perspective
- **Sun Tzu** (GPT-5.2) — plans independently from the GPT perspective

Then **Socrates** (Opus) debates the disagreements. **Plato** (Opus) synthesizes both plans + debate resolution into one `master-plan.md` with phases, tasks, and acceptance criteria.

The dual-plan approach exists because different model families catch different things. The debate forces explicit conflict resolution instead of silent averaging.

Three debate modes: Skip (1), Focused (2, default), Full rounds (3).

</details>

<details>
<summary><b>Stage 3 — Execute</b> (automated, phase by phase)</summary>
<br>

For each phase, **Maestro** runs a full lifecycle:

| Step | Agent | What happens |
|:---|:---|:---|
| **Index** | Sherlock (Haiku) | Generates a fresh codebase snapshot — file tree, exports, test commands |
| **Plan** | Confucius + Sun Tzu | Dual-plan the phase scope, debate, synthesize |
| **Sharpen** | Scheherazade (GPT-5.2) | Explores the *current* codebase with Glob/Read/Grep, reads living docs, then generates context-rich prompts following 6 Codex Prompting Guide principles |
| **Build** | Codex (GPT-5.3-codex) | Executes each sharpened prompt. One task, one commit. |
| **Review** | Sphinx (Opus 4.6) | Reviews all changes. If rejected → Scheherazade re-sharpens a fix prompt → Codex fixes → Sphinx re-reviews. Up to 3 rounds. |
| **Merge** | Maestro | Phase branch merges to main |
| **Learn** | Sherlock (Haiku) | Reconciles living docs — appends decisions, pitfalls, and patterns discovered during the phase |

The **Sharpen** step is what makes this work. Scheherazade doesn't just rephrase the plan — she explores the actual codebase to discover real file paths, function signatures, and existing patterns, then generates prompts with verbatim code context. GPT-5.2 writing prompts for GPT-5.3-codex — same family, optimized translation.

The **Learn** step creates a cross-phase learning loop. Each phase's discoveries feed into the next phase's prompts.

</details>

<details>
<summary><b>Stage 4 — Validate</b> (automated, with correction cycles)</summary>
<br>

**Argus** doesn't just run unit tests. He builds the project, deploys it (Docker, dev server, or CLI), and tests real user flows against the master plan's acceptance criteria.

If validation fails, Argus generates correction task descriptions. The orchestrator creates correction phases that re-enter Stage 3 through the full **Scheherazade → Codex → Sphinx** cycle. This loops until validation passes or 3 correction cycles are exhausted — then it escalates to you.

</details>

<details>
<summary><b>Stage 5 — Deliver</b> (interactive)</summary>
<br>

Summary back to you: phases completed, files changed, test results, known limitations. You review and approve.

</details>

<br>

## The Crew

Every agent has a name. Not for decoration — for the logs.

| | Alias | Model | Role |
|:---|:---|:---|:---|
| | **Da Vinci** | Opus 4.6 | Brainstorm facilitator — 61 techniques, anti-bias protocols |
| | **Mnemosyne** | Opus 4.6 | Brownfield codebase mapper — pre-seeds memory from existing code |
| | **Confucius** | Opus 4.6 | Claude-side planner — architecture, edge cases, big picture |
| | **Sun Tzu** | GPT-5.2 | GPT-side planner — catches what Opus misses |
| | **Socrates** | Opus 4.6 | Debate moderator — forces the two plans to argue until they agree |
| | **Plato** | Opus 4.6 | Plan synthesizer — merges competing plans into one truth |
| | **Scheherazade** | GPT-5.2 | JIT prompt sharpener — explores codebase, generates context-rich prompts |
| | **Codex** | GPT-5.3-codex | Code implementer — writes the actual code, task by task |
| | **Sphinx** | Opus 4.6 | Code reviewer — correctness, security, completeness |
| | **Maestro** | Opus 4.6 | Phase coordinator — orchestrates the full lifecycle per phase |
| | **Argus** | Opus 4.6 | Validator — deploys, tests the running product, generates corrections |
| | **Sherlock** | Haiku 4.5 | Fast researcher — codebase indexing, living docs reconciliation |

<br>

## Commands

**In Claude Code:**

| Command | What it does |
|:---|:---|
| `/kiln:start` | Light the kiln — brainstorm, plan, execute, validate, ship |
| `/kiln:resume` | Pick up exactly where the last session stopped |
| `/kiln:reset` | Save state to memory and prepare for `/clear` |

**In terminal:**

| Command | What it does |
|:---|:---|
| `kilntwo install` | Installs agents, commands, protocol, templates, and data files |
| `kilntwo uninstall` | Manifest-driven removal — knows exactly what it installed |
| `kilntwo update` | Lossless upgrade — preserves your agent edits via checksum diff |
| `kilntwo doctor` | Cross-platform health check — Node, CLI tools, permissions, manifest |

<br>

## Memory & State

The pipeline survives context resets. All state lives in files:

```
~/.claude/projects/<encoded-path>/memory/
  MEMORY.md       ← canonical runtime state (stage, phase, status, handoff)
  vision.md       ← project goals (written in Stage 1, never overwritten)
  master-plan.md  ← the approved execution plan
  decisions.md    ← append-only decision log (updated by Sherlock each phase)
  pitfalls.md     ← append-only failure log (updated by Sherlock each phase)
  PATTERNS.md     ← coding patterns discovered during execution
```

`/kiln:reset` saves state. `/kiln:resume` reads it and picks up where it left off — right down to which task in which phase was last completed.

<br>

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

<br>

<details>
<summary><b>What gets installed</b></summary>
<br>

When you run `kilntwo install`:

| What | Where | Count |
|:---|:---|:---|
| Agent definitions | `~/.claude/agents/` | 13 agents |
| Slash commands | `~/.claude/commands/kiln/` | 3 commands |
| Memory templates | `~/.claude/kilntwo/templates/` | 6 templates |
| Shared skill | `~/.claude/kilntwo/skills/` | 1 skill |
| Data files | `~/.claude/kilntwo/data/` | 2 JSON files |
| Protocol block | `<project>/CLAUDE.md` | Injected |
| Manifest | `~/.claude/kilntwo/manifest.json` | Tracks everything |

Everything is manifest-driven with SHA-256 checksums. `update` diffs checksums to skip user-edited files. `uninstall` reads the manifest to remove exactly what it installed. `doctor` verifies integrity.

</details>

<details>
<summary><b>Project structure</b></summary>
<br>

```
kilntwo/
├── bin/kilntwo.js          CLI entry point
├── src/
│   ├── paths.js            Path resolution (~/.claude/*)
│   ├── manifest.js         Install tracking with checksums
│   ├── markers.js          Protocol block injection into CLAUDE.md
│   ├── install.js          Idempotent, manifest-aware install
│   ├── uninstall.js        Manifest-driven clean removal
│   ├── update.js           Lossless version-aware upgrade
│   └── doctor.js           Cross-platform health checks
├── assets/
│   ├── agents/             13 agent definitions (YAML frontmatter + markdown)
│   ├── commands/kiln/      3 slash commands (start, resume, reset)
│   ├── data/               61 brainstorming techniques + 50 elicitation methods
│   ├── skills/             Shared schema skill (kiln-core)
│   ├── templates/          6 memory file templates
│   ├── protocol.md         14 behavioral rules for CLAUDE.md
│   └── names.json          Agent alias registry with quotes
└── test/                   134 tests, zero dependencies
```

</details>

<details>
<summary><b>v1 vs v2</b></summary>
<br>

| | v1 | v2 |
|:---|:---|:---|
| Agents | 13 | 13 |
| Skills | 26 | 1 (shared) |
| Commands | 8 | 3 |
| Hooks | 3 scripts | 0 |
| State tracking | STATE.md + state.json | Memory files |
| Install | Custom installer | npm package + CLI |
| Dependencies | Zero | Zero |
| Lines of config | ~4,000 | ~1,400 |

Same pipeline. Same multi-model debate. Same QA gates. A third of the surface area.

</details>

<details>
<summary><b>Troubleshooting</b></summary>
<br>

**`codex: command not found`** — `npm install -g @openai/codex`, then `codex --version`.

**Commands don't appear in Claude Code** — Run `kilntwo install` and restart Claude Code. Still nothing? `kilntwo doctor`.

**Pipeline halts with "escalate to operator"** — A phase failed 3 QA rounds or 3 correction cycles. Check `.kiln/reviews/` or `.kiln/validation/report.md`, fix manually, then `/kiln:resume`.

**`uninstall` didn't remove protocol** — Prior to v0.1.1, uninstall targeted the wrong project. Upgrade and re-run.

</details>

<br>

---

<div align="center">

<sub>MIT License · Zero dependencies · Node.js 18+ · Built with Claude Code + Codex CLI</sub>

<br>

*"Perfection is achieved, not when there is nothing more to add,*
*but when there is nothing left to take away."*
— Antoine de Saint-Exupery

</div>
