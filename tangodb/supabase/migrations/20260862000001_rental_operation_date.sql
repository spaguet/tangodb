-- Stage 9 (hall rent audit F22): operation_date separate from created_at; finance period closing.

BEGIN;

-- =============================================================================
-- 1. Organization settings — closed finance period (last closed calendar day, inclusive)
-- =============================================================================

ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS finance_period_closed_until DATE;

COMMENT ON COLUMN organization_settings.finance_period_closed_until IS
  'Inclusive last calendar day of closed cash period in org TZ; operation_date <= this requires correction path.';

-- =============================================================================
-- 2. Centralized org-local date helpers (single TZ semantics)
-- =============================================================================

CREATE OR REPLACE FUNCTION _org_local_date(p_org_id uuid, p_ts timestamptz DEFAULT now())
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (COALESCE(p_ts, now()) AT TIME ZONE COALESCE(_org_timezone(p_org_id), 'UTC'))::date;
$$;

CREATE OR REPLACE FUNCTION _finance_period_closed_until(p_org_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT os.finance_period_closed_until
  FROM organization_settings os
  WHERE os.organization_id = p_org_id;
$$;

CREATE OR REPLACE FUNCTION _is_finance_period_closed(p_org_id uuid, p_operation_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_operation_date IS NOT NULL
    AND _finance_period_closed_until(p_org_id) IS NOT NULL
    AND p_operation_date <= _finance_period_closed_until(p_org_id);
$$;

REVOKE ALL ON FUNCTION _org_local_date(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _org_local_date(uuid, timestamptz) TO authenticated, service_role;

REVOKE ALL ON FUNCTION _finance_period_closed_until(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _finance_period_closed_until(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION _is_finance_period_closed(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _is_finance_period_closed(uuid, date) TO authenticated, service_role;

-- =============================================================================
-- 3. operation_date columns + backfill (created_at in org TZ)
-- =============================================================================

ALTER TABLE rental_payments ADD COLUMN IF NOT EXISTS operation_date DATE;

UPDATE rental_payments rp
SET operation_date = _org_local_date(rp.organization_id, rp.created_at)
WHERE rp.operation_date IS NULL;

ALTER TABLE rental_payments
  ALTER COLUMN operation_date SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rental_payments_org_operation_date
  ON rental_payments (organization_id, operation_date DESC);

ALTER TABLE rental_invoice_payments ADD COLUMN IF NOT EXISTS operation_date DATE;

UPDATE rental_invoice_payments rip
SET operation_date = _org_local_date(rip.organization_id, rip.created_at)
WHERE rip.operation_date IS NULL;

ALTER TABLE rental_invoice_payments
  ALTER COLUMN operation_date SET NOT NULL;

ALTER TABLE rental_advances ADD COLUMN IF NOT EXISTS operation_date DATE;

UPDATE rental_advances ra
SET operation_date = _org_local_date(ra.organization_id, ra.created_at)
WHERE ra.operation_date IS NULL;

ALTER TABLE rental_advances
  ALTER COLUMN operation_date SET NOT NULL;

ALTER TABLE rental_deposit_movements ADD COLUMN IF NOT EXISTS operation_date DATE;

UPDATE rental_deposit_movements rdm
SET operation_date = _org_local_date(rdm.organization_id, rdm.created_at)
WHERE rdm.operation_date IS NULL;

ALTER TABLE rental_deposit_movements
  ALTER COLUMN operation_date SET NOT NULL;

-- Bootstrap triggers for legacy INSERT paths without explicit operation_date
CREATE OR REPLACE FUNCTION rental_money_row_bootstrap_operation_date()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.operation_date IS NULL THEN
    NEW.operation_date := _org_local_date(
      NEW.organization_id,
      COALESCE(NEW.created_at, now())
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rental_payments_operation_date_trg ON rental_payments;
CREATE TRIGGER rental_payments_operation_date_trg
  BEFORE INSERT ON rental_payments
  FOR EACH ROW
  EXECUTE FUNCTION rental_money_row_bootstrap_operation_date();

DROP TRIGGER IF EXISTS rental_invoice_payments_operation_date_trg ON rental_invoice_payments;
CREATE TRIGGER rental_invoice_payments_operation_date_trg
  BEFORE INSERT ON rental_invoice_payments
  FOR EACH ROW
  EXECUTE FUNCTION rental_money_row_bootstrap_operation_date();

DROP TRIGGER IF EXISTS rental_advances_operation_date_trg ON rental_advances;
CREATE TRIGGER rental_advances_operation_date_trg
  BEFORE INSERT ON rental_advances
  FOR EACH ROW
  EXECUTE FUNCTION rental_money_row_bootstrap_operation_date();

DROP TRIGGER IF EXISTS rental_deposit_movements_operation_date_trg ON rental_deposit_movements;
CREATE TRIGGER rental_deposit_movements_operation_date_trg
  BEFORE INSERT ON rental_deposit_movements
  FOR EACH ROW
  EXECUTE FUNCTION rental_money_row_bootstrap_operation_date();

-- =============================================================================
-- 4. record_rental_payment — accept operation_date; validate open period
-- =============================================================================

CREATE OR REPLACE FUNCTION record_rental_payment(
  p_rental_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_method_comment text DEFAULT NULL,
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
  v_rental rentals%ROWTYPE;
  v_key text := NULLIF(trim(p_idempotency_key), '');
  v_existing rental_payments%ROWTYPE;
  v_payment_id uuid;
  v_new_paid numeric;
  v_effective numeric;
  v_new_status text;
  v_operation_date date;
  v_today date;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.orgReadOnly');
  END IF;

  IF NOT member_can_record_rental_payment() THEN
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
    FROM rental_payments rp
    WHERE rp.organization_id = v_org_id AND rp.idempotency_key = v_key;

    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'payment_id', v_existing.id, 'already_applied', true);
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
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.alreadyCancelled');
  END IF;

  INSERT INTO rental_payments (
    organization_id, rental_id, amount, currency, method, method_comment,
    idempotency_key, created_by, operation_date
  )
  VALUES (
    v_org_id,
    p_rental_id,
    p_amount,
    v_rental.currency,
    p_method,
    NULLIF(trim(p_method_comment), ''),
    v_key,
    v_member_id,
    v_operation_date
  )
  RETURNING id INTO v_payment_id;

  v_new_paid := _rental_paid_total(p_rental_id, v_org_id);
  v_effective := _rental_effective_amount(v_rental.fixed_amount, v_rental.final_amount);
  v_new_status := _rental_payment_status(v_effective, v_new_paid);

  UPDATE rentals SET updated_at = now() WHERE id = p_rental_id;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'paid_amount', v_new_paid,
    'payment_status', v_new_status,
    'operation_date', v_operation_date
  );
EXCEPTION
  WHEN unique_violation THEN
    IF v_key IS NOT NULL THEN
      SELECT id INTO v_payment_id FROM rental_payments WHERE organization_id = v_org_id AND idempotency_key = v_key;
      IF v_payment_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id, 'already_applied', true);
      END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.duplicate');
END;
$$;

REVOKE ALL ON FUNCTION record_rental_payment(uuid, numeric, text, text, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_rental_payment(uuid, numeric, text, text, text, date) TO authenticated;

-- =============================================================================
-- 5. Storno / correction — operation_date = org local today (correction in open period)
-- =============================================================================

CREATE OR REPLACE FUNCTION _storno_rental_payment_impl(
  p_org_id uuid,
  p_member_id uuid,
  p_payment_id uuid,
  p_amount numeric,
  p_reason_code text,
  p_reason_comment text,
  p_idempotency_key text,
  p_idempotency_scope text,
  p_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_payment rental_payments%ROWTYPE;
  v_remaining numeric;
  v_storno_amount numeric;
  v_storno_id uuid;
  v_op_num bigint;
  v_operation_date date;
BEGIN
  SELECT * INTO v_payment
  FROM rental_payments
  WHERE id = p_payment_id AND organization_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND OR v_payment.operation_kind <> 'payment' THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.paymentNotFound');
  END IF;

  v_remaining := rental_payment_remaining_amount(p_org_id, p_payment_id);

  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'corrections.rental.alreadyVoided');
  END IF;

  v_storno_amount := COALESCE(p_amount, v_remaining);

  IF v_storno_amount <= 0 OR v_storno_amount > v_remaining THEN
    RETURN jsonb_build_object('success', false, 'error', 'corrections.rental.stornoExceedsRemaining');
  END IF;

  v_op_num := next_correction_operation_number(p_org_id);
  v_operation_date := _org_local_date(p_org_id);

  INSERT INTO rental_payments (
    organization_id, rental_id, amount, currency, method, method_comment,
    created_by, operation_kind, reverses_payment_id,
    correction_reason_code, correction_comment, operation_number,
    idempotency_key, idempotency_scope, payload_fingerprint, operation_date
  )
  VALUES (
    v_payment.organization_id, v_payment.rental_id, v_storno_amount, v_payment.currency,
    v_payment.method, v_payment.method_comment,
    p_member_id, 'storno', v_payment.id,
    p_reason_code, p_reason_comment, v_op_num,
    p_idempotency_key, p_idempotency_scope, p_fingerprint, v_operation_date
  )
  RETURNING id INTO v_storno_id;

  UPDATE rentals SET updated_at = now()
  WHERE id = v_payment.rental_id AND organization_id = p_org_id;

  RETURN jsonb_build_object(
    'success', true,
    'storno_id', v_storno_id,
    'operation_number', v_op_num,
    'remaining_after', rental_payment_remaining_amount(p_org_id, p_payment_id),
    'paid_total', _rental_paid_total(v_payment.rental_id, p_org_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION correct_rental_payment(
  p_payment_id uuid,
  p_new_amount numeric,
  p_new_method text,
  p_reason_code text DEFAULT NULL,
  p_reason_comment text DEFAULT NULL,
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
  v_payment rental_payments%ROWTYPE;
  v_key text := NULLIF(trim(p_idempotency_key), '');
  v_storno_id uuid;
  v_new_payment_id uuid;
  v_op_num bigint;
  v_fingerprint text;
  v_cached jsonb;
  v_result jsonb;
  v_storno_result jsonb;
  v_operation_date date;
BEGIN
  v_fingerprint := md5(
    coalesce(p_payment_id::text, '') || '|rental_correct|' ||
    coalesce(p_new_amount::text, '') || '|' ||
    coalesce(p_new_method, '') || '|' ||
    coalesce(p_reason_code, '')
  );

  v_cached := check_operation_idempotency(v_org_id, 'correct_rental_payment', v_key::uuid, v_fingerprint);
  IF v_cached IS NOT NULL THEN
    IF (v_cached ->> 'success')::boolean IS NOT TRUE AND v_cached ->> 'error_code' = 'idempotency_conflict' THEN
      RETURN v_cached;
    END IF;
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT member_can_correct_payments() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  IF p_reason_code IS NULL OR trim(p_reason_code) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'corrections.payment.reasonRequired');
  END IF;

  IF p_new_amount IS NULL OR p_new_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'corrections.payment.amountInvalid');
  END IF;

  IF p_new_method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.paymentMethodInvalid');
  END IF;

  SELECT * INTO v_payment
  FROM rental_payments
  WHERE id = p_payment_id AND organization_id = v_org_id;

  IF NOT FOUND OR v_payment.operation_kind <> 'payment' THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.paymentNotFound');
  END IF;

  IF rental_payment_remaining_amount(v_org_id, p_payment_id) <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'corrections.rental.alreadyVoided');
  END IF;

  v_storno_result := _storno_rental_payment_impl(
    v_org_id, v_member_id, p_payment_id, NULL,
    p_reason_code, p_reason_comment,
    v_key, 'correct_rental_payment_storno', v_fingerprint || ':storno'
  );

  IF (v_storno_result ->> 'success')::boolean IS NOT TRUE THEN
    RETURN v_storno_result;
  END IF;

  v_storno_id := (v_storno_result ->> 'storno_id')::uuid;
  v_op_num := next_correction_operation_number(v_org_id);
  v_operation_date := _org_local_date(v_org_id);

  INSERT INTO rental_payments (
    organization_id, rental_id, amount, currency, method, method_comment,
    created_by, operation_kind, replaces_payment_id,
    correction_reason_code, correction_comment, operation_number,
    idempotency_key, idempotency_scope, payload_fingerprint, operation_date
  )
  VALUES (
    v_payment.organization_id, v_payment.rental_id, p_new_amount, v_payment.currency,
    p_new_method, p_reason_comment,
    v_member_id, 'payment', v_payment.id,
    p_reason_code, p_reason_comment, v_op_num,
    v_key, 'correct_rental_payment', v_fingerprint || ':payment', v_operation_date
  )
  RETURNING id INTO v_new_payment_id;

  UPDATE rentals SET updated_at = now()
  WHERE id = v_payment.rental_id AND organization_id = v_org_id;

  v_result := jsonb_build_object(
    'success', true,
    'payment_id', v_new_payment_id,
    'storno_id', v_storno_id,
    'operation_number', v_op_num,
    'paid_total', _rental_paid_total(v_payment.rental_id, v_org_id)
  );

  IF v_key IS NOT NULL THEN
    PERFORM store_operation_idempotency(v_org_id, 'correct_rental_payment', v_key::uuid, v_fingerprint, v_result);
  END IF;

  RETURN v_result;
END;
$$;

-- =============================================================================
-- 6. Unified money register — canonical operation_date column
-- =============================================================================

CREATE OR REPLACE VIEW rental_money_register_v
WITH (security_invoker = true)
AS
SELECT
  rp.organization_id,
  ('rental_payments:' || rp.id::text) AS register_key,
  rp.id AS entry_id,
  CASE
    WHEN rp.operation_kind = 'storno' THEN 'direct_booking_storno'
    ELSE 'direct_booking_payment'
  END::text AS entry_type,
  'rental_payments'::text AS source_table,
  rp.id AS source_id,
  CASE
    WHEN rp.operation_kind = 'storno' THEN (-rp.amount)::numeric(14, 2)
    ELSE rp.amount::numeric(14, 2)
  END AS signed_amount,
  rp.currency,
  rp.method,
  rp.method_comment,
  r.renter_id,
  rp.rental_id,
  NULL::uuid AS invoice_id,
  NULL::uuid AS advance_id,
  NULL::uuid AS deposit_id,
  rp.created_by,
  rp.created_at AS operation_ts,
  rp.operation_date,
  r.rental_date,
  r.location_id,
  ren.display_name AS renter_display,
  rp.operation_kind,
  rp.reverses_payment_id,
  rp.replaces_payment_id,
  rp.correction_reason_code,
  rp.correction_comment,
  rp.operation_number
FROM rental_payments rp
JOIN rentals r
  ON r.id = rp.rental_id
 AND r.organization_id = rp.organization_id
JOIN renters ren
  ON ren.id = r.renter_id
 AND ren.organization_id = r.organization_id

UNION ALL

SELECT
  rip.organization_id,
  ('rental_invoice_payments:' || rip.id::text),
  rip.id,
  'invoice_payment',
  'rental_invoice_payments',
  rip.id,
  rip.amount::numeric(14, 2),
  rip.currency,
  rip.method,
  NULL::text,
  ri.renter_id,
  NULL::uuid,
  rip.invoice_id,
  NULL::uuid,
  NULL::uuid,
  rip.created_by,
  rip.created_at,
  rip.operation_date,
  NULL::date,
  NULL::uuid,
  ren.display_name,
  'payment'::text,
  NULL::uuid,
  NULL::uuid,
  NULL::text,
  NULL::text,
  NULL::bigint
FROM rental_invoice_payments rip
JOIN rental_invoices ri
  ON ri.id = rip.invoice_id
 AND ri.organization_id = rip.organization_id
JOIN renters ren
  ON ren.id = ri.renter_id
 AND ren.organization_id = ri.organization_id

UNION ALL

SELECT
  ra.organization_id,
  ('rental_advances:' || ra.id::text),
  ra.id,
  'advance_received',
  'rental_advances',
  ra.id,
  ra.amount::numeric(14, 2),
  ra.currency,
  ra.method,
  NULL::text,
  ra.renter_id,
  NULL::uuid,
  NULL::uuid,
  ra.id,
  NULL::uuid,
  ra.created_by,
  ra.created_at,
  ra.operation_date,
  NULL::date,
  NULL::uuid,
  ren.display_name,
  'payment'::text,
  NULL::uuid,
  NULL::uuid,
  NULL::text,
  NULL::text,
  NULL::bigint
FROM rental_advances ra
JOIN renters ren
  ON ren.id = ra.renter_id
 AND ren.organization_id = ra.organization_id

UNION ALL

SELECT
  rdm.organization_id,
  ('rental_deposit_movements:' || rdm.id::text),
  rdm.id,
  'deposit_receive',
  'rental_deposit_movements',
  rdm.id,
  rdm.amount::numeric(14, 2),
  rd.currency,
  'other'::text,
  rdm.reason,
  rd.renter_id,
  NULL::uuid,
  rdm.invoice_id,
  NULL::uuid,
  rdm.deposit_id,
  rdm.created_by,
  rdm.created_at,
  rdm.operation_date,
  NULL::date,
  NULL::uuid,
  ren.display_name,
  'payment'::text,
  NULL::uuid,
  NULL::uuid,
  NULL::text,
  NULL::text,
  NULL::bigint
FROM rental_deposit_movements rdm
JOIN rental_deposits rd
  ON rd.id = rdm.deposit_id
 AND rd.organization_id = rdm.organization_id
JOIN renters ren
  ON ren.id = rd.renter_id
 AND ren.organization_id = rd.organization_id
WHERE rdm.movement_type = 'receive'

UNION ALL

SELECT
  rdm.organization_id,
  ('rental_deposit_movements:' || rdm.id::text),
  rdm.id,
  'deposit_return',
  'rental_deposit_movements',
  rdm.id,
  (-rdm.amount)::numeric(14, 2),
  rd.currency,
  'other'::text,
  rdm.reason,
  rd.renter_id,
  NULL::uuid,
  rdm.invoice_id,
  NULL::uuid,
  rdm.deposit_id,
  rdm.created_by,
  rdm.created_at,
  rdm.operation_date,
  NULL::date,
  NULL::uuid,
  ren.display_name,
  'payment'::text,
  NULL::uuid,
  NULL::uuid,
  NULL::text,
  NULL::text,
  NULL::bigint
FROM rental_deposit_movements rdm
JOIN rental_deposits rd
  ON rd.id = rdm.deposit_id
 AND rd.organization_id = rdm.organization_id
JOIN renters ren
  ON ren.id = rd.renter_id
 AND ren.organization_id = rd.organization_id
WHERE rdm.movement_type = 'return';

-- =============================================================================
-- 7. get_rental_detail — expose operation_date in payment history
-- =============================================================================

CREATE OR REPLACE FUNCTION get_rental_detail(p_rental_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_sensitive boolean;
  v_can_cash boolean;
  v_rental rentals%ROWTYPE;
  v_renter renters%ROWTYPE;
  v_paid numeric;
  v_effective numeric;
  v_payments jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_operational() AND current_member_role() <> 'teacher' THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  SELECT * INTO v_rental FROM rentals r WHERE r.id = p_rental_id AND r.organization_id = v_org_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.notFound');
  END IF;

  SELECT * INTO v_renter FROM renters ren WHERE ren.id = v_rental.renter_id AND ren.organization_id = v_org_id;
  v_sensitive := member_can_see_rental_sensitive();
  v_can_cash := member_can_record_rental_payment();
  v_paid := _rental_paid_total(p_rental_id, v_org_id);
  v_effective := _rental_effective_amount(v_rental.fixed_amount, v_rental.final_amount);

  IF v_can_cash THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', rp.id,
      'amount', rp.amount,
      'currency', rp.currency,
      'method', rp.method,
      'method_comment', rp.method_comment,
      'created_at', rp.created_at,
      'operation_date', rp.operation_date,
      'created_by', rp.created_by,
      'operation_kind', rp.operation_kind,
      'reverses_payment_id', rp.reverses_payment_id,
      'replaces_payment_id', rp.replaces_payment_id,
      'correction_reason_code', rp.correction_reason_code,
      'correction_comment', rp.correction_comment,
      'operation_number', rp.operation_number,
      'remaining_amount', rental_payment_remaining_amount(v_org_id, rp.id),
      'correction_status', rental_payment_correction_status(v_org_id, coalesce(rp.reverses_payment_id, rp.id))
    ) ORDER BY rp.created_at), '[]'::jsonb)
    INTO v_payments
    FROM rental_payments rp
    WHERE rp.rental_id = p_rental_id AND rp.organization_id = v_org_id;
  ELSE
    v_payments := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'rental', jsonb_build_object(
      'id', v_rental.id,
      'rental_date', v_rental.rental_date,
      'time_start', v_rental.time_start,
      'time_end', v_rental.time_end,
      'location_id', v_rental.location_id,
      'rental_series_id', v_rental.rental_series_id,
      'booking_status', v_rental.booking_status,
      'purpose', CASE WHEN v_sensitive THEN v_rental.purpose ELSE NULL END,
      'internal_comment', CASE WHEN v_sensitive THEN v_rental.internal_comment ELSE NULL END,
      'fixed_amount', CASE WHEN v_sensitive THEN v_effective ELSE NULL END,
      'calculated_amount', CASE WHEN v_sensitive AND can_read_financial() THEN v_rental.calculated_amount ELSE NULL END,
      'currency', CASE WHEN v_sensitive THEN v_rental.currency ELSE NULL END,
      'paid_amount', CASE WHEN v_sensitive THEN v_paid ELSE NULL END,
      'payment_status', CASE WHEN v_sensitive THEN _rental_payment_status(v_effective, v_paid) ELSE NULL END,
      'cancelled_at', v_rental.cancelled_at,
      'cancelled_reason', CASE WHEN v_sensitive THEN v_rental.cancelled_reason ELSE NULL END
    ),
    'renter', jsonb_build_object(
      'id', v_renter.id,
      'display_name', CASE WHEN v_sensitive THEN v_renter.display_name ELSE NULL END,
      'contact_phone', CASE WHEN v_sensitive AND can_read_financial() THEN v_renter.contact_phone ELSE NULL END,
      'contact_email', CASE WHEN v_sensitive AND can_read_financial() THEN v_renter.contact_email ELSE NULL END
    ),
    'payments', v_payments
  );
END;
$$;

COMMIT;
