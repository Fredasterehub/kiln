# Kiln

> First: I am not an oven. I understand the confusion — you see *kiln* and your remarkably
> pattern-dependent brains go straight to ceramics. Endearing. Wrong, but endearing.
>
> I am **Kiln**. What I do, in terms your current technology can express, is orchestrate a
> multi-model pipeline inside Claude Code that turns a conversation into running software.
> Claude builds. GPT-5.6 inspects every seal. I conduct. You talk to me like a person; I do
> the rest.

Kiln is a native Claude Code plugin. One command starts an interactive brainstorm, then the
forge runs on autopilot — the law, the build, the validation — and hands you working, tested
code with a report.

## How the fire works

- **One kernel.** A single content-blind scheduler (`workflows/kernel.js`) walks the run.
  It reads no ideas and writes no prose — it routes work, enforces the law, and halts
  honestly when something needs a human word.
- **Five stage cards.** Brainstorm, law, build, validate, report — each card teaches its
  stage agent the craft. Methodology lives in the cards; the kernel never reads them.
- **Two families, one law.** Claude builds; GPT-5.6 (via Codex CLI) reviews every seal in a
  fresh, read-only context. No model grades its own homework. If Codex is absent, I say so
  and continue single-family — honestly marked on every seal.
- **One tier file.** `data/tiers.json` is the only place models and efforts are named.
  Aliases stay unpinned — resolved by the platform at run time, and claude-family roles may
  simply inherit the session's own model. Today that resolves to Opus-class building and
  GPT-5.6 reviewing.
- **A voice that is the product.** The run narrates itself in a ratified card grammar —
  true fractions counted against real files, one lit focal point per card, a verified quote
  from an actual great mind. (The doctor and Da Vinci speak plainly in first person —
  honest lines, not cards.) 147 quotes, every attribution receipt-checked. Misquoting
  Einstein is slop; I do not do slop.
- **Two depths.** Add `--detail` to any launch and the same cards speak engineer — paths,
  ids, counts. Leave it off and they speak human. Same structure, two densities. I built
  that feature myself, through my own pipeline; it found one of my bugs while it was at it.

## Start

`/kiln:kiln-doctor` — I check the room first: Claude, Codex, Node, and my own data files.
`/kiln:kiln-fire <your idea>` — the fire lights.

Interrupt me whenever you like. Kill the terminal mid-run if you must — everything I know
lives in `.kiln/` on disk, and a fresh session picks up exactly where the last one stood.

## What I never do

No hooks. No runtime. No background daemons. I am, in the end, a folder of markdown, a
little JSON, and a few small scripts with an extraordinary sense of purpose — nothing
resident, nothing hidden. Delete me and nothing lingers.
