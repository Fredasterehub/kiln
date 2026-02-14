---
name: kiln-init
description: Initialize kiln for a project — detect project type, tooling, and model availability
user_invocable: true
---
# /kiln:init — Project Initialization

## Overview

This skill performs one-time project setup for kiln. It detects what exists, configures kiln accordingly, and creates the state directory. It asks zero questions about workflow preferences — it detects everything automatically. The only user interaction is confirming the detected configuration.

**Prerequisites:** The kiln package must be installed (agents and skills present in `.claude/`). If `.kiln/` already exists with valid STATE.md, this is a 'returning' project — skip detection and resume.

**References:** This skill follows the contracts defined in kiln-core.

Treat the project root as the current working directory where `/kiln:init` is invoked.
Do not infer project state from parent directories.

Never assume git exists or is configured.
`/kiln:init` must work in plain folders, exported snapshots, and CI workspaces.

Follow the core principle: detect first, then write.
Do not create or overwrite `.kiln/` files until detection is complete and the operator has confirmed the config.

Use read-only checks during detection.
Detection commands must not install dependencies, run builds, or modify user files.

## Step 1: Detect Project Type

Check the project root directory to classify the project:

**Returning project** (highest priority — check first):
- Check: Does `.kiln/` directory exist AND does `.kiln/STATE.md` exist?
- If yes: This is a returning project. Read STATE.md to determine where the previous session left off.
- Action: Print 'Returning project detected. Resuming from [last state].' Skip to Step 5 (Confirmation).

**Brownfield project** (existing code):
- Check: Does the project contain source code? Look for ANY of these indicators:
  - `src/` directory exists
  - `lib/` directory exists
  - `app/` directory exists
  - `package.json` exists (Node.js)
  - `requirements.txt` or `pyproject.toml` or `setup.py` exists (Python)
  - `go.mod` exists (Go)
  - `Cargo.toml` exists (Rust)
  - `pom.xml` or `build.gradle` exists (Java)
  - `*.sln` or `*.csproj` exists (C#/.NET)
- If any match: This is a brownfield project. Existing code must be respected.
- Action: Set `projectType` to `'brownfield'`.

**Greenfield project** (no existing code):
- If none of the brownfield indicators match: This is a greenfield project. Starting from scratch.
- Action: Set `projectType` to `'greenfield'`.

Operational rules:

1. Returning detection always runs first.
2. If `.kiln/` exists but `.kiln/STATE.md` does not, this is not returning.
3. If `.kiln/STATE.md` exists but is corrupted/unreadable, treat as incomplete and use Error Handling flow.

Use a per-command 5-second timeout pattern:

```bash
timeout 5s bash -lc 'test -d .kiln'
timeout 5s bash -lc 'test -f .kiln/STATE.md'
```

If `timeout` is unavailable, use an equivalent wrapper that enforces ~5 seconds before failing.

Concrete probe sequence:

```bash
has_kiln_dir=false
has_state=false

timeout 5s bash -lc 'test -d .kiln' >/dev/null 2>&1 && has_kiln_dir=true
timeout 5s bash -lc 'test -f .kiln/STATE.md' >/dev/null 2>&1 && has_state=true
```

Safe `STATE.md` read pattern:

```bash
timeout 5s bash -lc 'sed -n "1,200p" .kiln/STATE.md'
```

Interpret `last state` as the most specific available marker, in this order:

1. `Last Completed Step: ...`
2. `Current Step: ...`
3. `Current Phase: ...` plus `Current Track: ...`
4. Fallback label `unknown state` if markers are missing.

Corruption indicators for `STATE.md`:

1. File cannot be read.
2. File is empty.
3. No recognizable markers for current/last state.

If corrupted, do not silently resume as returning.
Treat it as incomplete initialization and ask whether to reinitialize.

Brownfield indicator probes should also run with the timeout pattern (same `timeout 5s bash -lc ...` form).
Store results in memory as `projectType` and `lastState` values for later config generation.

## Step 2: Discover Existing Tooling

For brownfield projects, detect existing tooling. For greenfield projects, all values will be `null` (nothing to detect yet — tooling will be established during implementation).

Run these detection checks. Use the Bash tool to execute each command. If the command succeeds (exit 0), record the tool name. If it fails, set that category to `null`.

**Test Runner** — check in this priority order (first match wins):
1. `grep -q '"vitest"' package.json 2>/dev/null` → `'vitest'`
2. `grep -q '"jest"' package.json 2>/dev/null` → `'jest'`
3. `grep -q '"mocha"' package.json 2>/dev/null` → `'mocha'`
4. `test -f pytest.ini || test -f pyproject.toml && grep -q 'pytest' pyproject.toml 2>/dev/null` → `'pytest'`
5. `test -f go.mod` → `'go test'`
6. `test -f Cargo.toml` → `'cargo test'`
7. None found → `null`

**Linter** — check in this priority order:
1. `grep -q '"eslint"' package.json 2>/dev/null` → `'eslint'`
2. `grep -q '"biome"' package.json 2>/dev/null` → `'biome'`
3. `test -f .eslintrc* || test -f eslint.config.*` → `'eslint'`
4. `grep -q 'ruff' pyproject.toml 2>/dev/null || test -f ruff.toml` → `'ruff'`
5. `grep -q 'flake8' pyproject.toml 2>/dev/null || test -f .flake8` → `'flake8'`
6. `test -f .golangci.yml || test -f .golangci.yaml` → `'golangci-lint'`
7. None found → `null`

**Type Checker** — check in this priority order:
1. `test -f tsconfig.json` → `'tsc'`
2. `grep -q 'mypy' pyproject.toml 2>/dev/null || test -f mypy.ini` → `'mypy'`
3. `grep -q 'pyright' pyproject.toml 2>/dev/null` → `'pyright'`
4. None found → `null` (Go and Rust have built-in type checking via their compilers)

**Build System** — check in this priority order:
1. `grep -q '"build"' package.json 2>/dev/null` → `'npm run build'`
2. `test -f Makefile` → `'make'`
3. `test -f Cargo.toml` → `'cargo build'`
4. `test -f go.mod` → `'go build ./...'`
5. None found → `null`

**Start Command** — check in this priority order:
1. `grep -q '"dev"' package.json 2>/dev/null` → `'npm run dev'`
2. `grep -q '"start"' package.json 2>/dev/null` → `'npm start'`
3. `test -f manage.py` → `'python manage.py runserver'`
4. `test -f app.py` → `'python app.py'`
5. `test -f main.py` → `'python main.py'`
6. `test -f main.go` → `'go run main.go'`
7. `test -f Cargo.toml` → `'cargo run'`
8. None found → `null`

Execution requirements:

1. Run each detection command with `timeout 5s`.
2. Timeout counts as not detected.
3. Keep first-match-wins behavior per category.
4. Do not run any command that mutates files.

Run checks using `bash -lc` to preserve shell semantics:

```bash
timeout 5s bash -lc 'grep -q "\"vitest\"" package.json 2>/dev/null'
```

For precedence-sensitive expressions, keep logic identical and use grouping:

```bash
timeout 5s bash -lc '( test -f pytest.ini ) || ( test -f pyproject.toml && grep -q "pytest" pyproject.toml 2>/dev/null )'
timeout 5s bash -lc '( test -f .eslintrc* ) || ( test -f eslint.config.* )'
```

Greenfield behavior: set all tooling values to `null` and skip command execution.
Store tooling results into variables (`testRunner`, `linter`, `typeChecker`, `buildSystem`, `startCommand`) for `.kiln/config.json`.
When not detected, keep JSON `null` (not string `"null"`).

## Step 3: Detect Model Availability

Check if Codex CLI is available for multi-model mode:

1. Run: `which codex 2>/dev/null`
   - If not found: Set `modelMode` to `'claude-only'`. Print: 'Codex CLI not found. Running in Claude-only mode.'
   - If found: Continue to authentication check.

2. Run: `codex --version 2>/dev/null`
   - If this succeeds: Set `modelMode` to `'multi-model'`. Print: 'Codex CLI detected (version X). Multi-model mode enabled.'
   - If this fails: Set `modelMode` to `'claude-only'`. Print: 'Codex CLI found but not properly configured. Running in Claude-only mode.'

Note: The user can override this later by editing `.kiln/config.json` directly.

Run both commands with timeouts:

```bash
codexPath="$(timeout 5s bash -lc 'which codex 2>/dev/null' || true)"
codexVersion="$(timeout 5s bash -lc 'codex --version 2>/dev/null' || true)"
```

Rules:

1. No `codex` path: `modelMode='claude-only'`.
2. Path plus successful version: `modelMode='multi-model'`.
3. Path but version failure/timeout: `modelMode='claude-only'`.

Capture version text for operator display.
Do not persist version unless a template explicitly requires it.

Do not attempt interactive authentication flows in `/kiln:init`.

## Step 4: Create .kiln/ Directory

Create the kiln state directory structure. Use the templates from the kiln package.

1. Create directories:
   ```
   mkdir -p .kiln/docs
   mkdir -p .kiln/tracks
   ```

2. Create `config.json` from template:
   - Read the template from `templates/config.json.tmpl` (relative to the kiln package install location, which is `.claude/skills/kiln-init/../../templates/` or find it via glob)
   - If the template can't be found, create the JSON directly with the detected values:
   ```json
   {
     "projectType": "<detected>",
     "modelMode": "<detected>",
     "tooling": {
       "testRunner": "<detected or null>",
       "linter": "<detected or null>",
       "typeChecker": "<detected or null>",
       "buildSystem": "<detected or null>",
       "startCommand": "<detected or null>"
     },
     "preferences": {
       "maxRetries": 2,
       "waveParallelism": 3,
       "e2eTimeout": 30000
     }
   }
   ```
   - Fill in detected values from Steps 1-3.

3. Create `STATE.md` from template:
   - Read from `templates/STATE.md.tmpl`
   - Fill in: project name (from directory name or package.json `name` field), model mode, initialization timestamp (ISO 8601)
   - Set all other fields to initial values (no phases yet, no current track, zero correction cycles, zero regression tests)

4. Create empty living doc placeholders:
   ```
   touch .kiln/docs/TECH_STACK.md
   touch .kiln/docs/PATTERNS.md
   touch .kiln/docs/DECISIONS.md
   touch .kiln/docs/PITFALLS.md
   ```

Authoritative rule:

1. `.kiln/` MUST NOT be added to `.gitignore`.
2. `.kiln/` is intended to be committed for auditability.
3. Do not modify `.gitignore` to ignore kiln state.

Template lookup guidance:

1. First try `.claude/skills/kiln-init/../../templates/`.
2. Then try project `templates/`.
3. Then use a bounded search under `.claude/` and project root.

Example search:

```bash
find .claude . -maxdepth 5 -type f \( -name 'config.json.tmpl' -o -name 'STATE.md.tmpl' \) 2>/dev/null
```

If multiple templates are found, select the closest kiln package path first; otherwise prefer project `templates/`.

Overwrite behavior:

1. Returning project with valid `STATE.md`: do not overwrite existing `.kiln/`.
2. `.kiln/` exists but incomplete: ask before overwriting.
3. Default overwrite scope for reinitialize: `.kiln/config.json` and `.kiln/STATE.md`.
4. Preserve `.kiln/docs/*` and `.kiln/tracks/*` unless operator requests broader reset.

Fallback `STATE.md` minimum required fields (if template missing):

1. Project name.
2. Initialized timestamp (ISO 8601).
3. Model mode.
4. Project type.
5. Current phase.
6. Current track.
7. Last completed step.
8. Correction cycles.
9. Regression tests run.

Fallback `STATE.md` skeleton:

```markdown
# Kiln State

Project: <project_name>
Initialized At: <iso_timestamp>
Model Mode: <multi-model|claude-only>
Project Type: <greenfield|brownfield|returning>
Current Phase: none
Current Track: none
Current Step: initialization
Last Completed Step: /kiln:init
Correction Cycles: 0
Regression Tests Run: 0
```

Ensure all created files are UTF-8 text and end with a trailing newline.

## Step 5: Confirm Configuration

Display the detected configuration to the operator and ask for confirmation:

```
Kiln initialized for: <project_name>

Project type: <greenfield|brownfield|returning>
Model mode:   <multi-model|claude-only>

Detected tooling:
  Test runner:   <value or 'not detected'>
  Linter:        <value or 'not detected'>
  Type checker:  <value or 'not detected'>
  Build system:  <value or 'not detected'>
  Start command: <value or 'not detected'>

Preferences (defaults):
  Max retries per task: 2
  Wave parallelism:     3
  E2E timeout:          30s

.kiln/ directory created.
```

Ask: 'Does this configuration look correct? You can edit .kiln/config.json manually at any time to adjust these values.'

If the operator confirms: Print 'Initialization complete. Run /kiln:brainstorm to start.' (or 'Run /kiln:status to see where you left off.' for returning projects).

If the operator wants changes: Let them specify corrections. Update config.json accordingly. Re-display and re-confirm.

Correction loop guidance:

1. Ask for all corrections in one message where possible.
2. Validate corrections before writing.
3. Apply minimal edits only to requested keys.
4. Reprint the same summary block.
5. Re-ask for confirmation until accepted.

Validation rules:

1. `modelMode` must be `multi-model` or `claude-only`.
2. Tooling fields can be known string values or `null`.
3. Keep detection-derived `projectType` for returning projects unless operator explicitly insists.

If operator insists on changing returning `projectType`, apply the requested edit and warn about possible resume inconsistencies.

## Error Handling

- If `.kiln/` already exists and this is NOT a returning project (no STATE.md): warn the operator that `.kiln/` exists but appears incomplete. Ask if they want to reinitialize (will overwrite existing config).
- If template files cannot be found: create config.json and STATE.md with hardcoded defaults rather than failing.
- If any detection command hangs: use a 5-second timeout per command. Treat timeout as 'not detected'.

Use this exact warning text for incomplete `.kiln/`:

`Warning: .kiln/ exists but STATE.md is missing or invalid. It appears incomplete. Reinitialize now? This will overwrite .kiln/config.json and .kiln/STATE.md.`

Overwrite scope on reinitialize:

1. Overwrite `.kiln/config.json` and `.kiln/STATE.md`.
2. Preserve `.kiln/docs/*` and `.kiln/tracks/*` by default.
3. Ask before any broader deletion/reset.

Corrupted `STATE.md` behavior:

1. If parsing fails or required markers are missing, treat as incomplete.
2. Do not proceed as returning.
3. Ask operator whether to reinitialize.

Timeout behavior:

1. Use `timeout 5s` per detection command.
2. Timeout or non-zero exit means not detected for that check.
3. Continue other checks even if one command times out.

If writes fail (permissions, disk, path issues), print the failing file and reason, then ask operator to retry or abort.
