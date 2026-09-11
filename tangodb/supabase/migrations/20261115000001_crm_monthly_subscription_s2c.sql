-- S2c / 2.11.3: Inbox preview + Dev Console billing adjust RPC (Edge/UI in same release).

BEGIN;

-- =============================================================================
-- 1. Shared period preview (CRM monthly activation, read-only)
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
  v_sub organization_subscriptions%ROWTYPE;
  v_now timestamptz := now();
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_anchor smallint;
  v_has_active_entitlement boolean;
BEGIN
  SELECT * INTO v_sub
  FROM organization_subscriptions
  WHERE organization_id = p_organization_id;

  v_has_active_entitlement := FOUND
    AND v_sub.status = 'active'
    AND v_sub.provider = 'manual'
    AND v_sub.current_period_end IS NOT NULL
    AND v_sub.current_period_end > v_now;

  IF p_period_start_override IS NOT NULL AND p_period_end_override IS NOT NULL THEN
    IF p_period_end_override <= p_period_start_override THEN
      RAISE EXCEPTION 'invalid_period' USING ERRCODE = '22023';
    END IF;
    v_period_start := p_period_start_override;
    v_period_end := p_period_end_override;
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

  IF v_req.request_kind <> 'crm_subscription' THEN
    RAISE EXCEPTION 'preview_month_only' USING ERRCODE = '22023';
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

REVOKE ALL ON FUNCTION preview_activate_platform_purchase_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION preview_activate_platform_purchase_request(uuid) TO service_role;

-- =============================================================================
-- 2. Dev Console manual billing adjust (create-if-missing, extend, audit payload)
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
  v_before jsonb;
  v_after jsonb;
  v_now timestamptz := now();
  v_status text;
  v_provider text;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_anchor smallint;
  v_sync jsonb;
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

  SELECT * INTO v_sub
  FROM organization_subscriptions
  WHERE organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    IF p_status IS NULL THEN
      v_status := 'active';
    ELSE
      v_status := p_status;
    END IF;
    v_provider := COALESCE(p_provider, 'manual');
    v_period_start := COALESCE(p_period_start, v_now);
    v_anchor := extract(day FROM (v_period_start AT TIME ZONE 'UTC'))::smallint;
    IF p_extend_one_month AND p_period_end IS NULL THEN
      v_period_end := add_calendar_month(v_period_start, v_anchor);
    ELSE
      v_period_end := COALESCE(p_period_end, add_calendar_month(v_period_start, v_anchor));
    END IF;
  ELSE
    v_status := COALESCE(p_status, v_sub.status);
    v_provider := COALESCE(p_provider, v_sub.provider);
    v_period_start := COALESCE(p_period_start, v_sub.current_period_start);
    v_period_end := COALESCE(p_period_end, v_sub.current_period_end);
    v_anchor := COALESCE(
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
      v_period_end := add_calendar_month(v_period_end, COALESCE(v_anchor, 1));
    END IF;
  END IF;

  IF v_status = 'active' AND v_provider = 'manual' THEN
    IF v_period_start IS NULL OR v_period_end IS NULL OR v_period_end <= v_period_start THEN
      RAISE EXCEPTION 'manual_active_requires_period' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF FOUND THEN
    v_before := jsonb_build_object(
      'status', v_sub.status,
      'provider', v_sub.provider,
      'current_period_start', v_sub.current_period_start,
      'current_period_end', v_sub.current_period_end
    );
  ELSE
    v_before := jsonb_build_object(
      'status', NULL,
      'provider', NULL,
      'current_period_start', NULL,
      'current_period_end', NULL
    );
  END IF;

  v_sync := sync_organization_subscription(
    p_organization_id,
    CASE WHEN FOUND THEN COALESCE(v_sub.plan, 'standard') ELSE 'standard' END,
    CASE WHEN FOUND THEN COALESCE(v_sub.billing_period, 'monthly') ELSE 'monthly' END,
    v_status,
    v_provider,
    CASE WHEN FOUND THEN v_sub.provider_customer_id ELSE NULL END,
    CASE WHEN FOUND THEN v_sub.provider_subscription_id ELSE NULL END,
    v_period_start,
    v_period_end,
    NULL,
    'dev_console.manual_adjust'
  );

  IF v_provider = 'manual' AND v_period_start IS NOT NULL THEN
    UPDATE organization_subscriptions
    SET billing_anchor_day = COALESCE(
      billing_anchor_day,
      extract(day FROM (v_period_start AT TIME ZONE 'UTC'))::smallint
    )
    WHERE organization_id = p_organization_id;
  END IF;

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
    'sync', v_sync,
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

COMMIT;
