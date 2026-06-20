-- Invite password setup: accept invite on behalf of a user (service_role only)

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
    organization_id, user_id, role, scope, display_name, is_active, invited_at, joined_at
  )
  VALUES (
    v_invite.organization_id,
    p_user_id,
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

REVOKE ALL ON FUNCTION complete_organization_invite_for_user(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_organization_invite_for_user(text, uuid) TO service_role;
