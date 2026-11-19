import { describe, expect, it } from "vitest";

import { AA_NON_TEXT, AA_TEXT, contrastRatio, luminance } from "./contrast.js";
import {
  COLOR_SCHEMES,
  LOADED_FONTS,
  MATERIALS,
  MIN_TOUCH_TARGET,
  NON_TEXT_PAIRS,
  PALETTES,
  TEXT_PAIRS,
  TYPE,
} from "./tokens.js";

/** An opaque `#rrggbb` at `alpha`, as `rgba(...)`. */
function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  return `rgba(${String(r)},${String(g)},${String(b)},${String(alpha)})`;
}

/** `rgba(...)` laid over an opaque `#rrggbb`, as an opaque `#rrggbb`. */
function over(rgba: string, hex: string): string {
  const match = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(rgba);
  if (match === null) throw new Error(`not rgba: ${rgba}`);
  const alpha = Number(match[4]);
  const top = [Number(match[1]), Number(match[2]), Number(match[3])];
  const bottom = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  return `#${top
    .map((value, index) =>
      Math.round(value * alpha + (bottom[index] ?? 0) * (1 - alpha))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

describe("contrastRatio", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
    // #767676 on white is the classic smallest AA grey.
    expect(contrastRatio("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#777777", "#ffffff")).toBeLessThan(4.5);
  });

  it("does not depend on the order of the colours", () => {
    expect(contrastRatio("#8a3b2e", "#faf7f2")).toBe(contrastRatio("#faf7f2", "#8a3b2e"));
  });

  it.each(["#fff", "red", "#gggggg", "#1234567", ""])("refuses %j", (bad) => {
    expect(() => luminance(bad)).toThrow();
  });
});

describe.each(COLOR_SCHEMES)("the %s palette", (scheme) => {
  const palette = PALETTES[scheme];

  it.each(TEXT_PAIRS)("%s on %s meets AA for body text (4.5:1)", (fg, bg) => {
    expect(contrastRatio(palette[fg], palette[bg])).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(NON_TEXT_PAIRS)("%s on %s meets AA for controls (3:1)", (fg, bg) => {
    expect(contrastRatio(palette[fg], palette[bg])).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it("is made of opaque #rrggbb colours only", () => {
    for (const value of Object.values(palette)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("keeps the brand coral decorative: too light for text or state", () => {
    expect(contrastRatio(palette.accent, palette.background)).toBeLessThan(AA_NON_TEXT);
    expect(contrastRatio(palette.accentText, palette.background)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("keeps glass clear and hairlines faint", () => {
    const alpha = (rgba: string) => Number(/,\s*([\d.]+)\)$/.exec(rgba)?.[1]);
    const materials = MATERIALS[scheme];
    expect(alpha(materials.glass)).toBeLessThan(0.8);
    expect(alpha(materials.glassRaised)).toBeLessThan(0.9);
    expect(alpha(materials.separator)).toBeLessThanOrEqual(0.08);
    // The 剧集版 light is saturated, but never opaque: the page shows through.
    expect(materials.glowStrength).toBeGreaterThan(0);
    expect(materials.glowStrength).toBeLessThanOrEqual(0.9);
  });

  /** Each ambient light at its centre: the glow at full strength over the page. */
  const lights = (page: string) => {
    const materials = MATERIALS[scheme];
    return [
      materials.glowBlush,
      materials.glowMint,
      materials.glowPeach,
      materials.glowPowder,
      materials.glowLavender,
    ].map((glow) => over(withAlpha(glow, materials.glowStrength), page));
  };

  it("keeps the coral badge's text readable, over the page and over the strongest light", () => {
    const palette = PALETTES[scheme];
    const materials = MATERIALS[scheme];
    // The badge sits on glass over the page; check it over the bare page and
    // over each glow at its centre, where the light is strongest.
    const under = [palette.background, ...lights(palette.background)];
    for (const backdrop of under) {
      const badge = over(materials.accentFill, over(materials.glass, backdrop));
      expect(contrastRatio(palette.accentText, badge)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("keeps text readable on glass over the strongest light", () => {
    const palette = PALETTES[scheme];
    const materials = MATERIALS[scheme];
    for (const glow of lights(palette.background)) {
      const surface = over(materials.glass, glow);
      for (const key of ["text", "textSecondary", "accentText"] as const) {
        expect(contrastRatio(palette[key], surface)).toBeGreaterThanOrEqual(AA_TEXT);
      }
      // Secondary text straight on the page's light, outside any glass.
      expect(contrastRatio(palette.textSecondary, glow)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});

describe("sizes", () => {
  it("only names fonts the apps load", () => {
    for (const style of Object.values(TYPE)) {
      if ("fontFamily" in style) expect(LOADED_FONTS).toContain(style.fontFamily);
    }
  });

  it("never goes below Apple's footnote size (13 pt) or lines tighter than 1.14", () => {
    for (const style of Object.values(TYPE)) {
      expect(style.fontSize).toBeGreaterThanOrEqual(13);
      expect(style.lineHeight / style.fontSize).toBeGreaterThanOrEqual(1.14);
    }
  });

  it("keeps touch targets at least 44 points", () => {
    for (const size of Object.values(MIN_TOUCH_TARGET)) expect(size).toBeGreaterThanOrEqual(44);
  });
});
