-- TangoDB v2 RBAC-6: admin disciplines write guard
-- Ref: CODE_REVIEW_ROLES.md RBAC-6, tangodb_roles_rbac_TZ.md §4 (направления через /settings/*)

BEGIN;

CREATE OR REPLACE FUNCTION can_manage_disciplines()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT current_member_role() IN ('owner', 'director');
$$;

DROP POLICY IF EXISTS disciplines_write_admin ON disciplines;
DROP POLICY IF EXISTS disciplines_update_admin ON disciplines;
DROP POLICY IF EXISTS disciplines_delete_admin ON disciplines;

CREATE POLICY disciplines_write_strategic
  ON disciplines FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_manage_disciplines()
  );

CREATE POLICY disciplines_update_strategic
  ON disciplines FOR UPDATE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_manage_disciplines()
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_manage_disciplines()
  );

CREATE POLICY disciplines_delete_strategic
  ON disciplines FOR DELETE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_manage_disciplines()
  );

GRANT EXECUTE ON FUNCTION can_manage_disciplines() TO authenticated, service_role;

COMMIT;
