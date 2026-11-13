import { SPACE } from "@serendipity/ui";
import { useState } from "react";
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

export function SignInScreen({
  api,
  onSignedIn,
}: {
  readonly api: Api;
  readonly onSignedIn: (session: Session) => void;
}) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [problem, setProblem] = useState<SignInProblem | null>(null);
  const [busy, setBusy] = useState(false);

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
      if (result.ok) setCodeSent(true);
      else setProblem(result.problem);
    });

  const submit = () =>
    run(async () => {
      const result = await api.signIn(phone.trim(), code.trim());
      if (result.ok) onSignedIn(result.session);
      else setProblem(result.problem);
    });

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
        <TextField
          label={SIGN_IN.phoneLabel}
          hint={SIGN_IN.phoneHint}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          maxLength={11}
        />
        <View style={{ gap: SPACE.sm }}>
          <Button
            label={SIGN_IN.sendCode}
            variant="secondary"
            disabled={busy}
            onPress={() => void sendCode()}
          />
          {codeSent ? (
            <AppText variant="footnote" color="textSecondary" live="polite" align="center">
              {SIGN_IN.codeSent}
            </AppText>
          ) : null}
        </View>
        <TextField
          label={SIGN_IN.codeLabel}
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          maxLength={6}
        />
        {problem === null ? null : (
          <AppText color="danger" live="assertive">
            {SIGN_IN.problems[problem]}
          </AppText>
        )}
        <Button label={SIGN_IN.submit} disabled={busy} onPress={() => void submit()} />
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
