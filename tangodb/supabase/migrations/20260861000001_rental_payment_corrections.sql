-- Stage 8 (hall rent audit): rental payment storno/correction, debtors, created_by in register.
-- F16 rental debtors in financial_debtors_v; F18 storno/correction; F27 created_by audit trail.

BEGIN;

-- =============================================================================
-- 1. rental_payments — correction metadata (mirror payments table)
-- =============================================================================

ALTER TABLE rental_payments
  ADD COLUMN IF NOT EXISTS operation_kind TEXT NOT NULL DEFAULT 'payment'
    CHECK (operation_kind IN ('payment', 'storno')),
  ADD COLUMN IF NOT EXISTS reverses_payment_id UUID,
  ADD COLUMN IF NOT EXISTS replaces_payment_id UUID,
  ADD COLUMN IF NOT EXISTS correction_reason_code TEXT,
  ADD COLUMN IF NOT EXISTS correction_comment TEXT,
  ADD COLUMN IF NOT EXISTS operation_number BIGINT,
  ADD COLUMN IF NOT EXISTS idempotency_scope TEXT,
  ADD COLUMN IF NOT EXISTS payload_fingerprint TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rental_payments_reverses_payment_id_fkey'
  ) THEN
    ALTER TABLE rental_payments
      ADD CONSTRAINT rental_payments_reverses_payment_id_fkey
      FOREIGN KEY (organization_id, reverses_payment_id)
      REFERENCES rental_payments (organization_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rental_payments_replaces_payment_id_fkey'
  ) THEN
    ALTER TABLE rental_payments
      ADD CONSTRAINT rental_payments_replaces_payment_id_fkey
      FOREIGN KEY (organization_id, replaces_payment_id)
      REFERENCES rental_payments (organization_id, id);
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rental_payments_org_idempotency_scope
  ON rental_payments (organization_id, idempotency_scope, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_scope IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rental_payments_reverses
  ON rental_payments (organization_id, reverses_payment_id)
  WHERE reverses_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rental_payments_replaces
  ON rental_payments (organization_id, replaces_payment_id)
  WHERE replaces_payment_id IS NOT NULL;

-- =============================================================================
-- 2. Helpers — net paid total and correction status
-- =============================================================================

CREATE OR REPLACE FUNCTION rental_payment_storno_total(p_org_id uuid, p_payment_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(SUM(s.amount), 0)
  FROM rental_payments s
  WHERE s.organization_id = p_org_id
    AND s.operation_kind = 'storno'
    AND s.reverses_payment_id = p_payment_id;
$$;

CREATE OR REPLACE FUNCTION rental_payment_remaining_amount(p_org_id uuid, p_payment_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT GREATEST(
    0,
    p.amount - rental_payment_storno_total(p_org_id, p_payment_id)
  )
  FROM rental_payments p
  WHERE p.organization_id = p_org_id
    AND p.id = p_payment_id
    AND p.operation_kind = 'payment';
$$;

CREATE OR REPLACE FUNCTION rental_payment_correction_status(p_org_id uuid, p_payment_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_payment rental_payments%ROWTYPE;
  v_storno numeric;
  v_has_replacement boolean;
BEGIN
  SELECT * INTO v_payment
  FROM rental_payments
  WHERE organization_id = p_org_id AND id = p_payment_id;

  IF NOT FOUND OR v_payment.operation_kind <> 'payment' THEN
    RETURN 'storno';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM rental_payments r
    WHERE r.organization_id = p_org_id AND r.replaces_payment_id = p_payment_id
  ) INTO v_has_replacement;

  IF v_has_replacement THEN
    RETURN 'replaced';
  END IF;

  v_storno := rental_payment_storno_total(p_org_id, p_payment_id);

  IF v_storno >= v_payment.amount THEN
    RETURN 'voided';
  END IF;

  IF v_storno > 0 THEN
    RETURN 'partially_voided';
  END IF;

  RETURN 'active';
END;
$$;

CREATE OR REPLACE FUNCTION _rental_paid_total(p_rental_id uuid, p_org_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    SUM(
      CASE
        WHEN rp.operation_kind = 'payment' THEN rp.amount
        WHEN rp.operation_kind = 'storno' THEN -rp.amount
        ELSE 0
      END
    ),
    0
  )
  FROM rental_payments rp
  WHERE rp.rental_id = p_rental_id
    AND rp.organization_id = p_org_id;
$$;

-- =============================================================================
-- 3. Storno / correction RPCs
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

  INSERT INTO rental_payments (
    organization_id, rental_id, amount, currency, method, method_comment,
    created_by, operation_kind, reverses_payment_id,
    correction_reason_code, correction_comment, operation_number,
    idempotency_key, idempotency_scope, payload_fingerprint
  )
  VALUES (
    v_payment.organization_id, v_payment.rental_id, v_storno_amount, v_payment.currency,
    v_payment.method, v_payment.method_comment,
    p_member_id, 'storno', v_payment.id,
    p_reason_code, p_reason_comment, v_op_num,
    p_idempotency_key, p_idempotency_scope, p_fingerprint
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

CREATE OR REPLACE FUNCTION storno_rental_payment(
  p_payment_id uuid,
  p_amount numeric DEFAULT NULL,
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
  v_key text := NULLIF(trim(p_idempotency_key), '');
  v_fingerprint text;
  v_cached jsonb;
  v_result jsonb;
BEGIN
  v_fingerprint := md5(
    coalesce(p_payment_id::text, '') || '|rental_storno|' ||
    coalesce(p_amount::text, 'full') || '|' ||
    coalesce(p_reason_code, '') || '|' ||
    coalesce(p_reason_comment, '')
  );

  v_cached := check_operation_idempotency(v_org_id, 'storno_rental_payment', v_key::uuid, v_fingerprint);
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

  v_result := _storno_rental_payment_impl(
    v_org_id, v_member_id, p_payment_id, p_amount,
    p_reason_code, p_reason_comment,
    v_key, 'storno_rental_payment', v_fingerprint
  );

  IF (v_result ->> 'success')::boolean AND v_key IS NOT NULL THEN
    PERFORM store_operation_idempotency(v_org_id, 'storno_rental_payment', v_key::uuid, v_fingerprint, v_result);
  END IF;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION correct_rental_payment(
  p_payment_id uuid,
  p_new_amount numeric,
  p_new_method text,
  p_reason_code text,
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

  INSERT INTO rental_payments (
    organization_id, rental_id, amount, currency, method, method_comment,
    created_by, operation_kind, replaces_payment_id,
    correction_reason_code, correction_comment, operation_number,
    idempotency_key, idempotency_scope, payload_fingerprint
  )
  VALUES (
    v_payment.organization_id, v_payment.rental_id, p_new_amount, v_payment.currency,
    p_new_method, p_reason_comment,
    v_member_id, 'payment', v_payment.id,
    p_reason_code, p_reason_comment, v_op_num,
    v_key, 'correct_rental_payment', v_fingerprint || ':payment'
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

REVOKE ALL ON FUNCTION storno_rental_payment(uuid, numeric, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION storno_rental_payment(uuid, numeric, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION correct_rental_payment(uuid, numeric, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION correct_rental_payment(uuid, numeric, text, text, text, text) TO authenticated;

-- =============================================================================
-- 4. Unified money register — include storno rows (negative signed_amount)
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
  (rp.created_at AT TIME ZONE COALESCE(NULLIF(trim(os.timezone), ''), 'UTC'))::date AS operation_date,
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
LEFT JOIN organization_settings os
  ON os.organization_id = rp.organization_id

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
  (rip.created_at AT TIME ZONE COALESCE(NULLIF(trim(os.timezone), ''), 'UTC'))::date,
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
LEFT JOIN organization_settings os
  ON os.organization_id = rip.organization_id

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
  (ra.created_at AT TIME ZONE COALESCE(NULLIF(trim(os.timezone), ''), 'UTC'))::date,
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
LEFT JOIN organization_settings os
  ON os.organization_id = ra.organization_id

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
  (rdm.created_at AT TIME ZONE COALESCE(NULLIF(trim(os.timezone), ''), 'UTC'))::date,
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
LEFT JOIN organization_settings os
  ON os.organization_id = rdm.organization_id
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
  NULL::uuid,
  NULL::uuid,
  rdm.deposit_id,
  rdm.created_by,
  rdm.created_at,
  (rdm.created_at AT TIME ZONE COALESCE(NULLIF(trim(os.timezone), ''), 'UTC'))::date,
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
LEFT JOIN organization_settings os
  ON os.organization_id = rdm.organization_id
WHERE rdm.movement_type = 'return';

CREATE OR REPLACE FUNCTION list_rental_money_register(
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_entries jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT can_read_financial() THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_to < p_date_from THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_period');
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'register_key', r.register_key,
        'entry_id', r.entry_id,
        'entry_type', r.entry_type,
        'source_table', r.source_table,
        'source_id', r.source_id,
        'signed_amount', r.signed_amount,
        'amount', r.signed_amount,
        'currency', r.currency,
        'method', r.method,
        'method_comment', r.method_comment,
        'renter_id', r.renter_id,
        'renter_display', r.renter_display,
        'rental_id', r.rental_id,
        'invoice_id', r.invoice_id,
        'advance_id', r.advance_id,
        'deposit_id', r.deposit_id,
        'created_by', r.created_by,
        'operation_ts', r.operation_ts,
        'operation_date', r.operation_date,
        'rental_date', r.rental_date,
        'location_id', r.location_id,
        'operation_kind', r.operation_kind,
        'reverses_payment_id', r.reverses_payment_id,
        'replaces_payment_id', r.replaces_payment_id,
        'correction_reason_code', r.correction_reason_code,
        'correction_comment', r.correction_comment,
        'operation_number', r.operation_number
      )
      ORDER BY r.operation_ts DESC
    ),
    '[]'::jsonb
  )
  INTO v_entries
  FROM rental_money_register_v r
  WHERE r.organization_id = v_org_id
    AND (p_date_from IS NULL OR r.operation_date >= p_date_from)
    AND (p_date_to IS NULL OR r.operation_date <= p_date_to);

  RETURN jsonb_build_object('success', true, 'entries', v_entries);
END;
$$;

-- =============================================================================
-- 5. financial_debtors_v — add rental hall-rent debtors (F16)
-- =============================================================================

DROP VIEW IF EXISTS financial_debtors_v;

CREATE OR REPLACE VIEW financial_debtors_v
WITH (security_invoker = false) AS
SELECT
  s.organization_id,
  ('sub-' || s.id::text) AS id,
  NULL::uuid AS personal_lesson_id,
  s.client_id1 AS client_id1,
  s.client_id2 AS client_id2,
  s.client_id3 AS client_id3,
  NULL::text AS lesson_time_start,
  NULL::text AS lesson_time_end,
  NULL::uuid AS location_id,
  s.discipline_id AS discipline_id,
  'subscription'::text AS kind,
  COALESCE(
    NULLIF(
      TRIM(BOTH ' &' FROM CONCAT_WS(
        ' & ',
        TRIM(c1.last_name || ' ' || c1.first_name),
        CASE WHEN s.client_id2 IS NOT NULL THEN TRIM(c2.last_name || ' ' || c2.first_name) END,
        CASE WHEN s.client_id3 IS NOT NULL THEN TRIM(c3.last_name || ' ' || c3.first_name) END
      )),
      ''
    ),
    s.client_id1::text
  ) AS client_display,
  COALESCE(NULLIF(TRIM(c1.telegram), ''), '—') AS contact,
  ('Осталось ' || s.lessons_left::text || ' из ' || s.lessons_total::text || ' занятий') AS detail,
  0::numeric AS amount,
  s.lessons_left,
  s.lessons_total,
  NULL::date AS lesson_date,
  NULL::uuid AS rental_id,
  NULL::uuid AS renter_id
FROM subscriptions s
INNER JOIN clients c1
  ON c1.organization_id = s.organization_id AND c1.id = s.client_id1
LEFT JOIN clients c2
  ON c2.organization_id = s.organization_id AND c2.id = s.client_id2
LEFT JOIN clients c3
  ON c3.organization_id = s.organization_id AND c3.id = s.client_id3
LEFT JOIN organization_settings os
  ON os.organization_id = s.organization_id
WHERE s.organization_id = auth_organization_id()
  AND business_row_readable()
  AND can_read_financial()
  AND s.status = 'active'
  AND s.lessons_left <= COALESCE(os.low_balance_threshold, 2)

UNION ALL

SELECT
  pl.organization_id,
  ('pl-' || pl.id::text) AS id,
  pl.id AS personal_lesson_id,
  pl.client_id1,
  pl.client_id2,
  pl.client_id3,
  pl.time_start AS lesson_time_start,
  pl.time_end AS lesson_time_end,
  pl.location_id,
  pl.discipline_id,
  'personal'::text AS kind,
  COALESCE(
    NULLIF(
      TRIM(BOTH ' &' FROM CONCAT_WS(
        ' & ',
        CASE WHEN pl.client_id1 IS NOT NULL THEN TRIM(c1.last_name || ' ' || c1.first_name) END,
        CASE WHEN pl.client_id2 IS NOT NULL THEN TRIM(c2.last_name || ' ' || c2.first_name) END,
        CASE WHEN pl.client_id3 IS NOT NULL THEN TRIM(c3.last_name || ' ' || c3.first_name) END
      )),
      ''
    ),
    COALESCE(pl.client_id1::text, 'Клиент не указан')
  ) AS client_display,
  COALESCE(NULLIF(TRIM(c1.telegram), ''), '—') AS contact,
  ('Персональный · ' || pl.date::text) AS detail,
  pl.price AS amount,
  NULL::integer AS lessons_left,
  NULL::integer AS lessons_total,
  pl.date AS lesson_date,
  NULL::uuid AS rental_id,
  NULL::uuid AS renter_id
FROM personal_lessons pl
LEFT JOIN clients c1
  ON c1.organization_id = pl.organization_id AND c1.id = pl.client_id1
LEFT JOIN clients c2
  ON c2.organization_id = pl.organization_id AND c2.id = pl.client_id2
LEFT JOIN clients c3
  ON c3.organization_id = pl.organization_id AND c3.id = pl.client_id3
WHERE pl.organization_id = auth_organization_id()
  AND business_row_readable()
  AND can_read_financial()
  AND pl.paid = 'no'

UNION ALL

SELECT
  r.organization_id,
  ('rent-' || r.id::text) AS id,
  NULL::uuid AS personal_lesson_id,
  NULL::uuid AS client_id1,
  NULL::uuid AS client_id2,
  NULL::uuid AS client_id3,
  r.time_start AS lesson_time_start,
  r.time_end AS lesson_time_end,
  r.location_id,
  NULL::uuid AS discipline_id,
  'rental'::text AS kind,
  ren.display_name AS client_display,
  COALESCE(
    NULLIF(TRIM(ren.contact_phone), ''),
    NULLIF(TRIM(ren.contact_email), ''),
    '—'
  ) AS contact,
  ('Аренда · ' || r.rental_date::text || COALESCE(' · ' || loc.name, '')) AS detail,
  GREATEST(
    _rental_effective_amount(r.fixed_amount, r.final_amount)
      - _rental_paid_total(r.id, r.organization_id),
    0
  ) AS amount,
  NULL::integer AS lessons_left,
  NULL::integer AS lessons_total,
  r.rental_date AS lesson_date,
  r.id AS rental_id,
  r.renter_id AS renter_id
FROM rentals r
INNER JOIN renters ren
  ON ren.id = r.renter_id AND ren.organization_id = r.organization_id
LEFT JOIN locations loc
  ON loc.id = r.location_id AND loc.organization_id = r.organization_id
WHERE r.organization_id = auth_organization_id()
  AND business_row_readable()
  AND can_read_financial()
  AND r.booking_status = 'confirmed'
  AND _rental_effective_amount(r.fixed_amount, r.final_amount) > 0
  AND _rental_paid_total(r.id, r.organization_id)
      < _rental_effective_amount(r.fixed_amount, r.final_amount);

GRANT SELECT ON financial_debtors_v TO authenticated;

-- =============================================================================
-- 6. get_rental_detail — payment audit fields (F27)
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

-- =============================================================================
-- 7. Corrections report — rental payments section
-- =============================================================================

CREATE OR REPLACE FUNCTION get_corrections_report(
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_payments jsonb;
  v_rental_payments jsonb;
  v_attendance jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT member_can_read_corrections() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC), '[]'::jsonb)
  INTO v_payments
  FROM (
    SELECT
      'payment'::text AS kind,
      p.id,
      p.operation_number,
      p.operation_kind,
      p.amount,
      p.method,
      p.client_display,
      p.correction_reason_code AS reason_code,
      p.correction_comment AS reason_comment,
      p.reverses_payment_id,
      p.replaces_payment_id,
      p.created_at,
      om.display_name AS author_name,
      payment_correction_status(v_org_id, coalesce(p.reverses_payment_id, p.id)) AS related_status
    FROM payments p
    LEFT JOIN organization_members om
      ON om.organization_id = p.organization_id AND om.id = p.created_by
    WHERE p.organization_id = v_org_id
      AND (
        p.operation_kind = 'storno'
        OR p.replaces_payment_id IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM payments s
          WHERE s.organization_id = v_org_id
            AND s.reverses_payment_id = p.id
        )
      )
      AND (p_date_from IS NULL OR p.created_at::date >= p_date_from)
      AND (p_date_to IS NULL OR p.created_at::date <= p_date_to)
  ) x;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC), '[]'::jsonb)
  INTO v_rental_payments
  FROM (
    SELECT
      'rental_payment'::text AS kind,
      rp.id,
      rp.operation_number,
      rp.operation_kind,
      rp.amount,
      rp.method,
      ren.display_name AS client_display,
      rp.correction_reason_code AS reason_code,
      rp.correction_comment AS reason_comment,
      rp.reverses_payment_id,
      rp.replaces_payment_id,
      rp.created_at,
      om.display_name AS author_name,
      rental_payment_correction_status(v_org_id, coalesce(rp.reverses_payment_id, rp.id)) AS related_status,
      rp.rental_id
    FROM rental_payments rp
    JOIN rentals r
      ON r.id = rp.rental_id AND r.organization_id = rp.organization_id
    JOIN renters ren
      ON ren.id = r.renter_id AND ren.organization_id = r.organization_id
    LEFT JOIN organization_members om
      ON om.organization_id = rp.organization_id AND om.id = rp.created_by
    WHERE rp.organization_id = v_org_id
      AND (
        rp.operation_kind = 'storno'
        OR rp.replaces_payment_id IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM rental_payments s
          WHERE s.organization_id = v_org_id
            AND s.reverses_payment_id = rp.id
        )
      )
      AND (p_date_from IS NULL OR rp.created_at::date >= p_date_from)
      AND (p_date_to IS NULL OR rp.created_at::date <= p_date_to)
  ) x;

  SELECT coalesce(jsonb_agg(row_to_json(y)::jsonb ORDER BY y.created_at DESC), '[]'::jsonb)
  INTO v_attendance
  FROM (
    SELECT
      'attendance'::text AS kind,
      ac.id,
      ac.operation_number,
      ac.client_display,
      ac.old_status,
      ac.new_status,
      ac.reason_code,
      ac.reason_comment,
      ac.is_undo,
      ac.occurrence_date,
      ac.created_at,
      om.display_name AS author_name
    FROM attendance_corrections ac
    LEFT JOIN organization_members om
      ON om.organization_id = ac.organization_id AND om.id = ac.created_by_member_id
    WHERE ac.organization_id = v_org_id
      AND (p_date_from IS NULL OR ac.occurrence_date >= p_date_from)
      AND (p_date_to IS NULL OR ac.occurrence_date <= p_date_to)
  ) y;

  RETURN jsonb_build_object(
    'success', true,
    'payments', v_payments,
    'rental_payments', v_rental_payments,
    'attendance', v_attendance
  );
END;
$$;

COMMIT;
