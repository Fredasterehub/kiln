# Transcript source

Snapshot from `/DEV/kilndev/test-results/kiln-teams-20260414-060726/`.
Captured 2026-04-14, kilndev v0.3.1.

## What this exercises

- **Happy path** (chunk 1, `codex` scenario, mario+luigi): write proof-1.md, APPROVED first try
- **Rejection cycle** (chunk 2, `codex`, lucky+luke): WRONG CONTENT → REJECTED → fix → APPROVED
- **Direct fallback** (chunk 3, `direct`, athos+porthos): Write tool path, not codex
- **UI team** (chunk 4, `ui`, clair+obscur): report.html with 4.4/5 design score
- **QA_FAIL → correction** (QA round 1): tribunal catches index.md missing, krs-one scopes fix
- **Final QA_PASS** (QA round 3): full tribunal consensus after trailing-newline fix

## Why this is the default transcript for replay tests

Dense — 123 events across 4 chunks + 3 QA rounds + 2 correction cycles.
Touches every signal in the build-step vocabulary at least once. Good
baseline for asserting engine decisions across a full milestone lifecycle.

## What was NOT copied

The original test-results dir contains `.omx/` runtime state (tmux hook,
notify-hook state, session logs) and duplicates of some QA artifacts at
the root level. Only `breadcrumbs/thoth-timeline.md` is reproduced here
— the minimum needed to feed `parse_transcript.py`. Per-agent breadcrumbs
were not copied to keep the snapshot lean; if replay needs recipient
recovery from per-agent logs, re-snapshot with a wider glob.
