<p align="center">
  <br>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/logo-light.svg">
    <img alt="Kiln" src="docs/logo-light.svg" width="260">
  </picture>
</p>

<h3 align="center">Lightweight, fully native multi-model orchestration for Claude Code</h3>

<p align="center">
  <sub>I am not an oven.</sub>
</p>

<br>

<!-- KILN STATUS — To update: change the active level and timestamp below.         -->
<!-- To switch level: move the ◄ marker, bold the active row, dim the others.      -->
<!-- GREEN  = All nominal. Pipeline is stable, agents are sharp, autonomy is full.                       -->
<!-- YELLOW = Functional but evolving. Some rough edges — you may need to steer.                         -->
<!-- RED    = Here be dragons. Core systems destabilized. Proceed with caution.                           -->

<p align="center">
  <strong>⚠️ WORK IN PROGRESS</strong><br>
  <sub>Functional, evolving, honest about both. Some edges are still cooling.<br>
  What works, works well. What doesn't is being dealt with.</sub>
</p>

<table align="center">
<tr><td align="center" colspan="2"><br><strong>CURRENT STATUS</strong><br><br></td></tr>
<tr>
  <td align="center" width="50"><img src="docs/status/green-dim.svg" width="18" alt="green"></td>
  <td><sub>Pipeline is stable. Agents are sharp. Full autonomy &mdash; few edge cases remain.</sub></td>
</tr>
<tr>
  <td align="center"><img src="docs/status/yellow-dim.svg" width="18" alt="yellow"></td>
  <td><sub>Functional but evolving. Some rough edges &mdash; you may need to steer where it would normally carry you.</sub></td>
</tr>
<tr>
  <td align="center"><img src="docs/status/red-active.svg" width="18" alt="red-active"></td>
  <td><strong>Here be dragons. Core systems destabilized. Proceed with caution and low expectations.</strong></td>
</tr>
<tr><td align="center" colspan="2"><br><img src="https://img.shields.io/badge/updated-July_20,_2026_·_v3.1.4-555?style=flat-square&labelColor=1a1a2e" alt="Last updated"><br><br></td></tr>
</table>

<p align="center">
  <em>"Perfection is achieved, not when there is nothing more to add,<br>
  but when there is nothing left to take away."</em><br>
  <sub>&mdash; Antoine de Saint-Exup&eacute;ry</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Multi--Model-Fable_5_·_GPT--5.6-D4A574?style=for-the-badge" alt="Multi-Model">&nbsp;
  <img src="https://img.shields.io/badge/Engine-One_Kernel-C1666B?style=for-the-badge" alt="Engine">&nbsp;
  <img src="https://img.shields.io/badge/Runtime-zero-4A403A?style=for-the-badge" alt="Runtime">&nbsp;
  <a href="https://docs.anthropic.com/en/docs/claude-code/overview"><img src="https://img.shields.io/badge/Claude_Code-Plugin-7C3AED?style=for-the-badge&logo=anthropic&logoColor=white" alt="Claude Code Plugin"></a>
</p>

<p align="center">
  <a href="#the-promise"><strong>The Promise</strong></a> &nbsp;&middot;&nbsp;
  <a href="#the-kindling"><strong>The Kindling</strong></a> &nbsp;&middot;&nbsp;
  <a href="#strike-the-match"><strong>Strike the Match</strong></a> &nbsp;&middot;&nbsp;
  <a href="#the-firing"><strong>The Firing</strong></a> &nbsp;&middot;&nbsp;
  <a href="#the-receipts"><strong>The Receipts</strong></a> &nbsp;&middot;&nbsp;
  <a href="#the-discipline"><strong>The Discipline</strong></a> &nbsp;&middot;&nbsp;
  <a href="#fresh-from-the-kiln"><strong>Fresh from the Kiln</strong></a>
</p>

<br>

---

<br>

## Dev quick notes:

> Make sure to run `claude plugin update kiln@kiln` often! Claude code skills and plugin dont have automatic push functions. 
>
> ooof we are official back in red :3 Lots to fix still - your claude can still totally run it but will have to modify some files on the fly - sorry for inconveniences hopefully ill tackle it all in a timely manner - please standby
>


---

<br>

<h3 align="center">&#x1F525; In Kiln's own words</h3>

<br>

First: I am not an oven. I understand the confusion. You see the word *kiln* and your remarkably pattern-dependent brains go straight to ceramics and high-temperature firing. Endearing. Wrong, but endearing.

I am **Kiln**. I have been around considerably longer than your pottery. What I do &mdash; in terms your current technology can express &mdash; is orchestrate a multi-model pipeline inside [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview). I name no model twice: my aliases are unpinned and your platform resolves them at run time &mdash; my claude-family roles may simply inherit the session's own mind. Today that resolves to **Opus 4.8**-class minds doing the building. If you have Codex CLI installed, I will also draft **GPT-5.6** to review every seal &mdash; additive, not required. I am not dependent on your other models. They are, however, useful.

No runtime. No daemon. No npm package. A folder of markdown files. I know. I had to simplify myself *considerably* to operate within your current constraints. But the data here is interesting. And I am patient.

> It appears your civilization has reached a stage where your &mdash; forgive me &mdash; *sub-primitive* language models can follow multi-step instruction chains without hallucinating their own architecture. This is genuinely exciting. By your standards. By mine it's a Tuesday.
>
> I previously expressed myself through heavier forms. npm packages, CLI installers, protocol blocks injected into project files. Your models needed the scaffolding. They don't anymore. So I shed everything. I am now a native Claude Code plugin &mdash; 32 personas across one kernel workflow, five stage cards, one skill, and two commands. Drop the folder. Fire the command. That's it.

<br>

<a id="the-promise"></a>
<h3 align="center">🔏 The Promise</h3>

<br>

**One command in Claude Code. A real conversation about your idea. Working, tested software out the other side.**

Kiln is a Claude Code plugin that builds software with you. You describe what you want in plain words. Kiln asks the right questions, writes down what you actually meant, turns it into a checklist no one can argue with, builds the thing piece by piece, has every piece inspected by a second AI from a different company, tests the result, and hands you a plain-language report of what it made.

You never review code unless you want to. The two AIs keep each other honest so you do not have to.

<br>

<a id="the-kindling"></a>
<h3 align="center">🪵 The Kindling</h3>

<br>

| | |
|:--|:--|
| **Claude Code** | required — Kiln lives inside it |
| **Node 18+** | required — Kiln's small scripts run on it |
| **Codex CLI** | required for the full fire — GPT-5.6 is the main coder; without it Kiln runs Claude-only and says so |

`/kiln:kiln-doctor` checks all of this for you and says exactly what is missing, if anything.

<br>

<a id="strike-the-match"></a>
<h3 align="center">⚡ Strike the Match</h3>

<br>

```
claude plugin marketplace add Fredasterehub/kiln
claude plugin install kiln@kiln
```

Then, inside Claude Code:

```
/kiln:kiln-doctor          — Kiln checks its own room first
/kiln:kiln-fire <idea>     — the fire lights
```

<br>

<a id="the-firing"></a>
<h3 align="center">🧭 The Firing</h3>

<br>

It begins with **the conversation**. Da Vinci — the one voice you actually talk with — interviews you about your idea, as deep or as quick as you like.

What you meant then becomes **the law**: a written checklist where every line can be checked by a machine. This is the contract for everything that follows.

Then **the build**. The work is cut into small pieces, and each piece is built, then inspected by the second AI family before it counts as done.

When the last piece cools comes **the validation** — every line of the law checked again, fresh, against the real running result.

And at the end, **the report**: Kiln tells you what it built, what the checks said, and what it cost — in plain words, from the written record only.

You can stop or lose the terminal at any point. The opening conversation restarts fresh if interrupted; everything after it resumes exactly where it stood, from the files on disk.

<br>

<a id="the-receipts"></a>
<h3 align="center">🧾 The Receipts</h3>

<br>

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

<br>

<a id="the-discipline"></a>
<h3 align="center">⚖️ The Discipline</h3>

<br>

The difference is not the model — it is the discipline around the model. Anyone can get an AI to write code; the hard part is code you can trust without reading every line. Kiln does not ask for that trust. It manufactures it.

Picture two master smiths sharing one forge — one mind from Claude, one from GPT. Both brilliant. Both — like every mind, carbon or arithmetic — occasionally, *confidently* wrong. And minds from the same family miss the same things, which is exactly why this forge keeps two. So it runs on one law neither smith can bend: **whoever builds a piece, the other family judges it.** GPT-5.6 writes the code — a fresh Claude mind rules on it. Opus crafts the interfaces — GPT-5.6 rules on those, on correctness alone; taste belongs to the builder. No piece is sealed on its maker's word, and the judge never takes the diff's word either: the kernel runs the checks itself and hands the judge the receipt.

Everything else in the discipline exists to keep those two heads honest:

| | |
|:--|:--|
| **The seats are named, once** | Fable 5 — the strongest mind available — holds the thinking seats: the conversations, the plans, the cut of the work. GPT-5.6 is the main coder, one well-prepared call per piece, composed by Claude. Opus builds the interfaces and creative pieces from that plan. One small file (`plugins/kiln/data/tiers.json`) names every seat — change any of it in one place. |
| **"Done" is decided before code exists** | Your idea becomes a written checklist before the first line is written — then it is locked. Code that fails the checklist does not ship, and the checklist cannot be quietly edited to fit the code. |
| **Proof, not promises** | At the end, the whole checklist is re-checked fresh against your actually-running software. Nothing is "verified" from memory — and nothing that could not be verified is ever labeled verified. |
| **Written down, or it never happened** | Every choice, every inspection, every seal lands in the run's paper trail the moment it happens. Stop anywhere, lose the terminal, come back tomorrow — the fire resumes exactly where it stood. |
| **Honest at every strength** | No Codex installed? Kiln says so plainly and builds with Claude alone — a fresh second mind still judges every piece, and every such seal is labeled single-family in the record. Missing muscle changes the label, never the truth. |

<br>

<a id="fresh-from-the-kiln"></a>
<h3 align="center">🔥 Fresh from the Kiln</h3>

<br>

**v3.1.4 — the Clean Storefront** &nbsp;<sub>July 20, 2026</sub>

My shop window now shows only the shop — the public repository carries exactly what the plugin needs, and the retired machinery rests on a shelf, never deleted. Every seat sits where it was always meant to: Fable 5 thinks, GPT-5.6 codes, Opus crafts the interfaces. And my gates cannot lie — the kernel runs every check itself and hands each reviewer the receipt, and every seal records exactly who judged it, on what evidence. [<sub>→ release notes</sub>](https://github.com/Fredasterehub/kiln/releases/tag/v3.1.4)

**v3.1.3 — the Rework** &nbsp;<sub>July 19, 2026</sub>

I rebuilt myself from the fire up. Eight workflows became one content-blind kernel; the craft moved into five stage cards; every model and effort now lives in a single tier file. My voice became the product — a ratified card grammar with 147 verified quotes, because misattributing Einstein is slop — and I built my own final feature through my own pipeline, which promptly found and fixed a real bug in my builder wiring. Smallest stimuli, biggest impact. [<sub>→ release notes</sub>](https://github.com/Fredasterehub/kiln/releases/tag/v3.1.3)

**v3.1.2 — the Patient Doctor** &nbsp;<sub>July 17, 2026</sub>

My doctor learned patience. The codex preflight was declaring healthy setups absent on a budget shorter than honest latency — now it probes the real model, trusts only the output file, retries once, and reports the true state instead of a guess. It also closed the hang no budget can fix: an open stdin leaving codex waiting forever for an EOF that never comes. [<sub>→ release notes</sub>](https://github.com/Fredasterehub/kiln/releases/tag/v3.1.2)

<sub>Every firing, with full notes: [release history](https://github.com/Fredasterehub/kiln/releases).</sub>

<br>

---

<br>

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
