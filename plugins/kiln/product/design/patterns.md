# Design patterns — modern CSS, ten techniques

Read on demand at UI chunks, never preloaded. Primary consumer is the UI/creative implementer (`agents/implementer-opus.md`), which follows these techniques for visual work; the chunk reviewer for Claude-family work reads it secondarily when weighing a chunk's technique choices. Each entry pairs the technique with working code and a DO vs DON'T — the DON'T is the cheaper generated-median path that has to be actively refused. Several of these are baseline in every current engine and belong to the floor, not the ceiling; the two that still need fallback thinking say so in their own entries. Every var() in every example resolves through the project's `.kiln/design/tokens.css` layer — the token names here are the worked shape from `tokens.md` — and the only locals any example declares are non-visual mechanics (a typed animation angle, a state-indirection variable), themselves assigned only from tokens.

## 1. OKLCH color with color-mix()

Derive variants from the accent already in the token layer — perceptually uniform, and every derivative moves when the base moves. Hover and active are semantic tokens (`--color-interactive-hover`, `--color-interactive-active`); where a one-off tint is genuinely a derivation — a badge wash, an overlay — derive it at point of use with `color-mix()` over the tokens rather than minting a literal:

```css
.button-primary { background: var(--color-interactive-default); }
.button-primary:hover { background: var(--color-interactive-hover); }
.badge {
  background: color-mix(in oklch, var(--color-interactive-default) 20%, var(--color-surface-primary));
  color: var(--color-text-accent);
}
```

Relative color syntax is the same idea when the transform is systematic: `oklch(from var(--color-interactive-default) calc(l - 0.15) c h)`. A derived value that earns reuse earns a name: it lands in `tokens.json` through the designer, never as a local variable — the stylesheet stays generated, and the token law stays whole.

DON'T: `background: #3b82f6;` DON'T: `hsl(220 90% 56%)` DON'T: a raw color literal in component code at all — every literal lives in `.kiln/design/tokens.json`/`tokens.css`, nowhere else.
DO: token references, with `color-mix()` or relative color over tokens where derivation is the point.

## 2. Container queries

Components adapt to their container, not the viewport. Baseline everywhere — viewport media queries for component layout are a legacy habit, not a fallback need.

```css
.card-container { container-type: inline-size; container-name: card; }
.card { display: grid; grid-template-columns: 1fr; gap: var(--space-inset); }
@container card (min-width: 400px) {
  .card { grid-template-columns: auto 1fr; gap: var(--space-stack); }
}
```

DON'T: `@media (min-width: 768px)` for component layout.
DO: `@container` — components own their breakpoints. Media queries keep exactly one job: page-level layout shifts.

## 3. Scroll-driven animations

Animate on scroll without JavaScript. Support is broad but not universal — write the reveal so unanimated content is simply visible, never hidden behind an animation that may not run, and honor `prefers-reduced-motion`.

```css
@keyframes fade-slide-up {
  from { opacity: 0; transform: translateY(var(--space-reveal)); }
  to { opacity: 1; transform: translateY(0); }
}
@supports (animation-timeline: view()) {
  @media (prefers-reduced-motion: no-preference) {
    .reveal-on-scroll {
      animation: fade-slide-up linear both;
      animation-timeline: view();
      animation-range: entry 0% entry 40%;
    }
  }
}
```

DON'T: JS scroll listeners with `getBoundingClientRect()`. DON'T: content that starts at `opacity: 0` outside the animation.
DO: `animation-timeline: view()` behind `@supports` — zero JS, GPU-accelerated, visible-by-default.

## 4. @starting-style for enter animations

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
DO: `@starting-style` — the browser handles entry animation natively.

## 5. View Transitions API

Smooth page/state transitions with shared-element animation.

```css
::view-transition-old(root) { animation: fade-out var(--duration-slow) var(--ease-in); }
::view-transition-new(root) { animation: fade-in var(--duration-slow) var(--ease-out); }
.hero-image { view-transition-name: hero; }
::view-transition-new(hero) { animation: morph var(--duration-slow) var(--ease-spring); }
```

DON'T: Complex JS route-transition libraries.
DO: `view-transition-name` + `document.startViewTransition()` — and nothing breaks where the API is absent; the transition is pure enhancement.

## 6. :has() selector

Parent-aware styling — style a parent based on what it contains. Baseline everywhere.

```css
.form-group:has(:focus-visible) {
  outline: 2px solid var(--color-interactive-default);
  outline-offset: 2px; border-radius: var(--radius-card);
}
.form-group:has(:invalid) { --field-border: var(--color-status-error); }
.card:has(img) { grid-template-rows: 200px auto; }
.card:not(:has(img)) { grid-template-rows: auto; }
```

DON'T: `.form-group.has-focus { ... }` toggled via JavaScript.
DO: `.form-group:has(:focus-visible)` — zero JS, real-time reactivity.

## 7. CSS subgrid

Align nested grid items to the parent grid. Solves card-footer alignment. Baseline everywhere.

```css
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-stack);
}
.card {
  display: grid; grid-template-rows: subgrid;
  grid-row: span 3; gap: var(--space-inset); padding: var(--space-stack);
}
.card-footer { align-self: end; }
```

DON'T: Fixed heights or JS to equalize card sections.
DO: `grid-template-rows: subgrid` — footers align across all cards.

## 8. text-wrap: balance / pretty

Typographic polish without manual `<br>` tags. Baseline — its absence is a craft finding, not a nicety.

```css
h1, h2, h3 { text-wrap: balance; letter-spacing: var(--letter-spacing-heading); }
p { text-wrap: pretty; max-width: 65ch; }
```

DON'T: Manual `<br>` in headings or accepting widowed last lines.
DO: `text-wrap: balance` for headings, `text-wrap: pretty` for paragraphs.

## 9. @property for typed custom-property animations

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
DO: `@property` with typed syntax — CSS-native, and the browser interpolates the value itself. The win is declarative animation, not compositor offload: an animating gradient still repaints, and compositor-only performance stays with `transform` and `opacity`.

## 10. Anchor positioning

Position tooltips/popovers relative to a trigger without JavaScript. The one technique here still short of universal support — use it where the tooltip is enhancement, or gate the component on `@supports (anchor-name: --a)` with a simpler placement fallback; never let a positioning gap hide functional content.

```css
.trigger { anchor-name: --my-trigger; }
.tooltip {
  position: fixed; position-anchor: --my-trigger;
  top: anchor(bottom); left: anchor(center);
  translate: -50% var(--space-inline);
  position-try-fallbacks: --above;
}
@position-try --above {
  top: auto; bottom: anchor(top); translate: -50% calc(-1 * var(--space-inline));
}
```

DON'T: JavaScript positioning libraries (Popper.js, Floating UI) as the first reach.
DO: `position-anchor` + `position-try-fallbacks` — built into the browser, degraded deliberately where absent.

## The finish layer

The habits that separate considered surfaces from generated ones. The values shown assume a dark direction — they read from tokens either way, and the mode itself is the project's creative-direction call, never a reflex (the Ban List in `tokens.md`).

```css
body { background: var(--color-surface-primary); color: var(--color-text-primary); } /* near-black, never pure */
.panel { /* subtle directional gradient — same-palette, two neighboring surface tokens */
  background: linear-gradient(180deg, var(--color-surface-secondary), color-mix(in oklch, var(--color-surface-secondary) 80%, var(--color-surface-primary)));
  border: 1px solid var(--color-border-subtle);
}
.card { transition: transform var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out); }
.card:hover { transform: scale(1.02); box-shadow: var(--shadow-raised); } /* micro-interaction */
.overlay { backdrop-filter: blur(16px) saturate(1.2); background: oklch(from var(--color-surface-primary) l c h / 0.8); }
.section { padding-block: var(--space-section); } /* generous whitespace */
.hero-title { /* text gradient stays inside the neutral scale — the violet-to-blue reflex is refused unless creative-direction.md elects it by name */
  background: linear-gradient(180deg, var(--color-text-primary) 30%, var(--color-text-secondary));
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
```
