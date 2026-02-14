# T01 Scaffolding — Specification

## Acceptance Criteria

- AC-01 (DET): `npm pack --dry-run` succeeds and lists expected files
- AC-02 (DET): Directory structure exists: `agents/`, `skills/kiln-core/`, `skills/kiln-brainstorm/`, `skills/kiln-plan/`, `skills/kiln-execute/`, `skills/kiln-verify/`, `skills/kiln-e2e/`, `skills/kiln-reconcile/`, `hooks/scripts/`, `bin/`, `templates/`
- AC-03 (DET): `node bin/install.js --help` exits 0 and prints usage information

## Constraints

- Zero runtime dependencies (devDependencies only if needed)
- Package name: `kiln-dev`
- bin entry: `kiln-dev` -> `bin/install.js`
- Node.js built-ins only for any JS code
- All file paths must be relative (no hardcoded absolute paths)

## Non-Goals

- Full installer logic (Track T09)
- Any agent/skill content beyond directory stubs (Tracks T02-T08)
- README content beyond minimal placeholder (Track T10)
- hooks.json or hook scripts (Track T09)
- Template file content (Track T02)
