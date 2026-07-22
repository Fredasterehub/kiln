import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Wave 3 (W3-ARCH-06): the onboarding preflight's brownfield classifier is a
// bounded DETERMINISTIC unit, never model judgment. Each fixture builds a real
// target dir on disk (the harness mkdtemp pattern) and asserts the single stdout
// token. The helper always exits 0 — the verdict is the token, not the status.
const SCRIPT = fileURLToPath(new URL('../scripts/detect-brownfield.sh', import.meta.url))
const detect = (dir) => {
  const r = spawnSync('bash', [SCRIPT, dir], { encoding: 'utf8' })
  assert.equal(r.status, 0, 'the preflight always exits 0 — the verdict is the stdout token')
  return r.stdout.trim()
}
const fixture = () => mkdtempSync(join(tmpdir(), 'kiln-bf-'))

test('detect-brownfield: an empty dir is greenfield — nothing to build on', () => {
  assert.equal(detect(fixture()), 'greenfield')
})

test('detect-brownfield: an initialized-but-empty git repo (only .git) is greenfield — VCS metadata is not substance', () => {
  const dir = fixture()
  mkdirSync(join(dir, '.git/objects'), { recursive: true })
  writeFileSync(join(dir, '.git/HEAD'), 'ref: refs/heads/main\n')
  assert.equal(detect(dir), 'greenfield')
})

test('detect-brownfield: a manifest-only dir (just package.json) is brownfield — a declared project', () => {
  const dir = fixture()
  writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n')
  assert.equal(detect(dir), 'brownfield')
})

test('detect-brownfield: a source-only dir (a .js file, no manifest) is brownfield — substantive source on disk', () => {
  const dir = fixture()
  writeFileSync(join(dir, 'app.js'), 'console.log(1)\n')
  assert.equal(detect(dir), 'brownfield')
})

// The pruning and prose-only rules the four canonical fixtures do not exercise —
// pinned so a future edit cannot silently widen brownfield to docs or vendored trees.
test('detect-brownfield: a prose-only scaffold (README + LICENSE + docs) is greenfield — docs are not code', () => {
  const dir = fixture()
  writeFileSync(join(dir, 'README.md'), '# Project\n')
  writeFileSync(join(dir, 'LICENSE'), 'MIT\n')
  mkdirSync(join(dir, 'docs'))
  writeFileSync(join(dir, 'docs/guide.md'), 'a guide\n')
  assert.equal(detect(dir), 'greenfield')
})

test('detect-brownfield: source that lives only under a vendored/generated tree is pruned — greenfield', () => {
  const dir = fixture()
  mkdirSync(join(dir, 'node_modules/dep'), { recursive: true })
  writeFileSync(join(dir, 'node_modules/dep/index.js'), 'module.exports = {}\n')
  writeFileSync(join(dir, 'README.md'), '# just docs\n')
  assert.equal(detect(dir), 'greenfield')
})

test('detect-brownfield: source under a generated/ tree is pruned — greenfield (a generated tree is not authored substance)', () => {
  const dir = fixture()
  mkdirSync(join(dir, 'generated'), { recursive: true })
  writeFileSync(join(dir, 'generated/schema.ts'), 'export type T = 1\n')
  writeFileSync(join(dir, 'README.md'), '# just docs\n')
  assert.equal(detect(dir), 'greenfield')
})

test('detect-brownfield: nested source under a real tree is brownfield — the walk is not surface-only', () => {
  const dir = fixture()
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src/index.ts'), 'export const x = 1\n')
  assert.equal(detect(dir), 'brownfield')
})

// The three non-extension arms — entry point, test tree, executable — pinned so
// classification is never reducible to manifest basenames + a source allowlist.
// Each isolates its arm: without it these dirs would classify greenfield.
test('detect-brownfield: an entry point (index.html) is brownfield — a runnable web root is a project to build on', () => {
  const dir = fixture()
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>x</title>\n')
  assert.equal(detect(dir), 'brownfield')
})

test('detect-brownfield: a test tree (tests/x.feature) is brownfield — authored tests are substance whatever the extension', () => {
  const dir = fixture()
  mkdirSync(join(dir, 'tests'), { recursive: true })
  writeFileSync(join(dir, 'tests/x.feature'), 'Feature: x\n')
  writeFileSync(join(dir, 'README.md'), '# just docs\n')
  assert.equal(detect(dir), 'brownfield')
})

test('detect-brownfield: an executable extensionless entry point (bin/app) is brownfield — a runnable program is substance', () => {
  const dir = fixture()
  mkdirSync(join(dir, 'bin'), { recursive: true })
  const app = join(dir, 'bin/app')
  writeFileSync(app, '#!/usr/bin/env node\nconsole.log(1)\n')
  chmodSync(app, 0o755)
  writeFileSync(join(dir, 'README.md'), '# just docs\n')
  assert.equal(detect(dir), 'brownfield')
})
