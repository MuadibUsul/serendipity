import { randomUUID } from "node:crypto";

import { createAuthorizer } from "@serendipity/consent";
import { createMediaService } from "@serendipity/media";
import { createPrivacyService } from "@serendipity/privacy";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pgMediaRepository } from "./media.js";
import { migrate } from "./migrations.js";
import { pgPrivacyRepository } from "./privacy.js";
import { createLoginRole, createTestDatabase, urlFor } from "./test-db.js";
import type { TestDatabase } from "./test-db.js";
import { pgVisionRepository } from "./vision.js";

let db: TestDatabase;
let role: Awaited<ReturnType<typeof createLoginRole>>;
let pool: pg.Pool;
let alice: string;
let bob: string;

beforeAll(async () => {
  db = await createTestDatabase();
  await migrate(db.url, "up");
  role = await createLoginRole("serendipity_app");
  pool = new pg.Pool({ connectionString: urlFor(db.name, role) });
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO app.users (status) VALUES ('active'), ('active') RETURNING id`,
  );
  alice = rows[0]?.id ?? "";
  bob = rows[1]?.id ?? "";
});

afterAll(async () => {
  await pool.end();
  await db.drop();
  await role.drop();
});

async function count(sql: string, values: unknown[]): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(sql, values);
  return rows[0]?.count ?? -1;
}

describe("self-service privacy data paths", () => {
  it("exports only own data and retries deletion while preserving a checkable retained-record receipt", async () => {
    const profile = randomUUID();
    const pair = randomUUID();
    const date = randomUUID();
    const photo = randomUUID();
    const pendingPhoto = randomUUID();
    await pool.query(
      `INSERT INTO app.profile_versions (id, user_id, version, structured_json)
       VALUES ($1, $2, 1, '{"bio":"own-profile"}'),
         (gen_random_uuid(), $3, 1, '{"bio":"other-private"}')`,
      [profile, alice, bob],
    );
    await pool.query(
      `INSERT INTO app.profile_facts (profile_version_id, key, value, provenance, certainty, visibility_scope)
       VALUES ($1, 'bio', '"own-profile"', 'explicit', 'high', 'private')`,
      [profile],
    );
    await pool.query(
      `INSERT INTO app.match_policies (user_id, version, active, region)
       VALUES ($1, 1, true, 'PILOT')`,
      [alice],
    );
    await pool.query(
      `INSERT INTO app.consent_grants (user_id, scope, recipient_class, purpose, version)
       VALUES ($1, 'visual_matching', 'vision_provider', 'visual_features', 1)`,
      [alice],
    );
    const [first, second] = [alice, bob].sort();
    await pool.query(
      `INSERT INTO app.candidate_pairs (id, user_a, user_b, policy_version_a,
        policy_version_b, safety_eligibility, retrieval_version, expires_at)
       VALUES ($1, $2, $3, 1, 1, 'eligible', 'fixture', now() + interval '1 day')`,
      [pair, first, second],
    );
    await pool.query(
      `INSERT INTO app.negotiations (candidate_pair_id, status, protocol_version,
        outcome_json, completed_at)
       VALUES ($1, 'PASS', 'fixture', '{"peer":"peer-secret"}', now())`,
      [pair],
    );
    await pool.query(
      `INSERT INTO app.dates (id, user_a, user_b, candidate_pair_id,
        machine_context) VALUES ($1, $2, $3, $4, '{"peer":"peer-secret"}')`,
      [date, alice, bob, pair],
    );
    await pool.query(
      `INSERT INTO app.date_invites (date_id, user_id, expires_at)
       VALUES ($1, $2, now() + interval '1 day')`,
      [date, alice],
    );
    await pool.query(
      `INSERT INTO app.post_date_feedback (date_id, user_id, mutual_interest)
       VALUES ($1, $2, true)`,
      [date, alice],
    );
    await pool.query(
      `INSERT INTO app.relationships (date_id, user_a, user_b)
       VALUES ($1, $2, $3)`,
      [date, alice, bob],
    );
    await pool.query(
      `INSERT INTO app.payment_orders (date_id, user_id, amount_minor, currency,
        provider, idempotency_key)
       VALUES ($1, $2, 2500, 'USD', 'fixture-pay', $3)`,
      [date, alice, randomUUID()],
    );
    await pool.query(
      `INSERT INTO app.notification_outbox (aggregate_type, aggregate_id, kind,
        recipient_user_id) VALUES ('candidate_pair', $1, 'fixture', $2)`,
      [pair, bob],
    );

    const mediaRepository = pgMediaRepository(pool);
    await mediaRepository.create({
      id: photo,
      ownerUserId: alice,
      objectKey: `photos/${photo}`,
      purpose: "visual_matching",
      contentType: "image/jpeg",
      maxBytes: 100,
      createdAt: new Date(),
      retentionUntil: new Date(Date.now() + 86_400_000),
      status: "pending",
    });
    expect(await mediaRepository.activate(photo)).toBe(true);
    await mediaRepository.create({
      id: pendingPhoto,
      ownerUserId: alice,
      objectKey: `photos/${pendingPhoto}`,
      purpose: "visual_matching",
      contentType: "image/jpeg",
      maxBytes: 100,
      createdAt: new Date(),
      retentionUntil: new Date(Date.now() + 86_400_000),
      status: "pending",
    });
    await pool.query(
      `INSERT INTO app.media_derivatives (asset_id, object_key)
       VALUES ($1, $2)`,
      [photo, `derived/${photo}`],
    );
    await pgVisionRepository(pool).save({
      assetId: photo,
      ownerUserId: alice,
      role: "self",
      preference: null,
      features: {
        hair_length: { value: "short", confidence: 0.8 },
        clothing_style: { value: "casual", confidence: 0.6 },
        photo_style: { value: "outdoor", confidence: 0.7 },
      },
    });

    const objects = new Set([`photos/${photo}`, `derived/${photo}`]);
    let failOnce = true;
    const media = createMediaService({
      repository: mediaRepository,
      consent: createAuthorizer({
        grants: { grantsFor: () => Promise.resolve([]) },
        audit: { record: () => Promise.resolve() },
      }),
      storage: {
        uploadForm: () => Promise.resolve({ url: "https://fixture.invalid", fields: {} }),
        describe: () => Promise.resolve(null),
        readUrl: () => Promise.resolve("https://fixture.invalid"),
        delete(key) {
          if (key === `photos/${photo}` && failOnce) {
            failOnce = false;
            return Promise.reject(new Error("fixture storage failure"));
          }
          objects.delete(key);
          return Promise.resolve();
        },
      },
    });
    const privacy = createPrivacyService({ repository: pgPrivacyRepository(pool), media });
    const exported = await privacy.exportForSelf(alice);
    const text = JSON.stringify(exported);
    expect(text).toContain("own-profile");
    expect(exported.visualFeatures).toHaveLength(1);
    expect(exported.transactionRecords.paymentOrders).toHaveLength(1);
    expect(text).not.toContain("other-private");
    expect(text).not.toContain("peer-secret");
    expect(text).not.toContain(bob);
    expect(text).not.toContain(`photos/${photo}`);
    expect(text).not.toContain(`derived/${photo}`);

    const requested = await privacy.requestDeletionForSelf(alice);
    expect(requested.status).toBe("requested");
    expect((await privacy.requestDeletionForSelf(alice)).id).toBe(requested.id);
    expect(await privacy.processDeletion(alice)).toMatchObject({
      status: "requested",
      attempts: 0,
    });
    await pool.query(
      `UPDATE app.media_assets SET created_at = now() - interval '2 minutes' WHERE id = $1`,
      [pendingPhoto],
    );
    expect(
      await count(
        `SELECT count(*)::int AS count FROM app.consent_grants
      WHERE user_id = $1 AND revoked_at IS NULL`,
        [alice],
      ),
    ).toBe(0);
    await expect(
      mediaRepository.create({
        id: randomUUID(),
        ownerUserId: alice,
        objectKey: `photos/${randomUUID()}`,
        purpose: "visual_matching",
        contentType: "image/jpeg",
        maxBytes: 100,
        createdAt: new Date(),
        retentionUntil: new Date(Date.now() + 86_400_000),
        status: "pending",
      }),
    ).rejects.toThrow();

    await expect(privacy.processDeletion(alice)).rejects.toMatchObject({ code: "deletion_failed" });
    expect(await privacy.deletionStatusForSelf(alice)).toMatchObject({
      id: requested.id,
      status: "failed",
      failureStage: "media",
      attempts: 1,
    });
    expect(
      await count(`SELECT count(*)::int AS count FROM app.profile_versions WHERE user_id = $1`, [
        alice,
      ]),
    ).toBe(1);
    const completed = await privacy.processDeletion(alice);
    expect(completed).toMatchObject({
      id: requested.id,
      status: "completed",
      attempts: 2,
      retainedSummary: { dates: 1, paymentOrders: 1 },
    });
    expect(objects.size).toBe(0);
    expect(await privacy.processDeletion(alice)).toEqual(completed);
    expect(
      await count(`SELECT count(*)::int AS count FROM app.media_assets WHERE owner_user_id = $1`, [
        alice,
      ]),
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*)::int AS count FROM app.visual_feature_snapshots WHERE owner_user_id = $1`,
        [alice],
      ),
    ).toBe(0);
    expect(
      await count(`SELECT count(*)::int AS count FROM app.profile_versions WHERE user_id = $1`, [
        alice,
      ]),
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*)::int AS count FROM app.candidate_pairs WHERE user_a = $1 OR user_b = $1`,
        [alice],
      ),
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*)::int AS count FROM app.negotiations WHERE candidate_pair_id = $1`,
        [pair],
      ),
    ).toBe(0);
    expect(
      await count(`SELECT count(*)::int AS count FROM app.payment_orders WHERE user_id = $1`, [
        alice,
      ]),
    ).toBe(1);
    expect(
      await count(`SELECT count(*)::int AS count FROM app.profile_versions WHERE user_id = $1`, [
        bob,
      ]),
    ).toBe(1);
    expect(
      await count(
        `SELECT count(*)::int AS count FROM app.audit_events
      WHERE object_id = $1 AND action = 'account_deletion_completed'`,
        [alice],
      ),
    ).toBe(1);
    await expect(privacy.exportForSelf(alice)).rejects.toMatchObject({ code: "not_found" });
  });
});
