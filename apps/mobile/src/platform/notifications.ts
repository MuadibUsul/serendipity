/**
 * Notification permission, behind an interface so the shell can be tested
 * without a device. Any failure reads as `unavailable`: the app carries on
 * without notifications, it never blocks on them.
 */
export type NotificationStatus =
  /** Never asked: the system prompt can still be shown. */
  | "undetermined"
  | "granted"
  /** Refused; only the system settings can change it now. */
  | "denied"
  /** Not supported here, or the check failed. */
  | "unavailable";

export interface NotificationPermissions {
  status(): Promise<NotificationStatus>;
  /** Shows the system prompt when it still can; otherwise reports the status. */
  request(): Promise<NotificationStatus>;
}

/** The fields of an Expo permission response this app reads. */
export interface PermissionResponseLike {
  readonly granted: boolean;
  readonly canAskAgain: boolean;
  readonly status: string;
}

export function statusFrom(response: PermissionResponseLike): NotificationStatus {
  if (response.granted) return "granted";
  if (response.status === "undetermined" && response.canAskAgain) return "undetermined";
  return "denied";
}

/** Runs a permission call, turning any error into `unavailable`. */
export async function safely(
  call: () => Promise<PermissionResponseLike>,
): Promise<NotificationStatus> {
  try {
    return statusFrom(await call());
  } catch {
    return "unavailable";
  }
}

/** A permission store for tests and previews: answers the prompt with `answer`. */
export function createFakePermissions(
  initial: NotificationStatus,
  answer: "granted" | "denied" = "granted",
): NotificationPermissions & { readonly requests: () => number } {
  let current = initial;
  let requests = 0;
  return {
    status: () => Promise.resolve(current),
    request: () => {
      requests += 1;
      if (current === "undetermined") current = answer;
      return Promise.resolve(current);
    },
    requests: () => requests,
  };
}
