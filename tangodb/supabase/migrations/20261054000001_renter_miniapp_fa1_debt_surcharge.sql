-- FA1 / 2.9.35: P0-02 early-close surcharge without double-counting remainder debt;
-- P0-03 separate debt_charge_seq per obligation + phase amount mismatch guard.

BEGIN;

-- =============================================================================
-- 1. debt_charge_seq — immutable generation per rental debt occurrence
-- =============================================================================

ALTER TABLE rentals
  ADD COLUMN IF NOT EXISTS debt_charge_seq integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN rentals.debt_charge_seq IS
  'Mini App: increments when debt_amount rises from 0; debt_settle ledger phase = debt_settle:<seq>.';

CREATE OR REPLACE FUNCTION _renter_bump_debt_charge_seq()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(NEW.debt_amount, 0) > 0 THEN
    IF TG_OP = 'INSERT' AND COALESCE(NEW.debt_charge_seq, 0) = 0 THEN
      NEW.debt_charge_seq := 1;
    ELSIF TG_OP = 'UPDATE'
      AND COALESCE(OLD.debt_amount, 0) = 0
      AND COALESCE(NEW.debt_amount, 0) > 0 THEN
      NEW.debt_charge_seq := COALESCE(OLD.debt_charge_seq, 0) + 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_renter_bump_debt_charge_seq ON rentals;
CREATE TRIGGER trg_renter_bump_debt_charge_seq
  BEFORE INSERT OR UPDATE OF debt_amount ON rentals
  FOR EACH ROW
  EXECUTE FUNCTION _renter_bump_debt_charge_seq();

-- Backfill seq for existing miniapp debts (one obligation per slot).
UPDATE rentals r
SET debt_charge_seq = 1
WHERE r.channel = 'miniapp'
  AND COALESCE(r.debt_amount, 0) > 0
  AND COALESCE(r.debt_charge_seq, 0) = 0;

-- =============================================================================
-- 2. _renter_wallet_insert_entry — phase conflict must match amount
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_wallet_insert_entry(
  p_org_id uuid,
  p_renter_id uuid,
  p_entry_type text,
  p_amount numeric,
  p_rental_id uuid,
  p_phase text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_existing_amount numeric(12, 2);
  v_amount numeric(12, 2);
BEGIN
  IF COALESCE(p_amount, 0) <= 0 THEN
    RETURN NULL;
  END IF;

  v_amount := p_amount::numeric(12, 2);

  BEGIN
    INSERT INTO renter_wallet_ledger (
      organization_id, renter_id, entry_type, amount, rental_id, advance_id, phase
    )
    VALUES (
      p_org_id, p_renter_id, p_entry_type, v_amount, p_rental_id, NULL, p_phase
    )
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT l.id, l.amount
    INTO v_id, v_existing_amount
    FROM renter_wallet_ledger l
    WHERE l.rental_id = p_rental_id AND l.phase = p_phase;

    IF v_id IS NULL OR v_existing_amount IS DISTINCT FROM v_amount THEN
      RAISE EXCEPTION 'renter.wallet.phase_amount_mismatch'
        USING ERRCODE = 'unique_violation',
              DETAIL = format(
                'rental_id=%s phase=%s expected=%s existing=%s',
                p_rental_id, p_phase, v_amount, v_existing_amount
              );
    END IF;
  END;

  PERFORM _renter_assert_wallet_invariant(p_org_id, p_renter_id);
  RETURN v_id;
END;
$$;

-- =============================================================================
-- 3. _renter_early_close_pack — assign debt, do not += existing remainder debt
-- =============================================================================

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
  IF NOT FOUND OR v_series.channel <> 'miniapp' OR v_series.status <> 'active' THEN
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
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_series_id
    AND status = 'active';
END;
$$;

COMMENT ON FUNCTION _renter_early_close_pack(uuid) IS
  'R1c/FA1: no remaining future dates AND at least one cancelled/hold_deleted/auto_deleted → surcharge used, debt assigned (not +=), then series.cancelled.';

-- =============================================================================
-- 4. _renter_debt_settle — phase per debt_charge_seq; no zero debt without debit
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_debt_settle(p_org_id uuid, p_renter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slot record;
  v_spendable numeric;
  v_amount numeric;
  v_phase text;
  v_ledger_id uuid;
BEGIN
  LOOP
    v_spendable := _renter_wallet_spendable(p_org_id, p_renter_id);
    IF v_spendable <= 0 THEN
      EXIT;
    END IF;

    SELECT r.id, r.debt_amount, r.debt_charge_seq
    INTO v_slot
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.debt_amount > 0
    ORDER BY
      _renter_slot_ts(r.organization_id, r.rental_date, r.time_end),
      r.created_at
    LIMIT 1;

    EXIT WHEN v_slot.id IS NULL;
    EXIT WHEN v_spendable < v_slot.debt_amount;

    v_amount := v_slot.debt_amount;
    v_phase := 'debt_settle:' || COALESCE(v_slot.debt_charge_seq, 1);

    v_ledger_id := _renter_wallet_insert_entry(
      p_org_id,
      p_renter_id,
      'debt_settle',
      v_amount,
      v_slot.id,
      v_phase
    );

    IF v_ledger_id IS NULL THEN
      EXIT;
    END IF;

    UPDATE rentals
    SET
      debt_amount = 0,
      lifecycle = CASE
        WHEN remainder_charged_at IS NOT NULL OR remainder_amount = 0 THEN 'settled'
        ELSE lifecycle
      END,
      updated_at = now()
    WHERE id = v_slot.id;

    IF FOUND THEN
      PERFORM _renter_enqueue_debt_settled(v_slot.id, v_amount);
    END IF;
  END LOOP;
END;
$$;

COMMIT;
