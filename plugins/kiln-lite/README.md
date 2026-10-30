# Kiln-Lite B1

Python 3.11+ and Git; Python standard library only. No Kiln 4 imports.
This slice ships `start`, `call`, `status`, and `follow`. B2 commands,
agents, hooks, and the Claude plugin manifest are deferred.

```sh
plugins/kiln-lite/bin/kl start demo --brief /path/brief.md --project /path/project
export KILN_LITE_RUN="$HOME/.cache/kiln-lite/project-demo"
plugins/kiln-lite/bin/kl call implementer /path/packet.md
plugins/kiln-lite/bin/kl call implementer /path/fix.md --resume THREAD_ID
plugins/kiln-lite/bin/kl call review_of_gpt /path/review.md --read-only
plugins/kiln-lite/bin/kl status
plugins/kiln-lite/bin/kl follow
```

`call`, `status`, and `follow` also accept `--run HOME`. Without an explicit
selection, they find the containing run home or the unique run for the current
project. Multiple runs require explicit selection. B1 writes no project pointer.
`follow` prints the current ledger, one headline per row, then exits.

Role names accept hyphens or underscores. `researcher`, `reviewer`, `verifier`,
and `council_expert` default to researcher_gpt, review_of_gpt, verifier_claude,
and conceptual.0 respectively. Select council seats with conceptual.N or
operational.N. A model override selects its CLI family by model ID prefix.
The claude-lean verifier defaults follow the corresponding v4 research routes.

Workers get the absolute result path and product cwd in their packet.
Without an explicit product directory, read-only workers run from their call
folder, except review_of_gpt and review_of_claude, which run from the worktree.
Other Codex and Claude calls run from the product directory. Claude receives
access to the call directory via `--add-dir`; process cwd selects its workspace.
Agy always launches from the call folder, with stdin disconnected. Receipts
record `launch_cwd` and `product_cwd` separately for every CLI (`cwd` retains
the product directory for compatibility).
`--read-only` detects Git or plain-directory fingerprint changes; it does not
prevent changes or undo them. Route defaults enable it for reviewing roles.
`final.md` holds the CLI response; a worker-written `result.md` is preserved.
If the worker wrote no result, only a successful CLI completion with a nonempty
final message supplies one. Otherwise `result.md` stays absent and `status.txt`
records the reason; the ledger result path is null.

`meta.json` distinguishes requested and observed model identity, retains all
reported token usage, and leaves missing identity/cost as null. Codex completion
events supply usage, not observed model identity. Agy requested effort is null
because the model slug encodes it. Nonzero
exit, timeout, malformed output, or incomplete CLI completion is a failed call.
Failed, rejected, and unparsed calls return exit 1; parsed worker questions and
blocks return exit 0 with their status retained. No model fallback is attempted.

Timeouts kill the CLI process group, including helpers. Agy's internal timeout
is 60 seconds shorter than the outer timeout (zero when the outer timeout is
60 seconds or less). Resumed Codex and agy packets omit the already supplied
card. Call numbering considers only directories beginning with digits and `-`.
Runner subagents are not callable worker routes; aliases load resolved cards.

`run.md` shows up to four entries per section and stays within 60 lines.
Its Milestones done section reads accept rows with `artifact_kind: milestone`,
using their `milestone` and `artifact` fields. Acceptance commands remain B2.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s plugins/kiln-lite/tests
python3 plugins/kiln-lite/bin/kl --help
```
