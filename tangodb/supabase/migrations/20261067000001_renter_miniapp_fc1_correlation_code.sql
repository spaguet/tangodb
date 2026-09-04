-- FC1 / P1-03 layer 1: short correlation code on pending top-up (TDB-XXXX) in chat, inbox, search.

ALTER TABLE renter_topup_requests
  ADD COLUMN IF NOT EXISTS correlation_code text;

-- Backfill historical rows before NOT NULL.
UPDATE renter_topup_requests t
SET correlation_code = sub.code
FROM (
  SELECT
    id,
    'TDB-' || upper(substr(encode(digest(id::text || organization_id::text, 'sha256'), 'hex'), 1, 4)) AS code
  FROM renter_topup_requests
  WHERE correlation_code IS NULL
) sub
WHERE t.id = sub.id
  AND t.correlation_code IS NULL;

CREATE OR REPLACE FUNCTION _renter_allocate_topup_correlation_code(p_org_id uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_code text;
  v_i integer;
  v_attempt integer := 0;
BEGIN
  LOOP
    v_code := 'TDB-';
    FOR v_i IN 1..4 LOOP
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::integer, 1);
    END LOOP;

    IF NOT EXISTS (
      SELECT 1
      FROM renter_topup_requests t
      WHERE t.organization_id = p_org_id
        AND t.correlation_code = v_code
    ) THEN
      RETURN v_code;
    END IF;

    v_attempt := v_attempt + 1;
    IF v_attempt > 50 THEN
      RAISE EXCEPTION 'renter.topup.correlationExhausted';
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE renter_topup_requests
  ALTER COLUMN correlation_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS renter_topup_requests_org_correlation_code
  ON renter_topup_requests (organization_id, correlation_code);

COMMENT ON COLUMN renter_topup_requests.correlation_code IS
  'FC1: short reference TDB-XXXX linking Telegram chat message and CRM inbox row.';

CREATE OR REPLACE FUNCTION renter_submit_topup(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ctx record;
  v_amount numeric;
  v_method text;
  v_qr uuid;
  v_id uuid;
  v_currency text;
  v_code text;
BEGIN
  SELECT * INTO v_ctx FROM _renter_require_renter_ctx();

  IF NOT _renter_check_rpc_rate_limit(v_ctx.org_id, v_ctx.telegram_id) THEN
    PERFORM _renter_raise('renter.rateLimited');
  END IF;

  IF NOT renter_miniapp_addon_is_active(v_ctx.org_id) THEN
    PERFORM _renter_raise('renter.addonInactive');
  END IF;
  IF NOT organization_allows_writes(v_ctx.org_id) THEN
    PERFORM _renter_raise('renter.writesDisabled');
  END IF;

  v_currency := _renter_org_currency(v_ctx.org_id);
  v_amount := _renter_round_money((p_payload ->> 'amount')::numeric, v_currency);
  v_method := NULLIF(trim(COALESCE(p_payload ->> 'method', '')), '');
  v_qr := NULLIF(p_payload ->> 'qr_asset_id', '')::uuid;

  IF v_method IS NULL OR v_method NOT IN ('qr', 'cash') THEN
    PERFORM _renter_raise('renter.topup.methodInvalid');
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    PERFORM _renter_raise('renter.topup.amountInvalid');
  END IF;
  IF v_amount > 1000000 THEN
    PERFORM _renter_raise('renter.topup.amountTooLarge');
  END IF;
  IF v_method = 'qr' THEN
    IF v_qr IS NULL OR NOT EXISTS (
      SELECT 1 FROM organization_rental_qr_assets a
      WHERE a.id = v_qr AND a.organization_id = v_ctx.org_id AND a.is_active
    ) THEN
      PERFORM _renter_raise('renter.topup.qrInvalid');
    END IF;
  ELSE
    v_qr := NULL;
  END IF;

  v_code := _renter_allocate_topup_correlation_code(v_ctx.org_id);

  INSERT INTO renter_topup_requests (
    organization_id, renter_id, amount, method, qr_asset_id, status, correlation_code
  )
  VALUES (v_ctx.org_id, v_ctx.renter_id, v_amount, v_method, v_qr, 'pending', v_code)
  RETURNING id INTO v_id;

  PERFORM _renter_enqueue_topup_created(v_ctx.org_id, v_ctx.renter_id, v_id, v_amount);

  RETURN jsonb_build_object(
    'success', true,
    'id', v_id,
    'amount', v_amount,
    'correlation_code', v_code
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.pendingExists');
  WHEN check_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.amountTooLarge');
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION list_renter_topup_inbox(
  p_status text DEFAULT 'pending',
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid := auth_organization_id();
  v_limit integer;
  v_offset integer;
  v_status text;
  v_search text;
  v_total integer;
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;
  IF NOT member_can_record_rental_payment() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);
  v_status := COALESCE(NULLIF(trim(p_status), ''), 'pending');
  IF v_status NOT IN ('pending', 'confirmed', 'rejected', 'all') THEN
    v_status := 'pending';
  END IF;
  v_search := NULLIF(trim(COALESCE(p_search, '')), '');

  SELECT count(*)
  INTO v_total
  FROM renter_topup_requests t
  JOIN renters r ON r.id = t.renter_id AND r.organization_id = t.organization_id
  WHERE t.organization_id = v_org
    AND (v_status = 'all' OR t.status = v_status)
    AND (
      v_search IS NULL
      OR t.correlation_code ILIKE '%' || replace(v_search, '%', '\%') || '%'
      OR r.display_name ILIKE '%' || replace(v_search, '%', '\%') || '%'
    );

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', x.id,
      'renter_id', x.renter_id,
      'renter_name', x.display_name,
      'amount', x.amount,
      'method', x.method,
      'status', x.status,
      'amount_fact', x.amount_fact,
      'correlation_code', x.correlation_code,
      'qr_asset_id', x.qr_asset_id,
      'created_at', x.created_at,
      'resolved_at', x.resolved_at
    ) ORDER BY x.created_at DESC
  ), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      t.id,
      t.renter_id,
      r.display_name,
      t.amount,
      t.method,
      t.status,
      t.amount_fact,
      t.correlation_code,
      t.qr_asset_id,
      t.created_at,
      t.resolved_at
    FROM renter_topup_requests t
    JOIN renters r ON r.id = t.renter_id AND r.organization_id = t.organization_id
    WHERE t.organization_id = v_org
      AND (v_status = 'all' OR t.status = v_status)
      AND (
        v_search IS NULL
        OR t.correlation_code ILIKE '%' || replace(v_search, '%', '\%') || '%'
        OR r.display_name ILIKE '%' || replace(v_search, '%', '\%') || '%'
      )
    ORDER BY t.created_at DESC
    LIMIT v_limit OFFSET v_offset
  ) x;

  RETURN jsonb_build_object(
    'success', true,
    'items', v_rows,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
END;
$$;

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
      'direction', x.direction,
      'rental_id', x.rental_id,
      'phase', x.phase,
      'created_at', x.created_at,
      'balance_after', x.balance_after
    ) ORDER BY x.created_at DESC, x.id DESC
  ), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      w.id,
      w.entry_type,
      w.amount,
      w.direction,
      w.rental_id,
      w.phase,
      w.created_at,
      w.balance_after
    FROM (
      SELECT
        l.id,
        l.entry_type,
        l.amount,
        _renter_wallet_entry_direction(l.entry_type) AS direction,
        l.rental_id,
        l.phase,
        l.created_at,
        SUM(_renter_wallet_entry_signed_amount(l.entry_type, l.amount)) OVER (
          ORDER BY l.created_at ASC, l.id ASC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS balance_after
      FROM renter_wallet_ledger l
      WHERE l.organization_id = v_ctx.org_id
        AND l.renter_id = v_ctx.renter_id
    ) w
    ORDER BY w.created_at DESC, w.id DESC
    LIMIT v_limit OFFSET v_offset
  ) x;

  SELECT jsonb_build_object(
    'id', t.id,
    'amount', t.amount,
    'method', t.method,
    'created_at', t.created_at,
    'correlation_code', t.correlation_code
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

REVOKE ALL ON FUNCTION _renter_allocate_topup_correlation_code(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _renter_allocate_topup_correlation_code(uuid) TO service_role;
