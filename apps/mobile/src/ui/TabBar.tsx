import { SPACE } from "@serendipity/ui";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TAB_LABELS } from "../copy";
import { TABS } from "../shell/state";
import type { Tab } from "../shell/state";
import { AppText } from "./AppText";
import { usePalette } from "./theme";
import { touchTarget } from "./touch";

/** The four pages (PRD-001 §3.1). Text labels, no icon-only tabs. */
export function TabBar({
  current,
  onSelect,
}: {
  readonly current: Tab;
  readonly onSelect: (tab: Tab) => void;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View
      role="tablist"
      style={{
        flexDirection: "row",
        backgroundColor: palette.surface,
        borderTopWidth: 1,
        borderTopColor: palette.border,
        paddingBottom: insets.bottom,
      }}
    >
      {TABS.map((tab) => {
        const selected = tab === current;
        return (
          <Pressable
            key={tab}
            role="tab"
            aria-label={TAB_LABELS[tab]}
            aria-selected={selected}
            onPress={() => {
              onSelect(tab);
            }}
            style={{
              ...touchTarget(),
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              paddingVertical: SPACE.sm,
              borderTopWidth: 3,
              borderTopColor: selected ? palette.accent : "transparent",
            }}
          >
            <AppText variant="label" color={selected ? "accent" : "textMuted"}>
              {TAB_LABELS[tab]}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}
