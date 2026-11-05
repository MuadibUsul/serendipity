import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { migrate } from "./migrations.js";
import { createTestDatabase } from "./test-db.js";
import type { TestDatabase } from "./test-db.js";

let db: TestDatabase;
let client: pg.Client;

beforeAll(async () => {
  db = await createTestDatabase();
  await migrate(db.url, "up");
  client = new pg.Client({ connectionString: db.url });
  await client.connect();
});

afterAll(async () => {
  await client.end();
  await db.drop();
});

// Every test runs in a transaction that is rolled back, so tests never see
// each other's rows. A failing statement is isolated with a savepoint.
beforeEach(async () => {
  await client.query("BEGIN");
  return async () => {
    await client.query("ROLLBACK");
  };
});

async function rows<Row extends pg.QueryResultRow>(sql: string, values: unknown[] = []) {
  return (await client.query<Row>(sql, values)).rows;
}

async function one<Row extends pg.QueryResultRow>(sql: string, values: unknown[] = []) {
  const [row] = await rows<Row>(sql, values);
  if (row === undefined) throw new Error(`no row from: ${sql}`);
  return row;
}

/** Runs `sql` inside a savepoint and returns the PostgreSQL error it raised, if any. */
async function attempt(
  sql: string,
  values: unknown[] = [],
): Promise<{ code?: string; constraint?: string } | null> {
  await client.query("SAVEPOINT attempt");
  try {
    await client.query(sql, values);
    await client.query("RELEASE SAVEPOINT attempt");
    return null;
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT attempt");
    return error as { code?: string; constraint?: string };
  }
}

const UNIQUE = "23505";
const CHECK = "23514";
const EXCLUSION = "23P01";

async function user(): Promise<string> {
  return (
    await one<{ id: string }>(`INSERT INTO app.users (status) VALUES ('active') RETURNING id`)
  ).id;
}

async function date(
  userA: string,
  userB: string,
  status: string,
  start: string | null,
  end: string | null,
  bookingRef: string | null = null,
): Promise<string> {
  return (
    await one<{ id: string }>(
      `INSERT INTO app.dates (user_a, user_b, status, start_at, end_at, booking_ref)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [userA, userB, status, start, end, bookingRef],
    )
  ).id;
}

const insertDate = (a: string, b: string, status: string, start: string, end: string) =>
  attempt(
    `INSERT INTO app.dates (user_a, user_b, status, start_at, end_at) VALUES ($1, $2, $3, $4, $5)`,
    [a, b, status, start, end],
  );

describe("unique constraints (PLAN-001 §8.2)", () => {
  it("stores a payment provider callback once per provider and event id", async () => {
    const insert = (provider: string, eventId: string) =>
      attempt(
        `INSERT INTO app.payment_webhook_events (provider, event_id, event_type, signature_valid)
         VALUES ($1, $2, 'payment.succeeded', true)`,
        [provider, eventId],
      );
    expect(await insert("acme-pay", "evt_1")).toBeNull();
    expect(await insert("acme-pay", "evt_1")).toMatchObject({
      code: UNIQUE,
      constraint: "payment_webhook_events_provider_event_id_key",
    });
    expect(await insert("other-pay", "evt_1")).toBeNull();
  });

  it("refuses a second payment order with the same idempotency key", async () => {
    const [a, b] = [await user(), await user()];
    const dateId = await date(a, b, "PAYMENT_PENDING", "2026-11-07 11:00Z", "2026-11-07 13:00Z");
    const order = (userId: string, key: string) =>
      attempt(
        `INSERT INTO app.payment_orders (date_id, user_id, amount_minor, currency, provider, idempotency_key)
         VALUES ($1, $2, 8800, 'CNY', 'acme-pay', $3)`,
        [dateId, userId, key],
      );
    expect(await order(a, "key-a-1")).toBeNull();
    expect(await order(b, "key-a-1")).toMatchObject({
      code: UNIQUE,
      constraint: "payment_orders_idempotency_key_key",
    });
  });

  it("allows one live payment order per person and date; a retry only after a failure", async () => {
    const [a, b] = [await user(), await user()];
    const dateId = await date(a, b, "PAYMENT_PENDING", "2026-11-07 11:00Z", "2026-11-07 13:00Z");
    const order = (key: string) =>
      attempt(
        `INSERT INTO app.payment_orders (date_id, user_id, amount_minor, currency, provider, idempotency_key)
         VALUES ($1, $2, 8800, 'CNY', 'acme-pay', $3)`,
        [dateId, a, key],
      );
    expect(await order("first")).toBeNull();
    expect(await order("second")).toMatchObject({
      code: UNIQUE,
      constraint: "payment_orders_one_live_idx",
    });
    await client.query(
      `UPDATE app.payment_orders SET state = 'FAILED' WHERE idempotency_key = 'first'`,
    );
    expect(await order("second")).toBeNull();
  });

  it("refuses a duplicate booking reference, and allows many dates without one", async () => {
    const [a, b, c, d] = [await user(), await user(), await user(), await user()];
    await date(a, b, "INVITED", null, null, "BK-1");
    expect(
      await attempt(`INSERT INTO app.dates (user_a, user_b, booking_ref) VALUES ($1, $2, 'BK-1')`, [
        c,
        d,
      ]),
    ).toMatchObject({ code: UNIQUE, constraint: "dates_booking_ref_key" });
    expect(
      await attempt(`INSERT INTO app.dates (user_a, user_b) VALUES ($1, $2)`, [c, d]),
    ).toBeNull();
    expect(
      await attempt(`INSERT INTO app.dates (user_a, user_b) VALUES ($1, $2)`, [c, d]),
    ).toBeNull();
  });

  it("keeps one candidate pair per two people and retrieval version, in canonical order", async () => {
    const [x, y] = [await user(), await user()].sort();
    const pair = (a: string | undefined, b: string | undefined, version: string) =>
      attempt(
        `INSERT INTO app.candidate_pairs
           (user_a, user_b, policy_version_a, policy_version_b, safety_eligibility, retrieval_version, expires_at)
         VALUES ($1, $2, 1, 1, 'eligible', $3, now() + interval '1 day')`,
        [a, b, version],
      );
    expect(await pair(x, y, "r1")).toBeNull();
    expect(await pair(x, y, "r1")).toMatchObject({
      code: UNIQUE,
      constraint: "candidate_pairs_user_a_user_b_retrieval_version_key",
    });
    expect(await pair(y, x, "r1")).toMatchObject({
      code: CHECK,
      constraint: "candidate_pairs_ordered_check",
    });
    expect(await pair(x, y, "r2")).toBeNull();
  });
});

describe("one date at a time per person (ARCH-001 §8.3)", () => {
  it("refuses an overlapping confirmed date, whichever side the person is on", async () => {
    const [x, p, q] = [await user(), await user(), await user()];
    await date(x, p, "CONFIRMED", "2026-11-07 11:00Z", "2026-11-07 13:00Z");
    expect(
      await insertDate(q, x, "CONFIRMED", "2026-11-07 12:00Z", "2026-11-07 14:00Z"),
    ).toMatchObject({
      code: EXCLUSION,
      constraint: "date_participants_no_overlap",
    });
  });

  it("allows back-to-back dates and other people's overlapping dates", async () => {
    const [x, p, q, r] = [await user(), await user(), await user(), await user()];
    await date(x, p, "CONFIRMED", "2026-11-07 11:00Z", "2026-11-07 13:00Z");
    expect(
      await insertDate(x, q, "CONFIRMED", "2026-11-07 13:00Z", "2026-11-07 15:00Z"),
    ).toBeNull();
    expect(
      await insertDate(q, r, "CONFIRMED", "2026-11-07 11:30Z", "2026-11-07 12:30Z"),
    ).toBeNull();
  });

  it("does not hold time for invitations, expired or cancelled dates", async () => {
    const [x, p, q] = [await user(), await user(), await user()];
    await date(x, p, "CONFIRMED", "2026-11-07 11:00Z", "2026-11-07 13:00Z");
    for (const status of [
      "INVITED",
      "EXPIRED",
      "CANCELLED_BEFORE_PAYMENT",
      "CANCELLED_REFUND_PENDING",
    ]) {
      expect(
        await insertDate(x, q, status, "2026-11-07 12:00Z", "2026-11-07 14:00Z"),
        status,
      ).toBeNull();
    }
  });

  it("refuses moving an overlapping invitation into a state that holds time", async () => {
    const [x, p, q] = [await user(), await user(), await user()];
    await date(x, p, "CONFIRMED", "2026-11-07 11:00Z", "2026-11-07 13:00Z");
    const invited = await date(x, q, "INVITED", "2026-11-07 12:00Z", "2026-11-07 14:00Z");
    expect(
      await attempt(`UPDATE app.dates SET status = 'BOTH_ACCEPTED' WHERE id = $1`, [invited]),
    ).toMatchObject({ code: EXCLUSION, constraint: "date_participants_no_overlap" });
  });

  it("frees the time when a date is cancelled", async () => {
    const [x, p, q] = [await user(), await user(), await user()];
    const first = await date(x, p, "CONFIRMED", "2026-11-07 11:00Z", "2026-11-07 13:00Z");
    const second = await date(x, q, "INVITED", "2026-11-07 12:00Z", "2026-11-07 14:00Z");
    await client.query(`UPDATE app.dates SET status = 'CANCELLED_REFUND_PENDING' WHERE id = $1`, [
      first,
    ]);
    expect(
      await attempt(`UPDATE app.dates SET status = 'CONFIRMED' WHERE id = $1`, [second]),
    ).toBeNull();
  });

  it("refuses a state that holds time without a time window", async () => {
    const [x, p] = [await user(), await user()];
    expect(
      await attempt(`INSERT INTO app.dates (user_a, user_b, status) VALUES ($1, $2, 'CONFIRMED')`, [
        x,
        p,
      ]),
    ).toMatchObject({ code: CHECK, constraint: "dates_time_held_check" });
  });

  it("refuses a date with oneself or an inverted time window", async () => {
    const x = await user();
    expect(
      await attempt(`INSERT INTO app.dates (user_a, user_b) VALUES ($1, $1)`, [x]),
    ).toMatchObject({
      code: CHECK,
      constraint: "dates_two_people_check",
    });
    const p = await user();
    expect(
      await insertDate(x, p, "INVITED", "2026-11-07 13:00Z", "2026-11-07 11:00Z"),
    ).toMatchObject({
      code: CHECK,
      constraint: "dates_time_check",
    });
  });
});

describe("relationship and money checks (PLAN-001 §8.2, §8.3)", () => {
  it("opens chat only after both opted in, and never while blocked", async () => {
    const [a, b] = [await user(), await user()];
    const dateId = await date(a, b, "CLOSED", "2026-11-07 11:00Z", "2026-11-07 13:00Z");
    const relationship = (optIn: string | null, chatOpen: boolean, blocked: string | null) =>
      attempt(
        `INSERT INTO app.relationships (date_id, user_a, user_b, mutual_opt_in_at, chat_open, blocked_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [dateId, a, b, optIn, chatOpen, blocked],
      );
    expect(await relationship(null, true, null)).toMatchObject({
      code: CHECK,
      constraint: "relationships_chat_needs_opt_in_check",
    });
    expect(await relationship("2026-11-07 14:00Z", true, "2026-11-08 09:00Z")).toMatchObject({
      code: CHECK,
      constraint: "relationships_chat_not_blocked_check",
    });
    expect(await relationship("2026-11-07 14:00Z", true, null)).toBeNull();
  });

  it("refuses non-positive amounts, malformed currencies and a paid state without a payment time", async () => {
    const [a, b] = [await user(), await user()];
    const dateId = await date(a, b, "PAYMENT_PENDING", "2026-11-07 11:00Z", "2026-11-07 13:00Z");
    const order = (amount: number, currency: string, state: string) =>
      attempt(
        `INSERT INTO app.payment_orders (date_id, user_id, amount_minor, currency, state, provider, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, 'acme-pay', gen_random_uuid()::text)`,
        [dateId, a, amount, currency, state],
      );
    expect(await order(0, "CNY", "PAYMENT_CREATED")).toMatchObject({
      constraint: "payment_orders_amount_check",
    });
    expect(await order(8800, "cny", "PAYMENT_CREATED")).toMatchObject({
      constraint: "payment_orders_currency_check",
    });
    expect(await order(8800, "CNY", "PAID")).toMatchObject({
      constraint: "payment_orders_paid_at_check",
    });
  });

  it("refuses an unknown date status", async () => {
    const [a, b] = [await user(), await user()];
    expect(
      await attempt(`INSERT INTO app.dates (user_a, user_b, status) VALUES ($1, $2, 'MAYBE')`, [
        a,
        b,
      ]),
    ).toMatchObject({ code: CHECK, constraint: "dates_status_check" });
  });

  it("records a deletion time exactly when an account is deleted", async () => {
    expect(await attempt(`INSERT INTO app.users (status) VALUES ('deleted')`)).toMatchObject({
      constraint: "users_deleted_at_check",
    });
    expect(
      await attempt(`INSERT INTO app.users (status, deleted_at) VALUES ('active', now())`),
    ).toMatchObject({
      constraint: "users_deleted_at_check",
    });
  });
});
