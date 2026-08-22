-- Allow deleting a storno that voided a payment later replaced (erroneous
-- correct_payment flow). Keep the replacement row, drop storno + superseded original.

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
  v_original payments%ROWTYPE;
  v_original_id uuid;
  v_has_replacement boolean;
  v_other_storno numeric;
  v_fingerprint text;
  v_cached jsonb;
  v_result jsonb;
  v_lesson_id uuid;
  v_collapse_replacement boolean := false;
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
    SELECT * INTO v_original
    FROM payments
    WHERE id = v_original_id AND organization_id = v_org_id
    FOR UPDATE;

    SELECT EXISTS (
      SELECT 1
      FROM payments rep
      WHERE rep.organization_id = v_org_id
        AND rep.operation_kind = 'payment'
        AND rep.replaces_payment_id = v_original_id
    ) INTO v_has_replacement;

    IF v_has_replacement THEN
      SELECT COALESCE(SUM(s.amount), 0) INTO v_other_storno
      FROM payments s
      WHERE s.organization_id = v_org_id
        AND s.operation_kind = 'storno'
        AND s.reverses_payment_id = v_original_id
        AND s.id <> p_storno_id;

      IF COALESCE(v_original.amount, 0) > 0 AND v_other_storno < v_original.amount THEN
        v_collapse_replacement := true;
      END IF;
    END IF;
  END IF;

  v_lesson_id := COALESCE(v_storno.personal_lesson_id, v_original.personal_lesson_id);

  IF v_collapse_replacement THEN
    UPDATE payments
    SET replaces_payment_id = NULL
    WHERE organization_id = v_org_id
      AND operation_kind = 'payment'
      AND replaces_payment_id = v_original_id;
  END IF;

  DELETE FROM payments
  WHERE id = p_storno_id AND organization_id = v_org_id;

  IF v_collapse_replacement THEN
    DELETE FROM payments
    WHERE id = v_original_id AND organization_id = v_org_id;
  END IF;

  IF v_lesson_id IS NOT NULL THEN
    PERFORM sync_personal_lesson_paid_status(v_org_id, v_lesson_id);
  END IF;

  v_result := jsonb_build_object(
    'success', true,
    'storno_id', p_storno_id,
    'reverses_payment_id', v_original_id,
    'collapsed_original', v_collapse_replacement
  );

  PERFORM store_operation_idempotency(v_org_id, 'remove_orphan_payment_storno', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION remove_orphan_payment_storno(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION remove_orphan_payment_storno(uuid, text, uuid) TO authenticated;
