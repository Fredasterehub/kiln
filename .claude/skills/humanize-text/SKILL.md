---
name: humanize-text
description: Transform AI-sounding or flat text into writing that feels authentically human — both in voice and visual presentation. Use when editing READMEs, documentation, proposals, blog posts, landing pages, or any text that needs to sound like a real person wrote it with care. Triggers on requests like "make this sound human", "humanize this", "bring this to life", "make it less AI", "polish the voice", "add personality", "add color", "make it visually appealing", "style this", or when reviewing drafted text for authenticity and visual impact.
---

# Humanize Text

Transform flat, generic, or AI-sounding text into writing that feels like a real person with opinions, rhythm, specificity, and visual taste wrote it.

## Core Principles

### 1. Kill the Slop

AI text has a signature. Learn to see it and cut it on sight.

**Banned words and phrases** — replace or delete every occurrence:

| Kill this | Replace with |
|-----------|-------------|
| utilize | use |
| leverage | use, build on, tap into |
| delve | dig into, explore, look at |
| it's important to note that | (delete — just state the thing) |
| in order to | to |
| a wide range of | many, various |
| at the end of the day | (delete or rewrite) |
| it's worth mentioning | (delete — if it's worth mentioning, mention it) |
| moving forward | next, from here |
| comprehensive | thorough, complete, full |
| streamline | simplify, speed up |
| cutting-edge | new, modern, latest |
| best-in-class | (delete or be specific about what's good) |
| robust | solid, strong, reliable |
| seamless | smooth, clean, invisible |
| empower | let, enable, help |
| paradigm | (delete or say what actually changed) |
| synergy | (delete) |
| ecosystem | system, stack, world |
| take it to the next level | improve, push further |
| game-changer | (be specific about what changed) |

**Structural slop patterns** — detect and rewrite:
- Paragraphs that start with "In today's..." or "In the world of..."
- Conclusions that begin with "In conclusion" or "To sum up"
- Transitions like "Furthermore", "Moreover", "Additionally" used back-to-back
- Lists where every item starts with the same sentence structure
- Sentences that say the same thing twice with different words
- Hedging chains: "It might be possible that perhaps..."

### 2. Preserve the Author's Voice

When editing someone else's text, the goal is to amplify their voice, not replace it with yours.

**Before editing, identify:**
- Their sentence length tendency (short and punchy vs. flowing)
- Their formality level (contractions? slang? technical terms?)
- Their personality markers (humor? directness? warmth? edge?)
- Phrases that are uniquely theirs — protect these

**The rule:** If the original author would read the edit and say "that's not how I talk," you've gone too far.

### 3. Specificity Over Abstraction

The fastest way to make text feel human is to replace abstract claims with concrete details.

- BAD: "It delivers impressive results"
- GOOD: "It shipped 47 components across 6 phases without a single rollback"

- BAD: "The pipeline is fully automated"
- GOOD: "You can literally go to bed and come back to a working project"

- BAD: "We use a multi-model approach for better outcomes"
- GOOD: "Opus plans, GPT-5.3-codex executes, then Opus reviews the work"

### 4. Rhythm and Cadence

Good prose breathes. Vary sentence length deliberately.

**The pattern:** Follow a long, complex sentence with a short one. Then medium. Then short again. Break it up. Let the reader's eye rest.

**Paragraph length:** Mix. One-sentence paragraphs hit hard. Three-sentence paragraphs carry ideas. Five or more and you're losing people — break it up or cut.

**Front-load the interesting part.** Don't bury the hook at the end of a sentence. Put the surprising word, the concrete number, the human moment first.

### 5. Show, Don't Explain

- BAD: "The brainstorm session is very important and valuable for the process"
- GOOD: "This is your investment, and where most of your ROI will come from"

- BAD: "The system handles errors gracefully through a correction mechanism"
- GOOD: "If after 3 rounds three state-of-the-art models can't fix the problem, there's a bigger issue at play"

### 6. Negative Space

What you leave out matters as much as what you put in. Every sentence should earn its place.

**The test:** Read each sentence and ask "does this add something the reader didn't already know or feel?" If the answer is no, cut it. Good writing is editing. Great writing is ruthless editing.

### 7. Visual Life

Text lives on a screen. How it looks matters as much as how it reads.

**Color with intention.** Pick a palette and commit. Three to five colors — a dominant, an accent, and neutrals. Avoid purple-gradient-on-white (the AI slop of color schemes). See [references/visual-styling.md](references/visual-styling.md) for ready-to-use palettes.

**Typography with character.** Two fonts maximum. Avoid Inter, Roboto, Arial — they're what every generated page uses. Pick something distinctive that matches the project's personality.

**Format for scanning.** Tables break monotony. Blockquotes create pause. Code blocks anchor the eye. Badges add scannable metadata. Collapsible sections hide depth without hiding existence. A wall of perfect prose is still a wall.

**Whitespace is structure.** Generous spacing between sections. Breathing room around tables and code blocks. Dense text signals "don't read me."

## Workflow

### When given text to humanize:

1. **Read the full text first.** Understand the intent, audience, and the author's natural voice before changing anything.

2. **Identify the worst offenders.** Mark slop words, dead phrases, abstract claims, and repetitive structures. Don't rewrite yet.

3. **Establish voice parameters.** Determine where the text sits on these spectrums:

| Spectrum | Dial |
|----------|------|
| Formal ←→ Casual | Where does the audience expect this? |
| Expert ←→ Peer | Is the author teaching or sharing? |
| Warm ←→ Direct | Empathy-led or efficiency-led? |
| Technical ←→ Accessible | What does the reader already know? |
| Bold ←→ Measured | Confident claims or careful hedging? |

4. **Rewrite in passes:**
   - **Pass 1:** Kill slop words and dead phrases
   - **Pass 2:** Replace abstractions with specifics
   - **Pass 3:** Fix rhythm — vary sentence length, front-load hooks
   - **Pass 4:** Cut anything that doesn't earn its place
   - **Pass 5:** Visual life — add color, formatting variety, and whitespace (see [references/visual-styling.md](references/visual-styling.md))
   - **Pass 6:** Read it as if you've never seen it — does it flow? Does it sound and look like a person made it?

5. **The read-aloud test.** Read the final version as if speaking it to someone. If any sentence makes you stumble, feels awkward to say, or sounds like a press release — rewrite it.

### When writing new text:

1. **Ask about voice and audience first.** Don't write until you know who's reading and what the author sounds like.
2. **Draft fast, edit slow.** Get ideas down, then apply the passes above.
3. **Lead with the human moment.** Open with something specific, personal, or surprising — not a definition or overview.

## Anti-Patterns

These patterns make text feel AI-generated. Avoid all of them:

- **The Wikipedia opening:** "X is a Y that does Z." Start with why it matters, not what it is.
- **The hedge sandwich:** "While there may be some challenges, overall the results are generally quite good." Pick a position.
- **The empty superlative:** "incredibly powerful", "truly remarkable", "absolutely essential." Cut the adverb and let the noun work.
- **The echo paragraph:** Restating what was just said in slightly different words. Say it once, say it well.
- **The premature summary:** "As we've seen above..." Trust the reader. They just read it.
- **The filler transition:** "That being said," "With that in mind," "Having established that," — delete and just start the next thought.
- **Uniform lists:** Every bullet starting with a verb, or every bullet the same length. Mix structure within lists.
- **Purple gradient syndrome:** Purple-to-blue gradients on white backgrounds. The default AI color scheme. Pick literally anything else.
- **The wall of text:** No tables, no code blocks, no blockquotes, no visual anchors. Just paragraph after paragraph. Break it up with formatting variety.
- **Generic card grid:** Three equal cards in a row with icon, title, description. Find another layout.

## Quality Gate

Before finalizing any humanized text, verify:

- [ ] No slop words remain (check the banned list)
- [ ] No two consecutive paragraphs start with the same structure
- [ ] At least one concrete detail, number, or example per major section
- [ ] Sentence length varies (not all medium, not all short)
- [ ] The opening line would make someone keep reading
- [ ] Every sentence adds something new
- [ ] It sounds like a person, not a language model
- [ ] Visual variety exists (not just paragraphs — tables, blockquotes, code blocks, or badges where appropriate)
- [ ] No purple-gradient-on-white or generic AI color schemes
- [ ] Whitespace creates breathing room between sections

For detailed hook formulas and opening techniques, see [references/hooks.md](references/hooks.md).
For tone adaptation across channels and contexts, see [references/tone-guide.md](references/tone-guide.md).
For color palettes, typography, and visual formatting, see [references/visual-styling.md](references/visual-styling.md).
