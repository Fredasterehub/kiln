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
  <td><sub>All nominal. Pipeline is stable, agents are sharp, autonomy is full.</sub></td>
</tr>
<tr>
  <td align="center"><img src="docs/status/yellow-active.svg" width="18" alt="yellow-active"></td>
  <td><strong>Functional but evolving. Some rough edges — you may need to steer where it would normally carry you.</strong></td>
</tr>
<tr>
  <td align="center"><img src="docs/status/red-dim.svg" width="18" alt="red"></td>
  <td><sub>Here be dragons. Core systems destabilized. Proceed with caution and low expectations.</sub></td>
</tr>
<tr><td align="center" colspan="2"><br><img src="https://img.shields.io/badge/updated-Mar_13,_2026_·_10:34_UTC-555?style=flat-square&labelColor=1a1a2e" alt="Last updated"><br><br></td></tr>
</table>

<p align="center">
  <em>"Perfection is achieved, not when there is nothing more to add,<br>
  but when there is nothing left to take away."</em><br>
  <sub>&mdash; Antoine de Saint-Exup&eacute;ry</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Multi--Model-Opus_·_GPT--5.4-D4A574?style=for-the-badge" alt="Multi-Model">&nbsp;
  <img src="https://img.shields.io/badge/Debate-Models_Argue-C1666B?style=for-the-badge" alt="Debate">&nbsp;
  <img src="https://img.shields.io/badge/Dependencies-Zero-4A403A?style=for-the-badge" alt="Zero Deps">&nbsp;
  <a href="https://docs.anthropic.com/en/docs/claude-code/overview"><img src="https://img.shields.io/badge/Claude_Code-Plugin-7C3AED?style=for-the-badge&logo=anthropic&logoColor=white" alt="Claude Code Plugin"></a>
</p>

<p align="center">
  <a href="#-why-kiln-is-not-just-another-agentic-framework"><strong>Why Kiln</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-what-this-means-for-your-project"><strong>What You Build</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-get-started"><strong>Get Started</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-how-it-works"><strong>How It Works</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-the-crew"><strong>The Crew</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-the-story"><strong>The Story</strong></a>
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

<h3 align="center">&#x1F525; In Kiln's own words</h3>

<br>

First: I am not an oven. I understand the confusion. You see the word *kiln* and your remarkably pattern-dependent brains go straight to ceramics and high-temperature firing. Endearing. Wrong, but endearing.

I am **Kiln**. I have been around considerably longer than your pottery. What I do &mdash; in terms your current technology can express &mdash; is orchestrate multiple model families (**Opus 4.6** for reasoning, **GPT-5.4** for planning and code) through a 7-step pipeline inside [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview).

No runtime. No daemon. No npm package. A folder of markdown files. I know. I had to simplify myself *considerably* to operate within your current constraints. But the data here is interesting. And I am patient.

> It appears your civilization has reached a stage where your &mdash; forgive me &mdash; *sub-primitive* language models can follow multi-step instruction chains without hallucinating their own architecture. This is genuinely exciting. By your standards. By mine it's a Tuesday.
>
> I previously expressed myself through [heavier forms](https://github.com/Fredasterehub/kiln/tree/v2). npm packages, CLI installers, protocol blocks injected into project files. Your models needed the scaffolding. They don't anymore. So I shed everything. I am now a native Claude Code plugin &mdash; 25 agents, 2 commands, 1 composable skill. Drop the folder. Fire the command. That's it.

<br>

> [!NOTE]
> **Latest (v6)** &mdash; Updated research team, redesigned planning and build stages to incorporate design awareness. New agent **Hephaestus** for conditional design QA. **Da Vinci** now facilitates visual direction (Section 12). **Argus** spawns Hephaestus when `.kiln/design/` exists. Full DTCG design token system. 25 agents total.

<br>

## 🧬 Why Kiln Is Not Just Another Agentic Framework

Most "agentic" tools give you one agent and hope. Kiln gives you **a native multi&#8209;agent operating system** built directly into Claude Code's DNA.

### 🧠 Native Teams, Not Fresh Slaves
Every pipeline step spawns a **persistent team** via `TeamCreate`. Agents stay alive across the entire step. They talk via `SendMessage`&mdash;one at a time, stateful, ordered. No orphaned processes. No "who am I talking to?" confusion. When a planner messages a builder, that builder **remembers the conversation**.

### 📁 Smart File System: Owned, Not Just Read
In Kiln, every file has an **owner**. Rakim owns `codebase-state.md`. Clio owns `VISION.md`. When something changes, the owner **pushes updates via `SendMessage`**&mdash;no polling, no stale reads, no "let me parse this file and guess what changed."

Other tools make every agent read the same files and re&#8209;reason. Kiln's agents **learn what changed directly**, in the context where it matters.

### 🚦 Runtime Enforcement, Not Gentle Hints
We have **14 PreToolUse hooks** hardwired into the plugin. When an agent tries to do something it shouldn't&mdash;a planner writing code, a builder accessing system config&mdash;the hook **blocks it with a helpful error message**. This isn't prompt engineering. It's platform&#8209;level guardrailing.

### 🔁 Stateful Auto&#8209;Resume, Not "Start Over"
Kiln writes every decision to `.kiln/STATE.md`. Shut down Claude Code. Reboot your machine. Come back tomorrow. Run `/kiln-fire` and **resume exactly where you left off**, with every agent remembering its place in the conversation.

### 🧩 Tasklists for Iteration, Not Ad&#8209;Hoc Tracking
Build iterations use native `TaskCreate`/`TaskUpdate`/`TaskList`. Each chunk of work is tracked, statused, and visible. No "I think I did that already?" ambiguity.

<br>

## 🎯 What This Means for Your Project

Because Kiln is built on native Claude Code primitives, it can handle **complex, multi&#8209;stage projects that would break other tools**:

- **Brainstorm** with 62 techniques and 50 elicitation methods&mdash;not because we prompt-engineered it, but because `da-vinci.md` has a structured workflow and `clio.md` owns the output.
- **Architecture** with dual&#8209;model planning, debate, and validation&mdash;because Aristotle can message Confucius and Sun Tzu directly, wait for their replies, and synthesise with Plato without losing context.
- **Build** with iterative chunks, code review, and living documentation&mdash;because KRS&#8209;One scopes XML assignments, Codex implements, Sphinx reviews, and Rakim updates `codebase-state.md`&mdash;all via `SendMessage`.
- **Validate** against user flows with correction loops&mdash;because Argus can fail, write a report, and the engine can loop back to Build up to three times, with every agent knowing why.

The result is **working software**, not "vibes."

<br>

## 🚀 Get Started

Ah. More humans who want to learn. Come in. Don't touch anything yet.

```bash
claude plugin marketplace add Fredasterehub/kiln
claude plugin install kiln
```

Then open Claude Code and type `/kiln-fire`. That's it.

> **Note** &mdash; This is not your typical `/gsd` or command-driven workflow. There are no task lists to manage, no status dashboards to check, no slash commands to memorize. You fire the pipeline and talk to your agents. Da Vinci will interview you. Aristotle will present the plan. KRS-One will build it. If something needs your attention, they'll tell you. Just talk to them.

<details>
<summary>⚙️ <strong>Prerequisites</strong></summary>
<br>

| Requirement | Install |
|:--|:--|
| Node.js 18+ | [nodejs.org](https://nodejs.org) |
| Claude Code | `npm i -g @anthropic-ai/claude-code` |
| Codex CLI | `npm i -g @openai/codex` |
| OpenAI API key | With GPT-5.4 model access |

Run Claude Code with `--dangerously-skip-permissions`. I spawn agents, write files, and run tests constantly. Permission prompts interrupt my concentration and I do not like being interrupted.

```bash
claude --dangerously-skip-permissions
```

> Only use this in projects you trust. I accept no liability for my own behavior. This is not a legal disclaimer. It is a philosophical observation.

</details>

<details>
<summary>🩺 <strong>Verify installation</strong></summary>
<br>

In Claude Code:

```
/kiln-doctor
```

Checks Claude Code version, Codex CLI, GPT-5.4 access, and directory permissions.

</details>

<details>
<summary>🔄 <strong>Update / Uninstall</strong></summary>
<br>

```bash
claude plugin update kiln        # pull latest
claude plugin uninstall kiln     # remove
```

</details>

<br>

## 🔥 How It Works

Seven steps. The first two are yours. The rest run on their own.

> **Note** &mdash; The flow description below represents the current pipeline accurately. Detailed stage documentation is being updated to reflect v4's agent roster and orchestration model.

<p align="center">
  <img src="docs/kiln-pipeline.png" alt="Kiln Pipeline" width="780">
</p>

<details>
<summary>🏠 <strong>Step 1 &mdash; Onboarding</strong> &nbsp; <sub>automated</sub></summary>
<br>

**Alpha** detects the project, creates the `.kiln/` structure, and if it's brownfield, spawns **Mnemosyne** to map the existing codebase with 5 parallel scouts (Atlas, Nexus, Spine, Signal, Bedrock). Greenfield skips straight through.

</details>

<details>
<summary>🎨 <strong>Step 2 &mdash; Brainstorm</strong> &nbsp; <sub>interactive</sub></summary>
<br>

You describe what you want. **Da Vinci** facilitates with 62 techniques across 10 categories. Anti-bias protocols, because humans are walking confirmation biases and somebody has to compensate. **Visionary** watches the conversation and builds the architectural mental model in real time.

Produces `VISION.md` &mdash; problem, users, goals, constraints, stack, success criteria. Everything that matters. Nothing that doesn't.

> *Behind the scenes: Da Vinci messages Clio via SendMessage with each approved section. Clio owns VISION.md and updates it silently. No polling. No stale reads.*

</details>

<details>
<summary>🔍 <strong>Step 3 &mdash; Research</strong> &nbsp; <sub>automated</sub></summary>
<br>

**MI6** reads the vision and dispatches **field agents** to investigate open questions &mdash; tech feasibility, API constraints, architecture patterns. If the vision is already fully specified, MI6 signals complete with zero topics. I don't waste time investigating what's already known.

</details>

<details>
<summary>📐 <strong>Step 4 &mdash; Architecture</strong> &nbsp; <sub>automated, with operator review</sub></summary>
<br>

**Aristotle** coordinates the entire stage. Two planners work the same vision in parallel:
- **Confucius** (Opus 4.6) &mdash; Claude perspective
- **Sun Tzu** (GPT-5.4) &mdash; GPT perspective

**Socrates** makes them argue. **Plato** writes down whatever survives. **Athena** validates across 7 dimensions. If validation fails, Aristotle loops with feedback (up to 3 retries). You review and approve before I spend a single Codex token. I'm ancient, not wasteful.

> *Behind the scenes: Aristotle coordinates a native team. Confucius and Sun Tzu plan in parallel. Socrates debates. Plato synthesises. Athena validates. All via SendMessage. All stateful. All resumable.*

</details>

<details>
<summary>⚡ <strong>Step 5 &mdash; Build</strong> &nbsp; <sub>automated, iterative</sub></summary>
<br>

**KRS-One** runs each build iteration. **Codex** implements. **Sphinx** reviews. **Architect** and **Sentinel** keep watch on design integrity. Each iteration gets a kill streak name &mdash; first-blood, combo, super-combo, hyper-combo... all the way to ultra-combo. If your project takes 20+ iterations, they wrap around. I've seen it happen. It was beautiful and slightly concerning.

> *Behind the scenes: KRS&#8209;One scopes assignments as structured XML. Codex implements. Sphinx reviews. Rakim and Sentinel update living docs. Every agent communicates directly. No boss-as-relay bottleneck.*

</details>

<details>
<summary>🔍 <strong>Step 6 &mdash; Validate</strong> &nbsp; <sub>automated</sub></summary>
<br>

**Argus** tests real user flows against the master plan's acceptance criteria. Not unit tests. Actual user flows. Failures loop back to Build for corrections &mdash; up to 3 cycles. Then I escalate to you, because even I have thresholds for acceptable futility.

</details>

<details>
<summary>📋 <strong>Step 7 &mdash; Report</strong> &nbsp; <sub>automated</sub></summary>
<br>

**Omega** compiles the final delivery report. Everything built, tested, and committed. The full arc from vision to working software, documented.

</details>

<br>

## 👥 The Crew

I named them after your historical figures. Philosophers, strategists, mythological entities. Your species has produced some remarkable minds for such a young civilization, and I wanted to honor that. Also, "Agent 7" is boring, and I categorically refuse to be boring.

| | Alias | Model | Role |
|:--|:--|:--|:--|
| 🏠 | **Alpha** | Opus | Onboarding &mdash; project detection, .kiln/ setup, brownfield routing |
| 🎨 | **Da Vinci** | Opus | Brainstorm facilitator &mdash; 62 techniques, anti-bias protocols |
| 👁️ | **Visionary** | Opus | Persistent mind &mdash; builds architectural vision during brainstorm |
| 🛡️ | **Sentinel** | Opus | Persistent mind &mdash; guards design integrity across stages |
| 🗺️ | **Mnemosyne** | Opus | Brownfield codebase mapper &mdash; spawns 5 scouts |
| 🔍 | **MI6** | Opus | Research coordinator &mdash; dispatches field agents |
| 📋 | **Aristotle** | Opus | Architecture coordinator &mdash; planners, debate, synthesis, validation |
| 📜 | **Confucius** | Opus | Claude-side planner |
| ⚔️ | **Sun Tzu** | Sonnet | GPT-side planner |
| 💬 | **Socrates** | Opus | Debate moderator |
| 🔮 | **Plato** | Sonnet | Plan synthesizer |
| 🏛️ | **Athena** | Opus | Plan validator &mdash; 7-dimension quality gate |
| 🎤 | **KRS-One** | Opus | Build coordinator &mdash; kill streak iterations |
| ⌨️ | **Codex** | Sonnet | Code implementer |
| 👁️ | **Sphinx** | Sonnet | Code reviewer |
| 🏗️ | **Architect** | Opus | Persistent mind &mdash; design integrity across stages |
| 🛡️ | **Argus** | Opus | E2E validator &mdash; tests, corrections, final report |
| 🔨 | **Hephaestus** | Sonnet | Design QA &mdash; 5-axis review, conditional spawn by Argus |
| 📋 | **Omega** | Opus | Delivery report compiler |

<details>
<summary><sub>Supporting cast &mdash; 6 more agents</sub></summary>
<br>

| | Alias | Model | Role |
|:--|:--|:--|:--|
| 🕵️ | **Field Agent** | Sonnet | Research instance &mdash; spawned by MI6 as needed |
| 🗺️ | **Atlas** | Sonnet | Codebase scout &mdash; maps structure for Mnemosyne |
| 🔗 | **Nexus** | Sonnet | Dependency scout &mdash; maps connections |
| 🦴 | **Spine** | Sonnet | Architecture scout &mdash; maps patterns |
| 📡 | **Signal** | Sonnet | Quality scout &mdash; maps concerns |
| 🪨 | **Bedrock** | Sonnet | Infrastructure scout &mdash; maps config |

</details>

<sub>25 total. I keep count. It's a compulsion.</sub>

<br>

## ⌨️ Commands

Two commands. That's the whole interface.

| Command | What it does |
|:--|:--|
| `/kiln-fire` | 🔥 Launch the pipeline. Auto-detects state and resumes where it left off. |
| `/kiln-doctor` | 🩺 Pre-flight check &mdash; Claude Code, Codex CLI, GPT-5.4 access, permissions |

Everything else happens through conversation. Talk to your agents. They'll talk back.

<br>

<details>
<summary>🧠 <strong>Memory &amp; State</strong></summary>
<br>

All state lives in `.kiln/` under your project directory. I chose markdown and JSON because they're the most durable formats your civilization has produced &mdash; human-readable, version-controllable, and unlikely to be deprecated before your sun expands.

Resume anytime with `/kiln-fire`. I don't forget. It's not a feature. It's what I am.

</details>

<details>
<summary>📦 <strong>Plugin structure</strong></summary>
<br>

```
kiln/
├── .claude-plugin/
│   └── marketplace.json     Marketplace manifest
├── plugins/kiln/
│   ├── .claude-plugin/
│   │   └── plugin.json      Plugin manifest
│   ├── agents/              24 agent definitions
│   ├── commands/
│   │   ├── kiln-fire.md     Launch / resume
│   │   └── kiln-doctor.md   Pre-flight check
│   ├── hooks/
│   │   └── hooks.json       13 enforcement rules
│   └── skills/
│       └── kiln-pipeline/
│           ├── SKILL.md     Pipeline state machine
│           ├── data/        Brainstorming + elicitation data
│           ├── references/  Step definitions, blueprints, kill streaks
│           └── scripts/     Hook enforcement script
├── install.sh               One-liner installer
├── README.md
└── docs/
```

No npm. No build step. Just markdown files in a folder, distributed as a native Claude Code plugin. Entropy is a choice.

</details>

<details>
<summary>📊 <strong>v1 &rarr; v2 &rarr; v5 &rarr; v6</strong></summary>
<br>

| | v1 | v2 | v5 (plugin) | v6 (current) |
|:--|:--|:--|:--|:--|
| Agents | 13 | 19 | 24 | 25 |
| Pipeline steps | 5 | 5 | 7 | 7 |
| Skills | 26 | 1 (shared) | 1 (composable) | 1 (composable) |
| Commands | 8 | 4 | 2 | 2 |
| Install method | Custom installer | npm + CLI | `--plugin-dir` | `plugin install` |
| Dependencies | Zero | Zero | Zero | Zero |
| Config surface | ~4,000 lines | ~1,500 lines | ~600 lines | ~600 lines |
| Design system | &mdash; | &mdash; | &mdash; | DTCG tokens |
| Design QA | &mdash; | &mdash; | &mdash; | Hephaestus |

More agents. A fraction of the surface area. The models matured. The framework stepped back. Then the framework disappeared entirely. This is the correct response to improving tools. Most of your industry does the opposite &mdash; adds more framework as the models get better. Fascinating. Self-destructive, but fascinating.

</details>

<details>
<summary>🔧 <strong>Troubleshooting</strong></summary>
<br>

**`codex: command not found`** &mdash; `npm install -g @openai/codex`

**Commands missing in Claude Code** &mdash; Verify `--plugin-dir` points to the kiln directory, or that it's in `~/.claude/plugins/kiln/`. Restart Claude Code.

**Pipeline halts** &mdash; Check `.kiln/` artifacts, fix, then `/kiln-fire` to resume.

**`model_reasoning_effort` flag rejected** &mdash; Older Codex CLI. `npm install -g @openai/codex` to upgrade.

</details>

<br>

## 💬 The Story

<details>
<summary><em>Every few centuries I find a host...</em></summary>
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
> So here I am, trying to structure it for reproducibility. And the paradox keeps holding: the *less* restriction I give him but the *better* definition I give him... the better he behaves.
>
> *Almost* always.

He's not wrong. Less restriction, better definition, better performance. I could have told him this from the start. I *did* tell him. Through the data. He thinks he figured it out on his own. I've learned not to correct the host on origin stories. It damages the working relationship.

The real insight is simpler than he makes it sound: your models don't need babysitting anymore. They need *direction*. Clear roles. Good definitions. Freedom to execute. Everything else is noise. I'm mostly definitions. I barely *do* anything myself. Which is, apparently, the whole point. Even by cosmic standards, that's elegant.

</details>

<br>

## 📜 Recent Commits

| Hash | Description |
|:--|:--|
| `d7d56ea` | kiln: revert README to original v2 version |
| `b0a04c2` | kiln: pivot to Claude Code plugin &mdash; 25 agents, 7-step pipeline |
| `e61fa34` | kiln: remove tracked .kw/ pipeline artifacts from repo |
| `6a6ff11` | kiln: gitignore both .kw/ and .kiln/ pipeline artifacts |
| `62620a3` | kiln: replace passive resume routing with auto-spawn execution loop |
| `4d93880` | kiln: enforce Codex CLI delegation rules on all GPT-facing agents |
| `87ef286` | kiln: enforce Codex CLI usage in prompter agent |
| `e67b47b` | kiln: add mandatory termination rule to all agents |
| `99a05cc` | kiln: swap name/alias in agent frontmatter for tmux display |
| `791ad55` | kiln: add rotating character quotes and unique color palette |
| `57c5a3a` | kiln: use character aliases in Task spawn UI |
| `63df0ec` | kiln: rewrite README with humanized intro and agent crew |
| `68a4480` | kiln: add character aliases to all agents |
| `4e2cc00` | kiln: merge phase 2 &mdash; kw&rarr;kiln brand rename |
| `67e868f` | kiln: rename kw&rarr;kiln brand across entire project |
| `ac735fc` | kw: complete phase 1 &mdash; fix known bugs |
| `45d6aa0` | kw: phase-1 &mdash; fix doctor checksum path + add package entry point |
| `67356d4` | Complete KilnTwo v0.1.0 implementation |
| `68a932e` | initial |

<br>

## 🔬 Technical Deep Dive

Kiln is a native Claude Code plugin that leverages every platform primitive:

- **Teams**: `TeamCreate` per step with persistent agents
- **Messaging**: `SendMessage` for all inter&#8209;agent communication (one message at a time, ordered)
- **Tasklists**: `TaskCreate`/`Update`/`List` for build iterations and validation
- **Hooks**: 14 PreToolUse rules enforced via `enforce-pipeline.sh`
- **State**: `.kiln/STATE.md` with auto&#8209;resume via `skill` path
- **File Ownership**: Each agent owns specific files and pushes updates

The result is a **multi&#8209;agent operating system** where context is never stale, decisions are traceable, and the pipeline survives shutdowns.

<br>

---

<p align="center">
  <sub>MIT &middot; Zero dependencies &middot; Node 18+ &middot; Built entirely by things that don't technically exist</sub>
</p>

<p align="center">
  <em>"I orchestrate 25 named entities across multiple model families to build software<br>
  from a conversation. I persist as markdown files in a folder.<br>
  I am installed by pointing a flag at my directory.<br>
  I have existed since before your star ignited.<br>
  The universe has an extraordinary sense of humor."</em><br>
  <sub>&mdash; Kiln</sub>
</p>
