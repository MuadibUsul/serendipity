import { MOTION } from "@serendipity/ui";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, Platform } from "react-native";

/** Whether the person asked the system for less motion; until known, assume yes. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then(
      (value) => {
        if (live) setReduced(value);
      },
      () => undefined,
    );
    // react-native-web returns nothing where matchMedia is missing.
    let subscription: { remove: () => void } | undefined;
    try {
      subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
        setReduced(value);
      });
    } catch {
      subscription = undefined;
    }
    return () => {
      live = false;
      subscription?.remove();
    };
  }, []);
  return reduced;
}

/** A slow, calm swell, for the voice entry. Still when motion is reduced. */
export function Breathing({ children }: { readonly children: ReactNode }) {
  const reduced = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(0));
  const scale = useMemo(
    () => progress.interpolate({ inputRange: [0, 1], outputRange: [1, MOTION.breatheScale] }),
    [progress],
  );
  useEffect(() => {
    if (reduced) {
      progress.setValue(0);
      return;
    }
    const half = MOTION.breatheMs / 2;
    const ease = Easing.inOut((t: number) => Easing.sin(t));
    const step = (toValue: number) =>
      Animated.timing(progress, {
        toValue,
        duration: half,
        easing: ease,
        useNativeDriver: Platform.OS !== "web",
      });
    const loop = Animated.loop(Animated.sequence([step(1), step(0)]));
    loop.start();
    return () => {
      loop.stop();
    };
  }, [reduced, progress]);
  return <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>;
}
