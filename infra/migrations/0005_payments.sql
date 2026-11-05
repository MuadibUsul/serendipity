-- Payment orders, provider callbacks and refunds (ARCH-001 §8.2). The
-- platform records orders and states only; money is held by the licensed
-- provider, never in a platform balance (ADR-005).

-- Up Migration

CREATE TABLE app.payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date_id uuid NOT NULL REFERENCES app.dates (id),
  user_id uuid NOT NULL REFERENCES app.users (id),
  amount_minor bigint NOT NULL CONSTRAINT payment_orders_amount_check CHECK (amount_minor > 0),
  currency char(3) NOT NULL CONSTRAINT payment_orders_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  state text NOT NULL DEFAULT 'PAYMENT_CREATED'
    CONSTRAINT payment_orders_state_check CHECK (state IN (
      'PAYMENT_CREATED', 'REQUIRES_ACTION', 'PAID', 'FAILED', 'EXPIRED',
      'REFUND_REQUESTED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'DISPUTED')),
  provider text NOT NULL,
  provider_order_id text,
  -- hash(date_id, user_id, operation, operation_version) (ARCH-001 §8.2).
  idempotency_key text NOT NULL CONSTRAINT payment_orders_idempotency_key_key UNIQUE,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_orders_provider_order_key UNIQUE (provider, provider_order_id),
  CONSTRAINT payment_orders_paid_at_check CHECK (
    paid_at IS NOT NULL OR state NOT IN ('PAID', 'REFUND_REQUESTED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'DISPUTED'))
);
CREATE INDEX payment_orders_date_idx ON app.payment_orders (date_id);
-- One live order per person and date: a retry is possible only after a failure or expiry.
CREATE UNIQUE INDEX payment_orders_one_live_idx
  ON app.payment_orders (date_id, user_id) WHERE state NOT IN ('FAILED', 'EXPIRED');

CREATE TABLE app.payment_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  signature_valid boolean NOT NULL,
  -- Card, account and personal fields removed before storage.
  payload_redacted jsonb NOT NULL DEFAULT '{}',
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  -- A replayed or duplicate callback is stored once (PLAN-001 §8.2).
  CONSTRAINT payment_webhook_events_provider_event_id_key UNIQUE (provider, event_id)
);
CREATE INDEX payment_webhook_events_unprocessed_idx
  ON app.payment_webhook_events (received_at) WHERE processed_at IS NULL;

CREATE TABLE app.refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_order_id uuid NOT NULL REFERENCES app.payment_orders (id),
  amount_minor bigint NOT NULL CONSTRAINT refunds_amount_check CHECK (amount_minor > 0),
  state text NOT NULL DEFAULT 'REQUESTED'
    CONSTRAINT refunds_state_check CHECK (state IN ('REQUESTED', 'PENDING', 'SUCCEEDED', 'FAILED')),
  reason text NOT NULL,
  -- Who asked: a person or a verified system, never a model (ARCH-001 §10.3).
  requested_by text NOT NULL CONSTRAINT refunds_requested_by_check CHECK (requested_by IN ('user', 'staff', 'system')),
  provider_refund_id text,
  idempotency_key text NOT NULL CONSTRAINT refunds_idempotency_key_key UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  CONSTRAINT refunds_settled_check CHECK ((state IN ('SUCCEEDED', 'FAILED')) = (settled_at IS NOT NULL))
);
CREATE INDEX refunds_payment_order_idx ON app.refunds (payment_order_id);

-- Down Migration

DROP TABLE app.refunds;
DROP TABLE app.payment_webhook_events;
DROP TABLE app.payment_orders;
