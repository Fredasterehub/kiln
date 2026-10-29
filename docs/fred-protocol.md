# Fred's statement of how Kiln works (2026-10-29, voice-to-text, transcribed by the Fable session)

Data: Fred's own words, lightly de-noised from voice-to-text, no interpretation added. Where a phrase is his, it is quoted.

## Body
- "We use Herdr." Everything is pure CLI: "we use the native plumbing of Herdr to connect the native tools and features of all those Claude Code and Codex CLI. So we really have a super small layer on top." No "crazy machinery using Teams or Workflows from within Claude".
- Little maintenance, "because everything relies on the CLI, and we adapt to the CLI and the Herdr."

## Bridge tab (first tab)
- **Big boss**: "the main guy I talk to". Fred leaves it to choose its own name ("Batman or Oracle or whatever he wants to be called").
- The persistent-mind idea applies to the boss too: "we have a little manager for our boss, so that all the admin stuff ... consumes a lot of context ... we'll delegate that to his little manager."
- **The boss's manager is the orchestrator** (Robin): "the first manager of the boss ... the intra manager", same tab. "He's really the one responsible of the whole loop and everything, since the boss is just talking with me."
- **The orchestrator's own worker** (Gravedigger): "whatever admin stuff needs to be done, not really worker stuff, but stuff that helps the orchestration and the actual build of everything."
- "That's the basis. And from there, everything spawns."

## Meta loop
- "research, plan, build, review ... When I say build, it's always build and review. Then verify and deploy."
- Full sequence: brainstorm → research → plan → build+review → verify → deploy.
- It is a meta concept: "this is something pretty much we can do at everything I ask ... whatever the task, is it a software that I want to create or just something? You should always research, think about how to resolve, plan, then resolve, iterate (build and review), and then verify, and then tell me the answer." Software development first.
- Execution: "we just open a tab for each of those phases. We use our persistent mind as actual real session, not just a team or something."

## Kiln fold-in
- "Kiln is brainstorm with the operator." The brainstorm "is just me asking you to do something in a way"; it is "always the most important part in a way, with the planning". It produces a document.
- After the brainstorm the loop runs: research, plan, build+review, verify, deploy.
- The operator "chooses or not if after the planning he wants to be advised or not, or is it just done automatically."
- **Kiln itself is spec-driven** (correction, same day): not only the product. "The spec driven aspect of Kiln need to be well wired and defined." Persistence through files on disk; "make sure we ... have all the wiring necessary, well wired up." Fred thinks this is partly true today and may need revisiting "to help the design even more".

## Bosses and work
- "By definition, a boss or managers should not do work." Exception: "extremely small work is more efficient being done by the boss than creating a whole worker and the subsequent manager loop, relay, creating the session and everything." For a real task "they should relay, and the manager responsible pop the worker."

## Scope of Kiln 4
- "We're compiling everything together. And of course, remove all the bad stuff. The main thing I want to add is a bit more hooks and stuff like that."
- "It worked really well for the last 72 hours"; "not reinvent the whole concept"; "we're not at the step of creating anything yet concrete."
- Kiln 4 lands in `/DEV/kiln` and the kiln GitHub project; zero-claude was only "the marketplace that we used for now".
- Old Kiln (v3.2.2) "built a lot of stuff ... those concepts kind of built software before"; the last version "was a bit rough".
- Other standing notes from the same conversation: GPT 6.1 is strong and Fred has plenty of limits there ("don't hesitate using it"); be concise, bullets not walls of text; the orchestrator session must stay context-lean and delegate reads to agents; the two Kiln 4 sessions (Opus, Fable) share data, never opinions or conclusions.
