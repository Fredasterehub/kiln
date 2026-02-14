# RISKS — T10: Integration Test

## R-01: Missing Files from Upstream Tracks (HIGH)
- **Risk:** If any upstream track hasn't completed, the integration test will fail on missing file checks
- **Mitigation:** Integration test reports specifically which files are missing, not just a generic failure
- **Fallback:** Can run partial validation for completed tracks

## R-02: Package File Leakage (MEDIUM)
- **Risk:** Development files (tracks/, .teams/, .claude/ build agents) may accidentally be included in the npm package
- **Mitigation:** package.json `files` whitelist is the primary control. Integration test verifies tarball contents.
- **Fallback:** Add entries to .npmignore as needed

## R-03: Cross-Reference Brittleness (LOW)
- **Risk:** Cross-reference validation may break if agent/skill naming conventions change
- **Mitigation:** Use pattern matching (grep for skill/agent names in references), not hardcoded lists
- **Fallback:** Update validation patterns if naming conventions change

## R-04: npm Registry Name Conflict (LOW)
- **Risk:** Package name `kiln-dev` may be taken on npm
- **Mitigation:** `npm publish --dry-run` checks availability. If taken, use scoped name.
- **Fallback:** Use @kiln-dev/kiln or similar scoped name
