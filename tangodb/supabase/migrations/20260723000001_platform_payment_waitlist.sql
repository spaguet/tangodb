-- S4: Manual payment config (public read) + subscription waitlist (service role write only)

CREATE TABLE platform_payment_methods (
  id         SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  config     JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users (id) ON DELETE SET NULL
);

INSERT INTO platform_payment_methods (id, config) VALUES (1, '{}'::jsonb);

ALTER TABLE platform_payment_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY platform_payment_methods_select_authenticated
  ON platform_payment_methods
  FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON platform_payment_methods TO authenticated;

CREATE TABLE platform_waitlist (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL,
  organization_id UUID REFERENCES organizations (id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_platform_waitlist_email_created
  ON platform_waitlist (lower(email), created_at DESC);

CREATE INDEX idx_platform_waitlist_org
  ON platform_waitlist (organization_id)
  WHERE organization_id IS NOT NULL;

ALTER TABLE platform_waitlist ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON platform_waitlist FROM anon, authenticated;
