# Standing Contract Template

Injected into AGENTS.md during the first build iteration when `.kiln/design/` exists. KRS-One populates the placeholders from tokens.json and creative-direction.md. Target: 800-1000 tokens.

---

## Design System Contract

**Palette:** {palette_summary — 3-5 key colors with their roles, e.g., "Surface: oklch(0.130 0.010 240), Accent: oklch(0.650 0.180 250)"}

**Typography:** {font_family} at sizes {scale_summary}. Headings: weight {heading_weight}, letter-spacing {tight/snug}. Body: weight {body_weight}, max-width 65ch.

**Spacing:** 4px base. Section gaps: 80-120px. Component padding: 16-32px. All values from `var(--space-*)`.

**Motion:** hover={fast}ms, expand={normal}ms, page={slow}ms. Easing: {default_easing}. Use `@starting-style` for enter animations.

**Radius:** Buttons/inputs: {sm}. Cards: {md}. Modals: {lg}. Pills: full.

**Shadows:** Always layered (two depths). Use shadow tokens.

**Import:** `@import './tokens.css';` at top of main stylesheet. All colors, spacing, typography via CSS custom properties.

**Ban list:** No hardcoded hex/rgb colors. No hardcoded px spacing. No Inter/Roboto unless specified. No `#000000` or `#ffffff`. No `transition: all`. No single-layer shadows.

**Reference:** Full token definitions in `.kiln/design/tokens.css`. Creative direction in `.kiln/design/creative-direction.md`.
