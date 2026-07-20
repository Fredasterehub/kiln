# Codex Prompt Guide

How Kiln talks to its coder. The live consumer is the build card's coder call
(`cards/build.md`): a claude context-builder composes ONE `codex exec` prompt per logic or
mixed slice, and GPT-5.6 writes the code. The model id is never written in this guide —
read the concrete id from `data/tiers.json` at `resolver["gpt-sol"]`, the one place it is
named. The coder effort is likewise named once, in the same file's `builder-logic` note.
Your job is to TRANSLATE the Kiln brief into a Codex-native prompt, never to forward it.

## GPT-5.6 deltas (vendor-reported, 2026-07)

GPT-5.6 rewards LEANER prompts: leaner, less-redundant prompts gained 10-15% on coding
evals. State each instruction ONCE — repeated or restated directives read as noise and can
degrade output. Drop belt-and-suspenders re-emphasis, duplicated constraints, and persona
padding ("world-class expert", "think step by step") — GPT-5.6 classifies padding as noise
and discards it.

## Translate, do not forward

1. **Extract, then invert.** Pull the Goal / Context / Constraints / Done-when out of the
   Kiln brief and re-order them instruction-first: the goal up top, code/data last.
2. **Strip what is Claude-shaped.** Plain markdown sections — no XML data-delimiters, no
   persona framing.
3. **One vertical slice per call.** Bounded scope is better output; never batch slices
   into one `codex exec`.
4. **Sanitize.** Never pipe untrusted or LLM-generated content into `codex exec` without
   sanitizing it first.

## The four-part prompt

```
Goal: {the outcome in 1-2 sentences — a result, not a procedure.}

Context:
- {file paths, the slice spec, interfaces/type signatures to match. Curated, not dumped;
   code/data goes LAST. Durable stack/test/import conventions live in repo AGENTS.md —
   do not restate them.}

Constraints:
- {hard limits, each with its reason. Pair every negative with a positive — "Do not edit
   outside src/auth; confine changes to that directory."}

Done when:
- {the verifiable exit: the exact test command + expected exit 0. Codex closes its own
   verify loop when told how.}
```

Rules for the four parts:

- **No code blocks in Goal.** Code in Goal is dictation, not delegation. Pin a required
  type signature in Context instead, where it reads as a constraint to match.
- **Context is curated, not dumped.** Include the shapes the code must honor; Codex reads
  the rest from disk.
- **Every line earns its tokens.** If Codex can discover a fact from `AGENTS.md` or the
  codebase, do not restate it.
- **Verification belongs in Done-when.** "Run `<cmd>`; if it fails, fix and re-run before
  finishing."

## Call-site facts (load-bearing tooling properties)

The canonical call is the ONE bash recipe in `cards/build.md`; these are the properties it
rests on:

- **Write the prompt to a file, then feed it through stdin.** Mint the file with `mktemp`
  (`/tmp/kiln-codex.XXXXXX.md`) — a fixed path collides across concurrent runs.
- **Close stdin or feed the prompt through it.** `codex exec` appends a non-TTY stdin to
  the prompt and WAITS FOR EOF — an open stdin hangs the call until your timeout kills
  it. The `< "$TMP"` redirect feeds the prompt AND closes stdin; append `</dev/null` when
  a prompt ever rides argv.
- **No approval flag.** `codex exec` is non-interactive and never asks; do NOT pass
  `--ask-for-approval` (rejected at parse time).
- **Exit 0 on internal failure.** Codex can exit 0 having produced nothing usable — the
  green test run is the only proof. If the reply is empty, do the work directly.
- **Sandbox.** Default to `--sandbox workspace-write`; widen with `--add-dir <path>` when
  a slice legitimately needs another directory — never `danger-full-access`.

## Schema discipline (`--output-schema` legs only)

The coder call takes a free-text reply via `-o` — no schema. When a leg does ship
`--output-schema` (the ui gate transport does), the schema must be STRICT — codex
validates the schema ITSELF and rejects a loose one (400 invalid_json_schema) before any
reasoning happens:

- Every schema node carries an explicit `type`; the root is `type: "object"`.
- Every object node carries `additionalProperties: false`, and its `required` array lists EXACTLY its property names — every property appears, none extra, no dangling names.
  Optionality is NEVER expressed by omission from `required`: an optional value stays
  required and takes a nullable type union (`"type": ["string", "null"]`).
- Keyword allowlist: `type`, `properties`, `required`, `additionalProperties`, `items`,
  `enum`, `description`, `maxLength`, `maxItems`, `minItems` — nothing else. Keep shapes
  flat.
- Put a `reasoning` (string) field before any verdict/score/decision field — token order
  forces reason-before-commit.
- Pass the schema via `--output-schema`, never described in prose.

## Durable conventions

- Stack, test command, and import rules belong in the repo's `AGENTS.md` (auto-loaded by
  codex) — not restated each call. Per-run specifics (this slice's spec, files in scope,
  this Done-when) stay in the exec prompt.
- The prompt is self-contained: Codex sees the prompt file and nothing else — no
  conversation history, no wrapper memory. If it is not in the prompt or `AGENTS.md`, it
  does not exist for Codex.
