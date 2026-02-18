# KilnTwo
Multi-model development protocol for Claude Code.

KilnTwo installs a custom slash command protocol into Claude Code to orchestrate a dual-model planning pipeline for software work. The orchestrator, Claude Opus 4.6, runs interactively in Claude Code and coordinates the session from kickoff through delivery. It spawns two planners in parallel: `kw-planner-claude` (Opus) and `kw-planner-codex` (GPT-5.2 via Codex CLI), then routes disagreements through a debater and consolidates results with a synthesizer into a master plan. Execution runs phase-by-phase: each phase produces per-task Codex prompts, executes them sequentially with GPT-5.3-codex, and requires QA review gates with up to three rounds before merge. Session state persists across context resets through memory files in `.kw/`.

## Prerequisites

- Node.js >= 18
  Install: https://nodejs.org
- Claude Code CLI
  Install: `npm install -g @anthropic-ai/claude-code`
- Codex CLI
  Install: `npm install -g @openai/codex`

## Installation

```bash
npm install -g kilntwo
kilntwo install
```

`kilntwo install` copies slash command files into the Claude Code configuration directory for the current user.

## Usage

### /kw:start

Initialize a new KilnTwo session. The orchestrator opens an interactive brainstorm to capture the project goal, constraints, and success criteria before moving to planning.

```
/kw:start
```

### /kw:resume

Resume an existing session after a Claude Code context reset. The orchestrator reads `MEMORY.md` and all other memory files from `.kw/` to restore pipeline state and continue from where it left off.

```
/kw:resume
```

### /kw:reset

Save current pipeline state to memory files and prepare for a context reset. Run this before resetting the Claude Code window when a session is running long.

```
/kw:reset
```

## How it works

1. Initialization and Brainstorm: The orchestrator runs an interactive intake to capture goals, constraints, and success criteria.
2. Planning: The system generates dual plans in parallel, debates disagreements, and synthesizes results into `master-plan.md`.
3. Execution: Work is implemented phase-by-phase through Codex CLI using per-task prompts.
4. Validation: End-to-end tests are executed and a report is written to `.kw/validation/report.md`.
5. Delivery: A final summary is presented to the operator for approval.

## Agent Roster

| Agent | Model | Role |
|---|---|---|
| kw-phase-executor | claude-opus-4-6 | Phase execution coordinator — orchestrates the full plan-prompt-implement-review lifecycle for a single phase |
| kw-planner-claude | claude-opus-4-6 | Claude-side implementation planner — creates detailed plans from project context and memory |
| kw-synthesizer | claude-opus-4-6 | Plan synthesis agent — merges dual plans into a single master plan with atomic implementation steps |
| kw-reviewer | claude-opus-4-6 | Code review agent — reviews phase changes for correctness, completeness, and quality |
| kw-validator | claude-opus-4-6 | E2E validation agent — detects project type, runs full test suite, generates validation report |
| kw-debater | claude-opus-4-5 | Plan debate and resolution agent — identifies disagreements between Claude and Codex plans and resolves them |
| kw-planner-codex | claude-sonnet-4-6 | GPT-5.2 planning agent via Codex CLI — produces alternative implementation plans |
| kw-prompter | claude-sonnet-4-6 | GPT-5.2 prompt generation agent — converts phase plans into atomic task prompts for Codex implementation |
| kw-implementer | claude-sonnet-4-6 | GPT-5.3-codex implementation agent — executes task prompts to write actual code |
| kw-researcher | claude-haiku | Fast documentation and codebase research agent |

## CLI Commands

| Command | Description |
|---|---|
| `kilntwo install` | Copy slash command files into the Claude Code user configuration directory |
| `kilntwo uninstall` | Remove KilnTwo slash command files from the Claude Code user configuration directory |
| `kilntwo update` | Replace installed slash command files with the current package version |
| `kilntwo doctor` | Check that Node.js, Claude Code CLI, and Codex CLI are installed and reachable, and report any issues |

## Architecture

```
kilntwo/
  bin/
    kilntwo.js
  src/
  assets/
    agents/
    protocol.md
```

- `bin/` contains the CLI entry point (`kilntwo.js`) and handles install, uninstall, update, and doctor.
- `src/` contains core library modules loaded by the CLI and slash commands.
- `assets/` contains the protocol definition (`protocol.md`), agent definitions (`agents/`), and slash command templates (`commands/`).

## Troubleshooting

#### `codex: command not found`

Codex CLI is not installed or not on `PATH`. Run `npm install -g @openai/codex` and verify with `codex --version`.

#### Claude Code does not show /kw commands

The slash command files are not installed. Run `kilntwo install` and restart Claude Code. If commands still do not appear, run `kilntwo doctor` to check the configuration directory path.

#### `model_reasoning_effort` flag rejected by Codex

You are running an older Codex CLI version that does not support the `-c` config flag. Upgrade with `npm install -g @openai/codex`.

#### Pipeline halts with "escalate to operator"

A phase failed three QA review rounds without passing. Open `.kw/reviews/fix_round_3.md` to read the specific failures, make manual corrections, then run `/kw:resume` to continue.

## License

MIT
