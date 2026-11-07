CREATE TABLE admin_ai_mode (
  phone text PRIMARY KEY REFERENCES admins(wa_number) ON DELETE CASCADE,
  last_activity timestamptz NOT NULL DEFAULT now()
);
