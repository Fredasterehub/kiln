You are GPT-5.3-codex running in Codex CLI inside the repo at `/tank/dump/DEV/kiln` (cwd is the repo root). Implement the task by editing the working tree (use `apply_patch`). The implementer has zero prior context: follow the instructions here exactly and do not assume anything else.

# Task: T03-T02 — Write `/kiln:init` skill

## Goal
Create the Claude Code slash-command skill file for `/kiln:init`. This skill performs one-time project setup for Kiln: detect project type, discover existing tooling, detect Codex CLI availability, create `.kiln/` state directory from templates (with fallback), and confirm the detected configuration with the operator.

## Acceptance Criteria (AC-02)
Your `skills/kiln-init/kiln-init.md` must:
- Handle greenfield, brownfield, and returning project detection with correct heuristics (returning has highest priority).
- Include correct tooling discovery commands for all 5 tooling categories (test runner, linter, type checker, build system, start command), with priority order as specified.
- Include Codex CLI detection (which + version) and set `modelMode` accordingly.
- Create `.kiln/` directory structure and required files using templates when available, with hardcoded fallback when templates are missing.
- Confirm detected config with the operator; allow corrections; re-confirm.
- Include robust error handling: incomplete `.kiln/`, missing templates, hung detection commands (5s timeout), corrupted `STATE.md` handling.

## Files
Add exactly one file:
- `skills/kiln-init/kiln-init.md` (action: add)

Do not modify any other files.

## Required verification commands (run them after writing the file)
- `test -f skills/kiln-init/kiln-init.md`
- `wc -l skills/kiln-init/kiln-init.md` (should be ~250–400 lines; target ~350)

## Output constraints for your implementation
- The skill file must be a Markdown document with YAML frontmatter.
- It must begin with the exact YAML frontmatter block shown below.
- It must contain the exact headings and section structure specified below, in order.
- Where this prompt provides exact text, include it verbatim.
- Expand with additional operational detail (checklists, explicit command patterns, fallback logic, and guardrails) to reach ~350 lines, but do not contradict any required content.
- Keep the skill self-contained: it should instruct the agent what to do, what to record, and what to ask the operator.

---

# File content specification (must implement exactly)

Create `skills/kiln-init/kiln-init.md` with:

## 0) YAML frontmatter (MUST be exactly this)
```yaml
---
name: kiln-init
description: Initialize kiln for a project — detect project type, tooling, and model availability
user_invocable: true
---
```

Immediately after frontmatter, add a Markdown H1 heading:

`# /kiln:init — Project Initialization`

Then include the following sections in order, with the exact headings.

---

## Section 1: Overview

Heading: `## Overview`

Include this exact content verbatim (keep paragraphs and emphasis):

"This skill performs one-time project setup for kiln. It detects what exists, configures kiln accordingly, and creates the state directory. It asks zero questions about workflow preferences — it detects everything automatically. The only user interaction is confirming the detected configuration.

**Prerequisites:** The kiln package must be installed (agents and skills present in `.claude/`). If `.kiln/` already exists with valid STATE.md, this is a 'returning' project — skip detection and resume.

**References:** This skill follows the contracts defined in kiln-core."

After the verbatim content, add additional practical guidance (to help the agent execute safely) without changing the meaning: what “project root” means (cwd), never assume git exists, and the principle “detect first, then write”.

---

## Section 2: Project Type Detection

Heading: `## Step 1: Detect Project Type`

Include this exact content verbatim:

"Check the project root directory to classify the project:

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
- Action: Set `projectType` to `'greenfield'`."

Then add additional instructions (to reach target length) that make this robust:
- How to safely read `.kiln/STATE.md` (handle missing fields, corrupted content) and what “last state” means (e.g., last completed step / current track / phase).
- Explicitly state: if `.kiln/` exists but `.kiln/STATE.md` does not, this is *not* returning (handled later in Error Handling).
- Provide concrete bash snippets the agent should run (e.g., `test -d .kiln`, `test -f .kiln/STATE.md`) with 5-second timeouts pattern (see Error Handling).

---

## Section 3: Tooling Discovery

Heading: `## Step 2: Discover Existing Tooling`

Include this exact content verbatim:

"For brownfield projects, detect existing tooling. For greenfield projects, all values will be `null` (nothing to detect yet — tooling will be established during implementation).

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
8. None found → `null`"

After the verbatim text, add operational detail to make the checks reliable:
- State that each detection command must be run with a 5-second timeout; treat timeout as “not detected”.
- Clarify bash precedence pitfalls: run the exact checks as written, but execute them in a way that preserves intended semantics (e.g., wrap complex expressions in `bash -lc` and use parentheses when needed).
- Clarify that these checks must not modify files.
- Describe how to store results into variables the agent will later write into `.kiln/config.json`.

---

## Section 4: Codex CLI Detection

Heading: `## Step 3: Detect Model Availability`

Include this exact content verbatim:

"Check if Codex CLI is available for multi-model mode:

1. Run: `which codex 2>/dev/null`
   - If not found: Set `modelMode` to `'claude-only'`. Print: 'Codex CLI not found. Running in Claude-only mode.'
   - If found: Continue to authentication check.

2. Run: `codex --version 2>/dev/null`
   - If this succeeds: Set `modelMode` to `'multi-model'`. Print: 'Codex CLI detected (version X). Multi-model mode enabled.'
   - If this fails: Set `modelMode` to `'claude-only'`. Print: 'Codex CLI found but not properly configured. Running in Claude-only mode.'

Note: The user can override this later by editing `.kiln/config.json` directly."

Then add additional guardrails:
- Use 5-second timeouts for both commands.
- If `codex --version` prints a version, capture it for operator display but do not store it unless the templates expect it.
- Do not attempt interactive auth flows here; just detect.

---

## Section 5: Create .kiln/ Directory

Heading: `## Step 4: Create .kiln/ Directory`

Include this exact content verbatim:

"Create the kiln state directory structure. Use the templates from the kiln package.

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
     \"projectType\": \"<detected>\",
     \"modelMode\": \"<detected>\",
     \"tooling\": {
       \"testRunner\": <detected or null>,
       \"linter\": <detected or null>,
       \"typeChecker\": <detected or null>,
       \"buildSystem\": <detected or null>,
       \"startCommand\": <detected or null>
     },
     \"preferences\": {
       \"maxRetries\": 2,
       \"waveParallelism\": 3,
       \"e2eTimeout\": 30000
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

5. Add `.kiln/` to `.gitignore` if not already present:
   - Check: `grep -q '.kiln/' .gitignore 2>/dev/null`
   - If not present: append `.kiln/` to `.gitignore`

   Actually, `.kiln/` should be committed to git (full auditability per kiln-core contracts). Do NOT add it to .gitignore."

Important: The spec above intentionally contains a contradiction; the final instruction is authoritative. In your added explanatory text below, make it unambiguous that `.kiln/` MUST NOT be added to `.gitignore` and the agent should not modify `.gitignore` for `.kiln/` ignoring.

After the verbatim content, add detailed “how to” instructions:
- How to locate templates robustly (search from `.claude/` if present; also search relative to the skill location; use a small glob/find strategy; if multiple matches, pick the closest/most plausible).
- Overwrite behavior rules:
  - If `.kiln/` exists and is returning, do not overwrite.
  - If `.kiln/` exists but incomplete, ask before overwriting (tie into Error Handling).
- Define the minimal required fields in `STATE.md` (even if template is missing) and give an explicit fallback skeleton the agent can write.
- Ensure all created files use UTF-8 and end with newline.

---

## Section 6: Operator Confirmation

Heading: `## Step 5: Confirm Configuration`

Include this exact content verbatim:

"Display the detected configuration to the operator and ask for confirmation:

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

If the operator wants changes: Let them specify corrections. Update config.json accordingly. Re-display and re-confirm."

Then add implementation guidance:
- How to ask for corrections (collect in one message; validate; apply minimal edits).
- Never change detection-derived projectType for returning projects unless operator insists.
- After edits, reprint the same block and re-ask confirmation.

---

## Section 7: Error Handling

Heading: `## Error Handling`

Include this exact content verbatim:

"- If `.kiln/` already exists and this is NOT a returning project (no STATE.md): warn the operator that `.kiln/` exists but appears incomplete. Ask if they want to reinitialize (will overwrite existing config).
- If template files cannot be found: create config.json and STATE.md with hardcoded defaults rather than failing.
- If any detection command hangs: use a 5-second timeout per command. Treat timeout as 'not detected'."

Then expand with concrete procedures:
- Provide the exact warning text you want the agent to print for incomplete `.kiln/`.
- Specify overwrite scope (which files/directories to overwrite; preserve any user docs if possible; otherwise ask).
- Corrupted `STATE.md` handling for “returning project” detection: if `.kiln/STATE.md` exists but cannot be parsed, treat as incomplete and ask to reinitialize; do not silently proceed.

---

# Line count requirement
The resulting `skills/kiln-init/kiln-init.md` should be approximately 250–400 lines; aim for ~350 by adding checklists, command examples (with timeouts), and explicit variable recording steps. Do not add fluff; make it operational.

# Implementation steps you should follow (as the coding agent)
1. Create `skills/kiln-init/kiln-init.md` with the specified content and expansions.
2. Run the required verification commands:
   - `test -f skills/kiln-init/kiln-init.md`
   - `wc -l skills/kiln-init/kiln-init.md`
3. Ensure no other files were modified.

Now implement.