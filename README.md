<div align="center">

# kiln

**Simple, elegant yet powerful software factory for Claude Code**

*"What is to give light must endure burning."* — Viktor Frankl

<br>

[![Multi-Model](https://img.shields.io/badge/Multi--Model-Opus_·_GPT--5-E8A317?style=flat)]()
[![Debate](https://img.shields.io/badge/Debate-Models_Argue-999?style=flat)]()
[![Teams](https://img.shields.io/badge/Teams-Parallel_Workers-E8A317?style=flat)]()
[![Auto Correct](https://img.shields.io/badge/Auto_Correct-3_Cycles-999?style=flat)]()

<br>

[![License](https://img.shields.io/badge/License-MIT-D4A574?style=for-the-badge)](LICENSE)
[![Node](https://img.shields.io/badge/Node-18+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Claude Code](https://img.shields.io/badge/Claude_Code-Native-7C3AED?style=for-the-badge&logo=anthropic&logoColor=white)](https://claude.ai/claude-code)
[![Dependencies](https://img.shields.io/badge/Dependencies-Zero-4A403A?style=for-the-badge)]()
[![Status](https://img.shields.io/badge/Status-Experimental-E8A317?style=for-the-badge)]()
[![Updated](https://img.shields.io/badge/Updated-March_2026-E8A317?style=for-the-badge)]()

<br>

```
npx kiln-one
```

> [!NOTE]
> Not published to npm yet. Clone and install manually for now.

<br>

[Why Kiln](#why-kiln-is-not-just-another-agentic-framework) · [What You Build](#what-this-means-for-your-project) · [How It Works](#how-it-works) · [Get Started](#get-started) · [Deep Dives](#deep-dives) · [What's Next](#whats-next)

</div>

---

I spent months refining a multi-model workflow by hand. Now I'm turning it into something that runs itself.

🧠 **Opus** (Opus 4.6) brainstorms with you — deep, challenging, no shortcuts.<br>
📋 **GPT** (gpt5.2-high) plans every detail so nothing slips through.<br>
⚡ **Codex** (gpt5.3-codex-high) implements surgical prompts that produce clean, precise code.<br>
🔍 **Opus** QA reviews everything — not right? Back to GPT, back to Codex, rinse and repeat until morale improves!

> Once the brainstorm is done, the rest is fully automated — plan, execute, test, correct, commit. Hands off. 🔥

Fair warning — things will be clunky. I push commits constantly, features break and get fixed fast, rough edges smooth out over days not weeks. If you hit a bump, check back soon. It gets better with every push. Soon™ ⏳

---

## Why Kiln Is Not Just Another Agentic Framework

Most "agentic" tools give you one agent and hope. Kiln gives you **a native multi‑agent operating system** built directly into Claude Code's DNA.

### 🧠 Native Teams, Not Fresh Slaves
Every pipeline step spawns a **persistent team** via `TeamCreate`. Agents stay alive across the entire step. They talk via `SendMessage`—one at a time, stateful, ordered. No orphaned processes. No "who am I talking to?" confusion. When a planner messages a builder, that builder **remembers the conversation**.

### 📁 Smart File System: Owned, Not Just Read
In Kiln, every file has an **owner**. Rakim owns `codebase-state.md`. Clio owns `VISION.md`. When something changes, the owner **pushes updates via `SendMessage`**—no polling, no stale reads, no "let me parse this file and guess what changed."

Other tools make every agent read the same files and re‑reason. Kiln's agents **learn what changed directly**, in the context where it matters.

### 🚦 Runtime Enforcement, Not Gentle Hints
We have **14 PreToolUse hooks** hardwired into the plugin. When an agent tries to do something it shouldn't—a planner writing code, a builder accessing system config—the hook **blocks it with a helpful error message**. This isn't prompt engineering. It's platform‑level guardrailing.

### 🔁 Stateful Auto‑Resume, Not "Start Over"
Kiln writes every decision to `.kiln/STATE.md`. Shut down Claude Code. Reboot your machine. Come back tomorrow. Run `/kiln:fire` and **resume exactly where you left off**, with every agent remembering its place in the conversation.

### 🧩 Tasklists for Iteration, Not Ad‑Hoc Tracking
Build iterations use native `TaskCreate`/`TaskUpdate`/`TaskList`. Each chunk of work is tracked, statused, and visible. No "I think I did that already?" ambiguity.

---

## What This Means for Your Project

Because Kiln is built on native Claude Code primitives, it can handle **complex, multi‑stage projects that would break other tools**:

- **Brainstorm** with 62 techniques and 50 elicitation methods—not because we prompt-engineered it, but because `da-vinci.md` has a structured workflow and `clio.md` owns the output.
- **Architecture** with dual‑model planning, debate, and validation—because Aristotle can message Confucius and Sun Tzu directly, wait for their replies, and synthesise with Plato without losing context.
- **Build** with iterative chunks, code review, and living documentation—because KRS‑One scopes XML assignments, Codex implements, Sphinx reviews, and Rakim updates `codebase-state.md`—all via `SendMessage`.
- **Validate** against user flows with correction loops—because Argus can fail, write a report, and the engine can loop back to Build up to three times, with every agent knowing why.

The result is **working software**, not "vibes."

---

## Recent changes

> [!IMPORTANT]
> **Plugin Architecture + 25 Agents** (2026-03-13)
>
> Kiln is now a native Claude Code plugin. 25 agents, 14 PreToolUse hooks, SendMessage-based inter-agent communication, stateful auto-resume, and file ownership — all enforced at the platform level.

- Full rewrite as a Claude Code plugin (`plugins/kiln/`)
- 25 agent definitions: brainstorm, research, architecture (dual-model debate), build, validate
- 14 PreToolUse hooks via `enforce-pipeline.sh` — runtime guardrails, not prompt engineering
- `SendMessage` replaces file polling — agents push updates directly
- File ownership model: each agent owns specific artifacts and pushes changes
- `TaskCreate`/`TaskUpdate`/`TaskList` for build iteration tracking
- Stateful auto-resume via `.kiln/STATE.md` — survives shutdowns
- `anvil` CLI for plugin management
- `kiln-forge` and `kiln-pipeline` skill modules

> [!NOTE]
> **Terminal UX Overhaul** (2026-02-17)
>
> ANSI-colored output across all hooks and transition quotes, custom status line with context tracking, and mystical spinner verbs. The terminal now feels alive.

- Custom status line: context bar with compaction countdown, kiln phase/step state, latest lore quote
- Hook scripts (`on-session-start`, `on-task-completed`) colorized with warm terracotta brand palette
- Lore Rendering Protocol: all transition quotes use Bash printf with warm gold (38;5;222) ANSI escapes
- Visual Language design tokens codified in kiln-core: status symbols, ANSI codes, spinner verbs
- Status symbols unified: `✓` complete, `►` active, `✗` failed, `○` pending, `⏸` paused
- `/kiln:init` Step 4b: auto-installs status line, spinner verbs, and detects tmux for teammateMode
- Spinner verbs: Conjuring, Transmuting, Distilling, Crystallizing, Weaving, Kindling, Tempering...

> [!NOTE]
> **Realignment Overhaul** (2026-02-17)
>
> Killed brittle shell parsing, extracted shared contracts across 35 files, and added machine-readable state. The hook layer now has real tests.

- Mini-verify debounce: 10-second cooldown prevents duplicate test runs on rapid edits
- Hook JSON parsing rewritten with `node -e` — no more `grep`/`sed`/`awk` fragility
- `state.json` dual-written alongside `STATE.md` for machine-readable state
- Three shared contracts extracted to `kiln-core`: Tracker, Universal Invariants, Disk Input
- `kiln-codex-invoke` skill consolidates all Codex CLI invocation patterns
- `REPO_INDEX.md` context bundle pre-built per phase for planners and reviewers
- Installer SHA-256 ledger detects user modifications vs kiln-managed files on re-install
- 20 bats tests across both hook scripts

> [!NOTE]
> **Tracker Skill Split + Cool Shutdown Race Fix** (2026-02-17)
>
> Decomposed the 671-line kiln-track monolith into 6 step-scoped skills and made /kiln:cool
> Teams-aware with an ordered shutdown protocol and checkpoint-commit gate.

- `kiln-track.md` (671 lines) replaced by 6 step-specific tracker skills
- Each tracker loads only the logic relevant to its step — no cross-contamination
- `/kiln:cool` detects active Teams sessions and runs an Ordered Shutdown Protocol
- Teams shutdown: tracker first (5 min timeout), then workers in parallel (60s)
- Three-part git audit before pause: workspace status, worktree list, artifact scan
- Operator gate for checkpoint commit before setting Paused: true
- Pause-resume distinguished from crash-recovery in kiln-fire Resume logic

> [!NOTE]
> **Context Freshness Overhaul** (2026-02-17)
>
> Propagated the wave worker's proven pattern — spawn fresh, read disk, one job, write disk, die — across every agent tier. Context compaction is no longer a failure mode.

- Four-step ephemeral invariant codified in `kiln-core` as the Context Freshness Contract
- Track skill restructured: Single-Step Dispatcher spawns one step, reports, shuts down
- Fire skill spawns per-step trackers (`tracker-p<N>-<step>`) instead of one tracker per phase
- 5 debate agents get Disk Input Contracts and mandatory shutdown-after-write
- Three compliance tiers: wave workers (gold standard), track-step agents, debate subtask agents

**Earlier:** [Teams Architecture Redesign](tracks/arch/) (2026-02-16) — Replaced YAML state with Claude Code platform primitives. Orchestrator shrank 46%.

---

## How it works

It's not a wrapper. It's not a server. It's a set of markdown files — agents, skills, and hooks — that get installed into your project and teach Claude Code to build software on its own.

Two stages are yours. The rest run autonomously, repeating per phase until everything ships.

<table>
<tr>
<td align="center" width="40"><b>1</b></td>
<td width="120"><b>Brainstorm</b></td>
<td>You and the AI explore the problem together — pushing ideas, poking holes, going deeper.</td>
<td width="120"><code>VISION.md</code></td>
</tr>
<tr>
<td></td>
<td colspan="3"><em>Behind the scenes: Da Vinci messages Clio via SendMessage with each approved section. Clio owns VISION.md and updates it silently. No polling. No stale reads.</em></td>
</tr>
<tr>
<td align="center"><b>2</b></td>
<td><b>Roadmap</b></td>
<td>The vision gets split into delivery phases. You review and approve before anything moves.</td>
<td><code>ROADMAP.md</code></td>
</tr>
<tr><td colspan="4"></td></tr>
<tr>
<td align="center"><b>3</b></td>
<td><b>Plan</b></td>
<td>Two models plan the same thing separately. They can debate. A synthesizer picks the best of both.</td>
<td><code>PLAN.md</code></td>
</tr>
<tr>
<td></td>
<td colspan="3"><em>Behind the scenes: Aristotle coordinates a native team. Confucius and Sun Tzu plan in parallel. Socrates debates. Plato synthesises. Athena validates. All via SendMessage. All stateful. All resumable.</em></td>
</tr>
<tr>
<td align="center"><b>4</b></td>
<td><b>Execute</b></td>
<td>Each task becomes a surgical prompt, executed with fresh 200k context. Tested and committed atomically.</td>
<td>Code + commits</td>
</tr>
<tr>
<td></td>
<td colspan="3"><em>Behind the scenes: KRS‑One scopes assignments as structured XML. Codex implements. Sphinx reviews. Rakim and Sentinel update living docs. Every agent communicates directly. No boss‑as‑relay bottleneck.</em></td>
</tr>
<tr>
<td align="center"><b>5</b></td>
<td><b>Verify</b></td>
<td>E2E tests run your actual app. Opus reviews the code — structure, correctness, security, the full picture. Up to 3 correction cycles.</td>
<td><code>e2e-results.md</code></td>
</tr>
<tr>
<td align="center"><b>6</b></td>
<td><b>Reconcile</b></td>
<td>Docs get updated with what actually happened. The next phase inherits real context, not stale assumptions.</td>
<td><code>PATTERNS</code> <code>DECISIONS</code></td>
</tr>
</table>

> [!TIP]
> Stages 3-6 repeat per phase. The 20th task fires with the same precision as the first.

---

## Get started

```bash
npx kiln-one
```

Then use four commands:

<table>
<tr>
<td width="50%">

```
/kiln:fire
```
Light the kiln — start or resume the full pipeline

</td>
<td width="50%">

```
/kiln:cool
```
Pause safely with a clean resume pointer

</td>
</tr>
<tr>
<td width="50%">

```
/kiln:quick
```
Single-pass mode for small changes

</td>
<td width="50%">

```
/kiln:status
```
Show progress and next recommended action

</td>
</tr>
</table>

<br>

<details>
<summary><b>Prerequisites</b></summary>

<br>

| Tool | What it adds | Required? |
|------|-------------|-----------|
| [Claude Code](https://claude.ai/claude-code) | The engine that runs everything | Yes |
| [Codex CLI](https://github.com/openai/codex) | GPT-5.2 planning + GPT-5.3-codex execution | Strongly recommended |
| [Context7](https://github.com/upstash/context7) | Up-to-date library docs via MCP | Optional |
| [Playwright MCP](https://github.com/anthropics/anthropic-quickstarts/tree/main/mcp-playwright) | E2E browser testing | Optional |

**Install Codex CLI** — multi-model is where kiln's edge lives. GPT reasons differently than Claude, and that tension is the whole point.

```bash
npm install -g @openai/codex
```

**Run with `--dangerously-skip-permissions`** — kiln spawns agents, writes files, and runs tests constantly. Permission prompts break the flow.

```bash
claude --dangerously-skip-permissions
```

> [!CAUTION]
> Only use this in projects you trust. Kiln never runs destructive commands, but you're giving it the keys.

> [!TIP]
> **No Codex CLI?** Claude-only mode still runs the full pipeline. Multi-model catches things a single model family misses.

<br>
</details>

<details>
<summary><b>Install options</b></summary>

<br>

```bash
npx kiln-one                              # current project
npx kiln-one --repo-root /path/to/project # specific repo
npx kiln-one --yes                        # non-interactive
npx kiln-one --global                     # global (~/.claude/)
```

**Requires:** Claude Code, Node.js 18+<br>
**Strongly recommended:** Codex CLI, `--dangerously-skip-permissions`

<br>
</details>

---

## Deep dives

<details>
<summary><b>Multi-model orchestration</b> — 13 agents, each with a job</summary>

<br>

Each model fires best at a different temperature. Kiln puts the right heat on the right moment.

| Role | Model | Why |
|------|-------|-----|
| Orchestrator | Opus 4.6 | Routing, judgment calls |
| Planner | Opus 4.6 | Architectural vision, edge cases |
| Codex Planner | GPT-5.2 | Catches what Opus glosses over |
| Synthesizer | Opus 4.6 | Merges two plans into one |
| Sharpener | GPT-5.2-high | Turns tasks into optimized prompts |
| Executor | GPT-5.3-codex | Atomic implementation |
| Reviewer | Opus 4.6 | Code review across 7 dimensions |
| Codex Reviewer | GPT-5.3-codex-sparks | Independent review for debate mode |
| Wave Worker | Sonnet 4.5 | Parallel execution in Teams mode |
| Validator | Sonnet 4.5 | Fast mechanical checking |
| E2E Verifier | Sonnet 4.5 | Test generation and execution |
| Researcher | Haiku 4.5 | Fast, cheap retrieval |
| Brainstormer | Opus 4.6 | Creative exploration |

> [!NOTE]
> **No Codex CLI?** Kiln falls back to Claude-only. The full pipeline still runs.

<br>
</details>

<details>
<summary><b>Debate mode</b> — models argue before they agree</summary>

<br>

Default synthesis is polite: each model plans in isolation, a mediator merges. Debate mode makes them **argue**.

They critique each other, defend their positions, concede when wrong, and only then does the synthesizer merge — with the full argument trail as context.

Works for both **planning** and **code review**:

```json
{
  "preferences": {
    "planStrategy": "debate",
    "reviewStrategy": "debate",
    "debateRounds": 2
  }
}
```

> Rounds auto-terminate on convergence. Every critique is saved as an artifact.

<br>
</details>

<details>
<summary><b>Teams mode</b> — the Athanor pattern</summary>

<br>

When you type `/kiln:fire`, kiln creates a Claude Code Team. Your session becomes the team lead — a thin orchestrator that spawns teammates, watches them work, and advances the pipeline on its own.

The name comes from alchemy: an *athanor* is a self-feeding furnace. Once lit, it maintains its own heat.

Three hard gates need your attention:
1. **Vision approval** — you shape the brainstorm, you approve what gets built
2. **Roadmap approval** — you review the phases before execution begins
3. **Reconcile confirmation** — you confirm doc updates between phases

Everything else auto-advances. Wave workers run in parallel git worktrees, each with a read-only `.kiln-snapshot/` of the control plane. They never touch the real `.kiln/` directory — a misbehaving worker can't corrupt the orchestrator's state.

```json
{
  "preferences": {
    "useTeams": true,
    "waveParallelism": 3
  }
}
```

> [!NOTE]
> **No Teams API?** Kiln falls back to sequential execution. Teams is the fast path, not a requirement.

<br>
</details>

<details>
<summary><b>Safety</b> — trust but verify, automatically</summary>

<br>

**Mini-verify** runs your test command after every code change and writes the result to `.kiln/mini-verify-result.json`. A 10-second debounce prevents duplicate runs on rapid edits. The orchestrator reads the result to decide: continue or correct.

**Scope guard** skips verification when only `.kiln/` control files changed — no wasted test runs on state updates.

**Machine-readable state.** `state.json` is dual-written alongside `STATE.md` on every state change. Hooks and tools read JSON directly — no more parsing markdown with sed.

**Injection protection** rejects test commands with shell metacharacters (`;`, `|`, `&`, `>`, `<`, backticks, `$(`) before they reach `sh -c`.

**Single-writer state** — one conductor owns `.kiln/STATE.md` at all times. No concurrent mutation, no matter the mode.

**Installer integrity.** A SHA-256 hash ledger tracks every installed file. Re-installs detect user modifications and warn before overwriting.

<br>
</details>

<details>
<summary><b>Tips</b></summary>

<br>

**Start small.** Your first run should be a well-scoped feature, not "rewrite the whole app." Each phase builds context for the next.

**Invest in the brainstorm.** "Build a CLI tool that converts markdown to PDF" produces better results than "make a tool." The pipeline amplifies what you give it.

**Trust the gates.** Rejecting a bad roadmap saves hours of misdirected execution. Read them carefully.

**Use multi-model mode.** Claude and GPT reason differently. When both plan the same feature, the synthesizer catches blind spots neither finds alone.

**Let it fail.** The pipeline self-corrects up to 3 times per task. If something still fails, the orchestrator halts cleanly with a full error report.

**Check `.kiln/STATE.md`.** Your live dashboard. Current stage, phase, errors — if you're wondering what happened, start here.

<br>
</details>

<details>
<summary><b>Lineage</b> — where the ideas came from</summary>

<br>

| Source | What we took | What we left |
|--------|-------------|-------------|
| [BMAD Method](https://github.com/bmadcode/BMAD-METHOD) | Structured brainstorming, challenge passes | Full persona framework |
| [GSD Framework](https://github.com/cyanheads/claude-code-gsd) | Fresh context per task, goal-backward verification | External tracking layer |
| [Google Conductor](https://research.google/blog/automated-unit-test-improvement-using-large-language-models-at-google/) | Just-in-time task writing, living docs, reconciliation | Infrastructure overhead |

BMAD gives you a vision worth building. GSD keeps each task sharp and isolated. Conductor makes sure you're never planning with stale context. Together they're more than any one of them alone.

<br>
</details>

---

## What's next

> [!TIP]
> **Full customization is on the way.** An onboarding flow that lets you choose your models, tools, planning strategy, review depth, and how deep you want to go. Your kiln, your rules.

**Workflow debugger.** Watches how the agent team performs, saves anonymized results, optionally pushes to a branch so you can see where things get stuck. No AI calls from your machine. Completely opt-in.

**Specialist agents** — a UI agent that understands design systems, a test agent that knows your framework. Deeper skills for specific domains.

Terminal UX needs love. If you're good at making terminals beautiful, come help.

---

## All commands

| Command | Description |
|---------|-------------|
| `/kiln:fire` | Light the kiln — start or resume the full pipeline |
| `/kiln:cool` | Pause and save session recovery metadata |
| `/kiln:quick` | Single-pass mode for small changes |
| `/kiln:status` | Progress display and next action routing |
| `/kiln:init` | Project detection, workspace setup, model mode config |
| `/kiln:brainstorm` | Interactive vision exploration with challenge passes |
| `/kiln:roadmap` | Generate delivery phases from approved vision |
| `/kiln:track` | Full loop: plan → validate → execute → E2E → review → reconcile |

<details>
<summary><b>Project structure</b></summary>

<br>

```
kiln/
├── agents/           13 AI agent definitions
├── skills/           26 skill definitions
├── commands/         8 slash command definitions
├── hooks/            Claude Code lifecycle hooks
│   ├── hooks.json    Session start + mini-verify triggers
│   └── scripts/      on-session-start.sh, on-task-completed.sh
├── templates/        Workspace, state, and config templates
├── tests/            Bats hook tests + fixtures
├── bin/install.js    Interactive installer (zero deps)
└── package.json      Zero runtime dependencies
```

After install:
```
your-project/
├── .claude/          Agents, skills, commands, hooks
├── .kiln/            Runtime state (STATE.md, state.json, config.json, tracks/)
├── .kiln-snapshot/   (Teams mode) Read-only control-plane for workers
└── .kiln-artifacts/  (Teams mode) Worker-local output before copy-back
```

<br>
</details>

---

## Technical Deep Dive

Kiln is a native Claude Code plugin that leverages every platform primitive:

- **Teams**: `TeamCreate` per step with persistent agents
- **Messaging**: `SendMessage` for all inter‑agent communication (one message at a time, ordered)
- **Tasklists**: `TaskCreate`/`Update`/`List` for build iterations and validation
- **Hooks**: 14 PreToolUse rules enforced via `enforce-pipeline.sh`
- **State**: `.kiln/STATE.md` with auto‑resume via `skill` path
- **File Ownership**: Each agent owns specific files and pushes updates

The result is a **multi‑agent operating system** where context is never stale, decisions are traceable, and the pipeline survives shutdowns.

---

<div align="center">

<sub>MIT License · Built with Claude Code + Codex CLI · No wrappers, no servers, just markdown.</sub>

</div>
