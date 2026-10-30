# Pinned family contract (Kiln 4, kernel step 2)

| Family | Launch |
| --- | --- |
| agy | advisor (one-shot in a pane) |

`plugins/kiln/bin/launch` emits native arguments after Herdr's `--`.
The plugin ships its own [routing](../plugins/kiln/config/routing.toml) and
[seat schema](../plugins/kiln/config/seat.schema.json), resolved from the
launcher's location, so a copied plugin needs no repository-level config.

| Family / seat | Native arguments |
| --- | --- |
| Claude | `--model <id> --effort <e> --settings <inline-json>` |
| Codex, persistent | `--model <id> -c model_reasoning_effort=<e> -s danger-full-access -C <root> -c approval_policy=never --add-dir <KILN_HOME>` |
| Codex, worker | `--model <id> -c model_reasoning_effort=<e> -s danger-full-access -C <worktree-or-root> -c approval_policy=never --add-dir <KILN_HOME>` |

Both families receive one `--add-dir <dir>` per declared extra root; `--run`
adds its directory to that list. `--worktree` supplies the seat root and
makes `--root` optional. Paths are absolute. Codex always receives KILN_HOME
via `--add-dir`. `approval_policy=never` lets Codex run unattended;
`danger-full-access` leaves shell writes unrestricted.

Claude inherits the operator's permission mode: the launcher emits no
`--permission-mode` and no Edit permission allow rules. The fence covers native
edit tools only. Claude shell writes have no native directory scope. Codex also
runs without an OS sandbox; shell writes can alter other seats'
receipts, records and ledger state. This is a known integrity gap, not covered
by the edit-tool fence. Worker `--read-only` restricts edit-tool writes to its
run, exact handoff and payload scratchpad; root and extra roots remain readable.
At acceptance, `team close` rejects a changed recorded Git worktree fingerprint
unless `--force` is supplied (see [fence coverage](hooks.md#fence-and-family-coverage)).
Settings retain fallbackModel=[] and switchModelsOnFlag=false.

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
Seat launches write no hook files. Claude folder trust is described below;
hook-review state in Codex `config.toml` remains read-only.
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

`plugins/kiln/bin/kiln start --team <team-dir> --project <repo>
--workspace <label> [--lane balanced|claude-lean] [--bosses claude|gpt]
[--names boss=Oracle,orchestrator=Robin] [--dry-run]` bootstraps a team.
It creates ledger.jsonl, seats/, inbox/, and bridge/, research/, plan/, build/,
verify/, deploy/, council/, waits/, listeners/. It trusts the team folder once for Claude, writes
team.toml with lane, bosses, project, branch, and trunk paths, creates a Herdr
workspace, and renames its initial tab to bridge. Boss, orchestrator (parent
boss), and gravedigah (parent orchestrator) all use bridge/ as their root; gravedigah's
fixed display name is Gravedigah. It prints their pane IDs and boss address.
Unspecified lane/bosses use the plugin routing defaults; unnamed bosses use
their addresses. Starting a configured team again refuses before any changes.
Bootstrap creates branch `kiln/<slug>` from the product HEAD in
`<team>/build/trunk` with `git -C <project> worktree add -b <branch> <trunk> HEAD`.
The slug replaces every character outside `[A-Za-z0-9._-]` in the team folder
name with `-` and collapses hyphen runs, then Git validates the branch. Slices and chunks live in worktrees
under build/; integration merges go to build/trunk. The operator's checkout,
including dirty files and its checked-out branch, remains unchanged. Delivery
names the integration branch for the operator to merge.
A failure after team.toml prints workspace/tab IDs, started panes and the exact
remaining launch commands; team state is retained with no automatic retry.
If workspace creation itself failed, workspace-create and tab-rename commands
print before the launch commands; replace placeholder IDs with the create result.
Any failure after worktree creation also prints exact worktree-remove and
branch-delete commands for an operator abandoning the start; no cleanup runs automatically.
Dry-run prints planned layout, trust, config, workspace/tab, and launcher
commands with placeholder IDs and performs no writes or Herdr calls.

The launcher reads lane and bosses from KILN_HOME/team.toml over the shipped
routing defaults; explicit --model/--effort still take precedence. When --card
is absent, persistent roles use the shipped cards/boss.md, orchestrator.md,
gravedigah.md, or chunkmaster.md; phase managers use cards/manager-<resolved-tab>.md.
A missing default card refuses launch before the split. Workers have no default
seat card: their packets refer to cards/worker.md. The shared hand-off table
ships at `$KILN_PLUGIN/handoffs.md` ([table](../plugins/kiln/handoffs.md)).
Cards are referenced directly in the plugin, not copied into the team folder.
An explicit --card overrides the default.
`--route <key>` selects an active-lane entry instead of the role default, e.g.
`research_gpt`, `conceptual.0`, or `operational.1`; explicit --model/--effort
still win. Explicit routes override the role's bosses override. The `advisor`
entry selects Argon; agy remains a plain command, so it cannot start a seat.
`plugins/kiln/bin/kiln route <key>` prints `<model> <effort>` using the same
active-lane resolver, including team.toml overrides and list indexes. It is a
read-only lookup and works for `advisor` without launching an agy seat. A list
key such as `conceptual` or `operational` prints one model/effort line per entry
in lane order; `conceptual.0` still selects just the first entry.

The orchestrator launches each phase manager only when work starts (council
at the first question), with address equal to the phase. The launcher creates
a missing tab in HERDR_WORKSPACE_ID, falling back to the parent seat's recorded
workspace when the variable is absent. Phase workers default to their parent’s tab, splitting right of the parent first and down from the last live worker thereafter; bridge seats' workers go to `bridge-work`; a new tab’s root shell closes once the seat is up. Use this shape from the orchestrator's pane:

```sh
plugins/kiln/bin/launch --tab build --address build --role manager --root "$KILN_HOME/build" --parent orchestrator
```

Substitute research, plan, verify, deploy, or council for build. Persistent
roots contain phase artifacts; product edits happen through product worktrees.
Codex seats on build, verify, and deploy also receive the product's Git common
dir as an extra root, resolved by `git -C <project> rev-parse
--path-format=absolute --git-common-dir`, as a declared path for Git metadata
edits. Read-only workers grant it no edit-tool writes. The operator's checkout
is not added as a writable root.

The active lane supplies model/effort defaults; `balanced` and `claude-lean`
are available. `claude-lean` keeps boss/orchestrator on Opus medium; managers,
gravedigah, chunkmaster, implementer and investigator use Sol medium. Mechanical
and both research slots use Sol low. Review of GPT uses Opus medium and review
of Claude uses Astra medium. Conceptual is Astra medium (Argon is the advisor);
operational is Sol medium + Opus medium. UI plan/build/review are respectively
Astra/Sol/Opus medium; advisor is Argon high. Adding this lane does not change
the active selection. `bosses="gpt"` applies on top of either lane, overriding
only boss (Astra medium) and orchestrator (Sol medium). Explicit model/effort override independently.
Family is derived from the final model; optional `--family` checks a caller's
explicit choice. Generic workers default to `implementer`, or `review_of_gpt`
when Claude is selected. Argon launches with `--role advisor --route advisor
--run <dir> --packet <file> --parent <you>` in the parent tab, using the worker
split layout. It has no hooks or inbox; read `result.md` when `rc` exists,
then close the accepted seat with `team close`.

The launcher selects a tab by unique label or ID within HERDR_WORKSPACE_ID,
splits its first listed pane with `--direction down` by default (`--direction
right|down` selects another direction), and stores the resolved tab label. Labels use
`<name-or-address> · <role-text> · <short-model>`; role text is `boss`,
`orchestrator`, `<tab> manager`, `gravedigah`, `chunk master`, or `worker`.
Herdr startup uses `agent start <addr> --kind <family> --pane <new-pane>
--timeout 30000 -- <native-arguments>`. Failed split/start restores the previous
seat record on a relaunch, or removes the record for a new seat. Corrupt prior
records produce a warning and are treated as absent. An overwritten address
with a different pane produces a warning. After a successful start, if the
seat has unread ledger rows according to its inbox receipts, launch sends
one `herdr agent prompt <address> inbox`. A failed prompt is reported without
retrying or removing the successfully started seat's record.

Codex launches never write profile config. `kiln start`, running unsandboxed,
resolves the project's main root as the parent of `git -C <project> rev-parse
--path-format=absolute --git-common-dir`. Under a sidecar flock it parses
`$CODEX_HOME/config.toml` (default `~/.codex/config.toml`) and, only if that
root's projects table is absent, appends `[projects."<root>"]` with
`trust_level = "trusted"`. It preserves existing bytes and tables and makes
one `config.toml.bak-kiln` from the parsed bytes before changing an existing
file. New config is 0600; malformed TOML refuses without changing it.
Codex 0.165 applies in-Git trust to the main repository root, including its
worktrees; with that root trusted a worktree opens directly (live probes,
2026-10-29; smoke run 1 stalled without it). Outside Git there is no folder
trust dialog. Later launchers need no profile writes; hook-review
diagnostics remain read-only.

Before `pane split`, Claude checks `$HOME/.claude.json` read-only for an exact
resolved root or ancestor key with `hasTrustDialogAccepted` equal to true.
Claude trust carries down to child folders (live probe, Claude 2.1.312,
2026-10-29). When any ancestor is trusted there is no lock, write, or backup.
Team bootstrap trusts the team folder once from the bridge; later seat roots
belong under that folder so launchers need no profile writes.
Otherwise the launcher sets only `projects[<root>].hasTrustDialogAccepted = true`,
preserving other JSON values. It holds a `.claude.json.kiln.lock` flock across
read, backup, and atomic replacement. A unique same-directory temp file receives
the original mode (0600 if new) before content, is fsynced, then replaces the
file. The one-time `.claude.json.bak-kiln` publishes the read snapshot through
a hard link from a complete, fsynced temp file. Permission/read-only failures
refuse before pane creation and name the remedy: put seat roots under a folder
Claude already trusts. Invalid JSON is preserved and reported.
The [official settings guide](https://code.claude.com/docs/en/settings) describes
per-project trust in `.claude.json`; the Boolean field is observed state,
not a documented provisioning API. Claude does not persist trust for HOME
itself; use a project subdirectory per the
[security guide](https://code.claude.com/docs/en/security).
Immediately before `agent start`, the same ancestor check runs again; missing
trust is re-applied once. Failed confirmation closes the new pane and restores
the previous seat record. Claude may ignore Kiln's lock and overwrite trust
after confirmation. Dry-run prints planned backups and writes once without
changing files or creating locks.
Workers and pending rows are derived via `team workers` and `team pending`;
`seat.json` stores neither. Hooks and team share `plugins/kiln/lib/ledger.py`:
children are seat files whose parent matches this address, regardless of role;
pending rows are requests or questions addressed here, received in `seat.inbox`,
and not cited by any done/answer. The hook reads this state directly, without
invoking team. The launcher's owner runs `team close <addr>` when it accepts a
worker; this removes the seat record and is idempotent. Stop counts only worker
children whose current status lacks a terminal done/question line; persistent
children never count. Closing a persistent
seat requires `team close <addr> --force`. Closing removes the seat record,
then calls `herdr pane close <recorded-pane>` outside the ledger lock. An already
gone pane or failed close is reported without failing the command; it is not
retried. Closing an absent seat is a no-op.
Headlines must be one line; those above 100 characters warn without refusing.
The default handoff is `<root>/handoff-<address>.md`, so shared phase roots
never share one handoff file; explicit --handoff overrides it. Launch only
records handoff/card paths; it does not widen extra_roots or
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

`team send --from` is optional and defaults to the KILN_SEAT address; an explicit
value must still match that identity. Workers can send their question with
--to/--kind/--task/--headline and optional --path, without repeating their address.
