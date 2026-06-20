-- TangoDB v2 RBAC R6: reception role via admin + meta.restricted_admin (Variant B)
-- Ref: tangodb_roles_rbac_TZ.md §R6

BEGIN;

-- =============================================================================
-- 1. meta JSONB on members and invites
-- =============================================================================

ALTER TABLE organization_members
  ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE organization_members
  DROP CONSTRAINT IF EXISTS organization_members_meta_object;

ALTER TABLE organization_members
  ADD CONSTRAINT organization_members_meta_object
  CHECK (jsonb_typeof(meta) = 'object');

ALTER TABLE organization_invites
  ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE organization_invites
  DROP CONSTRAINT IF EXISTS organization_invites_meta_object;

ALTER TABLE organization_invites
  ADD CONSTRAINT organization_invites_meta_object
  CHECK (jsonb_typeof(meta) = 'object');

-- =============================================================================
-- 2. Reception helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION is_restricted_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organization_members om
    WHERE om.id = auth_member_id()
      AND om.organization_id = auth_organization_id()
      AND om.role = 'admin'
      AND om.is_active = true
      AND COALESCE((om.meta ->> 'restricted_admin')::boolean, false)
  );
$$;

CREATE OR REPLACE FUNCTION can_read_reception()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT is_restricted_admin();
$$;

CREATE OR REPLACE FUNCTION can_write_reception()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT is_restricted_admin();
$$;

CREATE OR REPLACE FUNCTION can_read_operational()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT current_member_role() IN ('owner', 'director', 'admin')
    AND NOT is_restricted_admin();
$$;

CREATE OR REPLACE FUNCTION can_write_all_business()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT current_member_role() IN ('owner', 'director', 'admin')
    AND NOT is_restricted_admin();
$$;

-- =============================================================================
-- 3. Reception SELECT on subscriptions and attendance; payments write
-- =============================================================================

DROP POLICY IF EXISTS subscriptions_select_full_access ON subscriptions;
CREATE POLICY subscriptions_select_full_access
  ON subscriptions FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND (can_read_operational() OR can_read_reception())
  );

DROP POLICY IF EXISTS attendance_select_full_access ON attendance;
CREATE POLICY attendance_select_full_access
  ON attendance FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND (can_read_operational() OR can_read_reception())
  );

DROP POLICY IF EXISTS payments_write_admin ON payments;
CREATE POLICY payments_write_admin
  ON payments FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND (can_write_all_business() OR can_write_reception())
  );

DROP POLICY IF EXISTS payments_update_admin ON payments;
CREATE POLICY payments_update_admin
  ON payments FOR UPDATE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND (can_write_all_business() OR can_write_reception())
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND (can_write_all_business() OR can_write_reception())
  );

-- =============================================================================
-- 4. Invites: persist meta through invite lifecycle
-- =============================================================================

CREATE OR REPLACE FUNCTION create_organization_invite(
  p_email text,
  p_role text,
  p_scope jsonb DEFAULT NULL,
  p_token_hash text DEFAULT NULL,
  p_meta jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_inviter_id uuid := auth_member_id();
  v_inviter_role text;
  v_invite_id uuid;
  v_scope jsonb;
  v_meta jsonb;
  v_email text;
BEGIN
  IF v_org_id IS NULL OR v_inviter_id IS NULL THEN
    RAISE EXCEPTION 'no active organization';
  END IF;

  IF NOT can_manage_team() OR NOT organization_allows_writes(v_org_id) THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  v_inviter_role := member_role(auth.uid(), v_org_id);
  v_email := lower(trim(p_email));

  IF v_email = '' OR v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    RAISE EXCEPTION 'invalid email';
  END IF;

  IF NOT inviter_can_assign_role(v_inviter_role, p_role) THEN
    RAISE EXCEPTION 'cannot assign this role';
  END IF;

  IF p_token_hash IS NULL OR length(p_token_hash) < 32 THEN
    RAISE EXCEPTION 'invalid token';
  END IF;

  IF EXISTS (
    SELECT 1 FROM organization_members om
    JOIN auth.users u ON u.id = om.user_id
    WHERE om.organization_id = v_org_id
      AND om.is_active = true
      AND lower(u.email) = v_email
  ) THEN
    RAISE EXCEPTION 'user already a member';
  END IF;

  IF EXISTS (
    SELECT 1 FROM organization_invites oi
    WHERE oi.organization_id = v_org_id
      AND lower(oi.email) = v_email
      AND oi.accepted_at IS NULL
      AND oi.revoked_at IS NULL
      AND oi.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'pending invite already exists';
  END IF;

  v_scope := COALESCE(
    p_scope,
    '{
      "discipline_ids": [],
      "location_ids": [],
      "all_disciplines": false,
      "all_locations": false,
      "can_view_all_clients": false
    }'::jsonb
  );

  v_meta := COALESCE(p_meta, '{}'::jsonb);

  IF jsonb_typeof(v_meta) <> 'object' THEN
    RAISE EXCEPTION 'invalid meta';
  END IF;

  INSERT INTO organization_invites (
    organization_id, email, role, scope, meta, token_hash, invited_by, expires_at
  )
  VALUES (
    v_org_id, v_email, p_role, v_scope, v_meta, p_token_hash, v_inviter_id, now() + interval '7 days'
  )
  RETURNING id INTO v_invite_id;

  RETURN jsonb_build_object(
    'invite_id', v_invite_id,
    'email', v_email,
    'role', p_role,
    'expires_at', (now() + interval '7 days')
  );
END;
$$;

REVOKE ALL ON FUNCTION create_organization_invite(text, text, jsonb, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_organization_invite(text, text, jsonb, text, jsonb) TO authenticated;

DROP FUNCTION IF EXISTS create_organization_invite(text, text, jsonb, text);

CREATE OR REPLACE FUNCTION accept_organization_invite(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_invite organization_invites%ROWTYPE;
  v_member_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT lower(email) INTO v_user_email FROM auth.users WHERE id = v_user_id;
  IF v_user_email IS NULL OR v_user_email = '' THEN
    RAISE EXCEPTION 'email required on account';
  END IF;

  SELECT * INTO v_invite
  FROM organization_invites oi
  WHERE oi.token_hash = p_token_hash
    AND oi.accepted_at IS NULL
    AND oi.revoked_at IS NULL
    AND oi.expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid or expired invite';
  END IF;

  IF lower(v_invite.email) <> v_user_email THEN
    RAISE EXCEPTION 'invite email mismatch';
  END IF;

  IF EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.organization_id = v_invite.organization_id
      AND om.user_id = v_user_id
      AND om.is_active = true
  ) THEN
    UPDATE organization_invites
    SET accepted_at = now()
    WHERE id = v_invite.id;
    RAISE EXCEPTION 'already a member';
  END IF;

  INSERT INTO organization_members (
    organization_id, user_id, role, scope, meta, display_name, is_active, invited_at, joined_at
  )
  VALUES (
    v_invite.organization_id,
    v_user_id,
    v_invite.role,
    v_invite.scope,
    v_invite.meta,
    split_part(v_user_email, '@', 1),
    true,
    v_invite.created_at,
    now()
  )
  ON CONFLICT (organization_id, user_id) DO UPDATE
    SET role = EXCLUDED.role,
        scope = EXCLUDED.scope,
        meta = EXCLUDED.meta,
        is_active = true,
        joined_at = now()
  RETURNING id INTO v_member_id;

  UPDATE organization_invites
  SET accepted_at = now()
  WHERE id = v_invite.id;

  RETURN jsonb_build_object(
    'organization_id', v_invite.organization_id,
    'member_id', v_member_id,
    'role', v_invite.role
  );
END;
$$;

CREATE OR REPLACE FUNCTION complete_organization_invite_for_user(
  p_token_hash text,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_email text;
  v_invite organization_invites%ROWTYPE;
  v_member_id uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user required';
  END IF;

  SELECT lower(email) INTO v_user_email FROM auth.users WHERE id = p_user_id;
  IF v_user_email IS NULL OR v_user_email = '' THEN
    RAISE EXCEPTION 'email required on account';
  END IF;

  SELECT * INTO v_invite
  FROM organization_invites oi
  WHERE oi.token_hash = p_token_hash
    AND oi.accepted_at IS NULL
    AND oi.revoked_at IS NULL
    AND oi.expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid or expired invite';
  END IF;

  IF lower(v_invite.email) <> v_user_email THEN
    RAISE EXCEPTION 'invite email mismatch';
  END IF;

  IF EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.organization_id = v_invite.organization_id
      AND om.user_id = p_user_id
      AND om.is_active = true
  ) THEN
    UPDATE organization_invites
    SET accepted_at = now()
    WHERE id = v_invite.id;

    SELECT om.id
    INTO v_member_id
    FROM organization_members om
    WHERE om.organization_id = v_invite.organization_id
      AND om.user_id = p_user_id
      AND om.is_active = true;

    RETURN jsonb_build_object(
      'organization_id', v_invite.organization_id,
      'member_id', v_member_id,
      'role', v_invite.role,
      'already_member', true
    );
  END IF;

  INSERT INTO organization_members (
    organization_id, user_id, role, scope, meta, display_name, is_active, invited_at, joined_at
  )
  VALUES (
    v_invite.organization_id,
    p_user_id,
    v_invite.role,
    v_invite.scope,
    v_invite.meta,
    split_part(v_user_email, '@', 1),
    true,
    v_invite.created_at,
    now()
  )
  ON CONFLICT (organization_id, user_id) DO UPDATE
    SET role = EXCLUDED.role,
        scope = EXCLUDED.scope,
        meta = EXCLUDED.meta,
        is_active = true,
        joined_at = now()
  RETURNING id INTO v_member_id;

  UPDATE organization_invites
  SET accepted_at = now()
  WHERE id = v_invite.id;

  RETURN jsonb_build_object(
    'organization_id', v_invite.organization_id,
    'member_id', v_member_id,
    'role', v_invite.role
  );
END;
$$;

CREATE OR REPLACE FUNCTION update_team_member(
  p_member_id uuid,
  p_role text DEFAULT NULL,
  p_scope jsonb DEFAULT NULL,
  p_is_active boolean DEFAULT NULL,
  p_display_name text DEFAULT NULL,
  p_meta jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_inviter_role text;
  v_target organization_members%ROWTYPE;
BEGIN
  IF v_org_id IS NULL OR NOT can_manage_team() OR NOT organization_allows_writes(v_org_id) THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  v_inviter_role := member_role(auth.uid(), v_org_id);

  SELECT * INTO v_target
  FROM organization_members om
  WHERE om.id = p_member_id
    AND om.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'member not found';
  END IF;

  IF NOT inviter_can_manage_member(v_inviter_role, v_target.role) THEN
    RAISE EXCEPTION 'cannot manage this member';
  END IF;

  IF p_role IS NOT NULL AND p_role <> v_target.role THEN
    IF NOT inviter_can_assign_role(v_inviter_role, p_role) THEN
      RAISE EXCEPTION 'cannot assign this role';
    END IF;
    IF NOT inviter_can_manage_member(v_inviter_role, p_role) THEN
      RAISE EXCEPTION 'cannot assign this role';
    END IF;
    v_target.role := p_role;
  END IF;

  IF p_is_active IS NOT NULL AND p_is_active = false THEN
    IF v_target.role = 'owner' AND count_active_owners(v_org_id) <= 1 THEN
      RAISE EXCEPTION 'cannot deactivate last owner';
    END IF;
    v_target.is_active := false;
  ELSIF p_is_active IS NOT NULL THEN
    v_target.is_active := p_is_active;
  END IF;

  IF p_scope IS NOT NULL THEN
    v_target.scope := p_scope;
  END IF;

  IF p_meta IS NOT NULL THEN
    IF jsonb_typeof(p_meta) <> 'object' THEN
      RAISE EXCEPTION 'invalid meta';
    END IF;
    v_target.meta := p_meta;
  END IF;

  IF p_display_name IS NOT NULL THEN
    v_target.display_name := nullif(trim(p_display_name), '');
  END IF;

  UPDATE organization_members
  SET role = v_target.role,
      scope = v_target.scope,
      meta = v_target.meta,
      is_active = v_target.is_active,
      display_name = v_target.display_name
  WHERE id = p_member_id;
END;
$$;

REVOKE ALL ON FUNCTION update_team_member(uuid, text, jsonb, boolean, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_team_member(uuid, text, jsonb, boolean, text, jsonb) TO authenticated;

DROP FUNCTION IF EXISTS update_team_member(uuid, text, jsonb, boolean, text);

GRANT EXECUTE ON FUNCTION is_restricted_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION can_read_reception() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION can_write_reception() TO authenticated, service_role;

COMMIT;
