import { RADIUS } from "@serendipity/ui";
import { Pressable } from "react-native";

import { Glass } from "./Glass";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import { usePalette } from "./theme";
import { touchTarget } from "./touch";

/** A round glass button with one icon. `label` is what screen readers say. */
export function IconButton({
  icon,
  label,
  onPress,
  disabled = false,
  hint,
}: {
  readonly icon: IconName;
  readonly label: string;
  /** Left out only for a control that is shown but not live yet (always `disabled`). */
  readonly onPress?: () => void;
  readonly disabled?: boolean;
  readonly hint?: string;
}) {
  const palette = usePalette();
  return (
    <Pressable
      role="button"
      aria-label={label}
      aria-disabled={disabled}
      accessibilityHint={hint}
      disabled={disabled}
      onPress={onPress}
      style={{ ...touchTarget(), width: 52, height: 52, opacity: disabled ? 0.55 : 1 }}
    >
      <Glass
        radius={RADIUS.pill}
        style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
      >
        <Icon name={icon} color={disabled ? palette.textSecondary : palette.text} size={22} />
      </Glass>
    </Pressable>
  );
}
