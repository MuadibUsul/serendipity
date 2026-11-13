// Liquid Glass on the web (and in tests): CSS backdrop blur over translucent
// white, a hairline of light on the edge and a soft shadow.
import { GLASS, RADIUS, SHADOW } from "@serendipity/ui";
import { View } from "react-native";

import type { GlassProps } from "./glass-props";
import { useMaterials } from "./theme";

/** The thin light catching the glass's top edge. */
const EDGE_LIGHT = "inset 0px 1px 0px rgba(255,255,255,0.95)";

export function Glass({
  raised = false,
  halo = false,
  radius = RADIUS.lg,
  style,
  children,
}: GlassProps) {
  const materials = useMaterials();
  return (
    <View
      style={[
        {
          borderRadius: radius,
          backgroundColor: raised ? materials.glassRaised : materials.glass,
          borderWidth: 1,
          borderColor: materials.glassHighlight,
          boxShadow: `${EDGE_LIGHT}, ${halo ? SHADOW.halo : raised ? SHADOW.float : SHADOW.soft}`,
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
