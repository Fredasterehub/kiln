# Kiln — Session Handoff

**Date:** 2026-02-14
**Previous session:** Brainstorming + design phase (complete, approved)
**Next session:** Implementation planning via `writing-plans` skill

---

## What Is Kiln

Multi-model orchestration workflow for Claude Code. NPM package (`kiln-dev`). Fuses:
- **BMAD Method** — deep brainstorming with anti-clustering
- **Google Conductor** — just-in-time planning per track, living docs
- **GSD** — fresh 200k context per task, goal-backward verification
- **Dual-model baseline** — Claude + GPT perspective fusion

**Location:** `/tank/dump/DEV/kiln/`
**Design doc:** `/tank/dump/DEV/kiln/docs/plans/2026-02-14-kiln-architecture-design.md`

---

## What Was Decided (All Operator-Approved)

### Architecture: Staged Pipeline with Fresh Contexts

6 slash commands: `/kiln:init`, `/kiln:brainstorm`, `/kiln:roadmap`, `/kiln:track`, `/kiln:status`, `/kiln:quick`

### Track Lifecycle (the core loop, auto-advancing):

```
Step 1: PLAN        — dual-model (Opus + GPT-5.2), just-in-time against current codebase + living docs
Step 2: VALIDATE    — 7-dimension pre-execution plan check
Step 3: EXECUTE     — fresh 200k context per task, Sharpen (GPT-5.2) → Implement (GPT-5.3-codex) → Mini-verify
Step 4: E2E         — start app, generate user journey tests, run, cumulative regression
Step 5: CODE REVIEW — Opus reviews full track diff, security, stubs, integration
Step 6: RECONCILE   — update living docs, check roadmap, auto-advance to next track
```

After ALL tracks: Final Integration E2E (cross-cutting journeys) → FINAL_REPORT.md

### Model Routing

| Role | Multi-model | Claude-only |
|------|------------|-------------|
| Orchestrator | Opus 4.6 | Opus 4.6 |
| Brainstormer | Opus 4.6 (interactive) | Opus 4.6 |
| Vision Challenger | GPT-5.2-high | *skipped* |
| Vision Synthesizer | Opus 4.6 | *skipped* |
| Planner A | Opus 4.6 | Opus 4.6 |
| Planner B | GPT-5.2-high | *skipped* |
| Plan Synthesizer | Opus 4.6 | *skipped* |
| Plan Validator | Sonnet | Sonnet |
| Sharpener | GPT-5.2-high | Opus 4.6 |
| Implementer | GPT-5.3-codex-high | Sonnet |
| E2E Verifier | Sonnet | Sonnet |
| Reviewer | Opus 4.6 | Opus 4.6 |
| Researcher | Haiku | Haiku |

### Key Design Principles

1. **Multi-model is core** — GPT-5.2/5.3-codex via Codex CLI is the premium path. Claude-only is functional fallback.
2. **Brainstorming is the only interactive phase** — deep BMAD-style, everything else is automated.
3. **Just-in-time planning per track** — NO upfront full breakdown. Each track plans against current reality.
4. **Fresh context per task** — orchestrator stays lean (~15%), each task gets full 200k context.
5. **GPT-5.2 sharpens prompts for GPT-5.3-codex** — same model family affinity.
6. **Adaptive verification** — detect project tooling, run it, layer AI on top.
7. **Runtime verification is mandatory** — actually start and test the app per-track.
8. **Living docs propagate constraints** — TECH_STACK, PATTERNS, DECISIONS, PITFALLS evolve per track.
9. **Dynamic phase count** — model decides how many phases based on project scope.
10. **Auto-advancing track loop** — operator invokes `/kiln:track` once, system loops through all phases.
11. **Dual-model VISION.md** — Opus brainstorms interactively, GPT-5.2 challenge pass, Opus synthesizes, operator approves (HARD GATE).
12. **Corrections don't get dual-model planning** — they're narrow/specific, but Sharpener still optimizes for Codex.
13. **Max 3 correction cycles** per E2E and per code review — then halt + escalate.
14. **Code review corrections re-trigger E2E** — prevents fixes from breaking runtime behavior.
15. **E2E tests are committed** — become regression suite, grows organically per track.
16. **Final Integration E2E** after all tracks — cross-cutting user journeys + full regression + FINAL_REPORT.md.

### NPM Package Structure

```
kiln/
├── package.json                    # "kiln-dev"
├── bin/install.js                  # npx kiln-dev → interactive setup
├── agents/                         # 11 Claude Code agent definitions
│   ├── kiln-orchestrator.md        (Opus, traffic cop)
│   ├── kiln-brainstormer.md        (Opus, BMAD-style)
│   ├── kiln-planner.md             (Opus, architectural planning)
│   ├── kiln-codex-planner.md       (Sonnet shell → GPT-5.2)
│   ├── kiln-synthesizer.md         (Opus, dual-plan merge)
│   ├── kiln-validator.md           (Sonnet, 7-dim plan check)
│   ├── kiln-sharpener.md           (Sonnet shell → GPT-5.2 prompt eng)
│   ├── kiln-executor.md            (Sonnet shell → GPT-5.3-codex)
│   ├── kiln-e2e-verifier.md        (Sonnet, runtime test gen + exec)
│   ├── kiln-reviewer.md            (Opus, quality gate)
│   └── kiln-researcher.md          (Haiku, fast retrieval)
├── skills/                         # 7 behavioral modules
│   ├── kiln-core/                  (universal invariants)
│   ├── kiln-brainstorm/            (techniques + anti-clustering)
│   ├── kiln-plan/                  (planning format + atomization)
│   ├── kiln-execute/               (sharpening + implementation)
│   ├── kiln-verify/                (adaptive verification + stub detect)
│   ├── kiln-e2e/                   (runtime test gen + execution)
│   └── kiln-reconcile/             (living doc update protocol)
├── hooks/                          # 2 lifecycle hooks
│   ├── hooks.json
│   └── scripts/
│       ├── on-task-completed.sh    (mini-verify gate)
│       └── on-session-start.sh     (state rehydration)
└── templates/                      # initial file templates
```

### Project State Directory (`.kiln/`)

```
.kiln/
├── config.json          # detected tooling, model mode
├── VISION.md            # permanent north star (immutable after approval)
├── ROADMAP.md           # high-level phases (directional)
├── STATE.md             # persistent progress tracking
├── FINAL_REPORT.md      # generated after final integration E2E
├── docs/                # living docs
│   ├── TECH_STACK.md
│   ├── PATTERNS.md
│   ├── DECISIONS.md
│   └── PITFALLS.md
└── tracks/
    └── phase-N/
        ├── plan_claude.md
        ├── plan_codex.md
        ├── PLAN.md
        ├── e2e-results.md
        ├── review.md
        ├── reconcile.md
        └── artifacts/
```

---

## What Was NOT Decided (Open Questions for Implementation Planning)

1. Hook complexity — minimum viable set vs full lifecycle coverage
2. Researcher agent — on-demand vs structured integration points
3. Max task retries in mini-verify — currently 2, might need tuning
4. Living doc format — freeform vs structured sections
5. Wave parallelism limits — configurable in config.json
6. Quick mode boundaries — heuristics for "too big for quick"
7. E2E test framework selection per project type
8. E2E startup timeout configuration

---

## Reference Projects (Already Researched)

All four reference projects were deeply researched during this session. Key findings are embedded in the design doc. If you need to re-examine any of them:

- **BMAD**: `https://github.com/bmad-code-org/BMAD-METHOD` — v6.0.0-beta.8, 48 brainstorming techniques, anti-clustering protocol, party mode, scale-domain-adaptive
- **Conductor**: `https://github.com/gemini-cli-extensions/conductor` — v0.3.0, context-as-files, just-in-time track planning, living doc updates, logical-unit revert
- **GSD**: `https://github.com/gsd-build/get-shit-done` — v1.18.0, fresh context per task (context rot elimination), goal-backward verification, 7-dim plan validation, stub detection
- **deadfish-teams**: `/tank/dump/DEV/deadfish-teams/` — v3.2, 12 sentinel types, schema validation, deterministic verify.sh, 8 agents, hooks system. Kiln's spiritual predecessor.
- **avatarme baseline**: `/tank/dump/DEV/avatarme/workflow-standalone/` — 7 agents, dual-model planning (Opus + GPT-5.2), synthesis, prompter, Codex implementation, review loop

---

## Next Steps

1. **Start a fresh Claude Code session**
2. **Read this handoff:** `/tank/dump/DEV/kiln/docs/plans/HANDOFF.md`
3. **Read the full design doc:** `/tank/dump/DEV/kiln/docs/plans/2026-02-14-kiln-architecture-design.md`
4. **Invoke the `writing-plans` skill** to create a detailed implementation plan from the approved design
5. **Begin implementation** following the plan

The design is fully approved. No further brainstorming needed. Go straight to implementation planning.
