# QA Verdict: T02 Core Foundation

## Deterministic Gate

- config.json.tmpl valid JSON: **PASS** — `JSON.parse()` succeeds, all required keys present
- Template files exist: **PASS** — `config.json.tmpl`, `STATE.md.tmpl`, `vision-sections.md` all present
- kiln-core skill exists: **PASS** — `skills/kiln-core/kiln-core.md` (303 lines, within 200-400 target)

## Criteria Checks

### AC-01 (LLM): kiln-core defines all agent coordination contracts — **PASS**

Verified sections present in `skills/kiln-core/kiln-core.md`:

| Required Section | Lines | Status |
|---|---|---|
| `.kiln/` directory structure | 6-54 | Present — full tree with path-by-path purpose for all 16 paths |
| Output format contracts | 98-131 | Present — Read/Write Matrix (7 agent roles), Atomic Git Commit definition (6 rules), Acceptable `tests/e2e/` artifacts (7 items) |
| Sentinel schema format | 132-183 | Present — 4 sentinel types with required/recommended keys per type (`plan-validation-result`, `e2e-result`, `review-verdict`, `task-status`) |
| Error escalation protocol | 224-267 | Present — retry limits (2 mini-verify, 3 E2E, 3 review), required evidence set (7 artifacts), placement convention, actionable halt summary template, escalation discipline rules |

### AC-02 (DET): config.json.tmpl is valid JSON with required fields — **PASS**

```
JSON.parse() succeeds
Top-level keys: projectType, modelMode, tooling, preferences
tooling (5 keys): testRunner, linter, typeChecker, buildSystem, startCommand
preferences (3 keys): maxRetries, waveParallelism, e2eTimeout
```

### AC-03 (DET): All template files exist with required placeholder sections — **PASS**

| Template | Status | Placeholder Sections |
|---|---|---|
| `templates/config.json.tmpl` | Present | All fields use null/default values as identifiable placeholders |
| `templates/STATE.md.tmpl` | Present | 5 sections: header ({{project_name}}, {{model_mode}}, {{init_timestamp}}), Phase Progress table, Current Track ({{current_phase}}, {{current_step}}, {{step_status}}), Correction Cycles (mini-verify/E2E/review with limits), Session Recovery ({{last_activity}}, {{next_expected_action}}) |
| `templates/vision-sections.md` | Present | 7 structured sections matching design spec: Problem Statement, Solution Overview, User Personas, Success Criteria, Constraints and Non-Goals, Key Decisions, Open Questions — each with guidelines in HTML comments |

### AC-04 (LLM): kiln-core covers model routing, fallback rules, context budget — **PASS**

| Sub-criterion | Lines | Status |
|---|---|---|
| Model routing table (13 roles) | 56-73 | Present — all 13 roles listed: Orchestrator, Brainstormer, Vision Challenger, Vision Synthesizer, Planner A, Planner B, Plan Synthesizer, Plan Validator, Sharpener, Implementer, E2E Verifier, Reviewer, Researcher. Both Multi-Model and Claude-Only columns present. |
| Claude-only fallback rules | 74-96 | Present — 4 fallback rules + "shape stays the same" explanation with 5 concrete examples |
| Context budget guidelines | 185-228 | Present — ~15% orchestrator budget, fresh 200k-token per task, self-contained packet checklist (6 items), cross-task leakage Do/Don't examples, budget enforcement signals |

## Additional Checks

### Cross-references: kiln-core mentions all 11 agents and their roles — **PASS**

The model routing table (13 roles) maps to all 11 NPM package agents:

| NPM Agent | Routing Role(s) |
|---|---|
| kiln-orchestrator | Orchestrator |
| kiln-brainstormer | Brainstormer |
| kiln-planner | Planner A |
| kiln-codex-planner | Planner B, Vision Challenger, Sharpener (GPT-5.2 roles) |
| kiln-synthesizer | Vision Synthesizer, Plan Synthesizer |
| kiln-validator | Plan Validator |
| kiln-sharpener | Sharpener |
| kiln-executor | Implementer |
| kiln-e2e-verifier | E2E Verifier |
| kiln-reviewer | Reviewer |
| kiln-researcher | Researcher |

### Stage transitions — **PASS**

Lines 268-303: canonical pipeline order documented with 10 transition invariants table (required inputs/outputs), gate discipline rules, and stage completion signals.

### Constraint compliance — **PASS**

- Line count: 303 lines (within 200-400 target)
- No external file references to non-existent files
- Self-contained content with all referenced concepts defined inline
- Uses only relative paths within `.kiln/` structure

## Decision: PASS

All 4 acceptance criteria verified. kiln-core skill is comprehensive and well-structured. Templates are valid and contain appropriate placeholder sections. No issues found.

## Evidence

### JSON validation output
```
$ node -e "JSON.parse(fs.readFileSync('templates/config.json.tmpl'))"
Valid JSON
Keys: [ 'projectType', 'modelMode', 'tooling', 'preferences' ]
tooling keys: [ 'testRunner', 'linter', 'typeChecker', 'buildSystem', 'startCommand' ]
preferences keys: [ 'maxRetries', 'waveParallelism', 'e2eTimeout' ]
tooling key count: 5
preferences key count: 3
```

### kiln-core line count
```
303 skills/kiln-core/kiln-core.md
```

### Template files present
```
templates/config.json.tmpl
templates/STATE.md.tmpl
templates/vision-sections.md
```

### vision-sections.md — 7 sections confirmed
1. Problem Statement (line 7)
2. Solution Overview (line 20)
3. User Personas (line 33)
4. Success Criteria (line 46)
5. Constraints and Non-Goals (line 60)
6. Key Decisions (line 74)
7. Open Questions (line 87)
