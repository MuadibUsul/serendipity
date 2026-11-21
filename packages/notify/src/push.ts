/**
 * Push notifications (ADR-0030). The app registers its Expo push token;
 * queued notifications (app.notification_outbox) are delivered to every live
 * device of their recipient.
 *
 * - A message carries only a title, a body and the date id to open. It never
 *   carries the other person's name or anything about them.
 * - A token the push service says is no longer registered is forgotten.
 * - A failure is retried on the next run, up to `MAX_ATTEMPTS`; after that
 *   the notification is given up on, never sent late into the night.
 */

/** Expo push tokens, as the app's `getExpoPushTokenAsync` returns them. */
const TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,200}\]$/;

export const isPushToken = (value: unknown): value is string =>
  typeof value === "string" && TOKEN.test(value);

export const PLATFORMS = ["ios", "android"] as const;
export type Platform = (typeof PLATFORMS)[number];

/** Tries before a notification is given up on. */
export const MAX_ATTEMPTS = 5;

export interface PushMessage {
  readonly token: string;
  readonly title: string;
  readonly body: string;
  /** What the app opens when the notification is tapped. */
  readonly data: Readonly<Record<string, string>>;
}

export type PushResult =
  | { readonly status: "sent" }
  /** The device is gone: forget the token. */
  | { readonly status: "unregistered" }
  /** Try again later. */
  | { readonly status: "failed" };

export interface PushSender {
  readonly name: string;
  /** One result per message, in order. */
  send(messages: readonly PushMessage[]): Promise<readonly PushResult[]>;
}

/** Records what would be sent: dev and test. */
export interface FakePushSender extends PushSender {
  readonly sent: PushMessage[];
  /** Tokens the fake treats as unregistered. */
  readonly gone: Set<string>;
}

export function createFakePushSender(): FakePushSender {
  const sent: PushMessage[] = [];
  const gone = new Set<string>();
  return {
    name: "fake",
    sent,
    gone,
    send(messages) {
      return Promise.resolve(
        messages.map((message) => {
          if (gone.has(message.token)) return { status: "unregistered" } as const;
          sent.push(message);
          return { status: "sent" } as const;
        }),
      );
    },
  };
}

const EXPO_URL = "https://exp.host/--/api/v2/push/send";
/** Expo takes at most 100 messages a request. */
const EXPO_BATCH = 100;

type Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The Expo push service. `accessToken` is needed only with Expo's enhanced push security. */
export function createExpoPushSender(
  options: { readonly fetch?: Fetch; readonly accessToken?: string } = {},
): PushSender {
  const post: Fetch = options.fetch ?? ((url, init) => fetch(url, init));
  return {
    name: "expo",
    async send(messages) {
      const results: PushResult[] = [];
      for (let start = 0; start < messages.length; start += EXPO_BATCH) {
        const batch = messages.slice(start, start + EXPO_BATCH);
        results.push(...(await sendBatch(post, batch, options.accessToken)));
      }
      return results;
    },
  };
}

async function sendBatch(
  post: Fetch,
  batch: readonly PushMessage[],
  accessToken: string | undefined,
): Promise<PushResult[]> {
  const failed = (): PushResult[] => batch.map(() => ({ status: "failed" }));
  let body: unknown;
  try {
    const response = await post(EXPO_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(accessToken === undefined ? {} : { authorization: `Bearer ${accessToken}` }),
      },
      body: JSON.stringify(
        batch.map((message) => ({
          to: message.token,
          title: message.title,
          body: message.body,
          data: message.data,
          sound: "default",
        })),
      ),
    });
    if (!response.ok) return failed();
    body = await response.json();
  } catch {
    return failed();
  }
  const tickets = isRecord(body) && Array.isArray(body["data"]) ? body["data"] : null;
  if (tickets?.length !== batch.length) return failed();
  return tickets.map((ticket): PushResult => {
    if (!isRecord(ticket)) return { status: "failed" };
    if (ticket["status"] === "ok") return { status: "sent" };
    const details = ticket["details"];
    return isRecord(details) && details["error"] === "DeviceNotRegistered"
      ? { status: "unregistered" }
      : { status: "failed" };
  });
}
