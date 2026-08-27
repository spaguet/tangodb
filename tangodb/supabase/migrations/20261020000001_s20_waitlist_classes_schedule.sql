-- S20 / M26, M35, M36, M40: waitlist teacher scope + RPC-only write; classes max_capacity RPC-only;
-- locations write for can_manage_settings; schedule_slots admin flag in RLS.

BEGIN;

-- =============================================================================
-- 1. Helper: leadership schedule write respects admin_can_edit_schedule (M40)
-- =============================================================================

CREATE OR REPLACE FUNCTION member_can_write_schedule_as_leadership()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_role text := current_member_role();
  v_admin_can_edit boolean;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN false;
  END IF;

  IF v_role IN ('owner', 'director') THEN
    RETURN true;
  END IF;

  IF v_role = 'admin' THEN
    IF is_restricted_admin() THEN
      RETURN false;
    END IF;

    SELECT os.admin_can_edit_schedule
    INTO v_admin_can_edit
    FROM organization_settings os
    WHERE os.organization_id = v_org_id;

    RETURN COALESCE(v_admin_can_edit, true);
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION member_can_write_schedule_as_leadership() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_write_schedule_as_leadership() TO authenticated, service_role;

-- =============================================================================
-- 2. Waitlist SELECT — teacher only own groups (M26); write REST revoked (M35)
-- =============================================================================

DROP POLICY IF EXISTS group_waitlist_entries_select ON group_waitlist_entries;
DROP POLICY IF EXISTS group_waitlist_status_events_select ON group_waitlist_status_events;
DROP POLICY IF EXISTS group_waitlist_entries_write ON group_waitlist_entries;
DROP POLICY IF EXISTS group_spot_notifications_update ON group_spot_notifications;

CREATE POLICY group_waitlist_entries_select
  ON group_waitlist_entries FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND (
      can_read_all_business()
      OR can_write_reception()
      OR (
        current_member_role() = 'teacher'
        AND teacher_can_write_subscriptions()
        AND teacher_can_access_class(class_id)
      )
    )
  );

CREATE POLICY group_waitlist_status_events_select
  ON group_waitlist_status_events FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND (
      can_read_all_business()
      OR can_write_reception()
      OR (
        current_member_role() = 'teacher'
        AND teacher_can_write_subscriptions()
        AND EXISTS (
          SELECT 1
          FROM group_waitlist_entries gwe
          WHERE gwe.id = waitlist_entry_id
            AND gwe.organization_id = group_waitlist_status_events.organization_id
            AND teacher_can_access_class(gwe.class_id)
        )
      )
    )
  );

DROP POLICY IF EXISTS group_spot_notifications_select ON group_spot_notifications;

CREATE POLICY group_spot_notifications_select
  ON group_spot_notifications FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND member_can_manage_group_waitlist()
    AND (
      current_member_role() <> 'teacher'
      OR teacher_can_access_class(class_id)
    )
  );

REVOKE INSERT, UPDATE, DELETE ON group_waitlist_entries FROM anon, authenticated;
REVOKE UPDATE ON group_spot_notifications FROM anon, authenticated;

GRANT SELECT ON group_waitlist_entries TO authenticated;
GRANT SELECT ON group_spot_notifications TO authenticated;

-- =============================================================================
-- 3. Waitlist RPCs — teacher scoped to accessible classes (M35)
-- =============================================================================

CREATE OR REPLACE FUNCTION add_group_waitlist_entry(
  p_class_id uuid,
  p_client_id uuid,
  p_comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_entry_id uuid := gen_random_uuid();
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT member_can_manage_group_waitlist() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  IF current_member_role() = 'teacher' AND NOT teacher_can_access_class(p_class_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM classes c
    WHERE c.id = p_class_id AND c.organization_id = v_org_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Группа не найдена');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM clients c
    WHERE c.id = p_client_id AND c.organization_id = v_org_id AND c.archived_at IS NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Клиент не найден');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM group_waitlist_entries gwe
    WHERE gwe.organization_id = v_org_id
      AND gwe.class_id = p_class_id
      AND gwe.client_id = p_client_id
      AND gwe.status IN ('waiting', 'offered')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Клиент уже в очереди для этой группы');
  END IF;

  INSERT INTO group_waitlist_entries (
    id,
    organization_id,
    class_id,
    client_id,
    status,
    comment,
    created_by_member_id,
    updated_by_member_id
  )
  VALUES (
    v_entry_id,
    v_org_id,
    p_class_id,
    p_client_id,
    'waiting',
    nullif(trim(coalesce(p_comment, '')), ''),
    v_member_id,
    v_member_id
  );

  INSERT INTO group_waitlist_status_events (
    organization_id,
    waitlist_entry_id,
    from_status,
    to_status,
    comment,
    created_by_member_id
  )
  VALUES (
    v_org_id,
    v_entry_id,
    NULL,
    'waiting',
    nullif(trim(coalesce(p_comment, '')), ''),
    v_member_id
  );

  RETURN jsonb_build_object('success', true, 'id', v_entry_id);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'Клиент уже в очереди для этой группы');
END;
$$;

CREATE OR REPLACE FUNCTION update_group_waitlist_status(
  p_entry_id uuid,
  p_new_status text,
  p_comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_entry group_waitlist_entries%ROWTYPE;
  v_class classes%ROWTYPE;
  v_occupied int;
  v_new_count int := 1;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT member_can_manage_group_waitlist() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  IF p_new_status NOT IN ('waiting', 'offered', 'enrolled', 'declined', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недопустимый статус');
  END IF;

  SELECT * INTO v_entry
  FROM group_waitlist_entries gwe
  WHERE gwe.id = p_entry_id
    AND gwe.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Запись очереди не найдена');
  END IF;

  IF current_member_role() = 'teacher' AND NOT teacher_can_access_class(v_entry.class_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  IF v_entry.status = p_new_status THEN
    RETURN jsonb_build_object('success', true, 'id', v_entry.id);
  END IF;

  IF v_entry.status IN ('enrolled', 'declined', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Запись уже завершена');
  END IF;

  IF p_new_status = 'enrolled' THEN
    SELECT * INTO v_class
    FROM classes c
    WHERE c.id = v_entry.class_id
      AND c.organization_id = v_org_id
    FOR UPDATE;

    IF v_class.max_capacity IS NOT NULL THEN
      v_occupied := count_group_occupied_seats(v_org_id, v_entry.class_id, CURRENT_DATE);
      IF v_occupied + v_new_count > v_class.max_capacity THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'group_capacity_exceeded',
          'class_id', v_entry.class_id,
          'max_capacity', v_class.max_capacity,
          'occupied', v_occupied,
          'requested', v_new_count
        );
      END IF;
    END IF;
  END IF;

  UPDATE group_waitlist_entries
  SET
    status = p_new_status,
    comment = coalesce(nullif(trim(coalesce(p_comment, '')), ''), comment),
    updated_at = now(),
    updated_by_member_id = v_member_id
  WHERE id = p_entry_id;

  INSERT INTO group_waitlist_status_events (
    organization_id,
    waitlist_entry_id,
    from_status,
    to_status,
    comment,
    created_by_member_id
  )
  VALUES (
    v_org_id,
    p_entry_id,
    v_entry.status,
    p_new_status,
    nullif(trim(coalesce(p_comment, '')), ''),
    v_member_id
  );

  RETURN jsonb_build_object('success', true, 'id', p_entry_id);
END;
$$;

CREATE OR REPLACE FUNCTION dismiss_group_spot_notification(p_notification_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_notification group_spot_notifications%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT member_can_manage_group_waitlist() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  SELECT * INTO v_notification
  FROM group_spot_notifications gsn
  WHERE gsn.id = p_notification_id
    AND gsn.organization_id = v_org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Уведомление не найдено');
  END IF;

  IF current_member_role() = 'teacher' AND NOT teacher_can_access_class(v_notification.class_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  UPDATE group_spot_notifications
  SET
    dismissed_at = now(),
    dismissed_by_member_id = v_member_id
  WHERE id = p_notification_id
    AND organization_id = v_org_id
    AND dismissed_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Уведомление не найдено');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- =============================================================================
-- 4. classes — no REST INSERT; max_capacity only via RPC (M36)
-- =============================================================================

REVOKE INSERT ON classes FROM anon, authenticated;
REVOKE UPDATE (max_capacity) ON classes FROM anon, authenticated;

-- =============================================================================
-- 5. locations — settings roles only; REST write preserved for useLocations (M36)
-- =============================================================================

DROP POLICY IF EXISTS locations_write_admin ON locations;

CREATE POLICY locations_write_admin
  ON locations FOR ALL TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_manage_settings()
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_manage_settings()
  );

-- =============================================================================
-- 6. schedule_slots — admin_can_edit_schedule in leadership write policy (M40)
-- =============================================================================

DROP POLICY IF EXISTS schedule_slots_write_admin ON schedule_slots;

CREATE POLICY schedule_slots_write_admin
  ON schedule_slots FOR ALL TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND member_can_write_schedule_as_leadership()
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND member_can_write_schedule_as_leadership()
  );

COMMIT;
