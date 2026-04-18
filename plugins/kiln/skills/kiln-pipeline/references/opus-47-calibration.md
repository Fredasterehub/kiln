# Opus 4.7 Calibration for Kiln Roles

Opus 4.7 (shipped 2026-04-16) changed how Kiln agents behave under the same prompts that worked on 4.6. This reference is the calibration source for every Kiln role that runs on 4.7 — Boss, Reviewer, Synthesizer, Persistent Mind, Implementer, Planner, UI Builder.

Read this when you write or revise a 4.7 agent prompt. Apply the principle, not the recipe.

## The Seven Calibration Principles

### 1. Literal instruction-following

4.6 read between the lines and patched gaps with reasonable defaults. 4.7 takes you at your word. If a constraint mattered under 4.6, it must now be stated. If you wrote "review the code" expecting "review only the diff," 4.7 may go hunting through the whole tree.

The fix is not more rules — it is sharper rules. State scope, format, and no-go lines explicitly. Ambiguity now produces surprises rather than helpful guesses.

### 2. Strict effort respect

Effort levels are no longer suggestions. Low/medium scope tightly to what was asked and skip exploratory reasoning. High/xhigh unlock deeper thinking and more tool use.

xhigh sits between high and max — Claude Code defaults to it on plans. Use it for orchestration and review work where shallow reasoning produces shallow results.

### 3. Less overthinking by default

4.7's adaptive thinking is better calibrated, so it skips deep reasoning on tasks it judges simple. This is good — until your task looks simple but isn't. If you need careful analysis on something the model might dismiss, signal it: "Think carefully about X before responding."

Do not pad every prompt with "think hard" — that retrains the calibration you want to keep.

### 4. Length calibrated to task complexity

4.7 is less default-verbose than 4.6. Lookups stay terse; open-ended analysis expands naturally. If your downstream parser needs a specific length or format (e.g., a one-line APPROVED verdict), state it. Otherwise let the model breathe.

### 5. Reasons more, uses tools less

4.7 prefers internal reasoning to tool calls. For a Boss that must poll multiple state files each cycle, or a Reviewer that must read every file in a diff, this is a regression unless you compensate. Bump effort to high/xhigh and name the tool in the instruction: "Read the file using the Read tool" rather than "check the file."

### 6. Better bug recall

Anthropic measures 11pp higher recall than 4.6 on bug-finding evals. Reviewers tuned for 4.6 will feel stricter on 4.7. That is recall, not noise — trust it before you soften the rubric.

### 7. Temperature, top_p, top_k forbidden

The API returns 400 on non-default values. Behavior control is prompt-only on 4.7. If you have legacy config setting these, strip them.

## Effort Guidance

| Level | When to use | Kiln roles |
|-------|-------------|------------|
| low | Mechanical transforms, parsing, single-file lookups | (rarely a fit for 4.7 — prefer Sonnet) |
| medium | Single-pass writes from explicit spec, no judgment calls | Implementer on a tightly scoped task |
| high | Multi-file synthesis, design choices, structured review | Reviewer, Synthesizer, Planner |
| xhigh | Cross-file orchestration, judgment-heavy review, persistent state across cycles | Boss, Persistent Mind, UI Builder with design intent |

If a role lives across many cycles or reads many state files, default to xhigh. If unsure, raise effort before you add more prose to the prompt — extra effort beats extra instruction.

## Explain the Why, Not the What

4.7 generalizes from reasoning. Tell it only what to do and it will fail on the first edge case the rule didn't name. Tell it why the rule exists and it will infer the right behavior on cases you never wrote down.

This applies to every constraint you write into a 4.7 agent.

**Bad — bare prohibition:**
> Never edit source files directly.

The model has no model of why. On the next cycle when an "obvious" one-line fix appears, it may rationalize an exception.

**Good — reasoning attached:**
> You do not edit source files. Edits are dispatched to Implementer so the diff is reviewable and reversible — your role is coordination, not authorship. If you find yourself wanting to edit, dispatch instead.

**Bad — vague scope:**
> Review the code carefully.

4.7 will follow this literally and may interpret "the code" as the whole repository.

**Good — scoped with reasoning:**
> Review only the diff in the message. Out-of-scope concerns belong in a separate ticket — surfacing them here delays the current task and dilutes the verdict.

**Bad — ALL-CAPS commandment:**
> ALWAYS use the Read tool. NEVER guess at file contents.

4.7 reads this as emphasis, not as logic. Capitalization does not strengthen a rule the model does not understand.

**Good — same constraint, reasoned:**
> When you reference a file's contents, read it first. 4.7 prefers internal reasoning to tool calls, but invented file contents are worse than slow ones — readers downstream cannot tell guess from quote.

When you catch yourself writing ALWAYS or NEVER, stop and write the reason instead.

## Role Cookbooks

Each cookbook is a starting shape, not a template to paste. Adapt to the role's actual responsibilities.

### Boss

- Effort: xhigh. You coordinate across many state files and many cycles.
- Frame the role as coordinator, not author. State explicitly that you dispatch edits rather than make them.
- List every file you read on spawn by absolute path. Inlining duplicates context.
- State the signal vocabulary you emit (REQUEST_WORKERS, REVIEW_REQUEST, APPROVED) so workers can match.
- Treat cycle budgets as guidance. Per-cycle convergence judgment beats numeric caps.
- Name what you do not own (e.g., grading rubric, source edits) so 4.7 does not drift into authoring.

### Reviewer

- Effort: high or xhigh depending on diff size and judgment density.
- Output format must be exact: `APPROVED: <one line>` or `REJECTED: <numbered issues with file:line>`. State this; 4.7 will follow it.
- Rubric must be testable. "Function returns expected value on edge inputs" beats "function handles edge cases well."
- Scope the review to the diff provided. Hunting for adjacent issues dilutes the verdict and burns cycles.
- On ambiguous criteria: REJECTED with the ambiguity as issue #1, not invented criteria. State this explicitly — 4.7 will otherwise try to be helpful.
- Trust the higher recall. If verdicts feel stricter than under 4.6, that is the upgrade working.

### Synthesizer

- Effort: high. You consolidate across multiple inputs into one coherent artifact.
- State input paths and the exact output shape. 4.7 will produce what you describe, not what you implied.
- Name the resolution rule for conflicts between inputs (e.g., "later artifact wins on overlap"). Without it, 4.7 picks an order and may not tell you.
- Cap output length only if a downstream parser depends on it. Otherwise let the synthesis breathe.

### Persistent Mind

- Effort: xhigh. Your value is continuity across many turns.
- State what you remember and what you forget between cycles. 4.7's literal reading means an unstated assumption ("you remember everything") will be honored only as long as context allows.
- Reference state files by absolute path each time you need them. Do not assume prior reads persist — they may have been compressed.
- Name the handoff format you produce at end-of-shift so the next instance can pick up cleanly.

### Implementer

- Effort: medium for tight specs; high if the spec leaves design choices.
- State acceptance criteria in testable form. "Script exits 0 on the sample input" beats "script handles the sample correctly."
- Name the files you may touch and the files you must not. 4.7 follows scope literally — both directions.
- Require the Read tool before any Edit. 4.7's reasoning preference can otherwise lead to edits based on inferred contents.
- State the signal you emit on done (e.g., `IMPLEMENTATION_COMPLETE: <summary>`).

### Planner

- Effort: high. Planning is design under uncertainty.
- State the artifact shape (sections, ordering, depth). 4.7 will produce what you describe.
- Distinguish "in scope for this plan" from "noted for later." 4.7 will otherwise either include everything or drop the followups silently.
- Require the plan to name its own acceptance criteria — a plan that cannot be checked against reality is not actionable.

### UI Builder

- Effort: high or xhigh depending on design density.
- State the design system, component library, and tokens by absolute path. 4.7 will use whatever you reference; underspecified visual constraints produce drift.
- Name the device targets and breakpoints that matter. "Responsive" without targets is not a constraint 4.7 can act on.
- Require the build to run and the route to render before the role reports done. Unverified UI claims are worse than honest blockers.

## Quick Self-Check Before Spawning a 4.7 Agent

- Role stated in `<role>`
- Mission is one sentence
- Context files referenced by absolute path, not inlined
- Acceptance criteria testable
- What NOT to do stated, with the reason
- Output format stated precisely
- Effort level chosen deliberately (medium / high / xhigh)
- No temperature, top_p, top_k anywhere in config
- If structured output expected, the exact format is shown

## Skill Bodies vs Agent Prompts

This reference was written for agent prompts. Skill bodies (e.g. `kiln-protocol/SKILL.md`, `kiln-pipeline/SKILL.md`, reference files under `kiln-pipeline/references/`) are documents the host session reads rather than prompts scoped to one task — so some principles apply verbatim, others translate.

**Carries over verbatim:**
- **Principle 1 — Literal instruction-following.** Whatever a skill tells the reading session, 4.7 takes at face value. Ambiguity in a skill propagates to every agent that Reads it.
- **Principle 3 — Less overthinking by default.** Do not pad skill bodies with "think carefully" pleas. That retrains the calibration for every agent reading them.
- **Principle 4 — Length calibrated to task complexity.** A skill body that bloats past what it needs is the same failure mode as a verbose prompt: later trailing instructions drown. creatah's "body under 500 lines" rule is this principle applied — cut any line that does not change reader behavior.
- **Explain-the-why.** The single highest-leverage change in a skill body. ALL-CAPS commandments (ALWAYS / NEVER / MUST) without reasoning read as emphasis to 4.7, not logic. Skills riddled with bare prohibitions produce agents that drift on the first unanticipated case.

**Translates:**
- **Principle 2 — Strict effort respect.** Skills do not run with an effort setting. But a skill body consumed by a specific role (e.g. `duo-pool.md` consumed by the boss) should note the expected effort tier of its consumer, so constraints scale to the reader.
- **Principle 5 — Reasons more, uses tools less.** Skill bodies do not call tools. But skills that teach a role *when* to call a tool must be explicit — vague guidance (“check the state file”) produces internal reasoning instead of the intended Read call.

**Skill-specific discipline:**
- **Preserve every load-bearing contract.** Signal tables, field schemas, hook contracts, filesystem paths — these are referenced by agents and scripts. A well-styled rewrite that drops a signal meaning is worse than an ugly skill that works. Per-rewrite audit: 1:1 parity of contracts before/after.
- **Lead with purpose.** The first paragraph of a skill body states what this skill is for and who reads it. 4.7 calibrates from the opening; a skill that buries its purpose forces the reader to infer, and inference drifts.
- **Separate policy from mechanism.** Rules the reading agent must follow (policy) belong near the top in explain-the-why form. Implementation detail (mechanism — scripts, paths, envvars) can live further down in reference tables; 4.7 reads tables fine when the policy framing is upstream.
- **Restate critical invariants at point of use.** A skill body can be long. Repeating a load-bearing constraint where it matters is cheaper than relying on the reader to hold the whole doc in working memory.

## Sources

- `/home/dev/.claude/skills/selektah/references/claude-opus-47-prompting.md` — authoritative 4.7 prompting reference
- `/home/dev/.claude/skills/creatah/references/agent-anatomy.md` — agent structural fundamentals
