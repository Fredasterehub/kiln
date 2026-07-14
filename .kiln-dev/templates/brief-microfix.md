# Micro-fix brief (r3) — {{batch_id}}

The r3 rung is LEGAL only when the joint-heads scope artifact names EXACTLY ONE surviving blocking
finding ID. More than one ID ⇒ confirm each separately or enter correction escalation (do NOT use
this template). This brief is dispatched as a FRESH implementer invocation (A11) — self-contained:
the finding, the required change, and the boundaries all ride in it.

## Surviving blocking finding (exactly one)
- Finding ID: {{finding_id}}
- From verdict: {{prior_verdict_path}} (round {{prior_round}})
- Sol's written required change (verbatim): {{required_change}}
- Scope ruling: {{scope_artifact_path}} (Sol's findings = the scope; Fable concurred on record)

## Objective
Apply the single change above and NOTHING else. Any edit outside the named finding voids the
delta-scoped re-review (surgical/delta-scoped re-reviews converge; blind full re-reviews do not).

## Output format
Fill the fix, then FREEZE. Your final message: the one-file diff summary + the receipt for any
mechanism touched. No new scope, no drive-by cleanups.

## Allowed tools / inputs
{{allowed_tools_and_inputs}}
<!-- ADOPT-9: the five-field contract holds for the micro-fix brief too — the mechanical handoff bounce
     (`kiln-codex-receipt.mjs check-handoff <file> --kind microfix`) requires this section present.
     The tools the worker may use and the input artifacts it may read; A11: the worker is a fresh
     workflow agent with no peers, so every input it needs is a file named here (the prior verdict,
     the scope ruling, the delta diff path). -->

## Boundaries
{{boundaries}}  <!-- narrower than the r1 brief: the single finding's file(s) only -->

## Effort tier · failure idiom
- Effort: medium  <!-- the r3 rung is medium by protocol -->
- Failure idiom: {{failure_idiom}}
