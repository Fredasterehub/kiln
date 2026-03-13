# kiln-forge — Unified Plugin Development Cockpit

Evolve the existing kiln-test TUI into a single-window development cockpit for the Kiln pipeline plugin. No more terminal juggling — findings, diagnosis, refinement, validation, testing, and tracking all happen from one interface.

## What Exists Already

The current `kiln-test` binary at `/DEV/kilntop/kiln-test/` is a working Ratatui TUI with:
- Dashboard, Scenarios, Run (live), Results, History, Baselines views
- Background thread runner that spawns `claude -p` and parses stream-json
- Scenario loading from expect.json files
- Kiln brand theme (terracotta, gold, dark bg)

**This project extends that codebase.** Do not rewrite from scratch — add to the existing `src/` structure.

## Tech Stack (same as existing)

- Rust 1.92, Ratatui 0.29, crossterm 0.28, serde/serde_json, clap 4, chrono
- Project at `/DEV/kilntop/kiln-test/`
- Plugin dir: `/DEV/kilntop/plugin/`

## New Capabilities

### 1. Findings Tracker (native — no claude needed)

A built-in issue tracker that replaces manually editing `findings.md`.

**Data**: Read/write `{plugin_dir}/skills/kiln-forge/findings.json` (new file, migrate from findings.md format).

```json
[
  {
    "id": 1,
    "title": "KRS-One needs manual nudge after REQUEST_WORKERS",
    "category": "Sequencing",
    "source": "ST12",
    "status": "fixed",
    "description": "Boss goes idle after REQUEST_WORKERS. No wake-up when workers spawn.",
    "resolution": "Added WORKERS_SPAWNED message in SKILL.md Phase C",
    "created": "2026-03-11",
    "updated": "2026-03-11"
  }
]
```

**View — Findings list:**
- Table: ID, Title, Category, Source, Status
- Status colors: open=yellow, fixed=green, wontfix=dim
- Arrow keys to navigate, Enter to view/edit detail
- `n` to create new finding (inline form: title, category, source, description)
- `e` to edit selected finding
- `r` to mark resolved (prompts for resolution text)
- `d` to delete
- Filter by status: `o` open only, `a` all, `f` fixed only

### 2. Structural Validation (native — no claude needed)

Run the w2-validate checks directly in Rust. No claude session needed — these are all file system checks.

**Checks implemented natively:**
1. **Agent anatomy** — for each `agents/*.md`: parse YAML frontmatter, verify required fields (name, description, tools, model, color), check name matches filename
2. **Blueprint-agent alignment** — for each `blueprints/step-*.md`: extract agent names from roster table, verify matching `.md` file exists
3. **Data file integrity** — parse all JSON files in `data/`, report parse errors
4. **Hook count** — count `# Hook` comments in `enforce-pipeline.sh`, compare to expected (13)
5. **File counts** — agent count, blueprint count, script executability

**View — Validation results:**
- Table of checks: Name, Status (PASS/WARN/FAIL), Details
- `v` from any view to run validation
- Results cached until next run
- Failures shown in red with details

### 3. Diagnose (claude-powered)

Select an open finding and launch a targeted diagnosis via `claude -p`.

**Flow:**
1. User selects a finding from the Findings view
2. Presses `x` (diagnose)
3. TUI constructs a prompt:
   ```
   You are running the kiln-forge w5-diagnose workflow.
   Read the workflow at {plugin_dir}/skills/kiln-forge/workflows/w5-diagnose.md
   Read the plugin architecture at {plugin_dir}/skills/kiln-forge/references/plugin-architecture.md

   Diagnose this finding:
   Title: {finding.title}
   Category: {finding.category}
   Source: {finding.source}
   Description: {finding.description}

   Trace the root cause. Output your diagnosis as JSON:
   {"root_cause": "...", "category": "...", "proposed_fix": "...", "confidence": "high|medium|low", "files_affected": ["..."]}
   ```
4. Spawns `claude -p "{prompt}" --output-format stream-json --plugin-dir {plugin_dir}` in background thread (same pattern as test runner)
5. Shows live output in a split pane (reuse the Run view layout)
6. On completion, parses the JSON diagnosis from claude's output
7. Displays structured result: root cause, proposed fix, confidence, affected files
8. User can accept (`a`) → auto-creates a refinement task, or dismiss (`Esc`)

### 4. Refine (claude-powered)

Apply a fix to the plugin via `claude -p`.

**Flow:**
1. User triggers refine from a diagnosis result (press `a` to accept fix), or manually from Findings view (`w` to refine)
2. TUI constructs a prompt:
   ```
   You are running the kiln-forge w1-refine workflow.
   Read the workflow at {plugin_dir}/skills/kiln-forge/workflows/w1-refine.md
   Read the plugin architecture at {plugin_dir}/skills/kiln-forge/references/plugin-architecture.md

   Apply this fix:
   Finding: {finding.title}
   Root cause: {diagnosis.root_cause}
   Proposed fix: {diagnosis.proposed_fix}
   Files affected: {diagnosis.files_affected}

   Implement the fix. After implementing:
   1. Run structural validation on affected files
   2. Log the change in evolution-log.json
   3. Output a summary as JSON:
   {"files_changed": ["..."], "change_summary": "...", "validation_passed": true|false}
   ```
3. Spawns `claude -p` with `--dangerously-skip-permissions` (it needs Write/Edit access)
4. Shows live progress
5. On completion: updates finding status to "fixed", shows what changed
6. User can immediately run a test scenario to verify (prompt: "Run S5 to verify?")

### 5. Quick Actions Bar

A command palette accessible from any view with `/`:

```
/ diagnose {finding_id}     — diagnose a specific finding
/ refine {finding_id}       — refine a specific finding
/ validate                  — run structural validation
/ test {S1|S5|S6}          — run a test scenario
/ state                     — show plugin state summary
/ finding {title}           — create a new finding
```

Parse the command, dispatch to the right workflow.

## Updated View Structure

```
Tab cycles through:
Dashboard → Findings → Validate → Scenarios → Run → Results → History → Baselines

New views: Findings (2nd), Validate (3rd)
Existing views: Dashboard, Scenarios, Run, Results, History, Baselines (unchanged)
```

### Updated Dashboard

```
╔══════════════════════════════════════════════════════╗
║  KILN FORGE — Development Cockpit                    ║
╚══════════════════════════════════════════════════════╝

  Plugin: v1.0.5    Forge: v0.1.0    Agents: 23

  ┌─ Health ──────────────────────────────────────────┐
  │  Validation: PASS (6/6 checks)     12 min ago     │
  │  Last Test:  S5 PASS (14m 32s)     2 hours ago    │
  │  Findings:   3 open / 12 total                    │
  └───────────────────────────────────────────────────┘

  ┌─ Open Findings ───────────────────────────────────┐
  │  #1  Parallel codex blueprint           Arch      │
  │  #2  Prompt skeleton compliance         Enforce   │
  │  #6  Codex bootstrap-before-inbox       Sequence  │
  └───────────────────────────────────────────────────┘

  ┌─ Quick Actions ───────────────────────────────────┐
  │  [/] command palette   [v] validate   [f] findings│
  │  [1] test S1   [5] test S5   [6] test S6          │
  └───────────────────────────────────────────────────┘
```

### Findings View

```
╔══════════════════════════════════════════════════════╗
║  Findings                            [n]ew [o]pen [a]ll║
╚══════════════════════════════════════════════════════╝

  │ ID │ Title                              │ Cat      │ Src   │ Status │
  │  1 │ Parallel codex blueprint           │ Arch     │ ST11  │ OPEN   │
  │  2 │ Prompt skeleton compliance         │ Enforce  │ ST11  │ OPEN   │
  │  3 │ Engine context burn on resume      │ Effic    │ ST11  │ OPEN   │
  │ 13 │ Boss idle after REQUEST_WORKERS    │ Seq      │ ST12  │ FIXED  │
  │ 14 │ Artifact checks missing runner.rs  │ Build    │ ST12  │ FIXED  │

  ┌─ #1: Parallel codex blueprint ────────────────────┐
  │  KRS-One scopes correctly for parallel but         │
  │  blueprint forces sequential codex dispatch.       │
  │  Blueprint needs N×(codex+sphinx) pattern.         │
  │                                                    │
  │  [x] diagnose  [w] refine  [r] resolve  [Esc] back│
  └───────────────────────────────────────────────────┘
```

### Validate View

```
╔══════════════════════════════════════════════════════╗
║  Validation                          [v] run  [Esc] back║
╚══════════════════════════════════════════════════════╝

  │ Check                    │ Status │ Details              │
  │ Agent anatomy (23)       │ PASS   │ 23/23 valid          │
  │ Blueprint alignment (7)  │ PASS   │ 7/7 matched          │
  │ Data file integrity (5)  │ PASS   │ 5/5 parse OK         │
  │ Hook count               │ PASS   │ 13 hooks found       │
  │ Script executability     │ PASS   │ 2/2 executable       │
  │ File counts              │ WARN   │ 5 retired in agents  │

  Last run: 12 min ago — Overall: PASS (1 warning)
```

## New Source Files

Add to existing `src/`:

```
src/
├── findings.rs           # Finding struct, CRUD, JSON read/write
├── validation.rs         # Native structural checks (no claude)
├── claude_runner.rs      # Shared claude -p runner for diagnose/refine
├── command_palette.rs    # "/" command parser and dispatcher
└── views/
    ├── findings.rs       # Findings list + detail view
    ├── validate.rs       # Validation results view
    └── command_palette.rs # Overlay for "/" input
```

Modify existing:
- `app.rs` — add View::Findings, View::Validate, new state fields, key handlers
- `views/mod.rs` — add new view dispatches
- `views/dashboard.rs` — add health summary, open findings, quick actions

## Data Migration

On first launch, if `findings.json` doesn't exist but `findings.md` does, parse the markdown tables and create `findings.json`. The markdown format has:

```
| # | Finding | Category | Status |
|---|---------|----------|--------|
| 1 | KRS-One scopes correctly for... | Architecture | Open |
```

Parse each row into a Finding struct. After migration, `findings.json` is the source of truth.

## Key Interactions

| View | Key | Action |
|------|-----|--------|
| Any | `/` | Open command palette |
| Any | `Tab` | Next view |
| Any | `q` | Quit |
| Dashboard | `1`/`5`/`6` | Launch scenario S1/S5/S6 |
| Dashboard | `v` | Run validation |
| Dashboard | `f` | Go to Findings |
| Findings | `n` | New finding |
| Findings | `e` | Edit selected |
| Findings | `r` | Resolve selected |
| Findings | `x` | Diagnose selected (claude) |
| Findings | `w` | Refine selected (claude) |
| Findings | `o`/`a`/`f` | Filter: open/all/fixed |
| Validate | `v` | Run validation |
| Scenarios | `Enter` | Launch selected scenario |
| Run | `f` | Toggle follow mode |
| Results | `s` | Save to history |
| Results | `b` | Set as baseline |

## Claude Runner Architecture

`claude_runner.rs` shares the same pattern as `runner.rs`:
- Background thread
- mpsc channel for events
- Spawns `claude -p "{prompt}" --output-format stream-json --plugin-dir {plugin_dir}`
- Parses stream-json for progress
- On completion, extracts JSON from claude's text output (scan for `{...}` blocks)

The difference from test runner: no workspace setup, no artifact checks. Just prompt → stream → parse result.

Both the diagnose and refine flows reuse this runner. The prompt construction is the only difference.

## Acceptance Criteria

1. Binary compiles with `cargo build --release` (zero errors)
2. All existing views still work (dashboard, scenarios, run, results, history, baselines)
3. Findings view loads from `findings.json`, supports CRUD operations
4. Validation runs natively in <2 seconds, reports PASS/WARN/FAIL per check
5. Diagnose flow: select finding → launch claude → see live output → structured result
6. Refine flow: accept diagnosis → launch claude → see changes → finding auto-resolved
7. Command palette opens with `/`, parses commands, dispatches correctly
8. Dashboard shows health summary with open findings count
9. All existing tests still pass
10. Theme consistent with Kiln brand palette
