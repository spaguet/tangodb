-- S29 / H8+M11: revoke auth sessions on member deactivate; JWT org/member claims require active membership.

BEGIN;

-- =============================================================================
-- 1. Revoke GoTrue sessions (internal — only from update_team_member)
-- =============================================================================

CREATE OR REPLACE FUNCTION revoke_auth_sessions_for_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM auth.refresh_tokens WHERE user_id::uuid = p_user_id;
  DELETE FROM auth.sessions WHERE user_id::uuid = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION revoke_auth_sessions_for_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION revoke_auth_sessions_for_user(uuid) TO service_role;

-- =============================================================================
-- 2. JWT claim helpers — ignore stale org/member claims when membership inactive
-- =============================================================================

CREATE OR REPLACE FUNCTION auth_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM organization_members om
      WHERE om.user_id = auth.uid()
        AND om.organization_id = NULLIF(
          current_setting('request.jwt.claims', true)::jsonb ->> 'organization_id',
          ''
        )::uuid
        AND om.is_active = true
    )
    THEN NULLIF(
      current_setting('request.jwt.claims', true)::jsonb ->> 'organization_id',
      ''
    )::uuid
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION auth_member_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT om.id
  FROM organization_members om
  WHERE om.user_id = auth.uid()
    AND om.organization_id = auth_organization_id()
    AND om.is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION auth_member_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT member_role(auth.uid(), auth_organization_id());
$$;

-- =============================================================================
-- 3. update_team_member — clear active org + revoke sessions on deactivate
-- =============================================================================

CREATE OR REPLACE FUNCTION update_team_member(
  p_member_id uuid,
  p_role text DEFAULT NULL,
  p_scope jsonb DEFAULT NULL,
  p_is_active boolean DEFAULT NULL,
  p_display_name text DEFAULT NULL,
  p_meta jsonb DEFAULT NULL,
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL,
  p_patronymic text DEFAULT NULL,
  p_contact_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_telegram text DEFAULT NULL,
  p_profile_notes text DEFAULT NULL
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
  v_profile_update boolean := false;
  v_effective_role text;
  v_had_active_org boolean := false;
BEGIN
  IF v_org_id IS NULL
    OR is_restricted_admin()
    OR NOT can_manage_team()
    OR NOT organization_allows_writes(v_org_id)
  THEN
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
    IF p_role = 'director' AND organization_director_slot_taken(v_org_id, p_member_id) THEN
      RAISE EXCEPTION 'director_slot_taken';
    END IF;
    v_target.role := p_role;
    v_target.meta := normalize_member_meta(v_target.meta, p_role);
  END IF;

  v_effective_role := v_target.role;

  IF p_is_active IS NOT NULL AND p_is_active = false THEN
    IF v_target.role = 'owner' AND count_active_owners(v_org_id) <= 1 THEN
      RAISE EXCEPTION 'cannot deactivate last owner';
    END IF;
    IF v_target.role = 'teacher'
      AND teacher_member_has_future_lessons(v_org_id, p_member_id)
    THEN
      RAISE EXCEPTION 'teacher_has_future_lessons';
    END IF;
    v_target.is_active := false;

    SELECT EXISTS (
      SELECT 1
      FROM user_active_organizations uao
      WHERE uao.user_id = v_target.user_id
        AND uao.organization_id = v_org_id
    )
    INTO v_had_active_org;

    DELETE FROM user_active_organizations
    WHERE user_id = v_target.user_id
      AND organization_id = v_org_id;

    IF v_had_active_org THEN
      PERFORM revoke_auth_sessions_for_user(v_target.user_id);
    END IF;
  ELSIF p_is_active IS NOT NULL THEN
    IF p_is_active = true
      AND v_target.role = 'director'
      AND organization_director_slot_taken(v_org_id, p_member_id)
    THEN
      RAISE EXCEPTION 'director_slot_taken';
    END IF;
    v_target.is_active := true;
  END IF;

  IF p_scope IS NOT NULL AND v_effective_role = 'teacher' THEN
    v_target.scope := normalize_member_scope(p_scope, 'teacher');
  END IF;

  IF p_meta IS NOT NULL AND v_inviter_role IN ('owner', 'director') THEN
    v_target.meta := normalize_member_meta(v_target.meta || p_meta, v_effective_role);
  END IF;

  IF p_display_name IS NOT NULL THEN
    v_target.display_name := nullif(trim(p_display_name), '');
  END IF;

  v_profile_update := (
    p_first_name IS NOT NULL
    OR p_last_name IS NOT NULL
    OR p_patronymic IS NOT NULL
    OR p_contact_email IS NOT NULL
    OR p_phone IS NOT NULL
    OR p_telegram IS NOT NULL
    OR p_profile_notes IS NOT NULL
  );

  IF v_profile_update AND v_inviter_role NOT IN ('owner', 'director') THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  IF p_first_name IS NOT NULL THEN
    v_target.first_name := nullif(trim(p_first_name), '');
  END IF;
  IF p_last_name IS NOT NULL THEN
    v_target.last_name := nullif(trim(p_last_name), '');
  END IF;
  IF p_patronymic IS NOT NULL THEN
    v_target.patronymic := nullif(trim(p_patronymic), '');
  END IF;
  IF p_contact_email IS NOT NULL THEN
    v_target.contact_email := nullif(trim(p_contact_email), '');
  END IF;
  IF p_phone IS NOT NULL THEN
    v_target.phone := nullif(trim(p_phone), '');
  END IF;
  IF p_telegram IS NOT NULL THEN
    v_target.telegram := nullif(trim(p_telegram), '');
  END IF;
  IF p_profile_notes IS NOT NULL THEN
    v_target.profile_notes := nullif(trim(p_profile_notes), '');
  END IF;

  UPDATE organization_members
  SET role = v_target.role,
      scope = v_target.scope,
      meta = v_target.meta,
      is_active = v_target.is_active,
      display_name = v_target.display_name,
      first_name = v_target.first_name,
      last_name = v_target.last_name,
      patronymic = v_target.patronymic,
      contact_email = v_target.contact_email,
      phone = v_target.phone,
      telegram = v_target.telegram,
      profile_notes = v_target.profile_notes
  WHERE id = p_member_id;
END;
$$;

COMMIT;
