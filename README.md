<div align="center">

```
    ╭─────────────────────────────────────────╮
    │                                         │
    │          ▄█▀▀▀█▄                        │
    │         ██     ██   ╔═╗                 │
    │         ██▄▄▄▄▄██   ║ ║                 │
    │         ██     ██   ╚═╝                 │
    │         ▀▀     ▀▀                       │
    │                                         │
    │   k  i  l  n                            │
    │                                         │
    │   raw ideas in. verified code out.      │
    │                                         │
    ╰─────────────────────────────────────────╯
```

**Multi-model AI orchestration for Claude Code**

*Clay enters. Ceramic exits.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org)
[![Claude Code](https://img.shields.io/badge/Claude_Code-Compatible-blueviolet.svg)](https://claude.ai/claude-code)

</div>

---

## The Problem

You have an idea. You open Claude Code. You start typing.

Three hours later, you're 47 messages deep. The AI has forgotten what you said in message 12. It's repeating itself. It contradicts a decision from an hour ago. The code kind of works but nobody verified it end-to-end. Your "living documentation" is a chat log you'll never read again.

**This is context rot.** And it kills ambitious projects.

## The Idea

What if every task got a *fresh* 200k-token context — not the dregs of a long conversation? What if two competing AI models debated your architecture before a line was written? What if every feature was verified by actually *running* your application, not just checking syntax?

**Kiln** is a structured orchestration workflow that turns Claude Code from a chatbot into a build system.

---

## How It Works

Kiln processes your project through six stages. The first is interactive. The rest are automated.

```
    YOU                              KILN
     │                                │
     │   "I want to build..."         │
     │ ─────────────────────────────▶ │
     │                                │
     │         ┌──────────────────────┤
     │         │  1. BRAINSTORM       │   ◀── You + AI, deep conversation
     │         │     VISION.md        │       Anti-clustering, challenge passes
     │         └──────────┬───────────┤
     │                    │           │
     │         ┌──────────▼───────────┤
     │         │  2. ROADMAP          │   ◀── AI breaks vision into phases
     │         │     ROADMAP.md       │       You review and approve
     │         └──────────┬───────────┤
     │                    │           │
     │         ┌──────────▼───────────┤
     │         │  3. PLAN             │   ◀── Two models plan independently
     │         │     Claude ──┐       │       Then a synthesizer merges
     │         │     GPT ─────┤       │       the best of both
     │         │     Merge ◀──┘       │
     │         └──────────┬───────────┤
     │                    │           │
     │         ┌──────────▼───────────┤
     │         │  4. EXECUTE          │   ◀── Prompts sharpened per task
     │         │     Sharpen → Build  │       Fresh context every time
     │         │     → Mini-verify    │       Atomic commits
     │         └──────────┬───────────┤
     │                    │           │
     │         ┌──────────▼───────────┤
     │         │  5. VERIFY           │   ◀── E2E user journey tests
     │         │     Runtime tests    │       Actually starts your app
     │         │     Code review      │       7-dimension quality gate
     │         └──────────┬───────────┤
     │                    │           │
     │         ┌──────────▼───────────┤
     │         │  6. RECONCILE        │   ◀── Living docs updated
     │         │     Docs refreshed   │       Next phase inherits
     │         │     Next phase ──▶   │       real context
     │         └──────────────────────┤
     │                                │
     │   "Here's your verified app."  │
     │ ◀───────────────────────────── │
```

Each phase repeats steps 3-6. The docs written after phase 1 inform the planning of phase 2. No stale context. No plan rot. The 20th task executes with the same quality as the first.

---

## The Multi-Model Advantage

Kiln's signature feature: **two AI models independently plan your architecture, then a synthesizer takes the best of both.**

```
                    ┌─────────────────┐
                    │   Your Phase    │
                    │   Requirements  │
                    └────────┬────────┘
                             │
                ┌────────────┴────────────┐
                │                         │
        ┌───────▼───────┐        ┌───────▼───────┐
        │  Claude Opus   │        │   GPT-5.2     │
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
                    │   Synthesizer   │
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
                    │  Master Plan    │
                    │  Better than    │
                    │  either alone   │
                    └─────────────────┘
```

No Codex CLI? Kiln falls back to **Claude-only mode** — the full pipeline still runs with Claude models at every stage. You still get planning, verification, review, and living docs. Multi-model is the premium path, not a requirement.

---

## What Makes It Different

| Feature | Typical AI Coding | Kiln |
|---|---|---|
| **Context** | Degrades over conversation | Fresh 200k tokens per task |
| **Planning** | One model, one perspective | Two models, synthesized |
| **Verification** | "Looks right to me" | Actually runs your app |
| **Documentation** | Chat logs | Living docs that evolve |
| **Execution** | One long session | Atomic tasks, wave parallelism |
| **Quality gate** | Hope | 7-dimension code review |

---

## Quick Start

```bash
npx kiln-dev
```

That's it. The installer detects your project, copies agents and skills into `.claude/`, creates the `.kiln/` workspace, and configures everything.

Then in Claude Code:

```
/kiln:brainstorm     ←  Start here. Deep conversation about what you're building.
/kiln:roadmap        ←  Break your vision into delivery phases.
/kiln:track          ←  Execute. Plan → Build → Verify → Review → Reconcile.
```

---

## The Pipeline in Detail

### Stage 1: Brainstorm `/kiln:brainstorm`

An interactive session between you and the AI. Not "tell me what to build" — a structured exploration:

- **Anti-clustering** surfaces ideas you wouldn't think of alone
- **Dual-model challenge passes** (Claude critiques, GPT challenges) stress-test your vision
- **Output:** `VISION.md` — a locked, operator-approved project specification with success criteria

This is the only stage that requires your sustained attention. Everything after is automated.

### Stage 2: Roadmap `/kiln:roadmap`

The AI reads your vision and proposes delivery phases:

```markdown
## Phase 1: Authentication Foundation
Set up user model, JWT auth, login/signup endpoints.

## Phase 2: Core Task Engine
CRUD operations, task assignment, status tracking.

## Phase 3: Real-time Updates
WebSocket notifications, live dashboard refresh.
```

You review, reorder, add, remove. Then approve.

### Stage 3: Plan (per phase)

Two planners work independently:

- **Claude Planner** (Opus) — thorough, security-first, edge-case-aware
- **Codex Planner** (GPT-5.2) — pragmatic, conventional, simple

A **Synthesizer** merges them into the master plan: atomic task packets with goals, acceptance criteria, file hints, and wave assignments. A **Validator** runs a 7-dimension quality check before any code is written.

### Stage 4: Execute (per phase)

For each task in the plan:

1. **Sharpen** — A prompt engineer reads the task packet *and the current codebase*, then produces a self-contained implementation prompt with real file paths and function signatures
2. **Implement** — GPT-5.3-codex (or Sonnet in Claude-only mode) writes the code
3. **Mini-verify** — Run the project's test suite immediately. Catch failures fast.
4. **Commit** — One atomic commit per task

Tasks in the same wave run in parallel. Later waves wait.

### Stage 5: Verify (per phase)

Two quality gates:

- **E2E Verifier** — Generates user journey tests, starts your app, and runs them. Not unit tests — real user flows.
- **Reviewer** — 7-dimension code review: correctness, completeness, security, integration, stub detection, quality, regressions. Rejections generate correction tasks that flow back through the pipeline.

### Stage 6: Reconcile (per phase)

Living documentation updated with what actually happened:

- `TECH_STACK.md` — what's in use now
- `PATTERNS.md` — conventions established
- `DECISIONS.md` — why things were done this way
- `PITFALLS.md` — gotchas discovered

Budget-enforced (~3000 words each). Outdated entries are replaced, not appended. The next phase's planner reads these docs — real institutional memory, not archaeological artifacts.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      SLASH COMMANDS                          │
│  /kiln:init  /kiln:brainstorm  /kiln:roadmap                │
│  /kiln:track  /kiln:status  /kiln:quick                     │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│                    ORCHESTRATOR (Opus)                        │
│  Thin traffic cop. ~15% context budget.                      │
│  Routes stages, spawns subagents, tracks state.              │
│  Never writes code.                                          │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│                  EXECUTION AGENTS                             │
│                                                              │
│  ┌─────────┐ ┌──────────┐ ┌───────────┐ ┌────────┐         │
│  │ Planner │ │ Codex    │ │Synthesizer│ │Validate│         │
│  │ (Opus)  │ │ Planner  │ │  (Opus)   │ │(Sonnet)│         │
│  └────┬────┘ │ (Sonnet) │ └─────┬─────┘ └────┬───┘         │
│       │      └────┬─────┘       │             │             │
│       │           │             │             │             │
│  ┌────▼───┐ ┌─────▼────┐ ┌─────▼─────┐ ┌────▼────┐        │
│  │Sharpen │ │ Executor │ │E2E Verify │ │Reviewer │        │
│  │(Sonnet)│ │ (Sonnet) │ │ (Sonnet)  │ │ (Opus)  │        │
│  └────────┘ └──────────┘ └───────────┘ └─────────┘        │
│                                                              │
│  ┌────────────┐  ┌────────────┐                             │
│  │ Researcher │  │ Brainstorm │  Utility agents              │
│  │  (Haiku)   │  │  (Opus)    │  spawned on demand           │
│  └────────────┘  └────────────┘                             │
└──────────────────────────────────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│                      .kiln/ STATE                            │
│                                                              │
│  config.json    VISION.md     ROADMAP.md    STATE.md         │
│  docs/          tracks/       FINAL_REPORT.md                │
│                                                              │
│  All state is files. Git-native. Survives session resets.    │
└──────────────────────────────────────────────────────────────┘
```

### Model Routing

| Role | Model | Why |
|---|---|---|
| Orchestrator | Opus 4.6 | Deep reasoning for routing |
| Planner | Opus 4.6 | Thorough architecture |
| Codex Planner | GPT-5.2 | Alternative perspective |
| Synthesizer | Opus 4.6 | Complex merging judgment |
| Validator | Sonnet | Mechanical checking |
| Sharpener | Sonnet + GPT-5.2 | Prompt engineering |
| Executor | GPT-5.3-codex | Code generation |
| E2E Verifier | Sonnet | Test generation |
| Reviewer | Opus 4.6 | Deep code review |
| Researcher | Haiku | Fast, cheap retrieval |
| Brainstormer | Opus 4.6 | Creative exploration |

---

## Project Structure

```
kiln/
├── agents/                  # 11 AI agent definitions
│   ├── kiln-orchestrator    #   Traffic cop
│   ├── kiln-brainstormer    #   Vision exploration
│   ├── kiln-planner         #   Claude-side planning
│   ├── kiln-codex-planner   #   GPT-side planning
│   ├── kiln-synthesizer     #   Plan merging
│   ├── kiln-validator       #   Plan quality gate
│   ├── kiln-sharpener       #   Prompt engineering
│   ├── kiln-executor        #   Code generation
│   ├── kiln-e2e-verifier    #   Runtime testing
│   ├── kiln-reviewer        #   Code review
│   └── kiln-researcher      #   On-demand lookup
│
├── skills/                  # 12 skill definitions
│   ├── kiln-core/           #   Universal contracts
│   ├── kiln-init/           #   Project setup
│   ├── kiln-brainstorm/     #   Brainstorm protocol
│   ├── kiln-plan/           #   Planning format
│   ├── kiln-execute/        #   Execution protocol
│   ├── kiln-e2e/            #   Test patterns
│   ├── kiln-verify/         #   Verification protocol
│   ├── kiln-track/          #   Main work loop
│   ├── kiln-reconcile/      #   Doc reconciliation
│   ├── kiln-roadmap/        #   Phase generation
│   ├── kiln-status/         #   Progress display
│   └── kiln-quick/          #   Single-pass mode
│
├── hooks/                   # Claude Code lifecycle hooks
│   ├── hooks.json           #   Hook registration
│   └── scripts/
│       ├── on-session-start #   State rehydration
│       └── on-task-completed#   Mini-verify gate
│
├── templates/               # Workspace templates
├── bin/install.js           # Interactive installer
└── package.json             # Zero runtime dependencies
```

---

## Install Options

```bash
# Into current project
npx kiln-dev

# Into a specific repo
npx kiln-dev --repo-root /path/to/project

# Non-interactive
npx kiln-dev --yes

# Global install (~/.claude/)
npx kiln-dev --global
```

### Requirements

- **Claude Code** — the CLI this workflow runs inside
- **Node.js 18+** — for the installer
- **Codex CLI** *(optional)* — enables multi-model mode with GPT-5.2/5.3

---

## Inspired By

Kiln fuses ideas from four systems into something new:

| System | Contribution |
|---|---|
| **BMAD Method** | Deep interactive brainstorming with anti-clustering and facilitation personas |
| **Google Conductor** | Just-in-time planning, living documentation, workflow-as-data |
| **GSD Framework** | Fresh context per task, goal-backward verification, plan validation gates |
| **Dual-model patterns** | Multi-model perspective fusion, competing plans, synthesis |

---

## Commands Reference

| Command | What It Does |
|---|---|
| `/kiln:init` | Detect project tooling, create `.kiln/` workspace, configure model mode |
| `/kiln:brainstorm` | Interactive vision exploration with challenge passes |
| `/kiln:roadmap` | Generate delivery phases from approved vision |
| `/kiln:track` | Execute the full loop: plan, validate, execute, E2E, review, reconcile |
| `/kiln:status` | Display current phase, step, and project progress |
| `/kiln:quick` | Single-pass mode for smaller tasks (skip brainstorm/roadmap) |

---

<div align="center">

```
       raw ideas in
            │
            ▼
    ┌───────────────┐
    │               │
    │     kiln      │     brainstorm ── roadmap ── plan
    │               │     execute ── verify ── reconcile
    │               │     repeat until done
    │               │
    └───────┬───────┘
            │
            ▼
     verified code out
```

**MIT License**

</div>
