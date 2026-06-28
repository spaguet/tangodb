-- Dev Console: registered auth users overview + orphan cleanup

CREATE OR REPLACE FUNCTION dev_console_registered_users_snapshot(
  p_query text DEFAULT NULL,
  p_limit int DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_users jsonb;
  v_orphan_count int;
BEGIN
  SELECT coalesce(jsonb_agg(row_data ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_users
  FROM (
    SELECT jsonb_build_object(
      'user_id', u.id,
      'email', u.email,
      'created_at', u.created_at,
      'last_sign_in_at', u.last_sign_in_at,
      'email_confirmed', u.email_confirmed_at IS NOT NULL,
      'is_developer', is_platform_developer(u.id),
      'memberships', coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'organization_id', om.organization_id,
            'organization_name', o.name,
            'organization_status', o.status,
            'role', om.role,
            'is_active', om.is_active,
            'display_name', om.display_name
          )
          ORDER BY o.name
        )
        FROM organization_members om
        JOIN organizations o ON o.id = om.organization_id
        WHERE om.user_id = u.id
      ), '[]'::jsonb),
      'is_orphan',
        NOT is_platform_developer(u.id)
        AND NOT EXISTS (
          SELECT 1
          FROM organization_members om
          WHERE om.user_id = u.id
            AND om.is_active = true
        )
    ) AS row_data,
    u.created_at
    FROM auth.users u
    WHERE coalesce(trim(p_query), '') = ''
       OR lower(coalesce(u.email, '')) LIKE '%' || lower(trim(p_query)) || '%'
    ORDER BY u.created_at DESC
    LIMIT greatest(1, least(coalesce(p_limit, 200), 500))
  ) sub;

  SELECT count(*)::int
  INTO v_orphan_count
  FROM auth.users u
  WHERE NOT is_platform_developer(u.id)
    AND NOT EXISTS (
      SELECT 1
      FROM organization_members om
      WHERE om.user_id = u.id
        AND om.is_active = true
    );

  RETURN jsonb_build_object(
    'users', v_users,
    'orphan_count', v_orphan_count
  );
END;
$$;

REVOKE ALL ON FUNCTION dev_console_registered_users_snapshot(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dev_console_registered_users_snapshot(text, int) TO service_role;

CREATE OR REPLACE FUNCTION dev_console_cleanup_orphan_auth_users(
  p_actor_user_id uuid,
  p_dry_run boolean DEFAULT true
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
  LOOP
    v_count := v_count + 1;
    v_deleted := v_deleted || jsonb_build_array(
      jsonb_build_object('user_id', v_user.id, 'email', v_user.email)
    );

    IF NOT coalesce(p_dry_run, true) THEN
      v_email_hash := owner_email_hash(v_user.email);

      DELETE FROM user_active_organizations WHERE user_id = v_user.id;
      DELETE FROM user_recovery_codes WHERE user_id = v_user.id;
      DELETE FROM self_service_demo_challenges WHERE user_id = v_user.id;

      IF v_user.email IS NOT NULL AND trim(v_user.email) <> '' THEN
        DELETE FROM access_keys
        WHERE key_type = 'demo'
          AND email IS NOT NULL
          AND lower(trim(email)) = lower(trim(v_user.email));
      END IF;

      IF v_email_hash IS NOT NULL THEN
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
    jsonb_build_object('count', v_count, 'dry_run', coalesce(p_dry_run, true))
  );

  RETURN jsonb_build_object(
    'dry_run', coalesce(p_dry_run, true),
    'count', v_count,
    'users', v_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION dev_console_cleanup_orphan_auth_users(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dev_console_cleanup_orphan_auth_users(uuid, boolean) TO service_role;
