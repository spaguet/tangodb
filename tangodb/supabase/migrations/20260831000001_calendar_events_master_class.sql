-- Calendar events (master class / open lesson) with conflict resolution and other income (CRM scenario 3 / Prompt 3)

BEGIN;

-- =============================================================================
-- 1. Schema
-- =============================================================================

ALTER TABLE personal_lessons
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'personal_lessons_cancelled_by_fkey'
  ) THEN
    ALTER TABLE personal_lessons
      ADD CONSTRAINT personal_lessons_cancelled_by_fkey
      FOREIGN KEY (organization_id, cancelled_by)
      REFERENCES organization_members (organization_id, id);
  END IF;
END;
$$;

CREATE TABLE calendar_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  event_type          TEXT NOT NULL CHECK (event_type IN ('master_class', 'open_lesson')),
  comment             TEXT,
  guest_teacher       TEXT,
  organizer           TEXT,
  planned_guest_count INTEGER CHECK (planned_guest_count IS NULL OR planned_guest_count >= 0),
  actual_guest_count  INTEGER CHECK (actual_guest_count IS NULL OR actual_guest_count >= 0),
  income_amount       NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (income_amount >= 0),
  paid_amount         NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  currency            TEXT NOT NULL DEFAULT 'RUB',
  payment_status      TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
  payment_comment     TEXT,
  idempotency_key     TEXT,
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, created_by)
    REFERENCES organization_members (organization_id, id),
  CHECK (paid_amount <= income_amount OR income_amount = 0)
);

CREATE UNIQUE INDEX calendar_events_org_idempotency_unique
  ON calendar_events (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_calendar_events_org_created
  ON calendar_events (organization_id, created_at DESC);

CREATE TABLE calendar_event_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  event_id        UUID NOT NULL,
  session_date    DATE NOT NULL,
  time_start      TEXT NOT NULL,
  time_end        TEXT NOT NULL,
  location_id     UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, event_id)
    REFERENCES calendar_events (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, location_id)
    REFERENCES locations (organization_id, id),
  CHECK (session_date >= DATE '2000-01-01')
);

CREATE INDEX idx_calendar_event_sessions_org_date
  ON calendar_event_sessions (organization_id, session_date);

CREATE INDEX idx_calendar_event_sessions_org_location_date
  ON calendar_event_sessions (organization_id, location_id, session_date);

CREATE TABLE other_income (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  calendar_event_id   UUID NOT NULL,
  amount              NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  currency            TEXT NOT NULL DEFAULT 'RUB',
  method              TEXT NOT NULL DEFAULT 'cash'
    CHECK (method IN ('cash', 'transfer', 'card', 'other')),
  method_comment      TEXT,
  idempotency_key     TEXT,
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, calendar_event_id)
    REFERENCES calendar_events (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, created_by)
    REFERENCES organization_members (organization_id, id)
);

CREATE UNIQUE INDEX other_income_org_idempotency_unique
  ON other_income (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_other_income_org_created
  ON other_income (organization_id, created_at DESC);

-- =============================================================================
-- 2. Permission helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION member_can_manage_calendar_events()
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

CREATE OR REPLACE FUNCTION member_can_cancel_personal_lesson(p_lesson_id uuid)
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

  IF NOT EXISTS (
    SELECT 1
    FROM personal_lessons pl
    WHERE pl.id = p_lesson_id
      AND pl.organization_id = v_org_id
      AND pl.cancelled_at IS NULL
  ) THEN
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

-- Extend conflict check: skip cancelled personal lessons and include event sessions
CREATE OR REPLACE FUNCTION schedule_location_has_conflict(
  p_org_id uuid,
  p_date date,
  p_time_start text,
  p_time_end text,
  p_location_id uuid,
  p_exclude_slot_id uuid DEFAULT NULL,
  p_exclude_event_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_time_start text;
  v_time_end text;
  v_dow integer;
BEGIN
  v_time_start := normalize_hhmm(p_time_start);
  v_time_end := normalize_hhmm(p_time_end);
  v_dow := EXTRACT(ISODOW FROM p_date)::integer;

  IF EXISTS (
    SELECT 1
    FROM personal_lessons p
    WHERE p.organization_id = p_org_id
      AND p.date = p_date
      AND p.cancelled_at IS NULL
      AND p.location_id IS NOT DISTINCT FROM p_location_id
      AND schedule_time_ranges_overlap(
        p.time_start, p.time_end, v_time_start, v_time_end
      )
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM schedule_slots s
    WHERE s.organization_id = p_org_id
      AND s.day_of_week = v_dow
      AND s.location_id IS NOT DISTINCT FROM p_location_id
      AND s.id IS DISTINCT FROM p_exclude_slot_id
      AND s.valid_from <= p_date
      AND (s.valid_to IS NULL OR s.valid_to >= p_date)
      AND schedule_time_ranges_overlap(
        s.time, s.time_end, v_time_start, v_time_end
      )
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM calendar_event_sessions ces
    JOIN calendar_events ce ON ce.id = ces.event_id AND ce.organization_id = ces.organization_id
    WHERE ces.organization_id = p_org_id
      AND ces.session_date = p_date
      AND ces.location_id IS NOT DISTINCT FROM p_location_id
      AND ce.id IS DISTINCT FROM p_exclude_event_id
      AND schedule_time_ranges_overlap(
        ces.time_start, ces.time_end, v_time_start, v_time_end
      )
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- =============================================================================
-- 3. Conflict preview
-- =============================================================================

CREATE OR REPLACE FUNCTION preview_calendar_event_conflicts(p_sessions jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_conflicts jsonb := '[]'::jsonb;
  v_session jsonb;
  v_date date;
  v_time_start text;
  v_time_end text;
  v_location_id uuid;
  v_dow integer;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_operational() AND current_member_role() <> 'teacher' THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF p_sessions IS NULL OR jsonb_typeof(p_sessions) <> 'array' OR jsonb_array_length(p_sessions) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.sessionsEmpty');
  END IF;

  FOR v_session IN SELECT value FROM jsonb_array_elements(p_sessions) LOOP
    IF v_session ->> 'date' IS NULL OR v_session ->> 'date' !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.event.sessionDateInvalid');
    END IF;

    v_date := (v_session ->> 'date')::date;
    v_time_start := normalize_hhmm(v_session ->> 'time_start');
    v_time_end := normalize_hhmm(v_session ->> 'time_end');
    v_location_id := (v_session ->> 'location_id')::uuid;
    v_dow := EXTRACT(ISODOW FROM v_date)::integer;

    IF NOT EXISTS (
      SELECT 1 FROM locations l
      WHERE l.id = v_location_id AND l.organization_id = v_org_id
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.event.locationInvalid');
    END IF;

    v_conflicts := v_conflicts || COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'kind', 'group',
        'slot_id', s.id,
        'occurrence_date', v_date,
        'time_start', s.time,
        'time_end', s.time_end,
        'location_id', s.location_id,
        'group_name', COALESCE(s.group_name, ''),
        'teacher_member_id', s.teacher_member_id,
        'discipline_id', s.discipline_id
      ))
      FROM schedule_slots s
      WHERE s.organization_id = v_org_id
        AND s.day_of_week = v_dow
        AND s.location_id IS NOT DISTINCT FROM v_location_id
        AND s.valid_from <= v_date
        AND (s.valid_to IS NULL OR s.valid_to >= v_date)
        AND schedule_time_ranges_overlap(s.time, s.time_end, v_time_start, v_time_end)
    ), '[]'::jsonb);

    v_conflicts := v_conflicts || COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'kind', 'personal',
        'lesson_id', p.id,
        'occurrence_date', p.date,
        'time_start', p.time_start,
        'time_end', p.time_end,
        'location_id', p.location_id,
        'client_display', COALESCE(p.client_display, ''),
        'teacher_member_id', p.teacher_member_id,
        'discipline_id', p.discipline_id
      ))
      FROM personal_lessons p
      WHERE p.organization_id = v_org_id
        AND p.date = v_date
        AND p.cancelled_at IS NULL
        AND p.location_id IS NOT DISTINCT FROM v_location_id
        AND schedule_time_ranges_overlap(p.time_start, p.time_end, v_time_start, v_time_end)
    ), '[]'::jsonb);
  END LOOP;

  RETURN jsonb_build_object('success', true, 'conflicts', v_conflicts);
END;
$$;

-- =============================================================================
-- 4. Create event with cancellations (atomic)
-- =============================================================================

CREATE OR REPLACE FUNCTION create_calendar_event_with_cancellations(
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_idempotency_key text := NULLIF(trim(p_payload ->> 'idempotency_key'), '');
  v_existing calendar_events%ROWTYPE;
  v_event_id uuid;
  v_session jsonb;
  v_date date;
  v_time_start text;
  v_time_end text;
  v_location_id uuid;
  v_sessions jsonb;
  v_group_cancels jsonb;
  v_personal_cancels jsonb;
  v_cancel jsonb;
  v_slot_id uuid;
  v_lesson_id uuid;
  v_slot schedule_slots%ROWTYPE;
  v_cancel_dates date[];
  v_sorted date[];
  v_conflict_count integer;
  v_selected_group integer;
  v_selected_personal integer;
  v_total_conflicts integer;
  v_income_amount numeric;
  v_paid_amount numeric;
  v_payment_status text;
  v_currency text;
  v_payment_method text;
  v_session_count integer := 0;
  v_group_cancel_count integer := 0;
  v_personal_cancel_count integer := 0;
  v_preview jsonb;
  v_conflict jsonb;
  v_matched integer;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT member_can_manage_calendar_events() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.forbidden');
  END IF;

  IF v_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM calendar_events ce
    WHERE ce.organization_id = v_org_id
      AND ce.idempotency_key = v_idempotency_key;

    IF FOUND THEN
      SELECT count(*) INTO v_session_count
      FROM calendar_event_sessions ces
      WHERE ces.event_id = v_existing.id AND ces.organization_id = v_org_id;

      RETURN jsonb_build_object(
        'success', true,
        'event_id', v_existing.id,
        'session_count', v_session_count,
        'group_cancel_count', 0,
        'personal_cancel_count', 0,
        'already_applied', true
      );
    END IF;
  END IF;

  v_sessions := COALESCE(p_payload -> 'sessions', '[]'::jsonb);
  v_group_cancels := COALESCE(p_payload -> 'group_cancellations', '[]'::jsonb);
  v_personal_cancels := COALESCE(p_payload -> 'personal_cancellations', '[]'::jsonb);

  IF jsonb_typeof(v_sessions) <> 'array' OR jsonb_array_length(v_sessions) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.sessionsEmpty');
  END IF;

  IF NULLIF(trim(p_payload ->> 'title'), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.titleRequired');
  END IF;

  IF (p_payload ->> 'event_type') NOT IN ('master_class', 'open_lesson') THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.typeInvalid');
  END IF;

  v_income_amount := COALESCE((p_payload ->> 'income_amount')::numeric, 0);
  v_paid_amount := COALESCE((p_payload ->> 'paid_amount')::numeric, 0);
  v_payment_status := COALESCE(NULLIF(p_payload ->> 'payment_status', ''), 'unpaid');
  v_currency := COALESCE(NULLIF(p_payload ->> 'currency', ''), 'RUB');
  v_payment_method := COALESCE(NULLIF(p_payload ->> 'payment_method', ''), 'cash');

  IF v_payment_status NOT IN ('unpaid', 'partial', 'paid') THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.paymentStatusInvalid');
  END IF;

  IF v_income_amount > 0 AND NOT can_read_financial() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.financeForbidden');
  END IF;

  IF v_paid_amount > v_income_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.paidExceedsIncome');
  END IF;

  IF v_payment_status = 'paid' AND v_income_amount > 0 AND v_paid_amount <> v_income_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.paidStatusMismatch');
  END IF;

  IF v_payment_status = 'partial' AND (v_paid_amount <= 0 OR v_paid_amount >= v_income_amount) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.partialStatusMismatch');
  END IF;

  IF v_payment_status = 'unpaid' AND v_paid_amount > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.unpaidWithPayment');
  END IF;

  v_preview := preview_calendar_event_conflicts(v_sessions);
  IF NOT COALESCE((v_preview ->> 'success')::boolean, false) THEN
    RETURN v_preview;
  END IF;

  v_total_conflicts := jsonb_array_length(COALESCE(v_preview -> 'conflicts', '[]'::jsonb));
  v_selected_group := jsonb_array_length(v_group_cancels);
  v_selected_personal := jsonb_array_length(v_personal_cancels);

  IF v_selected_group + v_selected_personal <> v_total_conflicts THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.unresolvedConflicts');
  END IF;

  FOR v_conflict IN SELECT value FROM jsonb_array_elements(COALESCE(v_preview -> 'conflicts', '[]'::jsonb)) LOOP
    IF v_conflict ->> 'kind' = 'group' THEN
      SELECT count(*)
      INTO v_matched
      FROM jsonb_array_elements(v_group_cancels) AS elem
      WHERE (elem ->> 'slot_id')::uuid = (v_conflict ->> 'slot_id')::uuid
        AND (elem ->> 'date')::date = (v_conflict ->> 'occurrence_date')::date;

      IF v_matched = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'schedule.event.unresolvedConflicts');
      END IF;
    ELSIF v_conflict ->> 'kind' = 'personal' THEN
      SELECT count(*)
      INTO v_matched
      FROM jsonb_array_elements(v_personal_cancels) AS elem
      WHERE (elem ->> 'lesson_id')::uuid = (v_conflict ->> 'lesson_id')::uuid;

      IF v_matched = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'schedule.event.unresolvedConflicts');
      END IF;
    END IF;
  END LOOP;

  v_session_count := jsonb_array_length(v_sessions);

  -- Validate all group cancellations before any writes
  FOR v_slot_id IN
    SELECT DISTINCT (elem ->> 'slot_id')::uuid
    FROM jsonb_array_elements(v_group_cancels) AS elem
  LOOP
    IF NOT member_can_write_schedule_slot(v_slot_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.error.cancelForbidden');
    END IF;

    SELECT array_agg((elem ->> 'date')::date ORDER BY (elem ->> 'date')::date)
    INTO v_cancel_dates
    FROM jsonb_array_elements(v_group_cancels) AS elem
    WHERE (elem ->> 'slot_id')::uuid = v_slot_id;

    SELECT *
    INTO v_slot
    FROM schedule_slots ss
    WHERE ss.id = v_slot_id
      AND ss.organization_id = v_org_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.error.slotNotFound');
    END IF;

    SELECT count(*)
    INTO v_conflict_count
    FROM unnest(v_cancel_dates) AS d
    WHERE _is_group_slot_occurrence_date(v_slot, d);

    IF v_conflict_count <> array_length(v_cancel_dates, 1) THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.error.cancelDateInvalid');
    END IF;
  END LOOP;

  FOR v_cancel IN SELECT value FROM jsonb_array_elements(v_personal_cancels) LOOP
    v_lesson_id := (v_cancel ->> 'lesson_id')::uuid;
    IF NOT member_can_cancel_personal_lesson(v_lesson_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.event.personalCancelForbidden');
    END IF;
  END LOOP;

  -- Apply group cancellations (group by slot_id)
  FOR v_slot_id IN
    SELECT DISTINCT (elem ->> 'slot_id')::uuid
    FROM jsonb_array_elements(v_group_cancels) AS elem
  LOOP
    SELECT *
    INTO v_slot
    FROM schedule_slots ss
    WHERE ss.id = v_slot_id
      AND ss.organization_id = v_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.error.slotNotFound');
    END IF;

    SELECT array_agg((elem ->> 'date')::date ORDER BY (elem ->> 'date')::date)
    INTO v_cancel_dates
    FROM jsonb_array_elements(v_group_cancels) AS elem
    WHERE (elem ->> 'slot_id')::uuid = v_slot_id;

    SELECT array_agg(d ORDER BY d)
    INTO v_sorted
    FROM unnest(v_cancel_dates) AS d;

    PERFORM _record_schedule_cancellations(v_slot, v_sorted);
    v_group_cancel_count := v_group_cancel_count + _apply_group_slot_cancellations_locked(v_slot_id, v_sorted);
  END LOOP;

  -- Cancel personal lessons
  FOR v_cancel IN SELECT value FROM jsonb_array_elements(v_personal_cancels) LOOP
    v_lesson_id := (v_cancel ->> 'lesson_id')::uuid;

    UPDATE personal_lessons pl
    SET
      cancelled_at = now(),
      cancelled_reason = COALESCE(NULLIF(trim(v_cancel ->> 'reason'), ''), 'calendar_event'),
      cancelled_by = v_member_id
    WHERE pl.id = v_lesson_id
      AND pl.organization_id = v_org_id
      AND pl.cancelled_at IS NULL;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.event.personalNotFound');
    END IF;

    v_personal_cancel_count := v_personal_cancel_count + 1;
  END LOOP;

  -- Re-check conflicts after cancellations
  FOR v_session IN SELECT value FROM jsonb_array_elements(v_sessions) LOOP
    v_date := (v_session ->> 'date')::date;
    v_time_start := normalize_hhmm(v_session ->> 'time_start');
    v_time_end := normalize_hhmm(v_session ->> 'time_end');
    v_location_id := (v_session ->> 'location_id')::uuid;

    IF schedule_location_has_conflict(v_org_id, v_date, v_time_start, v_time_end, v_location_id) THEN
      RAISE EXCEPTION 'schedule.event.slotConflict' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  INSERT INTO calendar_events (
    organization_id,
    title,
    event_type,
    comment,
    guest_teacher,
    organizer,
    planned_guest_count,
    actual_guest_count,
    income_amount,
    paid_amount,
    currency,
    payment_status,
    payment_comment,
    idempotency_key,
    created_by
  )
  VALUES (
    v_org_id,
    trim(p_payload ->> 'title'),
    p_payload ->> 'event_type',
    NULLIF(trim(p_payload ->> 'comment'), ''),
    NULLIF(trim(p_payload ->> 'guest_teacher'), ''),
    NULLIF(trim(p_payload ->> 'organizer'), ''),
    (p_payload ->> 'planned_guest_count')::integer,
    (p_payload ->> 'actual_guest_count')::integer,
    v_income_amount,
    v_paid_amount,
    v_currency,
    v_payment_status,
    NULLIF(trim(p_payload ->> 'payment_comment'), ''),
    v_idempotency_key,
    v_member_id
  )
  RETURNING id INTO v_event_id;

  FOR v_session IN SELECT value FROM jsonb_array_elements(v_sessions) LOOP
    INSERT INTO calendar_event_sessions (
      organization_id,
      event_id,
      session_date,
      time_start,
      time_end,
      location_id
    )
    VALUES (
      v_org_id,
      v_event_id,
      (v_session ->> 'date')::date,
      normalize_hhmm(v_session ->> 'time_start'),
      normalize_hhmm(v_session ->> 'time_end'),
      (v_session ->> 'location_id')::uuid
    );
  END LOOP;

  IF v_paid_amount > 0 THEN
    INSERT INTO other_income (
      organization_id,
      calendar_event_id,
      amount,
      currency,
      method,
      method_comment,
      idempotency_key,
      created_by
    )
    VALUES (
      v_org_id,
      v_event_id,
      v_paid_amount,
      v_currency,
      v_payment_method,
      NULLIF(trim(p_payload ->> 'payment_comment'), ''),
      CASE WHEN v_idempotency_key IS NOT NULL THEN v_idempotency_key || ':payment' END,
      v_member_id
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'event_id', v_event_id,
    'session_count', v_session_count,
    'group_cancel_count', v_group_cancel_count,
    'personal_cancel_count', v_personal_cancel_count
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  WHEN unique_violation THEN
    IF v_idempotency_key IS NOT NULL THEN
      SELECT id INTO v_event_id
      FROM calendar_events
      WHERE organization_id = v_org_id AND idempotency_key = v_idempotency_key;

      IF v_event_id IS NOT NULL THEN
        SELECT count(*) INTO v_session_count
        FROM calendar_event_sessions WHERE event_id = v_event_id;

        RETURN jsonb_build_object(
          'success', true,
          'event_id', v_event_id,
          'session_count', v_session_count,
          'group_cancel_count', 0,
          'personal_cancel_count', 0,
          'already_applied', true
        );
      END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.duplicate');
  WHEN OTHERS THEN
    RAISE;
END;
$$;

-- =============================================================================
-- 5. RLS
-- =============================================================================

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_event_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE other_income ENABLE ROW LEVEL SECURITY;

CREATE POLICY calendar_events_select_operational
  ON calendar_events FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_operational()
  );

CREATE POLICY calendar_events_select_teacher
  ON calendar_events FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() = 'teacher'
  );

CREATE POLICY calendar_event_sessions_select_operational
  ON calendar_event_sessions FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_operational()
  );

CREATE POLICY calendar_event_sessions_select_teacher
  ON calendar_event_sessions FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() = 'teacher'
  );

CREATE POLICY other_income_select_financial
  ON other_income FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_financial()
  );

GRANT SELECT ON calendar_events TO authenticated;
GRANT SELECT ON calendar_event_sessions TO authenticated;
GRANT SELECT ON other_income TO authenticated;
GRANT SELECT, INSERT, UPDATE ON calendar_events TO service_role;
GRANT SELECT, INSERT, UPDATE ON calendar_event_sessions TO service_role;
GRANT SELECT, INSERT ON other_income TO service_role;

REVOKE ALL ON FUNCTION member_can_manage_calendar_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_manage_calendar_events() TO authenticated, service_role;

REVOKE ALL ON FUNCTION member_can_cancel_personal_lesson(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_cancel_personal_lesson(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION preview_calendar_event_conflicts(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION preview_calendar_event_conflicts(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION create_calendar_event_with_cancellations(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_calendar_event_with_cancellations(jsonb) TO authenticated;

COMMIT;
