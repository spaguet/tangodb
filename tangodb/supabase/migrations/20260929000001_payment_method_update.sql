-- In-place payment method update (no storno row) + remove orphan void storno rows.

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

  IF p_reason_code IS NULL OR trim(p_reason_code) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Укажите причину');
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
    'UPDATE_METHOD',
    p_payment_id,
    jsonb_build_object('method', v_old_method),
    jsonb_build_object(
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
  IF v_original_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Сторно не связано с платежом');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM payments rep
    WHERE rep.organization_id = v_org_id
      AND rep.operation_kind = 'payment'
      AND rep.replaces_payment_id = v_original_id
  ) INTO v_has_replacement;

  IF v_has_replacement THEN
    RETURN jsonb_build_object('success', false, 'error', 'corrections.payment.stornoNotOrphan');
  END IF;

  v_lesson_id := v_storno.personal_lesson_id;

  DELETE FROM payments
  WHERE id = p_storno_id AND organization_id = v_org_id;

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
    'DELETE_ORPHAN_STORNO',
    p_storno_id,
    to_jsonb(v_storno),
    jsonb_build_object('reason_comment', p_reason_comment),
    auth.uid()
  );

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

REVOKE ALL ON FUNCTION remove_orphan_payment_storno(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION remove_orphan_payment_storno(uuid, text, uuid) TO authenticated;
