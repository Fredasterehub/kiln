# REQUIREMENTS — T08: Reconcile + Utilities

## Upstream Dependencies

### T02: Core Foundation (REQUIRED)
- `skills/kiln-core/kiln-core.md` — coordination contracts, .kiln/docs/ directory structure, living doc schemas, sentinel schemas
- `templates/config.json.tmpl` — project config schema
- `templates/STATE.md.tmpl` — progress tracking format
- `templates/vision-sections.md` — VISION.md structure (used by roadmap generation)

### T03: Init + Orchestrator (REQUIRED)
- `agents/kiln-orchestrator.md` — spawning contracts (researcher spawned on-demand, reconcile triggered by orchestrator)
- `skills/kiln-init/kiln-init.md` — .kiln/ directory creation (living docs directory initialized here)

### T04: Brainstorming Pipeline (SOFT)
- VISION.md format — roadmap reads VISION.md to generate phases

## Invariants

- Living docs are budget-capped at ~3000 words each
- Living doc updates REPLACE outdated entries, not append
- Roadmap is LIGHTWEIGHT: titles + 1-2 sentences, no implementation details
- Researcher uses Haiku for fast, cheap retrieval
- Researcher is spawned on-demand by any agent that needs information
- Final integration E2E is a separate terminal gate, not merged into per-phase E2E
