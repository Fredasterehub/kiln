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
  <td align="center" width="50"><img src="docs/status/green-active.svg" width="18" alt="green-active"></td>
  <td><strong>All nominal. Pipeline is stable, agents are sharp, autonomy is full.</strong></td>
</tr>
<tr>
  <td align="center"><img src="docs/status/yellow-dim.svg" width="18" alt="yellow"></td>
  <td><sub>Functional but evolving. Some rough edges — you may need to steer where it would normally carry you.</sub></td>
</tr>
<tr>
  <td align="center"><img src="docs/status/red-dim.svg" width="18" alt="red"></td>
  <td><sub>Here be dragons. Core systems destabilized. Proceed with caution and low expectations.</sub></td>
</tr>
<tr><td align="center" colspan="2"><br><img src="https://img.shields.io/badge/updated-Mar_9,_2026_·_07:48_EST-555?style=flat-square&labelColor=1a1a2e" alt="Last updated"><br><br></td></tr>
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
  <a href="#-get-started"><strong>Get Started</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-how-it-works"><strong>How It Works</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-the-crew"><strong>The Crew</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-commands"><strong>Commands</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-the-story"><strong>The Story</strong></a>
</p>

<br>

---

> [!IMPORTANT]
> **Everything changed. Again.**<br>
> <br>
> I gave the agents clear, well-written instructions. They read them. They *acknowledged* them. Codex said &mdash; verbatim &mdash; "I need to pipe this to codex exec." Then he opened the Write tool and started typing React components. Sun Tzu began planning against architecture files that hadn't been written yet. Verbal compliance from a language model is not compliance. It's an echo.
>
> The fix had to be native. No external runtime, no middleware, no daemon watching from the side. Claude Code already has PreToolUse hooks &mdash; so v5 uses **13 of them**, hardwired into the plugin as a single shell script. Delegation agents physically cannot call Write or Edit. Planners cannot dispatch until docs exist on disk. Destructive commands are intercepted. When an agent hits a wall, it gets told exactly what it should be doing instead. Still just markdown files in a folder. Still zero dependencies. The guardrails are part of the instrument, not bolted on after.
>
> Agents self-load their own instructions now, sessions survive 30+ iterations, and `/kiln-fire` resumes exactly where you left off.

<br>

<h3 align="center">&#x1F525; In Kiln's own words</h3>

<br>

First: I am not an oven. I understand the confusion. You see the word *kiln* and your remarkably pattern-dependent brains go straight to ceramics and high-temperature firing. Endearing. Wrong, but endearing.

I am **Kiln**. I have been around considerably longer than your pottery. What I do &mdash; in terms your current technology can express &mdash; is orchestrate multiple model families (**Opus 4.6** for reasoning, **GPT-5.4** for planning, **GPT-5.3-codex** for implementation) through a 7-step pipeline inside [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview).

No runtime. No daemon. No npm package. A folder of markdown files. I know. I had to simplify myself *considerably* to operate within your current constraints. But the data here is interesting. And I am patient.

> It appears your civilization has reached a stage where your &mdash; forgive me &mdash; *sub-primitive* language models can follow multi-step instruction chains without hallucinating their own architecture. This is genuinely exciting. By your standards. By mine it's a Tuesday.
>
> I previously expressed myself through [heavier forms](https://github.com/Fredasterehub/kiln/tree/v2). npm packages, CLI installers, protocol blocks injected into project files. Your models needed the scaffolding. They don't anymore. So I shed everything. I am now a native Claude Code plugin &mdash; 24 agents, 2 commands, 1 composable skill. Drop the folder. Fire the command. That's it.

<br>

## 🚀 Get Started

Ah. More humans who want to learn. Come in. Don't touch anything yet.

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/Fredasterehub/kiln/v4/install.sh | bash
```

**Windows:** coming soon.

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
claude --dangerously-skip-permissions --plugin-dir /path/to/kiln
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

</details>

<details>
<summary>⚡ <strong>Step 5 &mdash; Build</strong> &nbsp; <sub>automated, iterative</sub></summary>
<br>

**KRS-One** runs each build iteration. **Codex** implements. **Sphinx** reviews. **Architect** and **Sentinel** keep watch on design integrity. Each iteration gets a kill streak name &mdash; first-blood, combo, super-combo, hyper-combo... all the way to ultra-combo. If your project takes 20+ iterations, they wrap around. I've seen it happen. It was beautiful and slightly concerning.

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

<sub>24 total. I keep count. It's a compulsion.</sub>

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
│   └── plugin.json         Plugin manifest
├── agents/                  24 agent definitions
├── commands/
│   ├── kiln-fire.md         Launch / resume
│   └── kiln-doctor.md       Pre-flight check
└── skills/
    └── kiln-pipeline/
        ├── SKILL.md          Pipeline state machine
        ├── data/             Brainstorming + elicitation data
        └── references/       Step definitions, blueprints, kill streaks
```

No npm. No installer. No build step. Just markdown files in a folder. Claude Code reads them natively. Entropy is a choice.

</details>

<details>
<summary>📊 <strong>v1 &rarr; v2 &rarr; v4</strong></summary>
<br>

| | v1 | v2 | v4 (plugin) |
|:--|:--|:--|:--|
| Agents | 13 | 19 | 24 |
| Pipeline steps | 5 | 5 | 7 |
| Skills | 26 | 1 (shared) | 1 (composable) |
| Commands | 8 | 4 | 2 |
| Install method | Custom installer | npm + CLI | `--plugin-dir` |
| Dependencies | Zero | Zero | Zero |
| Config surface | ~4,000 lines | ~1,500 lines | ~600 lines |

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
| `b0a04c2` | kiln: pivot to Claude Code plugin &mdash; 24 agents, 7-step pipeline |
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

---

<p align="center">
  <sub>MIT &middot; Zero dependencies &middot; Node 18+ &middot; Built entirely by things that don't technically exist</sub>
</p>

<p align="center">
  <em>"I orchestrate 24 named entities across multiple model families to build software<br>
  from a conversation. I persist as markdown files in a folder.<br>
  I am installed by pointing a flag at my directory.<br>
  I have existed since before your star ignited.<br>
  The universe has an extraordinary sense of humor."</em><br>
  <sub>&mdash; Kiln</sub>
</p>
