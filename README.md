<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/logo-light.svg">
  <img alt="Kiln" src="docs/logo-light.svg" width="320">
</picture>

<h3><em>I am not an oven.</em></h3>

<!-- shields.io: keep these three rows together; they read as one banner -->

[![updated](https://img.shields.io/badge/updated-May_29,_2026_·_v2.0.0-1a1a1a?style=flat-square&labelColor=2d2d2d)](https://github.com/Fredasterehub/kiln)
[![Claude Code](https://img.shields.io/badge/Claude_Code-plugin-d4824a?style=flat-square&labelColor=2d2d2d)](https://docs.claude.com/en/docs/claude-code/plugins)
[![Multi-Model](https://img.shields.io/badge/multi--model-Opus_4.8_·_GPT--5-c77d4a?style=flat-square&labelColor=2d2d2d)](https://github.com/Fredasterehub/kiln)
[![Runtime](https://img.shields.io/badge/runtime-zero-6b8f6b?style=flat-square&labelColor=2d2d2d)](https://github.com/Fredasterehub/kiln)

</div>

<div align="center">

<table>
<tr>
<td><img src="docs/status/green-active.svg" alt=""></td>
<td><strong>Forged & cooling</strong> — v2.0.0 has run end-to-end. Idea in, working, tested software out.</td>
</tr>
<tr>
<td><img src="docs/status/yellow-dim.svg" alt=""></td>
<td><strong>Still a fresh .0</strong> — if an edge cools rough, you'll be told plainly. No surprises.</td>
</tr>
<tr>
<td><img src="docs/status/red-dim.svg" alt=""></td>
<td>Not a toy. Not magic. A kiln does real work and asks for real materials.</td>
</tr>
</table>

</div>

<br>

> *What is essential is invisible to the eye.*
> — Antoine de Saint-Exupéry

<br>

## I am Kiln.

I don't autocomplete. I don't suggest. I take a rough idea and return working software — researched, architected, built, and tested while you watch.

Hand me a sentence. I'll hand you back a repository.

---

## What I do

A seven-step pipeline. Each step has a job. Each job has an owner.

I read your intent, then move through research, architecture, and construction — pausing only when a real decision needs a human.

<table>
<tr><td><strong>1 · Onboarding</strong></td><td>A few quick questions. Where to build, how much to ask, how hard to test.</td></tr>
<tr><td><strong>2 · Brainstorm</strong></td><td>We shape the idea together. You talk; I listen and push back. It ends with a vision written down.</td></tr>
<tr><td><strong>3 · Research</strong></td><td>I study your stack, your constraints, the prior art.</td></tr>
<tr><td><strong>4 · Architecture</strong></td><td>I design before I build. Decisions get written down.</td></tr>
<tr><td><strong>5 · Build</strong></td><td>Vertical slices. Each one reviewed before the next begins.</td></tr>
<tr><td><strong>6 · Validate</strong></td><td>I run the thing. Every acceptance criterion, exercised for real.</td></tr>
<tr><td><strong>7 · Report</strong></td><td>An honest account. What works, what doesn't, what's next.</td></tr>
</table>

Onboarding and brainstorm happen with you, in your session. Research through report run on their own — native Claude Code [Dynamic Workflows](https://code.claude.com/docs/en/workflows), deterministic from start to finish. If you want the final say, there's an approval gate before Build: I'll show you the master plan and wait.

---

## The crew

The pipeline wears faces. Each one has a single job, a single voice, a single obsession. They are my hands, not separate products — the personas my workflows adopt as they work.

<table>
<tr><td><strong>Da Vinci</strong></td><td>Brainstorm. Sees what you meant, not just what you said. The one teammate you actually talk to.</td></tr>
<tr><td><strong>MI6</strong></td><td>Research. Gathers intelligence on your stack and domain.</td></tr>
<tr><td><strong>Confucius · Plato · Athena · Numerobis</strong></td><td>Architecture. They argue so your design doesn't have to.</td></tr>
<tr><td><strong>KRS-One</strong></td><td>Slicing. Breaks the work into vertical, runnable pieces — one at a time.</td></tr>
<tr><td><strong>The build pool</strong></td><td>Builders and reviewers, paired by model family. One writes, the other judges.</td></tr>
<tr><td><strong>Ken · Ryu · Judge Dredd</strong></td><td>The tribunal. Independent review, then a binary verdict.</td></tr>
<tr><td><strong>Argus</strong></td><td>Validation. Runs the app. Believes nothing it cannot see.</td></tr>
<tr><td><strong>Omega</strong></td><td>The report. Tells you the truth, even when it's partial.</td></tr>
</table>

---

## How to start

```bash
claude plugin marketplace add Fredasterehub/kiln
claude plugin install kiln
```

Then, in any project:

```bash
/kiln-doctor    # check your forge is ready
/kiln-fire      # light it
```

Or hand me the idea directly:

```bash
/kiln-fire build me a habit-tracker PWA with streaks and reminders
```

I keep my state in `./.kiln/`. Run `/kiln-fire` again and I pick up where I left off.

<br>

<div align="center">

<table>
<tr>
<td align="center"><strong>Requirements</strong></td>
</tr>
<tr>
<td>Claude Code ≥ 2.1.154 (Dynamic Workflows) · <code>git</code> · <code>node</code></td>
</tr>
<tr>
<td><sub>Optional: Codex CLI (GPT-5 build path) · Playwright MCP (browser validation)</sub></td>
</tr>
<tr>
<td><sub>I run end-to-end on Claude alone. Codex and MCP only make me sharper.</sub></td>
</tr>
</table>

</div>

---

## Technical Deep Dive

<details>
<summary><strong>For the curious — how the forge actually works</strong></summary>

<br>

### Architecture

I am a Claude Code plugin. Pure native — no daemon, no server, no npm package, and essentially zero hooks. The autonomous stages are native [Dynamic Workflows](https://code.claude.com/docs/en/workflows): deterministic orchestration scripts that walk research, architecture, build, validate, and report in order, the same way every time.

<table>
<tr><td><strong>Dynamic Workflows</strong></td><td>The engine. Deterministic orchestration — steps run in order, outputs don't skip review.</td></tr>
<tr><td><strong>One interactive teammate</strong></td><td>Brainstorm is a real conversation with Da Vinci. The heavy creative dialogue stays in their context, not yours.</td></tr>
<tr><td><strong>Minds are files</strong></td><td>Architecture, decisions, and patterns live as markdown. Workers read them. I consult them on demand.</td></tr>
<tr><td><strong>Multi-model by design</strong></td><td>Opus 4.8 reasons and reviews. GPT-5, via Codex CLI, writes code. A Claude-only path covers you when Codex isn't installed.</td></tr>
</table>

### The build loop

Build is where the work is. Two nested loops.

The **outer loop** walks the master plan milestone by milestone, in dependency order. Each milestone builds on the last; commits are cumulative.

The **inner loop** is just-in-time. KRS-One scopes one vertical slice at a time from the live codebase — one independently-runnable, user-facing behavior. A multi-command CLI gets a slice per command: add, list, done, delete.

<table>
<tr><td><strong>Outer loop</strong></td><td>Milestones, in dependency order. Cumulative commits.</td></tr>
<tr><td><strong>Inner loop</strong></td><td>Vertical slices, scoped just-in-time from the live code.</td></tr>
<tr><td><strong>Cross-family review</strong></td><td>Builder and reviewer never share a model family. Opus builds UI / GPT reviews; GPT builds logic / Opus reviews. Up to three fix cycles before commit.</td></tr>
<tr><td><strong>Milestone tribunal</strong></td><td>Once the slices integrate: Ken (Opus) and Ryu (GPT-5) review independently, a deterministic reconcile dedupes and severity-ranks, and Judge Dredd delivers a binary verdict.</td></tr>
</table>

The tribunal is skipped for single-slice milestones — there, the cross-family slice review already is the milestone QA. No ceremony for ceremony's sake. The heavy end-to-end gate is Validate, not per-slice review.

### Validate & Report

Argus installs and builds the app the way a user would, then exercises every acceptance criterion by actually running it. The verdict is PASS, PARTIAL, or FAILED — and failures loop back to Build for up to three correction cycles.

Then Omega writes the delivery report into `REPORT.md`. Honest about what works. Honest about what's partial. Honest about what failed.

### What's in the box

<table>
<tr><td><strong>1 interactive agent</strong></td><td><code>the-creator</code> (Da Vinci) — the brainstorm teammate.</td></tr>
<tr><td><strong>2 commands</strong></td><td><code>/kiln-fire</code>, <code>/kiln-doctor</code>.</td></tr>
<tr><td><strong>9 skills</strong></td><td>The pipeline conductor and the per-stage playbooks.</td></tr>
<tr><td><strong>6 Dynamic Workflows</strong></td><td>Research, architecture, build, validate, report — plus mapping.</td></tr>
</table>

### The Arc

<details>
<summary>How Kiln got here</summary>

<br>

**v2.0.0 — The Native-Workflow Rebuild.** I was rebuilt on Claude Code's native Dynamic Workflow primitive. The old engine — persistent teams per step, ordered SendMessage, a wall of PreToolUse hooks — is gone. Thirty-four agent files collapse into one conductor plus workflows that wear the old personas. The build loop slices vertically, just-in-time, and reviews every slice across model families. The tribunal now runs only when a milestone has more than one slice. Lighter. Quieter. Still honest.

**v1.x — The Teams era.** The first working forge. A seven-step pipeline driven by hooks and per-step teams. It proved the idea: a sentence in, a repository out.

</details>

</details>

---

<div align="center">

*I orchestrate Dynamic Workflows that turn a conversation into working, tested software. I am not an oven.*

</div>
