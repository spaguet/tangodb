-- FB4 / P1-06, P1-07: hold cooldown only same calendar date; pack cancel guards + read-model flags.

-- =============================================================================
-- 1. Inherited hold expiry — same date + location only
-- =============================================================================

DROP FUNCTION IF EXISTS _renter_inherited_hold_expires_at(uuid, uuid, uuid, text, text);

CREATE OR REPLACE FUNCTION _renter_inherited_hold_expires_at(
  p_org_id uuid,
  p_renter_id uuid,
  p_location_id uuid,
  p_date date,
  p_time_start text,
  p_time_end text
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_exp timestamptz;
  v_now timestamptz := now();
BEGIN
  SELECT MAX(x.exp)
  INTO v_exp
  FROM (
    SELECT r.hold_expires_at AS exp
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.location_id = p_location_id
      AND r.rental_date = p_date
      AND r.channel = 'miniapp'
      AND r.lifecycle = 'hold_deleted'
      AND r.hold_expires_at IS NOT NULL
      AND schedule_time_ranges_overlap(r.time_start, r.time_end, p_time_start, p_time_end)
    UNION ALL
    SELECT _renter_slot_ts(r.organization_id, r.rental_date, r.time_start)
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.location_id = p_location_id
      AND r.rental_date = p_date
      AND r.channel = 'miniapp'
      AND r.lifecycle = 'cancelled'
      AND r.cancelled_reason IN ('miniapp_cancel_refund', 'miniapp_cancel')
      AND schedule_time_ranges_overlap(r.time_start, r.time_end, p_time_start, p_time_end)
  ) x
  WHERE x.exp IS NOT NULL
    AND x.exp > v_now;

  RETURN v_exp;
END;
$$;

COMMENT ON FUNCTION _renter_inherited_hold_expires_at(uuid, uuid, uuid, date, text, text) IS
  'FB4/P1-06: inherit hold/cooldown only on same calendar date and location.';

-- =============================================================================
-- 2. Cancel eligibility helpers (read model + renter_cancel_pack guard)
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_can_delete_hold_row(
  p_r rentals,
  p_is_renter boolean
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_r.channel IS DISTINCT FROM 'miniapp' THEN
    RETURN false;
  END IF;
  IF p_r.lifecycle IS DISTINCT FROM 'awaiting_payment' OR p_r.prepay_charged_at IS NOT NULL THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_can_cancel_occurrence_row(
  p_r rentals,
  p_is_renter boolean
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  IF p_r.channel IS DISTINCT FROM 'miniapp' THEN
    RETURN false;
  END IF;
  IF p_r.lifecycle NOT IN ('active', 'prepaid_charged') THEN
    RETURN false;
  END IF;

  v_start := _renter_slot_ts(p_r.organization_id, p_r.rental_date, p_r.time_start);
  v_end := _renter_slot_ts(p_r.organization_id, p_r.rental_date, p_r.time_end);
  IF v_now >= v_end THEN
    RETURN false;
  END IF;
  IF p_is_renter AND v_now >= v_start THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_series_has_cancellable_pack_slots(
  p_series_id uuid,
  p_is_renter boolean
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_series rental_series%ROWTYPE;
  v_now timestamptz := now();
  v_slot record;
  v_start timestamptz;
BEGIN
  IF p_series_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_series FROM rental_series WHERE id = p_series_id;
  IF NOT FOUND OR v_series.channel IS DISTINCT FROM 'miniapp' OR v_series.status IS DISTINCT FROM 'active' THEN
    RETURN false;
  END IF;

  FOR v_slot IN
    SELECT r.organization_id, r.rental_date, r.time_start, r.lifecycle
    FROM rentals r
    WHERE r.rental_series_id = p_series_id
      AND r.channel = 'miniapp'
      AND r.lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged')
  LOOP
    v_start := _renter_slot_ts(v_slot.organization_id, v_slot.rental_date, v_slot.time_start);
    IF p_is_renter AND v_now >= v_start THEN
      CONTINUE;
    END IF;
    RETURN true;
  END LOOP;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_can_cancel_pack_row(
  p_r rentals,
  p_is_renter boolean
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_anchor uuid;
BEGIN
  IF p_r.rental_series_id IS NULL THEN
    RETURN false;
  END IF;
  IF _renter_can_delete_hold_row(p_r, p_is_renter) THEN
    RETURN false;
  END IF;
  IF NOT _renter_series_has_cancellable_pack_slots(p_r.rental_series_id, p_is_renter) THEN
    RETURN false;
  END IF;

  SELECT r.id
  INTO v_anchor
  FROM rentals r
  WHERE r.rental_series_id = p_r.rental_series_id
    AND r.channel = 'miniapp'
  ORDER BY r.rental_date, r.time_start, r.created_at, r.id
  LIMIT 1;

  RETURN p_r.id = v_anchor;
END;
$$;

-- =============================================================================
-- 3. _renter_insert_occurrence — pass rental_date to inherited expiry
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_insert_occurrence(
  p_org_id uuid,
  p_renter_id uuid,
  p_location_id uuid,
  p_date date,
  p_time_start text,
  p_time_end text,
  p_kind text,
  p_series_id uuid,
  p_idempotency_key text,
  p_created_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_quote jsonb;
  v_kind text;
  v_start_ts timestamptz;
  v_now timestamptz := now();
  v_created timestamptz := now();
  v_hold timestamptz;
  v_inherited timestamptz;
  v_id uuid;
  v_currency text;
BEGIN
  PERFORM _renter_validate_slot_grid(p_time_start, p_time_end);

  v_start_ts := _renter_slot_ts(p_org_id, p_date, p_time_start);
  IF v_start_ts < v_now + interval '1 hour' THEN
    PERFORM _renter_raise('renter.booking.tooSoon');
  END IF;

  IF NOT _renter_location_channel_ok(p_org_id, p_location_id, p_date) THEN
    PERFORM _renter_raise('renter.booking.locationUnavailable');
  END IF;

  IF _renter_location_slot_busy(p_org_id, p_date, p_time_start, p_time_end, p_location_id) THEN
    PERFORM _renter_raise('renter.booking.conflict');
  END IF;

  v_kind := _renter_effective_kind(p_org_id, p_renter_id, p_kind);
  v_quote := _renter_quote_slot_amounts(
    p_org_id, p_location_id, v_kind, p_date, p_time_start, p_time_end
  );
  v_currency := v_quote ->> 'currency';
  v_inherited := _renter_inherited_hold_expires_at(
    p_org_id, p_renter_id, p_location_id, p_date, p_time_start, p_time_end
  );
  v_hold := COALESCE(
    v_inherited,
    _renter_compute_hold_expires_at(v_created, v_start_ts)
  );

  INSERT INTO rentals (
    organization_id,
    location_id,
    rental_date,
    time_start,
    time_end,
    renter_id,
    rental_series_id,
    booking_status,
    channel,
    lifecycle,
    hold_expires_at,
    prepay_amount,
    remainder_amount,
    debt_amount,
    fixed_amount,
    calculated_amount,
    final_amount,
    currency,
    tariff_id,
    tariff_type,
    tariff_snapshot,
    idempotency_key,
    created_by,
    created_at
  )
  VALUES (
    p_org_id,
    p_location_id,
    p_date,
    normalize_hhmm(p_time_start),
    normalize_hhmm(p_time_end),
    p_renter_id,
    p_series_id,
    'confirmed',
    'miniapp',
    'awaiting_payment',
    v_hold,
    (v_quote ->> 'prepay')::numeric,
    (v_quote ->> 'remainder')::numeric,
    0,
    (v_quote ->> 'cost')::numeric,
    (v_quote ->> 'cost')::numeric,
    NULL,
    v_currency,
    NULLIF(v_quote ->> 'tariff_id', '')::uuid,
    v_quote ->> 'tariff_type',
    v_quote -> 'tariff_snapshot',
    p_idempotency_key,
    p_created_by,
    v_created
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- =============================================================================
-- 4. Public rental JSON — server cancel flags
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_public_rental_json(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_r rentals%ROWTYPE;
  v_ctx record;
  v_is_renter boolean := true;
  v_can_delete_hold boolean;
  v_can_cancel_occ boolean;
  v_can_cancel_pack boolean;
BEGIN
  SELECT * INTO v_r FROM rentals WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  BEGIN
    SELECT * INTO v_ctx FROM _renter_actor_ctx();
    v_is_renter := v_ctx.is_renter;
  EXCEPTION
    WHEN OTHERS THEN
      v_is_renter := true;
  END;

  v_can_delete_hold := _renter_can_delete_hold_row(v_r, v_is_renter);
  v_can_cancel_occ := _renter_can_cancel_occurrence_row(v_r, v_is_renter);
  v_can_cancel_pack := _renter_can_cancel_pack_row(v_r, v_is_renter);

  RETURN jsonb_build_object(
    'id', v_r.id,
    'rental_series_id', v_r.rental_series_id,
    'location_id', v_r.location_id,
    'rental_date', v_r.rental_date,
    'time_start', v_r.time_start,
    'time_end', v_r.time_end,
    'channel', v_r.channel,
    'lifecycle', v_r.lifecycle,
    'booking_status', v_r.booking_status,
    'hold_expires_at', v_r.hold_expires_at,
    'prepay_amount', v_r.prepay_amount,
    'remainder_amount', v_r.remainder_amount,
    'debt_amount', v_r.debt_amount,
    'fixed_amount', v_r.fixed_amount,
    'currency', v_r.currency,
    'prepay_charged_at', v_r.prepay_charged_at,
    'remainder_charged_at', v_r.remainder_charged_at,
    'can_delete_hold', v_can_delete_hold,
    'can_cancel_occurrence', v_can_cancel_occ,
    'can_cancel_pack', v_can_cancel_pack
  );
END;
$$;

COMMENT ON FUNCTION _renter_public_rental_json(uuid) IS
  'FB4: miniapp rental read model with server-side cancel eligibility flags.';

-- =============================================================================
-- 5. renter_cancel_pack — reject completed/cancelled / empty batch
-- =============================================================================

CREATE OR REPLACE FUNCTION renter_cancel_pack(p_series_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ctx record;
  v_s rental_series%ROWTYPE;
  v_slot record;
  v_now timestamptz := now();
  v_start timestamptz;
  v_extra jsonb := '[]'::jsonb;
  v_reasons jsonb := '[]'::jsonb;
  v_reason text;
BEGIN
  SELECT * INTO v_ctx FROM _renter_actor_ctx();

  SELECT * INTO v_s FROM rental_series WHERE id = p_series_id;
  IF NOT FOUND OR v_s.organization_id IS DISTINCT FROM v_ctx.org_id OR v_s.channel <> 'miniapp' THEN
    PERFORM _renter_raise('renter.forbidden');
  END IF;
  IF v_ctx.is_renter AND v_s.renter_id IS DISTINCT FROM v_ctx.jwt_renter_id THEN
    PERFORM _renter_raise('renter.forbidden');
  END IF;
  IF v_s.status IS DISTINCT FROM 'active' THEN
    PERFORM _renter_raise('renter.cancel.packNotCancellable');
  END IF;
  IF NOT _renter_series_has_cancellable_pack_slots(p_series_id, v_ctx.is_renter) THEN
    PERFORM _renter_raise('renter.cancel.packNotCancellable');
  END IF;

  FOR v_slot IN
    SELECT r.id, r.location_id, r.rental_date, r.lifecycle
    FROM rentals r
    WHERE r.rental_series_id = p_series_id
      AND r.channel = 'miniapp'
  LOOP
    v_extra := v_extra || jsonb_build_array(
      jsonb_build_object('location_id', v_slot.location_id, 'date', v_slot.rental_date)
    );
  END LOOP;

  PERFORM _renter_acquire_miniapp_locks(v_ctx.org_id, v_s.renter_id, v_extra);

  FOR v_slot IN
    SELECT r.id, r.rental_date, r.time_start, r.lifecycle, r.organization_id
    FROM rentals r
    WHERE r.rental_series_id = p_series_id
      AND r.channel = 'miniapp'
      AND r.lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged')
  LOOP
    v_start := _renter_slot_ts(v_slot.organization_id, v_slot.rental_date, v_slot.time_start);
    IF v_ctx.is_renter AND v_now >= v_start THEN
      CONTINUE;
    END IF;
    IF v_slot.lifecycle = 'awaiting_payment' THEN
      PERFORM _renter_delete_hold_slot(v_slot.id, v_ctx.member_id, true);
      v_reason := 'hold_deleted';
    ELSE
      v_reason := _renter_cancel_one_slot(v_slot.id, v_ctx.is_renter, v_ctx.member_id, true);
    END IF;
    v_reasons := v_reasons || jsonb_build_array(
      jsonb_build_object('rental_id', v_slot.id, 'reason', v_reason)
    );
  END LOOP;

  IF jsonb_array_length(v_reasons) = 0 THEN
    PERFORM _renter_raise('renter.cancel.packNotCancellable');
  END IF;

  PERFORM _renter_apply_wallet(v_ctx.org_id, v_s.renter_id);
  PERFORM _renter_after_pack_slot_terminal(p_series_id);

  RETURN jsonb_build_object(
    'success', true,
    'series_id', p_series_id,
    'cancelled', v_reasons
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

COMMENT ON FUNCTION renter_cancel_pack(uuid) IS
  'FA4/FB4: batch cancel pack; FB4 rejects completed/cancelled series and empty cancelled.';

-- =============================================================================
-- 6. Schedule week read model — staff cancel flags
-- =============================================================================

CREATE OR REPLACE FUNCTION get_rentals_for_schedule_week(
  p_week_start date,
  p_week_end date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_sensitive boolean;
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF NOT can_read_operational() AND current_member_role() <> 'teacher' THEN
    RETURN '[]'::jsonb;
  END IF;

  v_sensitive := member_can_see_rental_sensitive();

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.rental_date, x.time_start), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      r.id AS rental_id,
      r.rental_date,
      r.time_start,
      r.time_end,
      r.location_id,
      r.rental_series_id,
      r.booking_status,
      r.channel,
      r.lifecycle,
      CASE WHEN v_sensitive THEN r.purpose ELSE NULL END AS purpose,
      CASE WHEN v_sensitive THEN ren.display_name ELSE NULL END AS renter_name,
      CASE WHEN v_sensitive THEN _rental_effective_amount(r.fixed_amount, r.final_amount) ELSE NULL END AS fixed_amount,
      CASE WHEN v_sensitive THEN r.currency ELSE NULL END AS currency,
      CASE
        WHEN NOT v_sensitive THEN NULL
        WHEN r.channel = 'miniapp' THEN NULL
        ELSE _rental_paid_total(r.id, r.organization_id)
      END AS paid_amount,
      CASE
        WHEN NOT v_sensitive THEN NULL
        WHEN r.channel = 'miniapp' THEN NULL
        ELSE _rental_payment_status(
          _rental_effective_amount(r.fixed_amount, r.final_amount),
          _rental_paid_total(r.id, r.organization_id)
        )
      END AS payment_status,
      CASE
        WHEN r.channel = 'miniapp' THEN _renter_can_delete_hold_row(r, false)
        ELSE false
      END AS can_delete_hold,
      CASE
        WHEN r.channel = 'miniapp' THEN _renter_can_cancel_occurrence_row(r, false)
        ELSE false
      END AS can_cancel_occurrence,
      CASE
        WHEN r.channel = 'miniapp' THEN _renter_can_cancel_pack_row(r, false)
        ELSE false
      END AS can_cancel_pack
    FROM rentals r
    JOIN renters ren ON ren.id = r.renter_id AND ren.organization_id = r.organization_id
    WHERE r.organization_id = v_org_id
      AND r.rental_date >= p_week_start
      AND r.rental_date <= p_week_end
      AND teacher_can_view_schedule_location(r.location_id)
  ) x;

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION _renter_inherited_hold_expires_at(uuid, uuid, uuid, date, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_can_delete_hold_row(rentals, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_can_cancel_occurrence_row(rentals, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_series_has_cancellable_pack_slots(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_can_cancel_pack_row(rentals, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION _renter_inherited_hold_expires_at(uuid, uuid, uuid, date, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_can_delete_hold_row(rentals, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_can_cancel_occurrence_row(rentals, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_series_has_cancellable_pack_slots(uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_can_cancel_pack_row(rentals, boolean) TO service_role;
