/**
 * Design tokens for every 不期 app: "Apple White Liquid Glass".
 *
 * White dominates; glass is clear and thin; a soft coral appears only as a
 * small accent. Plain values only, so they can be checked without a renderer.
 * Components live in the apps and take every colour, size and space from here.
 */

/** One scheme for now: the brand is Apple White. A dark scheme is a later design decision. */
export const COLOR_SCHEMES = ["light"] as const;
export type ColorScheme = (typeof COLOR_SCHEMES)[number];

/** Opaque colours. Every text and control pair among them is contrast-tested. */
export interface Palette {
  /** The page. */
  readonly background: string;
  /** Quiet areas: grouped backgrounds, wells. */
  readonly backgroundSecondary: string;
  readonly text: string;
  /**
   * Secondary text. The brief's #747982 is 4.38:1 on white, just under AA;
   * #6B7079 looks the same and reaches 4.98:1.
   */
  readonly textSecondary: string;
  /** The primary action's fill (Apple-style ink capsule) and its text. */
  readonly ink: string;
  readonly onInk: string;
  /**
   * The brand coral. Decorative only (glows, dots, illustration details): at
   * 2.74:1 on white it may carry neither text nor state.
   */
  readonly accent: string;
  /** Coral that carries state (toggle on, selected icon): 3.89:1, enough for controls. */
  readonly accentStrong: string;
  /** Coral for text and links: 5.24:1. */
  readonly accentText: string;
  /** Errors and destructive actions, as text. */
  readonly danger: string;
  /** Keyboard / screen-reader focus ring. */
  readonly focus: string;
}

export const PALETTES: Readonly<Record<ColorScheme, Palette>> = {
  light: {
    background: "#ffffff",
    backgroundSecondary: "#f8f9fb",
    text: "#17191d",
    textSecondary: "#6b7079",
    ink: "#17191d",
    onInk: "#ffffff",
    accent: "#ff6b81",
    accentStrong: "#e8435e",
    accentText: "#c9304a",
    danger: "#c4262e",
    focus: "#e8435e",
  },
};

/**
 * Translucent materials (Liquid Glass). Not contrast-tested on their own:
 * text always sits on them over a white page, never over a photo.
 */
export interface Materials {
  /** Glass surfaces: cards, grouped lists. */
  readonly glass: string;
  /** Floating glass: the tab bar, sheets, the selected tab. */
  readonly glassRaised: string;
  /** The thin light catching a glass edge. */
  readonly glassHighlight: string;
  /** Hairline separators. */
  readonly separator: string;
  /** Wells inside glass: text fields, quiet chips. */
  readonly fill: string;
  /** A toggle that is off. */
  readonly toggleOff: string;
  /**
   * Ambient light behind the glass (the "柔光" design, 2026-11-13): soft
   * fields of blush, mint, peach and powder blue on white, drawn as radial
   * fades at low opacity, so the glass has something to catch.
   */
  readonly glowBlush: string;
  readonly glowMint: string;
  readonly glowPeach: string;
  readonly glowPowder: string;
  /** The brand coral as light: the voice orb's glow, the invitation's halo. */
  readonly glowCoral: string;
  /** How strong the ambient fields are at their centre (0–1). */
  readonly glowStrength: number;
}

export const MATERIALS: Readonly<Record<ColorScheme, Materials>> = {
  light: {
    glass: "rgba(255,255,255,0.62)",
    glassRaised: "rgba(255,255,255,0.8)",
    glassHighlight: "rgba(255,255,255,0.85)",
    separator: "rgba(20,25,35,0.06)",
    fill: "rgba(118,122,135,0.09)",
    toggleOff: "rgba(118,122,135,0.20)",
    glowBlush: "#ffbeca",
    glowMint: "#c8eede",
    glowPeach: "#ffdac4",
    glowPowder: "#d6e2ff",
    glowCoral: "#ff6b81",
    glowStrength: 0.55,
  },
};

/** Text that must stay readable: [foreground, background], held to WCAG AA (4.5:1). */
export const TEXT_PAIRS: readonly (readonly [keyof Palette, keyof Palette])[] = [
  ["text", "background"],
  ["text", "backgroundSecondary"],
  ["textSecondary", "background"],
  ["textSecondary", "backgroundSecondary"],
  ["onInk", "ink"],
  ["accentText", "background"],
  ["accentText", "backgroundSecondary"],
  ["danger", "background"],
  ["danger", "backgroundSecondary"],
];

/** Parts of controls that carry state, and the focus ring: 3:1 (WCAG 1.4.11). */
export const NON_TEXT_PAIRS: readonly (readonly [keyof Palette, keyof Palette])[] = [
  ["accentStrong", "background"],
  ["accentStrong", "backgroundSecondary"],
  ["ink", "background"],
  ["focus", "background"],
  ["focus", "backgroundSecondary"],
];

/** Spacing steps, in points. Generous by design. */
export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, xxxl: 40 } as const;

/** Continuous-curvature corners (squircles on iOS). */
export const RADIUS = { sm: 12, md: 18, lg: 24, xl: 30, pill: 999 } as const;

/** Soft, diffuse, low-contrast shadows: lift without darkness. */
export const SHADOW = {
  /** Glass resting on the page. */
  soft: "0px 18px 44px rgba(40,24,40,0.07)",
  /** Floating glass: the tab bar, the sign-in sheet. */
  float: "0px 18px 44px rgba(40,24,40,0.09)",
  /** The invitation: a faint coral halo under the glass. */
  halo: "0px 30px 70px rgba(255,107,129,0.16), 0px 12px 30px rgba(40,24,40,0.06)",
  /** The voice orb. */
  orb: "0px 30px 70px rgba(255,107,129,0.32)",
  /** A white thumb or pill on glass. */
  thumb: "0px 2px 6px rgba(23,25,29,0.12)",
} as const;

/** Glass optics: thin and clear, never frosted plastic. */
export const GLASS = {
  /** expo-blur intensity, 1–100. */
  blurIntensity: 36,
  /** The same on the web. */
  webBackdrop: "blur(24px) saturate(180%)",
} as const;

/** Motion: slow and calm. Off when the person asks for reduced motion. */
export const MOTION = {
  breatheMs: 4200,
  breatheScale: 1.04,
  pressScale: 0.97,
} as const;

/**
 * The smallest touch target: 44 × 44 pt (Apple HIG; WCAG 2.5.5 AAA). Android
 * asks for 48 dp.
 */
export const MIN_TOUCH_TARGET = { ios: 44, android: 48, web: 44 } as const;

export interface TextStyleToken {
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly fontWeight: "200" | "300" | "400" | "500" | "600" | "700";
  readonly letterSpacing?: number;
  /** A loaded font (Outfit, for numerals and Latin labels); the system font otherwise. */
  readonly fontFamily?: string;
}

/**
 * The type scale, after Apple's (SF Pro and PingFang SC on Apple devices), at
 * the default text size. Apps never fix a height around text and never turn
 * font scaling off, so every step grows with the person's text size.
 */
export const TYPE = {
  /** Big numerals: the time of a date. Outfit ExtraLight, tight tracking. */
  numeral: {
    fontSize: 84,
    lineHeight: 96,
    fontWeight: "200",
    letterSpacing: -2,
    fontFamily: "Outfit_200ExtraLight",
  },
  /** The sign-in line: large, medium weight, airy. */
  hero: { fontSize: 32, lineHeight: 44, fontWeight: "500", letterSpacing: 0.5 },
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: "700", letterSpacing: 0.2 },
  title: { fontSize: 24, lineHeight: 32, fontWeight: "600" },
  subtitle: { fontSize: 20, lineHeight: 28, fontWeight: "600" },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: "600" },
  body: { fontSize: 17, lineHeight: 24, fontWeight: "400" },
  label: { fontSize: 16, lineHeight: 21, fontWeight: "500" },
  subhead: { fontSize: 15, lineHeight: 21, fontWeight: "400" },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: "400" },
  /** Small Latin labels ("INVITATION", "Serendipity"): Outfit Light, spaced. */
  latin: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "300",
    letterSpacing: 2,
    fontFamily: "Outfit_300Light",
  },
  /** One digit of a one-time code: Outfit Light. */
  digit: { fontSize: 28, lineHeight: 34, fontWeight: "300", fontFamily: "Outfit_300Light" },
  /** Amounts: Outfit Medium. */
  amount: { fontSize: 20, lineHeight: 26, fontWeight: "500", fontFamily: "Outfit_500Medium" },
} as const satisfies Record<string, TextStyleToken>;

/** The Outfit faces the apps load (expo-font), by the family names TYPE uses. */
export const LOADED_FONTS = [
  "Outfit_200ExtraLight",
  "Outfit_300Light",
  "Outfit_500Medium",
] as const;

export type TextVariant = keyof typeof TYPE;

/** The web font stack: SF and PingFang where present, then good neighbours. */
export const WEB_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", sans-serif';

/** The most a text style may be limited to grow, as a multiple of its size. */
export const MIN_FONT_SCALE_CAP = 2;
