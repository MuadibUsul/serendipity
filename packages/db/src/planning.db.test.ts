// Planning a matched pair's date against the real schema (P03-10), as the
// application role: approved profiles, venues with listings and slots.
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { migrate } from "./migrations.js";
import { pgDatePlanner } from "./planning.js";
import { createLoginRole, createTestDatabase, urlFor } from "./test-db.js";
import type { TestDatabase } from "./test-db.js";

// Friday 20 November 2026, 10:00 in San Francisco.
const NOW = new Date("2026-11-20T18:00:00Z");
const sf = (date: string, time: string) => new Date(`${date}T${time}:00-08:00`);
const EVENINGS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => ({
  day,
  from: "18:00",
  to: "23:00",
}));

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

// Each test sees only its own venues and slots.
beforeEach(async () => {
  await admin.query("DELETE FROM app.dates");
  await admin.query("DELETE FROM app.venue_slots");
  await admin.query("DELETE FROM app.venues");
});

afterAll(async () => {
  await pool.end();
  await admin.end();
  await db.drop();
  await role.drop();
});

interface PersonSpec {
  readonly windows?: readonly { day: string; from: string; to: string }[];
  readonly budget?: number;
  readonly area?: string;
  readonly dietary?: readonly string[];
  readonly dietaryConsent?: boolean;
}

async function person(spec: PersonSpec = {}): Promise<string> {
  const user = await admin.query<{ id: string }>(
    "INSERT INTO app.users (status) VALUES ('active') RETURNING id",
  );
  const id = user.rows[0]?.id ?? "";
  const snapshot = {
    schema_version: 1,
    hard_rules: {
      "self.city_region": "SFB_BAYAREA",
      "self.relationship_goal": "long_term",
      "self.availability": spec.windows ?? EVENINGS,
      "seeking.age_range": { min: 25, max: 40 },
      "seeking.relationship_goals": ["long_term"],
      "seeking.dealbreakers": [],
      "date.budget_per_person": { currency: "USD", max_minor: spec.budget ?? 6_000 },
    },
  };
  const version = await admin.query<{ id: string }>(
    `INSERT INTO app.profile_versions (user_id, version, approval_state, structured_json, approved_at)
     VALUES ($1, 1, 'approved', $2, now()) RETURNING id`,
    [id, JSON.stringify(snapshot)],
  );
  const facts: [string, unknown][] = [["self.home_area", spec.area ?? "SFB_SF_MISSION"]];
  if (spec.dietary !== undefined) facts.push(["date.dietary_restrictions", spec.dietary]);
  for (const [key, value] of facts) {
    await admin.query(
      `INSERT INTO app.profile_facts (profile_version_id, key, value, provenance, certainty, visibility_scope)
       VALUES ($1, $2, $3, 'explicit', 'high', 'private')`,
      [version.rows[0]?.id, key, JSON.stringify(value)],
    );
  }
  if (spec.dietaryConsent === true) {
    await admin.query(
      `INSERT INTO app.consent_grants (user_id, scope, recipient_class, purpose, version)
       VALUES ($1, 'dietary_restrictions', 'venue_filter', 'venue_selection', 1)`,
      [id],
    );
  }
  return id;
}

async function pair(a: PersonSpec = {}, b: PersonSpec = {}, verdict = "PASS"): Promise<string> {
  const [x, y] = [await person(a), await person(b)].sort();
  const inserted = await admin.query<{ id: string }>(
    `INSERT INTO app.candidate_pairs
       (user_a, user_b, policy_version_a, policy_version_b, safety_eligibility, retrieval_version, expires_at)
     VALUES ($1, $2, 4, 4, 'eligible', 'test', $3) RETURNING id`,
    [x, y, new Date(NOW.getTime() + 86_400_000)],
  );
  const pairId = inserted.rows[0]?.id ?? "";
  await admin.query(
    `INSERT INTO app.negotiations (candidate_pair_id, status, protocol_version, completed_at)
     VALUES ($1, $2, 'a2a-match/0.1', CASE WHEN $2 = 'RUNNING' THEN NULL ELSE now() END)`,
    [pairId, verdict],
  );
  return pairId;
}

async function venue(
  area: string,
  extra: { price?: number; accommodates?: string[]; status?: string } = {},
): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `INSERT INTO app.venues (name, region, address, location, status, area, price_per_person_minor, accommodates)
     VALUES ('Test venue', 'SFB_BAYAREA', '1 Test St', 'SRID=4326;POINT(-122.42 37.76)', $1, $2, $3, $4)
     RETURNING id`,
    [extra.status ?? "active", area, extra.price ?? 4_000, extra.accommodates ?? []],
  );
  return rows[0]?.id ?? "";
}

async function slot(venueId: string, startsAt: Date, extra: { full?: boolean } = {}) {
  const { rows } = await admin.query<{ id: string }>(
    `INSERT INTO app.venue_slots (venue_id, starts_at, ends_at, capacity, reserved)
     VALUES ($1, $2, $3, 2, $4) RETURNING id`,
    [venueId, startsAt, new Date(startsAt.getTime() + 2 * 3_600_000), extra.full ? 2 : 0],
  );
  return rows[0]?.id ?? "";
}

const planner = () => pgDatePlanner(pool);

describe("planning a date", () => {
  it("records the date in DRAFT with the chosen venue, slot and time", async () => {
    const near = await venue("SFB_SF_MISSION");
    const chosen = await slot(near, sf("2026-11-22", "19:00"));
    const pairId = await pair({}, { area: "SFB_SF_DOWNTOWN" });
    const outcome = await planner().planForPair(pairId, 0.5, NOW);
    expect(outcome.kind).toBe("planned");
    if (outcome.kind !== "planned") return;
    const { rows } = await admin.query(
      `SELECT status, venue_id, venue_slot_id, start_at, candidate_pair_id FROM app.dates WHERE id = $1`,
      [outcome.dateId],
    );
    expect(rows[0]).toMatchObject({
      status: "DRAFT",
      venue_id: near,
      venue_slot_id: chosen,
      start_at: sf("2026-11-22", "19:00"),
      candidate_pair_id: pairId,
    });
    expect(await planner().planForPair(pairId, 0.5, NOW)).toEqual({
      kind: "refused",
      refusal: "already_planned",
    });
  });

  it("plans only after a PASS", async () => {
    for (const verdict of ["RUNNING", "REJECT", "NO_DECISION"]) {
      const pairId = await pair({}, {}, verdict);
      expect(await planner().planForPair(pairId, 0.5, NOW)).toEqual({
        kind: "refused",
        refusal: "not_passed",
      });
    }
  });

  it("finds no time when their windows never meet a free slot", async () => {
    const near = await venue("SFB_SF_MISSION");
    await slot(near, sf("2026-11-23", "19:00"), { full: true }); // Monday, but full
    await slot(near, sf("2026-11-24", "19:00")); // Tuesday: outside their windows
    const monday = [{ day: "mon", from: "18:00", to: "23:00" }];
    const pairId = await pair({ windows: monday }, { windows: monday });
    expect(await planner().planForPair(pairId, 0.5, NOW)).toEqual({
      kind: "no_plan",
      reason: "no_common_time",
    });
  });

  it("offers only active venues", async () => {
    const pending = await venue("SFB_SF_MISSION", { status: "pending" });
    await slot(pending, sf("2026-11-22", "19:00"));
    expect(await planner().planForPair(await pair(), 0.5, NOW)).toMatchObject({
      kind: "no_plan",
    });
  });

  it("reads dietary needs only with the consent, and never writes them down", async () => {
    const plain = await venue("SFB_OAKLAND");
    const vegan = await venue("SFB_BERKELEY", { accommodates: ["vegan"] });
    const plainSlot = await slot(plain, sf("2026-11-24", "19:00"));
    const veganSlot = await slot(vegan, sf("2026-11-24", "19:30"));
    const withConsent = await pair(
      { area: "SFB_OAKLAND", dietary: ["vegetarian"], dietaryConsent: true },
      { area: "SFB_BERKELEY" },
    );
    const outcome = await planner().planForPair(withConsent, 0.5, NOW);
    if (outcome.kind !== "planned") throw new Error(`expected a plan: ${JSON.stringify(outcome)}`);
    const date = await admin.query<{ venue_slot_id: string }>(
      "SELECT venue_slot_id FROM app.dates WHERE id = $1",
      [outcome.dateId],
    );
    expect(date.rows[0]?.venue_slot_id).toBe(veganSlot);

    const withoutConsent = await pair(
      { area: "SFB_OAKLAND", dietary: ["vegetarian"], dietaryConsent: false },
      { area: "SFB_BERKELEY" },
    );
    // Without the consent the need is not read: the earlier, equally fair slot wins.
    const unread = await planner().planForPair(withoutConsent, 0.5, NOW);
    if (unread.kind !== "planned") throw new Error("expected a plan");
    const second = await admin.query<{ venue_slot_id: string }>(
      "SELECT venue_slot_id FROM app.dates WHERE id = $1",
      [unread.dateId],
    );
    expect(second.rows[0]?.venue_slot_id).toBe(plainSlot);

    const audit = await admin.query<{ text: string }>(
      "SELECT metadata_redacted::text AS text FROM app.audit_events WHERE action LIKE 'date.plan%'",
    );
    expect(audit.rows.map((row) => row.text).join(" ")).not.toMatch(/veg|SFB_|6000|18:00/);
  });

  it("keeps to the budget and leaves out venues without a listing", async () => {
    const pricey = await venue("SFB_SF_MARINA", { price: 9_000 });
    const unlisted = await admin.query<{ id: string }>(
      `INSERT INTO app.venues (name, region, address, location, status)
       VALUES ('Unlisted', 'SFB_BAYAREA', '2 Test St', 'SRID=4326;POINT(-122.43 37.80)', 'active')
       RETURNING id`,
    );
    await slot(pricey, sf("2026-11-25", "19:00"));
    await slot(unlisted.rows[0]?.id ?? "", sf("2026-11-25", "19:00"));
    const pairId = await pair(
      {
        area: "SFB_SF_MARINA",
        budget: 5_000,
        windows: [{ day: "wed", from: "18:00", to: "22:00" }],
      },
      { area: "SFB_SF_MARINA", windows: [{ day: "wed", from: "18:00", to: "22:00" }] },
    );
    expect(await planner().planForPair(pairId, 0.5, NOW)).toEqual({
      kind: "no_plan",
      reason: "no_venue",
    });
  });
});
