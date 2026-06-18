-- TangoDB v2 Phase 4 (D-1, D-3): organization invites, team RPCs, audit triggers

-- =============================================================================
-- 1. organization_invites
-- =============================================================================

CREATE TABLE organization_invites (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  role            TEXT NOT NULL
    CHECK (role IN ('owner', 'director', 'admin', 'teacher', 'accountant')),
  scope           JSONB NOT NULL DEFAULT '{
    "discipline_ids": [],
    "location_ids": [],
    "all_disciplines": false,
    "all_locations": false,
    "can_view_all_clients": false
  }'::jsonb,
  token_hash      TEXT NOT NULL UNIQUE,
  invited_by      UUID NOT NULL REFERENCES organization_members (id),
  expires_at      TIMESTAMPTZ NOT NULL,
  accepted_at     TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(scope) = 'object'),
  CHECK (role NOT IN ('owner', 'director') OR FALSE)
);

CREATE INDEX idx_org_invites_org_pending
  ON organization_invites (organization_id, expires_at)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX idx_org_invites_email
  ON organization_invites (lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- =============================================================================
-- 2. Team role helpers
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
    WHEN p_inviter_role = 'admin' THEN p_target_role IN ('teacher', 'accountant')
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
    WHEN p_inviter_role = 'admin' THEN p_target_role IN ('teacher', 'accountant')
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION count_active_owners(p_org_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT count(*)::integer
  FROM organization_members om
  WHERE om.organization_id = p_org_id
    AND om.role = 'owner'
    AND om.is_active = true;
$$;

-- =============================================================================
-- 3. RPC: create_organization_invite
-- =============================================================================

CREATE OR REPLACE FUNCTION create_organization_invite(
  p_email text,
  p_role text,
  p_scope jsonb DEFAULT NULL,
  p_token_hash text DEFAULT NULL
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

  INSERT INTO organization_invites (
    organization_id, email, role, scope, token_hash, invited_by, expires_at
  )
  VALUES (
    v_org_id, v_email, p_role, v_scope, p_token_hash, v_inviter_id, now() + interval '7 days'
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

REVOKE ALL ON FUNCTION create_organization_invite(text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_organization_invite(text, text, jsonb, text) TO authenticated;

-- =============================================================================
-- 4. RPC: accept_organization_invite
-- =============================================================================

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
    organization_id, user_id, role, scope, display_name, is_active, invited_at, joined_at
  )
  VALUES (
    v_invite.organization_id,
    v_user_id,
    v_invite.role,
    v_invite.scope,
    split_part(v_user_email, '@', 1),
    true,
    v_invite.created_at,
    now()
  )
  ON CONFLICT (organization_id, user_id) DO UPDATE
    SET role = EXCLUDED.role,
        scope = EXCLUDED.scope,
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

REVOKE ALL ON FUNCTION accept_organization_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_organization_invite(text) TO authenticated;

-- =============================================================================
-- 5. RPC: revoke_organization_invite
-- =============================================================================

CREATE OR REPLACE FUNCTION revoke_organization_invite(p_invite_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
BEGIN
  IF v_org_id IS NULL OR NOT can_manage_team() OR NOT organization_allows_writes(v_org_id) THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  UPDATE organization_invites
  SET revoked_at = now()
  WHERE id = p_invite_id
    AND organization_id = v_org_id
    AND accepted_at IS NULL
    AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION revoke_organization_invite(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION revoke_organization_invite(uuid) TO authenticated;

-- =============================================================================
-- 6. RPC: update_team_member
-- =============================================================================

CREATE OR REPLACE FUNCTION update_team_member(
  p_member_id uuid,
  p_role text DEFAULT NULL,
  p_scope jsonb DEFAULT NULL,
  p_is_active boolean DEFAULT NULL,
  p_display_name text DEFAULT NULL
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

  IF p_display_name IS NOT NULL THEN
    v_target.display_name := nullif(trim(p_display_name), '');
  END IF;

  UPDATE organization_members
  SET role = v_target.role,
      scope = v_target.scope,
      is_active = v_target.is_active,
      display_name = v_target.display_name
  WHERE id = p_member_id;
END;
$$;

REVOKE ALL ON FUNCTION update_team_member(uuid, text, jsonb, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_team_member(uuid, text, jsonb, boolean, text) TO authenticated;

-- =============================================================================
-- 7. Audit triggers for team / settings / invites
-- =============================================================================

CREATE OR REPLACE FUNCTION audit_org_event_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid;
  v_row_id text;
BEGIN
  IF TG_TABLE_NAME = 'organization_settings' THEN
    IF TG_OP = 'DELETE' THEN
      v_org_id := OLD.organization_id;
      v_row_id := OLD.organization_id::text;
    ELSE
      v_org_id := NEW.organization_id;
      v_row_id := NEW.organization_id::text;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_org_id := OLD.organization_id;
    v_row_id := OLD.id::text;
  ELSE
    v_org_id := NEW.organization_id;
    v_row_id := NEW.id::text;
  END IF;

  INSERT INTO audit_log (
    organization_id, table_name, operation, row_id, old_data, new_data, changed_by
  )
  VALUES (
    v_org_id,
    TG_TABLE_NAME,
    TG_OP,
    v_row_id,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
    auth.uid()
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER audit_organization_members
  AFTER INSERT OR UPDATE OR DELETE ON organization_members
  FOR EACH ROW EXECUTE FUNCTION audit_org_event_trigger_fn();

CREATE TRIGGER audit_organization_settings
  AFTER INSERT OR UPDATE OR DELETE ON organization_settings
  FOR EACH ROW EXECUTE FUNCTION audit_org_event_trigger_fn();

CREATE TRIGGER audit_organization_invites
  AFTER INSERT OR UPDATE OR DELETE ON organization_invites
  FOR EACH ROW EXECUTE FUNCTION audit_org_event_trigger_fn();

-- =============================================================================
-- 8. JWT hook: platform_role from app_metadata
-- =============================================================================

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  claims jsonb;
  tgid text;
  platform_role text;
  v_user_id uuid;
  v_org_id uuid;
  v_member_id uuid;
  v_role text;
BEGIN
  claims := event -> 'claims';
  v_user_id := (claims ->> 'sub')::uuid;

  tgid := claims -> 'app_metadata' ->> 'telegram_id';
  IF tgid IS NOT NULL AND tgid <> '' THEN
    claims := jsonb_set(claims, '{telegram_id}', to_jsonb(tgid));
  END IF;

  platform_role := claims -> 'app_metadata' ->> 'platform_role';
  IF platform_role IS NOT NULL AND platform_role <> '' THEN
    claims := jsonb_set(claims, '{platform_role}', to_jsonb(platform_role));
  END IF;

  SELECT uao.organization_id, uao.member_id, om.role
  INTO v_org_id, v_member_id, v_role
  FROM user_active_organizations uao
  JOIN organization_members om ON om.id = uao.member_id
  WHERE uao.user_id = v_user_id
    AND om.is_active = true;

  IF v_org_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{organization_id}', to_jsonb(v_org_id::text));
    claims := jsonb_set(claims, '{member_id}', to_jsonb(v_member_id::text));
    claims := jsonb_set(claims, '{role}', to_jsonb(v_role));
  END IF;

  RETURN jsonb_build_object('claims', claims);
END;
$$;

-- =============================================================================
-- 9. RLS: organization_invites
-- =============================================================================

ALTER TABLE organization_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY organization_invites_select_team
  ON organization_invites FOR SELECT
  TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND can_manage_team()
    AND organization_allows_reads(organization_id)
  );

GRANT SELECT ON organization_invites TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON organization_invites TO service_role;
