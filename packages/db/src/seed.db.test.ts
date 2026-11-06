import { SCENARIO_NAMES, buildDataset } from "@serendipity/fixtures";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrate } from "./migrations.js";
import { insertWebhookEvent, seedDataset } from "./seed.js";
import { createTestDatabase } from "./test-db.js";
import type { TestDatabase } from "./test-db.js";

const data = buildDataset(42);
let db: TestDatabase;
let client: pg.Client;

beforeAll(async () => {
  db = await createTestDatabase();
  await migrate(db.url, "up");
  client = new pg.Client({ connectionString: db.url });
  await client.connect();
  await seedDataset(client, data);
});

afterAll(async () => {
  await client.end();
  await db.drop();
});

async function count(table: string): Promise<number> {
  const { rows } = await client.query<{ count: string }>(`SELECT count(*) FROM app.${table}`);
  return Number(rows[0]?.count);
}

describe("seeding the fixtures dataset", () => {
  it("loads every row within the schema's constraints", async () => {
    expect({
      users: await count("users"),
      venues: await count("venues"),
      venue_slots: await count("venue_slots"),
      dates: await count("dates"),
      date_invites: await count("date_invites"),
      checkins: await count("checkins"),
      payment_orders: await count("payment_orders"),
      payment_webhook_events: await count("payment_webhook_events"),
      refunds: await count("refunds"),
    }).toEqual({
      users: data.users.length,
      venues: data.venues.length,
      venue_slots: data.venueSlots.length,
      dates: data.dates.length,
      date_invites: data.dateInvites.length,
      checkins: data.checkins.length,
      payment_orders: data.paymentOrders.length,
      payment_webhook_events: data.webhookEvents.length,
      refunds: data.refunds.length,
    });
  });

  it("stores each G3 scenario in its expected date state", async () => {
    const { rows } = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM app.dates`,
    );
    const byId = new Map(rows.map((row) => [row.id, row.status]));
    for (const scenario of data.scenarios) {
      const expected = data.dates.find((date) => date.id === scenario.dateId)?.status;
      expect(byId.get(scenario.dateId), scenario.name).toBe(expected);
    }
    expect(data.scenarios.map((scenario) => scenario.name)).toEqual([...SCENARIO_NAMES]);
  });

  it("refuses the replayed provider callback of the duplicate_webhook scenario", async () => {
    const [replay] = data.replays;
    if (replay === undefined) throw new Error("no replay in the dataset");
    await expect(insertWebhookEvent(client, replay)).rejects.toMatchObject({
      code: "23505",
      constraint: "payment_webhook_events_provider_event_id_key",
    });
  });

  it("places every venue in the fictional box around 0°, 0°", async () => {
    const { rows } = await client.query<{ far: string }>(
      `SELECT count(*) AS far FROM app.venues
       WHERE abs(ST_X(location::geometry)) > 0.05 OR abs(ST_Y(location::geometry)) > 0.05`,
    );
    expect(rows[0]?.far).toBe("0");
  });

  it("refuses to seed a database that already holds users", async () => {
    await expect(seedDataset(client, buildDataset(7))).rejects.toThrow(/not empty/);
  });
});
