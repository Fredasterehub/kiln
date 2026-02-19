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

[The Story](#the-story) · [Recent Changes](#recent-changes) · [Get Started](#get-started) · [How It Works](#how-it-works) · [The Crew](#the-crew) · [Commands](#commands)

</div>

---

## The Story

I was testing and developing with Claude Code when I started noticing things.

Memories were sticking. Not vaguely — *explicitly*. Tasks and TaskLists were rocking. I'd casually describe a workflow to Claude, ask it to iterate, and it would follow the thing to a T without me spelling out every guardrail. It started bugging me. Is Opus 4.6, combined with all these native features — Teams, Sub-agents, Memory, Tasks — now able to be steered with so much less?

So I tested it. Same multi-model pipeline I'd been building with heavy guardrails. Stripped it down. Almost no framework. Almost entirely Claude Code native functions. Agents defined in markdown. Slash commands. Memory files. That's it.

And it cooks. For hours. Autonomously. Planning, debating, implementing, reviewing, committing — phase after phase.

I think this might be the new way to do it. Less scaffolding, more trust. But time will tell.

> This is the lightweight rewrite of [kiln v1](https://github.com/Fredasterehub/kiln/tree/master). Same workflow, fraction of the weight. Where v1 had 35 skills and 13 agents with deep guardrails, this has 10 agents, 3 commands, and a protocol block. The models got better. The framework got smaller.

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

## Recent Changes

> [!NOTE]
> **Hardening Pass** (2026-02-19)
>
> Four parallel GPT-5.3-codex agents rewrote the internals. Opus 4.6 QA'd the result. Fixed the bugs that would have bitten first real users.

**Memory schema unified.** Start, resume, reset, and the protocol now write and read the exact same schema. Before this, a clean start-reset-resume cycle would fail because each command used different field names and status values. Single canonical enum set: `stage` (brainstorm|planning|execution|validation|complete), `status` (in_progress|paused|blocked|complete), `planning_sub_stage`, `phase_status`. ([`assets/templates/MEMORY.md`](assets/templates/MEMORY.md), [`assets/protocol.md`](assets/protocol.md), [`assets/commands/kiln/`](assets/commands/kiln/))

**Path contract enforced.** Every agent and command now anchors paths to `$PROJECT_PATH/.kiln/` or `$HOME/.claude/`. Agent docs had `memory_dir` examples pointing to `.kiln/memory` inside the project instead of Claude's per-project memory directory. Fixed across all 10 agents. ([`assets/agents/`](assets/agents/))

**Lossless update.** `kilntwo update` no longer nukes user-edited agent files. It compares checksums against the manifest and skips files you've customized, unless you pass `--force`. Reports what was updated vs skipped. ([`src/update.js`](src/update.js))

**Deterministic uninstall.** `kilntwo uninstall` used to call `removeProtocol(process.cwd() + '/CLAUDE.md')` — run it from the wrong directory and it strips the protocol from an unrelated project. Now reads the installed path from the manifest. ([`src/uninstall.js`](src/uninstall.js))

**Cross-platform doctor.** Replaced `which` (POSIX-only) with `command -v` / `where`. `encodeProjectPath` now strips Windows-invalid characters. ([`src/doctor.js`](src/doctor.js), [`src/paths.js`](src/paths.js))

**Asset lint test.** A regression guard that scans every markdown and JSON file in `assets/` for bare root-anchored paths, blank Codex CLI placeholders, and erased template variables. Catches prompt rot before it ships. ([`test/assets-lint.test.js`](test/assets-lint.test.js))

**53 tests &rarr; 64 tests.** New coverage for lossless update, manifest-targeted uninstall, cross-platform CLI detection, path encoding, and asset linting.

---

## How It Works

Two stages are yours. The rest run on their own.

| Stage | Name | What happens |
|:---:|---|---|
| **1** | **Brainstorm** | You and the orchestrator explore the problem. Goals, constraints, success criteria — nailed down before anything moves. |
| **2** | **Planning** | Two models plan in parallel. Confucius (Claude) and Sun Tzu (GPT-5.2) write independent plans. Socrates debates the disagreements. Plato merges them. You review and approve. |
| **3** | **Execution** | Phase by phase. Scheherazade writes task prompts. Codex implements with GPT-5.3-codex. Sphinx reviews — up to 3 rounds. Maestro orchestrates. |
| **4** | **Validation** | Argus runs end-to-end tests. If something fails, the pipeline re-enters execution for that phase only. |
| **5** | **Delivery** | Summary of everything built, tested, and committed. You approve. Done. |

> [!TIP]
> Session state persists across context resets through memory files. Run `/kiln:reset` before clearing, `/kiln:resume` to pick up exactly where you left off.

---

## The Crew

Every agent has a name. Not for decoration — for the logs.

| Alias | Agent | Model | Job |
|---|---|---|---|
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

## Commands

Three slash commands. One CLI with four verbs. That's the interface.

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
│   ├── agents/             10 agent definitions
│   ├── commands/kiln/      3 slash commands
│   ├── templates/          Memory file templates
│   ├── protocol.md         Behavioral rules for CLAUDE.md
│   └── names.json          Agent alias registry
└── test/                   64 tests, zero deps
```

After install, your `~/.claude/` gets the agents and commands. Your project's `CLAUDE.md` gets the protocol block. That's all Kiln touches.
</details>

<details>
<summary><b>v1 vs v2</b></summary>
<br>

| | v1 (kiln) | v2 (kilntwo) |
|---|---|---|
| Agents | 13 | 10 |
| Skills | 26 | 0 (protocol block instead) |
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
