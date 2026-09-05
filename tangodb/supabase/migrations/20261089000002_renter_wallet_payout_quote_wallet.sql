-- Patch: refundable from wallet, not spendable (reserved 50% must not be subtracted twice).
-- 20261089000001 already applied on linked DB with GREATEST(spendable − obligated).

BEGIN;

CREATE OR REPLACE FUNCTION _renter_wallet_payout_quote(
  p_org_id uuid,
  p_renter_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_currency text;
  v_wallet numeric;
  v_spendable numeric;
  v_reserved numeric;
  v_debt numeric;
  v_holds numeric;
  v_remainders numeric;
  v_hold_count integer;
  v_live_count integer;
  v_obligated numeric;
  v_refundable numeric;
BEGIN
  v_currency := _renter_org_currency(p_org_id);
  v_wallet := _renter_wallet_balance(p_org_id, p_renter_id);
  v_spendable := _renter_wallet_spendable(p_org_id, p_renter_id);
  v_reserved := _renter_wallet_reserved_prepay(p_org_id, p_renter_id);
  v_debt := _renter_wallet_debt_outstanding(p_org_id, p_renter_id);

  SELECT
    COALESCE(SUM(COALESCE(r.prepay_amount, 0) + COALESCE(r.remainder_amount, 0)), 0),
    COUNT(*)::integer
  INTO v_holds, v_hold_count
  FROM rentals r
  WHERE r.organization_id = p_org_id
    AND r.renter_id = p_renter_id
    AND r.channel = 'miniapp'
    AND r.booking_status = 'confirmed'
    AND r.lifecycle = 'awaiting_payment';

  SELECT
    COALESCE(SUM(COALESCE(r.remainder_amount, 0)), 0),
    COUNT(*)::integer
  INTO v_remainders, v_live_count
  FROM rentals r
  WHERE r.organization_id = p_org_id
    AND r.renter_id = p_renter_id
    AND r.channel = 'miniapp'
    AND r.booking_status = 'confirmed'
    AND r.remainder_charged_at IS NULL
    AND (
      (r.lifecycle = 'active' AND r.prepay_charged_at IS NULL)
      OR r.lifecycle = 'prepaid_charged'
    );

  v_holds := _renter_round_money(v_holds, v_currency);
  v_remainders := _renter_round_money(v_remainders, v_currency);
  v_obligated := _renter_round_money(v_debt + v_holds + v_remainders, v_currency);
  v_refundable := _renter_round_money(GREATEST(v_wallet - v_obligated, 0), v_currency);

  RETURN jsonb_build_object(
    'wallet_balance', v_wallet,
    'spendable', v_spendable,
    'reserved_prepay', v_reserved,
    'debt_to_keep', v_debt,
    'holds_full_cost', v_holds,
    'holds_count', v_hold_count,
    'remainders_to_keep', v_remainders,
    'live_booking_count', v_live_count,
    'obligated', v_obligated,
    'refundable', v_refundable,
    'currency', v_currency
  );
END;
$$;

REVOKE ALL ON FUNCTION _renter_wallet_payout_quote(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _renter_wallet_payout_quote(uuid, uuid) TO service_role;

COMMENT ON FUNCTION _renter_wallet_payout_quote(uuid, uuid) IS
  'Refundable leftover = wallet − Mini App debt − 100% of awaiting_payment holds − remainder of live bookings.';

COMMIT;
