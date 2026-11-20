// Tiered age and real-person checks against the real schema (ADR-0024): the
// date of birth, liveness and ID verdicts, and the decision the identity
// service (and recall) take from them.
import { createFakeIdentityProvider, createIdentityService } from "@serendipity/identity";
import type { IdentityService } from "@serendipity/identity";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pgAccountRepository } from "./account.js";
import { pgAttestationStore } from "./identity.js";
import { migrate } from "./migrations.js";
import { pgSafetyRepository } from "./safety.js";
import { createLoginRole, createTestDatabase, urlFor } from "./test-db.js";
import type { TestDatabase } from "./test-db.js";

const NOW = new Date("2026-11-20T18:00:00Z");
const TODAY = "2026-11-20";
const SECRET = "s".repeat(32);

let db: TestDatabase;
let role: Awaited<ReturnType<typeof createLoginRole>>;
let admin: pg.Pool;
let pool: pg.Pool;
let identity: IdentityService;
let provider: ReturnType<typeof createFakeIdentityProvider>;

beforeAll(async () => {
  db = await createTestDatabase();
  await migrate(db.url, "up");
  role = await createLoginRole("serendipity_app");
  admin = new pg.Pool({ connectionString: db.url });
  pool = new pg.Pool({ connectionString: urlFor(db.name, role) });
  provider = createFakeIdentityProvider({ env: "test", secret: SECRET });
  identity = createIdentityService({ provider, store: pgAttestationStore(pool), now: () => NOW });
});

afterAll(async () => {
  await pool.end();
  await admin.end();
  await db.drop();
  await role.drop();
});

async function person(birthDate: string | null = "1995-06-15"): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    "INSERT INTO app.users (status, birth_date) VALUES ('active', $1) RETURNING id",
    [birthDate],
  );
  return rows[0]?.id ?? "";
}

/** Runs one check through the fake vendor and its signed callback. */
async function check(
  userId: string,
  outcome: Parameters<typeof provider.complete>[2],
): Promise<void> {
  const session = await provider.start(userId, outcome?.level ?? "document");
  const callback = provider.complete(session.providerRef, NOW, outcome);
  await identity.handleCallback(callback.headers, callback.body);
}

const liveness = (estimatedAge: number, faceMatch = true) => ({
  level: "liveness" as const,
  estimatedAge,
  faceMatch,
  ageVerified: false,
  realPersonVerified: true,
  validDays: 365,
});

describe("date of birth", () => {
  it("is recorded once, 18 and over only, and never audited", async () => {
    const accounts = pgAccountRepository(pool);
    const id = await person(null);
    expect(await accounts.setBirthDate(id, "2010-03-01", TODAY)).toEqual({
      kind: "refused",
      refusal: "under_age",
    });
    expect(await accounts.setBirthDate(id, "1995-06-15", TODAY)).toEqual({ kind: "recorded" });
    expect(await accounts.setBirthDate(id, "1994-06-15", TODAY)).toEqual({
      kind: "refused",
      refusal: "already_set",
    });
    const { rows } = await admin.query<{ birth_date: string }>(
      "SELECT to_char(birth_date, 'YYYY-MM-DD') AS birth_date FROM app.users WHERE id = $1",
      [id],
    );
    expect(rows[0]?.birth_date).toBe("1995-06-15");
    const audits = await admin.query(
      "SELECT metadata_redacted FROM app.audit_events WHERE object_id = $1",
      [id],
    );
    expect(JSON.stringify(audits.rows)).not.toMatch(/1995|2010|1994/);
  });
});

describe("tiered decision", () => {
  it("needs a check first, then accepts a liveness pass that fits the declared age", async () => {
    const id = await person("1995-06-15");
    expect(await identity.eligible(id)).toEqual({ eligible: false, reason: "not_verified" });
    await check(id, liveness(32));
    expect(await identity.eligible(id)).toMatchObject({ eligible: true });
  });

  it("asks for an ID when the estimate is young, and accepts once the ID passes", async () => {
    const id = await person("2005-01-10");
    await check(id, liveness(21));
    expect(await identity.eligible(id)).toEqual({
      eligible: false,
      reason: "document_required",
      because: "age_estimate_low",
    });
    await check(id, { ageVerified: true, realPersonVerified: true, validDays: 365 });
    expect(await identity.eligible(id)).toMatchObject({ eligible: true });
  });

  it("asks for an ID when a report suspects a minor, even after a good liveness check", async () => {
    const id = await person("1995-06-15");
    const reporter = await person();
    await check(id, liveness(31));
    const date = await admin.query<{ id: string }>(
      "INSERT INTO app.dates (user_a, user_b, status) VALUES ($1, $2, 'CLOSED') RETURNING id",
      [reporter, id],
    );
    await pgSafetyRepository(pool).report(
      reporter,
      date.rows[0]?.id ?? "",
      "minor_suspected",
      null,
      NOW,
    );
    expect(await identity.eligible(id)).toEqual({
      eligible: false,
      reason: "document_required",
      because: "minor_suspected",
    });
  });

  it("refuses, in the database, a liveness verdict that claims to prove age", async () => {
    const id = await person();
    await expect(
      admin.query(
        `INSERT INTO app.identity_attestations
           (user_id, provider, provider_ref, age_verified, real_person_verified, verified_at, level)
         VALUES ($1, 'fake', 'fake_ref_live01', true, true, now(), 'liveness')`,
        [id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
