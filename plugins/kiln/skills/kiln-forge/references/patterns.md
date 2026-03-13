# Patterns — Validated Patterns and Anti-Patterns

Learnings from 12 smoke tests (ST1-ST11.5). What works, what fails, and why.

## Validated Patterns (Do This)

### P1: Three-Phase Spawn with READY Summaries
Phase A persistent minds bootstrap → signal READY with content summary → boss receives summaries in runtime prompt → boss dispatches with full context. This eliminates multi-turn Q&A between boss and persistent minds.

**Evidence**: ST10 (clean run, 0 corrections). Every step transitioned smoothly with READY summaries.

### P2: Lean Runtime Prompts
Agent `.md` files carry the full protocol. Runtime prompt adds only: team name, working dir, READY summaries, step-specific state. No protocol duplication.

**Evidence**: Reduced context burn significantly vs early smoke tests that injected full instructions at spawn time.

### P3: Structured XML Assignments (KRS-One → Codex)
KRS-One packages codebase context from rakim + sentinel guidance into structured XML. Codex receives a self-contained assignment — no multi-turn consultation needed for basic context.

**Evidence**: ST10 build step executed 4 milestones with 0 corrections.

### P4: Hook-Based Enforcement Over Instruction-Based
Instructions tell agents what NOT to do. Hooks enforce it. When instructions and hooks agree, compliance is ~100%. When instructions stand alone, compliance degrades under context pressure.

**Evidence**: Pre-hook era had frequent delegation violations. Post-hooks: near-zero violations in ST8-ST11.

### P5: Status Headers for Sequencing Gates
`<!-- status: complete -->` on first line of bootstrap docs. Hooks check this header. Agents write it when done. Simple, reliable, no timing races.

**Evidence**: Hook 4/5/6 gate correctly in all smoke tests since implementation.

### P6: Banner Symlinks for Presentation
Themed command paths (e.g., `magic/happens`) that all point to `kb.sh`. User sees the themed path in the collapsed Bash header. Presentation without complexity.

**Evidence**: Works reliably across all smoke tests.

### P7: Kill Streak Names for Build Iterations
Each build iteration gets a unique Killer Instinct combo tier name. Creates narrative momentum and makes iterations distinguishable in logs.

**Evidence**: ST10 used all 4 kill streak names across milestones.

## Anti-Patterns (Don't Do This)

### A1: Instruction-Based Enforcement for Critical Rules
Telling an agent "never use Write" in its `.md` file is necessary but not sufficient. Under context pressure (long runs, deep implementation context), models ignore instructions. Always back critical rules with hooks.

**Evidence**: Pre-hook era, codex frequently used Write directly despite clear instructions.

### A2: Engine Context Burn on Resume
Engine reads 21+ files before even identifying what step to resume. Fix: resume agent pattern, or lazy-load references.

**Evidence**: ST11 resume took 8-10 turns of file reads before any useful work.

### A3: Sequential-Only Build When Tasks Are Parallel
Blueprint step-5 defines sequential codex dispatch, but KRS-One naturally wants to parallelize independent tasks. Blueprint rigidity prevents this.

**Evidence**: ST11 KRS-One scoped correctly for parallel execution but was forced into sequential by blueprint.

### A4: Broadcast Shutdown
Sending one shutdown message to the team doesn't work. Each agent needs individual shutdown_request with a unique request_id, and must individually confirm.

**Evidence**: Early smoke tests had orphaned agent processes after team transitions.

### A5: Engine Narration Around Bash Calls
Writing "Let me render the banner..." before a Bash banner call duplicates the presentation. The command path in the collapsed header IS the presentation.

**Evidence**: User feedback — redundant text clutters the experience.

### A6: Prompt Skeleton via Instructions Only
Telling codex "follow this skeleton" in its .md file works initially but degrades as context grows. The skeleton sections need structural enforcement (template, section markers, or verification).

**Evidence**: ST11.5 M3 prompt had 0/6 skeleton sections despite clear instructions in codex.md.

### A7: AskUserQuestion in Background Agents
`AskUserQuestion` fails silently in background agents. Use `SendMessage` to team-lead for all questions that need user input.

**Evidence**: Multiple early smoke tests. Platform limitation.

### A8: Missing PATH for Tool Binaries
Some environments don't have `/home/dev/.cargo/bin` or `~/.local/bin` in PATH. Agent instructions should source PATH or use absolute paths for non-standard binaries.

**Evidence**: ST11 — `bun` not found despite being installed.

## Emerging Patterns (Needs More Data)

### E1: Parallel Codex Dispatch
KRS-One dispatches N independent codex agents simultaneously, each with its own sphinx. Could dramatically reduce build time for multi-file milestones.

**Status**: Identified in ST11, not yet implemented. Blueprint needs N×(codex+sphinx) pattern.

### E2: Progressive MI6 Synthesis
Instead of batch synthesis after all field agents return, MI6 synthesizes progressively as findings arrive. Reduces total research time.

**Status**: Research reference at `/DEV/kiln5/research/multi-agent-research-orchestration.json` supports this (T3, T6). Not yet implemented.

### E3: Resume Agent
Dedicated lightweight agent that reads STATE.md, determines current position, loads only the necessary references, and hands off to the engine with a pre-built context package. Eliminates engine context burn on resume.

**Status**: Suggested after ST11. Not yet implemented.
