import { SPACE } from "@serendipity/ui";
import { View } from "react-native";

import type { Me } from "../api/types";
import { ME_PAGE } from "../copy";
import type { NotificationStatus } from "../platform/notifications";
import { AppText } from "../ui/AppText";
import { Button } from "../ui/Button";
import { Card, Field, Screen } from "../ui/Screen";
import { SwitchRow } from "../ui/SwitchRow";

export function MeScreen({
  me,
  notificationStatus,
  onEnableNotifications,
  onOpenSettings,
  onPauseChange,
  onSignOut,
}: {
  readonly me: Me;
  readonly notificationStatus: NotificationStatus;
  readonly onEnableNotifications: () => void;
  readonly onOpenSettings: () => void;
  readonly onPauseChange: (paused: boolean) => void;
  readonly onSignOut: () => void;
}) {
  return (
    <Screen>
      <AppText variant="title" heading>
        {ME_PAGE.title}
      </AppText>
      <Card>
        <Field label={ME_PAGE.verification} value={ME_PAGE.verificationStatus[me.verification]} />
      </Card>
      <Card>
        <Field
          label={ME_PAGE.notifications}
          value={ME_PAGE.notificationStatus[notificationStatus]}
        />
        {notificationStatus === "undetermined" ? (
          <Button label={ME_PAGE.enableNotifications} onPress={onEnableNotifications} />
        ) : null}
        {notificationStatus === "denied" ? (
          <Button label={ME_PAGE.openSettings} variant="secondary" onPress={onOpenSettings} />
        ) : null}
      </Card>
      <Card>
        <SwitchRow
          label={ME_PAGE.pauseMatching}
          hint={ME_PAGE.pauseHint}
          value={me.matchingPaused}
          onValueChange={onPauseChange}
        />
      </Card>
      <Card>
        <Field label={ME_PAGE.privacy} value={ME_PAGE.privacySoon} />
      </Card>
      <View style={{ gap: SPACE.md }}>
        <Button label={ME_PAGE.signOut} variant="secondary" onPress={onSignOut} />
      </View>
    </Screen>
  );
}
