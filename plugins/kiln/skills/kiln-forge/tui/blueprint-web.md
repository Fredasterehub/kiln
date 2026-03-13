# kiln-forge-server — Plugin Development Dashboard

Web-based observation deck for the Kiln pipeline plugin. Runs alongside your claude session — shared data files, real-time test results, findings management, structural validation.

**This is a companion to the kiln-forge skill, not a replacement.** Claude does the thinking (diagnosis, refinement, editing). The web UI does the observing (state, tests, trends, findings board).

## Tech Stack

- **Language**: Rust 1.92 (`/home/dev/.cargo/bin/rustc`)
- **Web framework**: Axum 0.8
- **Templating**: Askama (compile-time HTML templates, no runtime overhead)
- **Live streaming**: Server-Sent Events (SSE) via Axum's Sse extractor
- **Interactivity**: htmx 2.0 (server-rendered HTML fragments, minimal JS)
- **Styling**: Embedded CSS — Kiln brand palette, no build tools, no npm
- **Project location**: `/DEV/kilntop/kiln-forge-server/`

### Cargo.toml

```toml
[package]
name = "kiln-forge-server"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = { version = "0.8", features = ["macros"] }
askama = "0.13"
askama_axum = "0.5"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
chrono = { version = "0.4", features = ["serde"] }
tower-http = { version = "0.6", features = ["fs"] }
```

htmx is served as a single vendored JS file in `static/htmx.min.js` — no CDN, no npm. Download from htmx.org at build time or embed as a const string.

## Architecture

```
Browser (localhost:3000)
  ↕ HTTP + SSE
Axum server (single binary)
  ↕ filesystem
Shared data files (plugin/skills/kiln-forge/data/)
  ↕ also read/written by
kiln-forge skill (in claude session)
```

No database. All state lives in JSON files that both the web server and the kiln-forge skill read/write:
- `data/findings.json` — findings board
- `data/evolution-log.json` — change history
- `data/run-history.json` — test results
- `data/plugin-state.json` — plugin snapshot

The server reads these on each request (files are small, <100KB). No caching needed — always fresh.

## Project Structure

```
kiln-forge-server/
├── Cargo.toml
├── static/
│   ├── htmx.min.js          # Vendored htmx 2.0
│   └── style.css            # Kiln brand stylesheet
├── templates/
│   ├── base.html             # Layout: nav + content area
│   ├── dashboard.html        # Dashboard page
│   ├── findings.html         # Findings list
│   ├── finding_detail.html   # Single finding view/edit
│   ├── finding_form.html     # New/edit finding form (htmx fragment)
│   ├── finding_row.html      # Single table row (htmx fragment for updates)
│   ├── validate.html         # Validation results
│   ├── scenarios.html        # Scenario list
│   ├── run.html              # Live test run page (SSE)
│   ├── run_events.html       # SSE event fragment (htmx swap)
│   ├── results.html          # Run results
│   ├── history.html          # Run history table
│   ├── baselines.html        # Baseline comparison
│   └── evolution.html        # Evolution log
└── src/
    ├── main.rs               # Server startup, router, CLI args
    ├── state.rs              # AppState: plugin_dir path, data file paths
    ├── data.rs               # Read/write JSON data files (findings, history, evolution, plugin-state)
    ├── models.rs             # Finding, RunRecord, EvolutionEntry, PluginState structs
    ├── validation.rs         # Native structural checks (agent anatomy, blueprint alignment, etc.)
    ├── runner.rs             # Scenario runner: spawn claude -p, parse stream-json, SSE broadcast
    ├── routes/
    │   ├── mod.rs            # Router assembly
    │   ├── dashboard.rs      # GET /
    │   ├── findings.rs       # GET/POST/PUT/DELETE /findings
    │   ├── validate.rs       # GET/POST /validate
    │   ├── scenarios.rs      # GET /scenarios
    │   ├── run.rs            # POST /run/{scenario_id}, GET /run/stream (SSE)
    │   ├── results.rs        # GET /results
    │   ├── history.rs        # GET /history
    │   ├── baselines.rs      # GET /baselines, POST /baselines/{run_id}
    │   └── evolution.rs      # GET /evolution
    └── templates.rs          # Askama template structs
```

## Pages and Routes

### Dashboard — `GET /`

The home page. Shows at a glance:

```html
┌─────────────────────────────────────────────────────┐
│  KILN FORGE                                          │
│  Plugin Development Dashboard                        │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Plugin v1.0.5 · Forge v0.1.0 · 23 agents           │
│                                                      │
│  ┌─ Health ──────────────────────────────────┐       │
│  │ Validation: PASS (6/6)      12 min ago    │       │
│  │ Last Test:  S5 PASS (14m)   2 hours ago   │       │
│  │ Findings:   3 open / 14 total             │       │
│  └───────────────────────────────────────────┘       │
│                                                      │
│  ┌─ Open Findings ───────────────────────────┐       │
│  │ #1  Parallel codex blueprint      Arch    │       │
│  │ #2  Prompt skeleton compliance    Enforce │       │
│  │ #6  Codex bootstrap-before-inbox  Seq     │       │
│  └───────────────────────────────────────────┘       │
│                                                      │
│  ┌─ Quick Actions ───────────────────────────┐       │
│  │  [Run S1]  [Run S5]  [Run S6]             │       │
│  │  [Validate]  [View Findings]               │       │
│  └───────────────────────────────────────────┘       │
│                                                      │
│  ┌─ Recent Changes ─────────────────────────┐        │
│  │ Mar 11  SKILL.md — WORKERS_SPAWNED msg    │       │
│  │ Mar 11  kb.sh — spinner schema fix        │       │
│  │ Mar 11  codex.md — timeout 30min          │       │
│  └───────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────┘
```

Data sources: plugin-state.json, findings.json (filter open), run-history.json (last entry), evolution-log.json (last 5).

### Findings — `GET /findings`

Full findings board with filtering.

**Query params**: `?status=open` (default), `?status=all`, `?status=fixed`

```html
┌─ Findings ──────────────────────────────────────────┐
│  [New Finding]    Filter: [Open] [Fixed] [All]       │
│                                                      │
│  ID  Title                           Cat     Status  │
│  ──  ─────                           ───     ──────  │
│   1  Parallel codex blueprint        Arch    OPEN    │
│   2  Prompt skeleton compliance      Enforce OPEN    │
│   3  Engine context burn on resume   Effic   OPEN    │
│   6  Codex bootstrap-before-inbox    Seq     OPEN    │
│  13  Boss idle after WORKERS         Seq     FIXED   │
│                                                      │
│  Click a row to view details.                        │
└─────────────────────────────────────────────────────┘
```

Each row is a link to `GET /findings/{id}`.

Filter buttons use htmx: `<button hx-get="/findings?status=open" hx-target="#findings-table">Open</button>`

### Finding Detail — `GET /findings/{id}`

View and edit a single finding.

```html
┌─ Finding #1 ────────────────────────────────────────┐
│                                                      │
│  Title:    Parallel codex blueprint                  │
│  Category: Architecture                              │
│  Source:   ST11                                      │
│  Status:   OPEN                                      │
│  Created:  2026-03-11                                │
│                                                      │
│  Description:                                        │
│  KRS-One scopes correctly for parallel execution     │
│  but blueprint step-5 forces sequential codex        │
│  dispatch. Blueprint needs N×(codex+sphinx) pattern. │
│                                                      │
│  [Edit]  [Resolve]  [Delete]  [Back]                 │
└─────────────────────────────────────────────────────┘
```

**Resolve** — `PUT /findings/{id}` with `status: "fixed"` and resolution text. Uses htmx inline form:
```html
<button hx-get="/findings/1/resolve-form" hx-target="#actions" hx-swap="outerHTML">Resolve</button>
```
Returns a text input for resolution + confirm button.

**Edit** — `GET /findings/{id}/edit` returns the form. `PUT /findings/{id}` saves.

**Delete** — `DELETE /findings/{id}` with htmx confirm.

**New** — `GET /findings/new` returns form. `POST /findings` creates.

### Finding CRUD — htmx pattern

All CRUD uses htmx fragments. No full page reloads.

```
POST   /findings              → create, redirect to detail
GET    /findings/{id}         → full detail page
GET    /findings/{id}/edit    → edit form (htmx fragment)
PUT    /findings/{id}         → update, return updated detail
DELETE /findings/{id}         → delete, redirect to list
GET    /findings/{id}/resolve-form → resolution form fragment
```

### Validate — `GET /validate`

Shows last validation results. Button to run new validation.

```html
┌─ Validation ────────────────────────────────────────┐
│  [Run Validation]              Last: 12 min ago      │
│                                                      │
│  Check                      Status  Details          │
│  ─────                      ──────  ───────          │
│  Agent anatomy (23)         PASS    23/23 valid      │
│  Blueprint alignment (7)    PASS    7/7 matched      │
│  Data file integrity (5)    PASS    5/5 parse OK     │
│  Hook count                 PASS    13 hooks found   │
│  Script executability       PASS    2/2 executable   │
│  File counts                WARN    5 retired agents │
│                                                      │
│  Overall: PASS (1 warning)                           │
└─────────────────────────────────────────────────────┘
```

**Run button**: `<button hx-post="/validate" hx-target="#results" hx-indicator="#spinner">Run Validation</button>`

`POST /validate` runs all checks synchronously (they're fast — pure filesystem), returns the results table as an htmx fragment.

#### Native Validation Checks (Rust)

These run in-process, no claude needed:

1. **Agent anatomy** — for each `plugin/agents/*.md`:
   - Read file, split on `---` to extract YAML frontmatter
   - Check required fields: name, description, tools, model, color
   - Verify `name` matches filename (without .md)
   - Verify model is one of: opus, sonnet, haiku

2. **Blueprint-agent alignment** — for each `plugin/skills/kiln-pipeline/references/blueprints/step-*.md`:
   - Parse agent roster table (lines with `|` delimiters)
   - Extract agent names from first column
   - Verify each name has a matching `.md` in `plugin/agents/`

3. **Data file integrity** — parse each JSON file in `plugin/skills/kiln-pipeline/data/`:
   - `serde_json::from_str` — if it parses, it passes

4. **Hook count** — read `enforce-pipeline.sh`, count lines matching `^# Hook`

5. **Script executability** — check `enforce-pipeline.sh` and `kb.sh` have executable bit

6. **File counts** — count agents, blueprints, compare to expected

7. **Architecture sync** — regenerate `plugin-architecture.md` from live filesystem, then diff against the existing file. See "Architecture Auto-Sync" section below.

#### Architecture Auto-Sync

`plugin-architecture.md` is the cross-reference brain — hook-agent matrix, agent-blueprint matrix, data consumers. If it drifts from reality, kiln-forge gives wrong advice. It must be generated, not hand-maintained.

**Trigger**: every time validation runs (via `POST /validate`), the server regenerates the architecture doc from live data BEFORE running cross-reference checks.

**Implementation** — add `src/arch_sync.rs`:

The sync function scans the live plugin directory and builds every section of `plugin-architecture.md` deterministically:

1. **Agent inventory** — scan `plugin/agents/*.md`, parse each frontmatter (name, model, color, tools, description). Sort by step number (extract from agents.json entry). Build the agent table.

2. **Blueprint inventory** — scan `plugin/skills/kiln-pipeline/references/blueprints/step-*.md`, parse each roster table. Build the blueprint table with boss, Phase A, Phase C columns.

3. **Hook-agent matrix** — parse `enforce-pipeline.sh`:
   - Find each `# Hook N` comment → extract hook number
   - Find the `if` condition after it → extract agent name(s) and tool(s) blocked
   - Find the category comment above it (DELEGATION, SEQUENCING, FLAGS, SAFETY)
   - Build the hook-agent matrix table

4. **Agent-blueprint matrix** — cross-reference: for each agent, which blueprint(s) reference it and in which phase. Built from the blueprint parse in step 2.

5. **Data consumers** — scan all `.md` files in `plugin/` for references to data file names (`agents.json`, `spinner-verbs.json`, `lore.json`, etc.). Build the consumers table.

6. **Data file inventory** — list all JSON files in `plugin/skills/kiln-pipeline/data/`, note their size and key count.

7. **Reference doc inventory** — list all `.md` files in `plugin/skills/kiln-pipeline/references/`.

8. **Conventions** — this section is static (copied from a const string). It documents naming rules, required sections, and patterns that don't change with file contents.

**Output**: write the generated content to `plugin/skills/kiln-forge/references/plugin-architecture.md`, overwriting the existing file. The file header includes a generation timestamp:

```markdown
<!-- Generated by kiln-forge-server at 2026-03-12T14:30:00Z — DO NOT EDIT MANUALLY -->
# Plugin Architecture — Complete Reference
...
```

**Validation check 7** then compares the freshly generated doc against what was there before. If they differ, that means the doc was stale — report as WARN with a summary of what changed (e.g., "agent count changed from 23 to 24", "new hook #15 detected"). The file is already updated, so the warning is informational.

**The kiln-forge skill also benefits**: since the web server keeps `plugin-architecture.md` in sync, the skill's w1-refine and w5-diagnose workflows always read accurate cross-references. No drift possible as long as the user runs validation periodically (and the dashboard nudges them when it's stale).

**Route**: `GET /architecture` — shows the current generated architecture doc rendered as HTML, with a "Regenerate" button that triggers `POST /validate` (which includes the sync).

Add to the nav bar between Validate and Test:
```html
<a href="/architecture">Architecture</a>
```

Add to project structure:
```
src/
├── arch_sync.rs          # Scan plugin dir, generate plugin-architecture.md
```

Add to routes:
```
src/routes/
├── architecture.rs       # GET /architecture, rendered from generated doc
```

### Scenarios — `GET /scenarios`

List available scenarios with details.

```html
┌─ Scenarios ─────────────────────────────────────────┐
│                                                      │
│  S1  Research Only       10 min   Steps 1-2 → 3      │
│      [Run S1]                                        │
│                                                      │
│  S5  Build Cycle         20 min   Steps 1-4 → 5      │
│      [Run S5]                                        │
│                                                      │
│  S6  Full Autonomous     60 min   Steps 1-2 → 3-7    │
│      [Run S6]                                        │
│                                                      │
└─────────────────────────────────────────────────────┘
```

Run buttons: `<button hx-post="/run/s5-build-cycle" hx-swap="none">Run S5</button>` — triggers run, then JavaScript redirects to `/run`.

### Live Run — `GET /run`

Shows live progress via SSE. This is the most complex page.

```html
┌─ Running: S5 Build Cycle ───────────────── 02:34 ──┐
│                                                      │
│  Agents: 3    Tools: 42    Tokens: 84K    Viol: 0    │
│                                                      │
│  ┌─ Live Events ────────────────────────────────┐    │
│  │ 14:30:12  ◆ rakim spawned                    │    │
│  │ 14:30:12  ◆ sentinel spawned                 │    │
│  │ 14:30:15  ✓ rakim: Read codebase-state.md    │    │
│  │ 14:30:16  ✓ sentinel: Read patterns.md       │    │
│  │ 14:30:20  ◆ krs-one spawned                  │    │
│  │ 14:30:25  ✓ krs-one: Read master-plan.md     │    │
│  │ 14:30:30  ◆ codex spawned                    │    │
│  │ 14:30:35  ✓ codex: Bash codex exec ...       │    │
│  │ 14:30:35    ⏳ codex executing GPT-5.4...     │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  [Cancel]                                            │
└─────────────────────────────────────────────────────┘
```

**SSE implementation:**

```
GET /run/stream → SSE endpoint
```

Server maintains a `tokio::sync::broadcast::Sender<RunnerEvent>`. When a run starts (`POST /run/{id}`), it spawns a tokio task that:
1. Creates temp workspace
2. Runs `setup.sh {workspace}`
3. Reads `prompt.md` from scenario dir
4. Spawns `claude -p "{prompt}" --output-format stream-json --plugin-dir {plugin_dir} --dangerously-skip-permissions`
5. Reads stdout line by line
6. Parses each line (same parser logic as kiln-test)
7. Broadcasts `RunnerEvent` to all SSE subscribers

Client-side, htmx listens to SSE and appends events:

```html
<div id="events"
     hx-ext="sse"
     sse-connect="/run/stream"
     sse-swap="event">
</div>
```

Each SSE message is an HTML fragment:
```html
event: event
data: <div class="event"><span class="time">14:30:12</span> <span class="icon">◆</span> rakim spawned</div>
```

The counters bar updates via a separate SSE event type:
```html
event: counters
data: <div id="counters">Agents: 3  Tools: 42  Tokens: 84K  Viol: 0</div>
```

With htmx: `<div id="counters" sse-swap="counters" hx-swap="innerHTML">...</div>`

The duration timer is the one piece of client JS — a `setInterval` that updates the clock every second. ~5 lines.

### Results — `GET /results`

Post-run results. Only shown after a run completes.

```html
┌─ Results: S5 Build Cycle — PASS ────────────────────┐
│                                                      │
│  Duration: 14m 32s (target ≤20m)              GREEN  │
│                                                      │
│  Artifacts:                                          │
│    ✓ .kiln/docs/codebase-state.md                    │
│    ✓ .kiln/docs/patterns.md                          │
│    ✓ .kiln/docs/pitfalls.md                          │
│    ✓ .kiln/STATE.md                                  │
│                                                      │
│  Compliance:                                         │
│    ✓ prompt_skeleton: 5/6                            │
│    ✓ hook_violations: 0                              │
│    ✓ delegation_compliance: passed                   │
│                                                      │
│  Metrics:                                            │
│    agents_spawned: 5    tokens: 284K                 │
│    tool_calls: 142      violations: 0                │
│                                                      │
│  [Save to History]  [Set as Baseline]                │
│                                                      │
│  ┌─ Create Finding from Run ────────────────┐        │
│  │  Noticed something? [New Finding]         │       │
│  └──────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────┘
```

**Save**: `POST /history` with run data. **Baseline**: `POST /baselines/{scenario_id}`.

**New Finding from run**: pre-fills source field with scenario + date.

### History — `GET /history`

```html
┌─ Run History ───────────────────────────────────────┐
│                                                      │
│  #   Date        Scenario  Result  Duration  Tokens  │
│  1   2026-03-12  S5        PASS    14m 32s   284K    │
│  2   2026-03-11  S5        FAIL    22m 10s   340K    │
│  3   2026-03-10  ST10      PASS    manual    —       │
│                                                      │
│  Click a row for details.                            │
└─────────────────────────────────────────────────────┘
```

### Baselines — `GET /baselines`

```html
┌─ Baseline Comparison ───────────────────────────────┐
│                                                      │
│  Scenario: S5 Build Cycle                            │
│                                                      │
│  Metric          Baseline  Current  Delta    Status   │
│  duration (min)  16.0      14.5     -1.5     ✓       │
│  tool_calls      150       130      -20      ✓       │
│  tokens (K)      300       270      -30      ✓       │
│  violations      0         0        0        ✓       │
│  skeleton        4/6       5/6      +1       ✓       │
│                                                      │
│  Overall: IMPROVEMENT                                │
└─────────────────────────────────────────────────────┘
```

### Evolution Log — `GET /evolution`

```html
┌─ Evolution Log ─────────────────────────────────────┐
│                                                      │
│  Mar 11  skills/kiln-pipeline/SKILL.md               │
│          WORKERS_SPAWNED confirmation after Phase C   │
│          Why: Boss idle after REQUEST_WORKERS (ST12)  │
│                                                      │
│  Mar 11  skills/kiln-pipeline/scripts/kb.sh          │
│          Fixed spinnerVerbs schema                    │
│          Why: Spinners DOA — bare array vs object     │
│                                                      │
│  Mar 11  agents/codex.md                             │
│          Raised timeout to 30 min                    │
│          Why: GPT-5.4 exceeds 10 min on complex      │
└─────────────────────────────────────────────────────┘
```

## Styling — `static/style.css`

Kiln brand palette, dark theme, clean typography.

```css
:root {
  --bg-primary: #1a1a1a;
  --bg-panel: #242424;
  --bg-hover: #2a2a2a;
  --border: #3a3a3a;
  --terracotta: #d08060;      /* brand accent */
  --gold: #e0c080;            /* headers, highlights */
  --muted-gold: #b0a070;      /* rules, secondary */
  --warm-white: #e8dcc8;      /* body text */
  --text-dim: #888;           /* secondary text */
  --success: #4a9;            /* green */
  --error: #c44;              /* red */
  --warning: #ca4;            /* yellow */
  --bold-orange: #e08030;     /* kill streak accent */
  --font-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  --font-sans: 'Inter', system-ui, sans-serif;
}

body {
  background: var(--bg-primary);
  color: var(--warm-white);
  font-family: var(--font-sans);
  margin: 0;
  padding: 0;
}

/* Navigation */
nav {
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  padding: 0.75rem 1.5rem;
  display: flex;
  gap: 1.5rem;
  align-items: center;
}

nav a {
  color: var(--text-dim);
  text-decoration: none;
  font-size: 0.9rem;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

nav a:hover, nav a.active {
  color: var(--gold);
  background: var(--bg-hover);
}

nav .brand {
  color: var(--terracotta);
  font-weight: 700;
  font-size: 1rem;
  letter-spacing: 0.05em;
}

/* Panels */
.panel {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 1.25rem;
  margin-bottom: 1rem;
}

.panel h2 {
  color: var(--gold);
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin: 0 0 0.75rem 0;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.5rem;
}

/* Tables */
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

th {
  color: var(--muted-gold);
  text-align: left;
  padding: 0.5rem;
  border-bottom: 1px solid var(--border);
  font-weight: 500;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

td {
  padding: 0.5rem;
  border-bottom: 1px solid var(--bg-hover);
}

tr:hover td {
  background: var(--bg-hover);
}

/* Status badges */
.badge { padding: 0.15rem 0.5rem; border-radius: 3px; font-size: 0.8rem; font-weight: 500; }
.badge-pass, .badge-fixed { background: #1a3a2a; color: var(--success); }
.badge-fail, .badge-open { background: #3a1a1a; color: var(--error); }
.badge-warn { background: #3a3a1a; color: var(--warning); }

/* Buttons */
button, .btn {
  background: var(--bg-hover);
  color: var(--warm-white);
  border: 1px solid var(--border);
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
}

button:hover, .btn:hover {
  border-color: var(--muted-gold);
  color: var(--gold);
}

button.primary, .btn-primary {
  background: var(--terracotta);
  border-color: var(--terracotta);
  color: #1a1a1a;
  font-weight: 600;
}

/* Live events stream */
.event-stream {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  max-height: 60vh;
  overflow-y: auto;
  padding: 0.5rem;
  background: var(--bg-primary);
  border-radius: 4px;
}

.event {
  padding: 0.2rem 0;
  border-bottom: 1px solid var(--bg-panel);
}

.event .time { color: var(--text-dim); }
.event .icon-spawn { color: var(--gold); }
.event .icon-tool { color: var(--success); }
.event .icon-error { color: var(--error); }
.event .icon-violation { color: var(--error); font-weight: bold; }

/* Forms */
input, textarea, select {
  background: var(--bg-primary);
  color: var(--warm-white);
  border: 1px solid var(--border);
  padding: 0.5rem;
  border-radius: 4px;
  font-size: 0.9rem;
  width: 100%;
}

input:focus, textarea:focus {
  border-color: var(--muted-gold);
  outline: none;
}

label {
  color: var(--muted-gold);
  font-size: 0.8rem;
  display: block;
  margin-bottom: 0.25rem;
}

/* Layout */
.container {
  max-width: 960px;
  margin: 0 auto;
  padding: 1.5rem;
}

.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.grid-3 {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 1rem;
}
```

## Runner (async, tokio)

Same logic as kiln-test's runner but async with tokio:

```rust
// runner.rs
use tokio::process::Command;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::broadcast;

pub async fn run_scenario(
    scenario: &Scenario,
    plugin_dir: &str,
    tx: broadcast::Sender<RunnerEvent>,
) -> RunResult {
    // 1. Create temp workspace
    let workspace = tempfile::tempdir().unwrap();

    // 2. Run setup.sh
    let setup = Command::new("bash")
        .arg(scenario.setup_script())
        .arg(workspace.path())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .status().await?;

    tx.send(RunnerEvent::WorkspaceReady(workspace.path().display().to_string()));

    // 3. Read prompt.md
    let prompt = tokio::fs::read_to_string(scenario.prompt_path()).await?;

    // 4. Spawn claude
    let mut child = Command::new("claude")
        .args(["-p", prompt.trim(),
               "--output-format", "stream-json",
               "--plugin-dir", plugin_dir,
               "--dangerously-skip-permissions"])
        .current_dir(workspace.path())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;

    tx.send(RunnerEvent::PipelineStarted);

    // 5. Parse stdout line by line
    let stdout = child.stdout.take().unwrap();
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();

    while let Some(line) = lines.next_line().await? {
        for event in parser::parse_line(&line) {
            let _ = tx.send(event);
        }
    }

    // 6. Check artifacts
    let artifacts = check_artifacts(&scenario, workspace.path());

    // 7. Return result
    RunResult { ... }
}
```

SSE endpoint streams from the broadcast receiver:

```rust
// routes/run.rs
async fn stream_events(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<SseEvent, Infallible>>> {
    let rx = state.run_broadcast.subscribe();

    let stream = BroadcastStream::new(rx).map(|event| {
        let html = render_event_fragment(&event);
        Ok(SseEvent::default().event("event").data(html))
    });

    Sse::new(stream)
}
```

## Navigation

Persistent top nav bar on all pages:

```html
<nav>
  <span class="brand">KILN FORGE</span>
  <a href="/">Dashboard</a>
  <a href="/findings">Findings</a>
  <a href="/validate">Validate</a>
  <a href="/scenarios">Test</a>
  <a href="/history">History</a>
  <a href="/baselines">Baselines</a>
  <a href="/evolution">Evolution</a>
</nav>
```

Active page highlighted with `.active` class.

## CLI

```
kiln-forge-server [OPTIONS]

Options:
  -p, --port <PORT>           Port to listen on [default: 3000]
  -d, --plugin-dir <DIR>      Plugin directory [default: /DEV/kilntop/plugin]
  -o, --open                  Open browser automatically on start
```

On startup: print `KILN FORGE listening on http://localhost:{port}` with terracotta ANSI color.

## Acceptance Criteria

1. Binary compiles with `cargo build --release` (zero errors)
2. Server starts and responds at `http://localhost:3000`
3. Dashboard shows plugin state, open findings, last run, recent changes
4. Findings CRUD works: create, view, edit, resolve, delete — all via htmx, no full page reloads
5. Validation runs natively in <2 seconds, renders results table
6. Scenario list loads from expect.json files
7. Running a scenario spawns claude, streams events via SSE in real-time
8. Results display artifact checks, compliance, metrics with color-coded status
9. History table shows all past runs
10. Baseline comparison shows deltas with improvement/regression indicators
11. Evolution log shows all changes chronologically
12. Kiln brand theme throughout — dark bg, terracotta accents, gold headers
13. No JavaScript frameworks — htmx + ~10 lines of vanilla JS (timer only)
14. All data persists in JSON files shared with kiln-forge skill
