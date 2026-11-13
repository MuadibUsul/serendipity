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
  /** Fixed text before the value, inside the field (e.g. "+86"). Not part of the value. */
  readonly prefix?: string;
  readonly autoFocus?: boolean;
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
  prefix,
  autoFocus,
}: TextFieldProps) {
  const palette = usePalette();
  const materials = useMaterials();
  const [focused, setFocused] = useState(false);
  const font = Platform.OS === "web" ? { fontFamily: WEB_FONT_FAMILY } : {};
  return (
    <View style={{ gap: SPACE.sm }}>
      <AppText variant="footnote" color="textSecondary">
        {label}
      </AppText>
      <View
        style={{
          ...touchTarget(),
          minHeight: 52,
          flexDirection: "row",
          alignItems: "center",
          gap: SPACE.md,
          backgroundColor: materials.fill,
          borderRadius: RADIUS.md,
          borderCurve: "continuous",
          borderWidth: 1.5,
          borderColor: focused ? palette.focus : "transparent",
          paddingHorizontal: SPACE.lg,
        }}
      >
        {prefix === undefined ? null : (
          <View aria-hidden>
            <AppText>{prefix}</AppText>
          </View>
        )}
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
          autoFocus={autoFocus}
          autoCorrect={false}
          selectionColor={palette.accentStrong}
          style={{
            ...TYPE.body,
            ...font,
            flex: 1,
            alignSelf: "stretch",
            color: palette.text,
            // The box above draws the field; the input itself stays clear.
            // react-native-web passes this to CSS: no browser focus box inside the coral ring.
            ...(Platform.OS === "web" ? ({ outlineStyle: "none", outlineWidth: 0 } as object) : {}),
          }}
        />
      </View>
      {hint === undefined ? null : (
        <AppText variant="footnote" color="textSecondary">
          {hint}
        </AppText>
      )}
    </View>
  );
}
