// voice.mjs — the MODEL_VOICE shell, inlined into every workflow by scripts/bundle-workflows.mjs.
// Current shape is Opus-only; non-Opus legs get no prose voice header.
// Pure constants only: no I/O, no Date.now/Math.random.

export const MODEL_VOICE = {
  opus: [
    'Be direct. State findings and decisions plainly; do not soften.',
    'Inputs are wrapped in XML tags — read the data block before the task line.',
    'Keep output minimal and specific. Apply every rule to EVERY item in scope, not just the first.',
  ].join('\n'),
}
export const voice = (m) => (m === 'opus' ? MODEL_VOICE.opus + '\n\n' : '')
