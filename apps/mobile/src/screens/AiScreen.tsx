import type { Home } from "../api/types";
import { AI_HEADLINES, AI_PAGE } from "../copy";
import { AppText } from "../ui/AppText";
import { Button } from "../ui/Button";
import { Card, Screen } from "../ui/Screen";

/** The AI page; its headline follows where the person is (PRD-001 §3.1). */
export function AiScreen({ home }: { readonly home: Home }) {
  return (
    <Screen>
      <AppText variant="display" heading>
        {AI_HEADLINES[home.state]}
      </AppText>
      <AppText color="textMuted">{AI_PAGE.intro[home.state]}</AppText>
      {home.state === "new" ? (
        <Card>
          {/* Voice arrives with ser-p02-02; the button is shown, not live. */}
          <Button label={AI_PAGE.startVoice} hint={AI_PAGE.voiceSoon} disabled />
          <AppText variant="caption" color="textMuted">
            {AI_PAGE.voiceSoon}
          </AppText>
        </Card>
      ) : null}
    </Screen>
  );
}
