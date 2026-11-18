// WCAG 2.2 contrast (§1.4.3, §1.4.11): relative luminance of sRGB colours
// written as #rrggbb, and the ratio between two of them.

const HEX = /^#[0-9a-f]{6}$/i;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance, 0 (black) to 1 (white). Throws on anything but #rrggbb. */
export function luminance(hex: string): number {
  if (!HEX.test(hex)) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16))) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The contrast ratio between two colours, from 1 (none) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** WCAG AA: 4.5:1 for body text, 3:1 for large text and for the parts of controls. */
export const AA_TEXT = 4.5;
export const AA_LARGE_TEXT = 3;
export const AA_NON_TEXT = 3;
