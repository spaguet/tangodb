-- Group capacity control and waitlist (CRM scenario 6 / Prompt 6)

BEGIN;

-- =============================================================================
-- 1. Schema
-- =============================================================================

ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS max_capacity INT
  CHECK (max_capacity IS NULL OR max_capacity > 0);

COMMENT ON COLUMN classes.max_capacity IS
  'Optional max participants for group subscriptions. NULL = unlimited.';

CREATE TABLE IF NOT EXISTS group_capacity_overrides (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  class_id            UUID NOT NULL,
  subscription_id     UUID NOT NULL,
  capacity_limit      INT NOT NULL,
  occupied_before     INT NOT NULL,
  seats_requested     INT NOT NULL,
  reason              TEXT NOT NULL CHECK (trim(reason) <> ''),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_member_id UUID,
  FOREIGN KEY (organization_id, class_id)
    REFERENCES classes (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, subscription_id)
    REFERENCES subscriptions (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, created_by_member_id)
    REFERENCES organization_members (organization_id, id)
);

CREATE INDEX IF NOT EXISTS idx_group_capacity_overrides_org_class
  ON group_capacity_overrides (organization_id, class_id, created_at DESC);

CREATE TABLE IF NOT EXISTS group_waitlist_entries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  class_id            UUID NOT NULL,
  client_id           UUID NOT NULL,
  status              TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'offered', 'enrolled', 'declined', 'cancelled')),
  comment             TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_member_id UUID,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_member_id UUID,
  FOREIGN KEY (organization_id, class_id)
    REFERENCES classes (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, client_id)
    REFERENCES clients (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, created_by_member_id)
    REFERENCES organization_members (organization_id, id),
  FOREIGN KEY (organization_id, updated_by_member_id)
    REFERENCES organization_members (organization_id, id)
);

CREATE INDEX IF NOT EXISTS idx_group_waitlist_org_class_status
  ON group_waitlist_entries (organization_id, class_id, status, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS group_waitlist_one_active_per_client
  ON group_waitlist_entries (organization_id, class_id, client_id)
  WHERE status IN ('waiting', 'offered');

CREATE TABLE IF NOT EXISTS group_waitlist_status_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  waitlist_entry_id   UUID NOT NULL REFERENCES group_waitlist_entries (id) ON DELETE CASCADE,
  from_status         TEXT,
  to_status           TEXT NOT NULL,
  comment             TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_member_id UUID,
  FOREIGN KEY (organization_id, created_by_member_id)
    REFERENCES organization_members (organization_id, id)
);

CREATE INDEX IF NOT EXISTS idx_group_waitlist_events_entry
  ON group_waitlist_status_events (waitlist_entry_id, created_at DESC);

CREATE TABLE IF NOT EXISTS group_spot_notifications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  class_id            UUID NOT NULL,
  waitlist_entry_id   UUID NOT NULL REFERENCES group_waitlist_entries (id) ON DELETE CASCADE,
  client_id           UUID NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  dismissed_at        TIMESTAMPTZ,
  dismissed_by_member_id UUID,
  FOREIGN KEY (organization_id, class_id)
    REFERENCES classes (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, client_id)
    REFERENCES clients (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, dismissed_by_member_id)
    REFERENCES organization_members (organization_id, id),
  UNIQUE (organization_id, waitlist_entry_id)
);

CREATE INDEX IF NOT EXISTS idx_group_spot_notifications_org_open
  ON group_spot_notifications (organization_id, created_at DESC)
  WHERE dismissed_at IS NULL;

-- =============================================================================
-- 2. Helpers — seat counting
-- =============================================================================

CREATE OR REPLACE FUNCTION subscription_client_id_array(
  p_client_id1 uuid,
  p_client_id2 uuid,
  p_client_id3 uuid,
  p_client_id4 uuid
)
RETURNS uuid[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    array_remove(
      ARRAY[p_client_id1, p_client_id2, p_client_id3, p_client_id4],
      NULL
    ),
    ARRAY[]::uuid[]
  );
$$;

CREATE OR REPLACE FUNCTION subscription_occupies_group_seat(
  p_sub subscriptions,
  p_as_of date DEFAULT CURRENT_DATE
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    p_sub.status = 'active'
    AND p_sub.category = 'group'
    AND p_sub.activation_date <= p_as_of
    AND (p_sub.expires_at IS NULL OR p_sub.expires_at >= p_as_of);
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
    SELECT unnest(
      subscription_client_id_array(
        s.client_id1,
        s.client_id2,
        s.client_id3,
        s.client_id4
      )
    ) AS client_id
    FROM subscriptions s
    INNER JOIN subscription_groups sg
      ON sg.organization_id = s.organization_id
     AND sg.subscription_id = s.id
     AND sg.schedule_group_id = p_class_id
    WHERE s.organization_id = p_org_id
      AND subscription_occupies_group_seat(s, p_as_of)
  ) occupied;
$$;

CREATE OR REPLACE FUNCTION member_can_sell_group_subscription(p_discipline_id uuid)
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

  IF v_role = 'accountant' THEN
    RETURN false;
  END IF;

  IF v_role = 'teacher' THEN
    RETURN teacher_can_write_subscriptions()
      AND teacher_has_discipline_access(p_discipline_id);
  END IF;

  IF v_role IN ('owner', 'director', 'admin') THEN
    RETURN can_write_all_business();
  END IF;

  RETURN can_write_reception();
END;
$$;

CREATE OR REPLACE FUNCTION member_can_override_group_capacity()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND auth_organization_id() IS NOT NULL
    AND organization_allows_writes(auth_organization_id())
    AND current_member_role() IN ('owner', 'director');
$$;

CREATE OR REPLACE FUNCTION member_can_manage_group_waitlist()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND auth_organization_id() IS NOT NULL
    AND organization_allows_writes(auth_organization_id())
    AND current_member_role() <> 'accountant'
    AND (
      current_member_role() IN ('owner', 'director', 'admin')
      OR can_write_reception()
      OR (current_member_role() = 'teacher' AND teacher_can_write_subscriptions())
    );
$$;

CREATE OR REPLACE FUNCTION member_can_update_class_capacity()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND auth_organization_id() IS NOT NULL
    AND organization_allows_writes(auth_organization_id())
    AND can_write_all_business();
$$;

-- =============================================================================
-- 3. Capacity snapshot RPC
-- =============================================================================

CREATE OR REPLACE FUNCTION get_groups_capacity_snapshot(p_class_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_result jsonb := '[]'::jsonb;
  v_class_id uuid;
  v_class classes%ROWTYPE;
  v_occupied int;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF p_class_ids IS NULL OR cardinality(p_class_ids) = 0 THEN
    RETURN jsonb_build_object('success', true, 'groups', '[]'::jsonb);
  END IF;

  FOREACH v_class_id IN ARRAY p_class_ids LOOP
    SELECT * INTO v_class
    FROM classes c
    WHERE c.id = v_class_id
      AND c.organization_id = v_org_id;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_occupied := count_group_occupied_seats(v_org_id, v_class_id, CURRENT_DATE);

    v_result := v_result || jsonb_build_array(
      jsonb_build_object(
        'class_id', v_class.id,
        'max_capacity', v_class.max_capacity,
        'occupied', v_occupied,
        'has_limit', v_class.max_capacity IS NOT NULL,
        'is_full', v_class.max_capacity IS NOT NULL AND v_occupied >= v_class.max_capacity
      )
    );
  END LOOP;

  RETURN jsonb_build_object('success', true, 'groups', v_result);
END;
$$;

-- =============================================================================
-- 4. Create group subscription with capacity check
-- =============================================================================

CREATE OR REPLACE FUNCTION create_group_subscription(
  p_type text,
  p_client_id1 uuid,
  p_client_id2 uuid,
  p_client_id3 uuid,
  p_client_id4 uuid,
  p_lessons_total int,
  p_activation_date date,
  p_pair_month text,
  p_discipline_id uuid,
  p_price_id uuid,
  p_billing_model text,
  p_schedule_group_ids uuid[],
  p_subscription_id uuid DEFAULT gen_random_uuid(),
  p_capacity_override_reason text DEFAULT NULL,
  p_expires_at date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_role text := current_member_role();
  v_class_id uuid;
  v_class classes%ROWTYPE;
  v_occupied int;
  v_new_clients uuid[];
  v_new_count int;
  v_sorted_ids uuid[];
  v_expires_at date := p_expires_at;
  v_is_monthly boolean := coalesce(p_billing_model, 'lesson_count') = 'monthly_unlimited';
  v_pair_month text := coalesce(nullif(trim(p_pair_month), ''), '');
  v_override_reason text := nullif(trim(coalesce(p_capacity_override_reason, '')), '');
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Организация в режиме только чтения');
  END IF;

  IF NOT member_can_sell_group_subscription(p_discipline_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав для продажи абонемента');
  END IF;

  IF p_client_id1 IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не указан клиент');
  END IF;

  IF p_schedule_group_ids IS NULL OR cardinality(p_schedule_group_ids) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не выбраны группы');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM clients c
    WHERE c.organization_id = v_org_id AND c.id = p_client_id1 AND c.deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Клиент не найден');
  END IF;

  IF p_client_id2 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM clients c
    WHERE c.organization_id = v_org_id AND c.id = p_client_id2 AND c.deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Второй клиент не найден');
  END IF;

  IF p_client_id3 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM clients c
    WHERE c.organization_id = v_org_id AND c.id = p_client_id3 AND c.deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Третий клиент не найден');
  END IF;

  IF p_client_id4 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM clients c
    WHERE c.organization_id = v_org_id AND c.id = p_client_id4 AND c.deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Четвёртый клиент не найден');
  END IF;

  v_new_clients := (
    SELECT array_agg(DISTINCT cid)
    FROM unnest(subscription_client_id_array(
      p_client_id1, p_client_id2, p_client_id3, p_client_id4
    )) AS cid
  );
  v_new_count := coalesce(cardinality(v_new_clients), 0);

  IF v_new_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не указаны участники абонемента');
  END IF;

  SELECT array_agg(DISTINCT gid ORDER BY gid)
  INTO v_sorted_ids
  FROM unnest(p_schedule_group_ids) AS gid;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_sorted_ids) AS gid
    LEFT JOIN classes c
      ON c.id = gid AND c.organization_id = v_org_id
    WHERE c.id IS NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Группа не найдена');
  END IF;

  -- Lock all affected groups in deterministic order
  PERFORM 1
  FROM classes c
  WHERE c.organization_id = v_org_id
    AND c.id = ANY (v_sorted_ids)
  ORDER BY c.id
  FOR UPDATE;

  FOREACH v_class_id IN ARRAY v_sorted_ids LOOP
    SELECT * INTO v_class
    FROM classes c
    WHERE c.organization_id = v_org_id
      AND c.id = v_class_id;

    IF v_class.max_capacity IS NULL THEN
      CONTINUE;
    END IF;

    v_occupied := count_group_occupied_seats(v_org_id, v_class_id, CURRENT_DATE);

    IF v_occupied + v_new_count > v_class.max_capacity THEN
      IF v_override_reason IS NULL THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'group_capacity_exceeded',
          'class_id', v_class_id,
          'max_capacity', v_class.max_capacity,
          'occupied', v_occupied,
          'requested', v_new_count
        );
      END IF;

      IF NOT member_can_override_group_capacity() THEN
        RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав для записи сверх лимита');
      END IF;
    END IF;
  END LOOP;

  IF v_is_monthly AND v_expires_at IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не указан срок действия абонемента');
  END IF;

  PERFORM set_config('row_security', 'off', true);

  INSERT INTO subscriptions (
    id,
    organization_id,
    type,
    client_id1,
    client_id2,
    client_id3,
    client_id4,
    lessons_total,
    lessons_left,
    freeze_used,
    activation_date,
    status,
    pair_month,
    discipline_id,
    price_id,
    category,
    billing_model,
    expires_at
  )
  VALUES (
    p_subscription_id,
    v_org_id,
    trim(p_type),
    p_client_id1,
    p_client_id2,
    p_client_id3,
    p_client_id4,
    CASE WHEN v_is_monthly THEN 0 ELSE p_lessons_total END,
    CASE WHEN v_is_monthly THEN 0 ELSE p_lessons_total END,
    0,
    p_activation_date,
    'active',
    v_pair_month,
    p_discipline_id,
    p_price_id,
    'group',
    coalesce(p_billing_model, 'lesson_count'),
    v_expires_at
  );

  INSERT INTO subscription_groups (organization_id, subscription_id, schedule_group_id)
  SELECT v_org_id, p_subscription_id, gid
  FROM unnest(v_sorted_ids) AS gid;

  FOREACH v_class_id IN ARRAY v_sorted_ids LOOP
    SELECT * INTO v_class
    FROM classes c
    WHERE c.organization_id = v_org_id
      AND c.id = v_class_id;

    IF v_class.max_capacity IS NULL THEN
      CONTINUE;
    END IF;

    v_occupied := count_group_occupied_seats(v_org_id, v_class_id, CURRENT_DATE);

    IF v_occupied > v_class.max_capacity AND v_override_reason IS NOT NULL THEN
      INSERT INTO group_capacity_overrides (
        organization_id,
        class_id,
        subscription_id,
        capacity_limit,
        occupied_before,
        seats_requested,
        reason,
        created_by_member_id
      )
      VALUES (
        v_org_id,
        v_class_id,
        p_subscription_id,
        v_class.max_capacity,
        v_occupied - v_new_count,
        v_new_count,
        v_override_reason,
        v_member_id
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'id', p_subscription_id);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', true, 'id', p_subscription_id, 'duplicate', true);
END;
$$;

-- =============================================================================
-- 5. Update class capacity
-- =============================================================================

CREATE OR REPLACE FUNCTION update_class_max_capacity(
  p_class_id uuid,
  p_max_capacity int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT member_can_update_class_capacity() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  IF p_max_capacity IS NOT NULL AND p_max_capacity <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Вместимость должна быть положительным числом');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM classes c
    WHERE c.id = p_class_id AND c.organization_id = v_org_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Группа не найдена');
  END IF;

  UPDATE classes
  SET max_capacity = p_max_capacity
  WHERE id = p_class_id
    AND organization_id = v_org_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- =============================================================================
-- 6. Waitlist RPCs
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

  IF NOT EXISTS (
    SELECT 1 FROM classes c
    WHERE c.id = p_class_id AND c.organization_id = v_org_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Группа не найдена');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM clients c
    WHERE c.id = p_client_id AND c.organization_id = v_org_id AND c.deleted_at IS NULL
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

-- =============================================================================
-- 7. Spot availability notifications
-- =============================================================================

CREATE OR REPLACE FUNCTION notify_group_spot_available(p_class_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_class classes%ROWTYPE;
  v_entry group_waitlist_entries%ROWTYPE;
  v_occupied int;
BEGIN
  SELECT * INTO v_class FROM classes c WHERE c.id = p_class_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_org_id := v_class.organization_id;

  IF v_class.max_capacity IS NULL THEN
    RETURN;
  END IF;

  v_occupied := count_group_occupied_seats(v_org_id, p_class_id, CURRENT_DATE);
  IF v_occupied >= v_class.max_capacity THEN
    RETURN;
  END IF;

  SELECT * INTO v_entry
  FROM group_waitlist_entries gwe
  WHERE gwe.organization_id = v_org_id
    AND gwe.class_id = p_class_id
    AND gwe.status = 'waiting'
  ORDER BY gwe.created_at ASC, gwe.id ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO group_spot_notifications (
    organization_id,
    class_id,
    waitlist_entry_id,
    client_id
  )
  VALUES (
    v_org_id,
    p_class_id,
    v_entry.id,
    v_entry.client_id
  )
  ON CONFLICT (organization_id, waitlist_entry_id) DO NOTHING;
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
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT member_can_manage_group_waitlist() THEN
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

CREATE OR REPLACE FUNCTION notify_groups_after_subscription_release(p_subscription_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class_id uuid;
BEGIN
  FOR v_class_id IN
    SELECT DISTINCT sg.schedule_group_id
    FROM subscription_groups sg
    WHERE sg.subscription_id = p_subscription_id
  LOOP
    PERFORM notify_group_spot_available(v_class_id);
  END LOOP;
END;
$$;

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

  PERFORM notify_groups_after_subscription_release(v_sub_uuid);

  RETURN jsonb_build_object('success', true);
END;
$$;

-- =============================================================================
-- 8. RLS
-- =============================================================================

ALTER TABLE group_capacity_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_waitlist_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_waitlist_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_spot_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY group_capacity_overrides_select
  ON group_capacity_overrides FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_all_business()
  );

CREATE POLICY group_waitlist_entries_select
  ON group_waitlist_entries FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND (
      can_read_all_business()
      OR can_write_reception()
      OR (current_member_role() = 'teacher' AND teacher_can_write_subscriptions())
    )
  );

CREATE POLICY group_waitlist_entries_write
  ON group_waitlist_entries FOR ALL TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND member_can_manage_group_waitlist()
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND member_can_manage_group_waitlist()
  );

CREATE POLICY group_waitlist_status_events_select
  ON group_waitlist_status_events FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND (
      can_read_all_business()
      OR can_write_reception()
      OR (current_member_role() = 'teacher' AND teacher_can_write_subscriptions())
    )
  );

CREATE POLICY group_spot_notifications_select
  ON group_spot_notifications FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND member_can_manage_group_waitlist()
  );

CREATE POLICY group_spot_notifications_update
  ON group_spot_notifications FOR UPDATE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND member_can_manage_group_waitlist()
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND member_can_manage_group_waitlist()
  );

GRANT SELECT ON group_capacity_overrides TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON group_waitlist_entries TO authenticated;
GRANT SELECT ON group_waitlist_status_events TO authenticated;
GRANT SELECT, UPDATE ON group_spot_notifications TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON group_capacity_overrides TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON group_waitlist_entries TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON group_waitlist_status_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON group_spot_notifications TO service_role;

REVOKE ALL ON FUNCTION subscription_client_id_array(uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION subscription_client_id_array(uuid, uuid, uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION subscription_occupies_group_seat(subscriptions, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION subscription_occupies_group_seat(subscriptions, date) TO authenticated, service_role;

REVOKE ALL ON FUNCTION count_group_occupied_seats(uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION count_group_occupied_seats(uuid, uuid, date) TO authenticated, service_role;

REVOKE ALL ON FUNCTION member_can_sell_group_subscription(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_sell_group_subscription(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION member_can_override_group_capacity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_override_group_capacity() TO authenticated, service_role;

REVOKE ALL ON FUNCTION member_can_manage_group_waitlist() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_manage_group_waitlist() TO authenticated, service_role;

REVOKE ALL ON FUNCTION member_can_update_class_capacity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_update_class_capacity() TO authenticated, service_role;

REVOKE ALL ON FUNCTION get_groups_capacity_snapshot(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_groups_capacity_snapshot(uuid[]) TO authenticated;

REVOKE ALL ON FUNCTION create_group_subscription(text, uuid, uuid, uuid, uuid, int, date, text, uuid, uuid, text, uuid[], uuid, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_group_subscription(text, uuid, uuid, uuid, uuid, int, date, text, uuid, uuid, text, uuid[], uuid, text, date) TO authenticated;

REVOKE ALL ON FUNCTION update_class_max_capacity(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_class_max_capacity(uuid, int) TO authenticated;

REVOKE ALL ON FUNCTION add_group_waitlist_entry(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION add_group_waitlist_entry(uuid, uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION update_group_waitlist_status(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_group_waitlist_status(uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION dismiss_group_spot_notification(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dismiss_group_spot_notification(uuid) TO authenticated;

COMMIT;
