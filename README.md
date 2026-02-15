<div align="center">

# kiln

**A multi-model orchestration workflow for Claude Code**

[![License: MIT](https://img.shields.io/badge/License-MIT-D4A574?style=flat-square)](LICENSE)&nbsp;
[![Node](https://img.shields.io/badge/Node-18+-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)&nbsp;
[![Claude Code](https://img.shields.io/badge/Claude_Code-Native-7C3AED?style=flat-square&logo=anthropic&logoColor=white)](https://claude.ai/claude-code)&nbsp;
[![Zero Deps](https://img.shields.io/badge/Dependencies-Zero-2ea44f?style=flat-square)]()

</div>

<br/>

## What is this

Kiln is the result of months spent trying to build real apps efficiently with AI coding tools. Along the way, a few projects stood out — each brilliant at one thing, but none doing the whole job.

[BMAD Method](https://github.com/bmadcode/BMAD-METHOD) has an incredible brainstorming process — structured divergence, anti-clustering, challenge passes — that produces visions you actually want to build. [GSD](https://github.com/cyanheads/claude-code-gsd) nails the execution loop — fresh context per task, goal-backward verification, no context rot. [Google Conductor](https://research.google/blog/automated-unit-test-improvement-using-large-language-models-at-google/) brought the insight that you shouldn't plan 76 tasks upfront — you write each task precisely at the moment of execution, with real codebase context, not stale assumptions.

Kiln combines the best of all three into a single workflow. And we're lucky: almost everything it needs is now native to Claude Code — agents, skills, hooks, teams. No wrappers, no servers. Just markdown files that teach your AI how to deliver.

```
npx kiln-dev
```

<br/>

## Get started

Install, then use four commands:

<table>
<tr>
<td width="50%">

```
/kiln:fire
```
Start a new project or resume where you left off

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

Your project flows through six stages. The first two are interactive — you shape the vision together. The rest run autonomously, repeating per phase until everything ships.

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
<tr><td>Sharpener</td><td>Opus 4.6</td><td>Prompt engineering for downstream execution</td></tr>
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
<summary>&nbsp;<b>Teams mode</b>&nbsp;&mdash;&nbsp;<i>parallel execution with isolated worktrees</i></summary>

<br/>

Teams mode uses Claude Code's native Teams API to run wave workers in parallel. Each task gets its own git worktree with a symlinked control plane, executes independently, and reports back for deterministic copy-back to main.

Three stages gain Teams coordination:

- **PLAN** &mdash; Claude and Codex plan simultaneously, debate optionally, then synthesize
- **EXECUTE** &mdash; Wave workers run in parallel (configurable via `waveParallelism`), each in an isolated worktree with explicit mini-verify
- **REVIEW** &mdash; Opus and Codex review independently, then debate findings

```json
{
  "preferences": {
    "useTeams": true,
    "waveParallelism": 3,
    "executeConcurrency": "worktree"
  }
}
```

> **No Teams API?** Kiln runs everything sequentially. Teams is the fast path, not a requirement.

<br/>
</details>

<details>
<summary>&nbsp;<b>All commands</b></summary>

<br/>

| Command | Description |
|---------|-------------|
| `/kiln:fire` | Start new work or resume from STATE.md |
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
**Optional:** Codex CLI (enables multi-model mode)

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
├── skills/           16 skill definitions
├── commands/         8 slash command definitions
├── hooks/            Claude Code lifecycle hooks
│   ├── hooks.json
│   └── scripts/
├── templates/        Workspace templates
├── bin/install.js    Interactive installer
└── package.json      Zero runtime dependencies
```

<br/>
</details>

<br/>

<div align="center">

<sub>MIT License &middot; Built with Claude Code &middot; No wrappers, no servers, just markdown.</sub>

</div>
