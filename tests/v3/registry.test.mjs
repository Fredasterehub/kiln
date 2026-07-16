// registry.test.mjs — the registry guards itself. tests/v3/index.js is a STATIC import list
// (modern node loads the directory via this entry; an unregistered *.test.mjs silently never
// runs in the suite). This has bitten twice (roster.test.mjs at, packaging.test.mjs at
// the latter hid 13 guards incl. the README footer byte-locks for a full phase).
// This drill makes the class impossible: every *.test.mjs on disk must be imported.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = dirname(fileURLToPath(import.meta.url))

test('every tests/v3/*.test.mjs is imported by index.js — no silently-unregistered test files', () => {
  // Parse REAL import statements only (line-anchored) — a commented-out `// import './x.test.mjs'`
  // must NOT satisfy the guard (reviewer-probed failure mode). Set equality both ways: an
  // unregistered file on disk fails, and an import of a deleted file fails too.
  const index = readFileSync(join(DIR, 'index.js'), 'utf8')
  const imported = index.split('\n')
    .map((l) => l.match(/^import '\.\/(.+\.test\.mjs)'$/))
    .filter(Boolean)
    .map((m) => m[1])
    .sort()
  const onDisk = readdirSync(DIR).filter((f) => f.endsWith('.test.mjs')).sort()
  assert.deepEqual(imported, onDisk,
    `index.js imports and on-disk *.test.mjs files must match exactly (missing imports fail; imports of deleted files fail)`)
})
