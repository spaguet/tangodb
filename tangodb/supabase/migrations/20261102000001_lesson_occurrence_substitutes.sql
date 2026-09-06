-- Temporary conducting teacher for one group/personal occurrence (CRM substitute scenario).
-- Does not change the regular slot/lesson teacher. Access + payroll follow the substitute.

BEGIN;

-- =============================================================================
-- 1. Table
-- =============================================================================

CREATE TABLE lesson_occurrence_substitutes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  occurrence_kind TEXT NOT NULL CHECK (occurrence_kind IN ('group', 'personal')),
  occurrence_date DATE NOT NULL,
  schedule_slot_id UUID,
  personal_lesson_id UUID,
  original_teacher_member_id UUID NOT NULL,
  substitute_teacher_member_id UUID NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  CHECK (original_teacher_member_id <> substitute_teacher_member_id),
  CHECK (
    (occurrence_kind = 'group'
      AND schedule_slot_id IS NOT NULL
      AND personal_lesson_id IS NULL)
    OR
    (occurrence_kind = 'personal'
      AND personal_lesson_id IS NOT NULL
      AND schedule_slot_id IS NULL)
  ),
  FOREIGN KEY (organization_id, schedule_slot_id)
    REFERENCES schedule_slots (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, personal_lesson_id)
    REFERENCES personal_lessons (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, original_teacher_member_id)
    REFERENCES organization_members (organization_id, id),
  FOREIGN KEY (organization_id, substitute_teacher_member_id)
    REFERENCES organization_members (organization_id, id),
  FOREIGN KEY (organization_id, created_by)
    REFERENCES organization_members (organization_id, id)
);

CREATE UNIQUE INDEX lesson_occurrence_substitutes_group_uniq
  ON lesson_occurrence_substitutes (organization_id, schedule_slot_id, occurrence_date)
  WHERE occurrence_kind = 'group';

CREATE UNIQUE INDEX lesson_occurrence_substitutes_personal_uniq
  ON lesson_occurrence_substitutes (organization_id, personal_lesson_id)
  WHERE occurrence_kind = 'personal';

CREATE INDEX lesson_occurrence_substitutes_org_date
  ON lesson_occurrence_substitutes (organization_id, occurrence_date);

CREATE INDEX lesson_occurrence_substitutes_org_sub
  ON lesson_occurrence_substitutes (organization_id, substitute_teacher_member_id, occurrence_date);

CREATE TRIGGER audit_lesson_occurrence_substitutes
  AFTER INSERT OR UPDATE OR DELETE ON lesson_occurrence_substitutes
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

ALTER TABLE lesson_occurrence_substitutes ENABLE ROW LEVEL SECURITY;

CREATE POLICY lesson_occurrence_substitutes_select ON lesson_occurrence_substitutes
  FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND (
      can_read_operational()
      OR can_read_financial()
      OR original_teacher_member_id = auth_member_id()
      OR substitute_teacher_member_id = auth_member_id()
    )
  );

CREATE POLICY lesson_occurrence_substitutes_write_none ON lesson_occurrence_substitutes
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

REVOKE ALL ON lesson_occurrence_substitutes FROM PUBLIC, anon;
GRANT SELECT ON lesson_occurrence_substitutes TO authenticated;

-- =============================================================================
-- 2. Helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION occurrence_times_overlap(
  p_start_a text,
  p_end_a text,
  p_start_b text,
  p_end_b text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_start_a::time < p_end_b::time AND p_start_b::time < p_end_a::time;
$$;

CREATE OR REPLACE FUNCTION occurrence_conducting_teacher_id(
  p_org_id uuid,
  p_occurrence_kind text,
  p_schedule_slot_id uuid,
  p_personal_lesson_id uuid,
  p_occurrence_date date,
  p_fallback uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT s.substitute_teacher_member_id
      FROM lesson_occurrence_substitutes s
      WHERE s.organization_id = p_org_id
        AND s.occurrence_kind = p_occurrence_kind
        AND s.occurrence_date = p_occurrence_date
        AND (
          (p_occurrence_kind = 'group'
            AND s.schedule_slot_id = p_schedule_slot_id)
          OR
          (p_occurrence_kind = 'personal'
            AND s.personal_lesson_id = p_personal_lesson_id)
        )
      LIMIT 1
    ),
    p_fallback
  );
$$;

CREATE OR REPLACE FUNCTION teacher_is_slot_occurrence_substitute(
  p_schedule_slot_id uuid,
  p_occurrence_date date
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM lesson_occurrence_substitutes s
    WHERE s.organization_id = auth_organization_id()
      AND s.occurrence_kind = 'group'
      AND s.schedule_slot_id = p_schedule_slot_id
      AND s.occurrence_date = p_occurrence_date
      AND s.substitute_teacher_member_id = auth_member_id()
  );
$$;

CREATE OR REPLACE FUNCTION teacher_is_group_occurrence_substitute(
  p_date date,
  p_schedule_group_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM lesson_occurrence_substitutes s
    JOIN schedule_slots ss
      ON ss.organization_id = s.organization_id
     AND ss.id = s.schedule_slot_id
    WHERE s.organization_id = auth_organization_id()
      AND s.occurrence_kind = 'group'
      AND s.occurrence_date = p_date
      AND s.substitute_teacher_member_id = auth_member_id()
      AND ss.class_id = p_schedule_group_id
  );
$$;

CREATE OR REPLACE FUNCTION teacher_is_personal_occurrence_substitute(p_lesson_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM lesson_occurrence_substitutes s
    WHERE s.organization_id = auth_organization_id()
      AND s.occurrence_kind = 'personal'
      AND s.personal_lesson_id = p_lesson_id
      AND s.substitute_teacher_member_id = auth_member_id()
  );
$$;

CREATE OR REPLACE FUNCTION teacher_can_mark_personal_lesson(p_lesson_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM personal_lessons pl
    WHERE pl.id = p_lesson_id
      AND pl.organization_id = auth_organization_id()
      AND (
        pl.teacher_member_id = auth_member_id()
        OR teacher_is_personal_occurrence_substitute(pl.id)
      )
  );
$$;

CREATE OR REPLACE FUNCTION teacher_has_conducting_overlap(
  p_org_id uuid,
  p_member_id uuid,
  p_date date,
  p_time_start text,
  p_time_end text,
  p_exclude_slot_id uuid,
  p_exclude_personal_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM schedule_slots ss
    WHERE ss.organization_id = p_org_id
      AND ss.day_of_week = EXTRACT(ISODOW FROM p_date)::integer
      AND ss.valid_from <= p_date
      AND (ss.valid_to IS NULL OR ss.valid_to >= p_date)
      AND (p_exclude_slot_id IS NULL OR ss.id <> p_exclude_slot_id)
      AND NOT EXISTS (
        SELECT 1
        FROM schedule_occurrence_cancellations soc
        WHERE soc.organization_id = ss.organization_id
          AND soc.slot_id = ss.id
          AND soc.occurrence_date = p_date
      )
      AND occurrence_conducting_teacher_id(
        p_org_id, 'group', ss.id, NULL, p_date, ss.teacher_member_id
      ) = p_member_id
      AND occurrence_times_overlap(ss.time, ss.time_end, p_time_start, p_time_end)
  )
  OR EXISTS (
    SELECT 1
    FROM personal_lessons pl
    WHERE pl.organization_id = p_org_id
      AND pl.date = p_date
      AND pl.cancelled_at IS NULL
      AND (p_exclude_personal_id IS NULL OR pl.id <> p_exclude_personal_id)
      AND occurrence_conducting_teacher_id(
        p_org_id, 'personal', NULL, pl.id, p_date, pl.teacher_member_id
      ) = p_member_id
      AND occurrence_times_overlap(pl.time_start, pl.time_end, p_time_start, p_time_end)
  );
$$;

-- =============================================================================
-- 3. Access: attendance, personal lesson, subscriptions, close, drop-in
-- =============================================================================

CREATE OR REPLACE FUNCTION teacher_can_mark_group_attendance(
  p_date date,
  p_schedule_group_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_dow int;
BEGIN
  IF teacher_is_group_occurrence_substitute(p_date, p_schedule_group_id) THEN
    RETURN true;
  END IF;

  IF NOT teacher_has_schedule_group_access(p_schedule_group_id) THEN
    RETURN false;
  END IF;

  v_dow := EXTRACT(ISODOW FROM p_date)::int;

  RETURN EXISTS (
    SELECT 1
    FROM schedule_slots ss
    WHERE ss.organization_id = auth_organization_id()
      AND ss.class_id = p_schedule_group_id
      AND ss.day_of_week = v_dow
      AND COALESCE(ss.valid_from, DATE '2000-01-01') <= p_date
      AND (ss.valid_to IS NULL OR ss.valid_to >= p_date)
  );
END;
$$;

CREATE OR REPLACE FUNCTION teacher_can_access_lesson(p_lesson_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_lesson RECORD;
BEGIN
  SELECT pl.discipline_id, pl.location_id, pl.teacher_member_id
  INTO v_lesson
  FROM personal_lessons pl
  WHERE pl.id = p_lesson_id
    AND pl.organization_id = auth_organization_id();

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_lesson.teacher_member_id = auth_member_id() THEN
    RETURN true;
  END IF;

  IF teacher_is_personal_occurrence_substitute(p_lesson_id) THEN
    RETURN true;
  END IF;

  IF NOT teachers_can_view_full_schedule_setting() THEN
    RETURN false;
  END IF;

  IF NOT teacher_has_discipline_access(v_lesson.discipline_id) THEN
    RETURN false;
  END IF;

  IF v_lesson.location_id IS NOT NULL
    AND NOT teacher_has_location_access(v_lesson.location_id) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION teacher_can_access_subscription(p_subscription_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_discipline_id uuid;
BEGIN
  SELECT s.discipline_id
  INTO v_discipline_id
  FROM subscriptions s
  WHERE s.id = p_subscription_id
    AND s.organization_id = auth_organization_id();

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF teacher_has_discipline_access(v_discipline_id) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM lesson_occurrence_substitutes sub
    JOIN schedule_slots ss
      ON ss.organization_id = sub.organization_id
     AND ss.id = sub.schedule_slot_id
    JOIN subscription_groups sg
      ON sg.organization_id = sub.organization_id
     AND sg.subscription_id = p_subscription_id
     AND sg.schedule_group_id = ss.class_id
    WHERE sub.organization_id = auth_organization_id()
      AND sub.occurrence_kind = 'group'
      AND sub.substitute_teacher_member_id = auth_member_id()
  );
END;
$$;

CREATE OR REPLACE FUNCTION member_can_record_single_visit(p_slot schedule_slots)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role text := current_member_role();
  v_settings record;
BEGIN
  IF v_role IN ('owner', 'director') THEN
    RETURN true;
  END IF;

  SELECT
    os.admin_can_record_single_visits,
    os.teachers_can_record_single_visits
  INTO v_settings
  FROM organization_settings os
  WHERE os.organization_id = auth_organization_id();

  IF v_role = 'admin' THEN
    RETURN COALESCE(v_settings.admin_can_record_single_visits, true);
  END IF;

  IF v_role = 'teacher' THEN
    RETURN COALESCE(v_settings.teachers_can_record_single_visits, false)
      AND (
        p_slot.teacher_member_id = auth_member_id()
        OR teacher_has_discipline_access(p_slot.discipline_id)
        OR teacher_has_location_access(p_slot.location_id)
        OR EXISTS (
          SELECT 1
          FROM lesson_occurrence_substitutes s
          WHERE s.organization_id = auth_organization_id()
            AND s.occurrence_kind = 'group'
            AND s.schedule_slot_id = p_slot.id
            AND s.substitute_teacher_member_id = auth_member_id()
        )
      );
  END IF;

  RETURN false;
END;
$$;

-- =============================================================================
-- 4. Conducting teacher on close / drop-in
-- =============================================================================

CREATE OR REPLACE FUNCTION lesson_closures_apply_conducting_teacher()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.teacher_member_id := occurrence_conducting_teacher_id(
    NEW.organization_id,
    NEW.occurrence_kind,
    NEW.schedule_slot_id,
    COALESCE(NEW.source_personal_lesson_id, NEW.personal_lesson_id),
    NEW.occurrence_date,
    NEW.teacher_member_id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lesson_closures_conducting_teacher ON lesson_occurrence_closures;
CREATE TRIGGER lesson_closures_conducting_teacher
  BEFORE INSERT OR UPDATE OF teacher_member_id, schedule_slot_id, personal_lesson_id,
    source_personal_lesson_id, occurrence_date, occurrence_kind
  ON lesson_occurrence_closures
  FOR EACH ROW EXECUTE FUNCTION lesson_closures_apply_conducting_teacher();

CREATE OR REPLACE FUNCTION single_visits_apply_conducting_teacher()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.schedule_slot_id IS NOT NULL THEN
    NEW.teacher_member_id := occurrence_conducting_teacher_id(
      NEW.organization_id,
      'group',
      NEW.schedule_slot_id,
      NULL,
      NEW.visit_date,
      NEW.teacher_member_id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS single_visits_conducting_teacher ON single_visits;
CREATE TRIGGER single_visits_conducting_teacher
  BEFORE INSERT OR UPDATE OF teacher_member_id, schedule_slot_id, visit_date
  ON single_visits
  FOR EACH ROW EXECUTE FUNCTION single_visits_apply_conducting_teacher();

CREATE OR REPLACE FUNCTION sync_substitute_conducting_records(
  p_org_id uuid,
  p_kind text,
  p_slot_id uuid,
  p_personal_id uuid,
  p_date date,
  p_teacher_id uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_kind = 'group' THEN
    UPDATE lesson_occurrence_closures
    SET teacher_member_id = p_teacher_id
    WHERE organization_id = p_org_id
      AND schedule_slot_id = p_slot_id
      AND occurrence_date = p_date
      AND status = 'closed';

    UPDATE single_visits
    SET teacher_member_id = p_teacher_id
    WHERE organization_id = p_org_id
      AND schedule_slot_id = p_slot_id
      AND visit_date = p_date;
  ELSE
    UPDATE lesson_occurrence_closures
    SET teacher_member_id = p_teacher_id
    WHERE organization_id = p_org_id
      AND COALESCE(source_personal_lesson_id, personal_lesson_id) = p_personal_id
      AND status = 'closed';
  END IF;
END;
$$;

-- =============================================================================
-- 5. Assign / clear RPCs
-- =============================================================================

CREATE OR REPLACE FUNCTION member_can_assign_lesson_substitute(
  p_original_teacher_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role text := current_member_role();
BEGIN
  IF auth.uid() IS NULL OR auth_organization_id() IS NULL
    OR NOT organization_allows_writes(auth_organization_id())
  THEN
    RETURN false;
  END IF;

  IF v_role IN ('owner', 'director') THEN
    RETURN true;
  END IF;

  IF v_role = 'admin' THEN
    RETURN NOT is_restricted_admin();
  END IF;

  IF v_role = 'teacher' THEN
    RETURN p_original_teacher_id IS NOT NULL
      AND p_original_teacher_id = auth_member_id();
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION assign_lesson_substitute(
  p_occurrence_kind text,
  p_occurrence_date date,
  p_schedule_slot_id uuid,
  p_personal_lesson_id uuid,
  p_substitute_member_id uuid,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_actor uuid := auth_member_id();
  v_fingerprint text;
  v_cached jsonb;
  v_slot schedule_slots%ROWTYPE;
  v_lesson personal_lessons%ROWTYPE;
  v_original uuid;
  v_time_start text;
  v_time_end text;
  v_sub_role text;
  v_existing uuid;
  v_id uuid;
  v_result jsonb;
BEGIN
  v_fingerprint := md5(concat_ws('|',
    p_occurrence_kind,
    p_occurrence_date::text,
    COALESCE(p_schedule_slot_id::text, ''),
    COALESCE(p_personal_lesson_id::text, ''),
    p_substitute_member_id::text
  ));
  v_cached := check_operation_idempotency(
    v_org_id, 'assign_lesson_substitute', p_idempotency_key, v_fingerprint
  );
  IF v_cached IS NOT NULL THEN
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.unauthorized');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.readOnly');
  END IF;

  IF p_occurrence_kind NOT IN ('group', 'personal') OR p_occurrence_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.invalid');
  END IF;

  IF p_occurrence_kind = 'group' THEN
    IF p_schedule_slot_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.notFound');
    END IF;
    SELECT * INTO v_slot
    FROM schedule_slots ss
    WHERE ss.id = p_schedule_slot_id AND ss.organization_id = v_org_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.notFound');
    END IF;
    IF v_slot.day_of_week <> EXTRACT(ISODOW FROM p_occurrence_date)::integer
      OR v_slot.valid_from > p_occurrence_date
      OR (v_slot.valid_to IS NOT NULL AND v_slot.valid_to < p_occurrence_date)
    THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.notFound');
    END IF;
    IF EXISTS (
      SELECT 1 FROM schedule_occurrence_cancellations soc
      WHERE soc.organization_id = v_org_id
        AND soc.slot_id = v_slot.id
        AND soc.occurrence_date = p_occurrence_date
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.cancelled');
    END IF;
    v_original := v_slot.teacher_member_id;
    v_time_start := v_slot.time;
    v_time_end := v_slot.time_end;
  ELSE
    IF p_personal_lesson_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.notFound');
    END IF;
    SELECT * INTO v_lesson
    FROM personal_lessons pl
    WHERE pl.id = p_personal_lesson_id AND pl.organization_id = v_org_id;
    IF NOT FOUND OR v_lesson.cancelled_at IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.notFound');
    END IF;
    IF v_lesson.date IS DISTINCT FROM p_occurrence_date THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.invalid');
    END IF;
    v_original := v_lesson.teacher_member_id;
    v_time_start := v_lesson.time_start;
    v_time_end := v_lesson.time_end;
  END IF;

  IF v_original IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.noRegularTeacher');
  END IF;

  IF NOT member_can_assign_lesson_substitute(v_original) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.forbidden');
  END IF;

  IF p_substitute_member_id IS NULL OR p_substitute_member_id = v_original THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.self');
  END IF;

  SELECT om.role INTO v_sub_role
  FROM organization_members om
  WHERE om.organization_id = v_org_id
    AND om.id = p_substitute_member_id
    AND om.is_active = true;
  IF NOT FOUND OR v_sub_role <> 'teacher' THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.invalidTeacher');
  END IF;

  IF teacher_has_conducting_overlap(
    v_org_id,
    p_substitute_member_id,
    p_occurrence_date,
    v_time_start,
    v_time_end,
    CASE WHEN p_occurrence_kind = 'group' THEN v_slot.id ELSE NULL END,
    CASE WHEN p_occurrence_kind = 'personal' THEN v_lesson.id ELSE NULL END
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.overlap');
  END IF;

  SELECT s.id INTO v_existing
  FROM lesson_occurrence_substitutes s
  WHERE s.organization_id = v_org_id
    AND s.occurrence_kind = p_occurrence_kind
    AND s.occurrence_date = p_occurrence_date
    AND (
      (p_occurrence_kind = 'group' AND s.schedule_slot_id = v_slot.id)
      OR (p_occurrence_kind = 'personal' AND s.personal_lesson_id = v_lesson.id)
    );

  IF v_existing IS NOT NULL THEN
    UPDATE lesson_occurrence_substitutes
    SET
      substitute_teacher_member_id = p_substitute_member_id,
      original_teacher_member_id = v_original,
      created_by = v_actor
    WHERE id = v_existing AND organization_id = v_org_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO lesson_occurrence_substitutes (
      organization_id,
      occurrence_kind,
      occurrence_date,
      schedule_slot_id,
      personal_lesson_id,
      original_teacher_member_id,
      substitute_teacher_member_id,
      created_by
    ) VALUES (
      v_org_id,
      p_occurrence_kind,
      p_occurrence_date,
      CASE WHEN p_occurrence_kind = 'group' THEN v_slot.id ELSE NULL END,
      CASE WHEN p_occurrence_kind = 'personal' THEN v_lesson.id ELSE NULL END,
      v_original,
      p_substitute_member_id,
      v_actor
    )
    RETURNING id INTO v_id;
  END IF;

  PERFORM sync_substitute_conducting_records(
    v_org_id,
    p_occurrence_kind,
    CASE WHEN p_occurrence_kind = 'group' THEN v_slot.id ELSE NULL END,
    CASE WHEN p_occurrence_kind = 'personal' THEN v_lesson.id ELSE NULL END,
    p_occurrence_date,
    p_substitute_member_id
  );

  IF p_occurrence_kind = 'group' THEN
    PERFORM enqueue_calendar_sync(v_org_id, 'group_occurrence', v_slot.id, p_occurrence_date, 'upsert');
  ELSE
    PERFORM enqueue_calendar_sync(v_org_id, 'personal_lesson', v_lesson.id, p_occurrence_date, 'upsert');
  END IF;

  v_result := jsonb_build_object(
    'success', true,
    'substitute_id', v_id,
    'original_teacher_member_id', v_original,
    'substitute_teacher_member_id', p_substitute_member_id
  );
  PERFORM store_operation_idempotency(
    v_org_id, 'assign_lesson_substitute', p_idempotency_key, v_fingerprint, v_result
  );
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION clear_lesson_substitute(
  p_occurrence_kind text,
  p_occurrence_date date,
  p_schedule_slot_id uuid,
  p_personal_lesson_id uuid,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_fingerprint text;
  v_cached jsonb;
  v_row lesson_occurrence_substitutes%ROWTYPE;
  v_result jsonb;
BEGIN
  v_fingerprint := md5(concat_ws('|',
    'clear',
    p_occurrence_kind,
    p_occurrence_date::text,
    COALESCE(p_schedule_slot_id::text, ''),
    COALESCE(p_personal_lesson_id::text, '')
  ));
  v_cached := check_operation_idempotency(
    v_org_id, 'clear_lesson_substitute', p_idempotency_key, v_fingerprint
  );
  IF v_cached IS NOT NULL THEN
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.unauthorized');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.readOnly');
  END IF;

  SELECT * INTO v_row
  FROM lesson_occurrence_substitutes s
  WHERE s.organization_id = v_org_id
    AND s.occurrence_kind = p_occurrence_kind
    AND s.occurrence_date = p_occurrence_date
    AND (
      (p_occurrence_kind = 'group' AND s.schedule_slot_id = p_schedule_slot_id)
      OR (p_occurrence_kind = 'personal' AND s.personal_lesson_id = p_personal_lesson_id)
    );

  IF NOT FOUND THEN
    v_result := jsonb_build_object('success', true, 'already_applied', true);
    PERFORM store_operation_idempotency(
      v_org_id, 'clear_lesson_substitute', p_idempotency_key, v_fingerprint, v_result
    );
    RETURN v_result;
  END IF;

  IF NOT member_can_assign_lesson_substitute(v_row.original_teacher_member_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.forbidden');
  END IF;

  DELETE FROM lesson_occurrence_substitutes
  WHERE id = v_row.id AND organization_id = v_org_id;

  PERFORM sync_substitute_conducting_records(
    v_org_id,
    p_occurrence_kind,
    v_row.schedule_slot_id,
    v_row.personal_lesson_id,
    p_occurrence_date,
    v_row.original_teacher_member_id
  );

  IF p_occurrence_kind = 'group' AND v_row.schedule_slot_id IS NOT NULL THEN
    PERFORM enqueue_calendar_sync(
      v_org_id, 'group_occurrence', v_row.schedule_slot_id, p_occurrence_date, 'upsert'
    );
  ELSIF p_occurrence_kind = 'personal' AND v_row.personal_lesson_id IS NOT NULL THEN
    PERFORM enqueue_calendar_sync(
      v_org_id, 'personal_lesson', v_row.personal_lesson_id, p_occurrence_date, 'upsert'
    );
  END IF;

  v_result := jsonb_build_object('success', true, 'cleared_id', v_row.id);
  PERFORM store_operation_idempotency(
    v_org_id, 'clear_lesson_substitute', p_idempotency_key, v_fingerprint, v_result
  );
  RETURN v_result;
END;
$$;

-- =============================================================================
-- 6. Personal attendance + payroll resolve + conducted report
-- =============================================================================

CREATE OR REPLACE FUNCTION mark_personal_lesson_attendance(
  p_lesson_id text,
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
  v_lesson RECORD;
  v_sub RECORD;
  v_today date := current_date;
  v_lesson_uuid uuid;
  v_old_status text;
  v_lesson_delta int := 0;
  v_new_lessons_left int;
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

  IF p_new_status NOT IN ('present', 'absent', 'excused') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недопустимый статус');
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

  IF v_role = 'director' AND NOT directors_can_mark_attendance_setting() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  IF v_role = 'teacher' AND NOT teacher_can_mark_personal_lesson(v_lesson_uuid) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав для этого урока');
  END IF;

  IF v_lesson.date > v_today THEN
    RETURN jsonb_build_object('success', false, 'error', 'Отметки доступны только за прошедшие и текущий день');
  END IF;

  v_old_status := v_lesson.attendance_status;

  IF v_old_status IS NOT DISTINCT FROM p_new_status THEN
    IF v_lesson.subscription_id IS NOT NULL THEN
      SELECT lessons_left INTO v_new_lessons_left
      FROM subscriptions
      WHERE id = v_lesson.subscription_id
        AND organization_id = v_org_id;
      RETURN jsonb_build_object('success', true, 'newLessonsLeft', v_new_lessons_left);
    END IF;
    RETURN jsonb_build_object('success', true);
  END IF;

  IF v_lesson.subscription_id IS NOT NULL THEN
    SELECT * INTO v_sub
    FROM subscriptions
    WHERE id = v_lesson.subscription_id
      AND organization_id = v_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Пакет не найден');
    END IF;

    IF v_old_status IN ('present', 'absent') THEN
      v_lesson_delta := 1;
    END IF;

    IF p_new_status IN ('present', 'absent') THEN
      v_lesson_delta := v_lesson_delta - 1;
    END IF;

    IF v_old_status IN ('present', 'absent') AND p_new_status IN ('present', 'absent') THEN
      v_lesson_delta := 0;
    END IF;

    v_new_lessons_left := v_sub.lessons_left + v_lesson_delta;

    IF v_new_lessons_left < 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Недостаточно уроков в пакете');
    END IF;

    UPDATE personal_lessons
    SET attendance_status = p_new_status
    WHERE id = v_lesson_uuid
      AND organization_id = v_org_id;

    PERFORM set_config('app.allow_subscription_counter_update', 'true', true);

    UPDATE subscriptions
    SET
      lessons_left = v_new_lessons_left,
      status = CASE WHEN v_new_lessons_left = 0 THEN 'finished' ELSE status END
    WHERE id = v_sub.id
      AND organization_id = v_org_id;

    RETURN jsonb_build_object('success', true, 'newLessonsLeft', v_new_lessons_left);
  END IF;

  UPDATE personal_lessons
  SET attendance_status = p_new_status
  WHERE id = v_lesson_uuid
    AND organization_id = v_org_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION payroll_resolve_payment_teacher_id(
  p_org_id uuid,
  p_personal_lesson_id uuid,
  p_subscription_id uuid,
  p_single_visit_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_personal_lesson_id IS NOT NULL THEN (
      SELECT occurrence_conducting_teacher_id(
        p_org_id,
        'personal',
        NULL,
        pl.id,
        pl.date,
        pl.teacher_member_id
      )
      FROM personal_lessons pl
      WHERE pl.organization_id = p_org_id
        AND pl.id = p_personal_lesson_id
    )
    WHEN p_single_visit_id IS NOT NULL THEN (
      SELECT sv.teacher_member_id
      FROM single_visits sv
      WHERE sv.organization_id = p_org_id
        AND sv.id = p_single_visit_id
    )
    WHEN p_subscription_id IS NOT NULL THEN (
      SELECT ss.teacher_member_id
      FROM subscription_groups sg
      JOIN schedule_slots ss
        ON ss.organization_id = sg.organization_id
       AND ss.class_id = sg.schedule_group_id
       AND ss.teacher_member_id IS NOT NULL
      WHERE sg.organization_id = p_org_id
        AND sg.subscription_id = p_subscription_id
      ORDER BY sg.id, ss.id
      LIMIT 1
    )
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION get_conducted_group_lessons_report(
  p_date_from text,
  p_date_to text,
  p_discipline_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_date_from date;
  v_date_to date;
  v_tz text;
  v_disc_count integer;
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'report.error.unauthorized');
  END IF;

  IF NOT can_export_data() THEN
    RETURN jsonb_build_object('success', false, 'error', 'report.error.forbidden');
  END IF;

  IF p_date_from IS NULL OR p_date_from !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'report.error.dateFromInvalid');
  END IF;

  IF p_date_to IS NULL OR p_date_to !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'report.error.dateToInvalid');
  END IF;

  BEGIN
    v_date_from := p_date_from::date;
    v_date_to := p_date_to::date;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'error', 'report.error.dateRangeInvalid');
  END;

  IF v_date_to < v_date_from THEN
    RETURN jsonb_build_object('success', false, 'error', 'report.error.dateRangeInvalid');
  END IF;

  IF p_discipline_ids IS NULL OR array_length(p_discipline_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('success', true, 'rows', '[]'::jsonb);
  END IF;

  SELECT count(*)
  INTO v_disc_count
  FROM unnest(p_discipline_ids) AS did
  JOIN disciplines d
    ON d.id = did
   AND d.organization_id = v_org_id;

  IF v_disc_count <> array_length(p_discipline_ids, 1) THEN
    RETURN jsonb_build_object('success', false, 'error', 'report.error.disciplineInvalid');
  END IF;

  SELECT os.timezone
  INTO v_tz
  FROM organization_settings os
  WHERE os.organization_id = v_org_id;

  WITH expanded AS (
    SELECT
      ss.id AS slot_id,
      ss.class_id AS schedule_group_id,
      ss.group_name,
      ss.discipline_id,
      ss.location_id,
      occurrence_conducting_teacher_id(
        ss.organization_id,
        'group',
        ss.id,
        NULL,
        occ.occurrence_date,
        ss.teacher_member_id
      ) AS teacher_member_id,
      ss.time AS time_start,
      ss.time_end,
      occ.occurrence_date
    FROM schedule_slots ss
    CROSS JOIN LATERAL unnest(
      _expand_group_slot_dates_in_range(ss, v_date_from, v_date_to)
    ) AS occ(occurrence_date)
    WHERE ss.organization_id = v_org_id
      AND ss.discipline_id = ANY (p_discipline_ids)
      AND _group_lesson_occurrence_conducted(occ.occurrence_date, ss.time_end, v_tz)
      AND NOT EXISTS (
        SELECT 1
        FROM schedule_occurrence_cancellations soc
        WHERE soc.organization_id = v_org_id
          AND soc.slot_id = ss.id
          AND soc.occurrence_date = occ.occurrence_date
      )
  ),
  attendance_agg AS (
    SELECT
      a.date,
      a.schedule_group_id,
      sum(_group_subscription_participant_count(s.type)) FILTER (WHERE a.attendance_status = 'present') AS present_count,
      sum(_group_subscription_participant_count(s.type)) FILTER (WHERE a.attendance_status = 'absent') AS absent_count,
      sum(_group_subscription_participant_count(s.type)) FILTER (WHERE a.attendance_status = 'freeze') AS freeze_count
    FROM attendance a
    JOIN subscriptions s
      ON s.id = a.subscription_id
     AND s.organization_id = v_org_id
    WHERE a.organization_id = v_org_id
      AND a.date >= v_date_from
      AND a.date <= v_date_to
    GROUP BY a.date, a.schedule_group_id
  )
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'occurrence_id', e.slot_id::text || ':' || to_char(e.occurrence_date, 'YYYY-MM-DD'),
        'slot_id', e.slot_id,
        'schedule_group_id', e.schedule_group_id,
        'date', to_char(e.occurrence_date, 'YYYY-MM-DD'),
        'day_of_week', EXTRACT(ISODOW FROM e.occurrence_date)::integer,
        'time_start', normalize_hhmm(e.time_start),
        'time_end', normalize_hhmm(e.time_end),
        'discipline_category', coalesce(d.category, ''),
        'discipline_id', e.discipline_id,
        'discipline_name', coalesce(d.name, ''),
        'group_name', coalesce(e.group_name, ''),
        'teacher_name', coalesce(nullif(trim(om.display_name), ''), ''),
        'location_name', coalesce(l.name, ''),
        'present_count', coalesce(aa.present_count, 0),
        'absent_count', coalesce(aa.absent_count, 0),
        'freeze_count', coalesce(aa.freeze_count, 0)
      )
      ORDER BY e.occurrence_date, normalize_hhmm(e.time_start), coalesce(l.name, ''), coalesce(e.group_name, '')
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM expanded e
  LEFT JOIN disciplines d
    ON d.id = e.discipline_id
   AND d.organization_id = v_org_id
  LEFT JOIN locations l
    ON l.id = e.location_id
   AND l.organization_id = v_org_id
  LEFT JOIN organization_members om
    ON om.id = e.teacher_member_id
   AND om.organization_id = v_org_id
  LEFT JOIN attendance_agg aa
    ON aa.date = e.occurrence_date
   AND aa.schedule_group_id = e.schedule_group_id;

  RETURN jsonb_build_object('success', true, 'rows', coalesce(v_rows, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION occurrence_times_overlap(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION occurrence_conducting_teacher_id(uuid, text, uuid, uuid, date, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION teacher_is_slot_occurrence_substitute(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION teacher_is_group_occurrence_substitute(date, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION teacher_is_personal_occurrence_substitute(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION teacher_can_mark_personal_lesson(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION teacher_has_conducting_overlap(uuid, uuid, date, text, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION member_can_assign_lesson_substitute(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION assign_lesson_substitute(text, date, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION clear_lesson_substitute(text, date, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION sync_substitute_conducting_records(uuid, text, uuid, uuid, date, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION occurrence_conducting_teacher_id(uuid, text, uuid, uuid, date, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION teacher_is_slot_occurrence_substitute(uuid, date)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION teacher_is_group_occurrence_substitute(date, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION teacher_is_personal_occurrence_substitute(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION teacher_can_mark_personal_lesson(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION member_can_assign_lesson_substitute(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION assign_lesson_substitute(text, date, uuid, uuid, uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION clear_lesson_substitute(text, date, uuid, uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION teacher_can_mark_group_attendance(date, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION teacher_can_access_lesson(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION teacher_can_access_subscription(uuid)
  TO authenticated, service_role;

COMMIT;
