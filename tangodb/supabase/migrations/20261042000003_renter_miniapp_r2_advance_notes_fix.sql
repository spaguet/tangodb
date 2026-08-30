-- R2 follow-up: rental_advances has no `notes` column (same trap as 20260873000001).
-- Keep p_notes on the signature so resolve/staff-topup call sites stay unchanged.

CREATE OR REPLACE FUNCTION _renter_credit_wallet_topup(
  p_org_id uuid,
  p_renter_id uuid,
  p_amount numeric,
  p_method text,
  p_member_id uuid,
  p_topup_request_id uuid,
  p_notes text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today date;
  v_advance uuid;
  v_currency text;
  v_advance_method text;
BEGIN
  v_today := _org_local_date(p_org_id);

  IF _is_finance_period_closed(p_org_id, v_today) THEN
    PERFORM _renter_raise('finance.error.periodClosed');
  END IF;

  IF NOT organization_allows_writes(p_org_id) THEN
    PERFORM _renter_raise('renter.writesDisabled');
  END IF;

  v_currency := _renter_org_currency(p_org_id);
  v_advance_method := CASE WHEN p_method = 'qr' THEN 'transfer' ELSE 'cash' END;

  INSERT INTO rental_advances (
    organization_id, renter_id, amount, allocated_amount, currency, method,
    created_by, operation_date
  )
  VALUES (
    p_org_id,
    p_renter_id,
    p_amount,
    p_amount,
    v_currency,
    v_advance_method,
    p_member_id,
    v_today
  )
  RETURNING id INTO v_advance;

  PERFORM _renter_wallet_insert_topup(
    p_org_id, p_renter_id, p_amount, v_advance, p_topup_request_id
  );
  PERFORM _renter_apply_wallet(p_org_id, p_renter_id);

  RETURN v_advance;
END;
$$;
