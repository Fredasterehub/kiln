# Lore Engine Reference

How the pipeline engine renders its presentation layer. Read this once at pipeline start, alongside step-definitions, artifact-flow, and brand.md.

All data lives in `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/data/`:
- `lore.json` — transition quotes and greetings
- `spinner-verbs.json` — step-categorized spinner verbs
- `agents.json` — agent aliases and personality quotes

Visual vocabulary is defined in `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/brand.md`. Read it once — single source of truth for all visual patterns.

## The Two-Channel Pattern

Claude Code shows two things for every Bash call: the **description** (in the collapsed header) and the **output** (the rendered result). Use both as a narrative pair:

- The **description** sets the scene — a short, evocative line (see brand.md table)
- The **output** delivers the visual payoff — colored banner with quote

Together they tell a story. The description complements the output — never duplicates it.

**The engine's own text output before a Bash call is also visible.** If the engine writes "Ignition..." and then Bash prints the banner, the user sees both — that's duplication. Rule: **either the engine says it OR Bash prints it, never both.** Let Bash handle all visual rendering. The engine's text should only be used for idle voice and direct operator communication.

## Transition Banners

Every transition is ONE Bash call that renders banner + installs spinner verbs. Keep output to **3 lines max**.

### Standard transitions (step changes)

```bash
# Description: "The philosophers convene..."
printf '\033[38;5;179m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m\n \033[38;5;173mKILN ►\033[0m %s\n \033[38;5;222m"%s"\033[0m \033[2m— %s\033[0m\n' \
  "$TITLE" "$QUOTE_TEXT" "$QUOTE_SOURCE"
mkdir -p "$WORKING_DIR/.claude" && echo "$SPINNER_JSON" > "$WORKING_DIR/.claude/settings.local.json"
```

Output (3 lines):
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 KILN ► Architecture
 "Plans are nothing; planning is everything." — Eisenhower
```

### Pipeline start (greeting + banner)

```bash
# Description: "The forge ignites..."
printf '\033[38;5;173m%s\033[0m\n\n\033[38;5;179m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m\n \033[38;5;173mKILN ►\033[0m %s\n \033[38;5;222m"%s"\033[0m \033[2m— %s\033[0m\n' \
  "$GREETING" "$TITLE" "$QUOTE_TEXT" "$QUOTE_SOURCE"
mkdir -p "$WORKING_DIR/.claude" && echo "$SPINNER_JSON" > "$WORKING_DIR/.claude/settings.local.json"
```

Output (5 lines — acceptable for the one-time greeting):
```
The forge is hot, the agents are caffeinated, and Da Vinci already has opinions.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 KILN ► Ignition
 "The secret of getting ahead is getting started." — Mark Twain
```

### Kill Streak (Build iterations)

```bash
# Description: "KRS-One announces the next combo..."
printf '\033[38;5;179m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m\n \033[1;38;5;208m▸ %s\033[0m              \033[38;5;179mIteration %d · Milestone %d/%d\033[0m\n \033[38;5;222m"%s"\033[0m \033[2m— %s\033[0m\n' \
  "$STREAK_UPPER" "$ITER" "$CURRENT_MS" "$TOTAL_MS" "$QUOTE_TEXT" "$QUOTE_SOURCE"
echo "$SPINNER_JSON" > "$WORKING_DIR/.claude/settings.local.json"
```

Output (3 lines):
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 ▸ HYPER COMBO              Iteration 4 · Milestone 2/5
 "It does not matter how slowly you go..." — Confucius
```

On milestone completion, add:
```bash
printf '\033[32m✓ Milestone complete: %s\033[0m\n' "$MILESTONE_NAME"
```

### Operator checkpoints

When the pipeline needs operator input (plan approval, blocked state), render as **markdown** (not Bash) since the engine processes the response:

```
╔══════════════════════════════════════════════════════════════╗
║  APPROVAL REQUIRED                                           ║
╚══════════════════════════════════════════════════════════════╝

{Summary}

──────────────────────────────────────────────────────────────
→ approve / edit / abort
──────────────────────────────────────────────────────────────
```

## Event → Lore Key Mapping

| Pipeline Event | lore.json key | Banner title |
|---|---|---|
| Step 1 start | `ignition` | Ignition |
| Step 2 start | `brainstorm_start` | Brainstorm |
| Step 2 done | `brainstorm_complete` | Vision Locked |
| Step 3 start | `research_start` | Research |
| Step 3 done | `research_complete` | Intelligence Gathered |
| Step 4 start | `planning_start` | Architecture |
| Step 4: plan approved | `plan_approved` | Plan Approved |
| Step 4 done | `architecture_complete` | Architecture Locked |
| Step 5 first entry | `build_start` | Build |
| Step 5 each iteration | `phase_start` | (kill streak name) |
| Step 5 iteration done | `phase_complete` | Iteration Complete |
| Step 5 milestone done | `milestone_complete` | Milestone: {name} |
| Step 5 BUILD_COMPLETE | `phases_complete` | All Milestones Complete |
| Step 5 review passed | `review_approved` | Review Passed |
| Step 5 review failed | `review_rejected` | Review Failed |
| Correction cycle | `correction_start` | Correction Cycle {N} |
| Step 6 start | `validation_start` | Validation |
| Step 6 VALIDATE_PASS | `validation_passed` | Validation Passed |
| Step 6 VALIDATE_FAILED | `validation_failed` | Validation Failed |
| Step 7 start | `report_start` | Final Report |
| Step 7 done | `project_complete` | Project Complete |
| Session resume | `resume` | Session Resumed |
| Pipeline blocked | `halt` | Pipeline Blocked |
| Session break | `pause` | Session Break |

## Spinner Verbs

Installed silently inside the transition Bash call — never as a separate visible step.

### Step → Category Mapping

| Step | Categories |
|---|---|
| 1 Onboarding | `onboarding` + `generic` |
| 2 Brainstorm | `brainstorm` + `generic` |
| 3 Research | `research` + `generic` |
| 4 Architecture | `architecture` + `generic` |
| 5 Build | `build` + `review` + `generic` |
| 6 Validate | `validation` + `generic` |
| 7 Report | `generic` |

## Spawning Indicators

Before spawning a team, output a spawning block (markdown, not Bash):

```
◆ Spawning 5 agents...
  → krs-one
  → codex
  → architect
  → sentinel
  → sphinx
```

After an agent completes:
```
✓ codex complete: "14 files committed, tests passing"
```

## Idle Voice

When forced to respond during idle (`idle_notification`), output a lore-flavored one-liner. Draw from the current step's spinner verb list or improvise in the same voice.

**Never say**: "Standing by", "Waiting for signal from X", "No updates yet"

Vary each time — never repeat the same line twice in a row.

## Rendering Rules

1. **One Bash call per transition** — banner + spinner install in one call.
2. **3-line max Bash output** — Claude Code truncates longer output.
3. **No duplicate text** — engine text and Bash output must not overlap.
4. **Description is narrative** — from the brand.md table.
5. **One banner per transition** — never two back-to-back without work between.
6. **ANSI for color, Unicode for structure** — colors enhance but never carry meaning alone. Box drawing characters (━ ═ ─) and status symbols (✓ ► ✗ ○) provide structure.
7. **Markdown for interactive output** — checkpoints, approval boxes, status tables.
8. **Step name is the progress** — no step counters or progress icons in banners.
