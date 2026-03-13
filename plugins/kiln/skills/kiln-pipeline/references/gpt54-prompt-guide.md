# GPT-5.4 Prompt Guide

Every prompt sent to GPT-5.4 via `codex exec` follows this structure. No exceptions.

## Why This Structure

GPT-5.4 performs best when:
1. It knows the commands to verify its work (top)
2. It understands the project shape before the task (orientation)
3. It receives objectives, not dictation (autonomy)
4. It knows the boundaries (constraints + acceptance criteria)

Dictating exact code defeats delegation — GPT-5.4 has 272K context and high reasoning.
Describe what you need, not how to type it.

## Skeleton

```
## Commands
{build, test, lint commands. GPT-5.4 runs these to verify its own work.
 From AGENTS.md or project config. Include the exact invocation.}

## Architecture
{3-5 sentences: stack, framework, structure, key patterns, threading model.
 So GPT-5.4 understands HOW the codebase is built before reading the task.}

## Context
{Curated snippets — only what GPT-5.4 needs to make correct decisions.
 Include: key type definitions, interfaces it must match, file layout.
 Exclude: full file dumps, code it won't touch, implementation it should decide.
 For greenfield: note "no existing code" and list what must be created.}

## Task
{WHAT to accomplish — objectives, deliverables, behaviors.
 Describe the goal and the definition of done.
 Do NOT include code blocks. Do NOT dictate implementations.
 Do NOT list file-by-file changes. Let GPT-5.4 decide HOW.

 WRONG: "In src/runner.rs, add pub struct RunState { pub scenario_id: String... }"
 RIGHT: "Implement the runner module — spawn claude CLI as a child process,
         parse its stream-JSON stdout into typed events, send events to main
         thread via mpsc channel. The runner owns the child process lifecycle."}

## Constraints
{Hard limits GPT-5.4 must respect. From architecture docs, ADRs, tech decisions.
 These are NON-NEGOTIABLE — not suggestions.
 Example: "No async runtime — std::thread only", "All colors from theme.rs"}

## Patterns & Pitfalls
{From sentinel's guidance. What patterns to follow, what to avoid.
 Existing conventions GPT-5.4 should match.
 Example: "All view modules use render(frame, app, area) signature",
          "Never use unwrap() on user-facing paths — use match or if-let"}

## Acceptance Criteria
{Testable conditions for DONE. GPT-5.4 checks these before finishing.
 Include build gates: "cargo build --release must produce zero errors, zero warnings"
 Include behavior checks: "Tab cycles through all 6 views, wrapping at the end"}
```

## Rules

1. **Zero code blocks in ## Task.** If you're writing code in the Task section, you're dictating, not delegating. Rephrase as behavior.
2. **## Context is curated, not dumped.** Include interfaces GPT-5.4 must match. Exclude full files it will read from disk anyway.
3. **Every section earns its tokens.** If GPT-5.4 can discover it from AGENTS.md or the codebase, don't repeat it.
4. **Fix prompts follow the same skeleton.** Even a 1-file fix gets Commands, Architecture (brief), Context (the broken code), Task (what's wrong and what "fixed" looks like), Acceptance Criteria.
