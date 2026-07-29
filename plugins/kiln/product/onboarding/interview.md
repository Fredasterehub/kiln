---
purpose: The scripted settings interview onboarding runs before any other phase starts.
runs_in: Maestro's top-level session only.
---

# The settings interview

## Execution constraint — read this before anything else

`AskUserQuestion` exists only in the top-level session. No subagent, worker, or
delegated task can call it — the interview runs in the main skill context,
never a subagent, settled by ruling in the dev record. `agents/maestro.md`'s
Do/route boundary otherwise sends anything that touches disk or costs more
than a handful of tool calls to a worker; this file is the deliberate
exception. **Maestro executes every step below directly, in its own turn. No
step here is delegated.**

One fire per project at a time — never two Kiln sessions on the same folder.
Step 5 writes a whole clamped settings object; two sessions racing the same
`.kiln/settings.json` would each write over the other's answers, and nothing
on disk would tell you which set of answers survived.

Never read or quote secret material — .env files, *.pem, *.key,
credentials.json, secrets.* — their contents belong in no transcript,
envelope, or record.

## What this script owns, and what it doesn't

This is the settings-interview portion of the door: the preset panel, the knob
panels, the telemetry/blocking/plan-review questions, and the recap. It is not
the whole onboarding phase. Preflight (Node, Codex, Workflow tool,
agent-teams, git) is `product/onboarding/preflight.md`'s job and runs
immediately after `machine/src/scaffold.js` has built the tree, strictly
before this script's first question (`product/onboarding/preflight.md`
§"Ordering"). By the time this script starts, `state.json.preflight.mode`
already holds `"full-cross-family"` or `"degraded-claude-only"` — Panel 3
takes that field as given and never re-checks Codex itself.

## Single source of truth for knob copy — read this before rendering any panel

Every knob's question text, option meaning, and cost line come from
`machine/settings-schema.json` at the moment this script runs — **never**
copied into this document as static prose. That file is loaded with
`loadProductSchema(file)` (`machine/src/settings.js:115-124`), which throws
if it is missing or malformed rather than defaulting silently. This keeps
exactly one place where a knob's wording and dollar-placeholder tokens live —
one native mechanism per constraint, never two: a future dogfood calibration
pass that replaces a `$PLACEHOLDER-*` token with a measured number updates the
interview automatically, with no edit to this file.

### Rendering one knob panel

For a flat knob (`facilitator`, `research_width`, `planning`, `reviews`,
`checkpoints`, `telemetry_consent`, `blocking_preference`, `plan_review`):

1. **Question text** = `knobs.<key>.description`, verbatim.
2. **Options** = one per entry in `knobs.<key>.enum`, in the array's own
   order. The default option (`knobs.<key>.default`) gets the ▶ marker.
3. **Option label** = the enum value rendered in plain language per the
   Label lookup table below — never the raw token (`opus-5`, `x3`,
   `auto_remedy`, ...) shown to the operator.
4. **Option cost line** = derived from `knobs.<key>.cost_note`, by an
   **explicit allowlist, never an automatic pattern-detection rule** — a
   "split on `; ` when the clause count matches `enum.length`" heuristic
   was tried while writing this document and rejected: it misfires on
   `checkpoints`, whose cost_note ("No direct cost difference between the
   two options; both run the same verification floor.") happens to split
   into exactly 2 clauses for its exactly-2 options without either clause
   actually being option-specific — clause count matching option count is
   not evidence the split is meaningful. Use this instead:
   - **`facilitator`, `research_width`, `planning`, `reviews`** — these four
     `cost_note`s were hand-verified (see this document's self-check) to be
     written one clause per enum value, in enum order, each clause starting
     with that option's own label. Split on `; `, clause *i* (trailing
     period trimmed) is option *i*'s cost line.
   - **Every other knob** (`checkpoints`, `telemetry_consent`,
     `blocking_preference`, `plan_review`) — show the **whole** `cost_note`
     identically under every option of that question. None of these currently
     have a cost differential between their options, so this is accurate,
     never merely a fallback.
   - If a future schema edit adds a cost-differentiated option to a knob not
     on the four-item list above, that edit must also update this allowlist
     — do not re-introduce an automatic clause-count heuristic to avoid the
     edit; it is exactly what produced the `checkpoints` false-positive.

The nested `budget` knob (`knobs.budget.properties.*`) is rendered nowhere: no
panel asks for it. Its schema entries stay put as reserved defaults, and this
procedure never reaches them.

### Label lookup (enum token → operator-facing label)

| Token | Label | | Token | Label |
|---|---|---|---|---|
| `opus-5` | Opus 5 | | `x5` | Maximum ×5 |
| `fable-5` | Fable 5 | | `milestone_pauses` | Milestone pauses |
| `standard` | Standard | | `autonomous` | Autonomous |
| `deep_scrutiny` | Deep scrutiny | | `auto_remedy` | Auto-remedy |
| `maximal_confrontation` | Maximal confrontation | | `advise_me` | Advise me first |
| `floor` | Standard (floor) | | `auto_proceed` | Auto-proceed |
| `x3` | Reinforced ×3 | | `review` | Review the plan first |
| `2` / `3` / `5` (research_width) | "2 workers" / "3 workers" / "5 workers" | | | |

## Step 0 — re-run check (skip the interview entirely if it already ran)

Read the settings currently on disk with `settings.js read <treeRoot>` — Maestro's own call, invocation form in `agents/maestro.md`'s Bash law point 8, which is where every runtime command this document names is written out (this file is plugin payload, so a command stored here would reach Bash with its plugin-root prefix unresolved).
`machine/src/scaffold.js` writes this file as `{}` at tree genesis (see its
"settings.json — onboarding genesis" comment, `machine/src/scaffold.js:130-137`)
— so **file existence alone never means the interview ran**; an empty object
is what a fresh tree always has. The actual skip condition: **the object is
non-empty and has a `facilitator` key** (any one schema-owned knob key
proves a completed run, since Step 5 below always writes the full clamped
object; `facilitator` is picked as the marker because it is first in
schema order).

- Present → the interview already completed. Ask nothing. Regenerate
  `.kiln/views/settings-recap.md` from the settings currently on
  disk (Step 6) and stop. A re-run skips the interview entirely — zero
  questions on a second pass, ruled in the dev record. Your answers were
  already given; I do not ask twice.
- Absent (including the empty `{}` genesis case) → proceed to Step 1.

## Step 1 — Panel 1: the preset question (always asked first)

One `AskUserQuestion` call, one question, four options — the happy path is one
question, and this is that question.

The preset **mechanics** (which knob values each preset sets) come from
`machine/settings-schema.json`'s `presets` object — `custom` is `{}` (pure
schema defaults; the operator is walked through every knob instead of
accepting the defaults silently), `balanced`, `budget_solo`, and `max_rigor`
are named partial overrides (`machine/settings-schema.json:99-118`) —
execution-proven against `applySchema` in the dev record. Those preset objects
still carry `budget` values, and no step here asks about them: no panel offers
a ceiling, no recap row shows one, and nothing downstream meters spend today.
They are reserved schema defaults awaiting a metered rewire — never a cap I
claim to enforce. `telemetry_consent`, `blocking_preference`, and
`plan_review` are asked identically regardless of preset, in Step 4.

The **framing copy** below (what the operator reads to choose a preset) is
not schema-owned — no preset-level `description`/`cost_note` exists in
`machine/settings-schema.json` (only individual knobs carry one). It stays at
the one-line, intent-shaped framing below and quotes no dollar figure: the
ceiling numbers sitting in the preset objects are rough estimates awaiting
dogfood measurement, and I do not hand you an unmeasured number dressed as a
price. The recap (Step 6) shows what each knob was actually set to, read back
from disk after clamping.

| Header: `Preset` | |
|---|---|
| **Question** | "Pick a build. Every preset can be inspected and overridden — Custom walks you through each choice." |
| ▶ **Balanced** | My defaults, unchanged: 3 researchers, standard planning, the full verification floor, and a pause at each milestone. |
| **Budget Solo** | The leanest seats I will run: 2 researchers, standard planning — verification stays at the floor, which never shrinks. |
| **Max Rigor** | Heavyweight facilitation, widest research, maximal confrontation in planning, maximum ×5 reviews — and no milestone pauses, so it will not stop to ask you anything until it is done. |
| **Custom** | Two more panels: you set each knob yourself instead of taking my defaults. |

### If the operator picked Balanced, Budget Solo, or Max Rigor

Apply `machine/settings-schema.json`'s matching `presets.<name>` object via
`applySchema(presets.<name>, knobs)` (Step 5), then skip straight to Step 4.

### If the operator picked Custom

Continue to Step 2.

## Step 2 — Panel 2 (Custom only): Facilitator, Research, Planning, Reviews

One `AskUserQuestion` call, four questions — the panel law's own shape,
4 questions × 4 options max, batched into one call rather than four separate
stops: `facilitator`, `research_width`, `planning`, `reviews`, rendered per
the procedure above from `machine/settings-schema.json:4-27`.

`planning`'s third enum value, `maximal_confrontation`, is settled doctrine in
the dev record — it is present in the schema
(`machine/settings-schema.json:18`), so this document renders it, never
re-argues it.

`reviews`'s `floor` value is the verification-never-scales-down minimum
(schema description, `machine/settings-schema.json:25`) — `applySchema`
has no branch that can resolve `reviews` below it: the clamp is
unconditional in the function, and every input tried in the dev record
landed at or above the floor.

## Step 3 — Panel 3 (Custom only): Checkpoints

Panel 3's exact question/option/header/default shape is mechanically derived
from `machine/settings-schema.json` by `machine/src/interview-panels.js`'s
`buildPanel3(knobs, mode)` — call it (`mode` = `state.json.preflight.mode`)
and render its `questions` array verbatim rather than hand-deriving option
lists; the module throws if the 4x4 contract (1-4 questions, 2-4 options
each, ≤12-char headers, exactly one default per question) is ever violated,
so a future schema edit that breaks the contract fails loudly instead of
shipping a bad panel — the shape both modes produce is execution-proven in
the dev record. This section restates that output in prose for a reader not
running the module:

- **`Checkpoints`** — one option per `knobs.checkpoints.enum` entry
  (`machine/settings-schema.json:28-33`), labels from the Label lookup table
  above, default marked.

That is the whole panel: one question, in both modes. The budget family — both
ceilings and the cost report — is off the operator surface, because nothing
downstream consumes it: no host primitive reports session spend, so asking you
for a ceiling would promise a readout that never renders. The schema keys stay
as reserved internal defaults until the metered rewire lands. `mode` is still
passed for call parity, and `buildPanel3` still refuses any value that is not
`"full-cross-family"` or `"degraded-claude-only"`.

## Step 4 — always-asked panel: Telemetry, Blocking, Plan review, Floor lock

One `AskUserQuestion` call, four questions — the panel law's exact max — run
identically on every path — after Step 1 for a preset pick, after Step 3 for
Custom — and always before the recap. These four never appear in any
preset's override object (`machine/settings-schema.json:99-114`): plan review
and blocking preference sit outside the tunable knob set and are asked of you
whichever preset you took, and telemetry is always asked separately, never
folded into a preset. Floor lock is the fourth, added by operator ruling
2026-07-28 [seq 48] — the sovereignty escape hatch, asked here directly and
never offered as its own menu-visible tier.

| Header: `Telemetry` | |
|---|---|
| **Question** | (from schema) `knobs.telemetry_consent.description`, `machine/settings-schema.json:64`. |
| ▶ **No** | Nothing is recorded. This is asked once; changing it later means hand-editing `telemetry_consent` in `.kiln/settings.json`, which `applySchema` clamps like any other read. |
| **Yes** | Anonymous build stats, local only, saved as plain files under `.kiln/usage/` (`machine/src/telemetry.js`'s `recordEvent`/`status`/`purge`). Never your code, never your prompt text — and never off this machine. `.kiln/usage/` is plain files in your own project — read them, or delete the folder; nothing reconstructs it. |

The ruled consent text lives at `machine/settings-schema.json`'s
`telemetry_consent.description` and is rendered from there like every other
knob — this document quotes no consent copy, so the two can never drift.
Consent copy is quoted from the schema, never improvised and never
paraphrased. Sets `telemetry_consent` (schema default `false`,
`machine/settings-schema.json:62`).

| Header: `Blocking` | |
|---|---|
| **Question** | (from schema) `knobs.blocking_preference.description`, `machine/settings-schema.json:70`. |
| ▶ **Auto-remedy** | I try the fix myself first — the two model families work it out between them — and bring it to you only when it does not hold. |
| **Advise me first** | I stop at every blocker and ask before I touch a remedy. |

Sets `blocking_preference` (schema default `auto_remedy`).

| Header: `Plan review` | |
|---|---|
| **Question** | (from schema) `knobs.plan_review.description`, `machine/settings-schema.json:76`. |
| ▶ **Auto-proceed** | Planning gives way to building the moment the plan is ready — the Law locks without stopping for your word. |
| **Review the plan first** | I hold at the plan gate. You read the plan; the Law locks on your word, never before. |

Sets `plan_review` (schema default `auto_proceed`).

| Header: `Floor lock` | |
|---|---|
| **Question** | (from schema) `knobs.floor_lock.description`, `machine/settings-schema.json:84` — operator-approved copy, rendered from the schema verbatim, never paraphrased and never copied here, so the ruled text and this document can never drift. |
| ▶ **No — floor stays absolute (recommended)** | The floor cannot be moved in this install, by anyone — the override key is never deployed, not merely set to false. |
| **Yes — deploy the hand-editable override** | A documented config key exists and works, and every run that uses it prints a loud warning. For operators who tune my own machinery. |

Sets `floor_lock` (schema default `true`; the ▶ **No** answer maps to
`true`, **Yes** maps to `false`). This is the only place in the whole
product `floor_lock` can ever be set to `false`: `machine/src/settings.js`'s
`applySchema` clamps any other attempt — a hand-edited `settings.json`, a
`write()` call from anywhere but this step — back to `true` and reports it
(`rule: 'source-locked'`), because Step 5's write call below is the sole
caller that carries this interview's own provenance marker. Answering
**Yes** here only unlocks the *capability*; it does not itself turn
`override_verification_floor` on — that remains at its own schema default
(`false`) until an operator hand-edits it afterward, at which point every
run using it prints the loud warning `knobs.override_verification_floor`'s
own `warn_message` names (`machine/settings-schema.json:93`), through the
same clamps-reporting channel, never a second one.

## Step 5 — persist to `.kiln/settings.json`

Do not write the operator's raw picks straight to disk, and do not run them
through `applySchema`/`writeAtomic` by hand — `machine/src/settings.js`'s own
`write` CLI is the sole validation path, so there is exactly one place that
enforces defaults and bounds — never two (one native mechanism per
constraint; `agents/maestro.md`'s Bash law point 8 and
`product/onboarding/flow.md`'s own step (c) name this exact call as Maestro's
sole-caller call once the interview closes — never a second validation path,
`settings.js`'s own `write` command is the only place its floor-clamping
runs):

1. Build a plain picks object from Steps 1–4's answers, keyed exactly as
   `knobs`' top-level keys (`facilitator`, `research_width`, `planning`,
   `reviews`, `checkpoints`, `telemetry_consent`, `blocking_preference`,
   `plan_review`, `floor_lock`) — and nothing else. `budget` never enters the
   picks object: no step asks for it, and I do not guess a ceiling on your
   behalf; `applySchema` resolves it from the preset, or from the schema
   default, without me. Never include `override_verification_floor` here — this
   interview never asks for it (Step 4's Floor lock question sets only
   `floor_lock`); leave it out of the picks object entirely and let
   `applySchema` resolve it (undeployed while `floor_lock` is `true`,
   defaulted to `false` once it's `false`).
2. Read the current file with `readJson('.kiln/settings.json', {})`
   (`machine/src/atomic-json.js:40-56`) so a pre-existing bookkeeping key is
   not lost — `applySchema` writes no key outside `knobs` (the function has
   no branch that does), and every input tried in the dev record left every
   other key untouched.
3. Merge the picks over that object, and add one bookkeeping key outside the
   schema, `preset`, set to the raw Q0 answer (`'balanced' | 'budget_solo' |
   'max_rigor' | 'custom'`) — not a schema knob, preserved as an unknown
   key, and exists solely so Step 0's re-run check and Step 6's recap can
   say "Custom, tuned by hand" apart from "Balanced, as-is."
4. Pass the merged object as this call's sole JSON-string argument:
   ```
   settings.js write <treeRoot> '<json>' --source interview      (form: agents/maestro.md, Bash law point 8)
   ```
   `write` loads `machine/settings-schema.json` itself
   (`settings.js`'s own `DEFAULT_SCHEMA_PATH`, `__dirname`-anchored — never a
   path this document or its caller supplies) and runs the merged object
   through `applySchema` — the exact function `loadSettings` runs on every
   future read (`machine/src/settings.js:172-184`), so a value this
   interview writes and a value an operator hand-edits later are clamped
   identically **except** for provenance: `--source interview` is what this
   call alone is entitled to pass, and it is the only thing in this whole
   product that lets a `floor_lock: false` pick actually land rather than
   being clamped back to `true` (`machine/src/settings.js`'s
   `interview_only` handling, operator ruling 2026-07-28 [seq 48]) — every
   other caller, including a plain hand-edit of `settings.json` read back on
   a later run, gets the fail-closed `'hand-edit'` default instead. This is
   also where `budget`'s nested clamping happens automatically
   (`machine/src/settings.js:47-58`): a wrong-typed `budget` value resets to
   the full nested default object, a wrong-typed sub-property resets to
   `null`, an explicit `null` on a `nullable: true` sub-property passes
   through untouched (`machine/src/settings.js:95-100`) — then atomic-writes
   the clamped result to `<treeRoot>/settings.json` and prints it back; read
   that printed document as the final word, since clamping can change
   values.

`.kiln/settings.json` is the persistence target — **not**
`.claude/<skill-name>.local.md`, which an earlier design proposed before the
system-of-record decision superseded it. That swap is a named trap in the dev
record: two homes for one truth, and neither one authoritative.

## Step 6 — the recap

Render a markdown table from the settings now on disk (never from the raw
interview answers — always re-read the clamped result, so the recap can
never show a value `applySchema` actually rejected) and write it to
`.kiln/views/settings-recap.md` via plain file write. Treat this as a
disposable, regenerable projection of `settings.json` — never a second source
of truth, the same doctrine the operator resume view lives under —
**flagged in this document's self-check**: no tree diagram in the design
record enumerates a `views/` directory anywhere.

```
# Your build

| Setting | Your pick | What it means | Cost |
|---|---|---|---|
| Preset | <preset marker> | | |
| Facilitator | <label> | <knobs.facilitator.description> | <matching cost_note clause> |
| Research | <N> workers | <knobs.research_width.description> | <matching cost_note clause> |
| Planning | <label> | <knobs.planning.description> | <matching cost_note clause> |
| Reviews | <label> | <knobs.reviews.description> | <matching cost_note clause> |
| Checkpoints | <label> | <knobs.checkpoints.description> | <knobs.checkpoints.cost_note> |
| Telemetry | <on/off> | | |
| Blocking | <label> | <knobs.blocking_preference.description> | |
| Plan review | <label> | <knobs.plan_review.description> | |
| Floor lock | <Locked | Unlocked> | <knobs.floor_lock.description> | |
```

"Floor lock"'s pick renders `settings.floor_lock` as **Locked** (`true`,
the recommended default) or **Unlocked** (`false`) — never the raw
`true`/`false` token, matching every other boolean row's label convention.
`override_verification_floor` gets no row of its own here: this interview
never asks for it directly, and at the moment this recap is first rendered
it is either undeployed (still locked) or sitting at its own schema default
(`false`, just unlocked) — nothing yet worth a dedicated line. A later
re-render of this same recap (regenerated from whatever's on disk, per this
step's own "disposable projection" doctrine above) would show it the same
way any other on-disk value shows, if this document is ever extended to do
so. The `budget` keys get no row either: nothing asked you for them and
nothing meters spend, so a ceiling line here would report a limit I do not
enforce. They earn a row when the metered rewire lands — never before.

Every "What it means" and "Cost" cell is read live from
`machine/settings-schema.json` at recap-render time, per the rendering
procedure above — never re-worded, so the recap and the question the
operator answered always say the same thing, and a future dogfood edit to
the schema updates old recaps' *wording* the next time they're regenerated
without touching this document.

## Step 7 — ledger event

Record completion through the closed-contract writer for this record kind —
`kind-registry.js append onboarding-decision <treeRoot>`, Maestro's own call
(form: `agents/maestro.md`, Bash law point 8) — with this object piped via
stdin:

```
{
  "kind": "decision",
  "payload": { "event": "settings_interview_completed", "preset": "<preset>", "telemetry_consent": <bool> },
  "correlation_id": null
}
```

That command accepts `kind: "decision"` against `ledger.jsonl` and refuses
every other kind or target, so this closing event cannot become a general-
purpose ledger append (`product/doctrine.md`'s stream/kind ownership table).

This closes the onboarding phase's `settings.json` exit-emit
(`machine/phases-registry.json:12`, onboarding phase `exit_emits`) with a
ledger record `machine/src/check-honesty.js` and a future
`phases.js#advance()` call can both point to.

## Settings key reference

The canonical schema is `machine/settings-schema.json` — this table is a
convenience index into it, not a second definition. Values, defaults, and
enums below are read directly off that file (line references as of this
writing; re-read the file if it has since changed rather than trusting this
table blind).

| Key | Rule (schema line) | Notes |
|---|---|---|
| `facilitator` | enum `['opus-5','fable-5']`, default `'opus-5'` (`machine/settings-schema.json:4-9`) | |
| `research_width` | enum `[2,3,5]`, default `3` (`machine/settings-schema.json:10-15`) | |
| `planning` | enum `['standard','deep_scrutiny','maximal_confrontation']`, default `'standard'` (`machine/settings-schema.json:16-21`) | |
| `reviews` | enum `['floor','x3','x5']`, default `'floor'` (`machine/settings-schema.json:22-27`) | `'floor'` is the verification-never-scales-down minimum — `applySchema` cannot resolve below it |
| `checkpoints` | enum `['milestone_pauses','autonomous']`, default `'milestone_pauses'` (`machine/settings-schema.json:28-33`) | The one question Panel 3 asks |
| `budget.claude_ceiling_usd` | `nullable: true, floor: 0`, default `null` (`machine/settings-schema.json:39-45`) | `null` = no ceiling, a first-class value (`machine/src/settings.js:95-100`), never an error state. Reserved: no panel asks for it, and no ceiling is enforced today |
| `budget.codex_ceiling_usd` | `nullable: true, floor: 0`, default `null` (`machine/settings-schema.json:46-52`) | Reserved on the same terms as the Claude ceiling; never exercised by the pipeline, and never exercised at all in degraded-Claude-only mode |
| `budget.budget_report` | enum `[true,false]`, default `false` (`machine/settings-schema.json:53-58`) | Reserved: never asked, and no cost readout renders today |
| `telemetry_consent` | enum `[true,false]`, default `false` (`machine/settings-schema.json:61-66`) | Opt-in — off unless you say yes, asked in Step 4 |
| `blocking_preference` | enum `['auto_remedy','advise_me']`, default `'auto_remedy'` (`machine/settings-schema.json:67-72`) | Asked on every path, in Step 4; no preset overrides it |
| `plan_review` | enum `['auto_proceed','review']`, default `'auto_proceed'` (`machine/settings-schema.json:73-78`) | Asked on every path, in Step 4; no preset overrides it |
| `floor_lock` | enum `[true,false]`, default `true`, `interview_only: true` (`machine/settings-schema.json:79-86`) | Only this interview's write call (Step 5, `{ source: 'interview' }`) can set it `false`; every other caller is clamped back to `true` (operator ruling 2026-07-28 [seq 48]) |
| `override_verification_floor` | enum `[true,false]`, default `false`, `locked_by: 'floor_lock'` (`machine/settings-schema.json:87-96`) | Not deployed at all while `floor_lock` is `true` — absent from `settings.json`, not merely `false`; never asked by this interview directly, only enabled for hand-editing once `floor_lock` is `false` |
| `preset` | not schema-owned; bookkeeping only | Set by this interview (Step 5.5), preserved by `applySchema` as an unknown key |

All other keys already present in `settings.json` (internal seat overrides,
routing tweaks written by something other than this interview) are
preserved byte-for-byte — `applySchema` writes no key outside `knobs`, and
every input tried in the dev record left every other key byte-identical. This
interview never invents or deletes a key it doesn't own.
