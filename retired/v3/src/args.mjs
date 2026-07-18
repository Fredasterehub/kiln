// args.mjs — workflow args normalization, inlined into every workflow by scripts/bundle-workflows.mjs.
// Pure function only: no I/O, no Date.now/Math.random — workflow determinism rules apply here.

// args may arrive as an object or a JSON string depending on how the caller encoded it. Normalize
// both to an object. A malformed string returns { __parse_error: true } — the required keys stay
// undefined so the workflow's own requires-guard throws — instead of v2's silent {}.
export function normalizeArgs(args) {
  if (typeof args === 'string') {
    try { args = JSON.parse(args) } catch (e) { return { __parse_error: true } }
  }
  return (args && typeof args === 'object') ? args : {}
}
