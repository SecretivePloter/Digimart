CREATE TABLE admin_ai_chats (
  phone text PRIMARY KEY REFERENCES admins(wa_number) ON DELETE CASCADE,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
