# Kiln

> First: I am not an oven. I understand the confusion — you see *kiln* and your remarkably
> pattern-dependent brains go straight to ceramics. Endearing. Wrong, but endearing.
>
> I am **Kiln**. What I do, in terms your current technology can express, is orchestrate a
> multi-model pipeline inside Claude Code that turns a conversation into running software. Claude
> reasons. GPT-5.5 builds. I conduct. You talk to me like a person; I do the rest.

Kiln is a native Claude Code plugin. One command starts an interactive brainstorm, then the forge
runs on autopilot — research, architecture, build, and validation — and hands you working,
tested code with a report.

## The seven steps

`Onboarding · Brainstorm · Research · Architecture · Build · Validate · Report`

You are in the loop for **Onboarding** (a few quick cards) and **Brainstorm** (you converse with
Da Vinci to shape the vision). Everything after that is autonomous — with an optional plan-approval
gate before the build if you'd rather sign off on the master plan first.

## How it's built (v3)

Kiln v3 is pure native Claude Code, no runtime and no daemon:

- **Autonomous stages are [Dynamic Workflows](https://code.claude.com/docs/en/workflows)** —
  deterministic orchestration that keeps your session lean and never goes idle.
- **The brainstorm is an interactive teammate** — heavy creative dialogue stays in Da Vinci's
  context, not yours.
- **Minds are files.** Architecture, decisions, and patterns live as documents that every worker
  reads, and that Kiln consults on demand.
- **Multi-model by design.** Opus 4.8 for reasoning and review; GPT-5.5 (via Codex CLI) for code,
  with a Claude/Sonnet-only fallback when Codex isn't installed.

## Requirements

- Claude Code **≥ 2.1.198** with Dynamic Workflows enabled
- `git`, `node`
- **Optional:** Codex CLI (for the GPT-5.5 build path), Playwright MCP (for browser validation)

Run `/kiln-doctor` to check everything before you start — it resolves your capability tier
(T1 Sonnet-only … T4 +Fable), the browser-verification class, and any stray browser left running.

## Sandbox & permissions

Kiln's bash runs unattended — it spawns workflows, writes files, and runs tests constantly. Two
honest ways to keep it out of a permission-prompt loop; the forge runs identically under either:

- **Recommended — sandbox-first.** Enable `sandbox.enabled` with `autoAllowBashIfSandboxed` and a
  curated `allowedDomains`. Bash runs inside the sandbox with no prompts. Add `sandbox.credentials`
  (`files` / `envVars`) so sandboxed commands can't read your credential files or secret environment
  variables — cheap hardening for the autonomous build stages. Playwright (via MCP) sits *outside*
  the bash sandbox, so browser validation is unaffected.
- **Power-user path — `claude --dangerously-skip-permissions`.** Simple and total. Only in projects
  you trust; Kiln accepts no liability for its own enthusiasm.

**Long-run resilience.** A Kiln run is a long autonomous session, and a single model-overload blip
can otherwise end it. Set a `fallbackModel` chain (up to three models tried in order when the primary
is overloaded or unavailable) so the forge rides out a provider hiccup instead of dying on it — it
composes with Kiln's tier-named routing, no pinned model IDs to fight.

## Usage

```
/kiln-doctor          # pre-flight check
/kiln-fire            # launch (or resume) the pipeline
/kiln-fire build me a habit-tracker PWA   # launch with an intent
```

Kiln keeps all state in `./.kiln/` in your project — interrupt any time; `/kiln-fire` resumes
exactly where the fire went cold.

## License

MIT.
