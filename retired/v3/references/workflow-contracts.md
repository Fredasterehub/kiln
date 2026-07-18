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

**Launch cadence.** A stage's CLEAN completion auto-advances the run — the conductor launches the
next stage in the same turn (see *The story telegraph* / unattended chaining in the conductor), bounded
by the hard stops: the `plan_approval: gated` checkpoint, the `correction_cycle >= 3` escalation, any
blocked / degraded / law-unlocked return, and any operator interrupt.

## What the autonomous stages read: the compiled VISION

The `VISION.md` that Gauge, Research, and Architecture read is the **v3 compiled + gated artifact**
`vision.js` produces from the brainstorm ledger — its YAML frontmatter (`tier`, `visual_direction`,
`counts`, `open_questions`) is the authoritative machine surface those stages key on (research reads
the frontmatter/section OQs; architecture threads `visual_direction`; the D-dims read the same VISION
whether the tier is `express` or a facilitated tier).

## Per-stage arg contracts

- **Brainstorm→VISION** (`vision.js`, launched from the Brainstorm handler) takes `kilnDir`,
  `projectPath`, and **`pluginRoot`** — `pluginRoot` is LOAD-BEARING here (it locates the `kiln-vision`
  gate CLI, this leg's floor and verdict; absence fails CLOSED with a named reason, never a gateless
  compile). It returns `{vision_valid, tier, counts, unresolved, visual_direction, …}`; you thread the
  returned **`visual_direction`** into the Architecture launch as `visualDirection` (below). It also
  takes a **`runToken`** and a **`capabilityTier`** (`T1`|`T2`|`T3`|`T4` = the freshest capability
  record's `tier`; see [The run token](#the-run-token)). It also takes an optional **`claudeHead`**
  (`'fable'`|`'opus'` = `state.json.capability.claude_head`, the resolved Claude council head) — every
  Claude-head council seat resolves its engine through it, so an Opus-headed council seals with Opus in
  the seat and records the succession in the checkpoints' `seat_provenance`; **omit it (or any value but
  `'opus'`) ⇒ the Fable head, byte-compatible with every pre-succession launch.** When `capabilityTier === 'T4'` AND `codexAvailable`
  AND a `runToken` is present, the compile is sealed by the **fidelity council**: a blind
  Fable/Sol required pair rules whether `VISION.md` is a FAITHFUL compile of the brainstorm ledger
  (nothing invented, nothing dropped) — dual-APPROVE ⇒ `vision_compiled` THEN `stage_completed` fire +
  a `b43-vision/1` certificate rides the return; ANY other outcome ⇒ NEITHER seal event, the conductor
  escalates with the honest terminal. Sub-T4 / `codexAvailable:false` / a missing `runToken` are
  byte-preserved — except a **PROMISED** council (T4 + codex) launched WITHOUT a `runToken`, a
  misconfigured conductor: the seal fails CLOSED (terminal DEGRADED, NEITHER seal event — never a silent
  v3.0.1 compile).
- **Gauge** takes `postureOverride`, `assessorModel`, `pluginRoot` (see the Gauge stage in the
  conductor). It is the source of the posture-derived args every downstream stage reads.
- **Research** also takes **`topicsMax`** = `posture.research_topics_max` (always a
  positive integer — the cap `2 + D3 + D5`). Passing it is the signal that the Gauge ran and
  switches research to the posture rule: topics come ONLY from high-priority before-build OQs, capped at
  `topicsMax`, with NO lower floor — so **zero qualifying OQs ⇒ zero topics ⇒ no research.md is
  written** and the stage returns `research_file: null`. **Omit it** (or pass nothing) and research.js
  runs the verbatim v2 behavior instead: OQs plus load-bearing unknowns, a floor of 2 and a cap of 5,
  so a run without a posture is unchanged (and always produces a research.md). Architecture tolerates
  either outcome (next bullet). Research also takes **`pluginRoot`** — it locates the kiln-state CLI
  for the stage brackets (`stage_started` at entry; `stage_completed` on BOTH success returns — the
  zero-topics route IS a completion); absence degrades the brackets to log lines, never a failure.
- **Architecture** also takes **`planning`** = `posture.planning`
  (`'dual'`/`'single+redteam'`/`'single'`) and **`validationRounds`** = `posture.plan_validation_rounds`.
  `planning` decides whether The Council (dual anonymized plans + divergence) runs: `'dual'` runs it,
  `'single'`/`'single+redteam'` take the lite single-plan path (the cross-family red-team critique
  `'single+redteam'` names is build-spine machinery not yet wired — so
  it routes like `'single'`). `validationRounds` is the number of Athena VALIDATION
  PASSES to run (`plan_validation_rounds`, NOT a revision count): `1` ⇒ one pass / zero
  revisions, `3` ⇒ three passes / ≤2 revisions. **Omit both** and architecture.js falls back to its
  historical behavior (the foundation's `scope === 'trivial'` decides lite-vs-dual; 2 passes lite /
  3 passes full) — a run without a posture is unchanged. Architecture also reads **`lawModel`** and
  **`pluginRoot`**. `lawModel` is the slot for Asimov the Lawgiver (compiles and revises the Law's
  checks; default `'opus'` — pass another slot per capability tier). `pluginRoot` is the same absolute
  `$PLUGIN_ROOT` you resolved at launch — it locates the `kiln-law` CLI for the Law's dryrun and index/lock step;
  omit it and the lock degrades to `law_locked: false` with a recorded reason — never a silent
  proceed, never a stage crash. Architecture also takes an **optional `visualDirection`** — the boolean
  `vision.js` returned at brainstorm (a workflow cannot read a file
  in-script, so arg-threading is the only mechanical route). When you pass it, it **IS**
  `has_visual_direction` — the decline-byte check lives in the vision gate now, so architecture's
  foundation agent is NOT asked to re-judge it and design-token generation gates on your threaded value.
  **Omit it** (a pre-v3 VISION, a harness run, or a cross-session resume that starts at architecture
  without the brainstorm return in hand) and the foundation agent judges it from the VISION as the
  pre-v3 fallback — a run without the thread is unchanged. Architecture self-detects whether research.md
  exists (a cheap `ls` probe, the self-validation discipline) and grounds in VISION.md directly when
  the zero-topics route wrote none — it never points an agent at a phantom research file.
  Architecture also takes a **`runToken`** (council receipt binding + council seed at T4 — NOT a browser
  token; see [The run token](#the-run-token)) and a **`capabilityTier`** (`T1`|`T2`|`T3`|`T4` = the
  freshest capability record's `tier`), plus the optional **`claudeHead`** (`'fable'`|`'opus'` =
  `state.json.capability.claude_head`; absent ⇒ `'fable'`, byte-compatible) that resolves the Claude
  council seat's engine on BOTH the FULL and LITE paths. When `capabilityTier === 'T4'` AND `codexAvailable` AND a
  `runToken` is present, BOTH the FULL and the LITE paths become the **twin council**: the FULL path
  runs the anonymized Fable ∥ receipt-attested-Sol draft pair + a divergence-aware blind ratification
  ladder; the LITE path runs the blind required ratification pair ALONE over the single lite
  master plan — ONE round, no answer exchange, renderer `b42-lite/1`. Sub-T4 and `codexAvailable:false`
  run the v3.0.1 path BYTE-IDENTICAL, labeled `council.path:'v301'` with an honest reason (never
  `twin_ratified`, never second-family verification). The return grows ONE additive field: `council: {
  eligible, tier, path:'twin_council'|'v301', terminal:'RATIFIED'|'COUNCIL_DEADLOCK'|'BLOCKED'|'DEGRADED'|null,
  certificate, terminal_record, blocked_reason, receipts[], checkpoints, reason }` — a live, valid
  BLOCK/NEITHER on the lite plan is an honest `BLOCKED` terminal (the lite form has no answer-exchange
  remedy). On the twin-council path — FULL or LITE — the Law locks ONLY a `RATIFIED` plan; any other
  terminal (`BLOCKED`/`DEGRADED`/`COUNCIL_DEADLOCK`/absent) returns `law_locked:false` naming the
  council. A T4 launch (FULL or LITE) missing `runToken` is a misconfigured conductor: the council rules
  `DEGRADED` (reason `runToken absent`, Law blocked — a promised guarantee never silently downgrades to
  a clean v301 label); on the FULL path the v3.0.1 pair still produces a DRAFT plan for the operator.
- **Build** also takes `milestoneLimit` (omit in production = all milestones), `uiBuild`,
  `pluginRoot`, and — exactly like Validate — the whole **`posture`** object and a **`runToken`**.
  **`uiBuild` defaults `false`** — set it `true` only for a genuinely pure-UI/static
  deliverable (no backend). `uiBuild===true` forces build.js's `surfaceOf()` to route *every*
  milestone to the UI builder, overriding each milestone's own `surface` tag, so a normal app left
  at `false` lets architecture's per-milestone `surface` route backend/logic milestones correctly.
  `pluginRoot` is the same absolute `$PLUGIN_ROOT` you resolved at launch — a launched Workflow cannot
  see `${CLAUDE_PLUGIN_ROOT}` (it is unset there), so build.js workers need the resolved path passed
  in to Read plugin reference files by absolute path. Pass the **whole `posture` object**
  (`state.json.posture`) — build.js reads its Gauge dials (`review.ui_effort_base`,
  `min_slices_for_tribunal`, `browser.tier2_per_milestone`, and the validate-extras it carries
  downstream); omit it and the entire build stage drops to v2-equivalent defaults. **`runToken`** is
  conductor-minted per run (see [The run token](#the-run-token)) — build.js derives its `kbuild-…`
  browser-kill token from it AND (at capability tier T4) binds its milestone-council receipt-invocation
  IDs to the SAME per-run token. Build also takes a **`capabilityTier`** (`T1`|`T2`|`T3`|`T4` = the
  freshest capability record's `tier`, same as Architecture) and the optional **`claudeHead`**
  (`'fable'`|`'opus'` = `state.json.capability.claude_head`; absent ⇒ `'fable'`, byte-compatible) that
  resolves the milestone council's Claude seat engine. When `capabilityTier === 'T4'` AND
  `codexAvailable` AND a `runToken` is present, the milestone gate's three judgment seats go
  council-grade: the Ryu analyst becomes a receipt-attested Sol evidence analyst (xhigh, read-only,
  judging from the runner's persisted hashed evidence), Judge Dredd is retired in favor of a blind
  Fable/Sol required close-ratification pair (dual-APPROVE ⇒ QA_PASS + a `twin_ratified` certificate;
  any other outcome ⇒ QA_FAIL fail-closed with an honest terminal), and the single corrective build is
  gated by a blind Fable/Sol correction council over `retry | escalate | replan` (split/dead ⇒
  fail-closed escalate). Sub-T4, `codexAvailable:false`, and a missing `runToken` keep the v3.0.1
  prompt-delegated Ryu, single-Opus Judge Dredd, and unconditional corrective build BYTE-IDENTICAL —
  except a **PROMISED** council (T4 + codex) launched WITHOUT a `runToken`, which is a misconfigured
  conductor: the affected milestone ruling fails CLOSED (QA_FAIL, terminal DEGRADED — never a silent
  downgrade to Judge Dredd). Council terminals ride the milestone result's additive `council`
  field and the `gate_decision` ledger summary; deterministic red gates are never converted to green by
  council prose. For the `gateOnly` retry arg, see [Build failure routing](#build-failure-routing--the-gate-only-retry).
- **Validate** also takes `designPresent`, `pluginRoot`, `posture`, and a **`runToken`** (same recipe
  as Build — see [The run token](#the-run-token); validate.js derives its `kval-…` browser-kill / lease
  token from it, with the same non-unique per-project hash fallback when omitted).
  `designPresent` is `true` if the architecture stage wrote a `design/` directory (a HINT only —
  validate.js self-detects `design/` from disk, so a wrong/absent hint never mis-routes the design
  QA leg). `pluginRoot` is the same absolute `$PLUGIN_ROOT` you resolved at launch — LOAD-BEARING here: it locates
  the `kiln-law` CLI (the deterministic Law floor — fresh install, then `verify` + `run` FULL +
  `suite` as the real backstop) and `kiln-probe` (the Tier-2 scripted browser path + the token sweeps
  + the browser lease). Pass the **whole `posture` object** (`state.json.posture`) — validate.js reads
  its `validate.adversarial_pass` / `validate.second_family` dials (the D8=2 extras: a second
  adversarial traversal pass and a second cross-family goal-backward auditor); omit it and validate
  runs the floor without the extras. **Playwright MCP is NOT driven by autonomous validate** (an MCP
  server is a persistent browser service, forbidden in-loop) — there is no `playwrightMcp` arg.
  The Tier-2 traversal uses the scripted, lease-gated, one-shot `kiln-probe` ORACLE only; if playwright
  is absent on disk the UI criteria degrade honestly to `PARTIAL_PASS_STATIC_ONLY` (verification_class
  recorded), never silently green. MCP stays a doctor-detected capability for the operator's
  INTERACTIVE/manual visual QA, named as the manual alternative in the emitted `visual_qa_checklist`.
  The **in-loop Tier-2 browser traversal is the v3 repeal of the v2 ban** — it runs INSIDE validate as
  one bounded, swept, lease-gated evaluator (the browser is a subprocess with a deadline, never a
  service); the out-of-loop `visual_qa_checklist` still ships as the optional operator re-check below.
  Validate also takes a **`capabilityTier`** (`T1`|`T2`|`T3`|`T4`, same as Build/Architecture) and the
  optional **`claudeHead`** (`'fable'`|`'opus'` = `state.json.capability.claude_head`; absent ⇒ `'fable'`,
  byte-compatible) that resolves the final-ruling council's Claude seat engine. When
  `capabilityTier === 'T4'` AND `codexAvailable` AND a `runToken` is present, the **final ruling** goes
  council-grade: a blind Fable/Sol required pair CONFIRMS or BLOCKS the assembled deterministic
  verdict for EVERY computed verdict (PASS incl. prospective, PARTIAL, FAILED) — the monotonicity rail is
  absolute (the council never alters `verdict`/`blocking`/`correction_tasks`; a deterministic red is
  never greened). It gates ONE thing: `stage_completed` fires only on `VALIDATE_PASS` AND a RATIFIED
  ruling (a PASS whose council BLOCKED/DEGRADED leaves the projection at `validate` — the deterministic
  verdict STANDS, but completion is council-gated). The terminal + `b43-validate/1` certificate ride the
  `validate_verdict` event's additive `council` field and the return. Also, `second_family_verified`
  is now **receipt-based**: the posture-required second-family goal leg becomes a receipt-attested envelope
  leg (gated on `codexAvailable` + `runToken`, NOT the tier) with an invocation-exact ledger cross-check;
  the claim is `verified` only when `receipt_verified && ledger_verified` on top of the existing model
  checks — codex-but-no-`runToken` keeps the prompt-delegated form with `verified:false` + a
  `no_run_token_no_attestation` reason (honest, never an unattested claim), and `codexAvailable:false` is
  never verified. Sub-T4 is byte-preserved; a **PROMISED** council (T4 + codex) with no `runToken` fails
  CLOSED (terminal DEGRADED, no `stage_completed` even on a PASS — never a silent v3.0.1 completion).
- **Report** (`report.js`) takes `kilnDir`, `projectPath`, and **`pluginRoot`** — `pluginRoot`
  locates the kiln-state CLI for the stage brackets (`stage_started` at entry; `stage_completed` on
  the genuine-success path ONLY — REPORT.md written, confirmed by an existence probe) and the lore
  beats, AND (at T4) the `kiln-codex-receipt` CLI the signoff council binds its receipts through;
  absence degrades the ledger legs to log lines, never a stage failure. A missing REPORT.md emits NO
  `stage_completed`, so the projection stays at `report`. Report also takes a **`runToken`**, a
  **`capabilityTier`**, and the optional **`claudeHead`** (`'fable'`|`'opus'` =
  `state.json.capability.claude_head`; absent ⇒ `'fable'`, byte-compatible) that resolves the signoff
  council's Claude seat engine. When `capabilityTier === 'T4'` AND `codexAvailable` AND a `runToken` is present,
  the **signoff** goes council-grade: Omega still AUTHORS the report (creative seat, unchanged),
  then after the existence gate a blind Fable/Sol required pair rules whether REPORT.md tells the TRUTH
  about the run's delivered vs outstanding artifacts — dual-APPROVE ⇒ `signed_off: true` + a `b43-report/1`
  certificate in the return AND ONLY THEN `stage_completed` fires (the existence-gated completion is
  council-gated at T4); ANY other outcome ⇒ `signed_off: false` + the honest terminal + frozen findings in
  the return, the UNSIGNED report still returned, and NO `stage_completed` (the conductor's gated checkpoint
  owns the block). Sub-T4 omits `signed_off` entirely (never a false claim) and the existence-gated
  completion is byte-preserved; a **PROMISED** council with no `runToken` fails CLOSED (terminal DEGRADED,
  `signed_off: false`, no completion).
- **Mapping** (`mapping.js`, brownfield onboarding) takes `projectPath`, `kilnDir`, and
  **`pluginRoot`** — same shape: `pluginRoot` locates kiln-state for the stage brackets
  (`stage_started` at entry; `stage_completed` ONLY when `.kiln/docs/codebase-map.md` is on disk) and
  the lore beats; absence degrades each to a log line. A missing map emits NO `stage_completed`.

## The run token

Build and Validate each derive their per-stage browser-kill token (`kbuild-…` / `kval-…`) from
`args.runToken`, and **Architecture at capability tier T4** binds its twin-council receipt-invocation
IDs + the council seed to the SAME per-run token (a receipt/seed binding, not a browser kill). Workflow
scripts cannot mint one — `Date.now()`/`Math.random` are forbidden inside them (the determinism guard
that keeps resume reproducible), and the per-project hash fallback they fall to is NOT unique across runs. So **cross-run uniqueness is the conductor's job, in the session,
where clocks are legal.** Mint ONE token per run, reuse it for every Build and Validate launch that
run, and keep it in the inert charset `[A-Za-z0-9._-]` (it becomes a `pkill -f` / `readdir` pattern).
Epoch seconds plus a short suffix is plenty — e.g. `1718200000-a1`. Mint a fresh one for a gate-only
retry (below) so its sweep can't collide with the starved run's leftovers. **An architecture RE-RUN
likewise mints a FRESH runToken** — the council receipt ledger rejects replayed invocation IDs, so
relaunching architecture under the aborted run's token would collide with its own reservations.

Validate failures feed corrections back to Build while `correction_cycle < 3`, then escalate to the
operator. Use the matching transition lines from `brand.md` for each event.

## Build failure routing — the gate-only retry

When a build run returns `QA_FAIL` whose ONLY blocking finding is `goal-audit-failure` — or the gate
was visibly *starved* (session death mid-Judgment with the slices already built and committed) — do
not pay for a full re-run. The slicer cannot legally cut zero slices over a completed build, so a full
re-run churns through builder/confirm work it doesn't need. Instead relaunch build with
`{gateOnly: true, …same args, fresh runToken}`: it skips Scoring the Cut and Forging entirely and
re-runs only the milestone gate (Law verify + full run + the tribunal) over the finished build.
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

- **The browser is a subprocess with a deadline, never a service.** The v2 blanket
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
  persistent browser service forbidden inside the loop); it stays a doctor-detected capability for the
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
