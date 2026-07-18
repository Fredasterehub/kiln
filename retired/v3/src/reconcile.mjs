// reconcile.mjs — the deterministic tribunal reconciler, inlined into build.js by
// scripts/bundle-workflows.mjs. Lifted verbatim from v2 build.js — do not change behavior.
// Pure functions/constants only: no I/O, no Date.now/Math.random.

export const SEV_RANK = { critical: 4, high: 3, medium: 2, low: 1 }
export const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim()
export function denzelReconcile(repA, repB) {
  const all = [...((repA && repA.findings) || []), ...((repB && repB.findings) || [])]
  const byKey = new Map()
  for (const f of all) {
    if (!f || !f.text) continue
    const k = norm(f.text); const sev = SEV_RANK[f.severity] || 1
    const prev = byKey.get(k)
    if (!prev || sev > prev.rank) byKey.set(k, { text: f.text, severity: f.severity, rank: sev })
  }
  const merged = [...byKey.values()].sort((x, y) => y.rank - x.rank)
  const blocking = merged.filter((f) => f.rank >= SEV_RANK.high)
  return { findings: merged, blocking, hasBlocking: blocking.length > 0, summaryLines: merged.map((f) => `[${f.severity}] ${f.text}`) }
}
