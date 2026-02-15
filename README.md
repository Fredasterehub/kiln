<div align="center">

# kiln

**Autonomous software delivery for Claude Code**

[![License: MIT](https://img.shields.io/badge/License-MIT-D4A574?style=flat-square)](LICENSE)&nbsp;
[![Node](https://img.shields.io/badge/Node-18+-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)&nbsp;
[![Claude Code](https://img.shields.io/badge/Claude_Code-Native-7C3AED?style=flat-square&logo=anthropic&logoColor=white)](https://claude.ai/claude-code)&nbsp;
[![Zero Deps](https://img.shields.io/badge/Dependencies-Zero-2ea44f?style=flat-square)]()

> *"What is to give light must endure burning."*
> — Viktor Frankl

</div>

<br/>

> **Honest status:** Kiln works and produces real code. We've been using it to build itself — the agents, skills, and orchestration you see here were written by kiln's own multi-model pipeline. Two QA rounds complete, all path references verified, security hardened, snapshot isolation landed. The installer hasn't shipped to npm yet, but the core workflow runs and delivers. Expect rough edges. Help us smooth them.

<br/>

## What is this

Kiln is a workflow that turns Claude Code into a self-running software factory. You describe what you want to build, and it handles everything else — brainstorming, planning, implementation, testing, review, documentation — across multiple AI models, with no human intervention required between stages.

It's not a wrapper around Claude Code. It's not a server. It's a collection of markdown files — agents, skills, and hooks — that get installed into your project and teach Claude Code how to orchestrate a full delivery pipeline. When you type `/kiln:fire`, it creates a team of AI agents, each with a specific role, and runs them through a structured sequence until your project is built.

The ideas come from real projects that each solved a piece of the puzzle: [BMAD Method](https://github.com/bmadcode/BMAD-METHOD) for structured brainstorming, [GSD](https://github.com/cyanheads/claude-code-gsd) for fresh-context execution, and [Google's Conductor research](https://research.google/blog/automated-unit-test-improvement-using-large-language-models-at-google/) for just-in-time task writing. Kiln combines them into one pipeline that actually runs.

```
npx kiln-dev
```

> **Not published to npm yet.** This will work once we ship. For now, clone the repo and install manually.

<br/>

## Recommended setup

Kiln works best when Claude Code can operate with minimal friction. Two things make a real difference:

**1. Run Claude Code with `--dangerously-skip-permissions`**

Kiln orchestrates agents, spawns teams, reads and writes files, and runs verification commands constantly. Permission prompts at every step break the flow and defeat the purpose of autonomous delivery. For the best experience:

```bash
claude --dangerously-skip-permissions
```

> This grants full tool access. Only use this in projects where you trust the pipeline. Kiln never runs destructive commands, but you're giving it the keys.

**2. Install Codex CLI (strongly recommended)**

Multi-model mode is where Kiln shines. Codex CLI gives you access to GPT-5.2 (planning and sharpening) and GPT-5.3-codex (execution) — models that complement Claude's strengths with different reasoning styles. Without it, Kiln falls back to Claude-only mode, which works but misses the dual-perspective advantage.

```bash
npm install -g @openai/codex
```

If Codex CLI was not detected during install, enable multi-model mode later in `.kiln/config.json`:

```json
{
  "modelMode": "multi-model"
}
```

> **Claude-only mode** still runs the full pipeline. Multi-model is the premium path — it catches things a single model family misses.

<br/>

## Get started

Install, then use four commands:

<table>
<tr>
<td width="50%">

```
/kiln:fire
```
Light the kiln — start or resume the full automated pipeline

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

<br/>

## How it works

Your project flows through six stages. The first two are interactive — you and the AI shape the vision together. The rest run autonomously, repeating per phase until everything ships. At each transition, the kiln displays a curated quote — a small moment of reflection between stages of the fire.

<table>
<tr>
<td align="center" width="33"><b>#</b></td>
<td><b>Stage</b></td>
<td><b>What happens</b></td>
<td><b>Output</b></td>
</tr>
<tr>
<td align="center">1</td>
<td><b>Brainstorm</b></td>
<td>You and the AI explore the problem space together. Anti-clustering, challenge passes, structured divergence &mdash; borrowed from BMAD.</td>
<td><code>VISION.md</code></td>
</tr>
<tr>
<td align="center">2</td>
<td><b>Roadmap</b></td>
<td>The vision gets broken into delivery phases. You review and approve before anything moves.</td>
<td><code>ROADMAP.md</code></td>
</tr>
<tr>
<td align="center">3</td>
<td><b>Plan</b></td>
<td>Two models plan independently. Optional debate rounds. A synthesizer merges the best of both. Tasks are written just-in-time with real codebase context &mdash; the Conductor insight.</td>
<td><code>PLAN.md</code></td>
</tr>
<tr>
<td align="center">4</td>
<td><b>Execute</b></td>
<td>Each task is sharpened into a surgical prompt and executed with fresh 200k context. Mini-verified, committed atomically. In Teams mode, wave workers run in parallel via git worktrees.</td>
<td>Code + commits</td>
</tr>
<tr>
<td align="center">5</td>
<td><b>Verify</b></td>
<td>E2E tests run your actual app. Opus reviews across 7 quality dimensions. Up to 3 correction cycles before it ships.</td>
<td><code>e2e-results.md</code></td>
</tr>
<tr>
<td align="center">6</td>
<td><b>Reconcile</b></td>
<td>Living docs get updated with what actually happened. The next phase inherits real context, not stale assumptions.</td>
<td><code>PATTERNS</code> <code>DECISIONS</code> <code>PITFALLS</code></td>
</tr>
</table>

> Stages 3-6 repeat per phase. The 20th task fires with the same precision as the first.

<br/>

<details>
<summary>&nbsp;<b>Multi-model orchestration</b>&nbsp;&mdash;&nbsp;<i>right model, right task</i></summary>

<br/>

Each model has a temperature it fires best at. Kiln applies the right heat at the right moment.

<table>
<tr><td><b>Role</b></td><td><b>Model</b></td><td><b>Why</b></td></tr>
<tr><td>Orchestrator</td><td>Opus 4.6</td><td>Deep reasoning for routing</td></tr>
<tr><td>Planner</td><td>Opus 4.6</td><td>Architectural vision, edge cases</td></tr>
<tr><td>Codex Planner</td><td>GPT-5.2</td><td>Catches details Opus glosses over</td></tr>
<tr><td>Synthesizer</td><td>Opus 4.6</td><td>Judgment calls on merging</td></tr>
<tr><td>Sharpener</td><td>GPT-5.2-high</td><td>Prompt engineering for downstream execution</td></tr>
<tr><td>Executor</td><td>GPT-5.3-codex</td><td>Atomic task beast mode</td></tr>
<tr><td>Reviewer</td><td>Opus 4.6</td><td>7-dimension code review</td></tr>
<tr><td>Codex Reviewer</td><td>GPT-5.3-codex-sparks</td><td>Independent review for debate mode</td></tr>
<tr><td>Wave Worker</td><td>Sonnet 4.5</td><td>Parallel task execution in Teams mode</td></tr>
<tr><td>Validator</td><td>Sonnet 4.5</td><td>Fast mechanical checking</td></tr>
<tr><td>E2E Verifier</td><td>Sonnet 4.5</td><td>Test generation and execution</td></tr>
<tr><td>Researcher</td><td>Haiku 4.5</td><td>Fast, cheap retrieval</td></tr>
<tr><td>Brainstormer</td><td>Opus 4.6</td><td>Creative exploration</td></tr>
</table>

> **No Codex CLI?** Kiln falls back to Claude-only mode. The full pipeline still runs. Multi-model is the premium path, not a requirement.

<br/>
</details>

<details>
<summary>&nbsp;<b>Debate mode</b>&nbsp;&mdash;&nbsp;<i>models argue before they agree</i></summary>

<br/>

Default synthesis is polite: each model plans in isolation, then a mediator merges. Debate mode makes them **argue**.

The models critique each other, defend their choices, concede when wrong, and only then does the synthesizer merge — with the full argument trail as context.

Works for both **planning** and **code review**. Toggle in `.kiln/config.json`:

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

<br/>
</details>

<details>
<summary>&nbsp;<b>Teams-first orchestration</b>&nbsp;&mdash;&nbsp;<i>the Athanor pattern</i></summary>

<br/>

When you type `/kiln:fire`, Kiln creates a Claude Code Team. Your session becomes the team lead — a thin orchestrator that spawns teammates, watches them work, and advances the pipeline automatically.

The name comes from alchemy: an *athanor* is a self-feeding furnace. Once lit, it maintains its own heat. That's what happens here — after you approve the vision and roadmap (the only two human gates), the kiln runs itself through planning, execution, verification, review, and reconciliation. Each transition emits a curated quote from the lore system — 90 quotes drawn from philosophy, science, and world traditions.

Three hard gates require your attention:
1. **Vision approval** — you shape the brainstorm, you approve what gets built
2. **Roadmap approval** — you review the delivery phases before execution begins
3. **Reconcile confirmation** — you confirm documentation updates between phases

Everything else auto-advances. Teammates report completion via SendMessage, the orchestrator updates state, emits a transition message, and spawns the next stage.

Under the hood, wave workers run in parallel git worktrees with **read-only snapshot isolation** — each worker receives a `.kiln-snapshot/` directory with copies of the control-plane files it needs, and writes artifacts to `.kiln-artifacts/`. Workers never touch the real `.kiln/` directory. This eliminates any mutation blast radius: a misbehaving worker cannot corrupt the orchestrator's state.

```json
{
  "preferences": {
    "useTeams": true,
    "waveParallelism": 3
  }
}
```

> **No Teams API?** Kiln falls back to sequential execution. Teams is the fast path, not a requirement.

<br/>
</details>

<details>
<summary>&nbsp;<b>Safety and verification</b>&nbsp;&mdash;&nbsp;<i>trust but verify, automatically</i></summary>

<br/>

Kiln includes several layers of protection that run without configuration:

**Mini-verify** hooks into Claude Code's PostToolUse lifecycle. After every code change, it runs your project's test command (if configured) and writes a durable JSON result to `.kiln/mini-verify-result.json`. The orchestrator can read this to decide whether to continue or correct.

**Scope guard** prevents mini-verify from firing when only `.kiln/` control files changed — no wasted test runs on state updates.

**Command injection protection** rejects test commands containing shell metacharacters (`;`, `|`, `&`, `>`, `<`, backticks, `$(`) before they reach `sh -c`. If someone puts `npm test; rm -rf /` in config, it gets caught and skipped.

**Filesystem-safe task IDs** replace colons with dashes when constructing directory paths, so `phase-1:exec:wave-1:task-1` becomes `phase-1-exec-wave-1-task-1` on disk. This prevents path issues on Windows and macOS.

**Conductor role clarity** defines exactly who manages state in each mode:
- *Teams mode:* your Claude Code session (the team lead) is the conductor
- *Non-Teams mode:* the orchestrator agent running `/kiln:track` is the conductor
- In both cases, a single writer owns `.kiln/STATE.md` — no concurrent mutation.

<br/>
</details>

<details>
<summary>&nbsp;<b>All commands</b></summary>

<br/>

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

<br/>
</details>

<details>
<summary>&nbsp;<b>Install options</b></summary>

<br/>

```bash
npx kiln-dev                              # current project
npx kiln-dev --repo-root /path/to/project # specific repo
npx kiln-dev --yes                        # non-interactive
npx kiln-dev --global                     # global (~/.claude/)
```

**Requires:** Claude Code, Node.js 18+<br/>
**Strongly recommended:** Codex CLI (enables multi-model mode), `--dangerously-skip-permissions` flag

<br/>
</details>

<details>
<summary>&nbsp;<b>Tips for best results</b></summary>

<br/>

- **Start small.** Your first kiln run should be a well-scoped feature, not "rewrite the whole app." The pipeline learns from reconciliation — each phase builds context for the next.

- **Write a good initial description.** The brainstorm stage amplifies what you give it. "Build a CLI tool that converts markdown to PDF" gives better results than "make a tool."

- **Trust the gates.** Vision and roadmap approvals exist so you can course-correct early. Read them carefully. Rejecting a bad roadmap saves hours of misdirected execution.

- **Use multi-model mode.** Claude and GPT reason differently. When both plan the same feature, the synthesizer catches blind spots neither would find alone. This is where Kiln's real edge lives.

- **Let it fail.** Mini-verify and correction cycles exist for a reason. The pipeline self-corrects up to 3 times per task. If something still fails, the orchestrator halts cleanly and tells you what went wrong.

- **Check `.kiln/STATE.md`.** This is your live dashboard. It shows the current stage, phase, and any errors. If you're wondering what happened, start here.

- **Don't fight the structure.** Kiln creates `.kiln/` for state, writes to `tracks/` for plans, and commits atomically. Working with these conventions instead of around them keeps everything clean.

<br/>
</details>

<details>
<summary>&nbsp;<b>Lineage</b>&nbsp;&mdash;&nbsp;<i>where the ideas came from</i></summary>

<br/>

Kiln doesn't start from scratch. It stands on the shoulders of three projects that each solved a piece of the puzzle:

| Source | What we took | What we left |
|--------|-------------|-------------|
| [BMAD Method](https://github.com/bmadcode/BMAD-METHOD) | Structured brainstorming, anti-clustering, challenge passes | Full persona framework |
| [GSD Framework](https://github.com/cyanheads/claude-code-gsd) | Fresh context per task, goal-backward verification, execution efficiency | External tracking layer |
| [Google Conductor](https://research.google/blog/automated-unit-test-improvement-using-large-language-models-at-google/) | Just-in-time task writing, living docs, reconciliation loops | Infrastructure overhead |

The combination turns out to be more than the sum of its parts. BMAD gives you a vision worth building. GSD keeps each task sharp and isolated. Conductor makes sure you're never planning with stale context.

<br/>
</details>

<details>
<summary>&nbsp;<b>Project structure</b></summary>

<br/>

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

After install, your project gets:
```
your-project/
├── .claude/          Agents, skills, commands, hooks, templates
├── .kiln/            Runtime state (STATE.md, config.json, tracks/)
├── .kiln-snapshot/   (Teams mode) Read-only control-plane copy for workers
└── .kiln-artifacts/  (Teams mode) Worker-local output before copy-back
```

<br/>
</details>

<br/>

<div align="center">

<sub>MIT License &middot; Built with Claude Code + Codex CLI &middot; No wrappers, no servers, just markdown.</sub>

</div>
