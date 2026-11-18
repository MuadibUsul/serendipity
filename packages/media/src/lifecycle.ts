import { defineLifecycle } from "@serendipity/domain";

export const MEDIA_STATUSES = ["pending", "active", "expired", "deleted"] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

/**
 * How a matching photo moves (`app.media_assets.status`): `pending` from the
 * upload intent until the verified upload makes it `active`; it is `deleted`
 * (bytes, derivatives and row status) by the owner or the clean-up job.
 * `expired` marks a photo past its retention before clean-up runs; no code
 * writes it yet (clean-up deletes expired photos directly), but the column
 * allows it, so the table keeps its place. `deleted` is final.
 */
export const MEDIA_LIFECYCLE = defineLifecycle({
  name: "app.media_assets.status",
  states: MEDIA_STATUSES,
  initial: "pending",
  transitions: {
    pending: ["active", "expired", "deleted"],
    active: ["expired", "deleted"],
    expired: ["deleted"],
    deleted: [],
  },
});
