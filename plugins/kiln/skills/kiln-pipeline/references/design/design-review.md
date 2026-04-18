# Design Review — 5-Axis Rubric

On-demand reference during UI scenarios. Primary consumer is hephaestus (UI validator, high/sonnet effort) when scoring a built milestone; la-peintresse reads it secondarily to self-check work before handing off. Overall score = mean of 5 axes, mapped to percentage (score/5 * 100). The rubric is advisory — never the sole cause of a FAIL verdict, because design quality is a signal for iteration rather than a gate on shipping functional code.

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

**Common Failures:** All text same size/weight. Buttons same visual weight as surrounding text. No whitespace variation between sections.

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

**Common Failures:** No hover state on buttons. Focus ring removed without replacement. Form submits with no loading indication. Instant show/hide with no transition.

## Axis 3: Consistency (Token Compliance)

Does the implementation use the design system tokens consistently?

**Check:**
- Colors come from token variables, not hardcoded hex/rgb values
- Spacing uses the spacing scale, not arbitrary pixel values
- Typography uses the type scale (font-size, weight, letter-spacing tokens)
- Border radius uses the radius scale
- Shadows use the shadow tokens
- Motion uses duration and easing tokens

**Scoring:**
- 5: All values from tokens, zero hardcoded overrides
- 4: 90%+ token usage, 1-2 justified exceptions
- 3: Mix of tokens and hardcoded values
- 2: Mostly hardcoded values, tokens used sporadically
- 1: No token usage, all values hardcoded

**Common Failures:** Hardcoded `#333` instead of `var(--color-text-primary)`. `padding: 15px` instead of `var(--space-4)`. `font-size: 14px` instead of `var(--font-size-sm)`.

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

**Common Failures:** `<div onclick>` instead of `<button>`. Icon button with no aria-label. Low contrast text on dark surfaces. No skip-to-main link.

## Axis 5: Craft (Polish)

Attention to detail that separates good from great. The "feel" layer.

**Check:**
- Negative letter-spacing on headings (-0.02em to -0.04em)
- text-wrap: balance on headings, text-wrap: pretty on paragraphs
- Consistent border-radius across similar elements
- Layered shadows (not single flat shadow)
- Subtle gradients on surfaces (not flat solid colors)
- Micro-interactions on hover (scale, shadow lift, color shift)
- Loading skeletons match final layout dimensions
- No layout shift on content load

**Scoring:**
- 5: Feels premium — every detail considered, motion is intentional
- 4: High polish, 1-2 areas could use refinement
- 3: Functional and clean, but generic — no distinguishing craft
- 2: Rough edges visible — inconsistent radius, flat shadows, no hover states
- 1: No craft — default browser styling with minimal CSS

**Common Failures:** `letter-spacing: normal` on headings. Single-layer `box-shadow`. No hover transitions. Uniform flat backgrounds. Text orphans/widows on headings.

## Scoring Summary

| Score Range | Label | Impact on Verdict |
|---|---|---|
| 4.0-5.0 | Excellent | No impact |
| 3.0-3.9 | Good | No impact |
| 2.0-2.9 | Needs Work | Warning note, can contribute to PARTIAL |
| 1.0-1.9 | Poor | Strong warning, recommend design iteration |

Design score NEVER causes FAIL on its own. It provides signal for improvement, not a gate.
