-- TangoDB v2 RBAC R2: role refinement, split operational/financial read helpers, policy updates
-- Ref: tangodb_roles_rbac_TZ.md §3.4, §6.2, §7 R2, §8

BEGIN;

-- =============================================================================
-- 0. Data migration: existing admins → owner (before RLS tightening)
-- =============================================================================

UPDATE organization_members
SET role = 'owner'
WHERE role = 'admin';

-- =============================================================================
-- 1. Tenant helpers: settings/team — owner and director only
-- =============================================================================

CREATE OR REPLACE FUNCTION can_manage_settings()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT current_member_role() IN ('owner', 'director');
$$;

CREATE OR REPLACE FUNCTION can_manage_team()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT current_member_role() IN ('owner', 'director');
$$;

-- =============================================================================
-- 2. Operational / financial read split
-- =============================================================================

CREATE OR REPLACE FUNCTION can_read_operational()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT current_member_role() IN ('owner', 'director', 'admin');
$$;

CREATE OR REPLACE FUNCTION can_read_financial()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT current_member_role() IN ('owner', 'director', 'accountant');
$$;

CREATE OR REPLACE FUNCTION can_read_prices()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT current_member_role() IN ('owner', 'director', 'admin', 'accountant');
$$;

CREATE OR REPLACE FUNCTION can_manage_prices()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT current_member_role() IN ('owner', 'director');
$$;

CREATE OR REPLACE FUNCTION can_export_financial()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT current_member_role() IN ('owner', 'director', 'accountant');
$$;

-- Legacy alias: operational CRM read only (not finance, not accountant)
CREATE OR REPLACE FUNCTION can_read_all_business()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT can_read_operational();
$$;

-- Export: owner/director/accountant (+ scoped teacher); admin removed
CREATE OR REPLACE FUNCTION can_export_data()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT can_export_financial()
    OR (
      current_member_role() = 'teacher'
      AND (
        COALESCE((auth_teacher_scope() ->> 'all_disciplines')::boolean, false)
        OR jsonb_array_length(COALESCE(auth_teacher_scope() -> 'discipline_ids', '[]'::jsonb)) > 0
      )
    );
$$;

-- =============================================================================
-- 3. Team invite helpers: admin cannot invite or manage members
-- =============================================================================

CREATE OR REPLACE FUNCTION inviter_can_assign_role(p_inviter_role text, p_target_role text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_target_role IN ('owner', 'director') THEN false
    WHEN p_inviter_role IN ('owner', 'director') THEN p_target_role IN ('admin', 'teacher', 'accountant')
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION inviter_can_manage_member(p_inviter_role text, p_target_role text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_inviter_role IN ('owner', 'director') THEN p_target_role <> 'owner' OR p_inviter_role = 'owner'
    ELSE false
  END;
$$;

-- =============================================================================
-- 4. Business SELECT policies: operational split (accountant denied on CRM)
-- =============================================================================

DROP POLICY IF EXISTS clients_select_full_access ON clients;
CREATE POLICY clients_select_full_access
  ON clients FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_operational()
  );

DROP POLICY IF EXISTS disciplines_select_full_access ON disciplines;
CREATE POLICY disciplines_select_full_access
  ON disciplines FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_operational()
  );

DROP POLICY IF EXISTS locations_select_full_access ON locations;
CREATE POLICY locations_select_full_access
  ON locations FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_operational()
  );

DROP POLICY IF EXISTS classes_select_full_access ON classes;
CREATE POLICY classes_select_full_access
  ON classes FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_operational()
  );

DROP POLICY IF EXISTS class_teachers_select_full_access ON class_teachers;
CREATE POLICY class_teachers_select_full_access
  ON class_teachers FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_operational()
  );

DROP POLICY IF EXISTS subscriptions_select_full_access ON subscriptions;
CREATE POLICY subscriptions_select_full_access
  ON subscriptions FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_operational()
  );

DROP POLICY IF EXISTS attendance_select_full_access ON attendance;
CREATE POLICY attendance_select_full_access
  ON attendance FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_operational()
  );

DROP POLICY IF EXISTS personal_lessons_select_full_access ON personal_lessons;
CREATE POLICY personal_lessons_select_full_access
  ON personal_lessons FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_operational()
  );

DROP POLICY IF EXISTS schedule_slots_select_full_access ON schedule_slots;
CREATE POLICY schedule_slots_select_full_access
  ON schedule_slots FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_operational()
  );

-- =============================================================================
-- 5. Prices: read via can_read_prices(); write via can_manage_prices()
-- =============================================================================

DROP POLICY IF EXISTS prices_select ON prices;
CREATE POLICY prices_select
  ON prices FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_prices()
  );

DROP POLICY IF EXISTS prices_write_admin ON prices;
CREATE POLICY prices_write_admin
  ON prices FOR ALL TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_manage_prices()
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_manage_prices()
  );

-- =============================================================================
-- 6. organization_members: team mutations — owner/director only
-- =============================================================================

DROP POLICY IF EXISTS organization_members_insert_team ON organization_members;
CREATE POLICY organization_members_insert_team
  ON organization_members FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = auth_organization_id()
    AND can_manage_team()
    AND organization_allows_writes(organization_id)
    AND member_role(auth.uid(), organization_id) IN ('owner', 'director')
  );

-- =============================================================================
-- 7. Grants on new helpers
-- =============================================================================

GRANT EXECUTE ON FUNCTION can_read_operational() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION can_read_financial() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION can_read_prices() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION can_manage_prices() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION can_export_financial() TO authenticated, service_role;

COMMIT;
