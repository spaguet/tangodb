-- E1c / 2.12.2: purchase Activate/preview IN, dual-write mirrors, adjust wrap, expire, purge, notifications, access_key.

BEGIN;

-- =============================================================================
-- 1. CHECK: Studio SKU / request_kind (F80, F118)
-- =============================================================================

ALTER TABLE platform_purchase_quotes
  DROP CONSTRAINT IF EXISTS platform_purchase_quotes_sku_check;

ALTER TABLE platform_purchase_quotes
  ADD CONSTRAINT platform_purchase_quotes_sku_check
  CHECK (sku IN ('crm_license', 'crm_subscription', 'crm_studio_subscription'));

ALTER TABLE platform_purchase_requests
  DROP CONSTRAINT IF EXISTS platform_purchase_requests_request_kind_check;

ALTER TABLE platform_purchase_requests
  ADD CONSTRAINT platform_purchase_requests_request_kind_check
  CHECK (request_kind IN (
    'crm_license', 'crm_subscription', 'crm_studio_subscription', 'renter_miniapp_addon'
  ));

CREATE OR REPLACE FUNCTION _organization_has_eligible_purchase_review_new(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform_purchase_requests pr
    WHERE pr.organization_id = p_org_id
      AND pr.status = 'new'
      AND pr.request_kind IN (
        'crm_license', 'crm_subscription', 'crm_studio_subscription'
      )
  );
$$;

-- =============================================================================
-- 2. Month kind helpers + dual-write mirrors (§18.3, §18.14)
-- =============================================================================

CREATE OR REPLACE FUNCTION _edition_is_crm_month_request_kind(p_kind text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_kind IN ('crm_subscription', 'crm_studio_subscription');
$$;

CREATE OR REPLACE FUNCTION _edition_month_meta_from_request_kind(p_kind text)
RETURNS TABLE (edition text, instrument text)
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  CASE p_kind
    WHEN 'crm_subscription' THEN
      edition := 'pro';
      instrument := 'pro_monthly';
    WHEN 'crm_studio_subscription' THEN
      edition := 'studio';
      instrument := 'studio_monthly';
    ELSE
      RAISE EXCEPTION 'not_month_request_kind' USING ERRCODE = '22023';
  END CASE;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION _edition_cancel_trial_pro(p_org_id uuid)
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
    AND e.instrument = 'trial_pro'
    AND e.status IN ('active', 'past_due');
END;
$$;

CREATE OR REPLACE FUNCTION _sync_organization_edition_mirrors(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_version_id uuid;
  v_has_lifetime boolean := false;
  v_month organization_entitlements%ROWTYPE;
  v_month_found boolean := false;
  v_plan text;
BEGIN
  v_version_id := current_crm_version_id();

  SELECT EXISTS (
    SELECT 1
    FROM organization_entitlements e
    WHERE e.organization_id = p_org_id
      AND e.instrument = 'pro_lifetime'
      AND e.status IN ('active', 'past_due')
      AND organization_entitlement_row_phase(e, v_now) = 'active'
  ) INTO v_has_lifetime;

  SELECT * INTO v_month
  FROM organization_entitlements e
  WHERE e.organization_id = p_org_id
    AND e.instrument IN ('studio_monthly', 'pro_monthly')
    AND e.status IN ('active', 'past_due')
    AND organization_entitlement_row_phase(e, v_now) IN ('active', 'past_due')
  ORDER BY organization_edition_rank(e.edition) DESC
  LIMIT 1;

  v_month_found := FOUND;

  IF v_has_lifetime THEN
    INSERT INTO organization_licenses (
      organization_id, crm_version_id, license_type, activated_at, expires_at
    )
    VALUES (p_org_id, v_version_id, 'lifetime', v_now, NULL)
    ON CONFLICT (organization_id) DO UPDATE
      SET license_type = 'lifetime',
          crm_version_id = EXCLUDED.crm_version_id,
          expires_at = NULL;
    RETURN;
  END IF;

  IF v_month_found THEN
    v_plan := CASE v_month.edition WHEN 'studio' THEN 'studio' ELSE 'pro' END;

    INSERT INTO organization_subscriptions (
      organization_id, plan, billing_period, status, provider,
      current_period_start, current_period_end, billing_anchor_day, updated_at
    )
    VALUES (
      p_org_id, v_plan, 'monthly', v_month.status, 'manual',
      v_month.period_start, v_month.period_end, v_month.billing_anchor_day, v_now
    )
    ON CONFLICT (organization_id) DO UPDATE
      SET plan = EXCLUDED.plan,
          billing_period = 'monthly',
          status = EXCLUDED.status,
          provider = 'manual',
          current_period_start = EXCLUDED.current_period_start,
          current_period_end = EXCLUDED.current_period_end,
          billing_anchor_day = EXCLUDED.billing_anchor_day,
          updated_at = v_now;

    INSERT INTO organization_licenses (
      organization_id, crm_version_id, license_type, activated_at, expires_at
    )
    VALUES (p_org_id, v_version_id, 'subscription', v_now, NULL)
    ON CONFLICT (organization_id) DO UPDATE
      SET license_type = 'subscription',
          crm_version_id = EXCLUDED.crm_version_id,
          expires_at = NULL;

    RETURN;
  END IF;

  DELETE FROM organization_licenses ol
  WHERE ol.organization_id = p_org_id
    AND ol.license_type = 'subscription';

  UPDATE organization_subscriptions os
  SET status = 'canceled',
      updated_at = v_now
  WHERE os.organization_id = p_org_id
    AND os.status IS DISTINCT FROM 'canceled';
END;
$$;

CREATE OR REPLACE FUNCTION _edition_upsert_live_month_entitlement(
  p_org_id uuid,
  p_edition text,
  p_instrument text,
  p_status text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_anchor smallint,
  p_source_request_id uuid,
  p_change_reason text,
  p_actor_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_existing organization_entitlements%ROWTYPE;
  v_reason text := coalesce(p_change_reason, 'purchase');
BEGIN
  PERFORM 1 FROM organizations o WHERE o.id = p_org_id FOR UPDATE;

  PERFORM _edition_cancel_other_raising_instruments(p_instrument);
  PERFORM _edition_cancel_trial_pro(p_org_id);

  SELECT * INTO v_existing
  FROM organization_entitlements e
  WHERE e.organization_id = p_org_id
    AND e.instrument = p_instrument
    AND e.status IN ('active', 'past_due')
  FOR UPDATE;

  IF FOUND THEN
    UPDATE organization_entitlements
    SET status = p_status,
        period_start = p_period_start,
        period_end = p_period_end,
        billing_anchor_day = p_anchor,
        source_request_id = coalesce(p_source_request_id, source_request_id),
        updated_at = v_now
    WHERE id = v_existing.id;

    IF v_existing.status = 'past_due' AND p_status = 'active' THEN
      v_reason := 'renew';
    END IF;
  ELSE
    INSERT INTO organization_entitlements (
      organization_id, edition, instrument, status,
      period_start, period_end, billing_anchor_day, source_request_id
    )
    VALUES (
      p_org_id, p_edition, p_instrument, p_status,
      p_period_start, p_period_end, p_anchor, p_source_request_id
    );
  END IF;

  PERFORM _insert_free_lifetime_entitlement(p_org_id);

  INSERT INTO organization_edition_state (
    organization_id, active_edition, changed_at, changed_by, change_reason
  )
  VALUES (p_org_id, p_edition, v_now, p_actor_id, v_reason)
  ON CONFLICT (organization_id) DO UPDATE
    SET active_edition = EXCLUDED.active_edition,
        changed_at = EXCLUDED.changed_at,
        changed_by = EXCLUDED.changed_by,
        change_reason = EXCLUDED.change_reason;

  PERFORM _sync_organization_edition_mirrors(p_org_id);
END;
$$;

REVOKE ALL ON FUNCTION _edition_cancel_trial_pro(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _edition_month_meta_from_request_kind(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _edition_upsert_live_month_entitlement(
  uuid, text, text, text, timestamptz, timestamptz, smallint, uuid, text, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _edition_cancel_trial_pro(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _edition_month_meta_from_request_kind(text) TO service_role;
GRANT EXECUTE ON FUNCTION _edition_upsert_live_month_entitlement(
  uuid, text, text, text, timestamptz, timestamptz, smallint, uuid, text, uuid
) TO service_role;

-- =============================================================================
-- 3. Preview month period from entitlements (F109)
-- =============================================================================

CREATE OR REPLACE FUNCTION _preview_crm_month_activation_period(
  p_organization_id uuid,
  p_period_start_override timestamptz DEFAULT NULL,
  p_period_end_override timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_ent organization_entitlements%ROWTYPE;
  v_sub organization_subscriptions%ROWTYPE;
  v_now timestamptz := now();
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_anchor smallint;
  v_use_ent boolean := false;
  v_has_active_sub boolean := false;
BEGIN
  SELECT * INTO v_ent
  FROM organization_entitlements e
  WHERE e.organization_id = p_organization_id
    AND e.instrument IN ('studio_monthly', 'pro_monthly')
    AND e.status IN ('active', 'past_due')
  ORDER BY organization_edition_rank(e.edition) DESC
  LIMIT 1;

  v_use_ent := FOUND
    AND organization_entitlement_row_phase(v_ent, v_now) IN ('active', 'past_due');

  IF NOT v_use_ent THEN
    SELECT * INTO v_sub
    FROM organization_subscriptions
    WHERE organization_id = p_organization_id;

    v_has_active_sub := FOUND
      AND v_sub.status = 'active'
      AND v_sub.provider = 'manual'
      AND v_sub.current_period_end IS NOT NULL
      AND v_sub.current_period_end > v_now;
  END IF;

  IF p_period_start_override IS NOT NULL AND p_period_end_override IS NOT NULL THEN
    IF p_period_end_override <= p_period_start_override THEN
      RAISE EXCEPTION 'invalid_period' USING ERRCODE = '22023';
    END IF;
    v_period_start := p_period_start_override;
    v_period_end := p_period_end_override;
  ELSIF v_use_ent THEN
    v_anchor := coalesce(
      v_ent.billing_anchor_day,
      extract(day FROM (v_ent.period_start AT TIME ZONE 'UTC'))::smallint
    );
    v_period_start := v_ent.period_start;
    v_period_end := add_calendar_month(v_ent.period_end, v_anchor);
  ELSIF v_has_active_sub THEN
    v_anchor := coalesce(
      v_sub.billing_anchor_day,
      extract(day FROM (v_sub.current_period_start AT TIME ZONE 'UTC'))::smallint
    );
    v_period_start := v_sub.current_period_start;
    v_period_end := add_calendar_month(v_sub.current_period_end, v_anchor);
  ELSE
    v_period_start := v_now;
    v_anchor := extract(day FROM (v_now AT TIME ZONE 'UTC'))::smallint;
    v_period_end := add_calendar_month(v_now, v_anchor);
  END IF;

  RETURN jsonb_build_object(
    'period_start', v_period_start,
    'period_end', v_period_end
  );
END;
$$;

CREATE OR REPLACE FUNCTION preview_activate_platform_purchase_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_req platform_purchase_requests%ROWTYPE;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid_preview_payload' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_req
  FROM platform_purchase_requests
  WHERE id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = '22023';
  END IF;

  IF NOT _edition_is_crm_month_request_kind(v_req.request_kind) THEN
    RAISE EXCEPTION 'preview_month_only' USING ERRCODE = '22023';
  END IF;

  IF v_req.request_kind = 'crm_studio_subscription'
     AND NOT editions_lifecycle_enabled() THEN
    PERFORM _edition_raise('editions_lifecycle_off');
  END IF;

  IF v_req.status = 'activated' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_activated', true,
      'period_start', v_req.activated_period_start,
      'period_end', v_req.activated_period_end
    );
  END IF;

  IF v_req.status IS DISTINCT FROM 'new' THEN
    RAISE EXCEPTION 'request_not_new' USING ERRCODE = '22023';
  END IF;

  IF organization_has_lifetime_license(v_req.organization_id) THEN
    RAISE EXCEPTION 'month_on_lifetime_forbidden' USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'request_id', v_req.id,
    'request_kind', v_req.request_kind
  ) || _preview_crm_month_activation_period(v_req.organization_id);
END;
$$;

-- =============================================================================
-- 4. submit_platform_purchase_request — Studio SKU
-- =============================================================================

CREATE OR REPLACE FUNCTION submit_platform_purchase_request(
  p_quote_id uuid,
  p_client_request_id uuid,
  p_organization_id uuid,
  p_requester_user_id uuid,
  p_requester_email text,
  p_organization_name text,
  p_contact_email text,
  p_contact_telegram text,
  p_payment_comment text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_existing platform_purchase_requests%ROWTYPE;
  v_quote platform_purchase_quotes%ROWTYPE;
  v_org organizations%ROWTYPE;
  v_kind text;
  v_now timestamptz := now();
  v_request_id uuid;
BEGIN
  IF p_quote_id IS NULL OR p_client_request_id IS NULL OR p_organization_id IS NULL
     OR p_requester_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_submit_payload' USING ERRCODE = '22023';
  END IF;

  IF p_payment_comment IS NULL OR length(trim(p_payment_comment)) = 0 THEN
    RAISE EXCEPTION 'payment_comment_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM platform_purchase_requests
  WHERE requester_user_id = p_requester_user_id
    AND client_request_id = p_client_request_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'request_id', v_existing.id,
      'status', v_existing.status
    );
  END IF;

  SELECT * INTO v_org
  FROM organizations
  WHERE id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_not_found' USING ERRCODE = '22023';
  END IF;

  IF v_org.data_purge_at IS NOT NULL AND v_now >= v_org.data_purge_at THEN
    RAISE EXCEPTION 'demo_purge_deadline_passed' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_quote
  FROM platform_purchase_quotes
  WHERE id = p_quote_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote_not_found' USING ERRCODE = '22023';
  END IF;

  IF v_quote.organization_id IS DISTINCT FROM p_organization_id
     OR v_quote.requester_user_id IS DISTINCT FROM p_requester_user_id THEN
    RAISE EXCEPTION 'quote_forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_quote.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'quote_already_consumed' USING ERRCODE = '22023';
  END IF;

  IF v_quote.expires_at <= v_now THEN
    RAISE EXCEPTION 'quote_expired' USING ERRCODE = '22023';
  END IF;

  v_kind := CASE v_quote.sku
    WHEN 'crm_license' THEN 'crm_license'
    WHEN 'crm_subscription' THEN 'crm_subscription'
    WHEN 'crm_studio_subscription' THEN 'crm_studio_subscription'
    ELSE NULL
  END;

  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'invalid_quote_sku' USING ERRCODE = '22023';
  END IF;

  IF _edition_is_crm_month_request_kind(v_kind)
     AND organization_has_lifetime_license(p_organization_id) THEN
    RAISE EXCEPTION 'lifetime_org_monthly_forbidden' USING ERRCODE = '22023';
  END IF;

  UPDATE platform_purchase_quotes
  SET consumed_at = v_now
  WHERE id = p_quote_id
    AND consumed_at IS NULL;

  INSERT INTO platform_purchase_requests (
    organization_id,
    requester_user_id,
    requester_email,
    organization_name,
    contact_email,
    contact_telegram,
    payment_comment,
    request_kind,
    quote_id,
    client_request_id,
    method_code,
    amount,
    currency,
    pricing_revision,
    payment_details_fingerprint,
    status
  )
  VALUES (
    p_organization_id,
    p_requester_user_id,
    NULLIF(trim(p_requester_email), ''),
    COALESCE(NULLIF(trim(p_organization_name), ''), v_org.name),
    NULLIF(trim(p_contact_email), ''),
    NULLIF(trim(p_contact_telegram), ''),
    trim(p_payment_comment),
    v_kind,
    p_quote_id,
    p_client_request_id,
    v_quote.method_code,
    v_quote.amount,
    v_quote.currency,
    v_quote.pricing_revision,
    v_quote.qr_sha256,
    'new'
  )
  RETURNING id INTO v_request_id;

  IF v_org.status IN ('demo_active', 'demo_retention')
     AND v_org.data_purge_at IS NOT NULL
     AND v_now < v_org.data_purge_at
     AND v_org.purchase_review_hold_until IS NULL THEN
    UPDATE organizations
    SET purchase_review_hold_until = v_org.data_purge_at + interval '72 hours'
    WHERE id = p_organization_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'request_id', v_request_id,
    'request_kind', v_kind
  );
END;
$$;

-- =============================================================================
-- 5. activate_platform_purchase_request (F109, F47, F52, F83)
-- =============================================================================

CREATE OR REPLACE FUNCTION activate_platform_purchase_request(
  p_request_id uuid,
  p_actor_id uuid,
  p_period_start timestamptz DEFAULT NULL,
  p_period_end timestamptz DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_lifetime_key_hash text DEFAULT NULL,
  p_lifetime_recipient_email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_req platform_purchase_requests%ROWTYPE;
  v_org organizations%ROWTYPE;
  v_now timestamptz := now();
  v_version_id uuid;
  v_key_id uuid;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_anchor smallint;
  v_has_lifetime boolean;
  v_edition text;
  v_instrument text;
BEGIN
  IF p_request_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'invalid_activate_payload' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_req
  FROM platform_purchase_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = '22023';
  END IF;

  IF v_req.status = 'activated' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_activated', true,
      'request_id', v_req.id,
      'request_kind', v_req.request_kind,
      'activated_period_start', v_req.activated_period_start,
      'activated_period_end', v_req.activated_period_end,
      'access_key_id', v_req.access_key_id
    );
  END IF;

  IF v_req.status IS DISTINCT FROM 'new' THEN
    RAISE EXCEPTION 'request_not_new' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_org
  FROM organizations
  WHERE id = v_req.organization_id
  FOR UPDATE;

  v_has_lifetime := organization_has_lifetime_license(v_req.organization_id);

  IF _edition_is_crm_month_request_kind(v_req.request_kind) AND v_has_lifetime THEN
    RAISE EXCEPTION 'month_on_lifetime_forbidden' USING ERRCODE = '22023';
  END IF;

  IF v_req.request_kind = 'crm_license' AND v_has_lifetime THEN
    RAISE EXCEPTION 'already_lifetime' USING ERRCODE = '22023';
  END IF;

  IF v_req.request_kind = 'crm_studio_subscription'
     AND NOT editions_lifecycle_enabled() THEN
    PERFORM _edition_raise('editions_lifecycle_off');
  END IF;

  IF (p_period_start IS NOT NULL OR p_period_end IS NOT NULL)
     AND (p_note IS NULL OR length(trim(p_note)) = 0) THEN
    RAISE EXCEPTION 'period_override_note_required' USING ERRCODE = '22023';
  END IF;

  v_version_id := current_crm_version_id();

  IF _edition_is_crm_month_request_kind(v_req.request_kind) THEN
    SELECT m.edition, m.instrument
    INTO v_edition, v_instrument
    FROM _edition_month_meta_from_request_kind(v_req.request_kind) m;

    IF p_period_start IS NOT NULL AND p_period_end IS NOT NULL THEN
      IF p_period_end <= p_period_start THEN
        RAISE EXCEPTION 'invalid_period' USING ERRCODE = '22023';
      END IF;
      v_period_start := p_period_start;
      v_period_end := p_period_end;
      v_anchor := extract(day FROM (v_period_start AT TIME ZONE 'UTC'))::smallint;
    ELSE
      SELECT
        (j ->> 'period_start')::timestamptz,
        (j ->> 'period_end')::timestamptz
      INTO v_period_start, v_period_end
      FROM (
        SELECT _preview_crm_month_activation_period(v_req.organization_id) AS j
      ) s;

      v_anchor := extract(day FROM (v_period_start AT TIME ZONE 'UTC'))::smallint;
    END IF;

    PERFORM _edition_upsert_live_month_entitlement(
      v_req.organization_id,
      v_edition,
      v_instrument,
      'active',
      v_period_start,
      v_period_end,
      v_anchor,
      p_request_id,
      'purchase',
      p_actor_id
    );

    UPDATE organizations
    SET status = 'licensed',
        data_purge_at = NULL,
        demo_expires_at = NULL,
        purchase_review_hold_until = NULL
    WHERE id = v_req.organization_id;

    UPDATE platform_purchase_requests
    SET status = 'activated',
        activated_by = p_actor_id,
        activated_at = v_now,
        activated_period_start = v_period_start,
        activated_period_end = v_period_end,
        updated_at = v_now
    WHERE id = p_request_id;

    PERFORM _refresh_organization_purchase_review_hold(v_req.organization_id);

    RETURN jsonb_build_object(
      'ok', true,
      'request_id', p_request_id,
      'request_kind', v_req.request_kind,
      'activated_period_start', v_period_start,
      'activated_period_end', v_period_end
    );
  END IF;

  IF v_req.request_kind <> 'crm_license' THEN
    RAISE EXCEPTION 'unsupported_request_kind' USING ERRCODE = '22023';
  END IF;

  IF p_lifetime_key_hash IS NULL OR length(trim(p_lifetime_key_hash)) = 0 THEN
    RAISE EXCEPTION 'lifetime_key_hash_required' USING ERRCODE = '22023';
  END IF;

  PERFORM _edition_cancel_other_raising_instruments('pro_lifetime');
  PERFORM _edition_cancel_trial_pro(v_req.organization_id);

  INSERT INTO access_keys (
    key_hash, key_type, status, crm_version_id, email,
    organization_id, activated_at, created_by
  )
  VALUES (
    trim(p_lifetime_key_hash), 'lifetime', 'consumed', v_version_id,
    NULLIF(trim(p_lifetime_recipient_email), ''),
    v_req.organization_id, v_now, p_actor_id
  )
  RETURNING id INTO v_key_id;

  INSERT INTO organization_entitlements (
    organization_id, edition, instrument, status, period_start, period_end, billing_anchor_day
  )
  SELECT v_req.organization_id, 'pro', 'pro_lifetime', 'active', NULL, NULL, NULL
  WHERE NOT EXISTS (
    SELECT 1
    FROM organization_entitlements e
    WHERE e.organization_id = v_req.organization_id
      AND e.instrument = 'pro_lifetime'
      AND e.status IN ('active', 'past_due')
  );

  UPDATE organization_entitlements e
  SET status = 'active', updated_at = v_now
  WHERE e.organization_id = v_req.organization_id
    AND e.instrument = 'pro_lifetime';

  PERFORM _insert_free_lifetime_entitlement(v_req.organization_id);

  INSERT INTO organization_edition_state (
    organization_id, active_edition, changed_at, changed_by, change_reason
  )
  VALUES (v_req.organization_id, 'pro', v_now, p_actor_id, 'purchase')
  ON CONFLICT (organization_id) DO UPDATE
    SET active_edition = 'pro',
        changed_at = v_now,
        changed_by = p_actor_id,
        change_reason = 'purchase';

  UPDATE organizations
  SET status = 'licensed',
      access_key_id = v_key_id,
      data_purge_at = NULL,
      demo_expires_at = NULL,
      purchase_review_hold_until = NULL
  WHERE id = v_req.organization_id;

  INSERT INTO organization_licenses (
    organization_id, crm_version_id, license_type, access_key_id, activated_at, expires_at
  )
  VALUES (
    v_req.organization_id, v_version_id, 'lifetime', v_key_id, v_now, NULL
  )
  ON CONFLICT (organization_id) DO UPDATE
    SET license_type = 'lifetime',
        access_key_id = EXCLUDED.access_key_id,
        crm_version_id = EXCLUDED.crm_version_id,
        activated_at = EXCLUDED.activated_at,
        expires_at = NULL;

  UPDATE organization_subscriptions
  SET status = 'canceled', updated_at = v_now
  WHERE organization_id = v_req.organization_id
    AND status IS DISTINCT FROM 'canceled';

  UPDATE platform_purchase_requests
  SET status = 'activated',
      activated_by = p_actor_id,
      activated_at = v_now,
      access_key_id = v_key_id,
      updated_at = v_now
  WHERE id = p_request_id;

  PERFORM _refresh_organization_purchase_review_hold(v_req.organization_id);

  RETURN jsonb_build_object(
    'ok', true,
    'request_id', p_request_id,
    'request_kind', v_req.request_kind,
    'access_key_id', v_key_id
  );
END;
$$;

REVOKE ALL ON FUNCTION activate_platform_purchase_request(
  uuid, uuid, timestamptz, timestamptz, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION activate_platform_purchase_request(
  uuid, uuid, timestamptz, timestamptz, text, text, text
) TO service_role;

-- =============================================================================
-- 6. dev_console_adjust_organization_subscription wrap (F113)
-- =============================================================================

CREATE OR REPLACE FUNCTION dev_console_adjust_organization_subscription(
  p_organization_id uuid,
  p_actor_id uuid,
  p_status text DEFAULT NULL,
  p_period_start timestamptz DEFAULT NULL,
  p_period_end timestamptz DEFAULT NULL,
  p_provider text DEFAULT NULL,
  p_extend_one_month boolean DEFAULT false,
  p_note text DEFAULT NULL
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
BEGIN
  IF p_organization_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'invalid_adjust_payload' USING ERRCODE = '22023';
  END IF;

  IF p_note IS NULL OR length(trim(p_note)) = 0 THEN
    RAISE EXCEPTION 'adjust_note_required' USING ERRCODE = '22023';
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

  IF v_has_sub THEN
    v_plan := coalesce(v_sub.plan, 'pro');
    IF v_plan = 'standard' THEN
      v_plan := 'pro';
    END IF;
  ELSIF v_has_ent THEN
    v_plan := CASE v_ent.edition WHEN 'studio' THEN 'studio' ELSE 'pro' END;
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
    'current_period_end', current_period_end
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
  uuid, uuid, text, timestamptz, timestamptz, text, boolean, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dev_console_adjust_organization_subscription(
  uuid, uuid, text, timestamptz, timestamptz, text, boolean, text
) TO service_role;

-- =============================================================================
-- 7. expire_crm_organization_subscriptions (flag off = S4, on = entitlements)
-- =============================================================================

CREATE OR REPLACE FUNCTION expire_crm_organization_subscriptions(
  p_batch_size int DEFAULT 200,
  p_as_of timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_as_of timestamptz := COALESCE(p_as_of, now());
  v_grace constant interval := interval '7 days';
  v_past_due int := 0;
  v_suspended int := 0;
  v_canceled int := 0;
  rec record;
  v_has_lifetime boolean;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 5000 THEN
    RAISE EXCEPTION 'invalid batch size' USING ERRCODE = '22023';
  END IF;

  IF NOT editions_lifecycle_enabled() THEN
    FOR rec IN
      SELECT os.organization_id
      FROM organization_subscriptions os
      WHERE os.status = 'active'
        AND os.current_period_end IS NOT NULL
        AND os.current_period_end <= v_as_of
        AND NOT organization_has_lifetime_license(os.organization_id)
      ORDER BY os.current_period_end
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
    LOOP
      UPDATE organization_subscriptions
      SET status = 'past_due', updated_at = now()
      WHERE organization_id = rec.organization_id AND status = 'active';
      v_past_due := v_past_due + 1;
    END LOOP;

    FOR rec IN
      SELECT os.organization_id
      FROM organization_subscriptions os
      JOIN organizations o ON o.id = os.organization_id
      WHERE os.status = 'past_due'
        AND os.current_period_end IS NOT NULL
        AND (os.current_period_end + v_grace) <= v_as_of
        AND NOT organization_has_lifetime_license(os.organization_id)
      ORDER BY os.current_period_end
      LIMIT p_batch_size
      FOR UPDATE OF os, o SKIP LOCKED
    LOOP
      UPDATE organization_subscriptions
      SET status = 'canceled', updated_at = now()
      WHERE organization_id = rec.organization_id AND status = 'past_due';

      UPDATE organizations
      SET status = 'suspended'
      WHERE id = rec.organization_id AND status = 'licensed';

      v_suspended := v_suspended + 1;
    END LOOP;

    RETURN jsonb_build_object(
      'ok', true,
      'past_due_count', v_past_due,
      'suspended_count', v_suspended
    );
  END IF;

  FOR rec IN
    SELECT e.id, e.organization_id, e.instrument, e.edition
    FROM organization_entitlements e
    WHERE e.instrument IN ('studio_monthly', 'pro_monthly')
      AND e.status = 'active'
      AND e.period_end IS NOT NULL
      AND e.period_end <= v_as_of
    ORDER BY e.period_end
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE organization_entitlements
    SET status = 'past_due', updated_at = now()
    WHERE id = rec.id;

    UPDATE organization_edition_state s
    SET active_edition = 'lite',
        changed_at = v_as_of,
        change_reason = 'expire_grace'
    WHERE s.organization_id = rec.organization_id
      AND organization_edition_rank(s.active_edition) > 1;

    PERFORM _sync_organization_edition_mirrors(rec.organization_id);
    v_past_due := v_past_due + 1;
  END LOOP;

  FOR rec IN
    SELECT e.id, e.organization_id
    FROM organization_entitlements e
    WHERE e.instrument IN ('studio_monthly', 'pro_monthly')
      AND e.status = 'past_due'
      AND e.period_end IS NOT NULL
      AND (e.period_end + v_grace) <= v_as_of
    ORDER BY e.period_end
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT EXISTS (
      SELECT 1
      FROM organization_entitlements x
      WHERE x.organization_id = rec.organization_id
        AND x.instrument = 'pro_lifetime'
        AND x.status IN ('active', 'past_due')
        AND organization_entitlement_row_phase(x, v_as_of) = 'active'
    ) INTO v_has_lifetime;

    UPDATE organization_entitlements
    SET status = 'canceled', updated_at = now()
    WHERE id = rec.id;

    IF NOT v_has_lifetime THEN
      DELETE FROM organization_licenses ol WHERE ol.organization_id = rec.organization_id;
    END IF;

    UPDATE organization_edition_state s
    SET active_edition = 'lite',
        changed_at = v_as_of,
        change_reason = 'expire'
    WHERE s.organization_id = rec.organization_id;

    PERFORM _sync_organization_edition_mirrors(rec.organization_id);
    v_canceled := v_canceled + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'past_due_count', v_past_due,
    'canceled_count', v_canceled,
    'suspended_count', 0
  );
END;
$$;

-- =============================================================================
-- 8. Purge F70 / F79 / F104
-- =============================================================================

DROP FUNCTION IF EXISTS purge_single_organization(uuid, uuid, text, boolean);

CREATE OR REPLACE FUNCTION _purge_demo_organization_core(
  p_org_id uuid,
  p_actor_user_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_force_licensed boolean DEFAULT false,
  p_audit_action text DEFAULT 'org.purged',
  p_force_anti_abuse boolean DEFAULT false
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
  v_live_free_lifetime boolean := false;
  v_audit text;
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

  SELECT EXISTS (
    SELECT 1
    FROM organization_entitlements e
    WHERE e.organization_id = p_org_id
      AND e.instrument = 'free_lifetime'
      AND e.status IN ('active', 'past_due')
      AND organization_entitlement_row_phase(e, now()) = 'active'
  ) INTO v_live_free_lifetime;

  IF v_org.status = 'licensed' OR v_live_free_lifetime THEN
    RAISE EXCEPTION 'licensed_org_purge_forbidden' USING ERRCODE = '22023';
  END IF;

  IF v_org.status = 'suspended' THEN
    IF NOT coalesce(p_force_anti_abuse, false)
       OR p_reason IS NULL
       OR length(trim(p_reason)) < 8 THEN
      RAISE EXCEPTION 'abuse_purge_note_required' USING ERRCODE = '22023';
    END IF;
    v_audit := 'org.purged_abuse';
  ELSE
    v_audit := coalesce(p_audit_action, 'org.purged');

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
        owner_email_hash, telegram_id_hash, first_demo_at, purged_at, payment_ref
      )
      VALUES (
        v_email_hash, v_tg_hash,
        coalesce(v_org.demo_activated_at, now()), now(), v_org.payment_ref
      )
      ON CONFLICT (owner_email_hash) DO UPDATE
        SET purged_at = EXCLUDED.purged_at,
            telegram_id_hash = coalesce(EXCLUDED.telegram_id_hash, demo_owner_retention.telegram_id_hash),
            payment_ref = coalesce(EXCLUDED.payment_ref, demo_owner_retention.payment_ref);
    END IF;
  END IF;

  DELETE FROM user_active_organizations uao WHERE uao.organization_id = p_org_id;

  UPDATE organizations SET access_key_id = NULL WHERE id = p_org_id;

  UPDATE access_keys
  SET status = 'consumed', organization_id = NULL
  WHERE organization_id = p_org_id
     OR (v_key_id IS NOT NULL AND id = v_key_id);

  DELETE FROM organizations WHERE id = p_org_id;

  INSERT INTO platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  VALUES (
    p_actor_user_id,
    v_audit,
    'organization',
    p_org_id,
    jsonb_build_object(
      'previous_name', v_prev_name,
      'previous_status', v_prev_status,
      'reason', left(coalesce(p_reason, ''), 500),
      'force_licensed', coalesce(p_force_licensed, false),
      'force_anti_abuse', coalesce(p_force_anti_abuse, false),
      'deleted', true
    )
  );

  RETURN jsonb_build_object('ok', true, 'organization_id', p_org_id, 'deleted', true);
END;
$$;

CREATE OR REPLACE FUNCTION purge_single_organization(
  p_org_id uuid,
  p_actor_user_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_force_licensed boolean DEFAULT false,
  p_force_anti_abuse boolean DEFAULT false
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
    'org.manual_purge',
    p_force_anti_abuse
  );
END;
$$;

REVOKE ALL ON FUNCTION purge_single_organization(uuid, uuid, text, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_single_organization(uuid, uuid, text, boolean, boolean) TO service_role;

-- =============================================================================
-- 9. Notification CASE Studio (F114)
-- =============================================================================

CREATE OR REPLACE FUNCTION enqueue_platform_purchase_request_notifications(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req platform_purchase_requests%ROWTYPE;
  v_quote_details text;
  v_chat_id bigint;
  v_email_to text;
  v_kind_label text;
  v_contact text;
  v_header text;
  v_comment text;
  v_telegram text;
  v_email_subject text;
  v_email_text text;
  v_payload jsonb;
  v_tg_status text;
  v_tg_error text;
  v_email_id uuid;
  v_tg_id uuid;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_req FROM platform_purchase_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'purchase_request_not_found' USING ERRCODE = '22023';
  END IF;

  SELECT telegram_chat_id INTO v_chat_id
  FROM platform_notification_settings WHERE id = 1;

  SELECT NULLIF(trim(config #>> '{contacts,email}'), '')
  INTO v_email_to
  FROM platform_payment_methods WHERE id = 1;

  IF v_req.quote_id IS NOT NULL THEN
    SELECT payment_details_snapshot INTO v_quote_details
    FROM platform_purchase_quotes WHERE id = v_req.quote_id;
  END IF;

  v_kind_label := CASE v_req.request_kind
    WHEN 'crm_subscription' THEN 'Pro / месяц'
    WHEN 'crm_studio_subscription' THEN 'Studio / месяц'
    WHEN 'crm_license' THEN 'Lifetime'
    ELSE 'Unknown'
  END;

  v_contact := COALESCE(NULLIF(trim(v_req.contact_email), ''), '—');
  IF NULLIF(trim(v_req.contact_telegram), '') IS NOT NULL THEN
    v_contact := v_contact || ' · ' || left(trim(v_req.contact_telegram), 40);
  END IF;

  v_header := format(
    E'[purchase] %s · %s\norg: %s  request: %s\nожидаем: %s %s\nконтакт: %s',
    v_kind_label,
    left(_platform_notification_plain(v_req.organization_name), 80),
    _platform_notification_short_id(v_req.organization_id),
    _platform_notification_short_id(v_req.id),
    COALESCE(v_req.amount, '—'),
    COALESCE(v_req.currency, ''),
    v_contact
  );

  v_comment := left(
    _platform_notification_plain(v_req.payment_comment),
    GREATEST(4096 - char_length(v_header) - 8, 0)
  );
  v_telegram := left(v_header || E'\n«' || v_comment || E'»', 4096);

  v_email_subject := CASE v_req.request_kind
    WHEN 'crm_subscription' THEN
      'TangoDB: заявка Pro (месяц) — ' || COALESCE(v_req.organization_name, '')
    WHEN 'crm_studio_subscription' THEN
      'TangoDB: заявка Studio (месяц) — ' || COALESCE(v_req.organization_name, '')
    WHEN 'crm_license' THEN
      'TangoDB: заявка Lifetime — ' || COALESCE(v_req.organization_name, '')
    ELSE
      'TangoDB: заявка — ' || COALESCE(v_req.organization_name, '')
  END;

  v_email_text := concat_ws(
    E'\n',
    CASE v_req.request_kind
      WHEN 'crm_subscription' THEN 'Новая заявка на месячную подписку CRM Pro.'
      WHEN 'crm_studio_subscription' THEN 'Новая заявка на месячную подписку CRM Studio.'
      WHEN 'crm_license' THEN 'Новая заявка на покупку полной версии TangoDB (Lifetime).'
      ELSE 'Новая заявка на покупку.'
    END,
    '',
    'Request ID: ' || v_req.id::text,
    'Kind: ' || v_req.request_kind,
    'Quote ID: ' || COALESCE(v_req.quote_id::text, ''),
    'Method: ' || COALESCE(v_req.method_code, ''),
    'Amount: ' || COALESCE(v_req.amount, '') || ' ' || COALESCE(v_req.currency, ''),
    'Pricing revision: ' || COALESCE(v_req.pricing_revision::text, ''),
    'Organization: ' || COALESCE(v_req.organization_name, '') || ' (' || v_req.organization_id::text || ')',
    'Requester email: ' || COALESCE(v_req.requester_email, 'not provided'),
    'Contact email: ' || COALESCE(v_req.contact_email, v_req.requester_email, 'not provided'),
    'Telegram: ' || COALESCE(v_req.contact_telegram, 'not provided'),
    '',
    'Payment details (quote snapshot):',
    COALESCE(v_quote_details, ''),
    '',
    'Комментарий пользователя:',
    _platform_notification_plain(v_req.payment_comment),
    '',
    'Проверьте поступление средств и активируйте доступ в Dev Console → Inbox.'
  );

  v_payload := _platform_notification_sanitize_payload(jsonb_build_object(
    'telegram_text', v_telegram,
    'email_subject', left(v_email_subject, 200),
    'email_text', left(v_email_text, 8000),
    'email_to', v_email_to,
    'org_id', v_req.organization_id,
    'org_name', left(v_req.organization_name, 120),
    'request_id', v_req.id,
    'request_kind', v_req.request_kind,
    'amount', v_req.amount,
    'currency', v_req.currency,
    'method_code', v_req.method_code,
    'contact_email', v_req.contact_email,
    'contact_telegram', left(COALESCE(v_req.contact_telegram, ''), 40)
  ));

  IF v_chat_id IS NULL THEN
    v_tg_status := 'blocked';
    v_tg_error := 'config_missing';
  ELSE
    v_tg_status := 'pending';
    v_tg_error := NULL;
  END IF;

  v_email_id := enqueue_platform_notification(
    'email', 'purchase_request', 'platform_purchase_request',
    v_req.id, 'purchase:' || v_req.id::text || ':email',
    v_payload, 'pending', NULL
  );

  v_tg_id := enqueue_platform_notification(
    'telegram', 'purchase_request', 'platform_purchase_request',
    v_req.id, 'purchase:' || v_req.id::text || ':telegram',
    v_payload, v_tg_status, v_tg_error
  );

  RETURN jsonb_build_object(
    'ok', true,
    'email_notification_id', v_email_id,
    'telegram_notification_id', v_tg_id
  );
END;
$$;

-- =============================================================================
-- 10. activate_access_key lifetime → pro_lifetime entitlements (F119)
-- =============================================================================

CREATE OR REPLACE FUNCTION _edition_apply_access_key_lifetime(p_org_id uuid, p_actor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  PERFORM 1 FROM organizations o WHERE o.id = p_org_id FOR UPDATE;

  PERFORM _edition_cancel_other_raising_instruments('pro_lifetime');
  PERFORM _edition_cancel_trial_pro(p_org_id);

  INSERT INTO organization_entitlements (
    organization_id, edition, instrument, status, period_start, period_end, billing_anchor_day
  )
  SELECT p_org_id, 'pro', 'pro_lifetime', 'active', NULL, NULL, NULL
  WHERE NOT EXISTS (
    SELECT 1
    FROM organization_entitlements e
    WHERE e.organization_id = p_org_id
      AND e.instrument = 'pro_lifetime'
      AND e.status IN ('active', 'past_due')
  );

  UPDATE organization_entitlements e
  SET status = 'active', updated_at = v_now
  WHERE e.organization_id = p_org_id AND e.instrument = 'pro_lifetime';

  PERFORM _insert_free_lifetime_entitlement(p_org_id);

  INSERT INTO organization_edition_state (
    organization_id, active_edition, changed_at, changed_by, change_reason
  )
  VALUES (p_org_id, 'pro', v_now, p_actor_id, 'purchase')
  ON CONFLICT (organization_id) DO UPDATE
    SET active_edition = 'pro',
        changed_at = v_now,
        changed_by = p_actor_id,
        change_reason = 'purchase';

  UPDATE organization_subscriptions os
  SET status = 'canceled', updated_at = v_now
  WHERE os.organization_id = p_org_id
    AND os.status IS DISTINCT FROM 'canceled';

  PERFORM _sync_organization_edition_mirrors(p_org_id);
END;
$$;

REVOKE ALL ON FUNCTION _edition_apply_access_key_lifetime(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _edition_apply_access_key_lifetime(uuid, uuid) TO service_role;

-- Patch activate_access_key: call helper after lifetime license paths
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
    PERFORM _seed_demo_edition_entitlements(v_org_id, v_now, v_demo_expires);

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
    IF v_key.email IS NULL OR lower(trim(v_key.email)) <> lower(trim(v_user_email)) THEN
      RAISE EXCEPTION 'invalid access key' USING ERRCODE = '22023';
    END IF;

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

      PERFORM _edition_apply_access_key_lifetime(v_org_id, v_user_id);

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

    PERFORM _edition_apply_access_key_lifetime(v_org_id, v_user_id);

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
GRANT EXECUTE ON FUNCTION activate_access_key(text, text, uuid) TO authenticated, service_role;

COMMIT;
