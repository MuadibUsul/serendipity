import { TYPE, WEB_FONT_FAMILY } from "@serendipity/ui";
import type { Palette, TextStyleToken, TextVariant } from "@serendipity/ui";
import type { ReactNode } from "react";
import { Platform, Text } from "react-native";

import { usePalette } from "./theme";

type TextColor = "text" | "textSecondary" | "accentText" | "onInk" | "danger";

export interface AppTextProps {
  readonly variant?: TextVariant;
  readonly color?: TextColor & keyof Palette;
  /** Marks the text as a heading for screen readers. */
  readonly heading?: boolean;
  /** Announced when it appears (errors, confirmations). */
  readonly live?: "polite" | "assertive";
  readonly align?: "left" | "center";
  readonly children: ReactNode;
}

/** Outfit where the type scale names it; the system font (SF Pro / PingFang SC) otherwise. */
function fontFor(variant: TextVariant): { fontFamily?: string } {
  const style: TextStyleToken = TYPE[variant];
  if (style.fontFamily !== undefined) {
    return {
      fontFamily:
        Platform.OS === "web" ? `${style.fontFamily}, ${WEB_FONT_FAMILY}` : style.fontFamily,
    };
  }
  return Platform.OS === "web" ? { fontFamily: WEB_FONT_FAMILY } : {};
}

/**
 * The only text component screens use. On Apple devices the system font is SF
 * Pro with PingFang SC; the web asks for the same. It always scales with the
 * person's text size: font scaling is never off or capped, and no height is
 * fixed around it (dynamic type).
 */
export function AppText({
  variant = "body",
  color = "text",
  heading,
  live,
  align = "left",
  children,
}: AppTextProps) {
  const palette = usePalette();
  return (
    <Text
      role={heading === true ? "heading" : undefined}
      aria-live={live}
      style={{
        ...TYPE[variant],
        color: palette[color],
        textAlign: align,
        ...fontFor(variant),
      }}
    >
      {children}
    </Text>
  );
}
