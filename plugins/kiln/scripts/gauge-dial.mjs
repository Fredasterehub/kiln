#!/usr/bin/env node
// The Gauge dial projector — a trusted CONTROL-FACT script, not an evidence CLI. It maps a
// closed posture {scope, novelty, reversibility} plus a visual-artifact flag to five scrutiny
// organs. Each dial is an INDEPENDENT monotone predicate (never a lookup matrix), so a later
// posture field adds one predicate, not a combinatorial table. It names NO effort tier — it
// toggles organs and permits xhigh only; effort stays in data/tiers.json, never here.
//
// postureToDials was body-local in workflows/kernel.js (a Workflow async-body — not importable,
// and with no production consumer it never ran). research-sweep.js is its first real reader, so
// it lives here where it can both be imported and run as an exact-command leg. The frozen enums
// are duplicated from the kernel (validatePosture keeps its own copy for the LAW input gate);
// tests/gauge-dial.test.mjs asserts the two agree so the duplication cannot drift.
//
// FAIL-UPWARD: any missing, non-object, extra-field, or out-of-enum posture projects the
// max-scrutiny profile with recovery_cap 1 — the most scrutiny exactly when the posture is
// least trustworthy, regardless of the visual flag. Deterministic; never throws.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Frozen so a runtime `POSTURE_SCOPE.push('medium')` cannot widen what the projector accepts
// past what the kernel's validatePosture gate validates — the enum-agreement invariant survives
// mutation, not just value drift.
export const POSTURE_SCOPE = Object.freeze(['small', 'large'])
export const POSTURE_NOVELTY = Object.freeze(['familiar', 'novel'])
export const POSTURE_REVERSIBILITY = Object.freeze(['reversible', 'risky', 'irreversible'])

export function postureToDials(posture, visualArtifactPresence) {
  const failUp = { width: 'wide', research: 'on', perceptual: 'on', recovery_cap: 1, xhigh_permit: true }
  // Reflective reads (Reflect.ownKeys) and property access (destructuring getters) can throw
  // on adversarial input — a throwing ownKeys trap, a throwing getter, a revoked proxy
  // (Array.isArray itself throws on one). The whole body is guarded so "never throws" is
  // unconditional: any throw fails UP to max scrutiny. Reflect.ownKeys — not Object.keys — also
  // counts non-enumerable and Symbol own fields, so a malformed posture cannot smuggle an extra
  // field past the exact-field count.
  try {
    if (!posture || typeof posture !== 'object' || Array.isArray(posture)) return failUp
    const keys = Reflect.ownKeys(posture)
    const fields = ['scope', 'novelty', 'reversibility']
    if (keys.length !== fields.length || fields.some((k) => keys.indexOf(k) < 0)) return failUp
    const { scope, novelty, reversibility } = posture
    if (POSTURE_SCOPE.indexOf(scope) < 0 || POSTURE_NOVELTY.indexOf(novelty) < 0 || POSTURE_REVERSIBILITY.indexOf(reversibility) < 0) return failUp
    return {
      width: (novelty === 'novel' || scope === 'large') ? 'wide' : 'floor',
      research: (novelty === 'novel' || reversibility === 'risky' || reversibility === 'irreversible') ? 'on' : 'off',
      perceptual: visualArtifactPresence === true ? 'on' : 'dormant',
      recovery_cap: reversibility === 'reversible' ? 2 : 1,
      xhigh_permit: novelty === 'novel' || reversibility === 'irreversible',
    }
  } catch { return failUp }
}

// The executable entry: read .kiln/posture.json from the project cwd and print the projected
// dials as one line of JSON, exit 0. A missing, unreadable, or malformed posture parses to
// undefined and falls through the fail-up guard — the same max-scrutiny default the callers
// want when the posture cannot be trusted. The posture is exactly {scope, novelty,
// reversibility} and carries no visual-artifact flag, so perceptual projects dormant here; the
// research dial — the only field the research-sweep caller reads — never depends on it.
function readPosture() {
  try {
    return JSON.parse(readFileSync(resolve('.kiln/posture.json'), 'utf8'))
  } catch {
    return undefined
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  process.stdout.write(JSON.stringify(postureToDials(readPosture(), false)) + '\n')
  process.exit(0)
}
