-- S19 / M13 + M24 + M28 + M25: roster view without colleague PII; client_notes author-only
-- for operational roles; organization_invites list without token_hash.

BEGIN;

-- =============================================================================
-- 1. organization_members roster view (M13)
-- =============================================================================

CREATE OR REPLACE VIEW organization_members_roster_v
WITH (security_invoker = false) AS
SELECT
  om.id,
  om.organization_id,
  om.first_name,
  om.last_name,
  om.patronymic,
  om.display_name,
  om.role,
  om.is_active,
  CASE
    WHEN om.role = 'admin'
      AND COALESCE((om.meta ->> 'restricted_admin')::boolean, false)
    THEN jsonb_build_object('restricted_admin', true)
    ELSE '{}'::jsonb
  END AS meta,
  om.joined_at
FROM organization_members om
WHERE om.organization_id = auth_organization_id()
  AND is_active_member(auth.uid(), om.organization_id)
  AND organization_allows_reads(om.organization_id);

GRANT SELECT ON organization_members_roster_v TO authenticated;

DROP POLICY IF EXISTS organization_members_select_active_org ON organization_members;

CREATE POLICY organization_members_select_team_or_own
  ON organization_members FOR SELECT
  TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND is_active_member(auth.uid(), organization_id)
    AND organization_allows_reads(organization_id)
    AND (
      can_manage_team()
      OR user_id = auth.uid()
    )
  );

-- =============================================================================
-- 2. client_notes — operational read/write only own notes (M24, M28)
-- =============================================================================

DROP POLICY IF EXISTS client_notes_select_operational ON client_notes;
DROP POLICY IF EXISTS client_notes_update_operational ON client_notes;
DROP POLICY IF EXISTS client_notes_delete_operational ON client_notes;

CREATE POLICY client_notes_select_operational
  ON client_notes FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_operational()
    AND author_member_id = auth_member_id()
  );

CREATE POLICY client_notes_update_operational
  ON client_notes FOR UPDATE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
    AND author_member_id = auth_member_id()
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
    AND author_member_id = auth_member_id()
  );

CREATE POLICY client_notes_delete_operational
  ON client_notes FOR DELETE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
    AND author_member_id = auth_member_id()
  );

-- =============================================================================
-- 3. organization_invites list without token_hash (M25)
-- =============================================================================

CREATE OR REPLACE VIEW organization_invites_team_v
WITH (security_invoker = false) AS
SELECT
  oi.id,
  oi.organization_id,
  oi.email,
  oi.first_name,
  oi.last_name,
  oi.role,
  oi.scope,
  oi.meta,
  oi.expires_at,
  oi.accepted_at,
  oi.revoked_at,
  oi.created_at,
  oi.invited_by
FROM organization_invites oi
WHERE oi.organization_id = auth_organization_id()
  AND can_manage_team()
  AND organization_allows_reads(oi.organization_id);

DROP POLICY IF EXISTS organization_invites_select_team ON organization_invites;

REVOKE SELECT ON organization_invites FROM authenticated;
GRANT SELECT ON organization_invites_team_v TO authenticated;

COMMIT;
