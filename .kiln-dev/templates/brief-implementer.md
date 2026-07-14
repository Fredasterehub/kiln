# Implementer brief — {{batch_id}}

The five-field brief contract (Anthropic multi-agent delegation rules). Every field is REQUIRED; a
handoff missing any required section is bounced mechanically by `format-error.md` before any model
reads it. Fill every `{{blank}}`; delete nothing.

## Objective
{{objective}}

<!-- What to build, in one or two sentences. Name the ratified spec / brief it binds to and the
     surviving blocking finding IDs if this is a fix round. -->

## Output format
{{output_format}}

<!-- The exact shape of the deliverable and of the FINAL MESSAGE report (per-file list, receipts for
     every NEW mechanism relied on, test tally, AMBIGUITY items). The worker's final message IS its
     report — no separate report file. -->

## Allowed tools / inputs
{{allowed_tools_and_inputs}}

<!-- The tools the worker may use and the input artifacts it may read. A11: the worker is a fresh
     workflow agent — it has no peers; every input it needs is a file named here. -->

## Boundaries (what NOT to touch)
{{boundaries}}

<!-- The exact file/dir allowlist. Everything else is untouched. /DEV/ghostundo is NEVER touched.
     The worker never commits or runs any git mutation. -->

## Effort tier · failure idiom
- Effort: {{effort}}  <!-- low | medium | high | xhigh -->
- Failure idiom: {{failure_idiom}}  <!-- fail-closed evidence (no receipt ⇒ no claim) vs null-keep product (a missing optional degrades, never fails) -->

## Floor (the harness gate this batch must leave green)
{{floor}}

<!-- e.g. bash tests/v3/run.sh green (cite the baseline tally — you only add) ·
     node scripts/bundle-workflows.mjs --check untouched-green · any scoped floor. -->
