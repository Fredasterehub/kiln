# Design Patterns — Modern CSS Techniques

Ten techniques that separate premium UI from generic output. Each: description, complete code, DO vs DON'T.

## 1. OKLCH Color System with color-mix()

Derive hover/muted/overlay from a single accent — perceptually uniform.

```css
:root {
  --accent: oklch(0.650 0.180 250);
  --accent-hover: color-mix(in oklch, var(--accent) 85%, white);
  --accent-muted: color-mix(in oklch, var(--accent) 20%, var(--color-surface-primary));
}
.button-primary { background: var(--accent); }
.button-primary:hover { background: var(--accent-hover); }
.badge { background: var(--accent-muted); color: var(--accent); }
```

DON'T: `background: #3b82f6;` DON'T: `hsl(220 90% 56%)`
DO: `oklch(0.650 0.180 250)` with `color-mix()` for variants.

## 2. Container Queries

Components adapt to their container, not the viewport.

```css
.card-container { container-type: inline-size; container-name: card; }
.card { display: grid; grid-template-columns: 1fr; gap: var(--space-4); }
@container card (min-width: 400px) {
  .card { grid-template-columns: auto 1fr; gap: var(--space-6); }
}
```

DON'T: `@media (min-width: 768px)` for component layout.
DO: `@container` — components own their breakpoints.

## 3. Scroll-Driven Animations

Animate on scroll without JavaScript.

```css
@keyframes fade-slide-up {
  from { opacity: 0; transform: translateY(var(--space-8)); }
  to { opacity: 1; transform: translateY(0); }
}
.reveal-on-scroll {
  animation: fade-slide-up linear both;
  animation-timeline: view();
  animation-range: entry 0% entry 40%;
}
```

DON'T: JS scroll listeners with `getBoundingClientRect()`.
DO: `animation-timeline: view()` — zero JS, GPU-accelerated.

## 4. @starting-style for Enter Animations

Animate elements on DOM insertion natively.

```css
.dialog[open] {
  opacity: 1; transform: scale(1);
  transition: opacity var(--duration-normal) var(--ease-out),
              transform var(--duration-normal) var(--ease-spring);
  @starting-style { opacity: 0; transform: scale(0.95); }
}
```

DON'T: `.dialog.is-visible { opacity: 1; }` with JS class-toggling.
DO: `@starting-style` — browser handles entry animation natively.

## 5. View Transitions API

Smooth page/state transitions with shared-element animation.

```css
::view-transition-old(root) { animation: fade-out var(--duration-slow) var(--ease-in); }
::view-transition-new(root) { animation: fade-in var(--duration-slow) var(--ease-out); }
.hero-image { view-transition-name: hero; }
::view-transition-new(hero) { animation: morph var(--duration-slow) var(--ease-spring); }
```

DON'T: Complex JS route transition libraries.
DO: `view-transition-name` + `document.startViewTransition()`.

## 6. :has() Selector

Parent-aware styling — style a parent based on what it contains.

```css
.form-group:has(:focus-visible) {
  outline: 2px solid var(--color-interactive-default);
  outline-offset: 2px; border-radius: var(--radius-md);
}
.form-group:has(:invalid) { --field-border: oklch(0.650 0.200 25); }
.card:has(img) { grid-template-rows: 200px auto; }
.card:not(:has(img)) { grid-template-rows: auto; }
```

DON'T: `.form-group.has-focus { ... }` toggled via JavaScript.
DO: `.form-group:has(:focus-visible)` — zero JS, real-time reactivity.

## 7. CSS Subgrid

Align nested grid items to parent grid. Solves card footer alignment.

```css
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-6);
}
.card {
  display: grid; grid-template-rows: subgrid;
  grid-row: span 3; gap: var(--space-4); padding: var(--space-6);
}
.card-footer { align-self: end; }
```

DON'T: Fixed heights or JS to equalize card sections.
DO: `grid-template-rows: subgrid` — footers align across all cards.

## 8. text-wrap: balance / pretty

Typographic polish without manual `<br>` tags.

```css
h1, h2, h3 { text-wrap: balance; letter-spacing: var(--letter-spacing-snug); }
p { text-wrap: pretty; max-width: 65ch; }
```

DON'T: Manual `<br>` in headings or accepting widowed last lines.
DO: `text-wrap: balance` for headings, `text-wrap: pretty` for paragraphs.

## 9. @property for Typed Custom Property Animations

Animate custom properties — enables gradient animation, glow effects.

```css
@property --gradient-angle {
  syntax: "<angle>"; initial-value: 0deg; inherits: false;
}
.hero-gradient {
  --gradient-angle: 135deg;
  background: linear-gradient(var(--gradient-angle), var(--color-surface-primary), var(--color-surface-secondary));
  transition: --gradient-angle var(--duration-slow) var(--ease-default);
}
.hero-gradient:hover { --gradient-angle: 225deg; }
```

DON'T: JS animation loops for gradient shifts.
DO: `@property` with typed syntax — CSS-native, GPU-composited.

## 10. Anchor Positioning

Position tooltips/popovers relative to trigger without JavaScript.

```css
.trigger { anchor-name: --my-trigger; }
.tooltip {
  position: fixed; position-anchor: --my-trigger;
  top: anchor(bottom); left: anchor(center);
  translate: -50% var(--space-2);
  position-try-fallbacks: --above;
}
@position-try --above {
  top: auto; bottom: anchor(top); translate: -50% calc(-1 * var(--space-2));
}
```

DON'T: JavaScript positioning libraries (Popper.js, Floating UI).
DO: `position-anchor` + `position-try-fallbacks` — built into the browser.

## Premium Specification (Linear-style)

Patterns that make UI feel high-end:

```css
body { background: oklch(0.130 0.010 240); color: oklch(0.985 0.002 240); } /* near-black, not pure */
.panel { /* subtle directional gradient */
  background: linear-gradient(180deg, oklch(0.180 0.014 240), oklch(0.150 0.012 240));
  border: 1px solid oklch(0.250 0.018 240);
}
.card { transition: transform var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out); }
.card:hover { transform: scale(1.02); box-shadow: var(--shadow-lg); } /* micro-interaction */
.overlay { backdrop-filter: blur(16px) saturate(1.2); background: oklch(0.130 0.010 240 / 0.8); }
.section { padding-block: var(--space-20); } /* generous whitespace */
.hero-title { /* text gradient */
  background: linear-gradient(180deg, oklch(0.985 0.002 240) 30%, oklch(0.710 0.010 240));
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
```
