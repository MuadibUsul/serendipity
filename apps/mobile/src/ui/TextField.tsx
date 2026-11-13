import { RADIUS, SPACE, TYPE, WEB_FONT_FAMILY } from "@serendipity/ui";
import { useState } from "react";
import { Platform, TextInput, View } from "react-native";
import type { KeyboardTypeOptions } from "react-native";

import { AppText } from "./AppText";
import { useMaterials, usePalette } from "./theme";
import { touchTarget } from "./touch";

export interface TextFieldProps {
  /** Shown above the field and read by screen readers. */
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly hint?: string;
  readonly keyboardType?: KeyboardTypeOptions;
  readonly textContentType?: "telephoneNumber" | "oneTimeCode";
  readonly maxLength?: number;
}

/**
 * A filled field with its label above it, no outline. The label identifies
 * the field; focus shows as a coral ring.
 */
export function TextField({
  label,
  value,
  onChangeText,
  hint,
  keyboardType,
  textContentType,
  maxLength,
}: TextFieldProps) {
  const palette = usePalette();
  const materials = useMaterials();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: SPACE.sm }}>
      <AppText variant="footnote" color="textSecondary">
        {label}
      </AppText>
      <TextInput
        aria-label={label}
        accessibilityHint={hint}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
        }}
        keyboardType={keyboardType}
        textContentType={textContentType}
        maxLength={maxLength}
        autoCorrect={false}
        selectionColor={palette.accentStrong}
        style={{
          ...TYPE.body,
          ...touchTarget(),
          ...(Platform.OS === "web" ? { fontFamily: WEB_FONT_FAMILY } : {}),
          minHeight: 52,
          color: palette.text,
          backgroundColor: materials.fill,
          borderRadius: RADIUS.md,
          borderCurve: "continuous",
          borderWidth: 1.5,
          borderColor: focused ? palette.focus : "transparent",
          paddingHorizontal: SPACE.lg,
        }}
      />
      {hint === undefined ? null : (
        <AppText variant="footnote" color="textSecondary">
          {hint}
        </AppText>
      )}
    </View>
  );
}
