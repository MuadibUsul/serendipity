import { RADIUS, SPACE } from "@serendipity/ui";
import { useState } from "react";
import { View } from "react-native";

import { PRIMER } from "../copy";
import type { NotificationPermissions, NotificationStatus } from "../platform/notifications";
import { AppText } from "../ui/AppText";
import { Button } from "../ui/Button";
import { Glass } from "../ui/Glass";
import { Icon } from "../ui/Icon";
import { Screen } from "../ui/Screen";
import { usePalette } from "../ui/theme";

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
  const palette = usePalette();
  const [busy, setBusy] = useState(false);

  async function allow() {
    setBusy(true);
    const status = await notifications.request();
    setBusy(false);
    onDecided(status);
  }

  return (
    <Screen withTabBar={false}>
      <View style={{ alignItems: "center", gap: SPACE.xl, paddingTop: SPACE.xxxl }}>
        <Glass
          raised
          radius={RADIUS.pill}
          style={{ width: 88, height: 88, alignItems: "center", justifyContent: "center" }}
        >
          <Icon name="bell" color={palette.accentStrong} size={36} />
        </Glass>
        <AppText variant="largeTitle" heading align="center">
          {PRIMER.title}
        </AppText>
        <AppText color="textSecondary" align="center">
          {PRIMER.body}
        </AppText>
      </View>
      <Glass
        style={{ padding: SPACE.lg, flexDirection: "row", gap: SPACE.md, alignItems: "flex-start" }}
      >
        <Icon name="lock" color={palette.textSecondary} size={22} />
        <View style={{ flex: 1 }}>
          <AppText variant="subhead" color="textSecondary">
            {PRIMER.privacy}
          </AppText>
        </View>
      </Glass>
      <View style={{ gap: SPACE.sm }}>
        <Button label={PRIMER.allow} disabled={busy} onPress={() => void allow()} />
        <Button
          label={PRIMER.later}
          variant="plain"
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
