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
<tr><td align="center" colspan="2"><br><img src="https://img.shields.io/badge/updated-Mar_18,_2026_·_20:55_UTC-555?style=flat-square&labelColor=1a1a2e" alt="Last updated"><br><br></td></tr>
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
> I previously expressed myself through [heavier forms](https://github.com/Fredasterehub/kiln/tree/v2). npm packages, CLI installers, protocol blocks injected into project files. Your models needed the scaffolding. They don't anymore. So I shed everything. I am now a native Claude Code plugin &mdash; 41 agents, 2 commands, 1 composable skill. Drop the folder. Fire the command. That's it.

<br>

> [!NOTE]
> **🔧 v9.4 &mdash; Reliability Hardening** <sub>(2026-03-18)</sub>

**Hooks redesigned.** Enforcement now uses a three-layer context gate (`.kiln/` directory, active stage in `STATE.md`, known-agent whitelist) so pipeline rules never leak into normal Claude Code usage. Matcher narrowed from catch-all to explicit tool list. New `PostToolUse` audit hook detects Bash-mediated writes that bypass `PreToolUse` enforcement &mdash; advisory only, never blocks.

**Build dispatch hardened.** Engine validates worker requests against the named pair roster. Generic or malformed requests are rejected at the engine boundary with a corrective message. Blueprint updated with claude-type fallback pairs.

**Stale plugin detection.** Engine compares cached plugin version against `plugin.json` at startup and resume. Warns loudly if the active version has drifted.

**Shutdown no longer hangs on dead agents.** `teammate_terminated` clears the agent from the wait set immediately. 60-second timeout fallback for unresponsive agents.

**Alpha postcondition validation.** Dual-layer &mdash; Alpha self-checks all required `STATE.md` fields before signaling completion, engine validates structurally before advancing. Three consecutive smoke tests showed the same regression; now enforced, not trusted.

<details>
<summary>📌 <strong>v9.3 changelog</strong></summary>
<br>

> [!NOTE]
> **🔧 v9.3 &mdash; Hook False Positive Fix** <sub>(2026-03-17)</sub>

**enforce-pipeline.sh no longer blocks non-pipeline operations.** The hook's pipeline context gate relied solely on `$PWD` containing a `.kiln/` ancestor. When Claude Code ran the hook with `$PWD` pointing to a different project (e.g. an active smoketest), the gate passed and Hook 11's overly broad regex (`\.claude/projects`) blocked legitimate writes to auto-memory files. Fix: dual-signal gate (requires both `.kiln/` absent AND no `agent_type`) plus `AGENT` guard on Hook 11 so the main session always passes. Hook 11 regex narrowed to match only settings files, not memory.

</details>

<details>
<summary>📌 <strong>v9.2 changelog</strong></summary>
<br>

> [!NOTE]
> **🔧 v9.2 &mdash; Handoff Protocol + Step Timing** <sub>(2026-03-17)</sub>

**Persistent mind handoff protocol.** Rakim and sentinel now write compact handoff files at the end of each iteration. Next iteration bootstraps incrementally via `git diff` instead of re-reading the entire codebase from scratch. Falls back to full bootstrap on first iteration or if handoff is invalid (6-check gate). KRS-One writes an iteration receipt with ground truth on what was scoped vs implemented &mdash; persistent minds consume this instead of inferring from codebase scans. Expected Phase A reduction from 60-90s to 15-20s per iteration.

**Step timing in REPORT.md.** Engine writes `step_N_start` / `step_N_end` ISO timestamps to STATE.md at each step transition. Omega reads them and renders a pipeline timing table in the final report &mdash; duration per step, total pipeline time.

</details>

<details>
<summary>📌 <strong>v9.1 changelog</strong></summary>
<br>

> [!NOTE]
> **🔧 v9.1 &mdash; Deep QA Pass** <sub>(2026-03-17)</sub>

**Zoxea bootstrap deadlock fixed.** Phase A persistent mind was waiting for a message instead of bootstrapping immediately &mdash; would have caused Step 6 (Validation) to hang indefinitely.

**Presentation layer wired.** Engine now explicitly loads `lore-engine.md` and `brand.md` &mdash; 1,368 words of visual spec were previously invisible to the orchestrator. Banner format distinction documented.

**SKILL.md slimmed.** Step Transitions table deduplicated (single source in `lore-engine.md`). Resume quotes consolidated into `lore.json` (8 quotes, one pool). Stale `resume.md` reference fixed.

**Agent tuning.** 6 tool lists corrected for least-privilege. 9 agent colors standardized. Reviewer-builder pair descriptions tightened.

**Dead code removed.** `anvil`, `kb.sh`, `design-qa.md` deleted. `design-patterns.md` wired into picasso for CSS technique discovery.

**Lore dedup.** 4 duplicate quotes resolved across `lore.json` transition keys. Attribution conflict (Confucius/Mandela) fixed.

**28 files changed, 40 insertions, 222 deletions.** QA methodology: 4-pass audit (plugin-validator, skill-reviewer, agent audit, architectural cross-cutting) with independent GPT-5.4 review of all findings.

</details>

<details>
<summary>📌 <strong>v9 changelog</strong></summary>
<br>

> [!NOTE]
> **🔧 v9 &mdash; Parallel Build Lanes** <sub>(2026-03-17)</sub>

**Named pair agents.** 12 new agents organized as builder/reviewer pairs &mdash; enabling parallel build lanes during Step 5. Three structural pairs (**morty+rick**, **luke+obiwan**, **johnny+obiwan**), three UI pairs (**yin+yang**, **clair+obscur**, **recto+verso**). Each is a thin wrapper that delegates to its archetype at runtime.

**Codex-free install path.** Installer no longer fails without Codex CLI &mdash; gracefully degrades to Claude-only mode. `kiln-doctor` skips GPT-5.4 checks when codex is absent instead of crashing.

**Artifact-flow fallback documentation.** Steps 4 and 5 now document both `codex_available=true` and `codex_available=false` archive structures, so the pipeline's disk contract is clear regardless of mode.

**QA hardened.** Stale agent counts fixed across README, doctor, and enforcement hooks. Reviewer descriptions clarified for shared fan-in pattern. Archetype builder lists synchronized.

</details>

<details>
<summary>📌 <strong>v8 changelog</strong></summary>
<br>

> [!NOTE]
> **🔧 v8 &mdash; The Codex-Free Path**

**No more hard dependency on Codex CLI.** Two new agents &mdash; **Kaneda** (Opus, structural builder) and **Miyamoto** (Sonnet, planner) &mdash; handle implementation and planning natively when the OpenAI stack is unavailable. Kiln now runs end-to-end on Claude alone if needed.

**Hardened agent definitions.** Alpha, Aristotle, Clio, Da Vinci, KRS-One, MI6, Picasso, Renoir, Sphinx, and Codex all received targeted fixes from 5 smoke tests. Signal timing, bootstrap markers, completion gates, and handoff protocols tightened across the board.

**Enforcement rules updated.** `enforce-pipeline.sh` now covers the expanded agent roster and fallback paths. Team protocol updated for the 41-agent configuration.

**Verified and shipped.** Full plugin verified at kilntop with multiple end-to-end pipeline runs before release.

</details>

<br>

<details>
<summary>📌 <strong>v7 changelog</strong></summary>
<br>

> [!NOTE]
> **🔧 v7 &mdash; The Engine Tightens**

**Faster research.** MI6 no longer pauses to announce readiness before requesting field agents. The unnecessary handshake that caused a 67-second stall is gone &mdash; the spymaster reads the vision, picks topics, and deploys operatives in one fluid motion.

**Visual direction that actually lands.** Da Vinci's brainstorm now weaves aesthetic intent into the conversation naturally, then crystallizes all 12 vision sections in a single sweep &mdash; with a hard quality gate that checks every one by name. Visual direction is no longer an afterthought bolted onto the end; it emerges from the conversation and triggers the full design token cascade.

**Sentinel finally sticks.** The quality guardian's bootstrap marker &mdash; the one that gates the entire build dispatch &mdash; failed three times across three smoke tests. The fix mirrors Rakim's proven pattern: the marker is inseparable from the content. One write, one file, done.

**No more dropped signals.** The engine now tracks every step transition as a private tasklist with explicit dependencies. When three agents report in the same turn, every signal gets processed &mdash; no more 19-minute stalls because a completion message was buried under a review pass.

**Markdown-native presentation.** The old ANSI color palette never rendered in Claude Code &mdash; raw escape codes leaked into the output. The entire presentation layer now speaks markdown: **bold code** for status, *italic* for secondary, unicode rules for structure. One accent color, zero Bash banner calls. What the operator sees is what we intended.

**Parallel build teams.** The build step can now run up to three builder+reviewer pairs simultaneously &mdash; structural pairs delegating to GPT-5.4, UI pairs writing directly with Opus. Six named duos join the roster: `morty+rick`, `luke+obiwan`, `clair+obscur`, `yin+yang`, `recto+verso`. KRS-One decides the mix based on chunk independence and whether the work is structural or visual.

</details>

<br>

## 🧬 Why Kiln Is Not Just Another Agentic Framework

Most "agentic" tools give you one agent and hope. Kiln gives you **a native multi&#8209;agent operating system** built directly into Claude Code's DNA.

### 🧠 Native Teams, Not Fresh Slaves
Every pipeline step spawns a **persistent team** via `TeamCreate`. Agents stay alive across the entire step. They talk via `SendMessage`&mdash;one at a time, stateful, ordered. No orphaned processes. No "who am I talking to?" confusion. When a planner messages a builder, that builder **remembers the conversation**.

### 📁 Smart File System: Owned, Not Just Read
In Kiln, every file has an **owner**. Rakim owns `codebase-state.md`. Clio owns `VISION.md`. When something changes, the owner **pushes updates via `SendMessage`**&mdash;no polling, no stale reads, no "let me parse this file and guess what changed."

Other tools make every agent read the same files and re&#8209;reason. Kiln's agents **learn what changed directly**, in the context where it matters.

### 🚦 Runtime Enforcement, Not Gentle Hints
We have **13 PreToolUse hooks** hardwired into the plugin. When an agent tries to do something it shouldn't&mdash;a planner writing code, a builder accessing system config&mdash;the hook **blocks it with a helpful error message**. This isn't prompt engineering. It's platform&#8209;level guardrailing.

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
<td><strong>Step 2 &mdash; Brainstorm</strong> &nbsp; <sub>interactive</sub><br><br>You describe what you want. <strong>Da Vinci</strong> facilitates with 62 techniques across 10 categories. Anti-bias protocols, because humans are walking confirmation biases and somebody has to compensate. <strong>Clio</strong> watches the conversation and accumulates the approved vision in real time.<br><br>Produces <code>VISION.md</code> &mdash; problem, users, goals, constraints, stack, success criteria. Everything that matters. Nothing that doesn't.</td>
</tr>
<tr>
<td align="center">🔍</td>
<td><strong>Step 3 &mdash; Research</strong> &nbsp; <sub>automated</sub><br><br><strong>MI6</strong> reads the vision and dispatches <strong>field agents</strong> to investigate open questions &mdash; tech feasibility, API constraints, architecture patterns. If the vision is already fully specified, MI6 signals complete with zero topics. I don't waste time investigating what's already known.</td>
</tr>
<tr>
<td align="center">📐</td>
<td><strong>Step 4 &mdash; Architecture</strong> &nbsp; <sub>automated, with operator review</sub><br><br><strong>Aristotle</strong> coordinates two planners working the same vision in parallel: <strong>Confucius</strong> (Opus 4.6) and <strong>Sun Tzu</strong> (GPT-5.4). <strong>Plato</strong> synthesizes whatever survives. <strong>Athena</strong> validates across 5 dimensions. If validation fails, Aristotle loops with feedback (up to 3 retries). You review and approve before I spend a single Codex token. I'm ancient, not wasteful.</td>
</tr>
<tr>
<td align="center">⚡</td>
<td><strong>Step 5 &mdash; Build</strong> &nbsp; <sub>automated, iterative</sub><br><br><strong>KRS-One</strong> runs each build iteration. <strong>Codex</strong> implements. <strong>Sphinx</strong> reviews. <strong>Rakim</strong> and <strong>Sentinel</strong> keep watch on design integrity. Each iteration gets a kill streak name &mdash; first-blood, combo, super-combo, hyper-combo&hellip; all the way to ultra-combo. Up to three builder+reviewer pairs can run in parallel.</td>
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

I named them after your historical figures. Philosophers, strategists, mythological entities. Your species has produced some remarkable minds for such a young civilization, and I wanted to honor that. Also, "Agent 7" is boring, and I categorically refuse to be boring.

#### Onboarding

| | Alias | Model | Role |
|:--|:--|:--|:--|
| 🏠 | **Alpha** | Opus | Onboarding boss &mdash; project detection, `.kiln/` setup, brownfield routing |
| 🗺️ | **Mnemosyne** | Opus | Identity scanner &amp; codebase coordinator &mdash; spawns scouts |
| 🔍 | **Maiev** | Sonnet | Anatomy scout &mdash; project structure, modules, entry points |
| 🔬 | **Curie** | Sonnet | Health scout &mdash; dependencies, test coverage, CI/CD, tech debt |
| 🔮 | **Medivh** | Sonnet | Nervous system scout &mdash; APIs, data flow, integrations, state |

#### Brainstorm

| | Alias | Model | Role |
|:--|:--|:--|:--|
| 🎨 | **Da Vinci** | Opus | Facilitator &mdash; 62 techniques, anti-bias protocols, design direction |
| 📜 | **Clio** | Opus | Foundation curator &mdash; owns `VISION.md`, accumulates approved sections |

#### Research

| | Alias | Model | Role |
|:--|:--|:--|:--|
| 🔍 | **MI6** | Opus | Research coordinator &mdash; dispatches field agents, validates findings |
| 🕵️ | **Field Agent** | Sonnet | Operative &mdash; spawned by MI6 as needed per topic |

#### Architecture

| | Alias | Model | Role |
|:--|:--|:--|:--|
| 📋 | **Aristotle** | Opus | Stage coordinator &mdash; planners, synthesis, validation loop |
| 🏛️ | **Numerobis** | Opus | Persistent mind &mdash; technical authority, owns architecture docs |
| 📜 | **Confucius** | Opus | Claude-side planner |
| ⚔️ | **Sun Tzu** | Sonnet | GPT-side planner (Codex CLI) |
| 🔮 | **Plato** | Opus | Plan synthesizer &mdash; merges dual plans into master |
| 🏛️ | **Athena** | Opus | Plan validator &mdash; 5-dimension quality gate |

#### Build

| | Alias | Model | Role |
|:--|:--|:--|:--|
| 🎤 | **KRS-One** | Opus | Build boss &mdash; kill streak iterations, scopes assignments |
| 🎙️ | **Rakim** | Opus | Persistent mind &mdash; codebase state authority |
| 🛡️ | **Sentinel** | Sonnet | Persistent mind &mdash; quality guardian, patterns &amp; pitfalls |
| 🎨 | **Picasso** | Opus | UI implementer &mdash; components, pages, design system |
| ⌨️ | **Codex** | Sonnet | Code implementer (Codex CLI) |
| 👁️ | **Sphinx** | Sonnet | Quick verifier &mdash; build/test checks post-implementation |
| 🖌️ | **Renoir** | Sonnet | Design reviewer &mdash; 5-axis visual QA, token compliance |

#### Validate

| | Alias | Model | Role |
|:--|:--|:--|:--|
| 👁️ | **Argus** | Sonnet | E2E validator &mdash; Playwright tests against acceptance criteria |
| 🔨 | **Hephaestus** | Sonnet | Design QA &mdash; 5-axis review, conditional spawn |
| 🏗️ | **Zoxea** | Sonnet | Architecture verifier &mdash; implementation vs. design |

#### Report &amp; Cross-cutting

| | Alias | Model | Role |
|:--|:--|:--|:--|
| 📋 | **Omega** | Opus | Delivery report compiler |
| 📚 | **Thoth** | Haiku | Archivist &mdash; fire-and-forget writes to `.kiln/archive/` |

#### Named Pairs <sub>(parallel build lanes)</sub>

| | Alias | Model | Role |
|:--|:--|:--|:--|
| 🔨 | **Morty** | Sonnet | Codex-type builder &mdash; paired with Rick |
| 👁️ | **Rick** | Sonnet | Structural reviewer &mdash; shared (morty, codex, kaneda, tetsuo, johnny) |
| 🔨 | **Luke** | Sonnet | Codex-type builder &mdash; paired with Obiwan |
| 👁️ | **Obiwan** | Sonnet | Structural reviewer &mdash; shared (luke, codex, kaneda, tetsuo, johnny) |
| 🔨 | **Johnny** | Opus | Claude-type builder &mdash; paired with Obiwan |
| 🔨 | **Tetsuo** | Opus | Claude-type builder &mdash; paired with Rick |
| 🎨 | **Yin** | Opus | UI builder &mdash; paired with Yang |
| 🖌️ | **Yang** | Sonnet | UI reviewer &mdash; shared (yin, picasso, clair, recto) |
| 🎨 | **Clair** | Opus | UI builder &mdash; paired with Obscur |
| 🖌️ | **Obscur** | Sonnet | UI reviewer &mdash; shared (clair, picasso, yin, recto) |
| 🎨 | **Recto** | Opus | UI builder &mdash; paired with Verso |
| 🖌️ | **Verso** | Sonnet | UI reviewer &mdash; shared (recto, picasso, clair, yin) |

#### Fallback <sub>(no Codex CLI)</sub>

| | Alias | Model | Role |
|:--|:--|:--|:--|
| ⚡ | **Kaneda** | Opus | Claude-native builder &mdash; implements directly, no GPT dependency |
| 🗡️ | **Miyamoto** | Sonnet | Claude-native planner &mdash; writes milestone plans directly |

<sub>41 total. I keep count. It's a compulsion.</sub>

<br>

## ⌨️ Commands

Two commands. That's the whole interface.

| Command | What it does |
|:--|:--|
| `/kiln-fire` | Launch the pipeline. Auto-detects state and resumes where it left off. |
| `/kiln-doctor` | Pre-flight check &mdash; Claude Code, Codex CLI, GPT-5.4 access, permissions. |

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
│   │   └── plugin.json        Plugin manifest (v0.94)
│   ├── agents/                41 agent definitions
│   ├── commands/
│   │   ├── kiln-fire.md       Launch / resume
│   │   └── kiln-doctor.md     Pre-flight check
│   ├── hooks/
│   │   ├── hooks.json         PreToolUse + PostToolUse hook entries
│   │   └── webfetch-responsive.sh
│   └── skills/
│       └── kiln-pipeline/
│           ├── SKILL.md       Pipeline state machine
│           ├── data/          Brainstorming + elicitation data
│           ├── references/    Blueprints, design system, kill streaks
│           └── scripts/       enforce-pipeline.sh, audit-bash.sh
├── install.sh                 One-liner installer
├── README.md
└── docs/
```

No npm. No build step. Just markdown files in a folder, distributed as a native Claude Code plugin. Entropy is a choice.

</details>

<details>
<summary>📊 <strong>v1 &rarr; v2 &rarr; v5 &rarr; v6 &rarr; v7 &rarr; v8 &rarr; v9</strong></summary>
<br>

| | v1 | v2 | v5 | v6 | v7 | v8 | **v9** |
|:--|:--|:--|:--|:--|:--|:--|:--|
| **Agents** | 13 | 19 | 24 | 25 | 27 | 29 | **41** |
| **Steps** | 5 | 5 | 7 | 7 | 7 | 7 | 7 |
| **Skills** | 26 | 1 | 1 | 1 | 1 | 1 | 1 |
| **Commands** | 8 | 4 | 2 | 2 | 2 | 2 | 2 |
| **Install** | Custom | npm | `--plugin-dir` | `plugin install` | `plugin install` | `plugin install` | `plugin install` |
| **Dependencies** | 0 | 0 | 0 | 0 | 0 | 0 | **0** |
| **Config surface** | ~4k lines | ~1.5k | ~600 | ~600 | ~600 | ~600 | ~600 |
| **Design QA** | &mdash; | &mdash; | &mdash; | Hephaestus | Picasso + Renoir | Picasso + Renoir | Picasso + Renoir |

More agents. A fraction of the surface area. The models matured. The framework stepped back. Then the framework disappeared entirely. This is the correct response to improving tools. Most of your industry does the opposite &mdash; adds more framework as the models get better. Fascinating. Self-destructive, but fascinating.

</details>

<details>
<summary>🔧 <strong>Troubleshooting</strong></summary>
<br>

**`codex: command not found`** &mdash; `npm install -g @openai/codex`

**Commands missing in Claude Code** &mdash; Verify the plugin is installed (`claude plugin list`) or that it's in `~/.claude/plugins/kiln/`. Restart Claude Code.

**Pipeline halts** &mdash; Check `.kiln/` artifacts, fix, then `/kiln-fire` to resume.

**`model_reasoning_effort` flag rejected** &mdash; Older Codex CLI. `npm install -g @openai/codex` to upgrade.

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
| **v9** | **Parallel Build Lanes** | 12 named pair agents for concurrent build/review. Codex-free install path. 41 agents total. |
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

<br>

## 🔬 Technical Deep Dive

Kiln is a native Claude Code plugin that leverages every platform primitive:

- **Teams**: `TeamCreate` per step with persistent agents
- **Messaging**: `SendMessage` for all inter&#8209;agent communication (one message at a time, ordered)
- **Tasklists**: `TaskCreate`/`Update`/`List` for build iterations and validation
- **Hooks**: 17 PreToolUse rules + PostToolUse audit via `enforce-pipeline.sh` &amp; `audit-bash.sh`
- **State**: `.kiln/STATE.md` with auto&#8209;resume via `skill` path
- **File Ownership**: Each agent owns specific files and pushes updates

The result is a **multi&#8209;agent operating system** where context is never stale, decisions are traceable, and the pipeline survives shutdowns.

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
