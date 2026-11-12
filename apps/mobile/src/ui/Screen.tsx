import { RADIUS, SPACE } from "@serendipity/ui";
import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppText } from "./AppText";
import { usePalette } from "./theme";

/**
 * A page's frame. It scrolls, so nothing is cut off when the person's text
 * size is large.
 */
export function Screen({ children }: { readonly children: ReactNode }) {
  const palette = usePalette();
  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={{ flex: 1, backgroundColor: palette.background }}
    >
      <ScrollView contentContainerStyle={{ padding: SPACE.lg, gap: SPACE.lg }}>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ children }: { readonly children: ReactNode }) {
  const palette = usePalette();
  return (
    <View
      style={{
        backgroundColor: palette.surface,
        borderRadius: RADIUS.md,
        padding: SPACE.lg,
        gap: SPACE.sm,
        borderWidth: 1,
        borderColor: palette.border,
      }}
    >
      {children}
    </View>
  );
}

/** A label and its value, read together by screen readers. */
export function Field({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View accessible aria-label={`${label}：${value}`} style={{ gap: SPACE.xs }}>
      <AppText variant="caption" color="textMuted">
        {label}
      </AppText>
      <AppText>{value}</AppText>
    </View>
  );
}
