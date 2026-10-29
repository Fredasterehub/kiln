# Pinned family contract (Kiln 4, kernel step 2)

`plugins/kiln/bin/launch` emits these native arguments after Herdr's `--`.
The installed `claude --help`, `codex exec --help`, and `agy --help` were
checked on 2026-10-29. Models use the exact IDs in `routing.toml` and
`seat.schema.json`; there is no model fallback or provider substitution.

| Family / seat | Native arguments |
| --- | --- |
| Claude, persistent or worker | `--model <id> --effort <e> --permission-mode acceptEdits --settings <inline-json>` |
| Codex, persistent | `--model <id> -c model_reasoning_effort=<e> -s workspace-write -C <root> -c approval_policy=never --dangerously-bypass-hook-trust -c sandbox_workspace_write.network_access=true` |
| Codex, worker | `--model <id> -c model_reasoning_effort=<e> -s workspace-write -C <worktree-or-root> -c approval_policy=never --dangerously-bypass-hook-trust --add-dir <run>` (when supplied) |
| agy, advisor only | `-p --model <id> --effort <e> --sandbox --output-format json` |

Claude and Codex also receive one `--add-dir <dir>` per declared extra root.
`--run` adds its directory to that list; `--worktree` replaces the writable root.
All paths are absolute. The split pane starts in the writable root.

Claude's inline settings combine `{"fallbackModel":[],"switchModelsOnFlag":false}`
with hooks and `permissions.allow` entries `Edit(//absolute/root/**)` for the
root and extra roots. `acceptEdits` accepts writes in the working directories;
these settings do not claim to sandbox arbitrary shell writes. See the
[Claude permission contract](https://code.claude.com/docs/en/permissions).

Claude receives Stop → `stop.sh`, PreToolUse → `fence.sh`, and, for persistent
roles, SessionStart → `start.sh`, via inline settings only. No Claude user or
project settings file is written. agy has no hooks.

Install Codex's three events (Stop, SessionStart, PreToolUse) once with
`plugins/kiln/bin/launch install-hooks --family codex`; remove them with
`plugins/kiln/bin/launch uninstall-hooks --family codex`. Both accept `--dry-run`.
The target is `$CODEX_HOME/hooks.json`, or `~/.codex/hooks.json` when unset.
Installation is idempotent and preserves the bytes and order of non-Kiln
entries. Uninstall removes only handlers whose command contains `KILN_SEAT`,
and drops a matcher group only when those removals empty it. Seat launches
write no Codex hook files; neither setup nor launch edits `config.toml`.

Every Kiln hook command, in both families, has this guard (the plugin root
is resolved from the launcher's own location; script paths are shell-quoted):

```sh
sh -c '[ -n "$KILN_SEAT" ] && [ -f "$KILN_SEAT" ] || exit 0; exec <absolute-plugin-root>/hooks/<script>.sh'
```

Paths point to `plugins/kiln/hooks/`; this step does not create those scripts.
The hook object follows the [Claude hook schema](https://code.claude.com/docs/en/hooks.md)
and [Codex hook schema](https://learn.chatgpt.com/docs/hooks), checked 2026-10-29.
Both schemas nest event arrays, matcher-group `hooks` arrays, then handlers
with `"type": "command"` and `"command"` fields. Codex's docs list all three
event names and user-level hooks; Claude's docs use the same settings structure.
Codex's `-c` values use its native config override mechanism; help verifies the
flag, while the pinned values come from SPEC §3 and the config reference.

The launcher reads the repository's `routing.toml`. Defaults use the active
lane's role row and apply `boss_lanes.gpt` to director/super when `bosses="gpt"`.
The generic worker role defaults to `implementer` for Codex and `review_of_gpt`
for Claude; task-specific routing uses explicit `--model` / `--effort`.
An explicit family must match the resulting model. Advisor defaults to its
advisor row. Explicit model and effort override their respective defaults.

Herdr commands are `tab list --workspace <HERDR_WORKSPACE_ID>`,
`pane list --workspace <id>`, `pane split <tab-pane> --cwd <root> --no-focus
--env KILN_SEAT=<seat-path> --env KILN_HOME=<home>`, `pane rename <new-pane>
'<name-or-address> · <role> · <short-model>'`, and `agent start <address>
--kind <family> --pane <new-pane> --timeout 30000 -- <native-arguments>`.
`--tab` accepts a unique label or ID in the caller's workspace; the first pane
listed in that tab is the split target. Workspace and pane IDs come from
Herdr responses, never from UI focus. Seat identity is written before agent start.

`--dry-run` makes no Herdr calls and writes no files. It prints the commands
and commented JSON file writes, using `<workspace>` if no workspace env exists,
`<tab-pane>` for the pane to split, and `<new-pane>` for the returned pane ID.

The installed Codex 0.165.0 `codex exec --help` and `codex --help` confirm
`--dangerously-bypass-hook-trust`. SPEC §3's isolated probe established that
user-level hooks plus this flag run unattended in fresh worktrees. The flag
applies to all enabled hook sources, including preserved non-Kiln hooks.
Live card/write/resume acceptance remains integration work after step 3.
Herdr describes `agent start` as interactive readiness; agy's one-shot `-p`
readiness needs that isolated acceptance check as well.
