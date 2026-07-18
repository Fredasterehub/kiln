---
schema: 1
status: draft
tier: standard
visual_direction: false
session: {"ideas": 0}
counts: {"frs": 1, "scs": 1, "stories": 1, "assumptions": 0, "unresolved_clarifications": 3, "open_questions": 0}
open_questions: []
---
<!-- VISION v3 (P4) — compiled from .kiln/docs/brainstorm-ledger.jsonl by a fresh-context agent.
     DERIVED ARTIFACT: regenerable from the ledger at any time; never hand-edit.
     kiln-vision validate gates this file mechanically — the rules that matter:
     - The frontmatter is the authoritative machine surface. Structured values (session, counts,
       open_questions) are single-key JSON — `key: {…}` or `key: […]`, JSON.parse-able after the
       first colon; the value may wrap onto following lines until the next top-level `key:`.
     - counts.* must EQUAL the number of body lines matching each grammar below — a lying count
       is a broken artifact. session.ideas is ledger provenance (type-checked only).
     - Every `## ` section below must appear exactly once, titles byte-stable — downstream
       stages key on them.
     - Countable line grammars (one entry per line; nothing else in the section counts):
         Functional Requirements  - **FR-1**: …       (MUST-form, testable)
         Success Criteria         - **SC-1**: …       (executable-check intent, tech-agnostic;
                                                       these ids SEED the Law — architecture
                                                       adopts them, never re-mints)
         User Stories             - **S-1 (P1)**: …   (P1 alone must be a viable MVP)
         Assumptions Ledger       - **A-1**: …        (every default chosen on the operator's
                                                       behalf, with why)
         Open Questions           - **OQ-1**: …       (mirror of the frontmatter list; the
                                                       frontmatter is authoritative — id sets
                                                       must match)
       Ids are `PREFIX-<digits>`, unique per family. Zero-padding is style, not contract.
     - `[NEEDS CLARIFICATION: …]` markers are legal inline anywhere while status: draft; the
       count must equal counts.unresolved_clarifications, and status gated|approved demands
       zero.
     - visual_direction false ⇒ the Visual Direction section body is EXACTLY the decline line
       shown below; true ⇒ it is substantive (non-empty, not the decline line).
-->

## Problem Statement

<!-- what, who, why now — the operator's words, compiled from the ledger -->

## Target Users

<!-- primary, secondary, jobs-to-be-done -->

## Goals

<!-- measurable, numbered -->

## Functional Requirements

- **FR-1**: [NEEDS CLARIFICATION: example entry — replace or resolve]

## User Stories

- **S-1 (P1)**: [NEEDS CLARIFICATION: example entry — P1 alone must be a viable MVP]

## Success Criteria

- **SC-1**: [NEEDS CLARIFICATION: example entry — write it as an executable-check intent]

## Non-Goals

<!-- explicit exclusions with rationale — agents lack the judgment to infer scope boundaries -->

## Key Entities

<!-- the nouns the product is made of -->

## Constraints

<!-- technical, time, budget, team, regulatory -->

## Tech Stack

<!-- leanings only; "Let Kiln decide" is honored — architecture makes the final call -->

## Risks & Unknowns

<!-- likelihood / impact -->

## Open Questions

<!-- - **OQ-1**: {question} — human-readable mirror; priority/timing/context live in the
     frontmatter entry with the same id -->

## Key Decisions

<!-- decision / alternatives / rationale -->

## Assumptions Ledger

<!-- - **A-1**: {default chosen} — {why the facilitator picked it on the operator's behalf} -->

## Elicitation Log

<!-- methods used + key outputs; compiled from the ledger's elicitation events -->

## Visual Direction

No visual direction specified. Build will proceed without design system generation.
