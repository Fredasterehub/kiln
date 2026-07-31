# Design review — the five axes

Read on demand at UI chunk and milestone reviews, never preloaded. Primary consumer is the chunk reviewer for Claude-family work (`agents/chunk-reviewer-sol.md`), which carries these axes into its dispatch as review vocabulary; the UI/creative implementer reads it secondarily to self-check before handing off, and the milestone reviewer applies the same vocabulary at slice level. The axes exist to make design findings nameable and comparable — a score is a signal for iteration, never a verdict. The advisory law, in full, closes this file.

## Axis 1: Visual Hierarchy

Does the page guide the eye naturally? Can a user find what matters in under 2 seconds?

**Check:**
- Heading sizes create clear hierarchy (h1 > h2 > h3 visually distinct)
- Primary actions are visually prominent (color, size, position)
- Secondary content uses reduced contrast (text-secondary, text-tertiary tokens)
- Whitespace creates logical groupings (related items closer, sections separated)
- No competing focal points on the same viewport

**Scoring:**
- 5: Clear hierarchy, eye flows naturally, primary action obvious
- 4: Good hierarchy, minor competing elements
- 3: Functional but flat — everything looks equally important
- 2: Confusing hierarchy, multiple competing focal points
- 1: No visual hierarchy — wall of uniformly styled content

**Common failures:** All text same size/weight. Buttons same visual weight as surrounding text. No whitespace variation between sections.

## Axis 2: Interaction Design

Do interactive elements behave correctly? Is the UI predictable and responsive?

**Check:**
- Hover states on all clickable elements (color, shadow, or transform change)
- Focus-visible indicators for keyboard navigation
- Loading states for async operations (spinners, skeleton screens, disabled buttons)
- Form validation feedback (error states, success confirmation)
- Transitions are smooth (no layout shift, no flash of unstyled content)

**Scoring:**
- 5: All states handled, transitions smooth, keyboard navigable
- 4: Most states handled, minor missing hover or focus states
- 3: Basic interactivity works, some states missing
- 2: Many missing states, jarring transitions
- 1: Interactive elements appear static, no feedback

**Common failures:** No hover state on buttons. Focus ring removed without replacement. Form submits with no loading indication. Instant show/hide with no transition.

## Axis 3: Consistency and Token-Compliance

Does the implementation use the design tokens consistently?

**Check:**
- Colors come from token variables, not hardcoded hex/rgb values
- Spacing uses the spacing scale, not arbitrary pixel values
- Typography uses the type scale (font-size, weight, letter-spacing tokens)
- Border radius uses the radius scale
- Shadows use the shadow tokens
- Motion uses duration and easing tokens
- Nothing on the Ban List (`tokens.md`) appears in the diff

**Scoring:**
- 5: All values from tokens, zero hardcoded overrides
- 4: 90%+ token usage, 1–2 justified exceptions
- 3: Mix of tokens and hardcoded values
- 2: Mostly hardcoded values, tokens used sporadically
- 1: No token usage, all values hardcoded

**Common failures:** Hardcoded `#333` instead of `var(--color-text-primary)`. `padding: 15px` instead of `var(--space-4)`. `font-size: 14px` instead of `var(--font-size-small)`.

This axis has one foot in contract adherence: when the chunk's brief binds the implementer to the project's tokens (the no-hardcoded-visual-values rule, in force whenever the project's `.kiln/design/` token system exists), a hardcoded value is a brief violation like any other — reportable as a contract-adherence finding on its own terms. A visual value with no matching token yet is NOT a license to hardcode: the missing token is minted first — the implementer proposes it through the designer consult channel, the designer rules — and only then does the value land, as a token. The axis SCORE stays advisory either way; the brief is what binds.

## Axis 4: Accessibility

Can all users interact with the content regardless of ability?

**Check:**
- Semantic HTML elements (button, nav, main, section, article — not div for everything)
- Image alt text present and descriptive
- Color contrast ratios meet WCAG AA (4.5:1 body text, 3:1 large text)
- Interactive elements reachable via keyboard (Tab, Enter, Escape)
- ARIA labels on icon-only buttons and custom components
- Reduced motion support (`@media (prefers-reduced-motion)`)

**Scoring:**
- 5: Full semantic HTML, contrast passing, keyboard navigable, ARIA complete
- 4: Good semantics, minor contrast or ARIA issues
- 3: Some semantic HTML, basic keyboard support, contrast mostly passing
- 2: Mostly div-based, some keyboard traps, contrast failures
- 1: No semantic HTML, keyboard unusable, no ARIA

**Common failures:** `<div onclick>` instead of `<button>`. Icon button with no aria-label. Low contrast text on dark surfaces. No skip-to-main link.

## Axis 5: Craft

Attention to detail that separates good from great. The "feel" layer.

**Check:**
- Negative letter-spacing on headings (-0.02em to -0.04em)
- text-wrap: balance on headings, text-wrap: pretty on paragraphs
- Consistent border-radius across similar elements
- Layered shadows (not single flat shadow)
- Surfaces with depth where depth is real (not flat solids everywhere, not decoration stacked on every card)
- Micro-interactions on hover (scale, shadow lift, color shift)
- Loading skeletons match final layout dimensions
- No layout shift on content load

**Scoring:**
- 5: Feels considered — every detail intentional, motion has purpose
- 4: High polish, 1–2 areas could use refinement
- 3: Functional and clean, but generic — no distinguishing craft
- 2: Rough edges visible — inconsistent radius, flat shadows, no hover states
- 1: No craft — default browser styling with minimal CSS

**Common failures:** `letter-spacing: normal` on headings. Single-layer `box-shadow`. No hover transitions. Uniform flat backgrounds. Text orphans/widows on headings.

## The advisory law

The axes give review a vocabulary; they never gate. A design score — any axis, any mean — NEVER causes a failing verdict on its own: the suite decides, model judgment never gates. A UI chunk with correct behavior, green tests, and a design score of 2 still seals on its review's own merits; the scores ride the review as advisory findings, named plainly so a later pass can act on them. What CAN drive a `revise` is what always could: a real brief violation — an unmet acceptance criterion, out-of-scope work, or a broken no-hardcoded-values bound where the brief carried one. The axes describe; the brief binds; the suite proves.

**The suite's own boundaries.** Design review here is vocabulary riding the existing reviews — nothing more. There is no dedicated visual-review surface: findings ride the chunk review and the milestone review, the same envelopes, the same verdict vocabulary. There is no perceptual criterion kind: the criteria register's kinds stay closed, and no journey asserts on how a pixel feels. There is no evidence-capture machinery: no screenshot pipeline, no film strip — a reviewer reasons from the code and says plainly when a check would need a render it doesn't have. And there is no style-validator seat: the roster is closed, and the reviewing seats that exist carry this vocabulary themselves.
