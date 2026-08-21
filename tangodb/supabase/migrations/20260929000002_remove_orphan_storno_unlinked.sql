-- Allow removing storno rows without reverses_payment_id (erroneous orphan refunds).

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

  IF v_original_id IS NOT NULL THEN
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
