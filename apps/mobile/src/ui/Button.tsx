import { RADIUS, SPACE } from "@serendipity/ui";
import { Pressable, View } from "react-native";

import { AppText } from "./AppText";
import { usePalette } from "./theme";
import { touchTarget } from "./touch";

export interface ButtonProps {
  /** The visible text, which is also what a screen reader says. */
  readonly label: string;
  /** Left out only for a control that is shown but not live yet (always `disabled`). */
  readonly onPress?: () => void;
  readonly variant?: "primary" | "secondary" | "danger";
  readonly disabled?: boolean;
  /** Extra context for screen readers, e.g. what happens next. */
  readonly hint?: string;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  hint,
}: ButtonProps) {
  const palette = usePalette();
  const fill =
    variant === "primary"
      ? palette.accent
      : variant === "danger"
        ? palette.danger
        : palette.surface;
  const text = variant === "primary" ? "onAccent" : variant === "danger" ? "onDanger" : "accent";
  return (
    <Pressable
      role="button"
      aria-label={label}
      aria-disabled={disabled}
      accessibilityHint={hint}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        ...touchTarget(),
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: SPACE.lg,
        paddingVertical: SPACE.md,
        borderRadius: RADIUS.md,
        backgroundColor: fill,
        borderWidth: variant === "secondary" ? 1 : 0,
        borderColor: palette.border,
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      <View>
        <AppText variant="label" color={text}>
          {label}
        </AppText>
      </View>
    </Pressable>
  );
}
