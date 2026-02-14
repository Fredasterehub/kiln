# SPEC — T10: Integration Test

## Goal

End-to-end verification that the complete kiln package installs correctly, all files are placed in the right locations, all cross-references resolve, and the package is ready for npm publish.

## Acceptance Criteria

- AC-01 (DET): `node bin/install.js` installs into a fresh temp project without errors
- AC-02 (DET): All agent files exist in .claude/agents/ after install (11 agents)
- AC-03 (DET): All skill directories exist in .claude/skills/ after install (7 skills)
- AC-04 (DET): hooks.json is valid JSON and references existing scripts
- AC-05 (DET): .kiln/ directory created with config.json and STATE.md
- AC-06 (LLM): Cross-references resolve — every agent that references a skill points to an existing skill
- AC-07 (DET): `npm pack` produces valid tarball, `npm publish --dry-run` succeeds
- AC-08 (DET): No dev/build files leaked into package (no .claude/ build agents, no tracks/, no .teams/)

## Deliverables

| File | Type | Description |
|------|------|-------------|
| `tests/integration.sh` | Script | Full integration test script |
| `README.md` | Doc | Package README with install instructions |

## Verification Commands

```bash
bash tests/integration.sh
npm pack --dry-run
```
