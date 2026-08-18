-- Subscription partner replacement (CRM scenario 7 / Prompt 7)

BEGIN;

CREATE TABLE IF NOT EXISTS subscription_member_changes (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  subscription_id         UUID NOT NULL,
  member_slot             SMALLINT NOT NULL CHECK (member_slot BETWEEN 1 AND 4),
  outgoing_client_id      UUID NOT NULL,
  incoming_client_id      UUID NOT NULL,
  effective_date          DATE NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'applied'
    CHECK (status IN ('scheduled', 'applied', 'cancelled')),
  reason                  TEXT,
  idempotency_key         UUID,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_member_id    UUID,
  applied_at              TIMESTAMPTZ,
  CHECK (outgoing_client_id <> incoming_client_id),
  FOREIGN KEY (organization_id, subscription_id)
    REFERENCES subscriptions (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, outgoing_client_id)
    REFERENCES clients (organization_id, id),
  FOREIGN KEY (organization_id, incoming_client_id)
    REFERENCES clients (organization_id, id),
  FOREIGN KEY (organization_id, created_by_member_id)
    REFERENCES organization_members (organization_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_member_changes_idempotency
  ON subscription_member_changes (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscription_member_changes_org_sub
  ON subscription_member_changes (organization_id, subscription_id, effective_date DESC, created_at DESC);

CREATE OR REPLACE FUNCTION subscription_member_slot_client_id(
  p_sub subscriptions,
  p_slot smallint
)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_slot
    WHEN 1 THEN p_sub.client_id1
    WHEN 2 THEN p_sub.client_id2
    WHEN 3 THEN p_sub.client_id3
    WHEN 4 THEN p_sub.client_id4
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION subscription_set_member_slot_client_id(
  p_sub subscriptions,
  p_slot smallint,
  p_client_id uuid
)
RETURNS subscriptions
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  CASE p_slot
    WHEN 1 THEN p_sub.client_id1 := p_client_id;
    WHEN 2 THEN p_sub.client_id2 := p_client_id;
    WHEN 3 THEN p_sub.client_id3 := p_client_id;
    WHEN 4 THEN p_sub.client_id4 := p_client_id;
    ELSE NULL;
  END CASE;
  RETURN p_sub;
END;
$$;

CREATE OR REPLACE FUNCTION subscription_client_ids_at_date(
  p_sub_id uuid,
  p_as_of date
)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub subscriptions%ROWTYPE;
  v_change RECORD;
  v_ids uuid[];
  v_slot smallint;
BEGIN
  SELECT * INTO v_sub
  FROM subscriptions
  WHERE id = p_sub_id;

  IF NOT FOUND THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  v_ids := subscription_client_id_array(
    v_sub.client_id1,
    v_sub.client_id2,
    v_sub.client_id3,
    v_sub.client_id4
  );

  FOR v_change IN
    SELECT smc.member_slot, smc.outgoing_client_id, smc.incoming_client_id
    FROM subscription_member_changes smc
    WHERE smc.subscription_id = p_sub_id
      AND smc.organization_id = v_sub.organization_id
      AND smc.status = 'applied'
      AND smc.effective_date > p_as_of
    ORDER BY smc.effective_date DESC, smc.created_at DESC, smc.id DESC
  LOOP
    v_slot := v_change.member_slot;
    IF v_slot = 1 THEN
      IF v_sub.client_id1 = v_change.incoming_client_id THEN
        v_sub.client_id1 := v_change.outgoing_client_id;
      END IF;
    ELSIF v_slot = 2 THEN
      IF v_sub.client_id2 = v_change.incoming_client_id THEN
        v_sub.client_id2 := v_change.outgoing_client_id;
      END IF;
    ELSIF v_slot = 3 THEN
      IF v_sub.client_id3 = v_change.incoming_client_id THEN
        v_sub.client_id3 := v_change.outgoing_client_id;
      END IF;
    ELSIF v_slot = 4 THEN
      IF v_sub.client_id4 = v_change.incoming_client_id THEN
        v_sub.client_id4 := v_change.outgoing_client_id;
      END IF;
    END IF;
  END LOOP;

  RETURN subscription_client_id_array(
    v_sub.client_id1,
    v_sub.client_id2,
    v_sub.client_id3,
    v_sub.client_id4
  );
END;
$$;

CREATE OR REPLACE FUNCTION subscription_client_display_for_date(
  p_sub_id uuid,
  p_as_of date
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_client_id uuid;
  v_display text := '';
  v_name text;
BEGIN
  SELECT organization_id INTO v_org_id FROM subscriptions WHERE id = p_sub_id;
  IF NOT FOUND THEN
    RETURN '';
  END IF;

  FOR v_client_id IN
    SELECT unnest(subscription_client_ids_at_date(p_sub_id, p_as_of))
  LOOP
    SELECT TRIM(c.last_name || ' ' || c.first_name)
    INTO v_name
    FROM clients c
    WHERE c.id = v_client_id
      AND c.organization_id = v_org_id;

    IF v_name IS NULL OR v_name = '' THEN
      v_name := v_client_id::text;
    END IF;

    IF v_display = '' THEN
      v_display := v_name;
    ELSE
      v_display := v_display || ' & ' || v_name;
    END IF;
  END LOOP;

  RETURN v_display;
END;
$$;

CREATE OR REPLACE FUNCTION apply_scheduled_subscription_member_changes(
  p_org_id uuid DEFAULT auth_organization_id()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_change RECORD;
  v_today date := CURRENT_DATE;
BEGIN
  IF p_org_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_change IN
    SELECT smc.*
    FROM subscription_member_changes smc
    INNER JOIN subscriptions s
      ON s.id = smc.subscription_id
     AND s.organization_id = smc.organization_id
    WHERE smc.organization_id = p_org_id
      AND smc.status = 'scheduled'
      AND smc.effective_date <= v_today
    ORDER BY smc.effective_date ASC, smc.created_at ASC, smc.id ASC
    FOR UPDATE OF smc, s
  LOOP
    IF v_change.member_slot = 1 THEN
      UPDATE subscriptions
      SET client_id1 = v_change.incoming_client_id
      WHERE id = v_change.subscription_id
        AND organization_id = p_org_id
        AND client_id1 = v_change.outgoing_client_id;
    ELSIF v_change.member_slot = 2 THEN
      UPDATE subscriptions
      SET client_id2 = v_change.incoming_client_id
      WHERE id = v_change.subscription_id
        AND organization_id = p_org_id
        AND client_id2 = v_change.outgoing_client_id;
    ELSIF v_change.member_slot = 3 THEN
      UPDATE subscriptions
      SET client_id3 = v_change.incoming_client_id
      WHERE id = v_change.subscription_id
        AND organization_id = p_org_id
        AND client_id3 = v_change.outgoing_client_id;
    ELSIF v_change.member_slot = 4 THEN
      UPDATE subscriptions
      SET client_id4 = v_change.incoming_client_id
      WHERE id = v_change.subscription_id
        AND organization_id = p_org_id
        AND client_id4 = v_change.outgoing_client_id;
    END IF;

    UPDATE subscription_member_changes
    SET status = 'applied', applied_at = now()
    WHERE id = v_change.id;

    UPDATE attendance a
    SET client_display = subscription_client_display_for_date(v_change.subscription_id, a.date)
    WHERE a.organization_id = p_org_id
      AND a.subscription_id = v_change.subscription_id
      AND a.date >= v_change.effective_date;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION member_can_replace_subscription_partner(p_sub_id uuid)
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

  IF v_role = 'teacher' THEN
    RETURN teacher_can_write_subscriptions()
      AND teacher_can_access_subscription(p_sub_id);
  END IF;

  IF v_role IN ('owner', 'director', 'admin') THEN
    IF v_role = 'admin' AND is_restricted_admin() THEN
      RETURN false;
    END IF;
    RETURN true;
  END IF;

  RETURN can_write_reception();
END;
$$;

CREATE OR REPLACE FUNCTION replace_subscription_partner(
  p_sub_id text,
  p_outgoing_client_id uuid,
  p_incoming_client_id uuid,
  p_effective_date date,
  p_reason text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_sub_uuid uuid;
  v_sub subscriptions%ROWTYPE;
  v_slot smallint;
  v_today date := CURRENT_DATE;
  v_existing subscription_member_changes%ROWTYPE;
  v_status text;
  v_last_attendance date;
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

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM subscription_member_changes
    WHERE organization_id = v_org_id
      AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
      IF v_existing.subscription_id = v_sub_uuid
         AND v_existing.outgoing_client_id = p_outgoing_client_id
         AND v_existing.incoming_client_id = p_incoming_client_id
         AND v_existing.effective_date = p_effective_date THEN
        RETURN jsonb_build_object(
          'success', true,
          'changeId', v_existing.id,
          'status', v_existing.status,
          'idempotent', true
        );
      END IF;
      RETURN jsonb_build_object('success', false, 'error', 'Ключ идемпотентности уже использован');
    END IF;
  END IF;

  SELECT * INTO v_sub
  FROM subscriptions
  WHERE id = v_sub_uuid
    AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Абонемент не найден');
  END IF;

  IF NOT member_can_replace_subscription_partner(v_sub_uuid) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  IF v_sub.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Абонемент не активен');
  END IF;

  IF v_sub.type NOT IN ('pair', 'pair_hm') OR v_sub.category <> 'group' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Замена партнёра доступна только для парных групповых абонементов');
  END IF;

  IF p_effective_date < v_sub.activation_date THEN
    RETURN jsonb_build_object('success', false, 'error', 'Дата замены не может быть раньше активации абонемента');
  END IF;

  IF p_outgoing_client_id = p_incoming_client_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Новый партнёр должен отличаться от выбывающего');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM clients c
    WHERE c.id = p_incoming_client_id
      AND c.organization_id = v_org_id
      AND c.archived_at IS NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Новый клиент не найден или неактивен');
  END IF;

  v_slot := CASE
    WHEN v_sub.client_id1 = p_outgoing_client_id THEN 1
    WHEN v_sub.client_id2 = p_outgoing_client_id THEN 2
    WHEN v_sub.client_id3 = p_outgoing_client_id THEN 3
    WHEN v_sub.client_id4 = p_outgoing_client_id THEN 4
    ELSE NULL
  END;

  IF v_slot IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Выбывающий клиент не входит в текущий состав абонемента');
  END IF;

  IF p_incoming_client_id = ANY(subscription_client_id_array(
    v_sub.client_id1, v_sub.client_id2, v_sub.client_id3, v_sub.client_id4
  )) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Новый клиент уже участвует в этом абонементе');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM subscription_member_changes smc
    WHERE smc.organization_id = v_org_id
      AND smc.subscription_id = v_sub_uuid
      AND smc.status IN ('scheduled', 'applied')
      AND smc.member_slot = v_slot
      AND smc.effective_date >= p_effective_date
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Для этого места уже запланирована замена');
  END IF;

  SELECT MAX(a.date) INTO v_last_attendance
  FROM attendance a
  WHERE a.organization_id = v_org_id
    AND a.subscription_id = v_sub_uuid
    AND a.attendance_status IN ('present', 'absent', 'freeze', 'excused');

  IF v_last_attendance IS NOT NULL AND p_effective_date < v_last_attendance THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Дата замены не может быть раньше последней отметки посещаемости'
    );
  END IF;

  v_status := CASE WHEN p_effective_date > v_today THEN 'scheduled' ELSE 'applied' END;

  INSERT INTO subscription_member_changes (
    organization_id,
    subscription_id,
    member_slot,
    outgoing_client_id,
    incoming_client_id,
    effective_date,
    status,
    reason,
    idempotency_key,
    created_by_member_id,
    applied_at
  )
  VALUES (
    v_org_id,
    v_sub_uuid,
    v_slot,
    p_outgoing_client_id,
    p_incoming_client_id,
    p_effective_date,
    v_status,
    NULLIF(TRIM(COALESCE(p_reason, '')), ''),
    p_idempotency_key,
    v_member_id,
    CASE WHEN v_status = 'applied' THEN now() ELSE NULL END
  );

  IF v_status = 'applied' THEN
    IF v_slot = 1 THEN
      UPDATE subscriptions SET client_id1 = p_incoming_client_id
      WHERE id = v_sub_uuid AND organization_id = v_org_id;
    ELSIF v_slot = 2 THEN
      UPDATE subscriptions SET client_id2 = p_incoming_client_id
      WHERE id = v_sub_uuid AND organization_id = v_org_id;
    ELSIF v_slot = 3 THEN
      UPDATE subscriptions SET client_id3 = p_incoming_client_id
      WHERE id = v_sub_uuid AND organization_id = v_org_id;
    ELSIF v_slot = 4 THEN
      UPDATE subscriptions SET client_id4 = p_incoming_client_id
      WHERE id = v_sub_uuid AND organization_id = v_org_id;
    END IF;

    UPDATE attendance a
    SET client_display = subscription_client_display_for_date(v_sub_uuid, a.date)
    WHERE a.organization_id = v_org_id
      AND a.subscription_id = v_sub_uuid
      AND a.date >= p_effective_date;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'changeId', (
      SELECT id FROM subscription_member_changes
      WHERE organization_id = v_org_id
        AND subscription_id = v_sub_uuid
        AND outgoing_client_id = p_outgoing_client_id
        AND incoming_client_id = p_incoming_client_id
        AND effective_date = p_effective_date
      ORDER BY created_at DESC
      LIMIT 1
    ),
    'status', v_status
  );
END;
$$;

CREATE OR REPLACE FUNCTION count_group_occupied_seats(
  p_org_id uuid,
  p_class_id uuid,
  p_as_of date DEFAULT CURRENT_DATE
)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(count(DISTINCT client_id)::int, 0)
  FROM (
    SELECT unnest(subscription_client_ids_at_date(s.id, p_as_of)) AS client_id
    FROM subscriptions s
    INNER JOIN subscription_groups sg
      ON sg.organization_id = s.organization_id
     AND sg.subscription_id = s.id
     AND sg.schedule_group_id = p_class_id
    WHERE s.organization_id = p_org_id
      AND subscription_occupies_group_seat(s, p_as_of)
  ) occupied;
$$;

ALTER TABLE subscription_member_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY subscription_member_changes_select ON subscription_member_changes
  FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND is_active_member(auth.uid(), organization_id)
  );

CREATE POLICY subscription_member_changes_teacher_select ON subscription_member_changes
  FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND current_member_role() = 'teacher'
    AND teacher_can_access_subscription(subscription_id)
  );

GRANT SELECT ON subscription_member_changes TO authenticated;
GRANT SELECT, INSERT, UPDATE ON subscription_member_changes TO service_role;

REVOKE ALL ON FUNCTION subscription_client_ids_at_date(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION subscription_client_ids_at_date(uuid, date) TO authenticated, service_role;

REVOKE ALL ON FUNCTION subscription_client_display_for_date(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION subscription_client_display_for_date(uuid, date) TO authenticated, service_role;

REVOKE ALL ON FUNCTION apply_scheduled_subscription_member_changes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_scheduled_subscription_member_changes(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION member_can_replace_subscription_partner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_replace_subscription_partner(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION replace_subscription_partner(text, uuid, uuid, date, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION replace_subscription_partner(text, uuid, uuid, date, text, uuid) TO authenticated;

-- mark_attendance v5 — apply scheduled partner changes + effective client display
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
  v_today date := current_date;
  v_sub_uuid uuid;
  v_in_freeze_period boolean;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  PERFORM apply_scheduled_subscription_member_changes(v_org_id);
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

  v_display := subscription_client_display_for_date(v_sub_uuid, p_date::date);

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

COMMIT;
