-- Custom payment amounts:
-- 1) single visits can be recorded with a custom amount instead of the tariff price
-- 2) personal lessons support partial (top-up) payments with a tracked remaining debt

BEGIN;

-- =============================================================================
-- 1. personal_lessons.paid_amount — tracks net amount actually paid
-- =============================================================================

ALTER TABLE personal_lessons
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC NOT NULL DEFAULT 0 CHECK (paid_amount >= 0);

UPDATE personal_lessons pl
SET paid_amount = GREATEST(COALESCE(personal_lesson_net_payment(pl.organization_id, pl.id), 0), 0);

-- =============================================================================
-- 2. sync_personal_lesson_paid_status — also maintain paid_amount;
--    price = 0 lessons (e.g. package-covered) keep their manually-set paid flag.
-- =============================================================================

CREATE OR REPLACE FUNCTION sync_personal_lesson_paid_status(p_org_id uuid, p_lesson_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_net numeric := personal_lesson_net_payment(p_org_id, p_lesson_id);
  v_price numeric;
BEGIN
  SELECT price INTO v_price
  FROM personal_lessons
  WHERE organization_id = p_org_id AND id = p_lesson_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE personal_lessons
  SET
    paid_amount = GREATEST(v_net, 0),
    paid = CASE
      WHEN v_price > 0 THEN (CASE WHEN v_net >= v_price THEN 'yes' ELSE 'no' END)
      ELSE paid
    END
  WHERE organization_id = p_org_id
    AND id = p_lesson_id;
END;
$$;

-- =============================================================================
-- 3. record_personal_lesson_payment — allow partial/top-up payments.
--    Previously any existing active payment short-circuited to "already_applied";
--    now we only block once the lesson is fully paid, so several partial
--    payments can accumulate towards the price.
-- =============================================================================

CREATE OR REPLACE FUNCTION record_personal_lesson_payment(
  p_lesson_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
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
  v_role text := current_member_role();
  v_lesson personal_lessons%ROWTYPE;
  v_client_display text;
  v_fingerprint text;
  v_cached jsonb;
  v_payment_id uuid;
  v_op_num bigint;
  v_result jsonb;
  v_net_paid numeric;
BEGIN
  v_fingerprint := md5(
    coalesce(p_lesson_id::text, '') || '|' ||
    coalesce(p_amount::text, '') || '|' ||
    coalesce(p_method, '')
  );

  v_cached := check_operation_idempotency(
    v_org_id, 'record_personal_lesson_payment', p_idempotency_key, v_fingerprint
  );
  IF v_cached IS NOT NULL THEN
    IF (v_cached ->> 'success')::boolean IS NOT TRUE AND v_cached ->> 'error_code' = 'idempotency_conflict' THEN
      RETURN v_cached;
    END IF;
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

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
  WHERE id = p_lesson_id AND organization_id = v_org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Урок не найден');
  END IF;

  IF v_role = 'teacher' AND v_lesson.teacher_member_id IS DISTINCT FROM v_member_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Нет доступа к этому уроку');
  END IF;

  IF v_lesson.client_id1 IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'У урока не указан клиент');
  END IF;

  v_net_paid := personal_lesson_net_payment(v_org_id, p_lesson_id);
  IF v_lesson.price > 0 AND v_net_paid >= v_lesson.price THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Урок уже полностью оплачен',
      'error_code', 'already_fully_paid'
    );
  END IF;

  SELECT trim(coalesce(c.last_name, '') || ' ' || coalesce(c.first_name, ''))
  INTO v_client_display
  FROM clients c
  WHERE c.organization_id = v_org_id AND c.id = v_lesson.client_id1;

  v_op_num := next_payment_operation_number(v_org_id);

  INSERT INTO payments (
    organization_id, client_id, client_display, amount, method,
    personal_lesson_id, created_by, operation_number,
    idempotency_key, idempotency_scope, payload_fingerprint
  )
  VALUES (
    v_org_id, v_lesson.client_id1, coalesce(nullif(v_client_display, ''), 'Клиент'),
    p_amount, p_method, v_lesson.id, v_member_id, v_op_num,
    p_idempotency_key, 'record_personal_lesson_payment', v_fingerprint
  )
  RETURNING id INTO v_payment_id;

  PERFORM sync_personal_lesson_paid_status(v_org_id, p_lesson_id);

  v_result := jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'operation_number', v_op_num
  );

  PERFORM store_operation_idempotency(
    v_org_id, 'record_personal_lesson_payment', p_idempotency_key, v_fingerprint, v_result
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

-- =============================================================================
-- 4. void_personal_lesson_payment — storno every active payment row for the
--    lesson (not just the first one), so top-up payments are fully cancelled.
-- =============================================================================

CREATE OR REPLACE FUNCTION void_personal_lesson_payment(
  p_lesson_id uuid,
  p_reason_code text DEFAULT 'duplicate',
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
  v_payment RECORD;
  v_remaining numeric;
  v_storno_result jsonb;
  v_voided_count int := 0;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  FOR v_payment IN
    SELECT p.id
    FROM payments p
    WHERE p.organization_id = v_org_id
      AND p.personal_lesson_id = p_lesson_id
      AND p.operation_kind = 'payment'
      AND p.replaces_payment_id IS NULL
    ORDER BY p.created_at
  LOOP
    v_remaining := payment_remaining_amount(v_org_id, v_payment.id);
    IF v_remaining > 0 THEN
      v_storno_result := storno_payment(v_payment.id, v_remaining, p_reason_code, p_reason_comment, NULL);
      IF NOT COALESCE((v_storno_result ->> 'success')::boolean, false) THEN
        PERFORM sync_personal_lesson_paid_status(v_org_id, p_lesson_id);
        RETURN v_storno_result;
      END IF;
      v_voided_count := v_voided_count + 1;
    END IF;
  END LOOP;

  PERFORM sync_personal_lesson_paid_status(v_org_id, p_lesson_id);

  IF v_voided_count = 0 THEN
    RETURN jsonb_build_object('success', true, 'already_void', true);
  END IF;

  RETURN jsonb_build_object('success', true, 'voided_count', v_voided_count);
END;
$$;

-- =============================================================================
-- 5. record_single_visit — accept an optional custom amount instead of always
--    charging the tariff price (e.g. a discounted/negotiated drop-in rate).
-- =============================================================================

DROP FUNCTION IF EXISTS record_single_visit(date, uuid, uuid, uuid, text, uuid, boolean);
DROP FUNCTION IF EXISTS _record_single_visit_before_venue_rules(date, uuid, uuid, uuid, text, uuid);

CREATE FUNCTION _record_single_visit_before_venue_rules(
  p_visit_date date,
  p_schedule_slot_id uuid,
  p_client_id uuid,
  p_price_id uuid,
  p_method text DEFAULT 'cash',
  p_idempotency_key uuid DEFAULT NULL,
  p_amount numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_slot schedule_slots%ROWTYPE;
  v_price prices%ROWTYPE;
  v_amount numeric;
  v_client_display text;
  v_visit_id uuid;
  v_payment_id uuid;
  v_fingerprint text;
  v_cached jsonb;
  v_op_num bigint;
  v_result jsonb;
BEGIN
  v_fingerprint := md5(
    coalesce(p_visit_date::text, '') || '|' ||
    coalesce(p_schedule_slot_id::text, '') || '|' ||
    coalesce(p_client_id::text, '') || '|' ||
    coalesce(p_price_id::text, '') || '|' ||
    coalesce(p_method, '') || '|' ||
    coalesce(p_amount::text, '')
  );

  v_cached := check_operation_idempotency(
    v_org_id, 'record_single_visit', p_idempotency_key, v_fingerprint
  );
  IF v_cached IS NOT NULL THEN
    IF (v_cached ->> 'success')::boolean IS NOT TRUE AND v_cached ->> 'error_code' = 'idempotency_conflict' THEN
      RETURN v_cached;
    END IF;
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Организация в режиме только чтения');
  END IF;

  IF p_visit_date IS NULL OR p_visit_date > current_date THEN
    RETURN jsonb_build_object('success', false, 'error', 'Разовое посещение можно отметить только за прошедший или текущий день');
  END IF;

  IF p_method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недопустимый способ оплаты');
  END IF;

  IF p_amount IS NOT NULL AND p_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Сумма должна быть неотрицательной');
  END IF;

  SELECT * INTO v_slot
  FROM schedule_slots ss
  WHERE ss.organization_id = v_org_id
    AND ss.id = p_schedule_slot_id
    AND ss.class_id IS NOT NULL
    AND ss.valid_from <= p_visit_date
    AND (ss.valid_to IS NULL OR ss.valid_to >= p_visit_date)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Групповое занятие не найдено');
  END IF;

  IF NOT can_record_single_visit_for_slot(v_slot) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав для разового посещения');
  END IF;

  SELECT * INTO v_price
  FROM prices pr
  WHERE pr.organization_id = v_org_id
    AND pr.id = p_price_id
    AND pr.category = 'single_visit';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Тариф разового посещения не найден');
  END IF;

  IF v_price.location_id IS NOT NULL AND v_price.location_id IS DISTINCT FROM v_slot.location_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Тариф не подходит для этой локации');
  END IF;

  IF v_price.discipline_id IS NOT NULL AND v_price.discipline_id IS DISTINCT FROM v_slot.discipline_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Тариф не подходит для этого направления');
  END IF;

  v_amount := COALESCE(p_amount, v_price.price);

  SELECT trim(coalesce(c.last_name, '') || ' ' || coalesce(c.first_name, ''))
  INTO v_client_display
  FROM clients c
  WHERE c.organization_id = v_org_id AND c.id = p_client_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Клиент не найден');
  END IF;

  INSERT INTO single_visits (
    organization_id, visit_date, schedule_slot_id, schedule_group_id,
    client_id, client_display, price_id, amount, method,
    location_id, discipline_id, teacher_member_id, created_by
  )
  VALUES (
    v_org_id, p_visit_date, v_slot.id, v_slot.class_id,
    p_client_id, coalesce(nullif(v_client_display, ''), 'Клиент'),
    v_price.id, v_amount, p_method,
    v_slot.location_id, v_slot.discipline_id, v_slot.teacher_member_id, v_member_id
  )
  ON CONFLICT (organization_id, visit_date, schedule_slot_id, client_id)
  DO UPDATE SET
    price_id = EXCLUDED.price_id,
    amount = EXCLUDED.amount,
    method = EXCLUDED.method,
    client_display = EXCLUDED.client_display,
    teacher_member_id = EXCLUDED.teacher_member_id,
    created_by = EXCLUDED.created_by,
    created_at = now()
  RETURNING id INTO v_visit_id;

  SELECT p.id INTO v_payment_id
  FROM payments p
  WHERE p.organization_id = v_org_id
    AND p.single_visit_id = v_visit_id
    AND p.operation_kind = 'payment'
    AND p.replaces_payment_id IS NULL
    AND payment_remaining_amount(v_org_id, p.id) > 0
  LIMIT 1;

  IF v_payment_id IS NULL THEN
    v_op_num := next_payment_operation_number(v_org_id);

    INSERT INTO payments (
      organization_id, client_id, client_display, amount, method,
      single_visit_id, created_by, operation_number,
      idempotency_key, idempotency_scope, payload_fingerprint
    )
    VALUES (
      v_org_id, p_client_id, coalesce(nullif(v_client_display, ''), 'Клиент'),
      v_amount, p_method, v_visit_id, v_member_id, v_op_num,
      p_idempotency_key, 'record_single_visit', v_fingerprint
    )
    RETURNING id INTO v_payment_id;
  ELSE
    SELECT p.operation_number INTO v_op_num
    FROM payments p WHERE p.id = v_payment_id;
  END IF;

  v_result := jsonb_build_object(
    'success', true,
    'visitId', v_visit_id,
    'payment_id', v_payment_id,
    'operation_number', v_op_num
  );

  PERFORM store_operation_idempotency(
    v_org_id, 'record_single_visit', p_idempotency_key, v_fingerprint, v_result
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION _record_single_visit_before_venue_rules(date, uuid, uuid, uuid, text, uuid, numeric) FROM PUBLIC, authenticated;

CREATE FUNCTION record_single_visit(
  p_visit_date date,
  p_schedule_slot_id uuid,
  p_client_id uuid,
  p_price_id uuid,
  p_method text DEFAULT 'cash',
  p_idempotency_key uuid DEFAULT NULL,
  p_amount numeric DEFAULT NULL,
  p_venue_rule_acknowledged boolean DEFAULT false
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
    '|', p_visit_date, p_schedule_slot_id, p_client_id, p_price_id, p_method, p_venue_rule_acknowledged, p_amount
  ));
BEGIN
  v_cached := check_operation_idempotency(v_org_id, 'record_single_visit', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN
    IF v_cached ->> 'error_code' = 'idempotency_conflict'
      AND NOT COALESCE(p_venue_rule_acknowledged, false)
    THEN
      v_cached := check_operation_idempotency(
        v_org_id,
        'record_single_visit',
        p_idempotency_key,
        md5(
          coalesce(p_visit_date::text, '') || '|' ||
          coalesce(p_schedule_slot_id::text, '') || '|' ||
          coalesce(p_client_id::text, '') || '|' ||
          coalesce(p_price_id::text, '') || '|' ||
          coalesce(p_method, '')
        )
      );
    END IF;
    IF v_cached ->> 'error_code' = 'idempotency_conflict' THEN RETURN v_cached; END IF;
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;
  v_status := venue_cost_status_for_org(v_org_id, current_date);
  IF COALESCE((v_status ->> 'acknowledgement_required')::boolean, false)
    AND NOT COALESCE(p_venue_rule_acknowledged, false)
  THEN
    RETURN jsonb_build_object(
      'success', false, 'error_code', 'venue_rule_ack_required',
      'error', 'venue_rule_ack_required', 'venue_rule_status', v_status
    );
  END IF;
  SELECT p.id INTO v_existing_payment_id
  FROM single_visits sv
  JOIN payments p
    ON p.organization_id = sv.organization_id
   AND p.single_visit_id = sv.id
   AND p.operation_kind = 'payment'
   AND p.replaces_payment_id IS NULL
  WHERE sv.organization_id = v_org_id
    AND sv.visit_date = p_visit_date
    AND sv.schedule_slot_id = p_schedule_slot_id
    AND sv.client_id = p_client_id
    AND payment_remaining_amount(v_org_id, p.id) > 0
  LIMIT 1;
  v_result := _record_single_visit_before_venue_rules(
    p_visit_date, p_schedule_slot_id, p_client_id, p_price_id, p_method, p_idempotency_key, p_amount
  );
  IF COALESCE((v_result ->> 'success')::boolean, false) THEN
    IF v_existing_payment_id IS NULL
      AND NOT COALESCE((v_result ->> 'already_applied')::boolean, false)
    THEN
      PERFORM store_venue_payment_ack_if_required(
        v_status, (v_result ->> 'payment_id')::uuid, 'record_single_visit', p_idempotency_key
      );
    END IF;
    PERFORM store_operation_idempotency(v_org_id, 'record_single_visit', p_idempotency_key, v_fingerprint, v_result);
  END IF;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION record_single_visit(date, uuid, uuid, uuid, text, uuid, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_single_visit(date, uuid, uuid, uuid, text, uuid, numeric, boolean) TO authenticated;

-- =============================================================================
-- 6. financial_debtors_v — personal lesson debt is the remaining balance,
--    not the full lesson price, once a partial payment has been recorded.
-- =============================================================================

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
  GREATEST(pl.price - pl.paid_amount, 0) AS amount,
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
-- 7. Expose paid_amount on the canonical personal lesson listing.
--    (personal_lessons_teacher_v intentionally excludes financial fields.)
-- =============================================================================

COMMIT;
