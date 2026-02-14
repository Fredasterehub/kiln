# Track: T02-core-foundation

## Title
Core Foundation

## Goal
Build the foundational skill (kiln-core) that defines universal invariants, the state layer schema, and all file templates. Every agent and skill downstream depends on this.

## State
PLANNED

## Created
2026-02-14T06:57:02Z

## Tasks
- T02-T01: Write kiln-core skill (the constitution)
- T02-T02: Write config.json template
- T02-T03: Write STATE.md template
- T02-T04: Write vision-sections template

## Acceptance Criteria
- AC-01 (LLM): kiln-core defines all agent coordination contracts
- AC-02 (DET): config.json template is valid JSON with required fields
- AC-03 (DET): All template files exist with required sections
- AC-04 (LLM): kiln-core covers model routing, Claude-only fallback, context budget

## Dependencies
T01 (Project Scaffolding) — directory skeleton must exist

## Blocks
T03 (Init + Orchestrator), T04 (Brainstorming Pipeline), T08 (Reconcile + Utilities)
