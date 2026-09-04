-- FZ / 2.9.62: restore FA1 surcharge debt assignment regressed in FDB2; drop ambiguous 4-arg _renter_mark_terminal overload.

BEGIN;

DROP FUNCTION IF EXISTS _renter_mark_terminal(uuid, text, text, uuid);
DROP FUNCTION IF EXISTS _renter_credit_wallet_topup(uuid, uuid, numeric, text, uuid, uuid, text);

CREATE OR REPLACE FUNCTION _renter_early_close_pack(p_series_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_series rental_series%ROWTYPE;
  v_now timestamptz := now();
  v_slot record;
  v_one_time numeric;
  v_penalty numeric;
  v_rate numeric;
  v_minutes integer;
  v_hours numeric;
  v_currency text;
  v_recalc numeric;
  v_already numeric;
  v_delta numeric;
  v_spendable numeric;
  v_take numeric;
  v_has_terminal boolean;
  v_has_future boolean;
BEGIN
  IF p_series_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_series FROM rental_series WHERE id = p_series_id FOR UPDATE;
  IF NOT FOUND
     OR v_series.channel <> 'miniapp'
     OR v_series.status NOT IN ('active', 'awaiting_payment') THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM rentals r
    WHERE r.rental_series_id = p_series_id
      AND r.channel = 'miniapp'
      AND r.lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged')
      AND _renter_slot_ts(r.organization_id, r.rental_date, r.time_start) > v_now
  ) INTO v_has_future;

  IF v_has_future THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM rentals r
    WHERE r.rental_series_id = p_series_id
      AND r.channel = 'miniapp'
      AND r.lifecycle IN ('cancelled', 'hold_deleted', 'auto_deleted')
  ) INTO v_has_terminal;

  IF NOT v_has_terminal THEN
    PERFORM _renter_try_complete_pack(p_series_id);
    RETURN;
  END IF;

  IF v_series.status = 'awaiting_payment' THEN
    UPDATE rental_series
    SET status = 'cancelled', hold_expires_at = NULL, updated_at = now()
    WHERE id = p_series_id;
    RETURN;
  END IF;

  v_currency := _renter_org_currency(v_series.organization_id);

  FOR v_slot IN
    SELECT r.*
    FROM rentals r
    WHERE r.rental_series_id = p_series_id
      AND r.channel = 'miniapp'
      AND _renter_slot_ts(r.organization_id, r.rental_date, r.time_end) <= v_now
      AND r.lifecycle IN ('settled', 'debt', 'prepaid_charged', 'active')
    ORDER BY r.rental_date, r.time_start
  LOOP
    v_one_time := _renter_hour_rate(
      v_series.organization_id, v_series.location_id, 'one_time', v_slot.rental_date
    );
    v_penalty := _renter_hour_rate(
      v_series.organization_id, v_series.location_id, 'penalty', v_slot.rental_date
    );
    IF EXISTS (
      SELECT 1 FROM renters x
      WHERE x.id = v_series.renter_id AND x.penalty_tariff_applied_at IS NOT NULL
    ) THEN
      v_rate := GREATEST(COALESCE(v_one_time, 0), COALESCE(v_penalty, 0));
    ELSE
      v_rate := COALESCE(v_one_time, 0);
    END IF;

    v_minutes := _hhmm_to_minutes(v_slot.time_end) - _hhmm_to_minutes(v_slot.time_start);
    v_hours := v_minutes::numeric / 60;
    v_recalc := _renter_round_money(v_hours * v_rate, v_currency);
    v_already := COALESCE(v_slot.prepay_amount, 0)
      * CASE WHEN v_slot.prepay_charged_at IS NOT NULL THEN 1 ELSE 0 END
      + COALESCE(v_slot.remainder_amount, 0)
      * CASE WHEN v_slot.remainder_charged_at IS NOT NULL THEN 1 ELSE 0 END;
    v_delta := GREATEST(0, v_recalc - v_already);
    IF v_delta <= 0 THEN
      CONTINUE;
    END IF;

    v_spendable := _renter_wallet_spendable(v_series.organization_id, v_series.renter_id);
    v_take := LEAST(v_spendable, v_delta);

    IF v_take > 0 THEN
      PERFORM _renter_wallet_insert_entry(
        v_series.organization_id,
        v_series.renter_id,
        'surcharge_one_time_recalc',
        v_take,
        v_slot.id,
        'surcharge'
      );
    END IF;

    IF v_delta - v_take > 0 THEN
      UPDATE rentals
      SET
        debt_amount = (v_delta - v_take),
        lifecycle = CASE
          WHEN lifecycle IN ('settled', 'prepaid_charged', 'active') THEN 'debt'
          ELSE lifecycle
        END,
        updated_at = now()
      WHERE id = v_slot.id;
    END IF;
  END LOOP;

  UPDATE rental_series
  SET status = 'cancelled', hold_expires_at = NULL, updated_at = now()
  WHERE id = p_series_id
    AND status IN ('active', 'awaiting_payment');
END;
$$;

COMMENT ON FUNCTION _renter_early_close_pack(uuid) IS
  'R1c/FDB2/FZ: early close; FA1 assigns surcharge debt (not +=); awaiting_payment pack → cancelled without surcharge.';

COMMIT;
