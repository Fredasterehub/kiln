# RISKS — T09: Hooks + Installer

## R-01: Existing Configuration Merge (HIGH)
- **Risk:** Users may have existing .claude/agents/, .claude/skills/, .claude/hooks/ from other tools. Overwriting could destroy their configurations.
- **Mitigation:** Installer detects existing files, offers merge (add kiln files alongside existing) or skip (don't overwrite). hooks.json merge combines hook arrays.
- **Fallback:** Installer creates backup of existing configs before modification.

## R-02: Cross-Platform Shell Compatibility (MEDIUM)
- **Risk:** Shell scripts may not work on all platforms (macOS vs Linux, different shells)
- **Mitigation:** Use POSIX-compatible sh, not bash-specific features. Test with shellcheck.
- **Fallback:** Document minimum shell requirements.

## R-03: Hook Execution Context (MEDIUM)
- **Risk:** Claude Code hooks execute in a specific context. The working directory, environment variables, and available commands may differ from expectations.
- **Mitigation:** Scripts use absolute paths or resolve relative to .kiln/. Scripts check for required files before proceeding.
- **Fallback:** Scripts fail gracefully with helpful error messages.

## R-04: Interactive Prompts in CI (LOW)
- **Risk:** Interactive installer prompts won't work in non-interactive environments (CI/CD)
- **Mitigation:** Support --yes flag for non-interactive mode with sensible defaults
- **Fallback:** Document CI installation instructions

## R-05: Incomplete Agent/Skill Set (MEDIUM)
- **Risk:** If upstream tracks haven't delivered all agents/skills, installer copies an incomplete set
- **Mitigation:** Installer reads actual directory contents, doesn't hardcode file list. Missing files are logged as warnings.
- **Fallback:** /kiln:status can detect missing components post-install
