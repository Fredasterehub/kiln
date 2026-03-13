# Lore Engine Reference

How the pipeline engine renders its presentation layer. Read this once at pipeline start, alongside step-definitions, artifact-flow, and brand.md.

All data lives in `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/data/`:
- `lore.json` — transition quotes and greetings
- `spinner-verbs.json` — step-categorized spinner verbs
- `agents.json` — agent aliases and personality quotes

Visual vocabulary is defined in `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/brand.md`. Read it once — single source of truth for all visual patterns.

## The Two-Channel Pattern

Claude Code shows two things for every Bash call: the **command path** (in the collapsed header) and the **output** (the rendered result). The `description` parameter is a no-op — the UI always shows the command, not the description.

Kiln exploits this: themed symlinks at the project root (e.g., `magic/happens`, `deploy/spies`) all point to `kb.sh`. The user sees `Bash(magic/happens)` as the header — a thematic label, not raw printf. The output delivers the visual payoff — colored banner with quote.

- The **command path** sets the scene — `omega/alpha`, `solid/foundation`, `pass/ordontpass`
- The **output** delivers the visual payoff — KILN banner with quote
- The **description** is set for accessibility/logging but does NOT display in the UI header

**Step → Symlink mapping:**

| Step | Command path | User sees |
|------|-------------|-----------|
| 1 Onboarding | `omega/alpha` | `Bash(omega/alpha)` |
| 2 Brainstorm | `brainstorm/crunch` | `Bash(brainstorm/crunch)` |
| 3 Research | `deploy/spies` | `Bash(deploy/spies)` |
| 4 Architecture | `solid/foundation` | `Bash(solid/foundation)` |
| 5 Build | `magic/happens` | `Bash(magic/happens)` |
| 6 Validate | `pass/ordontpass` | `Bash(pass/ordontpass)` |
| 7 Report | `alpha/omega` | `Bash(alpha/omega)` |

**The engine's own text output before a Bash call is also visible.** If the engine writes "Ignition..." and then Bash prints the banner, the user sees both — that's duplication. Rule: **either the engine says it OR Bash prints it, never both.** Let Bash handle all visual rendering. The engine's text should only be used for idle voice and direct operator communication.

## Transition Banners

Every transition is ONE Bash call that renders banner + installs spinner verbs. Keep output to **3 lines max**.

### Standard transitions (step changes)

1. Write banner config (via Bash heredoc):
   ```
   /tmp/kiln_banner.conf:
   Architecture
   Plans are nothing; planning is everything.
   Dwight D. Eisenhower
   /path/to/working/dir
   {"spinnerVerbs":["Confucius contemplates the path forward","Sun Tzu is flanking the requirements",...]}
   ```

2. Call the step's symlink:
   ```
   Bash(command: "solid/foundation", description: "The philosophers convene...")
   ```

The user sees `Bash(solid/foundation)` in the header. kb.sh reads the conf and renders:
```
 KILN ► Architecture
 "Plans are nothing; planning is everything." — Dwight D. Eisenhower
```

### Pipeline start (greeting + banner)

For the first transition, prepend the greeting to the conf title line:

1. Write banner config (via Bash heredoc):
   ```
   /tmp/kiln_banner.conf:
   Ignition
   The secret of getting ahead is getting started.
   Mark Twain
   /path/to/working/dir
   {"spinnerVerbs":["Alpha asks the hard questions","Mapping the territory",...]}
   ```

2. Output the greeting as text, then call the symlink:
   ```
   "The forge is hot, the agents are caffeinated, and Da Vinci already has opinions."
   Bash(command: "omega/alpha", description: "The forge ignites...")
   ```

The user sees the greeting text, then `Bash(omega/alpha)` with the KILN banner.

### Kill Streak (Build iterations)

Kill streak banners also use the symlink, but the conf title should include the streak name:

1. Write banner config (via Bash heredoc):
   ```
   /tmp/kiln_banner.conf:
   ▸ HYPER COMBO              Iteration 4 · Milestone 2/5
   It does not matter how slowly you go as long as you do not stop.
   Confucius
   /path/to/working/dir
   {"spinnerVerbs":["KRS-One drops the knowledge","Codex is typing — don't interrupt",...]}
   ```

2. Call the Build symlink:
   ```
   Bash(command: "magic/happens", description: "KRS-One announces the next combo...")
   ```

The user sees `Bash(magic/happens)` with the kill streak banner in the output.

On milestone completion, add a text line: `✓ Milestone complete: {name}`

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
  → rakim
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
4. **Description is for logging** — set from the brand.md table, but does not control the UI header (the command path does).
5. **One banner per transition** — never two back-to-back without work between.
6. **ANSI for color, Unicode for structure** — colors enhance but never carry meaning alone. Box drawing characters (━ ═ ─) and status symbols (✓ ► ✗ ○) provide structure.
7. **Markdown for interactive output** — checkpoints, approval boxes, status tables.
8. **Step name is the progress** — no step counters or progress icons in banners.
