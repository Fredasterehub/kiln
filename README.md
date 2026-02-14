# kiln-dev

Multi-model orchestration workflow for Claude Code.

## What Is Kiln?

Kiln provides an opinionated workflow for shipping software with structured AI collaboration:

- Brainstorming sessions that produce a clear project vision
- Phase-based planning and execution loops
- Verification and review passes to catch regressions
- Reconciliation of docs and project state after each phase

When you run the installer, kiln copies agents, skills, hooks, and templates into your project.

## Quick Start

```bash
npx kiln-dev
```

This installs kiln assets into your repository's `.claude/` and `.kiln/` directories.

## Requirements

- Claude Code
- Node.js 18+
- Optional: Codex CLI for multi-model challenge passes

## Usage

After installation, run these slash commands in Claude Code:

| Command | Description |
| --- | --- |
| `/kiln:init` | Detect tooling, initialize `.kiln/`, and configure the project |
| `/kiln:brainstorm` | Build or refine project vision artifacts |
| `/kiln:roadmap` | Convert vision into phased implementation tracks |
| `/kiln:track` | Execute a track end-to-end (plan, build, verify, review, reconcile) |
| `/kiln:status` | Show current kiln state and project progress |
| `/kiln:quick` | Run a reduced single-pass flow for small tasks |

## Install Options

```bash
# Install into current project
npx kiln-dev

# Install into a specific repository
npx kiln-dev --repo-root /path/to/repo

# Non-interactive mode
npx kiln-dev --yes

# Install into ~/.claude
npx kiln-dev --global
```

## Model Modes

- Multi-model mode: uses Claude + GPT workflows when Codex CLI is available
- Claude-only mode: defaults to Claude-driven flows when Codex is unavailable

## License

MIT
