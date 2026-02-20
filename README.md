<p align="center">
  <br>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/logo-light.svg">
    <img alt="Kiln" src="docs/logo-light.svg" width="260">
  </picture>
</p>

<h3 align="center">Multi-model orchestration for Claude Code</h3>

<p align="center">
  <sub>Opus plans. GPT sharpens. Codex builds. Opus reviews.</sub>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/kilntwo"><img src="https://img.shields.io/badge/npm-kilntwo-D4A574?style=flat-square&logo=npm" alt="npm"></a>&nbsp;
  <img src="https://img.shields.io/badge/tests-134_passing-4A403A?style=flat-square" alt="tests">&nbsp;
  <img src="https://img.shields.io/badge/deps-0-4A403A?style=flat-square" alt="zero deps">&nbsp;
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-4A403A?style=flat-square" alt="MIT"></a>
</p>

<p align="center">
  <a href="#quick-start"><strong>Quick Start</strong></a> &nbsp;&middot;&nbsp;
  <a href="#how-it-works"><strong>How It Works</strong></a> &nbsp;&middot;&nbsp;
  <a href="#the-crew"><strong>The Crew</strong></a> &nbsp;&middot;&nbsp;
  <a href="#the-story"><strong>The Story</strong></a>
</p>

<br>

---

<br>

You describe what you want to build. Kiln orchestrates three model families &mdash; **Opus 4.6** for planning and review, **GPT-5.2** for prompt sharpening, **GPT-5.3-codex** for implementation &mdash; through a structured pipeline that runs inside [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview).

No runtime. No daemon. Markdown files and Claude Code's native agent system.

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

> **Note** &mdash; Not on npm yet. Clone and link manually for now.

<details>
<summary><strong>Prerequisites</strong></summary>
<br>

| Requirement | Install |
|:--|:--|
| Node.js 18+ | [nodejs.org](https://nodejs.org) |
| Claude Code | `npm i -g @anthropic-ai/claude-code` |
| Codex CLI | `npm i -g @openai/codex` |

Run Claude Code with `--dangerously-skip-permissions`. Kiln spawns agents, writes files, and runs tests constantly. Permission prompts break the flow.

> Only use this in projects you trust.

</details>

<br>

## How It Works

Five stages. Each one uses different models for different jobs.

<table>
<tr>
<td align="center" width="20%">
<br>
<strong>Brainstorm</strong><br>
<sub>You + Da Vinci</sub><br>
<sub>61 techniques</sub>
<br><br>
</td>
<td align="center" width="20%">
<br>
<strong>Plan</strong><br>
<sub>Opus vs GPT</sub><br>
<sub>Debate &amp; synthesize</sub>
<br><br>
</td>
<td align="center" width="20%">
<br>
<strong>Execute</strong><br>
<sub>Phase by phase</sub><br>
<sub>Sharpen &rarr; Build &rarr; Review</sub>
<br><br>
</td>
<td align="center" width="20%">
<br>
<strong>Validate</strong><br>
<sub>Deploy &amp; test</sub><br>
<sub>Correct &times; 3</sub>
<br><br>
</td>
<td align="center" width="20%">
<br>
<strong>Deliver</strong><br>
<sub>Summary to you</sub><br>
<sub>Review &amp; approve</sub>
<br><br>
</td>
</tr>
</table>

<details>
<summary><strong>Stage 1 &mdash; Brainstorm</strong> &nbsp; <sub>interactive</sub></summary>
<br>

You describe what you want. **Da Vinci** facilitates &mdash; 61 techniques across 10 categories, 50 elicitation methods, anti-bias protocols. Pick a depth:

| Depth | Idea Floor | Style |
|:--|:--|:--|
| Light | 10 | Quick and focused |
| Standard | 30 | Balanced exploration |
| Deep | 100 | Thorough |

Brownfield? **Mnemosyne** maps the existing codebase first.

Produces `vision.md` &mdash; problem, users, goals, constraints, stack, success criteria.

</details>

<details>
<summary><strong>Stage 2 &mdash; Plan</strong> &nbsp; <sub>automated</sub></summary>
<br>

Two planners work the same vision in parallel:
- **Confucius** (Opus 4.6) &mdash; Claude perspective
- **Sun Tzu** (GPT-5.2) &mdash; GPT perspective

**Socrates** debates the disagreements. **Plato** synthesizes into `master-plan.md`.

Different model families catch different things. The debate forces explicit conflict resolution instead of silent averaging.

</details>

<details>
<summary><strong>Stage 3 &mdash; Execute</strong> &nbsp; <sub>automated, per phase</sub></summary>
<br>

**Maestro** runs each phase through a full lifecycle:

| Step | Agent | What happens |
|:--|:--|:--|
| **Index** | Sherlock | Fresh codebase snapshot |
| **Plan** | Confucius + Sun Tzu | Dual-plan, debate, synthesize |
| **Sharpen** | Scheherazade | Explores the *current* codebase, reads living docs, generates context-rich prompts |
| **Build** | Codex | Executes each sharpened prompt. One task, one commit. |
| **Review** | Sphinx | Reviews changes. Reject &rarr; re-sharpen &rarr; fix. Up to 3 rounds. |
| **Merge** | Maestro | Phase branch &rarr; main |
| **Learn** | Sherlock | Appends decisions, pitfalls, and patterns to living docs |

**Sharpen** is the key step. Scheherazade reads real code &mdash; file paths, function signatures, existing patterns &mdash; then generates prompts with verbatim context. GPT-5.2 writing for GPT-5.3-codex. Same family, optimized translation.

**Learn** creates a cross-phase loop. Each phase's discoveries feed into the next.

</details>

<details>
<summary><strong>Stage 4 &mdash; Validate</strong> &nbsp; <sub>automated</sub></summary>
<br>

**Argus** builds the project, deploys it, and tests real user flows against the master plan's acceptance criteria.

Failures generate correction tasks through the full **Scheherazade &rarr; Codex &rarr; Sphinx** cycle. Loops until passing or 3 cycles exhausted &mdash; then escalates to you.

</details>

<br>

## The Crew

Every agent has a name. Not for decoration &mdash; for the logs.

| Alias | Model | Role |
|:--|:--|:--|
| **Da Vinci** | Opus 4.6 | Brainstorm facilitator &mdash; 61 techniques, anti-bias protocols |
| **Mnemosyne** | Opus 4.6 | Brownfield codebase mapper |
| **Confucius** | Opus 4.6 | Claude-side planner |
| **Sun Tzu** | GPT-5.2 | GPT-side planner |
| **Socrates** | Opus 4.6 | Debate moderator |
| **Plato** | Opus 4.6 | Plan synthesizer |
| **Scheherazade** | GPT-5.2 | JIT prompt sharpener &mdash; explores codebase, generates context-rich prompts |
| **Codex** | GPT-5.3 | Code implementer |
| **Sphinx** | Opus 4.6 | Code reviewer |
| **Maestro** | Opus 4.6 | Phase coordinator |
| **Argus** | Opus 4.6 | E2E validator &mdash; deploys, tests, generates corrections |
| **Sherlock** | Haiku 4.5 | Fast researcher &mdash; codebase indexing, living docs reconciliation |

<br>

## Commands

**In Claude Code:**

| Command | What it does |
|:--|:--|
| `/kiln:start` | Brainstorm, plan, execute, validate, ship |
| `/kiln:resume` | Pick up where the last session stopped |
| `/kiln:reset` | Save state, prepare for `/clear` |

**In terminal:**

| Command | What it does |
|:--|:--|
| `kilntwo install` | Install agents, commands, protocol, templates |
| `kilntwo uninstall` | Manifest-driven removal |
| `kilntwo update` | Lossless upgrade via checksum diff |
| `kilntwo doctor` | Health check &mdash; Node, CLIs, permissions, manifest |

<br>

## The Story

> I was working on Kiln, and started realizing that Claude was following the whole workflow *extremely* easily. Even with all the scaffolding and robustness and steering I was cooking in, sometimes it felt like Claude would behave best when I only said, in a prompt-style:
>
> *Hey, from now on be proactive with your use of sub-agents, tasks, tasklists, memory and teams. You are my Maestro so try to keep your context lean so you can stick around as long as possible. When we plan something, always use 2 agents &mdash; one `Opus 4.6` and one `GPT-5.2` with reasoning high &mdash; then synthesize with another `Opus 4.6` agent and present the results to me.*
>
> Once we were happy I'd tell him: *ok use our flow please &mdash; take that plan and ask `GPT-5.2` to create the optimal number of prompts, optimize each one following [the guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide), then hand them to `GPT-5.3-codex` for implementation. QA review his work and give feedback until satisfied. Rinse and repeat until done...*
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
<summary><strong>Memory &amp; State</strong></summary>
<br>

The pipeline survives context resets. All state lives in files:

```
~/.claude/projects/<encoded-path>/memory/
  MEMORY.md        runtime state (stage, phase, status, handoff)
  vision.md        project goals, written in Stage 1
  master-plan.md   the approved execution plan
  decisions.md     append-only decision log
  pitfalls.md      append-only failure log
  PATTERNS.md      coding patterns discovered during execution
```

`/kiln:reset` saves state. `/kiln:resume` picks up where it left off &mdash; right down to which task in which phase was last completed.

</details>

<details>
<summary><strong>What gets installed</strong></summary>
<br>

| What | Where | Count |
|:--|:--|:--|
| Agents | `~/.claude/agents/` | 13 |
| Commands | `~/.claude/commands/kiln/` | 3 |
| Templates | `~/.claude/kilntwo/templates/` | 6 |
| Skill | `~/.claude/kilntwo/skills/` | 1 |
| Data | `~/.claude/kilntwo/data/` | 2 |
| Protocol | `<project>/CLAUDE.md` | injected |
| Manifest | `~/.claude/kilntwo/manifest.json` | 1 |

Manifest-driven with SHA-256 checksums. `update` diffs checksums to preserve your edits. `uninstall` removes exactly what it installed.

</details>

<details>
<summary><strong>Project structure</strong></summary>
<br>

```
kilntwo/
├── bin/kilntwo.js
├── src/
│   ├── paths.js
│   ├── manifest.js
│   ├── markers.js
│   ├── install.js
│   ├── uninstall.js
│   ├── update.js
│   └── doctor.js
├── assets/
│   ├── agents/           13 agents
│   ├── commands/kiln/    3 commands
│   ├── data/             brainstorming + elicitation
│   ├── skills/           kiln-core
│   ├── templates/        6 templates
│   ├── protocol.md
│   └── names.json
└── test/                 134 tests, zero deps
```

</details>

<details>
<summary><strong>v1 vs v2</strong></summary>
<br>

| | v1 | v2 |
|:--|:--|:--|
| Skills | 26 | 1 (shared) |
| Commands | 8 | 3 |
| Hooks | 3 | 0 |
| Config lines | ~4,000 | ~1,400 |

Same pipeline. A third of the surface area.

</details>

<details>
<summary><strong>Troubleshooting</strong></summary>
<br>

**`codex: command not found`** &mdash; `npm install -g @openai/codex`

**Commands missing in Claude Code** &mdash; `kilntwo install`, restart Claude Code, or `kilntwo doctor`

**Pipeline halts** &mdash; Check `.kiln/reviews/` or `.kiln/validation/report.md`, fix, then `/kiln:resume`

</details>

<br>

---

<p align="center">
  <sub>MIT &middot; Zero dependencies &middot; Node 18+ &middot; Built with Claude Code + Codex CLI</sub>
</p>

<p align="center">
  <em>"Perfection is achieved, not when there is nothing more to add,<br>
  but when there is nothing left to take away."</em><br>
  <sub>&mdash; Antoine de Saint-Exup&eacute;ry</sub>
</p>
