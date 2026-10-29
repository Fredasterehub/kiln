# Pinned family contract (Kiln 4, kernel step 2)

`plugins/kiln/bin/launch` emits native arguments after Herdr's `--`.
The plugin ships its own [routing](../plugins/kiln/config/routing.toml) and
[seat schema](../plugins/kiln/config/seat.schema.json), resolved from the
launcher's location, so a copied plugin needs no repository-level config.

| Family / seat | Native arguments |
| --- | --- |
| Claude | `--model <id> --effort <e> --settings <inline-json>` |
| Codex, persistent | `--model <id> -c model_reasoning_effort=<e> -s workspace-write -C <root> -c approval_policy=never --add-dir <KILN_HOME> -c sandbox_workspace_write.network_access=true` |
| Codex, worker | `--model <id> -c model_reasoning_effort=<e> -s workspace-write -C <worktree-or-root> -c approval_policy=never --add-dir <KILN_HOME>` |

Both families receive one `--add-dir <dir>` per declared extra root; `--run`
adds its directory to that list. `--worktree` supplies the writable root and
makes `--root` optional. Paths are absolute. Codex always receives KILN_HOME
as an additional writable directory so seats can append rows and mark inboxes.
`approval_policy=never` lets Codex run unattended within its native sandbox.

Claude inherits the operator's permission mode: the launcher emits no
`--permission-mode` and no Edit permission allow rules. The fence covers native
edit tools only. Claude shell writes have no native directory scope. Codex's
sandbox includes all KILN_HOME via --add-dir; shell writes can alter other seats'
receipts, records and ledger state. This is a known integrity gap, not covered
by the edit-tool fence. Settings retain fallbackModel=[] and switchModelsOnFlag=false.

Claude receives Stop → `stop.sh`, PreToolUse → `fence.sh`, and, for persistent
roles, SessionStart → `start.sh`, via inline settings only. The existing
Claude adapter registers `listen.sh` at SessionStart and Stop with
`asyncRewake: true` and a 300-second timeout. Its 280-second lifetime is
covered by the fallback described below.
No Claude user or project settings file is written.

Install Codex's three events (Stop, SessionStart, PreToolUse) once with
`plugins/kiln/bin/launch install-hooks --family codex`; uninstall with
`plugins/kiln/bin/launch uninstall-hooks --family codex`. Both accept `--dry-run`.
The target is `$CODEX_HOME/hooks.json`, otherwise `~/.codex/hooks.json`.
Install first removes existing handlers whose commands contain `KILN_SEAT`,
then appends the current generic Kiln handlers. Uninstall removes only those handlers
and drops groups emptied by those removals. Non-Kiln content and order remain;
JSON formatting is normalized with indent 2. Parse and shape checks happen
before writing, and writes follow a symlink to its resolved target.
When installation or removal leaves the parsed content unchanged, no write occurs.
Seat launches write no hook files. Before agent start they persist folder trust
as described below; hook-review state in Codex `config.toml` remains read-only.
Missing installed Kiln hooks produce a warning and never refuse a launch.
Codex installs SessionStart for all seats; `start.sh` exits for workers.

Every Kiln hook command has this guard; KILN_PLUGIN is passed through Herdr's
--env for each seat so frozen copies select their own code:

```sh
sh -c '[ -n "$KILN_SEAT" ] && [ -f "$KILN_SEAT" ] && [ -n "$KILN_PLUGIN" ] || exit 0; exec "$KILN_PLUGIN/hooks/<script>.sh"'
```

Both the [Claude hooks](https://code.claude.com/docs/en/hooks.md) and
[Codex hooks](https://learn.chatgpt.com/docs/hooks) schemas use event arrays,
matcher-group `hooks` arrays, and command handlers with `type` and `command`.
SPEC §3's second isolated probe established that one Codex TUI review covers
stable user-level definitions across fresh worktrees and plain folders.
Kiln launches preserve Codex's normal hook review. After installing, follow
the printed one-time instructions: launch Codex from an empty plain folder,
open `/hooks`, inspect and trust the Kiln entries, then Esc and Ctrl-D.
Installation prints the exact `hooks.state` key for each Kiln handler:
`<absolute-hooks.json>:<event>:<group-index>:<handler-index>`; events are
`stop`, `pre_tool_use`, and `session_start`, and indexes include non-Kiln entries.
Codex persists hook review in `$CODEX_HOME/config.toml`; Kiln only reads that state.
Missing keys, absent `trusted_hash` values, or unreadable/malformed config
produce one warning naming the affected Kiln entries and never refuse a launch.
This observed state format is diagnostic, not a provisioning API: Kiln writes
no trust state and does not calculate or validate definition hashes.
Kiln hook definitions are stable on purpose; changing one costs one review.
Codex handles review of other project hooks; Kiln adds no foreign-hook guard.

The active lane supplies model/effort defaults; `balanced` and `claude-lean`
are available. `claude-lean` keeps director/super on Opus medium; managers,
helper, chunkmaster, implementer and investigator use Sol medium. Mechanical
and both research slots use Sol low. Review of GPT uses Opus medium and review
of Claude uses Astra medium. Conceptual is Astra medium (Argon is the advisor);
operational is Sol medium + Opus medium. UI plan/build/review are respectively
Astra/Sol/Opus medium; advisor is Argon high. Adding this lane does not change
the active selection. `bosses="gpt"` applies on top of either lane, overriding
only director (Astra medium) and super (Sol medium). Explicit model/effort override independently.
Family is derived from the final model; optional `--family` checks a caller's
explicit choice. Generic workers default to `implementer`, or `review_of_gpt`
when Claude is selected. No advisor seat exists: Argon runs as a plain
`agy -p <sanitized-prompt> --model gemini-4-argon-high --effort high --sandbox
--output-format json` command, outside this launcher, with no hooks or inbox.

The launcher selects a tab by unique label or ID within HERDR_WORKSPACE_ID,
splits its first listed pane with `--direction down` by default (`--direction
right|down` selects another direction), and stores the resolved tab label. Labels use
`<name-or-address> · <role-text> · <short-model>`; role text is `director`,
`super manager`, `<tab> manager`, `helper`, `chunk master`, or `worker`.
Herdr startup uses `agent start <addr> --kind <family> --pane <new-pane>
--timeout 30000 -- <native-arguments>`. Failed split/start restores the previous
seat record on a relaunch, or removes the record for a new seat. Corrupt prior
records produce a warning and are treated as absent. An overwritten address
with a different pane produces a warning.

Before `pane split`, the launcher records trust for the exact writable root:
Codex appends `[projects."<root>"]` with `trust_level = "trusted"` to
`$CODEX_HOME/config.toml` (default `~/.codex/config.toml`), preserving every
existing byte as a prefix of the atomically replaced file. It validates TOML before writing and saves `config.toml.bak-kiln`
once when an existing file needs changing. Already-trusted roots are unchanged.
Malformed config or an existing non-trusted table for the same root cannot be
fixed by appending a duplicate table: the launcher reports this without changing
the file, and does not start the agent. No startup keystrokes answer dialogs.
The [Codex reference](https://learn.chatgpt.com/docs/config-file/config-reference)
documents `projects.<path>.trust_level` as `"trusted"` or `"untrusted"`.

Claude sets only `projects[<root>].hasTrustDialogAccepted = true` in
`$HOME/.claude.json`, preserving all other JSON values and backing up the
existing file to `.claude.json.bak-kiln` once. The
[official settings guide](https://code.claude.com/docs/en/settings) identifies
`.claude.json` as holding per-project trust decisions; the specific Boolean
field was observed in a trusted project on this host (2026-10-29), rather than
documented as a provisioning API. Already-trusted records are untouched.
Invalid JSON is preserved and reported. Claude does not persist trust for the
home directory itself; use a project subdirectory, per the
[security documentation](https://code.claude.com/docs/en/security).
Both trust files use a `<file>.kiln.lock` sidecar flock across read, backup,
and atomic replacement. A unique temp file in the same directory is set to
the original mode (0600 for a new file) before content is written, then fsynced
before replacement. The one-time backup publishes the already-read snapshot
through a hard link from a complete, fsynced temp file. Codex re-parses the
installed file under the lock and refuses launch unless this root is trusted.
Immediately before `agent start`, the launcher re-reads trust and re-applies once
if missing; a failed confirmation refuses start. CLI writers do not necessarily
honour Kiln's lock, so this confirmation cannot prevent later external rewrites.
Dry-run prints planned backups and trust writes without changing either file
or creating locks.
Workers and pending rows are derived via `team workers` and `team pending`;
`seat.json` stores neither. Hooks and team share `plugins/kiln/lib/ledger.py`:
children are seat files whose parent matches this address, regardless of role;
pending rows are requests or questions addressed here, received in `seat.inbox`,
and not cited by any done/answer. The hook reads this state directly, without
invoking team. The launcher's owner runs `team close <addr>` when it accepts a
worker; this removes the seat record and is idempotent. Stop counts only worker
children whose current status lacks a terminal done/question line; persistent
children never count. Closing a persistent
seat requires `team close <addr> --force`; closing does not send Herdr commands.
Headlines must be one line; those above 100 characters warn without refusing.
Launch only records handoff/card paths; it does not widen extra_roots or
--add-dir for them. The edit-path rule is defined once in the fence (see hooks.md).
The required run field records --run for workers (required per worker) and the
phase root for persistent seats; worker status is read only from its own run.
A worker's `team send` appends its question without nudging any receiver. The
question records `via`, the worker's parent at send time. This field is present
only on worker questions; the other ledger fields remain `id`, `from`, `to`,
`kind`, `task`, `headline`, `path`, `time`, `cites`. The question's owner sends
the cited answer to this recorded launcher, even after the worker closes or
changes parent; workers remain invalid row recipients.
When the worker status says `question: #id`, its launcher runs `team relay <id>`
to nudge the question's receiver through the existing nudge path (one delayed
Codex busy re-check, one prompt at most, no retry). Relay requires the row's
`via` to match the caller, refuses worker callers, and reports a no-op when
the receiver is the caller. It appends no row. The launcher waits for the answer
and resumes the worker. Each relay invocation makes one nudge attempt; receipt
markers suppress a prompt after the question has been read.
--wait-ms writes
seat.wait_ms (default 1800000 ms) for Stop wait recipes. Claude executes both
Herdr wait forms with Bash run_in_background: true; Codex waits in the foreground.
The rotation producer's old_session/old_pane/acked contract is in hooks.md.

A Claude listener publishes `KILN_HOME/listeners/<address>.pid` while alive,
and removes its own marker before its final expiry check. Liveness also checks
/proc/<pid>/cmdline for core.py listen. `team send` leaves a live listener to wake
Claude; absent/dead markers use the same fallback as Codex: an idle/done status
gets one `herdr agent prompt <address> inbox`, with one delayed status re-check
if working, and no retry. This closes the listener-expiry idle gap. A forced
kill may leave a stale PID marker, which is treated as dead. See [hooks.md](hooks.md)
for marker ownership, wait and receipt interfaces.

`--dry-run` writes no files and makes no Herdr calls. It prints commands and
commented JSON writes, using placeholders for unavailable pane/workspace IDs
and `<KILN_HOME>` when unset. Live card/write/resume and local-socket sandbox
acceptance remain integration work, separate from these fake-Herdr unit tests.

PreToolUse matchers are Claude Bash|Edit|Write|NotebookEdit|MultiEdit and Codex
Bash|apply_patch. Native patch paths are fenced; patches run through Bash are shell
writes. Nested CLIs must clear both identifiers: env -u KILN_SEAT -u KILN_PLUGIN.
Logs retain refusals/errors, skipped-row counts and required start-card metrics.
