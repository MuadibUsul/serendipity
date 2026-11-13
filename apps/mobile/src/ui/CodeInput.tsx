import { RADIUS, SHADOW, SPACE, TYPE, WEB_FONT_FAMILY } from "@serendipity/ui";
import { useEffect, useRef, useState } from "react";
import type { ComponentRef } from "react";
import { Animated, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";

import { AppText } from "./AppText";
import { useReducedMotion } from "./Breathing";
import { useMaterials, usePalette } from "./theme";

/** A short side-to-side shake, the way a wrong passcode answers on iOS. */
function useShake(trigger: number) {
  const reduced = useReducedMotion();
  const [offset] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (trigger === 0 || reduced) return;
    const step = (toValue: number) =>
      Animated.timing(offset, {
        toValue,
        duration: 55,
        useNativeDriver: Platform.OS !== "web",
      });
    Animated.sequence([step(10), step(-10), step(7), step(-7), step(3), step(0)]).start();
  }, [trigger, reduced, offset]);
  return offset;
}

/** The caret in the active cell, blinking; steady when motion is reduced. */
function Caret() {
  const palette = usePalette();
  const reduced = useReducedMotion();
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduced) return;
    const step = (toValue: number) =>
      Animated.timing(opacity, {
        toValue,
        duration: 0,
        delay: 530,
        useNativeDriver: Platform.OS !== "web",
      });
    const loop = Animated.loop(Animated.sequence([step(0), step(1)]));
    loop.start();
    return () => {
      loop.stop();
    };
  }, [reduced, opacity]);
  return (
    <Animated.View
      style={{ width: 2, minHeight: 26, borderRadius: 1, backgroundColor: palette.focus, opacity }}
    />
  );
}

/**
 * A one-time code as a row of cells (after BoardUI's Input OTP, MIT). One real
 * text field underneath takes typing, paste and SMS autofill in one go and is
 * what screen readers see; the cells only draw it. `onComplete` runs once the
 * last digit is in, so the person never has to press a button.
 */
export function CodeInput({
  label,
  value,
  onChangeText,
  onComplete,
  length = 6,
  shakeKey = 0,
  busy = false,
  autoFocus = false,
  hint,
}: {
  /** Read by screen readers (the visible heading names the step). */
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  /** Called with the whole code when the last digit arrives. */
  readonly onComplete?: (code: string) => void;
  readonly length?: number;
  /** Bump it to shake the cells (a wrong code). */
  readonly shakeKey?: number;
  /** The code is being checked: cells dim and take no input. */
  readonly busy?: boolean;
  readonly autoFocus?: boolean;
  readonly hint?: string;
}) {
  const palette = usePalette();
  const materials = useMaterials();
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [focused, setFocused] = useState(false);
  const offset = useShake(shakeKey);
  const digits = value.replace(/\D/g, "").slice(0, length);
  const active = Math.min(digits.length, length - 1);
  const half = Math.ceil(length / 2);

  // A wrong code comes back cleared: put the person back in the first cell.
  useEffect(() => {
    if (shakeKey > 0) input.current?.focus();
  }, [shakeKey]);

  return (
    <View style={{ gap: SPACE.sm, opacity: busy ? 0.5 : 1 }}>
      <Animated.View style={{ transform: [{ translateX: offset }] }}>
        <Pressable
          aria-hidden
          tabIndex={-1}
          onPress={() => {
            input.current?.focus();
          }}
          style={{ flexDirection: "row", gap: SPACE.sm }}
        >
          {Array.from({ length }, (_, index) => {
            const digit = digits[index];
            const isActive = focused && !busy && index === active && digit === undefined;
            return (
              <View
                key={index}
                style={{
                  flex: 1,
                  minHeight: 60,
                  marginLeft: index === half ? SPACE.sm : 0,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: digit === undefined ? materials.fill : materials.glassRaised,
                  borderRadius: RADIUS.md,
                  borderCurve: "continuous",
                  borderWidth: 1.5,
                  borderColor: isActive ? palette.focus : "transparent",
                  boxShadow: digit === undefined ? "none" : SHADOW.thumb,
                }}
              >
                {digit === undefined ? (
                  isActive ? (
                    <Caret />
                  ) : null
                ) : (
                  <AppText variant="digit">{digit}</AppText>
                )}
              </View>
            );
          })}
        </Pressable>
      </Animated.View>
      <TextInput
        ref={input}
        aria-label={label}
        accessibilityHint={hint}
        value={digits}
        editable={!busy}
        onChangeText={(text) => {
          const next = text.replace(/\D/g, "").slice(0, length);
          onChangeText(next);
          if (next.length === length && digits.length < length) onComplete?.(next);
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
      {hint === undefined ? null : (
        <AppText variant="footnote" color="textSecondary">
          {hint}
        </AppText>
      )}
    </View>
  );
}
