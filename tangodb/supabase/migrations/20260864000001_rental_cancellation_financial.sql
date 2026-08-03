-- Stage 11 (hall rent audit): financial action on rental cancellation (F26).
-- Extends cancel_rental and cancel_rental_series_occurrence with refund / transfer_to_advance;
-- reuses storno (stage 8) and advance register (stage 5/10).

BEGIN;

-- =============================================================================
-- 1. Schema — audit columns + expanded financial_action enum
-- =============================================================================

ALTER TABLE rentals
  ADD COLUMN IF NOT EXISTS cancel_financial_action TEXT,
  ADD COLUMN IF NOT EXISTS cancel_penalty_amount NUMERIC(12, 2);

ALTER TABLE rental_series_exceptions
  DROP CONSTRAINT IF EXISTS rental_series_exceptions_financial_action_check;

ALTER TABLE rental_series_exceptions
  ADD CONSTRAINT rental_series_exceptions_financial_action_check
  CHECK (
    financial_action IN (
      'none', 'full_penalty', 'partial_penalty', 'manual',
      'refund', 'transfer_to_advance'
    )
  );

-- =============================================================================
-- 2. Helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION _rental_cancel_financial_action_valid(p_action text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_action IN (
    'none', 'full_penalty', 'partial_penalty', 'manual',
    'refund', 'transfer_to_advance'
  );
$$;

CREATE OR REPLACE FUNCTION _storno_all_rental_payments_for_cancel(
  p_org_id uuid,
  p_member_id uuid,
  p_rental_id uuid,
  p_reason_code text,
  p_reason_comment text,
  p_scope_prefix text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_payment rental_payments%ROWTYPE;
  v_result jsonb;
  v_total numeric := 0;
  v_idx int := 0;
  v_remaining numeric;
BEGIN
  FOR v_payment IN
    SELECT *
    FROM rental_payments rp
    WHERE rp.organization_id = p_org_id
      AND rp.rental_id = p_rental_id
      AND rp.operation_kind = 'payment'
      AND rental_payment_remaining_amount(p_org_id, rp.id) > 0
    ORDER BY rp.created_at, rp.id
    FOR UPDATE
  LOOP
    v_remaining := rental_payment_remaining_amount(p_org_id, v_payment.id);
    IF v_remaining <= 0 THEN
      CONTINUE;
    END IF;

    v_idx := v_idx + 1;
    v_result := _storno_rental_payment_impl(
      p_org_id,
      p_member_id,
      v_payment.id,
      NULL,
      p_reason_code,
      p_reason_comment,
      NULL,
      p_scope_prefix || ':storno:' || v_idx::text,
      md5(p_rental_id::text || '|cancel_storno|' || v_payment.id::text)
    );

    IF (v_result ->> 'success')::boolean IS NOT TRUE THEN
      RETURN v_result;
    END IF;

    v_total := v_total + v_remaining;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'refunded_total', v_total,
    'paid_total', _rental_paid_total(p_rental_id, p_org_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION _apply_rental_cancellation_financial(
  p_org_id uuid,
  p_member_id uuid,
  p_rental_id uuid,
  p_financial_action text,
  p_penalty_amount numeric,
  p_reason text,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_paid numeric;
  v_effective numeric;
  v_final numeric;
  v_storno_result jsonb;
  v_advance_id uuid;
  v_refunded numeric;
  v_key text := NULLIF(trim(p_idempotency_key), '');
  v_today date;
  v_rental rentals%ROWTYPE;
BEGIN
  SELECT * INTO v_rental
  FROM rentals r
  WHERE r.id = p_rental_id AND r.organization_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.notFound');
  END IF;

  IF NOT _rental_cancel_financial_action_valid(p_financial_action) THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.cancel.financialActionInvalid');
  END IF;

  v_paid := _rental_paid_total(v_rental.id, p_org_id);
  v_effective := _rental_effective_amount(v_rental.fixed_amount, v_rental.final_amount);

  IF p_financial_action IN ('refund', 'transfer_to_advance') THEN
    IF NOT member_can_correct_payments() THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
    END IF;
    IF v_paid <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'rental.cancel.noPaymentsToRefund');
    END IF;
  END IF;

  IF p_financial_action = 'none' AND v_paid > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.cancel.paidRequiresRefundOrAdvance');
  END IF;

  IF p_financial_action = 'refund' THEN
    v_storno_result := _storno_all_rental_payments_for_cancel(
      p_org_id, p_member_id, v_rental.id,
      'cancellation_refund', p_reason,
      COALESCE(v_key, v_rental.id::text) || ':cancel_refund'
    );
    IF (v_storno_result ->> 'success')::boolean IS NOT TRUE THEN
      RETURN v_storno_result;
    END IF;
    v_refunded := COALESCE((v_storno_result ->> 'refunded_total')::numeric, 0);

    UPDATE rentals
    SET final_amount = 0, fixed_amount = 0, adjustment_amount = 0, updated_at = now()
    WHERE id = v_rental.id AND organization_id = p_org_id;

  ELSIF p_financial_action = 'transfer_to_advance' THEN
    v_storno_result := _storno_all_rental_payments_for_cancel(
      p_org_id, p_member_id, v_rental.id,
      'cancellation_advance', p_reason,
      COALESCE(v_key, v_rental.id::text) || ':cancel_advance_storno'
    );
    IF (v_storno_result ->> 'success')::boolean IS NOT TRUE THEN
      RETURN v_storno_result;
    END IF;
    v_refunded := COALESCE((v_storno_result ->> 'refunded_total')::numeric, 0);

    IF v_refunded <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'rental.cancel.noPaymentsToRefund');
    END IF;

    v_today := _org_local_date(p_org_id);

    IF v_key IS NOT NULL AND EXISTS (
      SELECT 1 FROM rental_advances ra
      WHERE ra.organization_id = p_org_id AND ra.idempotency_key = v_key || ':advance'
    ) THEN
      SELECT id INTO v_advance_id
      FROM rental_advances
      WHERE organization_id = p_org_id AND idempotency_key = v_key || ':advance';
    ELSE
      INSERT INTO rental_advances (
        organization_id, renter_id, amount, currency, method,
        idempotency_key, created_by, notes, operation_date
      )
      VALUES (
        p_org_id,
        v_rental.renter_id,
        v_refunded,
        COALESCE(v_rental.currency, 'RUB'),
        'other',
        CASE WHEN v_key IS NOT NULL THEN v_key || ':advance' ELSE NULL END,
        p_member_id,
        'Cancellation advance: ' || left(trim(p_reason), 200),
        v_today
      )
      RETURNING id INTO v_advance_id;
    END IF;

    UPDATE rentals
    SET final_amount = 0, fixed_amount = 0, adjustment_amount = 0, updated_at = now()
    WHERE id = v_rental.id AND organization_id = p_org_id;

  ELSIF p_financial_action = 'none' THEN
    UPDATE rentals
    SET final_amount = 0, fixed_amount = 0, adjustment_amount = 0, updated_at = now()
    WHERE id = v_rental.id AND organization_id = p_org_id;

  ELSIF p_financial_action = 'full_penalty' THEN
    v_final := v_effective;
    UPDATE rentals
    SET final_amount = v_final, fixed_amount = v_final, updated_at = now()
    WHERE id = v_rental.id AND organization_id = p_org_id;

  ELSIF p_financial_action = 'partial_penalty' THEN
    IF p_penalty_amount IS NULL OR p_penalty_amount <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'rental.series.penaltyInvalid');
    END IF;
    UPDATE rentals
    SET final_amount = p_penalty_amount, fixed_amount = p_penalty_amount, updated_at = now()
    WHERE id = v_rental.id AND organization_id = p_org_id;

  END IF;
  -- manual: no amount/payment changes

  UPDATE rentals
  SET
    cancel_financial_action = p_financial_action,
    cancel_penalty_amount = CASE
      WHEN p_financial_action = 'partial_penalty' THEN p_penalty_amount
      WHEN p_financial_action = 'full_penalty' THEN v_effective
      ELSE NULL
    END,
    updated_at = now()
  WHERE id = v_rental.id AND organization_id = p_org_id;

  RETURN jsonb_build_object(
    'success', true,
    'financial_action', p_financial_action,
    'paid_total', _rental_paid_total(v_rental.id, p_org_id),
    'effective_amount', _rental_effective_amount(
      (SELECT fixed_amount FROM rentals WHERE id = v_rental.id AND organization_id = p_org_id),
      (SELECT final_amount FROM rentals WHERE id = v_rental.id AND organization_id = p_org_id)
    ),
    'advance_id', v_advance_id,
    'refunded_total', v_refunded
  );
END;
$$;

-- =============================================================================
-- 3. cancel_rental — financial action support
-- =============================================================================

DROP FUNCTION IF EXISTS cancel_rental(uuid, text);

CREATE OR REPLACE FUNCTION cancel_rental(
  p_rental_id uuid,
  p_reason text,
  p_financial_action text DEFAULT 'none',
  p_penalty_amount numeric DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_rental rentals%ROWTYPE;
  v_fin_result jsonb;
  v_key text := NULLIF(trim(p_idempotency_key), '');
  v_cached jsonb;
  v_fingerprint text;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT member_can_manage_rentals() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
  END IF;

  IF NULLIF(trim(p_reason), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.cancelReasonRequired');
  END IF;

  IF NOT _rental_cancel_financial_action_valid(COALESCE(p_financial_action, 'none')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.cancel.financialActionInvalid');
  END IF;

  v_fingerprint := md5(
    coalesce(p_rental_id::text, '') || '|cancel_rental|' ||
    coalesce(p_financial_action, 'none') || '|' ||
    coalesce(p_penalty_amount::text, '') || '|' ||
    trim(p_reason)
  );

  IF v_key IS NOT NULL THEN
    v_cached := check_operation_idempotency(v_org_id, 'cancel_rental', v_key::uuid, v_fingerprint);
    IF v_cached IS NOT NULL THEN
      IF (v_cached ->> 'success')::boolean IS NOT TRUE AND v_cached ->> 'error_code' = 'idempotency_conflict' THEN
        RETURN v_cached;
      END IF;
      RETURN v_cached || jsonb_build_object('already_applied', true);
    END IF;
  END IF;

  SELECT * INTO v_rental
  FROM rentals r
  WHERE r.id = p_rental_id AND r.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.notFound');
  END IF;

  IF v_rental.booking_status = 'cancelled' THEN
    RETURN jsonb_build_object('success', true, 'already_applied', true);
  END IF;

  v_fin_result := _apply_rental_cancellation_financial(
    v_org_id,
    v_member_id,
    p_rental_id,
    COALESCE(p_financial_action, 'none'),
    p_penalty_amount,
    trim(p_reason),
    v_key
  );

  IF (v_fin_result ->> 'success')::boolean IS NOT TRUE THEN
    RETURN v_fin_result;
  END IF;

  UPDATE rentals
  SET
    booking_status = 'cancelled',
    cancelled_at = now(),
    cancelled_reason = trim(p_reason),
    cancelled_by = v_member_id,
    updated_at = now()
  WHERE id = p_rental_id;

  v_fin_result := v_fin_result || jsonb_build_object(
    'success', true,
    'rental_id', p_rental_id
  );

  IF v_key IS NOT NULL THEN
    PERFORM store_operation_idempotency(v_org_id, 'cancel_rental', v_key::uuid, v_fingerprint, v_fin_result);
  END IF;

  RETURN v_fin_result;
END;
$$;

-- =============================================================================
-- 4. cancel_rental_series_occurrence — refund / advance
-- =============================================================================

CREATE OR REPLACE FUNCTION cancel_rental_series_occurrence(
  p_series_id uuid,
  p_date date,
  p_reason text,
  p_financial_action text DEFAULT 'none',
  p_penalty_amount numeric DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_series rental_series%ROWTYPE;
  v_rental rentals%ROWTYPE;
  v_fin_result jsonb;
  v_key text := NULLIF(trim(p_idempotency_key), '');
  v_cached jsonb;
  v_fingerprint text;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT member_can_manage_rentals() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
  END IF;

  IF NULLIF(trim(p_reason), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.cancelReasonRequired');
  END IF;

  IF NOT _rental_cancel_financial_action_valid(COALESCE(p_financial_action, 'none')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.cancel.financialActionInvalid');
  END IF;

  v_fingerprint := md5(
    coalesce(p_series_id::text, '') || '|' || coalesce(p_date::text, '') ||
    '|cancel_series_occ|' || coalesce(p_financial_action, 'none') || '|' ||
    coalesce(p_penalty_amount::text, '') || '|' || trim(p_reason)
  );

  IF v_key IS NOT NULL THEN
    v_cached := check_operation_idempotency(v_org_id, 'cancel_rental_series_occurrence', v_key::uuid, v_fingerprint);
    IF v_cached IS NOT NULL THEN
      IF (v_cached ->> 'success')::boolean IS NOT TRUE AND v_cached ->> 'error_code' = 'idempotency_conflict' THEN
        RETURN v_cached;
      END IF;
      RETURN v_cached || jsonb_build_object('already_applied', true);
    END IF;
  END IF;

  SELECT * INTO v_series
  FROM rental_series rs
  WHERE rs.id = p_series_id AND rs.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.series.notFound');
  END IF;

  IF EXISTS (
    SELECT 1 FROM rental_series_exceptions e
    WHERE e.series_id = p_series_id AND e.organization_id = v_org_id AND e.exception_date = p_date
  ) THEN
    RETURN jsonb_build_object('success', true, 'already_applied', true);
  END IF;

  SELECT * INTO v_rental
  FROM rentals r
  WHERE r.organization_id = v_org_id
    AND r.rental_series_id = p_series_id
    AND r.rental_date = p_date
    AND r.booking_status = 'confirmed'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.series.occurrenceNotFound');
  END IF;

  v_fin_result := _apply_rental_cancellation_financial(
    v_org_id,
    v_member_id,
    v_rental.id,
    COALESCE(p_financial_action, 'none'),
    p_penalty_amount,
    trim(p_reason),
    v_key
  );

  IF (v_fin_result ->> 'success')::boolean IS NOT TRUE THEN
    RETURN v_fin_result;
  END IF;

  INSERT INTO rental_series_exceptions (
    organization_id, series_id, exception_date, reason,
    financial_action, penalty_amount, cancelled_by
  )
  VALUES (
    v_org_id, p_series_id, p_date, trim(p_reason),
    COALESCE(p_financial_action, 'none'),
    CASE
      WHEN COALESCE(p_financial_action, 'none') = 'full_penalty'
        THEN _rental_effective_amount(v_rental.fixed_amount, v_rental.final_amount)
      WHEN COALESCE(p_financial_action, 'none') = 'partial_penalty' THEN p_penalty_amount
      ELSE NULL
    END,
    v_member_id
  );

  UPDATE rentals
  SET
    booking_status = 'cancelled',
    cancelled_at = now(),
    cancelled_reason = trim(p_reason),
    cancelled_by = v_member_id,
    updated_at = now()
  WHERE id = v_rental.id;

  v_fin_result := v_fin_result || jsonb_build_object(
    'success', true,
    'rental_id', v_rental.id,
    'series_id', p_series_id
  );

  IF v_key IS NOT NULL THEN
    PERFORM store_operation_idempotency(
      v_org_id, 'cancel_rental_series_occurrence', v_key::uuid, v_fingerprint, v_fin_result
    );
  END IF;

  RETURN v_fin_result;
END;
$$;

REVOKE ALL ON FUNCTION cancel_rental(uuid, text, text, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_rental(uuid, text, text, numeric, text) TO authenticated;

REVOKE ALL ON FUNCTION cancel_rental_series_occurrence(uuid, date, text, text, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_rental_series_occurrence(uuid, date, text, text, numeric, text) TO authenticated;

COMMIT;
