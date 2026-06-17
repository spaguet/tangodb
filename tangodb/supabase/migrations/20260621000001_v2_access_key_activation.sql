-- TangoDB v2 Phase 1A-L (A-6, A-11): access key activation + demo lifecycle

-- =============================================================================
-- 1. Helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION slugify_org_name(p_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_slug text;
BEGIN
  v_slug := lower(trim(p_name));
  v_slug := regexp_replace(v_slug, '[^a-z0-9]+', '-', 'g');
  v_slug := trim(both '-' from v_slug);
  IF v_slug = '' THEN
    v_slug := 'org';
  END IF;
  RETURN left(v_slug, 48);
END;
$$;

CREATE OR REPLACE FUNCTION current_crm_version_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM crm_product_versions
  WHERE is_current = true
  ORDER BY released_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION queue_demo_notification(
  p_type text,
  p_org_id uuid,
  p_email text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO platform_audit_log (action, target_type, target_id, metadata)
  VALUES (
    'notification.stub',
    'organization',
    p_org_id,
    jsonb_build_object(
      'notification_type', p_type,
      'recipient_email', p_email
    )
  );
END;
$$;

-- =============================================================================
-- 2. activate_access_key — demo / lifetime / demo→lifetime upgrade
-- =============================================================================

CREATE OR REPLACE FUNCTION activate_access_key(
  p_key_hash text,
  p_org_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
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
BEGIN
  IF v_user_id IS NULL THEN
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
  IF v_key.crm_version_id IS DISTINCT FROM v_current_version_id THEN
    RAISE EXCEPTION 'key for different CRM version' USING ERRCODE = '22023';
  END IF;

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
      name,
      slug,
      status,
      crm_version_id,
      access_key_id,
      demo_activated_at,
      demo_expires_at,
      data_purge_at,
      owner_user_id
    )
    VALUES (
      v_org_name,
      v_slug,
      'demo_active',
      v_key.crm_version_id,
      v_key.id,
      v_now,
      v_now + interval '30 days',
      v_now + interval '60 days',
      v_user_id
    )
    RETURNING id INTO v_org_id;

    INSERT INTO organization_settings (organization_id)
    VALUES (v_org_id);

    INSERT INTO organization_members (organization_id, user_id, role, display_name, joined_at)
    VALUES (v_org_id, v_user_id, 'owner', split_part(v_user_email, '@', 1), v_now)
    RETURNING id INTO v_member_id;

    UPDATE access_keys
    SET status = 'active',
        organization_id = v_org_id,
        activated_at = v_now,
        demo_expires_at = v_now + interval '30 days',
        data_purge_at = v_now + interval '60 days'
    WHERE id = v_key.id;

    PERFORM set_active_organization(v_org_id);

    RETURN jsonb_build_object(
      'organization_id', v_org_id,
      'key_type', 'demo',
      'status', 'demo_active',
      'upgraded', false
    );
  END IF;

  IF v_key.key_type = 'lifetime' THEN
    SELECT o.*
    INTO v_existing_org
    FROM organizations o
    WHERE o.owner_user_id = v_user_id
      AND o.status IN ('demo_active', 'demo_retention')
    ORDER BY o.created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      v_org_id := v_existing_org.id;

      UPDATE organizations
      SET status = 'licensed',
          access_key_id = v_key.id,
          data_purge_at = NULL,
          demo_expires_at = NULL
      WHERE id = v_org_id;

      INSERT INTO organization_licenses (
        organization_id,
        crm_version_id,
        license_type,
        access_key_id,
        activated_at,
        expires_at
      )
      VALUES (
        v_org_id,
        v_key.crm_version_id,
        'lifetime',
        v_key.id,
        v_now,
        NULL
      )
      ON CONFLICT (organization_id) DO UPDATE
        SET crm_version_id = EXCLUDED.crm_version_id,
            license_type = EXCLUDED.license_type,
            access_key_id = EXCLUDED.access_key_id,
            activated_at = EXCLUDED.activated_at,
            expires_at = NULL;

      UPDATE access_keys
      SET status = 'consumed',
          organization_id = v_org_id,
          activated_at = v_now
      WHERE id = v_key.id;

      PERFORM set_active_organization(v_org_id);

      RETURN jsonb_build_object(
        'organization_id', v_org_id,
        'key_type', 'lifetime',
        'status', 'licensed',
        'upgraded', true
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

    INSERT INTO organizations (
      name,
      slug,
      status,
      crm_version_id,
      access_key_id,
      owner_user_id
    )
    VALUES (
      v_org_name,
      v_slug,
      'licensed',
      v_key.crm_version_id,
      v_key.id,
      v_user_id
    )
    RETURNING id INTO v_org_id;

    INSERT INTO organization_settings (organization_id)
    VALUES (v_org_id);

    INSERT INTO organization_members (organization_id, user_id, role, display_name, joined_at)
    VALUES (v_org_id, v_user_id, 'owner', split_part(v_user_email, '@', 1), v_now)
    RETURNING id INTO v_member_id;

    INSERT INTO organization_licenses (
      organization_id,
      crm_version_id,
      license_type,
      access_key_id,
      activated_at,
      expires_at
    )
    VALUES (
      v_org_id,
      v_key.crm_version_id,
      'lifetime',
      v_key.id,
      v_now,
      NULL
    );

    UPDATE access_keys
    SET status = 'consumed',
        organization_id = v_org_id,
        activated_at = v_now
    WHERE id = v_key.id;

    PERFORM set_active_organization(v_org_id);

    RETURN jsonb_build_object(
      'organization_id', v_org_id,
      'key_type', 'lifetime',
      'status', 'licensed',
      'upgraded', false
    );
  END IF;

  RAISE EXCEPTION 'invalid access key' USING ERRCODE = '22023';
END;
$$;

REVOKE ALL ON FUNCTION activate_access_key(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION activate_access_key(text, text) TO authenticated;

-- =============================================================================
-- 3. Demo lifecycle — demo_active → demo_retention + notification stubs
-- =============================================================================

CREATE OR REPLACE FUNCTION run_demo_lifecycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_transitioned int := 0;
  v_notified_expiring int := 0;
  v_notified_retention int := 0;
  v_notified_purge int := 0;
  rec record;
  v_owner_email text;
BEGIN
  UPDATE organizations o
  SET status = 'demo_retention'
  WHERE o.status = 'demo_active'
    AND o.demo_expires_at IS NOT NULL
    AND o.demo_expires_at < now();

  GET DIAGNOSTICS v_transitioned = ROW_COUNT;

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

  FOR rec IN
    SELECT o.id, o.owner_user_id
    FROM organizations o
    WHERE o.status = 'demo_retention'
      AND o.demo_expires_at IS NOT NULL
      AND o.demo_expires_at <= now()
      AND NOT EXISTS (
        SELECT 1
        FROM platform_audit_log pal
        WHERE pal.target_id = o.id
          AND pal.action = 'notification.stub'
          AND pal.metadata ->> 'notification_type' = 'demo_retention_started'
          AND pal.created_at > now() - interval '30 days'
      )
  LOOP
    SELECT u.email INTO v_owner_email FROM auth.users u WHERE u.id = rec.owner_user_id;
    IF v_owner_email IS NOT NULL THEN
      PERFORM queue_demo_notification('demo_retention_started', rec.id, v_owner_email);
      v_notified_retention := v_notified_retention + 1;
    END IF;
  END LOOP;

  FOR rec IN
    SELECT o.id, o.owner_user_id, o.data_purge_at
    FROM organizations o
    WHERE o.status = 'demo_retention'
      AND o.data_purge_at IS NOT NULL
      AND o.data_purge_at > now()
      AND o.data_purge_at <= now() + interval '7 days'
      AND NOT EXISTS (
        SELECT 1
        FROM platform_audit_log pal
        WHERE pal.target_id = o.id
          AND pal.action = 'notification.stub'
          AND pal.metadata ->> 'notification_type' = 'demo_purge_warning_7d'
          AND pal.created_at > now() - interval '6 days'
      )
  LOOP
    SELECT u.email INTO v_owner_email FROM auth.users u WHERE u.id = rec.owner_user_id;
    IF v_owner_email IS NOT NULL THEN
      PERFORM queue_demo_notification('demo_purge_warning_7d', rec.id, v_owner_email);
      v_notified_purge := v_notified_purge + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'transitioned_to_retention', v_transitioned,
    'notifications_expiring', v_notified_expiring,
    'notifications_retention', v_notified_retention,
    'notifications_purge_warning', v_notified_purge
  );
END;
$$;

REVOKE ALL ON FUNCTION run_demo_lifecycle() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION run_demo_lifecycle() TO service_role;

-- =============================================================================
-- 4. Purge expired demo organizations
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
  v_key_id uuid;
BEGIN
  FOR rec IN
    SELECT o.id, o.access_key_id, o.name
    FROM organizations o
    WHERE o.status = 'demo_retention'
      AND o.data_purge_at IS NOT NULL
      AND o.data_purge_at < now()
    FOR UPDATE
  LOOP
    v_key_id := rec.access_key_id;

    DELETE FROM user_active_organizations uao
    WHERE uao.organization_id = rec.id;

    DELETE FROM organization_licenses ol
    WHERE ol.organization_id = rec.id;

    DELETE FROM organization_members om
    WHERE om.organization_id = rec.id;

    DELETE FROM organization_settings os
    WHERE os.organization_id = rec.id;

    UPDATE organizations
    SET
      name = 'purged',
      slug = NULL,
      status = 'purged',
      owner_user_id = NULL,
      demo_activated_at = NULL,
      demo_expires_at = NULL,
      data_purge_at = NULL,
      access_key_id = NULL
    WHERE id = rec.id;

    IF v_key_id IS NOT NULL THEN
      UPDATE access_keys
      SET status = 'consumed'
      WHERE id = v_key_id
        AND key_type = 'demo';
    END IF;

    INSERT INTO platform_audit_log (action, target_type, target_id, metadata)
    VALUES (
      'org.purged',
      'organization',
      rec.id,
      jsonb_build_object('previous_name', rec.name)
    );

    v_purged := v_purged + 1;
  END LOOP;

  RETURN jsonb_build_object('purged_count', v_purged);
END;
$$;

REVOKE ALL ON FUNCTION purge_expired_demo_organizations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_expired_demo_organizations() TO service_role;

GRANT EXECUTE ON FUNCTION slugify_org_name(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION current_crm_version_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION queue_demo_notification(text, uuid, text) TO service_role;
