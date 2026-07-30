-- One-time hall rentals without teacher (CRM scenario 12 / Prompt 12)

BEGIN;

-- =============================================================================
-- 1. Schema
-- =============================================================================

CREATE TABLE renters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  display_name    TEXT NOT NULL,
  contact_phone   TEXT,
  contact_email   TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  CHECK (length(trim(display_name)) > 0)
);

CREATE INDEX idx_renters_org_name ON renters (organization_id, display_name);

CREATE TABLE rentals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  location_id     UUID NOT NULL,
  rental_date     DATE NOT NULL,
  time_start      TEXT NOT NULL,
  time_end        TEXT NOT NULL,
  renter_id       UUID NOT NULL,
  purpose         TEXT,
  internal_comment TEXT,
  booking_status  TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (booking_status IN ('confirmed', 'cancelled')),
  fixed_amount    NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (fixed_amount >= 0),
  currency        TEXT NOT NULL DEFAULT 'RUB',
  cancelled_at    TIMESTAMPTZ,
  cancelled_reason TEXT,
  cancelled_by    UUID,
  idempotency_key TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, location_id)
    REFERENCES locations (organization_id, id),
  FOREIGN KEY (organization_id, renter_id)
    REFERENCES renters (organization_id, id),
  FOREIGN KEY (organization_id, created_by)
    REFERENCES organization_members (organization_id, id),
  FOREIGN KEY (organization_id, cancelled_by)
    REFERENCES organization_members (organization_id, id),
  CHECK (rental_date >= DATE '2000-01-01'),
  CHECK (
    booking_status = 'confirmed'
    OR (cancelled_at IS NOT NULL AND cancelled_reason IS NOT NULL)
  )
);

CREATE UNIQUE INDEX rentals_org_idempotency_unique
  ON rentals (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_rentals_org_date ON rentals (organization_id, rental_date);
CREATE INDEX idx_rentals_org_location_date
  ON rentals (organization_id, location_id, rental_date)
  WHERE booking_status = 'confirmed';

CREATE TABLE rental_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  rental_id       UUID NOT NULL,
  amount          NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  currency        TEXT NOT NULL DEFAULT 'RUB',
  method          TEXT NOT NULL DEFAULT 'cash'
    CHECK (method IN ('cash', 'transfer', 'card', 'other')),
  method_comment  TEXT,
  idempotency_key TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, rental_id)
    REFERENCES rentals (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, created_by)
    REFERENCES organization_members (organization_id, id)
);

CREATE UNIQUE INDEX rental_payments_org_idempotency_unique
  ON rental_payments (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_rental_payments_org_created
  ON rental_payments (organization_id, created_at DESC);

CREATE INDEX idx_rental_payments_rental
  ON rental_payments (organization_id, rental_id);

-- =============================================================================
-- 2. Helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION member_can_manage_rentals()
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

CREATE OR REPLACE FUNCTION member_can_see_rental_sensitive()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT member_can_manage_rentals() OR can_read_financial();
$$;

CREATE OR REPLACE FUNCTION _rental_paid_total(p_rental_id uuid, p_org_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(sum(rp.amount), 0)
  FROM rental_payments rp
  WHERE rp.rental_id = p_rental_id
    AND rp.organization_id = p_org_id;
$$;

CREATE OR REPLACE FUNCTION _rental_payment_status(p_fixed_amount numeric, p_paid_amount numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN COALESCE(p_paid_amount, 0) <= 0 THEN 'unpaid'
    WHEN COALESCE(p_fixed_amount, 0) > 0 AND COALESCE(p_paid_amount, 0) > COALESCE(p_fixed_amount, 0) THEN 'overpaid'
    WHEN COALESCE(p_fixed_amount, 0) > 0 AND COALESCE(p_paid_amount, 0) >= COALESCE(p_fixed_amount, 0) THEN 'paid'
    WHEN COALESCE(p_fixed_amount, 0) <= 0 AND COALESCE(p_paid_amount, 0) > 0 THEN 'overpaid'
    ELSE 'partial'
  END;
$$;

CREATE OR REPLACE FUNCTION _hhmm_to_minutes(p_time text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT split_part(normalize_hhmm(p_time), ':', 1)::INT * 60
       + split_part(normalize_hhmm(p_time), ':', 2)::INT;
$$;

CREATE OR REPLACE FUNCTION _rental_location_lock_key(
  p_org_id uuid,
  p_location_id uuid,
  p_date date
)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT (
    ('x' || substr(md5(p_org_id::text || ':' || p_location_id::text || ':' || p_date::text), 1, 15))::bit(60)::bigint
  );
$$;

-- Extend unified conflict check (rentals + existing types)
CREATE OR REPLACE FUNCTION schedule_location_has_conflict(
  p_org_id uuid,
  p_date date,
  p_time_start text,
  p_time_end text,
  p_location_id uuid,
  p_exclude_slot_id uuid DEFAULT NULL,
  p_exclude_event_id uuid DEFAULT NULL,
  p_exclude_rental_id uuid DEFAULT NULL
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

  IF _hhmm_to_minutes(v_time_end) <= _hhmm_to_minutes(v_time_start) THEN
    RETURN true;
  END IF;

  v_dow := EXTRACT(ISODOW FROM p_date)::integer;

  IF EXISTS (
    SELECT 1
    FROM personal_lessons p
    WHERE p.organization_id = p_org_id
      AND p.date = p_date
      AND p.cancelled_at IS NULL
      AND p.location_id IS NOT DISTINCT FROM p_location_id
      AND schedule_time_ranges_overlap(p.time_start, p.time_end, v_time_start, v_time_end)
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
      AND schedule_time_ranges_overlap(s.time, s.time_end, v_time_start, v_time_end)
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
      AND schedule_time_ranges_overlap(ces.time_start, ces.time_end, v_time_start, v_time_end)
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.rental_date = p_date
      AND r.location_id IS NOT DISTINCT FROM p_location_id
      AND r.booking_status = 'confirmed'
      AND r.id IS DISTINCT FROM p_exclude_rental_id
      AND schedule_time_ranges_overlap(r.time_start, r.time_end, v_time_start, v_time_end)
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- =============================================================================
-- 3. Conflict preview
-- =============================================================================

CREATE OR REPLACE FUNCTION preview_rental_conflicts(
  p_date date,
  p_time_start text,
  p_time_end text,
  p_location_id uuid,
  p_exclude_rental_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_time_start text;
  v_time_end text;
  v_dow integer;
  v_conflicts jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_operational() AND current_member_role() <> 'teacher' THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF p_date IS NULL OR p_time_start IS NULL OR p_time_end IS NULL OR p_location_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.fieldsInvalid');
  END IF;

  v_time_start := normalize_hhmm(p_time_start);
  v_time_end := normalize_hhmm(p_time_end);
  v_dow := EXTRACT(ISODOW FROM p_date)::integer;

  IF _hhmm_to_minutes(v_time_end) <= _hhmm_to_minutes(v_time_start) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.timeRangeInvalid');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM locations l
    WHERE l.id = p_location_id AND l.organization_id = v_org_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.locationInvalid');
  END IF;

  v_conflicts := v_conflicts || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'kind', 'group',
      'slot_id', s.id,
      'occurrence_date', p_date,
      'time_start', s.time,
      'time_end', s.time_end,
      'location_id', s.location_id,
      'group_name', COALESCE(s.group_name, '')
    ))
    FROM schedule_slots s
    WHERE s.organization_id = v_org_id
      AND s.day_of_week = v_dow
      AND s.location_id IS NOT DISTINCT FROM p_location_id
      AND s.valid_from <= p_date
      AND (s.valid_to IS NULL OR s.valid_to >= p_date)
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
      'client_display', COALESCE(p.client_display, '')
    ))
    FROM personal_lessons p
    WHERE p.organization_id = v_org_id
      AND p.date = p_date
      AND p.cancelled_at IS NULL
      AND p.location_id IS NOT DISTINCT FROM p_location_id
      AND schedule_time_ranges_overlap(p.time_start, p.time_end, v_time_start, v_time_end)
  ), '[]'::jsonb);

  v_conflicts := v_conflicts || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'kind', 'event',
      'event_id', ce.id,
      'session_id', ces.id,
      'occurrence_date', ces.session_date,
      'time_start', ces.time_start,
      'time_end', ces.time_end,
      'location_id', ces.location_id,
      'title', ce.title
    ))
    FROM calendar_event_sessions ces
    JOIN calendar_events ce ON ce.id = ces.event_id AND ce.organization_id = ces.organization_id
    WHERE ces.organization_id = v_org_id
      AND ces.session_date = p_date
      AND ces.location_id IS NOT DISTINCT FROM p_location_id
      AND schedule_time_ranges_overlap(ces.time_start, ces.time_end, v_time_start, v_time_end)
  ), '[]'::jsonb);

  v_conflicts := v_conflicts || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'kind', 'rental',
      'rental_id', r.id,
      'occurrence_date', r.rental_date,
      'time_start', r.time_start,
      'time_end', r.time_end,
      'location_id', r.location_id,
      'purpose', COALESCE(r.purpose, '')
    ))
    FROM rentals r
    WHERE r.organization_id = v_org_id
      AND r.rental_date = p_date
      AND r.location_id IS NOT DISTINCT FROM p_location_id
      AND r.booking_status = 'confirmed'
      AND r.id IS DISTINCT FROM p_exclude_rental_id
      AND schedule_time_ranges_overlap(r.time_start, r.time_end, v_time_start, v_time_end)
  ), '[]'::jsonb);

  RETURN jsonb_build_object('success', true, 'conflicts', v_conflicts);
END;
$$;

-- Include rentals in calendar event conflict preview
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

    v_conflicts := v_conflicts || COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'kind', 'event',
        'event_id', ce.id,
        'session_id', ces.id,
        'occurrence_date', ces.session_date,
        'time_start', ces.time_start,
        'time_end', ces.time_end,
        'location_id', ces.location_id,
        'title', ce.title
      ))
      FROM calendar_event_sessions ces
      JOIN calendar_events ce ON ce.id = ces.event_id AND ce.organization_id = ces.organization_id
      WHERE ces.organization_id = v_org_id
        AND ces.session_date = v_date
        AND ces.location_id IS NOT DISTINCT FROM v_location_id
        AND schedule_time_ranges_overlap(ces.time_start, ces.time_end, v_time_start, v_time_end)
    ), '[]'::jsonb);

    v_conflicts := v_conflicts || COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'kind', 'rental',
        'rental_id', r.id,
        'occurrence_date', r.rental_date,
        'time_start', r.time_start,
        'time_end', r.time_end,
        'location_id', r.location_id,
        'purpose', COALESCE(r.purpose, '')
      ))
      FROM rentals r
      WHERE r.organization_id = v_org_id
        AND r.rental_date = v_date
        AND r.location_id IS NOT DISTINCT FROM v_location_id
        AND r.booking_status = 'confirmed'
        AND schedule_time_ranges_overlap(r.time_start, r.time_end, v_time_start, v_time_end)
    ), '[]'::jsonb);
  END LOOP;

  RETURN jsonb_build_object('success', true, 'conflicts', v_conflicts);
END;
$$;

-- =============================================================================
-- 4. Schedule week query (role-aware)
-- =============================================================================

CREATE OR REPLACE FUNCTION get_rentals_for_schedule_week(
  p_week_start date,
  p_week_end date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_sensitive boolean;
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF NOT can_read_operational() AND current_member_role() <> 'teacher' THEN
    RETURN '[]'::jsonb;
  END IF;

  v_sensitive := member_can_see_rental_sensitive();

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.rental_date, x.time_start), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      r.id AS rental_id,
      r.rental_date,
      r.time_start,
      r.time_end,
      r.location_id,
      r.booking_status,
      CASE WHEN v_sensitive THEN r.purpose ELSE NULL END AS purpose,
      CASE WHEN v_sensitive THEN ren.display_name ELSE NULL END AS renter_name,
      CASE WHEN v_sensitive THEN r.fixed_amount ELSE NULL END AS fixed_amount,
      CASE WHEN v_sensitive THEN r.currency ELSE NULL END AS currency,
      CASE WHEN v_sensitive THEN _rental_paid_total(r.id, r.organization_id) ELSE NULL END AS paid_amount,
      CASE WHEN v_sensitive THEN _rental_payment_status(r.fixed_amount, _rental_paid_total(r.id, r.organization_id)) ELSE NULL END AS payment_status
    FROM rentals r
    JOIN renters ren ON ren.id = r.renter_id AND ren.organization_id = r.organization_id
    WHERE r.organization_id = v_org_id
      AND r.rental_date >= p_week_start
      AND r.rental_date <= p_week_end
  ) x;

  RETURN v_rows;
END;
$$;

-- =============================================================================
-- 5. CRUD RPCs
-- =============================================================================

CREATE OR REPLACE FUNCTION create_renter(p_display_name text, p_contact_phone text DEFAULT NULL, p_contact_email text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT member_can_manage_rentals() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
  END IF;

  IF NULLIF(trim(p_display_name), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.renterNameRequired');
  END IF;

  INSERT INTO renters (organization_id, display_name, contact_phone, contact_email)
  VALUES (v_org_id, trim(p_display_name), NULLIF(trim(p_contact_phone), ''), NULLIF(trim(p_contact_email), ''))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'renter_id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION create_rental(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_idempotency_key text := NULLIF(trim(p_payload ->> 'idempotency_key'), '');
  v_existing rentals%ROWTYPE;
  v_rental_id uuid;
  v_date date;
  v_time_start text;
  v_time_end text;
  v_location_id uuid;
  v_renter_id uuid;
  v_fixed_amount numeric;
  v_currency text;
  v_paid_amount numeric := 0;
  v_conflicts jsonb;
  v_conflict jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT member_can_manage_rentals() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
  END IF;

  IF v_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM rentals r
    WHERE r.organization_id = v_org_id AND r.idempotency_key = v_idempotency_key;

    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'rental_id', v_existing.id, 'already_applied', true);
    END IF;
  END IF;

  v_date := (p_payload ->> 'rental_date')::date;
  v_time_start := normalize_hhmm(p_payload ->> 'time_start');
  v_time_end := normalize_hhmm(p_payload ->> 'time_end');
  v_location_id := (p_payload ->> 'location_id')::uuid;
  v_renter_id := (p_payload ->> 'renter_id')::uuid;
  v_fixed_amount := COALESCE((p_payload ->> 'fixed_amount')::numeric, 0);
  v_currency := COALESCE(NULLIF(p_payload ->> 'currency', ''), 'RUB');

  IF v_date IS NULL OR v_location_id IS NULL OR v_renter_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.fieldsInvalid');
  END IF;

  IF _hhmm_to_minutes(v_time_end) <= _hhmm_to_minutes(v_time_start) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.timeRangeInvalid');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM locations l WHERE l.id = v_location_id AND l.organization_id = v_org_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.locationInvalid');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM renters ren WHERE ren.id = v_renter_id AND ren.organization_id = v_org_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.renterInvalid');
  END IF;

  IF v_fixed_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.amountInvalid');
  END IF;

  IF v_fixed_amount > 0 AND NOT can_read_financial() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  v_conflicts := preview_rental_conflicts(v_date, v_time_start, v_time_end, v_location_id, NULL);
  IF NOT COALESCE((v_conflicts ->> 'success')::boolean, false) THEN
    RETURN v_conflicts;
  END IF;

  IF jsonb_array_length(COALESCE(v_conflicts -> 'conflicts', '[]'::jsonb)) > 0 THEN
    SELECT value INTO v_conflict
    FROM jsonb_array_elements(v_conflicts -> 'conflicts') LIMIT 1;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'schedule.rental.conflict',
      'conflict', v_conflict
    );
  END IF;

  PERFORM pg_advisory_xact_lock(_rental_location_lock_key(v_org_id, v_location_id, v_date));

  IF schedule_location_has_conflict(v_org_id, v_date, v_time_start, v_time_end, v_location_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.conflict');
  END IF;

  INSERT INTO rentals (
    organization_id,
    location_id,
    rental_date,
    time_start,
    time_end,
    renter_id,
    purpose,
    internal_comment,
    fixed_amount,
    currency,
    idempotency_key,
    created_by
  )
  VALUES (
    v_org_id,
    v_location_id,
    v_date,
    v_time_start,
    v_time_end,
    v_renter_id,
    NULLIF(trim(p_payload ->> 'purpose'), ''),
    NULLIF(trim(p_payload ->> 'internal_comment'), ''),
    v_fixed_amount,
    v_currency,
    v_idempotency_key,
    v_member_id
  )
  RETURNING id INTO v_rental_id;

  IF COALESCE((p_payload ->> 'initial_payment')::numeric, 0) > 0 THEN
    IF NOT can_read_financial() THEN
      RAISE EXCEPTION 'schedule.rental.financeForbidden' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO rental_payments (
      organization_id, rental_id, amount, currency, method, method_comment, idempotency_key, created_by
    )
    VALUES (
      v_org_id,
      v_rental_id,
      (p_payload ->> 'initial_payment')::numeric,
      v_currency,
      COALESCE(NULLIF(p_payload ->> 'payment_method', ''), 'cash'),
      NULLIF(trim(p_payload ->> 'payment_comment'), ''),
      CASE WHEN v_idempotency_key IS NOT NULL THEN v_idempotency_key || ':payment' END,
      v_member_id
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'rental_id', v_rental_id);
EXCEPTION
  WHEN unique_violation THEN
    IF v_idempotency_key IS NOT NULL THEN
      SELECT id INTO v_rental_id FROM rentals WHERE organization_id = v_org_id AND idempotency_key = v_idempotency_key;
      IF v_rental_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'rental_id', v_rental_id, 'already_applied', true);
      END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.duplicate');
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION update_rental(p_rental_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_rental rentals%ROWTYPE;
  v_date date;
  v_time_start text;
  v_time_end text;
  v_location_id uuid;
  v_renter_id uuid;
  v_fixed_amount numeric;
  v_paid numeric;
  v_conflicts jsonb;
  v_conflict jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT member_can_manage_rentals() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
  END IF;

  SELECT * INTO v_rental
  FROM rentals r
  WHERE r.id = p_rental_id AND r.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.notFound');
  END IF;

  IF v_rental.booking_status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.alreadyCancelled');
  END IF;

  v_date := COALESCE((p_payload ->> 'rental_date')::date, v_rental.rental_date);
  v_time_start := COALESCE(normalize_hhmm(p_payload ->> 'time_start'), v_rental.time_start);
  v_time_end := COALESCE(normalize_hhmm(p_payload ->> 'time_end'), v_rental.time_end);
  v_location_id := COALESCE((p_payload ->> 'location_id')::uuid, v_rental.location_id);
  v_renter_id := COALESCE((p_payload ->> 'renter_id')::uuid, v_rental.renter_id);

  IF _hhmm_to_minutes(v_time_end) <= _hhmm_to_minutes(v_time_start) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.timeRangeInvalid');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM renters ren WHERE ren.id = v_renter_id AND ren.organization_id = v_org_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.renterInvalid');
  END IF;

  v_fixed_amount := v_rental.fixed_amount;
  IF p_payload ? 'fixed_amount' THEN
    IF NOT can_read_financial() THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
    END IF;
    v_fixed_amount := COALESCE((p_payload ->> 'fixed_amount')::numeric, 0);
    IF v_fixed_amount < 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.amountInvalid');
    END IF;
    v_paid := _rental_paid_total(p_rental_id, v_org_id);
    IF v_paid > v_fixed_amount AND v_fixed_amount > 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.paidExceedsFixed');
    END IF;
  END IF;

  v_conflicts := preview_rental_conflicts(v_date, v_time_start, v_time_end, v_location_id, p_rental_id);
  IF NOT COALESCE((v_conflicts ->> 'success')::boolean, false) THEN
    RETURN v_conflicts;
  END IF;

  IF jsonb_array_length(COALESCE(v_conflicts -> 'conflicts', '[]'::jsonb)) > 0 THEN
    SELECT value INTO v_conflict FROM jsonb_array_elements(v_conflicts -> 'conflicts') LIMIT 1;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.conflict', 'conflict', v_conflict);
  END IF;

  PERFORM pg_advisory_xact_lock(_rental_location_lock_key(v_org_id, v_location_id, v_date));

  IF schedule_location_has_conflict(v_org_id, v_date, v_time_start, v_time_end, v_location_id, NULL, NULL, p_rental_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.conflict');
  END IF;

  UPDATE rentals
  SET
    rental_date = v_date,
    time_start = v_time_start,
    time_end = v_time_end,
    location_id = v_location_id,
    renter_id = v_renter_id,
    purpose = CASE WHEN p_payload ? 'purpose' THEN NULLIF(trim(p_payload ->> 'purpose'), '') ELSE purpose END,
    internal_comment = CASE
      WHEN p_payload ? 'internal_comment' AND member_can_see_rental_sensitive()
        THEN NULLIF(trim(p_payload ->> 'internal_comment'), '')
      ELSE internal_comment
    END,
    fixed_amount = v_fixed_amount,
    currency = COALESCE(NULLIF(p_payload ->> 'currency', ''), currency),
    updated_at = now()
  WHERE id = p_rental_id;

  RETURN jsonb_build_object('success', true, 'rental_id', p_rental_id);
END;
$$;

CREATE OR REPLACE FUNCTION cancel_rental(
  p_rental_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_rental rentals%ROWTYPE;
  v_has_payments boolean;
  v_past_or_now boolean;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT member_can_manage_rentals() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
  END IF;

  IF NULLIF(trim(p_reason), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.cancelReasonRequired');
  END IF;

  SELECT * INTO v_rental
  FROM rentals r
  WHERE r.id = p_rental_id AND r.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.notFound');
  END IF;

  IF v_rental.booking_status = 'cancelled' THEN
    RETURN jsonb_build_object('success', true, 'already_applied', true);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM rental_payments rp
    WHERE rp.rental_id = p_rental_id AND rp.organization_id = v_org_id
  ) INTO v_has_payments;

  v_past_or_now := v_rental.rental_date <= current_date;

  UPDATE rentals
  SET
    booking_status = 'cancelled',
    cancelled_at = now(),
    cancelled_reason = trim(p_reason),
    cancelled_by = v_member_id,
    updated_at = now()
  WHERE id = p_rental_id;

  RETURN jsonb_build_object('success', true, 'rental_id', p_rental_id);
END;
$$;

CREATE OR REPLACE FUNCTION get_rental_detail(p_rental_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_sensitive boolean;
  v_rental rentals%ROWTYPE;
  v_renter renters%ROWTYPE;
  v_paid numeric;
  v_payments jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_operational() AND current_member_role() <> 'teacher' THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  SELECT * INTO v_rental FROM rentals r WHERE r.id = p_rental_id AND r.organization_id = v_org_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.notFound');
  END IF;

  SELECT * INTO v_renter FROM renters ren WHERE ren.id = v_rental.renter_id AND ren.organization_id = v_org_id;
  v_sensitive := member_can_see_rental_sensitive();
  v_paid := _rental_paid_total(p_rental_id, v_org_id);

  IF v_sensitive AND can_read_financial() THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', rp.id,
      'amount', rp.amount,
      'currency', rp.currency,
      'method', rp.method,
      'method_comment', rp.method_comment,
      'created_at', rp.created_at
    ) ORDER BY rp.created_at), '[]'::jsonb)
    INTO v_payments
    FROM rental_payments rp
    WHERE rp.rental_id = p_rental_id AND rp.organization_id = v_org_id;
  ELSE
    v_payments := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'rental', jsonb_build_object(
      'id', v_rental.id,
      'rental_date', v_rental.rental_date,
      'time_start', v_rental.time_start,
      'time_end', v_rental.time_end,
      'location_id', v_rental.location_id,
      'booking_status', v_rental.booking_status,
      'purpose', CASE WHEN v_sensitive THEN v_rental.purpose ELSE NULL END,
      'internal_comment', CASE WHEN v_sensitive THEN v_rental.internal_comment ELSE NULL END,
      'fixed_amount', CASE WHEN v_sensitive THEN v_rental.fixed_amount ELSE NULL END,
      'currency', CASE WHEN v_sensitive THEN v_rental.currency ELSE NULL END,
      'paid_amount', CASE WHEN v_sensitive THEN v_paid ELSE NULL END,
      'payment_status', CASE WHEN v_sensitive THEN _rental_payment_status(v_rental.fixed_amount, v_paid) ELSE NULL END,
      'cancelled_at', v_rental.cancelled_at,
      'cancelled_reason', CASE WHEN v_sensitive THEN v_rental.cancelled_reason ELSE NULL END
    ),
    'renter', jsonb_build_object(
      'id', v_renter.id,
      'display_name', CASE WHEN v_sensitive THEN v_renter.display_name ELSE NULL END,
      'contact_phone', CASE WHEN v_sensitive AND can_read_financial() THEN v_renter.contact_phone ELSE NULL END,
      'contact_email', CASE WHEN v_sensitive AND can_read_financial() THEN v_renter.contact_email ELSE NULL END
    ),
    'payments', v_payments
  );
END;
$$;

CREATE OR REPLACE FUNCTION record_rental_payment(
  p_rental_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_method_comment text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_rental rentals%ROWTYPE;
  v_key text := NULLIF(trim(p_idempotency_key), '');
  v_existing rental_payments%ROWTYPE;
  v_payment_id uuid;
  v_new_paid numeric;
  v_new_status text;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.orgReadOnly');
  END IF;

  IF NOT can_read_financial() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.paymentAmountInvalid');
  END IF;

  IF p_method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.paymentMethodInvalid');
  END IF;

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM rental_payments rp
    WHERE rp.organization_id = v_org_id AND rp.idempotency_key = v_key;

    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'payment_id', v_existing.id, 'already_applied', true);
    END IF;
  END IF;

  SELECT * INTO v_rental
  FROM rentals r
  WHERE r.id = p_rental_id AND r.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.notFound');
  END IF;

  IF v_rental.booking_status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.alreadyCancelled');
  END IF;

  INSERT INTO rental_payments (
    organization_id, rental_id, amount, currency, method, method_comment, idempotency_key, created_by
  )
  VALUES (
    v_org_id,
    p_rental_id,
    p_amount,
    v_rental.currency,
    p_method,
    NULLIF(trim(p_method_comment), ''),
    v_key,
    v_member_id
  )
  RETURNING id INTO v_payment_id;

  v_new_paid := _rental_paid_total(p_rental_id, v_org_id);
  v_new_status := _rental_payment_status(v_rental.fixed_amount, v_new_paid);

  UPDATE rentals SET updated_at = now() WHERE id = p_rental_id;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'paid_amount', v_new_paid,
    'payment_status', v_new_status
  );
EXCEPTION
  WHEN unique_violation THEN
    IF v_key IS NOT NULL THEN
      SELECT id INTO v_payment_id FROM rental_payments WHERE organization_id = v_org_id AND idempotency_key = v_key;
      IF v_payment_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id, 'already_applied', true);
      END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.duplicate');
END;
$$;

-- =============================================================================
-- 6. RLS
-- =============================================================================

ALTER TABLE renters ENABLE ROW LEVEL SECURITY;
ALTER TABLE rentals ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY renters_select ON renters FOR SELECT TO authenticated
  USING (organization_id = auth_organization_id() AND business_row_readable() AND member_can_see_rental_sensitive());

CREATE POLICY renters_insert ON renters FOR INSERT TO authenticated
  WITH CHECK (organization_id = auth_organization_id() AND member_can_manage_rentals());

CREATE POLICY renters_update ON renters FOR UPDATE TO authenticated
  USING (organization_id = auth_organization_id() AND member_can_manage_rentals())
  WITH CHECK (organization_id = auth_organization_id() AND member_can_manage_rentals());

CREATE POLICY rentals_select_sensitive ON rentals FOR SELECT TO authenticated
  USING (organization_id = auth_organization_id() AND business_row_readable() AND member_can_see_rental_sensitive());

CREATE POLICY rental_payments_select ON rental_payments FOR SELECT TO authenticated
  USING (organization_id = auth_organization_id() AND business_row_readable() AND can_read_financial());

-- =============================================================================
-- 7. Grants
-- =============================================================================

REVOKE ALL ON FUNCTION member_can_manage_rentals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_manage_rentals() TO authenticated, service_role;

REVOKE ALL ON FUNCTION member_can_see_rental_sensitive() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_see_rental_sensitive() TO authenticated, service_role;

REVOKE ALL ON FUNCTION preview_rental_conflicts(date, text, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION preview_rental_conflicts(date, text, text, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION get_rentals_for_schedule_week(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_rentals_for_schedule_week(date, date) TO authenticated;

REVOKE ALL ON FUNCTION create_renter(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_renter(text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION create_rental(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_rental(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION update_rental(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_rental(uuid, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION cancel_rental(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_rental(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION get_rental_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_rental_detail(uuid) TO authenticated;

REVOKE ALL ON FUNCTION record_rental_payment(uuid, numeric, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_rental_payment(uuid, numeric, text, text, text) TO authenticated;

COMMIT;
