import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// kiln-meter is a trusted CLI, not an importable module — exercise it exactly the way the conductor
// does, as a child process, and read the integer off stdout.
const SCRIPT = fileURLToPath(new URL('../scripts/kiln-meter.mjs', import.meta.url))

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
    return { code: 0, stdout, stderr: '' }
  } catch (e) {
    return { code: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

// Each line is serialized to JSONL; raw strings pass through so a test can inject a torn line.
function fixture(lines) {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-meter-'))
  const p = join(dir, 'transcript.jsonl')
  writeFileSync(p, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n')
  return p
}

const asst = (requestId, usage) => ({ type: 'assistant', requestId, message: { usage } })

test('last-per-requestId: only the final event for a requestId counts', () => {
  const p = fixture([
    asst('r1', { input_tokens: 10, output_tokens: 1 }),
    asst('r1', { input_tokens: 10, output_tokens: 2 }),
    asst('r1', { input_tokens: 10, output_tokens: 5 }),
  ])
  const { code, stdout } = run(['--transcript', p])
  assert.equal(code, 0)
  assert.equal(stdout, '15\n') // 10 + 5, the last event only
})

test('cache fields are excluded — only input_tokens + output_tokens sum', () => {
  const p = fixture([
    asst('r1', {
      input_tokens: 3, output_tokens: 7,
      cache_read_input_tokens: 99999, cache_creation_input_tokens: 88888,
    }),
  ])
  const { code, stdout } = run(['--transcript', p])
  assert.equal(code, 0)
  assert.equal(stdout, '10\n')
})

test('multiple requestIds sum across the transcript', () => {
  const p = fixture([
    asst('r1', { input_tokens: 100, output_tokens: 20 }),
    asst('r2', { input_tokens: 5, output_tokens: 5 }),
  ])
  const { code, stdout } = run(['--transcript', p])
  assert.equal(code, 0)
  assert.equal(stdout, '130\n')
})

test('non-assistant, requestId-less, usage-less, and torn lines are ignored', () => {
  const p = fixture([
    { type: 'user', message: { content: 'hi' } },
    { type: 'assistant', message: { usage: { input_tokens: 500, output_tokens: 9 } } }, // no requestId
    { type: 'assistant', requestId: 'rX' }, // no message.usage
    'this is not json',
    asst('r1', { input_tokens: 40, output_tokens: 2 }), // the only countable event
  ])
  const { code, stdout } = run(['--transcript', p])
  assert.equal(code, 0)
  assert.equal(stdout, '42\n')
})

test('missing usage fields count as zero', () => {
  const p = fixture([
    asst('r1', { output_tokens: 7 }), // no input_tokens
    asst('r2', { input_tokens: 4 }), // no output_tokens
  ])
  const { code, stdout } = run(['--transcript', p])
  assert.equal(code, 0)
  assert.equal(stdout, '11\n')
})

test('--transcript pointing at a missing file exits 1 with empty stdout', () => {
  const missing = join(tmpdir(), 'kiln-meter-does-not-exist-' + Date.now(), 'nope.jsonl')
  const { code, stdout, stderr } = run(['--transcript', missing])
  assert.equal(code, 1)
  assert.equal(stdout, '')
  assert.match(stderr, /kiln-meter:/)
})

test('an unknown flag is a usage error (exit 2)', () => {
  const { code, stdout } = run(['--windows'])
  assert.equal(code, 2)
  assert.equal(stdout, '')
})
