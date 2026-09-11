-- After T−24h the first 50% leaves reserved_prepay, but the unpaid second 50%
-- of that prepaid_charged slot was still counted as spendable / FIFO-available.
-- A 3-day pack then showed 2×prepay in reserve and 1×prepay as "available".
-- Earmark that remainder in the UI reserve; FIFO cannot spend it; remainder
-- charge at time_end still covers it from (wallet − active uncharged prepays).
-- Invariant stays wallet >= reserved_active (not the UI reserved figure).

BEGIN;

CREATE OR REPLACE FUNCTION _renter_wallet_reserved_active_prepay(p_org_id uuid, p_renter_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(r.prepay_amount), 0)::numeric(12, 2)
  FROM rentals r
  WHERE r.organization_id = p_org_id
    AND r.renter_id = p_renter_id
    AND r.channel = 'miniapp'
    AND r.lifecycle = 'active'
    AND r.prepay_charged_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION _renter_wallet_earmarked_remainder(p_org_id uuid, p_renter_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(r.remainder_amount), 0)::numeric(12, 2)
  FROM rentals r
  WHERE r.organization_id = p_org_id
    AND r.renter_id = p_renter_id
    AND r.channel = 'miniapp'
    AND r.booking_status = 'confirmed'
    AND r.lifecycle = 'prepaid_charged'
    AND r.remainder_charged_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION _renter_wallet_reserved_prepay(p_org_id uuid, p_renter_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT LEAST(
    _renter_wallet_balance(p_org_id, p_renter_id),
    (
      _renter_wallet_reserved_active_prepay(p_org_id, p_renter_id)
      + _renter_wallet_earmarked_remainder(p_org_id, p_renter_id)
    )
  )::numeric(12, 2);
$$;

CREATE OR REPLACE FUNCTION _renter_wallet_spendable(p_org_id uuid, p_renter_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT GREATEST(
    _renter_wallet_balance(p_org_id, p_renter_id)
      - _renter_wallet_reserved_active_prepay(p_org_id, p_renter_id)
      - _renter_wallet_earmarked_remainder(p_org_id, p_renter_id),
    0
  )::numeric(12, 2);
$$;

CREATE OR REPLACE FUNCTION _renter_wallet_remainder_coverable(p_org_id uuid, p_renter_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT GREATEST(
    _renter_wallet_balance(p_org_id, p_renter_id)
      - _renter_wallet_reserved_active_prepay(p_org_id, p_renter_id),
    0
  )::numeric(12, 2);
$$;

CREATE OR REPLACE FUNCTION _renter_assert_wallet_invariant(p_org_id uuid, p_renter_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF _renter_wallet_balance(p_org_id, p_renter_id)
     < _renter_wallet_reserved_active_prepay(p_org_id, p_renter_id) THEN
    RAISE EXCEPTION 'renter.wallet.invariant'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_charge_prepay(p_rental_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r rentals%ROWTYPE;
  v_available numeric;
  v_balance numeric;
  v_reserved numeric;
BEGIN
  SELECT * INTO v_r FROM rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND OR v_r.channel <> 'miniapp' THEN
    RETURN false;
  END IF;

  IF v_r.prepay_charged_at IS NOT NULL THEN
    RETURN true;
  END IF;

  IF v_r.prepay_amount <= 0 THEN
    UPDATE rentals
    SET
      lifecycle = 'prepaid_charged',
      prepay_charged_at = now(),
      updated_at = now()
    WHERE id = p_rental_id
      AND prepay_charged_at IS NULL;
    RETURN true;
  END IF;

  v_balance := _renter_wallet_balance(v_r.organization_id, v_r.renter_id);
  v_reserved := _renter_wallet_reserved_active_prepay(v_r.organization_id, v_r.renter_id);
  v_available := _renter_wallet_available(v_r.organization_id, v_r.renter_id);

  IF v_r.lifecycle = 'active' THEN
    IF v_balance < v_r.prepay_amount THEN
      RETURN false;
    END IF;
    IF (v_balance - (v_reserved - v_r.prepay_amount)) < v_r.prepay_amount THEN
      RETURN false;
    END IF;
  ELSE
    IF v_available < v_r.prepay_amount THEN
      RETURN false;
    END IF;
  END IF;

  PERFORM _renter_wallet_insert_entry(
    v_r.organization_id,
    v_r.renter_id,
    'prepay_charge',
    v_r.prepay_amount,
    v_r.id,
    'prepay'
  );

  UPDATE rentals
  SET
    lifecycle = 'prepaid_charged',
    prepay_charged_at = now(),
    updated_at = now()
  WHERE id = p_rental_id
    AND prepay_charged_at IS NULL;

  PERFORM _renter_assert_wallet_invariant(v_r.organization_id, v_r.renter_id);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_charge_remainder(p_rental_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r rentals%ROWTYPE;
  v_coverable numeric;
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

  -- Own earmarked remainder is payable; do not spend other slots' active 50%.
  v_coverable := _renter_wallet_remainder_coverable(v_r.organization_id, v_r.renter_id);

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

  IF v_coverable < v_r.remainder_amount THEN
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

REVOKE ALL ON FUNCTION _renter_wallet_reserved_active_prepay(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_wallet_earmarked_remainder(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_wallet_remainder_coverable(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_wallet_reserved_prepay(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_wallet_spendable(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_assert_wallet_invariant(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_charge_prepay(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_charge_remainder(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION _renter_wallet_reserved_active_prepay(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_wallet_earmarked_remainder(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_wallet_remainder_coverable(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_wallet_reserved_prepay(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_wallet_spendable(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_assert_wallet_invariant(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_charge_prepay(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_charge_remainder(uuid) TO service_role;

COMMENT ON FUNCTION _renter_wallet_reserved_active_prepay(uuid, uuid) IS
  'Σ prepay_amount on confirmed Mini App rentals with lifecycle=active AND prepay_charged_at IS NULL. Invariant and T−24 charge use this.';
COMMENT ON FUNCTION _renter_wallet_earmarked_remainder(uuid, uuid) IS
  'Σ remainder_amount on confirmed prepaid_charged Mini App rentals not yet remainder-charged.';
COMMENT ON FUNCTION _renter_wallet_reserved_prepay(uuid, uuid) IS
  'UI reserve: LEAST(wallet, reserved_active + earmarked remainder of prepaid_charged).';
COMMENT ON FUNCTION _renter_wallet_spendable(uuid, uuid) IS
  'GREATEST(wallet − reserved_active − earmarked remainder, 0). FIFO / debt_settle / surcharge.';
COMMENT ON FUNCTION _renter_wallet_remainder_coverable(uuid, uuid) IS
  'GREATEST(wallet − reserved_active, 0). Remainder charge at time_end; includes own earmark.';
COMMENT ON FUNCTION _renter_assert_wallet_invariant(uuid, uuid) IS
  'wallet_balance >= reserved_active_prepay (uncharged active 50% only).';

COMMIT;
