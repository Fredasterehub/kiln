# Validation Strategies by Product Type

On-demand reference for argus — the Step 6 validator running on sonnet at medium effort, checking a concrete deliverable against acceptance criteria. This file is the catalog of non-web validation techniques argus reaches for when a running browser and dev server are not the right fit: CLI tools, libraries, services, extensions, desktop apps, mobile builds. The main argus instructions cover the Playwright-first web flow; this file covers everything else. On-demand load, not preloaded.

Read the detection section first, then jump to the section for the product you're validating — each per-type section is self-contained.

## Product Type Detection

Check these files at the project root to classify the product:

| Indicator | Product Type |
|-----------|-------------|
| `manifest.json` with `manifest_version` + `permissions`/`background` | Chrome Extension |
| `package.json` with `bin` field and no app framework | CLI Tool |
| `electron` in dependencies or devDependencies | Electron Desktop App |
| `express`/`fastify`/`nest`/`koa`/`flask`/`django`/`fastapi` dependency | REST/GraphQL API |
| `package.json` with `exports` but no app framework or `bin` | Library/Package |
| `react-native`/`expo` dependency or `pubspec.yaml` | Mobile App |
| `index.html` or web framework (React/Vue/Next.js/SvelteKit/Nuxt) | Web App (default) |

When multiple indicators match, pick the most specific. A project with both `express` and `react` is a web app with an API — validate both layers. If ambiguous, default to Web App.

## Chrome Extension

**Key checks:**
- Manifest V3 compliance: `jq . manifest.json` + verify `manifest_version`, `name`, `version`
- Permission audit: Grep for `chrome.` API usage, cross-check against declared `permissions`
- Storage API usage: Grep for `localStorage` — flag if architecture requires `chrome.storage`
- Content script patterns: verify `matches` in manifest target intended URLs
- Background service worker: verify `service_worker` entry exists in manifest

**Tools:** Bash (manifest validation via jq), Grep (permission and API audit), Read (file inspection)
**Playwright:** Static analysis only. MCP browser tools cannot load extensions — no E2E browser testing available.

## CLI Tool

**Key checks:**
- Exit codes: success (0), failure (non-zero) for valid/invalid inputs
- Flag parsing: `--help`, `--version`, short/long flags
- Output format: stdout/stderr separation, valid JSON if `--json` flag exists
- Error messages meaningful and on stderr
- Dependency availability checks (runtime prerequisites)

**Tools:** Bash (direct invocation), Grep (output pattern matching)
**Playwright:** Not applicable

## Electron Desktop App

**Key checks:**
- Build output: verify build succeeds and produces expected artifacts
- Main/preload/renderer structure: correct separation of concerns
- IPC handlers: Grep for `ipcMain.handle`/`ipcRenderer.invoke` — verify matching channels
- Preload bridge: verify `contextBridge.exposeInMainWorld` usage, no direct `require` in renderer
- Security: check `nodeIntegration` is disabled, `contextIsolation` enabled in BrowserWindow config

**Tools:** Bash (build verification), Grep (IPC audit, security config check), Read (file inspection)
**Playwright:** Static analysis only. MCP browser tools cannot launch Electron apps — no E2E testing available.

## REST/GraphQL API

**Key checks:**
- Endpoint existence: all documented routes respond (via curl)
- Status codes: correct HTTP codes for success/error paths
- Response schema validation (JSON structure matches spec)
- Auth mechanisms work (bearer, API key, etc.)
- Error responses: 4xx/5xx include meaningful messages
- Request validation: invalid payloads rejected with 400
- GraphQL-specific: schema introspection, query/mutation testing

**Tools:** Bash/curl (endpoint testing, JSON validation via jq), Grep (route discovery)
**Playwright:** Not applicable for pure API. Useful if API has admin dashboard.

## Library/Package

**Key checks:**
- Exports field correctness (import/require/types entry points)
- Type definitions present and compilable (`tsc --noEmit`)
- Entry point accessible (`node -e "require('.')"` or equivalent)
- Package contents: `npm pack --dry-run` to verify only needed files ship
- Build output: verify dist/ or lib/ contains expected artifacts

**Tools:** Bash (tsc, npm pack, node -e), Grep (export verification)
**Playwright:** Not applicable

## Mobile App

**Key checks:**
- Business logic tests pass (Jest/unit tests)
- Build succeeds for target platforms
- API connectivity verified (mock or real endpoints)
- Config/environment validation
- Type checking passes (if TypeScript)

**Tools:** Bash (build commands, test runners)
**Playwright:** Not applicable (no simulator control). Only for companion web builds.

## Web App (Default)

Use the standard Playwright validation flow defined in argus's main instructions: navigate, interact, screenshot, assert against acceptance criteria.
