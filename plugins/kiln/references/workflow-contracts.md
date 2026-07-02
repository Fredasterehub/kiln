# Kiln Workflow Contracts — per-stage args & discipline

The authoritative consumption contract for the autonomous workflow stages the conductor launches
(`research` · `architecture` · `build` · `validate`, plus the brainstorm-stage `vision.js` and
`gauge.js` legs). The conductor keeps the routing table in `skills/kiln-fire/SKILL.md`; the per-stage
arg semantics, the run-token recipe, the gate-only retry, and the browser/resource discipline live
here so the conductor body stays a thin control plane. **Read this before launching any autonomous
stage** — the routing-table row names the args, this file says what each one MEANS.

## Contents

- [The base launch pattern](#the-base-launch-pattern)
- [What the autonomous stages read: the compiled VISION](#what-the-autonomous-stages-read-the-compiled-vision)
- [Per-stage arg contracts](#per-stage-arg-contracts) — Brainstorm→VISION · Gauge · Research · Architecture · Build · Validate
- [The run token](#the-run-token)
- [Build failure routing — the gate-only retry](#build-failure-routing--the-gate-only-retry)
- [The workflow tree is a lore surface (don't duplicate it)](#the-workflow-tree-is-a-lore-surface-dont-duplicate-it)
- [Resource & visual-verification discipline](#resource--visual-verification-discipline)

## The base launch pattern

`Workflow({scriptPath: "$PLUGIN_ROOT/workflows/<stage>.js", args: {kilnDir: "<abs>/.kiln", projectPath: "<abs>", testingRigor, codexAvailable}})`.
Pass the absolute `$PLUGIN_ROOT`-resolved paths, the operator's `testing_rigor` from STATE, and
`codexAvailable` from the kiln-doctor probe (drives the Codex-vs-Sonnet paths). `build.js` honors
`testingRigor` (tdd/standard/minimal). The base pattern is a **launch convenience** — one shape for
every stage, and a workflow simply ignores base args it doesn't read; the per-stage notes below are
the authoritative consumption contract. Each stage adds the args it actually reads.

## What the autonomous stages read: the compiled VISION

The `VISION.md` that Gauge, Research, and Architecture read is the **v3 compiled + gated artifact**
`vision.js` produces from the brainstorm ledger — its YAML frontmatter (`tier`, `visual_direction`,
`counts`, `open_questions`) is the authoritative machine surface those stages key on (research reads
the frontmatter/section OQs; architecture threads `visual_direction`; the D-dims read the same VISION
whether the tier is `express` or a facilitated tier).

## Per-stage arg contracts

- **Brainstorm→VISION** (`vision.js`, launched from the Brainstorm handler) takes ONLY `kilnDir`,
  `projectPath`, and **`pluginRoot`** — `pluginRoot` is LOAD-BEARING here (it locates the `kiln-vision`
  gate CLI, this leg's floor and verdict; absence fails CLOSED with a named reason, never a gateless
  compile). It returns `{vision_valid, tier, counts, unresolved, visual_direction, …}`; you thread the
  returned **`visual_direction`** into the Architecture launch as `visualDirection` (below).
- **Gauge** takes `postureOverride`, `assessorModel`, `pluginRoot` (see the Gauge stage in the
  conductor). It is the source of the posture-derived args every downstream stage reads.
- **Research** also takes **`topicsMax`** = `posture.research_topics_max` (always a
  positive integer — the §3.2 cap `2 + D3 + D5`). Passing it is the signal that the Gauge ran and
  switches research to the §3.2 rule: topics come ONLY from high-priority before-build OQs, capped at
  `topicsMax`, with NO lower floor — so **zero qualifying OQs ⇒ zero topics ⇒ no research.md is
  written** and the stage returns `research_file: null`. **Omit it** (or pass nothing) and research.js
  runs the verbatim v2 behavior instead: OQs plus load-bearing unknowns, a floor of 2 and a cap of 5,
  so a run without a posture is unchanged (and always produces a research.md). Architecture tolerates
  either outcome (next bullet).
- **Architecture** also takes **`planning`** = `posture.planning`
  (`'dual'`/`'single+redteam'`/`'single'`) and **`validationRounds`** = `posture.plan_validation_rounds`.
  `planning` decides whether The Council (dual anonymized plans + divergence) runs: `'dual'` runs it,
  `'single'`/`'single+redteam'` take the lite single-plan path (the cross-family red-team critique
  `'single+redteam'` names is build-spine machinery scheduled for a later phase — BLUEPRINT §16 — so
  in this phase it routes like `'single'`). `validationRounds` is the number of Athena VALIDATION
  PASSES to run (BLUEPRINT §3.2 `plan_validation_rounds`, NOT a revision count): `1` ⇒ one pass / zero
  revisions, `3` ⇒ three passes / ≤2 revisions. **Omit both** and architecture.js falls back to its
  historical behavior (the foundation's `scope === 'trivial'` decides lite-vs-dual; 2 passes lite /
  3 passes full) — a run without a posture is unchanged. Architecture also reads **`lawModel`** and
  **`pluginRoot`**. `lawModel` is the §8 slot for Asimov the Lawgiver (compiles and revises the Law's
  checks; default `'opus'` — pass another slot per capability tier). `pluginRoot` is the same absolute
  `$PLUGIN_ROOT` from §0 — it locates the `kiln-law` CLI for the Law's dryrun and index/lock step;
  omit it and the lock degrades to `law_locked: false` with a recorded reason — never a silent
  proceed, never a stage crash. Architecture also takes an **optional `visualDirection`** — the boolean
  `vision.js` returned at brainstorm (the mechanical path r1 F6: a workflow cannot read a file
  in-script, so arg-threading is the only mechanical route). When you pass it, it **IS**
  `has_visual_direction` — the decline-byte check lives in the vision gate now, so architecture's
  foundation agent is NOT asked to re-judge it and design-token generation gates on your threaded value.
  **Omit it** (a pre-v3 VISION, a harness run, or a cross-session resume that starts at architecture
  without the brainstorm return in hand) and the foundation agent judges it from the VISION as the
  pre-v3 fallback — a run without the thread is unchanged. Architecture self-detects whether research.md
  exists (a cheap `ls` probe, the §4 self-validation discipline) and grounds in VISION.md directly when
  the §3.2 zero-topics route wrote none — it never points an agent at a phantom research file.
- **Build** also takes `milestoneLimit` (omit in production = all milestones), `uiBuild`,
  `pluginRoot`, and — exactly like Validate — the whole **`posture`** object and a **`runToken`**.
  **`uiBuild` defaults `false`** — set it `true` only for a genuinely pure-UI/static
  deliverable (no backend). `uiBuild===true` forces build.js's `surfaceOf()` to route *every*
  milestone to the UI builder, overriding each milestone's own `surface` tag, so a normal app left
  at `false` lets architecture's per-milestone `surface` route backend/logic milestones correctly.
  `pluginRoot` is the same absolute `$PLUGIN_ROOT` you resolved in §0 — a launched Workflow cannot
  see `${CLAUDE_PLUGIN_ROOT}` (it is unset there), so build.js workers need the resolved path passed
  in to Read plugin reference files by absolute path. Pass the **whole `posture` object**
  (`state.json.posture`) — build.js reads its Gauge dials (`review.ui_effort_base`,
  `min_slices_for_tribunal`, `browser.tier2_per_milestone`, and the validate-extras it carries
  downstream); omit it and the entire build stage drops to v2-equivalent defaults. **`runToken`** is
  conductor-minted per run (see [The run token](#the-run-token)) — build.js derives its `kbuild-…`
  browser-kill token from it; omit it and it falls back to a per-project hash that is NOT unique across
  runs. For the `gateOnly` retry arg, see [Build failure routing](#build-failure-routing--the-gate-only-retry).
- **Validate** also takes `designPresent`, `pluginRoot`, `posture`, and a **`runToken`** (same recipe
  as Build — see [The run token](#the-run-token); validate.js derives its `kval-…` browser-kill / lease
  token from it, with the same non-unique per-project hash fallback when omitted).
  `designPresent` is `true` if the architecture stage wrote a `design/` directory (a HINT only —
  validate.js self-detects `design/` from disk, so a wrong/absent hint never mis-routes the design
  QA leg). `pluginRoot` is the same absolute `$PLUGIN_ROOT` from §0 — LOAD-BEARING here: it locates
  the `kiln-law` CLI (the deterministic Law floor — fresh install, then `verify` + `run` FULL +
  `suite` as the real backstop) and `kiln-probe` (the Tier-2 scripted browser path + the token sweeps
  + the browser lease). Pass the **whole `posture` object** (`state.json.posture`) — validate.js reads
  its `validate.adversarial_pass` / `validate.second_family` dials (the D8=2 extras: a second
  adversarial traversal pass and a second cross-family goal-backward auditor); omit it and validate
  runs the floor without the extras. **Playwright MCP is NOT driven by autonomous validate** (an MCP
  server is a persistent browser service, which §7 forbids in-loop) — there is no `playwrightMcp` arg.
  The Tier-2 traversal uses the scripted, lease-gated, one-shot `kiln-probe` ORACLE only; if playwright
  is absent on disk the UI criteria degrade honestly to `PARTIAL_PASS_STATIC_ONLY` (verification_class
  recorded), never silently green. MCP stays a doctor-detected capability for the operator's
  INTERACTIVE/manual visual QA, named as the manual alternative in the emitted `visual_qa_checklist`.
  The **in-loop Tier-2 browser traversal is the v3 repeal of the v2 ban** — it runs INSIDE validate as
  one bounded, swept, lease-gated evaluator (the browser is a subprocess with a deadline, never a
  service); the out-of-loop `visual_qa_checklist` still ships as the optional operator re-check below.

## The run token

Build and Validate each derive their per-stage browser-kill token (`kbuild-…` / `kval-…`) from
`args.runToken`. Workflow scripts cannot mint one — `Date.now()`/`Math.random` are forbidden inside
them (the determinism guard that keeps resume reproducible), and the per-project hash fallback they
fall to is NOT unique across runs. So **cross-run uniqueness is the conductor's job, in the session,
where clocks are legal.** Mint ONE token per run, reuse it for every Build and Validate launch that
run, and keep it in the inert charset `[A-Za-z0-9._-]` (it becomes a `pkill -f` / `readdir` pattern).
Epoch seconds plus a short suffix is plenty — e.g. `1718200000-a1`. Mint a fresh one for a gate-only
retry (below) so its sweep can't collide with the starved run's leftovers.

Validate failures feed corrections back to Build while `correction_cycle < 3`, then escalate to the
operator. Use the matching transition lines from `brand.md` for each event.

## Build failure routing — the gate-only retry

When a build run returns `QA_FAIL` whose ONLY blocking finding is `goal-audit-failure` — or the gate
was visibly *starved* (session death mid-Judgment with the slices already built and committed) — do
not pay for a full re-run. The slicer cannot legally cut zero slices over a completed build, so a full
re-run churns through builder/confirm work it doesn't need. Instead relaunch build with
`{gateOnly: true, …same args, fresh runToken}`: it skips Scoring the Cut and Forging entirely and
re-runs only the §3.2 milestone gate (Law verify + full run + the tribunal) over the finished build.
`gateOnly` REFUSES on a red Law (`gate-only-on-red`) — it re-runs a starved gate, it never skips
building. Any other `QA_FAIL` (real red checks, failed flips) is a genuine build failure: route it back
through the correction loop above, not gate-only.

## The workflow tree is a lore surface (don't duplicate it)

Each autonomous workflow renders its OWN lore in the `/workflows` progress tree: lore-flavored phase
titles (build's *The Forge Heats · Scoring the Cut · Forging · The Trial · Judgment*; research's *The
Briefing · Field Work · The Debrief*; architecture's *Laying Stone · The Council · The Lantern · One From
Many · Athena Weighs*; validate's *Measuring Drift · A Hundred Eyes · The Critique*), persona/duo agent
labels (`clair:build:M2:s1`, `sphinx:review:…`, `judge-dredd:verdict:M3`), and spinner-verb log lines. So
per stage the conductor's job is the ONE transition line + the ONE Tier-1 banner — let the tree carry the
per-agent theater; do **not** re-narrate worker progress in the conductor session (it would duplicate the
tree and bloat the session). The build duo names come from `data/duo-pool.json` if you want to name them
in the build transition.

## Resource & visual-verification discipline

*(load-bearing — a leaked browser OOM'd the box once)*

- **The browser is a subprocess with a deadline, never a service (BLUEPRINT §7).** The v2 blanket
  ban is repealed, but the discipline is absolute: no browser process may outlive the check that
  spawned it; every spawn carries a unique kill token; pre/post **token-scoped** sweeps bracket every
  stage that can spawn one (blanket `pkill -f chrome` stays forbidden — it would reap the operator's
  own browser). The leaks that OOM'd the box all require a long-lived holder process; one-shot
  launch→assert→close probes under a hard `timeout` cannot reproduce them.
- **Builders and reviewers NEVER drive a browser themselves.** UI verification is mediated by the
  bounded `kiln-probe` / `kiln-law run` subprocesses (build's Tier-1 per-slice probes) and by
  validate's single Tier-2 evaluator — agents read EVIDENCE files (screenshot + console/net/axe logs
  + exit code), they do not open Chromium. Static checks (read the code; parse HTML; `node --check`)
  still carry the per-slice review; the probe is the executable oracle beside them.
- **The Tier-2 live traversal lives INSIDE validate** (and, posture-gated, per ui milestone in
  build) — ONE fresh cross-family evaluator whose ≤10-minute cap is enforced on the **CAPABILITY**, not
  on an un-cancelable agent: before the traversal the workflow takes a `kiln-probe` browser LEASE
  (token `kval-…`, the traversal budget in seconds, a detached self-terminating watchdog that sweeps +
  deletes the lease at expiry), and every scripted probe carries `--lease <token>` so it REFUSES (exit
  77 LEASE_EXPIRED) once the lease expires. An evaluator alive past the deadline can do no further
  browser work. A `withDeadline` timer is the belt to that — it stops the workflow AWAITING a wedged
  evaluator (folds the pass static-only) — and the stage finally RELEASES the lease (kill watchdog +
  immediate token sweep). The scripted one-shot `kiln-probe` is the BOUNDED ORACLE (each criterion =
  one launch→assert→close process, hard-killed at 90s, swept by the `kval-…` token) and is the ONLY
  browser path autonomous validate takes — **Playwright MCP is NOT driven in-loop** (an MCP server is a
  persistent browser service §7 forbids inside the loop); it stays a doctor-detected capability for the
  operator's INTERACTIVE/manual visual QA (named in the `visual_qa_checklist`). No scripted oracle on
  disk ⇒ honest degradation to `PARTIAL_PASS_STATIC_ONLY` (verification_class recorded), never silently green.
- **The out-of-loop one-shot pass still ships as an OPTIONAL operator re-check.** `validate.js`
  emits a `visual_qa_checklist` (serve over http — never `file://`; exercise every wired interaction;
  traverse empty/loading/error/success states; capture console errors; axe-core a11y; ≥2 viewports;
  scroll-and-capture each scroll-reveal section) — run THAT as an independent human re-check when
  wanted, then tear down. It complements the in-loop Tier-2 traversal; it no longer substitutes for it.
- **Right-size the build to the deliverable.** Architecture must not over-decompose: a one-page site
  is ONE milestone; reserve many milestones only for genuinely independent components. The UI path
  (`uiBuild`) handles anything from a one-pager to a full frontend — the milestone *count* scales with
  real scope, not ceremony.
