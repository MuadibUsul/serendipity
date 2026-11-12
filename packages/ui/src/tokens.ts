/**
 * Design tokens for every 不期 app (PRD-001 §3.1: four pages, calm, no feed).
 * Plain values only, so they can be checked without a renderer. Components
 * live in the apps and take every colour, size and space from here.
 */

export const COLOR_SCHEMES = ["light", "dark"] as const;
export type ColorScheme = (typeof COLOR_SCHEMES)[number];

export interface Palette {
  /** The page behind everything. */
  readonly background: string;
  /** Cards and the tab bar. */
  readonly surface: string;
  readonly text: string;
  /** Secondary text: hints, captions, inactive tabs. */
  readonly textMuted: string;
  /** The primary action's fill, and the selected tab. */
  readonly accent: string;
  /** Text and icons on an accent fill. */
  readonly onAccent: string;
  /** Borders of inputs and outlined buttons: a control's boundary (WCAG 1.4.11). */
  readonly border: string;
  /** Errors and the safety entry points. */
  readonly danger: string;
  /** Text on a danger fill. */
  readonly onDanger: string;
  /** Keyboard / screen-reader focus ring. */
  readonly focus: string;
}

export const PALETTES: Readonly<Record<ColorScheme, Palette>> = {
  light: {
    background: "#faf7f2",
    surface: "#ffffff",
    text: "#1f1b16",
    textMuted: "#5c554c",
    accent: "#8a3b2e",
    onAccent: "#ffffff",
    border: "#8c847a",
    danger: "#a3221a",
    onDanger: "#ffffff",
    focus: "#1d4ed8",
  },
  dark: {
    background: "#14120f",
    surface: "#1f1c18",
    text: "#f3eee7",
    textMuted: "#b8afa3",
    accent: "#e8a593",
    onAccent: "#2a0f09",
    border: "#8f877c",
    danger: "#ff8a80",
    onDanger: "#2b0503",
    focus: "#93b4ff",
  },
};

/**
 * Text that must stay readable, as [foreground, background] pairs of palette
 * keys. The contrast tests hold every pair to WCAG AA in both schemes, so a
 * pair is added here whenever a component starts using it.
 */
export const TEXT_PAIRS: readonly (readonly [keyof Palette, keyof Palette])[] = [
  ["text", "background"],
  ["text", "surface"],
  ["textMuted", "background"],
  ["textMuted", "surface"],
  ["onAccent", "accent"],
  ["accent", "background"],
  ["accent", "surface"],
  ["danger", "background"],
  ["danger", "surface"],
  ["onDanger", "danger"],
];

/** Boundaries of controls and the focus ring: 3:1 against what they sit on. */
export const NON_TEXT_PAIRS: readonly (readonly [keyof Palette, keyof Palette])[] = [
  ["border", "background"],
  ["border", "surface"],
  ["accent", "background"],
  ["accent", "surface"],
  ["focus", "background"],
  ["focus", "surface"],
];

/** Spacing steps, in density-independent points. */
export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const RADIUS = { sm: 6, md: 12, lg: 20, pill: 999 } as const;

/**
 * The smallest touch target: 44 × 44 pt (Apple HIG; WCAG 2.5.5 AAA). Android
 * asks for 48 dp, which `minTouchTarget` gives on that platform.
 */
export const MIN_TOUCH_TARGET = { ios: 44, android: 48, web: 44 } as const;

export interface TextStyleToken {
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly fontWeight: "400" | "600" | "700";
}

/**
 * The type scale, at the default text size. Apps never fix a height around
 * text and never turn font scaling off, so every step grows with the person's
 * system text size (dynamic type).
 */
export const TYPE = {
  display: { fontSize: 28, lineHeight: 36, fontWeight: "700" },
  title: { fontSize: 22, lineHeight: 30, fontWeight: "700" },
  heading: { fontSize: 18, lineHeight: 26, fontWeight: "600" },
  body: { fontSize: 16, lineHeight: 24, fontWeight: "400" },
  label: { fontSize: 16, lineHeight: 22, fontWeight: "600" },
  caption: { fontSize: 14, lineHeight: 20, fontWeight: "400" },
} as const satisfies Record<string, TextStyleToken>;

export type TextVariant = keyof typeof TYPE;

/** Text at or above this size (or 14 pt bold) counts as large for WCAG. */
export const LARGE_TEXT_MIN = 18;

/**
 * The most a text style may be limited to grow, as a multiple of its size.
 * `maxFontSizeMultiplier` below this would defeat the person's text size.
 */
export const MIN_FONT_SCALE_CAP = 2;
