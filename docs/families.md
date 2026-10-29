# Pinned family contract (Kiln 4, kernel step 2)

`plugins/kiln/bin/launch` emits native arguments after Herdr's `--`.
The plugin ships its own [routing](../plugins/kiln/config/routing.toml) and
[seat schema](../plugins/kiln/config/seat.schema.json), resolved from the
launcher's location, so a copied plugin needs no repository-level config.

| Family / seat | Native arguments |
| --- | --- |
| Claude | `--model <id> --effort <e> --settings <inline-json>` |
| Codex, persistent | `--model <id> -c model_reasoning_effort=<e> -s workspace-write -C <root> -c approval_policy=never --dangerously-bypass-hook-trust --add-dir <KILN_HOME> -c sandbox_workspace_write.network_access=true` |
| Codex, worker | `--model <id> -c model_reasoning_effort=<e> -s workspace-write -C <worktree-or-root> -c approval_policy=never --dangerously-bypass-hook-trust --add-dir <KILN_HOME>` |

Both families receive one `--add-dir <dir>` per declared extra root; `--run`
adds its directory to that list. `--worktree` supplies the writable root and
makes `--root` optional. Paths are absolute. Codex always receives KILN_HOME
as an additional writable directory so seats can append rows and mark inboxes.
`approval_policy=never` lets Codex run unattended within its native sandbox.

Claude inherits the operator's permission mode: the launcher emits no
`--permission-mode`. The fence controls writes; inline `permissions.allow`
contains declared-root `Edit(//absolute/root/**)` rules without claiming to
sandbox shell writes. Settings retain `{"fallbackModel":[],"switchModelsOnFlag":false}`.
The [settings guide](https://code.claude.com/docs/en/settings.md) links the
[current key reference](https://code.claude.com/docs/en/settings-reference.md),
verified 2026-10-29: lines 425 and 767 name `fallbackModel` and
`switchModelsOnFlag`; line 779 shows `"switchModelsOnFlag": false`.

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
then appends the current copy's handlers. Uninstall removes only those handlers
and drops groups emptied by those removals. Non-Kiln content and order remain;
JSON formatting is normalized with indent 2. Parse and shape checks happen
before writing, and writes follow a symlink to its resolved target.
Seat launches write no hook files and never edit Codex `config.toml`.
Missing installed Kiln hooks produce a warning and never refuse a launch.
Codex installs SessionStart for all seats; `start.sh` exits for workers.

Every Kiln hook command has this guard; paths resolve from the launcher's
own location and are shell-quoted when necessary:

```sh
sh -c '[ -n "$KILN_SEAT" ] && [ -f "$KILN_SEAT" ] || exit 0; exec <absolute-plugin-root>/hooks/<script>.sh'
```

Both the [Claude hooks](https://code.claude.com/docs/en/hooks.md) and
[Codex hooks](https://learn.chatgpt.com/docs/hooks) schemas use event arrays,
matcher-group `hooks` arrays, and command handlers with `type` and `command`.
Installed Codex 0.165.0 help verifies `--dangerously-bypass-hook-trust`;
SPEC §3's isolated probe established unattended user hooks in fresh worktrees.
The flag applies to all enabled sources, including non-Kiln hooks.

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
splits its first listed pane, and stores the resolved tab label. Labels use
`<name-or-address> · <role-text> · <short-model>`; role text is `director`,
`super manager`, `<tab> manager`, `helper`, `chunk master`, or `worker`.
Herdr startup uses `agent start <addr> --kind <family> --pane <new-pane>
--timeout 30000 -- <native-arguments>`. Failed split/start removes the seat
record; an overwritten address with a different pane produces a warning.
Workers and pending rows are derived via `team workers` and `team pending`;
`seat.json` stores neither. Hooks and team share `plugins/kiln/lib/ledger.py`:
children are seat files whose parent matches this address, regardless of role;
pending rows are addressed here, received in `seat.inbox`, and not cited by any
done/answer. The hook reads this state directly, without invoking team.

A Claude listener publishes `KILN_HOME/listeners/<address>.pid` while alive,
and removes its own marker on exit. `team send` leaves a live listener to wake
Claude; absent/dead markers use the same fallback as Codex: an idle/done status
gets one `herdr agent prompt <address> inbox`, with one delayed status re-check
if working, and no retry. This closes the listener-expiry idle gap. A forced
kill may leave a stale PID marker, which is treated as dead. See [hooks.md](hooks.md)
for marker ownership, wait and receipt interfaces.

`--dry-run` writes no files and makes no Herdr calls. It prints commands and
commented JSON writes, using placeholders for unavailable pane/workspace IDs
and `<KILN_HOME>` when unset. Live card/write/resume and local-socket sandbox
acceptance remain integration work, separate from these fake-Herdr unit tests.
