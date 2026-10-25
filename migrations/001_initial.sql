CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wa_number text NOT NULL UNIQUE CHECK (wa_number ~ '^[1-9][0-9]{7,14}$'),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admins (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wa_number text NOT NULL UNIQUE CHECK (wa_number ~ '^[1-9][0-9]{7,14}$'),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  catalog_number integer NOT NULL UNIQUE CHECK (catalog_number > 0),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  terms text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE variants (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id bigint NOT NULL REFERENCES products(id),
  name text NOT NULL,
  base_price_idr bigint NOT NULL CHECK (base_price_idr >= 0),
  stock_status text NOT NULL DEFAULT 'ready'
    CHECK (stock_status IN ('ready', 'limited', 'out')),
  warranty_days integer NOT NULL DEFAULT 0 CHECK (warranty_days >= 0),
  requires_email boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, name)
);

CREATE TABLE orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id text NOT NULL UNIQUE,
  customer_id bigint NOT NULL REFERENCES customers(id),
  variant_id bigint NOT NULL REFERENCES variants(id),
  product_name_snapshot text NOT NULL,
  variant_name_snapshot text NOT NULL,
  terms_snapshot text NOT NULL,
  base_price_idr bigint NOT NULL CHECK (base_price_idr >= 0),
  payment_fee_idr bigint NOT NULL DEFAULT 0 CHECK (payment_fee_idr >= 0),
  total_idr bigint GENERATED ALWAYS AS (base_price_idr + payment_fee_idr) STORED,
  gateway_fee_idr bigint CHECK (gateway_fee_idr >= 0),
  net_received_idr bigint GENERATED ALWAYS AS
    (CASE WHEN gateway_fee_idr IS NULL THEN NULL
      ELSE base_price_idr + payment_fee_idr - gateway_fee_idr END) STORED,
  status text NOT NULL CHECK (status IN (
    'awaiting_stock', 'awaiting_payment', 'paid',
    'awaiting_customer_data', 'processing', 'completed',
    'stock_rejected', 'expired', 'failed_processing'
  )),
  fulfillment_email text,
  failure_reason text,
  completed_by_admin_id bigint REFERENCES admins(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  completed_at timestamptz,
  warranty_starts_at timestamptz,
  warranty_ends_at timestamptz,
  CHECK (warranty_ends_at IS NULL OR
    (warranty_starts_at IS NOT NULL AND warranty_ends_at >= warranty_starts_at)),
  CHECK (status <> 'completed' OR
    (completed_at IS NOT NULL AND completed_by_admin_id IS NOT NULL))
);
CREATE INDEX orders_customer_created_idx ON orders (customer_id, created_at DESC);
CREATE INDEX orders_status_created_idx ON orders (status, created_at DESC);
CREATE INDEX orders_paid_at_idx ON orders (paid_at) WHERE paid_at IS NOT NULL;
CREATE INDEX orders_warranty_ends_idx ON orders (warranty_ends_at)
  WHERE warranty_ends_at IS NOT NULL;

CREATE TABLE payments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES orders(id),
  provider text NOT NULL DEFAULT 'midtrans' CHECK (provider = 'midtrans'),
  provider_transaction_id text UNIQUE,
  status text NOT NULL CHECK (status IN ('pending', 'settlement', 'expire', 'cancel', 'deny', 'refund')),
  amount_idr bigint NOT NULL CHECK (amount_idr > 0),
  qr_code_url text,
  expires_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, provider)
);

CREATE TABLE order_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES orders(id),
  event_type text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('customer', 'admin', 'midtrans', 'system')),
  actor_ref text,
  reason text,
  external_event_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_events_order_created_idx ON order_events (order_id, created_at);

CREATE TABLE conversation_states (
  customer_id bigint PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  selected_product_id bigint REFERENCES products(id),
  selected_variant_id bigint REFERENCES variants(id),
  step text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE message_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recipient_wa_number text NOT NULL,
  message_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_outbox_pending_idx ON message_outbox (next_attempt_at)
  WHERE status IN ('pending', 'failed');
