-- Follow-up: rental_advances does not store notes. Keep payload shape compatible,
-- but stop selecting/inserting a non-existent column in CRM advance RPCs.

BEGIN;

CREATE OR REPLACE FUNCTION list_renter_rental_advances(p_renter_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_financial() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', ra.id,
    'amount', ra.amount,
    'allocated_amount', ra.allocated_amount,
    'available', GREATEST(ra.amount - ra.allocated_amount, 0),
    'currency', ra.currency,
    'method', ra.method,
    'operation_date', ra.operation_date,
    'created_at', ra.created_at
  ) ORDER BY ra.operation_date DESC, ra.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM rental_advances ra
  WHERE ra.organization_id = v_org_id
    AND ra.renter_id = p_renter_id;

  RETURN jsonb_build_object('success', true, 'advances', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION record_rental_advance(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_key text := NULLIF(trim(p_payload ->> 'idempotency_key'), '');
  v_existing rental_advances%ROWTYPE;
  v_advance_id uuid;
  v_renter_id uuid := (p_payload ->> 'renter_id')::uuid;
  v_amount numeric := (p_payload ->> 'amount')::numeric;
  v_operation_date date;
  v_today date;
  v_payload_date text := NULLIF(trim(p_payload ->> 'operation_date'), '');
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_financial() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  IF v_renter_id IS NULL OR v_amount IS NULL OR v_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.advance.fieldsInvalid');
  END IF;

  v_today := _org_local_date(v_org_id);
  v_operation_date := COALESCE(
    CASE WHEN v_payload_date IS NOT NULL THEN v_payload_date::date ELSE NULL END,
    v_today
  );

  IF v_operation_date > v_today THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.operationDateFuture');
  END IF;

  IF _is_finance_period_closed(v_org_id, v_operation_date) THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.periodClosed');
  END IF;

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM rental_advances ra
    WHERE ra.organization_id = v_org_id AND ra.idempotency_key = v_key;

    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'advance_id', v_existing.id, 'already_applied', true);
    END IF;
  END IF;

  INSERT INTO rental_advances (
    organization_id, renter_id, amount, currency, method, idempotency_key, created_by, operation_date
  )
  VALUES (
    v_org_id,
    v_renter_id,
    v_amount,
    COALESCE(NULLIF(p_payload ->> 'currency', ''), 'RUB'),
    COALESCE(NULLIF(p_payload ->> 'method', ''), 'cash'),
    v_key,
    v_member_id,
    v_operation_date
  )
  RETURNING id INTO v_advance_id;

  RETURN jsonb_build_object('success', true, 'advance_id', v_advance_id);
EXCEPTION
  WHEN unique_violation THEN
    IF v_key IS NOT NULL THEN
      SELECT id INTO v_advance_id FROM rental_advances WHERE organization_id = v_org_id AND idempotency_key = v_key;
      IF v_advance_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'advance_id', v_advance_id, 'already_applied', true);
      END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.duplicate');
END;
$$;

COMMIT;
