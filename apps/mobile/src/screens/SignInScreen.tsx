import { RADIUS, SPACE } from "@serendipity/ui";
import { useEffect, useReducer, useRef } from "react";
import { View } from "react-native";

import { MOCK_CODE } from "../api/mock";
import type { Api } from "../api/types";
import { SIGN_IN } from "../copy";
import { INITIAL_SIGN_IN, canSend, reduceSignIn } from "../shell/sign-in";
import type { Session } from "../shell/state";
import { AppText } from "../ui/AppText";
import { BrandMark } from "../ui/BrandMark";
import { Button } from "../ui/Button";
import { CodeInput } from "../ui/CodeInput";
import { Glass } from "../ui/Glass";
import { Screen } from "../ui/Screen";
import { TextField } from "../ui/TextField";
import { useMaterials, usePalette } from "../ui/theme";

/**
 * The three promises (PRD-001 §1), as glass pills floating at slight angles,
 * each in its own tint, after the 剧集版 sign-in draft.
 */
function Promises() {
  const palette = usePalette();
  const materials = useMaterials();
  const placements = [
    { left: 4, top: 18, angle: "-3deg", tint: materials.tintMint },
    { left: 132, top: 70, angle: "2deg", tint: materials.tintPeach },
    { right: 8, top: 8, angle: "4deg", tint: materials.tintBlush },
  ] as const;
  return (
    <View style={{ minHeight: 140, marginTop: SPACE.sm }}>
      {SIGN_IN.promises.map((promise, index) => {
        const { angle, tint, ...position } = placements[index] ?? placements[0];
        return (
          <Glass
            key={promise}
            tint={tint}
            radius={RADIUS.pill}
            style={{
              position: "absolute",
              ...position,
              paddingHorizontal: SPACE.lg,
              paddingVertical: SPACE.sm,
              flexDirection: "row",
              alignItems: "center",
              gap: SPACE.sm,
              transform: [{ rotate: angle }],
            }}
          >
            {index === 2 ? (
              <View
                aria-hidden
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 4,
                  backgroundColor: palette.accent,
                  boxShadow: "0px 0px 10px rgba(255,107,129,0.7)",
                }}
              />
            ) : null}
            <AppText variant="subhead">{promise}</AppText>
          </Glass>
        );
      })}
    </View>
  );
}

export { RESEND_AFTER_S } from "../shell/sign-in";

/** 4155550123 → (415) •••-0123: enough to recognise, not to read out. */
export function maskPhone(phone: string): string {
  return phone.length === 10 ? `(${phone.slice(0, 3)}) •••-${phone.slice(6)}` : phone;
}

/**
 * Sign-in in two steps, one primary action each: the phone number and
 * "Text me a code", then the code and "Sign in". The code field appears only once a
 * code has been sent.
 */
export function SignInScreen({
  api,
  onSignedIn,
}: {
  readonly api: Api;
  readonly onSignedIn: (session: Session) => void;
}) {
  const [state, dispatch] = useReducer(reduceSignIn, INITIAL_SIGN_IN);

  // The resend countdown, one second at a time.
  const wait = state.step === "code" ? state.wait : 0;
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => {
      dispatch({ type: "tick" });
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [wait]);

  // Signed in: hand over once.
  const handedOver = useRef(false);
  useEffect(() => {
    if (state.step === "signed_in" && !handedOver.current) {
      handedOver.current = true;
      onSignedIn(state.session);
    }
  }, [state, onSignedIn]);

  const phone = state.step === "signed_in" ? "" : state.phone.trim();

  const sendCode = () => {
    if (!canSend(state)) return;
    const attempt = state.attempt + 1;
    dispatch({ type: "send_requested" });
    api.requestCode(phone).then(
      (result) => {
        dispatch(
          result.ok
            ? { type: "code_sent", attempt }
            : { type: "refused", attempt, problem: result.problem },
        );
      },
      () => {
        dispatch({ type: "failed", attempt });
      },
    );
  };

  const submit = (entered: string) => {
    if (state.step !== "code" || state.pending !== null) return;
    const attempt = state.attempt + 1;
    dispatch({ type: "verify_requested" });
    api.signIn(phone, entered).then(
      (result) => {
        dispatch(
          result.ok
            ? { type: "signed_in", attempt, session: result.session }
            : { type: "refused", attempt, problem: result.problem },
        );
      },
      () => {
        dispatch({ type: "failed", attempt });
      },
    );
  };

  const busy = state.step !== "signed_in" && state.pending !== null;
  const problem = state.step === "signed_in" ? null : state.problem;

  return (
    <Screen withTabBar={false} ambient="signIn" fill>
      <View style={{ paddingTop: SPACE.xxl }}>
        <BrandMark />
      </View>
      <View style={{ gap: SPACE.md, paddingTop: SPACE.xxxl }}>
        <AppText variant="hero" heading>
          {SIGN_IN.title}
        </AppText>
        <AppText variant="subhead" color="textSecondary">
          {SIGN_IN.intro}
        </AppText>
      </View>
      <Promises />
      <Glass
        raised
        radius={RADIUS.xl}
        style={{ marginTop: "auto", padding: SPACE.xxl, gap: SPACE.lg }}
      >
        {state.step !== "code" ? (
          <>
            <TextField
              label={SIGN_IN.phoneLabel}
              hint={SIGN_IN.phoneHint}
              prefix={SIGN_IN.phonePrefix}
              value={state.step === "phone" ? state.phone : ""}
              onChangeText={(next) => {
                dispatch({ type: "phone_edited", phone: next });
              }}
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              maxLength={10}
            />
            {problem === null ? null : (
              <AppText color="danger" live="assertive">
                {SIGN_IN.problems[problem]}
              </AppText>
            )}
            <Button label={SIGN_IN.sendCode} disabled={busy} onPress={sendCode} />
          </>
        ) : (
          <>
            <View style={{ gap: SPACE.xs }}>
              <AppText variant="subtitle">{SIGN_IN.codeTitle}</AppText>
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center" }}>
                <AppText variant="subhead" color="textSecondary" live="polite">
                  {SIGN_IN.sentTo(maskPhone(phone))}
                </AppText>
                <Button
                  label={SIGN_IN.changePhone}
                  spokenLabel={SIGN_IN.changePhoneSpoken}
                  variant="plain"
                  onPress={() => {
                    dispatch({ type: "change_phone" });
                  }}
                />
              </View>
            </View>
            <CodeInput
              label={SIGN_IN.codeLabel}
              value={state.code}
              onChangeText={(next) => {
                dispatch({ type: "code_edited", code: next });
              }}
              onComplete={submit}
              shakeKey={state.shakes}
              busy={busy}
              hint={SIGN_IN.autoVerify}
              autoFocus
            />
            {state.pending === "verifying" ? (
              <AppText variant="footnote" color="textSecondary" live="polite">
                {SIGN_IN.verifying}
              </AppText>
            ) : problem === null ? null : (
              <AppText color="danger" live="assertive">
                {SIGN_IN.problems[problem]}
              </AppText>
            )}
            <View style={{ alignItems: "flex-start" }}>
              <Button
                label={wait > 0 ? SIGN_IN.resendIn(wait) : SIGN_IN.resend}
                variant="plain"
                disabled={!canSend(state)}
                onPress={sendCode}
              />
            </View>
          </>
        )}
      </Glass>
      <View style={{ gap: SPACE.xs, paddingHorizontal: SPACE.sm }}>
        <AppText variant="footnote" color="textSecondary" align="center">
          {SIGN_IN.adultsOnly}
        </AppText>
        <AppText variant="footnote" color="textSecondary" align="center">
          {SIGN_IN.mockNote(MOCK_CODE)}
        </AppText>
      </View>
    </Screen>
  );
}
