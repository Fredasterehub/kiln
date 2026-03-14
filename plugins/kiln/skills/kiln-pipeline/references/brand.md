# Kiln Brand Guide

Visual vocabulary for all Kiln pipeline output. The engine and all agents reference this file for consistent presentation.

## Design Principles

1. **Structure carries meaning** — use rules, spacing, and symbols to create hierarchy. Never depend on color beyond the single accent implied by code spans.
2. **Engine text is the surface** — Claude renders plain text with GitHub-flavored markdown. Write the presentation directly in the response.
3. **Weight over decoration** — emphasis comes from markdown weight shifts, not visual tricks. Use the lightest weight that still makes the state obvious.
4. **One transition, one banner** — step changes should render once, cleanly, without surrounding narration that repeats the same information.
5. **Quotes create breathing room** — transition copy should feel intentional, not noisy. Keep the quote short and let the rule frame it.
6. **Tense switching** — gerund during ("Forging..."), past tense after ("Forged: layout system").

## Markdown Weight System

The presentation surface has exactly one accent color: inline code. Use these eight weights deliberately.

| Weight | Use | Example |
|---|---|---|
| Normal text | Primary body copy | `Architecture locked. Moving into build.` |
| **bold** | Emphasis inside prose | `**Approval required** before continuing.` |
| *italic* | Secondary or atmospheric text | `*"Plans are nothing; planning is everything."*` |
| `code span` | Single accent color for labels, paths, and compact identifiers | `` `Research` `` |
| **`bold code`** | Primary status or banner label | `**\`ARCHITECTURE\`**` |
| *`italic code`* | Secondary status, subdued labels | `*\`queued\`*` |
| Unicode box drawing | Structural framing and separators | `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` |
| Status symbols | Compact state signaling | `✓ ✗ ▶ ○ ◆ ◇` |

## Visual Hierarchy

### Tier 1: Step banner — major transitions

Use a heavy rule top and bottom. Lead with the current step in bold code, then a progress line, then the quote.

```md
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
**`ARCHITECTURE`** ▸ *Step 4 of 7*
✓ `Research` · ▶ **`Architecture`** · ○ *Build*
*"Plans are nothing; planning is everything."* — Eisenhower
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Tier 2: Checkpoint — operator input needed

```md
╔══════════════════════════════════════════════════════════════╗
║  APPROVAL REQUIRED                                           ║
╚══════════════════════════════════════════════════════════════╝

{Content}

──────────────────────────────────────────────────────────────
→ {ACTION PROMPT}
──────────────────────────────────────────────────────────────
```

### Tier 3: Light rule — section separators

```md
──────────────────────────────────────────────────────────────
```

## Kill Streak Banners

Use the same heavy framing, but make the streak name the anchor and keep iteration metadata on the same line.

```md
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▸ **`HYPER COMBO`** · *Iteration 4* · **Milestone 2/5**
*"Quote here."* — Source
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

On milestone completion, add:

```md
✓ Milestone complete: {name}
```

## Status Symbols

```md
✓  Complete / Passed
✗  Failed / Blocked
▶  Active / In Progress
○  Pending
◆  Spawn / Team action
◇  Secondary marker / Optional action
```

## Spawning Indicators

```md
◆ Spawning 5 agents...
  → krs-one
  → codex
  → rakim
  → sentinel
  → sphinx
```

After completion:

```md
✓ codex complete: "14 files committed"
```

## Agent Personality

When spawning, set `description:` to a personality quote from `agents.json`. Pick a different quote each spawn — never repeat within a session.

## Idle Voice

When forced to respond during idle (`idle_notification`):
- One short lore-flavored line
- Vary every time — never repeat
- Never: "Standing by", "Waiting for signal", "No updates yet"

## Anti-Patterns

- Bash tool calls for visual presentation
- Varying banner widths within the same tier
- Engine narration wrapped around a banner that already says the same thing
- Emojis in banners (use status symbols)
- Multiple banners for one transition
- Multiple accent treatments competing with code spans
- Mechanical idle responses
