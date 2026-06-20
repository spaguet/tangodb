-- TangoDB v2 RBAC-3: teacher subscriptions write guard (§9 teachers_can_sell_subscriptions)
-- Ref: CODE_REVIEW_ROLES.md RBAC-3, tangodb_roles_rbac_TZ.md §9/§10.2

BEGIN;

CREATE OR REPLACE FUNCTION teacher_can_write_subscriptions()
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
        AND os.teachers_can_sell_subscriptions = true
    )
    AND teacher_has_any_scope();
$$;

DROP POLICY IF EXISTS subscriptions_insert_teacher ON subscriptions;
DROP POLICY IF EXISTS subscriptions_update_teacher ON subscriptions;
DROP POLICY IF EXISTS subscriptions_delete_teacher ON subscriptions;

CREATE POLICY subscriptions_insert_teacher
  ON subscriptions FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_write_subscriptions()
    AND teacher_has_discipline_access(discipline_id)
  );

CREATE POLICY subscriptions_update_teacher
  ON subscriptions FOR UPDATE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_write_subscriptions()
    AND teacher_can_access_subscription(id)
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_write_subscriptions()
    AND teacher_can_access_subscription(id)
  );

CREATE POLICY subscriptions_delete_teacher
  ON subscriptions FOR DELETE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_write_subscriptions()
    AND teacher_can_access_subscription(id)
  );

GRANT EXECUTE ON FUNCTION teacher_can_write_subscriptions() TO authenticated, service_role;

COMMIT;
