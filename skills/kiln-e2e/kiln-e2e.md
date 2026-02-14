---
name: kiln-e2e
description: "End-to-end test generation patterns, user journey format, and regression suite protocol"
---

# Kiln E2E Testing

Use this skill to generate behavior-first E2E journeys mapped to phase acceptance criteria.
It defines journey conventions, project-type templates, startup detection, artifact capture, and regression growth rules.

## User Journey Tests

E2E tests in kiln are user journeys, not unit tests and not implementation-level integration probes.
A journey simulates a real user workflow from start to finish, then verifies user-visible outcomes.
Each journey should map to one or more acceptance criteria in `.kiln/tracks/phase-N/PLAN.md`.

### Behavior-first policy
- Test behavior, not internals.
- Validate user-observable state transitions.
- Keep assertions at meaningful checkpoints in the flow.
- Prefer full journeys over isolated assertions.

### Contrast examples
- BAD (unit test): `expect(validateEmail('a@b.com')).toBe(true)`
- BAD (integration test): `expect(db.users.count()).toBe(1)`
- GOOD (journey): `User opens signup page, enters email and password, submits form, sees dashboard with welcome message`

### Journey format
Each journey should contain:
1. Preconditions (app/process reachable, deterministic test data)
2. User actions (realistic sequence)
3. Checkpoints (UI/API/CLI/library outcomes)
4. Cleanup (remove created data or temp state)
5. Failure evidence capture (artifacts)

### Naming convention
Use: `journey-NN-descriptive-slug.test.{js,ts,sh}`
Examples:
- `journey-01-signup-happy-path.test.ts`
- `journey-02-auth-token-refresh.test.js`
- `journey-03-init-build-output.test.sh`

### Traceability header
Add a short header in each test file:
```ts
// Covers: AC-01, AC-03
// Phase: phase-2
// Journey: signup happy path
```

## Web UI: Playwright Patterns

Use Playwright for `web-ui` projects. Prefer stable selectors (`getByRole`, `getByLabel`, `getByTestId`) and explicit waits.

### Base template
```ts
import { test, expect } from '@playwright/test';

test('journey-01-descriptive-slug', async ({ page }) => {
  await page.goto('http://localhost:3000');
  await page.click('text=Start');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});
```

### Complete signup journey example
```ts
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

const ARTIFACT_DIR = '.kiln/tracks/phase-2/artifacts';

test('journey-01-signup-happy-path', async ({ page }) => {
  try {
    await page.goto('http://localhost:3000/signup');
    await page.waitForLoadState('domcontentloaded');

    await page.fill('[name="email"]', 'journey.user@example.com');
    await page.fill('[name="password"]', 'StrongPass!123');
    await page.click('button[type="submit"]');

    await page.waitForURL('**/dashboard');
    await page.waitForSelector('[data-testid="dashboard-root"]');

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId('dashboard-root')).toBeVisible();
    await expect(page.getByTestId('welcome-message')).toContainText('Welcome');
  } catch (error) {
    await fs.mkdir(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: 'artifacts/failure-01.png', fullPage: true });
    await page.screenshot({ path: `${ARTIFACT_DIR}/failure-01-signup.png`, fullPage: true });
    throw error;
  }
});
```

### Navigation patterns
- `await page.goto(url)`
- `await page.click(selector)`
- `await page.fill(selector, value)`

### Assertion patterns
- `await expect(locator).toBeVisible()`
- `await expect(locator).toContainText(text)`
- `await expect(page).toHaveURL(pattern)`

### Wait strategies
- `await page.waitForSelector(selector)`
- `await page.waitForURL(pattern)`
- `await page.waitForLoadState('networkidle')` only when required

### Anti-patterns
- Avoid `page.waitForTimeout(...)` as synchronization (flaky)
- Avoid CSS-style assertions for behavior checks (brittle)
- Avoid selectors tied to generated framework class names

## API Server: HTTP Patterns

Use native `fetch` for `api-server` journey tests.
A complete journey validates status codes, response shapes, and headers across meaningful user flows.

### Base HTTP template
```ts
import assert from 'node:assert/strict';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:4000';

(async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
})();
```

### Complete CRUD journey example
```ts
import assert from 'node:assert/strict';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:4000';

async function runJourney() {
  const createRes = await fetch(`${baseUrl}/api/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'alpha-item' }),
  });
  assert.equal(createRes.status, 201);
  assert.equal(createRes.headers.get('content-type')?.includes('application/json'), true);
  const created = await createRes.json();
  assert.equal(typeof created.id, 'string');

  const readRes1 = await fetch(`${baseUrl}/api/items/${created.id}`);
  assert.equal(readRes1.status, 200);
  assert.equal((await readRes1.json()).name, 'alpha-item');

  const updateRes = await fetch(`${baseUrl}/api/items/${created.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'beta-item' }),
  });
  assert.equal(updateRes.status, 200);

  const readRes2 = await fetch(`${baseUrl}/api/items/${created.id}`);
  assert.equal(readRes2.status, 200);
  assert.equal((await readRes2.json()).name, 'beta-item');

  const deleteRes = await fetch(`${baseUrl}/api/items/${created.id}`, { method: 'DELETE' });
  assert.equal(deleteRes.status, 204);

  const readRes3 = await fetch(`${baseUrl}/api/items/${created.id}`);
  assert.equal(readRes3.status, 404);
}

runJourney().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

### CRUD journey sequence
Use: `create -> read -> update -> read -> delete -> verify-gone`.

### Auth flow sequence
Use: `register -> login -> use-token -> access-protected -> logout`.
Example token use:
```ts
const protectedRes = await fetch(`${baseUrl}/api/me`, {
  headers: { authorization: `Bearer ${token}` },
});
```

### Error journey patterns
- Invalid input returns `400` with structured error body
- Unauthorized access returns `401` without sensitive data
Example:
```ts
const bad = await fetch(`${baseUrl}/api/items`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: '' }),
});
if (bad.status !== 400) throw new Error(`Expected 400, got ${bad.status}`);
```

### Response validation checklist
Validate at each step:
- Status code
- Body structure and key fields
- Required headers
- Stable error envelope in failure paths

## CLI Tool: Subprocess Patterns

Use subprocess-driven journeys for `cli-tool` projects.
Invoke commands like a user would and verify stateful outputs in an isolated workspace.

### Base subprocess template
```ts
import { spawn } from 'node:child_process';

function run(cmd: string, args: string[], cwd: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(cmd, args, { cwd, env: process.env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += String(d)));
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
```

### Complete init/build/verify example
```ts
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

function run(cmd: string, args: string[], cwd: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(cmd, args, { cwd, env: process.env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += String(d)));
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function journeyInitBuildVerify() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kiln-cli-journey-'));
  const init = await run('mycli', ['init', 'demo-app'], tempRoot);
  assert.equal(init.code, 0, `init failed: ${init.stderr}`);

  const projectDir = path.join(tempRoot, 'demo-app');
  const build = await run('mycli', ['build'], projectDir);
  assert.equal(build.code, 0, `build failed: ${build.stderr}`);

  const output = path.join(projectDir, 'dist', 'index.js');
  const stat = await fs.stat(output);
  assert.equal(stat.isFile(), true);
}

journeyInitBuildVerify().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

### Journey sequence
Use: `init -> configure -> build -> verify output`.

### Exit code and error validation
- Happy path requires exit code `0`
- Error journeys require non-zero exit code and asserted stderr content
- Save stdout/stderr on failed commands

### Working directory policy
- Use a unique temp dir per journey
- Do not mutate repository root as runtime state
- Recreate workspace between journeys to prevent leakage

## Library: Import Patterns

Use import-based journeys for `library` projects and validate the public API sequence.

### Base import template
```ts
import assert from 'node:assert/strict';
import { Client } from '../src/index.js';

async function runJourney() {
  const client = new Client();
  const result = await client.process({ input: 'hello' });
  assert.equal(result.output, 'HELLO');
}

runJourney().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

### Journey lifecycle
Use: `create -> configure -> process -> validate -> cleanup`.

### Error handling journeys
- Invalid input should throw with stable error semantics
- Edge inputs should be handled gracefully
Example:
```ts
let threw = false;
try {
  await client.process({ input: '' });
} catch {
  threw = true;
}
if (!threw) throw new Error('Expected invalid input to throw');
```

### Async patterns
- Use `async/await` consistently for promise APIs
- Await cleanup hooks to avoid dangling handles
- Avoid mixing callbacks and promises in one journey

## Startup Detection

Startup detection gates E2E runs for project types with long-running processes.

### Defaults
- Default timeout: `30` seconds (from `config.json` at `preferences.e2eTimeout`)
- Polling interval: `500ms`
- Timeout classification: `config-issue`

### Detection methods by project type
- Web UI: poll HTTP GET to localhost until `200`
- API server: poll HTTP GET to health endpoint until `200`
- CLI tool: not applicable (no long-running process)
- Library: not applicable (no long-running process)

### Configurable health endpoint
If provided, use custom endpoint from `config.json`.
```json
{
  "preferences": {
    "e2eTimeout": 30,
    "e2eHealthEndpoint": "/health"
  }
}
```

### Polling template
```ts
async function waitForHealthy(url: string, timeoutMs = 30000, intervalMs = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status === 200) return;
    } catch {
      // service still starting
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('config-issue: startup timeout exceeded; include startup logs in failure report');
}
```

### Timeout behavior
On timeout:
- Categorize as `config-issue`
- Include startup logs in failure report
- Record attempted endpoint and timeout in `e2e-results.md`
- Stop the run; do not execute journeys against an unhealthy target

## Artifact Capture

Capture reproducible evidence for every failed journey.

### Canonical storage path
Store artifacts in `.kiln/tracks/phase-N/artifacts/`.

### Required capture by project type
- Web UI: screenshot on every failure
- API: response body and headers for failed assertions
- CLI: full stdout/stderr for failed commands
- Library: serialized inputs and thrown error details for failed journeys

### Global required capture
For all project types:
- Test execution log
- Failing journey identifier and mapped acceptance criteria
- Timestamp and environment metadata

### Naming conventions
Use stable names:
- `failure-<journey-id>.png`
- `failure-<journey-id>-response.json`
- `failure-<journey-id>-stderr.log`
- `e2e-run.log`

## Regression Suite Protocol

The E2E suite is cumulative and phase-scoped.

### Directory organization
Organize tests by phase under `tests/e2e/phase-N/`.
Examples:
- `tests/e2e/phase-1/journey-01-first-run.test.ts`
- `tests/e2e/phase-2/journey-03-auth-refresh.test.ts`

### Growth rules
- Each new phase adds new journey tests
- Preserve prior journey files unless explicitly deprecated
- New tests must follow the same journey naming and traceability conventions

### Regression execution rules
- Every E2E cycle runs all current-phase journeys
- Every E2E cycle also runs all prior-phase journeys
- A phase is not E2E-pass unless the full regression set passes

### Failure category
If previously passing journeys fail after new changes, classify as `regression-bug`.
Record this classification in `e2e-results.md` with failing journey IDs and suspected area.

### Commit protocol
After a successful full E2E pass:
- Commit new journey tests with the corresponding code changes
- Keep E2E tests in git as permanent regression assets
- Ensure default E2E runs include all prior phase journeys

### Pruning protocol
Regression pruning is operator-controlled between phases.
If pruning is approved:
1. Mark the test deprecated in header or commit notes
2. Document replacement coverage
3. Remove only after equivalent/better journey coverage exists

### Minimal run order
1. Read phase acceptance criteria from PLAN
2. Select current-phase journeys
3. Load all prior-phase journeys
4. Run startup detection (if applicable)
5. Execute full suite
6. Capture artifacts for all failures
7. Publish `e2e-results.md` with pass/fail or `regression-bug`

### Guardrails
- Keep test data deterministic
- Avoid non-reproducible randomness unless seeded and recorded
- Fix flaky journeys instead of muting them
- Favor resilient selectors, stable fixtures, and explicit readiness checks
