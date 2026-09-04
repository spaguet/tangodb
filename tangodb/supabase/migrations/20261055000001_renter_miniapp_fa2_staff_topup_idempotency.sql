-- FA2 / 2.9.36: P0-01 staff-topup — atomic idempotency claim after wallet lock, before credit.

BEGIN;

-- =============================================================================
-- 1. claim_operation_idempotency — INSERT pending row under lock; return cached/conflict
-- =============================================================================

CREATE OR REPLACE FUNCTION claim_operation_idempotency(
  p_org_id uuid,
  p_scope text,
  p_key uuid,
  p_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_claimed uuid;
  v_existing operation_idempotency%ROWTYPE;
BEGIN
  IF p_key IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO operation_idempotency (
    organization_id, scope, idempotency_key, payload_fingerprint, result_json
  )
  VALUES (
    p_org_id,
    p_scope,
    p_key,
    p_fingerprint,
    jsonb_build_object('_idempotency_pending', true)
  )
  ON CONFLICT (organization_id, scope, idempotency_key) DO NOTHING
  RETURNING idempotency_key INTO v_claimed;

  IF v_claimed IS NOT NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_existing
  FROM operation_idempotency
  WHERE organization_id = p_org_id
    AND scope = p_scope
    AND idempotency_key = p_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'idempotency_claim_race';
  END IF;

  IF v_existing.payload_fingerprint <> p_fingerprint THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'idempotency_conflict',
      'error_code', 'idempotency_conflict'
    );
  END IF;

  IF COALESCE(v_existing.result_json ->> '_idempotency_pending', 'false') = 'true' THEN
    RAISE EXCEPTION 'idempotency_in_progress';
  END IF;

  RETURN v_existing.result_json;
END;
$$;

COMMENT ON FUNCTION claim_operation_idempotency(uuid, text, uuid, text) IS
  'FA2: atomic claim after lock. NULL = proceed; jsonb = cached result or idempotency_conflict.';

-- =============================================================================
-- 2. store_operation_idempotency — complete pending claim (UPSERT when pending)
-- =============================================================================

CREATE OR REPLACE FUNCTION store_operation_idempotency(
  p_org_id uuid,
  p_scope text,
  p_key uuid,
  p_fingerprint text,
  p_result jsonb
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_key IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO operation_idempotency (
    organization_id, scope, idempotency_key, payload_fingerprint, result_json
  )
  VALUES (p_org_id, p_scope, p_key, p_fingerprint, p_result)
  ON CONFLICT (organization_id, scope, idempotency_key)
  DO UPDATE SET
    payload_fingerprint = EXCLUDED.payload_fingerprint,
    result_json = EXCLUDED.result_json
  WHERE operation_idempotency.result_json ? '_idempotency_pending';
END;
$$;

-- =============================================================================
-- 3. staff_renter_wallet_topup — claim after lock, before credit
-- =============================================================================

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

  IF v_renter IS NULL OR v_amount IS NULL OR v_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.amountInvalid');
  END IF;
  IF v_amount > 1000000 THEN
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
    v_org, v_renter, v_amount, v_method, v_member, NULL, 'staff_wallet_topup'
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

COMMENT ON FUNCTION staff_renter_wallet_topup(jsonb) IS
  'R2/FA2: staff direct wallet topup; idempotency claim after wallet lock, before credit.';

COMMIT;
