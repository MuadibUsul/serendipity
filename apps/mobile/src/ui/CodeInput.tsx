import { RADIUS, SPACE, TYPE, WEB_FONT_FAMILY } from "@serendipity/ui";
import { useRef, useState } from "react";
import type { ComponentRef } from "react";
import { Platform, Pressable, StyleSheet, TextInput, View } from "react-native";

import { AppText } from "./AppText";
import { useMaterials, usePalette } from "./theme";

/**
 * A one-time code as a row of cells (after BoardUI's Input OTP, MIT): one
 * real text field underneath takes typing, paste and SMS autofill in one go,
 * and is what screen readers see; the cells only draw it.
 */
export function CodeInput({
  label,
  value,
  onChangeText,
  length = 6,
  invalid = false,
  autoFocus = false,
}: {
  /** Shown above the cells and read by screen readers. */
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly length?: number;
  /** Draws every cell in the error colour. */
  readonly invalid?: boolean;
  readonly autoFocus?: boolean;
}) {
  const palette = usePalette();
  const materials = useMaterials();
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [focused, setFocused] = useState(false);
  const digits = value.replace(/\D/g, "").slice(0, length);
  const active = Math.min(digits.length, length - 1);
  const half = Math.ceil(length / 2);
  return (
    <View style={{ gap: SPACE.sm }}>
      <AppText variant="footnote" color="textSecondary">
        {label}
      </AppText>
      <Pressable
        aria-hidden
        tabIndex={-1}
        onPress={() => {
          input.current?.focus();
        }}
        style={{ flexDirection: "row", gap: SPACE.sm }}
      >
        {Array.from({ length }, (_, index) => {
          const isActive = focused && index === active;
          return (
            <View
              key={index}
              style={{
                flex: 1,
                minHeight: 56,
                marginLeft: index === half ? SPACE.md : 0,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: materials.fill,
                borderRadius: RADIUS.sm,
                borderCurve: "continuous",
                borderWidth: 1.5,
                borderColor: invalid ? palette.danger : isActive ? palette.focus : "transparent",
              }}
            >
              {digits[index] === undefined ? (
                isActive ? (
                  <View style={{ width: 2, minHeight: 24, backgroundColor: palette.focus }} />
                ) : null
              ) : (
                <AppText variant="title">{digits[index]}</AppText>
              )}
            </View>
          );
        })}
      </Pressable>
      <TextInput
        ref={input}
        aria-label={label}
        value={digits}
        onChangeText={(text) => {
          onChangeText(text.replace(/\D/g, "").slice(0, length));
        }}
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
        }}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={length}
        autoFocus={autoFocus}
        caretHidden
        style={[
          StyleSheet.absoluteFill,
          {
            ...TYPE.body,
            ...(Platform.OS === "web"
              ? ({ fontFamily: WEB_FONT_FAMILY, outlineStyle: "none" } as object)
              : {}),
            // Invisible but present: it receives the keyboard, paste and autofill.
            color: "transparent",
            opacity: 0.01,
          },
        ]}
      />
    </View>
  );
}
