-- FB3 / P1-04 (show), P1-05: pending top-up read model in renter_get_wallet + awaiting_payment flag for polling.

CREATE OR REPLACE FUNCTION renter_get_wallet(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ctx record;
  v_limit integer;
  v_offset integer;
  v_total integer;
  v_rows jsonb;
  v_pending jsonb;
BEGIN
  SELECT * INTO v_ctx FROM _renter_require_renter_ctx();
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);

  SELECT count(*)
  INTO v_total
  FROM renter_wallet_ledger l
  WHERE l.organization_id = v_ctx.org_id
    AND l.renter_id = v_ctx.renter_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', x.id,
      'entry_type', x.entry_type,
      'amount', x.amount,
      'rental_id', x.rental_id,
      'phase', x.phase,
      'created_at', x.created_at
    ) ORDER BY x.created_at DESC, x.id DESC
  ), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT l.id, l.entry_type, l.amount, l.rental_id, l.phase, l.created_at
    FROM renter_wallet_ledger l
    WHERE l.organization_id = v_ctx.org_id
      AND l.renter_id = v_ctx.renter_id
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT v_limit OFFSET v_offset
  ) x;

  SELECT jsonb_build_object(
    'id', t.id,
    'amount', t.amount,
    'method', t.method,
    'created_at', t.created_at
  )
  INTO v_pending
  FROM renter_topup_requests t
  WHERE t.organization_id = v_ctx.org_id
    AND t.renter_id = v_ctx.renter_id
    AND t.status = 'pending'
  ORDER BY t.created_at DESC, t.id DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'success', true,
    'wallet_balance', _renter_wallet_balance(v_ctx.org_id, v_ctx.renter_id),
    'spendable', _renter_wallet_spendable(v_ctx.org_id, v_ctx.renter_id),
    'reserved_prepay', _renter_wallet_reserved_prepay(v_ctx.org_id, v_ctx.renter_id),
    'debt_amount', _renter_wallet_debt_outstanding(v_ctx.org_id, v_ctx.renter_id),
    'pending_topup', v_pending,
    'has_awaiting_payment', EXISTS (
      SELECT 1
      FROM rentals r
      WHERE r.organization_id = v_ctx.org_id
        AND r.renter_id = v_ctx.renter_id
        AND r.channel = 'miniapp'
        AND r.lifecycle = 'awaiting_payment'
    ),
    'entries', v_rows,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
