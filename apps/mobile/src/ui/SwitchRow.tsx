import { RADIUS, SPACE } from "@serendipity/ui";
import { Pressable, View } from "react-native";

import { AppText } from "./AppText";
import { usePalette } from "./theme";
import { touchTarget } from "./touch";

const TRACK = { width: 48, height: 28 } as const;
const THUMB = 22;

/**
 * An on/off setting. The whole row is the control, so the touch target is the
 * row, not a small switch; the toggle is drawn, so there is one focus stop and
 * it looks the same on every platform.
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
        gap: SPACE.md,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View style={{ flex: 1, gap: SPACE.xs }}>
        <AppText variant="label">{label}</AppText>
        {hint === undefined ? null : (
          <AppText variant="caption" color="textMuted">
            {hint}
          </AppText>
        )}
      </View>
      <View
        aria-hidden
        style={{
          ...TRACK,
          borderRadius: RADIUS.pill,
          borderWidth: 2,
          borderColor: value ? palette.accent : palette.border,
          backgroundColor: value ? palette.accent : palette.surface,
          justifyContent: "center",
          paddingHorizontal: 1,
          alignItems: value ? "flex-end" : "flex-start",
        }}
      >
        <View
          style={{
            width: THUMB,
            minHeight: THUMB,
            borderRadius: RADIUS.pill,
            backgroundColor: value ? palette.onAccent : palette.border,
          }}
        />
      </View>
    </Pressable>
  );
}
