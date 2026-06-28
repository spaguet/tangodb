-- Fix orphan cleanup: self_service_demo_challenges has owner_email_hash, not user_id

CREATE OR REPLACE FUNCTION dev_console_cleanup_orphan_auth_users(
  p_actor_user_id uuid,
  p_dry_run boolean DEFAULT true,
  p_user_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user record;
  v_deleted jsonb := '[]'::jsonb;
  v_email_hash text;
  v_count int := 0;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'actor_user_id required' USING ERRCODE = '22023';
  END IF;

  IF NOT is_platform_developer(p_actor_user_id) THEN
    RAISE EXCEPTION 'developer_access_required' USING ERRCODE = '42501';
  END IF;

  FOR v_user IN
    SELECT u.id, u.email
    FROM auth.users u
    WHERE u.id <> p_actor_user_id
      AND NOT is_platform_developer(u.id)
      AND NOT EXISTS (
        SELECT 1
        FROM organization_members om
        WHERE om.user_id = u.id
          AND om.is_active = true
      )
      AND (
        p_user_ids IS NULL
        OR u.id = ANY(p_user_ids)
      )
  LOOP
    v_count := v_count + 1;
    v_deleted := v_deleted || jsonb_build_array(
      jsonb_build_object('user_id', v_user.id, 'email', v_user.email)
    );

    IF NOT coalesce(p_dry_run, true) THEN
      v_email_hash := owner_email_hash(v_user.email);

      UPDATE platform_audit_log
      SET actor_user_id = NULL
      WHERE actor_user_id = v_user.id;

      UPDATE organizations
      SET owner_user_id = NULL
      WHERE owner_user_id = v_user.id;

      UPDATE access_keys
      SET created_by = NULL
      WHERE created_by = v_user.id;

      UPDATE organization_version_migrations
      SET initiated_by = NULL
      WHERE initiated_by = v_user.id;

      DELETE FROM user_active_organizations WHERE user_id = v_user.id;
      DELETE FROM user_recovery_codes WHERE user_id = v_user.id;
      DELETE FROM organization_members WHERE user_id = v_user.id;

      IF v_user.email IS NOT NULL AND trim(v_user.email) <> '' THEN
        DELETE FROM access_keys
        WHERE key_type = 'demo'
          AND email IS NOT NULL
          AND lower(trim(email)) = lower(trim(v_user.email));
      END IF;

      IF v_email_hash IS NOT NULL THEN
        DELETE FROM self_service_demo_challenges WHERE owner_email_hash = v_email_hash;
        DELETE FROM demo_owner_retention WHERE owner_email_hash = v_email_hash;
      END IF;

      DELETE FROM auth.refresh_tokens WHERE user_id::uuid = v_user.id;
      DELETE FROM auth.sessions WHERE user_id::uuid = v_user.id;
      DELETE FROM auth.identities WHERE user_id = v_user.id;
      DELETE FROM auth.users WHERE id = v_user.id;
    END IF;
  END LOOP;

  INSERT INTO platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  VALUES (
    p_actor_user_id,
    CASE WHEN coalesce(p_dry_run, true) THEN 'auth.orphan_users_preview' ELSE 'auth.orphan_users_purged' END,
    'auth_user',
    NULL,
    jsonb_build_object(
      'count', v_count,
      'dry_run', coalesce(p_dry_run, true),
      'user_ids', coalesce(to_jsonb(p_user_ids), 'null'::jsonb)
    )
  );

  RETURN jsonb_build_object(
    'dry_run', coalesce(p_dry_run, true),
    'count', v_count,
    'users', v_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION dev_console_cleanup_orphan_auth_users(uuid, boolean, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dev_console_cleanup_orphan_auth_users(uuid, boolean, uuid[]) TO service_role;
