# @serendipity/ui

Design tokens for every 不期 app: **Apple White Liquid Glass**. Plain values, no React. Components
live in the apps and take every colour, size, shadow and space from here.
[ADR-0010](../../docs/adr/0010-mobile-shell.md) §9 records the visual decisions.

- **`PALETTES`:** opaque colours (white, ink, secondary grey, three corals).
  - `TEXT_PAIRS` must meet WCAG AA for text (4.5:1).
  - `NON_TEXT_PAIRS` (state-carrying parts of controls, the focus ring) must meet 3:1.

  `src/tokens.test.ts` checks every pair. Add a pair there whenever a component starts using it.

- **The corals:**
  - `accent` (#ff6b81) is decorative only: glows, dots, drawings.
  - `accentText` (#c9304a) is for coral text.
  - `accentStrong` (#e8435e) is for state, such as a toggle that is on or the selected icon.
- **`MATERIALS`:** translucent glass, hairlines, wells and ambient light. They are not
  contrast-tested on their own, because text on glass always sits over the white page.
- **`TYPE`:** Apple's type scale, at the default text size. Apps let it grow with the person's text
  size. `WEB_FONT_FAMILY` asks for SF Pro and PingFang SC on the web.
- **Sizes and effects:** `SPACE`, `RADIUS` (continuous corners), `SHADOW` (soft, low-contrast),
  `GLASS` (blur), `MOTION` (slow; apps switch it off for reduced motion), `MIN_TOUCH_TARGET`.
- **`contrastRatio(a, b)`:** the WCAG 2.2 ratio of two `#rrggbb` colours.
