-- Teacher schedule occupancy (see all busy slots at viewable locations) +
-- owner toggles: accept payments, add group lessons, add clients.

BEGIN;

-- =============================================================================
-- 1. organization_settings columns
-- =============================================================================

ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS teachers_can_accept_payments boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS teachers_can_add_group_lessons boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS teachers_can_add_clients boolean NOT NULL DEFAULT false;

UPDATE organization_settings
SET
  teachers_can_add_group_lessons = teachers_can_sell_subscriptions,
  teachers_can_add_clients = teachers_can_edit_clients
WHERE teachers_can_add_group_lessons = false
  AND teachers_can_sell_subscriptions = true;

UPDATE organization_settings
SET teachers_can_add_clients = teachers_can_edit_clients
WHERE teachers_can_add_clients = false
  AND teachers_can_edit_clients = true;

-- =============================================================================
-- 2. Setting helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION teachers_can_accept_payments_setting()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    (
      SELECT os.teachers_can_accept_payments
      FROM organization_settings os
      WHERE os.organization_id = auth_organization_id()
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION teachers_can_add_group_lessons_setting()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    (
      SELECT os.teachers_can_add_group_lessons
      FROM organization_settings os
      WHERE os.organization_id = auth_organization_id()
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION teachers_can_add_clients_setting()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    (
      SELECT os.teachers_can_add_clients
      FROM organization_settings os
      WHERE os.organization_id = auth_organization_id()
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION teacher_can_add_clients()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT teachers_can_add_clients_setting() AND teacher_has_client_write_scope();
$$;

CREATE OR REPLACE FUNCTION teacher_can_insert_schedule_slot(
  p_discipline_id uuid,
  p_location_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    teachers_can_add_group_lessons_setting()
    AND teacher_has_discipline_access(p_discipline_id)
    AND (
      p_location_id IS NULL OR teacher_has_location_access(p_location_id)
    );
$$;

REVOKE ALL ON FUNCTION teachers_can_accept_payments_setting() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION teachers_can_add_group_lessons_setting() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION teachers_can_add_clients_setting() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION teacher_can_add_clients() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION teacher_can_insert_schedule_slot(uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION teachers_can_accept_payments_setting() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION teachers_can_add_group_lessons_setting() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION teachers_can_add_clients_setting() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION teacher_can_add_clients() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION teacher_can_insert_schedule_slot(uuid, uuid) TO authenticated, service_role;

-- =============================================================================
-- 3. Payments: teachers with org flag (scoped lesson checked in RPC impl)
-- =============================================================================

CREATE OR REPLACE FUNCTION member_can_accept_payments()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    CASE current_member_role()
      WHEN 'teacher' THEN teachers_can_accept_payments_setting() AND teacher_has_any_scope()
      WHEN 'admin' THEN COALESCE(
        (
          SELECT os.admin_can_accept_payments
          FROM organization_settings os
          WHERE os.organization_id = auth_organization_id()
        ),
        true
      )
      WHEN 'owner' THEN true
      WHEN 'director' THEN true
      ELSE can_write_reception()
    END;
$$;

-- =============================================================================
-- 4. Schedule occupancy SELECT (permissive OR with scoped policies)
-- =============================================================================

CREATE POLICY schedule_slots_select_teacher_occupancy
  ON schedule_slots FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() = 'teacher'
    AND teacher_can_view_schedule_location(location_id)
  );

CREATE POLICY personal_lessons_select_teacher_occupancy
  ON personal_lessons FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() = 'teacher'
    AND cancelled_at IS NULL
    AND teacher_can_view_schedule_location(location_id)
  );

-- =============================================================================
-- 5. personal_lessons_teacher_v — all lessons at viewable locations; mask foreign PII
-- =============================================================================

DROP VIEW IF EXISTS personal_lessons_teacher_v;

CREATE VIEW personal_lessons_teacher_v
WITH (security_invoker = false) AS
SELECT
  pl.id,
  pl.organization_id,
  pl.type,
  CASE WHEN teacher_can_access_lesson(pl.id) THEN pl.client_id1 ELSE NULL END AS client_id1,
  CASE WHEN teacher_can_access_lesson(pl.id) THEN pl.client_id2 ELSE NULL END AS client_id2,
  CASE WHEN teacher_can_access_lesson(pl.id) THEN pl.client_id3 ELSE NULL END AS client_id3,
  CASE WHEN teacher_can_access_lesson(pl.id) THEN pl.client_id4 ELSE NULL END AS client_id4,
  pl.date,
  pl.time_start,
  pl.time_end,
  pl.discipline_id,
  CASE WHEN teacher_can_access_lesson(pl.id) THEN pl.subscription_id ELSE NULL END AS subscription_id,
  pl.location_id,
  pl.teacher_member_id,
  CASE WHEN teacher_can_access_lesson(pl.id) THEN pl.attendance_status ELSE NULL END AS attendance_status,
  pl.created_at,
  CASE WHEN teacher_can_access_lesson(pl.id) THEN pl.paid ELSE 'no'::text END AS paid,
  pl.cancelled_at,
  CASE WHEN teacher_can_access_lesson(pl.id) THEN pl.price_id ELSE NULL END AS price_id
FROM personal_lessons pl
WHERE pl.organization_id = auth_organization_id()
  AND business_row_readable()
  AND current_member_role() = 'teacher'
  AND teacher_can_view_schedule_location(pl.location_id);

GRANT SELECT ON personal_lessons_teacher_v TO authenticated;

-- =============================================================================
-- 6. clients INSERT — separate add vs edit flags
-- =============================================================================

DROP POLICY IF EXISTS clients_insert_teacher ON clients;

CREATE POLICY clients_insert_teacher
  ON clients FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_add_clients()
  );

-- =============================================================================
-- 7. schedule_slots teacher write — INSERT by discipline/location scope
-- =============================================================================

DROP POLICY IF EXISTS schedule_slots_write_teacher ON schedule_slots;

CREATE POLICY schedule_slots_update_teacher
  ON schedule_slots FOR UPDATE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_access_schedule_slot(id)
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_access_schedule_slot(id)
  );

CREATE POLICY schedule_slots_insert_teacher
  ON schedule_slots FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_insert_schedule_slot(discipline_id, location_id)
  );

CREATE POLICY schedule_slots_delete_teacher
  ON schedule_slots FOR DELETE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_access_schedule_slot(id)
  );

COMMIT;
