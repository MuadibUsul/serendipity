import { RADIUS, SHADOW, SPACE } from "@serendipity/ui";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TAB_LABELS } from "../copy";
import { TABS } from "../shell/state";
import type { Tab } from "../shell/state";
import { AppText } from "./AppText";
import { Glass } from "./Glass";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import { useMaterials, usePalette } from "./theme";
import { touchTarget } from "./touch";

const ICON_OF: Readonly<Record<Tab, IconName>> = {
  ai: "ai",
  dates: "dates",
  relationships: "relationships",
  me: "me",
};

/**
 * The four pages (PRD-001 §3.1) as a floating glass capsule. The selected page
 * sits in a white pill: ink label, coral icon. Every tab has a text label.
 */
export function TabBar({
  current,
  onSelect,
}: {
  readonly current: Tab;
  readonly onSelect: (tab: Tab) => void;
}) {
  const palette = usePalette();
  const materials = useMaterials();
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: SPACE.lg,
        right: SPACE.lg,
        bottom: Math.max(insets.bottom, SPACE.lg),
      }}
    >
      <Glass raised radius={RADIUS.pill} style={{ padding: SPACE.xs }}>
        <View role="tablist" style={{ flexDirection: "row" }}>
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
                  gap: 2,
                  paddingVertical: SPACE.sm,
                  borderRadius: RADIUS.pill,
                  backgroundColor: selected ? materials.glassRaised : "transparent",
                  boxShadow: selected ? SHADOW.thumb : "none",
                }}
              >
                <Icon
                  name={ICON_OF[tab]}
                  color={selected ? palette.accentStrong : palette.textSecondary}
                />
                <AppText variant="footnote" color={selected ? "text" : "textSecondary"}>
                  {TAB_LABELS[tab]}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </Glass>
    </View>
  );
}
