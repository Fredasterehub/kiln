import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  postureToDials, POSTURE_SCOPE, POSTURE_NOVELTY, POSTURE_REVERSIBILITY,
} from '../scripts/gauge-dial.mjs'

// The Gauge dial projector, W4: postureToDials moved out of workflows/kernel.js (body-local, no
// production consumer, not importable from a Workflow body) into scripts/gauge-dial.mjs. These
// are the retargeted dial tests — now driving the imported script instead of the kernel core.
const SCRIPT = fileURLToPath(new URL('../scripts/gauge-dial.mjs', import.meta.url))

test('gauge-dial: postureToDials — each monotone predicate toggles on both branches', () => {
  // small + familiar + reversible, no visual → every dial at its floor
  assert.deepEqual(
    postureToDials({ scope: 'small', novelty: 'familiar', reversibility: 'reversible' }, false),
    { width: 'floor', research: 'off', perceptual: 'dormant', recovery_cap: 2, xhigh_permit: false },
  )
  // novel (small, reversible) + visual → width/research/xhigh open via novelty, perceptual on, cap stays 2
  assert.deepEqual(
    postureToDials({ scope: 'small', novelty: 'novel', reversibility: 'reversible' }, true),
    { width: 'wide', research: 'on', perceptual: 'on', recovery_cap: 2, xhigh_permit: true },
  )
  // large + familiar + risky → width opens via scope, research via risky, cap 1, xhigh still shut
  assert.deepEqual(
    postureToDials({ scope: 'large', novelty: 'familiar', reversibility: 'risky' }, false),
    { width: 'wide', research: 'on', perceptual: 'dormant', recovery_cap: 1, xhigh_permit: false },
  )
  // small + familiar + irreversible → width stays floor, research + xhigh open via irreversible, cap 1
  assert.deepEqual(
    postureToDials({ scope: 'small', novelty: 'familiar', reversibility: 'irreversible' }, false),
    { width: 'floor', research: 'on', perceptual: 'dormant', recovery_cap: 1, xhigh_permit: true },
  )
  // perceptual keys on strict === true — a truthy non-boolean stays dormant on a valid posture
  const valid = { scope: 'small', novelty: 'familiar', reversibility: 'reversible' }
  assert.equal(postureToDials(valid, 1).perceptual, 'dormant', 'a truthy non-boolean is not true — perceptual stays dormant')
  assert.equal(postureToDials(valid, 'yes').perceptual, 'dormant')
  assert.equal(postureToDials(valid, undefined).perceptual, 'dormant')
})

test('gauge-dial: postureToDials fails UPWARD to max scrutiny on any untrustworthy posture — never throws', () => {
  const MAX = { width: 'wide', research: 'on', perceptual: 'on', recovery_cap: 1, xhigh_permit: true }
  const good = { scope: 'small', novelty: 'familiar', reversibility: 'reversible' }
  // missing / null / non-object / array
  assert.deepEqual(postureToDials(undefined, false), MAX, 'a missing posture → max scrutiny')
  assert.deepEqual(postureToDials(null, false), MAX)
  assert.deepEqual(postureToDials('small', false), MAX, 'a non-object posture → max scrutiny')
  assert.deepEqual(postureToDials(['small', 'familiar', 'reversible'], false), MAX, 'an array posture → max scrutiny')
  // missing a field / extra field — enumerable, non-enumerable, and Symbol own
  // fields all count: Object.keys would drop the last two and take the low path.
  assert.deepEqual(postureToDials({ scope: 'small', novelty: 'novel' }, false), MAX, 'a missing field → max scrutiny')
  assert.deepEqual(postureToDials({ ...good, extra: 1 }, false), MAX, 'an extra enumerable field → max scrutiny')
  const nonEnum = { ...good }; Object.defineProperty(nonEnum, 'extra', { enumerable: false, value: 1 })
  assert.deepEqual(postureToDials(nonEnum, false), MAX, 'a non-enumerable extra own field → max scrutiny (Reflect.ownKeys sees it)')
  assert.deepEqual(postureToDials({ ...good, [Symbol('extra')]: 1 }, false), MAX, 'a Symbol own field → max scrutiny')
  // any field out of its frozen enum
  assert.deepEqual(postureToDials({ ...good, scope: 'medium' }, false), MAX, 'an unknown scope → max scrutiny')
  assert.deepEqual(postureToDials({ ...good, novelty: 'weird' }, false), MAX, 'an unknown novelty → max scrutiny')
  assert.deepEqual(postureToDials({ ...good, reversibility: 'maybe' }, false), MAX, 'an unknown reversibility → max scrutiny')
  // the fail-up profile overrides the visual predicate — perceptual stays 'on' even with visual false
  assert.equal(postureToDials(null, false).perceptual, 'on', 'max scrutiny regardless of the visual flag')
  // never throws — even on adversarial input for either argument
  assert.doesNotThrow(() => postureToDials(Symbol('x'), Symbol('y')))
  // and it must survive the reflective step (Reflect.ownKeys) and property reads
  // (destructuring getters), not just the typeof short-circuit a Symbol takes: a
  // throwing ownKeys trap, a throwing getter on a well-shaped posture, and a
  // revoked proxy all fail UP to max scrutiny rather than propagate.
  const ownKeysBomb = new Proxy({}, { ownKeys() { throw new Error('ownKeys boom') } })
  assert.deepEqual(postureToDials(ownKeysBomb, false), MAX, 'a throwing ownKeys trap fails up, never throws')
  const getterBomb = { novelty: 'novel', reversibility: 'reversible' }
  Object.defineProperty(getterBomb, 'scope', { enumerable: true, get() { throw new Error('getter boom') } })
  assert.deepEqual(postureToDials(getterBomb, false), MAX, 'a throwing getter (past the field-count check) fails up, never throws')
  const rev = Proxy.revocable({}, {}); rev.revoke()
  assert.deepEqual(postureToDials(rev.proxy, false), MAX, 'a revoked proxy fails up, never throws')
})

test('gauge-dial: postureToDials names no effort tier — it toggles organs, never low/medium/high/xhigh', () => {
  const dials = postureToDials({ scope: 'large', novelty: 'novel', reversibility: 'irreversible' }, true)
  assert.deepEqual(Object.keys(dials).sort(), ['perceptual', 'recovery_cap', 'research', 'width', 'xhigh_permit'])
  assert.ok(!('effort' in dials), 'the dial profile carries no effort field')
  for (const v of Object.values(dials)) {
    assert.ok(!['low', 'medium', 'high', 'xhigh'].includes(v), 'no dial value is an effort tier — effort stays the tier file\'s job')
  }
})

// The projector duplicates the frozen enums the kernel keeps for validatePosture. This is the
// drift guard: extract the kernel's POSTURE_* from its pure-core region and assert the projector's
// exported copies are byte-for-byte the same three arrays.
test('gauge-dial: the projector enums agree with the kernel POSTURE_* enums — the duplication cannot drift', () => {
  const kernelSrc = readFileSync(fileURLToPath(new URL('../workflows/kernel.js', import.meta.url)), 'utf8')
  const lines = kernelSrc.split('\n')
  const coreSrc = lines.slice(
    lines.findIndex(l => l.includes('KERNEL_CORE_BEGIN')) + 1,
    lines.findIndex(l => l.includes('KERNEL_CORE_END')),
  ).join('\n')
  const kernel = new Function(coreSrc + '\nreturn { POSTURE_SCOPE, POSTURE_NOVELTY, POSTURE_REVERSIBILITY }')()
  assert.deepEqual(POSTURE_SCOPE, kernel.POSTURE_SCOPE, 'scope enum agrees with the kernel')
  assert.deepEqual(POSTURE_NOVELTY, kernel.POSTURE_NOVELTY, 'novelty enum agrees with the kernel')
  assert.deepEqual(POSTURE_REVERSIBILITY, kernel.POSTURE_REVERSIBILITY, 'reversibility enum agrees with the kernel')
  // Frozen, not just equal: a runtime POSTURE_SCOPE.push('medium') must not widen what the
  // projector accepts past what the kernel gate validates — the agreement survives mutation.
  assert.ok(Object.isFrozen(POSTURE_SCOPE) && Object.isFrozen(POSTURE_NOVELTY) && Object.isFrozen(POSTURE_REVERSIBILITY),
    'the projector enums are frozen — the enum-agreement invariant cannot be defeated by a push')
})

// The narrow executable entry: reads .kiln/posture.json from the cwd, prints the dials JSON,
// exits 0. A valid posture projects its dials (visual flag defaults false → perceptual dormant);
// a missing or malformed posture falls through to the fail-up default. This is the fact
// research-sweep.js reads for the research dial.
function runScript(posture) {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-gauge-'))
  if (posture !== undefined) {
    mkdirSync(join(dir, '.kiln'), { recursive: true })
    writeFileSync(join(dir, '.kiln/posture.json'), typeof posture === 'string' ? posture : JSON.stringify(posture))
  }
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' })
  return r
}

test('gauge-dial: the executable prints the projected dials for a valid posture and exits 0', () => {
  const r = runScript({ scope: 'small', novelty: 'novel', reversibility: 'reversible' })
  assert.equal(r.status, 0, 'the projector exits 0')
  assert.deepEqual(JSON.parse(r.stdout), postureToDials({ scope: 'small', novelty: 'novel', reversibility: 'reversible' }, false),
    'the printed dials match the pure projection at visual=false')
  assert.equal(JSON.parse(r.stdout).research, 'on', 'novel work turns research on — the fact research-sweep reads')
})

test('gauge-dial: a low posture prints research off — the stand-down fact', () => {
  const r = runScript({ scope: 'small', novelty: 'familiar', reversibility: 'reversible' })
  assert.equal(r.status, 0)
  assert.equal(JSON.parse(r.stdout).research, 'off', 'familiar reversible small work stands research down')
})

test('gauge-dial: a missing, unreadable, or malformed posture fails UP to max scrutiny — still exits 0', () => {
  for (const posture of [undefined, 'not json', '"a bare string"', '[1,2,3]', JSON.stringify({ scope: 'small' }), JSON.stringify({ scope: 'small', novelty: 'novel', reversibility: 'reversible', extra: 1 })]) {
    const r = runScript(posture)
    assert.equal(r.status, 0, 'the projector always exits 0 — it never fails the caller closed')
    assert.deepEqual(JSON.parse(r.stdout), { width: 'wide', research: 'on', perceptual: 'on', recovery_cap: 1, xhigh_permit: true },
      'an untrustworthy posture projects the max-scrutiny profile — research on')
  }
})
