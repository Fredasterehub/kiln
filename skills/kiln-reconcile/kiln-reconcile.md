---
name: kiln-reconcile
description: "Living documentation update protocol — keeps TECH_STACK, PATTERNS, DECISIONS, PITFALLS current after each phase"
---

# Kiln Reconciliation Protocol

## Purpose
Reconciliation keeps kiln's living documentation aligned with reality.
It runs after a phase passes review and before the next phase begins.

Living docs are institutional memory, not static docs.
They capture what the project actually uses and why.
They are actively read by planners, implementers, and reviewers.

Planner use:
- Read current stack, patterns, and decisions before producing plans.
- Avoid proposing work that conflicts with known constraints.
- Reuse proven conventions instead of creating drift.

Implementer use:
- Follow established patterns and naming conventions during coding.
- Respect decisions already made unless superseded explicitly.
- Avoid known pitfalls that caused failures in prior phases.

Reviewer use:
- Verify implementation aligns with documented conventions and decisions.
- Detect regressions against accepted architecture and tooling direction.
- Enforce consistency across phases, not just within one diff.

Reconcile protects pipeline integrity by making these docs trustworthy.
If docs are stale, later stages degrade in quality.

Reconcile is also a deliberate pause point.
The operator must confirm proposed doc updates before they are applied.
Do not auto-apply living doc changes without explicit approval.

## Prerequisites

Before running reconciliation, verify kiln state:
1. Check if `.kiln/` directory exists. If not: print 'Kiln is not initialized. Run /kiln:init first.' and stop.
2. Check if `.kiln/STATE.md` exists. If not: print 'Kiln state file missing. Run /kiln:init to reinitialize.' and stop.
3. Check if `.kiln/config.json` exists and is readable. If not: print 'Kiln configuration missing. Run /kiln:init to reinitialize.' and stop.

Run these checks from the project root. Treat missing required files as blocking. Never crash on missing prerequisites.

## Reconcile Steps
Run these steps in order for the completed phase.

1. **Gather changes**
   - Read the phase diff and summarize what was introduced or replaced.
   - Identify:
     - New files and deleted files.
     - New dependencies and removed dependencies.
     - New architecture or coding patterns.
     - Significant decisions made to satisfy requirements.
     - Pitfalls discovered during implementation, E2E, or review.
   - Use:
     - `git diff --name-status <phase-start-ref>...HEAD`
     - `git diff <phase-start-ref>...HEAD`
     - `.kiln/tracks/phase-N/review.md`
     - `.kiln/tracks/phase-N/e2e-results.md`

2. **Update TECH_STACK.md** (`.kiln/docs/TECH_STACK.md`)
   - Add newly introduced languages, frameworks, and dependencies with versions.
   - Remove dependencies that were replaced or removed from the codebase.
   - Update version numbers if they changed in lockfiles/manifests.
   - Keep sections structured and current:
     - Languages
     - Frameworks
     - Dependencies
     - Build Tools
     - Runtime Targets
     - Development Tools
   - Validate updates against actual project manifests and tool configs.
   - Prefer precise version notation over vague ranges when known.

3. **Update PATTERNS.md** (`.kiln/docs/PATTERNS.md`)
   - Add architecture patterns proven in this phase.
   - Add naming conventions that emerged and are now standard.
   - Add file structure conventions that should be reused.
   - Update existing entries when patterns evolved.
   - Include per pattern:
     - Pattern name
     - When to use
     - Example reference (file path)
   - Remove duplicate patterns that describe the same behavior.
   - Convert one-off tactics into patterns only if they are reusable.

4. **Update DECISIONS.md** (`.kiln/docs/DECISIONS.md`)
   - Add ADR-style entries for significant decisions from this phase.
   - Include only decisions that affect future phases.
   - Ignore trivial implementation choices with no forward impact.
   - Required fields per entry:
     - Title
     - Date
     - Status
     - Context
     - Decision
     - Consequences
   - If a new decision supersedes an old one:
     - Mark prior decision as `superseded`.
     - Link to the replacing decision title/date.

5. **Update PITFALLS.md** (`.kiln/docs/PITFALLS.md`)
   - Add implementation gotchas discovered during the phase.
   - Add anti-patterns that were identified and corrected.
   - Add environment-specific issues that affected delivery.
   - Record each entry with:
     - Title
     - Symptom
     - Cause
     - Fix
     - Severity
     - Discovered phase
   - Keep fixes concrete and reproducible.
   - Remove outdated pitfalls that no longer apply to current stack/patterns.

6. **Check roadmap** (`.kiln/ROADMAP.md`)
   - Read remaining phases after the completed phase.
   - Ask: does the roadmap still make sense with what was learned?
   - Evaluate:
     - Scope still valid?
     - Ordering still optimal?
     - Missing split needed for an oversized phase?
     - Any phase now redundant and removable?
   - If concerns exist, record them for operator review.
   - Do not silently rewrite roadmap ordering without operator confirmation.

7. **Update STATE.md** (`.kiln/STATE.md`)
   - Mark current phase status as `complete`.
   - Advance `currentPhase` to the next roadmap phase.
   - Set next phase step/state to its initial active status.
   - Preserve retry/correction counters for historical traceability.
   - Record timestamp for phase completion transition.
   - Ensure state changes are atomic and consistent with roadmap order.

8. **Write reconcile log**
   - Write `.kiln/tracks/phase-N/reconcile.md`.
   - Summarize:
     - Phase changes analyzed.
     - Living docs updated.
     - Budget outcomes.
     - Roadmap assessment.
     - Unresolved documentation debt.
   - Treat reconcile log as phase-level audit evidence.

## Budget Enforcement
Each living doc has a target budget of approximately 3000 words.
Treat 3000 as soft budget and 3500 as hard ceiling.

Budget policy:
- Soft limit: `~3000` words per living doc.
- Hard limit: `3500` words per living doc.
- Enforce budget on every reconcile pass.

Required word-count checks:
- `wc -w .kiln/docs/TECH_STACK.md`
- `wc -w .kiln/docs/PATTERNS.md`
- `wc -w .kiln/docs/DECISIONS.md`
- `wc -w .kiln/docs/PITFALLS.md`

If any doc exceeds soft budget:
- Prioritize relevance and recency.
- Remove the oldest or least relevant entries first.
- Merge overlapping entries to reduce duplication.
- Rewrite long narrative text into concise structured bullets.

If any doc exceeds hard limit:
- Do not proceed without pruning.
- Remove outdated content immediately.
- Re-run word-count checks until under 3500.

Replacement-first strategy:
- Replace outdated entries; do not only append.
- When dependency changes:
  - Remove old dependency record.
  - Add the replacement dependency with current version.
- When pattern evolves:
  - Update existing pattern entry in place.
  - Avoid near-duplicate "v2" pattern entries.
- When decision is superseded:
  - Mark old decision `superseded`.
  - Add new accepted decision entry with rationale.

Budget reporting requirement:
- Capture before/after word counts for each living doc.
- Include counts in reconcile operator summary.
- Include counts in `.kiln/tracks/phase-N/reconcile.md`.

## Operator Confirmation
Reconcile is a gated operation.
Do not apply living doc, roadmap, or state updates without explicit operator approval.

Prepare a proposal summary before applying edits.
The summary must include:
- Files to be modified and what changes in each file.
- Any roadmap concerns identified by sanity check.
- Word counts before and after for all living docs.
- Any entries removed or marked superseded.

Confirmation protocol:
1. Present proposed updates clearly and concisely.
2. Ask for explicit confirmation to proceed.
3. Wait for unambiguous approval.
4. On approval:
   - Apply doc updates.
   - Update `.kiln/STATE.md`.
   - Write `.kiln/tracks/phase-N/reconcile.md`.
5. On rejection:
   - Ask what to change.
   - Revise proposal.
   - Re-present summary for confirmation.

## Reconcile Log
Write reconcile output to `.kiln/tracks/phase-N/reconcile.md`.
This file is the phase reconciliation record.

Required reconcile log sections:
1. **Phase and Date**
   - Phase number
   - Calendar date
   - Timestamp (UTC)
2. **Phase Change Summary**
   - Key files changed in the phase
   - Dependency additions/removals
   - Patterns introduced or revised
3. **Living Doc Updates**
   - TECH_STACK updates
   - PATTERNS updates
   - DECISIONS updates
   - PITFALLS updates
   - For each: added, changed, removed
4. **Budget Status**
   - Word counts per doc before reconcile
   - Word counts per doc after reconcile
   - Any pruning actions performed
5. **Roadmap Assessment**
   - `still valid` or `concerns raised`
   - If concerns: specific reorder/split/remove recommendations
6. **Unresolved Doc Debt**
   - Missing updates deferred
   - Why deferred
   - Follow-up phase recommendation

Reference template:

```markdown
# Reconcile Log — Phase N

- Date: YYYY-MM-DD
- Timestamp (UTC): YYYY-MM-DDTHH:MM:SSZ

## Phase Change Summary
- Files: ...
- Dependencies: ...
- Patterns: ...

## Living Doc Updates
- TECH_STACK.md: added ..., changed ..., removed ...
- PATTERNS.md: added ..., changed ..., removed ...
- DECISIONS.md: added ..., changed ..., removed ...
- PITFALLS.md: added ..., changed ..., removed ...

## Budget Status
- TECH_STACK.md: before X, after Y
- PATTERNS.md: before X, after Y
- DECISIONS.md: before X, after Y
- PITFALLS.md: before X, after Y

## Roadmap Assessment
- Status: still valid | concerns raised
- Notes: ...

## Unresolved Doc Debt
- ...
```

## Living Doc Schemas
Use these required schemas when updating living docs.
Keep entries consistent so downstream agents can parse and trust them.

### TECH_STACK.md
Required top-level sections:
- Languages (with versions)
- Frameworks
- Dependencies (with versions)
- Build Tools
- Runtime Targets
- Development Tools

Entry rules:
- Include version numbers whenever available.
- Remove entries for tools no longer in use.
- Keep section ordering stable across updates.
- Prefer concise bullet entries over prose paragraphs.

### PATTERNS.md
Required top-level sections:
- Architecture Patterns
- Naming Conventions
- File Structure
- Testing Patterns
- Error Handling Patterns
- API Patterns

Pattern entry schema:
- Pattern Name
- When to Use
- Example Reference (file path)

Entry rules:
- Include concrete file references from the current codebase.
- Avoid abstract patterns without usage examples.
- Update existing entries when behavior changes.

### DECISIONS.md
Use ADR-style entries.
Required fields per entry:
- Title
- Date
- Status (`accepted`, `superseded`, `deprecated`)
- Context
- Decision
- Consequences

Entry rules:
- Record only decisions with future-phase impact.
- Mark superseded decisions explicitly.
- Keep chronological ordering clear.

### PITFALLS.md
Required fields per entry:
- Title
- Symptom
- Cause
- Fix
- Severity (`high`, `medium`, `low`)
- Discovered (phase number)

Entry rules:
- Capture practical, reproducible fixes.
- Keep symptom descriptions observable and specific.
- Remove pitfalls tied to retired architecture/components.
