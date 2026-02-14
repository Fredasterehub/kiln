# DECISIONS — T08: Reconcile + Utilities

## D-01: Researcher model choice
- **Decision:** Haiku for researcher agent
- **Rationale:** Researcher does retrieval, not analysis. Haiku is fast and cheap, which matters since the researcher is spawned frequently and on-demand.
- **Alternatives considered:** Sonnet — rejected because researcher's job is finding/citing, not reasoning.

## D-02: Living doc update strategy
- **Decision:** Replace outdated entries, not append
- **Rationale:** Append-only would cause docs to grow unbounded. Replace ensures docs stay current and within budget (~3000 words each).
- **Alternatives considered:** Append with periodic pruning — rejected because it's more complex and prone to drift.

## D-03: Roadmap format
- **Decision:** Lightweight — phase titles + 1-2 sentence descriptions only
- **Rationale:** The roadmap is a SEQUENCING tool, not a planning tool. Implementation details belong in PLAN.md per phase.
- **Alternatives considered:** Detailed roadmap with task sketches — rejected per design spec: "Lightweight format on purpose."

## D-04: Final integration E2E location
- **Decision:** Protocol embedded in kiln-track skill (T07-T05), implementation details in T08-T04 task packet
- **Rationale:** The final E2E is triggered by the track loop (kiln-track) after all phases complete. The T08-T04 packet defines the cross-cutting test generation logic that gets embedded there.
- **Alternatives considered:** Separate skill — rejected because it's only invoked once and is tightly coupled to the track loop.

## D-05: Researcher spawning model
- **Decision:** On-demand by any agent, not scheduled
- **Rationale:** Research needs are unpredictable. Any agent can spawn the researcher when it needs information. No fixed research phases.
