# GPT-5.4 Prompt Guide

This reference teaches Kiln's codex-invoking agents (art-of-war, dial-a-coder, creatah-reviewer transports — any role that shells out to `codex exec`) how to shape prompts for GPT-5.4. Read it before you build a prompt file; its own structure demonstrates the discipline it teaches.

Consumer tier: invoking agents run at sonnet-medium as thin transports; GPT-5.4 itself runs at `model_reasoning_effort="high"`. Effort lives on the receiver, so the prompt you ship must carry context and scope GPT cannot infer from your agent's history.

## Invocation

The canonical command pipes a prompt file into stdin. Long prompts passed as arguments or typed interactively hang — codex's stdin handler does not drain past a few KB, so heredoc-to-stdin is the only transport that works end-to-end:

```
codex exec -m gpt-5.4 -c 'model_reasoning_effort="high"' --sandbox danger-full-access --skip-git-repo-check < /tmp/prompt.md
```

Two caveats at the call site:
- **Write the prompt to a file, then pipe.** Heredoc into stdin is reliable; argument or interactive input is not. This is a tooling property of codex, not style.
- **Exit 0 on internal failure.** Codex can exit 0 after GPT hit an internal error and produced nothing usable. Check stdout contains the expected artifact before acting on the result.

## Why This Structure

GPT-5.4 performs best when it receives, in order: the commands it will use to verify its own work, the project shape, only the context it needs to decide correctly, the objective rather than dictation, and the boundaries that say when it is done. With 272K context and high reasoning, GPT-5.4 is a delegate, not a typist — prompts that hand it keystrokes waste the delegation.

## Skeleton

```
## Commands
{build, test, lint commands GPT-5.4 runs to verify its own work.
 Source from AGENTS.md or project config. Include the exact invocation.}

## Architecture
{3-5 sentences: stack, framework, structure, key patterns, threading model.
 So GPT-5.4 understands HOW the codebase is built before reading the task.}

## Context
{Curated snippets — only what GPT-5.4 needs to make correct decisions.
 Include: key type definitions, interfaces it must match, file layout.
 Exclude: full file dumps, code it won't touch, implementation it should decide.
 Greenfield: note "no existing code" and list what must be created.}

## Task
{WHAT to accomplish — objectives, deliverables, behaviors. Describe the goal
 and the definition of done. No code blocks, no file-by-file dictation. Let
 GPT-5.4 decide HOW.
 Dictated (loses the delegation):
   "In src/runner.rs, add pub struct RunState { pub scenario_id: String... }"
 Delegated (keeps it):
   "Implement the runner module — spawn claude CLI as a child process, parse
    its stream-JSON stdout into typed events, send events to main thread via
    mpsc channel. The runner owns the child process lifecycle."}

## Constraints
{Hard limits GPT-5.4 must respect. From architecture docs, ADRs, tech decisions.
 Frame these as non-negotiable with the reason attached — "No async runtime,
 std::thread only (the rest of the codebase is sync and mixing runtimes breaks
 the shutdown path)" reads as load-bearing; bare "No async runtime" reads as
 taste.}

## Patterns & Pitfalls
{From sentinel's guidance. Existing conventions GPT-5.4 should match, and the
 shapes that have bitten this codebase before.
 Example: "All view modules use render(frame, app, area) signature",
          "Avoid unwrap() on user-facing paths — propagate with ? or match,
           because panics in the TUI path take down the whole session."}

## Acceptance Criteria
{Testable conditions for DONE. GPT-5.4 checks these before finishing.
 Build gates: "cargo build --release produces zero errors, zero warnings."
 Behavior checks: "Tab cycles through all 6 views, wrapping at the end."}
```

## Rules

1. **No code blocks in `## Task`.** Code inside Task is dictation, not delegation. If you need to pin a type signature, move it to `## Context` where it reads as a constraint GPT must match rather than a blank to fill in.
2. **`## Context` is curated, not dumped.** Full-file dumps crowd out the interfaces GPT must honor and retrain its attention on the wrong parts. Include the shapes it must match; let it Read the rest from disk.
3. **Every section earns its tokens.** If GPT can discover a fact from AGENTS.md or the codebase, do not restate it. Restated context competes with the parts only you can provide.
4. **Fix prompts use the same skeleton.** A one-file fix still gets Commands, a brief Architecture, Context (the broken code), Task (what is wrong and what fixed looks like), and Acceptance Criteria. The skeleton is what makes the prompt self-contained, and that property is what makes the fix reviewable.
5. **Prompts are self-contained.** GPT-5.4 sees the prompt file and nothing else — no conversation history, no agent memory, no ambient context from the invoking role. If it is not in the prompt, it does not exist for GPT.
