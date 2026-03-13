# kiln-test — Interactive Test Runner TUI

Self-contained project specification for the Kiln pipeline test runner. Built with Rust + Ratatui. This blueprint is the input for ST12 — the Kiln pipeline builds its own test runner.

## Project Overview

Interactive TUI for running Kiln pipeline smoke test scenarios, viewing live progress, comparing results against baselines, and tracking metrics over time. Replaces manual "run claude, observe for hours, log findings" workflow.

## Tech Stack

- **Language**: Rust 1.92 (`/home/dev/.cargo/bin/rustc`)
- **TUI framework**: Ratatui 0.29 + crossterm
- **Serialization**: serde + serde_json
- **CLI args**: clap 4
- **Project location**: `/DEV/kilntop/kiln-test/`

### Cargo.toml Dependencies

```toml
[package]
name = "kiln-test"
version = "0.1.0"
edition = "2021"

[dependencies]
ratatui = "0.29"
crossterm = "0.28"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
clap = { version = "4", features = ["derive"] }
chrono = { version = "0.4", features = ["serde"] }
```

## Architecture

### Threading Model

```
┌─────────────────────────────────┐
│  Main Thread (TUI)              │
│  - Event poll (33ms tick)       │
│  - Render views                 │
│  - Handle keyboard input        │
│  ↕ mpsc::channel<RunnerEvent>   │
│                                 │
│  Background Thread (Runner)     │
│  - Create temp workspace        │
│  - Copy seed artifacts          │
│  - git init + commit            │
│  - Spawn claude -p process      │
│  - Parse stream-json stdout     │
│  - Send RunnerEvents to main    │
│  - On exit: run artifact checks │
│  - Send RunComplete             │
└─────────────────────────────────┘
```

Main thread never blocks on I/O. All pipeline execution happens in the background thread. Communication via `mpsc::Sender<RunnerEvent>` / `mpsc::Receiver<RunnerEvent>`.

### Views

```
Dashboard → Scenarios → Run (live) → Results → History → Baselines
    │           │           │            │          │          │
    │           │           │            │          │          └─ Set/compare baselines
    │           │           │            │          └─ Past run table
    │           │           │            └─ Post-run metrics + checks
    │           │           └─ Live agent spawns, tool calls, duration
    │           └─ Select S1/S5/S6, configure, launch
    └─ Overview: last run, open findings, quick actions
```

Navigation: Tab/Shift+Tab between views. `q` to quit. `Enter` to select/launch. `Esc` to go back.

### Project Structure

```
kiln-test/
├── Cargo.toml
└── src/
    ├── main.rs           # CLI parsing, terminal setup/restore, main loop
    ├── app.rs            # App state, view enum, event dispatch
    ├── event.rs          # Event enum (Key, Tick, Resize, Runner)
    ├── theme.rs          # Kiln brand colors (Style constants)
    ├── runner.rs         # Background thread: workspace setup, claude spawn, cleanup
    ├── parser.rs         # Stream-JSON line parser → RunnerEvents
    ├── metrics.rs        # Metric calculation, threshold checks, baseline comparison
    ├── scenarios.rs      # Scenario loading from expect.json files
    ├── history.rs        # Run history read/write (run-history.json)
    └── views/
        ├── mod.rs        # View trait, render dispatcher
        ├── dashboard.rs  # Dashboard view
        ├── scenarios.rs  # Scenario list + detail
        ├── run.rs        # Live run view (scrolling log, counters)
        ├── results.rs    # Post-run results
        ├── history.rs    # History table
        ├── baselines.rs  # Baseline comparison
        └── status_bar.rs # Bottom status line (view name, keybinds, clock)
```

## Detailed Component Specs

### main.rs (~80 lines)

```rust
use clap::Parser;

#[derive(Parser)]
#[command(name = "kiln-test", about = "Kiln pipeline test runner")]
struct Cli {
    /// Run a specific scenario immediately (S1, S5, S6)
    #[arg(short, long)]
    scenario: Option<String>,

    /// Plugin directory path
    #[arg(short, long, default_value = "/DEV/kilntop/plugin")]
    plugin_dir: String,

    /// Workspace directory (temp dir if not specified)
    #[arg(short, long)]
    workspace: Option<String>,
}
```

1. Parse CLI args
2. If `--scenario` provided, launch directly into run view
3. Otherwise, show dashboard
4. Terminal setup: `enable_raw_mode()`, `EnterAlternateScreen`, create `Terminal<CrosstermBackend<Stdout>>`
5. Main loop: poll events, dispatch, render
6. Terminal restore on exit (via Drop guard)

### app.rs (~200 lines)

```rust
pub struct App {
    pub view: View,
    pub should_quit: bool,
    pub scenarios: Vec<Scenario>,
    pub selected_scenario: usize,
    pub run_state: Option<RunState>,
    pub run_history: Vec<RunRecord>,
    pub plugin_dir: String,
    pub status_message: Option<(String, Instant)>,
}

pub enum View {
    Dashboard,
    Scenarios,
    Run,
    Results,
    History,
    Baselines,
}

pub struct RunState {
    pub scenario: Scenario,
    pub workspace: String,
    pub started_at: Instant,
    pub events: Vec<RunnerEvent>,
    pub agents_spawned: u32,
    pub tool_calls: u32,
    pub tokens_used: u64,
    pub hook_violations: u32,
    pub is_complete: bool,
    pub result: Option<RunResult>,
    pub scroll_offset: u16,
}
```

Event handling: match on `(view, key)` pairs. Tab cycles views. `r` in Scenarios starts a run. `s` in Results saves to history.

### event.rs (~30 lines)

```rust
pub enum Event {
    Key(KeyEvent),
    Tick,
    Resize(u16, u16),
    Runner(RunnerEvent),
}
```

Poll function: check crossterm events with 33ms timeout, drain mpsc channel for RunnerEvents, emit Tick on timeout.

### theme.rs (~50 lines)

Kiln brand palette as Ratatui `Style` constants:

```rust
use ratatui::style::{Color, Modifier, Style};

pub const TERRACOTTA: Color = Color::Indexed(173);  // Warm terracotta
pub const GOLD: Color = Color::Indexed(222);         // Warm gold
pub const MUTED_GOLD: Color = Color::Indexed(179);   // Muted gold (rules)
pub const DARK_BG: Color = Color::Indexed(234);      // Dark background
pub const WARM_WHITE: Color = Color::Indexed(223);    // Warm white text
pub const BOLD_ORANGE: Color = Color::Indexed(208);   // Kill streak accent
pub const SUCCESS: Color = Color::Green;
pub const FAILURE: Color = Color::Red;
pub const WARNING: Color = Color::Yellow;
pub const DIM: Color = Color::DarkGray;

pub fn title_style() -> Style {
    Style::default().fg(TERRACOTTA).add_modifier(Modifier::BOLD)
}

pub fn header_style() -> Style {
    Style::default().fg(GOLD)
}

pub fn normal_style() -> Style {
    Style::default().fg(WARM_WHITE)
}

pub fn status_style(passed: bool) -> Style {
    if passed {
        Style::default().fg(SUCCESS)
    } else {
        Style::default().fg(FAILURE)
    }
}
```

### runner.rs (~250 lines)

The critical path. Runs in a background thread.

```rust
pub struct RunnerConfig {
    pub scenario_dir: PathBuf,
    pub plugin_dir: PathBuf,
    pub workspace: Option<PathBuf>,
}

pub enum RunnerEvent {
    WorkspaceReady(String),
    PipelineStarted,
    AgentSpawned { name: String, agent_type: String },
    ToolCall { agent: String, tool: String },
    TokenUsage { input: u64, output: u64 },
    LogLine(String),
    HookViolation(String),
    Error(String),
    RunComplete(RunResult),
}

pub struct RunResult {
    pub duration_seconds: u64,
    pub exit_code: i32,
    pub agents_spawned: u32,
    pub tool_calls: u32,
    pub tokens_used: u64,
    pub hook_violations: u32,
    pub artifact_checks: Vec<ArtifactCheck>,
    pub compliance_checks: Vec<ComplianceCheck>,
}
```

**Runner thread flow:**

1. Create workspace: `mktemp -d /tmp/kiln-test-XXXXXX` (or use provided path)
2. Run scenario setup: `bash {scenario_dir}/seed/setup.sh {workspace}`
3. Send `WorkspaceReady`
4. Read `prompt.md` from scenario dir
5. Spawn claude process:
   ```
   Command::new("claude")
       .args(["-p", &prompt, "--output-format", "stream-json",
              "--plugin-dir", &plugin_dir, "--dangerously-skip-permissions"])
       .current_dir(&workspace)
       .stdout(Stdio::piped())
       .stderr(Stdio::piped())
       .spawn()
   ```
6. Send `PipelineStarted`
7. Read stdout line by line → pass each line to `parser::parse_line()` → send resulting events
8. On process exit: run artifact checks from `expect.json` → send `RunComplete`

### parser.rs (~150 lines)

Parses `--output-format stream-json` line by line. Each line is a JSON object. Uses `serde_json::Value` for forward compatibility — no rigid schema.

**Key event types to detect:**

```rust
pub fn parse_line(line: &str) -> Vec<RunnerEvent> {
    let v: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return vec![RunnerEvent::LogLine(line.to_string())],
    };

    let mut events = vec![];

    // Agent spawn detection
    if v["type"] == "tool_use" && v["name"] == "Agent" {
        if let Some(input) = v.get("input") {
            let name = input["name"].as_str().unwrap_or("unknown");
            let agent_type = input["subagent_type"].as_str().unwrap_or("unknown");
            events.push(RunnerEvent::AgentSpawned {
                name: name.to_string(),
                agent_type: agent_type.to_string(),
            });
        }
    }

    // Tool call detection
    if v["type"] == "tool_use" {
        let tool = v["name"].as_str().unwrap_or("unknown");
        let agent = v.get("agent_type").and_then(|a| a.as_str()).unwrap_or("engine");
        events.push(RunnerEvent::ToolCall {
            agent: agent.to_string(),
            tool: tool.to_string(),
        });
    }

    // Token usage from result events
    if v["type"] == "result" {
        if let Some(usage) = v.get("usage") {
            let input = usage["input_tokens"].as_u64().unwrap_or(0);
            let output = usage["output_tokens"].as_u64().unwrap_or(0);
            events.push(RunnerEvent::TokenUsage { input, output });
        }
    }

    // Hook violation detection (error messages from enforce-pipeline.sh)
    if v["type"] == "tool_result" {
        if let Some(content) = v.get("content").and_then(|c| c.as_str()) {
            if content.contains("BLOCKED:") || content.contains("STOP.") {
                events.push(RunnerEvent::HookViolation(content.to_string()));
            }
        }
    }

    events
}
```

**Forward compatibility**: Uses `Value` pattern matching, not `#[derive(Deserialize)]` structs. New event types are ignored gracefully. Fields that don't exist return `None`.

### metrics.rs (~100 lines)

```rust
pub struct Metrics {
    pub duration_seconds: u64,
    pub agents_spawned: u32,
    pub tool_calls: u32,
    pub tokens_used: u64,
    pub hook_violations: u32,
    pub correction_cycles: u32,
    pub prompt_skeleton_score: Option<u8>,  // 0-6
    pub artifact_completeness: f32,         // 0.0-1.0
}

pub enum Threshold {
    Green,
    Yellow,
    Red,
}

pub fn check_duration(scenario: &str, seconds: u64) -> Threshold { ... }
pub fn check_hook_violations(count: u32) -> Threshold { ... }
pub fn check_skeleton(score: u8) -> Threshold { ... }
pub fn check_artifacts(ratio: f32) -> Threshold { ... }

pub fn compare_to_baseline(current: &Metrics, baseline: &Metrics) -> Vec<MetricDelta> { ... }
```

Threshold definitions from `references/metrics.md`:
- Duration: per-scenario targets (S1 ≤10m, S5 ≤20m, S6 ≤60m)
- Hook violations: 0=green, 1-2=yellow, ≥3=red
- Skeleton: ≥5=green, 4=yellow, ≤3=red
- Artifacts: 100%=green, ≥80%=yellow, <80%=red

### scenarios.rs (~80 lines)

```rust
pub struct Scenario {
    pub id: String,           // "S1", "S5", "S6"
    pub name: String,
    pub description: String,
    pub timeout_seconds: u64,
    pub dir: PathBuf,
    pub expect: ExpectConfig,
}

pub struct ExpectConfig {
    pub artifacts: Vec<ArtifactExpect>,
    pub compliance: Vec<ComplianceExpect>,
    pub metrics: MetricTargets,
}
```

Loads scenarios by scanning `{plugin_dir}/skills/kiln-forge/scenarios/*/expect.json`.

### history.rs (~80 lines)

Read/write `{plugin_dir}/skills/kiln-forge/data/run-history.json`.

```rust
pub struct RunRecord {
    pub timestamp: String,
    pub scenario: String,
    pub name: Option<String>,
    pub duration_seconds: Option<u64>,
    pub result: String,  // "pass", "fail", "timeout", "interrupted"
    pub metrics: Metrics,
    pub baseline: bool,
    pub notes: String,
}

pub fn load_history(path: &Path) -> Vec<RunRecord> { ... }
pub fn save_history(path: &Path, history: &[RunRecord]) -> Result<()> { ... }
pub fn append_run(path: &Path, record: RunRecord) -> Result<()> { ... }
```

### views/ — View Modules

Each view implements rendering and key handling.

#### views/mod.rs (~30 lines)

```rust
pub fn render(frame: &mut Frame, app: &App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(1), Constraint::Length(1)])
        .split(frame.area());

    match app.view {
        View::Dashboard => dashboard::render(frame, app, chunks[0]),
        View::Scenarios => scenarios::render(frame, app, chunks[0]),
        View::Run => run::render(frame, app, chunks[0]),
        View::Results => results::render(frame, app, chunks[0]),
        View::History => history::render(frame, app, chunks[0]),
        View::Baselines => baselines::render(frame, app, chunks[0]),
    }

    status_bar::render(frame, app, chunks[1]);
}
```

#### views/dashboard.rs (~100 lines)

```
╔══════════════════════════════════════════════════════╗
║  KILN TEST — Dashboard                               ║
╚══════════════════════════════════════════════════════╝

  Plugin: v1.0.5    Forge: v0.1.0    Agents: 23

  ┌─ Last Run ────────────────────────────────────────┐
  │  S5 Build Cycle — PASS  (14m 32s)                 │
  │  2026-03-12 14:30                                 │
  └───────────────────────────────────────────────────┘

  ┌─ Quick Actions ───────────────────────────────────┐
  │  [1] Run S1 Research    [4] View History           │
  │  [2] Run S5 Build       [5] Compare Baselines      │
  │  [3] Run S6 Full        [6] Plugin State            │
  └───────────────────────────────────────────────────┘

  Open Findings: 10          Active Tasks: 0
```

#### views/scenarios.rs (~120 lines)

List of scenarios with details. Arrow keys to select, Enter to launch.

```
╔══════════════════════════════════════════════════════╗
║  Scenarios                                           ║
╚══════════════════════════════════════════════════════╝

  ► S1  Research Only      10 min    Steps 1-2 → Step 3
    S5  Build Cycle        20 min    Steps 1-4 → Step 5
    S6  Full Autonomous    60 min    Steps 1-2 → Steps 3-7

  ┌─ S1: Research Only ──────────────────────────────┐
  │  Tests: MI6 + field agents, progressive synthesis │
  │  Seed: Steps 1-2 complete (from ST10/finalkiln)   │
  │  Checks: research.md exists, RESEARCH_COMPLETE    │
  │  Last run: never                                  │
  └───────────────────────────────────────────────────┘

  [Enter] Launch    [b] Set Baseline    [Esc] Back
```

#### views/run.rs (~150 lines)

Live run view. Shows scrolling event log + counters.

```
╔══════════════════════════════════════════════════════╗
║  Running: S5 Build Cycle                     02:34   ║
╚══════════════════════════════════════════════════════╝

  Agents: 3    Tools: 42    Tokens: 84K    Violations: 0

  ┌─ Live Events ─────────────────────────────────────┐
  │  14:30:12  ◆ rakim spawned                        │
  │  14:30:12  ◆ sentinel spawned                     │
  │  14:30:15  ✓ rakim: Read .kiln/docs/codebase-st.. │
  │  14:30:16  ✓ sentinel: Read .kiln/docs/patterns..  │
  │  14:30:20  ◆ krs-one spawned                      │
  │  14:30:25  ✓ krs-one: Read .kiln/master-plan.md    │
  │  14:30:30  ◆ codex spawned                        │
  │  14:30:31  ◆ sphinx spawned                       │
  │  14:30:35  ✓ codex: Bash codex exec ...            │
  │  14:30:35    ⏳ codex executing GPT-5.4...          │
  └───────────────────────────────────────────────────┘

  [Esc] Cancel    [↑↓] Scroll    [f] Follow (auto-scroll)
```

Counters update in real-time from RunnerEvents. Event log scrolls with auto-follow (toggle with `f`).

#### views/results.rs (~120 lines)

Post-run results with artifact checks and compliance.

```
╔══════════════════════════════════════════════════════╗
║  Results: S5 Build Cycle — PASS                      ║
╚══════════════════════════════════════════════════════╝

  Duration: 14m 32s                          ✓ GREEN

  ┌─ Artifacts ───────────────────────────────────────┐
  │  ✓ .kiln/docs/codebase-state.md                   │
  │  ✓ .kiln/docs/patterns.md                         │
  │  ✓ .kiln/docs/pitfalls.md                         │
  │  ✓ .kiln/STATE.md                                 │
  └───────────────────────────────────────────────────┘

  ┌─ Compliance ──────────────────────────────────────┐
  │  ✓ prompt_skeleton: 5/6 sections                  │
  │  ✓ hook_violations: 0                             │
  │  ✓ delegation_compliance: passed                  │
  │  ✓ bootstrap_before_dispatch: passed              │
  │  ✓ iteration_signal: MILESTONE_COMPLETE received  │
  └───────────────────────────────────────────────────┘

  ┌─ Metrics ─────────────────────────────────────────┐
  │  agents_spawned .......... 5      tokens .... 284K │
  │  tool_calls .............. 142    violations ... 0  │
  │  correction_cycles ....... 0      skeleton ... 5/6  │
  └───────────────────────────────────────────────────┘

  [s] Save to history    [b] Set as baseline    [Esc] Back
```

#### views/history.rs (~100 lines)

Table of past runs. Arrow keys to navigate, Enter for details.

```
╔══════════════════════════════════════════════════════╗
║  Run History                                         ║
╚══════════════════════════════════════════════════════╝

  │ #  │ Date       │ Scenario │ Result  │ Duration │ Tokens │
  │ 1  │ 2026-03-12 │ S5       │ PASS    │ 14m 32s  │ 284K   │
  │ 2  │ 2026-03-11 │ S5       │ FAIL    │ 22m 10s  │ 340K   │
  │ 3  │ 2026-03-10 │ ST10     │ PASS    │ manual   │ —      │
  │ 4  │ 2026-03-11 │ ST11     │ INTR    │ —        │ —      │
  │ 5  │ 2026-03-11 │ ST11.5   │ INTR    │ —        │ —      │

  [Enter] Details    [b] Set baseline    [d] Delete    [Esc] Back
```

#### views/baselines.rs (~100 lines)

Side-by-side comparison of current run vs baseline.

```
╔══════════════════════════════════════════════════════╗
║  Baseline Comparison — S5                            ║
╚══════════════════════════════════════════════════════╝

  │ Metric          │ Baseline │ Current │ Delta   │ Status │
  │ duration (min)  │ 16.0     │ 14.5    │ -1.5    │ ✓      │
  │ tool_calls      │ 150      │ 130     │ -20     │ ✓      │
  │ tokens (K)      │ 300      │ 270     │ -30     │ ✓      │
  │ hook_violations │ 0        │ 0       │ 0       │ ✓      │
  │ skeleton        │ 4/6      │ 5/6     │ +1      │ ✓      │
  │ artifacts       │ 100%     │ 100%    │ 0       │ ✓      │

  Overall: IMPROVEMENT (3 better, 3 same, 0 worse)

  [Esc] Back
```

#### views/status_bar.rs (~40 lines)

```
 Dashboard │ Tab: next view │ q: quit │ 14:32:15
```

Shows current view name, context-sensitive keybinds, and clock.

## Build Instructions

```bash
# Ensure Rust is in PATH
source /home/dev/.cargo/env

# Create and build project
cd /DEV/kilntop/kiln-test
cargo build --release

# Run
./target/release/kiln-test

# Run specific scenario
./target/release/kiln-test --scenario S5
```

## Testing the Binary

1. `cargo build` compiles without errors → structural pass
2. Launch TUI → dashboard renders → visual pass
3. Navigate all views → no panics → stability pass
4. Launch S1 scenario → pipeline runs → integration pass
5. Results display with metrics → data flow pass

## Acceptance Criteria

1. Binary compiles with `cargo build --release` (zero errors, zero warnings)
2. TUI launches and displays the dashboard view
3. All 6 views are navigable with Tab/Shift+Tab
4. Scenario list loads from `expect.json` files
5. Running a scenario spawns claude process and shows live events
6. Post-run results display artifact checks and metrics
7. History saves to and loads from `run-history.json`
8. Baseline comparison calculates deltas and flags regressions
9. Theme uses Kiln brand palette (terracotta, gold, dark bg)
10. Clean terminal restore on exit (no raw mode artifacts)
