-- S09 / H21, H22, H26, H16, M19: payments and personal_lessons write only via RPC.
-- Teacher schedule reads personal_lessons_teacher_v (+ cancelled_at, price_id); INSERT sale kept.

BEGIN;

-- =============================================================================
-- 1. payments: REVOKE write; keep SELECT for operational dashboard + lesson modals
-- =============================================================================

REVOKE INSERT, UPDATE, DELETE ON payments FROM anon, authenticated;

GRANT SELECT ON payments TO authenticated;

-- =============================================================================
-- 2. personal_lessons_teacher_v: add cancelled_at + price_id (keep client_id4, paid)
-- =============================================================================

DROP VIEW IF EXISTS personal_lessons_teacher_v;

CREATE VIEW personal_lessons_teacher_v
WITH (security_invoker = false) AS
SELECT
  pl.id,
  pl.organization_id,
  pl.type,
  pl.client_id1,
  pl.client_id2,
  pl.client_id3,
  pl.client_id4,
  pl.date,
  pl.time_start,
  pl.time_end,
  pl.discipline_id,
  pl.subscription_id,
  pl.location_id,
  pl.teacher_member_id,
  pl.attendance_status,
  pl.created_at,
  pl.paid,
  pl.cancelled_at,
  pl.price_id
FROM personal_lessons pl
WHERE pl.organization_id = auth_organization_id()
  AND business_row_readable()
  AND current_member_role() = 'teacher'
  AND teacher_can_access_lesson(pl.id);

GRANT SELECT ON personal_lessons_teacher_v TO authenticated;

-- =============================================================================
-- 3. teacher personal-lesson sale guard (§9 teachers_can_sell_personal_lessons)
-- =============================================================================

CREATE OR REPLACE FUNCTION teacher_can_write_personal_lessons()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM organization_settings os
      WHERE os.organization_id = auth_organization_id()
        AND os.teachers_can_sell_personal_lessons = true
    )
    AND teacher_has_any_scope();
$$;

GRANT EXECUTE ON FUNCTION teacher_can_write_personal_lessons() TO authenticated, service_role;

-- =============================================================================
-- 4. personal_lessons: INSERT-only policies; REVOKE UPDATE/DELETE
-- =============================================================================

DROP POLICY IF EXISTS personal_lessons_write_admin ON personal_lessons;
DROP POLICY IF EXISTS personal_lessons_write_teacher ON personal_lessons;

CREATE POLICY personal_lessons_insert_admin
  ON personal_lessons FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  );

CREATE POLICY personal_lessons_insert_teacher
  ON personal_lessons FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_write_personal_lessons()
    AND teacher_has_discipline_access(discipline_id)
    AND (
      location_id IS NULL OR teacher_has_location_access(location_id)
    )
    AND (
      date >= current_date OR can_edit_past_schedule()
    )
  );

REVOKE UPDATE, DELETE ON personal_lessons FROM anon, authenticated;

COMMIT;
