-- Offline shift sync: idempotent mark_attendance for queued offline operations (CRM scenario 11)

CREATE OR REPLACE FUNCTION sync_offline_mark_attendance(
  p_date text,
  p_sub_id text,
  p_new_status text,
  p_schedule_group_id uuid,
  p_discipline_id uuid DEFAULT NULL,
  p_expected_old_status text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_sub_uuid uuid;
  v_server_old text;
  v_fingerprint text;
  v_cached jsonb;
  v_mark jsonb;
  v_result jsonb;
  v_lessons_left int;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF p_idempotency_key IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'idempotency_key required');
  END IF;

  v_fingerprint := concat_ws(
    '|',
    p_date,
    p_sub_id,
    p_schedule_group_id::text,
    COALESCE(p_discipline_id::text, ''),
    COALESCE(p_expected_old_status, 'null'),
    p_new_status
  );

  v_cached := check_operation_idempotency(
    v_org_id, 'offline_mark_attendance', p_idempotency_key, v_fingerprint
  );
  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  BEGIN
    v_sub_uuid := p_sub_id::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RETURN jsonb_build_object('success', false, 'error', 'Абонемент не найден');
  END;

  SELECT a.status INTO v_server_old
  FROM attendance a
  WHERE a.organization_id = v_org_id
    AND a.subscription_id = v_sub_uuid
    AND a.date = p_date::date
    AND a.schedule_group_id = p_schedule_group_id;

  IF p_expected_old_status IS DISTINCT FROM v_server_old THEN
    SELECT s.lessons_left INTO v_lessons_left
    FROM subscriptions s
    WHERE s.id = v_sub_uuid AND s.organization_id = v_org_id;

    v_result := jsonb_build_object(
      'success', false,
      'error', 'state_conflict',
      'error_code', 'state_conflict',
      'server_old_status', v_server_old,
      'server_lessons_left', v_lessons_left
    );
    RETURN v_result;
  END IF;

  IF v_server_old IS NOT NULL AND v_server_old <> p_new_status THEN
    v_mark := correct_attendance(
      p_date,
      p_sub_id,
      p_new_status,
      p_schedule_group_id,
      'offline_sync',
      NULL,
      p_discipline_id,
      p_idempotency_key,
      v_server_old
    );
  ELSE
    v_mark := mark_attendance(
      p_date,
      p_sub_id,
      p_new_status,
      p_discipline_id,
      p_schedule_group_id
    );
  END IF;

  IF COALESCE((v_mark ->> 'success')::boolean, false) IS NOT TRUE THEN
    RETURN v_mark;
  END IF;

  v_result := v_mark || jsonb_build_object('already_applied', false);

  PERFORM store_operation_idempotency(
    v_org_id, 'offline_mark_attendance', p_idempotency_key, v_fingerprint, v_result
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION sync_offline_mark_attendance(text, text, text, uuid, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sync_offline_mark_attendance(text, text, text, uuid, uuid, text, uuid) TO authenticated;
