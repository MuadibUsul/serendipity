// Chat after a mutual yes, against the real schema, as serendipity_app.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrate } from "./migrations.js";
import { pgPrivacyRepository } from "./privacy.js";
import { pgRelationshipRepository } from "./relationships.js";
import type { RelationshipRepository } from "./relationships.js";
import { createLoginRole, createTestDatabase, urlFor } from "./test-db.js";
import type { TestDatabase } from "./test-db.js";

const NOW = new Date("2026-11-22T10:00:00Z");
const LATER = new Date(NOW.getTime() + 60_000);

let db: TestDatabase;
let role: Awaited<ReturnType<typeof createLoginRole>>;
let admin: pg.Pool;
let pool: pg.Pool;
let chat: RelationshipRepository;

beforeAll(async () => {
  db = await createTestDatabase();
  await migrate(db.url, "up");
  role = await createLoginRole("serendipity_app");
  admin = new pg.Pool({ connectionString: db.url });
  pool = new pg.Pool({ connectionString: urlFor(db.name, role) });
  chat = pgRelationshipRepository(pool);
});

afterAll(async () => {
  await pool.end();
  await admin.end();
  await db.drop();
  await role.drop();
});

/** Two people who both said yes, both holding the chat consent. */
async function couple(mutual = true) {
  const { rows } = await admin.query<{ id: string }>(
    "INSERT INTO app.users (status) VALUES ('active'), ('active') RETURNING id",
  );
  const [a, b] = rows.map((row) => row.id) as [string, string];
  for (const id of [a, b]) {
    await admin.query(
      `INSERT INTO app.consent_grants (user_id, scope, recipient_class, purpose, version)
       VALUES ($1, 'relationship_chat', 'relationship_peer', 'relationship_messaging', 1)`,
      [id],
    );
  }
  const date = await admin.query<{ id: string }>(
    "INSERT INTO app.dates (user_a, user_b) VALUES ($1, $2) RETURNING id",
    [a, b],
  );
  const rel = await admin.query<{ id: string }>(
    `INSERT INTO app.relationships (date_id, user_a, user_b, mutual_opt_in_at, chat_open)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [date.rows[0]?.id, a, b, mutual ? NOW : null, mutual],
  );
  return { a, b, id: rel.rows[0]?.id ?? "" };
}

describe("chat", () => {
  it("carries messages both ways, each side seeing which are theirs", async () => {
    const { a, b, id } = await couple();
    expect(await chat.send(a, id, "你好", NOW)).toMatchObject({ kind: "sent" });
    expect(await chat.send(b, id, "明天见", LATER)).toMatchObject({ kind: "sent" });
    expect((await chat.messages(a, id, null))?.map((m) => [m.mine, m.body])).toEqual([
      [true, "你好"],
      [false, "明天见"],
    ]);
    expect((await chat.messages(b, id, NOW))?.map((m) => m.body)).toEqual(["明天见"]);
    expect(await chat.forUser(a)).toEqual([{ id, chat: "open", canSend: true }]);
  });

  it("stops new messages for both when either leaves", async () => {
    const { a, b, id } = await couple();
    expect(await chat.close(b, id, "leave", NOW)).toBe(true);
    expect(await chat.send(a, id, "还在吗", LATER)).toEqual({ kind: "refused", refusal: "left" });
    expect(await chat.send(b, id, "再见", LATER)).toEqual({ kind: "refused", refusal: "left" });
    expect(await chat.forUser(a)).toEqual([{ id, chat: "closed", canSend: false }]);
  });

  it("stops new messages when either blocks", async () => {
    const { a, b, id } = await couple();
    await chat.close(a, id, "block", NOW);
    expect(await chat.send(b, id, "?", LATER)).toEqual({ kind: "refused", refusal: "blocked" });
    // The block also keeps them from being matched again (ADR-0022).
    const blocks = await admin.query(
      "SELECT 1 FROM app.user_blocks WHERE blocker_id = $1 AND blocked_id = $2",
      [a, b],
    );
    expect(blocks.rowCount).toBe(1);
  });

  it("stops new messages while either is paused, and resumes after", async () => {
    const { a, b, id } = await couple();
    await admin.query("UPDATE app.users SET status = 'paused' WHERE id = $1", [b]);
    expect(await chat.send(a, id, "hi", NOW)).toEqual({
      kind: "refused",
      refusal: "account_inactive",
    });
    expect(await chat.forUser(a)).toEqual([{ id, chat: "closed", canSend: false }]);
    await admin.query("UPDATE app.users SET status = 'active' WHERE id = $1", [b]);
    expect(await chat.send(a, id, "hi", LATER)).toMatchObject({ kind: "sent" });
  });

  it("needs the sender's chat consent, without closing chat for the other", async () => {
    const { a, b, id } = await couple();
    await admin.query("UPDATE app.consent_grants SET revoked_at = now() WHERE user_id = $1", [a]);
    expect(await chat.send(a, id, "hi", NOW)).toEqual({ kind: "refused", refusal: "no_consent" });
    expect(await chat.forUser(a)).toEqual([{ id, chat: "open", canSend: false }]);
    expect(await chat.send(b, id, "hi", NOW)).toMatchObject({ kind: "sent" });
  });

  it("is closed until both said yes", async () => {
    const { a, id } = await couple(false);
    expect(await chat.send(a, id, "hi", NOW)).toEqual({ kind: "refused", refusal: "not_mutual" });
  });

  it("is invisible to anyone else", async () => {
    const { id } = await couple();
    const stranger = await couple();
    expect(await chat.messages(stranger.a, id, null)).toBeNull();
    expect(await chat.send(stranger.a, id, "hi", NOW)).toEqual({ kind: "not_found" });
    expect(await chat.close(stranger.a, id, "block", NOW)).toBe(false);
  });

  it("refuses, in the database itself, a message into a closed chat or from an outsider", async () => {
    const { a, id } = await couple();
    const stranger = await couple();
    await expect(
      admin.query(
        "INSERT INTO app.chat_messages (relationship_id, sender_id, body) VALUES ($1, $2, 'x')",
        [id, stranger.a],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await chat.close(a, id, "leave", NOW);
    await expect(
      admin.query(
        "INSERT INTO app.chat_messages (relationship_id, sender_id, body) VALUES ($1, $2, 'x')",
        [id, a],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("audits that a message was sent, never what it said", async () => {
    const { a, id } = await couple();
    await chat.send(a, id, "秘密内容", NOW);
    const { rows } = await admin.query<{ action: string; metadata_redacted: unknown }>(
      "SELECT action, metadata_redacted FROM app.audit_events WHERE object_id = $1",
      [id],
    );
    expect(rows.map((row) => row.action)).toEqual(["relationship.message.sent"]);
    expect(JSON.stringify(rows)).not.toContain("秘密");
  });

  it("goes, messages and all, when either person deletes their account", async () => {
    const { a, b, id } = await couple();
    await chat.send(a, id, "hi", NOW);
    await chat.send(b, id, "hello", LATER);
    const privacy = pgPrivacyRepository(pool);
    await privacy.requestDeletion(b);
    expect(await privacy.claimDeletion(b)).toBe(true);
    await privacy.finalizeDeletion(b);
    const left = await admin.query("SELECT 1 FROM app.chat_messages WHERE relationship_id = $1", [
      id,
    ]);
    expect(left.rowCount).toBe(0);
    expect(await chat.forUser(a)).toEqual([]);
  });
});
