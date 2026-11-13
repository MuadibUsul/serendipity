import { RADIUS, SPACE } from "@serendipity/ui";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { MOCK_CODE } from "../api/mock";
import type { Api, SignInProblem } from "../api/types";
import { SIGN_IN } from "../copy";
import type { Session } from "../shell/state";
import { AppText } from "../ui/AppText";
import { BrandMark } from "../ui/BrandMark";
import { Button } from "../ui/Button";
import { CodeInput } from "../ui/CodeInput";
import { Glass } from "../ui/Glass";
import { Screen } from "../ui/Screen";
import { TextField } from "../ui/TextField";
import { usePalette } from "../ui/theme";

/**
 * The three promises (PRD-001 §1), as glass pills floating at slight angles,
 * after the floating labels of the 柔光 design.
 */
function Promises() {
  const palette = usePalette();
  const placements = [
    { left: 4, top: 18, angle: "-3deg" },
    { left: 132, top: 70, angle: "2deg" },
    { right: 8, top: 8, angle: "4deg" },
  ] as const;
  return (
    <View style={{ minHeight: 140, marginTop: SPACE.sm }}>
      {SIGN_IN.promises.map((promise, index) => {
        const { angle, ...position } = placements[index] ?? placements[0];
        return (
          <Glass
            key={promise}
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

/** Seconds before another code may be requested. */
export const RESEND_AFTER_S = 60;

/** 13800000000 → 138****0000: enough to recognise, not to read out. */
export function maskPhone(phone: string): string {
  return phone.length === 11 ? `${phone.slice(0, 3)}****${phone.slice(7)}` : phone;
}

/**
 * Sign-in in two steps, one primary action each: the phone number and
 * "获取验证码", then the code and "登录". The code field appears only once a
 * code has been sent.
 */
export function SignInScreen({
  api,
  onSignedIn,
}: {
  readonly api: Api;
  readonly onSignedIn: (session: Session) => void;
}) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [wait, setWait] = useState(0);
  const [problem, setProblem] = useState<SignInProblem | null>(null);
  const [busy, setBusy] = useState(false);
  const [shakes, setShakes] = useState(0);

  // The resend countdown, one second at a time.
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => {
      setWait((seconds) => seconds - 1);
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [wait]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setProblem(null);
    try {
      await action();
    } catch {
      setProblem("unavailable");
    } finally {
      setBusy(false);
    }
  }

  const sendCode = () =>
    run(async () => {
      const result = await api.requestCode(phone.trim());
      if (result.ok) {
        setStep("code");
        setCode("");
        setWait(RESEND_AFTER_S);
      } else setProblem(result.problem);
    });

  const submit = (entered: string) =>
    run(async () => {
      const result = await api.signIn(phone.trim(), entered);
      if (result.ok) {
        onSignedIn(result.session);
        return;
      }
      setProblem(result.problem);
      if (result.problem === "invalid_code") {
        // Shake, clear, and start again from the first cell.
        setCode("");
        setShakes((n) => n + 1);
      }
    });

  const changePhone = () => {
    setStep("phone");
    setCode("");
    setProblem(null);
    setWait(0);
  };

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
        {step === "phone" ? (
          <>
            <TextField
              label={SIGN_IN.phoneLabel}
              hint={SIGN_IN.phoneHint}
              prefix={SIGN_IN.phonePrefix}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              maxLength={11}
            />
            {problem === null ? null : (
              <AppText color="danger" live="assertive">
                {SIGN_IN.problems[problem]}
              </AppText>
            )}
            <Button label={SIGN_IN.sendCode} disabled={busy} onPress={() => void sendCode()} />
          </>
        ) : (
          <>
            <View style={{ gap: SPACE.xs }}>
              <AppText variant="subtitle">{SIGN_IN.codeTitle}</AppText>
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center" }}>
                <AppText variant="subhead" color="textSecondary" live="polite">
                  {SIGN_IN.sentTo(maskPhone(phone.trim()))}
                </AppText>
                <Button
                  label={SIGN_IN.changePhone}
                  spokenLabel={SIGN_IN.changePhoneSpoken}
                  variant="plain"
                  onPress={changePhone}
                />
              </View>
            </View>
            <CodeInput
              label={SIGN_IN.codeLabel}
              value={code}
              onChangeText={(next) => {
                setCode(next);
                if (problem !== null) setProblem(null);
              }}
              onComplete={(entered) => void submit(entered)}
              shakeKey={shakes}
              busy={busy}
              hint={SIGN_IN.autoVerify}
              autoFocus
            />
            {busy ? (
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
                disabled={busy || wait > 0}
                onPress={() => void sendCode()}
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
