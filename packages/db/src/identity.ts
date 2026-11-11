// Identity attestations in app.identity_attestations (ARCH-001 §5): only
// what a verification provider concluded, never the evidence. One row per
// (provider, provider_ref). A later verdict for the same reference replaces an
// earlier one (a provider re-checking or revoking); a repeated or older one
// changes nothing. Every callback that reaches the store is audited, replays
// included.
import type { Attestation, AttestationStore, RecordOutcome } from "@serendipity/identity";

import { inAuditedTransaction } from "./audit.js";
import type { TransactionPool } from "./audit.js";
import type { Queryable } from "./queryable.js";

interface AttestationRow {
  provider: string;
  provider_ref: string;
  age_verified: boolean;
  real_person_verified: boolean;
  verified_at: Date;
  expires_at: Date | null;
}

export function pgAttestationStore(pool: TransactionPool & Queryable): AttestationStore {
  return {
    async attestationsFor(userId) {
      const { rows } = await pool.query<AttestationRow>(
        `SELECT provider, provider_ref, age_verified, real_person_verified, verified_at, expires_at
         FROM app.identity_attestations WHERE user_id = $1 ORDER BY verified_at`,
        [userId],
      );
      return rows.map((row): Attestation => ({
        provider: row.provider,
        providerRef: row.provider_ref,
        ageVerified: row.age_verified,
        realPersonVerified: row.real_person_verified,
        verifiedAt: row.verified_at,
        expiresAt: row.expires_at,
      }));
    },

    record(userId, attestation, context = {}) {
      return inAuditedTransaction(
        pool,
        async (tx) => {
          // Insert, or replace an older verdict for the same reference and person.
          const { rows } = await tx.db.query<{ inserted: boolean }>(
            `INSERT INTO app.identity_attestations AS a
               (user_id, provider, provider_ref, age_verified, real_person_verified, verified_at, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (provider, provider_ref) DO UPDATE SET
               age_verified = EXCLUDED.age_verified,
               real_person_verified = EXCLUDED.real_person_verified,
               verified_at = EXCLUDED.verified_at,
               expires_at = EXCLUDED.expires_at
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
