# Pinned family contract (Kiln 4, kernel step 2)

`plugins/kiln/bin/launch` emits these native arguments after Herdr's `--`.
The installed `claude --help`, `codex exec --help`, and `agy --help` were
checked on 2026-10-29. Models use the exact IDs in `routing.toml` and
`seat.schema.json`; there is no model fallback or provider substitution.

| Family / seat | Native arguments |
| --- | --- |
| Claude, persistent or worker | `--model <id> --effort <e> --permission-mode acceptEdits --settings <inline-json>` |
| Codex, persistent | `--model <id> -c model_reasoning_effort=<e> -s workspace-write -C <root> -c approval_policy=never -c sandbox_workspace_write.network_access=true` |
| Codex, worker | `--model <id> -c model_reasoning_effort=<e> -s workspace-write -C <worktree-or-root> -c approval_policy=never --add-dir <run>` (when supplied) |
| agy, advisor only | `-p --model <id> --effort <e> --sandbox --output-format json` |

Claude and Codex also receive one `--add-dir <dir>` per declared extra root.
`--run` adds its directory to that list; `--worktree` replaces the writable root.
All paths are absolute. The split pane starts in the writable root.

Claude's inline settings combine `{"fallbackModel":[],"switchModelsOnFlag":false}`
with hooks and `permissions.allow` entries `Edit(//absolute/root/**)` for the
root and extra roots. `acceptEdits` accepts writes in the working directories;
these settings do not claim to sandbox arbitrary shell writes. See the
[Claude permission contract](https://code.claude.com/docs/en/permissions).

Both Claude and Codex receive Stop → `stop.sh`, PreToolUse → `fence.sh`,
and, for persistent roles, SessionStart → `start.sh`. Paths point to
`plugins/kiln/hooks/`; this step does not create those scripts. Claude loads
hooks via inline settings; Codex merges them into `<root>/.codex/hooks.json`,
preserving existing entries and avoiding duplicate Kiln entries. agy has no hooks.
The hook object follows the [Claude hook schema](https://code.claude.com/docs/en/hooks)
and [Codex hook schema](https://developers.openai.com/codex/config-reference/).
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

Live CLI acceptance, card injection, writes, resumes, and Codex hook trust
remain integration work for a fresh isolated workspace after step 3. No
trust bypass is emitted. Herdr describes `agent start` as interactive readiness;
agy's one-shot `-p` readiness needs that isolated acceptance check as well.
