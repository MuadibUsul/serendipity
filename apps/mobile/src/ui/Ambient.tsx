import { StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";

import { useMaterials, usePalette } from "./theme";

/** Where the soft light sits on each kind of page (from the 柔光 design, 390 × 844). */
export type AmbientLayout = "default" | "signIn" | "ai" | "invite";

type Glow = "glowBlush" | "glowMint" | "glowPeach" | "glowPowder";

interface Field {
  readonly glow: Glow;
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  /** Where the light has faded out, as a share of the radius. */
  readonly reach: number;
}

const LAYOUTS: Readonly<Record<AmbientLayout, readonly Field[]>> = {
  default: [
    { glow: "glowBlush", cx: 360, cy: 40, r: 220, reach: 0.68 },
    { glow: "glowMint", cx: -20, cy: 520, r: 200, reach: 0.68 },
    { glow: "glowPeach", cx: 330, cy: 820, r: 190, reach: 0.68 },
  ],
  signIn: [
    { glow: "glowBlush", cx: 350, cy: 60, r: 230, reach: 0.68 },
    { glow: "glowMint", cx: -20, cy: 510, r: 210, reach: 0.68 },
    { glow: "glowPeach", cx: 320, cy: 804, r: 190, reach: 0.68 },
  ],
  ai: [
    { glow: "glowPowder", cx: 20, cy: 40, r: 180, reach: 0.68 },
    { glow: "glowBlush", cx: 195, cy: 320, r: 240, reach: 0.66 },
    { glow: "glowMint", cx: 130, cy: 774, r: 190, reach: 0.68 },
  ],
  invite: [
    { glow: "glowPeach", cx: 360, cy: 50, r: 170, reach: 0.68 },
    { glow: "glowBlush", cx: 195, cy: 320, r: 260, reach: 0.64 },
    { glow: "glowPowder", cx: 30, cy: 764, r: 180, reach: 0.68 },
  ],
};

/**
 * The page behind the glass: white, with soft fields of blush, mint, peach
 * and powder blue, so the glass has something to catch. Decorative.
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
