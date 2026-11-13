import { StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";

import { useMaterials, usePalette } from "./theme";

/**
 * The page behind the glass: white, with a faint pearl light and the
 * slightest trace of coral, so glass has something to catch. Decorative.
 */
export function Ambient() {
  const palette = usePalette();
  const materials = useMaterials();
  return (
    <View
      aria-hidden
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: palette.background }]}
    >
      <Svg width="100%" height="100%" viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <RadialGradient id="pearl" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={materials.glowPearl} stopOpacity={0.9} />
            <Stop offset="1" stopColor={materials.glowPearl} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="coral" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={materials.glowCoral} stopOpacity={0.1} />
            <Stop offset="1" stopColor={materials.glowCoral} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={330} cy={60} r={260} fill="url(#coral)" />
        <Circle cx={40} cy={420} r={320} fill="url(#pearl)" />
        <Circle cx={360} cy={820} r={240} fill="url(#pearl)" />
      </Svg>
    </View>
  );
}
