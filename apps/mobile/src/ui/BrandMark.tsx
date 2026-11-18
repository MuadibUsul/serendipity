import { SPACE } from "@serendipity/ui";
import { View } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";

import { APP_NAME } from "../copy";
import { AppText } from "./AppText";
import { useMaterials } from "./theme";

/** The coral orb: 不期's mark, a small light. */
export function Orb({ size = 22 }: { readonly size?: number }) {
  const materials = useMaterials();
  return (
    <View
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        boxShadow: `0px 0px ${String(Math.round(size * 0.8))}px rgba(255,107,129,0.45)`,
      }}
    >
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id="brand-orb" cx="35%" cy="30%" r="70%" fx="35%" fy="30%">
            <Stop offset="0" stopColor="#ffffff" />
            <Stop offset="0.4" stopColor="#ffd2da" />
            <Stop offset="1" stopColor={materials.glowCoral} />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill="url(#brand-orb)" />
      </Svg>
    </View>
  );
}

/** The orb, the name and "Serendipity", in one line. */
export function BrandMark() {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.md }}>
      <Orb />
      <AppText variant="headline">{APP_NAME}</AppText>
      <AppText variant="latin" color="textSecondary">
        Serendipity
      </AppText>
    </View>
  );
}
