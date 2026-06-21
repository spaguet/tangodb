-- Invite with first/last name; remove email nicknames from member display

BEGIN;

ALTER TABLE organization_invites
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT;

-- Remove email-local-part nicknames stored in display_name
UPDATE organization_members om
SET display_name = NULL
FROM auth.users u
WHERE om.user_id = u.id
  AND om.display_name IS NOT NULL
  AND lower(trim(om.display_name)) = split_part(lower(u.email), '@', 1);

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

REVOKE ALL ON FUNCTION create_organization_invite(text, text, jsonb, text, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_organization_invite(text, text, jsonb, text, jsonb, text, text) TO authenticated;

DROP FUNCTION IF EXISTS create_organization_invite(text, text, jsonb, text, jsonb);

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
    organization_id, user_id, role, scope, meta,
    first_name, last_name, contact_email,
    display_name, is_active, invited_at, joined_at
  )
  VALUES (
    v_invite.organization_id,
    v_user_id,
    v_invite.role,
    v_invite.scope,
    v_invite.meta,
    nullif(trim(v_invite.first_name), ''),
    nullif(trim(v_invite.last_name), ''),
    v_invite.email,
    NULL,
    true,
    v_invite.created_at,
    now()
  )
  ON CONFLICT (organization_id, user_id) DO UPDATE
    SET role = EXCLUDED.role,
        scope = EXCLUDED.scope,
        meta = EXCLUDED.meta,
        first_name = COALESCE(EXCLUDED.first_name, organization_members.first_name),
        last_name = COALESCE(EXCLUDED.last_name, organization_members.last_name),
        contact_email = COALESCE(EXCLUDED.contact_email, organization_members.contact_email),
        display_name = NULL,
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
    organization_id, user_id, role, scope, meta,
    first_name, last_name, contact_email,
    display_name, is_active, invited_at, joined_at
  )
  VALUES (
    v_invite.organization_id,
    p_user_id,
    v_invite.role,
    v_invite.scope,
    v_invite.meta,
    nullif(trim(v_invite.first_name), ''),
    nullif(trim(v_invite.last_name), ''),
    v_invite.email,
    NULL,
    true,
    v_invite.created_at,
    now()
  )
  ON CONFLICT (organization_id, user_id) DO UPDATE
    SET role = EXCLUDED.role,
        scope = EXCLUDED.scope,
        meta = EXCLUDED.meta,
        first_name = COALESCE(EXCLUDED.first_name, organization_members.first_name),
        last_name = COALESCE(EXCLUDED.last_name, organization_members.last_name),
        contact_email = COALESCE(EXCLUDED.contact_email, organization_members.contact_email),
        display_name = NULL,
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

COMMIT;
