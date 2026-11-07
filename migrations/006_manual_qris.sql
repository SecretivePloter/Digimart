ALTER TABLE orders ADD COLUMN payment_status text NOT NULL DEFAULT 'pending'
  CHECK (payment_status IN ('pending','awaiting_verification','paid','rejected','review_required'));
ALTER TABLE orders ADD COLUMN fulfillment_status text NOT NULL DEFAULT 'pending'
  CHECK (fulfillment_status IN ('pending','processing','completed','cancelled'));
UPDATE orders SET payment_status=CASE
  WHEN paid_at IS NOT NULL THEN 'paid'
  WHEN status IN ('awaiting_customer_data','processing','completed','paid') THEN 'review_required'
  WHEN status IN ('expired','cancelled','payment_failed','failed_processing') THEN 'rejected'
  ELSE 'pending' END,
 fulfillment_status=CASE WHEN status='completed' THEN 'completed'
   WHEN status IN ('processing','paid','awaiting_customer_data') THEN 'processing'
   WHEN status IN ('cancelled','stock_rejected') THEN 'cancelled' ELSE 'pending' END;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_provider_check;
ALTER TABLE payments ADD CONSTRAINT payments_provider_check CHECK (provider IN ('midtrans','qris_manual'));
ALTER TABLE orders DROP CONSTRAINT orders_payment_environment_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_environment_check CHECK (payment_environment IN ('sandbox','production','qris_manual'));
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_order_id_provider_key;
ALTER TABLE payments ADD CONSTRAINT payments_order_id_provider_key UNIQUE(order_id,provider);
CREATE TABLE manual_payment_reviews (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 order_id bigint NOT NULL REFERENCES orders(id),
 customer_id bigint NOT NULL REFERENCES customers(id),
 evidence_path text,
 evidence_mime text,
 evidence_sha256 text,
 evidence_size bigint CHECK(evidence_size IS NULL OR evidence_size BETWEEN 1 AND 5242880),
 state text NOT NULL CHECK(state IN('submitted','approved','rejected','review_required')),
 submitted_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz,
 reviewed_by_admin_id bigint REFERENCES admins(id),
 review_reason text,
 merchant_reference text,
 amount_idr bigint NOT NULL CHECK(amount_idr>0),
 UNIQUE(order_id),
 CHECK (state<>'approved' OR (reviewed_at IS NOT NULL AND reviewed_by_admin_id IS NOT NULL AND merchant_reference IS NOT NULL))
);
CREATE UNIQUE INDEX manual_payment_merchant_reference_unique ON manual_payment_reviews(lower(btrim(merchant_reference))) WHERE merchant_reference IS NOT NULL;
CREATE UNIQUE INDEX manual_payment_evidence_approved_unique ON manual_payment_reviews(evidence_sha256) WHERE state='approved';
CREATE INDEX manual_payment_review_queue_idx ON manual_payment_reviews(submitted_at) WHERE state IN ('submitted','review_required');
ALTER TABLE orders ADD COLUMN fulfillment_snapshot text NOT NULL DEFAULT '';
UPDATE orders SET fulfillment_snapshot=terms_snapshot;
