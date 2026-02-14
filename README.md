<a id="readme-top"></a>

<div align="center">

<br/>

# 🔥 kiln

### *raw ideas in. verified code out.*

<br/>

> *"You wouldn't fire porcelain at earthenware temperatures.*
> *Why would you use one model for every task?"*

<br/>

[![License: MIT](https://img.shields.io/badge/License-MIT-D4A574?style=for-the-badge)](LICENSE)
[![Node](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Claude Code](https://img.shields.io/badge/Claude_Code-Native-7C3AED?style=for-the-badge&logo=anthropic&logoColor=white)](https://claude.ai/claude-code)
[![Dependencies](https://img.shields.io/badge/Deps-Zero-2ea44f?style=for-the-badge)]()
[![Agents](https://img.shields.io/badge/🤖_Agents-12-E8590C?style=for-the-badge)]()
[![Skills](https://img.shields.io/badge/📜_Skills-15-2563EB?style=for-the-badge)]()

<br/>

**[⚡ Quick Start](#-quick-start)** · **[🧠 How It Works](#-how-it-works)** · **[⚔️ Debate Mode](#%EF%B8%8F-debate-mode)** · **[📖 Commands](#-commands)**

<br/>

</div>

---

<br/>

## 🏺 The Philosophy

We want **elegant, efficient, robust, state-of-the-art code**. Not "good enough." Not "it compiles." Code you'd be proud to show another engineer.

So we went looking. We found [BMAD](https://github.com/bmadcode/BMAD-METHOD) and its wild, structured brainstorming that surfaces ideas you'd never reach alone. We found [Google's Conductor](https://research.google/blog/automated-unit-test-improvement-using-large-language-models-at-google/) and its just-in-time dynamic execution that never plans too far ahead. We found [GSD](https://github.com/cyanheads/claude-code-gsd) and its ruthless efficiency — fresh context per task, goal-backward verification, no wasted tokens. And we looked at Claude Code itself — agents, skills, hooks — native primitives sitting right there, waiting to be orchestrated.

**We took the best parts of all of them and cooked them into one thing.**

Then we added the part nobody else was doing: **multi-model orchestration**. Because here's what we learned after months of building with AI:

- 🟣 **Opus** is the king. If we had one model, it'd be Opus. Deep reasoning, architectural vision, the full picture. No contest.
- 🟢 **GPT-5.2** won't forget that one small detail in your requirements that Opus might gloss over when planning. On plan creation, it's *surgical*.
- ⚡ **Codex** (GPT-5.3) on extremely small, atomic tasks? An absolute **beast**. Months of evidence. Give it a tight, well-scoped implementation prompt and it just *nails* it.
- 💎 **Sonnet** is the workhorse — fast, cheap, reliable for mechanical tasks like validation and verification.
- 🌀 **Gemini 3 Pro** — we see the potential, we want it in the mix, but controlling that model adequately is... a work in progress. *Stay tuned.* 😏

Each model has a temperature it fires best at. **Kiln applies the right heat at the right moment.**

> 🧱 No wrapper. No server. No daemon. Just markdown files baked directly into Claude Code's native agent and skill system. *Clay enters. Ceramic exits.*

<br/>

---

<br/>

## ⚡ Quick Start

```bash
npx kiln-dev
```

That's it. The installer detects your project, copies agents and skills into `.claude/`, creates the `.kiln/` workspace, and configures everything.

Then in Claude Code:

```
🔥  /kiln:fire           ←  Start a new project or resume exactly where you left off.
🧊  /kiln:cool           ←  Pause safely and save a clean resume pointer.
💨  /kiln:quick          ←  Single-pass mode for small, well-understood changes.
📊  /kiln:status         ←  Show progress and the next recommended action.
```

**Four primary commands.** Day-to-day control with one entrypoint and safe resume. ✨

<p align="right"><a href="#readme-top">⬆️ back to top</a></p>

<br/>

---

<br/>

## 🧠 How It Works

Kiln fires your project through **six stages**. The first is interactive. The rest are fully automated.

```
    YOU                              KILN
     │                                │
     │   "I want to build..."    🗣️  │
     │ ─────────────────────────────▶ │
     │                                │
     │      🧠 ┌─────────────────────┤
     │         │  1. BRAINSTORM       │   ◀── You + AI, deep conversation
     │         │     VISION.md        │       Anti-clustering, challenge passes
     │         └──────────┬───────────┤
     │                    │           │
     │      🗺️ ┌──────────▼───────────┤
     │         │  2. ROADMAP          │   ◀── AI breaks vision into phases
     │         │     ROADMAP.md       │       You review and approve
     │         └──────────┬───────────┤
     │                    │           │
     │      📐 ┌──────────▼───────────┤
     │         │  3. PLAN             │   ◀── Two models plan independently
     │         │     Opus ───┐        │       Optional: ⚔️ debate rounds
     │         │     GPT ────┤        │       Then synthesize the best of both
     │         │     Merge ◀─┘        │
     │         └──────────┬───────────┤
     │                    │           │
     │      ⚡ ┌──────────▼───────────┤
     │         │  4. EXECUTE          │   ◀── Prompts sharpened per task
     │         │     Sharpen → Build  │       Fresh 200k context every time
     │         │     → Mini-verify    │       Atomic commits
     │         └──────────┬───────────┤
     │                    │           │
     │      🔍 ┌──────────▼───────────┤
     │         │  5. VERIFY           │   ◀── E2E user journey tests
     │         │     Runtime tests    │       Actually starts your app
     │         │     Code review      │       7-dimension quality gate
     │         └──────────┬───────────┤
     │                    │           │
     │      📚 ┌──────────▼───────────┤
     │         │  6. RECONCILE        │   ◀── Living docs updated
     │         │     Docs refreshed   │       Next phase inherits
     │         │     Next phase ──▶   │       real context
     │         └──────────────────────┤
     │                                │
     │   "Here's your verified app." 🏺│
     │ ◀───────────────────────────── │
```

Each phase repeats steps 3–6. The docs written after phase 1 inform the planning of phase 2. **The 20th task fires with the same precision as the first.** No stale context. No plan rot. No degradation.

<p align="right"><a href="#readme-top">⬆️ back to top</a></p>

<br/>

---

<br/>

## 🍳 Multi-Model Orchestration

This is the core bet. **Two AI models independently plan your architecture, then a synthesizer takes the best of both.**

```
                    ┌─────────────────┐
                    │  📋 Your Phase  │
                    │   Requirements  │
                    └────────┬────────┘
                             │
                ┌────────────┴────────────┐
                │                         │
        ┌───────▼───────┐        ┌───────▼───────┐
        │ 🟣 Claude Opus │       │ 🟢 GPT-5.2    │
        │                │        │               │
        │  The King.     │        │  The Detail   │
        │  Big picture,  │        │  Catcher.     │
        │  security,     │        │  Pragmatic,   │
        │  edge cases.   │        │  nothing      │
        │                │        │  slips by.    │
        └───────┬───────┘        └───────┬───────┘
                │                         │
                └────────────┬────────────┘
                             │
                    ┌────────▼────────┐
                    │  🔀 Synthesizer │
                    │                 │
                    │  Picks the      │
                    │  cleaner arch   │
                    │  from one,      │
                    │  the tighter    │
                    │  error handling │
                    │  from the other.│
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  ✅ Master Plan │
                    │  Better than    │
                    │  either alone.  │
                    └─────────────────┘
```

> 🔌 **No Codex CLI?** Kiln falls back to **Claude-only mode** — the full pipeline still runs with Claude models at every stage. You still get planning, verification, review, and living docs. Multi-model is the premium path, not a requirement.

<p align="right"><a href="#readme-top">⬆️ back to top</a></p>

<br/>

---

<br/>

## ⚔️ Debate Mode

> 🆕 *New in latest release*

The synthesize strategy is *polite*. Each model plans in isolation, then a mediator merges. It works. But sometimes you want the models to actually **argue**.

**Debate mode** introduces structured adversarial rounds before synthesis. The models critique each other, defend their choices, concede when they're wrong, and *only then* does the synthesizer merge — with the full argument trail as context.

```
        ┌──────────┐           ┌──────────┐
        │ 🟣 Claude │          │ 🟢 GPT   │
        │  Plan v1  │           │  Plan v1 │
        └─────┬────┘           └────┬─────┘
              │    ┌──────────┐     │
              └───▶│⚔️Critique│◀────┘        Round 1
              ┌────│  each    │────┐
              │    │  other   │    │
              │    └──────────┘    │
        ┌─────▼────┐           ┌───▼──────┐
        │ 🟣 Claude │          │ 🟢 GPT   │
        │  Plan v2  │           │  Plan v2 │  ← revised & defended
        └─────┬────┘           └────┬─────┘
              │    ┌──────────┐     │
              └───▶│⚔️Critique│◀────┘        Round 2
              ┌────│  again   │────┐
              │    └──────────┘    │
              │                    │
        ┌─────▼────┐           ┌───▼──────┐
        │  Final 🟣 │          │  Final 🟢│
        └─────┬────┘           └────┬─────┘
              │                     │
              └──────────┬──────────┘
                   ┌─────▼─────┐
                   │🔀Synthesize│  ← with full debate trail
                   │  PLAN.md   │
                   └───────────┘
```

The rules are adversarial by design: *challenge assumptions, demand evidence, find gaps — but acknowledge genuine strength.* 🚫 No polite agreements. Defend your choices or concede with reasoning.

Same protocol applies to **code review** — enable `reviewStrategy: "debate"` and an independent GPT reviewer (running GPT-5.3-codex-sparks, a reasoning-capable review model) challenges the Opus reviewer's findings:

- 🤝 **Agreement** between both reviewers = high-confidence signal
- ⚡ **Disagreement** = deeper analysis, the truth gets pressure-tested

Toggle it in `.kiln/config.json`:

```json
{
  "preferences": {
    "planStrategy": "debate",
    "reviewStrategy": "debate",
    "debateRounds": 2
  }
}
```

> 🧠 Rounds auto-terminate on **convergence**. Every critique and revision is preserved as an **audit artifact**. The synthesizer documents which points won and why. Full transparency.

<p align="right"><a href="#readme-top">⬆️ back to top</a></p>

<br/>

---

<br/>

## 🏆 What Makes It Different

|  | 😐 Typical AI Coding | 🔥 Kiln |
|---|---|---|
| 🧠 **Context** | Degrades over conversation | Fresh 200k tokens per task |
| 📐 **Planning** | One model, one shot | Two models, optionally debating ⚔️ |
| ✅ **Verification** | "Looks right to me" 🤞 | Actually runs your app |
| 📚 **Documentation** | Chat logs you'll never read | Living docs that evolve per phase |
| ⚡ **Execution** | One long degrading session | Atomic chirurgical tasks, wave parallelism |
| 🛡️ **Quality gate** | Hope | 7-dimension code review |
| 🤖 **Models** | One model does everything | Right model, right task, right temperature |

<br/>

---

<br/>

## 🔬 The Pipeline in Detail

<details>
<summary>🧠 <b>Stage 1: Brainstorm</b> — <code>/kiln:brainstorm</code></summary>

<br/>

An interactive session between you and the AI. Not "tell me what to build" — a **structured exploration** borrowed from BMAD's playbook:

- 🌀 **Anti-clustering** surfaces ideas you wouldn't think of alone
- ⚔️ **Dual-model challenge passes** — Claude critiques, GPT challenges, your vision gets stress-tested from every angle
- 📄 **Output:** `VISION.md` — a locked, operator-approved project specification with measurable success criteria

> 👤 This is the **only stage** that requires your sustained attention. Everything after is automated.

</details>

<details>
<summary>🗺️ <b>Stage 2: Roadmap</b> — <code>/kiln:roadmap</code></summary>

<br/>

The AI reads your vision and proposes delivery phases — just-in-time planning, Conductor-style. No planning six phases ahead with stale assumptions:

```
📦 Phase 1: Authentication Foundation
📦 Phase 2: Core Task Engine
📦 Phase 3: Real-time Updates
```

You review, reorder, add, remove. Then approve. ✅

</details>

<details>
<summary>📐 <b>Stage 3: Plan</b> — per phase</summary>

<br/>

Two planners work independently on the same phase:

- 🟣 **Claude Planner** (Opus) — the architectural heavyweight. Thorough, security-first, sees edge cases others miss
- 🟢 **Codex Planner** (GPT-5.2) — the detail catcher. Pragmatic, conventional, won't forget that one config flag you need

In **synthesize mode** (default): a Synthesizer merges them directly into the master plan.

In **⚔️ debate mode**: the planners critique each other's work, revise, defend — up to 3 adversarial rounds before synthesis.

A **Validator** then runs a 7-dimension quality check before any code is written. 🛡️

</details>

<details>
<summary>⚡ <b>Stage 4: Execute</b> — per phase</summary>

<br/>

This is where Codex earns its keep. For each task in the plan:

1. 🔧 **Sharpen** — A prompt engineer reads the task packet *and the current codebase*, produces a chirurgical implementation prompt with real file paths and function signatures
2. 🏗️ **Implement** — GPT-5.3-codex executes the tight, atomic task. Fresh 200k context. No baggage from previous tasks.
3. ✅ **Mini-verify** — Run the project's test suite immediately. Catch failures before they compound.
4. 📦 **Commit** — One atomic commit per task. Revertible. Auditable.

Tasks in the same wave run **in parallel**. Later waves wait. GSD-style efficiency.

</details>

<details>
<summary>🔍 <b>Stage 5: Verify</b> — per phase</summary>

<br/>

Two quality gates, no shortcuts:

- 🧪 **E2E Verifier** — Generates user journey tests, starts your app, and runs them. Not unit tests — **real user flows**.
- 🛡️ **Reviewer** (Opus) — 7-dimension code review: correctness, completeness, security, integration, stub detection, quality, regressions.

In **⚔️ review debate mode**: an independent GPT reviewer produces a competing assessment. Both reviewers critique each other. Agreement = real issue. Disagreement = dig deeper.

Rejections generate correction tasks that flow **back through the pipeline**. 🔄 Up to 3 correction cycles before hard halt.

</details>

<details>
<summary>📚 <b>Stage 6: Reconcile</b> — per phase</summary>

<br/>

Living documentation updated with what **actually happened** — Conductor-style knowledge transfer:

- 🔧 `TECH_STACK.md` — what's in use now
- 🏛️ `PATTERNS.md` — conventions established
- 💭 `DECISIONS.md` — why things were done this way
- ⚠️ `PITFALLS.md` — gotchas discovered

Budget-enforced (~3000 words each). Outdated entries are **replaced, not appended**. The next phase's planner reads these docs — real institutional memory, not archaeological artifacts. 🏺

</details>

<p align="right"><a href="#readme-top">⬆️ back to top</a></p>

<br/>

---

<br/>

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ ⌨️                   SLASH COMMANDS                          │
│  /kiln:fire  /kiln:cool  /kiln:quick  /kiln:status          │
│  /kiln:init  /kiln:brainstorm  /kiln:roadmap  /kiln:track   │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│ 🎯                 ORCHESTRATOR (Opus)                       │
│  Thin traffic cop. ~15% context budget.                      │
│  Routes stages, spawns subagents, tracks state.              │
│  Never writes code.                                          │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│ 🤖                 EXECUTION AGENTS                          │
│                                                              │
│  ┌─────────┐ ┌──────────┐ ┌───────────┐ ┌────────┐         │
│  │📐Planner│ │🟢 Codex  │ │🔀Synthesiz│ │🛡️Valid.│         │
│  │ (Opus)  │ │ Planner  │ │  (Opus)   │ │(Sonnet)│         │
│  └────┬────┘ │ (Sonnet) │ └─────┬─────┘ └────┬───┘         │
│       │      └────┬─────┘       │             │             │
│       │           │             │             │             │
│  ┌────▼───┐ ┌─────▼────┐ ┌─────▼─────┐ ┌────▼────┐        │
│  │🔧Sharp.│ │⚡Execute │ │🧪E2E Veri.│ │🔍Review │        │
│  │(Sonnet)│ │ (Codex)  │ │ (Sonnet)  │ │ (Opus)  │        │
│  └────────┘ └──────────┘ └───────────┘ └─────────┘        │
│                                                              │
│  ┌────────────┐  ┌────────────┐  ┌──────────────┐          │
│  │🔎Researcher│  │🧠Brainstorm│  │⚔️Codex Revwr│  Utility  │
│  │  (Haiku)   │  │  (Opus)    │  │  (Codex)     │  agents   │
│  └────────────┘  └────────────┘  └──────────────┘          │
└──────────────────────────────────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│ 💾                   .kiln/ STATE                            │
│                                                              │
│  config.json    VISION.md     ROADMAP.md    STATE.md         │
│  docs/          tracks/       FINAL_REPORT.md                │
│                                                              │
│  All state is files. Git-native. Survives session resets. 🔄 │
└──────────────────────────────────────────────────────────────┘
```

<details>
<summary>📊 <b>Model Routing Table</b> — <i>right temperature, right moment</i></summary>

<br/>

| Role | Model | Why |
|---|---|---|
| 🎯 Orchestrator | Opus 4.6 | Deep reasoning for routing decisions |
| 📐 Planner | Opus 4.6 | Architectural heavyweight |
| 🟢 Codex Planner | GPT-5.2 | Catches details Opus glosses over |
| 🔀 Synthesizer | Opus 4.6 | Complex merging judgment |
| 🛡️ Validator | Sonnet | Fast mechanical checking |
| 🔧 Sharpener | Sonnet + GPT-5.2 | Prompt engineering |
| ⚡ Executor | GPT-5.3-codex | Atomic task beast mode |
| 🧪 E2E Verifier | Sonnet | Test generation |
| 🔍 Reviewer | Opus 4.6 | Deep code review |
| ⚔️ Codex Reviewer | GPT-5.3-codex-sparks | Independent review (debate) |
| 🔎 Researcher | Haiku | Fast, cheap retrieval |
| 🧠 Brainstormer | Opus 4.6 | Creative exploration |

</details>

<p align="right"><a href="#readme-top">⬆️ back to top</a></p>

<br/>

---

<br/>

## 📁 Project Structure

```
kiln/
├── 🤖 agents/                  # 12 AI agent definitions
│   ├── kiln-orchestrator       #   🎯 Traffic cop
│   ├── kiln-brainstormer       #   🧠 Vision exploration
│   ├── kiln-planner            #   📐 Claude-side planning (+ debate)
│   ├── kiln-codex-planner      #   🟢 GPT-side planning (+ debate)
│   ├── kiln-synthesizer        #   🔀 Plan merging (debate-aware)
│   ├── kiln-validator          #   🛡️ Plan quality gate
│   ├── kiln-sharpener          #   🔧 Prompt engineering
│   ├── kiln-executor           #   ⚡ Code generation
│   ├── kiln-e2e-verifier       #   🧪 Runtime testing
│   ├── kiln-reviewer           #   🔍 Code review (+ debate)
│   ├── kiln-codex-reviewer     #   ⚔️ Independent GPT review
│   └── kiln-researcher         #   🔎 On-demand lookup
│
├── 📜 skills/                  # 15 skill definitions
│   ├── kiln-core/              #   🏛️ Universal contracts
│   ├── kiln-init/              #   🚀 Project setup
│   ├── kiln-brainstorm/        #   🧠 BMAD-style brainstorm
│   ├── kiln-plan/              #   📐 Planning format
│   ├── kiln-execute/           #   ⚡ Execution protocol
│   ├── kiln-e2e/               #   🧪 Test patterns
│   ├── kiln-verify/            #   ✅ Verification protocol
│   ├── kiln-track/             #   🔥 Main work loop
│   ├── kiln-reconcile/         #   📚 Doc reconciliation
│   ├── kiln-roadmap/           #   🗺️ Phase generation
│   ├── kiln-status/            #   📊 Progress display
│   ├── kiln-quick/             #   💨 Single-pass mode
│   ├── kiln-fire/              #   🔥 Start/resume router
│   ├── kiln-cool/              #   🧊 Pause and save recovery pointer
│   └── kiln-debate/            #   ⚔️ Adversarial debate protocol
│
├── 🪝 hooks/                   # Claude Code lifecycle hooks
│   ├── hooks.json              #   📋 Hook registration
│   └── scripts/
│       ├── on-session-start    #   🔄 State rehydration
│       └── on-task-completed   #   ✅ Mini-verify gate
│
├── 📝 templates/               # Workspace templates
├── 🔧 bin/install.js           # Interactive installer
└── 📦 package.json             # Zero runtime dependencies
```

<p align="right"><a href="#readme-top">⬆️ back to top</a></p>

<br/>

---

<br/>

## 🧬 The Lineage

Kiln didn't come from nowhere. We went looking for the best ideas in AI-assisted development, took what worked, left what didn't, and fired them all together into something new. 🔥

| System | 🎁 What We Took | 🗑️ What We Left Behind |
|---|---|---|
| 🧠 **[BMAD Method](https://github.com/bmadcode/BMAD-METHOD)** | Crazy structured brainstorming, anti-clustering, facilitation personas, challenge passes that break your assumptions | The full persona framework — Kiln uses Claude Code's native agent system instead |
| 🎛️ **[Google Conductor](https://research.google/blog/automated-unit-test-improvement-using-large-language-models-at-google/)** | Dynamic just-in-time execution, living documentation, workflow-as-data, reconciliation loops | The infrastructure overhead — Kiln is pure markdown, no servers, no infra |
| ⚡ **[GSD Framework](https://github.com/cyanheads/claude-code-gsd)** | Fresh context per task, goal-backward verification, plan validation gates, phase-based execution | The external tracking layer — Kiln uses `.kiln/STATE.md` as the single source of truth |
| 🔀 **Multi-model patterns** | Perspective fusion, competing plans, adversarial debate, synthesis | Nothing — we went **further** with structured debate rounds ⚔️ |

> 🏺 The result is a workflow that feels native to Claude Code because it ***is*** native. Agents, skills, and hooks — the same primitives Claude Code already understands. No wrapper framework. No middleware. No runtime. Just structured markdown that teaches Claude Code to think in phases, fire each task at the right temperature, and produce ceramic instead of clay.

<p align="right"><a href="#readme-top">⬆️ back to top</a></p>

<br/>

---

<br/>

## 📖 Commands

| Command | Description |
|---|---|
| 🔥 `/kiln:fire` | Primary entrypoint: start new work or resume from `.kiln/STATE.md` |
| 🧊 `/kiln:cool` | Pause gracefully and save session recovery metadata for reliable resume |
| 💨 `/kiln:quick` | Lightweight single-pass mode for small, well-understood changes |
| 📊 `/kiln:status` | Display project progress and route to the next recommended action |

<details>
<summary>Power User Commands</summary>

<br/>

| Command | Description |
|---|---|
| 🚀 `/kiln:init` | Detect project tooling, create `.kiln/` workspace, configure model mode |
| 🧠 `/kiln:brainstorm` | Interactive vision exploration with challenge passes |
| 🗺️ `/kiln:roadmap` | Generate delivery phases from approved vision |
| 🔥 `/kiln:track` | Execute the full loop: plan → validate → execute → E2E → review → reconcile |

</details>

<br/>

## 📥 Install Options

```bash
# 📁 Into current project
npx kiln-dev

# 📂 Into a specific repo
npx kiln-dev --repo-root /path/to/project

# 🤖 Non-interactive
npx kiln-dev --yes

# 🌐 Global install (~/.claude/)
npx kiln-dev --global
```

### Requirements

| | What | Why |
|---|---|---|
| ✅ | **Claude Code** | The CLI this workflow runs inside |
| ✅ | **Node.js 18+** | For the installer |
| 💎 | **Codex CLI** *(optional)* | Enables multi-model mode — the premium path |

<br/>

---

<div align="center">

<br/>

```
       🧱 raw ideas in
            │
            ▼
    ┌───────────────┐
    │               │
    │    🔥 kiln    │     brainstorm ── roadmap ── plan
    │               │     debate ── execute ── verify
    │               │     reconcile ── repeat
    │               │
    └───────┬───────┘
            │
            ▼
      🏺 verified code out
```

<br/>

*Every model has a strength. The trick is knowing which flame to apply.* 🔥

<br/>

**MIT License** · Built with Claude Code

<br/>

</div>
