## ADR-1 — the JSONL is the truth, the log is a projection

Every rendered view is rebuilt from the append-only record, so a stale view is
a repair, never a second source of truth.
