import { SPACE } from "@serendipity/ui";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { MOCK_CODE } from "../api/mock";
import type { Api, SignInProblem } from "../api/types";
import { APP_NAME, SIGN_IN } from "../copy";
import type { Session } from "../shell/state";
import { AppText } from "../ui/AppText";
import { Button } from "../ui/Button";
import { Glass } from "../ui/Glass";
import { Screen } from "../ui/Screen";
import { TextField } from "../ui/TextField";

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

  const submit = () =>
    run(async () => {
      const result = await api.signIn(phone.trim(), code.trim());
      if (result.ok) onSignedIn(result.session);
      else setProblem(result.problem);
    });

  const changePhone = () => {
    setStep("phone");
    setCode("");
    setProblem(null);
    setWait(0);
  };

  return (
    <Screen withTabBar={false}>
      <View style={{ gap: SPACE.md, paddingTop: SPACE.xxxl }}>
        <AppText variant="footnote" color="accentText">
          {APP_NAME}
        </AppText>
        <AppText variant="largeTitle" heading>
          {SIGN_IN.title}
        </AppText>
        <AppText color="textSecondary">{SIGN_IN.intro}</AppText>
      </View>
      <Glass raised style={{ padding: SPACE.xl, gap: SPACE.xl }}>
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
            <AppText variant="subhead" color="textSecondary" live="polite">
              {SIGN_IN.sentTo(maskPhone(phone.trim()))}
            </AppText>
            <TextField
              label={SIGN_IN.codeLabel}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              maxLength={6}
              autoFocus
            />
            {problem === null ? null : (
              <AppText color="danger" live="assertive">
                {SIGN_IN.problems[problem]}
              </AppText>
            )}
            <Button label={SIGN_IN.submit} disabled={busy} onPress={() => void submit()} />
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              {wait > 0 ? (
                <AppText variant="footnote" color="textSecondary">
                  {SIGN_IN.resendIn(wait)}
                </AppText>
              ) : (
                <Button
                  label={SIGN_IN.resend}
                  variant="plain"
                  disabled={busy}
                  onPress={() => void sendCode()}
                />
              )}
              <Button label={SIGN_IN.changePhone} variant="plain" onPress={changePhone} />
            </View>
          </>
        )}
      </Glass>
      <View style={{ gap: SPACE.sm, paddingHorizontal: SPACE.sm }}>
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
