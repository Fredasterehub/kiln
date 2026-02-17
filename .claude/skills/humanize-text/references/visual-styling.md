# Visual Styling Guide

How to bring color, typography, and visual structure to text — whether it's markdown, HTML, or a full UI.

## Color Principles

**Commit to a palette.** Three to five colors, used consistently. A dominant color, one or two accents, and a neutral. Evenly-distributed pastels are timid. A bold dominant with a sharp accent creates identity.

**Contrast is readability.** Light text on dark, or dark text on light — never gray on gray. If someone squints, you failed.

**Color carries meaning.** Don't decorate — communicate. Green for success, amber for caution, red for errors. Blue for links and trust. Use color to guide the eye, not to fill space.

### Quick Palettes

When you need a starting point, not a committee:

| Name | Dominant | Accent | Neutral | Mood |
|------|----------|--------|---------|------|
| Warm Earth | `#4a403a` chocolate | `#f4a900` mustard | `#d4b896` beige | Grounded, artisanal |
| Ocean Depth | `#1a3a4a` deep teal | `#4ecdc4` bright teal | `#f0f4f8` ice | Professional, calm |
| Midnight | `#2b1e3e` dark purple | `#a490c2` lavender | `#e6e6fa` silver | Dramatic, premium |
| Forest | `#2d4a3e` deep green | `#8fbc8f` sage | `#f5f0e8` cream | Natural, trustworthy |
| Sunset | `#c1666b` terracotta | `#f4a900` gold | `#faf3eb` warm white | Warm, inviting |

Adapt these. Mix them. The point is a starting position with actual hex codes, not "pick some nice colors."

## Typography

**Two fonts maximum.** One display (headers), one body. Three is chaos. One can work if it has enough weight variation.

**Hierarchy through size and weight, not decoration.** H1 should be unmistakable. H2 clearly subordinate. Body comfortable to read in long stretches. If you need underlines, borders, or color to distinguish heading levels, the sizing is wrong.

**Avoid the usual suspects.** Inter, Roboto, Arial, and system-ui are the AI slop of typography. They're not bad fonts — they're just what every generated page uses. Pick something with character:

| Context | Good choices | Why |
|---------|-------------|-----|
| Technical / dev tools | JetBrains Mono, IBM Plex Mono, Fira Code | Monospace with personality |
| Editorial / docs | Lora, Merriweather, Source Serif Pro | Readable serifs with warmth |
| Modern / clean | DM Sans, Plus Jakarta Sans, Outfit | Distinctive without being loud |
| Bold / display | Space Grotesk, Syne, Cabinet Grotesk | Headers that own the page |

**Line height matters more than font choice.** Body text: 1.5-1.7. Headers: 1.1-1.3. Too tight feels cramped. Too loose feels disconnected.

## Markdown Visual Formatting

For READMEs, docs, and any markdown-rendered content:

**Badges** add scannable metadata to headers. Use `for-the-badge` style for hero sections, flat style for inline. Shields.io with custom colors that match your palette — not random defaults.

**Tables** break monotony. A comparison table, a role table, or a feature matrix says more than three paragraphs of prose. Keep cells short.

**Blockquotes** create visual pause. Use them for callouts, honest disclaimers, or the one sentence you want people to actually read. Don't overuse — two blockquotes in a section dilutes both.

**Horizontal rules** (`---`) are section breathers. One between major sections. Never two in a row.

**Collapsible sections** (`<details>`) hide depth without hiding existence. Put the hook in the summary, the substance inside. Good for: deep dives, install options, full command lists, lineage.

**Code blocks** are visual anchors. A fenced block with a language tag draws the eye. Use them for commands, config snippets, and directory structures — not just code.

**Whitespace** is structure. A `<br>` between the hero badges and the first heading. An empty line before and after tables. Generous spacing between sections. Dense text signals "don't read me."

## Visual Anti-Patterns

These make interfaces look AI-generated. Avoid all of them:

- **Purple gradient on white.** The most overused AI color scheme. If your first instinct is purple-to-blue gradient, stop and pick literally anything else.
- **Uniform rounded corners everywhere.** When every element has `border-radius: 12px`, nothing has shape. Mix sharp and rounded deliberately.
- **Centered everything.** Center the hero. Left-align the content. Centered body text is hard to read past three lines.
- **Generic card grids.** Three equal cards in a row with icon, title, description. Find another way to present features.
- **Decorative gradients as backgrounds.** If the gradient doesn't serve a purpose (directing attention, creating depth), it's wallpaper.
- **Stock illustration style.** Flat characters with disproportionate limbs in pastel scenes. If you need illustration, use something with an actual art direction.
- **Shadow soup.** When everything has `box-shadow`, nothing has elevation. Reserve shadows for elements that genuinely float above others.

## Applying Visual Thinking to Text

Not every humanization task involves HTML or CSS. But visual thinking applies everywhere:

**In markdown:** Use the formatting tools above to create rhythm. A table after two paragraphs of prose. A blockquote that interrupts the flow. A code block that gives the eye something different to process.

**In documentation:** Structure creates scannability. Someone looking for one answer shouldn't have to read everything. Headers, tables, and code blocks are your landmarks.

**In landing pages and READMEs:** The first screen is a poster. Hero, subtitle, one action. Everything below the fold earns its place by being useful, not comprehensive.

**In any format:** Ask "would I want to read this?" If the answer is "not really" — the problem might be visual, not verbal. A wall of text in perfect prose still feels like a wall.
