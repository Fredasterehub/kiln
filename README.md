<p align="center">
  <br>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/logo-light.svg">
    <img alt="Kiln" src="docs/logo-light.svg" width="260">
  </picture>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/updated-July_19,_2026_·_v3.1.3-555?style=flat-square&labelColor=1a1a2e" alt="Last updated">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Multi--Model-Fable_5_·_GPT--5.6-D4A574?style=for-the-badge" alt="Multi-Model">&nbsp;
  <img src="https://img.shields.io/badge/Engine-One_Kernel-C1666B?style=for-the-badge" alt="Engine">&nbsp;
  <img src="https://img.shields.io/badge/Runtime-zero-4A403A?style=for-the-badge" alt="Runtime">&nbsp;
  <a href="https://docs.anthropic.com/en/docs/claude-code/overview"><img src="https://img.shields.io/badge/Claude_Code-Plugin-7C3AED?style=for-the-badge&logo=anthropic&logoColor=white" alt="Claude Code Plugin"></a>
</p>

# Kiln

**One command in Claude Code. A real conversation about your idea. Working, tested software out the other side.**

Kiln is a Claude Code plugin that builds software with you. You describe what you want in plain words. Kiln asks the right questions, writes down what you actually meant, turns it into a checklist no one can argue with, builds the thing piece by piece, has every piece inspected by a second AI from a different company, tests the result, and hands you a plain-language report of what it made.

You never review code unless you want to. The two AIs keep each other honest so you do not have to.

## Install

```
claude plugin marketplace add Fredasterehub/kiln
claude plugin install kiln@kiln
```

Then, inside Claude Code:

```
/kiln:kiln-doctor          — Kiln checks its own room first
/kiln:kiln-fire <idea>     — the fire lights
```

> Make sure to run `claude plugin update kiln@kiln` often! Claude code skills and plugin dont have automatic push functions. 
>
> I'm keeping it yellow — lots of growing pain with the new fable he literally vomited the most insane ai slop, drifted us away from our original objectives and themes, although I did gave it full "carte blanche" to take the project - Its was a disaster.
> We are going back to a much more lightweight as originally designed.
>
> > Hope it helps anyone, give inspiration!

## What happens when the fire lights

1. **The conversation.** Da Vinci — the one voice you actually talk with — interviews you about your idea, as deep or as quick as you like.
2. **The law.** What you meant becomes a written checklist where every line can be checked by a machine. This is the contract for everything that follows.
3. **The build.** The work is cut into small pieces. Each piece is built, then inspected by the second AI family before it counts as done.
4. **The validation.** At the end, every line of the law is checked again, fresh, against the real running result.
5. **The report.** Kiln tells you what it built, what the checks said, and what it cost — in plain words, from the written record only.

You can stop or lose the terminal at any point. The opening conversation restarts fresh if interrupted; everything after it resumes exactly where it stood, from the files on disk.

## What a run leaves in your project

Whatever you asked for — an app, an API, a game, a tool — when the fire cools, your project looks like this:

```
my-project/
├── (your software)                ← ready to use, whatever shape your idea takes
│
└── .kiln/                         ← the run's paper trail — yours to read
    ├── brainstorm-ledger.jsonl       your conversation with Da Vinci, kept word for word
    ├── docs/vision.md                what you meant, written down clearly
    ├── LAW.md                        that vision turned into a checklist anyone can verify
    ├── law/check.sh                  the script that verifies every line of it
    ├── slices.json                   the work, cut into small pieces
    ├── STATE.md                      where the run stands right now
    ├── decisions.md                  every choice made while building, and why
    ├── seals.log                     every seal — a piece that passed inspection — and when
    ├── validate.md                   the final proof — the whole checklist re-checked
    │                                 against your actually-running software
    └── report.md                     the story of the run, in plain words
```

Start with `report.md` — it tells you everything. A few small bookkeeping files ride along in `.kiln/` too; they only matter to Kiln.

Delete `.kiln/` after a run if you like — your software does not need it. Keep it and Kiln can pick the work back up any time.

## The two minds

- **GPT-5.6 writes the code.** The main coder, working through the Codex program — one well-prepared call per piece, composed by Claude — with Claude inspecting every piece it builds.
- **Claude thinks and designs.** Fable 5 — the strongest mind available — leads the conversations, the plans, and the cut of the work; Opus implements the interfaces and creative pieces from that plan. GPT-5.6 inspects what Claude builds.
- **Nothing counts until the other family has inspected it.** No AI grades its own homework.
- **No Codex?** Kiln says so plainly and continues with Claude alone — every such piece honestly labeled in the run record.

One small file (`plugins/kiln/data/tiers.json`) names every seat — change any of it in one place.

## What you need

| | |
|:--|:--|
| **Claude Code** | required — Kiln lives inside it |
| **Node 18+** | required — Kiln's small scripts run on it |
| **Codex CLI** | required for the full fire — GPT-5.6 is the main coder; without it Kiln runs Claude-only and says so |

`/kiln:kiln-doctor` checks all of this for you and says exactly what is missing, if anything.

## Fresh from the Kiln

**v3.1.3 &mdash; the Rework** &nbsp;<sub>July 19, 2026</sub>

I rebuilt myself from the fire up. Eight workflows became one content-blind kernel; the craft moved into five stage cards; every model and effort now lives in a single tier file with unpinned names. My voice became the product — a ratified card grammar with true fractions and 147 verified quotes, because misattributing Einstein is slop. My old body was retired whole — moved aside, never deleted. And the proof is the point: I built my own final feature — a --detail toggle that makes every card speak either human or engineer — through my own pipeline, which promptly found and fixed a real bug in my builder wiring. Smallest stimuli, biggest impact. [<sub>→ release notes</sub>](https://github.com/Fredasterehub/kiln/releases/tag/v3.1.3)

<sub>Every release, with full notes: [release history](https://github.com/Fredasterehub/kiln/releases).</sub>

<p align="center">
  <sub>MIT &middot; Claude Code required &middot; Codex optional &middot; Node 18+ &middot; Built entirely by things that don't technically exist</sub>
</p>

<p align="center">
  <em>"I orchestrate 34 named entities across multiple model families to build software<br>
  from a conversation. I persist as markdown files in a folder.<br>
  I am installed by pointing a flag at my directory.<br>
  I have existed since before your star ignited.<br>
  The universe has an extraordinary sense of humor."</em><br>
  <sub>&mdash; Kiln</sub>
</p>
