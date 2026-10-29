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
only the fence also accepts `old_pane` from the rotation receipt. Other events
from that replaced pane exit silently. Unrelated panes never run hook policy.
Errors fail open. Logs contain refusals, errors, skipped-ledger-line counts,
and the required SessionStart card line count; cards over 40 lines add a warning.
Ordinary allowed tools, allowed Stops and successful listener wakes are not logged.

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
rotation owned by this session. `stop_hook_active` allows the continued Stop;
workers always stop. Request completion and sending done remain card rules.
Remediation commands use the absolute path of this plugin's `bin/team`.

`team workers` lists all children by parent. Stop considers only role `worker`:
its seat record must remain present (`team close` removes it), and its current
status must lack a terminal done/question line. A run directory in extra_roots
takes precedence over root; search in reverse extra-root order. Within that
directory use the highest numbered `status-fix<n>.txt`, otherwise `status.txt`.
The last nonblank line beginning `HH:MM done:` / `question:` (or without time)
is terminal. Missing status is unfinished. Persistent children never count.

An armed wait is `waits/<worker>.pid`, containing the live wait process PID;
zombies/dead/invalid PIDs are unarmed. Stop's command records that PID and waits
for it to finish. `seat.wait_ms` supplies the Herdr timeout in milliseconds;
`launch --wait-ms` defaults to 1800000. Claude must execute the Bash payload with
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
replacement is never refused for that rotation. A different old pane retains
its fence until ack but its Stop exits through the pane guard. The receipt must
remain until outgoing hooks have finished. Hooks never publish the ack.

## Fence and family coverage

Write roots are root + extra_roots + card/handoff parent directories + payload
scratchpad_dir when present. Launch explicitly adds card/handoff directories to
extra_roots. Paths resolve against payload cwd with symlinks resolved. NotebookEdit
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

Bash rules apply only to director/super/manager/chunkmaster. The hook recognizes
literal Herdr wait/typing command forms, not a shell program. Unbalanced quoting
(for example in a heredoc) can make shlex fail: policy fails open and logs an error.
Wrappers (`env herdr`, `bash -c`), substitutions and global flags before the subcommand
are not reliably seen. No shell-write parsing or additional typing verbs are claimed.
Typing permits child addresses/panes except the director and this seat's address.

Claude shell writes have **no native directory scope**; no Edit allow rules are
installed or claimed as a boundary. Codex shell writes use its native sandbox,
which includes all of KILN_HOME via --add-dir: a seat can write other receipts,
seat records, rotations, waits and the ledger. This is a known integrity gap;
the edit-tool fence does not prevent shell writes to those files.

## Listener

Persistent Claude seats register listen.sh at SessionStart and Stop with
asyncRewake and timeout 300 s; the listener lasts at most 280 s. A Stop listener
seeing unread rows that the synchronous Stop refuses does not re-arm. Other
listeners scan the initial ledger once, then read only appended bytes at their
last offset every 1 s; receipt files are checked without consuming rows.

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
