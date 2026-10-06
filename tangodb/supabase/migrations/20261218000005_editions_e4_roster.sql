-- E4 / 2.12.5: Lite journal roster (schedule_group_roster + roster_attendance + RPC).

BEGIN;

-- =============================================================================
-- 1. Tables (§4.7)
-- =============================================================================

CREATE TABLE schedule_group_roster (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  schedule_group_id   uuid NOT NULL,
  client_id           uuid NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by_member_id uuid,
  UNIQUE (organization_id, schedule_group_id, client_id),
  FOREIGN KEY (organization_id, schedule_group_id)
    REFERENCES classes (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, client_id)
    REFERENCES clients (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, created_by_member_id)
    REFERENCES organization_members (organization_id, id)
);

CREATE INDEX idx_schedule_group_roster_org_group
  ON schedule_group_roster (organization_id, schedule_group_id);

COMMENT ON TABLE schedule_group_roster IS
  'E4: permanent group roster without subscription (Lite journal).';

CREATE TABLE roster_attendance (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  schedule_group_id   uuid NOT NULL,
  client_id           uuid NOT NULL,
  date                date NOT NULL,
  attendance_status   text NOT NULL
    CHECK (attendance_status IN ('present', 'absent', 'freeze', 'excused')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by_member_id uuid,
  UNIQUE (organization_id, date, schedule_group_id, client_id),
  FOREIGN KEY (organization_id, schedule_group_id)
    REFERENCES classes (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, client_id)
    REFERENCES clients (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, created_by_member_id)
    REFERENCES organization_members (organization_id, id)
);

CREATE INDEX idx_roster_attendance_org_date_group
  ON roster_attendance (organization_id, date, schedule_group_id);

COMMENT ON TABLE roster_attendance IS
  'E4: per-lesson attendance marks for roster clients (no subscription_id).';

-- =============================================================================
-- 2. RLS (§18.2) — SELECT only; writes via RPC
-- =============================================================================

ALTER TABLE schedule_group_roster ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY schedule_group_roster_select_operational
  ON schedule_group_roster FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_operational()
  );

CREATE POLICY schedule_group_roster_select_teacher
  ON schedule_group_roster FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() = 'teacher'
    AND teacher_has_schedule_group_access(schedule_group_id)
  );

CREATE POLICY roster_attendance_select_operational
  ON roster_attendance FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_operational()
  );

CREATE POLICY roster_attendance_select_teacher
  ON roster_attendance FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() = 'teacher'
    AND teacher_can_view_attendance_row(date, schedule_group_id)
  );

REVOKE ALL ON TABLE schedule_group_roster FROM PUBLIC, anon;
REVOKE ALL ON TABLE roster_attendance FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON schedule_group_roster FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON roster_attendance FROM anon, authenticated;
GRANT SELECT ON schedule_group_roster TO authenticated;
GRANT SELECT ON roster_attendance TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON schedule_group_roster TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON roster_attendance TO service_role;

-- =============================================================================
-- 3. RPC
-- =============================================================================

CREATE OR REPLACE FUNCTION add_group_roster_client(
  p_schedule_group_id uuid,
  p_client_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_role text := current_member_role();
  v_member_id uuid := auth_member_id();
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Организация в режиме только чтения');
  END IF;

  IF v_role = 'accountant' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  IF v_role = 'director' AND NOT directors_can_mark_attendance_setting() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  IF v_role = 'teacher' AND NOT teacher_has_schedule_group_access(p_schedule_group_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав для этой группы');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM classes c
    WHERE c.organization_id = v_org_id
      AND c.id = p_schedule_group_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Группа не найдена');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM clients cl
    WHERE cl.organization_id = v_org_id
      AND cl.id = p_client_id
      AND cl.archived_at IS NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Клиент не найден или архивирован');
  END IF;

  INSERT INTO schedule_group_roster (
    organization_id,
    schedule_group_id,
    client_id,
    created_by_member_id
  )
  VALUES (v_org_id, p_schedule_group_id, p_client_id, v_member_id)
  ON CONFLICT (organization_id, schedule_group_id, client_id) DO NOTHING;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION remove_group_roster_client(
  p_schedule_group_id uuid,
  p_client_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_role text := current_member_role();
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Организация в режиме только чтения');
  END IF;

  IF v_role = 'accountant' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  IF v_role = 'director' AND NOT directors_can_mark_attendance_setting() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  IF v_role = 'teacher' AND NOT teacher_has_schedule_group_access(p_schedule_group_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав для этой группы');
  END IF;

  DELETE FROM schedule_group_roster
  WHERE organization_id = v_org_id
    AND schedule_group_id = p_schedule_group_id
    AND client_id = p_client_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION mark_roster_attendance(
  p_date text,
  p_schedule_group_id uuid,
  p_client_id uuid,
  p_new_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_role text := current_member_role();
  v_member_id uuid := auth_member_id();
  v_today date := current_date;
  v_old_status text;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Организация в режиме только чтения');
  END IF;

  IF p_date !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Неверный формат даты');
  END IF;

  IF p_date::date > v_today THEN
    RETURN jsonb_build_object('success', false, 'error', 'Отметки доступны только за прошедшие и текущий день');
  END IF;

  IF p_new_status NOT IN ('present', 'absent', 'excused') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недопустимый статус');
  END IF;

  IF v_role = 'accountant' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  IF v_role = 'director' AND NOT directors_can_mark_attendance_setting() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  IF v_role = 'teacher' AND NOT teacher_can_mark_group_attendance(p_date::date, p_schedule_group_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав для этой группы');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM schedule_group_roster r
    WHERE r.organization_id = v_org_id
      AND r.schedule_group_id = p_schedule_group_id
      AND r.client_id = p_client_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ученик не в составе группы');
  END IF;

  SELECT ra.attendance_status
  INTO v_old_status
  FROM roster_attendance ra
  WHERE ra.organization_id = v_org_id
    AND ra.date = p_date::date
    AND ra.schedule_group_id = p_schedule_group_id
    AND ra.client_id = p_client_id;

  IF v_old_status IS NOT DISTINCT FROM p_new_status THEN
    RETURN jsonb_build_object('success', true);
  END IF;

  INSERT INTO roster_attendance (
    organization_id,
    schedule_group_id,
    client_id,
    date,
    attendance_status,
    created_by_member_id
  )
  VALUES (
    v_org_id,
    p_schedule_group_id,
    p_client_id,
    p_date::date,
    p_new_status,
    v_member_id
  )
  ON CONFLICT (organization_id, date, schedule_group_id, client_id)
  DO UPDATE SET
    attendance_status = EXCLUDED.attendance_status,
    created_by_member_id = COALESCE(EXCLUDED.created_by_member_id, roster_attendance.created_by_member_id);

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION add_group_roster_client(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION remove_group_roster_client(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION mark_roster_attendance(text, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION add_group_roster_client(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION remove_group_roster_client(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION mark_roster_attendance(text, uuid, uuid, text) TO authenticated, service_role;

COMMIT;
