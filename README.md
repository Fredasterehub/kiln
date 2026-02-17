<div align="center">

# kiln

**Autonomous software delivery for Claude Code**

[![License](https://img.shields.io/badge/License-MIT-D4A574?style=for-the-badge)](LICENSE)
[![Node](https://img.shields.io/badge/Node-18+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Claude Code](https://img.shields.io/badge/Claude_Code-Native-7C3AED?style=for-the-badge&logo=anthropic&logoColor=white)](https://claude.ai/claude-code)
[![Dependencies](https://img.shields.io/badge/Dependencies-Zero-2ea44f?style=for-the-badge)]()

<br>

```
npx kiln-dev
```

> Not published to npm yet. Clone and install manually for now.

<br>

*"What is to give light must endure burning."* — Viktor Frankl

<br>

[Why I Built This](#why-i-built-this) · [How It Works](#how-it-works) · [Get Started](#get-started) · [Setup](#recommended-setup) · [Deep Dives](#deep-dives) · [Commands](#all-commands)

</div>

---

## Why I built this

This is for people who want to kick off projects solo and still deliver high-quality MVPs or full builds.

Kiln is now my daily driver for project development. I spend some good time brainstorming the idea, then I let the oven cook. Check back on the working prototype and finish tweaking, usually directly in Claude Code. That's the whole loop from my side.

You will spend real time during the brainstorm session — back and forth, deeply defining, articulating, and organizing your vision. This is your investment, and where most of your ROI will come from. You can zoom through or really take the time to go deep. The choice is yours.

Once the brainstorm is done — where all your input has been challenged, verified, and shaped into a concrete vision — kiln takes care of the rest. It creates a global plan that's more of a direction than a detailed PRD (those suffer from implementation drift eventually). From that plan, it iterates each phase rigorously: atomically splitting them into optimal task sizes and sharpened prompts so that GPT-5.3-codex can really shine. Deterministic verifications run after each task. Once the whole phase is done, Opus 4.6 runs a QA review with end-to-end tests — and if it finds issues, the correction loops all the way back through GPT-5.2 for re-sharpening before GPT-5.3-codex implements the fix. Opus reviews again. Those cycles are capped at 3. If after 3 rounds three state-of-the-art models can't fix the problem, there's a bigger issue at play.

I won't lie — there are a lot of steps, verifications, and even debates, so it can take a while to run. But the results have really been worth it. I'll optimize for speed everywhere we can, as long as it's lossless. And the beautiful part is that it's fully automated in a tmux window: you can literally go to bed or to work and come back to a quality project running.

There's a lot we can expand and improve throughout the whole loop, and I'll tackle it with method, slowly but surely. I hope you have a good experience and manage to cook amazing projects. Let us know.

> **Honest status:** Kiln works and produces real code. We've been using it to build itself — the agents, skills, and orchestration you see here were written by kiln's own multi-model pipeline. The installer hasn't shipped to npm yet, but the core workflow runs and delivers. Expect rough edges. Help us smooth them.

---

## How it works

It's not a wrapper. It's not a server. It's a collection of markdown files — agents, skills, and hooks — that get installed into your project and teach Claude Code how to orchestrate a full delivery pipeline.

Two stages are interactive. The rest run autonomously, repeating per phase until everything ships.

<table>
<tr>
<td align="center" width="40"><b>1</b></td>
<td width="120"><b>Brainstorm</b></td>
<td>You and the AI explore the problem space together. Anti-clustering, challenge passes, structured divergence.</td>
<td width="120"><code>VISION.md</code></td>
</tr>
<tr>
<td align="center"><b>2</b></td>
<td><b>Roadmap</b></td>
<td>The vision gets broken into delivery phases. You review and approve before anything moves.</td>
<td><code>ROADMAP.md</code></td>
</tr>
<tr><td colspan="4"></td></tr>
<tr>
<td align="center"><b>3</b></td>
<td><b>Plan</b></td>
<td>Two models plan independently. Optional debate rounds. A synthesizer merges the best of both.</td>
<td><code>PLAN.md</code></td>
</tr>
<tr>
<td align="center"><b>4</b></td>
<td><b>Execute</b></td>
<td>Each task is sharpened into a surgical prompt and executed with fresh 200k context. Mini-verified, committed atomically.</td>
<td>Code + commits</td>
</tr>
<tr>
<td align="center"><b>5</b></td>
<td><b>Verify</b></td>
<td>E2E tests run your actual app. Opus reviews across 7 quality dimensions. Up to 3 correction cycles.</td>
<td><code>e2e-results.md</code></td>
</tr>
<tr>
<td align="center"><b>6</b></td>
<td><b>Reconcile</b></td>
<td>Living docs get updated with what actually happened. The next phase inherits real context, not stale assumptions.</td>
<td><code>PATTERNS</code> <code>DECISIONS</code></td>
</tr>
</table>

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

**Optimal stack:** Claude Code + Codex CLI + [Context7](https://github.com/upstash/context7) + [Playwright MCP](https://github.com/anthropics/anthropic-quickstarts/tree/main/mcp-playwright) for end-to-end validations. Context7 and Playwright MCP integration into the installer is coming soon.

**1. Run Claude Code with `--dangerously-skip-permissions`**

Kiln orchestrates agents, spawns teams, reads and writes files, and runs verification commands constantly. Permission prompts at every step break the flow.

```bash
claude --dangerously-skip-permissions
```

> Only use this in projects where you trust the pipeline. Kiln never runs destructive commands, but you're giving it the keys.

**2. Install Codex CLI (strongly recommended)**

Multi-model mode is where Kiln shines. Codex CLI gives you access to GPT-5.2 (planning and sharpening) and GPT-5.3-codex (execution) — models that complement Claude's strengths with different reasoning styles.

```bash
npm install -g @openai/codex
```

> **Claude-only mode** still runs the full pipeline. Multi-model is the premium path — it catches things a single model family misses.

---

## Deep dives

<details>
<summary><b>Multi-model orchestration</b> — right model, right task</summary>

<br>

Each model has a temperature it fires best at. Kiln applies the right heat at the right moment.

| Role | Model | Why |
|------|-------|-----|
| Orchestrator | Opus 4.6 | Deep reasoning for routing |
| Planner | Opus 4.6 | Architectural vision, edge cases |
| Codex Planner | GPT-5.2 | Catches details Opus glosses over |
| Synthesizer | Opus 4.6 | Judgment calls on merging |
| Sharpener | GPT-5.2-high | Prompt engineering for execution |
| Executor | GPT-5.3-codex | Atomic task beast mode |
| Reviewer | Opus 4.6 | 7-dimension code review |
| Codex Reviewer | GPT-5.3-codex-sparks | Independent review for debate mode |
| Wave Worker | Sonnet 4.5 | Parallel execution in Teams mode |
| Validator | Sonnet 4.5 | Fast mechanical checking |
| E2E Verifier | Sonnet 4.5 | Test generation and execution |
| Researcher | Haiku 4.5 | Fast, cheap retrieval |
| Brainstormer | Opus 4.6 | Creative exploration |

> **No Codex CLI?** Kiln falls back to Claude-only mode. The full pipeline still runs.

<br>
</details>

<details>
<summary><b>Debate mode</b> — models argue before they agree</summary>

<br>

Default synthesis is polite: each model plans in isolation, then a mediator merges. Debate mode makes them **argue**.

The models critique each other, defend their choices, concede when wrong, and only then does the synthesizer merge — with the full argument trail as context.

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

> Rounds auto-terminate on convergence. Every critique is preserved as an audit artifact.

<br>
</details>

<details>
<summary><b>Teams-first orchestration</b> — the Athanor pattern</summary>

<br>

When you type `/kiln:fire`, Kiln creates a Claude Code Team. Your session becomes the team lead — a thin orchestrator that spawns teammates, watches them work, and advances the pipeline automatically.

The name comes from alchemy: an *athanor* is a self-feeding furnace. Once lit, it maintains its own heat. After you approve the vision and roadmap (the only two human gates), the kiln runs itself through planning, execution, verification, review, and reconciliation. Each transition emits a curated quote from the lore system — 90 quotes drawn from philosophy, science, and world traditions.

Three hard gates require your attention:
1. **Vision approval** — you shape the brainstorm, you approve what gets built
2. **Roadmap approval** — you review the delivery phases before execution begins
3. **Reconcile confirmation** — you confirm documentation updates between phases

Everything else auto-advances. Under the hood, wave workers run in parallel git worktrees with **read-only snapshot isolation** — each worker receives a `.kiln-snapshot/` directory with copies of the control-plane files it needs, and writes artifacts to `.kiln-artifacts/`. Workers never touch the real `.kiln/` directory.

```json
{
  "preferences": {
    "useTeams": true,
    "waveParallelism": 3
  }
}
```

> **No Teams API?** Kiln falls back to sequential execution. Teams is the fast path, not a requirement.

<br>
</details>

<details>
<summary><b>Safety and verification</b> — trust but verify, automatically</summary>

<br>

**Mini-verify** hooks into Claude Code's PostToolUse lifecycle. After every code change, it runs your project's test command and writes a durable JSON result to `.kiln/mini-verify-result.json`.

**Scope guard** prevents mini-verify from firing when only `.kiln/` control files changed — no wasted test runs on state updates.

**Command injection protection** rejects test commands containing shell metacharacters (`;`, `|`, `&`, `>`, `<`, backticks, `$(`) before they reach `sh -c`.

**Filesystem-safe task IDs** replace colons with dashes when constructing directory paths, so `phase-1:exec:wave-1:task-1` becomes `phase-1-exec-wave-1-task-1` on disk.

**Single-writer state** — one conductor owns `.kiln/STATE.md` at all times. No concurrent mutation, whether you're in Teams mode or not.

<br>
</details>

<details>
<summary><b>Tips for best results</b></summary>

<br>

- **Start small.** Your first kiln run should be a well-scoped feature, not "rewrite the whole app." The pipeline learns from reconciliation — each phase builds context for the next.

- **Write a good initial description.** The brainstorm stage amplifies what you give it. "Build a CLI tool that converts markdown to PDF" gives better results than "make a tool."

- **Trust the gates.** Vision and roadmap approvals exist so you can course-correct early. Read them carefully. Rejecting a bad roadmap saves hours of misdirected execution.

- **Use multi-model mode.** Claude and GPT reason differently. When both plan the same feature, the synthesizer catches blind spots neither would find alone. This is where Kiln's real edge lives.

- **Let it fail.** Mini-verify and correction cycles exist for a reason. The pipeline self-corrects up to 3 times per task. If something still fails, the orchestrator halts cleanly and tells you what went wrong.

- **Check `.kiln/STATE.md`.** This is your live dashboard. It shows the current stage, phase, and any errors. If you're wondering what happened, start here.

<br>
</details>

<details>
<summary><b>Lineage</b> — where the ideas came from</summary>

<br>

| Source | What we took | What we left |
|--------|-------------|-------------|
| [BMAD Method](https://github.com/bmadcode/BMAD-METHOD) | Structured brainstorming, anti-clustering, challenge passes | Full persona framework |
| [GSD Framework](https://github.com/cyanheads/claude-code-gsd) | Fresh context per task, goal-backward verification | External tracking layer |
| [Google Conductor](https://research.google/blog/automated-unit-test-improvement-using-large-language-models-at-google/) | Just-in-time task writing, living docs, reconciliation | Infrastructure overhead |

The combination turns out to be more than the sum of its parts.

<br>
</details>

---

## All commands

| Command | Description |
|---------|-------------|
| `/kiln:fire` | Light the kiln — start or resume the full automated pipeline |
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
npx kiln-dev                              # current project
npx kiln-dev --repo-root /path/to/project # specific repo
npx kiln-dev --yes                        # non-interactive
npx kiln-dev --global                     # global (~/.claude/)
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

## Coming soon

- **Integrated debugger** — saves anonymized workflow results and optionally pushes to a branch for analysis. Completely optional, no AI models called from your machine.
- **UI/UX refinements** — if you have experience harnessing the terminal and Claude Code to achieve polished interfaces, help is welcome.
- **Specialized agents** — dedicated models and skills for specific task types like UI/UX implementation.
- **Full installer** with better onboarding and MCP server integration.

---

## Recent changes

**Teams Architecture Redesign** (2026-02-16)

Replaced custom YAML state management with Claude Code's native platform primitives. Biggest structural update since initial release.

- **3 new skills extracted** from the orchestrator: `kiln-wave-schedule`, `kiln-copyback`, `kiln-resume`
- **Orchestrator slimmed 46%** (584 to 317 lines) — delegates protocol details to skills, keeps only routing logic
- **Platform-native task coordination** — 7 metadata keys via `TaskUpdate` replace 16-key YAML payloads. Wave ordering via `addBlockedBy` sentinel tasks
- **Dead worker detection** — stage-aware heartbeat thresholds with configurable override
- **Task Retry Ledger** in STATE.md for single-writer retry tracking

---

<div align="center">

<sub>MIT License · Built with Claude Code + Codex CLI · No wrappers, no servers, just markdown.</sub>

</div>
