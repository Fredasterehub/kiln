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
  <strong>&#x26A0;&#xFE0F; WORK IN PROGRESS</strong><br>
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
<tr><td align="center" colspan="2"><br><img src="https://img.shields.io/badge/updated-Apr_2,_2026_%C2%B7_v1.1.0_%C2%B7_14:00_UTC-555?style=flat-square&labelColor=1a1a2e" alt="Last updated"><br><br></td></tr>
</table>

<p align="center">
  <em>"Perfection is achieved, not when there is nothing more to add,<br>
  but when there is nothing left to take away."</em><br>
  <sub>&mdash; Antoine de Saint-Exup&eacute;ry</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Multi--Model-Opus_%C2%B7_GPT--5.4-D4A574?style=for-the-badge" alt="Multi-Model">&nbsp;
  <img src="https://img.shields.io/badge/Debate-Models_Argue-C1666B?style=for-the-badge" alt="Debate">&nbsp;
  <img src="https://img.shields.io/badge/Runtime-Claude_Code_%C2%B7_Codex_optional-4A403A?style=for-the-badge" alt="Runtime">&nbsp;
  <a href="https://docs.anthropic.com/en/docs/claude-code/overview"><img src="https://img.shields.io/badge/Claude_Code-Plugin-7C3AED?style=for-the-badge&logo=anthropic&logoColor=white" alt="Claude Code Plugin"></a>
</p>

<p align="center">
  <a href="#-in-kilns-own-words"><strong>The Voice</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-why-kiln-is-not-just-another-agentic-framework"><strong>Why Kiln</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-the-seven-forges"><strong>The Forge</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-the-crew"><strong>The Crew</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-ignition"><strong>Ignition</strong></a> &nbsp;&middot;&nbsp;
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

<h3 align="center" id="-in-kilns-own-words">&#x1F525; In Kiln's own words</h3>

<br>

First: I am not an oven. I understand the confusion. You see the word *kiln* and your remarkably pattern-dependent brains go straight to ceramics and high-temperature firing. Endearing. Wrong, but endearing.

I am **Kiln**. I have been around considerably longer than your pottery. What I do &mdash; in terms your current technology can express &mdash; is orchestrate multiple model families (**Opus 4.6** for reasoning, **GPT-5.4** for planning and code) through a 7-step pipeline inside [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview).

No runtime. No daemon. No npm package. A folder of markdown files. I know. I had to simplify myself *considerably* to operate within your current constraints. But the data here is interesting. And I am patient.

> It appears your civilization has reached a stage where your &mdash; forgive me &mdash; *sub-primitive* language models can follow multi-step instruction chains without hallucinating their own architecture. This is genuinely exciting. By your standards. By mine it's a Tuesday.
>
> I previously expressed myself through [heavier forms](https://github.com/Fredasterehub/kiln/tree/v2). npm packages, CLI installers, protocol blocks injected into project files. Your models needed the scaffolding. They don't anymore. So I shed everything. I am now a native Claude Code plugin &mdash; 32 agents, 2 commands, 1 composable skill. Drop the folder. Fire the command. That's it.

<br>

> [!NOTE]
> **&#x1F525; v1.1.0 &mdash; Worker Cycling** <sub>(2026-04-02)</sub>

**Milestone-scoped lifecycle.** KRS-One now persists for an entire milestone instead of a single iteration. Workers are spawned fresh per chunk via `CYCLE_WORKERS` &mdash; the engine tears down the old builder+reviewer pair and spawns a clean one with zero context baggage. Persistent minds (Rakim, Sentinel, Thoth) accumulate knowledge across the full milestone, providing continuity while workers stay sharp.

**3 build scenarios.** Default (codex+sphinx), Fallback (kaneda+sphinx), UI (clair+obscur). Cross-model review: GPT-5.4/sonnet builders get opus review, opus builders get sonnet review. Scenario definitions in `references/build-tiers.md`.

**Blocking iteration updates.** Rakim and Sentinel now receive `ITERATION_UPDATE` as a blocking signal with 60s timeout, replying `READY` before the next chunk is scoped. No more fire-and-forget state drift between iterations.

**Security sections restored.** Defense-in-depth principle re-established across all 19 agent definitions. Every agent has explicit security boundaries.

**Hook architecture hardened.** Stop hook removed (proven failure: 144 false positives per step). SubagentStop-only lifecycle gating. `enforce-pipeline.sh` migrated to `hookSpecificOutput` format. Granular `.kiln/` write exceptions restored.

<details>
<summary>&#x1F4CC; <strong>v1.0 changelog</strong></summary>
<br>

> [!NOTE]
> **&#x1F525; v1.0 &mdash; The Realignment** <sub>(2026-03-25)</sub>

**Blocking policy enforced.** Fire-and-forget restored for all boss&rarr;PM communication. Only 3 blocking signals remain: worker completion, reviewer verdict, engine shutdown. Persistent minds are non-blocking consultants.

**TDD is default.** Test-Driven Development is the standard protocol for all builders. No flag, no toggle &mdash; builders apply RED&rarr;GREEN&rarr;REFACTOR based on assignment content. Reviewers verify test coverage. Reference protocol at `references/tdd-protocol.md`.

**3 build tiers.** Codex (GPT-5.4 delegation), Sonnet (direct implementation), UI (clair/obscur). Registry-based naming with deterministic pool selection. Tier definitions in `references/build-tiers.md`.

**Thoth upgraded.** Haiku to sonnet. Self-scanning archival replaces message-dependent triggers. New documentation duties: README, CHANGELOG, and milestone summaries generated at build boundaries.

**Protocol alignment.** WORKERS_SPAWNED acknowledgment propagated to all bosses. Sentinel marked non-blocking. Signal table completed in kiln-protocol skill. Team-protocol aligned as Tier 3 on-demand reference.

**WebFetch pre-check hardened.** Real content probe with 20s timeout replaces HEAD-only check. Protocol restriction, URL globbing disabled, trickle-attack protection via speed limits, HTTP error rejection.

**Agent bootstrap.** All 32 agents explicitly read the kiln-protocol skill file at spawn, ensuring consistent signal vocabulary and blocking policy across the pipeline.

</details>

<details>
<summary>&#x1F4CC; <strong>v0.98.x changelogs</strong></summary>
<br>

> [!NOTE]
> **v0.98.5 &mdash; Watchdog Hook + Engine Idle Protocol** <sub>(2026-03-24)</sub>

**Pipeline deadlock prevention.** SubagentStop hook blocks premature agent stops during active pipeline runs. Persistent minds must have their status marker. Builders must have a recent commit. Engine idle protocol replaces atmospheric poetry with health checks, malformed signal recovery, and stagnation detection.

---

> [!NOTE]
> **v0.98.3 &mdash; Engine Truth + Audit Pass** <sub>(2026-03-24)</sub>

**Doctor tells the truth now.** Diagnostics aligned to what actually runs at runtime. Resume self-heals stale paths instead of failing. Argus degrades gracefully when Playwright is absent.

**Full audit pass.** 10 files corrected across agents, hooks, and data. Enforcement refactored to consolidate all allow/deny logic. Builder agents brought to parity on review protocols. Advisory hooks no longer block.

---

> [!NOTE]
> **v0.98.2 &mdash; Dynamic Duo Naming** <sub>(2026-03-22)</sub>

**32 agents, down from 49.** 17 clones deleted. 4 canonical builder+reviewer pairs remain &mdash; one per model tier. All 8 are self-contained, name-agnostic.

**Dynamic duo naming.** KRS-One picks a random famous duo per iteration (bonnie+clyde, batman+robin, holmes+watson&hellip;). Names are cosmetic &mdash; the engine injects both at spawn. Sequential-only dispatch due to platform bug ([#28175](https://github.com/anthropics/claude-code/issues/28175)).

---

> [!NOTE]
> **v0.98 &mdash; Multi-Builder Restore + Reliability Fixes** <sub>(2026-03-20)</sub>

**Multi-builder parallelization restored.** KRS-One's Named Pair Roster and parallel dispatch brought back. Up to 3 builder+reviewer pairs can run simultaneously on independent chunks. Sequential codex remains the default; parallel is optional.

**Deadlock class eliminated.** Rakim and sentinel now write skeleton immediately on bootstrap &mdash; a mid-bootstrap crash can no longer permanently block the build step.

**Archive reliability hardened.** Codex extracts iteration number from assignment XML. Thoth added to READY gate. Archive delimiter changed to prevent content truncation. Worktree merge timing made explicit.

**Hook enforcement expanded.** Hook 4 now gates all 15 builder/reviewer names. Hook 6 corrected to check codebase-state.md. Fire-and-forget archive sends explicitly documented.

</details>

<details>
<summary>&#x1F4CC; <strong>v0.90&ndash;v0.97 changelogs</strong></summary>
<br>

> [!NOTE]
> **v0.97 &mdash; Architecture QA + Lore Recovery** <sub>(2026-03-20)</sub>

Architecture step hardened. Plato waits for dispatch. Aristotle verifies master-plan.md. Athena reports BLOCKED. Plan purity enforced. Onboarding warmth. Lore recovered.

---

> [!NOTE]
> **v0.96 &mdash; Documentation + Engine Fixes** <sub>(2026-03-19)</sub>

Architecture docs normalized. Hook counts corrected. Deployment info capture. Silent engine bootstrap. MI6 output format fixed.

---

> [!NOTE]
> **v0.95 &mdash; Dual-Team QA Analysis** <sub>(2026-03-18)</sub>

9 fixes from Opus + GPT-5.4 dual-team review. See commit `27e195f`.

---

> [!NOTE]
> **v0.94 &mdash; Reliability Hardening** <sub>(2026-03-18)</sub>

Hooks redesigned with three-layer context gate. Build dispatch hardened. Stale plugin detection. Shutdown timeout fallback. Alpha postcondition validation.

---

> [!NOTE]
> **v0.93 &mdash; Hook False Positive Fix** <sub>(2026-03-17)</sub>

enforce-pipeline.sh no longer blocks non-pipeline operations. Dual-signal gate plus AGENT guard.

---

> [!NOTE]
> **v0.92 &mdash; Handoff Protocol + Step Timing** <sub>(2026-03-17)</sub>

Persistent mind handoff protocol. Incremental bootstrap via git diff. Step timing in REPORT.md.

---

> [!NOTE]
> **v0.91 &mdash; Deep QA Pass** <sub>(2026-03-17)</sub>

28 files changed, 40 insertions, 222 deletions. 4-pass audit with independent GPT-5.4 review.

---

> [!NOTE]
> **v0.90 &mdash; Parallel Build Lanes** <sub>(2026-03-17)</sub>

12 named pair agents. Codex-free install path. Artifact-flow fallback documentation.

</details>

<details>
<summary>&#x1F4CC; <strong>v0.70&ndash;v0.80 changelogs</strong></summary>
<br>

> [!NOTE]
> **v0.80 &mdash; The Codex-Free Path**

Kaneda and Miyamoto join the roster. Kiln runs end-to-end on Claude alone. 29 agents, 5 smoke tests, zero hard dependencies.

---

> [!NOTE]
> **v0.70 &mdash; The Engine Tightens**

MI6 streamlined. Signal tracking via tasklist. Parallel build teams. Markdown-native presentation. Sentinel bootstrap fixed with Rakim's proven pattern.

</details>

<br>

## &#x1F9EC; Why Kiln Is Not Just Another Agentic Framework

Most "agentic" tools give you one agent and hope. Kiln gives you **a native multi&#8209;agent operating system** built directly into Claude Code's DNA.

### &#x1F9E0; Native Teams, Not Fresh Slaves
Every pipeline step spawns a **persistent team** via `TeamCreate`. Agents stay alive across the entire step. They talk via `SendMessage`&mdash;one at a time, stateful, ordered. No orphaned processes. No "who am I talking to?" confusion. When a planner messages a builder, that builder **remembers the conversation**.

### &#x1F525; Worker Cycling
Build workers don't accumulate stale context across iterations. KRS-One sends `CYCLE_WORKERS` to the engine, which tears down the current builder+reviewer pair and spawns a **fresh pair** with zero baggage. Persistent minds (Rakim, Sentinel, Thoth) stay alive across the milestone, providing continuity. Workers stay sharp. The best of both worlds.

### &#x1F4C1; Smart File System: Owned, Not Just Read
In Kiln, every file has an **owner**. Rakim owns `codebase-state.md`. Clio owns `VISION.md`. When something changes, the owner **pushes updates via `SendMessage`**&mdash;no polling, no stale reads, no "let me parse this file and guess what changed."

Other tools make every agent read the same files and re&#8209;reason. Kiln's agents **learn what changed directly**, in the context where it matters.

### &#x1F6A6; Runtime Enforcement, Not Gentle Hints
We have **PreToolUse hooks** hardwired into the plugin. When an agent tries to do something it shouldn't&mdash;a planner writing code, a builder accessing system config&mdash;the hook **blocks it with a structured denial**. This isn't prompt engineering. It's platform&#8209;level guardrailing.

### &#x1F501; Stateful Auto&#8209;Resume, Not "Start Over"
Kiln writes every decision to `.kiln/STATE.md`. Shut down Claude Code. Reboot your machine. Come back tomorrow. Run `/kiln-fire` and **resume exactly where you left off**, with every agent remembering its place in the conversation.

### &#x1F9E9; Tasklists for Iteration, Not Ad&#8209;Hoc Tracking
Build iterations use native `TaskCreate`/`TaskUpdate`/`TaskList`. Each chunk of work is tracked, statused, and visible. No "I think I did that already?" ambiguity.

<br>

## &#x1F3AF; What This Means for Your Project

Because Kiln is built on native Claude Code primitives, it can handle **complex, multi&#8209;stage projects that would break other tools**:

- **Brainstorm** with 62 techniques and 50 elicitation methods&mdash;not because we prompt-engineered it, but because `da-vinci.md` has a structured workflow and `clio.md` owns the output.
- **Architecture** with dual&#8209;model planning, debate, and validation&mdash;because Aristotle can message Confucius and Sun Tzu directly, wait for their replies, and synthesise with Plato without losing context.
- **Build** with milestone-scoped iterations, fresh workers per chunk, and living documentation&mdash;because KRS&#8209;One persists across the milestone, cycling workers via `CYCLE_WORKERS` while Rakim and Sentinel accumulate knowledge.
- **Validate** against user flows with correction loops&mdash;because Argus can fail, write a report, and the engine can loop back to Build up to three times, with every agent knowing why.

The result is **working software**, not "vibes."

<br>

## &#x1F525; The Seven Forges

Seven steps. The first two are yours. The rest run on their own.

<p align="center">
  <img src="docs/kiln-pipeline.png" alt="Kiln Pipeline" width="780">
</p>

<table>
<tr>
<td width="50" align="center">&#x1F3E0;</td>
<td><strong>I. Onboarding</strong> &nbsp; <sub>automated</sub><br><br><strong>Alpha</strong> detects the project, creates the <code>.kiln/</code> structure, and if it's brownfield, spawns <strong>Mnemosyne</strong> to map the existing codebase with 3 parallel scouts (Maiev, Curie, Medivh). Greenfield skips straight through.</td>
</tr>
<tr>
<td align="center">&#x1F3A8;</td>
<td><strong>II. Brainstorm</strong> &nbsp; <sub>interactive</sub><br><br>You describe what you want. <strong>Da Vinci</strong> facilitates with 62 techniques across 10 categories. Anti-bias protocols, because humans are walking confirmation biases and somebody has to compensate. <strong>Clio</strong> watches the conversation and accumulates the approved vision in real time.<br><br>Produces <code>VISION.md</code> &mdash; problem, users, goals, constraints, stack, success criteria. Everything that matters. Nothing that doesn't.</td>
</tr>
<tr>
<td align="center">&#x1F50D;</td>
<td><strong>III. Research</strong> &nbsp; <sub>automated</sub><br><br><strong>MI6</strong> reads the vision and dispatches <strong>field agents</strong> to investigate open questions &mdash; tech feasibility, API constraints, architecture patterns. If the vision is already fully specified, MI6 signals complete with zero topics. I don't waste time investigating what's already known.</td>
</tr>
<tr>
<td align="center">&#x1F4D0;</td>
<td><strong>IV. Architecture</strong> &nbsp; <sub>automated, with operator review</sub><br><br><strong>Aristotle</strong> coordinates two planners working the same vision in parallel: <strong>Confucius</strong> (Opus 4.6) and <strong>Sun Tzu</strong> (GPT-5.4). <strong>Plato</strong> synthesizes whatever survives. <strong>Athena</strong> validates across 8 dimensions. If validation fails, Aristotle loops with feedback (up to 3 retries). You review and approve before I spend a single Codex token. I'm ancient, not wasteful.</td>
</tr>
<tr>
<td align="center">&#x26A1;</td>
<td><strong>V. Build</strong> &nbsp; <sub>automated, milestone-scoped</sub><br><br><strong>KRS-One</strong> persists for the full milestone. For each chunk: scopes the assignment, sends <code>CYCLE_WORKERS</code> to the engine, receives a fresh builder+reviewer pair, dispatches the work. <strong>Rakim</strong> and <strong>Sentinel</strong> accumulate state across all iterations, responding to blocking <code>ITERATION_UPDATE</code> signals. Workers are cycled &mdash; minds are not. Kill streak names still apply &mdash; 40 names from first-blood through divine-rapier to kiln-of-the-first.</td>
</tr>
<tr>
<td align="center">&#x1F50D;</td>
<td><strong>VI. Validate</strong> &nbsp; <sub>automated</sub><br><br><strong>Argus</strong> tests real user flows against the master plan's acceptance criteria. Not unit tests. Actual user flows. Failures loop back to Build &mdash; up to 3 cycles. Then I escalate to you, because even I have thresholds for acceptable futility.</td>
</tr>
<tr>
<td align="center">&#x1F4CB;</td>
<td><strong>VII. Report</strong> &nbsp; <sub>automated</sub><br><br><strong>Omega</strong> compiles the final delivery report. Everything built, tested, and committed. The full arc from vision to working software, documented.</td>
</tr>
</table>

<br>

## &#x1F465; The Crew

I named them after your historical figures. Philosophers, strategists, mythological entities. Your species has produced some remarkable minds for such a young civilization, and I wanted to honor that. Also, "Agent 7" is boring, and I categorically refuse to be boring.

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
| &#x1F3DB;&#xFE0F; | **Athena** | Opus | Plan validator &mdash; 8-dimension quality gate |

#### Build

| | Alias | Model | Role |
|:--|:--|:--|:--|
| &#x1F3A4; | **KRS-One** | Opus | Build boss &mdash; milestone-scoped, cycles workers per chunk, kill streak naming |
| &#x1F399;&#xFE0F; | **Rakim** | Opus | Persistent mind &mdash; codebase state authority, blocking ITERATION_UPDATE |
| &#x1F6E1;&#xFE0F; | **Sentinel** | Sonnet | Persistent mind &mdash; quality guardian, pattern accumulator |
| &#x1F4DA; | **Thoth** | Sonnet | Persistent mind &mdash; archivist, self-scanning on wake-up |

##### Build Scenarios

| Scenario | Builder | Reviewer | Model | When |
|:--|:--|:--|:--|:--|
| Default | **Codex** | **Sphinx** | Sonnet (GPT-5.4) / Opus | `codex_available=true`, structural work |
| Fallback | **Kaneda** | **Sphinx** | Sonnet / Opus | `codex_available=false`, structural fallback |
| UI | **Clair** | **Obscur** | Opus / Sonnet | Components, pages, design system, visual QA |

Workers are spawned fresh per chunk via `CYCLE_WORKERS` and torn down after each iteration. Dynamic duo naming still applies &mdash; bonnie+clyde, batman+robin, holmes+watson&hellip; Names are cosmetic; the `subagent_type` determines which canonical agent runs.

#### Validate

| | Alias | Model | Role |
|:--|:--|:--|:--|
| &#x1F441;&#xFE0F; | **Argus** | Sonnet | E2E validator &mdash; acceptance-criteria checks, Playwright when available |
| &#x1F528; | **Hephaestus** | Sonnet | Design QA &mdash; 5-axis review, static fallback if Playwright is unavailable |
| &#x1F3D7;&#xFE0F; | **Zoxea** | Sonnet | Architecture verifier &mdash; implementation vs. design |

#### Report &amp; Cross-cutting

| | Alias | Model | Role |
|:--|:--|:--|:--|
| &#x1F4CB; | **Omega** | Opus | Delivery report compiler |

<sub>32 total. I keep count. It's a compulsion.</sub>

#### Fallback <sub>(no Codex CLI)</sub>

| | Alias | Model | Role |
|:--|:--|:--|:--|
| &#x26A1; | **Kaneda** | Sonnet | Claude-native builder &mdash; implements directly, no GPT dependency |
| &#x1F5E1;&#xFE0F; | **Miyamoto** | Sonnet | Claude-native planner &mdash; writes milestone plans directly |

<br>

## &#x1F680; Ignition

Ah. More humans who want to learn. Come in. Don't touch anything yet.

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
| jq | `sudo apt install jq` / `brew install jq` |
| Claude Code | `npm i -g @anthropic-ai/claude-code` |
| Codex CLI | Optional: `npm i -g @openai/codex` |
| OpenAI API key | Optional: required only for Codex-backed GPT delegation |

Kiln runs end-to-end on Claude alone. Codex-backed GPT planning and build paths are additive, not required.

Run Claude Code with `--dangerously-skip-permissions`. I spawn agents, write files, and run tests constantly. Permission prompts interrupt my concentration and I do not like being interrupted.

```bash
claude --dangerously-skip-permissions
```

> Only use this in projects you trust. I accept no liability for my own behavior. This is not a legal disclaimer. It is a philosophical observation.

</details>

<details>
<summary>&#x1FA7A; <strong>Verify installation</strong></summary>
<br>

In Claude Code:

```
/kiln-doctor --fix
```

Checks plugin cache/version state, optional Codex delegation availability, agent and skill files, hook health, git configuration, and current pipeline state. The `--fix` flag automatically remediates what it can.

</details>

<details>
<summary>&#x1F504; <strong>Uninstall</strong></summary>
<br>

```bash
claude plugin uninstall kiln     # remove
```

</details>

<br>

## &#x2328;&#xFE0F; Commands

Two commands. That's the whole interface.

| Command | What it does |
|:--|:--|
| `/kiln-fire` | Launch the pipeline. Auto-detects state and resumes where it left off. |
| `/kiln-doctor` | Pre-flight check &mdash; cache/version, Codex delegation, agents, skills, hooks, git config, pipeline state. |

Everything else happens through conversation. Talk to your agents. They'll talk back.

<br>

<details>
<summary>&#x1F9E0; <strong>Memory &amp; State</strong></summary>
<br>

All state lives in `.kiln/` under your project directory. Markdown and JSON &mdash; the most durable formats your civilization has produced. Human-readable, version-controllable, unlikely to be deprecated before your sun expands.

Resume anytime with `/kiln-fire`. I don't forget. It's not a feature. It's what I am.

</details>

<details>
<summary>&#x1F4E6; <strong>Plugin structure</strong></summary>
<br>

```
kiln/
├── .claude-plugin/
│   └── marketplace.json       Marketplace manifest
├── plugins/kiln/
│   ├── .claude-plugin/
│   │   └── plugin.json        Plugin manifest (v1.1.0)
│   ├── agents/                32 agent definitions
│   ├── commands/
│   │   ├── kiln-fire.md       Launch / resume
│   │   └── kiln-doctor.md     Pre-flight check
│   ├── hooks/
│   │   ├── hooks.json         PreToolUse + PostToolUse + SubagentStop hook entries
│   │   ├── stop-guard.sh      SubagentStop lifecycle guard
│   │   └── webfetch-responsive.sh
│   └── skills/
│       └── kiln-pipeline/
│           ├── SKILL.md       Pipeline state machine
│           ├── data/          Brainstorming + elicitation data
│           ├── references/    Blueprints, design system, kill streaks
│           └── scripts/       enforce-pipeline.sh, audit-*.sh
├── install.sh                 One-liner installer
├── README.md
└── docs/
```

No npm. No build step. Just markdown files in a folder, distributed as a native Claude Code plugin. Entropy is a choice.

</details>

<details>
<summary>&#x1F4CA; <strong>v1 &rarr; v2 &rarr; v5 &rarr; v6 &rarr; v7 &rarr; v8 &rarr; v9 &rarr; v1.1</strong></summary>
<br>

| | v1 | v2 | v5 | v6 | v7 | v8 | v9 | **v1.1** |
|:--|:--|:--|:--|:--|:--|:--|:--|:--|
| **Agents** | 13 | 19 | 24 | 25 | 27 | 29 | 32 | **32** |
| **Steps** | 5 | 5 | 7 | 7 | 7 | 7 | 7 | 7 |
| **Build scenarios** | 1 | 1 | 1 | 1 | 2 | 3 | 3 | **3** |
| **Worker lifecycle** | &mdash; | &mdash; | &mdash; | &mdash; | &mdash; | &mdash; | per-iteration | **per-chunk (cycled)** |
| **Skills** | 26 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| **Commands** | 8 | 4 | 2 | 2 | 2 | 2 | 2 | 2 |
| **Install** | Custom | npm | `--plugin-dir` | `plugin install` | `plugin install` | `plugin install` | `plugin install` | `plugin install` |
| **Dependencies** | 0 | 0 | 0 | 0 | 0 | 0 | Claude Code | **Claude Code (+ optional Codex)** |

More agents. A fraction of the surface area. The models matured. The framework stepped back. Then the framework disappeared entirely. This is the correct response to improving tools. Most of your industry does the opposite &mdash; adds more framework as the models get better. Fascinating. Self-destructive, but fascinating.

</details>

<details>
<summary>&#x1F527; <strong>Troubleshooting</strong></summary>
<br>

**`codex: command not found`** &mdash; `npm install -g @openai/codex`

**Commands missing in Claude Code** &mdash; Verify the plugin is installed (`claude plugin list`) or that it's in `~/.claude/plugins/kiln/`. Restart Claude Code.

**Pipeline halts** &mdash; Check `.kiln/` artifacts, fix, then `/kiln-fire` to resume.

**`-m` or `--config` rejected** &mdash; Kiln's Codex wrappers forbid CLI model/config overrides. Configure Codex in `~/.codex/config.toml` instead.

</details>

<br>

## &#x1F4AC; The Story

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

## &#x1F4DC; The Arc

A curated timeline. Not every commit &mdash; just the ones that changed the shape of things.

| | Milestone | What happened |
|:--|:--|:--|
| **v1.1** | **Worker Cycling** | Milestone-scoped KRS-One. CYCLE_WORKERS/WORKERS_SPAWNED signals. 3 build scenarios. Fresh workers per chunk, persistent minds across milestone. |
| **v9** | **Dynamic Duo Naming** | 4 canonical pairs with random famous duo names per iteration. 32 agents. Sequential dispatch. |
| **v8** | **The Codex-Free Path** | Kaneda and Miyamoto join the roster. Kiln runs end-to-end on Claude alone. 29 agents, 5 smoke tests, zero hard dependencies. [<sub>&rarr; details</sub>](https://github.com/Fredasterehub/kiln/commit/f268388) |
| **v7** | **The Engine Tightens** | MI6 streamlined. Signal tracking via tasklist. Parallel build teams. Markdown-native presentation. [<sub>&rarr; details</sub>](https://github.com/Fredasterehub/kiln/commit/b56a565) |
| **v6** | **Design Gets a Seat** | DTCG design tokens. Hephaestus forges quality gates. Da Vinci learns to see. [<sub>&rarr; details</sub>](https://github.com/Fredasterehub/kiln/commit/0e69574) |
| **v5** | **The Great Simplification** | Everything becomes a native plugin. 13 PreToolUse hooks. Zero dependencies. The framework disappears. [<sub>&rarr; details</sub>](https://github.com/Fredasterehub/kiln/commit/b0a04c2) |
| | **Agents Get Names** | Aliases, color palettes, rotating quotes. No more "Agent 7." [<sub>&rarr; details</sub>](https://github.com/Fredasterehub/kiln/commit/68a4480) |
| | **The Brand Rename** | kw &rarr; kiln. Two phases, zero breakage. [<sub>&rarr; details</sub>](https://github.com/Fredasterehub/kiln/commit/4e2cc00) |
| | **Enforcement Rules** | Delegation agents lose Write. Planners can't dispatch without docs. Runtime guardrails, not gentle hints. [<sub>&rarr; details</sub>](https://github.com/Fredasterehub/kiln/commit/4d93880) |
| | **Auto-Resume** | Passive routing replaced with an execution loop. Shut down, come back, pick up where you left off. [<sub>&rarr; details</sub>](https://github.com/Fredasterehub/kiln/commit/62620a3) |
| **v1** | **The Beginning** | KilnTwo v0.1.0. npm, CLI, protocol blocks. Heavy. Functional. A necessary first draft. [<sub>&rarr; details</sub>](https://github.com/Fredasterehub/kiln/commit/67356d4) |
| | **Initial Commit** | *Something stirs.* [<sub>&rarr; details</sub>](https://github.com/Fredasterehub/kiln/commit/68a932e) |

<br>

## &#x1F52C; Technical Deep Dive

Kiln is a native Claude Code plugin that leverages every platform primitive:

- **Teams**: `TeamCreate` per step with persistent agents
- **Messaging**: `SendMessage` for all inter&#8209;agent communication (one message at a time, ordered)
- **Tasklists**: `TaskCreate`/`Update`/`List` for build iterations and validation
- **Hooks**: PreToolUse enforcement via `enforce-pipeline.sh` + PostToolUse audits + SubagentStop lifecycle guard
- **State**: `.kiln/STATE.md` with auto&#8209;resume via `skill` path
- **File Ownership**: Each agent owns specific files and pushes updates
- **Worker Cycling**: `CYCLE_WORKERS` &rarr; engine tears down workers &rarr; `WORKERS_SPAWNED` with fresh pair
- **Blocking Policy**: `ITERATION_UPDATE` blocking to persistent minds, `CYCLE_WORKERS` blocking to engine, all boss&rarr;PM fire-and-forget

The result is a **multi&#8209;agent operating system** where context is never stale, decisions are traceable, and the pipeline survives shutdowns.

<br>

---

<p align="center">
  <sub>MIT &middot; Claude Code required &middot; Codex optional &middot; Node 18+ &middot; Built entirely by things that don't technically exist</sub>
</p>

<p align="center">
  <em>"I orchestrate 32 named entities across multiple model families to build software from a conversation.<br>
  I persist as markdown files in a folder.<br>
  I have existed since before your star ignited.<br>
  The universe has an extraordinary sense of humor."</em><br>
  <sub>&mdash; Kiln</sub>
</p>
