// doctrine.mjs — Kiln's cross-stage prompt doctrine, single source of truth (v3.0.2 WS-E E2).
// Inlined verbatim into every StructuredOutput-emitting workflow by the `// @inline:doctrine:PAYLOAD_FIRST`
// bundler marker, so the ~90-word payload-first rule can never drift across the eight stages.
export const PAYLOAD_FIRST = 'Your ENTIRE final message is ONE StructuredOutput tool call — no prose before or after it. Emit the payload properties FIRST; reasoning is the LAST property, OPTIONAL, and under 50 words — put detail in the designated report file or field, never in reasoning. A long leading reasoning string is the observed death mode: the call truncates before the payload lands, the validator rejects it, each rejection burns one of five attempts, and five failures kill this leg.'
