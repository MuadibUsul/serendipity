import { RADIUS, SHADOW, SPACE } from "@serendipity/ui";
import { Pressable, View } from "react-native";

import { AppText } from "./AppText";
import { useMaterials, usePalette } from "./theme";
import { touchTarget } from "./touch";

const TRACK = { width: 51, height: 31 } as const;
const THUMB = 27;

/**
 * An on/off setting. The whole row is the control, so the touch target is the
 * row; the toggle is drawn (Apple's proportions), so there is one focus stop.
 */
export function SwitchRow({
  label,
  hint,
  value,
  onValueChange,
  disabled = false,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly value: boolean;
  readonly onValueChange: (value: boolean) => void;
  readonly disabled?: boolean;
}) {
  const palette = usePalette();
  const materials = useMaterials();
  return (
    <Pressable
      role="switch"
      aria-label={label}
      aria-checked={value}
      aria-disabled={disabled}
      accessibilityHint={hint}
      disabled={disabled}
      onPress={() => {
        onValueChange(!value);
      }}
      style={{
        ...touchTarget(),
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.lg,
        paddingVertical: SPACE.md,
        opacity: disabled ? 0.38 : 1,
      }}
    >
      <View style={{ flex: 1, gap: SPACE.xs }}>
        <AppText variant="body">{label}</AppText>
        {hint === undefined ? null : (
          <AppText variant="footnote" color="textSecondary">
            {hint}
          </AppText>
        )}
      </View>
      <View
        aria-hidden
        style={{
          ...TRACK,
          borderRadius: RADIUS.pill,
          backgroundColor: value ? palette.accentStrong : materials.toggleOff,
          padding: 2,
          alignItems: value ? "flex-end" : "flex-start",
          justifyContent: "center",
        }}
      >
        <View
          style={{
            width: THUMB,
            minHeight: THUMB,
            borderRadius: RADIUS.pill,
            backgroundColor: palette.background,
            boxShadow: SHADOW.thumb,
          }}
        />
      </View>
    </Pressable>
  );
}
