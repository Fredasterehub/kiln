# Kiln

Multi-modal software creation pipeline. From idea to deployed code in 7 autonomous steps.

## Commands

- `/kiln-fire` — Launch the pipeline. Auto-detects project state and resumes.
- `/kiln-doctor` — Check prerequisites and diagnose issues.

## The 7 Steps

1. **Onboarding** (Alpha) — Detect project, create .kiln/ structure, map codebase if brownfield
2. **Brainstorm** (Da Vinci) — Interactive vision discovery with the operator
3. **Research** (MI6) — Investigate open questions from the vision
4. **Architecture** (Aristotle) — Dual-model planning (Claude + GPT-5.5, GPT-5.4 fallback), debate, synthesis, validation
5. **Build** (KRS-One) — JIT implementation with kill streak team names
6. **Validate** (Argus) — Test against acceptance criteria, may loop back to Build
7. **Report** (Omega) — Compile final project report

## Prerequisites

- **Claude Code** (required)
- **Codex CLI** (optional): `npm install -g @openai/codex` &mdash; enables dual-model mode with GPT-5.5 when available, GPT-5.4 fallback
- Run `/kiln-doctor` to verify everything is ready.

## How It Works

The pipeline is fully autonomous after Step 2 (Brainstorm). Da Vinci interviews the operator to crystallize the vision, then the remaining steps run without intervention. Build iterates with kill streak team names (first-blood, combo, super-combo...) until all milestones are complete. Validate can loop back to Build for corrections (max 3 cycles).

All state lives in `.kiln/` under the project directory. Resume anytime with `/kiln-fire`.
