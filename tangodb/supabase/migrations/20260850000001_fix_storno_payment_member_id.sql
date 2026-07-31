-- Fix typo in _storno_payment_impl: v_member_id → p_member_id (caused storno_payment to fail).

CREATE OR REPLACE FUNCTION _storno_payment_impl(
  p_org_id uuid,
  p_member_id uuid,
  p_payment_id uuid,
  p_amount numeric,
  p_reason_code text,
  p_reason_comment text,
  p_idempotency_key uuid,
  p_idempotency_scope text,
  p_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_payment payments%ROWTYPE;
  v_remaining numeric;
  v_storno_amount numeric;
  v_storno_id uuid;
  v_op_num bigint;
  v_result jsonb;
BEGIN
  SELECT * INTO v_payment
  FROM payments
  WHERE id = p_payment_id AND organization_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND OR v_payment.operation_kind <> 'payment' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Платёж не найден');
  END IF;

  v_remaining := payment_remaining_amount(p_org_id, p_payment_id);

  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Платёж уже полностью аннулирован');
  END IF;

  v_storno_amount := COALESCE(p_amount, v_remaining);

  IF v_storno_amount <= 0 OR v_storno_amount > v_remaining THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Сумма сторно превышает доступный остаток'
    );
  END IF;

  v_op_num := next_payment_operation_number(p_org_id);

  INSERT INTO payments (
    organization_id, client_id, client_display, amount, method, method_comment,
    subscription_id, personal_lesson_id, single_visit_id,
    created_by, operation_kind, reverses_payment_id,
    correction_reason_code, correction_comment, operation_number,
    idempotency_key, idempotency_scope, payload_fingerprint
  )
  VALUES (
    v_payment.organization_id, v_payment.client_id, v_payment.client_display,
    v_storno_amount, v_payment.method, v_payment.method_comment,
    v_payment.subscription_id, v_payment.personal_lesson_id, v_payment.single_visit_id,
    p_member_id, 'storno', v_payment.id,
    p_reason_code, p_reason_comment, v_op_num,
    p_idempotency_key, p_idempotency_scope, p_fingerprint
  )
  RETURNING id INTO v_storno_id;

  IF v_payment.personal_lesson_id IS NOT NULL THEN
    PERFORM sync_personal_lesson_paid_status(p_org_id, v_payment.personal_lesson_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'storno_id', v_storno_id,
    'operation_number', v_op_num,
    'remaining_after', payment_remaining_amount(p_org_id, p_payment_id)
  );
END;
$$;
