<a id="readme-top"></a>

<div align="center">

<br/>

# 🔥 kiln

### *raw ideas in. verified code out.*

**Multi-model AI orchestration baked directly into Claude Code.**<br/>
No wrapper. No server. No daemon. Just markdown that rewires how Claude thinks.

<br/>

[![License: MIT](https://img.shields.io/badge/License-MIT-D4A574?style=for-the-badge)](LICENSE)
[![Node](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Claude Code](https://img.shields.io/badge/Claude_Code-Native-7C3AED?style=for-the-badge&logo=anthropic&logoColor=white)](https://claude.ai/claude-code)
[![Dependencies](https://img.shields.io/badge/Deps-Zero-2ea44f?style=for-the-badge)]()
[![Agents](https://img.shields.io/badge/Agents-12-E8590C?style=for-the-badge)]()
[![Skills](https://img.shields.io/badge/Skills-13-2563EB?style=for-the-badge)]()

<br/>

**[⚡ Quick Start](#-quick-start)** · **[🧠 How It Works](#-how-it-works)** · **[⚔️ Debate Mode](#%EF%B8%8F-debate-mode)** · **[📖 Commands](#-commands)**

<br/>

*Clay enters. Ceramic exits.* 🏺

</div>

<br/>

---

<br/>

## 😤 The Problem

You have an idea. You open Claude Code. You start typing.

Three hours later you're **47 messages deep**. The AI forgot what you said in message 12. It's repeating itself. It contradicts a decision from an hour ago. The code *kind of* works but nobody verified it end-to-end. Your "living documentation" is a chat log you'll never read again.

> **💀 This is context rot.** And it kills ambitious projects.

<br/>

## 💡 The Idea

What if every task got a *fresh* **200k-token context** — not the dregs of a long conversation?

What if two competing AI models **debated** your architecture before a single line was written?

What if every feature was verified by *actually running your application*, not just checking syntax?

**Kiln** is a structured orchestration workflow that turns Claude Code from a chatbot into a **build system**. It fuses ideas from [BMAD](#-the-lineage), [Google Conductor](#-the-lineage), and [GSD](#-the-lineage) — then cooks them directly into Claude Code's native agent, skill, and hook primitives.

> 🧱 **No wrapper. No server. No daemon.** Just markdown files that make Claude Code think differently.

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
🧠  /kiln:brainstorm     ←  Start here. Deep conversation about what you're building.
🗺️  /kiln:roadmap        ←  Break your vision into delivery phases.
🔥  /kiln:track          ←  Execute. Plan → Build → Verify → Review → Reconcile.
```

**Three commands.** Idea to verified application.

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
     │         │     Claude ──┐       │       Optional: ⚔️ debate rounds
     │         │     GPT ─────┤       │       Then synthesize the best of both
     │         │     Merge ◀──┘       │
     │         └──────────┬───────────┤
     │                    │           │
     │      ⚡ ┌──────────▼───────────┤
     │         │  4. EXECUTE          │   ◀── Prompts sharpened per task
     │         │     Sharpen → Build  │       Fresh context every time
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

Each phase repeats steps 3–6. The docs written after phase 1 inform the planning of phase 2. No stale context. No plan rot. **The 20th task executes with the same quality as the first.**

<p align="right"><a href="#readme-top">⬆️ back to top</a></p>

<br/>

---

<br/>

## 🍳 The Secret Sauce

Kiln's signature move: **two AI models independently plan your architecture, then a synthesizer takes the best of both.**

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
        │  Thorough      │        │  Pragmatic    │
        │  Security-first│        │  Conventional │
        │  Edge-case     │        │  Simple       │
        │  aware         │        │  Fast         │
        └───────┬───────┘        └───────┬───────┘
                │                         │
                └────────────┬────────────┘
                             │
                    ┌────────▼────────┐
                    │  🔀 Synthesizer │
                    │                 │
                    │  Takes cleaner  │
                    │  architecture   │
                    │  from one,      │
                    │  better error   │
                    │  handling from  │
                    │  the other.     │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  ✅ Master Plan │
                    │  Better than    │
                    │  either alone   │
                    └─────────────────┘
```

> 🔌 **No Codex CLI?** Kiln falls back to **Claude-only mode** — the full pipeline still runs with Claude models at every stage. You still get planning, verification, review, and living docs. Multi-model is the premium path, not a requirement.

<p align="right"><a href="#readme-top">⬆️ back to top</a></p>

<br/>

---

<br/>

## ⚔️ Debate Mode

> 🆕 **New feature**

The synthesize strategy is *polite*. Each model plans in isolation, then a mediator merges. It works. But sometimes you want the models to actually **argue**.

**Debate mode** introduces structured adversarial rounds before synthesis:

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
                   │🔀Synthesize│  ← with full debate context
                   │  PLAN.md   │
                   └───────────┘
```

The rules are adversarial by design: *challenge assumptions, demand evidence, find gaps — but acknowledge genuine strength.* 🚫 Models can't just agree to be polite. They have to **defend** their choices or **concede** with reasoning.

The same protocol applies to **code review**. Enable `reviewStrategy: "debate"` and an independent GPT reviewer challenges the Opus reviewer's findings. 🤝 Agreement = high-confidence signal. ⚡ Disagreement = deeper analysis.

Toggle it in `.kiln/config.json`:

```json
{
  "preferences": {
    "planStrategy": "debate",      // 💬 "synthesize" (default) | "debate"
    "reviewStrategy": "debate",    // 🔍 "single" (default) | "debate"
    "debateRounds": 2              // 🔄 max rounds: 1-3
  }
}
```

> 🧠 Rounds auto-terminate on **convergence**. Every critique and revision is preserved as an **audit artifact**. The synthesizer reads the full debate trail and documents which points won and why.

<p align="right"><a href="#readme-top">⬆️ back to top</a></p>

<br/>

---

<br/>

## 🏆 What Makes It Different

|  | 😐 Typical AI Coding | 🔥 Kiln |
|---|---|---|
| 🧠 **Context** | Degrades over conversation | Fresh 200k tokens per task |
| 📐 **Planning** | One model, one perspective | Two models, optionally debating ⚔️ |
| ✅ **Verification** | "Looks right to me" | Actually runs your app |
| 📚 **Documentation** | Chat logs | Living docs that evolve per phase |
| ⚡ **Execution** | One long session | Atomic tasks, wave parallelism |
| 🛡️ **Quality gate** | Hope 🤞 | 7-dimension code review |
| 🔍 **Review** | Single reviewer | Optional dual-model debate |

<br/>

---

<br/>

## 🔬 The Pipeline in Detail

<details>
<summary>🧠 <b>Stage 1: Brainstorm</b> — <code>/kiln:brainstorm</code></summary>

<br/>

An interactive session between you and the AI. Not "tell me what to build" — a **structured exploration**:

- 🌀 **Anti-clustering** surfaces ideas you wouldn't think of alone
- ⚔️ **Dual-model challenge passes** (Claude critiques, GPT challenges) stress-test your vision
- 📄 **Output:** `VISION.md` — a locked, operator-approved project specification with success criteria

> 👤 This is the **only stage** that requires your sustained attention. Everything after is automated.

</details>

<details>
<summary>🗺️ <b>Stage 2: Roadmap</b> — <code>/kiln:roadmap</code></summary>

<br/>

The AI reads your vision and proposes delivery phases:

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

Two planners work independently:

- 🟣 **Claude Planner** (Opus) — thorough, security-first, edge-case-aware
- 🟢 **Codex Planner** (GPT-5.2) — pragmatic, conventional, simple

In **synthesize mode** (default): a Synthesizer merges them directly into the master plan.

In **⚔️ debate mode**: the planners critique each other's work, revise, and iterate for up to 3 rounds before synthesis. The synthesizer reads the full debate trail.

A **Validator** runs a 7-dimension quality check before any code is written. 🛡️

</details>

<details>
<summary>⚡ <b>Stage 4: Execute</b> — per phase</summary>

<br/>

For each task in the plan:

1. 🔧 **Sharpen** — A prompt engineer reads the task packet *and the current codebase*, produces a self-contained implementation prompt with real file paths and function signatures
2. 🏗️ **Implement** — GPT-5.3-codex (or Sonnet in Claude-only mode) writes the code
3. ✅ **Mini-verify** — Run the project's test suite immediately. Catch failures fast.
4. 📦 **Commit** — One atomic commit per task

Tasks in the same wave run **in parallel**. Later waves wait.

</details>

<details>
<summary>🔍 <b>Stage 5: Verify</b> — per phase</summary>

<br/>

Two quality gates:

- 🧪 **E2E Verifier** — Generates user journey tests, starts your app, and runs them. Not unit tests — **real user flows**.
- 🛡️ **Reviewer** — 7-dimension code review: correctness, completeness, security, integration, stub detection, quality, regressions.

In **⚔️ review debate mode**: an independent GPT reviewer (GPT-5.3-codex-sparks) produces a competing review. Both reviewers critique each other's findings. 🤝 Agreement = high confidence. ⚡ Disagreement = deeper analysis.

Rejections generate correction tasks that flow **back through the pipeline**. 🔄

</details>

<details>
<summary>📚 <b>Stage 6: Reconcile</b> — per phase</summary>

<br/>

Living documentation updated with what **actually happened**:

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
│  /kiln:init  /kiln:brainstorm  /kiln:roadmap                │
│  /kiln:track  /kiln:status  /kiln:quick                     │
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
│  │🔧Sharp.│ │🏗️Execute│ │🧪E2E Veri.│ │🔍Review │        │
│  │(Sonnet)│ │ (Sonnet) │ │ (Sonnet)  │ │ (Opus)  │        │
│  └────────┘ └──────────┘ └───────────┘ └─────────┘        │
│                                                              │
│  ┌────────────┐  ┌────────────┐  ┌──────────────┐          │
│  │🔎Researcher│  │🧠Brainstorm│  │⚔️Codex Revwr│  Utility  │
│  │  (Haiku)   │  │  (Opus)    │  │   (Sonnet)   │  agents   │
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
<summary>📊 <b>Model Routing Table</b></summary>

<br/>

| Role | Model | Why |
|---|---|---|
| 🎯 Orchestrator | Opus 4.6 | Deep reasoning for routing |
| 📐 Planner | Opus 4.6 | Thorough architecture |
| 🟢 Codex Planner | GPT-5.2 | Alternative perspective |
| 🔀 Synthesizer | Opus 4.6 | Complex merging judgment |
| 🛡️ Validator | Sonnet | Mechanical checking |
| 🔧 Sharpener | Sonnet + GPT-5.2 | Prompt engineering |
| 🏗️ Executor | GPT-5.3-codex | Code generation |
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
│   ├── kiln-planner            #   📐 Claude-side planning (+ critique/revise)
│   ├── kiln-codex-planner      #   🟢 GPT-side planning (+ critique/revise)
│   ├── kiln-synthesizer        #   🔀 Plan merging (debate-aware)
│   ├── kiln-validator          #   🛡️ Plan quality gate
│   ├── kiln-sharpener          #   🔧 Prompt engineering
│   ├── kiln-executor           #   🏗️ Code generation
│   ├── kiln-e2e-verifier       #   🧪 Runtime testing
│   ├── kiln-reviewer           #   🔍 Code review (+ debate mode)
│   ├── kiln-codex-reviewer     #   ⚔️ Independent GPT review (debate)
│   └── kiln-researcher         #   🔎 On-demand lookup
│
├── 📜 skills/                  # 13 skill definitions
│   ├── kiln-core/              #   🏛️ Universal contracts & config schema
│   ├── kiln-init/              #   🚀 Project setup
│   ├── kiln-brainstorm/        #   🧠 Brainstorm protocol
│   ├── kiln-plan/              #   📐 Planning format
│   ├── kiln-execute/           #   ⚡ Execution protocol
│   ├── kiln-e2e/               #   🧪 Test patterns
│   ├── kiln-verify/            #   ✅ Verification protocol
│   ├── kiln-track/             #   🔥 Main work loop
│   ├── kiln-reconcile/         #   📚 Doc reconciliation
│   ├── kiln-roadmap/           #   🗺️ Phase generation
│   ├── kiln-status/            #   📊 Progress display
│   ├── kiln-quick/             #   💨 Single-pass mode
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

Kiln didn't come from nowhere. It's what happens when you take four systems that each solved *part* of the problem and fire them all in the same kiln. 🔥

| System | 🎁 What We Took | 🗑️ What We Left Behind |
|---|---|---|
| 🧠 **[BMAD Method](https://github.com/bmadcode/BMAD-METHOD)** | Deep interactive brainstorming, anti-clustering, facilitation personas, challenge passes | The full persona framework — Kiln uses Claude Code's native agent system instead |
| 🎵 **[Google Conductor](https://research.google/blog/automated-unit-test-improvement-using-large-language-models-at-google/)** | Just-in-time planning, living documentation, workflow-as-data, reconciliation loops | The infrastructure overhead — Kiln is pure markdown, no servers |
| ⚡ **[GSD Framework](https://github.com/cyanheads/claude-code-gsd)** | Fresh context per task, goal-backward verification, plan validation gates, phase-based execution | The external tracking layer — Kiln uses `.kiln/STATE.md` as the single source of truth |
| 🔀 **Dual-model patterns** | Multi-model perspective fusion, competing plans, adversarial debate, synthesis | Nothing — we went **further** with structured debate rounds ⚔️ |

> 🏺 The result: a workflow that feels native to Claude Code because it ***is*** native. Agents, skills, and hooks — the same primitives Claude Code already understands. No wrapper framework. No middleware. No runtime. Just structured markdown that teaches Claude Code to think in phases.

<p align="right"><a href="#readme-top">⬆️ back to top</a></p>

<br/>

---

<br/>

## 📖 Commands

| Command | Description |
|---|---|
| 🚀 `/kiln:init` | Detect project tooling, create `.kiln/` workspace, configure model mode |
| 🧠 `/kiln:brainstorm` | Interactive vision exploration with challenge passes |
| 🗺️ `/kiln:roadmap` | Generate delivery phases from approved vision |
| 🔥 `/kiln:track` | Execute the full loop: plan → validate → execute → E2E → review → reconcile |
| 📊 `/kiln:status` | Display current phase, step, and project progress |
| 💨 `/kiln:quick` | Single-pass mode for smaller tasks (skip brainstorm/roadmap) |

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
| 💎 | **Codex CLI** *(optional)* | Enables multi-model mode with GPT-5.2/5.3 |

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

**MIT License** · Built with 🔥 and Claude Code

<br/>

</div>
