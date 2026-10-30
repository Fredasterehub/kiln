# Kiln-Lite B2

Python 3.11+ and Git; Python standard library only. No Kiln 4 imports.
Load locally with `claude --plugin-dir plugins/kiln-lite`, then invoke
`/kiln-lite`. The session dispatches the five lore-named runners; workers
run only through `kl call`. See [lore](docs/lore.md) for the names.

```sh
kl start demo --brief /path/brief.md --project /path/project
kl dispatch algalon --agent-id AGENT_ID --packet /path/research-packet.md
kl call researcher_gpt /path/research-packet.md
kl ask "Use the local target?"
kl answer q1 "Use the local target from the brief."
kl gate --cwd /run/home/wt --cmd "python3 -m unittest" --cmd "git diff --check"
kl accept milestone M1 --artifact /run/home/build/build.md
kl council /path/question.md --lens conceptual
kl status
kl follow
```

Every command after `start` accepts `--run HOME`. `KILN_LITE_RUN` also selects
a run. Otherwise discovery walks up from cwd: a run home wins, then the project
`.kiln-lite-run` pointer. A stale pointer falls back to a unique active cached project match.
`start` writes that pointer and excludes it through Git's `info/exclude`.
`follow` prints `Lore Keepah: <slug>`, then one headline per ledger row, and exits.

`ask` allocates `q<N>` under the ledger lock. `answer` accepts `q1` or `#q1`
and requires an existing ID.
`dispatch` records runner, agent ID and optional packet path; an acceptance
retires the corresponding runner in the generated view. A resumed successful
call clears the preceding unfinished call for that resume ID. All original
receipts remain in the ledger. A later done call of the same role also clears
a failed or rejected call from the view. Each live runner shows its own last
call, and Phase names the next phase after the last acceptance. `run.md` shows at most four entries per section
and stays within 60 lines; the full ledger remains available with `status --json`.

Acceptance checks Markdown structure and receipts, not the truth of prose.
Use the brief template's headings (descriptive suffixes are supported).
Research requires its report and nonempty `research/sources.md`. The architect
card gives the plan skeleton: `## Capabilities`, one `###` section per capability
with a `Done-when` line (colon optional); `## External facts` with evidence on
each fact bullet; `## Seams`; `## First end-to-end path`; `## Size estimate`.
Heading suffixes are allowed. Prose in External facts is ignored; `none` cannot
serve as a fact's evidence. `plan/decisions.md` requires `## Decisions` and a
`###` section per decision with Reason and Dropped lines. The council ruling
must exist, and the newest fresh-builder read must be done after the newest
architect call. Its card permits done only when buildable without defects.
Milestones require the latest gate green on the current fingerprint, an exact
milestone entry in `build/build.md` (`M1` differs from `M10`), and the last line
`Open blocking: none` in each report belonging to that milestone. Reports state
`Milestone: <name>`; older reports can be mapped by chunk ID in the build entry.
Build delivery requires `## Built scope`, `## Deferred`, `## Trial`, `## Branch`.
Verify requires one line per brief Done-when in the shape
`- <Done-when text verbatim> | pass|fail|deferred | evidence: <command → output>`.
Failures return to build; deferred evidence must mention deploy. Deploy requires
`## Where it runs`, `## How it was started`, `## How to stop`, `## How to roll back`,
`## Evidence`. All required sections must have content. Acceptance artifacts
must resolve inside the run home, including symlink targets. Refusals exit 1
and append no acceptance row; deploy acceptance removes the project pointer
when it still selects this run.

Gate commands run in order, including those after a failed command; stdout,
stderr and each return code go to `build/gates/<n>.log`. The gate row records
all commands, return codes, HEAD separately, and the resulting tree fingerprint.
Fingerprints cover tracked content and non-ignored untracked content, including
file types and executable bits. Staging or committing unchanged bytes preserves
the fingerprint; product edits require another green gate.

Councils use the current lane's conceptual.N or operational.N routes. Override
one model per configured seat with `--models a,b`; `--no-argon` disables the
advisor. Without a `## Public` section the advisor is skipped with a note.
Only that section's content is sent to the advisor. `kl council QUESTION --lens
conceptual` runs the blind round in parallel and prints its folder. The asker
runs `kl council --exchange FOLDER` for the one exchange round: each expert is
resumed once with the other experts' full answers and asked to keep, revise or
withdraw with evidence. Advisor failure is nonfatal; questions remain questions.
Folders use `council/<name>` from `--name`, otherwise the first question heading
slug (or filename stem if no heading); repeats get numbered folders. `result.md`
starts with recommendations side by side, then retains full attributed answers,
exchange changes, questions and failures. Expert failures return exit 1. The
asker writes the ruling; the script never blends answers or writes a ruling.

Role names accept hyphens or underscores. `researcher`, `reviewer`, `verifier`
and `council_expert` resolve to researcher_gpt, review_of_gpt, verifier_claude
and conceptual.0. Model overrides select a CLI family by model ID prefix.
Relative packet, question and artifact paths use cwd when present, otherwise
the run home. Workers receive their absolute result path and product cwd in the packet.
Resume looks up the newest earlier receipt containing the ID and reuses its
recorded launch directory; an unknown ID is refused before launching.
Default read-only calls launch from their call folders except reviewers, which
launch in the product worktree. Explicit product directories remain supported;
Agy always launches from the call folder. Claude gets `--add-dir <run home>`.
Receipts distinguish launch and product cwd; council `cwd` is the call folder.
`--read-only` detects fingerprint changes but does not prevent or undo them.
A worker's `result.md` is preserved. Only a successful CLI completion with a
nonempty final message can supply a missing result from `final.md`.
`meta.json` retains requested versus observed model identity, reported usage,
CLI session IDs, wall time and reported cost; unreported values remain null.
Timeouts terminate only the launched process group. No fallback is attempted.

PreToolUse denies Write/Edit/NotebookEdit for absolute paths resolving inside
this run's `wt/`, for both session and subagents. Shell writes are not parsed.
SessionStart injects `kl status` on startup/resume/compact. In a mode other than
`bypassPermissions`, context starts with the stop-before-start instruction,
even without an active run; bypass mode without a run produces no output.
Plugin layout and hook paths follow the [official reference](https://code.claude.com/docs/en/plugins-reference)
(checked 2026-10-30 against installed Claude Code 2.1.314).

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s plugins/kiln-lite/tests
claude plugin validate plugins/kiln-lite
```
