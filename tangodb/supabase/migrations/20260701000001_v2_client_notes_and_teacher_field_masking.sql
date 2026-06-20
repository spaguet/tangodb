-- TangoDB v2 RBAC R4: client_notes + teacher field masking (SQL views)
-- Ref: tangodb_roles_rbac_TZ.md §7 R4

BEGIN;

-- =============================================================================
-- 1. Client notes
-- =============================================================================

CREATE TABLE client_notes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  client_id         UUID NOT NULL,
  author_member_id  UUID NOT NULL,
  body              TEXT NOT NULL CHECK (length(trim(body)) > 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, client_id)
    REFERENCES clients (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, author_member_id)
    REFERENCES organization_members (organization_id, id)
);

CREATE INDEX idx_client_notes_org_client
  ON client_notes (organization_id, client_id, created_at DESC);

CREATE TRIGGER audit_client_notes
  AFTER INSERT OR UPDATE OR DELETE ON client_notes
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

ALTER TABLE client_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY client_notes_select_operational
  ON client_notes FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_operational()
  );

CREATE POLICY client_notes_select_teacher
  ON client_notes FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() = 'teacher'
    AND author_member_id = auth_member_id()
    AND teacher_can_access_client(client_id)
  );

CREATE POLICY client_notes_insert_operational
  ON client_notes FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
    AND author_member_id = auth_member_id()
  );

CREATE POLICY client_notes_insert_teacher
  ON client_notes FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND author_member_id = auth_member_id()
    AND teacher_can_access_client(client_id)
  );

CREATE POLICY client_notes_update_operational
  ON client_notes FOR UPDATE TO authenticated
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

CREATE POLICY client_notes_update_teacher
  ON client_notes FOR UPDATE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND author_member_id = auth_member_id()
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND author_member_id = auth_member_id()
  );

CREATE POLICY client_notes_delete_operational
  ON client_notes FOR DELETE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  );

CREATE POLICY client_notes_delete_teacher
  ON client_notes FOR DELETE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND author_member_id = auth_member_id()
  );

-- =============================================================================
-- 2. Teacher-safe views (no financial columns; defense in depth over R1 hooks)
-- =============================================================================

DROP POLICY IF EXISTS subscriptions_select_teacher ON subscriptions;

CREATE OR REPLACE VIEW subscriptions_teacher_v
WITH (security_invoker = false) AS
SELECT
  s.id,
  s.organization_id,
  s.type,
  s.client_id1,
  s.client_id2,
  s.client_id3,
  s.lessons_total,
  s.lessons_left,
  s.freeze_used,
  s.activation_date,
  s.status,
  s.pair_month,
  s.discipline_id,
  s.class_id,
  s.category,
  s.created_at
FROM subscriptions s
WHERE s.organization_id = auth_organization_id()
  AND business_row_readable()
  AND current_member_role() = 'teacher'
  AND teacher_can_access_subscription(s.id);

DROP POLICY IF EXISTS personal_lessons_select_teacher ON personal_lessons;

CREATE OR REPLACE VIEW personal_lessons_teacher_v
WITH (security_invoker = false) AS
SELECT
  pl.id,
  pl.organization_id,
  pl.type,
  pl.client_id1,
  pl.client_id2,
  pl.client_id3,
  pl.date,
  pl.time_start,
  pl.time_end,
  pl.discipline_id,
  pl.subscription_id,
  pl.location_id,
  pl.teacher_member_id,
  pl.attendance_status,
  pl.created_at
FROM personal_lessons pl
WHERE pl.organization_id = auth_organization_id()
  AND business_row_readable()
  AND current_member_role() = 'teacher'
  AND teacher_can_access_lesson(pl.id);

GRANT SELECT ON subscriptions_teacher_v TO authenticated;
GRANT SELECT ON personal_lessons_teacher_v TO authenticated;

COMMIT;
