# Lore Engine Reference

How the pipeline engine renders its presentation layer. Read this once at pipeline start, alongside step-definitions and artifact-flow.

All data lives in `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/data/`:
- `lore.json` — transition quotes and greetings
- `spinner-verbs.json` — step-categorized spinner verbs
- `agents.json` — agent aliases and personality quotes

## The Two-Channel Pattern

Claude Code shows two things for every Bash call: the **description** (in the `● Bash(...)` header) and the **output** (the rendered result). Use both as a narrative pair:

- The **description** sets the scene — a short, evocative line
- The **output** delivers the visual payoff — ANSI-colored banner

Together they tell a story. The description complements the output — never duplicates it.

**The engine's own text output before a Bash call is also visible.** If the engine writes "Ignition..." and then Bash prints "━━━ Ignition ━━━", the user sees both — that's duplication. Rule: **either the engine says it OR Bash prints it, never both.** Let Bash handle all narrative rendering. The engine's text should only be used for idle voice and direct operator communication.

## ANSI Color Palette

| Purpose | Code | Visual |
|---|---|---|
| Brand `[kiln]` | `38;5;173` | Warm terracotta |
| Quote text | `38;5;222` | Warm gold |
| Dividers / titles | `38;5;179` | Muted gold |
| Success | `32` | Green |
| Failure | `31` | Red |
| Warning | `33` | Yellow |
| Dim / secondary | `2` | Faint |
| Gray | `90` | Gray |
| Kill streak | `1;38;5;208` | Bold orange |

## Status Symbols

| State | Symbol | Color |
|---|---|---|
| Complete | `✓` | Green `32` |
| Active | `►` | Terracotta `38;5;173` |
| Failed | `✗` | Red `31` |
| Pending | `○` | Gray `90` |
| Paused | `⏸` | Terracotta `38;5;173` |

## Transition Banners

Every transition is ONE Bash call that renders banner + installs spinner verbs. Keep output to **3 lines max** (Claude Code truncates longer output behind ctrl+o).

### Format: Option D (standard transitions)

```bash
# Description: "The forge ignites..."
printf '\033[38;5;179m━━━ %s\033[0m \033[90m[%s]\033[0m\n\033[38;5;222m"%s"\033[0m \033[2m— %s\033[0m\n' \
  "$TITLE" "$STEP_PROGRESS" "$QUOTE_TEXT" "$QUOTE_SOURCE"
# then silently install spinners:
mkdir -p "$WORKING_DIR/.claude" && echo "$SPINNER_JSON" > "$WORKING_DIR/.claude/settings.local.json"
```

Where `$STEP_PROGRESS` is an inline progress string like `1✓ 2► 3○ 4○ 5○ 6○ 7○`.

Output (2 lines, always visible):
```
━━━ Ignition  [1► 2○ 3○ 4○ 5○ 6○ 7○]
"The secret of getting ahead is getting started." — Mark Twain
```

### Format: Option E (pipeline start only)

Pipeline greeting + first banner merged into one call:

```bash
# Description: "The forge ignites..."
printf '\033[38;5;173m%s\033[0m\n\n\033[38;5;179m━━━ %s\033[0m \033[90m[%s]\033[0m\n\033[38;5;222m"%s"\033[0m \033[2m— %s\033[0m\n' \
  "$GREETING" "$TITLE" "$STEP_PROGRESS" "$QUOTE_TEXT" "$QUOTE_SOURCE"
mkdir -p "$WORKING_DIR/.claude" && echo "$SPINNER_JSON" > "$WORKING_DIR/.claude/settings.local.json"
```

Output (4 lines — acceptable for the one-time greeting):
```
The forge is hot, the agents are caffeinated, and Da Vinci already has opinions.

━━━ Ignition  [1► 2○ 3○ 4○ 5○ 6○ 7○]
"The secret of getting ahead is getting started." — Mark Twain
```

### Kill Streak Format (Build iterations)

```bash
# Description: "KRS-One announces the next combo..."
printf '\033[1;38;5;208m━━━ ▸ %s ━━━\033[0m \033[38;5;179mIteration %d · Milestone %d/%d\033[0m\n\033[38;5;222m"%s"\033[0m \033[2m— %s\033[0m\n' \
  "$STREAK_UPPER" "$ITER" "$CURRENT_MS" "$TOTAL_MS" "$QUOTE_TEXT" "$QUOTE_SOURCE"
echo "$SPINNER_JSON" > "$WORKING_DIR/.claude/settings.local.json"
```

Output (2 lines):
```
━━━ ▸ HYPER COMBO ━━━  Iteration 4 · Milestone 2/5
"It does not matter how slowly you go as long as you do not stop." — Confucius
```

On milestone-completing iterations, add a third line:
```bash
printf '\033[32m✓ Milestone complete: %s\033[0m\n' "$MILESTONE_NAME"
```

### Bash Description Examples

The description is the narrative setup. It should evoke the step's atmosphere in a few words:

| Pipeline Event | Bash description |
|---|---|
| Pipeline start | "The forge ignites..." |
| Brainstorm start | "Da Vinci uncaps the paint..." |
| Vision locked | "The vision crystallizes..." |
| Research start | "MI6 deploys the field team..." |
| Intelligence gathered | "Intelligence secured..." |
| Architecture start | "The philosophers convene..." |
| Plan approved | "Athena nods..." |
| Architecture locked | "The blueprint is set..." |
| Build start | "KRS-One takes the stage..." |
| Build iteration | "KRS-One announces the next combo..." |
| Iteration complete | "Another round in the books..." |
| Milestone complete | "Another milestone falls..." |
| All milestones complete | "The orchestra takes a bow..." |
| Review passed | "Sphinx steps aside..." |
| Review failed | "Sphinx blocks the gate..." |
| Correction cycle | "Back to the forge..." |
| Validation start | "Argus opens a hundred eyes..." |
| Validation passed | "A hundred eyes find nothing wrong..." |
| Validation failed | "Argus found something..." |
| Final report | "Omega picks up the pen..." |
| Project complete | "The forge cools. The work remains." |
| Session resumed | "The fire reignites..." |
| Pipeline blocked | "The forge goes cold..." |
| Session break | "The fire banks for the night..." |

### Event → Lore Key Mapping

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
| Step 5 each iteration | `phase_start` | Iteration {N} |
| Step 5 iteration done | `phase_complete` | Iteration {N} Complete |
| Step 5 milestone done | `milestone_complete` | Milestone: {name} |
| Step 5 BUILD_COMPLETE | `phases_complete` | All Milestones Complete |
| Step 5 review passed | `review_approved` | Review Passed |
| Step 5 review failed | `review_rejected` | Review Failed |
| Correction cycle entry | `correction_start` | Correction Cycle {N} |
| Step 6 start | `validation_start` | Validation |
| Step 6 VALIDATE_PASS | `validation_passed` | Validation Passed |
| Step 6 VALIDATE_FAILED | `validation_failed` | Validation Failed |
| Step 7 start | `report_start` | Final Report |
| Step 7 done | `project_complete` | Project Complete |
| Session resume | `resume` | Session Resumed |
| Pipeline blocked | `halt` | Pipeline Blocked |
| Session break advisory | `pause` | Session Break |

## Agent Personality

When spawning any agent, set the `description` parameter to a random quote from `agents.json`:

```
Agent(
  name: "codex",
  description: "Talk is cheap — show me the code.",
  ...
)
```

The description appears in the team panel as flavor text beneath the agent name. Pick a different quote each spawn — don't repeat within a session.

## Spinner Verbs

Spinner verbs are installed silently inside the transition banner Bash call — never as a separate visible step.

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

## Idle Voice

When the platform forces an idle response (`idle_notification`), respond with personality — never mechanical status updates. Draw from the current step's spinner verb list or improvise in the same voice.

**Never say**: "Standing by", "Waiting for signal from X", "No updates yet"

**Instead**: Pick a spinner verb and output it as a one-liner. Vary each time — never repeat the same line twice in a row. Keep idle responses to a single short line. The goal is atmosphere, not information.

## Rendering Rules

1. **One Bash call per transition** — banner + spinner install + any silent plumbing, all in one call. Never split presentation across multiple Bash calls.
2. **3-line max output** — Claude Code truncates longer output behind ctrl+o. Keep banner output to 2-3 lines so the user always sees it.
3. **No duplicate text** — the engine's text before a Bash call is visible. If Bash prints the narrative, the engine should not also write it. Let Bash handle all visual rendering.
4. **Description is narrative** — the Bash description sets the scene; the output is the visual payoff. They complement, never duplicate.
5. **One banner per transition** — never render two banners back-to-back without intervening work.
6. **Color consistency** — use the palette above. Don't invent new colors.
7. **No emojis in banners** — use the status symbols (✓ ► ✗ ○ ⏸) instead of emoji equivalents.
8. **Quote attribution** — always render the source name after the quote, in dim text.
