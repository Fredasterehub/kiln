# Blueprint: architecture

The engine reads this blueprint at step spawn to launch numerobis and thoth, then to service aristotle's wave-by-wave REQUEST_WORKERS. Aristotle consults it inside the conversation for the wave ordering, the validation loop, and the exact signal names. Reference posture — the contract that the spawning engine and the step boss both commit to.

## Meta
- **Team name**: architecture
- **Artifact directory**: .kiln/
- **Expected output**: .kiln/docs/architecture.md, .kiln/docs/tech-stack.md, .kiln/docs/arch-constraints.md, .kiln/docs/decisions.md, .kiln/plans/plan-a.md, .kiln/plans/plan-b.md, .kiln/plans/plan_validation.md, .kiln/master-plan.md, .kiln/architecture-handoff.md, .kiln/design/tokens.json (conditional — only if VISION.md has Visual Direction), .kiln/design/tokens.css (conditional), .kiln/design/creative-direction.md (conditional)
- **Inputs from previous steps**: .kiln/docs/VISION.md, .kiln/docs/vision-notes.md, .kiln/docs/vision-priorities.md, .kiln/docs/research.md, .kiln/docs/research/{slug}.md, .kiln/docs/codebase-snapshot.md, .kiln/docs/decisions.md, .kiln/docs/pitfalls.md (brownfield)
- **Workflow**: three-phase (persistent mind bootstraps, boss orchestrates, planners+synthesizer+validator as waves)

## Agent Roster

| Name | Agent Type | Role | Phase | Model |
|------|------------|------|-------|-------|
| numerobis | pitie-pas-les-crocos | Persistent mind. Technical authority. Bootstraps from research + onboarding, writes architecture docs, consultation hub. | A | opus |
| thoth | lore-keepah | Persistent mind. Archivist — owns all writes to .kiln/archive/. Fire-and-forget. | A | opus |
| aristotle | the-plan-maker | Boss. Orchestrates dual plan, divergence extraction, synthesis, validation, operator review. | B (INTERACTIVE) | opus |
| confucius | mystical-inspiration | Claude-side planner. Reads architecture docs, consults numerobis, writes plan-${SLOT}.md with structured skeleton (slot from runtime prompt, assigned randomly by aristotle). Conditionally generates design artifacts when VISION.md contains Visual Direction (section 12). | C (wave 1) | opus |
| sun-tzu | art-of-war | Codex-side planner. Delegates to GPT-5.4 via Codex CLI, writes plan-${SLOT}.md with structured skeleton (slot from runtime prompt). | C (wave 1) | sonnet |
| miyamoto | gracefully-degrading | Claude-side sonnet planner. Writes plan-${SLOT}.md directly (slot from runtime prompt). Used when codex_available=false. | C (wave 1, conditional) | sonnet |
| diogenes | divergences-converge | Divergence extractor. Receives anonymized plans (Plan A/B), extracts consensus, divergences, unique insights. Fast sonnet analysis avoiding planner self-bias. | C (wave 1.5) | sonnet |
| plato | e-pluribus-unum | Plan chairman. Reads anonymized plans + divergence analysis, synthesizes master-plan.md with confidence-tiered verdicts. | C (wave 2) | opus |
| athena | straight-outta-olympia | Validator. Validates master-plan.md on 8 dimensions (including plan purity). PASS or FAIL. | C (wave 3) | opus |

## Three-Phase Spawn

**Phase A**: numerobis + thoth bootstrap in parallel → numerobis reads research + writes architecture docs → thoth ensures archive structure → both signal READY.

**Phase B**: aristotle spawns (INTERACTIVE). Receives numerobis's READY summary. Orchestrates the dependency chain by requesting agents in waves.

**Phase C waves** (aristotle requests via REQUEST_WORKERS):
- Wave 1: confucius + sun-tzu (codex_available=true) OR confucius + miyamoto (codex_available=false). Aristotle randomises `slot=a`/`slot=b` across the planner pair at spawn time (Wave 2 self-anonymization) — each planner writes directly to `.kiln/plans/plan-${SLOT}.md` with no identity in the content.
- Wave 1.5: diogenes (divergence extraction after both plans ready — aristotle copies plan-a.md and plan-b.md verbatim to `.kiln/tmp/`; no sed rewriting needed since plans are already identity-free at creation)
- Wave 2: plato (chairman synthesis after divergence analysis — receives anonymized plans + divergence-analysis.md)
- Wave 3: athena (validation after synthesis)

Validation may loop: athena FAIL → plato revises → athena re-validates (max 2 rounds).

## Signal Vocabulary

| Signal | Sender → Receiver | Blocking? | Notes |
|--------|-------------------|-----------|-------|
| `READY_BOOTSTRAP: {summary}` | Numerobis → team-lead | No | Bootstrap complete; architecture docs written, technical summary ready (Wave 2 distinct-name contract) |
| `READY_BOOTSTRAP: {summary}` | Thoth → team-lead | No | Archive structure confirmed; independent of numerobis |
| `REQUEST_WORKERS: {list}` | Aristotle → engine | No | Four separate requests: wave 1 (planners), wave 1.5 (diogenes), wave 2 (plato), wave 3 (athena) |
| `PLAN_READY` | Confucius / Sun-Tzu / Miyamoto → Aristotle | No | Planner signals completion; aristotle waits for both before wave 1.5 |
| `DIVERGENCE_READY` | Diogenes → Aristotle | No | Divergence analysis written; aristotle triggers wave 2 (plato) |
| `SYNTHESIS_COMPLETE` | Plato → Aristotle | No | master-plan.md written; aristotle triggers wave 3 |
| `VALIDATION_PASS` | Athena → Aristotle | No | All 8 dimensions pass; aristotle proceeds to operator review |
| `VALIDATION_FAIL: {dimensions}` | Athena → Aristotle | No | One or more dimensions failed; aristotle sends plato back to revise (max 2 rounds) |
| `DOCS_UPDATED` | Numerobis → Aristotle | No | Reply to UPDATE_FROM_MASTER_PLAN; all architecture docs aligned |
| `ARCHITECTURE_COMPLETE: milestone_count={N}` | Aristotle → engine | No (terminal) | Step done; advances stage to build |
| `PLAN_BLOCKED` | Aristotle → engine | No (terminal) | Validation failed 3× with no resolution |
| `ARCHIVE: {paths}` | Sun-Tzu / Miyamoto / Confucius / Plato → Thoth | No (fire-and-forget) | Each agent archives their own artifacts |

## Communication Model

```
--- Phase A (bootstrap, parallel) ---
Numerobis  → team-lead     (READY_BOOTSTRAP: architecture summary)
Thoth      → team-lead     (READY_BOOTSTRAP: archive structure confirmed)

--- Phase B (boss, INTERACTIVE) ---
Aristotle  → engine        (REQUEST_WORKERS: confucius, sun-tzu — or confucius, miyamoto)

--- Wave 1 (planners) ---
Aristotle  → Confucius     (assignment + numerobis summary)
Aristotle  → Sun-Tzu       (assignment + numerobis summary)  [or Miyamoto if codex unavailable]
Confucius  → Numerobis     (technical consultation — optional)
Sun-Tzu    → Numerobis     (technical consultation — optional)
Confucius  → Aristotle     (PLAN_READY)
Sun-Tzu    → Aristotle     (PLAN_READY)
Sun-Tzu    → Thoth         (ARCHIVE: plan-prompt.md, codex-output.log — fire-and-forget)
Confucius  → Thoth         (ARCHIVE: tokens.json, tokens.css, creative-direction.md — conditional, fire-and-forget)

--- Wave 1.5 (divergence extraction) ---
Aristotle  → Bash          (copy .kiln/plans/plan-{a,b}.md → .kiln/tmp/plan-{a,b}.md verbatim — plans already anonymized at spawn time)
Aristotle  → engine        (REQUEST_WORKERS: diogenes)
Aristotle  → Diogenes      (assignment: read anonymized plans, extract divergence)
Diogenes   → Thoth         (ARCHIVE: divergence-analysis.md — fire-and-forget)
Diogenes   → Aristotle     (DIVERGENCE_READY)

--- Wave 2 (chairman synthesis) ---
Aristotle  → engine        (REQUEST_WORKERS: plato)
Aristotle  → Plato         (assignment: anonymized plans + divergence analysis → synthesize with confidence tiers)
Plato      → Numerobis     (technical consultation — optional)
Plato      → Aristotle     (SYNTHESIS_COMPLETE)
Plato      → Thoth         (ARCHIVE: master-plan.md, confidence-assessment.md, debate-resolution.md — fire-and-forget)

--- Wave 3 (validator — may loop max 2×) ---
Aristotle  → engine        (REQUEST_WORKERS: athena)
Aristotle  → Athena        (validation assignment)
Athena     → Numerobis     (technical consultation — optional)
Athena     → Aristotle     (VALIDATION_PASS or VALIDATION_FAIL)
[on FAIL: aristotle sends plato back to revise → re-validates]

--- Post-validation ---
Aristotle  → Numerobis     (UPDATE_FROM_MASTER_PLAN)
Numerobis  → Aristotle     (DOCS_UPDATED)

--- Terminal ---
Aristotle  → engine        (ARCHITECTURE_COMPLETE: milestone_count=N  or  PLAN_BLOCKED)
```

Numerobis is the consultation hub — planners, synthesizer, and validator message her directly. Aristotle never relays technical questions.
