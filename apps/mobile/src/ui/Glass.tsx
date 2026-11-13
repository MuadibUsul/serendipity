// Liquid Glass on iOS and Android. iOS 26 draws Apple's own material
// (expo-glass-effect); older iOS and Android use a light blur; anything else
// gets clear translucent white. The web version is Glass.web.tsx.
import { GLASS, RADIUS, SHADOW } from "@serendipity/ui";
import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { StyleSheet, View } from "react-native";

import type { GlassProps } from "./glass-props";
import { useMaterials } from "./theme";

const liquid = (() => {
  try {
    return isLiquidGlassAvailable();
  } catch {
    return false;
  }
})();

export function Glass({
  raised = false,
  halo = false,
  radius = RADIUS.lg,
  style,
  children,
}: GlassProps) {
  const materials = useMaterials();
  const shape = { borderRadius: radius, borderCurve: "continuous" as const };
  return (
    <View
      style={[
        shape,
        { boxShadow: halo ? SHADOW.halo : raised ? SHADOW.float : SHADOW.soft },
        style,
      ]}
    >
      <View style={[StyleSheet.absoluteFill, shape, { overflow: "hidden" }]}>
        {liquid ? (
          <GlassView
            glassEffectStyle="regular"
            colorScheme="light"
            tintColor={raised ? materials.glassRaised : materials.glass}
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <BlurView
            intensity={GLASS.blurIntensity}
            tint="light"
            blurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
        )}
        <View
          style={[
            StyleSheet.absoluteFill,
            shape,
            {
              backgroundColor: liquid
                ? "transparent"
                : raised
                  ? materials.glassRaised
                  : materials.glass,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: materials.glassHighlight,
            },
          ]}
        />
      </View>
      {children}
    </View>
  );
}
