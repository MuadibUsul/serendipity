import { RADIUS, SPACE } from "@serendipity/ui";
import { useEffect, useState } from "react";
import { Animated, Platform, View } from "react-native";

import { useReducedMotion } from "./Breathing";
import { Glass } from "./Glass";
import { useMaterials } from "./theme";

/**
 * Placeholders in the shape of what is loading (after BoardUI's Skeleton,
 * MIT): a soft, slow pulse; still when the person asks for reduced motion.
 * Hidden from screen readers; the page's live "加载中" line speaks instead.
 */
function Block({
  width,
  height,
  radius = RADIUS.sm,
}: {
  readonly width: number | `${number}%`;
  readonly height: number;
  readonly radius?: number;
}) {
  const materials = useMaterials();
  return (
    <View style={{ width, height, borderRadius: radius, backgroundColor: materials.toggleOff }} />
  );
}

function usePulse() {
  const reduced = useReducedMotion();
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduced) {
      opacity.setValue(1);
      return;
    }
    const step = (toValue: number) =>
      Animated.timing(opacity, {
        toValue,
        duration: 900,
        useNativeDriver: Platform.OS !== "web",
      });
    const loop = Animated.loop(Animated.sequence([step(0.45), step(1)]));
    loop.start();
    return () => {
      loop.stop();
    };
  }, [reduced, opacity]);
  return opacity;
}

/** A page-shaped placeholder: a card of lines, then a list of rows. */
export function PageSkeleton() {
  const opacity = usePulse();
  return (
    <Animated.View aria-hidden style={{ opacity, gap: SPACE.xxl }}>
      <Glass raised radius={RADIUS.xl} style={{ padding: SPACE.xxl, gap: SPACE.lg }}>
        <Block width="35%" height={12} />
        <Block width="55%" height={22} />
        <Block width="45%" height={48} radius={RADIUS.md} />
        <Block width="80%" height={14} />
        <Block width="65%" height={14} />
      </Glass>
      <Glass style={{ padding: SPACE.lg, gap: SPACE.lg }}>
        <Block width="70%" height={14} />
        <Block width="50%" height={14} />
        <Block width="60%" height={14} />
      </Glass>
    </Animated.View>
  );
}
