-- Fix: sync_personal_lesson_charges upserts charges (preserve UUIDs) instead of
-- delete+insert — stale personal_lesson_charge_id caused «Начисление не найдено».
-- Backfill equal split for unpaid multi-participant lessons on single_payer.

BEGIN;

CREATE OR REPLACE FUNCTION sync_personal_lesson_charges(p_org_id uuid, p_lesson_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lesson personal_lessons%ROWTYPE;
  v_participants uuid[];
  v_splits numeric[];
  v_idx integer;
  v_payer_id uuid;
  v_total_billed numeric;
  v_desired_client uuid;
  v_desired_amount numeric;
BEGIN
  SELECT * INTO v_lesson
  FROM personal_lessons
  WHERE organization_id = p_org_id
    AND id = p_lesson_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_lesson.subscription_id IS NOT NULL AND COALESCE(v_lesson.price, 0) = 0 THEN
    DELETE FROM personal_lesson_charges
    WHERE organization_id = p_org_id
      AND personal_lesson_id = p_lesson_id;
    RETURN;
  END IF;

  IF personal_lesson_has_payment_rows(p_org_id, p_lesson_id) THEN
    SELECT COALESCE(SUM(billed_amount), 0) INTO v_total_billed
    FROM personal_lesson_charges
    WHERE organization_id = p_org_id
      AND personal_lesson_id = p_lesson_id;

    IF v_total_billed > 0 THEN
      UPDATE personal_lessons
      SET price = v_total_billed
      WHERE organization_id = p_org_id
        AND id = p_lesson_id;
    END IF;
    RETURN;
  END IF;

  v_total_billed := COALESCE(v_lesson.price, 0);
  v_participants := ARRAY[]::uuid[];
  v_splits := ARRAY[]::numeric[];

  IF v_lesson.billing_split_mode = 'equal' THEN
    v_participants := personal_lesson_participant_ids_ordered(
      v_lesson.client_id1,
      v_lesson.client_id2,
      v_lesson.client_id3,
      v_lesson.client_id4,
      v_lesson.payer_client_id,
      true
    );

    IF COALESCE(array_length(v_participants, 1), 0) >= 2 THEN
      v_splits := split_billed_equally(v_total_billed, array_length(v_participants, 1));
    ELSE
      v_payer_id := COALESCE(v_lesson.payer_client_id, v_lesson.client_id1);
      v_participants := ARRAY[v_payer_id];
      v_splits := ARRAY[v_total_billed];
    END IF;
  ELSE
    v_payer_id := COALESCE(v_lesson.payer_client_id, v_lesson.client_id1);
    v_participants := ARRAY[v_payer_id];
    v_splits := ARRAY[v_total_billed];
  END IF;

  FOR v_idx IN 1..COALESCE(array_length(v_participants, 1), 0) LOOP
    v_desired_client := v_participants[v_idx];
    v_desired_amount := v_splits[v_idx];

    UPDATE personal_lesson_charges
    SET billed_amount = v_desired_amount
    WHERE organization_id = p_org_id
      AND personal_lesson_id = p_lesson_id
      AND client_id = v_desired_client;

    IF NOT FOUND THEN
      INSERT INTO personal_lesson_charges (
        organization_id, personal_lesson_id, client_id, billed_amount
      )
      VALUES (p_org_id, p_lesson_id, v_desired_client, v_desired_amount);
    END IF;
  END LOOP;

  DELETE FROM personal_lesson_charges
  WHERE organization_id = p_org_id
    AND personal_lesson_id = p_lesson_id
    AND NOT (client_id = ANY (v_participants));

  SELECT COALESCE(SUM(billed_amount), 0) INTO v_total_billed
  FROM personal_lesson_charges
  WHERE organization_id = p_org_id
    AND personal_lesson_id = p_lesson_id;

  UPDATE personal_lessons
  SET price = v_total_billed
  WHERE organization_id = p_org_id
    AND id = p_lesson_id;
END;
$$;

REVOKE ALL ON FUNCTION sync_personal_lesson_charges(uuid, uuid) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION _record_personal_lesson_payment_impl(
  p_lesson_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_idempotency_key uuid DEFAULT NULL,
  p_price_id uuid DEFAULT NULL,
  p_tariff_units numeric DEFAULT NULL,
  p_tariff_duration_minutes integer DEFAULT NULL,
  p_tariff_price numeric DEFAULT NULL,
  p_tariff_label text DEFAULT NULL,
  p_lesson_duration_minutes integer DEFAULT NULL,
  p_client_id uuid DEFAULT NULL,
  p_charge_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_role text := current_member_role();
  v_lesson personal_lessons%ROWTYPE;
  v_price prices%ROWTYPE;
  v_charge personal_lesson_charges%ROWTYPE;
  v_payer_id uuid;
  v_client_display text;
  v_payment_id uuid;
  v_op_num bigint;
  v_result jsonb;
  v_net_paid_lesson numeric;
  v_charge_net_paid numeric;
  v_remaining numeric;
  v_lesson_minutes integer;
  v_effective_price_id uuid;
  v_pay_price_id uuid;
  v_pay_tariff_duration integer;
  v_pay_tariff_price numeric;
  v_pay_tariff_label text;
  v_pay_tariff_units numeric;
  v_pay_lesson_duration integer;
  v_new_billed numeric;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Организация в режиме только чтения');
  END IF;

  IF NOT member_can_accept_payments() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Нет прав на запись платежа');
  END IF;

  IF p_method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недопустимый способ оплаты');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Сумма должна быть больше нуля');
  END IF;

  SELECT * INTO v_lesson
  FROM personal_lessons
  WHERE id = p_lesson_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Урок не найден');
  END IF;

  IF v_role = 'teacher' AND v_lesson.teacher_member_id IS DISTINCT FROM v_member_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Нет доступа к этому уроку');
  END IF;

  IF v_lesson.client_id1 IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'У урока не указан клиент');
  END IF;

  v_payer_id := COALESCE(p_client_id, v_lesson.client_id1);

  IF NOT personal_lesson_client_is_participant(
    v_payer_id,
    v_lesson.client_id1,
    v_lesson.client_id2,
    v_lesson.client_id3,
    v_lesson.client_id4
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Клиент не является участником урока');
  END IF;

  PERFORM sync_personal_lesson_charges(v_org_id, p_lesson_id);

  IF p_charge_id IS NOT NULL THEN
    SELECT * INTO v_charge
    FROM personal_lesson_charges
    WHERE organization_id = v_org_id
      AND id = p_charge_id
      AND personal_lesson_id = p_lesson_id
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    SELECT * INTO v_charge
    FROM personal_lesson_charges
    WHERE organization_id = v_org_id
      AND personal_lesson_id = p_lesson_id
      AND client_id = v_payer_id
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Начисление не найдено');
  END IF;

  IF v_charge.client_id <> v_payer_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Платёж должен закрывать долг выбранного клиента');
  END IF;

  v_lesson_minutes := COALESCE(
    p_lesson_duration_minutes,
    personal_lesson_slot_minutes(v_lesson.time_start, v_lesson.time_end)
  );

  IF v_lesson.subscription_id IS NULL
    AND v_lesson.price_id IS NULL
    AND p_price_id IS NOT NULL
  THEN
    SELECT * INTO v_price
    FROM prices pr
    WHERE pr.organization_id = v_org_id
      AND pr.id = p_price_id
      AND pr.category = 'private'
      AND pr.lessons = 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Тариф персонального урока не найден');
    END IF;

    v_new_billed := billed_from_tariff(
      v_price.price,
      v_lesson_minutes,
      v_price.duration_minutes
    );

    IF v_new_billed IS NULL OR v_new_billed < 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Некорректная сумма начисления');
    END IF;

    UPDATE personal_lessons
    SET
      price_id = p_price_id,
      price = v_new_billed
    WHERE organization_id = v_org_id
      AND id = p_lesson_id;

    v_lesson.price_id := p_price_id;
    v_lesson.price := v_new_billed;

    PERFORM sync_personal_lesson_charges(v_org_id, p_lesson_id);

    SELECT * INTO v_charge
    FROM personal_lesson_charges
    WHERE organization_id = v_org_id
      AND personal_lesson_id = p_lesson_id
      AND client_id = v_payer_id
    FOR UPDATE;
  END IF;

  v_charge_net_paid := COALESCE(personal_lesson_charge_net_payment(v_org_id, v_charge.id), 0);

  IF v_charge.billed_amount > 0 AND v_charge_net_paid >= v_charge.billed_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Долг этого клиента уже полностью оплачен',
      'error_code', 'already_fully_paid'
    );
  END IF;

  v_remaining := GREATEST(v_charge.billed_amount - v_charge_net_paid, 0);

  IF p_amount > v_remaining THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Сумма превышает остаток к оплате',
      'error_code', 'amount_exceeds_remaining'
    );
  END IF;

  v_net_paid_lesson := COALESCE(personal_lesson_net_payment(v_org_id, p_lesson_id), 0);

  SELECT trim(coalesce(c.last_name, '') || ' ' || coalesce(c.first_name, ''))
  INTO v_client_display
  FROM clients c
  WHERE c.organization_id = v_org_id AND c.id = v_payer_id;

  v_effective_price_id := v_lesson.price_id;

  IF v_effective_price_id IS NOT NULL AND v_lesson.subscription_id IS NULL THEN
    IF p_tariff_price IS NOT NULL
      OR p_tariff_duration_minutes IS NOT NULL
      OR p_tariff_label IS NOT NULL
      OR p_tariff_units IS NOT NULL
      OR p_lesson_duration_minutes IS NOT NULL
    THEN
      v_pay_price_id := COALESCE(p_price_id, v_effective_price_id);
      v_pay_tariff_duration := p_tariff_duration_minutes;
      v_pay_tariff_price := p_tariff_price;
      v_pay_tariff_label := p_tariff_label;
      v_pay_tariff_units := p_tariff_units;
      v_pay_lesson_duration := p_lesson_duration_minutes;
    ELSE
      SELECT * INTO v_price
      FROM prices pr
      WHERE pr.organization_id = v_org_id AND pr.id = v_effective_price_id;

      v_pay_price_id := v_effective_price_id;
      v_pay_tariff_duration := v_price.duration_minutes;
      v_pay_tariff_price := v_price.price;
      v_pay_tariff_label := v_price.label;
      v_pay_tariff_units := tariff_units_snapshot(v_lesson_minutes, v_price.duration_minutes);
      v_pay_lesson_duration := v_lesson_minutes;
    END IF;

    IF v_pay_tariff_duration IS NULL THEN
      v_pay_tariff_units := NULL;
    END IF;
  ELSE
    v_pay_price_id := NULL;
    v_pay_tariff_duration := NULL;
    v_pay_tariff_price := NULL;
    v_pay_tariff_label := NULL;
    v_pay_tariff_units := NULL;
    v_pay_lesson_duration := NULL;
  END IF;

  v_op_num := next_payment_operation_number(v_org_id);

  INSERT INTO payments (
    organization_id,
    client_id,
    client_display,
    amount,
    method,
    personal_lesson_id,
    personal_lesson_charge_id,
    created_by,
    operation_number,
    idempotency_key,
    idempotency_scope,
    payload_fingerprint,
    price_id,
    tariff_duration_minutes,
    tariff_units,
    tariff_price,
    tariff_label,
    lesson_duration_minutes
  )
  VALUES (
    v_org_id,
    v_payer_id,
    coalesce(nullif(v_client_display, ''), 'Клиент'),
    p_amount,
    p_method,
    v_lesson.id,
    v_charge.id,
    v_member_id,
    v_op_num,
    p_idempotency_key,
    'record_personal_lesson_payment',
    md5(
      coalesce(p_lesson_id::text, '') || '|' ||
      coalesce(p_amount::text, '') || '|' ||
      coalesce(p_method, '') || '|' ||
      coalesce(v_pay_price_id::text, '') || '|' ||
      coalesce(v_pay_tariff_units::text, '') || '|' ||
      coalesce(v_payer_id::text, '') || '|' ||
      coalesce(v_charge.id::text, '')
    ),
    v_pay_price_id,
    v_pay_tariff_duration,
    v_pay_tariff_units,
    v_pay_tariff_price,
    v_pay_tariff_label,
    v_pay_lesson_duration
  )
  RETURNING id INTO v_payment_id;

  PERFORM sync_personal_lesson_paid_status(v_org_id, p_lesson_id);

  v_result := jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'operation_number', v_op_num
  );

  RETURN v_result;
EXCEPTION
  WHEN unique_violation THEN
    SELECT p.id INTO v_payment_id
    FROM payments p
    WHERE p.organization_id = v_org_id
      AND p.idempotency_scope = 'record_personal_lesson_payment'
      AND p.idempotency_key = p_idempotency_key;

    IF v_payment_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'payment_id', v_payment_id,
        'already_applied', true
      );
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'duplicate_payment');
END;
$$;

REVOKE ALL ON FUNCTION _record_personal_lesson_payment_impl(
  uuid, numeric, text, uuid, uuid, numeric, integer, numeric, text, integer, uuid, uuid
) FROM PUBLIC, authenticated;

UPDATE personal_lessons pl
SET billing_split_mode = 'equal'
WHERE billing_split_mode = 'single_payer'
  AND paid = 'no'
  AND client_id1 IS NOT NULL
  AND (
    client_id2 IS NOT NULL
    OR client_id3 IS NOT NULL
    OR client_id4 IS NOT NULL
  )
  AND NOT personal_lesson_has_payment_rows(pl.organization_id, pl.id)
  AND NOT (pl.subscription_id IS NOT NULL AND COALESCE(pl.price, 0) = 0);

DO $$
DECLARE
  v_row record;
BEGIN
  FOR v_row IN
    SELECT pl.organization_id, pl.id
    FROM personal_lessons pl
    WHERE pl.billing_split_mode = 'equal'
      AND pl.paid = 'no'
      AND pl.client_id1 IS NOT NULL
      AND (
        pl.client_id2 IS NOT NULL
        OR pl.client_id3 IS NOT NULL
        OR pl.client_id4 IS NOT NULL
      )
      AND NOT personal_lesson_has_payment_rows(pl.organization_id, pl.id)
      AND NOT (pl.subscription_id IS NOT NULL AND COALESCE(pl.price, 0) = 0)
  LOOP
    PERFORM sync_personal_lesson_charges(v_row.organization_id, v_row.id);
  END LOOP;
END;
$$;

COMMIT;
