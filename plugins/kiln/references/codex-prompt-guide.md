# Codex Frontier Prompt Guide

This reference teaches Kiln's codex-invoking legs (the logic builder, the UI reviewer, the slot-B planner, Ryu QA — any role that shells out to `codex exec`) how to construct a prompt for the GPT-5.5 frontier model. The invoking agent runs as a thin Sonnet wrapper; **its job is to TRANSLATE the Kiln brief into a Codex-native prompt, never to forward it.** Prefer GPT-5.5; use GPT-5.4 as the rollout fallback. Read this before you build a prompt.

The invoking wrapper runs at sonnet-medium; Codex itself runs at the `model_reasoning_effort` you set. Effort lives on the receiver, so the prompt you ship must carry the context and scope Codex cannot infer from the wrapper's history.

## The wrapper's job (TRANSLATE, do not forward)

1. **Extract, then invert.** Pull the Goal / Context / Constraints / Done-when out of the Kiln brief and re-order them instruction-first. The Claude brief is data-last (large payloads above the task); the Codex prompt is instruction-first (the goal up top, code/data last).
2. **Strip what is Claude-shaped.** Drop XML data-delimiters (use plain markdown sections), drop any prose JSON-schema description (the schema rides on `--output-schema`), and drop all persona / "think step by step" / "world-class expert" padding — GPT-5.5 classifies persona padding as noise and discards it.
3. **One vertical slice per call.** Bounded scope is better output. Do not batch slices into one `codex exec`.
4. **Sanitize.** Never pipe untrusted/LLM-generated content into `codex exec` without sanitizing it first.

## Invocation (load-bearing tooling facts — do not change)

The canonical command writes the prompt to a file and pipes it into stdin. Long prompts as arguments or typed interactively hang — codex's stdin handler does not drain past a few KB, so heredoc-to-stdin is the only transport that works end-to-end:

```
KILN_CODEX_MODEL="${KILN_CODEX_MODEL:-gpt-5.5}"
TMP="$(mktemp /tmp/kiln-codex.XXXXXX.md)"   # write the four-part prompt into "$TMP" first
codex exec -m "$KILN_CODEX_MODEL" \
  -c 'model_reasoning_effort="high"' \
  --output-schema /tmp/schema.json \
  --sandbox workspace-write \
  --skip-git-repo-check < "$TMP"
```

Caveats at the call site:
- **Write the prompt to a file, then pipe.** Heredoc into stdin is reliable; argument or interactive input is not. This is a tooling property of codex, not style. Mint the file with `mktemp` (`/tmp/kiln-codex.XXXXXX.md`) — a fixed path collides across concurrent runs.
- **No approval flag.** `codex exec` is non-interactive and never asks for approval; do NOT pass `--ask-for-approval` (rejected at parse time as of codex v0.141.0).
- **Fallback deliberately.** If GPT-5.5 is unavailable for the signed-in account, retry the same prompt with `-m gpt-5.4`. Do not silently downgrade without capturing the chosen model in the archived output.
- **Exit 0 on internal failure.** Codex can exit 0 after GPT hit an internal error and produced nothing usable. Check stdout contains the expected artifact (file written / tests run) before acting on the result; if it is empty, do the work directly.
- **Sandbox.** Default to `--sandbox workspace-write`; widen with `--add-dir <path>` when a slice legitimately needs another directory — do NOT reach for `danger-full-access`.

## The four-part prompt (what the wrapper EMITS)

```
Goal: {the outcome in 1-2 sentences — a result, not a procedure. Fold the functional role in here.}

Context:
- {inline file paths, the slice spec, interfaces/type signatures it must match. Curated, not dumped.
   Code/data goes LAST. Durable stack/test/import conventions live in repo AGENTS.md — do not restate them.}

Constraints:
- {hard limits, each with its reason. Pair every negative with a positive — "Do not edit outside src/auth;
   confine changes to that directory." A reason makes a constraint read as load-bearing, not taste.}

Done when:
- {the verifiable exit: the exact test command + expected exit 0. "npm test src/auth/session exits 0 and
   tsc reports no errors." Codex closes its own verify loop when told how.}
```

Rules for the four parts:
- **No code blocks in Goal.** Code in Goal is dictation, not delegation. Pin a required type signature in Context instead, where it reads as a constraint to match.
- **Context is curated, not dumped.** Full-file dumps crowd out the interfaces GPT must honor; include the shapes it must match and let it Read the rest from disk.
- **Every line earns its tokens.** If GPT can discover a fact from `AGENTS.md` or the codebase, do not restate it.
- **Verification belongs in Done-when.** "Run `<cmd>`; if it fails, fix and re-run before finishing."

### Before / after (a structural builder slice)

Before — the Claude brief forwarded verbatim (anti-pattern):
```
You are numerobis's hands. Think step by step. Carefully implement the following slice.
Return JSON {files:[{path,contents}], notes}. Here is the full architecture doc: <...8k tokens...>
<then the slice spec at the very end>
```

After — wrapper-constructed Codex prompt:
```
Goal: implement the "auth-session" vertical slice so its tests pass.

Context:
- Slice spec: <inline, concise>
- Files in scope: src/auth/session.ts, src/auth/session.test.ts
- Conventions are in AGENTS.md (auto-loaded).

Constraints:
- Touch only src/auth/. Do not add abstractions beyond the slice.
- Follow the existing import style; add no new deps (the project pins its dependency set).

Done when: `npm test src/auth/session` exits 0 and tsc reports no errors.
```
(`--output-schema` carries the result shape; `-m gpt-5.5 -c model_reasoning_effort="high"`, `text.verbosity=low` for schema agents.)

## Per-role flags

| Role | `-m` | `model_reasoning_effort` | `text.verbosity` | notes |
|---|---|---|---|---|
| logic builder | gpt-5.5 | high | (default) | one slice per call; Done-when = test cmd + exit 0 |
| UI reviewer / cross-model reviewer | gpt-5.5 | high | low (schema) | judge code + static only; read-only |
| slot-B planner / architect | gpt-5.5 | high | low (schema) | outcome-first; no step prescription |
| Ryu / QA analyst / judge | gpt-5.5 | xhigh | low (schema) | adversarial; quote evidence |
| pure transform / formatting | gpt-5.5 | low or none | low | no reasoning budget needed |

## Schema & reasoning rules

1. **Pass the JSON schema via `--output-schema`, never in prose.** Remove every schema description from the prompt body. Test for the MCP silent-ignore bug (codex #15451) — confirm the output actually validates against the schema before trusting it.
2. **`reasoning` field FIRST in the schema.** Put a `reasoning` (string) field before any verdict/score/decision field so token order forces reason-before-commit. Never place the answer before the reasoning ("broken chain of thought").
3. **Keep schemas flat.** Mark only truly-required fields required; avoid deep nesting and premature enums.
4. **Do not over-engineer.** Skip two-pass free-form→reformat, CRANE-style constrained decoding, and self-reflection-under-constraint loops — those target small open-weight models; marginal-to-zero gain on GPT-5.5.

## Durable conventions

- Stack, test command, and import rules belong in the repo's `AGENTS.md` (auto-injected to codex) — not re-stated each call.
- Per-run specifics (this slice's spec, files in scope, this Done-when) stay in the exec prompt.
- The prompt is self-contained: Codex sees the prompt file and nothing else — no conversation history, no wrapper memory. If it is not in the prompt or AGENTS.md, it does not exist for Codex.
