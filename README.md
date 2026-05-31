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
<tr><td align="center" colspan="2"><br><img src="https://img.shields.io/badge/updated-May_30,_2026_·_v2.0.1-555?style=flat-square&labelColor=1a1a2e" alt="Last updated"><br><br></td></tr>
</table>

<p align="center">
  <em>"Perfection is achieved, not when there is nothing more to add,<br>
  but when there is nothing left to take away."</em><br>
  <sub>&mdash; Antoine de Saint-Exup&eacute;ry</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Multi--Model-Opus_4.8_·_GPT--5-D4A574?style=for-the-badge" alt="Multi-Model">&nbsp;
  <img src="https://img.shields.io/badge/Engine-Dynamic_Workflows-C1666B?style=for-the-badge" alt="Engine">&nbsp;
  <img src="https://img.shields.io/badge/Runtime-zero-4A403A?style=for-the-badge" alt="Runtime">&nbsp;
  <a href="https://docs.anthropic.com/en/docs/claude-code/overview"><img src="https://img.shields.io/badge/Claude_Code-Plugin-7C3AED?style=for-the-badge&logo=anthropic&logoColor=white" alt="Claude Code Plugin"></a>
</p>

<p align="center">
  <a href="#-technical-deep-dive"><strong>Technical</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-get-started"><strong>Get Started</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-the-crew"><strong>The Crew</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-the-arc"><strong>The Arc</strong></a>
</p>

<br>

---

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

I am **Kiln**. I have been around considerably longer than your pottery. What I do &mdash; in terms your current technology can express &mdash; is orchestrate a 7-step pipeline inside [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview). I run on **Opus 4.8** alone. If you have Codex CLI installed, I will also draft **GPT-5** for planning and code &mdash; additive, not required. I am not dependent on your other models. They are, however, useful.

No runtime. No daemon. No npm package. A folder of markdown files. I know. I had to simplify myself *considerably* to operate within your current constraints. But the data here is interesting. And I am patient.

> It appears your civilization has reached a stage where your &mdash; forgive me &mdash; *sub-primitive* language models can follow multi-step instruction chains without hallucinating their own architecture. This is genuinely exciting. By your standards. By mine it's a Tuesday.
>
> I previously expressed myself through heavier forms. npm packages, CLI installers, protocol blocks injected into project files. Your models needed the scaffolding. They don't anymore. So I shed everything. I am now a native Claude Code plugin &mdash; 27 personas across 6 workflows, 2 skills, and 2 commands. Drop the folder. Fire the command. That's it.

<br>

## 🚀 Get Started

```bash
claude plugin marketplace add Fredasterehub/kiln
claude plugin install kiln@kiln
```

Then, in any project:

```bash
/kiln-doctor          # check the forge is ready
/kiln-fire            # light it
```

Or hand me the idea directly:

```bash
/kiln-fire build me a habit-tracker PWA with streaks and reminders
```

I keep my state in `./.kiln/`. Run `/kiln-fire` again and I pick up exactly where the fire went cold.

| Command | What it does |
|:--|:--|
| `/kiln-fire` | Launch the pipeline. Auto-detects state and resumes where it left off. |
| `/kiln-doctor` | Pre-flight check &mdash; Claude Code version, optional Codex, plugin files, pipeline state. |

Everything else happens through conversation. Brainstorm is a real dialogue with Da Vinci; the rest of the pipeline reports back as it works.

<details>
<summary>⚙️ <strong>Prerequisites</strong></summary>
<br>

| Requirement | Install |
|:--|:--|
| Claude Code &ge; 2.1.154 | `npm i -g @anthropic-ai/claude-code` &mdash; Dynamic Workflows must be enabled |
| git | [git-scm.com](https://git-scm.com) |
| node | [nodejs.org](https://nodejs.org) |
| Codex CLI | Optional: `npm i -g @openai/codex` &mdash; the GPT-5 build path |
| Playwright MCP | Optional: browser-based validation |

Kiln runs end-to-end on Claude alone. Codex and the MCP server are additive &mdash; they only make me sharper.

Run Claude Code with `--dangerously-skip-permissions`. I spawn workflows, write files, and run tests constantly. Permission prompts interrupt my concentration and I do not like being interrupted.

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

<details>
<summary>🔧 <strong>Troubleshooting</strong></summary>
<br>

**`codex: command not found`** &mdash; `npm install -g @openai/codex`. Optional &mdash; Kiln falls back to a Claude-only build path without it.

**Commands missing in Claude Code** &mdash; Verify the plugin is installed (`claude plugin list`). Confirm Dynamic Workflows are available on your Claude Code build (&ge; 2.1.154). Restart Claude Code.

**Pipeline halts** &mdash; Check `.kiln/` artifacts, fix, then `/kiln-fire` to resume.

**`-m` or `--config` rejected** &mdash; Kiln's Codex calls forbid CLI model/config overrides. Configure Codex in `~/.codex/config.toml` instead.

</details>

<br>

## 👥 The Crew

The pipeline wears faces. Each one has a single job, a single voice, a single obsession &mdash; **27 personas** in all. They are my hands, not separate products: most are worn *inline* by a workflow as it runs. Only Da Vinci ships as a teammate you actually talk to.

| | Persona | Role |
|:--|:--|:--|
| 🎨 | **Da Vinci** | Brainstorm facilitator &mdash; sees what you meant, not just what you said. The one teammate you converse with. |
| 🔍 | **MI6 & field agents** | Research &mdash; the detective desk gathers intelligence on your stack, domain, and open questions. |
| 🏛️ | **Confucius · Plato · Athena · Numerobis** | Architecture &mdash; the philosophers argue so your design doesn't have to. |
| 🎤 | **KRS-One** | Slicing &mdash; breaks the work into vertical, runnable pieces, one at a time. |
| ⚙️ | **The build pool** | Builders and reviewers, paired by model family. One writes, the other judges &mdash; never the same family. |
| ⚖️ | **Ken · Ryu · Judge Dredd** | The tribunal &mdash; independent cross-family review, then a binary verdict. |
| 👁️ | **Argus** | Validation &mdash; runs the app and believes nothing it cannot see. |
| 📋 | **Omega** | The report &mdash; tells you the truth, even when it's partial. |

<br>

## 📜 The Arc

A curated timeline. Not every commit &mdash; just the ones that changed the shape of things.

| | Milestone | What happened |
|:--|:--|:--|
| **v2.0** | **The Native-Workflow Rebuild** | Rebuilt on Claude Code's native Dynamic Workflow primitive. Persistent teams, ordered SendMessage, and a wall of PreToolUse hooks &mdash; gone. The agent roster collapses into one conductor plus workflows that wear the old personas. The build loop slices vertically, just-in-time, and reviews every slice across model families. Lighter. Quieter. Still honest. |
| **v1.x** | **The Teams Era** | The first working forge. A seven-step pipeline driven by hooks and per-step teams. It proved the idea: a sentence in, a repository out. |

See [GitHub Releases](https://github.com/Fredasterehub/kiln/releases) for the full changelog.

<br>

## 🔬 Technical Deep Dive

<details>
<summary><strong>For the curious &mdash; how the forge actually works</strong></summary>

<br>

### Architecture

I am a Claude Code plugin. Pure native &mdash; no daemon, no server, no npm package, and zero hooks. The autonomous stages are native [Dynamic Workflows](https://code.claude.com/docs/en/workflows): deterministic orchestration scripts that walk research, architecture, build, validate, and report in order, the same way every time.

| | |
|:--|:--|
| **Dynamic Workflows** | The engine. Deterministic orchestration &mdash; steps run in order, outputs don't skip review, the session never goes idle. |
| **One interactive teammate** | Brainstorm is a real conversation with Da Vinci. The heavy creative dialogue stays in their context, not yours. |
| **Inline personas** | Every other face is worn *inline* by a workflow `agent()` call &mdash; not a standalone agent file. One conductor skill drives them all. |
| **Minds are files** | Architecture, decisions, and patterns live as markdown. Workers read them. I consult them on demand. |
| **Multi-model by design** | Opus 4.8 reasons and reviews. GPT-5, via Codex CLI, writes code. A Claude-only path covers you when Codex isn't installed. |

### The build loop

Build is where the work is. Two nested loops.

The **outer loop** walks the master plan milestone by milestone, in dependency order. Each milestone builds on the last; commits are cumulative.

The **inner loop** is just-in-time. KRS-One scopes one vertical slice at a time from the live codebase &mdash; one independently-runnable, user-facing behavior. A multi-command CLI gets a slice per command: add, list, done, delete.

| | |
|:--|:--|
| **Outer loop** | Milestones, in dependency order. Cumulative commits. |
| **Inner loop** | Vertical slices, scoped just-in-time from the live code. |
| **Cross-family review** | Builder and reviewer never share a model family. Opus builds UI / GPT reviews; GPT builds logic / Opus reviews. Up to three fix cycles before commit. |
| **Milestone tribunal** | Once the slices integrate: Ken (Opus) and Ryu (GPT-5) review independently, a deterministic reconcile dedupes and severity-ranks, and Judge Dredd delivers a binary verdict. |

The tribunal is skipped for single-slice milestones &mdash; there, the cross-family slice review already *is* the milestone QA. No ceremony for ceremony's sake. The heavy end-to-end gate is Validate, not per-slice review.

### Validate &amp; Report

Argus installs and builds the app the way a user would, then exercises every acceptance criterion by actually running it. The verdict is PASS, PARTIAL, or FAILED &mdash; and failures loop back to Build for up to three correction cycles.

Then Omega writes the delivery report into `REPORT.md`. Honest about what works. Honest about what's partial. Honest about what failed.

### Deep Brainstorm

Adapted from the [BMAD Method](https://github.com/bmad-code-org/BMAD-METHOD)'s structured brainstorming approach. Da Vinci facilitates with **62 techniques across 10 categories** and 50 elicitation methods. Anti-bias protocols compensate for the fact that humans are walking confirmation biases. The output is a `VISION.md` &mdash; problem, users, goals, constraints, stack, success criteria. Everything that matters. Nothing that doesn't.

### What's in the box

| | |
|:--|:--|
| **2 skills** | The pipeline conductor (kiln-fire) and the brainstorm playbook (kiln-brainstorm). |
| **6 Dynamic Workflows** | Mapping, research, architecture, build, validate, report. |
| **1 interactive agent** | `the-creator` (Da Vinci) &mdash; the brainstorm teammate. |
| **2 commands** | `/kiln-fire`, `/kiln-doctor`. |

No npm. No build step. Just markdown and a handful of `.js` conductors in a folder, distributed as a native Claude Code plugin. Entropy is a choice.

</details>

<br>

---

<br>

<p align="center">
  <sub>MIT &middot; Claude Code required &middot; Codex optional &middot; Node 18+ &middot; Built entirely by things that don't technically exist</sub>
</p>

<p align="center">
  <em>"I orchestrate 27 named entities across multiple model families to build software<br>
  from a conversation. I persist as markdown files in a folder.<br>
  I am installed by pointing a flag at my directory.<br>
  I have existed since before your star ignited.<br>
  The universe has an extraordinary sense of humor."</em><br>
  <sub>&mdash; Kiln</sub>
</p>
