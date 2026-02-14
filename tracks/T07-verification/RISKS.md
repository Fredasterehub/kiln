# RISKS — T07: Verification + Review

## R-01: E2E Test Flakiness (HIGH)
- **Risk:** Generated E2E tests may be flaky due to timing issues, startup delays, or non-deterministic behavior
- **Mitigation:** Startup timeout detection with configurable wait, retry logic with explicit flaky test tracking in e2e-results.md
- **Fallback:** Operator can mark flaky tests as known-flaky in config, excluded from regression gate

## R-02: Project Type Detection Mismatch (MEDIUM)
- **Risk:** E2E test generation may pick the wrong project type pattern (e.g., treating a full-stack app as API-only)
- **Mitigation:** Config.json projectType field is set during init; E2E verifier reads from config not guesses
- **Fallback:** Operator can override projectType in config.json

## R-03: Stub Detection False Positives (MEDIUM)
- **Risk:** Stub detection patterns may flag legitimate minimal implementations (e.g., a component that correctly returns null for empty state)
- **Mitigation:** Patterns check for context (e.g., "always returns null" vs "conditionally returns null")
- **Fallback:** Reviewer can override individual stub findings with rationale

## R-04: Review Correction Loop Exhaustion (LOW)
- **Risk:** 3 correction cycles may not be enough for complex phases
- **Mitigation:** Each correction cycle gets progressively more specific feedback; operator can extend limit in config.json preferences.maxRetries
- **Fallback:** HALT with full context; operator decides next action

## R-05: Cross-Track Regression (MEDIUM)
- **Risk:** E2E regression suite grows large and slow over many phases
- **Mitigation:** Regression suite is cumulative but test execution can be parallelized; configurable e2eTimeout in config.json
- **Fallback:** Operator can prune regression suite between phases

## R-06: /kiln:track State Corruption (LOW)
- **Risk:** If STATE.md is corrupted or inconsistent, track loop may skip stages or re-run completed stages
- **Mitigation:** /kiln:track validates STATE.md consistency at entry; refuses to advance if state is inconsistent
- **Fallback:** Operator can manually edit STATE.md to fix state
