# T02 Core Foundation — Specification

## Acceptance Criteria

- AC-01 (LLM): `skills/kiln-core/kiln-core.md` defines all agent coordination contracts: `.kiln/` directory structure, output format contracts between agents, sentinel schema format, error escalation protocol
- AC-02 (DET): `templates/config.json.tmpl` is valid JSON with fields: `projectType`, `modelMode`, `tooling` (object with 5 keys), `preferences` (object with 3 keys)
- AC-03 (DET): All template files exist and contain required placeholder sections: `templates/config.json.tmpl`, `templates/STATE.md.tmpl`, `templates/vision-sections.md`
- AC-04 (LLM): `skills/kiln-core/kiln-core.md` covers model routing table (13 roles), Claude-only fallback rules, and context budget guidelines (~15% orchestrator, fresh context per task)

## Constraints

- kiln-core skill should be thorough but not bloated (~200-400 lines)
- Template files must use placeholder values that are clearly identifiable
- config.json.tmpl must be valid JSON (parseable by `JSON.parse`)
- All content must be self-contained — no references to external files that don't exist yet
- Templates go at `templates/` root level (NOT under `templates/teams/` which is build workflow)

## Non-Goals

- Agent definitions (Tracks T03-T08)
- Other skill content (Tracks T03-T08)
- Full installer logic (Track T09)
- Living doc templates (created by reconcile skill in Track T08)

## Dependencies

- Depends on T01 (directory skeleton must exist: `skills/kiln-core/`, `templates/`)
