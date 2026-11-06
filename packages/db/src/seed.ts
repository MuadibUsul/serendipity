import type { Dataset, WebhookEventRow } from "@serendipity/fixtures";
import type pg from "pg";

type Row = Record<string, unknown>;

/** Multi-row INSERT; `casts` wraps a column's placeholder, e.g. { location: "ST_GeogFromText" }. */
async function insert(
  client: pg.ClientBase,
  table: string,
  rows: readonly Row[],
  casts: Record<string, string> = {},
): Promise<void> {
  const first = rows[0];
  if (first === undefined) return;
  const columns = Object.keys(first);
  const values: unknown[] = [];
  const tuples = rows.map((row) => {
    const placeholders = columns.map((column) => {
      values.push(row[column]);
      const placeholder = `$${String(values.length)}`;
      const cast = casts[column];
      return cast === undefined ? placeholder : `${cast}(${placeholder})`;
    });
    return `(${placeholders.join(", ")})`;
  });
  await client.query(
    `INSERT INTO app.${table} (${columns.join(", ")}) VALUES ${tuples.join(", ")}`,
    values,
  );
}

/** The row for one provider callback, as `seedDataset` writes it. */
export function webhookRow(event: WebhookEventRow): Row {
  return {
    id: event.id,
    provider: event.provider,
    event_id: event.eventId,
    event_type: event.eventType,
    signature_valid: event.signatureValid,
    payload_redacted: JSON.stringify(event.payloadRedacted),
    received_at: event.receivedAt,
    processed_at: event.processedAt,
  };
}

/** Inserts one callback; the database refuses a replay of one already stored. */
export async function insertWebhookEvent(
  client: pg.ClientBase,
  event: WebhookEventRow,
): Promise<void> {
  await insert(client, "payment_webhook_events", [webhookRow(event)]);
}

/**
 * Loads a fixtures dataset into a migrated, empty database in one
 * transaction. Refuses a database that already holds users, so fixture rows
 * never mix with other data. For local development and tests only.
 */
export async function seedDataset(client: pg.ClientBase, data: Dataset): Promise<void> {
  const existing = await client.query<{ count: string }>(`SELECT count(*) FROM app.users`);
  if (existing.rows[0]?.count !== "0") {
    throw new Error("refusing to seed: app.users is not empty (seed an empty, migrated database)");
  }
  await client.query("BEGIN");
  try {
    await insert(
      client,
      "users",
      data.users.map((u) => ({
        id: u.id,
        status: u.status,
        created_at: u.createdAt,
        deleted_at: u.deletedAt,
      })),
    );
    await insert(
      client,
      "venues",
      data.venues.map((v) => ({
        id: v.id,
        name: v.name,
        region: v.region,
        address: v.address,
        location: `SRID=4326;POINT(${String(v.longitude)} ${String(v.latitude)})`,
        status: v.status,
      })),
      { location: "ST_GeogFromText" },
    );
    await insert(
      client,
      "venue_slots",
      data.venueSlots.map((s) => ({
        id: s.id,
        venue_id: s.venueId,
        starts_at: s.startsAt,
        ends_at: s.endsAt,
        capacity: s.capacity,
        reserved: s.reserved,
        status: s.status,
      })),
    );
    await insert(
      client,
      "dates",
      data.dates.map((d) => ({
        id: d.id,
        user_a: d.userA,
        user_b: d.userB,
        venue_id: d.venueId,
        venue_slot_id: d.venueSlotId,
        status: d.status,
        machine_version: d.machineVersion,
        revision: d.revision,
        machine_context: JSON.stringify(d.machineContext),
        start_at: d.startAt,
        end_at: d.endAt,
        booking_ref: d.bookingRef,
        policy_snapshot_hash: d.policySnapshotHash,
      })),
    );
    await insert(
      client,
      "date_invites",
      data.dateInvites.map((i) => ({
        id: i.id,
        date_id: i.dateId,
        user_id: i.userId,
        status: i.status,
        responded_at: i.respondedAt,
        expires_at: i.expiresAt,
      })),
    );
    await insert(
      client,
      "checkins",
      data.checkins.map((c) => ({
        id: c.id,
        date_id: c.dateId,
        user_id: c.userId,
        method: c.method,
        verified_at: c.verifiedAt,
        venue_attested: c.venueAttested,
      })),
    );
    await insert(
      client,
      "payment_orders",
      data.paymentOrders.map((o) => ({
        id: o.id,
        date_id: o.dateId,
        user_id: o.userId,
        amount_minor: o.amountMinor,
        currency: o.currency,
        state: o.state,
        provider: o.provider,
        provider_order_id: o.providerOrderId,
        idempotency_key: o.idempotencyKey,
        paid_at: o.paidAt,
      })),
    );
    await insert(client, "payment_webhook_events", data.webhookEvents.map(webhookRow));
    await insert(
      client,
      "refunds",
      data.refunds.map((r) => ({
        id: r.id,
        payment_order_id: r.paymentOrderId,
        amount_minor: r.amountMinor,
        state: r.state,
        reason: r.reason,
        requested_by: r.requestedBy,
        idempotency_key: r.idempotencyKey,
      })),
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
