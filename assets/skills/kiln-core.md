# Kiln Core Reference

Single source of truth for shared schema used across all Kiln agents and commands.

## Path Contract

All runtime paths follow this contract:

- `PROJECT_PATH`: absolute path to the active project root.
- `KILN_DIR`: `$PROJECT_PATH/.kiln` — all pipeline artifacts live here.
- `CLAUDE_HOME`: `$HOME/.claude`.
- `MEMORY_DIR`: `$CLAUDE_HOME/projects/$ENCODED_PATH/memory`.
- `ENCODED_PATH`: `PROJECT_PATH` with `/` replaced by `-` (e.g. `/DEV/myapp` becomes `-DEV-myapp`).
- Claude-side install assets: `$CLAUDE_HOME/kilntwo/...`.

All git operations MUST use `git -C $PROJECT_PATH`. Never use root-relative paths. Anchor filesystem paths to either `$PROJECT_PATH` (project artifacts) or `$HOME` (Claude memory/install artifacts).

## Memory Schema

**Required fields** in `MEMORY.md`:
- `project_name`, `project_path`, `project_mode: greenfield | brownfield`, `date_started`, `last_updated`
- `stage`: `brainstorm | planning | execution | validation | complete`
- `status`: `in_progress | paused | blocked | complete`
- `planning_sub_stage`: `dual_plan | debate | synthesis | null`
- `debate_mode`: `1 | 2 | 3`
- `phase_number`, `phase_name`, `phase_total`
- `handoff_note` — single-line routing hint, < 120 chars
- `handoff_context` — multi-line narrative block (YAML `|` block scalar)
**Phase status entries** under `## Phase Statuses`:
`- phase_number: <int> | phase_name: <string> | phase_status: <pending|in_progress|failed|completed>`

**Optional fields**: `plan_approved_at`, `completed_at`, `correction_cycle` (integer 0-3; absent is treated as 0)
**Optional sections**: `## Phase Results`, `## Validation`, `## Reset Notes`, `## Correction Log`
**Optional memory files**: `tech-stack.md` (living inventory updated during reconciliation)

## Config Schema

`$KILN_DIR/config.json` controls runtime tunables and tooling hints.

```json
{
  "model_mode": "multi-model",
  "preferences": {
    "debate_mode": 2,
    "debate_rounds_max": 3,
    "review_rounds_max": 3,
    "correction_cycles_max": 3,
    "codex_timeout": 600,
    "phase_size_hours_min": 1,
    "phase_size_hours_max": 4
  },
  "tooling": {
    "test_runner": null,
    "linter": null,
    "type_checker": null,
    "build_system": null,
    "package_manager": null
  }
}
```

Field notes:
- `model_mode`: execution model selection (`multi-model` by default).
- `preferences.debate_mode`: default planning debate mode (`2` focused).
- `preferences.debate_rounds_max`: max critique/revise rounds for Mode 3 debate (`3`).
- `preferences.review_rounds_max`: max QA rounds per phase (`3`).
- `preferences.correction_cycles_max`: max validation correction cycles (`3`).
- `preferences.codex_timeout`: minimum Codex timeout in seconds (`600`).
- `preferences.phase_size_hours_min` / `phase_size_hours_max`: planning phase sizing targets (`1-4` hours).
- `tooling.*`: optional auto-detected commands/systems for brownfield projects.

## ANSI Rendering

All Kiln stage/phase transitions MUST be rendered via `Bash printf` commands with ANSI escape codes. Never render transitions as plain markdown text.

### Color Palette

| Purpose | ANSI Code | Visual |
|---|---|---|
| Brand `[kiln]` | `38;5;173` | Warm terracotta |
| Quote text | `38;5;222` | Warm gold |
| Dividers + titles | `38;5;179` | Muted gold |
| Success | `32` | Green |
| Failure | `31` | Red |
| Warning | `33` | Yellow |
| Dim/secondary | `2` | Faint |
| Gray | `90` | Gray |

### Status Symbols

| State | Symbol | Color |
|---|---|---|
| Complete | `✓` | Green (`32`) |
| Active | `►` | Terracotta (`38;5;173`) |
| Failed | `✗` | Red (`31`) |
| Pending | `○` | Gray (`90`) |
| Paused | `⏸` | Terracotta (`38;5;173`) |

### Transition Banner Template

At every pipeline transition point, the orchestrator renders a banner via Bash:

```bash
printf '\n\033[38;5;179m━━━ %s ━━━\033[0m\n\033[38;5;222m"%s"\033[0m \033[2m— %s\033[0m\n\n' \
  "$TITLE" "$QUOTE_TEXT" "$QUOTE_SOURCE"
```

Where:
- `$TITLE` = transition name (e.g., "Ignition", "Brainstorm", "Phase 2 — API Integration")
- `$QUOTE_TEXT` = random quote text from the matching `lore.json` section
- `$QUOTE_SOURCE` = quote attribution

### Last-Quote Persistence

After rendering each transition banner, write the displayed quote to `$KILN_DIR/tmp/last-quote.json`:

```json
{"quote": "...", "by": "...", "section": "ignition", "at": "2026-02-20T..."}
```

This file is ephemeral (`tmp/` is gitignored). Used by `/kiln:status` to display current quote. MEMORY.md remains the sole source of truth for state.

### Spinner Verb Installation

At `/kiln:start` initialization and at each stage transition, the orchestrator:

1. Reads `$CLAUDE_HOME/kilntwo/data/spinner-verbs.json`
2. Builds a flat array: verbs for the current stage + generic verbs
3. Writes to `$PROJECT_PATH/.claude/settings.local.json` as `{"spinnerVerbs": {"mode": "replace", "verbs": [...]}}`

Stage mapping: `brainstorm` → brainstorm verbs, `planning` → planning verbs, `execution` → execution verbs, `validation` → validation verbs. Review verbs are mixed in during execution stage review rounds.

## Team Pattern

Kiln uses Claude Code's native Teams API for agent coordination. No manual tmux management.

- **Session team**: `kiln-session` — created by Kiln after onboarding. Coordinators (Aristotle, Maestro, Mnemosyne) are spawned WITH `team_name: "kiln-session"` so Kiln can send mid-work nudges via `SendMessage`. Coordinators also create their own sub-teams for workers.
- **Sub-teams**: Coordinators create ephemeral sub-teams for their workers:
  - `aristotle-planning` — Confucius, Sun Tzu, Socrates, Plato, Athena
  - `maestro-phase-<N>` — Sherlock, Scheherazade, Codex, Sphinx, Confucius, Sun Tzu, Socrates, Plato
  - `mnemosyne-mapping` — Clio, Urania, Melpomene, Calliope, Terpsichore
- **Lifecycle**: Coordinators lead Setup with `TeamDelete` (cleanup), then `TeamCreate`. Workers are spawned with the sub-team's `team_name`. Coordinators call `TeamDelete` before returning. The session team is deleted during finalization or reset.

## Event Schema

Phase state files (`$KILN_DIR/phase_<N>_state.md`) contain a `## Events` section with structured log entries:

```
- [ISO-8601] [AGENT_ALIAS] [EVENT_TYPE] — description
```

`AGENT_ALIAS` = character alias (e.g. `Maestro`, `Confucius`, `Codex`), not internal name.

**Event type enum** (27 values, closed set): `setup`, `branch`, `plan_start`, `plan_complete`, `debate_complete`, `synthesis_complete`, `plan_validate_start`, `plan_validate_complete`, `sharpen_start`, `sharpen_complete`, `task_start`, `task_success`, `task_retry`, `task_fail`, `review_start`, `review_approved`, `review_rejected`, `fix_start`, `fix_complete`, `merge`, `reconcile_complete`, `deploy_start`, `deploy_complete`, `correction_start`, `correction_complete`, `error`, `halt`

Note: `plan_validate_start`, `plan_validate_complete` are logged during Stage 2 plan gating. `deploy_start`, `deploy_complete` are logged in the validation report timeline (not phase state files). `correction_start`, `correction_complete` are logged in the `## Correction Log` section of `MEMORY.md` (not phase state files). All other events are logged in phase state files.

## File Naming Conventions

- Task outputs: `task_<NN>_output.md` (zero-padded to 2 digits)
- Task errors: `task_<NN>_error.md`
- Task prompts: `task_<NN>.md`
- Fix outputs: `task_fix_<R>_output.md`
- Fix prompts: `fix_round_<R>.md`
- Phase state (working): `phase_<N>_state.md` (unpadded)
- Phase archive: `archive/phase_<NN>/` (zero-padded to 2 digits)
- Debate critiques: `plans/critique_of_<codex|claude>_r<N>.md` (round N)
- Debate revisions: `plans/plan_<claude|codex>_v<N>.md` (version N, N >= 2)
- Debate audit log: `plans/debate_log.md`
- Phase summary: `archive/phase_<NN>/phase_summary.md`
- Codebase index: `codebase-snapshot.md` (refreshed per phase)

## Codex CLI Patterns

**GPT-5.2** (planning, research, prompt generation):
```bash
codex exec -m gpt-5.2 \
  -c 'model_reasoning_effort="high"' \
  --skip-git-repo-check \
  -C <PROJECT_PATH> \
  "<PROMPT_TEXT>" \
  -o <OUTPUT_PATH>
```

**GPT-5.3-codex** (code implementation):
```bash
cat <PROMPT_PATH> | codex exec -m gpt-5.3-codex \
  -c 'model_reasoning_effort="high"' \
  --dangerously-bypass-approvals-and-sandbox \
  --skip-git-repo-check \
  -C <PROJECT_PATH> \
  - \
  -o <OUTPUT_PATH>
```

Note: `--dangerously-bypass-approvals-and-sandbox` replaces `--full-auto` because Landlock sandbox fails on Proxmox/certain kernel configs. Safe in the Kiln pipeline context.

**Required flags** (every invocation):
- `--skip-git-repo-check` — prevents failure in non-root git dirs
- `-o <OUTPUT_PATH>` — always capture output to file
- `-c 'model_reasoning_effort="high"'` — never omit or lower

**Timeout**: minimum 600 seconds for all Codex invocations. Use 900+ for large/complex tasks.

## Working Directory Structure

```
$KILN_DIR/
  config.json              — Runtime config (model mode, preferences, tooling hints)
  phase_<N>_state.md       — Per-phase state file (branch, commit SHA, structured events)
  planning_state.md        — Stage 2 planning coordinator state/event log
  codebase-snapshot.md     — Codebase index (refreshed per phase, gitignored)
  plans/
    claude_plan.md         — Claude planner output
    codex_plan.md          — Codex planner output
    debate_resolution.md   — Debater agent output
    debate_log.md          — Mode 3 debate audit trail (rounds, convergence, outcome)
    critique_of_codex_r<N>.md  — Claude's critique of Codex plan, round N
    critique_of_claude_r<N>.md — Codex's critique of Claude plan, round N
    plan_claude_v<N>.md        — Claude revised plan, version N
    plan_codex_v<N>.md         — Codex revised plan, version N
    phase_plan.md          — Phase-scoped synthesized plan
  prompts/
    task_01.md             — Per-task Codex prompt (one file per task)
    task_NN.md             — (numbered sequentially, zero-padded to 2 digits)
    tasks_raw.md           — Intermediate prompter output (pre-split)
    manifest.md            — Ordered list of all task prompts with summaries
  reviews/
    fix_round_1.md         — QA fix prompt, round 1
    fix_round_N.md         — (numbered sequentially)
  outputs/
    task_01_output.md      — Captured Codex output for task 01
    task_01_error.md       — Captured Codex error output for task 01 (if any)
    task_NN_output.md      — (numbered matching task prompts)
  archive/
    phase_01/              — Archived artifacts from completed phase 01
      plans/               — (moved from $KILN_DIR/plans/)
      prompts/             — (moved from $KILN_DIR/prompts/)
      reviews/             — (moved from $KILN_DIR/reviews/)
      outputs/             — (moved from $KILN_DIR/outputs/)
      phase_01_state.md    — (moved from $KILN_DIR/)
      phase_summary.md     — Phase completion digest (metrics + outcome)
    phase_NN/              — (one subdirectory per completed phase)
  validation/
    report.md              — End-to-end validation results
    missing_credentials.md — Environment variables or secrets that were absent
  tmp/
```

## Development Guidelines

1. **Write clean, working code** — No placeholders, no TODOs, no `// implement later` comments.
2. **Follow existing project conventions** — Read source files before writing; match naming, error handling, module format.
3. **Test everything** — Acceptance criteria must include at least one deterministic verification check.
4. **Commit early and often** — After each task: `kiln: phase-NN task-NN — <description>`.
5. **Handle errors explicitly** — Never swallow errors silently.
6. **When in doubt, ask the operator** — Pause on ambiguity; don't guess.
