// Candidate recall against the real schema, as serendipity_app: the SQL agrees
// with the TypeScript prefilter, keeps every pair decidePair passes, and
// leaves out whoever cannot be matched right now.
import { buildCity } from "@serendipity/fixtures";
import type { CityPerson } from "@serendipity/fixtures";
import { decidePair, mayRecall, recallEntryOf } from "@serendipity/matching";
import type { Candidate, RecallContext, RecallEntry } from "@serendipity/matching";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrate } from "./migrations.js";
import { EMBEDDING_DIMENSIONS, EmbeddingRefused, pgRecallRepository } from "./recall.js";
import type { RecallRepository } from "./recall.js";
import { createLoginRole, createTestDatabase, urlFor } from "./test-db.js";
import type { TestDatabase } from "./test-db.js";
import { CITY_IDENTITY_POLICY, seedCity } from "./test-recall.js";

const NOW = new Date("2026-11-18T04:00:00Z");
const VERIFIED = new Date("2026-11-17T04:00:00Z");
const CONTEXT: RecallContext = {
  dateLengthMinutes: 90,
  cheapestPackagePerPerson: { currency: "CNY", minor: 8_800 },
};
const QUERY = { context: CONTEXT, now: NOW, limit: 200, salt: "round-1" };
const MODEL = "fixture-embedding-1024";

let db: TestDatabase;
let role: Awaited<ReturnType<typeof createLoginRole>>;
let admin: pg.Pool;
let pool: pg.Pool;
let recall: RecallRepository;
let city: CityPerson[];
let versions: Map<string, string>;
let entries: Map<string, RecallEntry>;

const byId = (id: string) => {
  const person = city.find((p) => p.id === id);
  if (person === undefined) throw new Error(`no such person ${id}`);
  return person;
};

const tagsOf = (person: CityPerson) => [...new Set(Object.values(person.selfTags).flat())].sort();

function entryOf(person: CityPerson): RecallEntry {
  const result = recallEntryOf({
    userId: person.id,
    age: person.age,
    profileSnapshot: person.snapshot,
    confirmedSelfTags: tagsOf(person),
    identity: { eligible: true, until: null },
  });
  if (!result.ok) throw new Error(`the city has an unusable person: ${result.reason}`);
  return result.entry;
}

/** Everyone the TypeScript prefilter keeps for `id`. */
function expected(id: string): string[] {
  const me = entries.get(id);
  if (me === undefined) return [];
  return [...entries.values()]
    .filter((them) => mayRecall(me, them, CONTEXT, NOW))
    .map((them) => them.userId)
    .sort();
}

const candidate = (person: CityPerson): Candidate => ({
  id: person.id,
  accountStatus: "active",
  identityEligible: true,
  age: person.age,
  profileSnapshot: person.snapshot,
  confirmedSelfTags: tagsOf(person),
  hasActiveDate: false,
  blockedIds: [],
});

/** A requester in the shared city with at least `n` people recalled (read-only tests). */
function busyRequester(n: number): { me: string; them: string[] } {
  for (const person of city) {
    const them = expected(person.id);
    if (them.length >= n) return { me: person.id, them };
  }
  throw new Error(`nobody in the city has ${String(n)} matches`);
}

let towns = 0;

/**
 * A separate small town in its own region, seeded and refreshed, for a test
 * that changes people: no other test sees them. Returns a requester with at
 * least `n` people recalled, and those people.
 */
async function town(n: number): Promise<{ me: string; them: string[] }> {
  towns += 1;
  const people = buildCity({
    seed: 1_000 + towns,
    people: 80,
    dimensions: EMBEDDING_DIMENSIONS,
    region: `TOWN_${String(towns)}`,
  });
  const seeded = await seedCity(admin, people, VERIFIED);
  for (const person of people) {
    city.push(person);
    versions.set(person.id, seeded.get(person.id) ?? "");
    entries.set(person.id, entryOf(person));
    expect(await recall.refresh(person.id, { age: person.age }, NOW)).toEqual({ stored: true });
  }
  for (const person of people) {
    const them = expected(person.id);
    if (them.length >= n) return { me: person.id, them };
  }
  throw new Error(`nobody in town ${String(towns)} has ${String(n)} matches`);
}

beforeAll(async () => {
  db = await createTestDatabase();
  await migrate(db.url, "up");
  role = await createLoginRole("serendipity_app");
  admin = new pg.Pool({ connectionString: db.url });
  pool = new pg.Pool({ connectionString: urlFor(db.name, role) });
  recall = pgRecallRepository(pool, { identity: CITY_IDENTITY_POLICY, embeddingModel: MODEL });
  city = buildCity({ seed: 7, people: 400, dimensions: EMBEDDING_DIMENSIONS });
  versions = await seedCity(admin, city, VERIFIED);
  for (const person of city) {
    expect(await recall.refresh(person.id, { age: person.age }, NOW)).toEqual({ stored: true });
  }
  entries = new Map(city.map((person) => [person.id, entryOf(person)]));
}, 120_000);

afterAll(async () => {
  await pool.end();
  await admin.end();
  await db.drop();
  await role.drop();
});

describe("recall", () => {
  it("returns exactly the people the TypeScript prefilter keeps", async () => {
    let compared = 0;
    for (const person of city.slice(0, 40)) {
      const want = expected(person.id);
      expect(want.length).toBeLessThan(QUERY.limit);
      const got = await recall.recall(person.id, QUERY);
      expect([...got].sort()).toEqual(want);
      compared += want.length;
    }
    expect(compared).toBeGreaterThan(100);
  });

  it("is the same whatever food and dietary facts people hold (they filter venues, not people)", async () => {
    const { me, them } = await town(3);
    const before = new Map<string, string[]>();
    for (const id of [me, ...them]) before.set(id, [...(await recall.recall(id, QUERY))].sort());
    const restrictions = ["halal", "vegan", "nut_allergy"];
    for (const [i, id] of [me, ...them].entries()) {
      await admin.query(
        `INSERT INTO app.profile_facts (profile_version_id, key, value, provenance, certainty, visibility_scope)
         VALUES ($1, 'date.dietary_restrictions', $2, 'confirmed', 'high', 'private'),
                ($1, 'date.tastes', '["spicy"]', 'confirmed', 'high', 'matching')`,
        [versions.get(id), JSON.stringify([restrictions[i % restrictions.length]])],
      );
      expect(await recall.refresh(id, { age: byId(id).age }, NOW)).toEqual({ stored: true });
    }
    for (const id of [me, ...them]) {
      expect([...(await recall.recall(id, QUERY))].sort()).toEqual(before.get(id));
    }
  });

  it("never leaves out a pair decidePair passes", async () => {
    let passes = 0;
    for (const person of city.slice(0, 40)) {
      const got = new Set(await recall.recall(person.id, QUERY));
      for (const other of city) {
        if (decidePair(candidate(person), candidate(other), CONTEXT).pass) {
          passes += 1;
          expect(got.has(other.id)).toBe(true);
        }
      }
    }
    expect(passes).toBeGreaterThan(50);
  });

  it("returns user ids only, at most the limit, never the person themselves", async () => {
    const { me } = busyRequester(5);
    const got = await recall.recall(me, { ...QUERY, limit: 3 });
    expect(got).toHaveLength(3);
    for (const id of got) expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await recall.recall(me, QUERY)).not.toContain(me);
  });

  it("recalls nobody for a person who cannot afford the package", async () => {
    const { me } = busyRequester(1);
    const dear = { ...CONTEXT, cheapestPackagePerPerson: { currency: "CNY", minor: 10_000_000 } };
    expect(await recall.recall(me, { ...QUERY, context: dear })).toEqual([]);
  });

  it("refuses limits and prices it cannot honour", async () => {
    const { me } = busyRequester(1);
    await expect(recall.recall(me, { ...QUERY, limit: 0 })).rejects.toThrow(RangeError);
    await expect(recall.recall(me, { ...QUERY, limit: 201 })).rejects.toThrow(RangeError);
    await expect(
      recall.recall(me, { ...QUERY, context: { ...CONTEXT, dateLengthMinutes: 20 } }),
    ).rejects.toThrow(RangeError);
  });
});

describe("live exclusions", () => {
  it("leaves out an inactive account, and nobody is recalled for one", async () => {
    const { me, them } = await town(2);
    const [other] = them;
    await admin.query("UPDATE app.users SET status = 'paused' WHERE id = $1", [other]);
    expect(await recall.recall(me, QUERY)).not.toContain(other);
    expect(await recall.recall(other ?? "", QUERY)).toEqual([]);
    await admin.query("UPDATE app.users SET status = 'active' WHERE id = $1", [other]);
    expect(await recall.recall(me, QUERY)).toContain(other);
  });

  it("stops at once when matching consent is revoked, on either side", async () => {
    const { me, them } = await town(2);
    const [other] = them;
    const revoke = (id: string | undefined) =>
      admin.query(
        `UPDATE app.consent_grants SET revoked_at = now()
         WHERE user_id = $1 AND scope = 'profile_matching' AND revoked_at IS NULL`,
        [id],
      );
    await revoke(other);
    expect(await recall.recall(me, QUERY)).not.toContain(other);
    await revoke(me);
    expect(await recall.recall(me, QUERY)).toEqual([]);
  });

  it("leaves out a person whose identity verdict has run out", async () => {
    const { me, them } = await town(2);
    const [other] = them;
    await admin.query("UPDATE app.recall_entries SET eligible_until = $2 WHERE user_id = $1", [
      other,
      new Date(NOW.getTime() - 1),
    ]);
    expect(await recall.recall(me, QUERY)).not.toContain(other);
  });

  it("removes the entry when a later check fails, on refresh", async () => {
    const { me, them } = await town(2);
    const [other] = them;
    await admin.query(
      `INSERT INTO app.identity_attestations
         (user_id, provider, provider_ref, age_verified, real_person_verified, verified_at)
       VALUES ($1, $2, $3, false, true, $4)`,
      [
        other,
        CITY_IDENTITY_POLICY.provider,
        `fx-recheck-${other ?? ""}`,
        new Date(NOW.getTime() - 1_000),
      ],
    );
    expect(await recall.refresh(other ?? "", { age: byId(other ?? "").age }, NOW)).toEqual({
      stored: false,
      reason: "identity_ineligible",
    });
    expect(await recall.recall(me, QUERY)).not.toContain(other);
  });

  it("leaves out a person holding a date", async () => {
    const { me, them } = await town(3);
    const [other, partner] = them;
    await admin.query(
      `INSERT INTO app.dates (user_a, user_b, status, start_at, end_at)
       VALUES ($1, $2, 'BOTH_ACCEPTED', $3, $4)`,
      [other, partner, new Date("2026-11-21T06:00:00Z"), new Date("2026-11-21T07:30:00Z")],
    );
    const got = await recall.recall(me, QUERY);
    expect(got).not.toContain(other);
    expect(got).not.toContain(partner);
  });

  it("ignores an entry once another profile version is approved, until it is refreshed", async () => {
    const { me, them } = await town(2);
    const [other] = them;
    const person = byId(other ?? "");
    await admin.query(
      `UPDATE app.profile_versions SET approval_state = 'superseded' WHERE user_id = $1`,
      [other],
    );
    await admin.query(
      `INSERT INTO app.profile_versions (user_id, version, approval_state, structured_json, approved_at)
       VALUES ($1, 2, 'approved', $2, now())`,
      [other, JSON.stringify(person.snapshot)],
    );
    expect(await recall.recall(me, QUERY)).not.toContain(other);
    expect(await recall.refresh(other ?? "", { age: person.age }, NOW)).toEqual({ stored: true });
    expect(await recall.recall(me, QUERY)).toContain(other);
  });

  it("leaves out other regions and people with no entry", async () => {
    const { me, them } = await town(3);
    const [moved, gone] = them;
    await admin.query("UPDATE app.recall_entries SET region = 'ELSEWHERE' WHERE user_id = $1", [
      moved,
    ]);
    await recall.remove(gone ?? "", "test");
    const got = await recall.recall(me, QUERY);
    expect(got).not.toContain(moved);
    expect(got).not.toContain(gone);
  });

  it("keeps no entry for a person with an unknown age", async () => {
    const { me, them } = await town(2);
    const [other] = them;
    expect(await recall.refresh(other ?? "", { age: null }, NOW)).toEqual({
      stored: false,
      reason: "age_unknown",
    });
    expect(await recall.recall(me, QUERY)).not.toContain(other);
  });
});

describe("embeddings", () => {
  const cosine = (a: readonly number[], b: readonly number[]) =>
    1 - a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);

  it("order the recalled people by similarity to the person", async () => {
    // A requester untouched by the exclusion tests: everyone they recall is still in.
    const { me } = await town(8);
    const before = [...(await recall.recall(me, QUERY))].sort();
    for (const id of [me, ...before]) {
      const version = versions.get(id);
      expect(await recall.setEmbedding(id, version ?? "", byId(id).embedding)).toBe("stored");
    }
    const got = await recall.recall(me, QUERY);
    expect([...got].sort()).toEqual(before);
    const mine = byId(me).embedding;
    const distances = got.map((id) => cosine(mine, byId(id).embedding));
    expect(distances).toEqual([...distances].sort((x, y) => x - y));
  });

  it("refuses vectors of another size, non-finite values and the zero vector", async () => {
    const { me } = await town(1);
    const version = versions.get(me) ?? "";
    await expect(recall.setEmbedding(me, version, [1, 0, 0])).rejects.toThrow(EmbeddingRefused);
    const nan = Array.from({ length: EMBEDDING_DIMENSIONS }, () => Number.NaN);
    await expect(recall.setEmbedding(me, version, nan)).rejects.toThrow(EmbeddingRefused);
    const zero = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
    await expect(recall.setEmbedding(me, version, zero)).rejects.toThrow(EmbeddingRefused);
  });

  it("stores an embedding only against the entry's current profile version", async () => {
    const { me } = await town(1);
    expect(
      await recall.setEmbedding(me, "00000000-0000-4000-8000-000000000000", byId(me).embedding),
    ).toBe("stale");
  });

  it("are dropped when the entry is rebuilt from a new profile version", async () => {
    const { me } = await town(1);
    const person = byId(me);
    await recall.setEmbedding(me, versions.get(me) ?? "", person.embedding);
    await admin.query(
      `UPDATE app.profile_versions SET approval_state = 'superseded' WHERE user_id = $1`,
      [me],
    );
    await admin.query(
      `INSERT INTO app.profile_versions (user_id, version, approval_state, structured_json, approved_at)
       VALUES ($1, 3, 'approved', $2, now())`,
      [me, JSON.stringify(person.snapshot)],
    );
    await recall.refresh(me, { age: person.age }, NOW);
    const { rows } = await admin.query<{ embedding: string | null; model: string | null }>(
      "SELECT embedding::text, embedding_model AS model FROM app.recall_entries WHERE user_id = $1",
      [me],
    );
    expect(rows[0]).toEqual({ embedding: null, model: null });
  });

  it("without embeddings, shuffle by the salt, the same salt the same order", async () => {
    const { me } = await town(6);
    const one = await recall.recall(me, QUERY);
    expect(await recall.recall(me, QUERY)).toEqual(one);
    const other = await recall.recall(me, { ...QUERY, salt: "round-2" });
    expect([...other].sort()).toEqual([...one].sort());
    expect(other).not.toEqual(one);
  });
});

describe("what an entry holds", () => {
  it("only hard-rule data and an optional summary embedding", async () => {
    const { rows } = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'app' AND table_name = 'recall_entries' ORDER BY column_name`,
    );
    expect(rows.map((row) => row.column_name)).toEqual(
      [
        "accepts_goals",
        "age",
        "age_max",
        "age_min",
        "availability",
        "budget_currency",
        "budget_minor",
        "dealbreakers",
        "eligible_until",
        "embedding",
        "embedding_model",
        "goal",
        "profile_version_id",
        "refreshed_at",
        "region",
        "self_tags",
        "user_id",
      ].sort(),
    );
  });

  it("audits every refresh, removal and embedding", async () => {
    const { rows } = await admin.query<{ action: string }>(
      `SELECT DISTINCT action FROM app.audit_events WHERE action LIKE 'matching.recall.%' ORDER BY action`,
    );
    expect(rows.map((row) => row.action)).toEqual([
      "matching.recall.embedding",
      "matching.recall.refreshed",
      "matching.recall.removed",
    ]);
  });
});
