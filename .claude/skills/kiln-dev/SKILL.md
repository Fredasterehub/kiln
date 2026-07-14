---
name: kiln-dev
description: The Kiln Dev Protocol — the process constitution loaded at dev-session start. Seats, the two-key rule, the review ladder (script-decidable SUBSTANTIVE arithmetic, the convergence oracle, keystone council routing), the three standing rules, worker lifecycle, and the codex bridge contract. The dev process is a small Kiln — one skill (this), one review-cycle workflow, one trusted transport, one harness floor. This is the operational summary; `.kiln-dev/v302/dev-protocol-draft.md` (rev 3, jointly ratified) is the authority — link, do not duplicate.
---

# The Kiln Dev Protocol

The dev process is a small Kiln: one conductor skill (this), one deterministic review-cycle workflow
(`.kiln-dev/templates/dev-review.js`), one trusted transport (`plugins/kiln/scripts/kiln-codex-receipt.mjs
bridge`, wrapped by `scripts/dev/sol-review.sh`), one harness floor. Every mechanism collapses into
one of these four pieces or one of the three rules below; if it fits neither, it does not ship. The
HANDOFF keeps STATE only; memory keeps operator facts only; everything process-shaped lives here,
versioned and dual-keyed on change. Authority: `.kiln-dev/v302/dev-protocol-draft.md` (rev 3).

## Seats (constant)
- Dual-key EVERY commit: two `Reviewed-by` trailers — one opposite-family TERMINAL review
  (independent verification) and one author-family second key (governance/scope; never represented
  as independent verification).
- No same-family verification. Fable drafts, directs, and judges — never implements or mutates the
  tree. Opus is the default Claude-lane implementer; the mirrored Codex-authored lane is the stated
  exception. Codex-authored ⇒ Fable reviews.
- Creative: Fable directs / Opus produces / Sol mechanics-only-blocking (taste advisory).
- Workflows never auto-commit. /DEV/ghostundo is untouchable. One writer per task — reviewers and
  designers rule but never touch the tree.
- **Workflows, not teammates (A11 — operator ruling 2026-07-14):** workflows carry ALL autonomous
  LLM calls; named/team agents exist ONLY for operator-interactive work (dev batches have none).
  Implement and review are workflow stages — every round a FRESH agent() context fed a
  SELF-CONTAINED brief (files-as-truth carries continuity); reviewers additionally get the written
  prior verdict; Fable rules between invocations (the conductor pattern). The v1-era
  boss/implementer/transport teammates are retired.

Default lane: unlisted engineering work (docs, config, tooling, workflows, schemas, migrations,
dependencies, security, refactors) = Logic full review, or the mirrored Codex-authored lane by writer
family; test-only verification = QA/audit (a Sol verdict on the COMPLETE outcome, clean or condemn).
Full seat map: dev-protocol-draft.md §"Scenario seat map".

## The ladder (script-decidable; the `gate` subcommand owns the arithmetic)
1. **r1** full review → **r2** DELTA re-review (resolution table against r1) → at rejection 2 the
   **joint-heads scope rule** (Sol's written findings = the scope; Fable concurs on record) → **r3**
   micro-fix + one-item confirmation (`--ephemeral`, medium effort) — legal ONLY when the scope
   artifact names EXACTLY ONE surviving blocking finding ID (more IDs confirm separately or escalate).
2. **SUBSTANTIVE** = a rejection carrying ≥1 BLOCKING finding with `remedy_class: NEW_DECISION`
   (`isSubstantiveRejection`). Every finding carries `remedy_class:
   VERBATIM|EXACT_CHECK|EXISTING_RECEIPT|NEW_DECISION`; the verdict schema + validator enforce unique
   NONEMPTY ids, APPROVED ⇒ zero BLOCKING, REJECTED ⇒ ≥1 BLOCKING, and stamp the invocation round
   (never model-supplied). Schema: `scripts/dev/review-verdict-schema.json`; validator:
   `validateReviewVerdict`.
3. **Convergence oracle** (DEV-ONLY): two consecutive rounds with an unchanged finding set OR an
   unchanged diff = converged, regardless of verdict.
4. **Terminal routing:** a 3rd SUBSTANTIVE rejection or an oracle hit emits a correction-escalation
   artifact and enters the twin-council route (`twin-council.md` §§1–8) — never a direct jump to the
   operator. Constitutional keystones (master-plan/design ratification, release/report sign-off,
   correction escalation) take the council path from the START. The `kiln-codex-receipt.mjs gate`
   subcommand OWNS this arithmetic deterministically, from ARTIFACTS not caller args: it reads the
   batch manifest (lane + the pinned stage taxonomy, from which it DERIVES keystone — unforgeable by
   the caller) and the append-only route-ledger (prior rounds' substantive count, finding-set key,
   diff sha), and exits with the decision code (0 seal · 20 implement-r2 · 21 microfix-r3 · 22
   confirm-each-or-escalate · 30 twin-council · 12 gate failure). Decision order: keystone ⇒ council
   first; then the convergence oracle (REGARDLESS of verdict, so it precedes the APPROVED seal); then
   APPROVED ⇒ seal; then substantive-count and rung legality. The r3 rung is legal ONLY with a
   `--scope-artifact` naming exactly one surviving blocking id in machine form
   (`{surviving_blocking_id, sol_verdict_path, fable_concurrence: true}`).

## The three rules (judgment-seat law)
1. **Receipts for claims.** Any behavioral claim in code comments, docs, or tests carries a file:line
   receipt verified in-session, or gets a Sol design-check first. "Trivial" is not an exemption.
2. **Mechanism over discipline.** No brief or doctrine states a bound/invariant as caller discipline
   when a helper, schema, or gate can hold it.
3. **Executed before written.** Any rule naming a mechanism (flag, timeout, command, pattern) is
   executed once with the receipt captured before it is written into the skill, a template, or memory.

## Worker lifecycle (A11 — workflows, not teammates)
Every worker is a FRESH `agent()` call inside a workflow invocation — model pinned explicitly per
seat (never inherited), schema-typed output where the script parses it; the worker's FINAL MESSAGE
is its report (agent()'s return — no report files, no couriers). Nothing persists by agent
identity: continuity across rounds lives in FILES (brief, diff, verdict); each round is a new
invocation of the cycle with Fable ruling between invocations. A null agent() return is
TRANSPORT-class — it consumes no rung on the ladder. Every brief carries five fields (objective ·
output format · allowed tools/inputs · boundaries · effort) + the failure-idiom tag; templates in
`.kiln-dev/templates/`.

## The bridge contract (Piece 3 — trust base)
`kiln-codex-receipt.mjs bridge` (thin wrapper `sol-review.sh`) is the ONE receipt-bearing transport;
`gateAgent` and any friendly alias consume its verified envelope — never a second CLI. Contract
(every flag live-verified on codex-cli 0.144.1):
- `-o <prefix>.verdict` is the verdict channel; `--output-schema` forces the A2 envelope; `--json`
  captures thread_id + usage. Outcome is the A5 VALIDATED STATE MACHINE ONLY — no shorthand:
  VERDICT (exit 0 + one turn.completed + non-empty schema-valid output + verified receipt) ·
  SUPPRESSED (exit 0 + empty verdict file + turn.completed) · FAILED_TURN (exit 1 + turn.failed +
  absent file) · WALLCLOCK_TIMEOUT (exit 124) · everything else = TRANSPORT (consumes no rejection).
- Only the hooks-config warning fingerprint is allowlisted. Fallback to gpt-5.5 fires ONLY on the
  exact model-unavailable/entitlement fingerprint, preserves primary artifacts, and its output is
  INELIGIBLE for a required Sol seat.
- Sandbox: `read-only` default; `workspace-write` (with the explicit `--network` capability) when
  mapped checks mutate the workspace; `danger-full-access` needs a named commission need. Resume is
  RECOVERY-ONLY (same logical turn after SUPPRESSED or an admitted retryable FAILED_TURN; identical
  prompt/schema/sandbox; NEVER across rounds; NEVER with `--ephemeral`; cannot carry `-s`). Effort
  `high` baseline / `xhigh` council-grade (sol rejects `minimal`).
- **A7 execution boundary:** no model-authored or model-relayed VERDICT couriers. A runner executes
  ONLY the script-rendered argv and relays no authority; the verdict file, the receipt, and the
  trusted validator are authoritative. A VERDICT requires a verified receipt + ledger record.
- **Resume binds to the recorded row (A3/A6):** `--resume <thread_id>` must equal a recoverable
  SUPPRESSED/FAILED_TURN row's `thread_id` with matching prompt+schema; the resumed turn's model,
  Sol-eligibility, and the full posture tuple (sandbox, network, web) come from THAT row, never from
  opts — resume refuses a posture the recorded turn did not have. Every attempt's raw artifacts survive
  and its ledger row binds to immutable attempt-scoped bytes (`<prefix>.attempt<K>.*` + a per-artifact
  sha256 map); the stable `<prefix>.*` paths are the LATEST attempt's copy only.
- **The routing gate + the floor + the handoff bounce are trusted-CLI modes over the SAME boundary:**
  `gate --floor` spawns the harness + bundler and writes a diff-bound floor receipt; `gate` verifies
  the verdict chain (sol lane ⇒ a codex receipt is the ONLY proof, Sol-eligible; fable lane ⇒ a
  Fable-authored A2 verdict file with `fable_main_session` provenance — no cross-labeling either way),
  requires that floor receipt, binds the reviewed diff (`Diff-sha256:` in the commission ==
  sha256(diff) AND receipt.prompt_sha256 == sha256(commission)), and routes; `check-handoff` bounces a
  malformed brief/commission before any model reads it.
- **⟨DSGN-1b⟩ the workflow return is a COURTESY COPY, never authority.** Every consumer of a routing
  decision (Fable ruling between invocations, the seal step) reads `<prefix>.decision.json` + the
  route-ledger row DIRECTLY; a mismatch between the relay and the files is a TRANSPORT failure.

## Inheritance (before building dev-side, check product-already-has first — one codebase of trust)
- **product-inherits:** the verified codex facts → the shared receipt transport + codex-prompt-guide;
  receipts-for-claims + executed-before-written as authoring discipline; the five-field brief contract;
  generic v3.0.1 in-flight resume/migration + its ghostundo-SHAPED fixture.
- **product-already-has:** kiln-codex-receipt.mjs attestation; commit-before-review; schema-forced
  payloads; fixed workflow prompts; lease-on-capability deadlines; content-based failure fingerprints;
  B3's closed debate state machine (the convergence oracle does NOT ride into B3).
- **dev-only / personal:** two-trailer dual-key; operator box/paths/subscriptions; the /DEV/ghostundo
  path + untouchable rule; memory/HANDOFF conventions; the review-cycle convergence oracle.
