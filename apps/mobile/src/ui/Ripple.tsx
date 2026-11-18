import { useEffect, useState } from "react";
import { Animated, Easing, Platform, View } from "react-native";

import { useReducedMotion } from "./Breathing";
import { useMaterials } from "./theme";

/**
 * Rings of coral light leaving the voice orb, slowly, one after another.
 * Decorative; when motion is reduced, one still, faint ring stays.
 */
export function Ripple({
  size,
  period = 3200,
}: {
  readonly size: number;
  readonly period?: number;
}) {
  const reduced = useReducedMotion();
  const materials = useMaterials();
  const [waves] = useState(() => [new Animated.Value(0), new Animated.Value(0)]);
  useEffect(() => {
    if (reduced) return;
    const loops = waves.map((wave, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay((index * period) / 2),
          Animated.timing(wave, {
            toValue: 1,
            duration: period,
            easing: Easing.out((t: number) => Easing.quad(t)),
            useNativeDriver: Platform.OS !== "web",
          }),
          Animated.timing(wave, {
            toValue: 0,
            duration: 0,
            useNativeDriver: Platform.OS !== "web",
          }),
        ]),
      ),
    );
    for (const loop of loops) loop.start();
    return () => {
      for (const loop of loops) loop.stop();
    };
  }, [reduced, waves, period]);
  const ring = {
    position: "absolute" as const,
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth: 1,
    borderColor: materials.glowCoral,
  };
  if (reduced) return <View aria-hidden style={[ring, { opacity: 0.25 }]} />;
  return (
    <>
      {waves.map((wave, index) => (
        <Animated.View
          key={index}
          aria-hidden
          style={[
            ring,
            {
              opacity: wave.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }),
              transform: [
                { scale: wave.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.25] }) },
              ],
            },
          ]}
        />
      ))}
    </>
  );
}
