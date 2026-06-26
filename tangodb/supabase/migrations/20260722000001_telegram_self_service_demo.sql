-- S2: Telegram self-service demo (synthetic auth user + demo org, no email/password)

-- =============================================================================
-- 1. telegram_id_hash helper
-- =============================================================================

CREATE OR REPLACE FUNCTION telegram_id_hash(p_telegram_id text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT encode(digest(trim(coalesce(p_telegram_id, '')), 'sha256'), 'hex');
$$;

REVOKE ALL ON FUNCTION telegram_id_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION telegram_id_hash(text) TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS idx_demo_owner_retention_telegram_hash
  ON demo_owner_retention (telegram_id_hash)
  WHERE telegram_id_hash IS NOT NULL;

-- =============================================================================
-- 2. create_telegram_self_service_demo_org
-- =============================================================================

CREATE OR REPLACE FUNCTION create_telegram_self_service_demo_org(
  p_user_id uuid,
  p_telegram_id bigint,
  p_display_name text DEFAULT NULL,
  p_recovery_code_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user_email text;
  v_app_tg text;
  v_tg_hash text;
  v_org_id uuid;
  v_member_id uuid;
  v_slug text;
  v_slug_base text;
  v_slug_suffix int := 0;
  v_display_name text;
  v_current_version_id uuid;
  v_now timestamptz := now();
  v_demo_expires timestamptz;
  v_expected_email text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required' USING ERRCODE = '22023';
  END IF;

  IF p_telegram_id IS NULL OR p_telegram_id <= 0 THEN
    RAISE EXCEPTION 'telegram_id required' USING ERRCODE = '22023';
  END IF;

  v_tg_hash := telegram_id_hash(p_telegram_id::text);
  v_expected_email := 'tg_' || p_telegram_id::text || '@tangodb.auth';

  SELECT u.email, u.raw_app_meta_data ->> 'telegram_id'
  INTO v_user_email, v_app_tg
  FROM auth.users u
  WHERE u.id = p_user_id;

  IF v_user_email IS NULL OR trim(v_user_email) = '' THEN
    RAISE EXCEPTION 'user email required' USING ERRCODE = '22023';
  END IF;

  IF lower(trim(v_user_email)) IS DISTINCT FROM lower(trim(v_expected_email)) THEN
    RAISE EXCEPTION 'telegram user email mismatch' USING ERRCODE = '22023';
  END IF;

  IF v_app_tg IS NOT NULL AND v_app_tg <> '' AND v_app_tg IS DISTINCT FROM p_telegram_id::text THEN
    RAISE EXCEPTION 'telegram_id metadata mismatch' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM demo_owner_retention r WHERE r.telegram_id_hash = v_tg_hash
  ) THEN
    RAISE EXCEPTION 'demo already used for this telegram account' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM organization_members om
    WHERE om.user_id = p_user_id
      AND om.is_active = true
  ) THEN
    RAISE EXCEPTION 'user already has organization membership' USING ERRCODE = '22023';
  END IF;

  v_current_version_id := current_crm_version_id();
  IF v_current_version_id IS NULL THEN
    RAISE EXCEPTION 'crm version not configured' USING ERRCODE = '22023';
  END IF;

  v_display_name := coalesce(
    nullif(trim(p_display_name), ''),
    'Telegram User'
  );

  v_slug_base := slugify_org_name('Demo Organization');
  v_slug := v_slug_base;
  WHILE EXISTS (SELECT 1 FROM organizations o WHERE o.slug = v_slug) LOOP
    v_slug_suffix := v_slug_suffix + 1;
    v_slug := v_slug_base || '-' || v_slug_suffix::text;
  END LOOP;

  v_demo_expires := v_now + interval '30 days';

  INSERT INTO organizations (
    name,
    slug,
    status,
    crm_version_id,
    demo_activated_at,
    demo_expires_at,
    data_purge_at,
    owner_user_id
  )
  VALUES (
    'Demo Organization',
    v_slug,
    'demo_active',
    v_current_version_id,
    v_now,
    v_demo_expires,
    v_demo_expires,
    p_user_id
  )
  RETURNING id INTO v_org_id;

  INSERT INTO organization_settings (organization_id)
  VALUES (v_org_id);

  INSERT INTO organization_members (organization_id, user_id, role, display_name, joined_at)
  VALUES (v_org_id, p_user_id, 'owner', v_display_name, v_now)
  RETURNING id INTO v_member_id;

  INSERT INTO user_active_organizations (user_id, organization_id, member_id, updated_at)
  VALUES (p_user_id, v_org_id, v_member_id, v_now)
  ON CONFLICT (user_id) DO UPDATE
    SET organization_id = EXCLUDED.organization_id,
        member_id = EXCLUDED.member_id,
        updated_at = EXCLUDED.updated_at;

  IF p_recovery_code_hash IS NOT NULL AND length(trim(p_recovery_code_hash)) > 0 THEN
    UPDATE user_recovery_codes
    SET revoked_at = v_now
    WHERE user_id = p_user_id
      AND revoked_at IS NULL;

    INSERT INTO user_recovery_codes (user_id, code_hash, shown_at)
    VALUES (p_user_id, p_recovery_code_hash, NULL);
  END IF;

  INSERT INTO platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  VALUES (
    p_user_id,
    'demo.self_service_created',
    'organization',
    v_org_id,
    jsonb_build_object(
      'source', 'telegram',
      'telegram_id_hash', v_tg_hash,
      'demo_expires_at', v_demo_expires
    )
  );

  RETURN jsonb_build_object(
    'organization_id', v_org_id,
    'status', 'demo_active',
    'demo_expires_at', v_demo_expires,
    'is_new_demo', true
  );
END;
$$;

REVOKE ALL ON FUNCTION create_telegram_self_service_demo_org(uuid, bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_telegram_self_service_demo_org(uuid, bigint, text, text) TO service_role;
