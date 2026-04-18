# Design QA — Automated + Manual Checks

On-demand reference during UI scenarios. Primary consumer is hephaestus (UI validator, high/sonnet effort — the five-axis manual review is judgment-heavy); the-curator reads the automated-check section during build-time reviews. Two tiers live here: automated checks run by **the-curator** (build-time, per chunk) and manual review run by **hephaestus** (validation-time, per milestone). Both tiers are advisory by design — they inform verdicts but a poor design score alone never blocks a chunk or a milestone, because that gate would punish correct functional work for cosmetic reasons.

## Automated Checks — `the-curator` (build-time, advisory)

Grep-based checks the UI reviewer runs against the chunk's diff as part of its five-axis review (Token Compliance axis). Results appear as "Design Notes" in the APPROVED / REJECTED verdict. Design notes NEVER trigger REJECTED — only functional defects (failing build, failing tests, unmet acceptance criteria, missing test files when `test_requirements` is non-empty, placeholder code) can reject a chunk. See `references/design/design-review.md` for the full five-axis rubric the-curator applies.

### Hardcoded Colors

```bash
# Flag hex colors that should use tokens
grep -rn '#[0-9a-fA-F]\{3,8\}' --include='*.css' --include='*.tsx' --include='*.jsx' --include='*.html' --include='*.vue' --include='*.svelte' | grep -v 'node_modules' | grep -v 'tokens.css' | grep -v '.kiln/'
# Flag rgb/rgba that should use tokens
grep -rn 'rgb\(a\?\)(' --include='*.css' --include='*.tsx' --include='*.jsx' --include='*.html' | grep -v 'node_modules' | grep -v 'tokens.css'
# Flag hsl that should use oklch
grep -rn 'hsl\(a\?\)(' --include='*.css' --include='*.tsx' --include='*.jsx' --include='*.html' | grep -v 'node_modules'
```

Expected: Zero matches outside tokens.css and vendor files. Each match is a potential token violation — record as a design note, do not reject the chunk unless hardcoded values demonstrably violate a documented acceptance criterion.

### Hardcoded Spacing

```bash
# Flag px values in padding/margin/gap that should use spacing tokens
grep -rn 'padding\|margin\|gap' --include='*.css' | grep '[0-9]\+px' | grep -v 'var(--space' | grep -v 'node_modules' | grep -v 'tokens.css'
```

Expected: Spacing values use `var(--space-*)`. Exceptions: `0px`, `1px` borders, viewport units.

### Non-Semantic HTML

```bash
# Flag divs used where semantic elements belong
grep -rn '<div.*onclick\|<div.*role="button"\|<div.*tabindex' --include='*.tsx' --include='*.jsx' --include='*.html' --include='*.vue' --include='*.svelte' | grep -v 'node_modules'
# Flag missing alt text
grep -rn '<img' --include='*.tsx' --include='*.jsx' --include='*.html' | grep -v 'alt=' | grep -v 'node_modules'
```

Expected: Interactive elements use `<button>`, `<a>`, `<input>`. All `<img>` have `alt`.

### Missing Token Import

```bash
# Verify tokens.css is imported in the main stylesheet or entry point
grep -rn 'tokens\.css' --include='*.css' --include='*.tsx' --include='*.jsx' --include='*.html' | head -5
```

Expected: At least one import of tokens.css in the project entry point.

## Manual Review — `hephaestus` (validation-time, advisory)

The UI validator (`hephaestus`, spawned by argus during Step 6 when `.kiln/design/` exists) performs these checks against the built product. Uses Playwright screenshots when the host runtime exposes Playwright; falls back to static artifact / code inspection otherwise, and records that the visual review coverage is limited. Results go into `.kiln/validation/design-review.md`.

### Visual Hierarchy Flow

1. Take full-page screenshot
2. Identify: What draws the eye first? Is it the primary action?
3. Check heading size progression (h1 > h2 > h3 visually)
4. Check whitespace creates logical groupings

### Whitespace Rhythm

1. Measure spacing between sections — should use spacing scale consistently
2. Check: generous section spacing (80-120px between major sections)
3. Check: tighter spacing within components (16-32px)
4. No cramped areas adjacent to overly spaced areas

### Color Harmony

1. Screenshot the page — does the palette feel cohesive?
2. Check: accent color used sparingly (buttons, links, highlights only)
3. Check: text layers use the opacity hierarchy (primary/secondary/tertiary)
4. Check: no competing accent colors

### Motion Feel

1. Interact with hover states — do they feel smooth?
2. Check: transitions use named durations (fast for hover, normal for expand)
3. Check: no instant show/hide without transition
4. Check: @starting-style or equivalent for element entry

### Responsive Behavior

1. Resize browser to narrow width — does layout adapt?
2. Check: container queries for component-level responsiveness
3. Check: no horizontal overflow, no content clipping
4. Check: navigation adapts (hamburger menu or equivalent)

### Dark/Light Coherence

1. If both modes exist: check both with screenshots
2. Check: contrast ratios passing in both modes
3. Check: shadows adjust for dark (more transparent) vs light (more visible)
4. Check: images/icons visible in both modes

## Integration with Argus Verdict

Hephaestus sends `DESIGN_QA_COMPLETE` to argus with:
- Overall design score (1.0-5.0, mean of 5 axes)
- Per-axis scores
- Top 3 issues (if any)

Argus includes design score in validation report:

| Score | Verdict Impact |
|---|---|
| >= 3.0 | No impact. Note in report. |
| 2.0 - 2.9 | Warning. Can contribute to PARTIAL (but not sole cause). |
| < 2.0 | Strong warning. Recommend design iteration before ship. |

Design quality is ADVISORY at every tier. A product with perfect functionality and poor design still passes validation; a chunk with perfect functionality and poor design still receives APPROVED with design notes.
