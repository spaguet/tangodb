-- TangoDB v2 RBAC-8: sync can_export_data() with §9 org overrides
-- Ref: CODE_REVIEW_ROLES.md RBAC-8, tangodb_roles_rbac_TZ.md §8/§9

BEGIN;

CREATE OR REPLACE FUNCTION teacher_has_any_scope()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    COALESCE((auth_teacher_scope() ->> 'all_disciplines')::boolean, false)
    OR COALESCE((auth_teacher_scope() ->> 'all_locations')::boolean, false)
    OR jsonb_array_length(COALESCE(auth_teacher_scope() -> 'discipline_ids', '[]'::jsonb)) > 0
    OR jsonb_array_length(COALESCE(auth_teacher_scope() -> 'location_ids', '[]'::jsonb)) > 0;
$$;

-- Operational dashboard export only (not financial — see can_export_financial())
CREATE OR REPLACE FUNCTION can_export_data()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT
    current_member_role() IN ('owner', 'director')
    OR (
      current_member_role() = 'admin'
      AND EXISTS (
        SELECT 1
        FROM organization_settings os
        WHERE os.organization_id = auth_organization_id()
          AND os.admin_can_export = true
      )
    )
    OR (
      current_member_role() = 'teacher'
      AND EXISTS (
        SELECT 1
        FROM organization_settings os
        WHERE os.organization_id = auth_organization_id()
          AND os.teachers_can_export = true
      )
      AND teacher_has_any_scope()
    );
$$;

GRANT EXECUTE ON FUNCTION teacher_has_any_scope() TO authenticated, service_role;

COMMIT;
