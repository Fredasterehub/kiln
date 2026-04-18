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

## Integration Tests

- Write integration tests for cross-module behavior (API routes that touch DB, workflows that span services).
- Keep them separate from unit tests — different directories or naming conventions per the project's `AGENTS.md`.
- Integration tests run in GREEN phase alongside unit tests. If the project has a separate integration command, note it in the implementation report.

## Rules

1. **Tests go in first.** The test file exists before the implementation file. This is the whole point.
2. **One assertion per test** where practical. A test that checks 5 things tells you nothing when it fails.
3. **No mocking what you own.** Mock external services and APIs. Don't mock your own modules — that tests the mock, not the code.
4. **Test names describe behavior, not methods.** "rejects expired tokens" not "test_validate_token_3".
