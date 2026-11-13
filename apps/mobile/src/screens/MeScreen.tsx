import { SPACE } from "@serendipity/ui";
import { View } from "react-native";

import type { Me } from "../api/types";
import { ME_PAGE } from "../copy";
import type { NotificationStatus } from "../platform/notifications";
import { Button } from "../ui/Button";
import { Group, Row, Screen } from "../ui/Screen";
import { SwitchRow } from "../ui/SwitchRow";

/** Settings as two grouped glass lists (iOS style), not a stack of separate cards. */
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
    <Screen title={ME_PAGE.title}>
      <Group title={ME_PAGE.account}>
        <Row label={ME_PAGE.verification} value={ME_PAGE.verificationStatus[me.verification]} />
        <Row label={ME_PAGE.notifications} value={ME_PAGE.notificationStatus[notificationStatus]} />
        {notificationStatus === "undetermined" ? (
          <Button
            label={ME_PAGE.enableNotifications}
            variant="plain"
            onPress={onEnableNotifications}
          />
        ) : null}
        {notificationStatus === "denied" ? (
          <Button label={ME_PAGE.openSettings} variant="plain" onPress={onOpenSettings} />
        ) : null}
        <Row label={ME_PAGE.privacy} value={ME_PAGE.privacySoon} />
      </Group>
      <Group title={ME_PAGE.matching} footer={ME_PAGE.pauseHint}>
        <SwitchRow
          label={ME_PAGE.pauseMatching}
          value={me.matchingPaused}
          onValueChange={onPauseChange}
        />
      </Group>
      <View style={{ paddingTop: SPACE.sm }}>
        <Button label={ME_PAGE.signOut} variant="danger" onPress={onSignOut} />
      </View>
    </Screen>
  );
}
