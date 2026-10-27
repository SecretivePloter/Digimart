ALTER TABLE admins ADD COLUMN password_hash text;
ALTER TABLE products ADD COLUMN revision integer NOT NULL DEFAULT 1;
CREATE TABLE catalog_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id bigint NOT NULL REFERENCES products(id),
  actor text NOT NULL,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
