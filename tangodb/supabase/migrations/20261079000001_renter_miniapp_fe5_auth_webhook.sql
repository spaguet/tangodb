-- FE5 / P2-09, P2-24: auth replay vs suspension, QR topup chat gate, bind safety.

BEGIN;

-- =============================================================================
-- 1. Mint prepare — idempotent replay must re-check org suspension
-- =============================================================================

CREATE OR REPLACE FUNCTION renter_telegram_mint_prepare(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_telegram bigint;
  v_display_name text;
  v_init_hash text;
  v_allows_write boolean;
  v_renter_id uuid;
  v_auth_user_id uuid;
  v_status text;
  v_existed boolean := false;
  v_addon_active boolean;
  v_hash_row renter_init_data_hashes%ROWTYPE;
BEGIN
  v_org := NULLIF(p_payload ->> 'organization_id', '')::uuid;
  BEGIN
    v_telegram := NULLIF(p_payload ->> 'telegram_id', '')::bigint;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.auth.forbidden');
  END;
  v_display_name := left(
    regexp_replace(
      trim(COALESCE(p_payload ->> 'display_name', '')),
      '[[:cntrl:]]',
      '',
      'g'
    ),
    80
  );
  v_init_hash := NULLIF(trim(COALESCE(p_payload ->> 'init_data_hash', '')), '');
  v_allows_write := COALESCE((p_payload ->> 'allows_write_to_pm')::boolean, false);

  IF v_org IS NULL OR v_telegram IS NULL OR v_telegram <= 0 OR v_init_hash IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.auth.forbidden');
  END IF;

  IF v_display_name = '' THEN
    v_display_name := 'Telegram user';
  END IF;

  PERFORM pg_advisory_xact_lock(_renter_mint_lock_key(v_org, v_telegram));

  SELECT *
  INTO v_hash_row
  FROM renter_init_data_hashes h
  WHERE h.init_data_hash = v_init_hash
    AND h.organization_id = v_org
    AND h.created_at > now() - interval '15 minutes';

  IF FOUND THEN
    IF NOT organization_allows_writes(v_org) THEN
      RETURN jsonb_build_object('success', false, 'error', 'renter.auth.forbidden');
    END IF;

    SELECT r.id, r.auth_user_id, r.status
    INTO v_renter_id, v_auth_user_id, v_status
    FROM renters r
    WHERE r.id = v_hash_row.renter_id
      AND r.organization_id = v_org
      AND r.telegram_id = v_telegram;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'renter.auth.forbidden');
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'renter_id', v_renter_id,
      'auth_user_id', v_auth_user_id,
      'needs_create_user', v_auth_user_id IS NULL,
      'is_new_renter', false,
      'status', v_status,
      'idempotent', true
    );
  END IF;

  IF NOT organization_allows_writes(v_org) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.auth.forbidden');
  END IF;

  SELECT r.id, r.auth_user_id, r.status
  INTO v_renter_id, v_auth_user_id, v_status
  FROM renters r
  WHERE r.organization_id = v_org
    AND r.telegram_id = v_telegram;

  v_existed := FOUND;

  v_addon_active := renter_miniapp_addon_is_active(v_org);

  IF NOT v_existed AND NOT v_addon_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.auth.forbidden');
  END IF;

  IF NOT v_existed THEN
    INSERT INTO renters (
      organization_id,
      display_name,
      telegram_id,
      counterparty_type,
      status
    )
    VALUES (
      v_org,
      v_display_name,
      v_telegram,
      'individual',
      'active'
    )
    RETURNING id, auth_user_id, status
    INTO v_renter_id, v_auth_user_id, v_status;
  END IF;

  IF v_allows_write THEN
    INSERT INTO renter_telegram_dialog (
      organization_id,
      telegram_id,
      allows_write_to_pm,
      updated_at
    )
    VALUES (v_org, v_telegram, true, now())
    ON CONFLICT (organization_id, telegram_id) DO UPDATE SET
      allows_write_to_pm = true,
      updated_at = now();
  END IF;

  INSERT INTO renter_init_data_hashes (
    init_data_hash,
    organization_id,
    telegram_id,
    auth_user_id,
    renter_id
  )
  VALUES (
    v_init_hash,
    v_org,
    v_telegram,
    v_auth_user_id,
    v_renter_id
  )
  ON CONFLICT (init_data_hash) DO UPDATE SET
    auth_user_id = EXCLUDED.auth_user_id,
    renter_id = EXCLUDED.renter_id,
    created_at = now();

  RETURN jsonb_build_object(
    'success', true,
    'renter_id', v_renter_id,
    'auth_user_id', v_auth_user_id,
    'needs_create_user', v_auth_user_id IS NULL,
    'is_new_renter', NOT v_existed,
    'status', v_status,
    'idempotent', false
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.auth.forbidden');
END;
$$;

-- =============================================================================
-- 2. bind_auth — never clear an existing auth_user_id (race loser only)
-- =============================================================================

CREATE OR REPLACE FUNCTION renter_telegram_mint_bind_auth(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_telegram bigint;
  v_auth_user_id uuid;
  v_updated integer;
  v_existing uuid;
BEGIN
  v_org := NULLIF(p_payload ->> 'organization_id', '')::uuid;
  BEGIN
    v_telegram := NULLIF(p_payload ->> 'telegram_id', '')::bigint;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'bound', false);
  END;
  v_auth_user_id := NULLIF(p_payload ->> 'auth_user_id', '')::uuid;

  IF v_org IS NULL OR v_telegram IS NULL OR v_telegram <= 0 OR v_auth_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'bound', false);
  END IF;

  PERFORM pg_advisory_xact_lock(_renter_mint_lock_key(v_org, v_telegram));

  SELECT auth_user_id INTO v_existing
  FROM renters
  WHERE organization_id = v_org
    AND telegram_id = v_telegram;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', v_existing = v_auth_user_id,
      'bound', false,
      'existing_auth_user_id', v_existing
    );
  END IF;

  UPDATE renters
  SET auth_user_id = v_auth_user_id
  WHERE organization_id = v_org
    AND telegram_id = v_telegram
    AND auth_user_id IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 1 THEN
    UPDATE renter_init_data_hashes
    SET auth_user_id = v_auth_user_id
    WHERE organization_id = v_org
      AND telegram_id = v_telegram
      AND created_at > now() - interval '15 minutes';
  END IF;

  RETURN jsonb_build_object('success', v_updated = 1, 'bound', v_updated = 1);
END;
$$;

-- =============================================================================
-- 3. QR topup — server gate requires allowlisted studio chat URL
-- =============================================================================

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
  IF v_amount > 1000000 THEN
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

COMMIT;
