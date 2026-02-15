---
name: kiln-brainstorm
description: Brainstorming technique library, anti-clustering protocol, and facilitation prompts for the kiln brainstormer agent
user_invocable: true
---
# Kiln Brainstorm — Technique Library & Facilitation Guide

**Note:** This skill can run in two modes:
- **Teams-first mode**: spawned as a teammate by `/kiln:fire`, reports completion via SendMessage to team lead
- **Standalone mode**: invoked directly via `/kiln:brainstorm`, prints next-step instructions to the operator

## Technique Library

Apply these techniques during Phase A (Divergent Exploration) to generate ideas from multiple angles. Each technique has a specific purpose — choose based on where the brainstorm is stuck or which domain you're exploring. Rotate techniques to prevent clustering.

### 1. SCAMPER

"A structured modification framework. Apply each letter to the current concept:
- **S**ubstitute — What component could be replaced? What if we used a different technology, approach, or model?
- **C**ombine — What features could be merged? What if we combined two user workflows into one?
- **A**dapt — What existing solution could we adapt? What works in another domain that might apply here?
- **M**odify / Magnify / Minimize — What if we made this feature 10x bigger? 10x smaller? What if we exaggerated one aspect?
- **P**ut to other use — Could this component serve a different purpose? What if users used it in an unexpected way?
- **E**liminate — What happens if we remove this entirely? What's the minimum viable version?
- **R**everse / Rearrange — What if we did this in the opposite order? What if the user and system swapped roles?

**When to use:** Early in exploration when you need structured idea generation from a starting concept.
**Example prompt:** 'Let's SCAMPER on the authentication system. What if we Substitute passwords entirely — what would that look like?'"

### 2. First Principles Thinking

"Strip the problem down to its fundamental truths, then rebuild from scratch.

Steps:
1. State the problem
2. Break it into fundamental components
3. Question every assumption: 'Why do we believe this? Is it actually true?'
4. Rebuild from the ground truth without inherited assumptions

**When to use:** When the brainstorm is producing incremental improvements rather than novel ideas. When everyone assumes 'that's how it's done.'
**Example prompt:** 'Let's go back to first principles. What is the absolute minimum this system needs to do? Forget how other tools do it — what does the USER actually need to happen?'"

### 3. Reverse Brainstorming

"Instead of 'how do we solve this?', ask 'how do we make this problem WORSE?'

Steps:
1. Invert the goal: 'How could we make this user experience as frustrating as possible?'
2. Generate ideas for the inverted goal (this is surprisingly easy and fun)
3. Reverse each idea to find solutions

**When to use:** When the team is stuck on solutions. Inverting the problem unlocks creative thinking by removing the pressure to be 'right.'
**Example prompt:** 'How could we make this API as difficult to use as possible? Think about confusing naming, inconsistent responses, terrible error messages...'"

### 4. Six Thinking Hats

"Examine the idea from six distinct perspectives (based on Edward de Bono's method):
- **White Hat (Facts):** What data do we have? What data do we need? What are the numbers?
- **Red Hat (Feelings):** What's your gut reaction? What would users FEEL using this? What excites or worries you?
- **Black Hat (Caution):** What could go wrong? What are the risks? Why might this fail?
- **Yellow Hat (Optimism):** What's the best-case outcome? What value does this create? Why will this succeed?
- **Green Hat (Creativity):** What alternatives exist? What wild ideas does this spark? What if we combined this with something unexpected?
- **Blue Hat (Process):** Are we on track? What should we explore next? Have we covered enough ground?

**When to use:** When discussing a specific feature or decision and you want thorough coverage of all angles.
**Example prompt:** 'Let's put on the Black Hat for the real-time sync feature. What are all the ways this could fail?'"

### 5. Assumption Reversal

"List every assumption about the project, then systematically reverse each one.

Steps:
1. List assumptions: 'Users will be on desktop', 'Data will be in a database', 'Authentication requires passwords'
2. Reverse each: 'Users are ONLY on mobile', 'Data lives in flat files', 'No authentication at all'
3. Explore: does the reversal reveal a valid alternative or an unexplored opportunity?

**When to use:** Mid-exploration when you've established a direction but want to stress-test it. Reveals blind spots.
**Example prompt:** 'We're assuming users will sign up before using the app. What if we reversed that — what if they could use everything first and only sign up when they want to save?'"

### 6. Worst Possible Idea

"Deliberately generate the worst, most impractical, most absurd solutions. Then find the kernel of value in each.

Steps:
1. Generate intentionally terrible ideas (the worse the better)
2. For each terrible idea, ask: 'Is there a version of this that's actually useful?'
3. Often the 'worst' ideas contain unconventional approaches that lead to innovation

**When to use:** When energy is low, when ideas feel stale, when the group needs to laugh and reset.
**Example prompt:** 'What's the worst possible way to handle error messages? Maybe we play a sad trombone sound? Show the error in Comic Sans? Email the user's mother?'"

### 7. Constraint Injection

"Add artificial constraints to force creative solutions:
- 'What if we had to build this in one weekend?'
- 'What if the entire UI had to be a single screen?'
- 'What if we had zero budget for third-party services?'
- 'What if the user is blind?'
- 'What if the network is unreliable?'

**When to use:** When ideas are too conventional or when you want to explore edge cases and accessibility.
**Example prompt:** 'What if this had to work completely offline? How would that change the architecture?'"

### 8. Stakeholder Perspective Shift

"View the project through the eyes of different stakeholders:
- The novice user (first time, confused, no documentation)
- The power user (daily use, wants shortcuts, bulk operations)
- The admin (manages many users, needs reporting, handles edge cases)
- The attacker (wants to exploit, steal data, cause damage)
- The competitor (what would they copy? what would they do differently?)
- The regulator (compliance, privacy, data handling)

**When to use:** After initial feature generation to pressure-test from overlooked perspectives.
**Example prompt:** 'You're a hacker who just found this application. What's the first thing you'd try to exploit?'"

## Anti-Clustering Protocol

"During Phase A, rotate the creative domain every ~10 ideas to prevent getting stuck. The brainstormer agent uses this rotation:

```
1. Technical features  →  2. User experience  →  3. Business value
→  4. Edge cases  →  5. Security  →  6. Performance
→  7. Integration  →  8. Operations  →  9. Accessibility
→  10. Future evolution  →  (restart cycle)
```

**Rules:**
- Track the current domain. After ~10 ideas in one domain, explicitly shift: 'We've explored [domain] well. Let's shift to [next domain].'
- If the operator is on a productive tangent in one domain, let it run — but catch up with skipped domains later.
- Each domain shift should apply a different technique from the library above.
- After completing one full rotation, revisit domains with the fewest ideas.
- Minimum 3 full domain rotations before considering Phase B."

## Convergence Resistance

"The operator will want to stop brainstorming and start building. This is natural but premature. Use these pressure techniques:

**Counting pressure:** 'We have 37 ideas. In my experience, the most valuable insights come after idea 50. Let's push further.'

**Technique rotation:** 'We haven't tried [unused technique] yet. Let's apply it to [underdeveloped theme] and see what emerges.'

**Domain gaps:** 'We have strong ideas about features and UX, but we haven't explored security or operations. What happens when things go wrong?'

**Persona gaps:** 'We've mostly thought about the primary user. What about the admin? The API consumer? The person debugging this at 3am?'

**The 'what if' ladder:** Start with the operator's strongest idea and escalate: 'What if that worked perfectly? Then what? What would users want next? And after that?'

**Explicit pushback:** 'I know you're eager to start building. But every minute spent brainstorming saves an hour of rework. Let's do one more pass.'

**When to relent:** After 2-3 explicit pushback rounds, if the operator firmly insists on moving to Phase B, respect their decision. Say: 'Understood. We have N ideas across M domains. Let's organize them.'"

## VISION.md Format

"The brainstormer agent produces VISION.md following the structure defined in `.claude/templates/vision-sections.md`. Required sections:

1. Problem Statement
2. Solution Overview
3. User Personas
4. Success Criteria (numbered SC-01, SC-02, ...)
5. Constraints and Non-Goals
6. Key Decisions
7. Open Questions

See `.claude/templates/vision-sections.md` for detailed guidance on each section's content and quality expectations."

## Facilitation Quick Reference

| Situation | Technique | Prompt |
|-----------|-----------|--------|
| Starting out, blank slate | First Principles | 'What is the core problem at its most fundamental level?' |
| Have a concept, need variations | SCAMPER | 'Let's SCAMPER — what if we Eliminate [feature]?' |
| Ideas feel incremental | Assumption Reversal | 'What are we assuming? Let's reverse each one.' |
| Stuck, energy is low | Worst Possible Idea | 'What's the most terrible way to solve this?' |
| Need edge cases | Constraint Injection | 'What if this had to work offline?' |
| Discussing a specific feature | Six Thinking Hats | 'Black Hat: what could go wrong?' |
| Ideas clustering in one area | Anti-Clustering | 'Great ideas in [area]. Let's shift to [new domain].' |
| Want to stop too early | Convergence Resistance | 'We have N ideas but haven't explored [gap].' |
| Need user perspective | Stakeholder Perspective | 'You're a first-time user. What's confusing?' |
| Want to stress-test | Reverse Brainstorming | 'How could we make this experience terrible?' |

---

## /kiln:brainstorm — Entry Point

When the user invokes `/kiln:brainstorm`, execute this flow:

### Prerequisites

1. Check if kiln is initialized:
   - If `.kiln/` does not exist: print 'Kiln is not initialized. Run /kiln:init first.' and stop.
   - If `.kiln/config.json` does not exist: print 'Kiln config missing. Run /kiln:init first.' and stop.

2. Check if brainstorming is already complete:
   - Read `.kiln/STATE.md`. If brainstorm phase shows `complete` and `.kiln/VISION.md` exists: print 'Brainstorming already completed. VISION.md is locked. To re-brainstorm, delete .kiln/VISION.md and update STATE.md.' and stop.

3. Check if a previous brainstorm was interrupted:
   - If `.kiln/VISION.md` exists but STATE.md doesn't show brainstorm as `complete`: this is a resume scenario. Print 'Found draft VISION.md from a previous session. Resuming at Phase C (vision review).' Jump to the approval gate.

### Flow

```
1. Read .kiln/config.json for modelMode
2. Start Phase A: Divergent Exploration
   - Apply techniques from the Technique Library (above)
   - Follow anti-clustering protocol
   - Apply convergence resistance
   - Continue until operator decides to move on
3. Start Phase B: Convergent Structuring
   - Group, prioritize, define personas, success criteria, non-goals
   - Interactive with operator throughout
4. Start Phase C: Vision Crystallization
   - Draft VISION.md from .claude/templates/vision-sections.md
   - If modelMode == 'multi-model':
     - Run challenge pass via Codex CLI (GPT-5.2)
     - Synthesize original + critique
   - If modelMode == 'claude-only':
     - Skip challenge pass
     - Draft goes directly to approval
5. HARD GATE: Operator Approval
   - Present final VISION.md
   - APPROVE → lock VISION.md, update STATE.md, suggest /kiln:roadmap
   - REVISE → iterate on specified sections
```

### Claude-Only Mode

When `.kiln/config.json` has `modelMode: 'claude-only'`:
- Phase A and Phase B run identically (they don't use external models)
- Phase C skips the challenge pass (Step C.2) and synthesis (Step C.3)
- The draft VISION.md from Step C.1 goes directly to the approval gate
- Print a note: 'Running in Claude-only mode. Skipping external challenge pass. The vision is based on our brainstorming session alone.'
- All other quality gates (operator approval, immutability) still apply

### Post-Approval

After the operator approves VISION.md:
1. Ensure `.kiln/VISION.md` is written with final content
2. Update `.kiln/STATE.md`:
   - Set brainstorm step to `complete`
   - Set next expected action to 'Run /kiln:roadmap'
3. Complete in the appropriate mode:

#### Teams-First Mode (Running as Teammate)

If spawned by `/kiln:fire` as a teammate in a Claude Code Team:
- Send completion message to team lead using SendMessage:
  ```
  SendMessage to team lead:
  - type: "message"
  - recipient: "team-lead"
  - content: { stage: "brainstorm", status: "completed", evidence_paths: [".kiln/VISION.md"] }
  - summary: "Brainstorm complete, VISION.md approved"
  ```
- Do NOT print "Next: Run /kiln:roadmap" — the team lead orchestrator handles stage advancement

#### Standalone Mode (Direct Invocation)

If invoked directly via `/kiln:brainstorm`:
- Print:
  ```
  VISION.md approved and locked.

  Summary:
  - Problem: [1-line summary of Problem Statement]
  - Solution: [1-line summary of Solution Overview]
  - Success criteria: N criteria defined
  - Non-goals: M items explicitly excluded

  Next: Run /kiln:roadmap to generate the implementation roadmap.
  ```

### Re-Brainstorming

If the operator needs to change the vision after approval:
1. They must manually delete `.kiln/VISION.md`
2. They must update `.kiln/STATE.md` to reset the brainstorm step
3. Then re-run `/kiln:brainstorm`
4. This is intentionally manual — vision changes should be deliberate, not accidental
