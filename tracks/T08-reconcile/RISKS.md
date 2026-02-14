# RISKS — T08: Reconcile + Utilities

## R-01: Living Doc Drift (MEDIUM)
- **Risk:** Living docs may become outdated between reconcile passes if multiple phases run quickly
- **Mitigation:** Reconcile runs after EVERY phase (not just at the end). Each reconcile pass reads the full current state.
- **Fallback:** Operator can trigger manual reconcile at any time

## R-02: Budget Enforcement Difficulty (LOW)
- **Risk:** Hard to enforce ~3000 word budget per living doc when content grows organically
- **Mitigation:** Reconcile skill explicitly checks word count and trims by removing outdated entries (REPLACE, not append)
- **Fallback:** Operator review at reconcile confirmation gate catches bloat

## R-03: Roadmap Granularity Mismatch (MEDIUM)
- **Risk:** Model may generate too many or too few phases, mismatching the project's actual complexity
- **Mitigation:** Operator review gate — operator can reorder, add, remove, adjust phases before approval
- **Fallback:** Re-run /kiln:roadmap with adjusted guidance

## R-04: Researcher Model Quality (LOW)
- **Risk:** Haiku may miss nuanced information that requires deeper reasoning
- **Mitigation:** Researcher is for RETRIEVAL only (find and cite), not analysis. Analysis is done by the requesting agent.
- **Fallback:** Requesting agent can spawn a Sonnet/Opus subagent for complex analysis

## R-05: Final Integration E2E Scope (HIGH)
- **Risk:** Cross-cutting tests spanning all phases may be very complex to generate and execute
- **Mitigation:** Focus on 3-5 critical user journeys that span the most phases, not exhaustive coverage
- **Fallback:** Operator can scope down to specific cross-cutting scenarios
