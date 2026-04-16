# Layer 1 — Static lint + hook fixtures

Runtime: ~2 seconds. No LLM calls, no network, no external deps. Pure Python 3.11+ stdlib + bash.

## What this catches

| Component | Target |
|---|---|
| `lint/consistency.py` | Cross-doc invariants: paths, signals, handlers, names, prefixes, runtime vars, REQUEST_WORKERS handler, STATE.md scope, terminal signal contract |
| `lint/agents.py` | Per-agent schema: frontmatter, required sections, bootstrap line, tool scope |
| `lint/orphans.py` | Dead code: orphan reference files, vestigial signals, tombstones, snake_case aliases, deleted-role residue |
| `hook-fixtures/` | Per-hook behavior: JSON stdin → diff stdout/stderr/exit against `.expected` |

Exit code 0 = all pass, 1 = any failure.

Map to audit findings (`PLUMBING-AUDIT-v1.3.0.md`):

| Finding | Detected by |
|---|---|
| C1 path mismatch | `consistency.py::check_path_symmetry` |
| C2 audit-milestone filter | `hook-fixtures/audit-milestone/bossman-no-ledger` |
| C3 missing CHECKER_ID | `consistency.py::check_runtime_vars` |
| C4 terminal signal contradiction | `consistency.py::check_terminal_signal_contract` |
| C5 orphan MILESTONE_DONE handler | `consistency.py::check_signal_handlers` |
| C6 missing REQUEST_WORKERS protocol | `consistency.py::check_request_workers_handler` |
| C7 prefix inconsistency | `consistency.py::check_prefix_consistency` |
| H1 vestigial signals | `orphans.py::check_vestigial_signals` |
| H4 hook exit code | `hook-fixtures/audit-bash/dial-a-coder-source-write` (exit=2 expectation) |
| H6 boss touches STATE.md | `consistency.py::check_boss_state_md_writes` |
| B1 orphan design-qa.md | `orphans.py::check_orphan_references` |
| B2 ITERATION_COMPLETE | `orphans.py::check_vestigial_signals` |
| B3 tombstones | `orphans.py::check_tombstones` |
| B4 snake_case aliases | `orphans.py::check_snake_case_aliases` |
| M4 stop-guard whitelist | (partial — stop-guard fixtures) |

## Running

```bash
bash run.sh                           # full layer 1
python3 lint/consistency.py           # single linter
python3 lint/agents.py
python3 lint/orphans.py               # fails on findings
python3 lint/orphans.py --warn-only   # reports but exits 0
bash hook-fixtures/run.sh             # all hook fixtures
bash hook-fixtures/run.sh enforce-pipeline   # one hook
```

## Hook fixtures — structure

Each fixture is a pair under `hook-fixtures/{hook-name}/`:

- `{case}.json` — stdin to the hook (simulates Claude Code tool_input)
- `{case}.expected` — assertion block:
  ```
  === STDOUT ===
  {exact match after trim, if non-empty}
  === STDOUT_CONTAINS ===
  {each non-empty line must appear as substring}
  === STDERR ===
  {each non-empty line must appear as substring}
  === EXIT ===
  {numeric exit code}
  === CONTEXT ===
  {"mock-pipeline" (default) or "no-pipeline"}
  ```
- `{case}.fixup.sh` (optional) — bash script receiving the tempdir path as `$1`; can overwrite seeded files to exercise specific states.

## Mock pipeline

The runner creates a disposable tempdir with:
- `.kiln/STATE.md` — stage=build, plugin_version=1.3.0
- `.kiln/docs/codebase-state.md` — with `<!-- status: complete -->`
- `.kiln/docs/patterns.md` — with `<!-- status: complete -->`
- `.kiln/docs/architecture.md` — with `<!-- status: complete -->`
- `.kiln/docs/iter-log.md` — one milestone_complete entry, qa: PASS
- `.kiln/master-plan.md` — minimal skeleton

Then cds there and pipes the JSON into the hook. Per-fixture fixups override specific files.

## Adding a consistency invariant

1. Add a new `check_*` function in `lint/consistency.py` returning `list[Violation]`.
2. Append to `ALL_CHECKS` at the bottom of the file.
3. Run against v1.3.0 to confirm it catches a real issue. If it doesn't, either the invariant is wrong or the codebase is already clean on that axis (fine).

## Adding a hook fixture

1. Pick the hook directory (`audit-milestone`, `audit-bash`, etc.).
2. Create `{name}.json` — the tool_input JSON.
3. Create `{name}.expected` — with STDOUT/STDERR/EXIT assertions.
4. (Optional) Create `{name}.fixup.sh` to modify the mock pipeline before the hook runs.
5. Run `bash hook-fixtures/run.sh {hook-name}` to verify.
