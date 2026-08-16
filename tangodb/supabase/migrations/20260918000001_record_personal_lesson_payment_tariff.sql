-- Personal tariff stage 1 (PL-TARIFF Prompt 3):
-- unified record_personal_lesson_payment + tariff snapshot + payer + cap;
-- restate clears price_id; update_personal_lesson recalc; storno/correct copy snapshot.

BEGIN;

-- =============================================================================
-- 1. Pricing helpers (multiply-first, matches personalTariffPricing.ts / §3.2)
-- =============================================================================

CREATE OR REPLACE FUNCTION schedule_time_to_minutes(p_time text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    CASE
      WHEN p_time IS NULL OR btrim(p_time) = '' THEN NULL
      ELSE (
        split_part(btrim(p_time), ':', 1)::integer * 60
        + split_part(btrim(p_time), ':', 2)::integer
      )
    END;
$$;

CREATE OR REPLACE FUNCTION personal_lesson_slot_minutes(p_time_start text, p_time_end text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    CASE
      WHEN schedule_time_to_minutes(p_time_start) IS NULL
        OR schedule_time_to_minutes(p_time_end) IS NULL
      THEN NULL
      ELSE schedule_time_to_minutes(p_time_end) - schedule_time_to_minutes(p_time_start)
    END;
$$;

CREATE OR REPLACE FUNCTION billed_from_tariff(
  p_price numeric,
  p_lesson_minutes integer,
  p_tariff_duration_minutes integer
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    CASE
      WHEN p_tariff_duration_minutes IS NULL THEN ROUND(p_price, 2)
      WHEN p_tariff_duration_minutes <= 0 OR p_lesson_minutes IS NULL OR p_lesson_minutes <= 0 THEN NULL
      ELSE ROUND(
        (p_price * p_lesson_minutes::numeric) / p_tariff_duration_minutes::numeric,
        2
      )
    END;
$$;

CREATE OR REPLACE FUNCTION tariff_units_snapshot(
  p_lesson_minutes integer,
  p_tariff_duration_minutes integer
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    CASE
      WHEN p_tariff_duration_minutes IS NULL OR p_tariff_duration_minutes <= 0 THEN NULL
      WHEN p_lesson_minutes IS NULL OR p_lesson_minutes <= 0 THEN NULL
      ELSE ROUND(
        p_lesson_minutes::numeric / p_tariff_duration_minutes::numeric,
        4
      )
    END;
$$;

CREATE OR REPLACE FUNCTION personal_lesson_has_payment_rows(p_org_id uuid, p_lesson_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM payments p
    WHERE p.organization_id = p_org_id
      AND p.personal_lesson_id = p_lesson_id
  );
$$;

CREATE OR REPLACE FUNCTION personal_lesson_client_is_participant(
  p_client_id uuid,
  p_client_id1 uuid,
  p_client_id2 uuid,
  p_client_id3 uuid,
  p_client_id4 uuid
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    p_client_id IS NOT NULL
    AND (
      p_client_id = p_client_id1
      OR (p_client_id2 IS NOT NULL AND p_client_id = p_client_id2)
      OR (p_client_id3 IS NOT NULL AND p_client_id = p_client_id3)
      OR (p_client_id4 IS NOT NULL AND p_client_id = p_client_id4)
    );
$$;

-- =============================================================================
-- 2. record_personal_lesson_payment — single public signature
-- =============================================================================

DROP FUNCTION IF EXISTS record_personal_lesson_payment(uuid, numeric, text, uuid, boolean);
DROP FUNCTION IF EXISTS record_personal_lesson_payment(uuid, numeric, text, uuid);
DROP FUNCTION IF EXISTS record_personal_lesson_payment(uuid, numeric, text);
DROP FUNCTION IF EXISTS _record_personal_lesson_payment_before_venue_rules(uuid, numeric, text, uuid);

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
  p_client_id uuid DEFAULT NULL
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
  v_payer_id uuid;
  v_client_display text;
  v_payment_id uuid;
  v_op_num bigint;
  v_result jsonb;
  v_net_paid numeric;
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

  v_lesson_minutes := COALESCE(
    p_lesson_duration_minutes,
    personal_lesson_slot_minutes(v_lesson.time_start, v_lesson.time_end)
  );

  -- Package lessons: never set price_id or recalc billed from tariff.
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
  END IF;

  v_net_paid := COALESCE(personal_lesson_net_payment(v_org_id, p_lesson_id), 0);

  IF v_lesson.price > 0 AND v_net_paid >= v_lesson.price THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Урок уже полностью оплачен',
      'error_code', 'already_fully_paid'
    );
  END IF;

  v_remaining := GREATEST(v_lesson.price - v_net_paid, 0);

  IF p_amount > v_remaining THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Сумма превышает остаток к оплате',
      'error_code', 'amount_exceeds_remaining'
    );
  END IF;

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
      coalesce(v_payer_id::text, '')
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
  uuid, numeric, text, uuid, uuid, numeric, integer, numeric, text, integer, uuid
) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION record_personal_lesson_payment(
  p_lesson_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_idempotency_key uuid DEFAULT NULL,
  p_venue_rule_acknowledged boolean DEFAULT false,
  p_price_id uuid DEFAULT NULL,
  p_tariff_units numeric DEFAULT NULL,
  p_tariff_duration_minutes integer DEFAULT NULL,
  p_tariff_price numeric DEFAULT NULL,
  p_tariff_label text DEFAULT NULL,
  p_lesson_duration_minutes integer DEFAULT NULL,
  p_client_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_status jsonb;
  v_result jsonb;
  v_cached jsonb;
  v_existing_payment_id uuid;
  v_fingerprint text := md5(concat_ws(
    '|',
    p_lesson_id,
    p_amount,
    p_method,
    p_venue_rule_acknowledged,
    p_price_id,
    p_tariff_units,
    p_client_id
  ));
  v_legacy_fingerprint text := md5(
    coalesce(p_lesson_id::text, '') || '|' ||
    coalesce(p_amount::text, '') || '|' ||
    coalesce(p_method, '')
  );
BEGIN
  v_cached := check_operation_idempotency(
    v_org_id, 'record_personal_lesson_payment', p_idempotency_key, v_fingerprint
  );
  IF v_cached IS NOT NULL THEN
    IF v_cached ->> 'error_code' = 'idempotency_conflict'
      AND NOT COALESCE(p_venue_rule_acknowledged, false)
    THEN
      v_cached := check_operation_idempotency(
        v_org_id,
        'record_personal_lesson_payment',
        p_idempotency_key,
        v_legacy_fingerprint
      );
    END IF;
    IF v_cached ->> 'error_code' = 'idempotency_conflict' THEN
      RETURN v_cached;
    END IF;
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  v_status := venue_cost_status_for_org(v_org_id, current_date);
  IF COALESCE((v_status ->> 'acknowledgement_required')::boolean, false)
    AND NOT COALESCE(p_venue_rule_acknowledged, false)
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'venue_rule_ack_required',
      'error', 'venue_rule_ack_required',
      'venue_rule_status', v_status
    );
  END IF;

  SELECT p.id INTO v_existing_payment_id
  FROM payments p
  WHERE p.organization_id = v_org_id
    AND p.personal_lesson_id = p_lesson_id
    AND p.operation_kind = 'payment'
    AND p.replaces_payment_id IS NULL
    AND payment_remaining_amount(v_org_id, p.id) > 0
  ORDER BY p.created_at
  LIMIT 1;

  v_result := _record_personal_lesson_payment_impl(
    p_lesson_id,
    p_amount,
    p_method,
    p_idempotency_key,
    p_price_id,
    p_tariff_units,
    p_tariff_duration_minutes,
    p_tariff_price,
    p_tariff_label,
    p_lesson_duration_minutes,
    p_client_id
  );

  IF COALESCE((v_result ->> 'success')::boolean, false) THEN
    IF v_existing_payment_id IS NULL
      AND NOT COALESCE((v_result ->> 'already_applied')::boolean, false)
    THEN
      PERFORM store_venue_payment_ack_if_required(
        v_status,
        (v_result ->> 'payment_id')::uuid,
        'record_personal_lesson_payment',
        p_idempotency_key
      );
    END IF;
    PERFORM store_operation_idempotency(
      v_org_id,
      'record_personal_lesson_payment',
      p_idempotency_key,
      v_fingerprint,
      v_result
    );
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION record_personal_lesson_payment(
  uuid, numeric, text, uuid, boolean, uuid, numeric, integer, numeric, text, integer, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_personal_lesson_payment(
  uuid, numeric, text, uuid, boolean, uuid, numeric, integer, numeric, text, integer, uuid
) TO authenticated;

-- =============================================================================
-- 3. restate_personal_lesson_amount — clear price_id on success (§3.3)
-- =============================================================================

CREATE OR REPLACE FUNCTION restate_personal_lesson_amount(
  p_lesson_id uuid,
  p_new_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_lesson personal_lessons%ROWTYPE;
  v_paid numeric;
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

  IF p_lesson_id IS NULL OR p_new_amount IS NULL OR p_new_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.adjustInvalid');
  END IF;

  SELECT * INTO v_lesson
  FROM personal_lessons
  WHERE id = p_lesson_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.adjustFailed');
  END IF;

  v_paid := COALESCE(v_lesson.paid_amount, 0);

  IF p_new_amount < v_paid THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.adjustBelowPaid');
  END IF;

  UPDATE personal_lessons
  SET
    price = p_new_amount,
    price_id = NULL,
    paid = CASE WHEN p_new_amount <= v_paid THEN 'yes' ELSE 'no' END
  WHERE id = p_lesson_id
    AND organization_id = v_org_id;

  RETURN jsonb_build_object(
    'success', true,
    'old_amount', v_lesson.price,
    'new_amount', p_new_amount,
    'paid_amount', v_paid
  );
END;
$$;

-- =============================================================================
-- 4. update_personal_lesson — price_id / payer + billed recalc (§3.3)
-- =============================================================================

CREATE OR REPLACE FUNCTION update_personal_lesson(
  p_lesson_id text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_role text := current_member_role();
  v_lesson RECORD;
  v_today date := current_date;
  v_lesson_uuid uuid;
  v_new_date date;
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_has_payments boolean;
  v_new_time_start text;
  v_new_time_end text;
  v_new_price_id uuid;
  v_new_payer_client_id uuid;
  v_new_subscription_id uuid;
  v_new_client_id1 uuid;
  v_new_client_id2 uuid;
  v_new_client_id3 uuid;
  v_new_client_id4 uuid;
  v_new_price numeric;
  v_price prices%ROWTYPE;
  v_lesson_minutes integer;
  v_slot_changed boolean;
  v_price_id_changed boolean;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Организация в режиме только чтения');
  END IF;

  IF p_lesson_id IS NULL OR trim(p_lesson_id) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не указан идентификатор урока');
  END IF;

  IF v_payload = '{}'::jsonb THEN
    RETURN jsonb_build_object('success', false, 'error', 'Нет данных для обновления');
  END IF;

  BEGIN
    v_lesson_uuid := p_lesson_id::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RETURN jsonb_build_object('success', false, 'error', 'Урок не найден');
  END;

  SELECT * INTO v_lesson
  FROM personal_lessons
  WHERE id = v_lesson_uuid
    AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Урок не найден');
  END IF;

  IF v_role = 'accountant' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  IF v_role = 'teacher' AND NOT teacher_can_access_lesson(v_lesson_uuid) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав для этого урока');
  END IF;

  IF v_lesson.date < v_today AND NOT can_edit_past_schedule() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Редактирование недоступно для прошедших уроков');
  END IF;

  IF v_payload ? 'date' THEN
    BEGIN
      v_new_date := (v_payload ->> 'date')::date;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RETURN jsonb_build_object('success', false, 'error', 'Неверный формат даты');
    END;

    IF v_new_date < v_today AND NOT can_edit_past_schedule() THEN
      RETURN jsonb_build_object('success', false, 'error', 'Новая дата не может быть в прошлом');
    END IF;
  END IF;

  IF v_lesson.subscription_id IS NOT NULL
    AND v_lesson.attendance_status IN ('present', 'absent') THEN
    IF (v_payload ? 'subscription_id'
        AND NULLIF(v_payload ->> 'subscription_id', '')::uuid IS DISTINCT FROM v_lesson.subscription_id)
      OR (v_payload ? 'client_id1'
        AND NULLIF(v_payload ->> 'client_id1', '')::uuid IS DISTINCT FROM v_lesson.client_id1)
      OR (v_payload ? 'client_id2'
        AND NULLIF(v_payload ->> 'client_id2', '')::uuid IS DISTINCT FROM COALESCE(v_lesson.client_id2, NULL))
      OR (v_payload ? 'client_id3'
        AND NULLIF(v_payload ->> 'client_id3', '')::uuid IS DISTINCT FROM COALESCE(v_lesson.client_id3, NULL))
      OR (v_payload ? 'client_id4'
        AND NULLIF(v_payload ->> 'client_id4', '')::uuid IS DISTINCT FROM COALESCE(v_lesson.client_id4, NULL)) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Сначала смените отметку посещаемости');
    END IF;
  END IF;

  v_has_payments := personal_lesson_has_payment_rows(v_org_id, v_lesson_uuid);

  v_new_time_start := CASE
    WHEN v_payload ? 'time_start' THEN v_payload ->> 'time_start'
    ELSE v_lesson.time_start
  END;
  v_new_time_end := CASE
    WHEN v_payload ? 'time_end' THEN v_payload ->> 'time_end'
    ELSE v_lesson.time_end
  END;
  v_new_price_id := CASE
    WHEN v_payload ? 'price_id' THEN NULLIF(v_payload ->> 'price_id', '')::uuid
    ELSE v_lesson.price_id
  END;
  v_new_payer_client_id := CASE
    WHEN v_payload ? 'payer_client_id' THEN NULLIF(v_payload ->> 'payer_client_id', '')::uuid
    ELSE v_lesson.payer_client_id
  END;
  v_new_subscription_id := CASE
    WHEN v_payload ? 'subscription_id' THEN NULLIF(v_payload ->> 'subscription_id', '')::uuid
    ELSE v_lesson.subscription_id
  END;
  v_new_client_id1 := CASE
    WHEN v_payload ? 'client_id1' THEN NULLIF(v_payload ->> 'client_id1', '')::uuid
    ELSE v_lesson.client_id1
  END;
  v_new_client_id2 := CASE
    WHEN v_payload ? 'client_id2' THEN NULLIF(v_payload ->> 'client_id2', '')::uuid
    ELSE v_lesson.client_id2
  END;
  v_new_client_id3 := CASE
    WHEN v_payload ? 'client_id3' THEN NULLIF(v_payload ->> 'client_id3', '')::uuid
    ELSE v_lesson.client_id3
  END;
  v_new_client_id4 := CASE
    WHEN v_payload ? 'client_id4' THEN NULLIF(v_payload ->> 'client_id4', '')::uuid
    ELSE v_lesson.client_id4
  END;
  v_new_price := CASE
    WHEN v_payload ? 'price' THEN (v_payload ->> 'price')::numeric
    ELSE v_lesson.price
  END;

  IF v_new_subscription_id IS NOT NULL THEN
    v_new_price_id := NULL;
  END IF;

  IF v_new_payer_client_id IS NOT NULL
    AND NOT personal_lesson_client_is_participant(
      v_new_payer_client_id,
      v_new_client_id1,
      v_new_client_id2,
      v_new_client_id3,
      v_new_client_id4
    )
  THEN
    RETURN jsonb_build_object('success', false, 'error', 'Плательщик должен быть участником урока');
  END IF;

  v_slot_changed :=
    (v_payload ? 'time_start' AND v_new_time_start IS DISTINCT FROM v_lesson.time_start)
    OR (v_payload ? 'time_end' AND v_new_time_end IS DISTINCT FROM v_lesson.time_end);
  v_price_id_changed :=
    v_payload ? 'price_id' AND v_new_price_id IS DISTINCT FROM v_lesson.price_id;

  IF v_new_price_id IS NOT NULL
    AND NOT v_has_payments
    AND v_new_subscription_id IS NULL
    AND (v_slot_changed OR v_price_id_changed)
    AND NOT (v_payload ? 'price')
  THEN
    SELECT * INTO v_price
    FROM prices pr
    WHERE pr.organization_id = v_org_id AND pr.id = v_new_price_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Тариф не найден');
    END IF;

    v_lesson_minutes := personal_lesson_slot_minutes(v_new_time_start, v_new_time_end);
    v_new_price := billed_from_tariff(
      v_price.price,
      v_lesson_minutes,
      v_price.duration_minutes
    );

    IF v_new_price IS NULL OR v_new_price < 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Некорректная сумма начисления');
    END IF;
  END IF;

  UPDATE personal_lessons pl
  SET
    date = CASE WHEN v_payload ? 'date' THEN (v_payload ->> 'date')::date ELSE pl.date END,
    time_start = v_new_time_start,
    time_end = v_new_time_end,
    location_id = CASE
      WHEN v_payload ? 'location_id' THEN NULLIF(v_payload ->> 'location_id', '')::uuid
      ELSE pl.location_id
    END,
    teacher_member_id = CASE
      WHEN v_payload ? 'teacher_member_id' THEN NULLIF(v_payload ->> 'teacher_member_id', '')::uuid
      ELSE pl.teacher_member_id
    END,
    discipline_id = CASE
      WHEN v_payload ? 'discipline_id' THEN NULLIF(v_payload ->> 'discipline_id', '')::uuid
      ELSE pl.discipline_id
    END,
    type = CASE WHEN v_payload ? 'type' THEN v_payload ->> 'type' ELSE pl.type END,
    client_id1 = v_new_client_id1,
    client_id2 = v_new_client_id2,
    client_id3 = v_new_client_id3,
    client_id4 = v_new_client_id4,
    price_id = v_new_price_id,
    payer_client_id = v_new_payer_client_id,
    price = v_new_price,
    paid = CASE WHEN v_payload ? 'paid' THEN v_payload ->> 'paid' ELSE pl.paid END,
    subscription_id = v_new_subscription_id
  WHERE pl.id = v_lesson_uuid
    AND pl.organization_id = v_org_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- =============================================================================
-- 5. Storno / correction — copy tariff snapshot from source payment
-- =============================================================================

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
    idempotency_key, idempotency_scope, payload_fingerprint,
    price_id, tariff_duration_minutes, tariff_units, tariff_price, tariff_label, lesson_duration_minutes
  )
  VALUES (
    v_payment.organization_id, v_payment.client_id, v_payment.client_display,
    v_storno_amount, v_payment.method, v_payment.method_comment,
    v_payment.subscription_id, v_payment.personal_lesson_id, v_payment.single_visit_id,
    p_member_id, 'storno', v_payment.id,
    p_reason_code, p_reason_comment, v_op_num,
    p_idempotency_key, p_idempotency_scope, p_fingerprint,
    v_payment.price_id, v_payment.tariff_duration_minutes, v_payment.tariff_units,
    v_payment.tariff_price, v_payment.tariff_label, v_payment.lesson_duration_minutes
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
    subscription_id, personal_lesson_id, single_visit_id,
    created_by, operation_kind, replaces_payment_id,
    correction_reason_code, correction_comment, operation_number,
    idempotency_key, idempotency_scope, payload_fingerprint,
    price_id, tariff_duration_minutes, tariff_units, tariff_price, tariff_label, lesson_duration_minutes
  )
  VALUES (
    v_payment.organization_id, v_payment.client_id, v_payment.client_display,
    p_new_amount, p_new_method, v_payment.method_comment,
    v_payment.subscription_id, v_payment.personal_lesson_id, v_payment.single_visit_id,
    v_member_id, 'payment', v_payment.id,
    p_reason_code, p_reason_comment, v_op_num,
    p_idempotency_key, 'correct_payment', v_fingerprint,
    v_payment.price_id, v_payment.tariff_duration_minutes, v_payment.tariff_units,
    v_payment.tariff_price, v_payment.tariff_label, v_payment.lesson_duration_minutes
  )
  RETURNING id INTO v_new_payment_id;

  IF v_payment.personal_lesson_id IS NOT NULL THEN
    PERFORM sync_personal_lesson_paid_status(v_org_id, v_payment.personal_lesson_id);
  END IF;

  v_result := jsonb_build_object(
    'success', true,
    'storno_id', v_storno_id,
    'payment_id', v_new_payment_id,
    'operation_number', v_op_num
  );

  PERFORM store_operation_idempotency(v_org_id, 'correct_payment', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;

COMMIT;
