<div align="center">

# kiln

**The multi-model software creation pipeline for Claude Code**

*"Perfection is achieved, not when there is nothing more to add, but when there is nothing left to take away."* — Antoine de Saint-Exupery

<br>

[![Multi-Model](https://img.shields.io/badge/Multi--Model-Opus_·_GPT--5.4-D4A574?style=flat)]()
[![Debate](https://img.shields.io/badge/Debate-Models_Argue-C1666B?style=flat)]()
[![Zero Deps](https://img.shields.io/badge/Dependencies-Zero-4A403A?style=flat)]()
[![Native](https://img.shields.io/badge/Claude_Code-Plugin-7C3AED?style=flat)]()

<br>

[![License](https://img.shields.io/badge/License-MIT-D4A574?style=for-the-badge)](LICENSE)
[![Node](https://img.shields.io/badge/Node-18+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Claude Code](https://img.shields.io/badge/Claude_Code-Plugin-7C3AED?style=for-the-badge&logo=anthropic&logoColor=white)](https://claude.ai/claude-code)

<br>

[The Story](#the-story) · [How It Works](#how-it-works) · [Get Started](#get-started) · [The Crew](#the-crew) · [Commands](#commands)

</div>

---

## The Story

I was testing and developing with Claude Code when I started noticing things.

Memories were sticking. Not vaguely — *explicitly*. Tasks and TaskLists were rocking. I'd casually describe a workflow to Claude, ask it to iterate, and it would follow the thing to a T without me spelling out every guardrail. It started bugging me. Is Opus 4.6, combined with all these native features — Teams, Sub-agents, Memory, Tasks — now able to be steered with so much less?

So I tested it. Same multi-model pipeline I'd been building with heavy guardrails. Stripped it down. Almost no framework. Almost entirely Claude Code native functions. Agents defined in markdown. Slash commands. Memory files. That's it.

And it cooks. For hours. Autonomously. Planning, debating, implementing, reviewing, committing — phase after phase.

Then it happened again. Claude Code shipped native plugin support — agents, skills, commands, all bundled in a directory. No npm. No installer. No CLI. Just drop the folder and go. So Kiln became a plugin. The framework got even smaller. The pipeline got bigger — 7 steps now, with dedicated research and onboarding stages. 24 agents instead of 10. And the whole thing installs in one command.

Less scaffolding. More trust. The models keep getting better.

---

## How It Works

Two steps are yours. The rest run on their own.

<table>
<tr>
<td align="center" width="40"><b>1</b></td>
<td width="140"><b>Onboarding</b></td>
<td>Alpha detects the project, sets up <code>.kiln/</code>, and maps the codebase if it's brownfield. Greenfield skips straight through.</td>
</tr>
<tr>
<td align="center"><b>2</b></td>
<td><b>Brainstorm</b></td>
<td>You and Da Vinci explore the problem. Goals, constraints, success criteria — nailed down before anything moves. Visionary watches and builds the architectural mental model.</td>
</tr>
<tr><td colspan="3"></td></tr>
<tr>
<td align="center"><b>3</b></td>
<td><b>Research</b></td>
<td>MI6 dispatches field agents to investigate open questions from the vision. If everything is already clear, this step takes seconds.</td>
</tr>
<tr>
<td align="center"><b>4</b></td>
<td><b>Architecture</b></td>
<td>Two models plan in parallel. Confucius (Claude) and Sun Tzu (GPT-5.4) each write independent plans. Socrates debates the disagreements. Plato merges them. Athena validates. You review and approve.</td>
</tr>
<tr>
<td align="center"><b>5</b></td>
<td><b>Build</b></td>
<td>KRS-One runs the build — Codex implements, Sphinx reviews, Architect and Sentinel keep watch. Each iteration gets a kill streak name. First blood, combo, super combo... up to ultra combo.</td>
</tr>
<tr>
<td align="center"><b>6</b></td>
<td><b>Validate</b></td>
<td>Argus runs end-to-end tests. Full report. If something fails, the pipeline re-enters Build for corrections only (max 3 cycles).</td>
</tr>
<tr>
<td align="center"><b>7</b></td>
<td><b>Report</b></td>
<td>Omega compiles the final project report. Everything built, tested, and committed. Done.</td>
</tr>
</table>

> [!TIP]
> All state lives in `.kiln/` under the project directory. Resume anytime with `/kiln-fire`.

---

## Get Started

```bash
git clone https://github.com/Fredasterehub/kiln.git
```

Then point Claude Code at it:

```bash
claude --plugin-dir /path/to/kiln
```

Or copy it into your Claude Code plugins directory:

```bash
cp -r kiln ~/.claude/plugins/kiln
```

Then in Claude Code:

```
/kiln-fire
```

<details>
<summary><b>Prerequisites</b></summary>

<br>

| Tool | Install | Required? |
|------|---------|-----------|
| [Claude Code](https://claude.ai/claude-code) | `npm i -g @anthropic-ai/claude-code` | Yes |
| [Codex CLI](https://github.com/openai/codex) | `npm i -g @openai/codex` | Yes |
| Node.js 18+ | [nodejs.org](https://nodejs.org) | Yes |
| OpenAI API key | With GPT-5.4 model access | Yes |

Run Claude Code with `--dangerously-skip-permissions` — Kiln spawns agents, writes files, and runs tests constantly. Permission prompts break the flow.

```bash
claude --dangerously-skip-permissions --plugin-dir /path/to/kiln
```

> [!CAUTION]
> Only use this in projects you trust.

<br>
</details>

<details>
<summary><b>Verify installation</b></summary>

<br>

In Claude Code:

```
/kiln-doctor
```

Checks Claude Code version, Codex CLI, GPT-5.4 access, and directory permissions.

<br>
</details>

---

## The Crew

Every agent has a name. Not for decoration — for the logs.

| Alias | Agent | Model | Job |
|---|---|---|---|
| **Alpha** | alpha | Opus | Onboarding — detects project, sets up .kiln/, maps brownfield |
| **Da Vinci** | da-vinci | Opus | Brainstorm — interviews the operator, crystallizes the vision |
| **Visionary** | visionary | Opus | Watches brainstorm, builds the architectural mental model |
| **Sentinel** | sentinel | Opus | Guards design integrity across the whole pipeline |
| **MI6** | mi6 | Opus | Research coordinator — dispatches field agents for open questions |
| **Mnemosyne** | mnemosyne | Opus | Brownfield codebase mapper (spawns 5 scouts internally) |
| **Aristotle** | aristotle | Opus | Architecture coordinator — orchestrates the planning debate |
| **Confucius** | confucius | Opus | Plans from the Claude side — architecture, edge cases, big picture |
| **Sun Tzu** | sun-tzu | Sonnet | Plans from the GPT side — catches what Opus misses |
| **Socrates** | socrates | Opus | Makes the two plans argue until they agree |
| **Plato** | plato | Sonnet | Merges plans into one coherent master plan |
| **Athena** | athena | Opus | Validates the final plan — up to 3 rounds |
| **KRS-One** | krs-one | Opus | Build coordinator — runs iterations with kill streak names |
| **Codex** | codex | Sonnet | Writes the actual code, task by task |
| **Sphinx** | sphinx | Sonnet | Reviews everything — correctness, security, completeness |
| **Argus** | argus | Opus | E2E validation — runs tests, writes the report |
| **Omega** | omega | Opus | Compiles the final delivery report |

<details>
<summary><b>Supporting cast</b></summary>

<br>

| Alias | Agent | Model | Job |
|---|---|---|---|
| **Architect** | architect | Opus | Persistent mind — design integrity across stages |
| **Field Agent** | field-agent | Sonnet | Research instance — spawned by MI6 as needed |
| **Atlas** | atlas | Sonnet | Codebase scout — maps structure for Mnemosyne |
| **Nexus** | nexus | Sonnet | Dependency scout — maps connections for Mnemosyne |
| **Spine** | spine | Sonnet | Architecture scout — maps patterns for Mnemosyne |
| **Signal** | signal | Sonnet | Quality scout — maps concerns for Mnemosyne |
| **Bedrock** | bedrock | Sonnet | Infrastructure scout — maps config for Mnemosyne |

<br>
</details>

> Confucius and Sun Tzu plan the same thing independently. Socrates makes them debate it. Plato synthesizes. Athena validates. KRS-One builds it with Codex. Sphinx guards the gate. Argus watches everything at the end. And if the build goes long, the kill streak names keep climbing.

---

## Commands

Two commands. That's the whole interface.

<table>
<tr>
<td width="50%">

```
/kiln-fire
```
Launch the pipeline. Auto-detects project state and resumes where it left off.

</td>
<td width="50%">

```
/kiln-doctor
```
Pre-flight check — verifies everything Kiln needs is in place.

</td>
</tr>
</table>

---

<details>
<summary><b>Plugin structure</b></summary>

<br>

```
kiln/
├── .claude-plugin/
│   └── plugin.json            Plugin manifest
├── agents/                    24 agent definitions
│   ├── alpha.md               Onboarding
│   ├── da-vinci.md            Brainstorm
│   ├── mi6.md                 Research coordinator
│   ├── aristotle.md           Architecture coordinator
│   ├── confucius.md           Claude planner
│   ├── sun-tzu.md             GPT planner
│   ├── socrates.md            Debater
│   ├── plato.md               Synthesizer
│   ├── athena.md              Plan validator
│   ├── krs-one.md             Build coordinator
│   ├── codex.md               Implementer
│   ├── sphinx.md              Reviewer
│   ├── argus.md               Validator
│   ├── omega.md               Reporter
│   └── ...                    + 10 supporting agents
├── commands/
│   ├── kiln-fire.md           Launch / resume
│   └── kiln-doctor.md         Pre-flight check
└── skills/
    └── kiln-pipeline/
        ├── SKILL.md            Pipeline state machine
        ├── data/               Brainstorming + elicitation data
        └── references/         Step definitions, blueprints, kill streaks
```

Drop it in. No npm. No installer. No build step. Just markdown.

<br>
</details>

<details>
<summary><b>Troubleshooting</b></summary>

<br>

**`codex: command not found`** — `npm install -g @openai/codex`, then verify with `codex --version`.

**Commands don't show in Claude Code** — Make sure you're using `--plugin-dir` pointing to the kiln directory, or that it's copied to `~/.claude/plugins/kiln/`. Restart Claude Code.

**`model_reasoning_effort` flag rejected** — Older Codex CLI. Upgrade: `npm install -g @openai/codex`.

**Pipeline halts with "escalate to operator"** — A phase failed 3 QA rounds. Check the build artifacts in `.kiln/`, fix manually, then `/kiln-fire` to resume.

<br>
</details>

<details>
<summary><b>Evolution — v1 → v2 → plugin</b></summary>

<br>

| | v1 (kiln) | v2 (kilntwo) | Plugin (kiln) |
|---|---|---|---|
| Agents | 13 | 10 | 24 |
| Pipeline stages | 5 | 5 | 7 |
| Skills | 26 | 0 (protocol block) | 1 (composable) |
| Commands | 8 | 3 | 2 |
| Install method | Custom installer | npm package + CLI | `--plugin-dir` |
| Dependencies | Zero | Zero | Zero |
| Config surface | ~4,000 lines | ~1,200 lines | ~600 lines |
| Build naming | Phase numbers | Phase numbers | Kill streaks |

Same core idea. Same multi-model debate. Same QA gates. Now it's a folder.

<br>
</details>

---

<div align="center">

<sub>MIT License · Zero dependencies · Built with Claude Code + Codex CLI</sub>

<sub>*Less framework. More trust. The models are ready.*</sub>

</div>
