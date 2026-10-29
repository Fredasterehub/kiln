# Kernel hooks (step 3)

`hooks/{stop,start,fence,listen}.sh` repeat the launcher's guard as their first
executable line, before Python starts. A missing/mismatched `HERDR_PANE_ID`
is also silent and has no side effects. The shared `lib/core.py` reads identity
from `KILN_SEAT`; `lib/{claude,codex}.py` own wire output and write-tool paths.
Errors allow the operation and append one JSON line to `$KILN_HOME/hooks.log`.
A matching invocation logs once, including worker/advisor no-ops. No Herdr
command is executed by a hook. Hooks never mark inbox rows read.

## State interfaces

- `plugins/kiln/lib/ledger.py` is imported by both `team` and the hooks. It
  owns receipt, pending-row and worker lookup plus PID-marker liveness, without
  loading the team command-line parser or shelling out on a hook's hot path.
- Receipt uses `seat.inbox`, normally `$KILN_HOME/inbox/<address>.json`, with
  `{"read":["row-id"]}` as `team inbox --mark` writes it. SessionStart lists
  pending IDs exactly as `team pending`: rows addressed to this seat, marked
  received, with no done/answer citation. This includes questions and updates;
  there is no stored `pending` field. Rotation inherits the same receipt file.
- Workers are derived from `$KILN_HOME/seats/*.json`: each child whose `parent`
  equals this seat's address, regardless of role, exactly as `team workers`.
  There is no stored `workers` field. These seat records are the live roster;
  their owner removes a record when its lifecycle ends. Stop checks each child
  and the typing fence permits its address/pane, excluding the director.
  An armed wait is `$KILN_HOME/waits/<worker>.pid` containing the positive PID
  of the live **wait process**, not a shell that already returned. `kill(pid,0)`
  establishes liveness; Linux zombies are not live. The waiter/owner writes
  the marker on launch and may unlink it on exit; a dead PID is unarmed even
  if its marker remains. PID reuse is a limitation of this simple interface.
  The Stop reason supplies a command recording the wait PID; Claude runs that
  command as a background group ending in `&`.
- A finished request is an incoming `request` marked received, with no `done`
  row citing its ID, whose `path` names a result file or task directory. Check
  that file and its sibling `status.txt` (directory: its `status.txt` only).
  The last nonblank line must start `done:` or `HH:MM done:`; following text
  is allowed. Earlier done lines, `question:` and Herdr status are not proof.
  A task name alone is never guessed into a filesystem path.
- Rotation publishes `$KILN_HOME/rotations/<address>.json`:
  `{"id":"rotation-id","pane":"old-pane-id","acked":false}`. The rotate
  script sets `acked` true after its replacement receipt, as SPEC §3 requires.
  Write receipts atomically. Only the old owning pane is refused; replacement
  inbox work is independent. The refusal names the receipt and `cat` command
  to inspect it; publishing the ack belongs to rotate, never to the new seat.

The selectable `claude-lean` routing lane keeps Claude bridge bosses and uses
Sol for managers/workers, with the specified cross-family review/UI roles;
see [families.md](families.md). The GPT boss override affects only director/super.

## Native adapters and listener

Both adapters emit `decision: block`/`reason` at Stop, and
`hookSpecificOutput` with `additionalContext` at SessionStart or
`permissionDecision: deny`/`permissionDecisionReason` at PreToolUse.
Claude Edit/Write uses `file_path`; Codex apply_patch uses `command` and checks
Add/Update/Delete headers and both ends of Move. Paths resolve relative to
hook `cwd`, including symlinks, against `root` and `extra_roots`.

Bash checks apply only to director/super/manager/chunkmaster. Literal Herdr
commands are recognized at command boundaries, including simple shell lists;
this is not a shell interpreter or a sandbox. No command is executed and no
poll-loop patterns are checked. A Claude `herdr agent wait` command must end
in `&`. Both wait forms need `--timeout` (including `--timeout=N`). Agent prompt
targets are worker addresses; pane send-text/send-keys targets are the panes
in those workers' seat files. The director's address/pane is always excluded.
Shell writes rely on native family scope, as the spec states.

The **one-line launcher interface addition** calls Claude's `with_listener`
adapter when building inline settings. It adds a second guarded command to
SessionStart and Stop for persistent Claude seats, with `asyncRewake: true`
and `timeout: 300`. Native Claude runs this listener in the background; a
child backgrounded by stop.sh itself would not register an asyncRewake hook.
Workers, advisors and Codex receive no listener entry.

The listener follows the proven rewaketest pattern: check unread rows, sleep,
exit 2 with row IDs and `team inbox --mark` on stderr. It checks every 250 ms,
never consumes a row, and times out after 280 seconds (before Claude's 300 s
handler timeout). This is detached file monitoring, not an agent polling loop.
Every re-arm replaces a generation token under `listeners/<address>.lock`;
older listeners retire, as do listeners whose seat pane changed. Rows already
present at re-arm are checked immediately. Each listener atomically publishes
`$KILN_HOME/listeners/<address>.pid` under that lock. On wake, expiry, error,
SIGTERM or SIGINT it removes only its own marker; an older listener cannot
remove a replacement's PID. SIGKILL may leave a dead marker, which is harmless.
`team send` skips a Claude nudge while this PID is live. When absent or dead,
it uses the Codex fallback: check Herdr state, re-check once if working, and
prompt `inbox` once if still unread and idle/done. A listener armed during
that re-check suppresses the fallback. There is no prompt retry. This covers
idle seats after listener expiry without extending the proven hook timeout.
Codex has no idle asyncRewake equivalent: its documented background output
waits for the next user turn, so `team` always handles its inbox nudge.

Official contracts retrieved **2026-10-29** (installed CLI versions verified:
Claude Code 2.1.312, Codex 0.165.0). Relevant exact quotes:

- [Claude hooks](https://code.claude.com/docs/en/hooks.md): “For command hooks,
  input arrives on stdin.” Stop: “`"block"` prevents Claude from stopping.”
  `stop_hook_active`: “Check this value or process the transcript to avoid
  blocking on a condition that will never resolve.” SessionStart:
  “String added to Claude's context at the start of the conversation, before
  the first prompt.” PreToolUse: “Use `hookSpecificOutput.permissionDecision`
  and `hookSpecificOutput.permissionDecisionReason` instead.” Exit status:
  “Exit with code 2 to block the action.” Async: “If `true`, runs in the
  background and wakes Claude on exit code 2.” Timeout: “Claude Code still
  enforces `timeout` on a hook you run with `asyncRewake`.”
- [Codex hooks](https://learn.chatgpt.com/docs/hooks): “Every command hook
  receives one JSON object on `stdin`.” Stop: “To keep Codex going, return:”
  followed by `{"decision":"block","reason":...}`. PreToolUse:
  “You can also use exit code `2` and write the blocking reason to `stderr`.”
  The documented JSON denial is `hookSpecificOutput.permissionDecision: deny`
  with `permissionDecisionReason`. SessionStart: “That `additionalContext`
  text is added as extra developer context.” Background: “Finishing a
  background hook doesn't start a new turn.”

Local read-only evidence: `shared-data/rewaketest-20261029/{listen.sh,
claude-settings.json}` and `shared-data/envtest-20261029/{claude,codex}.txt`
under `/home/dev/.cache/kiln4/`. Test Stop fixtures preserve observed field
shapes with anonymous IDs/paths; other event fields follow the official docs.
No installed user configuration or live workspace was used for validation.
