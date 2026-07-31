# Design tokens — the three-tier architecture, and the Ban List

Read on demand at UI chunks, never preloaded. Primary consumer is the UI/creative implementer (`agents/implementer-opus.md`, routing's `implementer_ui_creative` seat), which reads this file alongside the target project's own `.kiln/design/` artifacts before writing visual code; the milestone designer draws on the vocabulary here when composing a UI chunk's design brief, and the chunk reviewer for Claude-family work cites these token names when rating token compliance. This file is canonical for token STRUCTURE — the tier rules and the naming grammar. The project's real VALUES live in `.kiln/design/tokens.json` and `tokens.css`, authored per project from its own creative direction; every value in the examples below is a worked shape, not a shipped palette.

## Token hierarchy (DTCG)

Three tiers. Each tier references the one below it. Never skip tiers.

**Primitive** — raw values. Named by what they ARE.
`color.primitive.blue.500`, `font.primitive.size.16`, `space.primitive.4`

**Semantic** — purpose-bound aliases. Named by what they DO.
`color.semantic.surface.primary` → `{color.primitive.neutral.950}`, `font.semantic.size.body` → `{font.primitive.size.16}`

**Component** — scoped bindings. Named by WHERE they appear.
`component.button.bg` → `{color.semantic.interactive.default}`, `component.card.padding` → `{space.semantic.stack}`

A component style that reaches past the semantic tier straight into a primitive — or past every tier into a literal — is a hierarchy violation even when the rendered pixel is identical: the tiers are what let a direction change land in one place.

## tokens.json format (DTCG)

The Design Tokens (DTCG) format: a token is an object carrying `$value`, with `$type` set on the token itself or inherited from the closest enclosing group that declares one (a pure alias needs no `$type` — its type resolves from the token it references); `$description` rides wherever the name alone doesn't carry the meaning. Groups nest, and references use `{path.to.token}` syntax. The value shapes are typed, not strings: a color is an object (`colorSpace`, a `components` array, optional `alpha` and `hex` fallback); dimensions and durations are `{value, unit}` objects (`px`/`rem`, `ms`/`s`); a cubic bézier is a four-number array `[P1x, P1y, P2x, P2y]`; a shadow is a layer object — `color`, `offsetX`, `offsetY`, `blur`, `spread`, each a typed value or a token reference — or an array of layers; font families are a name or an ordered fallback array; weights and bare ratios are plain numbers.

The worked shape below demonstrates the whole architecture: all three tiers present, and every category — color, font, letter-spacing, space, duration, ease, shadow, radius, opacity — passing through primitive and semantic, with the component tier binding across them.

```json
{
  "color": {
    "$type": "color",
    "primitive": {
      "neutral": {
        "50":  { "$value": { "colorSpace": "oklch", "components": [0.985, 0.002, 240] }, "$description": "Lightest" },
        "200": { "$value": { "colorSpace": "oklch", "components": [0.925, 0.006, 240] }, "$description": "Soft" },
        "400": { "$value": { "colorSpace": "oklch", "components": [0.710, 0.010, 240] }, "$description": "Mid" },
        "500": { "$value": { "colorSpace": "oklch", "components": [0.550, 0.012, 240] }, "$description": "Base" },
        "600": { "$value": { "colorSpace": "oklch", "components": [0.440, 0.014, 240] }, "$description": "Dark" },
        "700": { "$value": { "colorSpace": "oklch", "components": [0.350, 0.016, 240] }, "$description": "Darker" },
        "800": { "$value": { "colorSpace": "oklch", "components": [0.250, 0.018, 240] }, "$description": "Deep" },
        "900": { "$value": { "colorSpace": "oklch", "components": [0.180, 0.014, 240] }, "$description": "Near-black" },
        "950": { "$value": { "colorSpace": "oklch", "components": [0.130, 0.010, 240] }, "$description": "Deepest" }
      },
      "accent": {
        "light":  { "$value": { "colorSpace": "oklch", "components": [0.800, 0.120, 250] } },
        "base":   { "$value": { "colorSpace": "oklch", "components": [0.650, 0.180, 250] } },
        "strong": { "$value": { "colorSpace": "oklch", "components": [0.500, 0.200, 250] } }
      },
      "red": {
        "base": { "$value": { "colorSpace": "oklch", "components": [0.620, 0.210, 25] }, "$description": "Signal red" }
      }
    },
    "semantic": {
      "surface": {
        "primary":   { "$value": "{color.primitive.neutral.950}", "$description": "Main background" },
        "secondary": { "$value": "{color.primitive.neutral.900}", "$description": "Card/section background" },
        "tertiary":  { "$value": "{color.primitive.neutral.800}", "$description": "Elevated surface" },
        "inverse":   { "$value": "{color.primitive.neutral.50}", "$description": "Opposite-mode surface" }
      },
      "text": {
        "primary":   { "$value": "{color.primitive.neutral.50}", "$description": "Primary text — full opacity" },
        "secondary": { "$value": "{color.primitive.neutral.400}", "$description": "Secondary text — 0.6 opacity feel" },
        "tertiary":  { "$value": "{color.primitive.neutral.500}", "$description": "Muted text — 0.3 opacity feel" },
        "accent":    { "$value": "{color.primitive.accent.base}", "$description": "Accent text" }
      },
      "border": {
        "subtle":  { "$value": "{color.primitive.neutral.800}", "$description": "Subtle divider" },
        "default": { "$value": "{color.primitive.neutral.700}", "$description": "Standard border" },
        "strong":  { "$value": "{color.primitive.neutral.600}", "$description": "Emphasized border" }
      },
      "interactive": {
        "default": { "$value": "{color.primitive.accent.base}", "$description": "Button/link default" },
        "hover":   { "$value": "{color.primitive.accent.light}", "$description": "Hover state" },
        "active":  { "$value": "{color.primitive.accent.strong}", "$description": "Active/pressed" }
      },
      "status": {
        "error": { "$value": "{color.primitive.red.base}", "$description": "Invalid/error state" }
      }
    }
  },
  "font": {
    "primitive": {
      "family": {
        "$type": "fontFamily",
        "sans": { "$value": ["system-ui", "sans-serif"], "$description": "Placeholder stack — the creative direction's chosen face lands here" },
        "mono": { "$value": ["ui-monospace", "SFMono-Regular", "monospace"], "$description": "Code stack" }
      },
      "size": {
        "$type": "dimension",
        "12": { "$value": { "value": 0.75, "unit": "rem" } },
        "14": { "$value": { "value": 0.875, "unit": "rem" } },
        "16": { "$value": { "value": 1, "unit": "rem" } },
        "18": { "$value": { "value": 1.125, "unit": "rem" } },
        "20": { "$value": { "value": 1.25, "unit": "rem" } },
        "24": { "$value": { "value": 1.5, "unit": "rem" } },
        "32": { "$value": { "value": 2, "unit": "rem" } },
        "40": { "$value": { "value": 2.5, "unit": "rem" } },
        "56": { "$value": { "value": 3.5, "unit": "rem" } }
      },
      "weight": {
        "$type": "fontWeight",
        "400": { "$value": 400 },
        "500": { "$value": 500 },
        "700": { "$value": 700 }
      }
    },
    "semantic": {
      "family": {
        "heading": { "$value": "{font.primitive.family.sans}" },
        "body":    { "$value": "{font.primitive.family.sans}" },
        "code":    { "$value": "{font.primitive.family.mono}" }
      },
      "size": {
        "caption": { "$value": "{font.primitive.size.12}" },
        "small":   { "$value": "{font.primitive.size.14}" },
        "body":    { "$value": "{font.primitive.size.16}" },
        "heading": { "$value": "{font.primitive.size.24}" },
        "display": { "$value": "{font.primitive.size.40}" }
      },
      "weight": {
        "body":     { "$value": "{font.primitive.weight.400}" },
        "emphasis": { "$value": "{font.primitive.weight.500}" },
        "heading":  { "$value": "{font.primitive.weight.700}" }
      }
    }
  },
  "letter-spacing": {
    "$type": "number",
    "primitive": {
      "tight":  { "$value": -0.04, "$description": "Em ratio — the generator supplies the unit" },
      "snug":   { "$value": -0.02 },
      "normal": { "$value": 0 },
      "wide":   { "$value": 0.05 }
    },
    "semantic": {
      "display": { "$value": "{letter-spacing.primitive.tight}", "$description": "Display/hero text" },
      "heading": { "$value": "{letter-spacing.primitive.snug}", "$description": "Headings below display" },
      "caps":    { "$value": "{letter-spacing.primitive.wide}", "$description": "All-caps labels" }
    }
  },
  "space": {
    "$type": "dimension",
    "primitive": {
      "1":  { "$value": { "value": 4, "unit": "px" } },
      "2":  { "$value": { "value": 8, "unit": "px" } },
      "3":  { "$value": { "value": 12, "unit": "px" } },
      "4":  { "$value": { "value": 16, "unit": "px" } },
      "5":  { "$value": { "value": 20, "unit": "px" } },
      "6":  { "$value": { "value": 24, "unit": "px" } },
      "8":  { "$value": { "value": 32, "unit": "px" } },
      "10": { "$value": { "value": 40, "unit": "px" } },
      "12": { "$value": { "value": 48, "unit": "px" } },
      "16": { "$value": { "value": 64, "unit": "px" } },
      "20": { "$value": { "value": 80, "unit": "px" } },
      "24": { "$value": { "value": 96, "unit": "px" } },
      "32": { "$value": { "value": 128, "unit": "px" } }
    },
    "semantic": {
      "inline":  { "$value": "{space.primitive.2}", "$description": "Within a control" },
      "inset":   { "$value": "{space.primitive.4}", "$description": "Control padding" },
      "stack":   { "$value": "{space.primitive.6}", "$description": "Card padding, sibling gap" },
      "reveal":  { "$value": "{space.primitive.8}", "$description": "Entrance travel distance" },
      "section": { "$value": "{space.primitive.20}", "$description": "Between page sections" }
    }
  },
  "duration": {
    "$type": "duration",
    "primitive": {
      "50":  { "$value": { "value": 50, "unit": "ms" } },
      "150": { "$value": { "value": 150, "unit": "ms" } },
      "250": { "$value": { "value": 250, "unit": "ms" } },
      "400": { "$value": { "value": 400, "unit": "ms" } },
      "700": { "$value": { "value": 700, "unit": "ms" } }
    },
    "semantic": {
      "instant":   { "$value": "{duration.primitive.50}", "$description": "Micro-feedback" },
      "fast":      { "$value": "{duration.primitive.150}", "$description": "Hover, focus" },
      "normal":    { "$value": "{duration.primitive.250}", "$description": "Expand, slide" },
      "slow":      { "$value": "{duration.primitive.400}", "$description": "Page transitions" },
      "cinematic": { "$value": "{duration.primitive.700}", "$description": "Hero reveals" }
    }
  },
  "ease": {
    "$type": "cubicBezier",
    "primitive": {
      "standard":   { "$value": [0.25, 0.1, 0.25, 1] },
      "accelerate": { "$value": [0.4, 0, 1, 1] },
      "decelerate": { "$value": [0, 0, 0.2, 1] },
      "overshoot":  { "$value": [0.34, 1.56, 0.64, 1] }
    },
    "semantic": {
      "default": { "$value": "{ease.primitive.standard}" },
      "in":      { "$value": "{ease.primitive.accelerate}", "$description": "Accelerate (exit)" },
      "out":     { "$value": "{ease.primitive.decelerate}", "$description": "Decelerate (enter)" },
      "spring":  { "$value": "{ease.primitive.overshoot}", "$description": "Overshoot bounce" }
    }
  },
  "shadow": {
    "$type": "shadow",
    "primitive": {
      "sm": { "$value": [
        { "color": { "colorSpace": "oklch", "components": [0, 0, 0], "alpha": 0.08 }, "offsetX": { "value": 0, "unit": "px" }, "offsetY": { "value": 1, "unit": "px" }, "blur": { "value": 2, "unit": "px" }, "spread": { "value": 0, "unit": "px" } },
        { "color": { "colorSpace": "oklch", "components": [0, 0, 0], "alpha": 0.04 }, "offsetX": { "value": 0, "unit": "px" }, "offsetY": { "value": 1, "unit": "px" }, "blur": { "value": 1, "unit": "px" }, "spread": { "value": 0, "unit": "px" } }
      ], "$description": "Subtle lift" },
      "md": { "$value": [
        { "color": { "colorSpace": "oklch", "components": [0, 0, 0], "alpha": 0.12 }, "offsetX": { "value": 0, "unit": "px" }, "offsetY": { "value": 2, "unit": "px" }, "blur": { "value": 8, "unit": "px" }, "spread": { "value": 0, "unit": "px" } },
        { "color": { "colorSpace": "oklch", "components": [0, 0, 0], "alpha": 0.06 }, "offsetX": { "value": 0, "unit": "px" }, "offsetY": { "value": 1, "unit": "px" }, "blur": { "value": 2, "unit": "px" }, "spread": { "value": 0, "unit": "px" } }
      ], "$description": "Card shadow" },
      "lg": { "$value": [
        { "color": { "colorSpace": "oklch", "components": [0, 0, 0], "alpha": 0.16 }, "offsetX": { "value": 0, "unit": "px" }, "offsetY": { "value": 8, "unit": "px" }, "blur": { "value": 24, "unit": "px" }, "spread": { "value": 0, "unit": "px" } },
        { "color": { "colorSpace": "oklch", "components": [0, 0, 0], "alpha": 0.08 }, "offsetX": { "value": 0, "unit": "px" }, "offsetY": { "value": 2, "unit": "px" }, "blur": { "value": 6, "unit": "px" }, "spread": { "value": 0, "unit": "px" } }
      ], "$description": "Modal/dropdown" },
      "xl": { "$value": [
        { "color": { "colorSpace": "oklch", "components": [0, 0, 0], "alpha": 0.20 }, "offsetX": { "value": 0, "unit": "px" }, "offsetY": { "value": 16, "unit": "px" }, "blur": { "value": 48, "unit": "px" }, "spread": { "value": 0, "unit": "px" } },
        { "color": { "colorSpace": "oklch", "components": [0, 0, 0], "alpha": 0.10 }, "offsetX": { "value": 0, "unit": "px" }, "offsetY": { "value": 4, "unit": "px" }, "blur": { "value": 12, "unit": "px" }, "spread": { "value": 0, "unit": "px" } }
      ], "$description": "Full overlay" }
    },
    "semantic": {
      "card":    { "$value": "{shadow.primitive.md}" },
      "raised":  { "$value": "{shadow.primitive.lg}", "$description": "Hover lift" },
      "overlay": { "$value": "{shadow.primitive.xl}" }
    }
  },
  "radius": {
    "$type": "dimension",
    "primitive": {
      "sm":   { "$value": { "value": 4, "unit": "px" } },
      "md":   { "$value": { "value": 8, "unit": "px" } },
      "lg":   { "$value": { "value": 12, "unit": "px" } },
      "xl":   { "$value": { "value": 16, "unit": "px" } },
      "full": { "$value": { "value": 9999, "unit": "px" } }
    },
    "semantic": {
      "control": { "$value": "{radius.primitive.sm}", "$description": "Buttons, inputs" },
      "card":    { "$value": "{radius.primitive.md}" },
      "pill":    { "$value": "{radius.primitive.full}", "$description": "Pills, avatars" }
    }
  },
  "opacity": {
    "$type": "number",
    "primitive": {
      "30":  { "$value": 0.3 },
      "60":  { "$value": 0.6 },
      "100": { "$value": 1 }
    },
    "semantic": {
      "muted":  { "$value": "{opacity.primitive.30}", "$description": "Tertiary/disabled" },
      "medium": { "$value": "{opacity.primitive.60}", "$description": "Secondary content" },
      "full":   { "$value": "{opacity.primitive.100}", "$description": "Primary content" }
    }
  },
  "component": {
    "button": {
      "bg":             { "$value": "{color.semantic.interactive.default}" },
      "bg-hover":       { "$value": "{color.semantic.interactive.hover}" },
      "bg-active":      { "$value": "{color.semantic.interactive.active}" },
      "text":           { "$value": "{color.semantic.surface.primary}", "$description": "Dark text on the accent" },
      "radius":         { "$value": "{radius.semantic.control}" },
      "padding-block":  { "$value": "{space.semantic.inline}" },
      "padding-inline": { "$value": "{space.semantic.inset}" },
      "font-size":      { "$value": "{font.semantic.size.small}" },
      "font-weight":    { "$value": "{font.semantic.weight.emphasis}" },
      "duration":       { "$value": "{duration.semantic.fast}" },
      "ease":           { "$value": "{ease.semantic.out}" }
    },
    "card": {
      "bg":      { "$value": "{color.semantic.surface.secondary}" },
      "border":  { "$value": "{color.semantic.border.subtle}" },
      "padding": { "$value": "{space.semantic.stack}" },
      "radius":  { "$value": "{radius.semantic.card}" },
      "shadow":  { "$value": "{shadow.semantic.card}" }
    }
  }
}
```

The component tier is not optional decoration: `component.button.bg` reaches `{color.semantic.interactive.default}`, which reaches `{color.primitive.accent.base}` — three tiers, each referencing only the one below it. That chain is the never-skip law demonstrated: rebrand the accent and every button follows; re-purpose the interactive role and only the semantic tier moves.

## tokens.css — derived custom properties

Generated from tokens.json — one custom property per token, and the stylesheet never invents a variable the JSON doesn't carry. The JSON above carries **133 tokens**; the stylesheet below carries **133 declarations**. The name is the token's path with the tier segment dropped (`primitive`, `semantic`, and `component` never appear in a variable name — the naming grammar keeps the remaining paths distinct) and dots joined as dashes. Primitives render as literals; aliases render as `var()` chains, so the tier hierarchy survives into the browser and a direction change still lands in one place. Unit handling is mechanical: dimensions and durations keep their units, cubic béziers render as `cubic-bezier()`, shadow layers join as a comma list, and the unitless letter-spacing ratios take `em` (tracking is proportional to its font size; the DTCG dimension type carries only `px` and `rem`, so the ratio is the token and the generator supplies the unit). No variable ever references itself.

```css
:root {
  /* color — primitives */
  --color-neutral-50: oklch(0.985 0.002 240);
  --color-neutral-200: oklch(0.925 0.006 240);
  --color-neutral-400: oklch(0.710 0.010 240);
  --color-neutral-500: oklch(0.550 0.012 240);
  --color-neutral-600: oklch(0.440 0.014 240);
  --color-neutral-700: oklch(0.350 0.016 240);
  --color-neutral-800: oklch(0.250 0.018 240);
  --color-neutral-900: oklch(0.180 0.014 240);
  --color-neutral-950: oklch(0.130 0.010 240);
  --color-accent-light: oklch(0.800 0.120 250);
  --color-accent-base: oklch(0.650 0.180 250);
  --color-accent-strong: oklch(0.500 0.200 250);
  --color-red-base: oklch(0.620 0.210 25);

  /* color — semantic */
  --color-surface-primary: var(--color-neutral-950);
  --color-surface-secondary: var(--color-neutral-900);
  --color-surface-tertiary: var(--color-neutral-800);
  --color-surface-inverse: var(--color-neutral-50);
  --color-text-primary: var(--color-neutral-50);
  --color-text-secondary: var(--color-neutral-400);
  --color-text-tertiary: var(--color-neutral-500);
  --color-text-accent: var(--color-accent-base);
  --color-border-subtle: var(--color-neutral-800);
  --color-border-default: var(--color-neutral-700);
  --color-border-strong: var(--color-neutral-600);
  --color-interactive-default: var(--color-accent-base);
  --color-interactive-hover: var(--color-accent-light);
  --color-interactive-active: var(--color-accent-strong);
  --color-status-error: var(--color-red-base);

  /* font */
  --font-family-sans: system-ui, sans-serif;
  --font-family-mono: ui-monospace, SFMono-Regular, monospace;
  --font-size-12: 0.75rem; --font-size-14: 0.875rem; --font-size-16: 1rem;
  --font-size-18: 1.125rem; --font-size-20: 1.25rem; --font-size-24: 1.5rem;
  --font-size-32: 2rem; --font-size-40: 2.5rem; --font-size-56: 3.5rem;
  --font-weight-400: 400; --font-weight-500: 500; --font-weight-700: 700;
  --font-family-heading: var(--font-family-sans);
  --font-family-body: var(--font-family-sans);
  --font-family-code: var(--font-family-mono);
  --font-size-caption: var(--font-size-12); --font-size-small: var(--font-size-14);
  --font-size-body: var(--font-size-16); --font-size-heading: var(--font-size-24);
  --font-size-display: var(--font-size-40);
  --font-weight-body: var(--font-weight-400); --font-weight-emphasis: var(--font-weight-500);
  --font-weight-heading: var(--font-weight-700);

  /* letter-spacing */
  --letter-spacing-tight: -0.04em; --letter-spacing-snug: -0.02em;
  --letter-spacing-normal: 0em; --letter-spacing-wide: 0.05em;
  --letter-spacing-display: var(--letter-spacing-tight);
  --letter-spacing-heading: var(--letter-spacing-snug);
  --letter-spacing-caps: var(--letter-spacing-wide);

  /* space */
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-5: 20px; --space-6: 24px; --space-8: 32px; --space-10: 40px;
  --space-12: 48px; --space-16: 64px; --space-20: 80px; --space-24: 96px;
  --space-32: 128px;
  --space-inline: var(--space-2);
  --space-inset: var(--space-4);
  --space-stack: var(--space-6);
  --space-reveal: var(--space-8);
  --space-section: var(--space-20);

  /* duration */
  --duration-50: 50ms; --duration-150: 150ms; --duration-250: 250ms;
  --duration-400: 400ms; --duration-700: 700ms;
  --duration-instant: var(--duration-50);
  --duration-fast: var(--duration-150);
  --duration-normal: var(--duration-250);
  --duration-slow: var(--duration-400);
  --duration-cinematic: var(--duration-700);

  /* ease */
  --ease-standard: cubic-bezier(0.25, 0.1, 0.25, 1);
  --ease-accelerate: cubic-bezier(0.4, 0, 1, 1);
  --ease-decelerate: cubic-bezier(0, 0, 0.2, 1);
  --ease-overshoot: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-default: var(--ease-standard);
  --ease-in: var(--ease-accelerate);
  --ease-out: var(--ease-decelerate);
  --ease-spring: var(--ease-overshoot);

  /* shadow */
  --shadow-sm: 0 1px 2px 0 oklch(0 0 0 / 0.08), 0 1px 1px 0 oklch(0 0 0 / 0.04);
  --shadow-md: 0 2px 8px 0 oklch(0 0 0 / 0.12), 0 1px 2px 0 oklch(0 0 0 / 0.06);
  --shadow-lg: 0 8px 24px 0 oklch(0 0 0 / 0.16), 0 2px 6px 0 oklch(0 0 0 / 0.08);
  --shadow-xl: 0 16px 48px 0 oklch(0 0 0 / 0.20), 0 4px 12px 0 oklch(0 0 0 / 0.10);
  --shadow-card: var(--shadow-md);
  --shadow-raised: var(--shadow-lg);
  --shadow-overlay: var(--shadow-xl);

  /* radius */
  --radius-sm: 4px; --radius-md: 8px; --radius-lg: 12px; --radius-xl: 16px;
  --radius-full: 9999px;
  --radius-control: var(--radius-sm);
  --radius-card: var(--radius-md);
  --radius-pill: var(--radius-full);

  /* opacity */
  --opacity-30: 0.3; --opacity-60: 0.6; --opacity-100: 1;
  --opacity-muted: var(--opacity-30);
  --opacity-medium: var(--opacity-60);
  --opacity-full: var(--opacity-100);

  /* component */
  --button-bg: var(--color-interactive-default);
  --button-bg-hover: var(--color-interactive-hover);
  --button-bg-active: var(--color-interactive-active);
  --button-text: var(--color-surface-primary);
  --button-radius: var(--radius-control);
  --button-padding-block: var(--space-inline);
  --button-padding-inline: var(--space-inset);
  --button-font-size: var(--font-size-small);
  --button-font-weight: var(--font-weight-emphasis);
  --button-duration: var(--duration-fast);
  --button-ease: var(--ease-out);
  --card-bg: var(--color-surface-secondary);
  --card-border: var(--color-border-subtle);
  --card-padding: var(--space-stack);
  --card-radius: var(--radius-card);
  --card-shadow: var(--shadow-card);
}
```

The example maps a dark direction (surface primary at the deep end of the neutral scale). That is the example's choice, not a default: whether a project is light, dark, or dual-mode is a creative-direction decision, and the semantic tier is what makes either mapping a one-file change.

## Color — OKLCH, and deriving variants

OKLCH for all colors. In the JSON, a color is `{"colorSpace": "oklch", "components": [L, C, H]}` — L 0–1, C 0–0.4 in practice, H 0–360 — rendering to CSS as `oklch(L C H)`. Perceptually uniform, P3 gamut. On top of the OKLCH primitives, derive variants rather than minting new literals: `color-mix(in oklch, var(--color-accent-base) 85%, white)` for hover/muted/overlay tints, and relative color syntax (`oklch(from var(--color-accent-base) calc(l - 0.15) c h)`) where a variant is a systematic transform of a base token. A handful of base tokens plus derivation beats a wall of hand-picked near-duplicates — and keeps every derived value moving when the base moves.

Text uses three opacity tiers via semantic colors: primary (1.0 feel), secondary (0.6 feel), tertiary (0.3 feel). Shadows always layered (two depths), oklch black for consistency.

## The Ban List — machine defaults to refuse

These are the choices that mark work as machine-made — the statistical medians of generated UI. Each is refused as a DEFAULT: the ban is on the reflex, never the deliberate choice. An intentional creative direction may elect any of them by name in `creative-direction.md`, and a named election stands — the same scoping the behavior bans below already carry. Absent that election, the right-hand column is the direction, not a single sanctioned value.

| Default to refuse | Better alternative |
|---|---|
| Inter / Roboto / Open Sans — and the second-wave defaults Geist and Space Grotesk | Project-specific typeface chosen in the creative direction, or an honest system-ui stack |
| blue-500 (`#3b82f6`) accent | OKLCH accent derived from the project's visual direction |
| Purple/indigo-to-blue gradients — hero backgrounds, glow orbs, gradient-text headlines | One accent, used sparingly; any gradient stays inside the project's own palette and earns its place |
| Tailwind default gray scale | Custom neutral scale with intentional undertone (warm/cool/neutral) |
| `#000000` pure black backgrounds | Near-black with slight chroma: `oklch(0.130 0.010 hue)` |
| `#ffffff` pure white text | Off-white: `oklch(0.985 0.002 hue)` |
| 0px border-radius everywhere | Consistent radius scale (sm/md/lg) |
| Large radius + drop shadow stacked on every card | Elevation that means something — one or two levels, radius from the scale, layered shadows where depth is real |
| `box-shadow: 0 2px 4px rgba(0,0,0,0.1)` | Layered shadow with two depths |
| `transition: all 0.3s ease` | Named duration + purpose-matched easing, transitioning named properties |
| 1rem/1.5rem spacing everywhere | 4px-base spacing scale |
| HSL color functions | OKLCH — perceptually uniform, P3-ready — with `color-mix()`/relative color for variants |

And beyond single values, the reflexes — refused as behaviors:

- **Dark mode nobody asked for.** Defaulting to a dark theme is itself a machine tell. The mode is a creative-direction decision made from the project's audience and content, stated in `creative-direction.md` — never a reflex.
- **The centered hero + three-feature-card grid** as the landing-page skeleton, and the bento grid as the reflexive answer to "modern layout." Layout follows the content's actual structure.
- **Unmodified component-library defaults.** A component kit shipped looking exactly like its documentation is a tell regardless of which kit. Kits are raw material; the token layer restyles them.
- **Glassmorphism as the whole surface language.** Frosted-glass depth is an accent for hierarchy, used sparingly — never the treatment every surface gets.
