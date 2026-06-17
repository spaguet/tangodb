-- TangoDB v2 Phase 1A (A-4): RLS on tenant core tables

ALTER TABLE crm_product_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_active_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_audit_log ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- crm_product_versions — read for authenticated; write for platform developer
-- =============================================================================

CREATE POLICY crm_product_versions_select_authenticated
  ON crm_product_versions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY crm_product_versions_write_developer
  ON crm_product_versions FOR ALL
  TO authenticated
  USING (auth_platform_role() = 'developer')
  WITH CHECK (auth_platform_role() = 'developer');

-- =============================================================================
-- organizations — members only; suspended visible to owner
-- =============================================================================

CREATE POLICY organizations_select_member
  ON organizations FOR SELECT
  TO authenticated
  USING (
    is_active_member(auth.uid(), id)
    AND (
      organization_allows_reads(id)
      OR (
        status = 'suspended'
        AND member_role(auth.uid(), id) = 'owner'
      )
    )
  );

CREATE POLICY organizations_update_admin
  ON organizations FOR UPDATE
  TO authenticated
  USING (
    id = auth_organization_id()
    AND is_active_member(auth.uid(), id)
    AND member_role(auth.uid(), id) IN ('owner', 'director', 'admin')
    AND organization_allows_writes(id)
  )
  WITH CHECK (
    id = auth_organization_id()
    AND is_active_member(auth.uid(), id)
    AND member_role(auth.uid(), id) IN ('owner', 'director', 'admin')
    AND organization_allows_writes(id)
  );

-- =============================================================================
-- organization_members — own memberships for org picker; team list in active org
-- =============================================================================

CREATE POLICY organization_members_select_own
  ON organization_members FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() AND is_active = true);

CREATE POLICY organization_members_select_active_org
  ON organization_members FOR SELECT
  TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND is_active_member(auth.uid(), organization_id)
    AND organization_allows_reads(organization_id)
  );

CREATE POLICY organization_members_insert_team
  ON organization_members FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = auth_organization_id()
    AND can_manage_team()
    AND organization_allows_writes(organization_id)
    AND member_role(auth.uid(), organization_id) IN ('owner', 'director', 'admin')
  );

CREATE POLICY organization_members_update_team
  ON organization_members FOR UPDATE
  TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND can_manage_team()
    AND organization_allows_writes(organization_id)
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND can_manage_team()
    AND organization_allows_writes(organization_id)
  );

CREATE POLICY organization_members_delete_team
  ON organization_members FOR DELETE
  TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND can_manage_team()
    AND organization_allows_writes(organization_id)
  );

-- =============================================================================
-- organization_settings — read in active org; write with license gating
-- =============================================================================

CREATE POLICY organization_settings_select_member
  ON organization_settings FOR SELECT
  TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND is_active_member(auth.uid(), organization_id)
    AND organization_allows_reads(organization_id)
  );

CREATE POLICY organization_settings_update_admin
  ON organization_settings FOR UPDATE
  TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND can_manage_settings()
    AND organization_allows_writes(organization_id)
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND can_manage_settings()
    AND organization_allows_writes(organization_id)
  );

-- =============================================================================
-- user_active_organizations — read own row only; mutations via RPC
-- =============================================================================

CREATE POLICY user_active_organizations_select_own
  ON user_active_organizations FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- =============================================================================
-- access_keys — no direct client access (Edge Functions / service role)
-- =============================================================================

CREATE POLICY access_keys_select_owner_org
  ON access_keys FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND organization_id = auth_organization_id()
    AND member_role(auth.uid(), organization_id) = 'owner'
  );

-- =============================================================================
-- organization_licenses — read in active org
-- =============================================================================

CREATE POLICY organization_licenses_select_member
  ON organization_licenses FOR SELECT
  TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND is_active_member(auth.uid(), organization_id)
    AND organization_allows_reads(organization_id)
  );

-- =============================================================================
-- platform_audit_log — Dev Console only
-- =============================================================================

CREATE POLICY platform_audit_log_developer
  ON platform_audit_log FOR ALL
  TO authenticated
  USING (auth_platform_role() = 'developer')
  WITH CHECK (auth_platform_role() = 'developer');

-- =============================================================================
-- Grants
-- =============================================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT ON crm_product_versions TO authenticated;
GRANT SELECT, UPDATE ON organizations TO authenticated;
GRANT SELECT ON access_keys TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON organization_members TO authenticated;
GRANT SELECT, UPDATE ON organization_settings TO authenticated;
GRANT SELECT ON user_active_organizations TO authenticated;
GRANT SELECT ON organization_licenses TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON crm_product_versions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON organizations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON access_keys TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON organization_members TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON organization_settings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_active_organizations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON organization_licenses TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_audit_log TO service_role;

GRANT EXECUTE ON FUNCTION auth_user_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth_organization_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth_member_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth_member_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth_platform_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION is_active_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth_is_member_of(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION member_role(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION member_scope(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION organization_allows_reads(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION organization_allows_writes(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION can_manage_settings() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION can_manage_team() TO authenticated, service_role;
