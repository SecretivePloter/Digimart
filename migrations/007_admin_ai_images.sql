CREATE TABLE admin_ai_images (
  phone text PRIMARY KEY REFERENCES admins(wa_number) ON DELETE CASCADE,
  data bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 8388608),
  media_type text NOT NULL CHECK (media_type IN ('image/png','image/jpeg','image/webp')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
