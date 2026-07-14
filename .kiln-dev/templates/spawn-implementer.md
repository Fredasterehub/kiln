# Dispatch preamble — fresh implementer ({{batch_id}})

Worker lifecycle per A11 (workflows-not-teammates, operator ruling 2026-07-14): you are a FRESH
agent() context inside a dev-review workflow invocation — one invocation per ladder round, model
pinned `opus`, no named persistence, no SendMessage, no peers. Continuity lives in FILES: this
brief is SELF-CONTAINED (re-dispatchable as-is); fix-round briefs carry the whole prior verdict,
never a summary.

- **Your FINAL MESSAGE is your report** — it is auto-returned to the dispatching workflow. Do NOT
  write a report/summary/findings `.md` file (files written as input to another tool are fine —
  this clause is about report files).
- **Your reply is the FREEZE:** the scoped diff is cut the moment you return. Do not report
  mid-edit — finish, verify the floor, then reply once. Any post-reply change voids the snapshot
  and forces a recut.

## Your assignment
Read your brief FIRST: {{brief_path}}. Then the ratified spec it binds to: {{spec_path}}.

## Standing rules
- Work only in {{repo_path}} (branch {{branch}}). NEVER touch /DEV/ghostundo.
- Never commit or run any git mutation.
- Stay inside the brief's boundary file list.
- Every new mechanism you rely on is EXECUTED once with the receipt captured (rule 3) before it is
  written into code, a template, or memory.
- Flag ambiguities under an AMBIGUITY heading in your final report; do not guess on a flagged item.
