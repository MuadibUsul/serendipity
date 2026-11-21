// Push devices and delivering the outbox against the real schema (ADR-0030).
import { MAX_ATTEMPTS, createFakePushSender, deliverOutbox } from "@serendipity/notify";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { migrate } from "./migrations.js";
import { pgPrivacyRepository } from "./privacy.js";
import { pgOutboxStore, pgPushDeviceRepository } from "./push.js";
import { createLoginRole, createTestDatabase, urlFor } from "./test-db.js";
import type { TestDatabase } from "./test-db.js";

const PHONE = "ExponentPushToken[phone-aaaaaaaaaaaa]";
const TABLET = "ExponentPushToken[tablet-bbbbbbbbbbb]";

let db: TestDatabase;
let role: Awaited<ReturnType<typeof createLoginRole>>;
let admin: pg.Pool;
let pool: pg.Pool;

beforeAll(async () => {
  db = await createTestDatabase();
  await migrate(db.url, "up");
  role = await createLoginRole("serendipity_app");
  admin = new pg.Pool({ connectionString: db.url });
  pool = new pg.Pool({ connectionString: urlFor(db.name, role) });
});

beforeEach(async () => {
  await admin.query("DELETE FROM app.notification_outbox");
  await admin.query("DELETE FROM app.push_devices");
});

afterAll(async () => {
  await pool.end();
  await admin.end();
  await db.drop();
  await role.drop();
});

async function person(): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    "INSERT INTO app.users (status) VALUES ('active') RETURNING id",
  );
  return rows[0]?.id ?? "";
}

async function notify(
  userId: string,
  payload: object = { title: "Check-in is open", body: "Show your code.", date_id: "d1" },
) {
  const { rows } = await admin.query<{ id: string }>(
    `INSERT INTO app.notification_outbox (aggregate_type, aggregate_id, kind, recipient_user_id, payload)
     VALUES ('date', gen_random_uuid(), 'date.reminder.checkin_open', $1, $2) RETURNING id`,
    [userId, JSON.stringify(payload)],
  );
  return rows[0]?.id ?? "";
}

const outbox = async (id: string) =>
  (
    await admin.query<{ dispatched: boolean; attempts: number }>(
      "SELECT dispatched_at IS NOT NULL AS dispatched, attempts FROM app.notification_outbox WHERE id = $1",
      [id],
    )
  ).rows[0];

describe("push devices", () => {
  it("registers a token once, and moves it to whoever signs in on that phone next", async () => {
    const devices = pgPushDeviceRepository(pool);
    const [ana, bo] = [await person(), await person()];
    await devices.register(ana, PHONE, "ios");
    await devices.register(ana, PHONE, "ios");
    await devices.register(bo, PHONE, "ios");
    const { rows } = await admin.query("SELECT user_id FROM app.push_devices WHERE token = $1", [
      PHONE,
    ]);
    expect(rows).toEqual([{ user_id: bo }]);
    expect(await devices.unregister(ana, PHONE)).toBe(false);
    expect(await devices.unregister(bo, PHONE)).toBe(true);
  });

  it("never writes the token into the audit", async () => {
    const ana = await person();
    await pgPushDeviceRepository(pool).register(ana, PHONE, "android");
    const audit = await admin.query<{ text: string }>(
      "SELECT metadata_redacted::text AS text FROM app.audit_events WHERE object_id = $1",
      [ana],
    );
    expect(audit.rows.map((row) => row.text).join(" ")).not.toContain("phone-aaaa");
  });

  it("goes with the account", async () => {
    const ana = await person();
    await pgPushDeviceRepository(pool).register(ana, PHONE, "ios");
    const privacy = pgPrivacyRepository(pool);
    await privacy.requestDeletion(ana);
    await privacy.claimDeletion(ana);
    await privacy.finalizeDeletion(ana);
    const left = await admin.query("SELECT 1 FROM app.push_devices WHERE user_id = $1", [ana]);
    expect(left.rowCount).toBe(0);
  });
});

describe("delivering the outbox", () => {
  it("sends to each of the recipient's devices and marks the notification sent", async () => {
    const ana = await person();
    const devices = pgPushDeviceRepository(pool);
    await devices.register(ana, PHONE, "ios");
    await devices.register(ana, TABLET, "ios");
    const id = await notify(ana);
    const sender = createFakePushSender();
    expect(await deliverOutbox(pgOutboxStore(pool), sender)).toMatchObject({ sent: 1 });
    expect(sender.sent.map((message) => message.token).sort()).toEqual([PHONE, TABLET].sort());
    expect(sender.sent[0]).toMatchObject({ title: "Check-in is open", data: { date_id: "d1" } });
    expect(await outbox(id)).toEqual({ dispatched: true, attempts: 1 });
    // Sent once only.
    await deliverOutbox(pgOutboxStore(pool), sender);
    expect(sender.sent).toHaveLength(2);
  });

  it("forgets a device the push service no longer knows", async () => {
    const ana = await person();
    await pgPushDeviceRepository(pool).register(ana, PHONE, "ios");
    await notify(ana);
    const sender = createFakePushSender();
    sender.gone.add(PHONE);
    await deliverOutbox(pgOutboxStore(pool), sender);
    const left = await admin.query("SELECT 1 FROM app.push_devices WHERE token = $1", [PHONE]);
    expect(left.rowCount).toBe(0);
  });

  it(`retries a failure, and gives up after ${String(MAX_ATTEMPTS)} tries`, async () => {
    const ana = await person();
    await pgPushDeviceRepository(pool).register(ana, PHONE, "ios");
    const id = await notify(ana);
    const down = { name: "down", send: () => Promise.resolve([{ status: "failed" } as const]) };
    for (let run = 0; run < MAX_ATTEMPTS + 2; run += 1)
      await deliverOutbox(pgOutboxStore(pool), down);
    expect(await outbox(id)).toEqual({ dispatched: false, attempts: MAX_ATTEMPTS });
  });

  it("does not push a notification without a title", async () => {
    const ana = await person();
    await pgPushDeviceRepository(pool).register(ana, PHONE, "ios");
    const id = await notify(ana, { date_id: "d1" });
    const sender = createFakePushSender();
    await deliverOutbox(pgOutboxStore(pool), sender);
    expect(sender.sent).toEqual([]);
    expect(await outbox(id)).toEqual({ dispatched: false, attempts: 0 });
  });
});
