# DECISIONS — T10: Integration Test

## D-01: Test script language
- **Decision:** Bash (tests/integration.sh), not Node.js
- **Rationale:** Shell script can test the installer end-to-end the same way a user would. It exercises `node bin/install.js` as a subprocess, verifies file placement with standard tools, and cleans up with rm.
- **Alternatives considered:** Node.js test script with Jest — rejected because it adds a dev dependency and is heavier than needed for file existence checks.

## D-02: Temp directory strategy
- **Decision:** Create temp dir at start, clean up at end (trap EXIT)
- **Rationale:** Ensures no side effects on the repository. Temp dir simulates a fresh user project.
- **Alternatives considered:** Use a fixtures/ directory — rejected because it would leave artifacts in the repo.

## D-03: README scope
- **Decision:** Minimal package README with install instructions and slash command reference
- **Rationale:** The README is for npm package consumers. Keep it focused on installation and usage, not development.
