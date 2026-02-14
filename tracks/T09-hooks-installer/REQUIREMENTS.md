# REQUIREMENTS — T09: Hooks + Installer

## Upstream Dependencies

### T01: Project Scaffolding (REQUIRED)
- `bin/install.js` stub exists — T09 replaces this with full implementation
- `package.json` — bin entry, files whitelist
- Directory skeleton: agents/, skills/, hooks/scripts/

### T02: Core Foundation (REQUIRED)
- `skills/kiln-core/kiln-core.md` — .kiln/ directory structure, STATE.md format
- `templates/config.json.tmpl` — config.json template for .kiln/ creation
- `templates/STATE.md.tmpl` — STATE.md template for .kiln/ creation

### T03-T08: All Agent/Skill Tracks (REQUIRED)
- All agent files in `agents/` — installer must copy all of them
- All skill directories in `skills/` — installer must copy all of them
- The installer needs a complete manifest of what to copy

## Invariants

- Zero runtime dependencies (Node.js built-ins only: fs, path, readline)
- Shell scripts must pass shellcheck
- Installer must handle merging with existing .claude/ configurations (not overwrite)
- hooks.json must reference scripts that actually exist
- Installer must work against a temp directory for testing
