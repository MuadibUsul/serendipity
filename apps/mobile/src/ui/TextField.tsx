import { RADIUS, SPACE, TYPE } from "@serendipity/ui";
import { TextInput, View } from "react-native";
import type { KeyboardTypeOptions } from "react-native";

import { AppText } from "./AppText";
import { usePalette } from "./theme";
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
  return (
    <View style={{ gap: SPACE.xs }}>
      <AppText variant="label">{label}</AppText>
      <TextInput
        aria-label={label}
        accessibilityHint={hint}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        textContentType={textContentType}
        maxLength={maxLength}
        autoCorrect={false}
        style={{
          ...TYPE.body,
          ...touchTarget(),
          color: palette.text,
          backgroundColor: palette.surface,
          borderColor: palette.border,
          borderWidth: 1,
          borderRadius: RADIUS.sm,
          paddingHorizontal: SPACE.md,
        }}
      />
      {hint === undefined ? null : (
        <AppText variant="caption" color="textMuted">
          {hint}
        </AppText>
      )}
    </View>
  );
}
