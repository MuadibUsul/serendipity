import { SPACE } from "@serendipity/ui";
import { Children, Fragment } from "react";
import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Ambient } from "./Ambient";
import { AppText } from "./AppText";
import { Glass } from "./Glass";
import { useMaterials, usePalette } from "./theme";

/** Room left at the bottom of a page for the floating tab bar. */
export const TAB_BAR_CLEARANCE = 112;

/**
 * A page: white with ambient light, a large title, then content that scrolls,
 * so nothing is cut off at a large text size.
 */
export function Screen({
  title,
  withTabBar = true,
  children,
}: {
  /** The page's large title, read as its heading. */
  readonly title?: string;
  readonly withTabBar?: boolean;
  readonly children: ReactNode;
}) {
  const palette = usePalette();
  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <Ambient />
      <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: SPACE.xl,
            paddingTop: SPACE.xxl,
            paddingBottom: withTabBar ? TAB_BAR_CLEARANCE : SPACE.xxxl,
            gap: SPACE.xxl,
          }}
        >
          {title === undefined ? null : (
            <AppText variant="largeTitle" heading>
              {title}
            </AppText>
          )}
          {children}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

/** A titled group of rows on one glass surface, separated by hairlines (iOS grouped list). */
export function Group({
  title,
  footer,
  children,
}: {
  readonly title?: string;
  readonly footer?: string;
  readonly children: ReactNode;
}) {
  const materials = useMaterials();
  const rows = Children.toArray(children);
  return (
    <View style={{ gap: SPACE.sm }}>
      {title === undefined ? null : (
        <View style={{ paddingHorizontal: SPACE.lg }}>
          <AppText variant="footnote" color="textSecondary">
            {title}
          </AppText>
        </View>
      )}
      <Glass style={{ paddingHorizontal: SPACE.lg }}>
        {rows.map((row, index) => (
          <Fragment key={index}>
            {index === 0 ? null : (
              <View style={{ height: 1, backgroundColor: materials.separator }} />
            )}
            {row}
          </Fragment>
        ))}
      </Glass>
      {footer === undefined ? null : (
        <View style={{ paddingHorizontal: SPACE.lg }}>
          <AppText variant="footnote" color="textSecondary">
            {footer}
          </AppText>
        </View>
      )}
    </View>
  );
}

/** A label and its value in a group, read together by screen readers. */
export function Row({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View
      accessible
      aria-label={`${label}：${value}`}
      style={{
        minHeight: 52,
        paddingVertical: SPACE.md,
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        columnGap: SPACE.lg,
        rowGap: SPACE.xs,
      }}
    >
      <AppText>{label}</AppText>
      <AppText color="textSecondary">{value}</AppText>
    </View>
  );
}

/** A calm empty state: a line drawing, one warm sentence, one hint. */
export function EmptyState({
  art,
  line,
  hint,
}: {
  readonly art: ReactNode;
  readonly line: string;
  readonly hint: string;
}) {
  return (
    <View style={{ alignItems: "center", gap: SPACE.lg, paddingVertical: SPACE.xxxl }}>
      {art}
      <AppText variant="title" align="center">
        {line}
      </AppText>
      <View style={{ maxWidth: 300 }}>
        <AppText color="textSecondary" align="center">
          {hint}
        </AppText>
      </View>
    </View>
  );
}
