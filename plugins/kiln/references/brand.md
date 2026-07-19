# Kiln Brand Guide

Visual vocabulary for all Kiln pipeline output. The stage cards and `data/voice.json` reference this file as the taste floor for consistent presentation.

## Sanctioned Surfaces

Kiln's voice appears ONLY on surfaces the platform sanctions and the operator consented to. The sanctioned set:

- **The conductor's conversation** — the kiln-fire skill greets in voice and relays each beat verbatim; one content-blind kernel does the work off-driver and never narrates.
- **Step banners & cards** — the Tier-1 frames and card blocks the five stage cards compose (this document's core).
- **Checkpoint cards** — the ASK composition at the hard stops (the plan gate, a blocked gate, the degradation offer).
- **The doctor & REPORT voice** — `/kiln-doctor` and the final `.kiln/report.md` speak in the same first-person forge voice — plain honest lines, not cards.
- **The `/workflows` progress tree is NOT a voice surface** — the kernel's spawn labels stay mechanical (`stage:law`, `slice:<id>`); the mask lives in the words the cards compose.

**The statusline is DROPPED and stays dropped.** Users own their statusline; overriding it is hostile. Kiln ships zero hooks, no theme, no output style, and no statusline surface.

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
| Normal text | Primary body copy | `Law locked. Moving into build.` |
| **bold** | Emphasis inside prose | `**Approval required** before continuing.` |
| *italic* | Secondary or atmospheric text | `*"Plans are nothing; planning is everything."*` |
| `code span` | Single accent color for labels, paths, and compact identifiers | `` `Validate` `` |
| **`bold code`** | Primary status or banner label | `**\`BUILD\`**` |
| *`italic code`* | Secondary status, subdued labels | `*\`queued\`*` |
| Unicode box drawing | Structural framing and separators | `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` |
| Status symbols | Compact state signaling | `✓ ✗ ▶ ○ ◆ ◇` |

## Accent Rules

The accent color (inline code) follows strict placement rules:

**In banners**: NO accent on the brand line or progress strip — they use bold/italic weight only. The quote foot gets accent: `` `"Quote."` `` — *Source*
**Agent names**: Get accent when referenced outside banners: `` `krs-one` ``, `` `tintin` ``
**Slice names**: Get accent: `` `detail-density-toggle` ``

## Visual Hierarchy

### Tier 1: Step banner — major transitions

Use a heavy rule top and bottom. Brand line and progress strip use bold/italic weight only — no accent; the fraction rides on the active phase alone, counted against a named on-disk checklist. The quote foot rides at the card's close, and it gets the accent.

```md
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
**KILN** · *the project's name*
✓ *Brainstorm* · ✓ *Law* · ▶ **Build 2/5** · ○ *Validate* · ○ *Report*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▸ **ULTRA COMBO** · *Iteration 10* · **Slice 2/5**
`"Quote here."` — *Source*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

On slice seal, add:

```md
✓ Slice sealed: `{name}`
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

Workers are spawned inline by the kernel with mechanical labels — `stage:law`, `slice:detail-density-toggle` — and the personas live one level up: the stage cards compose each beat in a persona voice from `data/voice.json` and the verified banks. The mask is in the words, not the spawn label:

```md
◆ Forging slice `detail-density-toggle` (ui surface)...
  → `argus` (validate) — "A hundred eyes, and every one of them open."
  → `omega` (report) — "The truth, even when it's partial."
```

After completion:

```md
✓ `argus` complete: "12 criteria exercised, none failed"
```

## Agent Personality

The persona is worn in the composed words, never stored as an agent field or a spawn label — only `da-vinci.md` and `the-creator.md` ship as agent files. Banner quotes draw from `data/lore-quotes.json` (147 verified entries, 25 moment keys) under the sealed discipline: never repeat a quote within a run, never invent an attribution.

## Idle Voice

When forced to respond during idle (`idle_notification`):
- One short lore-flavored line
- Vary every time — never repeat
- Never: "Standing by", "Waiting for signal", "No updates yet"

## Transition Voice

The one-line setup text before each card. This text sets the scene; the card delivers the visual payoff. They complement, never duplicate. Source-of-record is `data/voice.json` (`beats`) for the conductor and kernel lines; the stage cards compose their own transitions and pull one verified quote per Tier-1 foot from `data/lore-quotes.json`, keyed by moment.

| Event | Scene-setter |
|---|---|
| Pipeline start | "The forge is lit..." |
| Brainstorm start | "Da Vinci is already uncapping the paint..." |
| Vision compiled | "The vision crystallizes..." |
| Law start | "Asimov takes the bench..." |
| Law locked | "No poetry survives the pinning..." |
| Build start | "KRS-One takes the stage..." |
| Slice start | "{streak}. The slice takes the anvil..." |
| Review passed | "The reviewer steps aside..." |
| Review failed | "The reviewer blocks the gate..." |
| Repair pass | "Back to the forge..." |
| Slice sealed | "The evidence holds..." |
| Slice reopened | "A seal is evidence-bound, not sacred..." |
| Validation start | "Argus opens a hundred eyes..." |
| Validation passed | "A hundred eyes find nothing wrong..." |
| Validation failed | "Argus found something..." |
| Final report | "Omega picks up the pen..." |
| Degradation offered | "Codex is not answering the door..." |
| Single-family accepted | "Miyamoto steps in..." |
| Plan gate | "The forge waits on your word..." |
| Blocked gate | "The gate held — the ruling is yours..." |
| Project complete | "The forge cools. The work remains." |
| Session resumed | "The fire never went out..." |

These lines appear as the natural-language text immediately before the card for each transition. They are atmospheric preamble, not narration about the card itself.

## Anti-Patterns

- Bash tool calls for visual presentation
- Varying banner widths within the same tier
- Engine narration wrapped around a banner that already says the same thing
- Emojis in banners (use status symbols)
- Multiple banners for one transition
- Multiple accent treatments competing with code spans
- Mechanical idle responses
