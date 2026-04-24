# TDD Protocol

On-demand reference for builders executing a TDD chunk. Primary consumers are the build-step implementers — dial-a-coder, backup-coder, la-peintresse — running at medium-to-high effort depending on how much design the chunk leaves open. Reviewers consult it secondarily when checking that the test-first loop was followed. TDD is the default workflow for all testable behavior; this file is insurance against drift under pressure, not a tutorial.

## RED -> GREEN -> REFACTOR

1. **RED** — Write a failing test that captures the acceptance criterion. Run it. Confirm it fails for the right reason (not a syntax error).
2. **GREEN** — Write the minimum code to make the test pass. No more. Run the test suite.
3. **REFACTOR** — Clean up duplication, naming, structure. Tests must still pass after every change.

One cycle per behavior. Don't batch multiple behaviors into one test.

## When to Apply

Apply TDD when the assignment's `<test_requirements>` contains testable behavior:
- A function that returns a value
- A component that renders output
- An API endpoint with a contract
- A state transition with observable effects

## When to Skip

Skip TDD gracefully when there is no testable behavior:
- Pure configuration (env files, build config, tool settings)
- Scaffolding (directory structure, boilerplate with no logic)
- Static assets (images, fonts, CSS tokens)

When skipping, note "no testable behavior" in the implementation report. The reviewer will verify the skip was appropriate.

## Evidence Artifact

Every build chunk produces a TDD evidence artifact. The stable archive target is:

`.kiln/archive/milestone-<N>/chunk-<M>/tdd-evidence.md`

Builders write the working copy to `.kiln/tmp/tdd-evidence.md`, send it to thoth with `ARCHIVE`, and include both the working path and archive target in `REVIEW_REQUEST`.

Required schema:

```
testable: yes|no
no_test_waiver_reason: {required when testable=no}
assignment_id: {id from assignment}
milestone_id: {id from assignment}
chunk_id: {id from assignment}
current_head_sha_before: {sha before implementation}
current_head_sha_after: {sha after implementation}
red_command: {command or N/A}
red_result_summary: {summary}
green_command: {command or N/A}
green_result_summary: {summary}
refactor_command: {command or N/A}
refactor_result_summary: {summary}
test_files_added_or_changed: {paths}
production_files_changed: {paths}
reviewer_reran_commands: N/A - pending reviewer
reviewer_rerun_results: N/A - pending reviewer
limitations: {known limits}
```

For `testable: yes`, RED/GREEN/REFACTOR command and result fields must be substantive. For `testable: no`, `no_test_waiver_reason` must name the concrete reason the work cannot be tested. "No tests" or "not applicable" is not a waiver.

Reviewers reject testable chunks without a readable evidence artifact. Builder-reported results remain builder-reported until the reviewer reruns the commands or records a limitation.

## Integration Tests

- Write integration tests for cross-module behavior (API routes that touch DB, workflows that span services).
- Keep them separate from unit tests — different directories or naming conventions per the project's `AGENTS.md`.
- Integration tests run in GREEN phase alongside unit tests. If the project has a separate integration command, note it in the implementation report.

## Rules

1. **Tests go in first.** The test file exists before the implementation file. This is the whole point.
2. **One assertion per test** where practical. A test that checks 5 things tells you nothing when it fails.
3. **No mocking what you own.** Mock external services and APIs. Don't mock your own modules — that tests the mock, not the code.
4. **Test names describe behavior, not methods.** "rejects expired tokens" not "test_validate_token_3".
5. **Evidence is required.** A passing chat summary does not satisfy TDD; the artifact does.
