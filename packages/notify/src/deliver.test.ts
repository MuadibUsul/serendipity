import { describe, expect, it } from "vitest";

import { deliverOutbox } from "./deliver.js";
import type { OutboxStore, PendingNotification } from "./deliver.js";
import { createFakePushSender } from "./push.js";

function memory(pending: PendingNotification[]) {
  const log: string[] = [];
  const store: OutboxStore = {
    pending: () => Promise.resolve(pending),
    sent: (id) => {
      log.push(`sent ${id}`);
      return Promise.resolve();
    },
    failed: (id) => {
      log.push(`failed ${id}`);
      return Promise.resolve();
    },
    forgetToken: (token) => {
      log.push(`forget ${token}`);
      return Promise.resolve();
    },
  };
  return { store, log };
}

const note = (id: string, tokens: string[]): PendingNotification => ({
  id,
  title: "Check-in is open",
  body: "Show your code when you arrive.",
  data: { date_id: "d1" },
  tokens,
});

describe("deliverOutbox", () => {
  it("sends to every device of the recipient and marks the notification sent", async () => {
    const sender = createFakePushSender();
    const { store, log } = memory([note("n1", ["phone", "tablet"])]);
    expect(await deliverOutbox(store, sender)).toEqual({
      sent: 1,
      failed: 0,
      noDevice: 0,
      tokensForgotten: 0,
    });
    expect(sender.sent.map((message) => message.token)).toEqual(["phone", "tablet"]);
    expect(log).toEqual(["sent n1"]);
  });

  it("forgets a device that is gone, and counts the notification sent if another got it", async () => {
    const sender = createFakePushSender();
    sender.gone.add("old-phone");
    const { store, log } = memory([note("n1", ["old-phone", "phone"]), note("n2", ["old-phone"])]);
    await deliverOutbox(store, sender);
    expect(log).toEqual(["forget old-phone", "forget old-phone", "sent n1", "failed n2"]);
  });

  it("finishes a notification with no device to reach, rather than retrying it", async () => {
    const sender = createFakePushSender();
    const { store, log } = memory([note("n1", [])]);
    expect((await deliverOutbox(store, sender)).noDevice).toBe(1);
    expect(log).toEqual(["sent n1"]);
    expect(sender.sent).toEqual([]);
  });

  it("marks a failed send for a retry", async () => {
    const { store, log } = memory([note("n1", ["phone"])]);
    const down = { name: "down", send: () => Promise.resolve([{ status: "failed" } as const]) };
    expect((await deliverOutbox(store, down)).failed).toBe(1);
    expect(log).toEqual(["failed n1"]);
  });
});
