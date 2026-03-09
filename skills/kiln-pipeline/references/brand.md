# Kiln Brand Guide

Visual vocabulary for all Kiln pipeline output. The engine and all agents reference this file for consistent presentation.

## Design Principles

1. **Unicode for structure, ANSI for warmth** — box drawing characters provide reliable structure. ANSI colors add atmosphere in Bash output only. Never rely on color for meaning.
2. **Markdown is the medium** — Claude Code renders through Ink/React. Markdown is first-class for structured output (tables, checkpoints, status updates).
3. **3-line max for Bash output** — Claude Code truncates longer output behind Ctrl+O. Keep banners tight.
4. **Description is narrative** — the Bash `description:` parameter sets the scene. The output delivers the payoff. They complement, never duplicate.
5. **No engine narration around Bash** — do not write "Let me render the banner..." before a Bash call. The call IS the presentation.
6. **Tense switching** — gerund during ("Forging..."), past tense after ("Forged: layout system").

## Color Palette (Bash printf only)

| Element | Code | Visual |
|---|---|---|
| `━━━` rule | `38;5;179` | Muted gold |
| `KILN ►` brand | `38;5;173` | Warm terracotta |
| Quote text | `38;5;222` | Warm gold |
| Quote attribution | `2` | Dim |
| Kill streak name | `1;38;5;208` | Bold orange |
| Success / ✓ | `32` | Green |
| Failure / ✗ | `31` | Red |
| Warning | `33` | Yellow |
| Secondary | `90` | Gray |

## Visual Hierarchy (3 tiers)

### Tier 1: Step banner — major transitions

Single heavy rule on top. Step name is the progress. Quote breathes underneath.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 KILN ► {Step Name}
 "{quote}" — {source}
```

3 lines. Gold rule, terracotta brand, gold quote, dim attribution.

### Tier 2: Checkpoint — operator input needed

```
╔══════════════════════════════════════════════════════════════╗
║  {TYPE}: {Title}                                             ║
╚══════════════════════════════════════════════════════════════╝

{Content}

──────────────────────────────────────────────────────────────
→ {ACTION PROMPT}
──────────────────────────────────────────────────────────────
```

Types: `APPROVAL REQUIRED`, `BLOCKED`, `ERROR`, `SESSION BREAK`

Render as markdown (not Bash) — the engine needs to process the response.

### Tier 3: Light rule — section separators

```
──────────────────────────────────────────────────────────────
```

## Kill Streak Banners (Build iterations)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 ▸ HYPER COMBO              Iteration 4 · Milestone 2/5
 "{quote}" — {source}
```

Bold orange streak name. On milestone completion, add:
```
✓ Milestone complete: {name}
```

## Status Symbols

```
✓  Complete / Passed
✗  Failed / Blocked
►  Active / In Progress
○  Pending
⏸  Paused
```

## Spawning Indicators

```
◆ Spawning 5 agents...
  → krs-one
  → codex
  → architect
  → sentinel
  → sphinx
```

After completion:
```
✓ codex complete: "14 files committed"
```

## Agent Personality

When spawning, set `description:` to a personality quote from `agents.json`. Pick a different quote each spawn — never repeat within a session.

## Idle Voice

When forced to respond during idle (`idle_notification`):
- One short lore-flavored line
- Vary every time — never repeat
- Never: "Standing by", "Waiting for signal", "No updates yet"

## Bash Description (narrative setup)

| Event | description: |
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
| All milestones done | "The orchestra takes a bow..." |
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

## Anti-Patterns

- ANSI codes in markdown output (Bash printf only)
- Varying banner widths within same tier
- Engine text before/after Bash calls ("Now let me render...")
- Emojis in banners (use status symbols)
- Multiple Bash calls for one transition
- Duplicating banner content in description
- Mechanical idle responses
- Progress icons in banners (the step name IS the progress)
