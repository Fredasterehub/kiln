<div align="center">

# kiln

**Simple, elegant yet powerful software factory for Claude Code**

*"What is to give light must endure burning."* — Viktor Frankl

<br>

[![Multi-Model](https://img.shields.io/badge/Multi--Model-Opus_·_GPT--5-D4A574?style=flat)]()
[![Debate](https://img.shields.io/badge/Debate-Models_Argue-C1666B?style=flat)]()
[![Teams](https://img.shields.io/badge/Teams-Parallel_Workers-4A403A?style=flat)]()
[![Auto Correct](https://img.shields.io/badge/Auto_Correct-3_Cycles-2d4a3e?style=flat)]()

<br>

[![License](https://img.shields.io/badge/License-MIT-D4A574?style=for-the-badge)](LICENSE)
[![Node](https://img.shields.io/badge/Node-18+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Claude Code](https://img.shields.io/badge/Claude_Code-Native-7C3AED?style=for-the-badge&logo=anthropic&logoColor=white)](https://claude.ai/claude-code)
[![Dependencies](https://img.shields.io/badge/Dependencies-Zero-4A403A?style=for-the-badge)]()

<br>

```
npx kiln-one
```

> [!NOTE]
> Not published to npm yet. Clone and install manually for now.

<br>

[Why I Built This](#why-i-built-this) · [What's New](#recent-changes) · [What's Next](#coming-soon) · [How It Works](#how-it-works) · [Get Started](#get-started) · [Setup](#recommended-setup) · [Deep Dives](#deep-dives)

</div>

---

## Why I built this

I build projects solo. I want them to be good.

Kiln is my daily driver. I spend real time on the brainstorm — going deep, challenging my own assumptions, shaping something concrete — and then I let the oven cook. Check back on the working prototype, tweak it in Claude Code, done. That's my whole involvement.

The brainstorm session is where your time goes. It's also where your ROI comes from. You can rush through or really sit with it. The choice is yours, but the deeper you go, the better everything downstream gets.

| Your work | Kiln's work |
|-----------|-------------|
| Brainstorm your vision deeply | Plan, split into tasks, sharpen prompts |
| Approve the roadmap | Execute, test, commit atomically |
| Tweak the result in Claude Code | Self-correct up to 3 times per task |

Once the brainstorm is done, kiln handles the rest.

It builds a plan — not a detailed PRD that'll drift from reality, but a direction. From there it splits each phase into atomic tasks, sharpens each one into a focused prompt, and hands it to GPT-5.3-codex to implement. Every task gets tested automatically after execution.

When the whole phase is done, Opus 4.6 runs a QA review with end-to-end tests. If it finds problems, the fix doesn't go straight back to the executor. It loops through GPT-5.2 first to re-sharpen the prompt, then GPT-5.3-codex implements the fix, then Opus reviews again. Those correction cycles are capped at 3. If after 3 rounds three state-of-the-art models can't solve it, there's a bigger issue behind.

I won't lie — there are a lot of steps, a lot of verifications, and even debates between models. It takes time. But the results have been worth it, and I'll keep optimizing for speed wherever it's lossless. The beautiful part: it runs fully automated in a tmux window. Go to bed, go to work, come back to a quality project running.

I hope you cook something amazing. Let us know how it goes.

> [!IMPORTANT]
> **Where things stand:** Kiln works and produces real code. We've been using it to build itself — the agents, skills, and orchestration you see here were written by kiln's own pipeline. Not shipped to npm yet, but the core workflow runs and delivers. Expect rough edges. Help us smooth them.

---

## Recent changes

> [!NOTE]
> **Context Freshness Overhaul** (2026-02-17)
>
> Propagated the wave worker's proven pattern — spawn fresh, read disk, one job, write disk, die — across every agent tier. Context compaction is no longer a failure mode.

- Four-step ephemeral invariant codified in `kiln-core` as the cross-cutting Context Freshness Contract
- Track skill restructured: Single-Step Dispatcher spawns one step, reports, shuts down
- Fire skill now spawns per-step trackers (`tracker-p<N>-<step>`) instead of one tracker per phase
- 5 debate agents get Disk Input Contracts and mandatory shutdown-after-write
- Orchestrator updated with Context Freshness Discipline + 6 deterministic verification checks
- Three compliance tiers: wave workers (gold standard), track-step agents, debate subtask agents

> [!NOTE]
> **Teams Architecture Redesign** (2026-02-16)
>
> Replaced custom YAML state management with Claude Code's native platform primitives. Biggest structural change since the beginning.

- 3 new skills extracted from the orchestrator: `kiln-wave-schedule`, `kiln-copyback`, `kiln-resume`
- Orchestrator went from 584 to 317 lines — delegates details to skills, keeps only routing
- 7 metadata keys via `TaskUpdate` replace 16-key YAML payloads. Wave ordering through `addBlockedBy` sentinels
- Dead worker detection with stage-aware heartbeat thresholds
- Task Retry Ledger in STATE.md — single-writer principle, no concurrent state mutation

---

## Coming soon

> [!TIP]
> **Full customization is on the way.** We're building an onboarding flow that lets you choose your models, tools, planning strategy, review depth, and how deep you want to go in the rabbit hole. Your kiln, your rules.

**Workflow debugger.** Watches how the agent team performs, saves anonymized results, optionally pushes to a branch so we can see where things get stuck. No AI calls from your machine. Completely opt-in.

Terminal UX needs love. The CLI experience should feel refined, not raw. If you're good at making terminals beautiful, come help — you know the target.

**Specialist agents** — a UI agent that understands design systems, a test agent that knows your framework. Deeper skills for specific domains.

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
<td align="center"><b>4</b></td>
<td><b>Execute</b></td>
<td>Each task becomes a surgical prompt, executed with fresh 200k context. Tested and committed atomically.</td>
<td>Code + commits</td>
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

Install, then use four commands:

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

---

## Recommended setup

| Tool | What it adds | Required? |
|------|-------------|-----------|
| [Codex CLI](https://github.com/openai/codex) | GPT-5.2 planning + GPT-5.3-codex execution — this is where kiln's real edge lives | Strongly recommended |
| [Claude Code](https://claude.ai/claude-code) | The engine that runs everything | Yes |
| [Context7](https://github.com/upstash/context7) | Up-to-date library docs via MCP | Optional |
| [Playwright MCP](https://github.com/anthropics/anthropic-quickstarts/tree/main/mcp-playwright) | End-to-end browser testing | Optional |

**1. Install Codex CLI**

Multi-model mode is where kiln shines. Codex CLI gives you GPT-5.2 for planning and GPT-5.3-codex for execution — they think differently than Claude, and that's the whole point.

```bash
npm install -g @openai/codex
```

> [!TIP]
> **Claude-only mode** still runs the full pipeline. Multi-model just catches things a single model family misses.

**2. Run Claude Code with `--dangerously-skip-permissions`**

Kiln spawns agents, reads and writes files, and runs tests constantly. Permission prompts at every step break the flow.

```bash
claude --dangerously-skip-permissions
```

> [!CAUTION]
> Only use this in projects where you trust the pipeline. Kiln never runs destructive commands, but you're giving it the keys.

---

## Deep dives

<details>
<summary><b>Multi-model orchestration</b> — right model, right task</summary>

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

Everything else auto-advances. Wave workers run in parallel git worktrees, each with a read-only `.kiln-snapshot/` of the control plane. They write artifacts to `.kiln-artifacts/`. They never touch the real `.kiln/` directory — a misbehaving worker can't corrupt the orchestrator's state.

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

**Mini-verify** runs your test command after every code change and writes the result to `.kiln/mini-verify-result.json`. The orchestrator reads this to decide: continue or correct.

**Scope guard** skips verification when only `.kiln/` control files changed — no wasted test runs on state updates.

**Injection protection** rejects test commands with shell metacharacters (`;`, `|`, `&`, `>`, `<`, backticks, `$(`) before they reach `sh -c`.

**Single-writer state** — one conductor owns `.kiln/STATE.md` at all times. No concurrent mutation, no matter the mode.

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
| `/kiln:track` | Full loop: plan &rarr; validate &rarr; execute &rarr; E2E &rarr; review &rarr; reconcile |

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

<details>
<summary><b>Project structure</b></summary>

<br>

```
kiln/
├── agents/           13 AI agent definitions
├── skills/           17 skill definitions
├── commands/         8 slash command definitions
├── hooks/            Claude Code lifecycle hooks
│   ├── hooks.json    Session start + mini-verify triggers
│   └── scripts/      on-session-start.sh, on-task-completed.sh
├── templates/        Workspace and state templates
├── bin/install.js    Interactive installer (zero deps)
└── package.json      Zero runtime dependencies
```

After install:
```
your-project/
├── .claude/          Agents, skills, commands, hooks
├── .kiln/            Runtime state (STATE.md, config.json, tracks/)
├── .kiln-snapshot/   (Teams mode) Read-only control-plane for workers
└── .kiln-artifacts/  (Teams mode) Worker-local output before copy-back
```

<br>
</details>

---

<div align="center">

<sub>MIT License · Built with Claude Code + Codex CLI · No wrappers, no servers, just markdown.</sub>

</div>
