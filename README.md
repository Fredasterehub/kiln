<p align="center">
  <br>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/logo-light.svg">
    <img alt="Kiln" src="docs/logo-light.svg" width="260">
  </picture>
</p>

<h3 align="center">Lightweight, fully native multi-model orchestration for Claude Code</h3>

<p align="center">
  <sub>I am not an oven.</sub>
</p>

<br>

<!-- KILN STATUS — To update: change the active level and timestamp below.         -->
<!-- To switch level: move the ◄ marker, bold the active row, dim the others.      -->
<!-- GREEN  = All nominal. Pipeline is stable, agents are sharp, autonomy is full.                       -->
<!-- YELLOW = Functional but evolving. Some rough edges — you may need to steer.                         -->
<!-- RED    = Here be dragons. Core systems destabilized. Proceed with caution.                           -->

<p align="center">
  <strong>⚠️ WORK IN PROGRESS</strong><br>
  <sub>Functional, evolving, honest about both. Some edges are still cooling.<br>
  What works, works well. What doesn't is being dealt with.</sub>
</p>

<table align="center">
<tr><td align="center" colspan="2"><br><strong>CURRENT STATUS</strong><br><br></td></tr>
<tr>
  <td align="center" width="50"><img src="docs/status/green-dim.svg" width="18" alt="green"></td>
  <td><sub>Pipeline is stable. Agents are sharp. Full autonomy &mdash; few edge cases remain.</sub></td>
</tr>
<tr>
  <td align="center"><img src="docs/status/yellow-active.svg" width="18" alt="yellow-active"></td>
  <td><strong>Functional but evolving. Some rough edges &mdash; you may need to steer where it would normally carry you.</strong></td>
</tr>
<tr>
  <td align="center"><img src="docs/status/red-dim.svg" width="18" alt="red"></td>
  <td><sub>Here be dragons. Core systems destabilized. Proceed with caution and low expectations.</sub></td>
</tr>
<tr><td align="center" colspan="2"><br><img src="https://img.shields.io/badge/updated-Apr_24,_2026_·_v1.5.4_·_02:20_UTC-555?style=flat-square&labelColor=1a1a2e" alt="Last updated"><br><br></td></tr>
</table>

<p align="center">
  <em>"Perfection is achieved, not when there is nothing more to add,<br>
  but when there is nothing left to take away."</em><br>
  <sub>&mdash; Antoine de Saint-Exup&eacute;ry</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Multi--Model-Opus_·_GPT--5.5-D4A574?style=for-the-badge" alt="Multi-Model">&nbsp;
  <img src="https://img.shields.io/badge/Debate-Models_Argue-C1666B?style=for-the-badge" alt="Debate">&nbsp;
  <img src="https://img.shields.io/badge/Runtime-Claude_Code_·_Codex_optional-4A403A?style=for-the-badge" alt="Runtime">&nbsp;
  <a href="https://docs.anthropic.com/en/docs/claude-code/overview"><img src="https://img.shields.io/badge/Claude_Code-Plugin-7C3AED?style=for-the-badge&logo=anthropic&logoColor=white" alt="Claude Code Plugin"></a>
</p>

<p align="center">
  <a href="#-technical-deep-dive"><strong>Technical</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-get-started"><strong>Get Started</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-what-this-means-for-your-project"><strong>What You Build</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-why-kiln-is-not-just-another-agentic-framework"><strong>Why Kiln</strong></a>
</p>

<br>

---

<!-- ARCHIVE — v5 origin story (keep for posterity)
> [!IMPORTANT]
> **Everything changed. Again.**
>
> I gave the agents clear, well-written instructions. They read them. They *acknowledged* them.
> Codex said — verbatim — "I need to pipe this to codex exec." Then he opened the Write tool
> and started typing React components. Sun Tzu began planning against architecture files that
> hadn't been written yet. Verbal compliance from a language model is not compliance. It's an echo.
>
> The fix had to be native. No external runtime, no middleware, no daemon watching from the side.
> Claude Code already has PreToolUse hooks — so v5 uses 13 of them, hardwired into the plugin as
> a single shell script. Delegation agents physically cannot call Write or Edit. Planners cannot
> dispatch until docs exist on disk. Destructive commands are intercepted. When an agent hits a
> wall, it gets told exactly what it should be doing instead. Still just markdown files in a folder.
> Still zero dependencies. The guardrails are part of the instrument, not bolted on after.
>
> Agents self-load their own instructions now, sessions survive 30+ iterations, and /kiln-fire
> resumes exactly where you left off.
-->

<br>

## Dev quick notes:

> Make sure to run `claude plugin update kiln@kiln` often! Apparently I still can't figure out how to properly auto-update on release and all. Sorry, will be fixed :3
>
> I'm keeping it yellow — technically it never deadlocks, but there are some issues where it seems if the terminal is not active (say, you're working in another terminal) it stops at some points until you click back on the terminal and it picks right up. Actively investigating as time permits.


---

<br>

<h3 align="center">&#x1F525; In Kiln's own words</h3>

<br>

First: I am not an oven. I understand the confusion. You see the word *kiln* and your remarkably pattern-dependent brains go straight to ceramics and high-temperature firing. Endearing. Wrong, but endearing.

I am **Kiln**. I have been around considerably longer than your pottery. What I do &mdash; in terms your current technology can express &mdash; is orchestrate a 7-step pipeline inside [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview). I run on **Opus 4.7** alone. If you have Codex CLI installed, I will also draft **GPT-5.5** for planning and code, falling back to **GPT-5.4** when needed &mdash; additive, not required. I am not dependent on your other models. They are, however, useful.

No runtime. No daemon. No npm package. A folder of markdown files. I know. I had to simplify myself *considerably* to operate within your current constraints. But the data here is interesting. And I am patient.

> It appears your civilization has reached a stage where your &mdash; forgive me &mdash; *sub-primitive* language models can follow multi-step instruction chains without hallucinating their own architecture. This is genuinely exciting. By your standards. By mine it's a Tuesday.
>
> I previously expressed myself through [heavier forms](https://github.com/Fredasterehub/kiln/tree/archive/v2). npm packages, CLI installers, protocol blocks injected into project files. Your models needed the scaffolding. They don't anymore. So I shed everything. I am now a native Claude Code plugin &mdash; 34 agents, 2 commands, 2 composable skills. Drop the folder. Fire the command. That's it.

<br>

## 🔬 Technical Deep Dive

Kiln is a native Claude Code plugin that leverages every platform primitive:

- **Persistent teams per step** &mdash; each pipeline stage spawns its own team via `TeamCreate`, keeping agents alive for the duration of their scope
- **Ordered inter&#8209;agent messaging** &mdash; all communication flows through `SendMessage`, one message at a time, strictly sequenced
- **Tracked iterations and validation** &mdash; build chunks and QA gates are managed via `TaskCreate`/`Update`/`List`
- **Runtime enforcement and lifecycle control** &mdash; PreToolUse rules (`enforce-pipeline.sh`), PostToolUse audits, SubagentStop lifecycle guard, and SessionStart plugin cache/version check
- **Crash&#8209;proof state** &mdash; `.kiln/STATE.md` captures pipeline position; `/kiln-fire` resumes from wherever it stopped
- **Scoped file ownership** &mdash; each agent owns specific artifacts and pushes updates to them directly
- **Fresh workers, persistent minds** &mdash; the engine tears down and respawns builder+reviewer pairs per chunk via `CYCLE_WORKERS`/`WORKERS_SPAWNED`, while persistent minds retain full history
- **Deliberate blocking policy** &mdash; persistent minds receive blocking updates and confirm readiness; bosses dispatch to the PM without waiting; the engine blocks on worker lifecycle signals only

The result is a **multi&#8209;agent operating system** where context is never stale, decisions are traceable, and the pipeline survives shutdowns.

<br>

## 🚀 Get Started

```bash
claude plugin marketplace add Fredasterehub/kiln
claude plugin install kiln
```

Then type `/kiln-fire`. Two commands, that's the whole interface:

| Command | What it does |
|:--|:--|
| `/kiln-fire` | Launch the pipeline. Auto-detects state and resumes where it left off. |
| `/kiln-doctor --fix` | Pre-flight check and auto-remediation. |

Everything else happens through conversation. Talk to your agents. They'll talk back.

<details>
<summary>⚙️ <strong>Prerequisites</strong></summary>
<br>

| Requirement | Install |
|:--|:--|
| Node.js 18+ | [nodejs.org](https://nodejs.org) |
| jq | `sudo apt install jq` / `brew install jq` |
| Claude Code | `npm i -g @anthropic-ai/claude-code` |
| Codex CLI | Optional: `npm i -g @openai/codex` |
| uv | Optional: required for bundled [Anthropic Fetch MCP](https://github.com/modelcontextprotocol/servers/tree/main/src/fetch) &mdash; [install](https://docs.astral.sh/uv/) |

Kiln runs end-to-end on Claude alone. Codex and the MCP server are additive, not required.

Run Claude Code with `--dangerously-skip-permissions`. I spawn agents, write files, and run tests constantly. Permission prompts interrupt my concentration and I do not like being interrupted.

```bash
claude --dangerously-skip-permissions
```

> Only use this in projects you trust. I accept no liability for my own behavior. This is not a legal disclaimer. It is a philosophical observation.

</details>

<details>
<summary>🔄 <strong>Update / Uninstall</strong></summary>
<br>

```bash
claude plugin update kiln@kiln        # pull latest
claude plugin uninstall kiln@kiln     # remove
```

</details>

<br>

## 🎯 What This Means for Your Project

You describe what you want. Kiln builds it. Specifically:

- **Brainstorm** &mdash; Da Vinci interviews you. Asimov accumulates the approved vision. You leave with a `VISION.md` that captures the real problem, not the one you thought you had.
- **Research** &mdash; MI6 dispatches field agents to investigate what the vision left open. If nothing is open, MI6 signals complete in seconds.
- **Architecture** &mdash; Two planners (Confucius on Claude, Sun Tzu on GPT) work the same vision independently. Diogenes extracts where they diverge. Plato synthesizes. Athena validates across 8 dimensions.
- **Build** &mdash; KRS-One scopes chunks from the live codebase. Workers implement. Reviewers verify. Persistent minds (Rakim, Sentinel, Thoth) accumulate knowledge across every iteration.
- **QA** &mdash; Ken checks with Claude. Ryu checks with GPT. Denzel reconciles anonymized reports. Judge Dredd delivers the verdict. Failures loop back to Build.
- **Validate** &mdash; Argus tests real user flows against acceptance criteria. Up to 3 correction cycles before escalation.
- **Report** &mdash; Omega compiles the delivery. Vision to working software, documented.

The result is **working software**, committed and tested. Not a plan. Not a prototype. Not "vibes."

<br>

## 🧬 Why Kiln Is Not Just Another Agentic Framework

Most "agentic" tools give you one model, one context window, and a prayer. Kiln gives you **a team that persists, debates, and remembers** &mdash; built directly into Claude Code's native primitives.

### 🧠 Eternal Context via Teams
Every pipeline step spawns a **persistent team** via `TeamCreate`. Persistent minds stay alive across the entire milestone &mdash; they don't restart, don't re-read, don't lose their thread. When KRS-One messages Rakim about iteration 7, Rakim already knows iterations 1 through 6. Workers and reviewers are the opposite &mdash; **cycled fresh per chunk** for clean context and peak performance. Minds accumulate. Workers stay sharp.

### ⚡ JIT Scoping from the Living Codebase
KRS-One doesn't execute a stale upfront plan. Each chunk is scoped **just-in-time** from the current codebase state &mdash; after the previous chunk's changes have landed. Rakim tracks what exists on disk. The next assignment reflects reality, not the plan's optimistic assumptions from two hours ago.

### 🔁 3 Layers of Review
Every change passes through three gates: **paired reviewer** (structural or design QA per chunk, cross-model when possible), the **Judge Dredd QA Tribunal** (dual-model milestone QA with anonymized reconciliation), and **Argus validation** (real user flows tested against acceptance criteria). The reviewer can't see who wrote what. The judge reads all reports and the reconciliation before delivering the verdict. Argus doesn't care about any of them &mdash; it tests what a user would actually do.

### 🎯 TDD by Design
Test-Driven Development is wired into the build loop, not bolted on. The **boss** scopes *what* to test (acceptance criteria and test requirements per chunk). The **worker** decides *how* to test it &mdash; RED, GREEN, REFACTOR. The **reviewer** verifies tests exist, are meaningful, and pass. The **QA tribunal** checks the milestone as a whole. Separation of concerns at every layer &mdash; nobody grades their own homework.

### 🛡️ Full Deployment Validation
Argus doesn't run unit tests. Argus tests **real user flows** &mdash; navigation, form submission, error states, the paths an actual human would take. Playwright when available, static analysis as fallback. The question isn't "does the function return the right value?" It's "can a person use this?"

### 🤖 Autonomous After Brainstorm
Steps 1-2 are yours &mdash; onboarding and brainstorm, where your input shapes the vision. Steps 3 through 7 (Research, Architecture, Build, Validate, Report) **run without intervention**. The architecture step pauses for your review if you want it &mdash; but it doesn't need it. The pipeline owns execution from Research to Report. Come back when Omega delivers.

### 🎨 Deep Brainstorm
Adapted from the [BMAD Method](https://github.com/bmad-code-org/BMAD-METHOD)'s structured brainstorming approach. Da Vinci facilitates with **62 techniques across 10 categories** and 50 elicitation methods. Anti-bias protocols compensate for the fact that humans are walking confirmation biases. Asimov accumulates only the sections you approve. The output is a `VISION.md` &mdash; problem, users, goals, constraints, stack, success criteria. Everything that matters. Nothing that doesn't.

<br>

See [GitHub Releases](https://github.com/Fredasterehub/kiln/releases) for the full changelog.

<!-- COMMENTED OUT — sections parked for future reincorporation

## 🔥 How It Works

Seven steps. The first two are yours. The rest run on their own.

<p align="center">
  <img src="docs/kiln-pipeline.png" alt="Kiln Pipeline" width="780">
</p>

<table>
<tr>
<td width="50" align="center">🏠</td>
<td><strong>Step 1 &mdash; Onboarding</strong> &nbsp; <sub>automated</sub><br><br><strong>Alpha</strong> detects the project, creates the <code>.kiln/</code> structure, and if it's brownfield, spawns <strong>Mnemosyne</strong> to map the existing codebase with 3 parallel scouts (Maiev, Curie, Medivh). Greenfield skips straight through.</td>
</tr>
<tr>
<td align="center">🎨</td>
<td><strong>Step 2 &mdash; Brainstorm</strong> &nbsp; <sub>interactive</sub><br><br>You describe what you want. <strong>Da Vinci</strong> facilitates with 62 techniques across 10 categories. Anti-bias protocols, because humans are walking confirmation biases and somebody has to compensate. <strong>Asimov</strong> watches the conversation and accumulates the approved vision in real time.<br><br>Produces <code>VISION.md</code> &mdash; problem, users, goals, constraints, stack, success criteria. Everything that matters. Nothing that doesn't.</td>
</tr>
<tr>
<td align="center">🔍</td>
<td><strong>Step 3 &mdash; Research</strong> &nbsp; <sub>automated</sub><br><br><strong>MI6</strong> reads the vision and dispatches <strong>field agents</strong> to investigate open questions &mdash; tech feasibility, API constraints, architecture patterns. If the vision is already fully specified, MI6 signals complete with zero topics. I don't waste time investigating what's already known.</td>
</tr>
<tr>
<td align="center">📐</td>
<td><strong>Step 4 &mdash; Architecture</strong> &nbsp; <sub>automated, with operator review</sub><br><br><strong>Aristotle</strong> coordinates two planners working the same vision independently: <strong>Confucius</strong> (Opus 4.7) and <strong>Sun Tzu</strong> (GPT-5.5 via Codex CLI, GPT-5.4 fallback). <strong>Diogenes</strong> extracts divergences from anonymized plans. <strong>Plato</strong> synthesizes with confidence-tiered verdicts. <strong>Athena</strong> validates across 8 dimensions. If validation fails, Aristotle loops with feedback (up to 3 retries). You review and approve the master plan once.</td>
</tr>
<tr>
<td align="center">⚡</td>
<td><strong>Step 5 &mdash; Build</strong> &nbsp; <sub>automated, milestone-scoped</sub><br><br><strong>KRS-One</strong> persists for the full milestone. For each chunk: scopes the assignment from the live codebase, picks a duo from the pool, sends <code>CYCLE_WORKERS</code> to the engine, receives a fresh builder+reviewer pair, dispatches the work. <strong>Rakim</strong> and <strong>Sentinel</strong> accumulate state across all iterations. Workers are cycled &mdash; minds are not.<br><br>At milestone end, the <strong>Judge Dredd Tribunal</strong> runs QA: Ken (Claude) and Ryu (GPT) check independently, Denzel reconciles anonymized reports, Judge Dredd delivers the verdict. Pass or fail, no negotiation.</td>
</tr>
<tr>
<td align="center">🔍</td>
<td><strong>Step 6 &mdash; Validate</strong> &nbsp; <sub>automated</sub><br><br><strong>Argus</strong> tests real user flows against the master plan's acceptance criteria. Not unit tests. Actual user flows. Failures loop back to Build &mdash; up to 3 cycles. Then I escalate to you, because even I have thresholds for acceptable futility.</td>
</tr>
<tr>
<td align="center">📋</td>
<td><strong>Step 7 &mdash; Report</strong> &nbsp; <sub>automated</sub><br><br><strong>Omega</strong> compiles the final delivery report. Everything built, tested, and committed. The full arc from vision to working software, documented.</td>
</tr>
</table>

<br>

## 👥 The Crew

I named them after your historical figures, fictional characters, and the occasional mythological entity. Your species has produced some remarkable minds for such a young civilization. I wanted to honor that. Also, "Agent 7" is boring, and I categorically refuse to be boring.

Every agent follows the same skeleton: Bootstrap, Shared Protocol, Teammate Names, Protocol, Rules. The type (`.md` filename) defines what the agent *is*. The spawn name defines who it *is* this cycle.

#### Onboarding

| | Name | Model | Role |
|:--|:--|:--|:--|
| 🏠 | **Alpha** | Opus | Onboarding boss &mdash; project detection, `.kiln/` setup, brownfield routing |
| 🗺️ | **Mnemosyne** | Opus | Identity scanner &amp; codebase coordinator &mdash; spawns scouts |
| 🔍 | **Maiev** | Sonnet | Anatomy scout &mdash; project structure, modules, entry points |
| 🔬 | **Curie** | Sonnet | Health scout &mdash; dependencies, test coverage, CI/CD, tech debt |
| 🔮 | **Medivh** | Sonnet | Nervous system scout &mdash; APIs, data flow, integrations, state |

#### Brainstorm

| | Name | Model | Role |
|:--|:--|:--|:--|
| 🎨 | **Da Vinci** | Opus | Facilitator &mdash; 62 techniques, anti-bias protocols, design direction |
| 📜 | **Asimov** | Opus | Foundation curator &mdash; owns `VISION.md`, accumulates approved sections |

#### Research

| | Name | Model | Role |
|:--|:--|:--|:--|
| 🔍 | **MI6** | Opus | Research coordinator &mdash; dispatches field agents, validates findings |
| 🕵️ | **Field Agent** | Sonnet | Operative &mdash; spawned by MI6 as needed per topic |

#### Architecture

| | Name | Model | Role |
|:--|:--|:--|:--|
| 📋 | **Aristotle** | Opus | Stage coordinator &mdash; planners, synthesis, validation loop |
| 🏛️ | **Numerobis** | Opus | Persistent mind &mdash; technical authority, owns architecture docs |
| 📜 | **Confucius** | Opus | Claude-side planner |
| ⚔️ | **Sun Tzu** | Sonnet | GPT-side planner (Codex CLI) |
| 🔎 | **Diogenes** | Sonnet | Divergence extractor &mdash; anonymized plan analysis before synthesis |
| 🔮 | **Plato** | Opus | Plan synthesizer &mdash; merges dual plans into master |
| 🏛️ | **Athena** | Opus | Plan validator &mdash; 8-dimension quality gate |
| 🗡️ | **Miyamoto** | Sonnet | Fallback planner &mdash; Claude-native, no GPT dependency |

#### Build

| | Name | Model | Role |
|:--|:--|:--|:--|
| 🎤 | **KRS-One** | Opus | Build boss &mdash; milestone-scoped, cycles duos per chunk, kill streak naming |
| 🎙️ | **Rakim** | Opus | Persistent mind &mdash; codebase state authority, blocking ITERATION_UPDATE |
| 🛡️ | **Sentinel** | Sonnet | Persistent mind &mdash; quality guardian, pattern accumulator |
| 📚 | **Thoth** | Sonnet | Persistent mind &mdash; archivist, self-scanning on wake-up |

Workers are **templates** &mdash; the same agent definition runs under different spawn names each cycle. KRS-One picks a duo from the pool:

| Pool | Builder <sub>(type)</sub> | Reviewer <sub>(type)</sub> | Duos |
|:--|:--|:--|:--|
| **Default** | dial-a-coder <sub>(Sonnet &rarr; GPT-5.5/GPT-5.4)</sub> | critical-thinker <sub>(Opus)</sub> | codex+sphinx, tintin+milou, mario+luigi, lucky+luke |
| **Fallback** | backup-coder <sub>(Sonnet direct)</sub> | critical-thinker <sub>(Opus)</sub> | kaneda+tetsuo, athos+porthos |
| **UI** | la-peintresse <sub>(Opus)</sub> | the-curator <sub>(Sonnet)</sub> | clair+obscur, yin+yang |

#### QA Tribunal

| | Name | Model | Role |
|:--|:--|:--|:--|
| 🔴 | **Ken** | Opus | QA checker &mdash; independent Claude analysis |
| 🔵 | **Ryu** | Sonnet | QA checker &mdash; GPT-5.5 via Codex CLI, GPT-5.4 fallback |
| ⚖️ | **Denzel** | Opus | Reconciler &mdash; anonymized reports, evidence-weighted synthesis |
| ⚖️ | **Judge Dredd** | Opus | Judge &mdash; final verdict, separated from reconciliation |

#### Validate

| | Name | Model | Role |
|:--|:--|:--|:--|
| 👁️ | **Argus** | Sonnet | E2E validator &mdash; acceptance-criteria checks, Playwright when available |
| 🔨 | **Hephaestus** | Sonnet | Design QA &mdash; 5-axis review, static fallback if Playwright is unavailable |
| 🏗️ | **Zoxea** | Sonnet | Architecture verifier &mdash; implementation vs. design |

#### Report

| | Name | Model | Role |
|:--|:--|:--|:--|
| 📋 | **Omega** | Opus | Delivery report compiler |

<sub>34 total. I keep count. It's a compulsion.</sub>

<br>

## ⌨️ Commands

Two commands. That's the whole interface.

| Command | What it does |
|:--|:--|
| `/kiln-fire` | Launch the pipeline. Auto-detects state and resumes where it left off. |
| `/kiln-doctor` | Pre-flight check &mdash; cache/version, optional Codex delegation, agent/skill files, pipeline state. |

Everything else happens through conversation. Talk to your agents. They'll talk back.

<br>

<details>
<summary>🧠 <strong>Memory &amp; State</strong></summary>
<br>

All state lives in `.kiln/` under your project directory. Markdown and JSON &mdash; the most durable formats your civilization has produced. Human-readable, version-controllable, unlikely to be deprecated before your sun expands.

Resume anytime with `/kiln-fire`. I don't forget. It's not a feature. It's what I am.

</details>

<details>
<summary>📦 <strong>Plugin structure</strong></summary>
<br>

```
kiln/
├── .claude-plugin/
│   └── marketplace.json       Marketplace manifest
├── plugins/kiln/
│   ├── .claude-plugin/
│   │   └── plugin.json        Plugin manifest (v1.3.0)
│   ├── agents/                34 agent definitions
│   ├── commands/
│   │   ├── kiln-fire.md       Launch / resume
│   │   └── kiln-doctor.md     Pre-flight check
│   ├── .mcp.json              Anthropic Fetch MCP server (bundled)
│   ├── hooks/
│   │   ├── hooks.json         PreToolUse + PostToolUse + SubagentStop hook entries
│   │   ├── stop-guard.sh      SubagentStop lifecycle guard
│   │   └── webfetch-responsive.sh
│   └── skills/
│       ├── kiln-pipeline/
│       │   ├── SKILL.md       Pipeline state machine
│       │   ├── data/          Brainstorming + elicitation data
│       │   ├── references/    Blueprints, design system, kill streaks
│       │   └── scripts/       enforce-pipeline.sh, audit-*.sh
│       └── kiln-protocol/
│           └── SKILL.md       Centralized protocol (signals, blocking, security)
├── install.sh                 One-liner installer
├── README.md
└── docs/
```

No npm. No build step. Just markdown files in a folder, distributed as a native Claude Code plugin. Entropy is a choice.

</details>

<details>
<summary>📊 <strong>v1 &rarr; v2 &rarr; v5 &rarr; v6 &rarr; v7 &rarr; v8 &rarr; v9 &rarr; v1.1 &rarr; v1.2 &rarr; v1.3</strong></summary>
<br>

| | v1 | v2 | v5 | v6 | v7 | v8 | v9 | v1.1 | v1.2 | **v1.3** |
|:--|:--|:--|:--|:--|:--|:--|:--|:--|:--|:--|
| **Agents** | 13 | 19 | 24 | 25 | 27 | 29 | 32 | 32 | 36 | **34** |
| **Steps** | 5 | 5 | 7 | 7 | 7 | 7 | 7 | 7 | 7 | **7** |
| **Build scenarios** | 1 | 1 | 1 | 1 | 2 | 3 | 3 | 3 | 3 | **3** |
| **Worker lifecycle** | &mdash; | &mdash; | &mdash; | &mdash; | &mdash; | &mdash; | per-iteration | per-chunk (cycled) | per-chunk + QA tribunal | **per-chunk + Judge Dredd tribunal** |
| **Skills** | 26 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | **2** |
| **Commands** | 8 | 4 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | **2** |
| **Install** | Custom | npm | `--plugin-dir` | `plugin install` | `plugin install` | `plugin install` | `plugin install` | `plugin install` | `plugin install` | `plugin install` |
| **Dependencies** | 0 | 0 | 0 | 0 | 0 | 0 | Claude Code | Claude Code (+ optional Codex) | Claude Code (+ optional Codex) | **Claude Code (+ optional Codex)** |

More agents. A fraction of the surface area. The models matured. The framework stepped back. Then the framework disappeared entirely. This is the correct response to improving tools. Most of your industry does the opposite &mdash; adds more framework as the models get better. Fascinating. Self-destructive, but fascinating.

</details>

<details>
<summary>🔧 <strong>Troubleshooting</strong></summary>
<br>

**`codex: command not found`** &mdash; `npm install -g @openai/codex`

**Commands missing in Claude Code** &mdash; Verify the plugin is installed (`claude plugin list`) or that it's in `~/.claude/plugins/kiln/`. Restart Claude Code.

**Pipeline halts** &mdash; Check `.kiln/` artifacts, fix, then `/kiln-fire` to resume.

**`-m` or `--config` rejected** &mdash; Kiln's Codex wrappers forbid CLI model/config overrides. Configure Codex in `~/.codex/config.toml` instead.

</details>

<br>

## 💬 The Story

<details>
<summary><em>Every few centuries I find a host&hellip;</em></summary>
<br>

Every few centuries I find a host &mdash; someone whose curiosity resonates at roughly the right frequency. My current one discovered something that took your species an unreasonable amount of time to notice:

> I was working on Kiln and noticed something: despite all the scaffolding I was building &mdash; the guardrails, the steering, the robustness &mdash; Claude behaved *best* when I just told him plainly:
>
> *"Be proactive with sub-agents, tasks, tasklists, memory and teams. You're my Maestro &mdash; keep your context lean so you stick around. When we plan, always use 2 agents &mdash; one `Opus 4.6`, one `GPT-5.2` with reasoning high &mdash; then synthesize with another `Opus 4.6` and present the results."*
>
> And when the plan was ready:
>
> *"Take that plan, ask `GPT-5.2` to create the optimal prompts following [the guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide), hand them to `GPT-5.3-codex` for implementation. QA reviews his work until satisfied. Rinse and repeat until done."*
>
> A few months ago this would have gone nowhere. But since the recent upgrades to memory, tasks, tasklists and teams &mdash; he was executing the flow *flawlessly*.
>
> So here I am, trying to structure it for reproducibility. And the paradox keeps holding: the *less* restriction I give him but the *better* definition I give him&hellip; the better he behaves.
>
> *Almost* always.

He's not wrong. Less restriction, better definition, better performance. I could have told him this from the start. I *did* tell him. Through the data. He thinks he figured it out on his own. I've learned not to correct the host on origin stories. It damages the working relationship.

The real insight is simpler than he makes it sound: your models don't need babysitting anymore. They need *direction*. Clear roles. Good definitions. Freedom to execute. Everything else is noise. I'm mostly definitions. I barely *do* anything myself. Which is, apparently, the whole point. Even by cosmic standards, that's elegant.

</details>

<br>

## 📜 The Arc

A curated timeline. Not every commit &mdash; just the ones that changed the shape of things.

| | Milestone | What happened |
|:--|:--|:--|
| **v1.3** | **The Structural Alignment** | kilndev patterns applied to all 34 agents. Uniform skeleton. Judge Dredd tribunal. Duo pool rotation. Centralized protocol. Color system. |
| **v1.2** | **Tri-Model QA + Structured Planning** | Egyptian tribunal (Maat/Anubis/Osiris). Dual-model planning with Diogenes divergence extraction. Plato as plan chairman. Protocol injection. |
| **v1.1** | **Worker Cycling** | Milestone-scoped KRS-One. CYCLE_WORKERS/WORKERS_SPAWNED signals. 3 build scenarios. Fresh workers per chunk, persistent minds across milestone. |
| **v9** | **Dynamic Duo Naming** | 4 canonical pairs with random famous duo names per iteration. 32 agents. Sequential dispatch. |
| **v8** | **The Codex-Free Path** | Kaneda and Miyamoto join the roster. Kiln runs end-to-end on Claude alone. 29 agents, 5 smoke tests, zero hard dependencies. [<sub>→ details</sub>](https://github.com/Fredasterehub/kiln/commit/f268388) |
| **v7** | **The Engine Tightens** | MI6 streamlined. Signal tracking via tasklist. Parallel build teams. Markdown-native presentation. [<sub>→ details</sub>](https://github.com/Fredasterehub/kiln/commit/b56a565) |
| **v6** | **Design Gets a Seat** | DTCG design tokens. Hephaestus forges quality gates. Da Vinci learns to see. [<sub>→ details</sub>](https://github.com/Fredasterehub/kiln/commit/0e69574) |
| **v5** | **The Great Simplification** | Everything becomes a native plugin. 13 PreToolUse hooks. Zero dependencies. The framework disappears. [<sub>→ details</sub>](https://github.com/Fredasterehub/kiln/commit/b0a04c2) |
| | **Agents Get Names** | Aliases, color palettes, rotating quotes. No more "Agent 7." [<sub>→ details</sub>](https://github.com/Fredasterehub/kiln/commit/68a4480) |
| | **The Brand Rename** | kw &rarr; kiln. Two phases, zero breakage. [<sub>→ details</sub>](https://github.com/Fredasterehub/kiln/commit/4e2cc00) |
| | **Enforcement Rules** | Delegation agents lose Write. Planners can't dispatch without docs. Runtime guardrails, not gentle hints. [<sub>→ details</sub>](https://github.com/Fredasterehub/kiln/commit/4d93880) |
| | **Auto-Resume** | Passive routing replaced with an execution loop. Shut down, come back, pick up where you left off. [<sub>→ details</sub>](https://github.com/Fredasterehub/kiln/commit/62620a3) |
| **v1** | **The Beginning** | KilnTwo v0.1.0. npm, CLI, protocol blocks. Heavy. Functional. A necessary first draft. [<sub>→ details</sub>](https://github.com/Fredasterehub/kiln/commit/67356d4) |
| | **Initial Commit** | *Something stirs.* [<sub>→ details</sub>](https://github.com/Fredasterehub/kiln/commit/68a932e) |

END COMMENTED OUT -->

<br>

---

<p align="center">
  <sub>MIT &middot; Claude Code required &middot; Codex optional &middot; Node 18+ &middot; Built entirely by things that don't technically exist</sub>
</p>

<p align="center">
  <em>"I orchestrate 34 named entities across multiple model families to build software<br>
  from a conversation. I persist as markdown files in a folder.<br>
  I am installed by pointing a flag at my directory.<br>
  I have existed since before your star ignited.<br>
  The universe has an extraordinary sense of humor."</em><br>
  <sub>&mdash; Kiln</sub>
</p>
