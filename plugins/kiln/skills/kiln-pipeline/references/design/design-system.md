# Design System — Token Architecture

## Token Hierarchy (DTCG Standard)

Three tiers. Each tier references the one below it. Never skip tiers.

**Primitive** — raw values. Named by what they ARE.
`color.blue.500`, `font.size.16`, `space.4`

**Semantic** — purpose-bound aliases. Named by what they DO.
`color.surface.primary` → `{color.neutral.950}`, `font.size.body` → `{font.size.16}`

**Component** — scoped overrides. Named by WHERE they appear.
`button.color.bg` → `{color.accent.primary}`, `card.space.padding` → `{space.6}`

## tokens.json Format (DTCG)

Every token has `$type`, `$value`, `$description`. Groups nest. References use `{}` syntax.

```json
{
  "color": {
    "primitive": {
      "neutral": {
        "50":  { "$type": "color", "$value": "oklch(0.985 0.002 240)", "$description": "Lightest" },
        "200": { "$type": "color", "$value": "oklch(0.925 0.006 240)", "$description": "Soft" },
        "400": { "$type": "color", "$value": "oklch(0.710 0.010 240)", "$description": "Mid" },
        "500": { "$type": "color", "$value": "oklch(0.550 0.012 240)", "$description": "Base" },
        "600": { "$type": "color", "$value": "oklch(0.440 0.014 240)", "$description": "Dark" },
        "700": { "$type": "color", "$value": "oklch(0.350 0.016 240)", "$description": "Darker" },
        "800": { "$type": "color", "$value": "oklch(0.250 0.018 240)", "$description": "Deep" },
        "900": { "$type": "color", "$value": "oklch(0.180 0.014 240)", "$description": "Near-black" },
        "950": { "$type": "color", "$value": "oklch(0.130 0.010 240)", "$description": "Deepest" }
      },
      "accent": {
        "light":  { "$type": "color", "$value": "oklch(0.800 0.120 250)", "$description": "Light accent" },
        "base":   { "$type": "color", "$value": "oklch(0.650 0.180 250)", "$description": "Primary accent" },
        "strong": { "$type": "color", "$value": "oklch(0.500 0.200 250)", "$description": "Strong accent" }
      }
    },
    "semantic": {
      "surface": {
        "primary":   { "$type": "color", "$value": "{color.primitive.neutral.950}", "$description": "Main background" },
        "secondary": { "$type": "color", "$value": "{color.primitive.neutral.900}", "$description": "Card/section background" },
        "tertiary":  { "$type": "color", "$value": "{color.primitive.neutral.800}", "$description": "Elevated surface" },
        "inverse":   { "$type": "color", "$value": "{color.primitive.neutral.50}", "$description": "Light mode surface" }
      },
      "text": {
        "primary":   { "$type": "color", "$value": "{color.primitive.neutral.50}", "$description": "Primary text — full opacity" },
        "secondary": { "$type": "color", "$value": "{color.primitive.neutral.400}", "$description": "Secondary text — 0.6 opacity feel" },
        "tertiary":  { "$type": "color", "$value": "{color.primitive.neutral.500}", "$description": "Muted text — 0.3 opacity feel" },
        "accent":    { "$type": "color", "$value": "{color.primitive.accent.base}", "$description": "Accent text" }
      },
      "border": {
        "subtle":  { "$type": "color", "$value": "{color.primitive.neutral.800}", "$description": "Subtle divider" },
        "default": { "$type": "color", "$value": "{color.primitive.neutral.700}", "$description": "Standard border" },
        "strong":  { "$type": "color", "$value": "{color.primitive.neutral.600}", "$description": "Emphasized border" }
      },
      "interactive": {
        "default": { "$type": "color", "$value": "{color.primitive.accent.base}", "$description": "Button/link default" },
        "hover":   { "$type": "color", "$value": "{color.primitive.accent.light}", "$description": "Hover state" },
        "active":  { "$type": "color", "$value": "{color.primitive.accent.strong}", "$description": "Active/pressed" }
      }
    }
  },
  "font": {
    "family": {
      "heading": { "$type": "fontFamily", "$value": "var(--font-heading, system-ui)", "$description": "Heading typeface" },
      "body":    { "$type": "fontFamily", "$value": "var(--font-body, system-ui)", "$description": "Body typeface" },
      "mono":    { "$type": "fontFamily", "$value": "var(--font-mono, ui-monospace, monospace)", "$description": "Code typeface" }
    },
    "size": {
      "xs":   { "$type": "dimension", "$value": "0.75rem",  "$description": "12px — captions" },
      "sm":   { "$type": "dimension", "$value": "0.875rem", "$description": "14px — small text" },
      "base": { "$type": "dimension", "$value": "1rem",     "$description": "16px — body" },
      "lg":   { "$type": "dimension", "$value": "1.125rem", "$description": "18px — large body" },
      "xl":   { "$type": "dimension", "$value": "1.25rem",  "$description": "20px — subheading" },
      "2xl":  { "$type": "dimension", "$value": "1.5rem",   "$description": "24px — heading" },
      "3xl":  { "$type": "dimension", "$value": "2rem",     "$description": "32px — large heading" },
      "4xl":  { "$type": "dimension", "$value": "2.5rem",   "$description": "40px — display" },
      "5xl":  { "$type": "dimension", "$value": "3.5rem",   "$description": "56px — hero" }
    },
    "weight": {
      "normal": { "$type": "fontWeight", "$value": "400", "$description": "Body weight" },
      "medium": { "$type": "fontWeight", "$value": "500", "$description": "Emphasis" },
      "bold":   { "$type": "fontWeight", "$value": "700", "$description": "Headings" }
    },
    "letterSpacing": {
      "tight":   { "$type": "dimension", "$value": "-0.04em", "$description": "Display/hero text" },
      "snug":    { "$type": "dimension", "$value": "-0.02em", "$description": "Headings" },
      "normal":  { "$type": "dimension", "$value": "0em",     "$description": "Body text" },
      "wide":    { "$type": "dimension", "$value": "0.05em",  "$description": "All-caps labels" }
    }
  },
  "space": {
    "1":  { "$type": "dimension", "$value": "4px",   "$description": "Tight" },
    "2":  { "$type": "dimension", "$value": "8px",   "$description": "Compact" },
    "3":  { "$type": "dimension", "$value": "12px",  "$description": "Snug" },
    "4":  { "$type": "dimension", "$value": "16px",  "$description": "Base" },
    "5":  { "$type": "dimension", "$value": "20px",  "$description": "Comfortable" },
    "6":  { "$type": "dimension", "$value": "24px",  "$description": "Relaxed" },
    "8":  { "$type": "dimension", "$value": "32px",  "$description": "Spacious" },
    "10": { "$type": "dimension", "$value": "40px",  "$description": "Airy" },
    "12": { "$type": "dimension", "$value": "48px",  "$description": "Wide" },
    "16": { "$type": "dimension", "$value": "64px",  "$description": "Expansive" },
    "20": { "$type": "dimension", "$value": "80px",  "$description": "Section gap" },
    "24": { "$type": "dimension", "$value": "96px",  "$description": "Major section" },
    "32": { "$type": "dimension", "$value": "128px", "$description": "Hero section" }
  },
  "motion": {
    "duration": {
      "instant":   { "$type": "duration", "$value": "50ms",  "$description": "Micro-feedback" },
      "fast":      { "$type": "duration", "$value": "150ms", "$description": "Hover, focus" },
      "normal":    { "$type": "duration", "$value": "250ms", "$description": "Expand, slide" },
      "slow":      { "$type": "duration", "$value": "400ms", "$description": "Page transitions" },
      "cinematic": { "$type": "duration", "$value": "700ms", "$description": "Hero reveals" }
    },
    "easing": {
      "default":  { "$type": "cubicBezier", "$value": "cubic-bezier(0.25, 0.1, 0.25, 1.0)", "$description": "Standard ease" },
      "in":       { "$type": "cubicBezier", "$value": "cubic-bezier(0.4, 0.0, 1.0, 1.0)",   "$description": "Accelerate (exit)" },
      "out":      { "$type": "cubicBezier", "$value": "cubic-bezier(0.0, 0.0, 0.2, 1.0)",   "$description": "Decelerate (enter)" },
      "spring":   { "$type": "cubicBezier", "$value": "cubic-bezier(0.34, 1.56, 0.64, 1.0)", "$description": "Overshoot bounce" }
    }
  },
  "shadow": {
    "sm":  { "$type": "shadow", "$value": "0 1px 2px oklch(0 0 0 / 0.08)", "$description": "Subtle lift" },
    "md":  { "$type": "shadow", "$value": "0 2px 8px oklch(0 0 0 / 0.12), 0 1px 2px oklch(0 0 0 / 0.06)", "$description": "Card shadow" },
    "lg":  { "$type": "shadow", "$value": "0 8px 24px oklch(0 0 0 / 0.16), 0 2px 6px oklch(0 0 0 / 0.08)", "$description": "Modal/dropdown" },
    "xl":  { "$type": "shadow", "$value": "0 16px 48px oklch(0 0 0 / 0.20), 0 4px 12px oklch(0 0 0 / 0.10)", "$description": "Full overlay" }
  },
  "radius": {
    "sm":   { "$type": "dimension", "$value": "4px",   "$description": "Buttons, inputs" },
    "md":   { "$type": "dimension", "$value": "8px",   "$description": "Cards" },
    "lg":   { "$type": "dimension", "$value": "12px",  "$description": "Modals, panels" },
    "xl":   { "$type": "dimension", "$value": "16px",  "$description": "Hero sections" },
    "full": { "$type": "dimension", "$value": "9999px","$description": "Pills, avatars" }
  },
  "opacity": {
    "muted":   { "$type": "number", "$value": "0.3", "$description": "Tertiary/disabled" },
    "medium":  { "$type": "number", "$value": "0.6", "$description": "Secondary content" },
    "full":    { "$type": "number", "$value": "1.0", "$description": "Primary content" }
  }
}
```

## tokens.css — Derived Custom Properties

Generated from tokens.json. Every JSON token maps to one CSS variable.

```css
:root {
  /* Surface */
  --color-surface-primary: oklch(0.130 0.010 240);
  --color-surface-secondary: oklch(0.180 0.014 240);
  --color-surface-tertiary: oklch(0.250 0.018 240);
  --color-surface-inverse: oklch(0.985 0.002 240);

  /* Text */
  --color-text-primary: oklch(0.985 0.002 240);
  --color-text-secondary: oklch(0.710 0.010 240);
  --color-text-tertiary: oklch(0.550 0.012 240);
  --color-text-accent: oklch(0.650 0.180 250);

  /* Border */
  --color-border-subtle: oklch(0.250 0.018 240);
  --color-border-default: oklch(0.350 0.016 240);
  --color-border-strong: oklch(0.440 0.014 240);

  /* Interactive */
  --color-interactive-default: oklch(0.650 0.180 250);
  --color-interactive-hover: oklch(0.800 0.120 250);
  --color-interactive-active: oklch(0.500 0.200 250);

  /* Typography */
  --font-heading: var(--font-heading, system-ui);
  --font-body: var(--font-body, system-ui);
  --font-mono: var(--font-mono, ui-monospace, monospace);
  --font-size-xs: 0.75rem; --font-size-sm: 0.875rem; --font-size-base: 1rem;
  --font-size-lg: 1.125rem; --font-size-xl: 1.25rem; --font-size-2xl: 1.5rem;
  --font-size-3xl: 2rem; --font-size-4xl: 2.5rem; --font-size-5xl: 3.5rem;
  --font-weight-normal: 400; --font-weight-medium: 500; --font-weight-bold: 700;
  --letter-spacing-tight: -0.04em; --letter-spacing-snug: -0.02em;
  --letter-spacing-normal: 0em; --letter-spacing-wide: 0.05em;

  /* Spacing (4px base) */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;
  --space-20: 80px;
  --space-24: 96px;
  --space-32: 128px;

  /* Motion */
  --duration-instant: 50ms;
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --duration-slow: 400ms;
  --duration-cinematic: 700ms;

  --ease-default: cubic-bezier(0.25, 0.1, 0.25, 1.0);
  --ease-in: cubic-bezier(0.4, 0.0, 1.0, 1.0);
  --ease-out: cubic-bezier(0.0, 0.0, 0.2, 1.0);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1.0);

  /* Shadows */
  --shadow-sm: 0 1px 2px oklch(0 0 0 / 0.08);
  --shadow-md: 0 2px 8px oklch(0 0 0 / 0.12), 0 1px 2px oklch(0 0 0 / 0.06);
  --shadow-lg: 0 8px 24px oklch(0 0 0 / 0.16), 0 2px 6px oklch(0 0 0 / 0.08);
  --shadow-xl: 0 16px 48px oklch(0 0 0 / 0.20), 0 4px 12px oklch(0 0 0 / 0.10);

  /* Radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 9999px;

  /* Opacity */
  --opacity-muted: 0.3;
  --opacity-medium: 0.6;
  --opacity-full: 1.0;
}
```

## Color System — OKLCH

OKLCH for all colors. Format: `oklch(lightness chroma hue)` — L 0-1, C 0-0.4, H 0-360. Perceptually uniform, P3 gamut. Derive variants with `color-mix(in oklch, base 80%, white)`.

Text uses three opacity tiers via semantic colors: primary (1.0 feel), secondary (0.6 feel), tertiary (0.3 feel). Shadows always layered (two depths), oklch black for consistency.

## Ban List — AI Defaults to Avoid

| Default to Ban | Better Alternative |
|---|---|
| Inter / Roboto / Open Sans | Project-specific typeface or system-ui stack |
| blue-500 (#3b82f6) accent | OKLCH accent derived from project's visual direction |
| Tailwind default gray scale | Custom neutral scale with intentional undertone (warm/cool/neutral) |
| #000000 pure black backgrounds | Near-black with slight chroma: oklch(0.130 0.010 hue) |
| #ffffff pure white text | Off-white: oklch(0.985 0.002 hue) |
| 0px border-radius everywhere | Consistent radius scale (sm/md/lg) |
| box-shadow: 0 2px 4px rgba(0,0,0,0.1) | Layered shadow with two depths |
| transition: all 0.3s ease | Named duration + purpose-matched easing |
| 1rem/1.5rem spacing everywhere | 4px-base spacing scale |
| HSL color functions | OKLCH — perceptually uniform, P3-ready |
