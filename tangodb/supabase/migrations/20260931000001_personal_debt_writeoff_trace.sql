-- Personal lesson AR: persist assigned (billed) amount on correction,
-- write off erroneous debt, and expose a debt-origin trace.
--
-- Bug: changing a payment 950000 → 800000 (correct_payment storno+replace)
-- left personal_lesson_charges.billed_amount at 950000, so AR stayed 150000.
-- Restate was lesson-level only and used stale paid_amount.

-- Include legacy payments that were never linked to a charge id.
CREATE OR REPLACE FUNCTION personal_lesson_charge_net_payment(p_org_id uuid, p_charge_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(SUM(payment_effective_amount(p)), 0)
  FROM payments p
  WHERE p.organization_id = p_org_id
    AND (
      p.personal_lesson_charge_id = p_charge_id
      OR (
        p.personal_lesson_charge_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM personal_lesson_charges plc
          WHERE plc.organization_id = p_org_id
            AND plc.id = p_charge_id
            AND plc.personal_lesson_id = p.personal_lesson_id
            AND plc.client_id = p.client_id
        )
      )
    );
$$;

-- Shared billed restatement: charge + lesson.price/paid + audit.
CREATE OR REPLACE FUNCTION _restate_personal_lesson_charge_billed(
  p_org_id uuid,
  p_charge_id uuid,
  p_new_billed numeric,
  p_reason_code text,
  p_reason_comment text,
  p_kind text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_charge personal_lesson_charges%ROWTYPE;
  v_paid numeric;
  v_old_billed numeric;
BEGIN
  IF p_new_billed IS NULL OR p_new_billed < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.adjustInvalid');
  END IF;

  SELECT * INTO v_charge
  FROM personal_lesson_charges
  WHERE organization_id = p_org_id AND id = p_charge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.adjustFailed');
  END IF;

  v_old_billed := v_charge.billed_amount;
  v_paid := GREATEST(COALESCE(personal_lesson_charge_net_payment(p_org_id, p_charge_id), 0), 0);

  IF p_new_billed < v_paid THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.adjustBelowPaid');
  END IF;

  UPDATE personal_lesson_charges
  SET billed_amount = p_new_billed
  WHERE organization_id = p_org_id AND id = p_charge_id;

  PERFORM sync_personal_lesson_paid_status(p_org_id, v_charge.personal_lesson_id);

  INSERT INTO audit_log (
    organization_id,
    table_name,
    operation,
    row_id,
    old_data,
    new_data,
    changed_by
  )
  VALUES (
    p_org_id,
    'personal_lesson_charges',
    'UPDATE',
    p_charge_id,
    jsonb_build_object('billed_amount', v_old_billed),
    jsonb_build_object(
      'correction_kind', p_kind,
      'billed_amount', p_new_billed,
      'paid_amount', v_paid,
      'reason_code', p_reason_code,
      'reason_comment', p_reason_comment,
      'personal_lesson_id', v_charge.personal_lesson_id,
      'client_id', v_charge.client_id
    ),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'success', true,
    'charge_id', p_charge_id,
    'personal_lesson_id', v_charge.personal_lesson_id,
    'old_billed', v_old_billed,
    'new_billed', p_new_billed,
    'paid_amount', v_paid,
    'outstanding', GREATEST(p_new_billed - v_paid, 0),
    'unchanged', v_old_billed = p_new_billed
  );
END;
$$;

REVOKE ALL ON FUNCTION _restate_personal_lesson_charge_billed(uuid, uuid, numeric, text, text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION restate_personal_lesson_charge(
  p_lesson_id uuid,
  p_new_amount numeric,
  p_charge_id uuid DEFAULT NULL,
  p_reason_code text DEFAULT 'wrong_amount',
  p_reason_comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_charge_id uuid;
  v_charge_count integer;
  v_lesson_id uuid;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.orgReadOnly');
  END IF;

  IF NOT can_read_financial() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF p_lesson_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.adjustInvalid');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM personal_lessons
    WHERE id = p_lesson_id AND organization_id = v_org_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.adjustFailed');
  END IF;

  IF p_charge_id IS NOT NULL THEN
    SELECT id, personal_lesson_id INTO v_charge_id, v_lesson_id
    FROM personal_lesson_charges
    WHERE organization_id = v_org_id AND id = p_charge_id;

    IF NOT FOUND OR v_lesson_id IS DISTINCT FROM p_lesson_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.adjustFailed');
    END IF;
  ELSE
    SELECT COUNT(*)::integer INTO v_charge_count
    FROM personal_lesson_charges
    WHERE organization_id = v_org_id
      AND personal_lesson_id = p_lesson_id;

    IF v_charge_count <> 1 THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'finance.debtors.adjustSplitNotSupported'
      );
    END IF;

    SELECT id INTO v_charge_id
    FROM personal_lesson_charges
    WHERE organization_id = v_org_id
      AND personal_lesson_id = p_lesson_id
    LIMIT 1;
  END IF;

  RETURN _restate_personal_lesson_charge_billed(
    v_org_id,
    v_charge_id,
    p_new_amount,
    COALESCE(NULLIF(trim(p_reason_code), ''), 'wrong_amount'),
    p_reason_comment,
    'RESTATE_BILLED'
  );
END;
$$;

CREATE OR REPLACE FUNCTION restate_personal_lesson_amount(
  p_lesson_id uuid,
  p_new_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN restate_personal_lesson_charge(p_lesson_id, p_new_amount, NULL, 'wrong_amount', NULL);
END;
$$;

-- Set billed = net paid for one charge or every charge on the lesson.
CREATE OR REPLACE FUNCTION write_off_personal_lesson_debt(
  p_lesson_id uuid,
  p_charge_id uuid DEFAULT NULL,
  p_reason_code text DEFAULT 'wrong_amount',
  p_reason_comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_charge record;
  v_result jsonb;
  v_items jsonb := '[]'::jsonb;
  v_written_off numeric := 0;
  v_count integer := 0;
  v_reason text := COALESCE(NULLIF(trim(p_reason_code), ''), 'wrong_amount');
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.orgReadOnly');
  END IF;

  IF NOT member_can_correct_payments() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF p_lesson_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.adjustInvalid');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM personal_lessons
    WHERE id = p_lesson_id AND organization_id = v_org_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.adjustFailed');
  END IF;

  FOR v_charge IN
    SELECT
      plc.id,
      plc.billed_amount,
      GREATEST(COALESCE(personal_lesson_charge_net_payment(v_org_id, plc.id), 0), 0) AS paid_amount
    FROM personal_lesson_charges plc
    WHERE plc.organization_id = v_org_id
      AND plc.personal_lesson_id = p_lesson_id
      AND (p_charge_id IS NULL OR plc.id = p_charge_id)
    FOR UPDATE
  LOOP
    v_result := _restate_personal_lesson_charge_billed(
      v_org_id,
      v_charge.id,
      v_charge.paid_amount,
      v_reason,
      p_reason_comment,
      'WRITE_OFF_DEBT'
    );

    IF NOT COALESCE((v_result ->> 'success')::boolean, false) THEN
      RETURN v_result;
    END IF;

    v_written_off := v_written_off + GREATEST(v_charge.billed_amount - v_charge.paid_amount, 0);
    v_count := v_count + 1;
    v_items := v_items || jsonb_build_array(v_result);
  END LOOP;

  IF v_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.writeOffEmpty');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'personal_lesson_id', p_lesson_id,
    'written_off', v_written_off,
    'charge_count', v_count,
    'items', v_items
  );
END;
$$;

-- Timeline: charge create, payments/stornos, billed restates.
CREATE OR REPLACE FUNCTION get_personal_lesson_debt_trace(
  p_lesson_id uuid,
  p_charge_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_events jsonb := '[]'::jsonb;
  v_charges jsonb := '[]'::jsonb;
  v_billed numeric := 0;
  v_paid numeric := 0;
  v_outstanding numeric := 0;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_financial() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF p_lesson_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM personal_lessons
       WHERE id = p_lesson_id AND organization_id = v_org_id
     )
  THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.traceFailed');
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', plc.id,
      'client_id', plc.client_id,
      'client_display', COALESCE(NULLIF(TRIM(c.last_name || ' ' || c.first_name), ''), plc.client_id::text),
      'billed_amount', plc.billed_amount,
      'paid_amount', GREATEST(COALESCE(personal_lesson_charge_net_payment(v_org_id, plc.id), 0), 0),
      'outstanding', GREATEST(
        plc.billed_amount - GREATEST(COALESCE(personal_lesson_charge_net_payment(v_org_id, plc.id), 0), 0),
        0
      ),
      'created_at', plc.created_at
    )
    ORDER BY plc.created_at
  ), '[]'::jsonb)
  INTO v_charges
  FROM personal_lesson_charges plc
  LEFT JOIN clients c
    ON c.organization_id = plc.organization_id AND c.id = plc.client_id
  WHERE plc.organization_id = v_org_id
    AND plc.personal_lesson_id = p_lesson_id
    AND (p_charge_id IS NULL OR plc.id = p_charge_id);

  SELECT
    COALESCE(SUM((item ->> 'billed_amount')::numeric), 0),
    COALESCE(SUM((item ->> 'paid_amount')::numeric), 0),
    COALESCE(SUM((item ->> 'outstanding')::numeric), 0)
  INTO v_billed, v_paid, v_outstanding
  FROM jsonb_array_elements(v_charges) AS item;

  SELECT COALESCE(jsonb_agg(event ORDER BY (event ->> 'at')::timestamptz, event ->> 'kind'), '[]'::jsonb)
  INTO v_events
  FROM (
    SELECT jsonb_build_object(
      'at', plc.created_at,
      'kind', 'charge_created',
      'charge_id', plc.id,
      'client_display', COALESCE(NULLIF(TRIM(c.last_name || ' ' || c.first_name), ''), plc.client_id::text),
      'billed_amount', plc.billed_amount,
      'amount', plc.billed_amount
    ) AS event
    FROM personal_lesson_charges plc
    LEFT JOIN clients c
      ON c.organization_id = plc.organization_id AND c.id = plc.client_id
    WHERE plc.organization_id = v_org_id
      AND plc.personal_lesson_id = p_lesson_id
      AND (p_charge_id IS NULL OR plc.id = p_charge_id)

    UNION ALL

    SELECT jsonb_build_object(
      'at', p.created_at,
      'kind', CASE WHEN p.operation_kind = 'storno' THEN 'storno' ELSE 'payment' END,
      'payment_id', p.id,
      'charge_id', p.personal_lesson_charge_id,
      'client_display', p.client_display,
      'amount', p.amount,
      'method', p.method,
      'operation_kind', p.operation_kind,
      'correction_status', payment_correction_status(v_org_id, p.id),
      'reason_code', p.correction_reason_code,
      'reason_comment', p.correction_comment,
      'reverses_payment_id', p.reverses_payment_id,
      'replaces_payment_id', p.replaces_payment_id
    ) AS event
    FROM payments p
    WHERE p.organization_id = v_org_id
      AND p.personal_lesson_id = p_lesson_id
      AND (
        p_charge_id IS NULL
        OR p.personal_lesson_charge_id = p_charge_id
        OR (
          p.personal_lesson_charge_id IS NULL
          AND EXISTS (
            SELECT 1 FROM personal_lesson_charges plc
            WHERE plc.organization_id = v_org_id
              AND plc.id = p_charge_id
              AND plc.client_id = p.client_id
          )
        )
      )

    UNION ALL

    SELECT jsonb_build_object(
      'at', a.changed_at,
      'kind', CASE
        WHEN a.new_data ->> 'correction_kind' = 'WRITE_OFF_DEBT' THEN 'write_off'
        ELSE 'billed_restated'
      END,
      'charge_id', a.row_id::uuid,
      'old_billed', (a.old_data ->> 'billed_amount')::numeric,
      'billed_amount', (a.new_data ->> 'billed_amount')::numeric,
      'amount', (a.new_data ->> 'billed_amount')::numeric,
      'reason_code', a.new_data ->> 'reason_code',
      'reason_comment', a.new_data ->> 'reason_comment'
    ) AS event
    FROM audit_log a
    WHERE a.organization_id = v_org_id
      AND a.table_name = 'personal_lesson_charges'
      AND a.operation = 'UPDATE'
      AND a.new_data ? 'correction_kind'
      AND EXISTS (
        SELECT 1 FROM personal_lesson_charges plc
        WHERE plc.organization_id = v_org_id
          AND plc.personal_lesson_id = p_lesson_id
          AND plc.id::text = a.row_id
          AND (p_charge_id IS NULL OR plc.id = p_charge_id)
      )
  ) timeline;

  RETURN jsonb_build_object(
    'success', true,
    'personal_lesson_id', p_lesson_id,
    'billed_amount', v_billed,
    'paid_amount', v_paid,
    'outstanding', v_outstanding,
    'mismatch', v_outstanding > 0 AND v_paid > 0,
    'charges', v_charges,
    'events', v_events
  );
END;
$$;

-- correct_payment: after storno+replace, assigned amount follows net paid
-- (same product rule as update_payment_in_place for personal lessons).
CREATE OR REPLACE FUNCTION correct_payment(
  p_payment_id uuid,
  p_new_amount numeric,
  p_new_method text,
  p_reason_code text,
  p_reason_comment text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_payment payments%ROWTYPE;
  v_remaining numeric;
  v_storno_id uuid;
  v_new_payment_id uuid;
  v_op_num bigint;
  v_fingerprint text;
  v_cached jsonb;
  v_result jsonb;
  v_storno_result jsonb;
  v_charge_id uuid;
  v_old_billed numeric;
  v_new_billed numeric;
  v_restated boolean := false;
  v_restate jsonb;
BEGIN
  v_fingerprint := md5(
    coalesce(p_payment_id::text, '') || '|correct|' ||
    coalesce(p_new_amount::text, '') || '|' ||
    coalesce(p_new_method, '') || '|' ||
    coalesce(p_reason_code, '')
  );

  v_cached := check_operation_idempotency(v_org_id, 'correct_payment', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN
    IF (v_cached ->> 'success')::boolean IS NOT TRUE AND v_cached ->> 'error_code' = 'idempotency_conflict' THEN
      RETURN v_cached;
    END IF;
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT member_can_correct_payments() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  IF p_reason_code IS NULL OR trim(p_reason_code) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Укажите причину');
  END IF;

  IF p_new_method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недопустимый способ оплаты');
  END IF;

  IF p_new_amount IS NULL OR p_new_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Сумма должна быть положительной');
  END IF;

  SELECT * INTO v_payment
  FROM payments
  WHERE id = p_payment_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND OR v_payment.operation_kind <> 'payment' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Платёж не найден');
  END IF;

  IF payment_correction_status(v_org_id, p_payment_id) IN ('voided', 'replaced') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Платёж уже исправлен или аннулирован');
  END IF;

  v_remaining := payment_remaining_amount(v_org_id, p_payment_id);
  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Нет доступного остатка для сторно');
  END IF;

  v_storno_result := _storno_payment_impl(
    v_org_id,
    v_member_id,
    p_payment_id,
    v_remaining,
    p_reason_code,
    p_reason_comment,
    NULL,
    NULL,
    NULL
  );

  IF NOT (v_storno_result ->> 'success')::boolean THEN
    RETURN v_storno_result;
  END IF;

  v_storno_id := (v_storno_result ->> 'storno_id')::uuid;
  v_op_num := next_payment_operation_number(v_org_id);

  INSERT INTO payments (
    organization_id, client_id, client_display, amount, method, method_comment,
    subscription_id, personal_lesson_id, personal_lesson_charge_id, single_visit_id,
    created_by, operation_kind, replaces_payment_id,
    correction_reason_code, correction_comment, operation_number,
    idempotency_key, idempotency_scope, payload_fingerprint,
    price_id, tariff_duration_minutes, tariff_units, tariff_price, tariff_label, lesson_duration_minutes
  )
  VALUES (
    v_payment.organization_id, v_payment.client_id, v_payment.client_display,
    p_new_amount, p_new_method, v_payment.method_comment,
    v_payment.subscription_id, v_payment.personal_lesson_id, v_payment.personal_lesson_charge_id,
    v_payment.single_visit_id,
    v_member_id, 'payment', v_payment.id,
    p_reason_code, p_reason_comment, v_op_num,
    p_idempotency_key, 'correct_payment', v_fingerprint,
    v_payment.price_id, v_payment.tariff_duration_minutes, v_payment.tariff_units,
    v_payment.tariff_price, v_payment.tariff_label, v_payment.lesson_duration_minutes
  )
  RETURNING id INTO v_new_payment_id;

  v_charge_id := v_payment.personal_lesson_charge_id;
  IF v_charge_id IS NULL AND v_payment.personal_lesson_id IS NOT NULL THEN
    SELECT id INTO v_charge_id
    FROM personal_lesson_charges
    WHERE organization_id = v_org_id
      AND personal_lesson_id = v_payment.personal_lesson_id
      AND client_id = v_payment.client_id
    LIMIT 1;
  END IF;

  IF v_charge_id IS NOT NULL
     AND (p_new_amount <> v_payment.amount OR p_reason_code = 'wrong_amount') THEN
    SELECT billed_amount INTO v_old_billed
    FROM personal_lesson_charges
    WHERE organization_id = v_org_id AND id = v_charge_id
    FOR UPDATE;

    v_new_billed := GREATEST(personal_lesson_charge_net_payment(v_org_id, v_charge_id), 0);
    v_restate := _restate_personal_lesson_charge_billed(
      v_org_id,
      v_charge_id,
      v_new_billed,
      p_reason_code,
      p_reason_comment,
      'CORRECT_PAYMENT'
    );
    IF NOT COALESCE((v_restate ->> 'success')::boolean, false) THEN
      RAISE EXCEPTION '%', COALESCE(v_restate ->> 'error', 'finance.debtors.adjustFailed');
    END IF;
    v_restated := COALESCE((v_restate ->> 'unchanged')::boolean, true) IS NOT TRUE;
  ELSIF v_payment.personal_lesson_id IS NOT NULL THEN
    PERFORM sync_personal_lesson_paid_status(v_org_id, v_payment.personal_lesson_id);
  END IF;

  v_result := jsonb_build_object(
    'success', true,
    'payment_id', v_new_payment_id,
    'storno_id', v_storno_id,
    'operation_number', v_op_num,
    'billed_restated', v_restated,
    'old_billed', v_old_billed,
    'new_billed', v_new_billed
  );

  PERFORM store_operation_idempotency(v_org_id, 'correct_payment', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION restate_personal_lesson_charge(uuid, numeric, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION restate_personal_lesson_charge(uuid, numeric, uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION restate_personal_lesson_amount(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION restate_personal_lesson_amount(uuid, numeric) TO authenticated, service_role;

REVOKE ALL ON FUNCTION write_off_personal_lesson_debt(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION write_off_personal_lesson_debt(uuid, uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION get_personal_lesson_debt_trace(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_personal_lesson_debt_trace(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION correct_payment(uuid, numeric, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION correct_payment(uuid, numeric, text, text, text, uuid) TO authenticated;
