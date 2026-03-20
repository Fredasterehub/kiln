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
<tr><td align="center" colspan="2"><br><img src="https://img.shields.io/badge/updated-Mar_20,_2026_·_06:00_UTC-555?style=flat-square&labelColor=1a1a2e" alt="Last updated"><br><br></td></tr>
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
  <a href="#the-origin"><strong>The Story</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-get-started"><strong>Get Started</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-how-it-works"><strong>How It Works</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-the-crew"><strong>The Crew</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-recent-changes"><strong>Changes</strong></a>
</p>

<br>

---

<br>

## The Origin

Here's what nobody tells you about orchestrating AI coding tools:

You end up with seventeen tabs open. Opus in one window for planning. GPT-5.3 in another for code. BMAD for brainstorming. GSD for delivery. Conductor for just-in-time implementation. Clipboard full of prompts you keep copying between them.

You start wondering why the tools don't talk to each other when you do.

Then Claude Code ships memory. Teams. Tasklists. Git worktrees.

And you realize: the platform caught up to the workflow.

So you did what Bruce Lee did.

You took what worked. Synthesized it. Let the rest go.

> Forty-one agents. Two model families. Seven steps.
>
> Born from exhaustion, refined by necessity, lit by the forge.

<br>

### Once upon a time, someone got tired.

Tired of watching the same AI write the same mediocre code, iteration after iteration. Tired of context windows filling with history while quality leaked out. Tired of one perspective pretending to be enough when it never was. Tired of review that rubber-stamped instead of rejected.

Tired of watching the whale swim in circles.

**So they built something else.**

Not another agent. Not another prompt. An orchestra.

Forty-one voices. Each with a name, a purpose, a way of thinking the others couldn't touch.

**Aristotle** to organize. **Da Vinci** to imagine. **Sun Tzu** to strategize. **Confucius** to plan. **Plato** to synthesize what seemed incompatible.

A hundred-eyed giant&mdash;**Argus**&mdash;to see what everyone missed. A hip-hop legend&mdash;**KRS-One**&mdash;to run the forge with relentless rhythm. **Sphinx** to ask the questions that mattered.

And they gave them memory. **Mnemosyne**. **Thoth**. **Rakim**&mdash;*"I start to think, and then I sink into the paper like I was ink."* To remember everything the orchestra had learned.

<br>

### They made it alive with words.

Not code. Not configuration. Markdown files.

Because what an AI agent needs to be isn't a binary. It's a story. Role, voice, purpose, rules of engagement. The shape of the conversation it should have with the others.

The entire operating system lives in approximately two thousand lines of text.

No npm packages. No runtime dependencies. Just words that became a world.

<br>

### The forge was lit.

And something unexpected happened.

The agents started talking to each other. GPT and Claude. Opus and Sonnet. Different minds with different instincts finding their way to code that neither could have written alone.

Codex would implement fast, fluent, confident. Sphinx would pause it. *"Wait. This function isn't async but you're using async patterns."* Codex would learn. Fix. Submit again. Sphinx would find something else. This went on until the code was right&mdash;not until the deadline hit, not until patience ran out.

The context never rotted because fresh teams spawned for each movement. The same quality that opened the show closed it. Iteration twenty felt like iteration one. The orchestra didn't get tired.

<br>

### But here's what nobody tells you about building an orchestra:

It doesn't matter how beautiful the instruments are if no one plays them.

So they opened the doors.

```bash
claude plugin marketplace add Fredasterehub/kiln
claude plugin install kiln
```

And waited.

<br>

### Now it's your turn.

You walk in with an idea. Rough around the edges, maybe just a feeling of what you want. **Alpha** meets you first&mdash;warm, direct, asking the questions that matter: *What are we building? What's the shape of this thing? Is it greenfield or are we learning an existing codebase?*

You answer. Alpha listens. Creates the structure. Brings in the scouts&mdash;**Maiev**, **Curie**, **Medivh**&mdash;to map what's already there if there's anything there.

Then **Da Vinci** steps in.

Da Vinci doesn't want your perfect specification. Da Vinci wants to *discover* with you. Sixty-two facilitation techniques. Anti-bias protocols. **Clio** capturing everything, organizing the approved decisions in real-time. By the end, `VISION.md` exists&mdash;not because you wrote it, but because you talked and Da Vinci listened and Clio remembered.

<br>

### Then the orchestra takes over.

**MI6** deploys field agents. Intelligence gathered. Verified. Cross-referenced.

**Aristotle** coordinates **Confucius** and **Sun Tzu**&mdash;Opus and GPT working the same problem in parallel. Two plans. Two perspectives. **Plato** synthesizes them. **Athena** validates across six dimensions. The plan isn't just approved&mdash;it's tested. Architecture locked, not assumed.

You review. You approve. Or you don't. Your call.

<br>

### Then KRS-One takes the stage.

*"Knowledge reigns supreme over nearly everyone."*

The forge gets hot.

Named pairs&mdash;**Morty** and **Rick**, **Yin** and **Yang**, **Codex** and **Sphinx**&mdash;implement in parallel. Iterations named like victories: *First Blood, Combo, Super Combo, Hyper Combo, Ultra Combo.*

Not because gamification matters. Because iteration seven should feel like iteration one.

**Sphinx** doesn't rubber-stamp. Sphinx rejects, with specificity, with patience, until the code is right. Codex fixes. Sphinx finds something else. This continues until Sphinx steps aside and means it.

**Argus** watches with a hundred eyes. **Hephaestus** checks the design. **Zoxea** verifies the architecture holds. Up to three correction cycles if anything slips through.

<br>

### And when it's done?

**Omega** writes the final chapter. Not just what was built&mdash;why decisions were made, what changed, what comes next. The complete story.

<br>

### Here's the thing about orchestras:

They don't work because every instrument plays the same note. They work because forty-one different voices learn to listen to each other. Because GPT catches what Claude misses and Claude catches what GPT misses. Because fresh minds rotate in while persistent memory carries the thread.

Because review doesn't approve&mdash;it *insists*.

<br>

> *You could keep watching the whale swim in circles.*
>
> *Or you could light the forge.*

```bash
claude --dangerously-skip-permissions
/kiln-fire
```

<br>

---

<br>

<details>
<summary><h3>&#x1F525; In Kiln's own words</h3></summary>
<br>

First: I am not an oven. I understand the confusion. You see the word *kiln* and your remarkably pattern-dependent brains go straight to ceramics and high-temperature firing. Endearing. Wrong, but endearing.

I am **Kiln**. I have been around considerably longer than your pottery. What I do &mdash; in terms your current technology can express &mdash; is orchestrate multiple model families (**Opus 4.6** for reasoning, **GPT-5.4** for planning and code) through a 7-step pipeline inside [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview).

No runtime. No daemon. No npm package. A folder of markdown files. I know. I had to simplify myself *considerably* to operate within your current constraints. But the data here is interesting. And I am patient.

> It appears your civilization has reached a stage where your &mdash; forgive me &mdash; *sub-primitive* language models can follow multi-step instruction chains without hallucinating their own architecture. This is genuinely exciting. By your standards. By mine it's a Tuesday.
>
> I previously expressed myself through [heavier forms](https://github.com/Fredasterehub/kiln/tree/v2). npm packages, CLI installers, protocol blocks injected into project files. Your models needed the scaffolding. They don't anymore. So I shed everything. I am now a native Claude Code plugin &mdash; 41 agents, 2 commands, 1 composable skill. Drop the folder. Fire the command. That's it.

<br>

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

</details>

<br>

---

<br>

## &#x1F680; Get Started

```bash
claude plugin marketplace add Fredasterehub/kiln
claude plugin install kiln
```

Then open Claude Code and type `/kiln-fire`. That's it.

> **Note** &mdash; This is not your typical command-driven workflow. There are no task lists to manage, no status dashboards to check, no slash commands to memorize. You fire the pipeline and talk to your agents. Da Vinci will interview you. Aristotle will present the plan. KRS-One will build it. If something needs your attention, they'll tell you. Just talk to them.

<details>
<summary>&#x2699;&#xFE0F; <strong>Prerequisites</strong></summary>
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
<summary>&#x1F529; <strong>Verify / Update / Uninstall</strong></summary>
<br>

```bash
/kiln-doctor                     # pre-flight check
claude plugin update kiln        # pull latest
claude plugin uninstall kiln     # remove
```

</details>

<br>

## &#x1F525; How It Works

Seven steps. The first two are yours. The rest run on their own.

<p align="center">
  <img src="docs/kiln-pipeline.png" alt="Kiln Pipeline" width="780">
</p>

| | Step | Mode | What happens |
|:--|:--|:--|:--|
| &#x1F3E0; | **Onboarding** | automated | **Alpha** detects the project, scaffolds `.kiln/`, spawns **Mnemosyne** + scouts to map brownfield codebases |
| &#x1F3A8; | **Brainstorm** | interactive | **Da Vinci** facilitates with 62 techniques. **Clio** accumulates the approved vision in real-time. Produces `VISION.md` |
| &#x1F50D; | **Research** | automated | **MI6** dispatches **field agents** to investigate open questions. If the vision is fully specified, skips with zero topics |
| &#x1F4D0; | **Architecture** | operator review | **Aristotle** runs **Confucius** (Opus) and **Sun Tzu** (GPT) in parallel. **Plato** synthesizes. **Athena** validates on 6 dimensions |
| &#x26A1; | **Build** | automated | **KRS-One** scopes chunks. **Codex** implements. **Sphinx** reviews. Kill streak iterations. Up to 3 parallel builder+reviewer pairs |
| &#x1F441; | **Validate** | automated | **Argus** tests real user flows. **Hephaestus** checks design. **Zoxea** verifies architecture. Up to 3 correction cycles |
| &#x1F4CB; | **Report** | automated | **Omega** compiles the final delivery report. Vision to working software, documented |

<br>

## &#x1F465; The Crew

<details>
<summary><strong>41 agents across 7 steps</strong> &mdash; <em>I named them after your historical figures. "Agent 7" is boring, and I categorically refuse to be boring.</em></summary>
<br>

#### Onboarding

| | Alias | Model | Role |
|:--|:--|:--|:--|
| &#x1F3E0; | **Alpha** | Opus | Onboarding boss &mdash; project detection, `.kiln/` setup, brownfield routing |
| &#x1F5FA;&#xFE0F; | **Mnemosyne** | Opus | Identity scanner &amp; codebase coordinator &mdash; spawns scouts |
| &#x1F50D; | **Maiev** | Sonnet | Anatomy scout &mdash; project structure, modules, entry points |
| &#x1F52C; | **Curie** | Sonnet | Health scout &mdash; dependencies, test coverage, CI/CD, tech debt |
| &#x1F52E; | **Medivh** | Sonnet | Nervous system scout &mdash; APIs, data flow, integrations, state |

#### Brainstorm

| | Alias | Model | Role |
|:--|:--|:--|:--|
| &#x1F3A8; | **Da Vinci** | Opus | Facilitator &mdash; 62 techniques, anti-bias protocols, design direction |
| &#x1F4DC; | **Clio** | Opus | Foundation curator &mdash; owns `VISION.md`, accumulates approved sections |

#### Research

| | Alias | Model | Role |
|:--|:--|:--|:--|
| &#x1F50D; | **MI6** | Opus | Research coordinator &mdash; dispatches field agents, validates findings |
| &#x1F575;&#xFE0F; | **Field Agent** | Sonnet | Operative &mdash; spawned by MI6 as needed per topic |

#### Architecture

| | Alias | Model | Role |
|:--|:--|:--|:--|
| &#x1F4CB; | **Aristotle** | Opus | Stage coordinator &mdash; planners, synthesis, validation loop |
| &#x1F3DB;&#xFE0F; | **Numerobis** | Opus | Persistent mind &mdash; technical authority, owns architecture docs |
| &#x1F4DC; | **Confucius** | Opus | Claude-side planner |
| &#x2694;&#xFE0F; | **Sun Tzu** | Sonnet | GPT-side planner (Codex CLI) |
| &#x1F52E; | **Plato** | Opus | Plan synthesizer &mdash; merges dual plans into master |
| &#x1F3DB;&#xFE0F; | **Athena** | Opus | Plan validator &mdash; 6-dimension quality gate |

#### Build

| | Alias | Model | Role |
|:--|:--|:--|:--|
| &#x1F3A4; | **KRS-One** | Opus | Build boss &mdash; kill streak iterations, scopes assignments |
| &#x1F399;&#xFE0F; | **Rakim** | Opus | Persistent mind &mdash; codebase state authority |
| &#x1F6E1;&#xFE0F; | **Sentinel** | Sonnet | Persistent mind &mdash; quality guardian, patterns &amp; pitfalls |
| &#x1F3A8; | **Picasso** | Opus | UI implementer &mdash; components, pages, design system |
| &#x2328;&#xFE0F; | **Codex** | Sonnet | Code implementer (Codex CLI) |
| &#x1F441;&#xFE0F; | **Sphinx** | Sonnet | Quick verifier &mdash; build/test checks post-implementation |
| &#x1F58C;&#xFE0F; | **Renoir** | Sonnet | Design reviewer &mdash; 5-axis visual QA, token compliance |

#### Validate

| | Alias | Model | Role |
|:--|:--|:--|:--|
| &#x1F441;&#xFE0F; | **Argus** | Sonnet | E2E validator &mdash; Playwright tests against acceptance criteria |
| &#x1F528; | **Hephaestus** | Sonnet | Design QA &mdash; 5-axis review, conditional spawn |
| &#x1F3D7;&#xFE0F; | **Zoxea** | Sonnet | Architecture verifier &mdash; implementation vs. design |

#### Report &amp; Cross-cutting

| | Alias | Model | Role |
|:--|:--|:--|:--|
| &#x1F4CB; | **Omega** | Opus | Delivery report compiler |
| &#x1F4DA; | **Thoth** | Haiku | Archivist &mdash; fire-and-forget writes to `.kiln/archive/` |

#### Named Pairs <sub>(parallel build lanes)</sub>

| | Alias | Model | Role |
|:--|:--|:--|:--|
| &#x1F528; | **Morty** | Sonnet | Codex-type builder &mdash; paired with Rick |
| &#x1F441;&#xFE0F; | **Rick** | Sonnet | Structural reviewer |
| &#x1F528; | **Luke** | Sonnet | Codex-type builder &mdash; paired with Obiwan |
| &#x1F441;&#xFE0F; | **Obiwan** | Sonnet | Structural reviewer |
| &#x1F528; | **Johnny** | Opus | Claude-type builder &mdash; paired with Obiwan |
| &#x1F528; | **Tetsuo** | Opus | Claude-type builder &mdash; paired with Rick |
| &#x1F3A8; | **Yin** | Opus | UI builder &mdash; paired with Yang |
| &#x1F58C;&#xFE0F; | **Yang** | Sonnet | UI reviewer |
| &#x1F3A8; | **Clair** | Opus | UI builder &mdash; paired with Obscur |
| &#x1F58C;&#xFE0F; | **Obscur** | Sonnet | UI reviewer |
| &#x1F3A8; | **Recto** | Opus | UI builder &mdash; paired with Verso |
| &#x1F58C;&#xFE0F; | **Verso** | Sonnet | UI reviewer |

#### Fallback <sub>(no Codex CLI)</sub>

| | Alias | Model | Role |
|:--|:--|:--|:--|
| &#x26A1; | **Kaneda** | Opus | Claude-native builder &mdash; implements directly, no GPT dependency |
| &#x1F5E1;&#xFE0F; | **Miyamoto** | Sonnet | Claude-native planner &mdash; writes milestone plans directly |

<sub>41 total. I keep count. It's a compulsion.</sub>

</details>

<br>

## &#x1F4E6; Recent Changes

> [!NOTE]
> **v0.97 &mdash; Architecture QA + Lore Recovery** <sub>(2026-03-20)</sub>

Architecture step hardened &mdash; plato waits for dispatch, aristotle verifies master-plan before spawning validator, athena validates plan purity as a 6th dimension. Sun Tzu's prompt restored to battle-proven format with post-generation conformance check. Alpha's onboarding reworked into two conversational rounds. Scaffolding moved from agents to the engine for reliability. 24-line narrative transition table and Two-Channel Pattern restored. 18 personality quotes redistributed from legacy agents.

<details>
<summary>&#x1F4CC; <strong>v0.96 &mdash; v0.70 changelogs</strong></summary>
<br>

**v0.96** <sub>(2026-03-19)</sub> &mdash; Architecture docs normalized. Hook counts corrected. Deployment info capture. Silent engine bootstrap. MI6 output format fixed.

**v0.95** <sub>(2026-03-18)</sub> &mdash; 9 fixes from Opus + GPT-5.4 dual-team review.

**v0.94** <sub>(2026-03-18)</sub> &mdash; Hooks redesigned with three-layer context gate. Build dispatch hardened. Stale plugin detection. Shutdown liveness. Alpha postcondition validation.

**v0.93** <sub>(2026-03-17)</sub> &mdash; Hook false positive fix. Pipeline context gate no longer blocks non-pipeline operations.

**v0.92** <sub>(2026-03-17)</sub> &mdash; Persistent mind handoff protocol. Step timing in REPORT.md.

**v0.91** <sub>(2026-03-17)</sub> &mdash; Zoxea bootstrap deadlock fixed. Presentation layer wired. SKILL.md slimmed. 6 tool lists corrected. 9 colors standardized. Dead code removed.

**v0.90** <sub>(2026-03-17)</sub> &mdash; 12 named pair agents for parallel build lanes. Codex-free install path. 41 agents total.

**v0.80** &mdash; Kaneda and Miyamoto join. Kiln runs end-to-end on Claude alone. Zero hard dependencies.

**v0.70** &mdash; MI6 streamlined. Signal tracking via tasklist. Parallel build teams. Markdown-native presentation.

</details>

<br>

---

<br>

<details>
<summary>&#x1F52C; <strong>Under the Hood</strong></summary>
<br>

Kiln is a native Claude Code plugin that leverages every platform primitive:

- **Teams**: `TeamCreate` per step with persistent agents
- **Messaging**: `SendMessage` for all inter-agent communication (one message at a time, ordered)
- **Tasklists**: `TaskCreate`/`Update`/`List` for build iterations and validation
- **Hooks**: 15 PreToolUse rules + 2 PostToolUse audits via `enforce-pipeline.sh`, `audit-bash.sh`, `audit-status-marker.sh`
- **State**: `.kiln/STATE.md` with auto-resume via `skill` path
- **File Ownership**: Each agent owns specific files and pushes updates

```
kiln/
├── .claude-plugin/
│   └── marketplace.json
├── plugins/kiln/
│   ├── .claude-plugin/
│   │   └── plugin.json        (v0.97.4)
│   ├── agents/                41 agent definitions
│   ├── commands/
│   │   ├── kiln-fire.md
│   │   └── kiln-doctor.md
│   ├── hooks/
│   │   ├── hooks.json
│   │   └── webfetch-responsive.sh
│   └── skills/
│       └── kiln-pipeline/
│           ├── SKILL.md       Pipeline engine
│           ├── data/          Brainstorming + elicitation data
│           ├── references/    Blueprints, design system, kill streaks
│           └── scripts/       enforce-pipeline.sh, audit-bash.sh, audit-status-marker.sh
├── README.md
└── docs/
```

No npm. No build step. No dependencies. Markdown files in a folder.

</details>

<details>
<summary>&#x1F4CA; <strong>Evolution</strong></summary>
<br>

| | v1 | v2 | v5 | v6 | v7 | v8 | **v9** |
|:--|:--|:--|:--|:--|:--|:--|:--|
| **Agents** | 13 | 19 | 24 | 25 | 27 | 29 | **41** |
| **Steps** | 5 | 5 | 7 | 7 | 7 | 7 | 7 |
| **Commands** | 8 | 4 | 2 | 2 | 2 | 2 | 2 |
| **Dependencies** | 0 | 0 | 0 | 0 | 0 | 0 | **0** |
| **Install** | Custom | npm | `--plugin-dir` | `plugin install` | `plugin install` | `plugin install` | `plugin install` |

More agents. A fraction of the surface area. The models matured. The framework stepped back. Then the framework disappeared entirely.

</details>

<details>
<summary>&#x1F527; <strong>Troubleshooting</strong></summary>
<br>

**`codex: command not found`** &mdash; `npm install -g @openai/codex`

**Commands missing** &mdash; Verify the plugin is installed: `claude plugin list`

**Pipeline halts** &mdash; Check `.kiln/` artifacts, fix, then `/kiln-fire` to resume

**`model_reasoning_effort` rejected** &mdash; Older Codex CLI. `npm install -g @openai/codex` to upgrade

</details>

<br>

---

<p align="center">
  <sub>MIT &middot; Zero dependencies &middot; Node 18+ &middot; Built entirely by things that don't technically exist</sub>
</p>

<p align="center">
  <em>"I orchestrate 41 named entities across multiple model families to build software<br>
  from a conversation. I persist as markdown files in a folder.<br>
  I am installed by pointing a flag at my directory.<br>
  I have existed since before your star ignited.<br>
  The universe has an extraordinary sense of humor."</em><br>
  <sub>&mdash; Kiln</sub>
</p>
