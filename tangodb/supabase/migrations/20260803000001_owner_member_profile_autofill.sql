-- Autofill owner/member profile fields (email, name) from auth.users on org creation and first CRM entry.

CREATE OR REPLACE FUNCTION sync_member_profile_from_auth(p_member_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_member organization_members%ROWTYPE;
  v_user_email text;
  v_meta_display text;
  v_meta_username text;
  v_first_name text;
  v_last_name text;
  v_contact_email text;
  v_telegram text;
BEGIN
  IF p_member_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_member
  FROM organization_members om
  WHERE om.id = p_member_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT
    nullif(trim(u.email), ''),
    coalesce(
      nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''),
      nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(u.raw_user_meta_data ->> 'name'), '')
    ),
    coalesce(
      nullif(trim(u.raw_user_meta_data ->> 'username'), ''),
      nullif(trim(u.raw_user_meta_data ->> 'telegram_username'), '')
    )
  INTO v_user_email, v_meta_display, v_meta_username
  FROM auth.users u
  WHERE u.id = v_member.user_id;

  IF v_user_email IS NULL AND v_meta_display IS NULL AND v_meta_username IS NULL THEN
    RETURN;
  END IF;

  IF v_user_email IS NOT NULL AND v_user_email !~ '@tangodb\.auth$' THEN
    v_contact_email := v_user_email;
  END IF;

  IF v_meta_display IS NOT NULL THEN
    IF position(' ' in v_meta_display) > 0 THEN
      v_first_name := split_part(v_meta_display, ' ', 1);
      v_last_name := nullif(trim(substring(v_meta_display from position(' ' in v_meta_display) + 1)), '');
    ELSE
      v_first_name := v_meta_display;
    END IF;
  END IF;

  IF v_meta_username IS NOT NULL THEN
    v_telegram := CASE
      WHEN v_meta_username ~ '^@' THEN v_meta_username
      ELSE '@' || v_meta_username
    END;
  END IF;

  UPDATE organization_members
  SET
    contact_email = coalesce(contact_email, v_contact_email),
    display_name = coalesce(
      display_name,
      nullif(trim(v_meta_display), ''),
      nullif(split_part(v_user_email, '@', 1), '')
    ),
    first_name = coalesce(first_name, nullif(trim(v_first_name), '')),
    last_name = coalesce(last_name, nullif(trim(v_last_name), '')),
    telegram = coalesce(telegram, nullif(trim(v_telegram), ''))
  WHERE id = p_member_id
    AND (
      contact_email IS NULL
      OR display_name IS NULL
      OR first_name IS NULL
      OR last_name IS NULL
      OR telegram IS NULL
    );
END;
$$;

REVOKE ALL ON FUNCTION sync_member_profile_from_auth(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sync_member_profile_from_auth(uuid) TO service_role;

CREATE OR REPLACE FUNCTION ensure_own_member_profile()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_user_id uuid := auth.uid();
  v_member_id uuid;
BEGIN
  IF v_org_id IS NULL OR v_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT om.id INTO v_member_id
  FROM organization_members om
  WHERE om.organization_id = v_org_id
    AND om.user_id = v_user_id
    AND om.is_active = true
  LIMIT 1;

  IF v_member_id IS NULL THEN
    RETURN false;
  END IF;

  PERFORM sync_member_profile_from_auth(v_member_id);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION ensure_own_member_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ensure_own_member_profile() TO authenticated;

-- =============================================================================
-- create_self_service_demo_org — sync owner profile after member insert
-- =============================================================================

CREATE OR REPLACE FUNCTION create_self_service_demo_org(
  p_user_id uuid,
  p_display_name text,
  p_email_hash text,
  p_recovery_code_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_email text;
  v_email_confirmed timestamptz;
  v_org_id uuid;
  v_member_id uuid;
  v_slug text;
  v_slug_base text;
  v_slug_suffix int := 0;
  v_display_name text;
  v_current_version_id uuid;
  v_now timestamptz := now();
  v_demo_expires timestamptz;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required' USING ERRCODE = '22023';
  END IF;

  IF p_email_hash IS NULL OR length(trim(p_email_hash)) = 0 THEN
    RAISE EXCEPTION 'email_hash required' USING ERRCODE = '22023';
  END IF;

  SELECT u.email, u.email_confirmed_at
  INTO v_user_email, v_email_confirmed
  FROM auth.users u
  WHERE u.id = p_user_id;

  IF v_user_email IS NULL OR trim(v_user_email) = '' THEN
    RAISE EXCEPTION 'email required' USING ERRCODE = '22023';
  END IF;

  IF v_email_confirmed IS NULL THEN
    RAISE EXCEPTION 'email not confirmed' USING ERRCODE = '22023';
  END IF;

  IF owner_email_hash(v_user_email) IS DISTINCT FROM p_email_hash THEN
    RAISE EXCEPTION 'email hash mismatch' USING ERRCODE = '22023';
  END IF;

  IF NOT consume_self_service_demo_challenge(p_email_hash) THEN
    RAISE EXCEPTION 'turnstile challenge missing or expired' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM demo_owner_retention r WHERE r.owner_email_hash = p_email_hash
  ) THEN
    RAISE EXCEPTION 'demo already used for this email' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM access_keys ak
    WHERE ak.key_type = 'demo'
      AND ak.email IS NOT NULL
      AND lower(trim(ak.email)) = lower(trim(v_user_email))
  ) THEN
    RAISE EXCEPTION 'demo already used for this email' USING ERRCODE = '22023';
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
    nullif(trim(v_user_email), ''),
    'Owner'
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

  PERFORM sync_member_profile_from_auth(v_member_id);

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
      'source', 'email',
      'demo_expires_at', v_demo_expires
    )
  );

  RETURN jsonb_build_object(
    'organization_id', v_org_id,
    'status', 'demo_active',
    'demo_expires_at', v_demo_expires
  );
END;
$$;

REVOKE ALL ON FUNCTION create_self_service_demo_org(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_self_service_demo_org(uuid, text, text, text) TO service_role;

-- =============================================================================
-- complete_organization_onboarding — sync owner profile on first CRM setup
-- =============================================================================

CREATE OR REPLACE FUNCTION complete_organization_onboarding(
  p_organization_id uuid,
  p_name text,
  p_org_preset text DEFAULT 'dance_school',
  p_locale text DEFAULT 'ru-RU',
  p_currency_code text DEFAULT 'RUB',
  p_modules jsonb DEFAULT NULL,
  p_pair_cycle_enabled boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
  v_member_id uuid;
  v_trimmed_name text;
  v_preset text;
  v_locale text;
  v_currency text;
  v_modules jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization_id required' USING ERRCODE = '22023';
  END IF;

  v_trimmed_name := nullif(trim(p_name), '');
  IF v_trimmed_name IS NULL THEN
    RAISE EXCEPTION 'organization name required' USING ERRCODE = '22023';
  END IF;

  v_role := member_role(v_user_id, p_organization_id);
  IF v_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'only owner can complete onboarding' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM organizations o
    WHERE o.id = p_organization_id
      AND o.name IN ('Demo Organization', 'Organization')
      AND o.status IN ('demo_active', 'licensed')
  ) THEN
    RAISE EXCEPTION 'onboarding not required' USING ERRCODE = '22023';
  END IF;

  v_preset := coalesce(nullif(trim(p_org_preset), ''), 'dance_school');
  v_locale := coalesce(nullif(trim(p_locale), ''), 'ru-RU');
  v_currency := upper(coalesce(nullif(trim(p_currency_code), ''), 'RUB'));

  IF v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'invalid currency_code' USING ERRCODE = '22023';
  END IF;

  v_modules := coalesce(
    p_modules,
    '{
      "group_subscriptions": true,
      "personal_lessons": true,
      "pair_subscriptions": true,
      "trio_lessons": true,
      "multi_discipline": true,
      "locations": true,
      "finance_basic": true
    }'::jsonb
  );

  IF jsonb_typeof(v_modules) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid modules' USING ERRCODE = '22023';
  END IF;

  UPDATE organizations
  SET name = v_trimmed_name
  WHERE id = p_organization_id;

  INSERT INTO organization_settings (
    organization_id,
    org_preset,
    locale,
    currency_code,
    modules,
    pair_cycle_enabled,
    branding_name,
    updated_at
  )
  VALUES (
    p_organization_id,
    v_preset,
    v_locale,
    v_currency,
    v_modules,
    coalesce(p_pair_cycle_enabled, true),
    v_trimmed_name,
    now()
  )
  ON CONFLICT (organization_id) DO UPDATE
    SET org_preset = EXCLUDED.org_preset,
        locale = EXCLUDED.locale,
        currency_code = EXCLUDED.currency_code,
        modules = EXCLUDED.modules,
        pair_cycle_enabled = EXCLUDED.pair_cycle_enabled,
        branding_name = EXCLUDED.branding_name,
        updated_at = EXCLUDED.updated_at;

  SELECT om.id INTO v_member_id
  FROM organization_members om
  WHERE om.organization_id = p_organization_id
    AND om.user_id = v_user_id
    AND om.role = 'owner'
    AND om.is_active = true
  LIMIT 1;

  IF v_member_id IS NOT NULL THEN
    PERFORM sync_member_profile_from_auth(v_member_id);
  END IF;

  RETURN jsonb_build_object('ok', true, 'organization_id', p_organization_id);
END;
$$;

REVOKE ALL ON FUNCTION complete_organization_onboarding(
  uuid, text, text, text, text, jsonb, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_organization_onboarding(
  uuid, text, text, text, text, jsonb, boolean
) TO authenticated;

-- =============================================================================
-- activate_access_key — sync owner profile after member insert
-- =============================================================================

CREATE OR REPLACE FUNCTION activate_access_key(
  p_key_hash text,
  p_org_name text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
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

    PERFORM sync_member_profile_from_auth(v_member_id);

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

      PERFORM sync_member_profile_from_auth(v_member_id);

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

    PERFORM sync_member_profile_from_auth(v_member_id);

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

-- Backfill existing owners with empty profile fields.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT om.id
    FROM organization_members om
    WHERE om.role = 'owner'
      AND om.is_active = true
      AND (
        om.contact_email IS NULL
        OR om.first_name IS NULL
        OR om.last_name IS NULL
      )
  LOOP
    PERFORM sync_member_profile_from_auth(r.id);
  END LOOP;
END $$;
