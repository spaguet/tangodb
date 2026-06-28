-- Prices: optional teacher binding (empty = all teachers)

CREATE TABLE price_teacher_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  price_id        UUID NOT NULL,
  member_id       UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, price_id, member_id),
  FOREIGN KEY (organization_id, price_id)
    REFERENCES prices (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_price_teacher_members_org_price
  ON price_teacher_members (organization_id, price_id);

CREATE INDEX idx_price_teacher_members_org_member
  ON price_teacher_members (organization_id, member_id);

ALTER TABLE price_teacher_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY price_teacher_members_select
  ON price_teacher_members FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() IN ('owner', 'director', 'admin', 'accountant', 'teacher')
  );

CREATE POLICY price_teacher_members_write_admin
  ON price_teacher_members FOR ALL TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON price_teacher_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON price_teacher_members TO service_role;
