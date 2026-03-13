# W5: Diagnose — Root Cause Analysis

Systematic diagnosis of pipeline issues. Follows: symptom → evidence → causal chain → root cause → proposed fix.

## Prerequisites

Read these for context:
- `${CLAUDE_PLUGIN_ROOT}/skills/kiln-forge/references/plugin-architecture.md` — dependency graph
- `${CLAUDE_PLUGIN_ROOT}/skills/kiln-forge/data/run-history.json` — past run data
- `${CLAUDE_PLUGIN_ROOT}/skills/kiln-forge/data/evolution-log.json` — past changes

## Workflow

### Step 1: Identify Symptom

Clarify with the user:
- **What happened** — observable behavior (e.g., "codex prompt had 0/6 skeleton sections")
- **When** — which smoke test, which run, which step
- **Expected** — what should have happened instead
- **Severity** — pipeline-breaking, quality degradation, cosmetic

### Step 2: Gather Evidence

Collect relevant data from multiple sources:

1. **Run history** — find the run(s) where the symptom appeared. Look for patterns:
   - Does it happen every run or intermittently?
   - Does it correlate with specific scenarios?
   - Did it start after a specific change?

2. **Evolution log** — find recent changes to the affected component:
   - Was the component recently modified?
   - Was a "fix" applied that might have introduced the issue?
   - Are there repeated fixes to the same component (whack-a-mole)?

3. **TWEAKS.md** — check `/DEV/kilntop/TWEAKS.md` for related findings:
   - Is this a known issue?
   - Is it already tracked with a task number?
   - Are there related findings in the same area?

4. **Source files** — read the actual agent/hook/blueprint files involved:
   - Does the instruction say the right thing?
   - Is the instruction positioned where the model will actually follow it?
   - Are there conflicting instructions?

### Step 3: Trace Causal Chain

Work backwards from symptom to root cause:

```
SYMPTOM: codex prompt missing skeleton sections
  ↑ WHY: codex.md says "follow this skeleton" but doesn't enforce it
  ↑ WHY: instruction-based approach — model follows it when context is fresh,
         ignores it when deep in implementation
  ↑ ROOT CAUSE: instruction-based enforcement doesn't survive context pressure.
         Structural enforcement (template file, section markers) is needed.
```

Common root cause categories:
- **Instruction placement** — right instruction, wrong position (buried after conflicting content)
- **Instruction vs structure** — instruction tells the model what to do, but structure makes it unavoidable
- **Context pressure** — models follow instructions less reliably as context grows
- **Cross-reference gap** — change in file A broke assumption in file B
- **Hook gap** — behavior not enforced by hooks, relies solely on agent compliance
- **Data staleness** — JSON/template data out of sync with agent logic

### Step 4: Propose Root Cause Fix

Present to the user:
1. **Root cause** — one sentence
2. **Category** — from the list above
3. **Proposed fix** — specific changes with rationale
4. **Confidence** — high/medium/low based on evidence quality
5. **Verification plan** — how to confirm the fix works (which scenario to run)

### Step 5: Hand Off to Refine

If the user approves the diagnosis, transition to `w1-refine.md` workflow with the proposed fix as input. The refine workflow handles implementation, validation, and tracking.

## Diagnosis Anti-Patterns

- **Surface fix** — changing the wording of an instruction that was already clear. If the model ignored it, rewording won't help. Change the mechanism.
- **Symptom chasing** — fixing the symptom without understanding why. The symptom will recur in a different form.
- **Blame the model** — "the model just doesn't follow instructions." Models have predictable failure modes — the fix is structural.
- **Fix cascade** — fixing A breaks B, fixing B breaks C. Step back, understand the dependency, fix at the root.
