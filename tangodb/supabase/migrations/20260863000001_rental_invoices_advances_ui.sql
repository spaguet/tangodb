-- Stage 10 (hall rent audit F20, F23): list advances/allocations, accrual report,
-- operation_date on invoice payment and advance RPCs.

BEGIN;

-- =============================================================================
-- 1. List advances for renter
-- =============================================================================

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
    'notes', ra.notes,
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

-- =============================================================================
-- 2. List advance allocations (incl. cancelled) for renter
-- =============================================================================

CREATE OR REPLACE FUNCTION list_renter_rental_advance_allocations(p_renter_id uuid)
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
    'id', raa.id,
    'advance_id', raa.advance_id,
    'invoice_id', raa.invoice_id,
    'invoice_period_start', ri.period_start,
    'invoice_period_end', ri.period_end,
    'amount', raa.amount,
    'allocated_at', raa.allocated_at,
    'cancelled_at', raa.cancelled_at,
    'allocated_by', raa.allocated_by
  ) ORDER BY raa.allocated_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM rental_advance_allocations raa
  JOIN rental_advances ra
    ON ra.id = raa.advance_id
   AND ra.organization_id = raa.organization_id
  JOIN rental_invoices ri
    ON ri.id = raa.invoice_id
   AND ri.organization_id = raa.organization_id
  WHERE raa.organization_id = v_org_id
    AND ra.renter_id = p_renter_id;

  RETURN jsonb_build_object('success', true, 'allocations', v_rows);
END;
$$;

-- =============================================================================
-- 3. Accrual report (service date vs payment date vs advances)
-- =============================================================================

CREATE OR REPLACE FUNCTION get_rental_accrual_report(
  p_period_start date,
  p_period_end date,
  p_renter_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_accrued numeric := 0;
  v_paid_direct numeric := 0;
  v_paid_invoice numeric := 0;
  v_advances_received numeric := 0;
  v_advances_allocated numeric := 0;
  v_invoice_debt numeric := 0;
  v_uninvoiced_debt numeric := 0;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_financial() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_start > p_period_end THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.accrual.periodInvalid');
  END IF;

  SELECT COALESCE(sum(_rental_effective_amount(r.fixed_amount, r.final_amount)), 0)
  INTO v_accrued
  FROM rentals r
  WHERE r.organization_id = v_org_id
    AND r.booking_status = 'confirmed'
    AND r.rental_date >= p_period_start
    AND r.rental_date <= p_period_end
    AND (p_renter_id IS NULL OR r.renter_id = p_renter_id);

  SELECT COALESCE(sum(rp.amount), 0)
  INTO v_paid_direct
  FROM rental_payments rp
  JOIN rentals r ON r.id = rp.rental_id AND r.organization_id = rp.organization_id
  WHERE rp.organization_id = v_org_id
    AND rp.operation_date >= p_period_start
    AND rp.operation_date <= p_period_end
    AND (p_renter_id IS NULL OR r.renter_id = p_renter_id);

  SELECT COALESCE(sum(rip.amount), 0)
  INTO v_paid_invoice
  FROM rental_invoice_payments rip
  JOIN rental_invoices ri ON ri.id = rip.invoice_id AND ri.organization_id = rip.organization_id
  WHERE rip.organization_id = v_org_id
    AND rip.operation_date >= p_period_start
    AND rip.operation_date <= p_period_end
    AND (p_renter_id IS NULL OR ri.renter_id = p_renter_id);

  SELECT COALESCE(sum(ra.amount), 0)
  INTO v_advances_received
  FROM rental_advances ra
  WHERE ra.organization_id = v_org_id
    AND ra.operation_date >= p_period_start
    AND ra.operation_date <= p_period_end
    AND (p_renter_id IS NULL OR ra.renter_id = p_renter_id);

  SELECT COALESCE(sum(raa.amount), 0)
  INTO v_advances_allocated
  FROM rental_advance_allocations raa
  JOIN rental_advances ra ON ra.id = raa.advance_id AND ra.organization_id = raa.organization_id
  WHERE raa.organization_id = v_org_id
    AND raa.cancelled_at IS NULL
    AND (raa.allocated_at AT TIME ZONE COALESCE(_org_timezone(v_org_id), 'UTC'))::date >= p_period_start
    AND (raa.allocated_at AT TIME ZONE COALESCE(_org_timezone(v_org_id), 'UTC'))::date <= p_period_end
    AND (p_renter_id IS NULL OR ra.renter_id = p_renter_id);

  SELECT COALESCE(sum(GREATEST(ri.total_amount - _rental_invoice_paid_total(ri.id, ri.organization_id), 0)), 0)
  INTO v_invoice_debt
  FROM rental_invoices ri
  WHERE ri.organization_id = v_org_id
    AND ri.status <> 'cancelled'
    AND (p_renter_id IS NULL OR ri.renter_id = p_renter_id);

  SELECT COALESCE(sum(GREATEST(_rental_effective_amount(r.fixed_amount, r.final_amount) - _rental_paid_total(r.id, r.organization_id), 0)), 0)
  INTO v_uninvoiced_debt
  FROM rentals r
  WHERE r.organization_id = v_org_id
    AND r.booking_status = 'confirmed'
    AND NOT _rental_is_in_active_invoice(r.id, v_org_id)
    AND (p_renter_id IS NULL OR r.renter_id = p_renter_id);

  RETURN jsonb_build_object(
    'success', true,
    'report', jsonb_build_object(
      'period_start', p_period_start,
      'period_end', p_period_end,
      'renter_id', p_renter_id,
      'accrued_amount', v_accrued,
      'paid_direct', v_paid_direct,
      'paid_invoice', v_paid_invoice,
      'paid_total', v_paid_direct + v_paid_invoice,
      'advances_received', v_advances_received,
      'advances_allocated', v_advances_allocated,
      'invoice_debt', v_invoice_debt,
      'uninvoiced_debt', v_uninvoiced_debt,
      'total_debt', v_invoice_debt + v_uninvoiced_debt
    )
  );
END;
$$;

-- =============================================================================
-- 4. record_rental_invoice_payment — operation_date
-- =============================================================================

CREATE OR REPLACE FUNCTION record_rental_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_idempotency_key text DEFAULT NULL,
  p_operation_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_key text := NULLIF(trim(p_idempotency_key), '');
  v_invoice rental_invoices%ROWTYPE;
  v_existing rental_invoice_payments%ROWTYPE;
  v_payment_id uuid;
  v_paid numeric;
  v_status text;
  v_operation_date date;
  v_today date;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_financial() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.paymentAmountInvalid');
  END IF;

  IF p_method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.paymentMethodInvalid');
  END IF;

  v_today := _org_local_date(v_org_id);
  v_operation_date := COALESCE(p_operation_date, v_today);

  IF v_operation_date > v_today THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.operationDateFuture');
  END IF;

  IF _is_finance_period_closed(v_org_id, v_operation_date) THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.periodClosed');
  END IF;

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM rental_invoice_payments rip
    WHERE rip.organization_id = v_org_id AND rip.idempotency_key = v_key;

    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'payment_id', v_existing.id, 'already_applied', true);
    END IF;
  END IF;

  SELECT * INTO v_invoice
  FROM rental_invoices ri
  WHERE ri.id = p_invoice_id AND ri.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.invoice.notFound');
  END IF;

  IF v_invoice.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.invoice.cancelled');
  END IF;

  INSERT INTO rental_invoice_payments (
    organization_id, invoice_id, amount, currency, method, idempotency_key, created_by, operation_date
  )
  VALUES (
    v_org_id, p_invoice_id, p_amount, v_invoice.currency, p_method, v_key, v_member_id, v_operation_date
  )
  RETURNING id INTO v_payment_id;

  v_paid := _rental_invoice_paid_total(p_invoice_id, v_org_id);
  v_status := _rental_invoice_status(v_invoice.total_amount, v_paid, v_invoice.due_date, v_invoice.status);

  UPDATE rental_invoices
  SET status = v_status, updated_at = now()
  WHERE id = p_invoice_id;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'paid_amount', v_paid,
    'status', v_status
  );
EXCEPTION
  WHEN unique_violation THEN
    IF v_key IS NOT NULL THEN
      SELECT id INTO v_payment_id FROM rental_invoice_payments WHERE organization_id = v_org_id AND idempotency_key = v_key;
      IF v_payment_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id, 'already_applied', true);
      END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.duplicate');
END;
$$;

-- =============================================================================
-- 5. record_rental_advance — operation_date in payload
-- =============================================================================

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
    organization_id, renter_id, amount, currency, method, idempotency_key, created_by, notes, operation_date
  )
  VALUES (
    v_org_id,
    v_renter_id,
    v_amount,
    COALESCE(NULLIF(p_payload ->> 'currency', ''), 'RUB'),
    COALESCE(NULLIF(p_payload ->> 'method', ''), 'cash'),
    v_key,
    v_member_id,
    NULLIF(trim(p_payload ->> 'notes'), ''),
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

REVOKE ALL ON FUNCTION list_renter_rental_advances(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_renter_rental_advances(uuid) TO authenticated;

REVOKE ALL ON FUNCTION list_renter_rental_advance_allocations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_renter_rental_advance_allocations(uuid) TO authenticated;

REVOKE ALL ON FUNCTION get_rental_accrual_report(date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_rental_accrual_report(date, date, uuid) TO authenticated;

COMMIT;
