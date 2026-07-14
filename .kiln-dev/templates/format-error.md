# Format-error reprompt — {{batch_id}}

The ONE mechanical reprompt (MetaGPT, lean form). A handoff (brief, commission, or verdict) missing
a required section is bounced by this template BEFORE any model reads it — a malformed handoff never
reaches the reviewer, and a format bounce is NOT a review rejection (it consumes no rung on the
ladder and no retry in the router).

## What was rejected
- Artifact: {{artifact_path}}
- Kind: {{artifact_kind}}  <!-- brief | review-commission | confirm-commission | verdict -->

## Missing / malformed required sections
{{missing_sections}}

<!-- The exact list, mechanically detected against the template's required-section skeleton. For a
     verdict, this is the schema/validator failure verbatim (e.g. "REJECTED must carry at least one
     BLOCKING finding", "finding ids must be unique", "violates schema at $.findings[0].remedy_class"). -->

## Required action
Re-emit the artifact with EVERY required section present and well-formed. Change nothing else.
Do not add scope, commentary, or fields beyond the skeleton. Then resubmit; the mechanical check
re-runs and, on pass, the handoff proceeds to its reader.
