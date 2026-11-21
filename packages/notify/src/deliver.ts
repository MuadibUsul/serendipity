/**
 * Delivering the outbox (ADR-0030): each pending notification goes to every
 * live device of its recipient, in one call to the sender.
 */
import { MAX_ATTEMPTS } from "./push.js";
import type { PushMessage, PushSender } from "./push.js";

export interface PendingNotification {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly data: Readonly<Record<string, string>>;
  /** The recipient's live device tokens. */
  readonly tokens: readonly string[];
}

export interface OutboxStore {
  /** Notifications not yet sent, with fewer than `MAX_ATTEMPTS` tries. */
  pending(limit: number, maxAttempts: number): Promise<readonly PendingNotification[]>;
  /** Reached at least one device, or there is no device to reach. */
  sent(id: string): Promise<void>;
  failed(id: string): Promise<void>;
  /** The push service says this device is gone. */
  forgetToken(token: string): Promise<void>;
}

export interface DeliveryReport {
  readonly sent: number;
  readonly failed: number;
  readonly noDevice: number;
  readonly tokensForgotten: number;
}

export async function deliverOutbox(
  store: OutboxStore,
  sender: PushSender,
  limit = 200,
): Promise<DeliveryReport> {
  const pending = await store.pending(limit, MAX_ATTEMPTS);
  const messages: { notification: string; message: PushMessage }[] = [];
  let noDevice = 0;
  for (const notification of pending) {
    if (notification.tokens.length === 0) {
      // Nobody to tell: done, rather than retried until it is stale.
      await store.sent(notification.id);
      noDevice += 1;
      continue;
    }
    for (const token of notification.tokens) {
      messages.push({
        notification: notification.id,
        message: {
          token,
          title: notification.title,
          body: notification.body,
          data: notification.data,
        },
      });
    }
  }
  const results = await sender.send(messages.map((entry) => entry.message));
  const reached = new Set<string>();
  const attempted = new Set<string>();
  let tokensForgotten = 0;
  for (const [index, entry] of messages.entries()) {
    attempted.add(entry.notification);
    const result = results[index] ?? { status: "failed" };
    if (result.status === "sent") reached.add(entry.notification);
    if (result.status === "unregistered") {
      await store.forgetToken(entry.message.token);
      tokensForgotten += 1;
    }
  }
  let sent = 0;
  let failed = 0;
  for (const id of attempted) {
    if (reached.has(id)) {
      await store.sent(id);
      sent += 1;
    } else {
      await store.failed(id);
      failed += 1;
    }
  }
  return { sent, failed, noDevice, tokensForgotten };
}
