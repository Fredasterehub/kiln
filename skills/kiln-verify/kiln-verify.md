---
name: kiln-verify
description: "Adaptive verification protocol — tooling detection, deterministic verification, AI goal-backward verification, and stub detection"
---

# Kiln Verification Protocol

## Adaptive Verification

Kiln verification uses a 3-layer protocol that combines deterministic tooling with AI judgment.
The goal is reliable PASS/FAIL output with evidence, not narrative confidence.

Layer model:
1. Layer 1 detects available verification tooling from `.kiln/config.json`.
2. Layer 2 executes detected tools deterministically.
3. Layer 3 performs AI goal-backward verification for gaps tools cannot fully detect.

Core principles:
- Deterministic checks are TRUTH.
- AI judgment supplements deterministic output.
- AI judgment never overrides deterministic failures.
- Execution order is fixed: deterministic first, AI second.

Order discipline:
- If linter/type/test/build fails, that failure is authoritative.
- AI can add completeness concerns and stub findings.
- AI cannot convert deterministic FAIL into PASS.

## Layer 1: Tooling Detection

Tooling detection is config-driven.
This skill reads configuration and executes configured commands; it does not invent defaults.

Detection steps:
1. Read `.kiln/config.json`.
2. Read the `tooling` object.
3. Resolve command strings per tool category.

Tool categories:
- `testRunner`: jest, vitest, mocha, pytest, go test, cargo test
- `linter`: eslint, ruff, golangci-lint, clippy
- `typeChecker`: tsc --noEmit, mypy, pyright
- `buildSystem`: webpack, vite, esbuild, tsc, cargo build

Important behavior:
- Config fields contain the actual commands to run.
- Do not replace commands with guessed defaults.
- Do not silently add flags not specified by config.

Example:
```json
{
  "tooling": {
    "buildSystem": "npm run build",
    "typeChecker": "npm run typecheck",
    "linter": "npm run lint",
    "testRunner": "npm test"
  }
}
```

Missing tools:
- If any tooling field is `null`, skip that tool.
- Skipping a missing tool is not a failure.
- Report skipped tools explicitly in output.

Ownership boundary:
- Tool detection is established at init time by kiln-init.
- Verification only reads `.kiln/config.json` and executes what is present.
- If config is stale, report configuration mismatch; do not crash verification.

## Layer 2: Deterministic Verification

Deterministic verification is the authoritative gate.
Run each detected tool in fixed order and capture reproducible evidence.

Required run order:
1. Build
2. Type check
3. Lint
4. Test

Execution rules:
- Run only detected tools.
- Use exact command strings from config.
- Capture exit code, stdout, stderr.
- Parse summaries when possible.
- On failure, extract specific error locations (`file:line`) when possible.

Failure rules:
- Non-zero exit code means tool FAIL.
- Continue with remaining tools where practical to maximize evidence.
- Never reinterpret deterministic FAIL as PASS.

Parsing guidance:
- Build: compile/bundle failures, unresolved modules, artifact summary.
- Type check: error count, symbol/type mismatch locations.
- Lint: rule IDs, severity, file/line references.
- Test: suite totals, pass/fail/skip counts, failing test names.

Per-tool format:
```text
Tool: <name>
Command: <exact command>
Status: PASS|FAIL
Summary: <brief result>
Errors: [file:line: message, ...]
```

Deterministic authority statement:
- If build fails, build is FAIL.
- If type checker fails, type check is FAIL.
- If lint fails, lint is FAIL.
- If tests fail, tests are FAIL.
- AI assessment cannot override these statuses.

Evidence minimum:
- Include exact command run.
- Include first actionable error.
- Include at least one location reference when available.
- Include aggregate counts to support triage.

## Layer 3: AI Goal-Backward Verification

AI verification runs after deterministic execution.
It evaluates correctness dimensions tooling may miss: goal alignment, completeness, integration, and hidden stubs.

AI checks:
- Does code achieve the GOAL in acceptance criteria?
- Is implementation COMPLETE, not merely syntactically valid?
- Are stubs/placeholders masking incomplete behavior?
- Does implementation integrate correctly with surrounding system behavior?

Goal-backward method:
1. Start from each acceptance criterion.
2. Define required runtime behavior for that criterion.
3. Locate implementing code paths.
4. Trace backward through handlers/services/components/data boundaries.
5. Confirm each link performs real work.
6. Record evidence and gaps.

Evidence rules:
- Tie AI conclusions to concrete files and code paths.
- Distinguish confirmed failures from concerns.
- Mark critical completeness gaps explicitly.

Supplementary-only rule:
- AI catches issues deterministic tools miss.
- AI raises integration and completeness concerns.
- AI does not overrule deterministic results.

Suggested AI criterion entry:
```text
Criterion: AC-XX
Status: PASS|CONCERN|FAIL
Evidence: [file path references]
Gap: <missing behavior, if any>
```

## Stub Detection Checklist

Stub detection is mandatory.
Use this checklist to detect code that passes superficial checks but does not implement required behavior.

For each stub finding, report:
- `file:line`
- matched pattern
- severity: `HIGH` if it blocks a must-have acceptance criterion, otherwise `MEDIUM`

1. **Null/empty returns**
   - Pattern: components/functions always return `null`, `undefined`, `[]`, `{}`, or `""`.
   - Check: verify there is a real-data return path.
   - Evidence: point to branches proving real output exists or is missing.

2. **Hardcoded responses**
   - Pattern: API handlers return static JSON/constants only.
   - Check: verify handler calls real database/service/repository logic.
   - Evidence: trace response fields to runtime data source.

3. **No-op form handlers**
   - Pattern: `onSubmit` only calls `preventDefault()`.
   - Check: verify submission triggers validation and downstream action.
   - Evidence: trace form data to request/state mutation.

4. **Unhandled fetch responses**
   - Pattern: `fetch`/`axios` call made, response ignored.
   - Check: verify response status/body is parsed and used.
   - Evidence: show where response affects state/UI/output.

5. **Console.log-only functions**
   - Pattern: function behavior is logging only.
   - Check: verify meaningful side effect beyond logging.
   - Evidence: identify mutation, persistence, computation, or navigation.

6. **Placeholder text**
   - Pattern: UI renders `Lorem ipsum`, `TODO`, `Coming soon`, `Not implemented`.
   - Check: verify real content is rendered in production paths.
   - Evidence: identify final content source and render path.

7. **Commented-out implementations**
   - Pattern: real logic is commented out; active code is stubbed.
   - Check: verify active path performs full intended behavior.
   - Evidence: evaluate uncommented runtime path, not comment blocks.

8. **Pass-through functions**
   - Pattern: function returns input unchanged or constant output regardless of input.
   - Check: verify expected transformation/validation/business logic.
   - Evidence: compare expected behavior to observed implementation.

9. **Empty event handlers**
   - Pattern: `onClick`/`onChange`/`onSubmit` handlers are empty or log-only.
   - Check: verify state change or side effect occurs.
   - Evidence: point to resulting mutation, request, or navigation.

10. **Mock data in production code**
    - Pattern: test fixtures/seed data used as runtime source.
    - Check: verify production code uses real source of truth.
    - Evidence: show actual production data path.

False-positive control:
- Minimal code is not automatically stubbed.
- Require behavior-based evidence before filing.
- If uncertain, mark as concern with verification follow-up.

## Verification Result Format

Every verification run must produce standardized output with explicit status and evidence.

Required sections:
1. Summary
2. Deterministic Results
3. AI Verification
4. Stub Findings
5. Overall Determination

Summary must include:
- deterministic tool count with pass/fail totals
- AI criteria count with concern/fail totals
- stub counts by severity (`HIGH`, `MEDIUM`)
- overall result (`PASS` or `FAIL`)

Deterministic Results section:
- one entry per executed tool
- exact command
- PASS/FAIL status
- concise summary
- key errors with `file:line` when available

AI Verification section:
- one entry per acceptance criterion evaluated
- status (`PASS`, `CONCERN`, `FAIL`)
- evidence references
- noted completeness/integration gaps

Stub Findings section:
- one entry per stub finding
- include `file:line`
- include matched checklist item
- include severity and rationale

Overall determination rule:
- `PASS` requires all executed deterministic tools PASS.
- `PASS` requires zero HIGH severity stubs.
- `PASS` requires AI verification to find no critical gaps.
- Otherwise overall result is `FAIL`.

Canonical output template:
```text
Verification Summary
- Deterministic: <N> tools, <P> pass, <F> fail
- AI Criteria: <N> checked, <C> concerns, <F> fail
- Stubs: HIGH=<H>, MEDIUM=<M>
- Overall: PASS|FAIL

Deterministic Results
- Tool: <name>
  Command: <exact command>
  Status: PASS|FAIL
  Summary: <brief result>
  Errors: [file:line: message, ...]

AI Verification
- Criterion: AC-XX
  Status: PASS|CONCERN|FAIL
  Evidence: [file paths]
  Gap: <if any>

Stub Findings
- File:line: <path:line>
  Pattern: <checklist item>
  Severity: HIGH|MEDIUM
  Rationale: <why this is a stub>

Overall Determination
- Decision: PASS|FAIL
- Reason: <deterministic + AI + stub basis>
```
