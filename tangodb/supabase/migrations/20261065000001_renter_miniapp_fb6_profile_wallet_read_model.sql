-- FB6 / 2.9.47: P1-13 profile in bootstrap, P1-14 wallet entry direction/balance_after, P3-04 server_now.

CREATE OR REPLACE FUNCTION _renter_wallet_entry_signed_amount(p_entry_type text, p_amount numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_entry_type IN ('topup', 'refund') THEN p_amount
    WHEN p_entry_type IN (
      'prepay_charge',
      'remainder_charge',
      'debt_settle',
      'surcharge_one_time_recalc',
      'topup_reversal'
    ) THEN -p_amount
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION _renter_wallet_entry_direction(p_entry_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_entry_type IN ('topup', 'refund') THEN 'credit'
    ELSE 'debit'
  END;
$$;

CREATE OR REPLACE FUNCTION renter_bootstrap()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ctx record;
  v_renter renters%ROWTYPE;
  v_name text;
  v_branding text;
  v_tz text;
  v_currency text;
  v_locale text;
  v_chat text;
  v_started timestamptz;
  v_allows boolean;
BEGIN
  SELECT * INTO v_ctx FROM _renter_require_renter_ctx();

  SELECT r.*
  INTO v_renter
  FROM renters r
  WHERE r.id = v_ctx.renter_id
    AND r.organization_id = v_ctx.org_id;

  SELECT o.name, os.branding_name, os.timezone, os.currency_code, os.locale
  INTO v_name, v_branding, v_tz, v_currency, v_locale
  FROM organizations o
  JOIN organization_settings os ON os.organization_id = o.id
  WHERE o.id = v_ctx.org_id;

  SELECT c.telegram_chat_url
  INTO v_chat
  FROM organization_renter_channel c
  WHERE c.organization_id = v_ctx.org_id;

  IF v_chat IS NOT NULL AND NOT _renter_telegram_chat_url_ok(v_chat) THEN
    v_chat := NULL;
  END IF;

  SELECT d.bot_started_at, d.allows_write_to_pm
  INTO v_started, v_allows
  FROM renter_telegram_dialog d
  WHERE d.organization_id = v_ctx.org_id
    AND d.telegram_id = v_ctx.telegram_id;

  RETURN jsonb_build_object(
    'success', true,
    'studio_name', COALESCE(NULLIF(trim(v_branding), ''), v_name),
    'timezone', COALESCE(v_tz, 'UTC'),
    'currency_code', COALESCE(v_currency, 'RUB'),
    'locale', COALESCE(v_locale, 'ru'),
    'chat_url', v_chat,
    'addon_active', renter_miniapp_addon_is_active(v_ctx.org_id),
    'bot_started', v_started IS NOT NULL,
    'allows_write', COALESCE(v_allows, false),
    'display_name', v_renter.display_name,
    'contact_phone', v_renter.contact_phone,
    'server_now', now()
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
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
      'balance_after', x.balance_after,
      'rental_id', x.rental_id,
      'phase', x.phase,
      'created_at', x.created_at
    ) ORDER BY x.created_at DESC, x.id DESC
  ), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      w.id,
      w.entry_type,
      w.amount,
      _renter_wallet_entry_direction(w.entry_type) AS direction,
      w.balance_after,
      w.rental_id,
      w.phase,
      w.created_at
    FROM (
      SELECT
        l.id,
        l.entry_type,
        l.amount,
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

REVOKE ALL ON FUNCTION _renter_wallet_entry_signed_amount(text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_wallet_entry_direction(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _renter_wallet_entry_signed_amount(text, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_wallet_entry_direction(text) TO service_role;
