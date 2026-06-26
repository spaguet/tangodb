-- S9 (Prompt 16): Owner emergency recovery — support-only owner reassignment

CREATE OR REPLACE FUNCTION dev_console_user_id_by_email_exact(p_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT u.id
  FROM auth.users u
  WHERE lower(u.email) = lower(trim(coalesce(p_email, '')))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION dev_console_user_id_by_email_exact(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dev_console_user_id_by_email_exact(text) TO service_role;

CREATE OR REPLACE FUNCTION dev_console_reassign_org_owner(
  p_org_id uuid,
  p_new_user_id uuid,
  p_old_owner_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org organizations%ROWTYPE;
  v_old_member organization_members%ROWTYPE;
  v_new_member_id uuid;
  v_display_name text;
BEGIN
  IF p_org_id IS NULL OR p_new_user_id IS NULL OR p_old_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'required parameters missing' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization not found' USING ERRCODE = '22023';
  END IF;

  IF v_org.status = 'purged' THEN
    RAISE EXCEPTION 'organization purged' USING ERRCODE = '22023';
  END IF;

  IF v_org.owner_user_id IS DISTINCT FROM p_old_owner_user_id THEN
    RAISE EXCEPTION 'owner mismatch' USING ERRCODE = '22023';
  END IF;

  IF p_new_user_id = p_old_owner_user_id THEN
    RAISE EXCEPTION 'same owner user' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_old_member
  FROM organization_members
  WHERE organization_id = p_org_id
    AND user_id = p_old_owner_user_id
    AND role = 'owner'
  LIMIT 1;

  v_display_name := coalesce(nullif(trim(v_old_member.display_name), ''), 'Owner');

  UPDATE organization_members
  SET is_active = false
  WHERE organization_id = p_org_id
    AND user_id = p_old_owner_user_id;

  INSERT INTO organization_members (organization_id, user_id, role, display_name, is_active, joined_at)
  VALUES (p_org_id, p_new_user_id, 'owner', v_display_name, true, now())
  ON CONFLICT (organization_id, user_id) DO UPDATE
  SET
    role = 'owner',
    is_active = true,
    display_name = EXCLUDED.display_name;

  SELECT om.id INTO v_new_member_id
  FROM organization_members om
  WHERE om.organization_id = p_org_id
    AND om.user_id = p_new_user_id;

  UPDATE organizations
  SET owner_user_id = p_new_user_id
  WHERE id = p_org_id;

  UPDATE user_active_organizations
  SET
    organization_id = p_org_id,
    member_id = v_new_member_id,
    updated_at = now()
  WHERE user_id = p_new_user_id;

  DELETE FROM user_active_organizations
  WHERE user_id = p_old_owner_user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'organization_id', p_org_id,
    'new_member_id', v_new_member_id
  );
END;
$$;

REVOKE ALL ON FUNCTION dev_console_reassign_org_owner(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dev_console_reassign_org_owner(uuid, uuid, uuid) TO service_role;
