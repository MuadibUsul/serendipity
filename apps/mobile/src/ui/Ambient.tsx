import { StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";

import { useMaterials, usePalette } from "./theme";

/** Where the light sits on each kind of page (from the vivid drafts, 390 × 844). */
export type AmbientLayout = "default" | "signIn" | "ai" | "invite";

type Glow = "glowBlush" | "glowMint" | "glowPeach" | "glowPowder" | "glowLavender";

interface Field {
  readonly glow: Glow;
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  /** Where the light has faded out, as a share of the radius. */
  readonly reach: number;
}

const SIGN_IN: readonly Field[] = [
  { glow: "glowBlush", cx: 320, cy: 70, r: 240, reach: 0.66 },
  { glow: "glowMint", cx: 0, cy: 470, r: 220, reach: 0.66 },
  { glow: "glowLavender", cx: 380, cy: 340, r: 180, reach: 0.66 },
  { glow: "glowPeach", cx: 290, cy: 794, r: 210, reach: 0.66 },
  { glow: "glowPowder", cx: 30, cy: 794, r: 170, reach: 0.66 },
];

const LAYOUTS: Readonly<Record<AmbientLayout, readonly Field[]>> = {
  default: SIGN_IN,
  signIn: SIGN_IN,
  ai: [
    { glow: "glowBlush", cx: 195, cy: 320, r: 260, reach: 0.64 },
    { glow: "glowPowder", cx: 20, cy: 40, r: 190, reach: 0.66 },
    { glow: "glowLavender", cx: 370, cy: 60, r: 170, reach: 0.66 },
    { glow: "glowMint", cx: 130, cy: 784, r: 210, reach: 0.66 },
    { glow: "glowPeach", cx: 390, cy: 634, r: 150, reach: 0.66 },
  ],
  invite: [
    { glow: "glowBlush", cx: 195, cy: 310, r: 280, reach: 0.62 },
    { glow: "glowPeach", cx: 360, cy: 50, r: 180, reach: 0.66 },
    { glow: "glowLavender", cx: 10, cy: 50, r: 170, reach: 0.66 },
    { glow: "glowPowder", cx: 40, cy: 774, r: 200, reach: 0.66 },
    { glow: "glowMint", cx: 350, cy: 784, r: 180, reach: 0.66 },
  ],
};

/**
 * The page behind the glass: blush white, lit by saturated fields of blush,
 * mint, peach, powder blue and lavender, so the glass has something to
 * catch. Decorative.
 */
export function Ambient({ layout = "default" }: { readonly layout?: AmbientLayout }) {
  const palette = usePalette();
  const materials = useMaterials();
  const fields = LAYOUTS[layout];
  return (
    <View
      aria-hidden
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: palette.background }]}
    >
      <Svg width="100%" height="100%" viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice">
        <Defs>
          {fields.map((field, index) => (
            <RadialGradient
              key={index}
              id={`ambient-${layout}-${String(index)}`}
              cx="50%"
              cy="50%"
              r="50%"
            >
              <Stop
                offset="0"
                stopColor={materials[field.glow]}
                stopOpacity={materials.glowStrength}
              />
              <Stop offset={field.reach} stopColor={materials[field.glow]} stopOpacity={0} />
            </RadialGradient>
          ))}
        </Defs>
        {fields.map((field, index) => (
          <Circle
            key={index}
            cx={field.cx}
            cy={field.cy}
            r={field.r}
            fill={`url(#ambient-${layout}-${String(index)})`}
          />
        ))}
      </Svg>
    </View>
  );
}
