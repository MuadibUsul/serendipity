// Liquid Glass on the web (and in tests): CSS backdrop blur over translucent
// white, a hairline of light on the edge and a soft shadow.
import { GLASS, RADIUS, SHADOW } from "@serendipity/ui";
import { View } from "react-native";

import type { GlassProps } from "./glass-props";
import { useMaterials } from "./theme";

export function Glass({ raised = false, radius = RADIUS.lg, style, children }: GlassProps) {
  const materials = useMaterials();
  return (
    <View
      style={[
        {
          borderRadius: radius,
          backgroundColor: raised ? materials.glassRaised : materials.glass,
          borderWidth: 1,
          borderColor: materials.glassHighlight,
          boxShadow: raised ? SHADOW.float : SHADOW.soft,
          // react-native-web passes this through to CSS.
          backdropFilter: GLASS.webBackdrop,
        } as object,
        style,
      ]}
    >
      {children}
    </View>
  );
}
