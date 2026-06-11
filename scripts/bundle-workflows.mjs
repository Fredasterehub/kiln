#!/usr/bin/env node
// bundle-workflows.mjs — dev-side inliner for the Kiln workflow scripts. Zero dependencies.
//
// Workflow scripts run inside the native Workflow sandbox and CANNOT import. v2 paid for that
// with hand-duplicated blocks ("identical block" comments ×6 files). v3 keeps the shared pure
// functions in plugins/kiln/src/*.mjs (unit-tested once) and inlines them mechanically:
//
//   plugins/kiln/workflows-src/<name>.js — the editable source; marker lines declare inlines:
//     // @inline:<module>:<export>[,<export>...]
//   plugins/kiln/workflows/<name>.js     — GENERATED; never edit by hand.
//
// Each marker is replaced with the exact source text of those exports (the `export ` keyword
// stripped), in marker order. Deterministic and idempotent: same input → byte-identical output.
// Every emitted file is syntax-checked with `node --check`; any failure exits non-zero.
//
// Usage: node scripts/bundle-workflows.mjs [--check]
//   --check  write nothing; exit 1 if any generated file is out of sync (for validate-release.sh).

import { readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'plugins/kiln/src')
const wfSrcDir = join(root, 'plugins/kiln/workflows-src')
const wfOutDir = join(root, 'plugins/kiln/workflows')
const checkMode = process.argv.includes('--check')

// ── Parse a src module into { exportName → declaration text }, `export ` keyword stripped. ──
// A block runs from its `export` line to the line before the next one (or EOF), with trailing
// blank/comment-only lines trimmed — module-level commentary never leaks into a workflow.
const EXPORT_RE = /^export\s+(?:async\s+)?(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/
function parseModule(file) {
  const lines = readFileSync(file, 'utf8').split('\n')
  const starts = []
  lines.forEach((line, i) => { const m = line.match(EXPORT_RE); if (m) starts.push({ name: m[1], at: i }) })
  const blocks = {}
  starts.forEach((s, idx) => {
    let end = idx + 1 < starts.length ? starts[idx + 1].at : lines.length
    while (end > s.at && (lines[end - 1].trim() === '' || lines[end - 1].trim().startsWith('//'))) end--
    blocks[s.name] = lines.slice(s.at, end).join('\n').replace(/^export\s+/, '')
  })
  return blocks
}
const modules = {}
for (const f of readdirSync(srcDir).filter((f) => f.endsWith('.mjs')).sort()) {
  modules[f.replace(/\.mjs$/, '')] = parseModule(join(srcDir, f))
}

// ── Bundle one workflow source: replace each marker line with the named export declarations. ──
const MARKER_RE = /^\/\/ @inline:([\w-]+):([\w$]+(?:,[\w$]+)*)\s*$/
function bundle(name, src) {
  const body = src.split('\n').map((line) => {
    const m = line.match(MARKER_RE)
    if (!m) return line
    const [, mod, names] = m
    const blocks = modules[mod]
    if (!blocks) throw new Error(`${name}: marker references unknown module '${mod}'`)
    return names.split(',').map((n) => {
      if (!blocks[n]) throw new Error(`${name}: module '${mod}' has no export '${n}'`)
      return blocks[n]
    }).join('\n')
  }).join('\n')
  return `// GENERATED from workflows-src/${name} — edit the source, run scripts/bundle-workflows.mjs\n${body}`
}

// ── Generate, syntax-check, then write/compare. The temp path keeps the .js extension: workflow
//    scripts use top-level `return` (the Workflow sandbox evaluates them as a function body),
//    which node --check accepts for .js but rejects under a strict-ESM .mjs parse — this mirrors
//    exactly how validate-release.sh checks the shipped files. ──
const outOfSync = []
const tmp = mkdtempSync(join(tmpdir(), 'kiln-bundle-'))
try {
  for (const name of readdirSync(wfSrcDir).filter((f) => f.endsWith('.js')).sort()) {
    const generated = bundle(name, readFileSync(join(wfSrcDir, name), 'utf8'))
    const tmpFile = join(tmp, name)
    writeFileSync(tmpFile, generated)
    try {
      execFileSync(process.execPath, ['--check', tmpFile], { stdio: ['ignore', 'ignore', 'pipe'] })
    } catch (e) {
      console.error(`bundle-workflows: generated ${name} fails node --check\n${e.stderr || e.message}`)
      process.exit(1)
    }
    const outFile = join(wfOutDir, name)
    let current = null
    try { current = readFileSync(outFile, 'utf8') } catch (e) { /* missing → out of sync */ }
    if (current === generated) continue
    if (checkMode) outOfSync.push(name)
    else { writeFileSync(outFile, generated); console.log(`bundled workflows/${name}`) }
  }
} finally { rmSync(tmp, { recursive: true, force: true }) }

if (checkMode && outOfSync.length) {
  console.error(`bundle-workflows --check: OUT OF SYNC: ${outOfSync.join(', ')} — run 'node scripts/bundle-workflows.mjs'`)
  process.exit(1)
}
console.log(checkMode ? 'bundle-workflows --check: all generated workflows in sync' : 'bundle-workflows: done')
