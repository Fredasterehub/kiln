# DECISIONS — T09: Hooks + Installer

## D-01: Hook execution model
- **Decision:** Two hooks only — on-session-start and on-task-completed
- **Rationale:** Minimal viable hook set. on-session-start rehydrates state for session continuity. on-task-completed provides the mini-verify gate. More hooks can be added later.
- **Alternatives considered:** More granular hooks (on-phase-start, on-phase-complete, on-e2e-start) — rejected as premature complexity.

## D-02: Installer interactivity
- **Decision:** Interactive by default with --yes flag for non-interactive mode
- **Rationale:** Users need to confirm installation targets, especially when merging with existing configurations. --yes flag supports CI/scripted installation.
- **Alternatives considered:** Always non-interactive — rejected because merge decisions need user input.

## D-03: File copy strategy
- **Decision:** Dynamic file discovery (read directory contents) rather than hardcoded manifest
- **Rationale:** Installer stays correct even as agents/skills are added or renamed. No manifest to keep in sync.
- **Alternatives considered:** Hardcoded file list — rejected because it creates a maintenance burden and breaks if files change.

## D-04: hooks.json merge strategy
- **Decision:** Array merge — combine existing hooks with kiln hooks, avoiding duplicates
- **Rationale:** Users may have other hooks registered. Kiln should add its hooks alongside existing ones, not replace them.
- **Alternatives considered:** Full replacement — rejected because it would break non-kiln hooks.

## D-05: Shell script dialect
- **Decision:** POSIX sh (#!/bin/sh), not bash
- **Rationale:** Maximum portability. shellcheck enforces this. No bash-specific features needed for the simple scripts.
