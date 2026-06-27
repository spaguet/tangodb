-- Fix record_single_visit: ON CONFLICT must match partial unique index predicate

BEGIN;

CREATE OR REPLACE FUNCTION record_single_visit(
  p_visit_date date,
  p_schedule_slot_id uuid,
  p_client_id uuid,
  p_price_id uuid,
  p_method text DEFAULT 'cash'
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
  v_client_display text;
  v_visit_id uuid;
BEGIN
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

  SELECT trim(coalesce(c.last_name, '') || ' ' || coalesce(c.first_name, ''))
  INTO v_client_display
  FROM clients c
  WHERE c.organization_id = v_org_id
    AND c.id = p_client_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Клиент не найден');
  END IF;

  INSERT INTO single_visits (
    organization_id,
    visit_date,
    schedule_slot_id,
    schedule_group_id,
    client_id,
    client_display,
    price_id,
    amount,
    method,
    location_id,
    discipline_id,
    teacher_member_id,
    created_by
  )
  VALUES (
    v_org_id,
    p_visit_date,
    v_slot.id,
    v_slot.class_id,
    p_client_id,
    coalesce(nullif(v_client_display, ''), 'Клиент'),
    v_price.id,
    v_price.price,
    p_method,
    v_slot.location_id,
    v_slot.discipline_id,
    v_slot.teacher_member_id,
    v_member_id
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

  INSERT INTO payments (
    organization_id,
    client_id,
    client_display,
    amount,
    method,
    single_visit_id,
    created_by,
    created_at
  )
  VALUES (
    v_org_id,
    p_client_id,
    coalesce(nullif(v_client_display, ''), 'Клиент'),
    v_price.price,
    p_method,
    v_visit_id,
    v_member_id,
    now()
  )
  ON CONFLICT (organization_id, single_visit_id) WHERE single_visit_id IS NOT NULL
  DO UPDATE SET
    client_id = EXCLUDED.client_id,
    client_display = EXCLUDED.client_display,
    amount = EXCLUDED.amount,
    method = EXCLUDED.method,
    created_by = EXCLUDED.created_by,
    created_at = now();

  RETURN jsonb_build_object('success', true, 'visitId', v_visit_id);
END;
$$;

COMMIT;
