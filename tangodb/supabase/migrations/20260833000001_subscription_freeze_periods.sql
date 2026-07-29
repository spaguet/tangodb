-- Subscription freeze periods (CRM scenario 5 / Prompt 5)

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Optional tariff-level freeze policy overrides
ALTER TABLE prices
  ADD COLUMN IF NOT EXISTS freeze_max_count INT CHECK (freeze_max_count IS NULL OR freeze_max_count >= 0),
  ADD COLUMN IF NOT EXISTS freeze_min_lessons INT CHECK (freeze_min_lessons IS NULL OR freeze_min_lessons >= 0);

CREATE TABLE IF NOT EXISTS subscription_freeze_periods (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  subscription_id         UUID NOT NULL,
  start_date              DATE NOT NULL,
  end_date                DATE NOT NULL,
  reason                  TEXT,
  status                  TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'cancelled')),
  calendar_days           INT NOT NULL CHECK (calendar_days >= 1),
  expires_days_added      INT NOT NULL DEFAULT 0 CHECK (expires_days_added >= 0),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_member_id    UUID,
  cancelled_at            TIMESTAMPTZ,
  cancelled_by_member_id  UUID,
  CHECK (end_date >= start_date),
  FOREIGN KEY (organization_id, subscription_id)
    REFERENCES subscriptions (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, created_by_member_id)
    REFERENCES organization_members (organization_id, id),
  FOREIGN KEY (organization_id, cancelled_by_member_id)
    REFERENCES organization_members (organization_id, id)
);

CREATE INDEX IF NOT EXISTS idx_subscription_freeze_periods_org_sub
  ON subscription_freeze_periods (organization_id, subscription_id, start_date DESC);

ALTER TABLE subscription_freeze_periods
  DROP CONSTRAINT IF EXISTS subscription_freeze_periods_no_overlap;

ALTER TABLE subscription_freeze_periods
  ADD CONSTRAINT subscription_freeze_periods_no_overlap
  EXCLUDE USING gist (
    subscription_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  )
  WHERE (status = 'active');

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS freeze_period_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attendance_freeze_period_id_fkey'
  ) THEN
    ALTER TABLE attendance
      ADD CONSTRAINT attendance_freeze_period_id_fkey
      FOREIGN KEY (freeze_period_id) REFERENCES subscription_freeze_periods (id) ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION inclusive_calendar_days(p_start date, p_end date)
RETURNS int
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT GREATEST(0, (p_end - p_start + 1))::int;
$$;

CREATE OR REPLACE FUNCTION resolve_subscription_freeze_policy(p_sub subscriptions)
RETURNS TABLE (
  freeze_enabled boolean,
  freeze_max_count int,
  freeze_min_lessons int
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    os.freeze_enabled,
    COALESCE(p.freeze_max_count, os.freeze_max_count) AS freeze_max_count,
    COALESCE(p.freeze_min_lessons, os.freeze_min_lessons) AS freeze_min_lessons
  FROM organization_settings os
  LEFT JOIN prices p
    ON p.organization_id = p_sub.organization_id
   AND p.id = p_sub.price_id
  WHERE os.organization_id = p_sub.organization_id;
$$;

CREATE OR REPLACE FUNCTION subscription_active_freeze_period_id(
  p_org_id uuid,
  p_sub_id uuid,
  p_date date
)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT sfp.id
  FROM subscription_freeze_periods sfp
  WHERE sfp.organization_id = p_org_id
    AND sfp.subscription_id = p_sub_id
    AND sfp.status = 'active'
    AND p_date BETWEEN sfp.start_date AND sfp.end_date
  ORDER BY sfp.start_date
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION member_can_manage_subscription_freeze(p_sub_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_role text := current_member_role();
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM subscriptions s
    WHERE s.id = p_sub_id
      AND s.organization_id = v_org_id
  ) THEN
    RETURN false;
  END IF;

  IF v_role = 'accountant' THEN
    RETURN false;
  END IF;

  IF v_role = 'director' AND NOT directors_can_mark_attendance_setting() THEN
    RETURN false;
  END IF;

  IF v_role = 'teacher' AND NOT teacher_can_access_subscription(p_sub_id) THEN
    RETURN false;
  END IF;

  IF v_role IN ('owner', 'director', 'admin') THEN
    IF v_role = 'admin' AND is_restricted_admin() THEN
      RETURN false;
    END IF;
    RETURN true;
  END IF;

  IF v_role = 'teacher' THEN
    RETURN teacher_can_access_subscription(p_sub_id);
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION _subscription_occurrence_cancelled(
  p_org_id uuid,
  p_slot_id uuid,
  p_date date
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM schedule_occurrence_cancellations soc
    WHERE soc.organization_id = p_org_id
      AND soc.slot_id = p_slot_id
      AND soc.occurrence_date = p_date
  );
$$;

CREATE OR REPLACE FUNCTION _apply_freeze_attendance_for_occurrence(
  p_org_id uuid,
  p_sub_id uuid,
  p_schedule_group_id uuid,
  p_date date,
  p_client_display text,
  p_period_id uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_existing_status text;
BEGIN
  SELECT a.attendance_status
  INTO v_existing_status
  FROM attendance a
  WHERE a.organization_id = p_org_id
    AND a.date = p_date
    AND a.subscription_id = p_sub_id
    AND a.schedule_group_id = p_schedule_group_id;

  IF v_existing_status IN ('present', 'absent', 'excused') THEN
    RETURN;
  END IF;

  INSERT INTO attendance (
    organization_id,
    date,
    subscription_id,
    schedule_group_id,
    client_display,
    attendance_status,
    freeze_period_id
  )
  VALUES (
    p_org_id,
    p_date,
    p_sub_id,
    p_schedule_group_id,
    p_client_display,
    'freeze',
    p_period_id
  )
  ON CONFLICT (organization_id, date, subscription_id, schedule_group_id)
  DO UPDATE SET
    attendance_status = CASE
      WHEN attendance.attendance_status IN ('present', 'absent', 'excused') THEN attendance.attendance_status
      ELSE 'freeze'
    END,
    freeze_period_id = CASE
      WHEN attendance.attendance_status IN ('present', 'absent', 'excused') THEN attendance.freeze_period_id
      ELSE EXCLUDED.freeze_period_id
    END,
    client_display = EXCLUDED.client_display;
END;
$$;

CREATE OR REPLACE FUNCTION apply_subscription_freeze_period(
  p_sub_id text,
  p_start_date text,
  p_end_date text,
  p_reason text DEFAULT NULL
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
  v_policy RECORD;
  v_sub_uuid uuid;
  v_start date;
  v_end date;
  v_today date := current_date;
  v_calendar_days int;
  v_new_expires date;
  v_period_id uuid;
  v_display text := '';
  v_c1 record;
  v_c2 record;
  v_c3 record;
  v_link record;
  v_slot schedule_slots%ROWTYPE;
  v_date date;
  v_existing_id uuid;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'freeze.error.unauthorized');
  END IF;

  PERFORM expire_monthly_subscriptions(v_org_id);

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'freeze.error.orgReadOnly');
  END IF;

  IF p_start_date IS NULL OR p_start_date !~ '^\d{4}-\d{2}-\d{2}$'
     OR p_end_date IS NULL OR p_end_date !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'freeze.error.invalidDate');
  END IF;

  BEGIN
    v_start := p_start_date::date;
    v_end := p_end_date::date;
    v_sub_uuid := p_sub_id::uuid;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'error', 'freeze.error.invalidDate');
  END;

  IF v_end < v_start THEN
    RETURN jsonb_build_object('success', false, 'error', 'freeze.error.invalidRange');
  END IF;

  IF NOT member_can_manage_subscription_freeze(v_sub_uuid) THEN
    RETURN jsonb_build_object('success', false, 'error', 'freeze.error.forbidden');
  END IF;

  SELECT *
  INTO v_sub
  FROM subscriptions s
  WHERE s.id = v_sub_uuid
    AND s.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'freeze.error.subscriptionNotFound');
  END IF;

  IF v_sub.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'freeze.error.subscriptionInactive');
  END IF;

  IF v_sub.category <> 'group' THEN
    RETURN jsonb_build_object('success', false, 'error', 'freeze.error.groupOnly');
  END IF;

  IF v_sub.activation_date > v_end THEN
    RETURN jsonb_build_object('success', false, 'error', 'freeze.error.beforeActivation');
  END IF;

  IF v_sub.billing_model = 'lesson_count'
     AND v_sub.expires_at IS NOT NULL
     AND v_sub.expires_at < v_start THEN
    RETURN jsonb_build_object('success', false, 'error', 'freeze.error.subscriptionExpired');
  END IF;

  SELECT sfp.id
  INTO v_existing_id
  FROM subscription_freeze_periods sfp
  WHERE sfp.organization_id = v_org_id
    AND sfp.subscription_id = v_sub_uuid
    AND sfp.status = 'active'
    AND sfp.start_date = v_start
    AND sfp.end_date = v_end
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'periodId', v_existing_id,
      'lessonsLeft', v_sub.lessons_left,
      'expiresAt', v_sub.expires_at,
      'freezeUsed', v_sub.freeze_used,
      'idempotent', true
    );
  END IF;

  SELECT * INTO v_policy FROM resolve_subscription_freeze_policy(v_sub);

  IF NOT FOUND OR NOT v_policy.freeze_enabled THEN
    RETURN jsonb_build_object('success', false, 'error', 'freeze.error.disabled');
  END IF;

  IF v_sub.billing_model = 'lesson_count'
     AND v_sub.lessons_total < v_policy.freeze_min_lessons THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',
      format('freeze.error.minLessons:%s', v_policy.freeze_min_lessons)
    );
  END IF;

  IF v_sub.freeze_used + 1 > v_policy.freeze_max_count THEN
    RETURN jsonb_build_object('success', false, 'error', 'freeze.error.limitExceeded');
  END IF;

  v_calendar_days := inclusive_calendar_days(v_start, v_end);

  IF v_sub.billing_model = 'monthly_unlimited' OR v_sub.expires_at IS NOT NULL THEN
    v_new_expires := COALESCE(v_sub.expires_at, v_end) + v_calendar_days;
  ELSE
    v_new_expires := v_sub.expires_at;
  END IF;

  v_period_id := gen_random_uuid();

  INSERT INTO subscription_freeze_periods (
    id,
    organization_id,
    subscription_id,
    start_date,
    end_date,
    reason,
    status,
    calendar_days,
    expires_days_added,
    created_by_member_id
  )
  VALUES (
    v_period_id,
    v_org_id,
    v_sub_uuid,
    v_start,
    v_end,
    NULLIF(trim(p_reason), ''),
    'active',
    v_calendar_days,
    CASE
      WHEN v_sub.billing_model = 'monthly_unlimited' OR v_sub.expires_at IS NOT NULL THEN v_calendar_days
      ELSE 0
    END,
    v_member_id
  );

  PERFORM set_config('app.allow_subscription_counter_update', 'true', true);

  UPDATE subscriptions
  SET
    freeze_used = freeze_used + 1,
    expires_at = CASE
      WHEN billing_model = 'monthly_unlimited' OR expires_at IS NOT NULL THEN v_new_expires
      ELSE expires_at
    END
  WHERE id = v_sub_uuid
    AND organization_id = v_org_id;

  SELECT last_name, first_name INTO v_c1 FROM clients WHERE id = v_sub.client_id1;
  IF FOUND THEN
    v_display := v_c1.last_name || ' ' || v_c1.first_name;
  ELSE
    v_display := v_sub.client_id1::text;
  END IF;

  IF v_sub.client_id2 IS NOT NULL THEN
    SELECT last_name, first_name INTO v_c2 FROM clients WHERE id = v_sub.client_id2;
    IF FOUND THEN
      v_display := v_display || ' & ' || v_c2.last_name || ' ' || v_c2.first_name;
    END IF;
  END IF;

  IF v_sub.client_id3 IS NOT NULL THEN
    SELECT last_name, first_name INTO v_c3 FROM clients WHERE id = v_sub.client_id3;
    IF FOUND THEN
      v_display := v_display || ' & ' || v_c3.last_name || ' ' || v_c3.first_name;
    END IF;
  END IF;

  FOR v_link IN
    SELECT sg.schedule_group_id
    FROM subscription_groups sg
    WHERE sg.organization_id = v_org_id
      AND sg.subscription_id = v_sub_uuid
  LOOP
    FOR v_slot IN
      SELECT ss.*
      FROM schedule_slots ss
      WHERE ss.organization_id = v_org_id
        AND ss.class_id = v_link.schedule_group_id
    LOOP
      v_date := v_start;
      WHILE v_date <= v_end LOOP
        IF _is_group_slot_occurrence_date(v_slot, v_date)
           AND NOT _subscription_occurrence_cancelled(v_org_id, v_slot.id, v_date)
           AND v_date <= v_today THEN
          PERFORM _apply_freeze_attendance_for_occurrence(
            v_org_id,
            v_sub_uuid,
            v_link.schedule_group_id,
            v_date,
            v_display,
            v_period_id
          );
        END IF;
        v_date := v_date + 1;
      END LOOP;
    END LOOP;
  END LOOP;

  SELECT lessons_left, expires_at, freeze_used
  INTO v_sub.lessons_left, v_sub.expires_at, v_sub.freeze_used
  FROM subscriptions
  WHERE id = v_sub_uuid;

  RETURN jsonb_build_object(
    'success', true,
    'periodId', v_period_id,
    'lessonsLeft', v_sub.lessons_left,
    'expiresAt', v_sub.expires_at,
    'freezeUsed', v_sub.freeze_used,
    'calendarDays', v_calendar_days
  );
EXCEPTION
  WHEN exclusion_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'freeze.error.overlap');
END;
$$;

CREATE OR REPLACE FUNCTION cancel_subscription_freeze_period(p_period_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_period subscription_freeze_periods%ROWTYPE;
  v_sub subscriptions%ROWTYPE;
  v_today date := current_date;
  v_days_to_revert int;
  v_new_expires date;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'freeze.error.unauthorized');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'freeze.error.orgReadOnly');
  END IF;

  SELECT *
  INTO v_period
  FROM subscription_freeze_periods sfp
  WHERE sfp.id = p_period_id
    AND sfp.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'freeze.error.periodNotFound');
  END IF;

  IF v_period.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'freeze.error.periodNotActive');
  END IF;

  IF v_period.end_date < v_today THEN
    RETURN jsonb_build_object('success', false, 'error', 'freeze.error.periodCompleted');
  END IF;

  IF NOT member_can_manage_subscription_freeze(v_period.subscription_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'freeze.error.forbidden');
  END IF;

  SELECT *
  INTO v_sub
  FROM subscriptions s
  WHERE s.id = v_period.subscription_id
    AND s.organization_id = v_org_id
  FOR UPDATE;

  IF v_today < v_period.start_date THEN
    v_days_to_revert := v_period.expires_days_added;
  ELSE
    v_days_to_revert := GREATEST(0, v_period.end_date - v_today);
  END IF;

  IF v_sub.expires_at IS NOT NULL AND v_days_to_revert > 0 THEN
    v_new_expires := v_sub.expires_at - v_days_to_revert;
  ELSE
    v_new_expires := v_sub.expires_at;
  END IF;

  UPDATE subscription_freeze_periods
  SET
    status = 'cancelled',
    cancelled_at = now(),
    cancelled_by_member_id = v_member_id
  WHERE id = p_period_id;

  DELETE FROM attendance a
  WHERE a.freeze_period_id = p_period_id
    AND a.date >= v_today
    AND a.attendance_status = 'freeze';

  PERFORM set_config('app.allow_subscription_counter_update', 'true', true);

  UPDATE subscriptions
  SET
    freeze_used = GREATEST(0, freeze_used - 1),
    expires_at = v_new_expires
  WHERE id = v_period.subscription_id
    AND organization_id = v_org_id;

  SELECT lessons_left, expires_at, freeze_used
  INTO v_sub.lessons_left, v_sub.expires_at, v_sub.freeze_used
  FROM subscriptions
  WHERE id = v_period.subscription_id;

  RETURN jsonb_build_object(
    'success', true,
    'lessonsLeft', v_sub.lessons_left,
    'expiresAt', v_sub.expires_at,
    'freezeUsed', v_sub.freeze_used
  );
END;
$$;

-- mark_attendance v4 — respect active subscription freeze periods
CREATE OR REPLACE FUNCTION mark_attendance(
  p_date text,
  p_sub_id text,
  p_new_status text,
  p_discipline_id uuid DEFAULT NULL,
  p_schedule_group_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_role text := current_member_role();
  v_sub RECORD;
  v_settings RECORD;
  v_old_status text;
  v_lesson_delta int := 0;
  v_freeze_delta int := 0;
  v_new_lessons_left int;
  v_new_freeze_used int;
  v_display text := '';
  v_c1 record;
  v_c2 record;
  v_c3 record;
  v_today date := current_date;
  v_sub_uuid uuid;
  v_in_freeze_period boolean;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  PERFORM expire_monthly_subscriptions(v_org_id);

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Организация в режиме только чтения');
  END IF;

  IF p_date !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Неверный формат даты');
  END IF;

  IF p_date::date > v_today THEN
    RETURN jsonb_build_object('success', false, 'error', 'Отметки доступны только за прошедшие и текущий день');
  END IF;

  IF p_schedule_group_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Укажите групповой урок');
  END IF;

  IF p_new_status NOT IN ('present', 'absent', 'freeze', 'excused') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недопустимый статус');
  END IF;

  BEGIN
    v_sub_uuid := p_sub_id::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RETURN jsonb_build_object('success', false, 'error', 'Абонемент не найден');
  END;

  SELECT * INTO v_sub
  FROM subscriptions
  WHERE id = v_sub_uuid
    AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Абонемент не найден');
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
    FROM subscription_groups sg
    WHERE sg.organization_id = v_org_id
      AND sg.subscription_id = v_sub_uuid
      AND sg.schedule_group_id = p_schedule_group_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Абонемент не действует для этой группы');
  END IF;

  IF p_discipline_id IS NOT NULL
    AND v_sub.category = 'group'
    AND v_sub.discipline_id IS NOT NULL
    AND v_sub.discipline_id <> p_discipline_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Абонемент действует только для групповых уроков выбранного направления'
    );
  END IF;

  IF v_sub.billing_model = 'monthly_unlimited' THEN
    IF p_new_status NOT IN ('present', 'absent') THEN
      RETURN jsonb_build_object('success', false, 'error', 'Для месячного абонемента доступны только присутствие и отсутствие');
    END IF;
    IF v_sub.activation_date > p_date::date THEN
      RETURN jsonb_build_object('success', false, 'error', 'Абонемент ещё не активирован');
    END IF;
    IF v_sub.expires_at < p_date::date THEN
      RETURN jsonb_build_object('success', false, 'error', 'Срок месячного абонемента истёк');
    END IF;
  END IF;

  IF v_sub.category = 'private' AND p_new_status = 'freeze' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Заморозка недоступна для персональных абонементов');
  END IF;

  IF v_sub.billing_model = 'monthly_unlimited' AND p_new_status IN ('freeze', 'excused') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Для месячного абонемента недоступны заморозка и уважительный пропуск');
  END IF;

  SELECT
    pol.freeze_enabled,
    pol.freeze_max_count,
    pol.freeze_min_lessons
  INTO v_settings
  FROM resolve_subscription_freeze_policy(v_sub) pol;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Настройки организации не найдены');
  END IF;

  IF p_new_status = 'freeze' AND NOT v_settings.freeze_enabled THEN
    RETURN jsonb_build_object('success', false, 'error', 'Заморозки отключены в настройках организации');
  END IF;

  v_in_freeze_period := subscription_active_freeze_period_id(v_org_id, v_sub_uuid, p_date::date) IS NOT NULL;

  SELECT a.attendance_status
  INTO v_old_status
  FROM attendance a
  WHERE a.date = p_date::date
    AND a.subscription_id = v_sub_uuid
    AND a.schedule_group_id = p_schedule_group_id
    AND a.organization_id = v_org_id;

  IF v_old_status IS NOT DISTINCT FROM p_new_status THEN
    RETURN jsonb_build_object(
      'success', true,
      'newLessonsLeft', v_sub.lessons_left,
      'billingModel', v_sub.billing_model,
      'expiresAt', v_sub.expires_at
    );
  END IF;

  IF v_sub.billing_model = 'lesson_count' THEN
    IF v_old_status IN ('present', 'absent') THEN
      v_lesson_delta := 1;
    END IF;
    IF v_old_status = 'freeze' AND NOT v_in_freeze_period THEN
      v_freeze_delta := -1;
    END IF;

    IF p_new_status IN ('present', 'absent') THEN
      v_lesson_delta := v_lesson_delta - 1;
    END IF;
    IF p_new_status = 'freeze' AND NOT v_in_freeze_period THEN
      v_freeze_delta := v_freeze_delta + 1;
    END IF;

    IF v_old_status IN ('present', 'absent') AND p_new_status IN ('present', 'absent') THEN
      v_lesson_delta := 0;
    END IF;

    IF v_in_freeze_period AND p_new_status IN ('present', 'absent', 'freeze') THEN
      v_lesson_delta := 0;
      v_freeze_delta := 0;
    END IF;

    IF p_new_status = 'freeze' AND NOT v_in_freeze_period THEN
      IF v_sub.lessons_total < v_settings.freeze_min_lessons THEN
        RETURN jsonb_build_object(
          'success', false,
          'error',
          format('Заморозка только для абонементов от %s уроков', v_settings.freeze_min_lessons)
        );
      END IF;
      IF v_sub.freeze_used + v_freeze_delta > v_settings.freeze_max_count THEN
        RETURN jsonb_build_object('success', false, 'error', 'Лимит заморозок исчерпан');
      END IF;
    END IF;

    v_new_lessons_left := v_sub.lessons_left + v_lesson_delta;
    IF v_new_lessons_left < 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Недостаточно уроков');
    END IF;
    v_new_freeze_used := v_sub.freeze_used + v_freeze_delta;
  ELSE
    v_new_lessons_left := 0;
    v_new_freeze_used := v_sub.freeze_used;
  END IF;

  SELECT last_name, first_name INTO v_c1 FROM clients WHERE id = v_sub.client_id1;
  IF FOUND THEN
    v_display := v_c1.last_name || ' ' || v_c1.first_name;
  ELSE
    v_display := v_sub.client_id1::text;
  END IF;

  IF v_sub.client_id2 IS NOT NULL THEN
    SELECT last_name, first_name INTO v_c2 FROM clients WHERE id = v_sub.client_id2;
    IF FOUND THEN
      v_display := v_display || ' & ' || v_c2.last_name || ' ' || v_c2.first_name;
    END IF;
  END IF;

  IF v_sub.client_id3 IS NOT NULL THEN
    SELECT last_name, first_name INTO v_c3 FROM clients WHERE id = v_sub.client_id3;
    IF FOUND THEN
      v_display := v_display || ' & ' || v_c3.last_name || ' ' || v_c3.first_name;
    END IF;
  END IF;

  INSERT INTO attendance (
    organization_id,
    date,
    subscription_id,
    schedule_group_id,
    client_display,
    attendance_status,
    freeze_period_id
  )
  VALUES (
    v_org_id,
    p_date::date,
    v_sub_uuid,
    p_schedule_group_id,
    v_display,
    CASE
      WHEN v_in_freeze_period AND p_new_status IN ('present', 'absent') THEN p_new_status
      WHEN v_in_freeze_period THEN 'freeze'
      ELSE p_new_status
    END,
    CASE
      WHEN v_in_freeze_period THEN subscription_active_freeze_period_id(v_org_id, v_sub_uuid, p_date::date)
      ELSE NULL
    END
  )
  ON CONFLICT (organization_id, date, subscription_id, schedule_group_id)
  DO UPDATE SET
    attendance_status = EXCLUDED.attendance_status,
    client_display = EXCLUDED.client_display,
    freeze_period_id = COALESCE(EXCLUDED.freeze_period_id, attendance.freeze_period_id);

  IF v_sub.billing_model = 'lesson_count' THEN
    PERFORM set_config('app.allow_subscription_counter_update', 'true', true);

    UPDATE subscriptions
    SET
      lessons_left = v_new_lessons_left,
      freeze_used = v_new_freeze_used,
      status = CASE WHEN v_new_lessons_left = 0 THEN 'finished' ELSE status END
    WHERE id = v_sub_uuid
      AND organization_id = v_org_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'newLessonsLeft', v_new_lessons_left,
    'billingModel', v_sub.billing_model,
    'expiresAt', v_sub.expires_at
  );
END;
$$;

ALTER TABLE subscription_freeze_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY subscription_freeze_periods_select ON subscription_freeze_periods
  FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND is_active_member(auth.uid(), organization_id)
  );

CREATE POLICY subscription_freeze_periods_teacher_select ON subscription_freeze_periods
  FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND current_member_role() = 'teacher'
    AND teacher_can_access_subscription(subscription_id)
  );

GRANT SELECT ON subscription_freeze_periods TO authenticated;
GRANT SELECT, INSERT, UPDATE ON subscription_freeze_periods TO service_role;

REVOKE ALL ON FUNCTION apply_subscription_freeze_period(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_subscription_freeze_period(text, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION cancel_subscription_freeze_period(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_subscription_freeze_period(uuid) TO authenticated;

REVOKE ALL ON FUNCTION member_can_manage_subscription_freeze(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_manage_subscription_freeze(uuid) TO authenticated, service_role;

COMMIT;
