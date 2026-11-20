// Identity attestations in app.identity_attestations (ARCH-001 §5): only
// what a verification provider concluded, never the evidence. One row per
// (provider, provider_ref). A later verdict for the same reference replaces an
// earlier one (a provider re-checking or revoking); a repeated or older one
// changes nothing. Every callback that reaches the store is audited, replays
// included.
import { ageOn } from "@serendipity/identity";
import type {
  Attestation,
  AttestationStore,
  RecordOutcome,
  TierFacts,
} from "@serendipity/identity";
import { MARKET } from "@serendipity/market";

import { inAuditedTransaction } from "./audit.js";
import type { TransactionPool } from "./audit.js";
import type { Queryable } from "./queryable.js";

export interface AttestationRow {
  provider: string;
  provider_ref: string;
  age_verified: boolean;
  real_person_verified: boolean;
  verified_at: Date;
  expires_at: Date | null;
  level: "liveness" | "document";
  estimated_age: number | null;
  face_match: boolean | null;
}

export const ATTESTATION_COLUMNS = `provider, provider_ref, age_verified, real_person_verified,
  verified_at, expires_at, level, estimated_age, face_match`;

export const toAttestation = (row: AttestationRow): Attestation => ({
  provider: row.provider,
  providerRef: row.provider_ref,
  ageVerified: row.age_verified,
  realPersonVerified: row.real_person_verified,
  verifiedAt: row.verified_at,
  expiresAt: row.expires_at,
  level: row.level,
  estimatedAge: row.estimated_age,
  faceMatch: row.face_match,
});

/** The calendar date of `now` in the market's time zone (YYYY-MM-DD). */
const localDate = (now: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: MARKET.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

/**
 * What tiering needs besides the verdicts (ADR-0024): the age the person
 * declared, and whether an open or upheld report says they may be someone
 * else or under 18.
 */
export async function identityFacts(db: Queryable, userId: string, now: Date): Promise<TierFacts> {
  const user = await db.query<{ birth_date: string | null }>(
    "SELECT to_char(birth_date, 'YYYY-MM-DD') AS birth_date FROM app.users WHERE id = $1",
    [userId],
  );
  const reports = await db.query<{ category: string }>(
    `SELECT DISTINCT category FROM app.safety_reports
     WHERE subject_id = $1 AND status IN ('open', 'actioned')
       AND category IN ('fake_identity', 'minor_suspected')`,
    [userId],
  );
  const categories = new Set(reports.rows.map((row) => row.category));
  const birthDate = user.rows[0]?.birth_date ?? null;
  return {
    declaredAge: birthDate === null ? null : ageOn(birthDate, localDate(now)),
    region: null,
    impersonationReported: categories.has("fake_identity"),
    minorSuspected: categories.has("minor_suspected"),
  };
}

export function pgAttestationStore(pool: TransactionPool & Queryable): AttestationStore {
  return {
    async attestationsFor(userId) {
      const { rows } = await pool.query<AttestationRow>(
        `SELECT ${ATTESTATION_COLUMNS}
         FROM app.identity_attestations WHERE user_id = $1 ORDER BY verified_at`,
        [userId],
      );
      return rows.map(toAttestation);
    },

    factsFor: (userId, now) => identityFacts(pool, userId, now),

    record(userId, attestation, context = {}) {
      return inAuditedTransaction(
        pool,
        async (tx) => {
          // Insert, or replace an older verdict for the same reference and person.
          const { rows } = await tx.db.query<{ inserted: boolean }>(
            `INSERT INTO app.identity_attestations AS a
               (user_id, provider, provider_ref, age_verified, real_person_verified, verified_at,
                expires_at, level, estimated_age, face_match)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (provider, provider_ref) DO UPDATE SET
               age_verified = EXCLUDED.age_verified,
               real_person_verified = EXCLUDED.real_person_verified,
               verified_at = EXCLUDED.verified_at,
               expires_at = EXCLUDED.expires_at,
               level = EXCLUDED.level,
               estimated_age = EXCLUDED.estimated_age,
               face_match = EXCLUDED.face_match
             WHERE a.user_id = EXCLUDED.user_id AND EXCLUDED.verified_at > a.verified_at
             RETURNING (xmax = 0) AS inserted`,
            [
              userId,
              attestation.provider,
              attestation.providerRef,
              attestation.ageVerified,
              attestation.realPersonVerified,
              attestation.verifiedAt,
              attestation.expiresAt,
              attestation.level ?? "document",
              attestation.estimatedAge ?? null,
              attestation.faceMatch ?? null,
            ],
          );
          const row = rows[0];
          const outcome: RecordOutcome =
            row === undefined ? "unchanged" : row.inserted ? "recorded" : "updated";
          await tx.audit({
            actorType: "system",
            actorId: null,
            action: `identity.attestation.${outcome}`,
            objectType: "user",
            objectId: userId,
            metadata: {
              provider: attestation.provider,
              age_verified: attestation.ageVerified,
              real_person_verified: attestation.realPersonVerified,
              level: attestation.level ?? "document",
              face_match: attestation.faceMatch ?? null,
              expires_at: attestation.expiresAt,
            },
          });
          return outcome;
        },
        context,
      );
    },
  };
}
