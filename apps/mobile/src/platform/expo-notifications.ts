// The real permission store, on top of expo-notifications.
import { getPermissionsAsync, requestPermissionsAsync } from "expo-notifications";
import { Platform } from "react-native";

import { safely } from "./notifications";
import type { NotificationPermissions, NotificationStatus } from "./notifications";

const UNAVAILABLE: Promise<NotificationStatus> = Promise.resolve("unavailable");

/** Push notifications are an iOS and Android feature here; a web build reports them unavailable. */
const native = Platform.OS === "ios" || Platform.OS === "android";

export const expoNotificationPermissions: NotificationPermissions = {
  status: () => (native ? safely(getPermissionsAsync) : UNAVAILABLE),
  // Alerts, badge and sound only: no provisional or critical alerts. What a
  // notification may say on a locked screen is decided by whoever sends it
  // (PRD-001 §8.1: never the relationship status or preferences).
  request: () =>
    native
      ? safely(() =>
          requestPermissionsAsync({
            ios: { allowAlert: true, allowBadge: true, allowSound: true },
          }),
        )
      : UNAVAILABLE,
};
