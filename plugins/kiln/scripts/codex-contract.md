# Codex gate-review contract

`kiln-review` is the only kernel-facing Codex seam. It performs a fresh terminal semantic review and publishes the current `gate-review.json` only after schema and invariant validation.

## Invocation

```text
kiln-review review  <repo> <request.json> <gate-review.json>
kiln-review recheck <repo> <request.json> <prior-gate-review.json> <repair-delta> <gate-review.json>
```

The request is JSON with `reviewer_model`, `law_hash`, `criteria`, and string arrays `paths`, `failures`, and `commands`. The caller supplies the same request, including `reviewer_model`, throughout one review/repair loop. `reviewer_model` is passed as `--model` but never enters the evidence packet.

The transport invokes `codex exec --ephemeral --sandbox read-only --skip-git-repo-check -C <repo> --model <reviewer_model> -c model_reasoning_effort="high" --output-schema <review-schema.json> -o <temporary-output> -`, with the prompt supplied on stdin. A valid result is atomically renamed to the requested gate path. This follows the current official [noninteractive contract](https://developers.openai.com/codex/noninteractive/) and [`codex exec` reference](https://developers.openai.com/codex/cli/reference/); `--skip-git-repo-check` permits the locked historyless fixtures without widening the read-only sandbox.

## Packet

The script constructs the packet rather than forwarding the request. It retains only the locked criteria, relevant paths, observed failures, permitted commands, LAW hash, generated review ID, and repository access through `-C`. Author, model, persona, explanations, prior verdicts, and every unrecognized request field are absent. Findings must identify a criterion violation with a stable ID, exact repo-relative `path:line`, concrete failure, evidence, and smallest repair. Optional improvements are not findings.

## Recheck

A recheck is another fresh ephemeral invocation with the same embedded instructions and caller-held model. The script reads the persisted review ID, LAW hash, and original finding IDs from the prior gate, adds the repair delta, and instructs the reviewer to decide only those IDs. An out-of-scope or newly invented finding ID fails transport validation. Session identity is never used.

After JSON parsing, the script enforces: `accept` requires exactly empty findings and blockers; `changes_required` requires nonempty findings and empty blockers; `blocked` requires nonempty blockers. It also checks exact review-ID/LAW-hash continuity, unique nonempty finding fields, and schema-exact keys.

## Actor repair resume

Within one task, a repair turn may resume the same actor session to preserve intent and reduce context cost. Capture `thread_id` from the initial actor call’s first `thread.started` event emitted by `codex exec --json`, then target it explicitly with `codex exec resume <thread_id>`. Never use `--last`. Initial actor work, work for another task, and every reviewer invocation use fresh sessions; reviewers remain fresh and ephemeral.

A resumable actor chain must omit `--ephemeral`, because ephemeral sessions have no rollout and cannot be resumed. The task-scoped thread ID must not be reused across tasks.

Because `codex exec resume` rejects `-C/--cd` and `-s/--sandbox`, the transport sets the working root by changing directory before invocation and sets the sandbox with `-c sandbox_mode=<mode>`. Other supported resume flags, including `--model`, `--json`, output options, and configuration overrides, may be supplied normally.

Session resume is a cache; persisted task artifacts remain the truth. If the thread ID is unavailable or resume fails, the transport makes a fresh actor call with the task packet re-primed from those artifacts.

## Machine facts

| Exit | stdout | Meaning |
| ---: | --- | --- |
| 0 | `accept` | Gate accepted. |
| 10 | `reject` | Substantiated findings require repair. |
| 11 | `blocked` | Reviewer could not complete the gate; blockers are recorded. |
| 20 | `transport_failure` | Request, invocation, output, schema, invariant, auth, provider, or transport failed. No gate is published. |
| 21 | `codex_unavailable` | The real Codex process could not execute, returned shell absent/broken status, or rejected the required CLI contract. No gate is published. |

Exit 21 is the missing/broken-Codex degradation trigger: after the required user acknowledgment, the kernel may continue single-family and must label every affected seal. Exit 20 is not that declaration; it is an untrusted call failure. The transport never retries, resumes, or converts either failure into a verdict.
