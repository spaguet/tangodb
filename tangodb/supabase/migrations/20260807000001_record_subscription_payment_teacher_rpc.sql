-- Teacher subscription sale: record payment via SECURITY DEFINER RPC.
-- Direct INSERT into payments fails for teachers: tenant-consistency trigger
-- cannot see the new subscription row under teacher RLS on subscriptions.

BEGIN;

CREATE OR REPLACE FUNCTION record_subscription_payment(
  p_subscription_id uuid,
  p_amount numeric,
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
  v_sub subscriptions%ROWTYPE;
  v_client_display text;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Организация в режиме только чтения');
  END IF;

  IF current_member_role() <> 'teacher' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Только преподаватель может использовать этот метод');
  END IF;

  IF NOT teacher_can_write_subscriptions() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Преподавателям запрещена продажа абонементов');
  END IF;

  IF p_method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недопустимый способ оплаты');
  END IF;

  IF p_amount IS NULL OR p_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Сумма должна быть неотрицательной');
  END IF;

  SELECT * INTO v_sub
  FROM subscriptions s
  WHERE s.id = p_subscription_id
    AND s.organization_id = v_org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Абонемент не найден');
  END IF;

  IF NOT teacher_can_access_subscription(p_subscription_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Нет доступа к этому абонементу');
  END IF;

  IF v_sub.client_id1 IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'У абонемента не указан клиент');
  END IF;

  SELECT trim(coalesce(c.last_name, '') || ' ' || coalesce(c.first_name, ''))
  INTO v_client_display
  FROM clients c
  WHERE c.organization_id = v_org_id
    AND c.id = v_sub.client_id1;

  INSERT INTO payments (
    organization_id,
    client_id,
    client_display,
    amount,
    method,
    subscription_id,
    created_by,
    created_at
  )
  VALUES (
    v_org_id,
    v_sub.client_id1,
    coalesce(nullif(v_client_display, ''), 'Клиент'),
    p_amount,
    p_method,
    v_sub.id,
    v_member_id,
    now()
  )
  ON CONFLICT (organization_id, subscription_id)
    WHERE subscription_id IS NOT NULL AND personal_lesson_id IS NULL
  DO NOTHING;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION record_subscription_payment(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_subscription_payment(uuid, numeric, text) TO authenticated;

COMMIT;
