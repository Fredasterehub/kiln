# Track: T01-scaffolding

## Title
Project Scaffolding

## Goal
Create the NPM package skeleton for kiln-dev with correct directory structure, package.json, and stub installer.

## State
PLANNED

## Created
2026-02-14T06:38:45Z

## Tasks
- T01-T01: Create package.json
- T01-T02: Create directory skeleton
- T01-T03: Create stub installer

## Acceptance Criteria
- AC-01 (DET): `npm pack --dry-run` succeeds
- AC-02 (DET): Directory structure matches design spec
- AC-03 (DET): `node bin/install.js --help` exits 0

## Dependencies
None (first track)

## Blocks
T02 (Core Foundation)
