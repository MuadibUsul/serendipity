import { SPACE } from "@serendipity/ui";
import { useState } from "react";
import { View } from "react-native";

import { PRIMER } from "../copy";
import type { NotificationPermissions, NotificationStatus } from "../platform/notifications";
import { AppText } from "../ui/AppText";
import { Button } from "../ui/Button";
import { Card, Screen } from "../ui/Screen";

/**
 * Explains what notifications are for before the system prompt, which can be
 * shown only once. "Later" skips the prompt and keeps it for the Me page.
 */
export function NotificationPrimerScreen({
  notifications,
  onDecided,
}: {
  readonly notifications: NotificationPermissions;
  readonly onDecided: (status: NotificationStatus) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function allow() {
    setBusy(true);
    const status = await notifications.request();
    setBusy(false);
    onDecided(status);
  }

  return (
    <Screen>
      <AppText variant="title" heading>
        {PRIMER.title}
      </AppText>
      <Card>
        <AppText>{PRIMER.body}</AppText>
        <AppText color="textMuted">{PRIMER.privacy}</AppText>
      </Card>
      <View style={{ gap: SPACE.md }}>
        <Button label={PRIMER.allow} disabled={busy} onPress={() => void allow()} />
        <Button
          label={PRIMER.later}
          variant="secondary"
          hint={PRIMER.laterNote}
          disabled={busy}
          onPress={() => {
            onDecided("undetermined");
          }}
        />
      </View>
    </Screen>
  );
}
