---
name: kiln-roadmap
description: "Generates a lightweight phase roadmap from approved VISION.md"
user_invocable: true
---
# /kiln:roadmap — Roadmap Generation

## Overview

**Note:** This skill can run in two modes:
- **Teams-first mode**: spawned as a teammate by `/kiln:fire`, reports completion via SendMessage to team lead
- **Standalone mode**: invoked directly via `/kiln:roadmap`, prints next-step instructions to the operator

`/kiln:roadmap` reads the approved vision at `.kiln/VISION.md` and produces a sequenced delivery roadmap at `.kiln/ROADMAP.md`.

The roadmap converts the vision into incremental phases that can be executed one at a time through `/kiln:track`.

Phase count is dynamic. The model determines how many phases are needed based on scope, complexity, and dependency shape in the approved vision.

This artifact is intentionally lightweight. Each phase includes:
1. A phase title
2. A one- to two-sentence description of what is delivered

The roadmap is a sequencing tool, not a planning artifact. It defines WHAT each phase delivers, not HOW work is implemented.

Before roadmap lock-in, the operator reviews the proposed phases and may reorder them, add phases, remove phases, or edit descriptions.

Final output location: `.kiln/ROADMAP.md`.

## Prerequisites

Before generating a roadmap, validate these prerequisites in order:

1. `.kiln/` directory must exist.
   - If missing: stop immediately.
   - Remediation: instruct the operator to run `/kiln:init` first.
   - Halt rule: do not evaluate later prerequisites or generate a roadmap.
2. `.kiln/config.json` must exist.
   - If missing: stop immediately.
   - Remediation: instruct the operator to run `/kiln:init` to initialize kiln.
   - Halt rule: do not generate `.kiln/ROADMAP.md`.
3. `.kiln/VISION.md` must exist.
   - If missing: stop immediately.
   - Remediation: instruct the operator to run `/kiln:brainstorm` first.
   - Halt rule: do not generate a provisional roadmap.
4. Brainstorm stage in `.kiln/STATE.md` should be marked `complete`.
   - If state clearly indicates brainstorm is unapproved/incomplete: treat as a confirmation gate, not an automatic pass.
   - Confirmation gate text: `Brainstorm in .kiln/STATE.md is not marked complete. Return to /kiln:brainstorm for approval before continuing? (recommended)`
   - Continue only with explicit operator confirmation to proceed despite the risk.

Prerequisite rule:
- Never generate `.kiln/ROADMAP.md` from an absent or clearly unapproved vision unless the operator explicitly accepts that risk.

## Phase Generation

Generate phases using the approved vision as the single source of truth.

### Input Analysis

1. Read `.kiln/VISION.md` completely before drafting any phase.
2. Extract must-have capabilities and success criteria.
3. Extract delivery constraints and explicit non-goals.
4. Identify cross-cutting requirements that influence sequencing.

During extraction, prioritize:
- Must-have features that define the core value proposition
- Verifiable outcomes tied to success criteria
- Constraints that affect implementation order

### Sequencing Rules

Organize features into incremental phases following this order:

1. Foundation and infrastructure first:
   - Data models
   - Authentication and authorization
   - Core utilities
   - Baseline platform setup needed by later phases

2. Core features next:
   - Primary user value paths
   - Main product workflows
   - Minimum viable outcomes from the vision

3. Secondary features after core works:
   - Supporting flows
   - Optional capabilities
   - Expansion features that depend on validated core behavior

4. Polish and optimization last:
   - Performance tuning
   - UX refinements
   - Operational hardening and quality improvements

### Phase Quality Rules

Every proposed phase must satisfy all of the following:

1. Independently verifiable:
   - The phase output can be validated through end-to-end behavior.
2. Incremental:
   - The phase builds on previous completed phases.
3. Executable:
   - The phase is small enough to run through one `/kiln:track` loop cycle.
4. Cohesive:
   - Features in the phase are related and test well together.

Do not produce phases that are:
- Too broad to verify as one unit
- Purely technical with no user-observable outcome unless they are required foundation work
- Duplicative with content already covered in earlier phases

## Roadmap Format

Write `.kiln/ROADMAP.md` using this structure:

```markdown
# ROADMAP

## Phase 1: <Title>
<1-2 sentence description of what this phase delivers>

## Phase 2: <Title>
<1-2 sentence description>

...

## Phase N: <Title>
<1-2 sentence description>
```

Formatting rules:

1. Titles are descriptive but short (3-6 words).
2. Descriptions focus on WHAT is delivered, not HOW it is built.
3. No task lists.
4. No file hints.
5. No implementation details.
6. No time estimates.
7. Phase numbering is sequential: `Phase 1`, `Phase 2`, ..., `Phase N`.

Quality rules:

1. Phase titles should be specific enough to communicate scope quickly.
2. Descriptions should be concrete enough for operator review decisions.
3. Keep each phase description to one or two sentences only.
4. Avoid roadmap entries that imply hidden sub-phases or internal task breakdowns.

## Operator Review

After generating the draft roadmap, present it to the operator before lock-in.

Use this review prompt:

`Here is the proposed roadmap with N phases. You can: reorder phases, add new phases, remove phases, adjust descriptions, or approve as-is.`

Review workflow:

1. Present all phases in order.
2. Ask for explicit approval or requested edits.
3. If edits are requested, apply them to the roadmap draft.
4. Re-present updated roadmap if edits materially change sequencing.
5. Repeat until operator approves.

On operator modifications:
- Update phase order, titles, and descriptions exactly as instructed.
- Preserve sequential numbering after any insertions, deletions, or reorder operations.
- Re-check that each phase still remains independently verifiable and incremental.

On approval:
- Write final roadmap to `.kiln/ROADMAP.md`.
- Update `.kiln/STATE.md` to mark roadmap stage as `complete`.
- Set the first roadmap phase status to `pending`.
- Treat `.kiln/ROADMAP.md` as the phase list consumed by `/kiln:track`.

Gate rule:
- Do not consider roadmap generation complete until the operator has approved the roadmap content.

## Phase Count Guidance

Phase count is dynamic and model-selected from actual vision scope.

Use these heuristics as guidance:

1. Small project (2-4 success criteria): 2-3 phases
2. Medium project (5-8 success criteria): 3-5 phases
3. Large project (9+ success criteria): 5-8 phases

These are guidelines, not fixed rules.

Selection principle:
- Too few phases means each phase is too large to verify cleanly.
- Too many phases adds coordination overhead and transition cost.

Target sweet spot:
- Each phase delivers 1-3 related features that can be end-to-end tested together.

Calibration checks before finalizing phase count:

1. Can each phase produce a clear user-observable milestone?
2. Can each phase be fully exercised by E2E verification?
3. Does the sequence minimize blocking dependencies?
4. Does the roadmap avoid unnecessary micro-phases?

If calibration fails:
- Merge overly fragmented phases.
- Split oversized phases.
- Reorder phases to restore dependency logic.

## Output

On approval, complete these outputs:

1. Write approved roadmap to `.kiln/ROADMAP.md`.
2. Update `.kiln/STATE.md`:
   - Set roadmap stage to `complete`.
   - Set first phase status to `pending`.
3. Complete in the appropriate mode:

### Teams-First Mode (Running as Teammate)

If spawned by `/kiln:fire` as a teammate in a Claude Code Team:
- Send completion message to team lead using SendMessage:
  ```
  SendMessage to team lead:
  - type: "message"
  - recipient: "team-lead"
  - content: { stage: "roadmap", status: "completed", evidence_paths: [".kiln/ROADMAP.md"] }
  - summary: "Roadmap complete, N phases approved"
  ```
- Do NOT print "Run /kiln:track" — the team lead orchestrator handles stage advancement

### Standalone Mode (Direct Invocation)

If invoked directly via `/kiln:roadmap`:
- Print this completion message:
  - `Roadmap approved with N phases. Run /kiln:track to begin phase execution.`

Output constraints:

1. `.kiln/ROADMAP.md` is the canonical phase list for `/kiln:track`.
2. The roadmap remains lightweight and sequencing-focused.
3. Detailed task decomposition belongs to phase planning, not roadmap generation.
