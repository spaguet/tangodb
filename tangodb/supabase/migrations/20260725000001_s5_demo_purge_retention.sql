-- S5 (Prompt 12): strict 30-day demo purge — DELETE business data, retention registry

-- =============================================================================
-- 1. Backfill legacy 60-day purge dates → demo_expires_at
-- =============================================================================

UPDATE organizations o
SET data_purge_at = o.demo_expires_at
WHERE o.status IN ('demo_active', 'demo_retention')
  AND o.demo_expires_at IS NOT NULL
  AND (o.data_purge_at IS NULL OR o.data_purge_at <> o.demo_expires_at);

UPDATE access_keys ak
SET data_purge_at = ak.demo_expires_at
WHERE ak.key_type = 'demo'
  AND ak.demo_expires_at IS NOT NULL
  AND (ak.data_purge_at IS NULL OR ak.data_purge_at <> ak.demo_expires_at);

-- =============================================================================
-- 2. Block writes for expired demo_active (no mandatory demo_retention phase)
-- =============================================================================

CREATE OR REPLACE FUNCTION organization_allows_writes(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organizations o
    WHERE o.id = p_org_id
      AND NOT o.schema_version_locked
      AND (
        (
          o.status = 'demo_active'
          AND (o.demo_expires_at IS NULL OR o.demo_expires_at > now())
        )
        OR (
          o.status = 'licensed'
          AND (
            organization_has_lifetime_license(o.id)
            OR organization_has_active_subscription(o.id)
          )
        )
      )
  );
$$;

-- =============================================================================
-- 3. Shared purge core — retention record + DELETE org (CASCADE business data)
-- =============================================================================

CREATE OR REPLACE FUNCTION _purge_demo_organization_core(
  p_org_id uuid,
  p_actor_user_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_force_licensed boolean DEFAULT false,
  p_audit_action text DEFAULT 'org.purged'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_org record;
  v_key_id uuid;
  v_has_lifetime boolean := false;
  v_has_active_sub boolean := false;
  v_owner_email text;
  v_tg_id text;
  v_email_hash text;
  v_tg_hash text;
  v_prev_name text;
  v_prev_status text;
BEGIN
  SELECT o.id, o.access_key_id, o.name, o.status, o.owner_user_id,
         o.demo_activated_at, o.payment_ref
  INTO v_org
  FROM organizations o
  WHERE o.id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_not_found' USING ERRCODE = '22023';
  END IF;

  IF v_org.status = 'purged' THEN
    RAISE EXCEPTION 'organization_already_purged' USING ERRCODE = '22023';
  END IF;

  SELECT organization_has_lifetime_license(p_org_id) INTO v_has_lifetime;

  IF v_has_lifetime AND NOT coalesce(p_force_licensed, false) THEN
    RAISE EXCEPTION 'licensed_org_purge_forbidden' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM organization_subscriptions os
    WHERE os.organization_id = p_org_id
      AND os.status IN ('active', 'past_due')
  ) INTO v_has_active_sub;

  IF v_has_active_sub AND NOT coalesce(p_force_licensed, false) THEN
    RAISE EXCEPTION 'active_subscription_purge_forbidden' USING ERRCODE = '22023';
  END IF;

  v_prev_name := v_org.name;
  v_prev_status := v_org.status;
  v_key_id := v_org.access_key_id;

  IF v_org.owner_user_id IS NOT NULL THEN
    SELECT u.email, u.raw_app_meta_data ->> 'telegram_id'
    INTO v_owner_email, v_tg_id
    FROM auth.users u
    WHERE u.id = v_org.owner_user_id;

    IF v_owner_email IS NOT NULL AND trim(v_owner_email) <> '' THEN
      v_email_hash := owner_email_hash(v_owner_email);
    END IF;

    IF v_tg_id IS NOT NULL AND trim(v_tg_id) <> '' THEN
      v_tg_hash := telegram_id_hash(v_tg_id);
    END IF;

    IF v_email_hash IS NOT NULL THEN
      INSERT INTO demo_owner_retention (
        owner_email_hash,
        telegram_id_hash,
        first_demo_at,
        purged_at,
        payment_ref
      )
      VALUES (
        v_email_hash,
        v_tg_hash,
        coalesce(v_org.demo_activated_at, now()),
        now(),
        v_org.payment_ref
      )
      ON CONFLICT (owner_email_hash) DO UPDATE
        SET purged_at = EXCLUDED.purged_at,
            telegram_id_hash = coalesce(EXCLUDED.telegram_id_hash, demo_owner_retention.telegram_id_hash),
            payment_ref = coalesce(EXCLUDED.payment_ref, demo_owner_retention.payment_ref);
    END IF;
  END IF;

  DELETE FROM user_active_organizations uao
  WHERE uao.organization_id = p_org_id;

  UPDATE organizations
  SET access_key_id = NULL
  WHERE id = p_org_id;

  UPDATE access_keys
  SET status = 'consumed', organization_id = NULL
  WHERE organization_id = p_org_id
     OR (v_key_id IS NOT NULL AND id = v_key_id);

  DELETE FROM organizations
  WHERE id = p_org_id;

  INSERT INTO platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  VALUES (
    p_actor_user_id,
    p_audit_action,
    'organization',
    p_org_id,
    jsonb_build_object(
      'previous_name', v_prev_name,
      'previous_status', v_prev_status,
      'reason', left(coalesce(p_reason, ''), 500),
      'force_licensed', coalesce(p_force_licensed, false),
      'deleted', true
    )
  );

  RETURN jsonb_build_object('ok', true, 'organization_id', p_org_id, 'deleted', true);
END;
$$;

REVOKE ALL ON FUNCTION _purge_demo_organization_core(uuid, uuid, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _purge_demo_organization_core(uuid, uuid, text, boolean, text) TO service_role;

-- =============================================================================
-- 4. purge_single_organization — delegate to shared core
-- =============================================================================

CREATE OR REPLACE FUNCTION purge_single_organization(
  p_org_id uuid,
  p_actor_user_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_force_licensed boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN _purge_demo_organization_core(
    p_org_id,
    p_actor_user_id,
    p_reason,
    p_force_licensed,
    'org.manual_purge'
  );
END;
$$;

-- =============================================================================
-- 5. purge_expired_demo_organizations — strict 30 days, no tombstone
-- =============================================================================

CREATE OR REPLACE FUNCTION purge_expired_demo_organizations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_purged int := 0;
  rec record;
BEGIN
  FOR rec IN
    SELECT o.id
    FROM organizations o
    WHERE o.status IN ('demo_active', 'demo_retention')
      AND o.data_purge_at IS NOT NULL
      AND o.data_purge_at <= now()
      AND NOT organization_has_lifetime_license(o.id)
      AND NOT EXISTS (
        SELECT 1
        FROM organization_subscriptions os
        WHERE os.organization_id = o.id
          AND os.status IN ('active', 'past_due')
      )
    FOR UPDATE
  LOOP
    PERFORM _purge_demo_organization_core(rec.id, NULL, NULL, false, 'org.purged');
    v_purged := v_purged + 1;
  END LOOP;

  RETURN jsonb_build_object('purged_count', v_purged);
END;
$$;

REVOKE ALL ON FUNCTION purge_expired_demo_organizations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_expired_demo_organizations() TO service_role;

-- =============================================================================
-- 6. run_demo_lifecycle — notifications only (no demo_retention transition)
-- =============================================================================

CREATE OR REPLACE FUNCTION run_demo_lifecycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_notified_expiring int := 0;
  rec record;
  v_owner_email text;
BEGIN
  FOR rec IN
    SELECT o.id, o.name, o.demo_expires_at, o.owner_user_id
    FROM organizations o
    WHERE o.status = 'demo_active'
      AND o.demo_expires_at IS NOT NULL
      AND o.demo_expires_at > now()
      AND o.demo_expires_at <= now() + interval '7 days'
      AND NOT EXISTS (
        SELECT 1
        FROM platform_audit_log pal
        WHERE pal.target_id = o.id
          AND pal.action = 'notification.stub'
          AND pal.metadata ->> 'notification_type' = 'demo_expiring_7d'
          AND pal.created_at > now() - interval '6 days'
      )
  LOOP
    SELECT u.email INTO v_owner_email FROM auth.users u WHERE u.id = rec.owner_user_id;
    IF v_owner_email IS NOT NULL THEN
      PERFORM queue_demo_notification('demo_expiring_7d', rec.id, v_owner_email);
      v_notified_expiring := v_notified_expiring + 1;
    END IF;
  END LOOP;

  FOR rec IN
    SELECT o.id, o.owner_user_id
    FROM organizations o
    WHERE o.status = 'demo_active'
      AND o.demo_expires_at IS NOT NULL
      AND o.demo_expires_at > now()
      AND o.demo_expires_at <= now() + interval '1 day'
      AND NOT EXISTS (
        SELECT 1
        FROM platform_audit_log pal
        WHERE pal.target_id = o.id
          AND pal.action = 'notification.stub'
          AND pal.metadata ->> 'notification_type' = 'demo_expiring_1d'
          AND pal.created_at > now() - interval '20 hours'
      )
  LOOP
    SELECT u.email INTO v_owner_email FROM auth.users u WHERE u.id = rec.owner_user_id;
    IF v_owner_email IS NOT NULL THEN
      PERFORM queue_demo_notification('demo_expiring_1d', rec.id, v_owner_email);
      v_notified_expiring := v_notified_expiring + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'transitioned_to_retention', 0,
    'notifications_expiring', v_notified_expiring,
    'notifications_retention', 0,
    'notifications_purge_warning', 0
  );
END;
$$;

REVOKE ALL ON FUNCTION run_demo_lifecycle() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION run_demo_lifecycle() TO service_role;

-- =============================================================================
-- 7. Legacy demo-key activation — data_purge_at = demo_expires_at (30 days)
-- =============================================================================

CREATE OR REPLACE FUNCTION activate_access_key(
  p_key_hash text,
  p_org_name text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid := COALESCE(p_user_id, auth.uid());
  v_user_email text;
  v_key access_keys%ROWTYPE;
  v_current_version_id uuid;
  v_org_id uuid;
  v_member_id uuid;
  v_org_name text;
  v_slug text;
  v_slug_base text;
  v_slug_suffix int := 0;
  v_existing_org organizations%ROWTYPE;
  v_now timestamptz := now();
  v_demo_expires timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_user_id IS NOT NULL AND auth.uid() IS NOT NULL AND p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_key_hash IS NULL OR length(trim(p_key_hash)) = 0 THEN
    RAISE EXCEPTION 'invalid access key' USING ERRCODE = '22023';
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;
  IF v_user_email IS NULL OR trim(v_user_email) = '' THEN
    RAISE EXCEPTION 'email required for key activation' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_key
  FROM access_keys
  WHERE key_hash = p_key_hash
    AND status = 'pending'
    AND revoked_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid access key' USING ERRCODE = '22023';
  END IF;

  v_current_version_id := current_crm_version_id();
  IF v_current_version_id IS NULL THEN
    RAISE EXCEPTION 'crm version not configured' USING ERRCODE = '22023';
  END IF;

  IF v_key.crm_version_id IS DISTINCT FROM v_current_version_id THEN
    RAISE EXCEPTION 'key for different CRM version' USING ERRCODE = '22023';
  END IF;

  v_demo_expires := v_now + interval '30 days';

  IF v_key.key_type = 'demo' THEN
    IF v_key.email IS NULL OR lower(trim(v_key.email)) <> lower(trim(v_user_email)) THEN
      RAISE EXCEPTION 'invalid access key' USING ERRCODE = '22023';
    END IF;

    v_org_name := coalesce(nullif(trim(p_org_name), ''), 'Demo Organization');
    v_slug_base := slugify_org_name(v_org_name);
    v_slug := v_slug_base;

    WHILE EXISTS (SELECT 1 FROM organizations o WHERE o.slug = v_slug) LOOP
      v_slug_suffix := v_slug_suffix + 1;
      v_slug := v_slug_base || '-' || v_slug_suffix::text;
    END LOOP;

    INSERT INTO organizations (
      name, slug, status, crm_version_id, access_key_id,
      demo_activated_at, demo_expires_at, data_purge_at, owner_user_id
    )
    VALUES (
      v_org_name, v_slug, 'demo_active', v_key.crm_version_id, v_key.id,
      v_now, v_demo_expires, v_demo_expires, v_user_id
    )
    RETURNING id INTO v_org_id;

    INSERT INTO organization_settings (organization_id) VALUES (v_org_id);

    INSERT INTO organization_members (organization_id, user_id, role, display_name, joined_at)
    VALUES (v_org_id, v_user_id, 'owner', split_part(v_user_email, '@', 1), v_now)
    RETURNING id INTO v_member_id;

    UPDATE access_keys
    SET status = 'active', organization_id = v_org_id, activated_at = v_now,
        demo_expires_at = v_demo_expires, data_purge_at = v_demo_expires
    WHERE id = v_key.id;

    INSERT INTO user_active_organizations (user_id, organization_id, member_id, updated_at)
    VALUES (v_user_id, v_org_id, v_member_id, v_now)
    ON CONFLICT (user_id) DO UPDATE
      SET organization_id = EXCLUDED.organization_id,
          member_id = EXCLUDED.member_id,
          updated_at = EXCLUDED.updated_at;

    RETURN jsonb_build_object(
      'organization_id', v_org_id, 'key_type', 'demo', 'status', 'demo_active', 'upgraded', false
    );
  END IF;

  IF v_key.key_type = 'lifetime' THEN
    SELECT o.* INTO v_existing_org
    FROM organizations o
    WHERE o.owner_user_id = v_user_id
      AND o.status IN ('demo_active', 'demo_retention')
    ORDER BY o.created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      v_org_id := v_existing_org.id;

      UPDATE organizations
      SET status = 'licensed', access_key_id = v_key.id, data_purge_at = NULL, demo_expires_at = NULL
      WHERE id = v_org_id;

      INSERT INTO organization_licenses (
        organization_id, crm_version_id, license_type, access_key_id, activated_at, expires_at
      )
      VALUES (v_org_id, v_key.crm_version_id, 'lifetime', v_key.id, v_now, NULL)
      ON CONFLICT (organization_id) DO UPDATE
        SET crm_version_id = EXCLUDED.crm_version_id,
            license_type = EXCLUDED.license_type,
            access_key_id = EXCLUDED.access_key_id,
            activated_at = EXCLUDED.activated_at,
            expires_at = NULL;

      UPDATE access_keys
      SET status = 'consumed', organization_id = v_org_id, activated_at = v_now
      WHERE id = v_key.id;

      SELECT om.id INTO v_member_id
      FROM organization_members om
      WHERE om.organization_id = v_org_id AND om.user_id = v_user_id AND om.is_active = true
      LIMIT 1;

      IF v_member_id IS NULL THEN
        RAISE EXCEPTION 'membership missing after upgrade' USING ERRCODE = '22023';
      END IF;

      INSERT INTO user_active_organizations (user_id, organization_id, member_id, updated_at)
      VALUES (v_user_id, v_org_id, v_member_id, v_now)
      ON CONFLICT (user_id) DO UPDATE
        SET organization_id = EXCLUDED.organization_id,
          member_id = EXCLUDED.member_id,
          updated_at = EXCLUDED.updated_at;

      RETURN jsonb_build_object(
        'organization_id', v_org_id, 'key_type', 'lifetime', 'status', 'licensed', 'upgraded', true
      );
    END IF;

    v_org_name := coalesce(nullif(trim(p_org_name), ''), 'Organization');
    v_slug_base := slugify_org_name(v_org_name);
    v_slug := v_slug_base;
    v_slug_suffix := 0;

    WHILE EXISTS (SELECT 1 FROM organizations o WHERE o.slug = v_slug) LOOP
      v_slug_suffix := v_slug_suffix + 1;
      v_slug := v_slug_base || '-' || v_slug_suffix::text;
    END LOOP;

    INSERT INTO organizations (name, slug, status, crm_version_id, access_key_id, owner_user_id)
    VALUES (v_org_name, v_slug, 'licensed', v_key.crm_version_id, v_key.id, v_user_id)
    RETURNING id INTO v_org_id;

    INSERT INTO organization_settings (organization_id) VALUES (v_org_id);

    INSERT INTO organization_members (organization_id, user_id, role, display_name, joined_at)
    VALUES (v_org_id, v_user_id, 'owner', split_part(v_user_email, '@', 1), v_now)
    RETURNING id INTO v_member_id;

    INSERT INTO organization_licenses (
      organization_id, crm_version_id, license_type, access_key_id, activated_at, expires_at
    )
    VALUES (v_org_id, v_key.crm_version_id, 'lifetime', v_key.id, v_now, NULL);

    UPDATE access_keys
    SET status = 'consumed', organization_id = v_org_id, activated_at = v_now
    WHERE id = v_key.id;

    INSERT INTO user_active_organizations (user_id, organization_id, member_id, updated_at)
    VALUES (v_user_id, v_org_id, v_member_id, v_now)
    ON CONFLICT (user_id) DO UPDATE
      SET organization_id = EXCLUDED.organization_id,
          member_id = EXCLUDED.member_id,
          updated_at = EXCLUDED.updated_at;

    RETURN jsonb_build_object(
      'organization_id', v_org_id, 'key_type', 'lifetime', 'status', 'licensed', 'upgraded', false
    );
  END IF;

  RAISE EXCEPTION 'invalid access key' USING ERRCODE = '22023';
END;
$$;

REVOKE ALL ON FUNCTION activate_access_key(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION activate_access_key(text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION activate_access_key(text, text, uuid) TO service_role;
