-- Allow recording a single visit with a custom amount and no tariff (negotiated drop-in rate).

BEGIN;

ALTER TABLE single_visits
  ALTER COLUMN price_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION enforce_tenant_row_org_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'class_teachers' THEN
    IF NOT EXISTS (
      SELECT 1 FROM classes c
      WHERE c.organization_id = NEW.organization_id AND c.id = NEW.class_id
    ) THEN
      RAISE EXCEPTION 'class_id does not belong to organization';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = NEW.organization_id AND om.id = NEW.member_id
    ) THEN
      RAISE EXCEPTION 'member_id does not belong to organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'subscriptions' THEN
    IF NEW.discipline_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM disciplines d
      WHERE d.organization_id = NEW.organization_id AND d.id = NEW.discipline_id
    ) THEN
      RAISE EXCEPTION 'discipline_id does not belong to organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'attendance' THEN
    IF NOT EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.organization_id = NEW.organization_id AND s.id = NEW.subscription_id
    ) THEN
      RAISE EXCEPTION 'subscription_id does not belong to organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'personal_lessons' THEN
    IF NEW.subscription_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.organization_id = NEW.organization_id AND s.id = NEW.subscription_id
    ) THEN
      RAISE EXCEPTION 'subscription_id does not belong to organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'schedule_slots' THEN
    IF NEW.discipline_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM disciplines d
      WHERE d.organization_id = NEW.organization_id AND d.id = NEW.discipline_id
    ) THEN
      RAISE EXCEPTION 'discipline_id does not belong to organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'single_visits' THEN
    IF NOT EXISTS (
      SELECT 1 FROM schedule_slots ss
      WHERE ss.organization_id = NEW.organization_id AND ss.id = NEW.schedule_slot_id
    ) THEN
      RAISE EXCEPTION 'schedule_slot_id does not belong to organization';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM classes c
      WHERE c.organization_id = NEW.organization_id AND c.id = NEW.schedule_group_id
    ) THEN
      RAISE EXCEPTION 'schedule_group_id does not belong to organization';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM clients c
      WHERE c.organization_id = NEW.organization_id AND c.id = NEW.client_id
    ) THEN
      RAISE EXCEPTION 'client_id does not belong to organization';
    END IF;
    IF NEW.price_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM prices pr
      WHERE pr.organization_id = NEW.organization_id AND pr.id = NEW.price_id
    ) THEN
      RAISE EXCEPTION 'price_id does not belong to organization';
    END IF;
    IF NEW.created_by IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = NEW.organization_id AND om.id = NEW.created_by
    ) THEN
      RAISE EXCEPTION 'created_by does not belong to organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'payments' THEN
    IF NOT EXISTS (
      SELECT 1 FROM clients c
      WHERE c.organization_id = NEW.organization_id AND c.id = NEW.client_id
    ) THEN
      RAISE EXCEPTION 'client_id does not belong to organization';
    END IF;
    IF NEW.subscription_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.organization_id = NEW.organization_id AND s.id = NEW.subscription_id
    ) THEN
      RAISE EXCEPTION 'subscription_id does not belong to organization';
    END IF;
    IF NEW.personal_lesson_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM personal_lessons pl
      WHERE pl.organization_id = NEW.organization_id AND pl.id = NEW.personal_lesson_id
    ) THEN
      RAISE EXCEPTION 'personal_lesson_id does not belong to organization';
    END IF;
    IF NEW.single_visit_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM single_visits sv
      WHERE sv.organization_id = NEW.organization_id AND sv.id = NEW.single_visit_id
    ) THEN
      RAISE EXCEPTION 'single_visit_id does not belong to organization';
    END IF;
    IF NEW.created_by IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = NEW.organization_id AND om.id = NEW.created_by
    ) THEN
      RAISE EXCEPTION 'created_by does not belong to organization';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS record_single_visit(date, uuid, uuid, uuid, text, uuid, numeric, boolean);
DROP FUNCTION IF EXISTS _record_single_visit_before_venue_rules(date, uuid, uuid, uuid, text, uuid, numeric);

CREATE FUNCTION _record_single_visit_before_venue_rules(
  p_visit_date date,
  p_schedule_slot_id uuid,
  p_client_id uuid,
  p_price_id uuid DEFAULT NULL,
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

  IF p_price_id IS NULL THEN
    IF p_amount IS NULL OR p_amount <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Укажите тариф или сумму оплаты');
    END IF;
    v_amount := p_amount;
  ELSE
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
  END IF;

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
    p_price_id, v_amount, p_method,
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
  p_price_id uuid DEFAULT NULL,
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

COMMIT;
