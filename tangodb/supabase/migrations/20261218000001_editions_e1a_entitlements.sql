-- E1a / 2.12.0: edition entitlements source of truth, backfill, runtime flag (off).
-- Write-path 2.11 unchanged until E1b (organization_allows_writes not patched here).

BEGIN;

-- =============================================================================
-- 1. Tables (§4.3, §18.10)
-- =============================================================================

CREATE TABLE organization_entitlements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  edition             text NOT NULL,
  instrument          text NOT NULL,
  status              text NOT NULL,
  period_start        timestamptz,
  period_end          timestamptz,
  billing_anchor_day  smallint,
  source_request_id   uuid REFERENCES platform_purchase_requests(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_entitlements_edition_check
    CHECK (edition IN ('lite', 'studio', 'pro')),
  CONSTRAINT organization_entitlements_instrument_check
    CHECK (instrument IN (
      'free_lifetime', 'trial_pro', 'studio_monthly', 'pro_monthly', 'pro_lifetime'
    )),
  CONSTRAINT organization_entitlements_status_check
    CHECK (status IN ('active', 'past_due', 'canceled')),
  CONSTRAINT organization_entitlements_past_due_monthly_check
    CHECK (status <> 'past_due' OR instrument IN ('studio_monthly', 'pro_monthly')),
  CONSTRAINT organization_entitlements_instrument_edition_check
    CHECK (
      (instrument = 'free_lifetime' AND edition = 'lite')
      OR (instrument = 'studio_monthly' AND edition = 'studio')
      OR (instrument IN ('trial_pro', 'pro_monthly', 'pro_lifetime') AND edition = 'pro')
    ),
  CONSTRAINT organization_entitlements_period_required_check
    CHECK (
      instrument IN ('free_lifetime', 'pro_lifetime')
      OR period_end IS NOT NULL
    ),
  CONSTRAINT organization_entitlements_lifetime_period_check
    CHECK (
      instrument NOT IN ('free_lifetime', 'pro_lifetime')
      OR (period_end IS NULL AND status <> 'past_due')
    ),
  CONSTRAINT organization_entitlements_trial_past_due_check
    CHECK (instrument <> 'trial_pro' OR status <> 'past_due'),
  CONSTRAINT organization_entitlements_billing_anchor_day_check
    CHECK (billing_anchor_day IS NULL OR (billing_anchor_day >= 1 AND billing_anchor_day <= 31))
);

COMMENT ON TABLE organization_entitlements IS
  'E1a: paid/trial/free edition instruments. Source of truth for ceiling; mirrors organization_licenses/subscriptions.';

CREATE UNIQUE INDEX organization_entitlements_live_instrument
  ON organization_entitlements (organization_id, instrument)
  WHERE status IN ('active', 'past_due');

CREATE UNIQUE INDEX organization_entitlements_one_paid_month
  ON organization_entitlements (organization_id)
  WHERE status IN ('active', 'past_due')
    AND instrument IN ('studio_monthly', 'pro_monthly');

CREATE UNIQUE INDEX organization_entitlements_one_raising
  ON organization_entitlements (organization_id)
  WHERE status IN ('active', 'past_due')
    AND instrument IN ('trial_pro', 'studio_monthly', 'pro_monthly', 'pro_lifetime');

CREATE INDEX organization_entitlements_expire
  ON organization_entitlements (status, period_end)
  WHERE status IN ('active', 'past_due')
    AND instrument IN ('studio_monthly', 'pro_monthly')
    AND period_end IS NOT NULL;

CREATE TABLE organization_edition_state (
  organization_id   uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  active_edition    text NOT NULL,
  changed_at        timestamptz NOT NULL,
  changed_by        uuid,
  change_reason     text NOT NULL,
  CONSTRAINT organization_edition_state_active_edition_check
    CHECK (active_edition IN ('lite', 'studio', 'pro')),
  CONSTRAINT organization_edition_state_change_reason_check
    CHECK (change_reason IN (
      'purchase', 'renew', 'expire', 'expire_grace', 'owner_mode', 'owner_cancel',
      'trial_start', 'trial_end', 'admin_adjust'
    ))
);

COMMENT ON TABLE organization_edition_state IS
  'E1a: owner-selected active edition column (clamped in RPC in E1b).';

CREATE TABLE organization_edition_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  from_edition    text,
  to_edition      text,
  from_ceiling    text,
  to_ceiling      text,
  reason          text NOT NULL,
  actor_user_id   uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX organization_edition_events_org_created
  ON organization_edition_events (organization_id, created_at DESC);

COMMENT ON TABLE organization_edition_events IS
  'E1a: append-only edition audit trail.';

CREATE TABLE platform_runtime_flags (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE platform_runtime_flags IS
  'E1a: platform cutover flags (editions_lifecycle). Not in payment config.';

INSERT INTO platform_runtime_flags (key, value)
VALUES ('editions_lifecycle', '{"enabled": false}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- 2. Lifecycle flag reader (writes gated in E1b)
-- =============================================================================

CREATE OR REPLACE FUNCTION editions_lifecycle_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT (f.value ->> 'enabled')::boolean
      FROM platform_runtime_flags f
      WHERE f.key = 'editions_lifecycle'
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION editions_lifecycle_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION editions_lifecycle_enabled() TO service_role;

-- =============================================================================
-- 3. Dual-write stubs (§18.3 / §18.14 — wired in E1c, not from Activate yet)
-- =============================================================================

CREATE OR REPLACE FUNCTION _edition_cancel_other_raising_instruments(
  p_org_id uuid,
  p_keep_instrument text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE organization_entitlements e
  SET status = 'canceled',
      updated_at = now()
  WHERE e.organization_id = p_org_id
    AND e.status IN ('active', 'past_due')
    AND e.instrument IN ('trial_pro', 'studio_monthly', 'pro_monthly', 'pro_lifetime')
    AND (p_keep_instrument IS NULL OR e.instrument <> p_keep_instrument);
END;
$$;

COMMENT ON FUNCTION _edition_cancel_other_raising_instruments(uuid, text) IS
  'E1a stub: XOR cancel raising instruments. Called from mirror sync in E1c.';

CREATE OR REPLACE FUNCTION _sync_organization_edition_mirrors(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- E1c: sync organization_licenses + organization_subscriptions from live entitlements (§18.3).
  NULL;
END;
$$;

COMMENT ON FUNCTION _sync_organization_edition_mirrors(uuid) IS
  'E1a placeholder: dual-write mirrors. Implement body in E1c; do not call from 2.11 writers yet.';

REVOKE ALL ON FUNCTION _edition_cancel_other_raising_instruments(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _sync_organization_edition_mirrors(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _edition_cancel_other_raising_instruments(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION _sync_organization_edition_mirrors(uuid) TO service_role;

-- =============================================================================
-- 4. RLS (§18.2)
-- =============================================================================

ALTER TABLE organization_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_edition_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_edition_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_runtime_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY organization_entitlements_select_member
  ON organization_entitlements FOR SELECT
  TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND is_active_member(auth.uid(), organization_id)
    AND organization_allows_reads(organization_id)
  );

CREATE POLICY organization_edition_state_select_member
  ON organization_edition_state FOR SELECT
  TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND is_active_member(auth.uid(), organization_id)
    AND organization_allows_reads(organization_id)
  );

REVOKE ALL ON TABLE organization_entitlements FROM PUBLIC, anon;
REVOKE ALL ON TABLE organization_edition_state FROM PUBLIC, anon;
REVOKE ALL ON TABLE organization_edition_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE platform_runtime_flags FROM PUBLIC, anon, authenticated;

GRANT SELECT ON organization_entitlements TO authenticated;
GRANT SELECT ON organization_edition_state TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON organization_entitlements TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON organization_edition_state TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON organization_edition_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_runtime_flags TO service_role;

-- =============================================================================
-- 5. Backfill helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION _edition_backfill_f64_anti_abuse(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform_audit_log pal
    WHERE pal.target_id = p_org_id
      AND (
        pal.action ILIKE '%suspend%'
        OR pal.action ILIKE '%anti%abuse%'
        OR pal.action = 'org.suspended'
      )
  );
$$;

REVOKE ALL ON FUNCTION _edition_backfill_f64_anti_abuse(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _edition_backfill_f64_anti_abuse(uuid) TO service_role;

CREATE OR REPLACE FUNCTION _insert_free_lifetime_entitlement(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM organization_entitlements e
    WHERE e.organization_id = p_org_id
      AND e.instrument = 'free_lifetime'
      AND e.status IN ('active', 'past_due')
  ) THEN
    RETURN;
  END IF;

  INSERT INTO organization_entitlements (
    organization_id, edition, instrument, status, period_start, period_end, billing_anchor_day
  )
  VALUES (p_org_id, 'lite', 'free_lifetime', 'active', NULL, NULL, NULL);
END;
$$;

CREATE OR REPLACE FUNCTION _backfill_single_organization_edition(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org organizations%ROWTYPE;
  v_sub organization_subscriptions%ROWTYPE;
  v_has_sub boolean := false;
  v_has_lifetime boolean := false;
  v_now timestamptz := now();
  v_needs_review boolean := false;
  v_reason text := 'admin_adjust';
  v_active text := 'lite';
BEGIN
  SELECT * INTO v_org FROM organizations o WHERE o.id = p_org_id;
  IF NOT FOUND OR v_org.status = 'purged' THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM organization_edition_state s WHERE s.organization_id = p_org_id) THEN
    RETURN;
  END IF;

  SELECT * INTO v_sub FROM organization_subscriptions os WHERE os.organization_id = p_org_id;
  v_has_sub := FOUND;
  v_has_lifetime := organization_has_lifetime_license(p_org_id);

  IF v_org.status = 'demo_retention' THEN
    UPDATE organizations
    SET status = 'licensed',
        data_purge_at = NULL
    WHERE id = p_org_id;

    PERFORM _insert_free_lifetime_entitlement(p_org_id);

    INSERT INTO organization_edition_state (organization_id, active_edition, changed_at, changed_by, change_reason)
    VALUES (p_org_id, 'lite', v_now, NULL, 'trial_end');
    RETURN;
  END IF;

  IF v_org.status = 'demo_active' THEN
    INSERT INTO organization_entitlements (
      organization_id, edition, instrument, status,
      period_start, period_end, billing_anchor_day
    )
    VALUES (
      p_org_id, 'pro', 'trial_pro', 'active',
      coalesce(v_org.demo_activated_at, v_now),
      v_org.demo_expires_at,
      CASE
        WHEN v_org.demo_expires_at IS NOT NULL
          THEN extract(day FROM v_org.demo_expires_at AT TIME ZONE 'UTC')::int
        ELSE NULL
      END
    );

    PERFORM _insert_free_lifetime_entitlement(p_org_id);

    INSERT INTO organization_edition_state (organization_id, active_edition, changed_at, changed_by, change_reason)
    VALUES (p_org_id, 'pro', v_now, NULL, 'trial_start');
    RETURN;
  END IF;

  IF v_has_lifetime THEN
    INSERT INTO organization_entitlements (
      organization_id, edition, instrument, status, period_start, period_end, billing_anchor_day
    )
    VALUES (p_org_id, 'pro', 'pro_lifetime', 'active', NULL, NULL, NULL);

    PERFORM _insert_free_lifetime_entitlement(p_org_id);

    INSERT INTO organization_edition_state (organization_id, active_edition, changed_at, changed_by, change_reason)
    VALUES (p_org_id, 'pro', v_now, NULL, 'purchase');
    RETURN;
  END IF;

  IF v_has_sub AND v_sub.status IN ('active', 'past_due') THEN
    UPDATE organization_subscriptions
    SET plan = 'pro',
        updated_at = v_now
    WHERE organization_id = p_org_id
      AND plan = 'standard';

    INSERT INTO organization_entitlements (
      organization_id, edition, instrument, status,
      period_start, period_end, billing_anchor_day
    )
    VALUES (
      p_org_id,
      'pro',
      'pro_monthly',
      v_sub.status,
      v_sub.current_period_start,
      v_sub.current_period_end,
      v_sub.billing_anchor_day
    );

    PERFORM _insert_free_lifetime_entitlement(p_org_id);

    INSERT INTO organization_edition_state (organization_id, active_edition, changed_at, changed_by, change_reason)
    VALUES (p_org_id, 'pro', v_now, NULL, 'purchase');
    RETURN;
  END IF;

  IF v_org.status = 'suspended' THEN
    IF v_has_sub
       AND v_sub.status = 'canceled'
       AND NOT v_has_lifetime
       AND NOT _edition_backfill_f64_anti_abuse(p_org_id)
    THEN
      UPDATE organizations SET status = 'licensed' WHERE id = p_org_id;
      v_reason := 'expire';
    ELSE
      v_needs_review := true;
      v_reason := 'admin_adjust';
    END IF;

    PERFORM _insert_free_lifetime_entitlement(p_org_id);

    INSERT INTO organization_edition_state (organization_id, active_edition, changed_at, changed_by, change_reason)
    VALUES (p_org_id, v_active, v_now, NULL, v_reason);

    IF v_needs_review THEN
      INSERT INTO organization_edition_events (
        organization_id, from_edition, to_edition, reason, metadata
      )
      VALUES (
        p_org_id, NULL, v_active, v_reason,
        jsonb_build_object('needs_review', true, 'backfill', 'e1a', 'org_status', 'suspended')
      );
    END IF;
    RETURN;
  END IF;

  PERFORM _insert_free_lifetime_entitlement(p_org_id);

  INSERT INTO organization_edition_state (organization_id, active_edition, changed_at, changed_by, change_reason)
  VALUES (p_org_id, v_active, v_now, NULL, v_reason);
END;
$$;

REVOKE ALL ON FUNCTION _insert_free_lifetime_entitlement(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _backfill_single_organization_edition(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _insert_free_lifetime_entitlement(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _backfill_single_organization_edition(uuid) TO service_role;

DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT o.id
    FROM organizations o
    WHERE o.status <> 'purged'
    ORDER BY o.created_at
  LOOP
    PERFORM _backfill_single_organization_edition(rec.id);
  END LOOP;
END;
$$;

-- Grandfather plan standard → pro (§4.3)
UPDATE organization_subscriptions os
SET plan = 'pro',
    updated_at = now()
WHERE os.plan = 'standard';

-- =============================================================================
-- 6. Demo org creators — trial_pro + free_lifetime + edition_state (§18.3)
-- =============================================================================

CREATE OR REPLACE FUNCTION _seed_demo_edition_entitlements(
  p_org_id uuid,
  p_now timestamptz,
  p_demo_expires timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO organization_entitlements (
    organization_id, edition, instrument, status,
    period_start, period_end, billing_anchor_day
  )
  VALUES (
    p_org_id, 'pro', 'trial_pro', 'active',
    p_now, p_demo_expires,
    extract(day FROM p_demo_expires AT TIME ZONE 'UTC')::int
  );

  INSERT INTO organization_entitlements (
    organization_id, edition, instrument, status, period_start, period_end, billing_anchor_day
  )
  VALUES (p_org_id, 'lite', 'free_lifetime', 'active', NULL, NULL, NULL);

  INSERT INTO organization_edition_state (
    organization_id, active_edition, changed_at, changed_by, change_reason
  )
  VALUES (p_org_id, 'pro', p_now, NULL, 'trial_start');
END;
$$;

REVOKE ALL ON FUNCTION _seed_demo_edition_entitlements(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _seed_demo_edition_entitlements(uuid, timestamptz, timestamptz) TO service_role;

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

  PERFORM _seed_demo_edition_entitlements(v_org_id, v_now, v_demo_expires);

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

  PERFORM _seed_demo_edition_entitlements(v_org_id, v_now, v_demo_expires);

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
    'demo_expires_at', v_demo_expires
  );
END;
$$;

REVOKE ALL ON FUNCTION create_self_service_demo_org(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_telegram_self_service_demo_org(uuid, bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_self_service_demo_org(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION create_telegram_self_service_demo_org(uuid, bigint, text, text) TO service_role;

COMMIT;
