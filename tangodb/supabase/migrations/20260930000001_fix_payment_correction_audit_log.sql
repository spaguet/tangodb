-- audit_log.operation only allows INSERT | UPDATE | DELETE.
-- Payment correction RPCs used custom values (DELETE_ORPHAN_STORNO, UPDATE_METHOD, UPDATE_IN_PLACE)
-- and failed with a check-constraint error after the main change.

-- update_payment_method: use operation = 'UPDATE', keep kind in new_data
CREATE OR REPLACE FUNCTION update_payment_method(
  p_payment_id uuid,
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
  v_old_method text;
  v_op_num bigint;
  v_fingerprint text;
  v_cached jsonb;
  v_result jsonb;
BEGIN
  v_fingerprint := md5(
    coalesce(p_payment_id::text, '') || '|method|' ||
    coalesce(p_new_method, '') || '|' ||
    coalesce(p_reason_code, '')
  );

  v_cached := check_operation_idempotency(v_org_id, 'update_payment_method', p_idempotency_key, v_fingerprint);
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

  IF p_new_method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недопустимый способ оплаты');
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

  IF v_payment.method = p_new_method THEN
    RETURN jsonb_build_object('success', false, 'error', 'corrections.payment.nothingChanged');
  END IF;

  v_old_method := v_payment.method;
  v_op_num := next_payment_operation_number(v_org_id);

  UPDATE payments
  SET method = p_new_method
  WHERE id = p_payment_id AND organization_id = v_org_id;

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
    v_org_id,
    'payments',
    'UPDATE',
    p_payment_id,
    jsonb_build_object('method', v_old_method),
    jsonb_build_object(
      'correction_kind', 'UPDATE_METHOD',
      'method', p_new_method,
      'reason_code', p_reason_code,
      'reason_comment', p_reason_comment,
      'operation_number', v_op_num
    ),
    auth.uid()
  );

  v_result := jsonb_build_object(
    'success', true,
    'payment_id', p_payment_id,
    'operation_number', v_op_num,
    'old_method', v_old_method,
    'new_method', p_new_method
  );

  PERFORM store_operation_idempotency(v_org_id, 'update_payment_method', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;

-- update_payment_in_place: use operation = 'UPDATE', keep kind in new_data
CREATE OR REPLACE FUNCTION update_payment_in_place(
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
  v_payment payments%ROWTYPE;
  v_old_amount numeric;
  v_old_method text;
  v_op_num bigint;
  v_fingerprint text;
  v_cached jsonb;
  v_result jsonb;
  v_charge_id uuid;
  v_old_billed numeric;
  v_old_net numeric;
  v_new_billed numeric;
  v_restated boolean := false;
BEGIN
  v_fingerprint := md5(
    coalesce(p_payment_id::text, '') || '|inplace|' ||
    coalesce(p_new_amount::text, '') || '|' ||
    coalesce(p_new_method, '') || '|' ||
    coalesce(p_reason_code, '')
  );

  v_cached := check_operation_idempotency(v_org_id, 'update_payment_in_place', p_idempotency_key, v_fingerprint);
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

  v_old_amount := v_payment.amount;
  v_old_method := v_payment.method;

  v_charge_id := v_payment.personal_lesson_charge_id;
  IF v_charge_id IS NULL AND v_payment.personal_lesson_id IS NOT NULL THEN
    SELECT id INTO v_charge_id
    FROM personal_lesson_charges
    WHERE organization_id = v_org_id
      AND personal_lesson_id = v_payment.personal_lesson_id
      AND client_id = v_payment.client_id
    LIMIT 1;
  END IF;

  IF v_old_amount = p_new_amount AND v_old_method = p_new_method
     AND NOT (v_charge_id IS NOT NULL AND p_reason_code = 'wrong_amount') THEN
    RETURN jsonb_build_object('success', false, 'error', 'corrections.payment.nothingChanged');
  END IF;

  IF v_charge_id IS NOT NULL THEN
    SELECT billed_amount INTO v_old_billed
    FROM personal_lesson_charges
    WHERE organization_id = v_org_id AND id = v_charge_id
    FOR UPDATE;
    v_old_net := personal_lesson_charge_net_payment(v_org_id, v_charge_id);
  END IF;

  v_op_num := next_payment_operation_number(v_org_id);

  UPDATE payments
  SET
    amount = p_new_amount,
    method = p_new_method,
    correction_reason_code = p_reason_code,
    correction_comment = p_reason_comment,
    operation_number = v_op_num
  WHERE id = p_payment_id AND organization_id = v_org_id;

  IF v_charge_id IS NOT NULL
     AND v_old_billed IS NOT NULL
     AND (p_new_amount <> v_old_amount OR p_reason_code = 'wrong_amount') THEN
    v_new_billed := GREATEST(personal_lesson_charge_net_payment(v_org_id, v_charge_id), 0);
    UPDATE personal_lesson_charges
    SET billed_amount = v_new_billed
    WHERE organization_id = v_org_id AND id = v_charge_id;
    v_restated := v_new_billed <> v_old_billed;
  END IF;

  IF v_payment.personal_lesson_id IS NOT NULL THEN
    PERFORM sync_personal_lesson_paid_status(v_org_id, v_payment.personal_lesson_id);
    IF v_restated THEN
      UPDATE personal_lessons
      SET price_id = NULL
      WHERE id = v_payment.personal_lesson_id
        AND organization_id = v_org_id;
    END IF;
  END IF;

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
    v_org_id,
    'payments',
    'UPDATE',
    p_payment_id,
    jsonb_build_object('amount', v_old_amount, 'method', v_old_method),
    jsonb_build_object(
      'correction_kind', 'UPDATE_IN_PLACE',
      'amount', p_new_amount,
      'method', p_new_method,
      'reason_code', p_reason_code,
      'reason_comment', p_reason_comment,
      'operation_number', v_op_num,
      'billed_restated', v_restated
    ),
    auth.uid()
  );

  v_result := jsonb_build_object(
    'success', true,
    'payment_id', p_payment_id,
    'operation_number', v_op_num,
    'billed_restated', v_restated
  );

  PERFORM store_operation_idempotency(v_org_id, 'update_payment_in_place', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;

-- remove_orphan_payment_storno: rely on payments audit trigger for DELETE row
CREATE OR REPLACE FUNCTION remove_orphan_payment_storno(
  p_storno_id uuid,
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
  v_storno payments%ROWTYPE;
  v_original_id uuid;
  v_has_replacement boolean;
  v_orig_amount numeric;
  v_other_storno numeric;
  v_fingerprint text;
  v_cached jsonb;
  v_result jsonb;
  v_lesson_id uuid;
BEGIN
  v_fingerprint := md5(coalesce(p_storno_id::text, '') || '|remove_orphan_storno');

  v_cached := check_operation_idempotency(v_org_id, 'remove_orphan_payment_storno', p_idempotency_key, v_fingerprint);
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

  SELECT * INTO v_storno
  FROM payments
  WHERE id = p_storno_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND OR v_storno.operation_kind <> 'storno' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Сторно не найдено');
  END IF;

  v_original_id := v_storno.reverses_payment_id;

  IF v_original_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM payments rep
      WHERE rep.organization_id = v_org_id
        AND rep.operation_kind = 'payment'
        AND rep.replaces_payment_id = v_original_id
    ) INTO v_has_replacement;

    IF v_has_replacement THEN
      SELECT amount INTO v_orig_amount
      FROM payments
      WHERE id = v_original_id AND organization_id = v_org_id;

      SELECT COALESCE(SUM(s.amount), 0) INTO v_other_storno
      FROM payments s
      WHERE s.organization_id = v_org_id
        AND s.operation_kind = 'storno'
        AND s.reverses_payment_id = v_original_id
        AND s.id <> p_storno_id;

      IF COALESCE(v_orig_amount, 0) > 0 AND v_other_storno < v_orig_amount THEN
        RETURN jsonb_build_object('success', false, 'error', 'corrections.payment.stornoNotOrphan');
      END IF;
    END IF;
  END IF;

  v_lesson_id := v_storno.personal_lesson_id;

  DELETE FROM payments
  WHERE id = p_storno_id AND organization_id = v_org_id;

  IF v_lesson_id IS NOT NULL THEN
    PERFORM sync_personal_lesson_paid_status(v_org_id, v_lesson_id);
  END IF;

  v_result := jsonb_build_object(
    'success', true,
    'storno_id', p_storno_id,
    'reverses_payment_id', v_original_id
  );

  PERFORM store_operation_idempotency(v_org_id, 'remove_orphan_payment_storno', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION update_payment_method(uuid, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_payment_method(uuid, text, text, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION update_payment_in_place(uuid, numeric, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_payment_in_place(uuid, numeric, text, text, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION remove_orphan_payment_storno(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION remove_orphan_payment_storno(uuid, text, uuid) TO authenticated;
