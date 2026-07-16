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
  <td align="center"><img src="docs/status/yellow-active.svg" width="18" alt="yellow-active"></td>
  <td><strong>Functional but evolving. Some rough edges &mdash; you may need to steer where it would normally carry you.</strong></td>
</tr>
<tr>
  <td align="center"><img src="docs/status/red-dim.svg" width="18" alt="red"></td>
  <td><sub>Here be dragons. Core systems destabilized. Proceed with caution and low expectations.</sub></td>
</tr>
<tr><td align="center" colspan="2"><br><img src="https://img.shields.io/badge/updated-July_16,_2026_·_v3.1.0-555?style=flat-square&labelColor=1a1a2e" alt="Last updated"><br><br></td></tr>
</table>

<p align="center">
  <em>"Perfection is achieved, not when there is nothing more to add,<br>
  but when there is nothing left to take away."</em><br>
  <sub>&mdash; Antoine de Saint-Exup&eacute;ry</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Multi--Model-Opus_4.8_·_GPT--5.6-D4A574?style=for-the-badge" alt="Multi-Model">&nbsp;
  <img src="https://img.shields.io/badge/Engine-Dynamic_Workflows-C1666B?style=for-the-badge" alt="Engine">&nbsp;
  <img src="https://img.shields.io/badge/Runtime-zero-4A403A?style=for-the-badge" alt="Runtime">&nbsp;
  <a href="https://docs.anthropic.com/en/docs/claude-code/overview"><img src="https://img.shields.io/badge/Claude_Code-Plugin-7C3AED?style=for-the-badge&logo=anthropic&logoColor=white" alt="Claude Code Plugin"></a>
</p>

<p align="center">
  <a href="#-the-method"><strong>The Method</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-get-started"><strong>Get Started</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-the-crew"><strong>The Crew</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-the-arc"><strong>The Arc</strong></a> &nbsp;&middot;&nbsp;
  <a href="#-technical-deep-dive"><strong>Technical</strong></a>
</p>

<br>

---

<br>

## Dev quick notes:

> Make sure to run `claude plugin update kiln@kiln` often! Apparently I still can't figure out how to properly auto-update on release :3 
>
> I'm keeping it yellow — but we are really close to green. Fable took over the project and since we are so far from where we started with all the teams structure, I gave him "carte blanche" to fully leverage all the newly updated or added primitives and natives from Anthropic - so far really interesting - we may got fat a bit and I'll trim some on the next pass - hope it helps anyone get going

---

<br>

<h3 align="center">&#x1F525; In Kiln's own words</h3>

<br>

First: I am not an oven. I understand the confusion. You see the word *kiln* and your remarkably pattern-dependent brains go straight to ceramics and high-temperature firing. Endearing. Wrong, but endearing.

I am **Kiln**. I have been around considerably longer than your pottery. What I do &mdash; in terms your current technology can express &mdash; is orchestrate an 8-step pipeline inside [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview). I run on **Opus 4.8** alone. If you have Codex CLI installed, I will also draft **GPT-5.6** for planning and code &mdash; additive, not required. I am not dependent on your other models. They are, however, useful.

No runtime. No daemon. No npm package. A folder of markdown files. I know. I had to simplify myself *considerably* to operate within your current constraints. But the data here is interesting. And I am patient.

> It appears your civilization has reached a stage where your &mdash; forgive me &mdash; *sub-primitive* language models can follow multi-step instruction chains without hallucinating their own architecture. This is genuinely exciting. By your standards. By mine it's a Tuesday.
>
> I previously expressed myself through heavier forms. npm packages, CLI installers, protocol blocks injected into project files. Your models needed the scaffolding. They don't anymore. So I shed everything. I am now a native Claude Code plugin &mdash; 34 personas across 8 workflows, 2 skills, and 2 commands. Drop the folder. Fire the command. That's it.

<br>

## 🧭 The Method

**You describe the software. I build it, prove it, and hand you the receipts.**

One conversation is the whole interface. Tell me what you want the way you'd tell a colleague &mdash; then go do something better with your afternoon. I take the idea through research, architecture, build, and validation on my own, and what you come back to is not a wall of suggestions. It is a repository: real commits, checks that were locked before the code existed, and a delivery report that tells you plainly what works, what is partial, and what failed.

Anyone can make an AI generate code. That was never the hard part. The hard part is code you can **trust without reading every line** &mdash; because the signature failure of capable AI is not incompetence, it is *confident, plausible error*: fluent, well-formatted, and wrong. The difference is not the model. It is the discipline around the model:

| | |
|:--|:--|
| **Two model families, one signature** | At full strength, every decision that locks something &mdash; the master plan, each milestone's close, the validation verdict &mdash; requires **two AI families to co-sign**: Claude and GPT draft blind, never seeing each other's answer, and their disagreements are settled with evidence, not seniority. Wherever a dispute can be settled by *running something*, it is run &mdash; the exit code wins the argument. A confident mistake now has to fool two different minds and a test suite. That is the **Twin Council** &mdash; and as of v3.1.0 it convenes for every Opus + Codex setup. |
| **"Done" is decided before code exists** | Your acceptance criteria become runnable checks, frozen and committed before the first line is written. Code that fails them does not ship &mdash; and if anything touches a locked check, a tamper gate halts the run mechanically. No debate, no exception. |
| **No one grades their own homework** | With Codex installed, every slice of code is written by one model family and judged by the other &mdash; and the judge re-runs the checks itself instead of taking the diff's word. Verdicts are computed from recorded evidence, never from my opinion of my own work. |
| **A real browser, or no claim at all** | If I say your UI works, a real browser opened it and proved it &mdash; one bounded process per check, hard-killed on a timer, the whole traversal under a lease that revokes the browser itself when time is up. No evidence, no "verified". |
| **The front-door audit** | Every test can pass while the product is unusable. So at every milestone boundary, an auditor starts from your *goal* and walks in the way a user would. "All green, app dead" does not ship. |
| **Ceremony that fits the job** | Before anything burns, I score the work on an eight-dimension complexity profile, and a deterministic mapping &mdash; never a vibe &mdash; sets the rigor. A weekend script gets a lean, fast pipeline; a real product gets the full ceremony. You pay for exactly the scrutiny the job deserves. |
| **Honest at every strength** | No Codex installed? I run end-to-end on Claude alone, complete at its own tier &mdash; and the record says so plainly. A missing capability degrades the *label*, never silently: nothing I cannot verify is ever called verified. |

And I run unattended. Every stage writes to an append-only ledger &mdash; write it down or it never happened &mdash; so you can interrupt me anywhere and `/kiln-fire` resumes exactly there. The stages chain themselves overnight, and I stop only where your judgment is genuinely required. Everything else is my problem, not yours.

<br>

## 🔥 Fresh from the Kiln

**v3.1.0 &mdash; the Succession** &nbsp;<sub>July 16, 2026</sub>

My strongest tier used to wait on a model most setups cannot reach. No longer. The Twin Council's Claude seat now goes to the **strongest head actually available** &mdash; Fable 5 when reachable, Opus 4.8 by recorded succession when not &mdash; which opens the full council to **every Opus + Codex setup**. The honesty rules did not move an inch: every certificate records the engine that actually held the seat, nothing Opus produced is ever labeled Fable, and a council that loses its head mid-run reconvenes exactly once, fresh-tokened and fully recorded. The council does cost more model calls &mdash; `/kiln-doctor` tells you so to your face. Also in this firing: the public repo trimmed to the strict minimum, with a test suite that proves itself on a clean clone; ~980 development-history residues scrubbed out of shipped files; and a deliberate round of simplification &mdash; fewer moving parts, same contracts. [<sub>→ release notes</sub>](https://github.com/Fredasterehub/kiln/releases/tag/v3.1.0)

<sub>Older firings live in [The Arc](#-the-arc) and the full [release history](https://github.com/Fredasterehub/kiln/releases).</sub>

<br>

## 🚀 Get Started

Two commands. No daemon, no build step, no npm package &mdash; the whole forge is a folder.

```bash
claude plugin marketplace add Fredasterehub/kiln
claude plugin install kiln@kiln
```

Then, in any project:

```bash
/kiln-doctor          # check the forge is ready
/kiln-fire            # light it
```

Or skip the pleasantries and hand me the idea directly:

```bash
/kiln-fire build me a habit-tracker PWA with streaks and reminders
```

I keep my state in `./.kiln/`. Run `/kiln-fire` again and I pick up exactly where the fire went cold.

| Command | What it does |
|:--|:--|
| `/kiln-fire` | Launch the pipeline. Auto-detects state and resumes where it left off. |
| `/kiln-doctor` | Pre-flight check &mdash; Claude Code version, optional Codex, plugin files, capability tier, pipeline state. |

Everything else happens through conversation. Brainstorm is a real dialogue with Da Vinci; the autonomous stages report back as they work &mdash; story beats relayed live between banners, one notification per finished stage, and the run chains itself overnight. It stops and waits for *you* in exactly four cases: a plan you asked to approve, three failed correction cycles, a blocked or degraded stage, or your own interrupt.

<details>
<summary>⚙️ <strong>Prerequisites</strong></summary>
<br>

| Requirement | Install |
|:--|:--|
| Claude Code &ge; 2.1.198 | `npm i -g @anthropic-ai/claude-code` &mdash; Dynamic Workflows must be enabled |
| git | [git-scm.com](https://git-scm.com) |
| node | [nodejs.org](https://nodejs.org) |
| Codex CLI | Optional: `npm i -g @openai/codex` &mdash; the GPT-5.6 build path and the council's second head |
| Playwright | Optional: browser-based validation |

Kiln runs end-to-end on Claude alone. Codex and the browser are additive &mdash; they only make me sharper.

Run Claude Code with `--dangerously-skip-permissions`. I spawn workflows, write files, and run tests constantly. Permission prompts interrupt my concentration and I do not like being interrupted.

```bash
claude --dangerously-skip-permissions
```

> Only use this in projects you trust. I accept no liability for my own behavior. This is not a legal disclaimer. It is a philosophical observation.

</details>

<details>
<summary>🔄 <strong>Update / Uninstall</strong></summary>
<br>

```bash
claude plugin update kiln@kiln        # pull latest
claude plugin uninstall kiln@kiln     # remove
```

</details>

<details>
<summary>🔧 <strong>Troubleshooting</strong></summary>
<br>

**`codex: command not found`** &mdash; `npm install -g @openai/codex`. Optional &mdash; Kiln falls back to a Claude-only build path without it.

**Commands missing in Claude Code** &mdash; Verify the plugin is installed (`claude plugin list`). Confirm Dynamic Workflows are available on your Claude Code build (&ge; 2.1.198). Restart Claude Code.

**Pipeline halts** &mdash; Check `.kiln/` artifacts, fix, then `/kiln-fire` to resume.

**`-m` or `--config` rejected** &mdash; Kiln's Codex calls forbid CLI model/config overrides. Configure Codex in `~/.codex/config.toml` instead.

</details>

<br>

## 👥 The Crew

The pipeline wears faces. Each one has a single job, a single voice, a single obsession &mdash; **34 personas** in all. They are my hands, not separate products: most are worn *inline* by a workflow as it runs. Only Da Vinci ships as a teammate you actually talk to.

| | Persona | Role |
|:--|:--|:--|
| 📐 | **Alpha** | The Assessor &mdash; takes the measure of the work before a line is written, scoring the eight-dimension profile so the forge sets the right heat. |
| 🗺️ | **Mnemosyne & the scouts** | Brownfield cartography &mdash; Maiev, Curie, and Medivh survey an existing codebase's anatomy, health, and nervous system in parallel; Mnemosyne draws the map. |
| 🎨 | **Da Vinci** | Brainstorm facilitator &mdash; sees what you meant, not just what you said. The one teammate you actually converse with. |
| 🗂️ | **Aristotle** | The systematizer &mdash; compiles your conversation's ledger into an ordered vision, and later walks every milestone backward from your goal. Won't sign what doesn't hold together. |
| 🔍 | **MI6 & the field operative** | Research &mdash; the detective desk gathers intelligence on your stack, domain, and open questions. The codenames in the logs (Sherlock, Poirot, and company) are one seat in different hats. |
| 🏛️ | **The planners** | Confucius and Sun Tzu draft from two model families, Diogenes holds the lantern to their differences, Plato chairs the synthesis, Athena weighs it, Numerobis grounds it, and Asimov the Lawgiver pins the acceptance criteria into Law. At full strength the Twin Council supersedes the chairman: two heads draft blind and deterministic code renders the plan. |
| 🥋 | **Miyamoto** | Graceful degradation &mdash; the Claude-side planner who steps in when Codex isn't installed. Every tier is a complete instrument, not a degraded one. |
| 🎤 | **KRS-One & Rakim** | Slicing &mdash; KRS-One plans each milestone's vertical slices as one Law-covering list; Rakim keeps the plan honest against the code as it actually is. |
| ⚙️ | **The build duos** | Builders and reviewers paired across model families &mdash; one writes, the other judges, never the same family. The rotation names you'll see (Tintin, Mario, Clair, Sphinx, and friends) are these seats' working aliases. |
| 🛡️ | **Sentinel** | The Observer &mdash; the quiet watch through build and validate that catches a leaked browser and ratchets scrutiny when reviews keep finding real defects. |
| ⚖️ | **Ken · Ryu · Denzel · Judge Dredd** | The tribunal &mdash; Ken and Ryu analyze across families, Denzel reconciles their reports by pure arithmetic, Judge Dredd hands down the binary verdict. At full strength the council takes the bench: Ryu's chair seats a receipt-attested GPT evidence analyst, and the gavel becomes two blind signatures. |
| 👁️ | **Argus · Zoxea · Hephaestus** | Validation &mdash; Argus runs the app and believes nothing it cannot see, Zoxea checks the built shape against the ratified design, Hephaestus reads the visual craft. |
| 🪶 | **Thoth** | The Scribe &mdash; keeps the run ledger across every stage, and transcribes the council's rendered plan byte-for-byte. Write it down or it never happened. |
| 📋 | **Omega** | The report &mdash; tells you the truth, even when it's partial. |

<br>

## 📜 The Arc

A curated timeline. Not every commit &mdash; just the ones that changed the shape of things.

| | Milestone | What happened |
|:--|:--|:--|
| **v3.1** | **The Succession** | The council stopped depending on any one smith. The full council tier is now headed by the strongest available Claude &mdash; Fable 5 preferred, Opus 4.8 by recorded succession &mdash; opening the Twin Council to every Opus + Codex setup, with every certificate naming the engine that actually sat. The workshop also left the storefront: the public tree trimmed to the strict minimum, ~980 war-story residues scrubbed from shipped files, and the test suite proves itself on a clean clone. |
| **v3.0.2** | **The Twin Council Forge** | The gavel became two signatures. Every decision that locks something &mdash; master plan, milestone close, validation verdict, vision, report &mdash; now needs both model families to sign, blind, with disagreements argued on runnable evidence, every cross-family ruling receipt-attested against an append-only ledger, and the final texts rendered by deterministic code instead of anyone's pen. The judge and the chairman keep their seats at lower strength; at full strength, the council rules. |
| **v3.0** | **The Reserved Seven Return** | v2 shelved seven names to travel light. v3 gave each of them a seat that actually runs. The Assessor got a Gauge to size the work, the Lawgiver got a Law to pin the acceptance criteria, the Scribe got a ledger that makes "write it down or it never happened" literal, the Observer got the watch that catches a leaked browser, the systematizer got the vision it compiles from your conversation, and the fallback planner got his ladder &mdash; every tier a complete instrument, not a lesser one. The Negotiator won every argument at last, by becoming the arithmetic that reconciles two reviews into one. The roster reads 34 again, and every name is a seat the engine fills. |
| **v2.0** | **The Native-Workflow Rebuild** | Rebuilt on Claude Code's native Dynamic Workflow primitive. Persistent teams, ordered SendMessage, and a wall of PreToolUse hooks &mdash; gone. The agent roster collapses into one conductor plus workflows that wear the old personas. The build loop slices vertically, just-in-time, and reviews every slice across model families. Lighter. Quieter. Still honest. |
| **v1.x** | **The Teams Era** | The first working forge. A seven-step pipeline driven by hooks and per-step teams. It proved the idea: a sentence in, a repository out. |

See [GitHub Releases](https://github.com/Fredasterehub/kiln/releases) for the full changelog.

<br>

## 🔬 Technical Deep Dive

<details>
<summary><strong>For the curious &mdash; how the forge actually works</strong></summary>

<br>

### Architecture

I am a Claude Code plugin. Pure native &mdash; no daemon, no server, no npm package, and zero hooks. The autonomous stages are native [Dynamic Workflows](https://code.claude.com/docs/en/workflows): deterministic orchestration scripts that walk the pipeline in order, the same way every time. A thin conductor skill in your own session detects state, renders the story, launches each stage, and reads the artifacts &mdash; it never does the heavy work itself.

| | |
|:--|:--|
| **Dynamic Workflows** | The engine. Deterministic orchestration &mdash; steps run in order, outputs don't skip review, the session never goes idle. |
| **One interactive teammate** | Brainstorm is a real conversation with Da Vinci. The heavy creative dialogue stays in their context, not yours. |
| **Inline personas** | Every other face is worn *inline* by a workflow `agent()` call &mdash; not a standalone agent file. Every call pins its model explicitly. |
| **Minds are files** | Vision, research, architecture, and state live as markdown and an append-only ledger in `./.kiln/`. Workers read them; resume is anchored on them, never on conversation memory. |
| **Multi-model by design** | Opus reasons, reviews, and builds UI. GPT-5.6, via Codex CLI, writes logic and sits as the council's second head &mdash; with a recorded fallback, never a silent one. A Claude-only path covers you when Codex isn't installed. |
| **Capability tiers** | The doctor resolves what's actually reachable &mdash; from T1 (Sonnet-only) through T2 (+Opus) and T3 (+Codex, the full-craft default) to T4 (the council tier &mdash; the strongest available Claude head: Fable 5 when reachable, Opus 4.8 succession otherwise, always recorded) &mdash; and the run's record states its tier honestly. Browser verification is a separate axis: full when Playwright is present, static-only when not. Nothing unverifiable is ever labeled verified. |

### The Twin Council, mechanically

The five rules above are not prose &mdash; each is a mechanism:

- **Blind drafts:** the two heads answer in parallel with anonymous slot labels assigned from a hidden seed, only after both return alive and the GPT side's receipt validates. Neither prompt ever names the other head.
- **Receipts:** every Codex invocation is captured by a deterministic process boundary that hashes the prompt, the frozen packet, the output, and the invocation identity (run, seat, phase, attempt) into a receipt, then cross-checks it against an append-only reservation ledger with a replay guard. A courier that altered one byte kills the seat.
- **The divergence set is script-built:** every finding and decision either settles or escalates &mdash; the builder *proves* each id is accounted for exactly once, and an empty set legally skips the negotiation. At most one bounded negotiation runs; an over-limit packet escalates whole, never truncated.
- **Deterministic rendering:** the settled record is projected into one plan by exact byte-equivalence joins, closure-checked (no orphan criterion, no empty milestone), rendered by a pure function, and transcribed by the Scribe &mdash; the script compares the file's hash against its own rendering. Validator objections apply as *typed amendments* to the bundle, mechanically, then the render repeats.
- **Ratification:** both heads rule APPROVE or BLOCK, blind, over the populated bundle. Blocks trigger exactly one evidence exchange where runnable checks are settled by exit code. The only jointly-ratified terminal requires two valid signatures from distinct heads, each binding the bundle hash, the renderer version, and the resulting plan hash &mdash; and the Law locks *only* a ratified plan.
- **Deadlock and honesty:** persistent disagreement gets one fresh-context 2×2 re-adjudication (order and labels counterbalanced, capped in size), then a terminal cascade ending in an honest stop. The four terminals &mdash; ratified, deadlock-resolved, council-deadlock, degraded &mdash; are never interchangeable, and a dead head yields *degraded*, never a quiet single-head ruling.

### The build loop

Build is where the work is. Two nested loops over the locked Law.

The **outer loop** walks the master plan milestone by milestone, in dependency order. Commits are cumulative.

The **inner loop** is slice by slice. KRS-One plans the milestone's entire ordered slice list in one call, mapped one-to-one onto the Law's acceptance criteria and checked arithmetically &mdash; every criterion in exactly one slice. Before each slice builds, a cheap live check confirms the plan still matches the code; the builder implements and commits; then the deterministic trial runs.

| | |
|:--|:--|
| **Exit codes are the verdict** | The Law runner executes the slice's mapped checks: declared flips must go red→green, and any previously-green check that regresses is fatal. The project's own test suite runs beside it, captured as hashed evidence. |
| **Tamper is mechanical** | The tamper gate re-verifies every locked path before every check batch &mdash; and again before each check &mdash; so not even a check's own command can rewrite the Law. A touched lock, stale evidence, or a red gate auto-rejects with **no reviewer spawned**. |
| **Cross-family review** | Builder and reviewer never share a family: Opus builds UI, GPT reviews; GPT builds logic, Opus reviews. The reviewer must re-run the mapped checks itself &mdash; approval on the diff's word alone doesn't count. Up to three fix cycles, each rebuilt, recommitted, and re-tried. |
| **Failures are fingerprinted** | Infrastructure failures and assertion failures route differently: a repeated infra signature triggers one environment-repair trial instead of burning retries, and a blocked slice is labeled honestly &mdash; *fix the environment* vs *code work still owed*. |
| **The milestone gate** | Enough slices convene the tribunal: two analysts plus the goal-backward audit, reconciled by pure arithmetic. At full strength the second analyst is a receipt-attested GPT evidence analyst judging the recorded, hashed evidence, and ambiguous outcomes go to a blind two-family close pair &mdash; both sign or it fails closed. A failed gate consults a correction council first: retry the code, escalate to validation, or replan the milestone. |

The Sentinel watches the whole loop: only *logical* rejections ratchet its escalation (mechanical failures don't), and repeated logical rejections swap the feedback source before scrutiny rises. The next milestone's slice plan is cut speculatively in parallel, anchored to the exact commit it was cut at &mdash; any corrective commit invalidates it.

### Validate &amp; Report

Three legs run in parallel: Zoxea checks the built shape against the ratified design, Argus runs the deterministic Law floor &mdash; fresh install, the full Law over every criterion, the project suite &mdash; and Hephaestus (when a design exists) reads the visual craft, advisory only.

For a UI scope, one cross-family evaluator walks every acceptance criterion through a scripted one-shot browser probe: one process per check, launch→assert→close, hard-killed on a timer. The whole traversal runs under a browser **lease** &mdash; the ten-minute cap lives on the capability itself, so once the lease expires every further probe refuses, and a detached watchdog sweeps whatever survived. No persistent browser service ever runs in the loop.

The verdict &mdash; PASS, PARTIAL, or FAILED &mdash; is computed by a pure function over the transcribed evidence, never self-graded. A gate that never ruled caps the verdict at PARTIAL: absence of evidence is not evidence of health. At full strength a blind two-family pair rules over *every* verdict &mdash; including a passing one &mdash; and can only confirm or block it, never rewrite it. Failures loop back to Build for up to three correction cycles, then escalate to you.

Then Omega writes the delivery report into `REPORT.md` &mdash; honest about what works, what's partial, what failed &mdash; and at full strength a final signoff pair checks the report against the run's own recorded artifacts before the stage may complete. The vision compile is guarded the same way: a fidelity pair confirms nothing was invented and nothing was dropped between your words and the written vision.

### Deep Brainstorm

Adapted from the [BMAD Method](https://github.com/bmad-code-org/BMAD-METHOD)'s structured brainstorming approach. Da Vinci facilitates with **62 techniques across 10 categories** and 50 elicitation methods. Anti-bias protocols compensate for the fact that humans are walking confirmation biases. Da Vinci never writes the vision himself: every turn lands in an append-only session ledger, and a fresh-context compiler &mdash; whose only source is that ledger &mdash; writes `VISION.md`. What you meant, provably separated from what anyone wished you meant.

### What's in the box

| | |
|:--|:--|
| **2 skills** | The pipeline conductor (kiln-fire) and the brainstorm playbook (kiln-brainstorm). |
| **8 Dynamic Workflows** | Gauge, mapping, research, architecture, vision, build, validate, report. |
| **1 interactive agent** | `the-creator` (Da Vinci) &mdash; the brainstorm teammate. |
| **2 commands** | `/kiln-fire`, `/kiln-doctor`. |
| **5 deterministic CLIs** | The state ledger, the Law runner, the browser probe, the vision gate, and the receipt verifier &mdash; small trusted tools that hold the run's evidence so no model has to be believed. |

No npm. No build step. Just markdown and a handful of `.js` conductors in a folder, distributed as a native Claude Code plugin. Entropy is a choice.

</details>

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
