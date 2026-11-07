ALTER TABLE orders ADD COLUMN payment_environment text NOT NULL DEFAULT 'sandbox'
  CHECK (payment_environment IN ('sandbox','production'));
ALTER TABLE orders ADD COLUMN warranty_days_snapshot integer NOT NULL DEFAULT 0 CHECK (warranty_days_snapshot >= 0);
ALTER TABLE orders ADD COLUMN requires_email_snapshot boolean NOT NULL DEFAULT false;
UPDATE orders o SET warranty_days_snapshot=v.warranty_days, requires_email_snapshot=v.requires_email
  FROM variants v WHERE v.id=o.variant_id;
ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN (
  'awaiting_stock','payment_setup','awaiting_payment','paid','awaiting_customer_data',
  'processing','completed','stock_rejected','expired','failed_processing','cancelled','payment_failed'));
ALTER TABLE conversation_states ADD COLUMN fulfillment_email text;
ALTER TABLE conversation_states ADD COLUMN quoted_total_idr bigint;
ALTER TABLE orders ADD COLUMN payment_checked_at timestamptz;
CREATE TABLE incoming_messages (
  message_id text NOT NULL, sender text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(sender,message_id)
);
CREATE INDEX incoming_messages_received_idx ON incoming_messages(received_at);
ALTER TABLE message_outbox ADD COLUMN claimed_at timestamptz;
