---
name: kiln-e2e
description: "End-to-end test generation patterns, user journey format, and regression suite protocol"
---
# Kiln E2E Testing
Use this skill to generate behavior-first end-to-end tests tied to plan acceptance criteria.
It defines journey format, per-project test templates, startup detection, artifacts, and regression growth.
## User Journey Tests
E2E tests in kiln are USER JOURNEYS, not unit tests or isolated integration probes.
A journey simulates a real user workflow from start to finish and verifies user-visible outcomes.
Each journey maps to one or more acceptance criteria from `.kiln/tracks/phase-N/PLAN.md`.
### Journey principles
- Test behavior, not implementation details.
- Keep checkpoints user-observable (screen text, URL, API contract, CLI outputs, public library API).
- Prefer end-to-end flow assertions over helper-level assertions.
- Keep setup deterministic and cleanup explicit.
### Contrast
- BAD (unit): `expect(validateEmail('a@b.com')).toBe(true)`
- BAD (integration): `expect(db.users.count()).toBe(1)`
- GOOD (journey): `User opens signup page, enters email/password, submits, sees dashboard welcome message`
### Journey structure
1. Preconditions (service reachable, fixtures ready)
2. User actions (realistic sequence)
3. Behavior checks (expected outcome)
4. Cleanup (remove created state)
5. Failure evidence capture
### Naming
Use: `journey-NN-descriptive-slug.test.{js,ts,sh}`
Examples:
- `journey-01-signup-happy-path.test.ts`
- `journey-02-auth-token-refresh.test.js`
- `journey-03-init-build-output.test.sh`
## Web UI: Playwright Patterns
Use Playwright for `web-ui` projects. Prefer stable selectors (`getByRole`, `getByLabel`, `getByTestId`).
### Template
```ts
import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.goto('http://localhost:3000');
});
test.afterEach(async ({ page }) => {
  await page.close();
});
test('journey-01-descriptive-slug', async ({ page }) => {
  await page.click('text=Start');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});
```
### Complete signup journey example
```ts
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
test('journey-01-signup-happy-path', async ({ page }) => {
  const outDir = '.kiln/tracks/phase-2/artifacts';
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
  } catch (err) {
    await fs.mkdir(outDir, { recursive: true });
    await page.screenshot({ path: 'artifacts/failure-01.png', fullPage: true });
    await page.screenshot({ path: `${outDir}/failure-01-signup.png`, fullPage: true });
    throw err;
  }
});
```
### Core navigation and assertion patterns
- Navigation: `page.goto()`, `page.click()`, `page.fill()`
- Assertions: `toBeVisible()`, `toContainText()`, `toHaveURL()`
- Waits: `page.waitForSelector()`, `page.waitForURL()`, `page.waitForLoadState()`
### Anti-patterns
- Avoid `page.waitForTimeout()` for synchronization (flaky).
- Avoid CSS-style assertions for behavioral journeys (brittle).
- Avoid selectors tied to generated class names.
## API Server: HTTP Patterns
Use native `fetch` for `api-server` journeys and verify full contract behavior.
### Template
```ts
import assert from 'node:assert/strict';
const base = process.env.E2E_BASE_URL ?? 'http://localhost:4000';
(async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
})();
```
### Complete CRUD journey example
```ts
import assert from 'node:assert/strict';
const base = process.env.E2E_BASE_URL ?? 'http://localhost:4000';
async function run() {
  const create = await fetch(`${base}/api/items`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'alpha-item' }),
  });
  assert.equal(create.status, 201);
  assert.equal(create.headers.get('content-type')?.includes('application/json'), true);
  const { id } = await create.json();
  const read1 = await fetch(`${base}/api/items/${id}`);
  assert.equal(read1.status, 200);
  assert.equal((await read1.json()).name, 'alpha-item');
  const update = await fetch(`${base}/api/items/${id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'beta-item' }),
  });
  assert.equal(update.status, 200);
  const read2 = await fetch(`${base}/api/items/${id}`);
  assert.equal(read2.status, 200);
  assert.equal((await read2.json()).name, 'beta-item');
  const del = await fetch(`${base}/api/items/${id}`, { method: 'DELETE' });
  assert.equal(del.status, 204);
  const gone = await fetch(`${base}/api/items/${id}`);
  assert.equal(gone.status, 404);
}
run().catch((e) => { console.error(e); process.exit(1); });
```
### CRUD and auth journey patterns
- CRUD: `create -> read -> update -> read -> delete -> verify-gone`
- Auth: `register -> login -> use-token -> access-protected -> logout`
Auth snippet:
```ts
const login = await fetch(`${base}/auth/login`, { method: 'POST', headers, body });
const { token } = await login.json();
const me = await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${token}` } });
```
### Error journey patterns
- Invalid input returns `400`
- Unauthorized request returns `401`
```ts
const bad = await fetch(`${base}/api/items`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '' }),
});
if (bad.status !== 400) throw new Error(`Expected 400, got ${bad.status}`);
```
### Response validation checklist
- Status code
- Body structure and key fields
- Required headers
- Error envelope consistency
## CLI Tool: Subprocess Patterns
Use subprocess journeys for `cli-tool` projects. Run commands in isolated temp directories.
### Template
```ts
import { spawn } from 'node:child_process';
function run(cmd: string, args: string[], cwd: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const p = spawn(cmd, args, { cwd, env: process.env });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => (stdout += String(d)));
    p.stderr.on('data', (d) => (stderr += String(d)));
    p.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
```
### Complete init/build/verify journey example
```ts
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
function run(cmd: string, args: string[], cwd: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const p = spawn(cmd, args, { cwd, env: process.env });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => (stdout += String(d)));
    p.stderr.on('data', (d) => (stderr += String(d)));
    p.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
async function runJourney() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kiln-cli-journey-'));
  const init = await run('mycli', ['init', 'demo-app'], root);
  assert.equal(init.code, 0, `init failed: ${init.stderr}`);
  const dir = path.join(root, 'demo-app');
  const build = await run('mycli', ['build'], dir);
  assert.equal(build.code, 0, `build failed: ${build.stderr}`);
  const out = await fs.stat(path.join(dir, 'dist', 'index.js'));
  assert.equal(out.isFile(), true);
}
runJourney().catch((e) => { console.error(e); process.exit(1); });
```
### CLI journey rules
- Sequence: `init -> configure -> build -> verify output`
- Validate exit code (`0` success, non-zero for expected error journeys)
- Capture stderr for error journeys and assert expected message fragments
- Use unique working directories for every journey run
## Library: Import Patterns
Use import-based journeys for `library` projects and test the public API lifecycle.
### Template
```ts
import assert from 'node:assert/strict';
import { Client } from '../src/index.js';
async function runJourney() {
  const client = new Client();
  const result = await client.process({ input: 'hello' });
  assert.equal(result.output, 'HELLO');
}
runJourney().catch((e) => { console.error(e); process.exit(1); });
```
### Journey patterns
- `create -> configure -> process -> validate -> cleanup`
- Include error journeys for invalid input and boundary values
Error snippet:
```ts
let threw = false;
try { await client.process({ input: '' }); } catch { threw = true; }
if (!threw) throw new Error('Expected invalid input to throw');
```
### Async guidance
- Use `async/await` for promise APIs
- Await cleanup hooks to avoid dangling handles
- Avoid mixed callback/promise patterns in one test
## Startup Detection
Startup detection gates E2E execution when a long-running service must be ready first.
### Defaults
- Timeout: `30` seconds from `config.json` `preferences.e2eTimeout`
- Polling interval: `500ms`
- Timeout classification: `config-issue`
### Detection methods by project type
- Web UI: HTTP GET localhost until `200`
- API server: HTTP GET health endpoint until `200`
- CLI tool: not applicable (no long-running process)
- Library: not applicable (no long-running process)
### Configurable health endpoint
Custom health endpoint is configurable in `config.json`:
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
    } catch {}
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('config-issue: startup timeout exceeded; include startup logs in failure report');
}
```
### Timeout behavior
On timeout, categorize as `config-issue`, include startup logs, and stop the run before executing journeys.
## Artifact Capture
Capture reproducible evidence for all failed journeys.
### Storage path
Save artifacts under `.kiln/tracks/phase-N/artifacts/`.
### Required capture by project type
- Web UI: screenshot on every failure
- API: failed response bodies (and relevant headers)
- CLI: full stdout/stderr for failed commands
- Library: serialized inputs and thrown errors
### Required capture for all types
- Test execution log
- Journey ID and mapped acceptance criteria
- Timestamp and environment metadata
### Naming
- `failure-<journey-id>.png`
- `failure-<journey-id>-response.json`
- `failure-<journey-id>-stderr.log`
- `e2e-run.log`
## Regression Suite Protocol
E2E suites are cumulative and phase-organized.
### Test organization
Store tests in `tests/e2e/phase-N/`.
Each new phase adds new journey tests while preserving prior phase journeys.
### Regression execution
Every E2E cycle runs:
- current phase journeys
- all prior phase journeys
If previously passing journeys fail after new code, classify as `regression-bug` and record details in `e2e-results.md`.
### Commit protocol
After successful E2E:
- Commit new/updated journey tests to git with related code
- Keep prior journeys in the default regression set
### Pruning protocol
Regression pruning is operator-controlled between phases.
If pruning is approved:
1. Mark test deprecated
2. Document replacement coverage
3. Remove only after equivalent or broader coverage exists
### Minimal run order
1. Read PLAN acceptance criteria
2. Select current-phase journeys
3. Load prior-phase journeys
4. Run startup detection (if applicable)
5. Execute full suite
6. Capture failure artifacts
7. Write `e2e-results.md` with pass/fail or `regression-bug`
### Guardrails
- Keep data deterministic
- Use stable selectors/endpoints/fixtures
- Treat flakes as bugs to fix, not tests to mute
