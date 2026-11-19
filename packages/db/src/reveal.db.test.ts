// One card a day after a mutual yes, against the real schema, as serendipity_app.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrate } from "./migrations.js";
import { pgPrivacyRepository } from "./privacy.js";
import { pgRevealRepository } from "./reveal.js";
import type { RevealRepository } from "./reveal.js";
import { createLoginRole, createTestDatabase, urlFor } from "./test-db.js";
import type { TestDatabase } from "./test-db.js";

const DAY1 = new Date("2026-11-22T02:00:00Z"); // 10:00 in China
const DAY1_LATER = new Date("2026-11-22T12:00:00Z"); // 20:00, same local day
const DAY2 = new Date("2026-11-23T02:00:00Z");
const first = () => 0;

let db: TestDatabase;
let role: Awaited<ReturnType<typeof createLoginRole>>;
let admin: pg.Pool;
let pool: pg.Pool;
let cards: RevealRepository;

beforeAll(async () => {
  db = await createTestDatabase();
  await migrate(db.url, "up");
  role = await createLoginRole("serendipity_app");
  admin = new pg.Pool({ connectionString: db.url });
  pool = new pg.Pool({ connectionString: urlFor(db.name, role) });
  cards = pgRevealRepository(pool);
});

afterAll(async () => {
  await pool.end();
  await admin.end();
  await db.drop();
  await role.drop();
});

async function grant(userId: string, scope: string, recipient: string, purpose: string) {
  await admin.query(
    `INSERT INTO app.consent_grants (user_id, scope, recipient_class, purpose, version)
     VALUES ($1, $2, $3, $4, 1)`,
    [userId, scope, recipient, purpose],
  );
}

/** An approved profile with these facts. */
async function profile(userId: string, facts: Record<string, unknown>) {
  const { rows } = await admin.query<{ id: string }>(
    `INSERT INTO app.profile_versions (user_id, version, approval_state, approved_at)
     VALUES ($1, 1, 'approved', now()) RETURNING id`,
    [userId],
  );
  for (const [key, value] of Object.entries(facts)) {
    await admin.query(
      `INSERT INTO app.profile_facts (profile_version_id, key, value, provenance, certainty, visibility_scope)
       VALUES ($1, $2, $3, 'confirmed', 'high', 'private')`,
      [rows[0]?.id, key, JSON.stringify(value)],
    );
  }
}

/** Two people who both said yes, both allowing cards. */
async function couple(options: { consent?: boolean } = {}) {
  const { rows } = await admin.query<{ id: string }>(
    "INSERT INTO app.users (status) VALUES ('active'), ('active') RETURNING id",
  );
  const [a, b] = rows.map((row) => row.id) as [string, string];
  await profile(a, {
    "self.interests": ["jazz", "hiking"],
    "date.cuisines": [{ tag: "cantonese", weight: 3 }],
    "self.home_area": "GZ_TIANHE",
    "date.dietary_restrictions": ["halal"],
  });
  await profile(b, { "self.interests": ["films"], "date.tastes": ["spicy", "sweet"] });
  for (const id of [a, b]) {
    if (options.consent !== false || id === a) {
      await grant(id, "relationship_reveal", "relationship_peer", "relationship_reveal");
    }
  }
  const date = await admin.query<{ id: string }>(
    "INSERT INTO app.dates (user_a, user_b) VALUES ($1, $2) RETURNING id",
    [a, b],
  );
  const rel = await admin.query<{ id: string }>(
    `INSERT INTO app.relationships (date_id, user_a, user_b, mutual_opt_in_at, chat_open)
     VALUES ($1, $2, $3, now(), true) RETURNING id`,
    [date.rows[0]?.id, a, b],
  );
  return { a, b, id: rel.rows[0]?.id ?? "" };
}

describe("turning over cards", () => {
  it("shows face-down categories only, then one card a day of the viewer's choosing", async () => {
    const { a, b, id } = await couple();
    const before = await cards.view(b, id, DAY1);
    expect(before).toMatchObject({
      status: "open",
      seen: [],
      faceDown: [
        { category: "self.interests", remaining: 2 },
        { category: "date.cuisines", remaining: 1 },
      ],
      refusal: null,
    });
    expect(JSON.stringify(before)).not.toMatch(/jazz|hiking|cantonese|TIANHE|halal/);
    expect(await cards.flip(b, id, "date.cuisines", DAY1, first)).toEqual({
      kind: "flipped",
      card: { category: "date.cuisines", item: "cantonese" },
    });
    expect(await cards.flip(b, id, "self.interests", DAY1_LATER, first)).toEqual({
      kind: "refused",
      refusal: "daily_limit",
    });
    // b is one card ahead: b waits until a has turned one over too.
    expect(await cards.flip(b, id, "self.interests", DAY2, first)).toEqual({
      kind: "refused",
      refusal: "wait_for_them",
    });
    expect(await cards.flip(a, id, "self.interests", DAY2, first)).toMatchObject({
      kind: "flipped",
    });
    expect(await cards.flip(b, id, "self.interests", DAY2, first)).toMatchObject({
      kind: "flipped",
    });
    expect((await cards.view(b, id, DAY2))?.seen).toHaveLength(2);
  });

  it("never deals the home area, and dietary restrictions only when their owner allows them", async () => {
    const { a, b, id } = await couple();
    const categories = async () => (await cards.view(b, id, DAY1))?.faceDown.map((c) => c.category);
    expect(await categories()).not.toContain("date.dietary_restrictions");
    await cards.setSettings(a, { excluded: [], included: ["date.dietary_restrictions"] });
    expect(await categories()).not.toContain("date.dietary_restrictions");
    await grant(a, "dietary_restrictions", "venue_filter", "venue_selection");
    expect(await categories()).toContain("date.dietary_restrictions");
  });

  it("hides a card again when its owner takes the category out", async () => {
    const { a, b, id } = await couple();
    await cards.flip(b, id, "date.cuisines", DAY1, first);
    await cards.setSettings(a, { excluded: ["date.cuisines"], included: [] });
    expect((await cards.view(b, id, DAY1))?.seen).toEqual([]);
  });

  it("shows nothing without both people's consent, or once chat has closed", async () => {
    const quiet = await couple({ consent: false });
    expect(await cards.view(quiet.a, quiet.id, DAY1)).toEqual({
      status: "no_consent",
      faceDown: [],
      seen: [],
      refusal: "no_consent",
    });
    // The viewer's own consent is needed too, not only the owner's.
    expect(await cards.view(quiet.b, quiet.id, DAY1)).toMatchObject({ status: "no_consent" });
    const { a, b, id } = await couple();
    await cards.flip(b, id, "date.cuisines", DAY1, first);
    await admin.query(
      "UPDATE app.relationships SET chat_open = false, left_at = now(), left_by = $2 WHERE id = $1",
      [id, a],
    );
    expect(await cards.view(b, id, DAY2)).toMatchObject({ status: "closed", seen: [] });
    expect(await cards.flip(b, id, "self.interests", DAY2, first)).toEqual({
      kind: "refused",
      refusal: "closed",
    });
  });

  it("is invisible to anyone else, and audits the category, never the card", async () => {
    const { b, id } = await couple();
    const stranger = await couple();
    expect(await cards.view(stranger.a, id, DAY1)).toBeNull();
    expect(await cards.flip(stranger.a, id, "date.cuisines", DAY1, first)).toEqual({
      kind: "not_found",
    });
    await cards.flip(b, id, "date.cuisines", DAY1, first);
    const { rows } = await admin.query(
      "SELECT action, metadata_redacted FROM app.audit_events WHERE object_id = $1",
      [id],
    );
    expect(JSON.stringify(rows)).toContain("date.cuisines");
    expect(JSON.stringify(rows)).not.toContain("cantonese");
  });

  it("goes with the relationship when either person deletes their account", async () => {
    const { a, b, id } = await couple();
    await cards.flip(b, id, "date.cuisines", DAY1, first);
    const privacy = pgPrivacyRepository(pool);
    await privacy.requestDeletion(a);
    expect(await privacy.claimDeletion(a)).toBe(true);
    await privacy.finalizeDeletion(a);
    const { rowCount } = await admin.query(
      "SELECT 1 FROM app.reveal_flips WHERE relationship_id = $1",
      [id],
    );
    expect(rowCount).toBe(0);
  });
});
