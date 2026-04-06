# Engine Resume Cache
Pre-extracted from brand.md + lore-engine.md + team-protocol.md.
Engine reads THIS on resume instead of the source files.

## Markdown Weight System
Normal text = body copy
**bold** = emphasis
*italic* = secondary / quote text
`code span` = single accent color
**`bold code`** = primary status / banner label
*`italic code`* = secondary status
Box drawing = structure
Status symbols = ✓ ✗ ▶ ○ ◆ ◇
Banner accent rule: step labels and progress use bold only (no accent). Accent (code span) is reserved for quotes and agent/milestone names.

## Transition Banner
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
**ARCHITECTURE** ▸ *Step 4 of 7*
✓ Research · ▶ **Architecture** · ○ *Build*
`"Plans are nothing; planning is everything."` — *Eisenhower*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Kill Streak Banner
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▸ **HYPER COMBO** · *Iteration 4* · **Milestone 2/5**
`"Quote here."` — *Source*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Spinner Plumbing
Write settings.local.json via Bash heredoc once per transition.
Spinner installation is invisible plumbing only. Never render banners through Bash output.

## Status Symbols
✓ Complete | ✗ Failed | ▶ Active | ○ Pending | ◆ Spawn | ◇ Secondary

## Step Signals
| Step | Done Signal | Next Stage |
|------|-------------|------------|
| 1 | ONBOARDING_COMPLETE | brainstorm |
| 2 | BRAINSTORM_COMPLETE | research |
| 3 | RESEARCH_COMPLETE | architecture |
| 4 | ARCHITECTURE_COMPLETE | build |
| 5 | BUILD_COMPLETE | validate |
| 6 | VALIDATE_PASS | report |
| 6 | VALIDATE_FAILED → correction (max 3) | build |
| 7 | REPORT_COMPLETE | complete |

## Step Types
Interactive (boss IS operator interface): 1, 2, 4
Background (engine IS operator window): 3, 5, 6, 7

## Build Loop
KRS-One signals: CYCLE_WORKERS (fresh worker pair), MILESTONE_COMPLETE: {name} (next milestone), BUILD_COMPLETE (→ validate). KRS-One loops internally via CYCLE_WORKERS — he does NOT signal ITERATION_COMPLETE.
State: build_iteration incremented each invocation. correction_cycle tracks validate→build loops.

## Transition Quotes
Use quotes from lore.json for step transitions. The Step Transitions table in SKILL.md has the lore keys.

## Spinner Verbs
Install step-appropriate verbs via settings.local.json at each transition. Categories in spinner-verbs.json.

## Agent Personality
Use a random quote from agents.json in the description parameter on every spawn. Vary each time.
