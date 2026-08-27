-- S05 / H9 + H13: organization_members write only via SECURITY DEFINER RPC (no REST PATCH role/scope/meta).

-- =============================================================================
-- 1. Helpers — whitelist meta/scope (H13)
-- =============================================================================

CREATE OR REPLACE FUNCTION jsonb_uuid_text_array(p_value jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT jsonb_agg(to_jsonb(elem::text))
      FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(p_value) = 'array' THEN p_value ELSE '[]'::jsonb END
      ) AS elem
      WHERE elem ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ),
    '[]'::jsonb
  );
$$;

CREATE OR REPLACE FUNCTION member_scope_has_ui_access(p_scope jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT teacher_scope_has_access(p_scope)
    OR COALESCE((p_scope ->> 'all_groups')::boolean, false)
    OR jsonb_array_length(COALESCE(p_scope -> 'schedule_group_ids', '[]'::jsonb)) > 0;
$$;

CREATE OR REPLACE FUNCTION normalize_member_meta(p_meta jsonb, p_role text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_result jsonb := '{}'::jsonb;
BEGIN
  IF p_meta IS NULL OR jsonb_typeof(p_meta) <> 'object' THEN
    RETURN v_result;
  END IF;

  IF p_role = 'admin'
    AND p_meta ? 'restricted_admin'
    AND jsonb_typeof(p_meta -> 'restricted_admin') = 'boolean'
  THEN
    v_result := v_result || jsonb_build_object('restricted_admin', p_meta -> 'restricted_admin');
  END IF;

  IF p_role = 'teacher'
    AND p_meta ? 'can_edit_past_schedule'
    AND jsonb_typeof(p_meta -> 'can_edit_past_schedule') = 'boolean'
  THEN
    v_result := v_result || jsonb_build_object('can_edit_past_schedule', p_meta -> 'can_edit_past_schedule');
  END IF;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION normalize_member_scope(p_scope jsonb, p_role text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_scope jsonb;
BEGIN
  IF p_role <> 'teacher' THEN
    RETURN '{
      "discipline_ids": [],
      "location_ids": [],
      "schedule_group_ids": [],
      "all_disciplines": false,
      "all_locations": false,
      "all_groups": false,
      "can_view_all_clients": false
    }'::jsonb;
  END IF;

  v_scope := jsonb_build_object(
    'discipline_ids', jsonb_uuid_text_array(COALESCE(p_scope -> 'discipline_ids', '[]'::jsonb)),
    'location_ids', jsonb_uuid_text_array(COALESCE(p_scope -> 'location_ids', '[]'::jsonb)),
    'schedule_group_ids', jsonb_uuid_text_array(COALESCE(p_scope -> 'schedule_group_ids', '[]'::jsonb)),
    'all_disciplines', COALESCE((p_scope ->> 'all_disciplines')::boolean, false),
    'all_locations', COALESCE((p_scope ->> 'all_locations')::boolean, false),
    'all_groups', COALESCE((p_scope ->> 'all_groups')::boolean, false),
    'can_view_all_clients', COALESCE((p_scope ->> 'can_view_all_clients')::boolean, false)
  );

  IF NOT member_scope_has_ui_access(v_scope) THEN
    v_scope := default_teacher_scope() || jsonb_build_object(
      'schedule_group_ids', v_scope -> 'schedule_group_ids',
      'all_groups', v_scope -> 'all_groups'
    );
    IF NOT member_scope_has_ui_access(v_scope) THEN
      v_scope := default_teacher_scope();
    END IF;
  END IF;

  RETURN v_scope;
END;
$$;

-- =============================================================================
-- 2. Trigger — block authenticated/anon direct writes (not auth.uid())
-- =============================================================================

CREATE OR REPLACE FUNCTION protect_organization_members_client_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
  RAISE EXCEPTION 'organization_members mutations require RPC';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS organization_members_protect_client_write ON organization_members;

CREATE TRIGGER organization_members_protect_client_write
  BEFORE INSERT OR UPDATE OR DELETE ON organization_members
  FOR EACH ROW
  EXECUTE FUNCTION protect_organization_members_client_write();

-- =============================================================================
-- 3. REVOKE client write; keep SELECT for team roster UI
-- =============================================================================

DROP POLICY IF EXISTS organization_members_insert_team ON organization_members;
DROP POLICY IF EXISTS organization_members_update_team ON organization_members;
DROP POLICY IF EXISTS organization_members_delete_team ON organization_members;

REVOKE INSERT, UPDATE, DELETE ON organization_members FROM anon, authenticated;
GRANT SELECT ON organization_members TO authenticated;

-- =============================================================================
-- 4. create_organization_invite — whitelist scope/meta (H13)
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

  IF NOT can_manage_team() OR NOT organization_allows_writes(v_org_id) THEN
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

-- =============================================================================
-- 5. update_team_member — whitelist scope/meta (H13)
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
