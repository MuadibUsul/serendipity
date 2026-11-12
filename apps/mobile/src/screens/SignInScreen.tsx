import { SPACE } from "@serendipity/ui";
import { useState } from "react";
import { View } from "react-native";

import { MOCK_CODE } from "../api/mock";
import type { Api, SignInProblem } from "../api/types";
import { SIGN_IN } from "../copy";
import type { Session } from "../shell/state";
import { AppText } from "../ui/AppText";
import { Button } from "../ui/Button";
import { Card, Screen } from "../ui/Screen";
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
    <Screen>
      <View style={{ gap: SPACE.sm }}>
        <AppText variant="display" heading>
          {SIGN_IN.title}
        </AppText>
        <AppText color="textMuted">{SIGN_IN.intro}</AppText>
      </View>
      <Card>
        <TextField
          label={SIGN_IN.phoneLabel}
          hint={SIGN_IN.phoneHint}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          maxLength={11}
        />
        <Button
          label={SIGN_IN.sendCode}
          variant="secondary"
          disabled={busy}
          onPress={() => void sendCode()}
        />
        {codeSent ? (
          <AppText variant="caption" color="textMuted" live="polite">
            {SIGN_IN.codeSent}
          </AppText>
        ) : null}
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
      </Card>
      <AppText variant="caption" color="textMuted">
        {SIGN_IN.adultsOnly}
      </AppText>
      <AppText variant="caption" color="textMuted">
        {SIGN_IN.mockNote(MOCK_CODE)}
      </AppText>
    </Screen>
  );
}
