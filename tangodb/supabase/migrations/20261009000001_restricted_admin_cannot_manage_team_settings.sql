-- S07 / H12: reception (admin + meta.restricted_admin) cannot manage team/settings.
-- R6 closed business write; tenant can_manage_* helpers still allowed owner/director without restricted check.

-- =============================================================================
-- 1. Tenant helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION can_manage_settings()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT current_member_role() IN ('owner', 'director')
    AND NOT is_restricted_admin();
$$;

CREATE OR REPLACE FUNCTION can_manage_team()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT current_member_role() IN ('owner', 'director')
    AND NOT is_restricted_admin();
$$;

-- =============================================================================
-- 2. organization_settings UPDATE policy
-- =============================================================================

DROP POLICY IF EXISTS organization_settings_update_admin ON organization_settings;

CREATE POLICY organization_settings_update_admin
  ON organization_settings FOR UPDATE
  TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND can_manage_settings()
    AND NOT is_restricted_admin()
    AND organization_allows_writes(organization_id)
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND can_manage_settings()
    AND NOT is_restricted_admin()
    AND organization_allows_writes(organization_id)
  );

-- =============================================================================
-- 3. Team RPCs — explicit reception guard (cashier RPCs unchanged)
-- =============================================================================

CREATE OR REPLACE FUNCTION create_organization_invite(
  p_email text,
  p_role text,
  p_scope jsonb DEFAULT NULL,
  p_token_hash text DEFAULT NULL,
  p_meta jsonb DEFAULT NULL,
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL
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
  v_first_name text;
  v_last_name text;
BEGIN
  IF v_org_id IS NULL OR v_inviter_id IS NULL THEN
    RAISE EXCEPTION 'no active organization';
  END IF;

  IF is_restricted_admin()
    OR NOT can_manage_team()
    OR NOT organization_allows_writes(v_org_id)
  THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  v_inviter_role := member_role(auth.uid(), v_org_id);
  v_email := lower(trim(p_email));
  v_first_name := nullif(trim(p_first_name), '');
  v_last_name := nullif(trim(p_last_name), '');

  IF v_email = '' OR v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    RAISE EXCEPTION 'invalid email';
  END IF;

  IF v_first_name IS NULL OR v_last_name IS NULL THEN
    RAISE EXCEPTION 'first and last name required';
  END IF;

  IF NOT inviter_can_assign_role(v_inviter_role, p_role) THEN
    RAISE EXCEPTION 'cannot assign this role';
  END IF;

  IF p_role = 'director' AND organization_director_slot_taken(v_org_id) THEN
    RAISE EXCEPTION 'director_slot_taken';
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

  v_scope := normalize_member_scope(
    COALESCE(
      p_scope,
      CASE
        WHEN p_role = 'teacher' THEN default_teacher_scope()
        ELSE '{
          "discipline_ids": [],
          "location_ids": [],
          "schedule_group_ids": [],
          "all_disciplines": false,
          "all_locations": false,
          "all_groups": false,
          "can_view_all_clients": false
        }'::jsonb
      END
    ),
    p_role
  );

  IF v_inviter_role IN ('owner', 'director') THEN
    v_meta := normalize_member_meta(COALESCE(p_meta, '{}'::jsonb), p_role);
  ELSE
    v_meta := '{}'::jsonb;
  END IF;

  INSERT INTO organization_invites (
    organization_id, email, role, scope, meta, first_name, last_name, token_hash, invited_by, expires_at
  )
  VALUES (
    v_org_id, v_email, p_role, v_scope, v_meta, v_first_name, v_last_name, p_token_hash, v_inviter_id, now() + interval '7 days'
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
