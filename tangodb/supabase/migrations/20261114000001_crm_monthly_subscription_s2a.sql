-- S2a / 2.11.1: platform purchase quotes, crm_subscription kind, review hold, anchor months, submit/activate RPC.

BEGIN;

-- =============================================================================
-- 1. platform_purchase_quotes (backend-only)
-- =============================================================================

CREATE TABLE platform_purchase_quotes (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  requester_user_id         UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  sku                       TEXT NOT NULL CHECK (sku IN ('crm_license', 'crm_subscription')),
  method_code               TEXT NOT NULL,
  amount                    TEXT NOT NULL,
  currency                  TEXT NOT NULL,
  pricing_revision          INTEGER NOT NULL,
  payment_details_snapshot  TEXT NOT NULL,
  qr_sha256                 TEXT,
  expires_at                TIMESTAMPTZ NOT NULL,
  consumed_at               TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_purchase_quotes_amount_nonempty CHECK (length(trim(amount)) > 0),
  CONSTRAINT platform_purchase_quotes_currency_nonempty CHECK (length(trim(currency)) > 0)
);

CREATE INDEX idx_platform_purchase_quotes_org_user_created
  ON platform_purchase_quotes (organization_id, requester_user_id, created_at DESC);

CREATE INDEX idx_platform_purchase_quotes_expired_unused
  ON platform_purchase_quotes (expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE platform_purchase_quotes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON platform_purchase_quotes FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_purchase_quotes TO service_role;

COMMENT ON TABLE platform_purchase_quotes IS
  'Immutable server quotes for CRM license/monthly purchase. No authenticated access; Edge/RPC only.';

-- =============================================================================
-- 2. platform_purchase_requests — quote snapshot + crm_subscription kind
-- =============================================================================

ALTER TABLE platform_purchase_requests
  ADD COLUMN IF NOT EXISTS quote_id UUID REFERENCES platform_purchase_quotes (id),
  ADD COLUMN IF NOT EXISTS client_request_id UUID,
  ADD COLUMN IF NOT EXISTS method_code TEXT,
  ADD COLUMN IF NOT EXISTS amount TEXT,
  ADD COLUMN IF NOT EXISTS currency TEXT,
  ADD COLUMN IF NOT EXISTS pricing_revision INTEGER,
  ADD COLUMN IF NOT EXISTS payment_details_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS activated_period_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS activated_period_end TIMESTAMPTZ;

ALTER TABLE platform_purchase_requests
  DROP CONSTRAINT IF EXISTS platform_purchase_requests_request_kind_check;

ALTER TABLE platform_purchase_requests
  ADD CONSTRAINT platform_purchase_requests_request_kind_check
  CHECK (request_kind IN ('crm_license', 'crm_subscription', 'renter_miniapp_addon'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_purchase_requests_requester_client_request
  ON platform_purchase_requests (requester_user_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION platform_purchase_requests_kind_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_role text;
BEGIN
  v_role := COALESCE(auth.role(), current_setting('role', true));

  IF NEW.request_kind = 'renter_miniapp_addon' AND v_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'purchase_request_kind_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF v_role = 'authenticated'
     AND NEW.request_kind NOT IN ('crm_license') THEN
    RAISE EXCEPTION 'purchase_request_kind_forbidden'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- =============================================================================
-- 3. organizations.purchase_review_hold_until
-- =============================================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS purchase_review_hold_until TIMESTAMPTZ;

COMMENT ON COLUMN organizations.purchase_review_hold_until IS
  'Bounded demo purge hold after first timely crm_license/crm_subscription new request (data_purge_at + 72h).';

-- =============================================================================
-- 4. organization_subscriptions — billing anchor + manual active period guard
-- =============================================================================

ALTER TABLE organization_subscriptions
  ADD COLUMN IF NOT EXISTS billing_anchor_day smallint;

ALTER TABLE organization_subscriptions
  DROP CONSTRAINT IF EXISTS organization_subscriptions_billing_anchor_day_check;

ALTER TABLE organization_subscriptions
  ADD CONSTRAINT organization_subscriptions_billing_anchor_day_check
  CHECK (billing_anchor_day IS NULL OR (billing_anchor_day >= 1 AND billing_anchor_day <= 31));

ALTER TABLE organization_subscriptions
  DROP CONSTRAINT IF EXISTS organization_subscriptions_manual_active_period_check;

ALTER TABLE organization_subscriptions
  ADD CONSTRAINT organization_subscriptions_manual_active_period_check
  CHECK (
    provider IS DISTINCT FROM 'manual'
    OR status IS DISTINCT FROM 'active'
    OR (
      current_period_start IS NOT NULL
      AND current_period_end IS NOT NULL
      AND current_period_end > current_period_start
    )
  );

CREATE OR REPLACE FUNCTION add_calendar_month(p_start timestamptz, p_anchor_day smallint)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_tz constant text := 'UTC';
  v_start_local timestamp;
  v_y int;
  v_m int;
  v_anchor int;
  v_next_y int;
  v_next_m int;
  v_last_day int;
  v_target_day int;
  v_h int;
  v_min int;
  v_sec double precision;
BEGIN
  v_anchor := greatest(1, least(31, p_anchor_day));
  v_start_local := (p_start AT TIME ZONE v_tz);
  v_y := extract(year FROM v_start_local)::int;
  v_m := extract(month FROM v_start_local)::int;
  v_h := extract(hour FROM v_start_local)::int;
  v_min := extract(minute FROM v_start_local)::int;
  v_sec := extract(second FROM v_start_local);

  v_next_m := v_m + 1;
  v_next_y := v_y;
  IF v_next_m > 12 THEN
    v_next_m := 1;
    v_next_y := v_y + 1;
  END IF;

  v_last_day := extract(
    day FROM ((make_date(v_next_y, v_next_m, 1) + interval '1 month - 1 day')::date)
  )::int;
  v_target_day := least(v_anchor, v_last_day);

  RETURN make_timestamptz(v_next_y, v_next_m, v_target_day, v_h, v_min, v_sec, v_tz);
END;
$$;

CREATE OR REPLACE FUNCTION organization_has_active_subscription(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organization_subscriptions os
    WHERE os.organization_id = p_org_id
      AND os.status = 'active'
      AND (
        (
          os.provider = 'manual'
          AND os.current_period_end IS NOT NULL
          AND os.current_period_end > now()
        )
        OR (
          os.provider IS DISTINCT FROM 'manual'
          AND (os.current_period_end IS NULL OR os.current_period_end > now())
        )
      )
  );
$$;

-- =============================================================================
-- 5. Review-hold helpers + purge skip
-- =============================================================================

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
      AND pr.request_kind IN ('crm_license', 'crm_subscription')
  );
$$;

CREATE OR REPLACE FUNCTION _refresh_organization_purchase_review_hold(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT _organization_has_eligible_purchase_review_new(p_org_id) THEN
    UPDATE organizations
    SET purchase_review_hold_until = NULL
    WHERE id = p_org_id;
  END IF;
END;
$$;

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
      AND NOT (
        o.purchase_review_hold_until IS NOT NULL
        AND now() < o.purchase_review_hold_until
        AND _organization_has_eligible_purchase_review_new(o.id)
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

CREATE OR REPLACE FUNCTION cleanup_expired_platform_purchase_quotes(p_batch_size int DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_deleted int;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 5000 THEN
    RAISE EXCEPTION 'invalid batch size' USING ERRCODE = '22023';
  END IF;

  WITH doomed AS (
    SELECT q.id
    FROM platform_purchase_quotes q
    WHERE q.consumed_at IS NULL
      AND q.expires_at < now()
    ORDER BY q.expires_at
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM platform_purchase_quotes q
  USING doomed d
  WHERE q.id = d.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN jsonb_build_object('deleted', v_deleted);
END;
$$;

REVOKE ALL ON FUNCTION cleanup_expired_platform_purchase_quotes(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cleanup_expired_platform_purchase_quotes(int) TO service_role;

-- =============================================================================
-- 6. submit_platform_purchase_request
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
    ELSE NULL
  END;

  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'invalid_quote_sku' USING ERRCODE = '22023';
  END IF;

  IF v_kind = 'crm_subscription' AND organization_has_lifetime_license(p_organization_id) THEN
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

REVOKE ALL ON FUNCTION submit_platform_purchase_request(
  uuid, uuid, uuid, uuid, text, text, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submit_platform_purchase_request(
  uuid, uuid, uuid, uuid, text, text, text, text, text
) TO service_role;

-- =============================================================================
-- 7. activate_platform_purchase_request
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
  v_sub organization_subscriptions%ROWTYPE;
  v_now timestamptz := now();
  v_version_id uuid;
  v_key_id uuid;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_anchor smallint;
  v_has_lifetime boolean;
  v_has_active_entitlement boolean;
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

  IF v_req.request_kind = 'crm_subscription' AND v_has_lifetime THEN
    RAISE EXCEPTION 'month_on_lifetime_forbidden' USING ERRCODE = '22023';
  END IF;

  IF v_req.request_kind = 'crm_license' AND v_has_lifetime THEN
    RAISE EXCEPTION 'already_lifetime' USING ERRCODE = '22023';
  END IF;

  IF (p_period_start IS NOT NULL OR p_period_end IS NOT NULL)
     AND (p_note IS NULL OR length(trim(p_note)) = 0) THEN
    RAISE EXCEPTION 'period_override_note_required' USING ERRCODE = '22023';
  END IF;

  v_version_id := current_crm_version_id();

  IF v_req.request_kind = 'crm_subscription' THEN
    SELECT * INTO v_sub
    FROM organization_subscriptions
    WHERE organization_id = v_req.organization_id
    FOR UPDATE;

    v_has_active_entitlement := FOUND
      AND v_sub.status = 'active'
      AND v_sub.provider = 'manual'
      AND v_sub.current_period_end IS NOT NULL
      AND v_sub.current_period_end > v_now;

    IF p_period_start IS NOT NULL AND p_period_end IS NOT NULL THEN
      IF p_period_end <= p_period_start THEN
        RAISE EXCEPTION 'invalid_period' USING ERRCODE = '22023';
      END IF;
      v_period_start := p_period_start;
      v_period_end := p_period_end;
      v_anchor := extract(day FROM (v_period_start AT TIME ZONE 'UTC'))::smallint;
    ELSIF v_has_active_entitlement THEN
      v_anchor := COALESCE(
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

    IF NOT FOUND THEN
      INSERT INTO organization_subscriptions (
        organization_id,
        plan,
        billing_period,
        status,
        provider,
        current_period_start,
        current_period_end,
        billing_anchor_day,
        updated_at
      )
      VALUES (
        v_req.organization_id,
        'standard',
        'monthly',
        'active',
        'manual',
        v_period_start,
        v_period_end,
        v_anchor,
        v_now
      );
    ELSE
      UPDATE organization_subscriptions
      SET plan = 'standard',
          billing_period = 'monthly',
          status = 'active',
          provider = 'manual',
          current_period_start = v_period_start,
          current_period_end = v_period_end,
          billing_anchor_day = CASE
            WHEN v_has_active_entitlement THEN v_sub.billing_anchor_day
            ELSE v_anchor
          END,
          updated_at = v_now
      WHERE organization_id = v_req.organization_id;
    END IF;

    INSERT INTO organization_licenses (
      organization_id,
      crm_version_id,
      license_type,
      activated_at,
      expires_at
    )
    VALUES (
      v_req.organization_id,
      v_version_id,
      'subscription',
      v_now,
      NULL
    )
    ON CONFLICT (organization_id) DO UPDATE
      SET license_type = CASE
            WHEN organization_licenses.license_type = 'lifetime' THEN 'lifetime'
            ELSE 'subscription'
          END,
          crm_version_id = EXCLUDED.crm_version_id,
          activated_at = EXCLUDED.activated_at,
          expires_at = CASE
            WHEN organization_licenses.license_type = 'lifetime' THEN NULL
            ELSE NULL
          END;

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

  INSERT INTO access_keys (
    key_hash,
    key_type,
    status,
    crm_version_id,
    email,
    organization_id,
    activated_at,
    created_by
  )
  VALUES (
    trim(p_lifetime_key_hash),
    'lifetime',
    'consumed',
    v_version_id,
    NULLIF(trim(p_lifetime_recipient_email), ''),
    v_req.organization_id,
    v_now,
    p_actor_id
  )
  RETURNING id INTO v_key_id;

  UPDATE organizations
  SET status = 'licensed',
      access_key_id = v_key_id,
      data_purge_at = NULL,
      demo_expires_at = NULL,
      purchase_review_hold_until = NULL
  WHERE id = v_req.organization_id;

  INSERT INTO organization_licenses (
    organization_id,
    crm_version_id,
    license_type,
    access_key_id,
    activated_at,
    expires_at
  )
  VALUES (
    v_req.organization_id,
    v_version_id,
    'lifetime',
    v_key_id,
    v_now,
    NULL
  )
  ON CONFLICT (organization_id) DO UPDATE
    SET license_type = 'lifetime',
        access_key_id = EXCLUDED.access_key_id,
        crm_version_id = EXCLUDED.crm_version_id,
        activated_at = EXCLUDED.activated_at,
        expires_at = NULL;

  UPDATE organization_subscriptions
  SET status = 'canceled',
      updated_at = v_now
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

COMMIT;
