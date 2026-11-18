// Seeds a synthetic city (@serendipity/fixtures buildCity) the way the real
// modules would leave it: active accounts, an approved profile version with
// its confirmed tag facts, a current identity attestation and the matching
// consent grant. For tests and the recall benchmark only.
import { CITY_IDENTITY_PROVIDER } from "@serendipity/fixtures";
import type { CityPerson } from "@serendipity/fixtures";

import type { Queryable } from "./queryable.js";

export const CITY_IDENTITY_POLICY = {
  provider: CITY_IDENTITY_PROVIDER,
  requireRealPerson: true,
} as const;

/** Returns each person's approved profile version id, by user id. */
export async function seedCity(
  admin: Queryable,
  people: readonly CityPerson[],
  verifiedAt: Date,
): Promise<Map<string, string>> {
  const versions = new Map<string, string>();
  const batch = 1_000;
  for (let start = 0; start < people.length; start += batch) {
    const chunk = people.slice(start, start + batch);
    const ids = chunk.map((person) => person.id);
    await admin.query(`INSERT INTO app.users (id, status) SELECT unnest($1::uuid[]), 'active'`, [
      ids,
    ]);
    const { rows } = await admin.query<{ id: string; user_id: string }>(
      `INSERT INTO app.profile_versions (user_id, version, approval_state, structured_json, approved_at)
       SELECT u, 1, 'approved', s, $3 FROM unnest($1::uuid[], $2::jsonb[]) AS t (u, s)
       RETURNING id, user_id`,
      [ids, chunk.map((person) => JSON.stringify(person.snapshot)), verifiedAt],
    );
    for (const row of rows) versions.set(row.user_id, row.id);

    const facts = chunk.flatMap((person) =>
      Object.entries(person.selfTags)
        .filter(([, tags]) => tags.length > 0)
        .map(([key, tags]) => ({ version: versions.get(person.id), key, value: tags })),
    );
    await admin.query(
      `INSERT INTO app.profile_facts (profile_version_id, key, value, provenance, certainty, visibility_scope)
       SELECT v, k, x, 'confirmed', 'high', 'matching'
       FROM unnest($1::uuid[], $2::text[], $3::jsonb[]) AS t (v, k, x)`,
      [
        facts.map((fact) => fact.version),
        facts.map((fact) => fact.key),
        facts.map((fact) => JSON.stringify(fact.value)),
      ],
    );
    await admin.query(
      `INSERT INTO app.identity_attestations
         (user_id, provider, provider_ref, age_verified, real_person_verified, verified_at)
       SELECT u, $2, 'fx-idv-' || u::text, true, true, $3 FROM unnest($1::uuid[]) AS u`,
      [ids, CITY_IDENTITY_PROVIDER, verifiedAt],
    );
    await admin.query(
      `INSERT INTO app.consent_grants (user_id, scope, recipient_class, purpose, version)
       SELECT u, 'profile_matching', 'matching_service', 'matching', 1 FROM unnest($1::uuid[]) AS u`,
      [ids],
    );
  }
  return versions;
}
