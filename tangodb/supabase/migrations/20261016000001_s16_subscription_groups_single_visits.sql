-- S16 / H19, M30, H20, H32: subscription_groups teacher sales flag; single_visits write only via RPC;
-- teacher reads drop-in journal through masking view (no amount/method/price_id).

BEGIN;

-- =============================================================================
-- 1. subscription_groups: teacher INSERT/DELETE require teachers_can_sell_subscriptions
-- =============================================================================

DROP POLICY IF EXISTS subscription_groups_insert_teacher ON subscription_groups;

CREATE POLICY subscription_groups_insert_teacher
  ON subscription_groups FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_write_subscriptions()
    AND teacher_can_access_subscription(subscription_id)
  );

DROP POLICY IF EXISTS subscription_groups_delete_teacher ON subscription_groups;

CREATE POLICY subscription_groups_delete_teacher
  ON subscription_groups FOR DELETE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_write_subscriptions()
    AND teacher_can_access_subscription(subscription_id)
  );

-- =============================================================================
-- 2. single_visits: write only through record_single_visit (checks admin_can_record_single_visits)
-- =============================================================================

REVOKE INSERT, UPDATE, DELETE ON single_visits FROM anon, authenticated;

GRANT SELECT ON single_visits TO authenticated;

-- =============================================================================
-- 3. single_visits_teacher_v: journal without financial columns (H32 / R4)
-- =============================================================================

DROP VIEW IF EXISTS single_visits_teacher_v;

CREATE VIEW single_visits_teacher_v
WITH (security_invoker = false) AS
SELECT
  sv.id,
  sv.organization_id,
  sv.visit_date,
  sv.schedule_slot_id,
  sv.schedule_group_id,
  sv.client_id,
  sv.client_display,
  sv.attendance_status,
  sv.location_id,
  sv.discipline_id,
  sv.teacher_member_id,
  sv.created_at
FROM single_visits sv
WHERE sv.organization_id = auth_organization_id()
  AND business_row_readable()
  AND current_member_role() = 'teacher'
  AND (
    sv.teacher_member_id = auth_member_id()
    OR teacher_has_discipline_access(sv.discipline_id)
    OR teacher_has_location_access(sv.location_id)
  );

GRANT SELECT ON single_visits_teacher_v TO authenticated;

-- =============================================================================
-- 4. Base table SELECT: operational/financial roles only (teacher uses view)
-- =============================================================================

DROP POLICY IF EXISTS single_visits_select_operational_financial ON single_visits;

CREATE POLICY single_visits_select_operational_financial
  ON single_visits FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND (
      can_read_operational()
      OR can_read_financial()
    )
  );

COMMIT;
