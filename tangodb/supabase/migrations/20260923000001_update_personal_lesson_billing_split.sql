-- When editing a personal lesson to add participants, sync billing_split_mode
-- so personal_lesson_charges trigger creates per-participant charges (equal split).

BEGIN;

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
  v_new_billing_split_mode text;
  v_price prices%ROWTYPE;
  v_lesson_minutes integer;
  v_slot_changed boolean;
  v_price_id_changed boolean;
  v_multi_participant boolean;
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
  v_new_billing_split_mode := CASE
    WHEN v_payload ? 'billing_split_mode' THEN v_payload ->> 'billing_split_mode'
    ELSE v_lesson.billing_split_mode
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

  v_multi_participant :=
    v_new_client_id1 IS NOT NULL
    AND (
      v_new_client_id2 IS NOT NULL
      OR v_new_client_id3 IS NOT NULL
      OR v_new_client_id4 IS NOT NULL
    );

  IF NOT v_has_payments
    AND v_new_subscription_id IS NULL
    AND NOT (v_new_subscription_id IS NOT NULL AND COALESCE(v_new_price, 0) = 0)
    AND v_multi_participant
    AND NOT (v_payload ? 'billing_split_mode')
  THEN
    v_new_billing_split_mode := 'equal';
  END IF;

  IF v_new_billing_split_mode IS NOT NULL
    AND v_new_billing_split_mode NOT IN ('single_payer', 'equal')
  THEN
    RETURN jsonb_build_object('success', false, 'error', 'Некорректный режим разделения оплаты');
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
    billing_split_mode = COALESCE(v_new_billing_split_mode, pl.billing_split_mode),
    price = v_new_price,
    paid = CASE WHEN v_payload ? 'paid' THEN v_payload ->> 'paid' ELSE pl.paid END,
    subscription_id = v_new_subscription_id
  WHERE pl.id = v_lesson_uuid
    AND pl.organization_id = v_org_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- Re-sync charges for unpaid multi-participant lessons still on single_payer
-- (e.g. solo lesson edited to add a second client before this migration).
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
