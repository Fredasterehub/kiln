# Lore Engine Reference

How the pipeline engine renders its presentation layer. Read this once at pipeline start, alongside step-definitions, artifact-flow, and brand.md.

All data lives in `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/data/`:
- `lore.json` — transition quotes and greetings
- `spinner-verbs.json` — step-categorized spinner verbs
- `agents.json` — agent aliases and personality quotes

Visual vocabulary is defined in `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/brand.md`. Read it once — single source of truth for all visual patterns.

## Core Pattern

Engine text IS the presentation. For every transition, the engine writes the banner directly as markdown in its own response. There are no banner-rendering tool calls and no separate visual surface behind the scenes.

Spinner verbs still install through invisible plumbing:
- One Bash heredoc per transition writes `settings.local.json`
- That Bash call is only for spinner configuration
- The transition banner itself is always markdown text from the engine

### The Narrative Pair

Every transition is a two-part story told through different channels:

1. **Engine text** (before the banner) — a short, evocative line that sets the scene. Drawn from the Transition Voice table in `brand.md`. Example: *"The philosophers convene..."*
2. **Markdown banner** (the visual payoff) — the structured transition with step label, progress line, and quote.

Together they create atmosphere and momentum. The engine text primes the reader; the banner delivers the information. Rules:

- They **complement**, never duplicate. If the engine text says "The philosophers convene..." the banner should not echo "The philosophers are convening."
- The engine text is the only prose the engine writes around a transition. No additional narration before or after the banner.
- If the engine writes it, the banner does not repeat it. One channel owns each piece of information.

## Engine Banners

Three banner types rendered directly by the engine using quotes from `lore.json`. These use the simplified `**KILN** ►` format. Mid-pipeline step transitions use the richer format below.

**Ignition** (fresh run, `lore.json` key `ignition`):
```
`"{random quote}"`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
**KILN** ► Ignition — Alpha starting
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`↳ use` ***shift+↓*** `to switch to Alpha's session`
```

**Resume** (`lore.json` key `resume`):
```
`"{random quote}"`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
**KILN** ► Resuming — `{stage}` · {context from STATE.md}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`↳ spawning team...`
```

**Complete** (`lore.json` key `project_complete`):
```
`"{random quote}"`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
**KILN** ► Complete — `{project_name}`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`↳ report at .kiln/REPORT.md`
```

## Transition Banners

Every transition has two parts:
1. Install spinner verbs silently via Bash heredoc to `settings.local.json`
2. Output the banner as markdown text

### Standard transitions

Use this format for step changes:

```md
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
**ARCHITECTURE** ▸ *Step 4 of 7*
✓ Research · ▶ **Architecture** · ○ *Build*
`"Plans are nothing; planning is everything."` — *Eisenhower*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Pipeline start

For ignition, output the greeting first, then the standard banner:

```md
The forge is hot, the agents are caffeinated, and Da Vinci already has opinions.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
**IGNITION** ▸ *Step 1 of 7*
▶ **Onboarding** · ○ *Brainstorm* · ○ *Research*
`"The secret of getting ahead is getting started."` — *Mark Twain*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Operator checkpoints

When the pipeline needs operator input, render a markdown checkpoint:

```md
╔══════════════════════════════════════════════════════════════╗
║  APPROVAL REQUIRED                                           ║
╚══════════════════════════════════════════════════════════════╝

{Summary}

──────────────────────────────────────────────────────────────
→ approve / edit / abort
──────────────────────────────────────────────────────────────
```

## Kill Streak Banners

Build iterations use the streak format:

```md
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▸ **MULTIPASS** · *Iteration 4* · **Milestone 2/5**
`"It does not matter how slowly you go as long as you do not stop."` — *Confucius*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

On milestone completion, add:

```md
✓ Milestone complete: `{name}`
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
| Correction cycle | `correction_start` | Correction Cycle {N} |
| Step 6 start | `validation_start` | Validation |
| Step 6 VALIDATE_PASS | `validation_passed` | Validation Passed |
| Step 6 VALIDATE_FAILED | `validation_failed` | Validation Failed |
| Step 7 start | `report_start` | Final Report |
| Step 7 done | `project_complete` | Project Complete |
| Session resume | `resume` | Session Resumed |
| Pipeline blocked | `halt` | Pipeline Blocked |
| Session break | `pause` | Session Break |

## Operator Greetings

Engine's last output before going silent on interactive steps. Two lines: character entry + navigation hint.

- **Step 1**
  Alpha is ready. The beginning of the end.
  ↳ shift+↓ to meet Alpha and begin preparation of the kiln
- **Step 2**
  Da Vinci is ready. The vision begins.
  ↳ shift+↓ to join Da Vinci for brainstorming
- **Step 4**
  Aristotle is ready. The plan awaits your judgment.
  ↳ shift+↓ to review the architecture with Aristotle

## Spinner Verbs

Installed silently inside one Bash call per transition. This is invisible plumbing only — never use that call to render banners or other presentation.

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

Before spawning a team, output a spawning block:

```md
◆ Spawning 5 agents...
  → krs-one
  → rakim
  → sentinel
  → asterix (codex)
  → obelix (sphinx)
```

After an agent completes:

```md
✓ `codex` complete: "14 files committed, tests passing"
```

## Idle Voice

When forced to respond during idle (`idle_notification`), output a lore-flavored one-liner. Draw from the current step's spinner verb list or improvise in the same voice.

**Never say**: "Standing by", "Waiting for signal from X", "No updates yet"

Vary each time — never repeat the same line twice in a row.

## Rendering Rules

1. Output banners as markdown text from the engine itself.
2. Use one spinner-install call per transition, with no visible banner rendering in that call.
3. Keep transition text and banner text aligned — no duplicate narration around the banner.
4. Use the markdown weight system from `brand.md`; inline code is the only accent treatment.
5. Use one banner per transition — never stack multiple banners without work between them.
6. Preserve structural consistency with rules, spacing, and status symbols.
7. Use checkpoints for interactive operator states and banners for state transitions.
8. Show progress in the progress line, not by inventing alternate banner formats.
