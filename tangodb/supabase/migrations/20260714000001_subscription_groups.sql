-- Link group subscriptions to specific schedule groups (location + group_name + discipline).

CREATE TABLE subscription_groups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL,
  group_name      TEXT NOT NULL DEFAULT '',
  discipline_id   UUID NOT NULL,
  location_id     UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, subscription_id)
    REFERENCES subscriptions (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, discipline_id)
    REFERENCES disciplines (organization_id, id),
  FOREIGN KEY (organization_id, location_id)
    REFERENCES locations (organization_id, id)
);

CREATE UNIQUE INDEX subscription_groups_link_unique
  ON subscription_groups (
    organization_id,
    subscription_id,
    discipline_id,
    COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(trim(group_name))
  );

CREATE INDEX idx_subscription_groups_org_sub
  ON subscription_groups (organization_id, subscription_id);

ALTER TABLE subscription_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY subscription_groups_select_full_access
  ON subscription_groups FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_all_business()
  );

CREATE POLICY subscription_groups_select_teacher
  ON subscription_groups FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() = 'teacher'
    AND teacher_can_access_subscription(subscription_id)
  );

CREATE POLICY subscription_groups_write_admin
  ON subscription_groups FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  );

CREATE POLICY subscription_groups_update_admin
  ON subscription_groups FOR UPDATE TO authenticated
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

CREATE POLICY subscription_groups_delete_admin
  ON subscription_groups FOR DELETE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  );

CREATE POLICY subscription_groups_insert_teacher
  ON subscription_groups FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_access_subscription(subscription_id)
  );

CREATE POLICY subscription_groups_delete_teacher
  ON subscription_groups FOR DELETE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_access_subscription(subscription_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON subscription_groups TO authenticated;
