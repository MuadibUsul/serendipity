import { MOTION, RADIUS, SPACE } from "@serendipity/ui";
import { Pressable, View } from "react-native";

import { AppText } from "./AppText";
import { useMaterials, usePalette } from "./theme";
import { touchTarget } from "./touch";

export interface ButtonProps {
  /** The visible text, which is also what a screen reader says. */
  readonly label: string;
  /** Left out only for a control that is shown but not live yet (always `disabled`). */
  readonly onPress?: () => void;
  /**
   * - `primary`: the ink capsule, one per screen.
   * - `secondary`: a quiet filled capsule.
   * - `plain`: text only, coral (`danger` in red).
   */
  readonly variant?: "primary" | "secondary" | "plain" | "danger";
  readonly disabled?: boolean;
  /** Extra context for screen readers, e.g. what happens next. */
  readonly hint?: string;
  /**
   * What a screen reader says, when it needs more than the visible label
   * (e.g. whose chat). Must start with the visible label (WCAG 2.5.3).
   */
  readonly spokenLabel?: string;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  hint,
  spokenLabel,
}: ButtonProps) {
  if (spokenLabel !== undefined && !spokenLabel.startsWith(label)) {
    throw new Error(`Spoken label must start with the visible label: ${label}`);
  }
  const palette = usePalette();
  const materials = useMaterials();
  const filled = variant === "primary" || variant === "secondary";
  // Shown-but-not-live controls read as quiet grey, never as a faded black slab.
  const fill = !filled
    ? "transparent"
    : variant === "primary" && !disabled
      ? palette.ink
      : materials.fill;
  const text = disabled
    ? "textSecondary"
    : variant === "primary"
      ? "onInk"
      : variant === "plain"
        ? "accentText"
        : variant === "danger"
          ? "danger"
          : "text";
  return (
    <Pressable
      role="button"
      aria-label={spokenLabel ?? label}
      aria-disabled={disabled}
      accessibilityHint={hint}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        ...touchTarget(),
        minHeight: variant === "plain" || variant === "danger" ? 44 : 52,
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: SPACE.xl,
        paddingVertical: SPACE.md,
        borderRadius: RADIUS.pill,
        backgroundColor: fill,
        opacity: disabled && !filled ? 0.5 : 1,
        transform: [{ scale: pressed && !disabled ? MOTION.pressScale : 1 }],
      })}
    >
      <View>
        <AppText variant={variant === "primary" ? "headline" : "label"} color={text} align="center">
          {label}
        </AppText>
      </View>
    </Pressable>
  );
}
