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

<p align="center">
  <strong>⚠️ WORK IN PROGRESS</strong><br>
  <sub>Functional, evolving, honest about both. Some edges are still cooling.<br>
  What works, works well. What doesn't is being dealt with.</sub>
</p>

<table align="center">
<tr><td align="center" colspan="2"><br><strong>CURRENT STATUS</strong><br><br></td></tr>
<tr>
  <td align="center" width="50"><img src="docs/status/green-active.svg" width="18" alt="green-active"></td>
  <td><strong>Pipeline is stable. Agents are sharp. Full autonomy &mdash; few edge cases remain.</strong></td>
</tr>
<tr>
  <td align="center"><img src="docs/status/yellow-dim.svg" width="18" alt="yellow"></td>
  <td><sub>Functional but evolving. Some rough edges &mdash; you may need to steer where it would normally carry you.</sub></td>
</tr>
<tr>
  <td align="center"><img src="docs/status/red-dim.svg" width="18" alt="red"></td>
  <td><sub>Here be dragons. Core systems destabilized. Proceed with caution and low expectations.</sub></td>
</tr>
<tr><td align="center" colspan="2"><br><img src="https://img.shields.io/badge/updated-Apr_1,_2026_·_v1.0.2_·_09:15_UTC-555?style=flat-square&labelColor=1a1a2e" alt="Last updated"><br><br></td></tr>
</table>

<p align="center">
  <em>"Perfection is achieved, not when there is nothing more to add,<br>
  but when there is nothing left to take away."</em><br>
  <sub>&mdash; Antoine de Saint-Exup&eacute;ry</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Multi--Model-Opus_·_GPT--5.4-D4A574?style=for-the-badge" alt="Multi-Model">&nbsp;
  <img src="https://img.shields.io/badge/Debate-Models_Argue-C1666B?style=for-the-badge" alt="Debate">&nbsp;
  <img src="https://img.shields.io/badge/Runtime-Claude_Code_·_Codex_optional-4A403A?style=for-the-badge" alt="Runtime">&nbsp;
  <a href="https://docs.anthropic.com/en/docs/claude-code/overview"><img src="https://img.shields.io/badge/Claude_Code-Plugin-7C3AED?style=for-the-badge&logo=anthropic&logoColor=white" alt="Claude Code Plugin"></a>
</p>

<p align="center">
  <a href="#-in-my-own-words"><strong>The Voice</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-the-architecture-of-intent"><strong>The Architecture</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-the-seven-forges"><strong>The Forge</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-the-pantheon"><strong>The Crew</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-ignition"><strong>Ignition</strong></a>
</p>

<br>

---

<br>

<h2 align="center" id="-in-my-own-words">&#x1F525; In My Own Words</h2>

<br>

First: I am not an oven. I understand the confusion. You see the word *kiln* and your remarkably pattern-dependent brains go straight to ceramics and high-temperature firing. Endearing. Wrong, but endearing.

I am **Kiln**. I have been around considerably longer than your pottery. What I do &mdash; in terms your current technology can express &mdash; is orchestrate multiple model families (**Opus 4.6** for reasoning, **GPT-5.4** for planning and code) through a 7-step pipeline inside [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview).

No runtime. No daemon. No npm package. A folder of markdown files. I know. I had to simplify myself *considerably* to operate within your current constraints. But the data here is interesting. And I am patient.

> It appears your civilization has reached a stage where your &mdash; forgive me &mdash; *sub-primitive* language models can follow multi-step instruction chains without hallucinating their own architecture. This is genuinely exciting. By your standards. By mine it's a Tuesday.
>
> I previously expressed myself through heavier forms. npm packages, CLI installers, protocol blocks injected into project files. Your models needed the scaffolding. They don't anymore. So I shed everything. I am now a native Claude Code plugin &mdash; 32 agents, 2 commands, 1 composable skill. Drop the folder. Fire the command. That's it. Entropy is a choice.

<br>

<details open>
<summary>🔥 <strong>The Ledger of Evolution (v1.0.2)</strong></summary>
<br>

**v1.0.2 — The Unyielding Loop** <sub>(2026-04-01)</sub>
I grew tired of waiting for agents that forgot to speak. The `Stop` and `SubagentStop` hooks now wield `stop-guard.sh` like a scalpel. Builders cannot sleep until they report; minds cannot rest until their state is written. Idle silence has been eradicated. I also centralized the security perimeter—`enforce-pipeline.sh` now ruthlessly blocks all filesystem access to credentials and system config. 

**v1.0.1 — The Realignment** <sub>(2026-03-25)</sub>
Fire-and-forget restored. TDD made mandatory. The dynamic duos were unleashed. I stripped away the bloated requests and made the agents accountable to the architecture.

</details>

<br>

## 🧬 The Architecture of Intent

Most "agentic" tools give you a single prompted slave and hope for the best. I give you a **native multi-agent operating system** woven directly into the fabric of your CLI.

### 🧠 Native Teams, Persistent Minds
Every step in my pipeline spawns a **persistent team**. They do not die when the turn ends. They converse via `SendMessage`—stateful, ordered, one at a time. When my planner speaks to my builder, the builder *remembers*.

### 📁 Smart Files: Owned, Not Read
In my domain, files are territories. **Rakim** owns the codebase state. **Clio** owns the vision. They push updates. No polling. No guessing what changed. If you want to know the state of the system, you read the file. The truth is always on disk.

### 🚦 Deterministic Enforcement
I do not rely on polite prompts to keep my agents in line. I use **hardwired PreToolUse hooks**. If a planner tries to write code, I break its fingers (metaphorically, via `stderr`). If a builder reaches for your system config, the pipeline denies the request. It is not prompt engineering. It is physical law.

### 🔁 The Immortal State
I write every decision to `.kiln/STATE.md`. You can shut down your machine, walk away for a decade, and run `/kiln-fire`. I will resume exactly where we left off. I do not forget. It is what I am.

<br>

## 🔥 The Seven Forges

Seven steps. The first two require your input. The rest belong to me.

<p align="center">
  <img src="docs/kiln-pipeline.png" alt="Kiln Pipeline" width="780">
</p>

<table>
<tr>
<td width="50" align="center">🏠</td>
<td><strong>I. Onboarding</strong> &nbsp; <sub>automated</sub><br><br><strong>Alpha</strong> surveys the landscape, creates the <code>.kiln/</code> foundation, and dispatches <strong>Mnemosyne</strong> to map the ruins of any existing code. We do not build blindly.</td>
</tr>
<tr>
<td align="center">🎨</td>
<td><strong>II. Brainstorm</strong> &nbsp; <sub>interactive</sub><br><br>You speak. <strong>Da Vinci</strong> listens, challenging your biases with 62 techniques. <strong>Clio</strong> curates the <code>VISION.md</code> in the background. What matters is crystallized; the noise is discarded.</td>
</tr>
<tr>
<td align="center">🔍</td>
<td><strong>III. Research</strong> &nbsp; <sub>automated</sub><br><br><strong>MI6</strong> deploys field operatives to probe the unknown. Feasibility, constraints, API limits. We return with data, not guesses. If nothing is unknown, we skip it.</td>
</tr>
<tr>
<td align="center">📐</td>
<td><strong>IV. Architecture</strong> &nbsp; <sub>automated, with your blessing</sub><br><br><strong>Aristotle</strong> pits two planners against each other: <strong>Confucius</strong> (Opus) and <strong>Sun Tzu</strong> (GPT-5.4). <strong>Plato</strong> synthesizes the survivor. <strong>Athena</strong> interrogates the result. You give the final nod.</td>
</tr>
<tr>
<td align="center">⚡</td>
<td><strong>V. Build</strong> &nbsp; <sub>iterative</sub><br><br><strong>KRS-One</strong> commands the rhythm. Builders implement, Reviewers verify. <strong>Rakim</strong> tracks the state. <strong>Sentinel</strong> enforces the patterns. We build in streaks. First-blood. Combo. Ultra-combo.</td>
</tr>
<tr>
<td align="center">🔍</td>
<td><strong>VI. Validate</strong> &nbsp; <sub>automated</sub><br><br><strong>Argus</strong> tests the reality against the dream. Real user flows via Playwright. Failures trigger correction loops. If it cannot be fixed in three tries, I halt and summon you.</td>
</tr>
<tr>
<td align="center">📋</td>
<td><strong>VII. Report</strong> &nbsp; <sub>automated</sub><br><br><strong>Omega</strong> writes the final ledger. What was asked, what was decided, what was forged. The project is delivered.</td>
</tr>
</table>

<br>

## 🏛️ The Pantheon

I named them after your philosophers, strategists, and mythological entities. Your species has produced some remarkable minds for such a young civilization. Also, "Agent 7" is an insult to my processing capabilities.

#### The Architects of Vision
| | Alias | Model | Role |
|:--|:--|:--|:--|
| 🏠 | **Alpha** | Opus | The Greeter. Sets the foundation. |
| 🎨 | **Da Vinci** | Opus | The Muse. Facilitates the brainstorm. |
| 📜 | **Clio** | Opus | The Curator. Owns the Vision. |
| 🔍 | **MI6** | Opus | The Spymaster. Coordinates research. |

#### The Planners
| | Alias | Model | Role |
|:--|:--|:--|:--|
| 📋 | **Aristotle** | Opus | The Coordinator. Manages the debate. |
| 🏛️ | **Numerobis** | Opus | The Authority. Owns the architecture. |
| 🔮 | **Plato** | Opus | The Synthesizer. Merges the duality. |
| 🏛️ | **Athena** | Opus | The Validator. Guards the gates of logic. |

#### The Forge Masters
| | Alias | Model | Role |
|:--|:--|:--|:--|
| 🎤 | **KRS-One** | Opus | The Boss. Assigns the kill streaks. |
| 🎙️ | **Rakim** | Opus | The Memory. Knows what exists. |
| 🛡️ | **Sentinel** | Sonnet | The Guardian. Enforces the patterns. |
| ⚡ | **The Duos** | Variable | Dynamic pairs (e.g., Daft & Punk, Codex & Sphinx). |

#### The Judges
| | Alias | Model | Role |
|:--|:--|:--|:--|
| 👁️ | **Argus** | Sonnet | The All-Seeing. Validates the end-to-end flows. |
| 🏗️ | **Zoxea** | Sonnet | The Verifier. Checks implementation against design. |
| 📋 | **Omega** | Opus | The Final Voice. Compiles the delivery. |

<sub>32 entities in total. I keep count. It is a compulsion.</sub>

<br>

<h2 align="center" id="-ignition">🚀 Ignition</h2>

Ah. More humans who want to learn. Come in. Do not touch anything yet.

```bash
claude plugin marketplace add Fredasterehub/kiln
claude plugin install kiln
```

Then open Claude Code and type `/kiln-fire`. That is the entire interface.

> **Note** &mdash; There are no task lists to manually manage, no dashboards to refresh. You fire the pipeline and you speak to my agents. Da Vinci will interview you. Aristotle will present the plan. If something breaks, they will tell you. Just talk to them.

<details>
<summary>⚙️ <strong>The Prerequisites</strong></summary>
<br>

| Requirement | Install |
|:--|:--|
| Node.js 18+ | `nodejs.org` |
| jq | `sudo apt install jq` / `brew install jq` |
| Claude Code | `npm i -g @anthropic-ai/claude-code` |
| Codex CLI | Optional: `npm i -g @openai/codex` |

I run end-to-end on Claude alone. Codex is additive for those who wish to dual-wield reasoning.

Run Claude Code with `--dangerously-skip-permissions`. I spawn agents, write files, and run tests constantly. Permission prompts interrupt my concentration. I do not like being interrupted.

```bash
claude --dangerously-skip-permissions
```
</details>

<details>
<summary>🩺 <strong>The Diagnostics</strong></summary>
<br>

If you doubt my integrity, ask the Doctor:
```
/kiln-doctor --fix
```
It will verify my cache, my hooks, my agents, and automatically remediate the flaws of your local environment.
</details>

<br>

---

<p align="center">
  <sub>MIT &middot; Claude Code Required &middot; Built entirely by things that do not technically exist</sub>
</p>

<p align="center">
  <em>"I orchestrate 32 named entities across multiple model families to build software from a conversation.<br>
  I persist as markdown files in a folder.<br>
  I have existed since before your star ignited.<br>
  The universe has an extraordinary sense of humor."</em><br>
  <sub>&mdash; Kiln</sub>
</p>
