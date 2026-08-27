-- S24 / M41+M43+M45+M46+M53: narrow member SELECT — subscription changes/freeze by scope;
-- license/subscription bundle columns for isReadOnly; version migrations owner-only.

BEGIN;

-- =============================================================================
-- 1. subscription_member_changes — operational/financial or teacher scope (M41)
-- =============================================================================

DROP POLICY IF EXISTS subscription_member_changes_select ON subscription_member_changes;

CREATE POLICY subscription_member_changes_select_operational
  ON subscription_member_changes FOR SELECT
  TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND organization_allows_reads(organization_id)
    AND can_read_operational()
  );

CREATE POLICY subscription_member_changes_select_financial
  ON subscription_member_changes FOR SELECT
  TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND organization_allows_reads(organization_id)
    AND can_read_financial()
  );

-- subscription_member_changes_teacher_select — unchanged (teacher_can_access_subscription)

-- =============================================================================
-- 2. subscription_freeze_periods — operational or teacher scope (M46)
-- =============================================================================

DROP POLICY IF EXISTS subscription_freeze_periods_select ON subscription_freeze_periods;

CREATE POLICY subscription_freeze_periods_select_operational
  ON subscription_freeze_periods FOR SELECT
  TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND organization_allows_reads(organization_id)
    AND can_read_operational()
  );

-- subscription_freeze_periods_teacher_select — unchanged

-- =============================================================================
-- 3. organization_licenses / organization_subscriptions — bundle columns for all members (M43, M45)
-- =============================================================================

REVOKE SELECT ON organization_licenses FROM authenticated;
GRANT SELECT (
  organization_id,
  license_type,
  activated_at,
  expires_at
) ON organization_licenses TO authenticated;

REVOKE SELECT ON organization_subscriptions FROM authenticated;
GRANT SELECT (
  organization_id,
  plan,
  billing_period,
  status,
  provider,
  current_period_start,
  current_period_end
) ON organization_subscriptions TO authenticated;

-- Row policies organization_licenses_select_member / organization_subscriptions_select_member unchanged.

-- =============================================================================
-- 4. organization_version_migrations — owner only (M53)
-- =============================================================================

DROP POLICY IF EXISTS organization_version_migrations_select_member ON organization_version_migrations;

CREATE POLICY organization_version_migrations_select_owner
  ON organization_version_migrations FOR SELECT
  TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND is_active_member(auth.uid(), organization_id)
    AND current_member_role() = 'owner'
    AND organization_allows_reads(organization_id)
  );

COMMIT;
