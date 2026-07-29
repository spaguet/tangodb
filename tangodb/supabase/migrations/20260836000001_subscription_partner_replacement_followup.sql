-- Apply scheduled partner replacements before finish_subscription and capacity reads

BEGIN;

CREATE OR REPLACE FUNCTION finish_subscription(p_sub_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_role text := current_member_role();
  v_sub_uuid uuid;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  PERFORM apply_scheduled_subscription_member_changes(v_org_id);

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Организация в режиме только чтения');
  END IF;

  BEGIN
    v_sub_uuid := p_sub_id::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RETURN jsonb_build_object('success', false, 'error', 'Абонемент не найден');
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM subscriptions
    WHERE id = v_sub_uuid
      AND organization_id = v_org_id
      AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Абонемент не найден или уже завершён');
  END IF;

  IF v_role = 'accountant' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  IF v_role = 'teacher' AND NOT teacher_can_access_subscription(v_sub_uuid) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав для этого абонемента');
  END IF;

  PERFORM set_config('app.allow_subscription_counter_update', 'true', true);

  UPDATE subscriptions
  SET status = 'finished'
  WHERE id = v_sub_uuid
    AND organization_id = v_org_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMIT;
