# @serendipity/ui

Design tokens for every 不期 app, as plain values with no React. Components live in the apps and
take every colour, size and space from here.

- **Palettes:** `light` and `dark`.
- **Contrast lists:** `TEXT_PAIRS` must meet WCAG AA for text (4.5:1). `NON_TEXT_PAIRS` (control
  borders, focus ring) must meet 3:1. `src/tokens.test.ts` checks both lists in both schemes; add a
  pair there whenever a component starts using it.
- **Type scale:** `TYPE`, at the default text size. Apps let it grow with the person's text size.
- **Sizes:** `SPACE`, `RADIUS`, and `MIN_TOUCH_TARGET` (44 pt iOS and web, 48 dp Android).
- **`contrastRatio(a, b)`:** the WCAG 2.2 ratio of two `#rrggbb` colours.
