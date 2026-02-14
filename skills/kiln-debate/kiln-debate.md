---
name: kiln-debate
description: "Universal debate protocol — structured critique-revise rounds between competing model perspectives"
---
# /kiln:debate — Debate Protocol

## Overview
The debate protocol is an alternative to direct synthesis. Instead of merging two independent outputs immediately, models first critique each other's work, revise their own, and iterate for a bounded number of rounds before synthesis.

This skill defines the universal debate structure used by both the PLAN stage (competing plans) and the REVIEW stage (competing reviews). Stage-specific agents reference this protocol for round mechanics, artifact naming, and convergence rules.

## When Debate Activates

Debate mode is toggled per-stage in `.kiln/config.json` preferences:

```json
{
  "preferences": {
    "planStrategy": "debate",
    "reviewStrategy": "debate",
    "debateRounds": 2
  }
}
```

- `planStrategy: "debate"` activates debate in the PLAN stage (default: `"synthesize"`).
- `reviewStrategy: "debate"` activates debate in the REVIEW stage (default: `"single"`).
- `debateRounds` controls the maximum number of critique-revise rounds (valid range: 1-3, default: 2).

If the config key is missing or set to the default value, the stage runs its original non-debate flow.

## Debate Round Structure

Each debate round follows a strict two-phase cycle:

### Phase 1: Critique
Each participant reads the competing output and writes a structured critique.

Critique structure:
```markdown
## Critique of <source> (Round <R>)

### Strengths
- <what the competing output does well, with specific references>

### Weaknesses
- <specific problems with file:line or section references>
- <missing coverage, incorrect assumptions, or risky choices>

### Disagreements
- <point of contention>: <why this participant's approach is better, with evidence>

### Concessions
- <points where the competing output is genuinely superior>
```

### Phase 2: Revise
Each participant reads the critique of their own output and produces a revision.

Revision rules:
- Address every weakness that is valid. If a weakness is invalid, explain why in a `### Defense` section at the top of the revision.
- Incorporate conceded points from the competing critique into the revision.
- Do not concede points without reason. If a critique challenges a deliberate choice, defend it with evidence.
- Preserve the original output format exactly (same sections, same schema).

Revision header:
```markdown
<!-- Revision v<R+1>: Addressed critique points [list]. Defended: [list]. -->
```

## Adversarial Prompting Rules

Debate quality depends on genuine intellectual tension, not polite agreement.

Rules for critique authors:
1. **Challenge assumptions.** If the competing output assumes a pattern or library choice without justification, call it out.
2. **Demand evidence.** Generic claims like "this is simpler" must cite specific complexity metrics or concrete code paths.
3. **Find gaps.** Identify missing error handling, unaddressed edge cases, security oversights, or incomplete acceptance criteria.
4. **Be specific.** Reference exact sections, file paths, task IDs, or acceptance criteria. Vague critiques are worthless.
5. **Acknowledge strength.** Do not manufacture weaknesses. If an approach is genuinely good, say so and focus critique elsewhere.

Rules for revision authors:
1. **Defend deliberately.** Do not cave to every critique. If your choice was intentional and well-reasoned, explain why.
2. **Concede honestly.** If the critique found a real gap, fix it. Do not patch over problems with hand-waving.
3. **Show your work.** When revising, explain what changed and why in the revision header comment.
4. **Preserve format.** Revisions must be drop-in replacements for the prior version, same structure and schema.

## Convergence Detection

Debate rounds can terminate early if convergence is detected before the round budget is exhausted.

Convergence criteria (any one triggers early termination):
1. **No new weaknesses.** Both critiques in a round contain zero items in the Weaknesses section.
2. **Only cosmetic disagreements.** All disagreements are LOW severity (style, naming, ordering) with no correctness, security, or completeness impact.
3. **Mutual concession.** Both participants concede the same set of points, indicating agreement.

When convergence is detected:
- The orchestrator skips remaining rounds.
- The most recent revisions become the final debate inputs to synthesis.
- The debate log records the convergence trigger.

## Artifact Naming Convention

All debate artifacts live in `.kiln/tracks/phase-N/` alongside existing plan/review artifacts.

### Plan Debate Artifacts
```
plan_claude.md              # Round 0: initial plan (existing)
plan_codex.md               # Round 0: initial plan (existing)
critique_of_codex_r1.md     # Round 1: Claude critiques Codex plan
critique_of_claude_r1.md    # Round 1: Codex critiques Claude plan
plan_claude_v2.md           # Round 1: Claude revises based on critique
plan_codex_v2.md            # Round 1: Codex revises based on critique
critique_of_codex_r2.md     # Round 2: Claude critiques Codex v2
critique_of_claude_r2.md    # Round 2: Codex critiques Claude v2
plan_claude_v3.md           # Round 2: Claude revises again
plan_codex_v3.md            # Round 2: Codex revises again
debate_log.md               # Full audit trail
PLAN.md                     # Final synthesized plan (existing)
```

### Review Debate Artifacts
```
review.md                   # Round 0: Opus reviewer output (existing)
review_codex.md             # Round 0: GPT reviewer output
critique_of_review_codex_r1.md  # Round 1: Opus critiques GPT review
critique_of_review_opus_r1.md   # Round 1: GPT critiques Opus review
review_v2.md                # Round 1: Opus revises review
review_codex_v2.md          # Round 1: GPT revises review
debate_log.md               # Full audit trail (shared with plan debate if both run)
```

General naming pattern:
- Initial outputs: `<artifact>_<source>.md`
- Critiques: `critique_of_<target>_r<round>.md`
- Revisions: `<artifact>_<source>_v<round+1>.md`
- Round numbering starts at 1 (round 0 is the initial output).

## Debate Log Format

The debate log is the audit trail for the entire debate process. It is written to `.kiln/tracks/phase-N/debate_log.md`.

```markdown
# Debate Log — Phase <N>

## Configuration
- Plan strategy: <synthesize|debate>
- Review strategy: <single|debate>
- Max rounds: <debateRounds>

## Plan Debate
### Round 1
- Claude critique of Codex: <path> (<word count>, <weakness count>)
- Codex critique of Claude: <path> (<word count>, <weakness count>)
- Claude revision: <path> (changes: <summary>)
- Codex revision: <path> (changes: <summary>)
- Convergence check: <not converged|converged — reason>

### Round 2
...

### Outcome
- Rounds completed: <N> of <max>
- Early termination: <yes — reason | no>
- Final Claude version: <path>
- Final Codex version: <path>

## Review Debate
### Round 1
...

### Outcome
...
```

## Round Budget Enforcement

The `debateRounds` config value is a hard ceiling:
- Valid range: 1-3. Values outside this range are clamped (minimum 1, maximum 3).
- Default: 2 if not specified.
- Each round consists of one critique phase and one revise phase for both participants.
- The orchestrator tracks round count and stops spawning critique/revise agents when the budget is reached or convergence is detected.

Budget accounting:
- Round 1 = first critique + first revision.
- Round 2 = second critique + second revision.
- Round 3 = third critique + third revision (maximum).
- Convergence checks happen after each complete round.

## Integration with Synthesis

After debate rounds complete, synthesis proceeds with enriched context:

### Plan Synthesis (debate mode)
The synthesizer reads:
1. Final revised plans (e.g., `plan_claude_v3.md` and `plan_codex_v3.md`)
2. All critique artifacts (to understand what was contested)
3. The debate log (to understand convergence and remaining disagreements)

The synthesis notes section must document:
- Which debate points were adopted in the final plan
- Which debate points were overruled and why
- Any unresolved disagreements and the tiebreak rationale

### Review Synthesis (debate mode)
After review debate, the final verdict incorporates:
1. Both reviewers' final assessments
2. Points of agreement (strong signal for real issues)
3. Points of disagreement (requires tiebreak reasoning)
4. A unified finding list with consolidated severities

## Error Handling

- If one participant fails to produce a critique or revision, the debate degrades gracefully: the other participant's latest version proceeds to synthesis as-is, with a note in the debate log.
- If both participants fail in the same round, the debate terminates and synthesis uses the most recent successful versions.
- Codex CLI failures follow the same retry-once protocol defined in `kiln-codex-planner.md`.
- Debate artifacts are never deleted, even on failure. They are audit evidence.
