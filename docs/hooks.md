# Kernel hooks

`hooks/{stop,start,fence,listen}.sh` test `KILN_SEAT` (nonempty, file exists)
and `KILN_PLUGIN` before starting Python. The launcher's handler command is:

```sh
sh -c '[ -n "$KILN_SEAT" ] && [ -f "$KILN_SEAT" ] && [ -n "$KILN_PLUGIN" ] || exit 0; exec "$KILN_PLUGIN/hooks/<event>.sh"'
```

Every seat receives `KILN_PLUGIN=<launcher's plugin root>` through Herdr env.
Codex's user-level entries therefore run the seat's frozen copy, regardless of
which copy installed them. Claude receives these commands inline in settings.
No user configuration is edited at seat launch. Start nested CLIs with
`env -u KILN_SEAT -u KILN_PLUGIN codex ...` (or `claude ...`) to avoid inheriting
seat identity. A copied guard with a missing plugin variable silently exits.

The Python guard accepts `seat.pane == HERDR_PANE_ID`. During an unacked rotation,
the fence and Stop also accept `old_pane` from the rotation receipt. Such a Stop
is outgoing and checks only rotation ownership, never inbox rows or workers.
Other events from that replaced pane exit silently. Unrelated panes never run hook policy.
Errors fail open. Logs contain refusals, continued-Stop advisory reports, errors,
skipped-ledger-line counts and the required SessionStart card line count excluding
the handoff; start text over 40 lines adds a warning.
Ordinary allowed tools, Stops with no report and successful listener wakes are not logged.

SessionStart injects identity, then `cards/common.md` from the seat's
`KILN_PLUGIN` whenever `seat.card` is set, then the role card, optional handoff,
pending IDs and the closing instruction. Common rules are stored once; role
cards contain only role instructions. Trailing newlines are stripped before
joining sections so each boundary adds one blank line. The shipped persistent
cards plus common rules and startup fields stay within 40 lines without a
handoff; tests measure that context for both families. The handoff is injected
in full but excluded from `card_lines` and the 40-line warning; it has its own
60-line budget (spec §2b). Tests cover 40/41-line starts with a 60-line handoff.

## Shared state and Stop

`plugins/kiln/lib/ledger.py` supplies receipt, pending, child-seat lookup,
PID liveness and the ledger parser to both team and hooks. It has no CLI parser.
Bad JSON/torn lines are skipped: team reports them on stderr; hooks count them
in `hooks.log`. The same `ledger.lock` protects reads against live appends.

Receipt is the `{"read":["row-id"]}` file at `seat.inbox`. Pending IDs are received
request/question rows addressed to this seat, with no done/answer citation.
Received updates/done/answers are not obligations. Nothing marks rows implicitly.
Workers and pending IDs are derived, never stored in seat.json.

Stop refuses only unread rows, a live worker without an armed wait, or an unacked
rotation owned by this session. `stop_hook_active` suppresses blocking, not
policy evaluation: a continued Claude Stop returns a reason naming unread row
IDs and other obligations, but omits decision:block and exits 0. A nonblocking
Codex Stop emits nothing: the docs do not specify a reason-only advisory shape.
Unread rows stay unread; the hook does not mark receipt or completion. A Codex
seat ending a continued Stop with unread rows waits for the next nudge or
`team relay`; this hook does not guarantee an immediate wake. Claude's continued
listener defers the initial unread IDs until expiry, with one delayed wake per
ID if still unread; new unread rows can wake it immediately.
An empty reason produces no output. Outgoing sessions still check only rotation,
never replacement inbox/workers. Workers always stop. Completion and sending
done remain card rules.

Remediation commands use the absolute path of this plugin's `bin/team`.

`team workers` lists all children by parent. Stop considers only role `worker`:
its seat record must remain present (`team close` removes it), and its current
status must lack a terminal done/question line. The required `seat.run` is its
sole status folder: workers must supply their own `--run` (for example
`chunks/<id>/impl/`, `gate/`, `review/`); persistent seats record their phase root.
The caller assigns a distinct folder to each worker. No status is read from
root, extra_roots, card/handoff folders or another worker's run. Within run use
the highest numbered `status-fix<n>.txt`, otherwise `status.txt`.
The last nonblank line beginning `HH:MM done:` / `question:` (or without time)
is terminal. Missing status is unfinished. Persistent children never count.

For Claude seats only, an armed wait is `waits/<worker>.pid`, containing the live
background wait process PID; zombies/dead/invalid PIDs are unarmed. Claude Stop's
command records that PID and waits for it to finish. Codex Stop never reads wait
markers: it gives a plain foreground wait instruction for every live worker.
`seat.wait_ms` supplies the Herdr timeout in milliseconds;
`wait_ms` is required in the schema; `launch --wait-ms` defaults to 1800000.
The hook also uses that default for legacy seat files missing wait_ms. Claude must execute the Bash payload with
`run_in_background: true`; shell `&` alone cannot supply the native completion
notification. Both agent wait and pane wait-output follow this rule. Codex waits
in the foreground with `--timeout`. No request-count or poll-loop heuristic exists.

## Rotation producer interface

The out-of-scope handoff plugin's rotate producer atomically writes
`$KILN_HOME/rotations/<address>.json` before replacement:

```json
{"old_session":"outgoing-session-id","old_pane":"outgoing-pane-id","acked":false}
```

After its replacement receipt/ledger ack, rotate sets `acked: true`. The Stop
condition compares payload session_id to old_session, never pane; a same-pane
replacement is never refused for that rotation. Both same-pane and different-pane
outgoing Stops evaluate only the rotation condition: they never ask the old
seat to consume the replacement's inbox or wait on its workers. The old pane
retains its fence and rotation-only Stop until ack. Outgoing listeners do not
re-arm and existing listeners retire when their session becomes outgoing. The
receipt must remain until outgoing hooks have finished. Hooks never publish the ack.

## Fence and family coverage

For builders the fence's write rule is root + extra_roots + payload scratchpad_dir
when present, plus the exact seat.handoff file as an exception. Workers launched
with `--read-only` instead get only seat.run + payload scratchpad_dir + the exact
seat.handoff file; root and extra_roots grant no writes. Their cwd/root stays
at the supplied worktree or root for reading and running commands. The exact
seat.card file is always read-only, including when it lies inside an allowed root. Neither
card nor handoff grants access to its parent directory. The launcher only
records those paths: it adds neither directory to extra_roots or --add-dir.
Paths resolve against payload cwd with symlinks resolved. NotebookEdit
uses notebook_path; Edit/Write use file_path. MultiEdit file_path is supported for
compatibility and included in the requested matcher, but is absent from the fetched
current Claude tool list. A scratchpad is allowed only when supplied in the payload.

Claude's matcher is `Bash|Edit|Write|NotebookEdit|MultiEdit`; Codex's is
`Bash|apply_patch`. Per the [Claude hook reference](https://code.claude.com/docs/en/hooks.md)
and [Codex hook reference](https://learn.chatgpt.com/docs/hooks), tool-event matchers
filter tool names (Codex also supports aliases). Omitted matchers match all events.
The [Claude tools reference](https://code.claude.com/docs/en/tools-reference.md)
describes native background Bash and NotebookEdit. Retrieved 2026-10-29.

The Codex release reference documents shell/unified exec as Bash and direct patch
calls as apply_patch, with tool_input.command for both; patch aliases Edit/Write
retain canonical apply_patch input. MCP/other local tools can also trigger hooks;
hosted tools do not. Kiln covers only native Bash and apply_patch. Direct patches
check Add/Update/Delete headers and both ends of Move. A patch invoked through Bash
is a shell write and is not inspected. These are documented 0.165.0 wire contracts,
not new live captures; real shell/patch capture remains step 4 acceptance.

Bash rules apply only to boss/orchestrator/manager/chunkmaster. The hook recognizes
literal Herdr wait/typing command forms, not a shell program. Unbalanced quoting
(for example in a heredoc) can make shlex fail. Such commands are allowed unless
the raw text names `herdr agent prompt`, `herdr pane send-text`,
`herdr pane send-keys`, `herdr agent wait` or `herdr pane wait-output`; then the
fence denies with "could not parse this command; run the herdr call on its own line".
Wrappers (`env herdr`, `bash -c`), substitutions and global flags before the subcommand
are not reliably seen. No shell-write parsing or additional typing verbs are claimed.
The installed Herdr 0.9.5 probes (maestro, 2026-10-29) establish a literal
first argument after the subcommand as target. Help is exempt only when that
slot is -h/--help, such as `herdr agent prompt -h`. An invocation with nothing
after the subcommand is left to Herdr's usage validation. An existing argument,
even an empty string, option-looking value or `--`, is checked literally. Later -h/--help is never
a fence exemption: `pane send-keys X a -h` sends keys;
`pane send-text X --help` sends text. `agent prompt X hi -h` fails native option validation, but
still undergoes the target check. Child addresses/panes are allowed except
the boss and this seat's address; help cannot exempt a separate command.


Every seat runs open: Claude inherits the operator's bypass mode and Codex uses
`danger-full-access` (since commit 6494e1a). Neither family relies on an OS
sandbox for write scope. Shell writes are never parsed; the fence covers
edit-tool writes only, so shell commands can still change files outside that scope.

`launch --read-only` is valid only for worker roles and records `read_only: true`.
Reviewers and council/opinion workers use it; gate runners and verify workers
do not, because their checks can create build output.
When the root is inside a Git worktree, it also records `worktree_mark`: SHA-256
over `git rev-parse HEAD`, `git status --porcelain=v1 -z`, `git diff HEAD --binary`,
and each untracked non-ignored file's path and contents, enumerated by
`git ls-files -o --exclude-standard -z`. Commands run from the worktree's top
directory. Literal Git pathspecs exclude the seat's own run folder from status,
diff and untracked enumeration, including when it is inside the worktree.
Untracked paths are NUL-terminated and contents prefixed with an eight-byte
big-endian length; symlinks contribute their link text. Outside Git there is no mark.
Known gaps: ignored files, and edits inside an untracked nested repository (only its
HEAD is hashed).
Before prompting a retained reviewer to re-read fixes, its owner runs `team mark <address>` to refresh the read-only seat's fingerprint under the team lock, making the implementer's fix the new baseline.
When each review result arrives, before sending any fix to the implementer, its owner runs `team check <address>` to compare the read-only seat's recorded worktree mark under the team lock using the same check as close, keeping the seat and refusing changed worktrees before a mark could absorb reviewer edits.
`team close <address>` recomputes any recorded mark before removing the seat or
closing its pane. A changed mark refuses with
`team: worktree changed since launch: reject this review`; `--force` overrides.
If the root is gone, close instead refuses with
`team: worktree gone: cannot check this review; use --force`.
An unchanged mark or absent mark closes as before. The check compares worktree
state, including existing dirt, rather than requiring a clean launch. It is an
acceptance check, not shell-write prevention; ignored files are excluded.

## Listener

Persistent Claude seats register listen.sh at SessionStart and Stop with
asyncRewake and timeout 300 s; the listener lasts at most 280 s. A Stop listener
seeing unread rows suppresses re-arm only after the complete shared Stop
policy successfully confirms an unread refusal. If that policy errors (for
example on a broken child record), the listener arms normally and wakes on the
unread rows; the diagnostic is logged. It does not assume that finding unread
rows means the rest of the synchronous policy succeeded. Other listeners scan the initial ledger once, then read only appended bytes at their
last offset every 1 s; receipt files are checked without consuming rows.
On stop_hook_active, initial unread IDs are excluded from ordinary polling;
new unread IDs still wake immediately. At expiry, initial rows still unread
get one delayed exit-2 wake, named alongside any new unread rows found then.
Rows marked read before that check do not wake the seat. A listener that exits
early for new rows does not consume the initial rows' delayed-wake allowance.

`listeners/<address>.expiry.json` records `{"woken":["row-id"]}` for delayed wakes
only. At expiry the listener checks receipt state under its generation lock and
atomically records newly claimed IDs before exiting 2. A superseded generation
cannot claim them. This state persists across re-arms: a second continued Stop
with the same unread IDs cannot give them another delayed wake. Each new ID has
its own allowance. The file is notification bookkeeping, not an inbox receipt;
no rows are marked read or completed, and Codex remains on relay/nudge delivery.

Each listener publishes listeners/<address>.pid under its generation lock and
removes only its own marker on wake, error, termination or supersession. On expiry
it removes that marker under the lock **before** one final unread check. A row
arriving at this boundary either sees no marker in send or is caught by that check.
Re-arm retires the old generation; an old exit cannot erase the replacement PID.

`team send` skips a Claude nudge only when the PID is live, not a zombie, and
/proc/<pid>/cmdline contains core.py followed by listen. Otherwise it uses Codex's
fallback: one status check, one delayed re-check if working, one inbox prompt if
idle/done and unread; no retry. A newly armed listener suppresses that prompt.
SIGKILL may leave a dead marker. PID reuse by an unrelated process does not suppress
fallback; PID reuse by another listener remains a simple-marker limitation.

Step 4 must verify the Codex foreground-wait contract at the tool transport:
a long shell/unified-exec wait may yield control before its command ends even
while the command remains live. Codex Stop therefore requires a foreground wait
for any live worker, regardless of markers. Existing live checks also include Claude completion/wake
notifications and whether PreToolUse carries scratchpad_dir.

Codex Stop output checked 2026-10-29: the requested
[developers.openai.com/codex/hooks](https://developers.openai.com/codex/hooks#stop)
redirects to [the release reference](https://learn.chatgpt.com/docs/hooks#stop).
It says “To keep Codex going, return:” and shows decision:block with reason.
Common output fields are continue, stopReason, systemMessage and suppressOutput;
no reason-only advisory is documented. Silence on a nonblocking Codex Stop is
our conservative implementation choice, not a claim that Codex rejects that shape.
