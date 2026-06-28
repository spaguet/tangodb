-- Platform purchase inbox: CRM payment verification requests for Dev Console.

CREATE TABLE platform_purchase_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  requester_user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  requester_email   TEXT,
  organization_name TEXT NOT NULL,
  contact_email     TEXT,
  contact_telegram  TEXT,
  payment_comment   TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'activated', 'closed')),
  email_sent        BOOLEAN NOT NULL DEFAULT false,
  access_key_id     UUID REFERENCES access_keys (id),
  activated_by      UUID REFERENCES auth.users (id),
  activated_at      TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_platform_purchase_requests_status_created
  ON platform_purchase_requests (status, created_at DESC);

CREATE INDEX idx_platform_purchase_requests_org
  ON platform_purchase_requests (organization_id, created_at DESC);

ALTER TABLE platform_purchase_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY platform_purchase_requests_insert_owner_director
  ON platform_purchase_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    requester_user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM organization_members om
      WHERE om.organization_id = platform_purchase_requests.organization_id
        AND om.user_id = auth.uid()
        AND om.is_active
        AND om.role IN ('owner', 'director')
    )
  );

GRANT INSERT ON platform_purchase_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_purchase_requests TO service_role;
