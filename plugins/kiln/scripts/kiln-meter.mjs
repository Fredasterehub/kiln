#!/usr/bin/env node
// kiln-meter.mjs — the driver-token meter. Zero dependencies, plain node ≥18.
//
// Measures what THIS session actually spent: the sum of input + output tokens over the
// assistant turns in a Claude Code transcript. Cache tokens (cache_read/cache_creation) are
// EXCLUDED by definition — they are not driver spend. The conductor runs this once, at the
// completion beat, to fill the {driver} slot with a measured number rather than a guess; if it
// exits nonzero the completion line is spoken unmetered, never with an invented figure.
//
// The FIELD it sums: each assistant turn is billed once per requestId, but a single request can
// surface as several assistant events in the ledger (streaming, tool-use continuations). The last
// such event per requestId carries the final, complete usage — so we keep the LAST assistant event
// per unique requestId (file order) and sum input_tokens + output_tokens over exactly those.
//
// Usage:
//   kiln-meter.mjs [--transcript <path>]
// With --transcript: measure that file. Without it, resolve the current session's transcript:
//   1. env CLAUDE_CODE_SESSION_ID names the session (unset → exit 1);
//   2. look under ~/.claude/projects/<munged-cwd>/<sid>.jsonl, where <munged-cwd> is process.cwd()
//      with every character not [A-Za-z0-9] replaced by '-' (Claude Code's project-dir convention);
//   3. failing that, scan every ~/.claude/projects/*/ subdir for <sid>.jsonl;
//   4. none found → exit 1.
// stdout carries ONLY the integer (newline-terminated); every diagnostic goes to stderr.
// Exit codes: 0 ok · 1 error · 2 usage.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const die = (msg, code = 1) => { console.error(`kiln-meter: ${msg}`); process.exit(code) }
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
const num = (x) => (typeof x === 'number' && Number.isFinite(x)) ? x : 0

const USAGE = 'usage: kiln-meter.mjs [--transcript <path>]'

// ── Transcript resolution ──────────────────────────────────────────────────────────────────────
// An explicit --transcript is returned as-given (a missing file surfaces later, at read). Otherwise
// the current session's transcript is located by session id: the munged-cwd dir first (the common
// case, one lookup), then a scan of every project dir (a session whose cwd differs from where the
// meter runs).
function resolveTranscript(explicit) {
  if (explicit !== undefined) return explicit
  const sid = process.env.CLAUDE_CODE_SESSION_ID
  if (!sid) die('no --transcript given and CLAUDE_CODE_SESSION_ID is unset — cannot resolve the session transcript')
  const projects = join(homedir(), '.claude', 'projects')
  const munged = process.cwd().replace(/[^A-Za-z0-9]/g, '-')
  const direct = join(projects, munged, `${sid}.jsonl`)
  if (existsSync(direct)) return direct
  let entries = []
  try { entries = readdirSync(projects, { withFileTypes: true }) } catch (e) { die(`cannot read ${projects} to locate session ${sid} — ${e.message}`) }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const cand = join(projects, e.name, `${sid}.jsonl`)
    if (existsSync(cand)) return cand
  }
  die(`no transcript found for session ${sid} under ${projects} (looked in ${munged}/ and every project dir)`)
}

// ── Measurement ──────────────────────────────────────────────────────────────────────────────────
// Last-write-wins per requestId: Map.set overwrites the stored usage in file order, so after the
// pass each requestId holds its final usage. Unparsable lines are skipped silently — a transcript is
// an append log that may end mid-write, and a torn line is not a measurement error.
function measure(file) {
  let raw
  try { raw = readFileSync(file, 'utf8') } catch (e) { die(`cannot read transcript ${file} — ${e.message}`) }
  const lastUsage = new Map()
  for (const line of raw.split('\n')) {
    if (line === '') continue
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    if (isObj(ev) && ev.type === 'assistant' && ev.requestId && isObj(ev.message) && isObj(ev.message.usage)) {
      lastUsage.set(ev.requestId, ev.message.usage)
    }
  }
  let sum = 0
  for (const u of lastUsage.values()) sum += num(u.input_tokens) + num(u.output_tokens)
  return sum
}

// ── Dispatch ─────────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
let transcript
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--transcript') {
    if (argv[i + 1] === undefined) die(`--transcript needs a path — ${USAGE}`, 2)
    transcript = argv[++i]
  } else {
    die(`unknown argument '${argv[i]}' (only --transcript is accepted) — ${USAGE}`, 2)
  }
}

try {
  process.stdout.write(String(measure(resolveTranscript(transcript))) + '\n')
} catch (e) { die(e.message) }
