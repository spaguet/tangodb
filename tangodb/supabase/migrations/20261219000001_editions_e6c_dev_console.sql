-- E6c: Dev Console edition metrics, billing search, adjust manual_plan, digest Studio, lifecycle RPC

BEGIN;

-- =============================================================================
-- 1. Over-cap indicator (display only)
-- =============================================================================

CREATE OR REPLACE FUNCTION dev_console_org_over_cap(p_org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_members bigint;
BEGIN
  IF p_org_id IS NULL THEN
    RETURN false;
  END IF;

  IF organization_active_edition(p_org_id) <> 'lite' THEN
    RETURN false;
  END IF;

  IF (SELECT count(*) FROM locations l WHERE l.organization_id = p_org_id) > 1 THEN
    RETURN true;
  END IF;

  IF (SELECT count(*) FROM disciplines d WHERE d.organization_id = p_org_id) > 1 THEN
    RETURN true;
  END IF;

  IF (
    SELECT count(*)
    FROM clients c
    WHERE c.organization_id = p_org_id
      AND c.archived_at IS NULL
  ) > 200 THEN
    RETURN true;
  END IF;

  SELECT
    (
      SELECT count(*)
      FROM organization_members om
      WHERE om.organization_id = p_org_id
        AND om.is_active
    )
    + (
      SELECT count(*)
      FROM organization_invites oi
      WHERE oi.organization_id = p_org_id
        AND oi.accepted_at IS NULL
        AND oi.revoked_at IS NULL
        AND oi.expires_at > now()
    )
  INTO v_members;

  RETURN v_members >= 8;
END;
$$;

REVOKE ALL ON FUNCTION dev_console_org_over_cap(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dev_console_org_over_cap(uuid) TO service_role;

-- =============================================================================
-- 2. Edition metrics (§17.5 / §18.7)
-- =============================================================================

CREATE OR REPLACE FUNCTION dev_console_edition_metrics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  RETURN jsonb_build_object(
    'org_count', (SELECT count(*) FROM organizations o WHERE o.status <> 'purged'),
    'status_demo_active', (SELECT count(*) FROM organizations WHERE status = 'demo_active'),
    'status_demo_retention', (SELECT count(*) FROM organizations WHERE status = 'demo_retention'),
    'status_licensed', (SELECT count(*) FROM organizations WHERE status = 'licensed'),
    'status_suspended', (SELECT count(*) FROM organizations WHERE status = 'suspended'),
    'status_purged', (SELECT count(*) FROM organizations WHERE status = 'purged'),
    'edition_lite', (
      SELECT count(*)
      FROM organizations o
      WHERE o.status = 'licensed'
        AND organization_active_edition(o.id) = 'lite'
    ),
    'edition_studio', (
      SELECT count(*)
      FROM organizations o
      WHERE o.status = 'licensed'
        AND organization_active_edition(o.id) = 'studio'
    ),
    'edition_pro', (
      SELECT count(*)
      FROM organizations o
      WHERE o.status = 'licensed'
        AND organization_active_edition(o.id) = 'pro'
    ),
    'live_trial_pro', (
      SELECT count(DISTINCT e.organization_id)
      FROM organization_entitlements e
      WHERE e.instrument = 'trial_pro'
        AND e.status IN ('active', 'past_due')
        AND organization_entitlement_row_phase(e, v_now) = 'active'
    ),
    'live_studio_monthly', (
      SELECT count(DISTINCT e.organization_id)
      FROM organization_entitlements e
      WHERE e.instrument = 'studio_monthly'
        AND e.status IN ('active', 'past_due')
        AND organization_entitlement_row_phase(e, v_now) IN ('active', 'past_due')
    ),
    'live_pro_monthly', (
      SELECT count(DISTINCT e.organization_id)
      FROM organization_entitlements e
      WHERE e.instrument = 'pro_monthly'
        AND e.status IN ('active', 'past_due')
        AND organization_entitlement_row_phase(e, v_now) IN ('active', 'past_due')
    ),
    'live_pro_lifetime', (
      SELECT count(DISTINCT e.organization_id)
      FROM organization_entitlements e
      WHERE e.instrument = 'pro_lifetime'
        AND e.status IN ('active', 'past_due')
        AND organization_entitlement_row_phase(e, v_now) = 'active'
    ),
    'over_cap_lite', (
      SELECT count(*)
      FROM organizations o
      WHERE o.status = 'licensed'
        AND dev_console_org_over_cap(o.id)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION dev_console_edition_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dev_console_edition_metrics() TO service_role;

-- =============================================================================
-- 3. Billing search RPC
-- =============================================================================

CREATE OR REPLACE FUNCTION dev_console_search_billing(
  p_query text DEFAULT NULL,
  p_filter text DEFAULT NULL,
  p_limit int DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_q text := nullif(trim(p_query), '');
  v_filter text := nullif(lower(trim(p_filter)), '');
  v_now timestamptz := now();
BEGIN
  RETURN coalesce(
    (
      SELECT jsonb_agg((to_jsonb(filtered) - 'created_at' - 'sub_status') ORDER BY filtered.created_at DESC)
      FROM (
        SELECT
          base.*,
          base.created_at
        FROM (
          SELECT
            o.id,
            o.name,
            o.slug,
            o.status,
            o.created_at,
            organization_effective_ceiling(o.id) AS effective_ceiling,
            organization_active_edition(o.id) AS active_edition,
            (
              SELECT coalesce(jsonb_agg(
                jsonb_build_object(
                  'instrument', e.instrument,
                  'edition', e.edition,
                  'status', e.status,
                  'period_start', e.period_start,
                  'period_end', e.period_end
                )
                ORDER BY e.instrument
              ), '[]'::jsonb)
              FROM organization_entitlements e
              WHERE e.organization_id = o.id
                AND e.status IN ('active', 'past_due')
                AND organization_entitlement_row_phase(e, v_now) IN ('active', 'past_due')
            ) AS live_instruments,
            ol.license_type,
            ol.activated_at AS license_activated_at,
            (
              SELECT jsonb_build_object(
                'plan', os.plan,
                'billing_period', os.billing_period,
                'status', os.status,
                'provider', os.provider,
                'current_period_start', os.current_period_start,
                'current_period_end', os.current_period_end,
                'provider_subscription_id', os.provider_subscription_id
              )
              FROM organization_subscriptions os
              WHERE os.organization_id = o.id
            ) AS subscription,
            dev_console_org_over_cap(o.id) AS over_cap,
            os.status AS sub_status
          FROM organizations o
          LEFT JOIN organization_licenses ol ON ol.organization_id = o.id
          LEFT JOIN organization_subscriptions os ON os.organization_id = o.id
          WHERE o.status <> 'purged'
            AND (
              v_q IS NULL
              OR o.name ILIKE '%' || replace(v_q, '%', '\%') || '%'
              OR o.slug ILIKE '%' || replace(v_q, '%', '\%') || '%'
            )
        ) base
        WHERE
          v_filter IS NULL
          OR (v_filter = 'lite' AND base.active_edition = 'lite')
          OR (v_filter = 'studio' AND base.active_edition = 'studio')
          OR (v_filter = 'pro' AND base.active_edition = 'pro')
          OR (
            v_filter = 'orphan_licensed'
            AND base.status = 'licensed'
            AND NOT EXISTS (
              SELECT 1 FROM organization_entitlements e WHERE e.organization_id = base.id
            )
          )
          OR (
            v_filter = 'lifetime'
            AND EXISTS (
              SELECT 1
              FROM organization_entitlements e
              WHERE e.organization_id = base.id
                AND e.instrument = 'pro_lifetime'
                AND e.status IN ('active', 'past_due')
                AND organization_entitlement_row_phase(e, v_now) = 'active'
            )
          )
          OR (v_filter IN ('active', 'past_due', 'canceled') AND base.sub_status = v_filter)
          OR (
            v_filter = 'none'
            AND base.license_type IS DISTINCT FROM 'lifetime'
            AND NOT EXISTS (
              SELECT 1
              FROM organization_entitlements e
              WHERE e.organization_id = base.id
                AND e.instrument IN ('studio_monthly', 'pro_monthly')
                AND e.status IN ('active', 'past_due')
            )
            AND (base.sub_status IS NULL OR base.sub_status = 'canceled')
          )
        ORDER BY base.created_at DESC
        LIMIT v_limit
      ) filtered
    ),
    '[]'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION dev_console_search_billing(text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dev_console_search_billing(text, text, int) TO service_role;

-- =============================================================================
-- 4. Lifecycle flag (§17.8)
-- =============================================================================

CREATE OR REPLACE FUNCTION dev_console_set_editions_lifecycle(
  p_enabled boolean,
  p_actor_id uuid,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF p_actor_id IS NULL OR p_note IS NULL OR length(trim(p_note)) = 0 THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(value, '{}'::jsonb)
  INTO v_before
  FROM platform_runtime_flags
  WHERE key = 'editions_lifecycle';

  INSERT INTO platform_runtime_flags (key, value, updated_by, updated_at)
  VALUES (
    'editions_lifecycle',
    jsonb_build_object('enabled', coalesce(p_enabled, false)),
    p_actor_id,
    now()
  )
  ON CONFLICT (key) DO UPDATE
    SET value = jsonb_build_object('enabled', coalesce(p_enabled, false)),
        updated_by = p_actor_id,
        updated_at = now()
  RETURNING value INTO v_after;

  INSERT INTO platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  VALUES (
    p_actor_id,
    'platform.runtime_flag',
    'platform_runtime_flags',
    'editions_lifecycle',
    jsonb_build_object(
      'key', 'editions_lifecycle',
      'note', left(trim(p_note), 500),
      'before', coalesce(v_before, '{}'::jsonb),
      'after', v_after
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'enabled', coalesce((v_after ->> 'enabled')::boolean, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION dev_console_set_editions_lifecycle(boolean, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dev_console_set_editions_lifecycle(boolean, uuid, text) TO service_role;

-- =============================================================================
-- 5. Adjust subscription + manual_plan (F82 / F113)
-- =============================================================================

DROP FUNCTION IF EXISTS dev_console_adjust_organization_subscription(
  uuid, uuid, text, timestamptz, timestamptz, text, boolean, text
);

CREATE OR REPLACE FUNCTION dev_console_adjust_organization_subscription(
  p_organization_id uuid,
  p_actor_id uuid,
  p_status text DEFAULT NULL,
  p_period_start timestamptz DEFAULT NULL,
  p_period_end timestamptz DEFAULT NULL,
  p_provider text DEFAULT NULL,
  p_extend_one_month boolean DEFAULT false,
  p_note text DEFAULT NULL,
  p_manual_plan text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_sub organization_subscriptions%ROWTYPE;
  v_ent organization_entitlements%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
  v_now timestamptz := now();
  v_status text;
  v_provider text;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_anchor smallint;
  v_edition text;
  v_instrument text;
  v_plan text;
  v_has_ent boolean := false;
  v_has_sub boolean := false;
  v_manual text := nullif(lower(trim(p_manual_plan)), '');
BEGIN
  IF p_organization_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'invalid_adjust_payload' USING ERRCODE = '22023';
  END IF;

  IF p_note IS NULL OR length(trim(p_note)) = 0 THEN
    RAISE EXCEPTION 'adjust_note_required' USING ERRCODE = '22023';
  END IF;

  IF v_manual IS NOT NULL
     AND v_manual NOT IN ('studio_month', 'pro_month', 'pro_lifetime') THEN
    RAISE EXCEPTION 'invalid_manual_plan' USING ERRCODE = '22023';
  END IF;

  IF organization_has_lifetime_license(p_organization_id) THEN
    RAISE EXCEPTION 'lifetime_grandfathered' USING ERRCODE = '22023';
  END IF;

  IF p_status IS NOT NULL AND p_status NOT IN ('active', 'past_due', 'canceled') THEN
    RAISE EXCEPTION 'invalid_subscription_status' USING ERRCODE = '22023';
  END IF;

  IF p_provider IS NOT NULL AND p_provider NOT IN ('manual', 'stripe') THEN
    RAISE EXCEPTION 'invalid_provider' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM organizations o WHERE o.id = p_organization_id FOR UPDATE;

  SELECT * INTO v_ent
  FROM organization_entitlements e
  WHERE e.organization_id = p_organization_id
    AND e.instrument IN ('studio_monthly', 'pro_monthly')
    AND e.status IN ('active', 'past_due')
  ORDER BY organization_edition_rank(e.edition) DESC
  LIMIT 1
  FOR UPDATE;

  v_has_ent := FOUND;

  SELECT * INTO v_sub
  FROM organization_subscriptions
  WHERE organization_id = p_organization_id
  FOR UPDATE;

  v_has_sub := FOUND;

  IF NOT v_has_sub AND NOT v_has_ent AND v_manual = 'pro_lifetime' THEN
    PERFORM _edition_apply_access_key_lifetime(p_organization_id, p_actor_id);
    UPDATE organizations SET status = 'licensed' WHERE id = p_organization_id;
    RETURN jsonb_build_object(
      'ok', true,
      'granted', 'pro_lifetime',
      'note', trim(p_note)
    );
  END IF;

  IF v_has_sub THEN
    v_plan := coalesce(v_sub.plan, 'pro');
    IF v_plan = 'standard' THEN
      v_plan := 'pro';
    END IF;
  ELSIF v_has_ent THEN
    v_plan := CASE v_ent.edition WHEN 'studio' THEN 'studio' ELSE 'pro' END;
  ELSIF v_manual = 'studio_month' THEN
    v_plan := 'studio';
  ELSIF v_manual = 'pro_month' OR v_manual IS NULL THEN
    v_plan := 'pro';
  ELSE
    v_plan := 'pro';
  END IF;

  v_edition := CASE v_plan WHEN 'studio' THEN 'studio' ELSE 'pro' END;
  v_instrument := CASE v_plan WHEN 'studio' THEN 'studio_monthly' ELSE 'pro_monthly' END;

  IF NOT v_has_sub AND NOT v_has_ent THEN
    v_status := coalesce(p_status, 'active');
    v_provider := coalesce(p_provider, 'manual');
    v_period_start := coalesce(p_period_start, v_now);
    v_anchor := extract(day FROM (v_period_start AT TIME ZONE 'UTC'))::smallint;
    IF p_extend_one_month AND p_period_end IS NULL THEN
      v_period_end := add_calendar_month(v_period_start, v_anchor);
    ELSE
      v_period_end := coalesce(p_period_end, add_calendar_month(v_period_start, v_anchor));
    END IF;
  ELSIF v_has_sub THEN
    v_status := coalesce(p_status, v_sub.status);
    v_provider := coalesce(p_provider, v_sub.provider);
    v_period_start := coalesce(p_period_start, v_sub.current_period_start);
    v_period_end := coalesce(p_period_end, v_sub.current_period_end);
    v_anchor := coalesce(
      v_sub.billing_anchor_day,
      CASE
        WHEN v_period_start IS NOT NULL THEN
          extract(day FROM (v_period_start AT TIME ZONE 'UTC'))::smallint
        ELSE NULL
      END
    );

    IF p_extend_one_month THEN
      IF v_period_end IS NULL THEN
        RAISE EXCEPTION 'extend_requires_period_end' USING ERRCODE = '22023';
      END IF;
      v_period_end := add_calendar_month(v_period_end, coalesce(v_anchor, 1));
    END IF;
  ELSE
    v_status := coalesce(p_status, v_ent.status);
    v_provider := coalesce(p_provider, 'manual');
    v_period_start := coalesce(p_period_start, v_ent.period_start);
    v_period_end := coalesce(p_period_end, v_ent.period_end);
    v_anchor := coalesce(
      v_ent.billing_anchor_day,
      CASE
        WHEN v_period_start IS NOT NULL THEN
          extract(day FROM (v_period_start AT TIME ZONE 'UTC'))::smallint
        ELSE NULL
      END
    );

    IF p_extend_one_month THEN
      IF v_period_end IS NULL THEN
        RAISE EXCEPTION 'extend_requires_period_end' USING ERRCODE = '22023';
      END IF;
      v_period_end := add_calendar_month(v_period_end, coalesce(v_anchor, 1));
    END IF;
  END IF;

  IF v_status = 'active' AND v_provider = 'manual' THEN
    IF v_period_start IS NULL OR v_period_end IS NULL OR v_period_end <= v_period_start THEN
      RAISE EXCEPTION 'manual_active_requires_period' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_before := jsonb_build_object(
    'status', CASE WHEN v_has_sub THEN v_sub.status ELSE v_ent.status END,
    'provider', CASE WHEN v_has_sub THEN v_sub.provider ELSE 'manual' END,
    'current_period_start', CASE WHEN v_has_sub THEN v_sub.current_period_start ELSE v_ent.period_start END,
    'current_period_end', CASE WHEN v_has_sub THEN v_sub.current_period_end ELSE v_ent.period_end END
  );

  IF NOT v_has_ent AND v_status IN ('active', 'past_due') THEN
    PERFORM _edition_upsert_live_month_entitlement(
      p_organization_id, v_edition, v_instrument, v_status,
      v_period_start, v_period_end, v_anchor, NULL, 'admin_adjust', p_actor_id
    );
  ELSIF v_has_ent THEN
    UPDATE organization_entitlements
    SET status = v_status,
        period_start = v_period_start,
        period_end = v_period_end,
        billing_anchor_day = v_anchor,
        edition = v_edition,
        instrument = v_instrument,
        updated_at = v_now
    WHERE id = v_ent.id;

    PERFORM _sync_organization_edition_mirrors(p_organization_id);
  ELSE
    PERFORM _sync_organization_edition_mirrors(p_organization_id);
  END IF;

  UPDATE organizations
  SET status = 'licensed'
  WHERE id = p_organization_id;

  SELECT jsonb_build_object(
    'status', status,
    'provider', provider,
    'current_period_start', current_period_start,
    'current_period_end', current_period_end,
    'plan', plan
  ) INTO v_after
  FROM organization_subscriptions
  WHERE organization_id = p_organization_id;

  RETURN jsonb_build_object(
    'ok', true,
    'before', v_before,
    'after', v_after,
    'note', trim(p_note)
  );
END;
$$;

REVOKE ALL ON FUNCTION dev_console_adjust_organization_subscription(
  uuid, uuid, text, timestamptz, timestamptz, text, boolean, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dev_console_adjust_organization_subscription(
  uuid, uuid, text, timestamptz, timestamptz, text, boolean, text, text
) TO service_role;

-- =============================================================================
-- 6. Digest source: Studio month + plan label (F63 / F105)
-- =============================================================================

DROP FUNCTION IF EXISTS list_platform_crm_subscription_digest(timestamptz);

CREATE OR REPLACE FUNCTION list_platform_crm_subscription_digest(
  p_as_of timestamptz DEFAULT now()
)
RETURNS TABLE (
  digest_type text,
  organization_id uuid,
  organization_name text,
  organization_status text,
  subscription_status text,
  subscription_plan text,
  provider text,
  current_period_end timestamptz,
  grace_end timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH as_of AS (
    SELECT COALESCE(p_as_of, now()) AS ts
  ),
  month_rows AS (
    SELECT
      o.id AS organization_id,
      o.name AS organization_name,
      o.status::text AS organization_status,
      os.status::text AS subscription_status,
      CASE
        WHEN coalesce(os.plan, 'pro') IN ('studio', 'standard', 'pro') THEN
          CASE WHEN os.plan = 'studio' THEN 'studio' ELSE 'pro' END
        ELSE 'pro'
      END AS subscription_plan,
      os.provider,
      os.current_period_end,
      os.current_period_end + interval '7 days' AS grace_end
    FROM organization_subscriptions os
    JOIN organizations o ON o.id = os.organization_id
    WHERE o.status = 'licensed'
      AND NOT organization_has_lifetime_license(o.id)
      AND os.current_period_end IS NOT NULL

    UNION ALL

    SELECT
      o.id,
      o.name,
      o.status::text,
      e.status::text,
      CASE e.edition WHEN 'studio' THEN 'studio' ELSE 'pro' END,
      'manual'::text,
      e.period_end,
      e.period_end + interval '7 days'
    FROM organization_entitlements e
    JOIN organizations o ON o.id = e.organization_id
    WHERE e.instrument IN ('studio_monthly', 'pro_monthly')
      AND e.status IN ('active', 'past_due')
      AND e.period_end IS NOT NULL
      AND o.status = 'licensed'
      AND NOT EXISTS (
        SELECT 1
        FROM organization_subscriptions os
        WHERE os.organization_id = o.id
          AND os.current_period_end IS NOT DISTINCT FROM e.period_end
      )
  )
  SELECT
    'expiring'::text,
    m.organization_id,
    m.organization_name,
    m.organization_status,
    m.subscription_status,
    m.subscription_plan,
    m.provider,
    m.current_period_end,
    m.grace_end
  FROM month_rows m
  CROSS JOIN as_of
  WHERE m.subscription_status = 'active'
    AND m.current_period_end > as_of.ts
    AND m.current_period_end <= as_of.ts + interval '7 days'

  UNION ALL

  SELECT
    'overdue'::text,
    m.organization_id,
    m.organization_name,
    m.organization_status,
    m.subscription_status,
    m.subscription_plan,
    m.provider,
    m.current_period_end,
    m.grace_end
  FROM month_rows m
  CROSS JOIN as_of
  WHERE m.subscription_status IN ('active', 'past_due')
    AND m.current_period_end <= as_of.ts;
$$;

REVOKE ALL ON FUNCTION list_platform_crm_subscription_digest(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION list_platform_crm_subscription_digest(timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION list_platform_crm_subscription_digest(timestamptz) TO service_role;

-- =============================================================================
-- 7. Digest enqueue copy: Studio vs Pro plan label (F63)
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
  v_plan_label text;
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
      v_plan_label := CASE rec.subscription_plan
        WHEN 'studio' THEN 'Studio / месяц'
        ELSE 'Pro / месяц'
      END;
      v_lines := v_lines || format(
        E'\n- %s (%s) %s %s end %s',
        left(_platform_notification_plain(rec.organization_name), 80),
        _platform_notification_short_id(rec.organization_id),
        v_plan_label,
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
    'expiring_count', v_expiring,
    'overdue_count', v_overdue
  );
END;
$$;

COMMIT;
