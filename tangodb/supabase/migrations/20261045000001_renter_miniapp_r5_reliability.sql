-- R5 / 2.9.10: reliability 50/75, penalty tariff, booking ban, reset RPC.
-- Replaces _renter_apply_reliability stub only; does not rewrite worker/outbox bodies.

BEGIN;

-- =============================================================================
-- 1. Idempotency ledger for on_time++/untimely++
-- =============================================================================

CREATE TABLE IF NOT EXISTS renter_reliability_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  renter_id       uuid NOT NULL,
  rental_id       uuid NOT NULL,
  phase           text NOT NULL CHECK (phase IN ('on_time', 'untimely')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rental_id, phase),
  FOREIGN KEY (organization_id, renter_id)
    REFERENCES renters (organization_id, id),
  FOREIGN KEY (organization_id, rental_id)
    REFERENCES rentals (organization_id, id)
);

CREATE INDEX IF NOT EXISTS idx_renter_reliability_events_renter
  ON renter_reliability_events (organization_id, renter_id, created_at DESC);

COMMENT ON TABLE renter_reliability_events IS
  'R5: one row per rental terminal reliability outcome (on_time | untimely). Worker retries do not double-count.';

ALTER TABLE renter_reliability_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE renter_reliability_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE renter_reliability_events TO service_role;

-- =============================================================================
-- 2. Penalty rate availability helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_org_penalty_rate_gap(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM locations loc
    WHERE loc.organization_id = p_org_id
      AND loc.miniapp_enabled
      AND NOT _renter_location_has_three_kinds(
        p_org_id, loc.id, _org_local_date(p_org_id)
      )
  );
$$;

COMMENT ON FUNCTION _renter_org_penalty_rate_gap(uuid) IS
  'R5 CRM banner: any miniapp_enabled hall missing penalty (or other) rate for today.';

CREATE OR REPLACE FUNCTION _renter_renter_penalty_rates_ok(p_org_id uuid, p_renter_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.prepay_charged_at IS NULL
      AND r.lifecycle IN ('awaiting_payment', 'active')
      AND _renter_hour_rate(p_org_id, r.location_id, 'penalty', r.rental_date) IS NULL
  );
$$;

COMMENT ON FUNCTION _renter_renter_penalty_rates_ok(uuid, uuid) IS
  'R5: every uncharged slot location has an active penalty rate on its rental date.';

-- =============================================================================
-- 3. Penalty snapshot bounce (§4.3)
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_bounce_penalty_snapshots(p_org_id uuid, p_renter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slot record;
  v_quote jsonb;
  v_was_active boolean;
  v_hold timestamptz;
BEGIN
  FOR v_slot IN
    SELECT r.*
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.prepay_charged_at IS NULL
      AND r.lifecycle IN ('awaiting_payment', 'active')
    ORDER BY r.rental_date, r.time_start, r.created_at
  LOOP
    IF _renter_hour_rate(p_org_id, v_slot.location_id, 'penalty', v_slot.rental_date) IS NULL THEN
      CONTINUE;
    END IF;

    v_quote := _renter_quote_slot_amounts(
      p_org_id,
      v_slot.location_id,
      'penalty',
      v_slot.rental_date,
      v_slot.time_start,
      v_slot.time_end
    );

    v_was_active := v_slot.lifecycle = 'active';
    v_hold := v_slot.hold_expires_at;

    IF v_was_active THEN
      UPDATE rentals
      SET
        lifecycle = 'awaiting_payment',
        prepay_amount = (v_quote ->> 'prepay')::numeric,
        remainder_amount = (v_quote ->> 'remainder')::numeric,
        fixed_amount = (v_quote ->> 'cost')::numeric,
        calculated_amount = (v_quote ->> 'cost')::numeric,
        hold_expires_at = v_hold,
        updated_at = now()
      WHERE id = v_slot.id
        AND lifecycle = 'active'
        AND prepay_charged_at IS NULL;

      IF FOUND THEN
        PERFORM _renter_enqueue_penalty_prepay_bounce(v_slot.id);
      END IF;
    ELSE
      UPDATE rentals
      SET
        prepay_amount = (v_quote ->> 'prepay')::numeric,
        remainder_amount = (v_quote ->> 'remainder')::numeric,
        fixed_amount = (v_quote ->> 'cost')::numeric,
        calculated_amount = (v_quote ->> 'cost')::numeric,
        updated_at = now()
      WHERE id = v_slot.id
        AND lifecycle = 'awaiting_payment'
        AND prepay_charged_at IS NULL;
    END IF;
  END LOOP;

  PERFORM _renter_apply_wallet(p_org_id, p_renter_id);
END;
$$;

COMMENT ON FUNCTION _renter_bounce_penalty_snapshots(uuid, uuid) IS
  'R5: recalc uncharged slots to penalty rate; active→awaiting keeps hold_expires_at; awaiting keeps timer.';

-- =============================================================================
-- 4. Threshold actions
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_try_apply_penalty_tariff(p_org_id uuid, p_renter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r renters%ROWTYPE;
  v_first boolean;
BEGIN
  SELECT * INTO v_r
  FROM renters
  WHERE id = p_renter_id
    AND organization_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_first := v_r.penalty_tariff_applied_at IS NULL;

  IF NOT _renter_renter_penalty_rates_ok(p_org_id, p_renter_id) THEN
  -- CRM banner; worker continues other renters.
    RETURN;
  END IF;

  IF v_first THEN
    UPDATE renters
    SET penalty_tariff_applied_at = now(), updated_at = now()
    WHERE id = p_renter_id
      AND organization_id = p_org_id
      AND penalty_tariff_applied_at IS NULL;
    PERFORM _renter_enqueue_penalty_tariff(p_org_id, p_renter_id);
  END IF;

  PERFORM _renter_bounce_penalty_snapshots(p_org_id, p_renter_id);
END;
$$;

CREATE OR REPLACE FUNCTION _renter_cancel_future_miniapp_for_ban(p_org_id uuid, p_renter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slot record;
  v_now timestamptz := now();
  v_start timestamptz;
  v_series_ids uuid[] := '{}';
BEGIN
  FOR v_slot IN
    SELECT r.*
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged')
    ORDER BY r.rental_date, r.time_start, r.created_at
  LOOP
    v_start := _renter_slot_ts(p_org_id, v_slot.rental_date, v_slot.time_start);
    IF v_start <= v_now THEN
      CONTINUE;
    END IF;

    IF v_slot.lifecycle = 'awaiting_payment' AND v_slot.prepay_charged_at IS NULL THEN
      PERFORM _renter_delete_hold_slot(v_slot.id, NULL);
    ELSE
      PERFORM _renter_cancel_one_slot(v_slot.id, false, NULL);
    END IF;

    IF v_slot.rental_series_id IS NOT NULL THEN
      v_series_ids := array_append(v_series_ids, v_slot.rental_series_id);
    END IF;
  END LOOP;

  IF v_series_ids <> '{}' THEN
    PERFORM _renter_after_pack_slot_terminal(sid)
    FROM (SELECT DISTINCT unnest(v_series_ids) AS sid) s;
  END IF;
END;
$$;

COMMENT ON FUNCTION _renter_cancel_future_miniapp_for_ban(uuid, uuid) IS
  'R5 ban: cancel future miniapp slots via R1c helpers; early-close packs after futures removed.';

CREATE OR REPLACE FUNCTION _renter_apply_booking_ban(p_org_id uuid, p_renter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r renters%ROWTYPE;
  v_first boolean;
BEGIN
  SELECT * INTO v_r
  FROM renters
  WHERE id = p_renter_id
    AND organization_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_first := v_r.booking_banned_at IS NULL;

  IF v_first THEN
    UPDATE renters
    SET booking_banned_at = now(), updated_at = now()
    WHERE id = p_renter_id
      AND organization_id = p_org_id;

    IF v_r.auth_user_id IS NOT NULL THEN
      PERFORM revoke_auth_sessions_for_user(v_r.auth_user_id);
    END IF;
  END IF;

  -- Apply penalty while future slots still exist (rate check needs live locations).
  PERFORM _renter_try_apply_penalty_tariff(p_org_id, p_renter_id);

  IF v_first THEN
    PERFORM _renter_cancel_future_miniapp_for_ban(p_org_id, p_renter_id);
    PERFORM _renter_enqueue_booking_banned(p_org_id, p_renter_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_evaluate_reliability_thresholds(p_org_id uuid, p_renter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r renters%ROWTYPE;
  v_completed integer;
  v_ratio numeric;
BEGIN
  SELECT * INTO v_r
  FROM renters
  WHERE id = p_renter_id
    AND organization_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_completed := v_r.on_time_count + v_r.untimely_count;
  IF v_completed < 4 THEN
    RETURN;
  END IF;

  v_ratio := v_r.untimely_count::numeric / v_completed;

  IF v_ratio >= 0.75 THEN
    PERFORM _renter_apply_booking_ban(p_org_id, p_renter_id);
  ELSIF v_ratio >= 0.50 THEN
    PERFORM _renter_try_apply_penalty_tariff(p_org_id, p_renter_id);
  END IF;
END;
$$;

-- =============================================================================
-- 5. Replace reliability stub (same signature as R1d)
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_apply_reliability(
  p_rental_id uuid,
  p_phase text,
  p_allowed boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r rentals%ROWTYPE;
  v_inserted boolean := false;
BEGIN
  IF p_phase NOT IN ('on_time', 'untimely') THEN
    RETURN;
  END IF;

  IF p_phase = 'untimely' AND NOT COALESCE(p_allowed, false) THEN
    RETURN;
  END IF;

  SELECT * INTO v_r FROM rentals WHERE id = p_rental_id;
  IF NOT FOUND OR v_r.channel <> 'miniapp' OR v_r.renter_id IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    INSERT INTO renter_reliability_events (
      organization_id, renter_id, rental_id, phase
    )
    VALUES (
      v_r.organization_id, v_r.renter_id, p_rental_id, p_phase
    );
    v_inserted := true;
  EXCEPTION WHEN unique_violation THEN
    RETURN;
  END;

  IF NOT v_inserted THEN
    RETURN;
  END IF;

  IF p_phase = 'on_time' THEN
    UPDATE renters
    SET on_time_count = on_time_count + 1, updated_at = now()
    WHERE id = v_r.renter_id
      AND organization_id = v_r.organization_id;
  ELSE
    UPDATE renters
    SET untimely_count = untimely_count + 1, updated_at = now()
    WHERE id = v_r.renter_id
      AND organization_id = v_r.organization_id;

    PERFORM _renter_evaluate_reliability_thresholds(v_r.organization_id, v_r.renter_id);
  END IF;
END;
$$;

COMMENT ON FUNCTION _renter_apply_reliability(uuid, text, boolean) IS
  'R5: idempotent on_time++/untimely++ with rental_id+phase key; untimely gated by p_allowed.';

-- =============================================================================
-- 6. on_time++ at prepaid_charged → settled|debt terminal transition
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_charge_remainder(p_rental_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r rentals%ROWTYPE;
  v_spendable numeric;
  v_was_debt boolean;
  v_terminal boolean := false;
BEGIN
  SELECT * INTO v_r FROM rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND OR v_r.channel <> 'miniapp' THEN
    RETURN false;
  END IF;

  IF v_r.remainder_charged_at IS NOT NULL THEN
    RETURN true;
  END IF;

  IF v_r.prepay_charged_at IS NULL THEN
    RETURN false;
  END IF;

  v_spendable := _renter_wallet_spendable(v_r.organization_id, v_r.renter_id);

  IF v_r.remainder_amount <= 0 THEN
    UPDATE rentals
    SET
      lifecycle = 'settled',
      remainder_charged_at = now(),
      updated_at = now()
    WHERE id = p_rental_id
      AND remainder_charged_at IS NULL;
    IF FOUND THEN
      v_terminal := true;
    END IF;
    IF v_terminal THEN
      PERFORM _renter_apply_reliability(p_rental_id, 'on_time', true);
    END IF;
    RETURN true;
  END IF;

  IF v_spendable < v_r.remainder_amount THEN
    v_was_debt := v_r.lifecycle = 'debt';
    UPDATE rentals
    SET
      lifecycle = 'debt',
      debt_amount = v_r.remainder_amount,
      updated_at = now()
    WHERE id = p_rental_id
      AND remainder_charged_at IS NULL
      AND lifecycle IS DISTINCT FROM 'debt';
    IF FOUND AND NOT v_was_debt THEN
      PERFORM _renter_enqueue_debt_accrued(p_rental_id, v_r.remainder_amount);
      PERFORM _renter_apply_reliability(p_rental_id, 'on_time', true);
    END IF;
    RETURN false;
  END IF;

  PERFORM _renter_wallet_insert_entry(
    v_r.organization_id,
    v_r.renter_id,
    'remainder_charge',
    v_r.remainder_amount,
    v_r.id,
    'remainder'
  );

  UPDATE rentals
  SET
    lifecycle = 'settled',
    remainder_charged_at = now(),
    debt_amount = 0,
    updated_at = now()
  WHERE id = p_rental_id
    AND remainder_charged_at IS NULL;

  IF FOUND THEN
    PERFORM _renter_apply_reliability(p_rental_id, 'on_time', true);
  END IF;

  PERFORM _renter_assert_wallet_invariant(v_r.organization_id, v_r.renter_id);
  RETURN true;
END;
$$;

-- =============================================================================
-- 7. Staff reset RPC
-- =============================================================================

CREATE OR REPLACE FUNCTION reset_renter_reliability(p_renter_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid := auth_organization_id();
  v_r renters%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;

  IF NOT can_manage_settings() OR NOT organization_allows_writes(v_org) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  SELECT * INTO v_r
  FROM renters
  WHERE id = p_renter_id
    AND organization_id = v_org;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.notFound');
  END IF;

  PERFORM _renter_acquire_miniapp_locks(v_org, p_renter_id, '[]'::jsonb);

  UPDATE renters
  SET
    booking_banned_at = NULL,
    penalty_tariff_applied_at = NULL,
    on_time_count = 0,
    untimely_count = 0,
    updated_at = now()
  WHERE id = p_renter_id
    AND organization_id = v_org;

  PERFORM _renter_enqueue_ban_lifted(v_org, p_renter_id);

  RETURN jsonb_build_object('success', true, 'renter_id', p_renter_id);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- =============================================================================
-- 8. CRM read-model: penalty gap flag on hour rates list
-- =============================================================================

CREATE OR REPLACE FUNCTION list_location_rental_hour_rates()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_show_prices boolean;
  v_can_write boolean;
  v_rows jsonb;
  v_penalty_gap boolean;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT (member_can_manage_rentals() OR can_read_financial()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
  END IF;

  v_show_prices := member_can_see_rental_tariff_prices();
  v_can_write := can_manage_settings() AND organization_allows_writes(v_org_id);
  v_penalty_gap := _renter_org_penalty_rate_gap(v_org_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'location_id', loc.id,
    'name', loc.name,
    'miniapp_enabled', loc.miniapp_enabled,
    'kinds_complete', _renter_location_has_three_kinds(v_org_id, loc.id, _org_local_date(v_org_id)),
    'rates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', cur.id,
        'kind', cur.kind,
        'price', CASE WHEN v_show_prices THEN cur.price ELSE NULL END,
        'currency', CASE WHEN v_show_prices THEN cur.currency ELSE NULL END,
        'valid_from', cur.valid_from
      ) ORDER BY cur.kind)
      FROM (
        SELECT DISTINCT ON (hr.kind)
          hr.id, hr.kind, hr.price, hr.currency, hr.valid_from
        FROM location_rental_hour_rates hr
        WHERE hr.organization_id = v_org_id
          AND hr.location_id = loc.id
          AND hr.valid_from <= _org_local_date(v_org_id)
        ORDER BY hr.kind, hr.valid_from DESC, hr.created_at DESC, hr.id DESC
      ) cur
    ), '[]'::jsonb)
  ) ORDER BY loc.name), '[]'::jsonb)
  INTO v_rows
  FROM locations loc
  WHERE loc.organization_id = v_org_id;

  RETURN jsonb_build_object(
    'success', true,
    'addon_active', renter_miniapp_addon_is_active(v_org_id),
    'can_write', v_can_write,
    'show_prices', v_show_prices,
    'penalty_rate_gap', v_penalty_gap,
    'locations', v_rows
  );
END;
$$;

-- =============================================================================
-- Grants
-- =============================================================================

REVOKE ALL ON FUNCTION _renter_org_penalty_rate_gap(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_renter_penalty_rates_ok(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_bounce_penalty_snapshots(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_try_apply_penalty_tariff(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_cancel_future_miniapp_for_ban(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_apply_booking_ban(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_evaluate_reliability_thresholds(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION reset_renter_reliability(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION reset_renter_reliability(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION _renter_org_penalty_rate_gap(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_renter_penalty_rates_ok(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_bounce_penalty_snapshots(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_try_apply_penalty_tariff(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_cancel_future_miniapp_for_ban(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_apply_booking_ban(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_evaluate_reliability_thresholds(uuid, uuid) TO service_role;

COMMIT;
