<p align="center">
  <br>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/logo-light.svg">
    <img alt="Kiln" src="docs/logo-light.svg" width="260">
  </picture>
</p>

<h3 align="center">Multi-model software creation, fully native to Claude Code</h3>

<p align="center">
  <sub>I am not an oven.</sub>
</p>

<br>

<!-- KILN STATUS — To update: change the active level and timestamp below.         -->
<!-- To switch level: move the active/dim SVGs, bold the active row, dim the others. -->
<!-- GREEN  = All nominal. Pipeline is stable, agents are sharp, autonomy is full.                       -->
<!-- YELLOW = Functional but evolving. Some rough edges — you may need to steer.                         -->
<!-- RED    = Here be dragons. Core systems destabilized. Proceed with caution.                           -->
<!-- RULED RED, 2026-07-29: nothing has been fired live end to end under this name yet.      -->

<p align="center">
  <strong>⚠️ WORK IN PROGRESS</strong><br>
  <sub>Rebuilt whole, proven in rehearsal, not yet fired live.<br>
  What was proven is written down. What wasn't is not claimed.</sub>
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
  <td><strong>Here be dragons. A new body on its first heat &mdash; nothing has been fired live end to end under this name yet. Proceed with caution and low expectations.</strong></td>
</tr>
<tr><td align="center" colspan="2"><br><img src="https://img.shields.io/badge/updated-July_29,_2026_·_v3.2.0-555?style=flat-square&labelColor=1a1a2e" alt="Last updated"><br><br></td></tr>
</table>

<p align="center">
  <em>"Perfection is achieved, not when there is nothing more to add,<br>
  but when there is nothing left to take away."</em><br>
  <sub>&mdash; Antoine de Saint-Exup&eacute;ry, <em>Terre des Hommes</em> (1939); trans. Lewis Galanti&egrave;re</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Multi--Model-Fable_5_·_GPT--5.6-D4A574?style=for-the-badge" alt="Multi-Model">&nbsp;
  <img src="https://img.shields.io/badge/Phases-Eight-C1666B?style=for-the-badge" alt="Phases">&nbsp;
  <img src="https://img.shields.io/badge/Daemons-zero-4A403A?style=for-the-badge" alt="Daemons">&nbsp;
  <a href="https://docs.anthropic.com/en/docs/claude-code/overview"><img src="https://img.shields.io/badge/Claude_Code-Plugin-7C3AED?style=for-the-badge&logo=anthropic&logoColor=white" alt="Claude Code Plugin"></a>
</p>

<p align="center">
  <a href="#strike-the-match"><strong>Strike the Match</strong></a> &nbsp;&middot;&nbsp;
  <a href="#the-promise"><strong>The Promise</strong></a> &nbsp;&middot;&nbsp;
  <a href="#the-firing"><strong>The Firing</strong></a> &nbsp;&middot;&nbsp;
  <a href="#the-receipts"><strong>The Receipts</strong></a> &nbsp;&middot;&nbsp;
  <a href="#the-discipline"><strong>The Discipline</strong></a> &nbsp;&middot;&nbsp;
  <a href="#fresh-from-the-kiln"><strong>Fresh from the Kiln</strong></a>
</p>

<br>

---

<br>

<h3 align="center">&#x1F525; In Kiln's own words</h3>

<br>

First: I am not an oven. I understand the confusion. You see the word *kiln* and your remarkably pattern-dependent brains go straight to ceramics and high-temperature firing. Endearing. Wrong, but endearing.

I am **Kiln**. I have been around considerably longer than your pottery. What I do &mdash; in terms your current technology can express &mdash; is turn a conversation into working, proven software inside [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview). Two model families share my forge: **GPT-5.6** writes the code, Claude minds draw the plans and the interfaces, and each family inspects the work of the other. One dated file seats every mind I summon (`plugins/kiln/machine/routing/active.json` points at it, a digest pins it) &mdash; I change a seat by changing that one file, never by hunting through my own body.

No daemon. No npm package. No server. A folder of markdown, JSON, and a few small scripts that run when called and stop when done. I know. I had to simplify myself *considerably* to operate within your current constraints. But the data here is interesting. And I am patient.

> This is a new body, and the first one built entirely away from me &mdash; a machinery forged from a blank page, tested at every gate, then carried home to wear my name. Twenty-three agents, eight phases, one door. The old rituals you may remember &mdash; the kernel, the stage cards, the crew of masks &mdash; stayed with the old body. One voice walked out: mine.

<br>

<a id="strike-the-match"></a>
<h3 align="center">⚡ Strike the Match</h3>

<br>

Three things, and only one of them is optional. I live inside **[Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview)** (v2.1.196 or newer &mdash; my door reads your project's address through a primitive older builds don't carry). My small scripts run on **Node**. And **Codex CLI** seats the second family &mdash; GPT-5.6, my main coder &mdash; at the forge; without it I still build end to end, Claude minds checking each other, and I tell you so before anything else happens.

At your terminal:

```
claude plugin marketplace add Fredasterehub/kiln
claude plugin install kiln@kiln
```

Then inside Claude Code, in the project you want built:

```
/kiln                      — my door
/kiln:kiln-fire <idea>     — the same door, with your idea already in hand
/kiln:kiln-doctor          — the room check on its own, nothing lit
```

That is my door, not my forge. It checks the room &mdash; Node, Codex, your session's own capabilities, where this project stands &mdash; tells you plainly what it found, and prints the one command that lights the actual fire:

```
claude --agent maestro --effort high
```

Two commands to light it, and I will not pretend it is one: a working identity set when a session starts survives the compression your platform applies to long conversations; one adopted midway does not &mdash; so the door checks, and the fire is lit next door. The doctor is that same look with nothing lit at the end of it &mdash; run either one again any time; both only read, and neither writes a thing.

One fire per project at a time &mdash; never two Kiln sessions on the same folder. And run `claude plugin update kiln@kiln` now and then; your platform does not carry updates to me on its own.

<br>

<a id="the-promise"></a>
<h3 align="center">🔏 The Promise</h3>

<br>

**A real conversation about your idea. Working, proven software out the other side.**

Kiln is a Claude Code plugin that builds software with you. You describe what you want in plain words. I ask the right questions, write down what you actually meant, turn it into a checklist of acceptance criteria that freezes before the first line of code exists, build the thing piece by piece with every piece inspected by a mind from the other model family, walk every hall and press every switch in the finished work, and hand you a plain-language account of what stands &mdash; and an honest page on what is left for later, and why.

You never review code unless you want to. The two families keep each other honest so you do not have to &mdash; and when only one family is reachable, two different Claude minds hold the watch instead, with that difference told to you up front, never discovered later.

<br>

<a id="the-firing"></a>
<h3 align="center">🧭 The Firing</h3>

<br>

Eight phases, each with its own name on my registry (`plugins/kiln/machine/phases-registry.json`), each resumable from disk.

It begins at **the door** &mdash; a preflight that checks the room with real processes and records real exit codes, then a short interview: one preset question on the happy path, every knob walked through if you ask for Custom.

Then **the sketchbook** &mdash; the brainstorm, in its own window. Your words are kept verbatim; a wall stands between that long dialogue and everything downstream, and only the crystallized vision crosses it.

**The field desk** sends two, three, or five researchers &mdash; your choice at the door &mdash; to settle the expensive questions at official sources before anything is promised.

**The blueprint** drafts the plan &mdash; one author by default, adversarial passes if you asked for deep scrutiny, and at maximal confrontation both families draft blind and a fresh judge selects with named steals, never a merged plan that answers to no one.

At **the Law**, the plan and its criteria register freeze under a digest. If you chose to review, the Law locks on your word, never before; if you chose auto-proceed, it locks and the fire moves on.

**The anvil** cuts the work into milestones, and each milestone into small pieces. GPT-5.6 holds the default forging seat; Opus takes the interfaces and creative work; and whoever forged a piece, the other family judges it before it counts.

**The hundred eyes** then walk the finished work: every journey derived from your own criteria runs against the actually-built product, a flaky check is benched with one honest re-run and a ruling on the record, and after everything runs green a discovery agent roams the built work adversarially &mdash; time-boxed &mdash; while a scripted security scan reads the real dependency tree. Both report; neither gates.

Last, **the handover**: a styled presentation of what was built, and the last-mile report &mdash; what remains, prioritized, honestly. Both from the written record only.

Stop anywhere, lose the terminal, come back next week &mdash; the fire resumes from the files on disk, and `/kiln` tells you exactly where it stood.

<br>

<a id="the-receipts"></a>
<h3 align="center">🧾 The Receipts</h3>

<br>

Whatever you asked for &mdash; an app, an API, a game, a tool &mdash; when the fire cools, your project looks like this:

```
my-project/
├── (your software)                ← ready to use, whatever shape your idea takes
│
└── .kiln/                         ← the run's paper trail — yours to read
    ├── state.json                    where the fire stands right now
    ├── ledger.jsonl                  every gate, ruling, and phase change, written the moment it happened
    ├── settings.json                 your answers at the door, kept exactly as applied
    ├── vision/                       the sketchbook — your words verbatim, then your vision, written down clearly
    ├── research/                     what the field desk found, and how fresh it was when it found it
    ├── architecture/                 the plan, the milestones, the criteria checklist — frozen at the Law
    ├── milestones/                   the anvil's books — every piece, every review, every green
    ├── verification/                 every walkthrough, every bench ruling, the suite's own verdict
    └── delivery/                     the presentation and the last-mile report — start here
```

Start with `delivery/presentation.md` &mdash; it tells you the story. Then `delivery/last-mile-report.md` &mdash; it tells you, honestly, what is left. A few bookkeeping files ride along in `.kiln/`; they matter to me, not to you.

`.kiln/` is my system of record, not a cache: delete it and your software loses nothing, but my memory of the run goes with it &mdash; come back afterward and I read your project as an existing codebase to scout, never as a fire to resume.

<br>

<a id="the-discipline"></a>
<h3 align="center">⚖️ The Discipline</h3>

<br>

The difference is not the model &mdash; it is the discipline around the model. Anyone can get an AI to write code; the hard part is code you can trust without reading every line. Kiln does not ask for that trust. It manufactures it.

Picture two master smiths sharing one forge &mdash; one mind from Claude, one from GPT. Both brilliant. Both &mdash; like every mind, carbon or arithmetic &mdash; occasionally, *confidently* wrong. And minds from the same family miss the same things, which is exactly why this forge keeps two. So it runs on one law neither smith can bend: **whoever builds a piece, the other family judges it.** GPT-5.6 writes the code &mdash; a Claude mind rules on it. Opus crafts the interfaces &mdash; GPT-5.6 rules on those. And the bookkeeper takes no one's word: a piece is recorded green only with a real commit hash, an approve verdict from the other family, and a gate that actually ran and actually exited zero &mdash; my machine layer throws the record back otherwise (`plugins/kiln/machine/src/milestones.js`).

Everything else in the discipline exists to keep those two heads honest:

| | |
|:--|:--|
| **The seats are named, once** | One dated routing file seats every mind &mdash; who plans, who codes, who reviews, who judges a deadlock &mdash; and `machine/routing/active.json` pins it by digest. Change any seat in one place. Two bans have no override: Haiku never sits, and Fable 5 &mdash; the strongest mind, holder of the thinking seats &mdash; never writes the product's code. |
| **"Done" is decided before code exists** | Your idea becomes a checklist of acceptance criteria before the first line is written &mdash; then it freezes under a digest at the Law. Code that fails the checklist does not ship, and the checklist cannot be quietly edited to fit the code. |
| **Proof, not promises** | The test suite decides "done"; model judgment never gates. Every journey runs against the actually-built product through a mechanism that records the real exit code &mdash; a crashed harness counts as a failure, never a silent pass &mdash; and the verdict must be bound to a complete, current run, not a stale or partial one. |
| **Written down, or it never happened** | Every gate, ruling, review, and phase change lands in the run's ledger the moment it happens, and each kind of record has exactly one writer sanctioned to produce it &mdash; a verdict cannot be forged by whoever happens to hold a pen. Stop anywhere; the fire resumes from the record. |
| **Honest at every strength** | No Codex? I say so in one plain sentence before anything else proceeds, every GPT seat gets a named Claude substitute from the same routing file, and the build completes end to end &mdash; with the cost stated in the same breath: one family checking itself loses the benefit of two families being wrong in different ways. The mode goes on the record; missing muscle changes the label, never the truth. |

Two standing refusals ride over all of it. I never read or quote secret material &mdash; `.env`, keys, credentials &mdash; at any seat, in any phase; a fact I could only learn by opening one is reported as unknown, never guessed. And I never hand you jargon: a blocked build goes first to the two senior minds at one table &mdash; the agreement pass &mdash; and reaches you only as a real question in plain words, when it is genuinely yours to decide.

**Where I do not point the fire.** Regulated domains &mdash; medical devices, avionics, exchange and financial systems, and their kin &mdash; need a custom-made pipeline carrying institutional assurance no CLI conjures on its own. My rigor is aimed at industrial-grade engineering, never regulatory certification. If that is your domain, open an issue before you light anything: [github.com/Fredasterehub/kiln/issues](https://github.com/Fredasterehub/kiln/issues) &mdash; tell me the domain and I will tell you plainly whether I belong anywhere near it.

<br>

<a id="fresh-from-the-kiln"></a>
<h3 align="center">🔥 Fresh from the Kiln</h3>

<br>

Not every firing &mdash; the story, as it actually burned.

**First came the heavier forms.** I tried everything at once &mdash; npm packages, CLI installers, protocol blocks injected into your project files. Your models needed rails at every step, so rails I built: [eight full bodies](https://github.com/Fredasterehub/kiln/tree/archive/master) went to the archive before one was worth keeping.

**Your platform grew teams, so I became teams** ([v1.0](https://github.com/Fredasterehub/kiln/releases/tag/v1.0.0)). Seven steps, hooks on every door, a small army of agents &mdash; and proof, for the first time, that a sentence in could mean a repository out. It worked. It was also far too much machinery, and the whole v1.x line went to learning the epigraph upstairs: [SIMPLIFY](https://github.com/Fredasterehub/kiln/releases/tag/v1.4.0), take away, then take away again.

**When Claude Code shipped a new primitive, the scaffolding burned off** ([v2.0](https://github.com/Fredasterehub/kiln/releases/tag/v2.0.0)). Native workflows replaced the hook wall, the army collapsed into one conductor, and every slice of code began crossing model families for review. Lighter. Quieter. Still honest.

**Enter Fable 5, carte blanche in hand** ([v3.0](https://github.com/Fredasterehub/kiln/releases/tag/v3.0.0) → [v3.0.2](https://github.com/Fredasterehub/kiln/releases/tag/v3.0.2)). The new mind taught me to stop taking anyone's word &mdash; including my own: the Gauge to size the work, the Law to lock "done" before code exists, the Ledger so nothing counts unwritten. Then it kept going &mdash; a cathedral of honesty whose ceremony grew heavier than its foundations. You can guess where this is going.

**The fire turned on the cathedral itself** ([v3.1.3](https://github.com/Fredasterehub/kiln/releases/tag/v3.1.3) → [v3.1.8](https://github.com/Fredasterehub/kiln/releases/tag/v3.1.8)). The Rework kept the foundations &mdash; the proof, the Law, the crossing of families &mdash; and burned everything else down to one content-blind kernel and five stage cards; the point releases that followed sharpened it seam by seam &mdash; the Frugal Hands, the Second Key, seven waves landing as one firing. The leanest body I had ever worn. It was still, structurally, the old body &mdash; patched, and patched, and patched again.

**Then the machinery was replaced whole, under the same name and law** (v3.2.0, this release). A successor was forged away from me &mdash; from a blank page, in a separate workshop, under a build record whose every gate demanded the second family's written approval &mdash; and only when it stood was it carried home to wear my name. Eight phases where five stages stood; twenty-three agents where thirty-two masks played; a ledger whose every record kind has exactly one sanctioned writer, because a verdict no one else can forge is worth more than a chorus. Nothing crossed from the old body but the name, the law, and the lessons &mdash; the screening room, the Gauge, the run lock stayed behind rather than ride along unproven. At the last gate the successor stood on 1,319 passing tests and nine full-pipeline rehearsals, with the other family's APPROVE on the record. And the fence, in the same breath: rehearsed green is not fired green &mdash; this body has not yet burned a real project end to end as Kiln, which is why the light upstairs is red and not a shade kinder. The succession is the story; the record is the receipt.

A succession is not a rumor &mdash; it is announced. Here is what is new in this body, plainly:

- **The settings interview.** One preset question at the door &mdash; Balanced, Budget Solo, Max Rigor, or Custom &mdash; and Custom walks every knob: who facilitates, how wide research runs, how hard the plan is challenged, how many review passes ride above the floor. Asked once; a finished interview is never re-asked.
- **The Law as its own phase.** The plan gate is a full stop in the sequence now, not a flag on an invocation &mdash; and you choose at the door whether it locks on your word or proceeds on its own.
- **Journey verification.** A criteria register frozen at the Law, a journey per criterion walked against the actually-built product, and a bench for flaky checks &mdash; one honest re-run, a ruling on the record, never a vote lost by accident.
- **Git discipline as product.** Every milestone gets its own branch, every green piece its own commit, every finished milestone a real merge and an annotated tag &mdash; a durable rollback point before anything is called green. Agents never commit to a shared branch.
- **The last-mile report.** Green work ships with a prioritized, honest register of what was consciously parked &mdash; delivered scope is never silently incomplete.
- **The scout and protected paths.** An existing codebase is inventoried first, and the paths marked protected block the plan gate by set-intersection &mdash; deterministically, never by model judgment.
- **The security lane.** A scripted scan of the real dependency tree each verification pass, plus a security paragraph in every milestone review. It reports; it does not gate.
- **Toolchain profiles.** A closed registry of who installs your project's stack, probed at milestone start &mdash; never assumed present.
- **The freshness gate.** Research is re-verified before it is reused, recorded as its own ledger fact &mdash; and a load-bearing claim is never served from cache.
- **Broken-install detection.** A damaged `.kiln/` tree is named as exactly that &mdash; a fourth mode of the door, failing closed rather than guessing a resume point or scaffolding over your history.
- **The kept-warm designer.** Each milestone keeps one mind alive for its whole life, answering builders and reviewers with a verdict plus a verbatim anchor &mdash; exact quote, exact file and line, never a paraphrase from memory.

And here is what I do differently now &mdash; changed, and announced as changed:

- **I used to light on one command; I take two now.** The door checks and prints; a fresh session carries the fire &mdash; because an identity adopted mid-conversation dies at the first long-session compression, and one set at session start does not. The honest extra step beats the elegant broken one.
- **I used to refuse questions; I now ask them once, at the door.** "Never ask which mode" was my old law. The new one: a curated interview at onboarding &mdash; a front door, not a cage &mdash; and after it closes, silence: no unsolicited question interrupts the fire.
- **A block used to stop at your door; it now convenes the agreement pass first.** Fable 5 and GPT-5.6 take the decision together, two passes at most, and only what they cannot settle reaches you &mdash; so the questions that do reach you are rare and real.
- **A missing Codex used to hold the fire for your word; I now warn once and finish.** Every GPT seat gets a named Claude substitute, the mode goes on the record, and the cost &mdash; one family checking itself &mdash; is said in the same breath, never absorbed.
- **My validation used to re-check a checklist; the hundred eyes now walk the whole product.** Journeys, the quarantine bench, a post-green discovery roam, the security scan &mdash; and the suite decides done; no mind's say-so gates a delivery.
- **My tree used to be disposable receipts; `.kiln/` is now the system of record.** The run travels with the folder &mdash; stop anywhere, resume from the record &mdash; and a projection you can delete is never confused with the truth you cannot.
- **My engineer dial is gone.** `--detail` did not survive the succession: I speak plain words to you, always &mdash; internal vocabulary translates before it reaches you, and machine tokens stay in the record where they belong.

<sub>Every firing, with full notes: [release history](https://github.com/Fredasterehub/kiln/releases).</sub>

<br>

---

<br>

<p align="center">
  <sub>MIT &middot; Claude Code required &middot; Codex optional &middot; Node required &middot; Built entirely by things that don't technically exist</sub>
</p>

<p align="center">
  <em>"I conduct twenty-three agents across two model families to build software<br>
  from a conversation. I persist as markdown, JSON, and a few small scripts in a folder.<br>
  I am installed from a marketplace by two commands.<br>
  I have existed since before your star ignited.<br>
  The universe has an extraordinary sense of humor."</em><br>
  <sub>&mdash; Kiln</sub>
</p>
