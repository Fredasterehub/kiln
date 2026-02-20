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
  <sub>✨ Opus plans · GPT sharpens · Codex builds · Opus reviews ✨</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Multi--Model-Opus_·_GPT--5-D4A574?style=flat-square" alt="Multi-Model">&nbsp;
  <img src="https://img.shields.io/badge/Debate-Models_Argue-C1666B?style=flat-square" alt="Debate">&nbsp;
  <img src="https://img.shields.io/badge/Dependencies-Zero-4A403A?style=flat-square" alt="Zero Deps">&nbsp;
  <img src="https://img.shields.io/badge/Claude_Code-Native_Only-7C3AED?style=flat-square" alt="Native">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/kilntwo"><img src="https://img.shields.io/badge/npm-kilntwo-D4A574?style=for-the-badge&logo=npm" alt="npm"></a>&nbsp;
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-D4A574?style=for-the-badge" alt="MIT"></a>&nbsp;
  <img src="https://img.shields.io/badge/Node-18+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node">&nbsp;
  <a href="https://docs.anthropic.com/en/docs/claude-code/overview"><img src="https://img.shields.io/badge/Claude_Code-Native-7C3AED?style=for-the-badge&logo=anthropic&logoColor=white" alt="Claude Code"></a>
</p>

<p align="center">
  <a href="#-the-story"><strong>The Story</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-get-started"><strong>Get Started</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-recent-changes"><strong>Recent Changes</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-how-it-works"><strong>How It Works</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-the-crew"><strong>The Crew</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-commands"><strong>Commands</strong></a>
</p>

<br>

---

<br>

You describe what you want to build. Kiln orchestrates three model families &mdash; **Opus 4.6** for planning and review, **GPT-5.2** for prompt sharpening, **GPT-5.3-codex** for implementation &mdash; through a structured pipeline that runs inside [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview).

No runtime. No daemon. Markdown files and Claude Code's native agent system.

> This is the lightweight rewrite of [kiln v1](https://github.com/Fredasterehub/kiln/tree/master). Same workflow, fraction of the weight. Where v1 had 35 skills and 13 agents with deep guardrails, v2 has 19 agents, 4 commands, and a protocol block. The models got better. The framework got smaller.

<br>

## 💬 The Story

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

## 🚀 Get Started

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
<summary>⚙️ <strong>Prerequisites</strong></summary>
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

## ✨ Recent Changes

### 🔥 v0.6 &mdash; Full Debate, Tmux Panel UI &amp; QA Fixes

Debate Mode 3 expanded from a stub to a full adversarial protocol. Tmux split-pane UI for monitoring agents in real time. File efficiency pass across 7 agent files. Two QA fix rounds via dual-reviewer.

**⚔️ Full Debate Mode 3** &mdash; `kiln-debater` now runs a complete adversarial cycle: structured critique (strengths/weaknesses/disagreements/concessions), revision phase with headers, convergence detection, per-round artifacts to `plans/`, and a `debate_log.md` audit trail. The synthesizer reads final revised plans from the debate log outcome, not stale originals.

**🖥️ Tmux Panel UI** &mdash; `/kiln:start` optionally splits the terminal (30/70). Da Vinci runs in the left pane as a direct Claude process with file-based completion signaling. The right pane live-tails Aristotle, Maestro, and Argus output. `/kiln:resume` re-establishes the layout.

**🧹 QA Fixes (v0.6.1, v0.6.2)** &mdash; Dual-reviewer pass (Opus + Sonnet) caught 10 issues: `--context` flag replaced with `--append-system-prompt` launcher, `davinci_complete` path corrected to `tmp/`, tail teardown changed from `"q" Enter` to `C-c`, stale plan reads after Mode 3, config key nesting fixes, concrete pane recovery in resume, and Mnemosyne template prefix restoration.

<details>
<summary>🏛️ <strong>v0.5.0 &mdash; Aristotle (Stage 2 Coordinator)</strong></summary>
<br>

New coordinator agent **Aristotle** (`kiln-planning-coordinator`) owns all of Stage 2: spawns dual planners, runs debate, synthesizes the master plan, validates via Athena (2-retry loop), and handles operator approval. Returns `PLAN_APPROVED` or `PLAN_BLOCKED`. Writes `planning_state.md` event log.

`start.md` de-bloated from 597 to 375 lines &mdash; inline schemas and paths extracted to `kiln-core.md`. Stage 2 reduced to a 5-step coordinator delegation. 172 tests (was 153). 15 agents in roster (was 14).

</details>

<details>
<summary>⚗️ <strong>v0.4.0 &mdash; Plan Validation, Config, Lore, Status &amp; Tech Stack</strong></summary>
<br>

Five features ported from the v1 gap analysis. 19 new tests (153 total).

**🏛️ Plan Validator (Athena)** &mdash; Pre-execution quality gate. After Plato synthesizes the master plan, Athena validates it across 7 dimensions: requirement coverage, atomization quality, file action correctness, dependency graph integrity, phase sizing, scope adherence, and acceptance criteria quality. Bad plans get caught before they waste Codex cycles.

**⚙️ Config System** &mdash; `.kiln/config.json` generated during Stage 1 with tunable preferences (debate mode, review rounds, Codex timeout, phase sizing) and auto-detected tooling for brownfield projects. Agents read config instead of relying on hardcoded protocol values.

**📜 Lore System** &mdash; 60 curated philosophical quotes displayed at 15 pipeline transition points. Lao Tzu at ignition, Einstein at brainstorm, Feynman at validation. Pure polish that makes the pipeline feel alive.

**📊 Status Command** &mdash; `/kiln:status` displays a formatted progress summary: stage, phase, config, validation verdict, phase progress checklist, and recommended next action. Read-only, never modifies files.

**🔬 Tech Stack Living Doc** &mdash; `tech-stack.md` template tracks languages, frameworks, libraries, and build tools discovered during execution. Sherlock updates it during living docs reconciliation alongside decisions, pitfalls, and patterns.

**📐 Protocol Updates** &mdash; 15 rules (was 14), 14 agents (was 13), event enum 27 types (was 25), 4 commands (was 3).

</details>

<details>
<summary>⚡ <strong>v0.3.0 &mdash; Dynamic Execution with JIT Sharpening</strong></summary>
<br>

Six features that restore v1's dynamic execution patterns on top of v2's clean codebase. 13 new tests (134 total).

**Scheherazade JIT Sharpener** &mdash; The prompter agent evolved from static plan-to-prompt translation into a codebase-exploring JIT sharpener. Before generating each implementation prompt, Scheherazade uses Glob, Read, and Grep to explore the *current* codebase, reads living docs, then generates prompts with verbatim file paths, function signatures, and existing patterns baked in.

**Correction Cycles** &mdash; Stage 4 validation failures now generate correction task descriptions that re-enter Stage 3 through the full Scheherazade &rarr; Codex &rarr; Sphinx cycle. Max 3 correction cycles.

**Living Docs Reconciliation** &mdash; After every phase merge, Sherlock updates `decisions.md`, `pitfalls.md`, and `PATTERNS.md`.

**E2E Deployment Testing** &mdash; Argus builds, deploys, and tests the actual running product against acceptance criteria.

**Codebase Index Per Phase** &mdash; Sherlock generates a `codebase-snapshot.md` at the start of each phase.

**Protocol Updates** &mdash; 14 rules (was 10), event enum expanded to 25 types (was 19).

</details>

### 🗺️ Brownfield Support

[Mnemosyne codebase mapper](https://github.com/Fredasterehub/kiln/commit/dda21a7) &mdash; Auto-detects existing projects and maps the codebase with 5 parallel muse sub-agents before brainstorming begins.

### 🎨 Brainstorm Module

[BMAD creative engine import](https://github.com/Fredasterehub/kiln/commit/b5391dd) &mdash; Da Vinci agent with 61 techniques across 10 categories, 50 elicitation methods, anti-bias protocols.

<details>
<summary>🕰️ <strong>Older</strong></summary>
<br>

- [Simplification &amp; shared skill](https://github.com/Fredasterehub/kiln/commit/c6f1acb) &mdash; **v0.2.1**: Single `kiln-core` skill, agent specs compressed 52.6%.
- [Structured trajectory &amp; archive](https://github.com/Fredasterehub/kiln/commit/997e1a3) &mdash; **v0.2.0**: Phase archive, dual-layer handoff, trajectory log.
- [Contract tightening](https://github.com/Fredasterehub/kiln/commit/118e91f) &mdash; **v0.1.1**: Security hardening, QA fixes.
- [Hardening pass](https://github.com/Fredasterehub/kiln/commit/ad9e4c4) &mdash; Unified memory schema, lossless update, cross-platform doctor.
- [Brand rename](https://github.com/Fredasterehub/kiln/commit/4e2cc00) &mdash; kw &rarr; kiln across entire project.
- [Initial implementation](https://github.com/Fredasterehub/kiln/commit/67356d4) &mdash; **v0.1.0**.

</details>

<br>

## 🔥 How It Works

Five stages. Each one uses different models for different jobs.

<p align="center">
  <sub>💡 Brainstorm &rarr; 📐 Plan &rarr; ⚡ Execute &rarr; 🔍 Validate &rarr; ✅ Deliver</sub>
</p>

<table>
<tr>
<td align="center" width="20%">
<br>
💡<br>
<strong>Brainstorm</strong><br>
<sub>You + Da Vinci</sub><br>
<sub>61 techniques</sub>
<br><br>
</td>
<td align="center" width="20%">
<br>
📐<br>
<strong>Plan</strong><br>
<sub>Opus vs GPT</sub><br>
<sub>Debate &amp; synthesize</sub>
<br><br>
</td>
<td align="center" width="20%">
<br>
⚡<br>
<strong>Execute</strong><br>
<sub>Phase by phase</sub><br>
<sub>Sharpen &rarr; Build &rarr; Review</sub>
<br><br>
</td>
<td align="center" width="20%">
<br>
🔍<br>
<strong>Validate</strong><br>
<sub>Deploy &amp; test</sub><br>
<sub>Correct &times; 3</sub>
<br><br>
</td>
<td align="center" width="20%">
<br>
✅<br>
<strong>Deliver</strong><br>
<sub>Summary to you</sub><br>
<sub>Review &amp; approve</sub>
<br><br>
</td>
</tr>
</table>

<details>
<summary>💡 <strong>Stage 1 &mdash; Brainstorm</strong> &nbsp; <sub>interactive</sub></summary>
<br>

You describe what you want. **Da Vinci** facilitates &mdash; 61 techniques across 10 categories, 50 elicitation methods, anti-bias protocols. Pick a depth:

| Depth | Idea Floor | Style |
|:--|:--|:--|
| 🌱 Light | 10 | Quick and focused |
| 🌿 Standard | 30 | Balanced exploration |
| 🌳 Deep | 100 | Thorough |

Brownfield? **Mnemosyne** maps the existing codebase first with 5 parallel muse sub-agents (architecture, tech stack, data model, API surface, quality).

Produces `vision.md` &mdash; problem, users, goals, constraints, stack, success criteria.

</details>

<details>
<summary>📐 <strong>Stage 2 &mdash; Plan</strong> &nbsp; <sub>automated</sub></summary>
<br>

**Aristotle** coordinates the entire stage. Two planners work the same vision in parallel:
- **Confucius** (Opus 4.6) &mdash; Claude perspective
- **Sun Tzu** (GPT-5.2) &mdash; GPT perspective

**Socrates** debates the disagreements. **Plato** synthesizes into `master-plan.md`. **Athena** validates the plan across 7 dimensions. If validation fails, Aristotle loops the planners with feedback (up to 2 retries). You review and approve before execution begins.

Different model families catch different things. The debate forces explicit conflict resolution instead of silent averaging.

</details>

<details>
<summary>⚡ <strong>Stage 3 &mdash; Execute</strong> &nbsp; <sub>automated, per phase</sub></summary>
<br>

**Maestro** runs each phase through a full lifecycle:

| Step | Agent | What happens |
|:--|:--|:--|
| 🔎 **Index** | Sherlock | Fresh codebase snapshot |
| 📐 **Plan** | Confucius + Sun Tzu | Dual-plan, debate, synthesize |
| ✨ **Sharpen** | Scheherazade | Explores the *current* codebase, reads living docs, generates context-rich prompts |
| ⌨️ **Build** | Codex | Executes each sharpened prompt. One task, one commit. |
| 👁️ **Review** | Sphinx | Reviews changes. Reject &rarr; re-sharpen &rarr; fix. Up to 3 rounds. |
| 🔀 **Merge** | Maestro | Phase branch &rarr; main |
| 📚 **Learn** | Sherlock | Appends decisions, pitfalls, and patterns to living docs |

**Sharpen** is the key step. Scheherazade reads real code &mdash; file paths, function signatures, existing patterns &mdash; then generates prompts with verbatim context. GPT-5.2 writing for GPT-5.3-codex. Same family, optimized translation.

**Learn** creates a cross-phase loop. Each phase's discoveries feed into the next.

</details>

<details>
<summary>🔍 <strong>Stage 4 &mdash; Validate</strong> &nbsp; <sub>automated</sub></summary>
<br>

**Argus** builds the project, deploys it, and tests real user flows against the master plan's acceptance criteria.

Failures generate correction tasks through the full **Scheherazade &rarr; Codex &rarr; Sphinx** cycle. Loops until passing or 3 cycles exhausted &mdash; then escalates to you.

</details>

<br>

## 👥 The Crew

Every agent has a name. Not for decoration &mdash; for the logs.

| | Alias | Model | Role |
|:--|:--|:--|:--|
| 🎨 | **Da Vinci** | Opus 4.6 | Brainstorm facilitator &mdash; 61 techniques, anti-bias protocols |
| 🗺️ | **Mnemosyne** | Opus 4.6 | Brownfield codebase mapper &mdash; spawns 5 muse sub-agents |
| 📋 | **Aristotle** | Opus 4.6 | Stage 2 coordinator &mdash; planners, debate, synthesis, validation |
| 📜 | **Confucius** | Opus 4.6 | Claude-side planner |
| ⚔️ | **Sun Tzu** | GPT-5.2 | GPT-side planner |
| 💬 | **Socrates** | Opus 4.6 | Debate moderator |
| 🔮 | **Plato** | Opus 4.6 | Plan synthesizer |
| ✨ | **Scheherazade** | GPT-5.2 | JIT prompt sharpener &mdash; explores codebase, generates context-rich prompts |
| ⌨️ | **Codex** | GPT-5.3 | Code implementer |
| 👁️ | **Sphinx** | Opus 4.6 | Code reviewer |
| 🎯 | **Maestro** | Opus 4.6 | Phase coordinator |
| 🏛️ | **Athena** | Sonnet 4.6 | Plan validator &mdash; 7-dimension quality gate before execution |
| 🛡️ | **Argus** | Opus 4.6 | E2E validator &mdash; deploys, tests, generates corrections |
| 🔍 | **Sherlock** | Haiku 4.5 | Fast researcher &mdash; codebase indexing, living docs reconciliation |

<sub>Plus 5 muse sub-agents spawned by Mnemosyne for brownfield mapping: Clio (architecture), tech stack, data model, API surface, and quality analysis. 19 agents total.</sub>

<br>

## ⌨️ Commands

**In Claude Code:**

| Command | What it does |
|:--|:--|
| `/kiln:start` | 🔥 Brainstorm, plan, execute, validate, ship |
| `/kiln:resume` | ⏯️ Pick up where the last session stopped |
| `/kiln:reset` | 💾 Save state, prepare for `/clear` |
| `/kiln:status` | 📊 Display pipeline progress and next action |

**In terminal:**

| Command | What it does |
|:--|:--|
| `kilntwo install` | 📦 Install agents, commands, protocol, templates |
| `kilntwo uninstall` | 🧹 Manifest-driven removal |
| `kilntwo update` | 🔄 Lossless upgrade via checksum diff |
| `kilntwo doctor` | 🩺 Health check &mdash; Node, CLIs, permissions, manifest |

<br>

<details>
<summary>🧠 <strong>Memory &amp; State</strong></summary>
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
  tech-stack.md    languages, frameworks, libraries, build tools
```

`/kiln:reset` saves state. `/kiln:resume` picks up where it left off &mdash; right down to which task in which phase was last completed.

</details>

<details>
<summary>📦 <strong>What gets installed</strong></summary>
<br>

| What | Where | Count |
|:--|:--|:--|
| Agents | `~/.claude/agents/` | 19 |
| Commands | `~/.claude/commands/kiln/` | 4 |
| Templates | `~/.claude/kilntwo/templates/` | 7 |
| Skill | `~/.claude/kilntwo/skills/` | 1 |
| Data | `~/.claude/kilntwo/data/` | 4 |
| Protocol | `<project>/CLAUDE.md` | injected |
| Manifest | `~/.claude/kilntwo/manifest.json` | 1 |

Manifest-driven with SHA-256 checksums. `update` diffs checksums to preserve your edits. `uninstall` removes exactly what it installed.

</details>

<details>
<summary>🏗️ <strong>Project structure</strong></summary>
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
│   ├── agents/           19 agents
│   ├── commands/kiln/    4 commands
│   ├── data/             brainstorming, elicitation, config, lore
│   ├── skills/           kiln-core
│   ├── templates/        7 templates
│   ├── protocol.md
│   └── names.json
└── test/                 172 tests, zero deps
```

</details>

<details>
<summary>📊 <strong>v1 vs v2</strong></summary>
<br>

| | v1 | v2 |
|:--|:--|:--|
| Agents | 13 | 19 |
| Skills | 26 | 1 (shared) |
| Commands | 8 | 4 |
| Hooks | 3 | 0 |
| Config lines | ~4,000 | ~1,500 |

Same pipeline. More agents, a fraction of the surface area.

</details>

<details>
<summary>🔧 <strong>Troubleshooting</strong></summary>
<br>

**`codex: command not found`** &mdash; `npm install -g @openai/codex`

**Commands missing in Claude Code** &mdash; `kilntwo install`, restart Claude Code, or `kilntwo doctor`

**Pipeline halts** &mdash; Check `.kiln/reviews/` or `.kiln/validation/report.md`, fix, then `/kiln:resume`

</details>

<br>

---

<p align="center">
  <sub>MIT · Zero dependencies · Node 18+ · Built with Claude Code + Codex CLI</sub>
</p>

<p align="center">
  <em>"Perfection is achieved, not when there is nothing more to add,<br>
  but when there is nothing left to take away."</em><br>
  <sub>&mdash; Antoine de Saint-Exup&eacute;ry</sub>
</p>
