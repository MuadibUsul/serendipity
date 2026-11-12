import { TYPE } from "@serendipity/ui";
import type { Palette, TextVariant } from "@serendipity/ui";
import type { ReactNode } from "react";
import { Text } from "react-native";

import { usePalette } from "./theme";

type TextColor = "text" | "textMuted" | "accent" | "danger" | "onAccent" | "onDanger";

export interface AppTextProps {
  readonly variant?: TextVariant;
  readonly color?: TextColor & keyof Palette;
  /** Marks the text as a heading for screen readers. */
  readonly heading?: boolean;
  /** Announced when it appears (errors, confirmations). */
  readonly live?: "polite" | "assertive";
  readonly children: ReactNode;
}

/**
 * The only text component screens use. It always scales with the person's
 * text size: font scaling is never turned off and never capped, and no height
 * is fixed around it (dynamic type).
 */
export function AppText({
  variant = "body",
  color = "text",
  heading,
  live,
  children,
}: AppTextProps) {
  const palette = usePalette();
  return (
    <Text
      role={heading === true ? "heading" : undefined}
      aria-live={live}
      style={{ ...TYPE[variant], color: palette[color] }}
    >
      {children}
    </Text>
  );
}
