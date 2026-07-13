// models.mjs — the codex model pins, single source of truth (BLUEPRINT WS-B2). Inlined verbatim
// into every GPT-pinning workflow by the `// @models` bundler marker (like @gate pulls the whole
// module), so the model id can never drift across build/gauge/architecture/validate.
// DOCTRINE (references/codex-prompt-guide.md): the fallback is RECORDED when used, never silent — a
// leg that drops to CODEX_FALLBACK must capture the chosen model in its archived output, never
// downgrade invisibly.
export const CODEX_MODEL = 'gpt-5.6-sol' // GPT-5.6 Sol, GA 2026-07-09 — the codex CLI model id
export const CODEX_FALLBACK = 'gpt-5.5'  // recorded rollout fallback (5.4 dropped — two rungs suffice)
