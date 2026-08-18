-- clients soft-delete column is archived_at, not deleted_at

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
    WHERE c.organization_id = v_org_id AND c.id = p_client_id1 AND c.archived_at IS NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Клиент не найден');
  END IF;

  IF p_client_id2 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM clients c
    WHERE c.organization_id = v_org_id AND c.id = p_client_id2 AND c.archived_at IS NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Второй клиент не найден');
  END IF;

  IF p_client_id3 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM clients c
    WHERE c.organization_id = v_org_id AND c.id = p_client_id3 AND c.archived_at IS NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Третий клиент не найден');
  END IF;

  IF p_client_id4 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM clients c
    WHERE c.organization_id = v_org_id AND c.id = p_client_id4 AND c.archived_at IS NULL
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
