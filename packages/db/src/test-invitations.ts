// A date between two people, ready to be invited, for the invitation suites
// (`@serendipity/db/test-invitations`); for tests only. The other person is
// given profile, photo and identity data with recognisable markers, so a
// test can search every response for anything of theirs.
import { randomUUID } from "node:crypto";

import { createDate, transition } from "@serendipity/domain";
import type { Queryable } from "./queryable.js";

export interface InvitationFixture {
  readonly dateId: string;
  readonly userA: string;
  readonly userB: string;
  /** Someone with no part in the date. */
  readonly stranger: string;
  /** Strings that belong to each person and must never reach the other. */
  readonly secretsOf: Readonly<Record<"A" | "B", readonly string[]>>;
}

const ELIGIBLE = (() => {
  const result = transition(
    createDate(),
    { type: "VERIFIER_PASSED" },
    { kind: "system", source: "verifier" },
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.date;
})();

/** Inserts three people, one venue and an `ELIGIBLE` date between the first two. `admin` bypasses grants. */
export async function seedInvitationDate(admin: Queryable): Promise<InvitationFixture> {
  const [userA, userB, stranger] = [randomUUID(), randomUUID(), randomUUID()];
  const secretsOf: Record<"A" | "B", string[]> = { A: [], B: [] };
  for (const [party, id] of [
    ["A", userA],
    ["B", userB],
  ] as const) {
    const marker = `secret-${party.toLowerCase()}-${id.slice(0, 8)}`;
    await admin.query(`INSERT INTO app.users (id, status) VALUES ($1, 'active')`, [id]);
    await admin.query(
      `INSERT INTO app.profile_versions (user_id, version, approval_state, structured_json, approved_at)
       VALUES ($1, 1, 'approved', $2, now())`,
      [id, JSON.stringify({ schema_version: 1, note: `${marker}-profile` })],
    );
    await admin.query(
      `INSERT INTO app.media_assets (owner_user_id, object_key, purpose, retention_until, status)
       VALUES ($1, $2, 'match_photo', now() + interval '30 days', 'active')`,
      [id, `photos/${marker}-photo.jpg`],
    );
    await admin.query(
      `INSERT INTO app.identity_attestations
         (user_id, provider, provider_ref, age_verified, real_person_verified, verified_at)
       VALUES ($1, 'fake', $2, true, true, now())`,
      [id, `${marker}-identity`],
    );
    secretsOf[party].push(id, `${marker}-profile`, `${marker}-photo`, `${marker}-identity`);
  }
  await admin.query(`INSERT INTO app.users (id, status) VALUES ($1, 'active')`, [stranger]);
  const venueId = randomUUID();
  await admin.query(
    `INSERT INTO app.venues (id, name, region, address, location, status)
     VALUES ($1, '示例咖啡馆（虚构）', 'GZ_CORE', '示例路 1 号（虚构地址）',
             ST_GeogFromText('POINT(113.32 23.12)'), 'active')`,
    [venueId],
  );
  const dateId = randomUUID();
  const { machineVersion, state, revision, ...context } = ELIGIBLE;
  await admin.query(
    `INSERT INTO app.dates
       (id, user_a, user_b, venue_id, status, machine_version, revision, machine_context, start_at, end_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '2026-11-21T07:00:00Z', '2026-11-21T08:30:00Z')`,
    [dateId, userA, userB, venueId, state, machineVersion, revision, JSON.stringify(context)],
  );
  return { dateId, userA, userB, stranger, secretsOf };
}
