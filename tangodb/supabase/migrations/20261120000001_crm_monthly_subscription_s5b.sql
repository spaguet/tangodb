-- S5b / 2.11.9: Detect/Save destination, org_created enqueue in demo TX, digest enqueue from S4 source.
-- Token stays in PLATFORM_TELEGRAM_BOT_TOKEN. No webhook. No authenticated GRANT.

BEGIN;

-- =============================================================================
-- 1. Save destination (chat_id only)
-- =============================================================================

CREATE OR REPLACE FUNCTION save_platform_notification_settings(
  p_chat_id bigint,
  p_updated_by uuid,
  p_title text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_chat_id IS NULL OR p_chat_id = 0 THEN
    RAISE EXCEPTION 'telegram_chat_id_required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO platform_notification_settings (id, telegram_chat_id, title, updated_by, updated_at)
  VALUES (
    1,
    p_chat_id,
    COALESCE(NULLIF(trim(p_title), ''), 'developer'),
    p_updated_by,
    now()
  )
  ON CONFLICT (id) DO UPDATE
    SET telegram_chat_id = EXCLUDED.telegram_chat_id,
        title = COALESCE(NULLIF(trim(p_title), ''), platform_notification_settings.title, 'developer'),
        updated_by = EXCLUDED.updated_by,
        updated_at = now();

  INSERT INTO platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  VALUES (
    p_updated_by,
    'platform_bot.settings_save',
    'platform_notification_settings',
    NULL,
    jsonb_build_object('telegram_chat_id', p_chat_id)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'telegram_chat_id', p_chat_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION requeue_all_blocked_platform_notifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n int;
BEGIN
  UPDATE platform_notification_outbox
  SET
    status = 'pending',
    available_at = now(),
    lease_owner = NULL,
    lease_until = NULL,
    claim_token = NULL,
    last_error_code = NULL
  WHERE status = 'blocked';

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- =============================================================================
-- 2. org_created (same TX as self-service INSERT)
-- =============================================================================

CREATE OR REPLACE FUNCTION enqueue_platform_org_created_notifications(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org organizations%ROWTYPE;
  v_locale text;
  v_email text;
  v_domain text;
  v_chat_id bigint;
  v_email_to text;
  v_header text;
  v_telegram text;
  v_email_subject text;
  v_email_text text;
  v_payload jsonb;
  v_tg_status text;
  v_tg_error text;
  v_email_id uuid;
  v_tg_id uuid;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'organization_id_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_not_found' USING ERRCODE = '22023';
  END IF;

  SELECT locale INTO v_locale
  FROM organization_settings
  WHERE organization_id = p_org_id;

  SELECT u.email INTO v_email
  FROM auth.users u
  WHERE u.id = v_org.owner_user_id;

  v_domain := NULLIF(split_part(lower(trim(COALESCE(v_email, ''))), '@', 2), '');

  SELECT telegram_chat_id INTO v_chat_id
  FROM platform_notification_settings
  WHERE id = 1;

  SELECT NULLIF(trim(config #>> '{contacts,email}'), '')
  INTO v_email_to
  FROM platform_payment_methods
  WHERE id = 1;

  v_header := format(
    E'[org_created] %s\norg: %s\ndomain: %s\nlocale: %s\ndemo until: %s',
    left(_platform_notification_plain(v_org.name), 80),
    _platform_notification_short_id(v_org.id),
    COALESCE(v_domain, '—'),
    COALESCE(v_locale, '—'),
    COALESCE(to_char(v_org.demo_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'), '—')
  );
  v_telegram := left(v_header, 4096);

  v_email_subject := 'TangoDB: новая демо-база — ' || COALESCE(v_org.name, '');
  v_email_text := concat_ws(
    E'\n',
    'Создана новая self-service демо-база.',
    '',
    'Organization: ' || COALESCE(v_org.name, '') || ' (' || v_org.id::text || ')',
    'Status: ' || COALESCE(v_org.status, ''),
    'Locale: ' || COALESCE(v_locale, ''),
    'Email domain: ' || COALESCE(v_domain, ''),
    'Demo expires: ' || COALESCE(v_org.demo_expires_at::text, ''),
    '',
    'Не support ticket. Проверьте org в Dev Console → Tenants.'
  );

  v_payload := _platform_notification_sanitize_payload(jsonb_build_object(
    'telegram_text', v_telegram,
    'email_subject', left(v_email_subject, 200),
    'email_text', left(v_email_text, 8000),
    'email_to', v_email_to,
    'org_id', v_org.id,
    'org_name', left(v_org.name, 120),
    'email_domain', v_domain,
    'locale', v_locale
  ));

  IF v_chat_id IS NULL THEN
    v_tg_status := 'blocked';
    v_tg_error := 'config_missing';
  ELSE
    v_tg_status := 'pending';
    v_tg_error := NULL;
  END IF;

  v_email_id := enqueue_platform_notification(
    'email',
    'org_created',
    'organization',
    v_org.id,
    'org_created:' || v_org.id::text,
    v_payload,
    'pending',
    NULL
  );

  v_tg_id := enqueue_platform_notification(
    'telegram',
    'org_created',
    'organization',
    v_org.id,
    'org_created:' || v_org.id::text,
    v_payload,
    v_tg_status,
    v_tg_error
  );

  RETURN jsonb_build_object(
    'ok', true,
    'email_id', v_email_id,
    'telegram_id', v_tg_id,
    'telegram_status', v_tg_status
  );
END;
$$;

-- =============================================================================
-- 3. Daily digest from S4 SQL-source
-- =============================================================================

CREATE OR REPLACE FUNCTION enqueue_platform_crm_subscription_digest(
  p_as_of timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_as_of timestamptz := COALESCE(p_as_of, now());
  v_date text := to_char((COALESCE(p_as_of, now()) AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD');
  v_chat_id bigint;
  v_email_to text;
  v_type text;
  v_label text;
  v_n int;
  v_lines text;
  v_header text;
  v_telegram text;
  v_email_subject text;
  v_email_text text;
  v_payload jsonb;
  v_tg_status text;
  v_tg_error text;
  v_email_id uuid;
  v_tg_id uuid;
  v_expiring int := 0;
  v_overdue int := 0;
  rec record;
BEGIN
  SELECT telegram_chat_id INTO v_chat_id
  FROM platform_notification_settings
  WHERE id = 1;

  SELECT NULLIF(trim(config #>> '{contacts,email}'), '')
  INTO v_email_to
  FROM platform_payment_methods
  WHERE id = 1;

  IF v_chat_id IS NULL THEN
    v_tg_status := 'blocked';
    v_tg_error := 'config_missing';
  ELSE
    v_tg_status := 'pending';
    v_tg_error := NULL;
  END IF;

  FOREACH v_type IN ARRAY ARRAY['expiring', 'overdue'] LOOP
    v_n := 0;
    v_lines := '';
    v_label := CASE v_type WHEN 'expiring' THEN 'истекает (T−7)' ELSE 'просрочено' END;

    FOR rec IN
      SELECT *
      FROM list_platform_crm_subscription_digest(v_as_of)
      WHERE digest_type = v_type
      ORDER BY current_period_end NULLS LAST, organization_name
    LOOP
      v_n := v_n + 1;
      v_lines := v_lines || format(
        E'\n- %s (%s) %s end %s',
        left(_platform_notification_plain(rec.organization_name), 80),
        _platform_notification_short_id(rec.organization_id),
        COALESCE(rec.subscription_status, ''),
        COALESCE(to_char(rec.current_period_end AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'), '—')
      );
    END LOOP;

    IF v_type = 'expiring' THEN
      v_expiring := v_n;
    ELSE
      v_overdue := v_n;
    END IF;

    IF v_n = 0 THEN
      CONTINUE;
    END IF;

    v_header := format('[digest] %s %s (%s)', v_label, v_date, v_n);
    v_telegram := left(v_header || v_lines, 4096);
    v_email_subject := 'TangoDB digest: ' || v_label || ' ' || v_date;
    v_email_text := left(v_header || v_lines, 8000);

    v_payload := _platform_notification_sanitize_payload(jsonb_build_object(
      'telegram_text', v_telegram,
      'email_subject', left(v_email_subject, 200),
      'email_text', v_email_text,
      'email_to', v_email_to,
      'digest_type', v_type,
      'digest_date', v_date,
      'count', v_n
    ));

    v_email_id := enqueue_platform_notification(
      'email',
      'subscription_digest',
      'crm_subscription_digest',
      NULL,
      'digest:' || v_type || ':' || v_date,
      v_payload,
      'pending',
      NULL
    );

    v_tg_id := enqueue_platform_notification(
      'telegram',
      'subscription_digest',
      'crm_subscription_digest',
      NULL,
      'digest:' || v_type || ':' || v_date,
      v_payload,
      v_tg_status,
      v_tg_error
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'digest_date', v_date,
    'expiring_count', v_expiring,
    'overdue_count', v_overdue
  );
END;
$$;

-- =============================================================================
-- 4. Patch self-service demo RPCs — enqueue in the same TX as INSERT org
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
  v_is_developer boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required' USING ERRCODE = '22023';
  END IF;

  IF p_email_hash IS NULL OR length(trim(p_email_hash)) = 0 THEN
    RAISE EXCEPTION 'email_hash required' USING ERRCODE = '22023';
  END IF;

  v_is_developer := is_platform_developer(p_user_id);

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

  IF NOT v_is_developer AND EXISTS (
    SELECT 1 FROM demo_owner_retention r WHERE r.owner_email_hash = p_email_hash
  ) THEN
    RAISE EXCEPTION 'demo already used for this email' USING ERRCODE = '22023';
  END IF;

  IF NOT v_is_developer AND EXISTS (
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

  IF NOT v_is_developer AND NOT consume_self_service_demo_challenge(p_email_hash) THEN
    RAISE EXCEPTION 'turnstile challenge missing or expired' USING ERRCODE = '22023';
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
      'demo_expires_at', v_demo_expires,
      'platform_developer', v_is_developer
    )
  );

  PERFORM enqueue_platform_org_created_notifications(v_org_id);

  RETURN jsonb_build_object(
    'organization_id', v_org_id,
    'status', 'demo_active',
    'demo_expires_at', v_demo_expires
  );
END;
$$;

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

  PERFORM enqueue_platform_org_created_notifications(v_org_id);

  RETURN jsonb_build_object(
    'organization_id', v_org_id,
    'status', 'demo_active',
    'demo_expires_at', v_demo_expires,
    'is_new_demo', true
  );
END;
$$;

REVOKE ALL ON FUNCTION save_platform_notification_settings(bigint, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION requeue_all_blocked_platform_notifications() FROM PUBLIC;
REVOKE ALL ON FUNCTION enqueue_platform_org_created_notifications(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION enqueue_platform_crm_subscription_digest(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_self_service_demo_org(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_telegram_self_service_demo_org(uuid, bigint, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION save_platform_notification_settings(bigint, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION requeue_all_blocked_platform_notifications() TO service_role;
GRANT EXECUTE ON FUNCTION enqueue_platform_org_created_notifications(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION enqueue_platform_crm_subscription_digest(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION create_self_service_demo_org(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION create_telegram_self_service_demo_org(uuid, bigint, text, text) TO service_role;

COMMENT ON FUNCTION enqueue_platform_org_created_notifications(uuid) IS
  'S5b: one org_created email+telegram outbox row per org. Dedupe org_created:<org_id>. Not a support ticket.';
COMMENT ON FUNCTION enqueue_platform_crm_subscription_digest(timestamptz) IS
  'S5b: enqueue daily developer digest from list_platform_crm_subscription_digest. Dedupe digest:<type>:<UTC date>.';
COMMENT ON FUNCTION save_platform_notification_settings(bigint, uuid, text) IS
  'S5b: Dev Console Save of telegram_chat_id. Token is never stored here.';

COMMIT;
