-- Mini App top-up: raise amount ceiling for zero-decimal currencies (VND, KRW, JPY).
-- RUB/USD keep 1_000_000; VND etc. allow up to 100_000_000 major units.

BEGIN;

CREATE OR REPLACE FUNCTION _renter_topup_amount_max(p_currency text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN _renter_currency_minor(p_currency) = 0 THEN 100000000::numeric
    ELSE 1000000::numeric
  END;
$$;

REVOKE ALL ON FUNCTION _renter_topup_amount_max(text) FROM PUBLIC;

ALTER TABLE renter_topup_requests
  DROP CONSTRAINT IF EXISTS renter_topup_requests_amount_check;

ALTER TABLE renter_topup_requests
  ADD CONSTRAINT renter_topup_requests_amount_check
  CHECK (amount > 0 AND amount <= 100000000);

ALTER TABLE renter_topup_requests
  DROP CONSTRAINT IF EXISTS renter_topup_requests_amount_fact_check;

ALTER TABLE renter_topup_requests
  ADD CONSTRAINT renter_topup_requests_amount_fact_check
  CHECK (amount_fact IS NULL OR (amount_fact > 0 AND amount_fact <= 100000000));

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
  v_chat text;
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
  IF v_amount > _renter_topup_amount_max(v_currency) THEN
    PERFORM _renter_raise('renter.topup.amountTooLarge');
  END IF;
  IF v_method = 'qr' THEN
    SELECT c.telegram_chat_url
    INTO v_chat
    FROM organization_renter_channel c
    WHERE c.organization_id = v_ctx.org_id;

    IF v_chat IS NULL OR NOT _renter_telegram_chat_url_ok(v_chat) THEN
      PERFORM _renter_raise('renter.topup.chatRequired');
    END IF;

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

CREATE OR REPLACE FUNCTION resolve_renter_topup(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid := auth_organization_id();
  v_member uuid := auth_member_id();
  v_id uuid;
  v_action text;
  v_fact numeric;
  v_key uuid;
  v_fp text;
  v_cached jsonb;
  v_row renter_topup_requests%ROWTYPE;
  v_updated renter_topup_requests%ROWTYPE;
  v_currency text;
  v_today date;
  v_advance uuid;
  v_result jsonb;
  v_max numeric;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;
  IF NOT member_can_record_rental_payment() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  v_id := NULLIF(p_payload ->> 'id', '')::uuid;
  v_action := NULLIF(trim(COALESCE(p_payload ->> 'action', '')), '');
  v_key := NULLIF(p_payload ->> 'idempotency_key', '')::uuid;
  v_currency := _renter_org_currency(v_org);
  v_max := _renter_topup_amount_max(v_currency);
  v_fact := CASE
    WHEN p_payload ->> 'amount_fact' IS NULL OR trim(p_payload ->> 'amount_fact') = '' THEN NULL
    ELSE _renter_round_money((p_payload ->> 'amount_fact')::numeric, v_currency)
  END;

  IF v_id IS NULL OR v_action NOT IN ('confirm', 'reject') THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.resolveInvalid');
  END IF;

  v_fp := md5(v_id::text || ':' || v_action || ':' || COALESCE(v_fact::text, ''));
  v_cached := check_operation_idempotency(v_org, 'resolve_renter_topup', v_key, v_fp);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  SELECT * INTO v_row
  FROM renter_topup_requests
  WHERE id = v_id AND organization_id = v_org;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.notFound');
  END IF;

  v_today := _org_local_date(v_org);
  IF v_action = 'confirm' THEN
    IF _is_finance_period_closed(v_org, v_today) THEN
      RETURN jsonb_build_object('success', false, 'error', 'finance.error.periodClosed');
    END IF;
    IF NOT organization_allows_writes(v_org) THEN
      RETURN jsonb_build_object('success', false, 'error', 'renter.writesDisabled');
    END IF;
  END IF;

  PERFORM _renter_acquire_miniapp_locks(v_org, v_row.renter_id, '[]'::jsonb);

  IF v_action = 'reject' THEN
    UPDATE renter_topup_requests
    SET status = 'rejected', resolved_by = v_member, resolved_at = now()
    WHERE id = v_id AND organization_id = v_org AND status = 'pending'
    RETURNING * INTO v_updated;

    IF NOT FOUND THEN
      v_result := jsonb_build_object('success', true, 'already_applied', true);
      PERFORM store_operation_idempotency(v_org, 'resolve_renter_topup', v_key, v_fp, v_result);
      RETURN v_result;
    END IF;

    PERFORM _renter_enqueue_topup_rejected(v_org, v_row.renter_id, v_id, v_row.amount);

    v_result := jsonb_build_object('success', true, 'status', 'rejected', 'id', v_id);
    PERFORM store_operation_idempotency(v_org, 'resolve_renter_topup', v_key, v_fp, v_result);
    RETURN v_result;
  END IF;

  v_fact := COALESCE(v_fact, v_row.amount);
  IF v_fact <= 0 OR v_fact > v_max THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.amountInvalid');
  END IF;

  UPDATE renter_topup_requests
  SET
    status = 'confirmed',
    amount_fact = v_fact,
    resolved_by = v_member,
    resolved_at = now()
  WHERE id = v_id AND organization_id = v_org AND status = 'pending'
  RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    v_result := jsonb_build_object('success', true, 'already_applied', true);
    PERFORM store_operation_idempotency(v_org, 'resolve_renter_topup', v_key, v_fp, v_result);
    RETURN v_result;
  END IF;

  v_advance := _renter_credit_wallet_topup(
    v_org, v_row.renter_id, v_fact, v_row.method, v_member, v_id,
    'miniapp_topup_request'
  );

  PERFORM _renter_enqueue_topup_confirmed(v_org, v_row.renter_id, v_id, v_fact);

  v_result := jsonb_build_object(
    'success', true,
    'status', 'confirmed',
    'id', v_id,
    'amount', v_row.amount,
    'amount_fact', v_fact,
    'advance_id', v_advance
  );
  PERFORM store_operation_idempotency(v_org, 'resolve_renter_topup', v_key, v_fp, v_result);
  RETURN v_result;
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION staff_renter_wallet_topup(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid := auth_organization_id();
  v_member uuid := auth_member_id();
  v_renter uuid;
  v_amount numeric;
  v_method text;
  v_key uuid;
  v_fp text;
  v_cached jsonb;
  v_currency text;
  v_advance uuid;
  v_external_ref text;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;
  IF NOT member_can_record_rental_payment() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  v_renter := NULLIF(p_payload ->> 'renter_id', '')::uuid;
  v_currency := _renter_org_currency(v_org);
  v_amount := _renter_round_money((p_payload ->> 'amount')::numeric, v_currency);
  v_method := COALESCE(NULLIF(trim(p_payload ->> 'method'), ''), 'cash');
  v_key := NULLIF(p_payload ->> 'idempotency_key', '')::uuid;
  v_external_ref := NULLIF(trim(p_payload ->> 'external_reference'), '');

  IF v_renter IS NULL OR v_amount IS NULL OR v_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.amountInvalid');
  END IF;
  IF v_amount > _renter_topup_amount_max(v_currency) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.amountTooLarge');
  END IF;
  IF v_method NOT IN ('qr', 'cash') THEN
    v_method := 'cash';
  END IF;
  IF v_key IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.idempotencyRequired');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM renters r WHERE r.id = v_renter AND r.organization_id = v_org
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.notFound');
  END IF;

  v_fp := md5(v_renter::text || ':' || v_amount::text || ':' || v_method);

  PERFORM _renter_acquire_miniapp_locks(v_org, v_renter, '[]'::jsonb);

  v_cached := claim_operation_idempotency(v_org, 'staff_renter_wallet_topup', v_key, v_fp);
  IF v_cached IS NOT NULL THEN
    IF v_cached ->> 'error_code' = 'idempotency_conflict' THEN
      RETURN v_cached;
    END IF;
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  v_advance := _renter_credit_wallet_topup(
    v_org, v_renter, v_amount, v_method, v_member, NULL, 'staff_wallet_topup', v_external_ref
  );

  v_result := jsonb_build_object(
    'success', true,
    'advance_id', v_advance,
    'amount', v_amount
  );
  PERFORM store_operation_idempotency(v_org, 'staff_renter_wallet_topup', v_key, v_fp, v_result);
  RETURN v_result;
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
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
  v_started_bot bigint;
  v_channel_bot bigint;
  v_bot_started boolean;
  v_bot_url text;
  v_undelivered integer;
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

  SELECT c.telegram_chat_url, c.telegram_bot_id
  INTO v_chat, v_channel_bot
  FROM organization_renter_channel c
  WHERE c.organization_id = v_ctx.org_id;

  IF v_chat IS NOT NULL AND NOT _renter_telegram_chat_url_ok(v_chat) THEN
    v_chat := NULL;
  END IF;

  SELECT d.bot_started_at, d.allows_write_to_pm, d.bot_started_bot_id
  INTO v_started, v_allows, v_started_bot
  FROM renter_telegram_dialog d
  WHERE d.organization_id = v_ctx.org_id
    AND d.telegram_id = v_ctx.telegram_id;

  v_bot_started := v_started IS NOT NULL
    AND (v_channel_bot IS NULL OR v_started_bot = v_channel_bot);

  v_bot_url := _renter_telegram_bot_open_url(v_ctx.org_id);

  v_undelivered := _renter_outbox_unacknowledged_skipped_count(v_ctx.org_id, v_ctx.renter_id);

  RETURN jsonb_build_object(
    'success', true,
    'studio_name', COALESCE(NULLIF(trim(v_branding), ''), v_name),
    'timezone', COALESCE(v_tz, 'UTC'),
    'currency_code', COALESCE(v_currency, 'RUB'),
    'locale', COALESCE(v_locale, 'ru'),
    'chat_url', v_chat,
    'bot_url', v_bot_url,
    'addon_active', renter_miniapp_addon_is_active(v_ctx.org_id),
    'bot_started', v_bot_started,
    'allows_write', COALESCE(v_allows, false),
    'display_name', v_renter.display_name,
    'contact_phone', v_renter.contact_phone,
    'booking_banned', v_renter.booking_banned_at IS NOT NULL,
    'server_now', now(),
    'undelivered_notifications', v_undelivered,
    'topup_max_amount', _renter_topup_amount_max(COALESCE(v_currency, 'RUB'))
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

COMMIT;
