-- E3 / 2.12.4: edition_allows on write-RPCs (§18.9), venue-ack skip (F95), GCal enqueue no-op (F96).
-- Built by scripts/build-editions-e3-rpc-gates.mjs

BEGIN;

CREATE OR REPLACE FUNCTION _edition_require_capability(p_org_id uuid, p_capability text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(p_org_id, p_capability) THEN
    PERFORM _edition_raise('edition_forbidden');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION _edition_require_capability(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _edition_require_capability(uuid, text) TO service_role;


-- create_group_subscription from 20260877000001_fix_clients_archived_at_in_rpcs.sql
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
  p_expires_at date DEFAULT NULL,
  p_category text DEFAULT 'group'
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
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'group_subscriptions') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

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

  IF coalesce(nullif(trim(p_category), ''), 'group') NOT IN ('group', 'private') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недопустимая категория абонемента');
  END IF;

  IF (p_schedule_group_ids IS NULL OR cardinality(p_schedule_group_ids) = 0)
    AND coalesce(nullif(trim(p_category), ''), 'group') <> 'private'
  THEN
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
  FROM unnest(coalesce(p_schedule_group_ids, '{}'::uuid[])) AS gid;

  IF coalesce(cardinality(v_sorted_ids), 0) > 0 AND EXISTS (
    SELECT 1
    FROM unnest(v_sorted_ids) AS gid
    LEFT JOIN classes c
      ON c.id = gid AND c.organization_id = v_org_id
    WHERE c.id IS NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Группа не найдена');
  END IF;

  IF coalesce(cardinality(v_sorted_ids), 0) > 0 THEN
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
  END IF;

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
    coalesce(nullif(trim(p_category), ''), 'group'),
    coalesce(p_billing_model, 'lesson_count'),
    v_expires_at
  );

  IF coalesce(cardinality(v_sorted_ids), 0) > 0 THEN
    INSERT INTO subscription_groups (organization_id, subscription_id, schedule_group_id)
    SELECT v_org_id, p_subscription_id, gid
    FROM unnest(v_sorted_ids) AS gid;
  END IF;

  IF coalesce(cardinality(v_sorted_ids), 0) > 0 THEN
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
  END IF;

  RETURN jsonb_build_object('success', true, 'id', p_subscription_id);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', true, 'id', p_subscription_id, 'duplicate', true);
END;
$$;


-- create_renter from 20260843000001_hall_rentals.sql
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
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'hall_rent') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

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


-- create_rental from 20261125000001_staff_cashier_rental_wallet_hold.sql
CREATE OR REPLACE FUNCTION create_rental(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_result jsonb;
  v_rental_id uuid;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'hall_rent') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  IF _rental_payload_is_miniapp_channel(p_payload) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.miniappChannelForbidden');
  END IF;

  v_result := _cashier_create_rental(p_payload);
  IF COALESCE((v_result ->> 'success')::boolean, false)
     AND member_can_manage_rentals() THEN
    v_rental_id := NULLIF(v_result ->> 'rental_id', '')::uuid;
    IF v_rental_id IS NOT NULL THEN
      PERFORM _renter_attach_wallet_to_staff_cashier_rental(v_rental_id);
    END IF;
  END IF;

  RETURN v_result;
END;
$$;


-- create_rental_series from 20261125000001_staff_cashier_rental_wallet_hold.sql
CREATE OR REPLACE FUNCTION create_rental_series(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_key text := NULLIF(trim(p_payload ->> 'idempotency_key'), '');
  v_existing rental_series%ROWTYPE;
  v_series_id uuid;
  v_renter_id uuid := (p_payload ->> 'renter_id')::uuid;
  v_contract_id uuid := NULLIF(p_payload ->> 'contract_id', '')::uuid;
  v_location_id uuid := (p_payload ->> 'location_id')::uuid;
  v_tariff_id uuid := (p_payload ->> 'tariff_id')::uuid;
  v_valid_from date := (p_payload ->> 'valid_from')::date;
  v_valid_to date := (p_payload ->> 'valid_to')::date;
  v_patterns jsonb := COALESCE(p_payload -> 'patterns', '[]'::jsonb);
  v_pattern jsonb;
  v_preview jsonb;
  v_occ jsonb;
  v_item jsonb;
  v_rental_id uuid;
  v_pricing jsonb;
  v_created_ids uuid[] := '{}';
  v_tariff_type text;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'hall_rent') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT member_can_manage_rentals() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
  END IF;

  IF _rental_payload_is_miniapp_channel(p_payload) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.miniappChannelForbidden');
  END IF;

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM rental_series rs
    WHERE rs.organization_id = v_org_id AND rs.idempotency_key = v_key;

    IF FOUND THEN
      SELECT COALESCE(array_agg(r.id), '{}')
      INTO v_created_ids
      FROM rentals r
      WHERE r.rental_series_id = v_existing.id AND r.organization_id = v_org_id;

      PERFORM _renter_attach_wallet_to_staff_cashier_rentals(v_created_ids);

      RETURN jsonb_build_object(
        'success', true,
        'series_id', v_existing.id,
        'rental_ids', to_jsonb(v_created_ids),
        'already_applied', true
      );
    END IF;
  END IF;

  v_preview := preview_rental_series(p_payload);
  IF NOT COALESCE((v_preview ->> 'success')::boolean, false) THEN
    RETURN v_preview;
  END IF;

  IF COALESCE((v_preview ->> 'has_conflicts')::boolean, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.conflict', 'preview', v_preview);
  END IF;

  IF jsonb_array_length(COALESCE(v_preview -> 'occurrences', '[]'::jsonb)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.series.noOccurrences');
  END IF;

  INSERT INTO rental_series (
    organization_id, renter_id, contract_id, location_id, tariff_id,
    valid_from, valid_to, status, purpose, idempotency_key, created_by
  )
  VALUES (
    v_org_id,
    v_renter_id,
    v_contract_id,
    v_location_id,
    v_tariff_id,
    v_valid_from,
    v_valid_to,
    'active',
    NULLIF(trim(p_payload ->> 'purpose'), ''),
    v_key,
    v_member_id
  )
  RETURNING id INTO v_series_id;

  FOR v_pattern IN SELECT value FROM jsonb_array_elements(v_patterns) LOOP
    INSERT INTO rental_series_patterns (organization_id, series_id, days_of_week, time_start, time_end)
    VALUES (
      v_org_id,
      v_series_id,
      ARRAY(SELECT value::int FROM jsonb_array_elements_text(v_pattern -> 'days_of_week') AS t(value)),
      normalize_hhmm(v_pattern ->> 'time_start'),
      normalize_hhmm(v_pattern ->> 'time_end')
    );
  END LOOP;

  v_occ := v_preview -> 'occurrences';

  PERFORM _rental_acquire_location_date_locks(
    v_org_id,
    (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'location_id', v_location_id,
          'date', e.value ->> 'occurrence_date'
        )
      ), '[]'::jsonb)
      FROM jsonb_array_elements(v_occ) AS e(value)
    )
  );

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_occ) LOOP
    IF schedule_location_has_conflict(
      v_org_id,
      (v_item ->> 'occurrence_date')::date,
      v_item ->> 'time_start',
      v_item ->> 'time_end',
      v_location_id
    ) THEN
      RAISE EXCEPTION 'schedule.rental.conflict' USING ERRCODE = 'P0001';
    END IF;

    v_pricing := _calculate_rental_pricing(
      v_tariff_id,
      v_org_id,
      (v_item ->> 'occurrence_date')::date,
      v_item ->> 'time_start',
      v_item ->> 'time_end'
    );

    v_tariff_type := v_pricing ->> 'tariff_type';

    INSERT INTO rentals (
      organization_id, location_id, rental_date, time_start, time_end,
      renter_id, purpose, rental_series_id, tariff_id, tariff_type,
      tariff_snapshot, pricing_breakdown, calculated_amount, adjustment_amount,
      final_amount, fixed_amount, currency, created_by
    )
    VALUES (
      v_org_id,
      v_location_id,
      (v_item ->> 'occurrence_date')::date,
      v_item ->> 'time_start',
      v_item ->> 'time_end',
      v_renter_id,
      NULLIF(trim(p_payload ->> 'purpose'), ''),
      v_series_id,
      v_tariff_id,
      v_tariff_type,
      v_pricing -> 'tariff_snapshot',
      v_pricing -> 'breakdown',
      (v_pricing ->> 'calculated_amount')::numeric,
      0,
      (v_pricing ->> 'calculated_amount')::numeric,
      (v_pricing ->> 'calculated_amount')::numeric,
      v_pricing ->> 'currency',
      v_member_id
    )
    RETURNING id INTO v_rental_id;

    v_created_ids := v_created_ids || v_rental_id;
  END LOOP;

  PERFORM _renter_attach_wallet_to_staff_cashier_rentals(v_created_ids);

  RETURN jsonb_build_object(
    'success', true,
    'series_id', v_series_id,
    'rental_ids', to_jsonb(v_created_ids),
    'occurrence_count', array_length(v_created_ids, 1)
  );
EXCEPTION
  WHEN unique_violation THEN
    IF v_key IS NOT NULL THEN
      SELECT id INTO v_series_id FROM rental_series WHERE organization_id = v_org_id AND idempotency_key = v_key;
      IF v_series_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'series_id', v_series_id, 'already_applied', true);
      END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.duplicate');
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


-- record_subscription_payment from 20261013000001_s11_finance_period_main_cash.sql
CREATE OR REPLACE FUNCTION record_subscription_payment(
  p_subscription_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_method_comment text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,
  p_venue_rule_acknowledged boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_status jsonb;
  v_result jsonb;
  v_cached jsonb;
  v_existing_payment_id uuid;
  v_fingerprint text := md5(concat_ws('|', p_subscription_id, p_amount, p_method, p_method_comment, p_venue_rule_acknowledged));
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'group_subscriptions') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  v_cached := check_operation_idempotency(v_org_id, 'record_subscription_payment', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN
    IF v_cached ->> 'error_code' = 'idempotency_conflict'
      AND NOT COALESCE(p_venue_rule_acknowledged, false)
    THEN
      v_cached := check_operation_idempotency(
        v_org_id,
        'record_subscription_payment',
        p_idempotency_key,
        md5(
          coalesce(p_subscription_id::text, '') || '|' ||
          coalesce(p_amount::text, '') || '|' ||
          coalesce(p_method, '') || '|' ||
          coalesce(p_method_comment, '')
        )
      );
    END IF;
    IF v_cached ->> 'error_code' = 'idempotency_conflict' THEN RETURN v_cached; END IF;
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF _is_finance_period_closed(v_org_id, _org_local_date(v_org_id)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.periodClosed');
  END IF;

  IF editions_lifecycle_enabled() AND edition_allows(v_org_id, 'hall_rent') THEN
    v_status := venue_cost_status_for_org(v_org_id, current_date);
    IF COALESCE((v_status ->> 'acknowledgement_required')::boolean, false)
      AND NOT COALESCE(p_venue_rule_acknowledged, false)
    THEN
      RETURN jsonb_build_object(
        'success', false, 'error_code', 'venue_rule_ack_required',
        'error', 'venue_rule_ack_required', 'venue_rule_status', v_status
      );
    END IF;
  END IF;
  SELECT p.id INTO v_existing_payment_id
  FROM payments p
  WHERE p.organization_id = v_org_id
    AND p.subscription_id = p_subscription_id
    AND p.personal_lesson_id IS NULL
    AND p.single_visit_id IS NULL
    AND p.operation_kind = 'payment'
  LIMIT 1;
  v_result := _record_subscription_payment_before_venue_rules(
    p_subscription_id, p_amount, p_method, p_method_comment, p_idempotency_key
  );
  IF COALESCE((v_result ->> 'success')::boolean, false) THEN
    IF v_existing_payment_id IS NULL
      AND NOT COALESCE((v_result ->> 'already_applied')::boolean, false)
      AND editions_lifecycle_enabled()
      AND edition_allows(v_org_id, 'hall_rent')
    THEN
      PERFORM store_venue_payment_ack_if_required(
        v_status, (v_result ->> 'payment_id')::uuid, 'record_subscription_payment', p_idempotency_key
      );
    END IF;
    PERFORM store_operation_idempotency(v_org_id, 'record_subscription_payment', p_idempotency_key, v_fingerprint, v_result);
  END IF;
  RETURN v_result;
END;
$$;


-- record_personal_lesson_payment from 20261050000004_venue_cost_payment_grace_period.sql
CREATE OR REPLACE FUNCTION record_personal_lesson_payment(
  p_lesson_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_idempotency_key uuid DEFAULT NULL,
  p_venue_rule_acknowledged boolean DEFAULT false,
  p_price_id uuid DEFAULT NULL,
  p_tariff_units numeric DEFAULT NULL,
  p_tariff_duration_minutes integer DEFAULT NULL,
  p_tariff_price numeric DEFAULT NULL,
  p_tariff_label text DEFAULT NULL,
  p_lesson_duration_minutes integer DEFAULT NULL,
  p_client_id uuid DEFAULT NULL,
  p_charge_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_status jsonb;
  v_result jsonb;
  v_cached jsonb;
  v_existing_payment_id uuid;
  v_lesson_date date;
  v_fingerprint text := md5(concat_ws(
    '|',
    p_lesson_id,
    p_amount,
    p_method,
    p_venue_rule_acknowledged,
    p_price_id,
    p_tariff_units,
    p_client_id,
    p_charge_id
  ));
  v_legacy_fingerprint text := md5(
    coalesce(p_lesson_id::text, '') || '|' ||
    coalesce(p_amount::text, '') || '|' ||
    coalesce(p_method, '')
  );
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'personal_lessons') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  v_cached := check_operation_idempotency(
    v_org_id, 'record_personal_lesson_payment', p_idempotency_key, v_fingerprint
  );
  IF v_cached IS NOT NULL THEN
    IF v_cached ->> 'error_code' = 'idempotency_conflict'
      AND NOT COALESCE(p_venue_rule_acknowledged, false)
    THEN
      v_cached := check_operation_idempotency(
        v_org_id,
        'record_personal_lesson_payment',
        p_idempotency_key,
        v_legacy_fingerprint
      );
    END IF;
    IF v_cached ->> 'error_code' = 'idempotency_conflict' THEN
      RETURN v_cached;
    END IF;
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  SELECT pl.date INTO v_lesson_date
  FROM personal_lessons pl
  WHERE pl.id = p_lesson_id
    AND (v_org_id IS NULL OR pl.organization_id = v_org_id);

  IF FOUND AND _is_finance_period_closed(v_org_id, v_lesson_date) THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.periodClosed');
  END IF;

  IF editions_lifecycle_enabled() AND edition_allows(v_org_id, 'hall_rent') THEN
    IF venue_cost_payment_ack_required(v_org_id, v_lesson_date)
      AND NOT COALESCE(p_venue_rule_acknowledged, false)
    THEN
      v_status := venue_cost_status_for_org(v_org_id, current_date);
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'venue_rule_ack_required',
        'error', 'venue_rule_ack_required',
        'venue_rule_status', v_status
      );
    END IF;

    v_status := venue_cost_status_for_org(
      v_org_id,
      COALESCE(v_lesson_date, current_date)
    );
  END IF;

  SELECT p.id INTO v_existing_payment_id
  FROM payments p
  WHERE p.organization_id = v_org_id
    AND p.personal_lesson_id = p_lesson_id
    AND p.operation_kind = 'payment'
    AND p.replaces_payment_id IS NULL
    AND payment_remaining_amount(v_org_id, p.id) > 0
  ORDER BY p.created_at
  LIMIT 1;

  v_result := _record_personal_lesson_payment_impl(
    p_lesson_id,
    p_amount,
    p_method,
    p_idempotency_key,
    p_price_id,
    p_tariff_units,
    p_tariff_duration_minutes,
    p_tariff_price,
    p_tariff_label,
    p_lesson_duration_minutes,
    p_client_id,
    p_charge_id
  );

  IF COALESCE((v_result ->> 'success')::boolean, false) THEN
    IF v_existing_payment_id IS NULL
      AND NOT COALESCE((v_result ->> 'already_applied')::boolean, false)
      AND editions_lifecycle_enabled()
      AND edition_allows(v_org_id, 'hall_rent')
    THEN
      PERFORM store_venue_payment_ack_if_required(
        v_status,
        (v_result ->> 'payment_id')::uuid,
        'record_personal_lesson_payment',
        p_idempotency_key
      );
    END IF;
    PERFORM store_operation_idempotency(
      v_org_id,
      'record_personal_lesson_payment',
      p_idempotency_key,
      v_fingerprint,
      v_result
    );
  END IF;

  RETURN v_result;
END;
$$;


-- record_single_visit from 20261013000001_s11_finance_period_main_cash.sql
CREATE OR REPLACE FUNCTION record_single_visit(
  p_visit_date date,
  p_schedule_slot_id uuid,
  p_client_id uuid,
  p_price_id uuid DEFAULT NULL,
  p_method text DEFAULT 'cash',
  p_idempotency_key uuid DEFAULT NULL,
  p_amount numeric DEFAULT NULL,
  p_venue_rule_acknowledged boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_status jsonb;
  v_result jsonb;
  v_cached jsonb;
  v_existing_payment_id uuid;
  v_fingerprint text := md5(concat_ws(
    '|', p_visit_date, p_schedule_slot_id, p_client_id, p_price_id, p_method, p_venue_rule_acknowledged, p_amount
  ));
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'single_visits') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  v_cached := check_operation_idempotency(v_org_id, 'record_single_visit', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN
    IF v_cached ->> 'error_code' = 'idempotency_conflict'
      AND NOT COALESCE(p_venue_rule_acknowledged, false)
    THEN
      v_cached := check_operation_idempotency(
        v_org_id,
        'record_single_visit',
        p_idempotency_key,
        md5(
          coalesce(p_visit_date::text, '') || '|' ||
          coalesce(p_schedule_slot_id::text, '') || '|' ||
          coalesce(p_client_id::text, '') || '|' ||
          coalesce(p_price_id::text, '') || '|' ||
          coalesce(p_method, '')
        )
      );
    END IF;
    IF v_cached ->> 'error_code' = 'idempotency_conflict' THEN RETURN v_cached; END IF;
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF _is_finance_period_closed(v_org_id, p_visit_date) THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.periodClosed');
  END IF;

  IF editions_lifecycle_enabled() AND edition_allows(v_org_id, 'hall_rent') THEN
    v_status := venue_cost_status_for_org(v_org_id, current_date);
    IF COALESCE((v_status ->> 'acknowledgement_required')::boolean, false)
      AND NOT COALESCE(p_venue_rule_acknowledged, false)
    THEN
      RETURN jsonb_build_object(
        'success', false, 'error_code', 'venue_rule_ack_required',
        'error', 'venue_rule_ack_required', 'venue_rule_status', v_status
      );
    END IF;
  END IF;
  SELECT p.id INTO v_existing_payment_id
  FROM single_visits sv
  JOIN payments p
    ON p.organization_id = sv.organization_id
   AND p.single_visit_id = sv.id
   AND p.operation_kind = 'payment'
   AND p.replaces_payment_id IS NULL
  WHERE sv.organization_id = v_org_id
    AND sv.visit_date = p_visit_date
    AND sv.schedule_slot_id = p_schedule_slot_id
    AND sv.client_id = p_client_id
    AND payment_remaining_amount(v_org_id, p.id) > 0
  LIMIT 1;
  v_result := _record_single_visit_before_venue_rules(
    p_visit_date, p_schedule_slot_id, p_client_id, p_price_id, p_method, p_idempotency_key, p_amount
  );
  IF COALESCE((v_result ->> 'success')::boolean, false) THEN
    IF v_existing_payment_id IS NULL
      AND NOT COALESCE((v_result ->> 'already_applied')::boolean, false)
      AND editions_lifecycle_enabled()
      AND edition_allows(v_org_id, 'hall_rent')
    THEN
      PERFORM store_venue_payment_ack_if_required(
        v_status, (v_result ->> 'payment_id')::uuid, 'record_single_visit', p_idempotency_key
      );
    END IF;
    PERFORM post_teacher_pay_deduction_for_single_visit((v_result ->> 'visitId')::uuid, v_member_id);
    PERFORM store_operation_idempotency(v_org_id, 'record_single_visit', p_idempotency_key, v_fingerprint, v_result);
  END IF;
  RETURN v_result;
END;
$$;


-- replace_subscription_partner from 20260877000001_fix_clients_archived_at_in_rpcs.sql
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
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'group_subscriptions') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

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


-- finish_subscription_with_refund from 20261013000001_s11_finance_period_main_cash.sql
CREATE OR REPLACE FUNCTION finish_subscription_with_refund(
  p_sub_id text,
  p_recipient_client_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_reason text DEFAULT NULL,
  p_status text DEFAULT 'completed',
  p_operation_date date DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,
  p_calc_mode text DEFAULT 'pro_rata',
  p_single_visit_rate numeric DEFAULT NULL,
  p_single_visit_tariff_id uuid DEFAULT NULL,
  p_amount_override boolean DEFAULT false
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
  v_sub_uuid uuid;
  v_existing subscription_refunds%ROWTYPE;
  v_payment payments%ROWTYPE;
  v_available numeric;
  v_recommended numeric;
  v_rounded_amount numeric;
  v_operation_date date;
  v_formula jsonb;
  v_refund_id uuid;
  v_calc_mode text;
  v_retained numeric;
  v_lessons_used int;
  v_amount_override boolean;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'group_subscriptions') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT member_can_issue_refunds() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM subscription_refunds sr
    WHERE sr.organization_id = v_org_id
      AND sr.idempotency_key = p_idempotency_key;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'refundId', v_existing.id,
        'amount', v_existing.amount,
        'status', v_existing.status,
        'idempotentReplay', true
      );
    END IF;
  END IF;

  IF p_method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недопустимый способ возврата');
  END IF;

  IF p_status NOT IN ('pending', 'completed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недопустимый статус возврата');
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Укажите причину');
  END IF;

  v_calc_mode := COALESCE(NULLIF(trim(p_calc_mode), ''), 'pro_rata');
  IF v_calc_mode NOT IN ('pro_rata', 'single_visit_rate') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недопустимый режим расчёта');
  END IF;

  IF v_calc_mode = 'single_visit_rate' THEN
    IF p_single_visit_rate IS NULL OR p_single_visit_rate < 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Укажите тариф разового посещения');
    END IF;
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

  IF v_sub.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Абонемент уже завершён');
  END IF;

  IF NOT subscription_refund_validate_recipient(v_org_id, v_sub, p_recipient_client_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Получатель должен быть участником абонемента');
  END IF;

  v_available := subscription_refund_available_amount(v_org_id, v_sub_uuid);
  v_operation_date := COALESCE(p_operation_date, _org_local_date(v_org_id));

  IF _is_finance_period_closed(v_org_id, v_operation_date) THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.periodClosed');
  END IF;

  v_lessons_used := GREATEST(0, v_sub.lessons_total - v_sub.lessons_left);

  IF v_calc_mode = 'single_visit_rate' THEN
    v_recommended := subscription_refund_recommended_by_single_visit_rate(v_sub, p_single_visit_rate);
    v_retained := payroll_round_money(v_lessons_used * p_single_visit_rate);
    v_formula := subscription_refund_formula_snapshot(
      v_sub,
      'single_visit_rate',
      p_single_visit_rate,
      p_single_visit_tariff_id
    );
  ELSE
    v_recommended := subscription_recommended_refund_amount(v_sub);
    v_retained := NULL;
    v_formula := subscription_refund_formula_snapshot(v_sub, 'pro_rata', NULL, NULL);
  END IF;

  IF p_amount IS NULL OR p_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Сумма возврата должна быть неотрицательной');
  END IF;

  v_rounded_amount := payroll_round_money(p_amount);

  IF v_rounded_amount = 0 AND p_status = 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Для завершения без возврата используйте обычное завершение');
  END IF;

  IF v_rounded_amount > v_available THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Сумма превышает доступный остаток (%s)', v_available)
    );
  END IF;

  v_amount_override := COALESCE(p_amount_override, false);
  IF v_recommended IS NOT NULL
    AND abs(v_rounded_amount - payroll_round_money(v_recommended)) > 0.009
  THEN
    v_amount_override := true;
  END IF;

  IF v_amount_override THEN
    v_formula := v_formula || jsonb_build_object('amountOverride', true);
  END IF;

  SELECT * INTO v_payment
  FROM payments p
  WHERE p.organization_id = v_org_id
    AND p.subscription_id = v_sub_uuid
    AND p.personal_lesson_id IS NULL
  ORDER BY p.created_at
  LIMIT 1;

  PERFORM set_config('app.allow_subscription_counter_update', 'true', true);

  UPDATE subscriptions
  SET status = 'finished',
      finished_at = now(),
      finish_reason = trim(p_reason),
      finished_by_member_id = v_member_id
  WHERE id = v_sub_uuid
    AND organization_id = v_org_id;

  IF v_rounded_amount > 0 THEN
    INSERT INTO subscription_refunds (
      organization_id,
      subscription_id,
      client_id,
      payment_id,
      amount,
      recommended_amount,
      method,
      status,
      reason,
      formula_snapshot,
      operation_date,
      idempotency_key,
      completed_at,
      created_by_member_id,
      refund_kind,
      lessons_deducted,
      calc_mode,
      single_visit_tariff_id,
      single_visit_rate,
      retained_amount,
      amount_override
    ) VALUES (
      v_org_id,
      v_sub_uuid,
      p_recipient_client_id,
      v_payment.id,
      v_rounded_amount,
      v_recommended,
      p_method,
      p_status,
      trim(p_reason),
      v_formula,
      v_operation_date,
      p_idempotency_key,
      CASE WHEN p_status = 'completed' THEN now() ELSE NULL END,
      v_member_id,
      'finish',
      0,
      v_calc_mode,
      p_single_visit_tariff_id,
      CASE WHEN v_calc_mode = 'single_visit_rate' THEN p_single_visit_rate ELSE NULL END,
      v_retained,
      v_amount_override
    )
    RETURNING id INTO v_refund_id;

    IF p_status = 'completed' THEN
      PERFORM apply_subscription_refund_payroll_adjustment(
        v_org_id,
        v_refund_id,
        v_sub_uuid,
        v_rounded_amount,
        v_operation_date,
        v_payment.created_at
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'refundId', v_refund_id,
    'amount', v_rounded_amount,
    'status', p_status,
    'recommendedAmount', v_recommended,
    'availableBefore', v_available,
    'calcMode', v_calc_mode,
    'retainedAmount', v_retained,
    'amountOverride', v_amount_override
  );
END;
$$;


-- create_subscription_refund from 20260839000001_subscription_refund_partial_pending.sql
CREATE OR REPLACE FUNCTION create_subscription_refund(
  p_sub_id text,
  p_recipient_client_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_reason text DEFAULT NULL,
  p_status text DEFAULT 'completed',
  p_operation_date date DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,
  p_lessons_to_deduct int DEFAULT NULL
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
  v_sub_uuid uuid;
  v_existing subscription_refunds%ROWTYPE;
  v_payment payments%ROWTYPE;
  v_available numeric;
  v_rounded_amount numeric;
  v_operation_date date;
  v_formula jsonb;
  v_refund_id uuid;
  v_lessons_deducted int;
  v_per_lesson numeric;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'group_subscriptions') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT member_can_issue_refunds() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM subscription_refunds sr
    WHERE sr.organization_id = v_org_id
      AND sr.idempotency_key = p_idempotency_key;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'refundId', v_existing.id,
        'amount', v_existing.amount,
        'status', v_existing.status,
        'idempotentReplay', true
      );
    END IF;
  END IF;

  IF p_method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недопустимый способ возврата');
  END IF;

  IF p_status NOT IN ('pending', 'completed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недопустимый статус возврата');
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Укажите причину');
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

  IF v_sub.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Частичный возврат доступен только для активного абонемента');
  END IF;

  IF NOT subscription_refund_validate_recipient(v_org_id, v_sub, p_recipient_client_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Получатель должен быть участником абонемента');
  END IF;

  v_available := subscription_refund_available_amount(v_org_id, v_sub_uuid);
  v_formula := subscription_refund_formula_snapshot(v_sub);
  v_operation_date := COALESCE(p_operation_date, current_date);

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Сумма возврата должна быть больше нуля');
  END IF;

  v_rounded_amount := payroll_round_money(p_amount);

  IF v_rounded_amount > v_available THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Сумма превышает доступный остаток (%s)', v_available)
    );
  END IF;

  BEGIN
    IF v_sub.lessons_total > 0 THEN
      v_per_lesson := payroll_round_money(
        subscription_sale_price(v_org_id, v_sub_uuid) / v_sub.lessons_total::numeric
      );
    ELSE
      v_per_lesson := 0;
    END IF;
    v_lessons_deducted := subscription_refund_resolve_lessons_deducted(
      v_sub,
      v_rounded_amount,
      v_per_lesson,
      p_lessons_to_deduct
    );
  EXCEPTION
    WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'error', 'Некорректное количество уроков для списания');
  END;

  SELECT * INTO v_payment
  FROM payments p
  WHERE p.organization_id = v_org_id
    AND p.subscription_id = v_sub_uuid
    AND p.personal_lesson_id IS NULL
  ORDER BY p.created_at
  LIMIT 1;

  IF v_lessons_deducted > 0 THEN
    PERFORM set_config('app.allow_subscription_counter_update', 'true', true);
    UPDATE subscriptions
    SET lessons_left = lessons_left - v_lessons_deducted
    WHERE id = v_sub_uuid
      AND organization_id = v_org_id;
  END IF;

  INSERT INTO subscription_refunds (
    organization_id,
    subscription_id,
    client_id,
    payment_id,
    amount,
    recommended_amount,
    method,
    status,
    reason,
    formula_snapshot,
    operation_date,
    idempotency_key,
    completed_at,
    created_by_member_id,
    refund_kind,
    lessons_deducted
  ) VALUES (
    v_org_id,
    v_sub_uuid,
    p_recipient_client_id,
    v_payment.id,
    v_rounded_amount,
    subscription_recommended_refund_amount(v_sub),
    p_method,
    p_status,
    trim(p_reason),
    v_formula,
    v_operation_date,
    p_idempotency_key,
    CASE WHEN p_status = 'completed' THEN now() ELSE NULL END,
    v_member_id,
    'partial',
    v_lessons_deducted
  )
  RETURNING id INTO v_refund_id;

  IF p_status = 'completed' THEN
    PERFORM apply_subscription_refund_payroll_adjustment(
      v_org_id,
      v_refund_id,
      v_sub_uuid,
      v_rounded_amount,
      v_operation_date,
      v_payment.created_at
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'refundId', v_refund_id,
    'amount', v_rounded_amount,
    'status', p_status,
    'lessonsDeducted', v_lessons_deducted,
    'availableBefore', v_available
  );
END;
$$;


-- complete_subscription_refund from 20260839000001_subscription_refund_partial_pending.sql
CREATE OR REPLACE FUNCTION complete_subscription_refund(
  p_refund_id uuid,
  p_operation_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_refund subscription_refunds%ROWTYPE;
  v_payment payments%ROWTYPE;
  v_operation_date date;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'group_subscriptions') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT member_can_issue_refunds() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  SELECT * INTO v_refund
  FROM subscription_refunds sr
  WHERE sr.id = p_refund_id
    AND sr.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Возврат не найден');
  END IF;

  IF v_refund.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Возврат уже обработан');
  END IF;

  v_operation_date := COALESCE(p_operation_date, current_date);

  UPDATE subscription_refunds
  SET status = 'completed',
      completed_at = now(),
      operation_date = v_operation_date
  WHERE id = v_refund.id
    AND organization_id = v_org_id;

  SELECT * INTO v_payment
  FROM payments p
  WHERE p.organization_id = v_org_id
    AND p.id = v_refund.payment_id;

  PERFORM apply_subscription_refund_payroll_adjustment(
    v_org_id,
    v_refund.id,
    v_refund.subscription_id,
    v_refund.amount,
    v_operation_date,
    COALESCE(v_payment.created_at, v_operation_date::timestamptz)
  );

  RETURN jsonb_build_object(
    'success', true,
    'refundId', v_refund.id,
    'amount', v_refund.amount,
    'status', 'completed'
  );
END;
$$;


-- cancel_subscription_refund from 20260839000001_subscription_refund_partial_pending.sql
CREATE OR REPLACE FUNCTION cancel_subscription_refund(
  p_refund_id uuid,
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
  v_refund subscription_refunds%ROWTYPE;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'group_subscriptions') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT member_can_issue_refunds() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  SELECT * INTO v_refund
  FROM subscription_refunds sr
  WHERE sr.id = p_refund_id
    AND sr.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Возврат не найден');
  END IF;

  IF v_refund.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Отменить можно только ожидающий возврат');
  END IF;

  IF v_refund.refund_kind = 'partial' AND v_refund.lessons_deducted > 0 THEN
    PERFORM set_config('app.allow_subscription_counter_update', 'true', true);
    UPDATE subscriptions
    SET lessons_left = lessons_left + v_refund.lessons_deducted
    WHERE id = v_refund.subscription_id
      AND organization_id = v_org_id
      AND status = 'active';
  END IF;

  UPDATE subscription_refunds
  SET status = 'cancelled',
      cancelled_at = now(),
      cancelled_by_member_id = v_member_id,
      cancel_reason = NULLIF(trim(p_reason), '')
  WHERE id = v_refund.id
    AND organization_id = v_org_id;

  RETURN jsonb_build_object('success', true, 'refundId', v_refund.id);
END;
$$;


-- apply_subscription_freeze_period from 20260833000001_subscription_freeze_periods.sql
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
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'group_subscriptions') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

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


-- cancel_subscription_freeze_period from 20260833000001_subscription_freeze_periods.sql
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
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'group_subscriptions') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

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


-- add_group_waitlist_entry from 20261020000001_s20_waitlist_classes_schedule.sql
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
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'group_subscriptions') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

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


-- update_group_waitlist_status from 20261020000001_s20_waitlist_classes_schedule.sql
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
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'group_subscriptions') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

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


-- update_personal_lesson from 20260923000001_update_personal_lesson_billing_split.sql
CREATE OR REPLACE FUNCTION update_personal_lesson(
  p_lesson_id text,
  p_payload jsonb
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
  v_today date := current_date;
  v_lesson_uuid uuid;
  v_new_date date;
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_has_payments boolean;
  v_new_time_start text;
  v_new_time_end text;
  v_new_price_id uuid;
  v_new_payer_client_id uuid;
  v_new_subscription_id uuid;
  v_new_client_id1 uuid;
  v_new_client_id2 uuid;
  v_new_client_id3 uuid;
  v_new_client_id4 uuid;
  v_new_price numeric;
  v_new_billing_split_mode text;
  v_price prices%ROWTYPE;
  v_lesson_minutes integer;
  v_slot_changed boolean;
  v_price_id_changed boolean;
  v_multi_participant boolean;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'personal_lessons') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Организация в режиме только чтения');
  END IF;

  IF p_lesson_id IS NULL OR trim(p_lesson_id) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не указан идентификатор урока');
  END IF;

  IF v_payload = '{}'::jsonb THEN
    RETURN jsonb_build_object('success', false, 'error', 'Нет данных для обновления');
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

  IF v_role = 'teacher' AND NOT teacher_can_access_lesson(v_lesson_uuid) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав для этого урока');
  END IF;

  IF v_lesson.date < v_today AND NOT can_edit_past_schedule() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Редактирование недоступно для прошедших уроков');
  END IF;

  IF v_payload ? 'date' THEN
    BEGIN
      v_new_date := (v_payload ->> 'date')::date;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RETURN jsonb_build_object('success', false, 'error', 'Неверный формат даты');
    END;

    IF v_new_date < v_today AND NOT can_edit_past_schedule() THEN
      RETURN jsonb_build_object('success', false, 'error', 'Новая дата не может быть в прошлом');
    END IF;
  END IF;

  IF v_lesson.subscription_id IS NOT NULL
    AND v_lesson.attendance_status IN ('present', 'absent') THEN
    IF (v_payload ? 'subscription_id'
        AND NULLIF(v_payload ->> 'subscription_id', '')::uuid IS DISTINCT FROM v_lesson.subscription_id)
      OR (v_payload ? 'client_id1'
        AND NULLIF(v_payload ->> 'client_id1', '')::uuid IS DISTINCT FROM v_lesson.client_id1)
      OR (v_payload ? 'client_id2'
        AND NULLIF(v_payload ->> 'client_id2', '')::uuid IS DISTINCT FROM COALESCE(v_lesson.client_id2, NULL))
      OR (v_payload ? 'client_id3'
        AND NULLIF(v_payload ->> 'client_id3', '')::uuid IS DISTINCT FROM COALESCE(v_lesson.client_id3, NULL))
      OR (v_payload ? 'client_id4'
        AND NULLIF(v_payload ->> 'client_id4', '')::uuid IS DISTINCT FROM COALESCE(v_lesson.client_id4, NULL)) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Сначала смените отметку посещаемости');
    END IF;
  END IF;

  v_has_payments := personal_lesson_has_payment_rows(v_org_id, v_lesson_uuid);

  v_new_time_start := CASE
    WHEN v_payload ? 'time_start' THEN v_payload ->> 'time_start'
    ELSE v_lesson.time_start
  END;
  v_new_time_end := CASE
    WHEN v_payload ? 'time_end' THEN v_payload ->> 'time_end'
    ELSE v_lesson.time_end
  END;
  v_new_price_id := CASE
    WHEN v_payload ? 'price_id' THEN NULLIF(v_payload ->> 'price_id', '')::uuid
    ELSE v_lesson.price_id
  END;
  v_new_payer_client_id := CASE
    WHEN v_payload ? 'payer_client_id' THEN NULLIF(v_payload ->> 'payer_client_id', '')::uuid
    ELSE v_lesson.payer_client_id
  END;
  v_new_subscription_id := CASE
    WHEN v_payload ? 'subscription_id' THEN NULLIF(v_payload ->> 'subscription_id', '')::uuid
    ELSE v_lesson.subscription_id
  END;
  v_new_client_id1 := CASE
    WHEN v_payload ? 'client_id1' THEN NULLIF(v_payload ->> 'client_id1', '')::uuid
    ELSE v_lesson.client_id1
  END;
  v_new_client_id2 := CASE
    WHEN v_payload ? 'client_id2' THEN NULLIF(v_payload ->> 'client_id2', '')::uuid
    ELSE v_lesson.client_id2
  END;
  v_new_client_id3 := CASE
    WHEN v_payload ? 'client_id3' THEN NULLIF(v_payload ->> 'client_id3', '')::uuid
    ELSE v_lesson.client_id3
  END;
  v_new_client_id4 := CASE
    WHEN v_payload ? 'client_id4' THEN NULLIF(v_payload ->> 'client_id4', '')::uuid
    ELSE v_lesson.client_id4
  END;
  v_new_price := CASE
    WHEN v_payload ? 'price' THEN (v_payload ->> 'price')::numeric
    ELSE v_lesson.price
  END;
  v_new_billing_split_mode := CASE
    WHEN v_payload ? 'billing_split_mode' THEN v_payload ->> 'billing_split_mode'
    ELSE v_lesson.billing_split_mode
  END;

  IF v_new_subscription_id IS NOT NULL THEN
    v_new_price_id := NULL;
  END IF;

  IF v_new_payer_client_id IS NOT NULL
    AND NOT personal_lesson_client_is_participant(
      v_new_payer_client_id,
      v_new_client_id1,
      v_new_client_id2,
      v_new_client_id3,
      v_new_client_id4
    )
  THEN
    RETURN jsonb_build_object('success', false, 'error', 'Плательщик должен быть участником урока');
  END IF;

  v_multi_participant :=
    v_new_client_id1 IS NOT NULL
    AND (
      v_new_client_id2 IS NOT NULL
      OR v_new_client_id3 IS NOT NULL
      OR v_new_client_id4 IS NOT NULL
    );

  IF NOT v_has_payments
    AND v_new_subscription_id IS NULL
    AND NOT (v_new_subscription_id IS NOT NULL AND COALESCE(v_new_price, 0) = 0)
    AND v_multi_participant
    AND NOT (v_payload ? 'billing_split_mode')
  THEN
    v_new_billing_split_mode := 'equal';
  END IF;

  IF v_new_billing_split_mode IS NOT NULL
    AND v_new_billing_split_mode NOT IN ('single_payer', 'equal')
  THEN
    RETURN jsonb_build_object('success', false, 'error', 'Некорректный режим разделения оплаты');
  END IF;

  v_slot_changed :=
    (v_payload ? 'time_start' AND v_new_time_start IS DISTINCT FROM v_lesson.time_start)
    OR (v_payload ? 'time_end' AND v_new_time_end IS DISTINCT FROM v_lesson.time_end);
  v_price_id_changed :=
    v_payload ? 'price_id' AND v_new_price_id IS DISTINCT FROM v_lesson.price_id;

  IF v_new_price_id IS NOT NULL
    AND NOT v_has_payments
    AND v_new_subscription_id IS NULL
    AND (v_slot_changed OR v_price_id_changed)
    AND NOT (v_payload ? 'price')
  THEN
    SELECT * INTO v_price
    FROM prices pr
    WHERE pr.organization_id = v_org_id AND pr.id = v_new_price_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Тариф не найден');
    END IF;

    v_lesson_minutes := personal_lesson_slot_minutes(v_new_time_start, v_new_time_end);
    v_new_price := billed_from_tariff(
      v_price.price,
      v_lesson_minutes,
      v_price.duration_minutes
    );

    IF v_new_price IS NULL OR v_new_price < 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Некорректная сумма начисления');
    END IF;
  END IF;

  UPDATE personal_lessons pl
  SET
    date = CASE WHEN v_payload ? 'date' THEN (v_payload ->> 'date')::date ELSE pl.date END,
    time_start = v_new_time_start,
    time_end = v_new_time_end,
    location_id = CASE
      WHEN v_payload ? 'location_id' THEN NULLIF(v_payload ->> 'location_id', '')::uuid
      ELSE pl.location_id
    END,
    teacher_member_id = CASE
      WHEN v_payload ? 'teacher_member_id' THEN NULLIF(v_payload ->> 'teacher_member_id', '')::uuid
      ELSE pl.teacher_member_id
    END,
    discipline_id = CASE
      WHEN v_payload ? 'discipline_id' THEN NULLIF(v_payload ->> 'discipline_id', '')::uuid
      ELSE pl.discipline_id
    END,
    type = CASE WHEN v_payload ? 'type' THEN v_payload ->> 'type' ELSE pl.type END,
    client_id1 = v_new_client_id1,
    client_id2 = v_new_client_id2,
    client_id3 = v_new_client_id3,
    client_id4 = v_new_client_id4,
    price_id = v_new_price_id,
    payer_client_id = v_new_payer_client_id,
    billing_split_mode = COALESCE(v_new_billing_split_mode, pl.billing_split_mode),
    price = v_new_price,
    paid = CASE WHEN v_payload ? 'paid' THEN v_payload ->> 'paid' ELSE pl.paid END,
    subscription_id = v_new_subscription_id
  WHERE pl.id = v_lesson_uuid
    AND pl.organization_id = v_org_id;

  RETURN jsonb_build_object('success', true);
END;
$$;


-- delete_personal_lesson from 20260922000001_delete_future_personal_lesson_billing.sql
CREATE OR REPLACE FUNCTION delete_personal_lesson(p_lesson_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_role text := current_member_role();
  v_lesson RECORD;
  v_today date := current_date;
  v_lesson_uuid uuid;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'personal_lessons') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Организация в режиме только чтения');
  END IF;

  IF p_lesson_id IS NULL OR trim(p_lesson_id) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не указан идентификатор урока');
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

  IF v_role = 'teacher' AND NOT teacher_can_access_lesson(v_lesson_uuid) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав для этого урока');
  END IF;

  IF v_lesson.date < v_today AND NOT can_edit_past_schedule() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Удаление недоступно для прошедших уроков');
  END IF;

  IF v_lesson.subscription_id IS NOT NULL
    AND v_lesson.attendance_status IN ('present', 'absent') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Сначала смените отметку посещаемости');
  END IF;

  IF v_lesson.date >= v_today THEN
    PERFORM purge_personal_lesson_financials(v_org_id, v_lesson_uuid);
  ELSE
    IF personal_lesson_net_payment(v_org_id, v_lesson_uuid) > 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Сначала отмените оплату урока');
    END IF;

    PERFORM orphan_personal_lesson_payments(v_org_id, v_lesson_uuid);
  END IF;

  DELETE FROM personal_lessons
  WHERE id = v_lesson_uuid
    AND organization_id = v_org_id;

  RETURN jsonb_build_object('success', true);
END;
$$;


-- delete_personal_lesson_series_from_date from 20260922000001_delete_future_personal_lesson_billing.sql
CREATE OR REPLACE FUNCTION delete_personal_lesson_series_from_date(p_lesson_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_role text := current_member_role();
  v_lesson RECORD;
  v_today date := current_date;
  v_lesson_uuid uuid;
  v_target RECORD;
  v_deleted int := 0;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'personal_lessons') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Организация в режиме только чтения');
  END IF;

  IF p_lesson_id IS NULL OR trim(p_lesson_id) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не указан идентификатор урока');
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

  IF v_role = 'teacher' AND NOT teacher_can_access_lesson(v_lesson_uuid) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав для этого урока');
  END IF;

  FOR v_target IN
    SELECT pl.*
    FROM personal_lessons pl
    WHERE pl.organization_id = v_org_id
      AND pl.date >= v_lesson.date
      AND pl.type = v_lesson.type
      AND pl.client_id1 IS NOT DISTINCT FROM v_lesson.client_id1
      AND pl.client_id2 IS NOT DISTINCT FROM v_lesson.client_id2
      AND pl.client_id3 IS NOT DISTINCT FROM v_lesson.client_id3
      AND pl.client_id4 IS NOT DISTINCT FROM v_lesson.client_id4
      AND pl.time_start = v_lesson.time_start
      AND pl.time_end = v_lesson.time_end
      AND pl.teacher_member_id IS NOT DISTINCT FROM v_lesson.teacher_member_id
      AND pl.location_id IS NOT DISTINCT FROM v_lesson.location_id
      AND pl.discipline_id IS NOT DISTINCT FROM v_lesson.discipline_id
      AND EXTRACT(ISODOW FROM pl.date) = EXTRACT(ISODOW FROM v_lesson.date)
    ORDER BY pl.date
    FOR UPDATE
  LOOP
    IF v_role = 'teacher' AND NOT teacher_can_access_lesson(v_target.id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав для этого урока');
    END IF;

    IF v_target.date < v_today AND NOT can_edit_past_schedule() THEN
      RETURN jsonb_build_object('success', false, 'error', 'Удаление недоступно для прошедших уроков');
    END IF;

    IF v_target.subscription_id IS NOT NULL
      AND v_target.attendance_status IN ('present', 'absent') THEN
      RETURN jsonb_build_object('success', false, 'error', 'Сначала смените отметку посещаемости');
    END IF;

    IF v_target.date >= v_today THEN
      PERFORM purge_personal_lesson_financials(v_org_id, v_target.id);
    ELSIF personal_lesson_net_payment(v_org_id, v_target.id) > 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Сначала отмените оплату урока');
    ELSE
      PERFORM orphan_personal_lesson_payments(v_org_id, v_target.id);
    END IF;
  END LOOP;

  DELETE FROM personal_lessons pl
  WHERE pl.organization_id = v_org_id
    AND pl.date >= v_lesson.date
    AND pl.type = v_lesson.type
    AND pl.client_id1 IS NOT DISTINCT FROM v_lesson.client_id1
    AND pl.client_id2 IS NOT DISTINCT FROM v_lesson.client_id2
    AND pl.client_id3 IS NOT DISTINCT FROM v_lesson.client_id3
    AND pl.client_id4 IS NOT DISTINCT FROM v_lesson.client_id4
    AND pl.time_start = v_lesson.time_start
    AND pl.time_end = v_lesson.time_end
    AND pl.teacher_member_id IS NOT DISTINCT FROM v_lesson.teacher_member_id
    AND pl.location_id IS NOT DISTINCT FROM v_lesson.location_id
    AND pl.discipline_id IS NOT DISTINCT FROM v_lesson.discipline_id
    AND EXTRACT(ISODOW FROM pl.date) = EXTRACT(ISODOW FROM v_lesson.date);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'deleted_count', v_deleted);
END;
$$;


-- void_personal_lesson_payment from 20260878000001_custom_amount_payments.sql
CREATE OR REPLACE FUNCTION void_personal_lesson_payment(
  p_lesson_id uuid,
  p_reason_code text DEFAULT 'duplicate',
  p_reason_comment text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_payment RECORD;
  v_remaining numeric;
  v_storno_result jsonb;
  v_voided_count int := 0;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'personal_lessons') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  FOR v_payment IN
    SELECT p.id
    FROM payments p
    WHERE p.organization_id = v_org_id
      AND p.personal_lesson_id = p_lesson_id
      AND p.operation_kind = 'payment'
      AND p.replaces_payment_id IS NULL
    ORDER BY p.created_at
  LOOP
    v_remaining := payment_remaining_amount(v_org_id, v_payment.id);
    IF v_remaining > 0 THEN
      v_storno_result := storno_payment(v_payment.id, v_remaining, p_reason_code, p_reason_comment, NULL);
      IF NOT COALESCE((v_storno_result ->> 'success')::boolean, false) THEN
        PERFORM sync_personal_lesson_paid_status(v_org_id, p_lesson_id);
        RETURN v_storno_result;
      END IF;
      v_voided_count := v_voided_count + 1;
    END IF;
  END LOOP;

  PERFORM sync_personal_lesson_paid_status(v_org_id, p_lesson_id);

  IF v_voided_count = 0 THEN
    RETURN jsonb_build_object('success', true, 'already_void', true);
  END IF;

  RETURN jsonb_build_object('success', true, 'voided_count', v_voided_count);
END;
$$;


-- write_off_personal_lesson_debt from 20261013000001_s11_finance_period_main_cash.sql
CREATE OR REPLACE FUNCTION write_off_personal_lesson_debt(
  p_lesson_id uuid,
  p_charge_id uuid DEFAULT NULL,
  p_reason_code text DEFAULT 'wrong_amount',
  p_reason_comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_lesson personal_lessons%ROWTYPE;
  v_charge personal_lesson_charges%ROWTYPE;
  v_charge_count integer;
  v_paid numeric;
  v_new_billed numeric;
  v_written_off numeric;
  v_reason text := COALESCE(NULLIF(trim(p_reason_code), ''), 'wrong_amount');
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'finance') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.orgReadOnly');
  END IF;

  IF NOT can_read_financial() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF p_lesson_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.adjustInvalid');
  END IF;

  SELECT * INTO v_lesson
  FROM personal_lessons
  WHERE id = p_lesson_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.adjustFailed');
  END IF;

  IF _is_finance_period_closed(v_org_id, v_lesson.date) THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.periodClosed');
  END IF;

  IF p_charge_id IS NOT NULL THEN
    SELECT * INTO v_charge
    FROM personal_lesson_charges
    WHERE organization_id = v_org_id
      AND id = p_charge_id
      AND personal_lesson_id = p_lesson_id
    FOR UPDATE;
  ELSE
    SELECT COUNT(*)::integer INTO v_charge_count
    FROM personal_lesson_charges
    WHERE organization_id = v_org_id
      AND personal_lesson_id = p_lesson_id;

    IF v_charge_count <> 1 THEN
      RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.writeOffGroupHint');
    END IF;

    SELECT * INTO v_charge
    FROM personal_lesson_charges
    WHERE organization_id = v_org_id
      AND personal_lesson_id = p_lesson_id
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.adjustFailed');
  END IF;

  SELECT COALESCE(SUM(payment_effective_amount(p)), 0) INTO v_paid
  FROM payments p
  WHERE p.organization_id = v_org_id
    AND (
      p.personal_lesson_charge_id = v_charge.id
      OR (
        p.personal_lesson_charge_id IS NULL
        AND p.personal_lesson_id = p_lesson_id
        AND p.client_id = v_charge.client_id
      )
    );

  v_paid := GREATEST(COALESCE(v_paid, 0), 0);
  v_new_billed := v_paid;
  v_written_off := ROUND(v_charge.billed_amount - v_new_billed, 2);

  IF v_written_off <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.writeOffEmpty');
  END IF;

  UPDATE personal_lesson_charges
  SET billed_amount = v_new_billed
  WHERE organization_id = v_org_id
    AND id = v_charge.id;

  UPDATE personal_lessons
  SET price_id = NULL
  WHERE id = p_lesson_id
    AND organization_id = v_org_id;

  PERFORM sync_personal_lesson_paid_status(v_org_id, p_lesson_id);

  INSERT INTO audit_log (
    organization_id,
    table_name,
    operation,
    row_id,
    old_data,
    new_data,
    changed_by
  )
  VALUES (
    v_org_id,
    'personal_lesson_charges',
    'UPDATE',
    v_charge.id,
    jsonb_build_object('billed_amount', v_charge.billed_amount),
    jsonb_build_object(
      'billed_amount', v_new_billed,
      'written_off', v_written_off,
      'reason_code', v_reason,
      'reason_comment', p_reason_comment,
      'correction_kind', 'write_off'
    ),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'success', true,
    'written_off', v_written_off,
    'new_billed', v_new_billed,
    'paid_amount', v_paid
  );
END;
$$;


-- save_teacher_pay_rate from 20261024000001_s25_storage_teacher_pay_rates.sql
CREATE OR REPLACE FUNCTION save_teacher_pay_rate(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := NULLIF(p_payload ->> 'member_id', '')::uuid;
  v_pay_mode text := NULLIF(p_payload ->> 'pay_mode', '');
  v_fixed_amount numeric := COALESCE(NULLIF(p_payload ->> 'fixed_amount', '')::numeric, 0);
  v_group_rate numeric := COALESCE(NULLIF(p_payload ->> 'group_rate_percent', '')::numeric, 0);
  v_personal_rate numeric := COALESCE(NULLIF(p_payload ->> 'personal_rate_percent', '')::numeric, 0);
  v_single_visit_rate numeric := COALESCE(NULLIF(p_payload ->> 'single_visit_rate_percent', '')::numeric, 0);
  v_effective_from date := COALESCE(NULLIF(p_payload ->> 'effective_from', '')::date, CURRENT_DATE);
  v_rate_id uuid;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'payroll') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'unauthorized');
  END IF;

  IF NOT can_manage_payroll_rates() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  IF v_member_id IS NULL
    OR v_pay_mode NOT IN ('percent', 'fixed', 'fixed_plus_percent')
    OR v_fixed_amount < 0
    OR v_group_rate < 0
    OR v_personal_rate < 0
    OR v_single_visit_rate < 0
  THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_payload');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM organization_members om
    WHERE om.organization_id = v_org_id
      AND om.id = v_member_id
      AND om.role = 'teacher'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'member_not_found');
  END IF;

  INSERT INTO teacher_pay_rates (
    organization_id,
    member_id,
    pay_mode,
    fixed_amount,
    rate_percent,
    group_rate_percent,
    personal_rate_percent,
    single_visit_rate_percent,
    effective_from
  )
  VALUES (
    v_org_id,
    v_member_id,
    v_pay_mode,
    v_fixed_amount,
    GREATEST(v_group_rate, v_personal_rate, v_single_visit_rate),
    v_group_rate,
    v_personal_rate,
    v_single_visit_rate,
    v_effective_from
  )
  RETURNING id INTO v_rate_id;

  RETURN jsonb_build_object('success', true, 'rate_id', v_rate_id);
END;
$$;


-- save_teacher_pay_rule from 20260884000001_teacher_pay_audit_fixes.sql
CREATE OR REPLACE FUNCTION save_teacher_pay_rule(
  p_payload jsonb,
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
  v_rule_id uuid := NULLIF(p_payload ->> 'id', '')::uuid;
  v_teacher_member_id uuid := NULLIF(p_payload ->> 'member_id', '')::uuid;
  v_lesson_kind text := NULLIF(p_payload ->> 'lesson_kind', '');
  v_discipline_id uuid := NULLIF(p_payload ->> 'discipline_id', '')::uuid;
  v_schedule_group_id uuid := NULLIF(p_payload ->> 'schedule_group_id', '')::uuid;
  v_amount_type text := NULLIF(p_payload ->> 'amount_type', '');
  v_value numeric := NULLIF(p_payload ->> 'value', '')::numeric;
  v_expense_category text := NULLIF(p_payload ->> 'expense_category', '');
  v_valid_from date := NULLIF(p_payload ->> 'valid_from', '')::date;
  v_valid_to date := NULLIF(p_payload ->> 'valid_to', '')::date;
  v_result jsonb;
  v_cached jsonb;
  v_fingerprint text := md5(COALESCE(p_payload::text, ''));
  v_saved teacher_pay_rules%ROWTYPE;
  v_existing teacher_pay_rules%ROWTYPE;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'payroll') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  v_cached := check_operation_idempotency(v_org_id, 'save_teacher_pay_rule', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL OR current_member_role() NOT IN ('owner', 'director')
    OR NOT organization_allows_writes(v_org_id)
  THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  IF v_teacher_member_id IS NULL
    OR v_lesson_kind NOT IN ('personal', 'group', 'single_visit', 'all')
    OR v_amount_type NOT IN ('percent', 'fixed')
    OR v_value IS NULL OR v_value < 0
    OR v_valid_from IS NULL
    OR (v_valid_to IS NOT NULL AND v_valid_to < v_valid_from)
    OR (v_amount_type = 'percent' AND v_value > 100)
  THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_payload');
  END IF;

  IF v_expense_category IS NOT NULL
    AND v_expense_category NOT IN ('rent', 'utilities', 'marketing', 'other')
  THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_expense_category');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.organization_id = v_org_id AND om.id = v_teacher_member_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'member_not_found');
  END IF;

  IF v_discipline_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM disciplines d WHERE d.organization_id = v_org_id AND d.id = v_discipline_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_discipline');
  END IF;

  IF v_schedule_group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM classes c WHERE c.organization_id = v_org_id AND c.id = v_schedule_group_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_schedule_group');
  END IF;

  IF v_schedule_group_id IS NOT NULL AND v_discipline_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM classes c
    WHERE c.organization_id = v_org_id
      AND c.id = v_schedule_group_id
      AND c.discipline_id = v_discipline_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_schedule_group');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_org_id::text || ':teacher-pay-rules', 0));

  IF v_rule_id IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM teacher_pay_rules
    WHERE id = v_rule_id AND organization_id = v_org_id AND member_id = v_teacher_member_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'rule_not_found');
    END IF;

    IF v_existing.valid_from <= current_date THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'active_rule_not_editable');
    END IF;

    UPDATE teacher_pay_rules r
    SET
      lesson_kind = v_lesson_kind,
      discipline_id = v_discipline_id,
      schedule_group_id = v_schedule_group_id,
      amount_type = v_amount_type,
      value = v_value,
      expense_category = v_expense_category,
      valid_from = v_valid_from,
      valid_to = v_valid_to
    WHERE r.id = v_rule_id
      AND r.organization_id = v_org_id
      AND r.member_id = v_teacher_member_id
    RETURNING * INTO v_saved;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'rule_not_found');
    END IF;
  ELSE
    INSERT INTO teacher_pay_rules (
      organization_id, member_id, lesson_kind, discipline_id, schedule_group_id,
      amount_type, value, expense_category, valid_from, valid_to, created_by
    ) VALUES (
      v_org_id, v_teacher_member_id, v_lesson_kind, v_discipline_id, v_schedule_group_id,
      v_amount_type, v_value, v_expense_category, v_valid_from, v_valid_to, v_member_id
    )
    RETURNING * INTO v_saved;
  END IF;

  v_result := jsonb_build_object('success', true, 'rule_id', v_saved.id, 'rule', to_jsonb(v_saved));
  PERFORM store_operation_idempotency(v_org_id, 'save_teacher_pay_rule', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM LIKE '%teacher_pay_rule_overlap%' THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'rule_overlap');
    END IF;
    RAISE;
END;
$$;


-- recalculate_teacher_settlement from 20260837000001_teacher_settlement_detail.sql
CREATE OR REPLACE FUNCTION recalculate_teacher_settlement(
  p_org_id uuid,
  p_year int,
  p_month int
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_date_from date;
  v_date_to date;
  v_member record;
  v_accrued numeric;
  v_existing_paid numeric;
  v_settlement_id uuid;
  v_computed_at timestamptz := now();
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'payroll') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  IF p_org_id IS NULL
    OR p_org_id <> auth_organization_id()
    OR NOT can_write_payroll()
    OR NOT organization_allows_writes(p_org_id)
  THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  IF p_month < 1 OR p_month > 12 THEN
    RAISE EXCEPTION 'invalid month';
  END IF;

  v_date_from := make_date(p_year, p_month, 1);
  v_date_to := (v_date_from + interval '1 month' - interval '1 day')::date;

  FOR v_member IN
    SELECT om.id AS member_id
    FROM organization_members om
    WHERE om.organization_id = p_org_id
      AND om.role IN ('owner', 'director', 'admin', 'teacher', 'accountant')
      AND om.is_active = true
  LOOP
    SELECT ts.amount_paid, ts.id
    INTO v_existing_paid, v_settlement_id
    FROM teacher_settlements ts
    WHERE ts.organization_id = p_org_id
      AND ts.member_id = v_member.member_id
      AND ts.period_year = p_year
      AND ts.period_month = p_month;

    INSERT INTO teacher_settlements (
      organization_id,
      member_id,
      period_year,
      period_month,
      amount_accrued,
      amount_paid,
      computed_at
    )
    VALUES (
      p_org_id,
      v_member.member_id,
      p_year,
      p_month,
      0,
      COALESCE(v_existing_paid, 0),
      v_computed_at
    )
    ON CONFLICT (organization_id, member_id, period_year, period_month)
    DO UPDATE SET
      computed_at = v_computed_at
    RETURNING id INTO v_settlement_id;

    v_accrued := payroll_refresh_settlement_lines(
      p_org_id,
      v_settlement_id,
      v_member.member_id,
      p_year,
      p_month,
      v_computed_at
    );

    UPDATE teacher_settlements
    SET amount_accrued = COALESCE(v_accrued, 0),
        computed_at = v_computed_at
    WHERE organization_id = p_org_id
      AND id = v_settlement_id;
  END LOOP;
END;
$$;


-- record_teacher_settlement_payment from 20260730000001_team_payroll_rates_and_advances.sql
CREATE OR REPLACE FUNCTION record_teacher_settlement_payment(
  p_settlement_id uuid,
  p_amount numeric,
  p_paid_at date,
  p_method text DEFAULT 'transfer',
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_settlement teacher_settlements%ROWTYPE;
  v_payment_id uuid;
  v_new_paid numeric;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'payroll') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  IF v_org_id IS NULL
    OR NOT can_write_payroll()
    OR NOT organization_allows_writes(v_org_id)
  THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid amount';
  END IF;

  IF p_paid_at IS NULL OR p_paid_at > CURRENT_DATE THEN
    RAISE EXCEPTION 'paid_at cannot be in the future';
  END IF;

  IF p_method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RAISE EXCEPTION 'invalid method';
  END IF;

  SELECT * INTO v_settlement
  FROM teacher_settlements ts
  WHERE ts.id = p_settlement_id
    AND ts.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement not found';
  END IF;

  v_new_paid := v_settlement.amount_paid + p_amount;

  INSERT INTO teacher_settlement_payments (
    organization_id,
    settlement_id,
    amount,
    paid_at,
    method,
    note,
    created_by
  )
  VALUES (
    v_org_id,
    p_settlement_id,
    p_amount,
    p_paid_at,
    p_method,
    nullif(trim(p_note), ''),
    auth_member_id()
  )
  RETURNING id INTO v_payment_id;

  UPDATE teacher_settlements
  SET amount_paid = v_new_paid
  WHERE id = p_settlement_id;

  RETURN v_payment_id;
END;
$$;


-- create_rental_invoice from 20260845000001_rental_series_tariffs.sql
CREATE OR REPLACE FUNCTION create_rental_invoice(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_key text := NULLIF(trim(p_payload ->> 'idempotency_key'), '');
  v_existing rental_invoices%ROWTYPE;
  v_renter_id uuid := (p_payload ->> 'renter_id')::uuid;
  v_series_id uuid := NULLIF(p_payload ->> 'series_id', '')::uuid;
  v_period_start date := (p_payload ->> 'period_start')::date;
  v_period_end date := (p_payload ->> 'period_end')::date;
  v_due_date date := COALESCE((p_payload ->> 'due_date')::date, v_period_end + 14);
  v_invoice_id uuid;
  v_rental rentals%ROWTYPE;
  v_total numeric(12, 2) := 0;
  v_currency text := 'RUB';
  v_status text := COALESCE(NULLIF(p_payload ->> 'status', ''), 'invoiced');
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'hall_rent') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_financial() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  IF v_renter_id IS NULL OR v_period_start IS NULL OR v_period_end IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.invoice.fieldsInvalid');
  END IF;

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM rental_invoices ri
    WHERE ri.organization_id = v_org_id AND ri.idempotency_key = v_key;

    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'invoice_id', v_existing.id, 'already_applied', true);
    END IF;
  END IF;

  INSERT INTO rental_invoices (
    organization_id, renter_id, series_id, period_start, period_end,
    due_date, status, currency, total_amount, idempotency_key, created_by
  )
  VALUES (
    v_org_id, v_renter_id, v_series_id, v_period_start, v_period_end,
    v_due_date, v_status, v_currency, 0, v_key, v_member_id
  )
  RETURNING id INTO v_invoice_id;

  FOR v_rental IN
    SELECT r.*
    FROM rentals r
    WHERE r.organization_id = v_org_id
      AND r.renter_id = v_renter_id
      AND r.rental_date >= v_period_start
      AND r.rental_date <= v_period_end
      AND r.booking_status = 'confirmed'
      AND (v_series_id IS NULL OR r.rental_series_id = v_series_id)
      AND NOT _rental_is_in_active_invoice(r.id, v_org_id)
    ORDER BY r.rental_date, r.time_start
  LOOP
    v_currency := v_rental.currency;
    v_total := v_total + _rental_effective_amount(v_rental.fixed_amount, v_rental.final_amount);

    INSERT INTO rental_invoice_lines (
      organization_id, invoice_id, rental_id, line_type, description, amount
    )
    VALUES (
      v_org_id,
      v_invoice_id,
      v_rental.id,
      'booking',
      'Rental ' || v_rental.rental_date::text || ' ' || v_rental.time_start || '-' || v_rental.time_end,
      _rental_effective_amount(v_rental.fixed_amount, v_rental.final_amount)
    );
  END LOOP;

  UPDATE rental_invoices
  SET total_amount = v_total, currency = v_currency, updated_at = now()
  WHERE id = v_invoice_id;

  RETURN jsonb_build_object('success', true, 'invoice_id', v_invoice_id, 'total_amount', v_total);
EXCEPTION
  WHEN unique_violation THEN
    IF v_key IS NOT NULL THEN
      SELECT id INTO v_invoice_id FROM rental_invoices WHERE organization_id = v_org_id AND idempotency_key = v_key;
      IF v_invoice_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'invoice_id', v_invoice_id, 'already_applied', true);
      END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.duplicate');
END;
$$;


-- record_rental_payment from 20261125000001_staff_cashier_rental_wallet_hold.sql
CREATE OR REPLACE FUNCTION record_rental_payment(
  p_rental_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_method_comment text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_operation_date date DEFAULT NULL,
  p_fiscal_status text DEFAULT NULL,
  p_fiscal_receipt_number text DEFAULT NULL,
  p_fiscal_cash_register_id text DEFAULT NULL,
  p_fiscal_terminal_id text DEFAULT NULL,
  p_fiscal_acquiring_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_denied jsonb;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'hall_rent') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  v_denied := _rental_reject_miniapp_money_write(auth_organization_id(), p_rental_id);
  IF v_denied IS NOT NULL THEN
    RETURN v_denied;
  END IF;
  RETURN _cashier_record_rental_payment(
    p_rental_id,
    p_amount,
    p_method,
    p_method_comment,
    p_idempotency_key,
    p_operation_date,
    p_fiscal_status,
    p_fiscal_receipt_number,
    p_fiscal_cash_register_id,
    p_fiscal_terminal_id,
    p_fiscal_acquiring_id
  );
END;
$$;


-- record_rental_invoice_payment from 20260868000001_rental_fiscal_documents.sql
CREATE OR REPLACE FUNCTION record_rental_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_idempotency_key text DEFAULT NULL,
  p_operation_date date DEFAULT NULL,
  p_fiscal_status text DEFAULT NULL,
  p_fiscal_receipt_number text DEFAULT NULL,
  p_fiscal_cash_register_id text DEFAULT NULL,
  p_fiscal_terminal_id text DEFAULT NULL,
  p_fiscal_acquiring_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_key text := NULLIF(trim(p_idempotency_key), '');
  v_invoice rental_invoices%ROWTYPE;
  v_existing rental_invoice_payments%ROWTYPE;
  v_payment_id uuid;
  v_paid numeric;
  v_status text;
  v_operation_date date;
  v_today date;
  v_fiscal_status text;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'hall_rent') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_financial() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.paymentAmountInvalid');
  END IF;

  IF p_method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.paymentMethodInvalid');
  END IF;

  v_today := _org_local_date(v_org_id);
  v_operation_date := COALESCE(p_operation_date, v_today);

  IF v_operation_date > v_today THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.operationDateFuture');
  END IF;

  IF _is_finance_period_closed(v_org_id, v_operation_date) THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.periodClosed');
  END IF;

  v_fiscal_status := _rental_resolve_fiscal_status(v_org_id, p_method, p_fiscal_status);

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM rental_invoice_payments rip
    WHERE rip.organization_id = v_org_id AND rip.idempotency_key = v_key;

    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'payment_id', v_existing.id, 'already_applied', true);
    END IF;
  END IF;

  SELECT * INTO v_invoice
  FROM rental_invoices ri
  WHERE ri.id = p_invoice_id AND ri.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.invoice.notFound');
  END IF;

  IF v_invoice.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.invoice.cancelled');
  END IF;

  INSERT INTO rental_invoice_payments (
    organization_id, invoice_id, amount, currency, method, idempotency_key, created_by, operation_date,
    fiscal_status, fiscal_receipt_number, fiscal_cash_register_id,
    fiscal_terminal_id, fiscal_acquiring_id
  )
  VALUES (
    v_org_id, p_invoice_id, p_amount, v_invoice.currency, p_method, v_key, v_member_id, v_operation_date,
    v_fiscal_status,
    NULLIF(trim(p_fiscal_receipt_number), ''),
    NULLIF(trim(p_fiscal_cash_register_id), ''),
    NULLIF(trim(p_fiscal_terminal_id), ''),
    NULLIF(trim(p_fiscal_acquiring_id), '')
  )
  RETURNING id INTO v_payment_id;

  v_paid := _rental_invoice_paid_total(p_invoice_id, v_org_id);
  v_status := _rental_invoice_status(v_invoice.total_amount, v_paid, v_invoice.due_date, v_invoice.status);

  UPDATE rental_invoices
  SET status = v_status, updated_at = now()
  WHERE id = p_invoice_id;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'paid_amount', v_paid,
    'status', v_status,
    'fiscal_status', v_fiscal_status
  );
EXCEPTION
  WHEN unique_violation THEN
    IF v_key IS NOT NULL THEN
      SELECT id INTO v_payment_id FROM rental_invoice_payments WHERE organization_id = v_org_id AND idempotency_key = v_key;
      IF v_payment_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id, 'already_applied', true);
      END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.duplicate');
END;
$$;


-- correct_rental_payment from 20260862000001_rental_operation_date.sql
CREATE OR REPLACE FUNCTION correct_rental_payment(
  p_payment_id uuid,
  p_new_amount numeric,
  p_new_method text,
  p_reason_code text DEFAULT NULL,
  p_reason_comment text DEFAULT NULL,
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
  v_payment rental_payments%ROWTYPE;
  v_key text := NULLIF(trim(p_idempotency_key), '');
  v_storno_id uuid;
  v_new_payment_id uuid;
  v_op_num bigint;
  v_fingerprint text;
  v_cached jsonb;
  v_result jsonb;
  v_storno_result jsonb;
  v_operation_date date;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'hall_rent') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  v_fingerprint := md5(
    coalesce(p_payment_id::text, '') || '|rental_correct|' ||
    coalesce(p_new_amount::text, '') || '|' ||
    coalesce(p_new_method, '') || '|' ||
    coalesce(p_reason_code, '')
  );

  v_cached := check_operation_idempotency(v_org_id, 'correct_rental_payment', v_key::uuid, v_fingerprint);
  IF v_cached IS NOT NULL THEN
    IF (v_cached ->> 'success')::boolean IS NOT TRUE AND v_cached ->> 'error_code' = 'idempotency_conflict' THEN
      RETURN v_cached;
    END IF;
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT member_can_correct_payments() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  IF p_reason_code IS NULL OR trim(p_reason_code) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'corrections.payment.reasonRequired');
  END IF;

  IF p_new_amount IS NULL OR p_new_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'corrections.payment.amountInvalid');
  END IF;

  IF p_new_method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.paymentMethodInvalid');
  END IF;

  SELECT * INTO v_payment
  FROM rental_payments
  WHERE id = p_payment_id AND organization_id = v_org_id;

  IF NOT FOUND OR v_payment.operation_kind <> 'payment' THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.paymentNotFound');
  END IF;

  IF rental_payment_remaining_amount(v_org_id, p_payment_id) <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'corrections.rental.alreadyVoided');
  END IF;

  v_storno_result := _storno_rental_payment_impl(
    v_org_id, v_member_id, p_payment_id, NULL,
    p_reason_code, p_reason_comment,
    v_key, 'correct_rental_payment_storno', v_fingerprint || ':storno'
  );

  IF (v_storno_result ->> 'success')::boolean IS NOT TRUE THEN
    RETURN v_storno_result;
  END IF;

  v_storno_id := (v_storno_result ->> 'storno_id')::uuid;
  v_op_num := next_correction_operation_number(v_org_id);
  v_operation_date := _org_local_date(v_org_id);

  INSERT INTO rental_payments (
    organization_id, rental_id, amount, currency, method, method_comment,
    created_by, operation_kind, replaces_payment_id,
    correction_reason_code, correction_comment, operation_number,
    idempotency_key, idempotency_scope, payload_fingerprint, operation_date
  )
  VALUES (
    v_payment.organization_id, v_payment.rental_id, p_new_amount, v_payment.currency,
    p_new_method, p_reason_comment,
    v_member_id, 'payment', v_payment.id,
    p_reason_code, p_reason_comment, v_op_num,
    v_key, 'correct_rental_payment', v_fingerprint || ':payment', v_operation_date
  )
  RETURNING id INTO v_new_payment_id;

  UPDATE rentals SET updated_at = now()
  WHERE id = v_payment.rental_id AND organization_id = v_org_id;

  v_result := jsonb_build_object(
    'success', true,
    'payment_id', v_new_payment_id,
    'storno_id', v_storno_id,
    'operation_number', v_op_num,
    'paid_total', _rental_paid_total(v_payment.rental_id, v_org_id)
  );

  IF v_key IS NOT NULL THEN
    PERFORM store_operation_idempotency(v_org_id, 'correct_rental_payment', v_key::uuid, v_fingerprint, v_result);
  END IF;

  RETURN v_result;
END;
$$;


-- record_rental_advance from 20261128000008_record_rental_advance_wallet_sync.sql
CREATE OR REPLACE FUNCTION record_rental_advance(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_key text := NULLIF(trim(p_payload ->> 'idempotency_key'), '');
  v_existing rental_advances%ROWTYPE;
  v_advance_id uuid;
  v_renter_id uuid := (p_payload ->> 'renter_id')::uuid;
  v_amount numeric := (p_payload ->> 'amount')::numeric;
  v_operation_date date;
  v_today date;
  v_payload_date text := NULLIF(trim(p_payload ->> 'operation_date'), '');
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'hall_rent') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_financial() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  IF v_renter_id IS NULL OR v_amount IS NULL OR v_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.advance.fieldsInvalid');
  END IF;

  v_today := _org_local_date(v_org_id);
  v_operation_date := COALESCE(
    CASE WHEN v_payload_date IS NOT NULL THEN v_payload_date::date ELSE NULL END,
    v_today
  );

  IF v_operation_date > v_today THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.operationDateFuture');
  END IF;

  IF _is_finance_period_closed(v_org_id, v_operation_date) THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.periodClosed');
  END IF;

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM rental_advances ra
    WHERE ra.organization_id = v_org_id AND ra.idempotency_key = v_key;

    IF FOUND THEN
      PERFORM _renter_wallet_sync_advance_to_wallet(v_existing.id);
      PERFORM _renter_apply_wallet(v_org_id, v_existing.renter_id);
      RETURN jsonb_build_object('success', true, 'advance_id', v_existing.id, 'already_applied', true);
    END IF;
  END IF;

  INSERT INTO rental_advances (
    organization_id, renter_id, amount, currency, method, idempotency_key, created_by, operation_date
  )
  VALUES (
    v_org_id,
    v_renter_id,
    v_amount,
    COALESCE(NULLIF(p_payload ->> 'currency', ''), 'RUB'),
    COALESCE(NULLIF(p_payload ->> 'method', ''), 'cash'),
    v_key,
    v_member_id,
    v_operation_date
  )
  RETURNING id INTO v_advance_id;

  PERFORM _renter_wallet_sync_advance_to_wallet(v_advance_id);
  PERFORM _renter_apply_wallet(v_org_id, v_renter_id);

  RETURN jsonb_build_object('success', true, 'advance_id', v_advance_id);
EXCEPTION
  WHEN unique_violation THEN
    IF v_key IS NOT NULL THEN
      SELECT id INTO v_advance_id FROM rental_advances WHERE organization_id = v_org_id AND idempotency_key = v_key;
      IF v_advance_id IS NOT NULL THEN
        PERFORM _renter_wallet_sync_advance_to_wallet(v_advance_id);
        PERFORM _renter_apply_wallet(v_org_id, v_renter_id);
        RETURN jsonb_build_object('success', true, 'advance_id', v_advance_id, 'already_applied', true);
      END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.duplicate');
END;
$$;


-- allocate_rental_advance from 20261039000001_renter_miniapp_r1b_wallet_ledger.sql
CREATE OR REPLACE FUNCTION allocate_rental_advance(
  p_advance_id uuid,
  p_invoice_id uuid,
  p_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_advance rental_advances%ROWTYPE;
  v_invoice rental_invoices%ROWTYPE;
  v_allocation_id uuid;
  v_paid numeric;
  v_status text;
  v_available numeric;
  v_wallet_sink numeric;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'hall_rent') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_financial() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.paymentAmountInvalid');
  END IF;

  SELECT * INTO v_advance
  FROM rental_advances ra
  WHERE ra.id = p_advance_id AND ra.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.advance.notFound');
  END IF;

  SELECT * INTO v_invoice
  FROM rental_invoices ri
  WHERE ri.id = p_invoice_id AND ri.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.invoice.notFound');
  END IF;

  IF v_advance.renter_id <> v_invoice.renter_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.advance.renterMismatch');
  END IF;

  IF v_advance.currency <> v_invoice.currency THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.advance.currencyMismatch');
  END IF;

  v_wallet_sink := COALESCE((
    SELECT SUM(l.amount)
    FROM renter_wallet_ledger l
    WHERE l.organization_id = v_org_id
      AND l.advance_id = p_advance_id
      AND l.entry_type = 'topup'
  ), 0);

  -- Wallet-transferred remainder is not allocatable to 2.5 invoices (backfill sink).
  v_available := v_advance.amount - GREATEST(v_advance.allocated_amount, v_wallet_sink);
  IF p_amount > v_available THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.advance.insufficient');
  END IF;

  INSERT INTO rental_advance_allocations (
    organization_id, advance_id, invoice_id, amount, allocated_by
  )
  VALUES (v_org_id, p_advance_id, p_invoice_id, p_amount, v_member_id)
  RETURNING id INTO v_allocation_id;

  UPDATE rental_advances
  SET allocated_amount = allocated_amount + p_amount
  WHERE id = p_advance_id;

  v_paid := _rental_invoice_paid_total(p_invoice_id, v_org_id);
  v_status := _rental_invoice_status(v_invoice.total_amount, v_paid, v_invoice.due_date, v_invoice.status);

  UPDATE rental_invoices
  SET status = v_status, updated_at = now()
  WHERE id = p_invoice_id;

  RETURN jsonb_build_object(
    'success', true,
    'allocation_id', v_allocation_id,
    'paid_amount', v_paid,
    'status', v_status
  );
END;
$$;


-- cancel_rental_advance_allocation from 20260845000001_rental_series_tariffs.sql
CREATE OR REPLACE FUNCTION cancel_rental_advance_allocation(p_allocation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_row rental_advance_allocations%ROWTYPE;
  v_invoice rental_invoices%ROWTYPE;
  v_paid numeric;
  v_status text;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'hall_rent') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_financial() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  SELECT * INTO v_row
  FROM rental_advance_allocations raa
  WHERE raa.id = p_allocation_id AND raa.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.advance.allocationNotFound');
  END IF;

  IF v_row.cancelled_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'already_applied', true);
  END IF;

  UPDATE rental_advance_allocations
  SET cancelled_at = now()
  WHERE id = p_allocation_id;

  UPDATE rental_advances
  SET allocated_amount = allocated_amount - v_row.amount
  WHERE id = v_row.advance_id AND organization_id = v_org_id;

  SELECT * INTO v_invoice FROM rental_invoices WHERE id = v_row.invoice_id AND organization_id = v_org_id;
  v_paid := _rental_invoice_paid_total(v_row.invoice_id, v_org_id);
  v_status := _rental_invoice_status(v_invoice.total_amount, v_paid, v_invoice.due_date, v_invoice.status);

  UPDATE rental_invoices SET status = v_status, updated_at = now() WHERE id = v_row.invoice_id;

  RETURN jsonb_build_object('success', true, 'allocation_id', p_allocation_id, 'status', v_status);
END;
$$;


-- record_rental_deposit_movement from 20260845000001_rental_series_tariffs.sql
CREATE OR REPLACE FUNCTION record_rental_deposit_movement(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_key text := NULLIF(trim(p_payload ->> 'idempotency_key'), '');
  v_existing rental_deposit_movements%ROWTYPE;
  v_deposit_id uuid := NULLIF(p_payload ->> 'deposit_id', '')::uuid;
  v_renter_id uuid := (p_payload ->> 'renter_id')::uuid;
  v_contract_id uuid := NULLIF(p_payload ->> 'contract_id', '')::uuid;
  v_movement_type text := NULLIF(trim(p_payload ->> 'movement_type'), '');
  v_amount numeric := (p_payload ->> 'amount')::numeric;
  v_invoice_id uuid := NULLIF(p_payload ->> 'invoice_id', '')::uuid;
  v_movement_id uuid;
  v_delta numeric;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'hall_rent') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_financial() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  IF v_movement_type NOT IN ('receive', 'hold', 'return', 'apply_to_invoice')
     OR v_amount IS NULL OR v_amount <= 0
     OR NULLIF(trim(p_payload ->> 'reason'), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.deposit.fieldsInvalid');
  END IF;

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM rental_deposit_movements rdm
    WHERE rdm.organization_id = v_org_id AND rdm.idempotency_key = v_key;

    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'movement_id', v_existing.id, 'already_applied', true);
    END IF;
  END IF;

  IF v_deposit_id IS NULL THEN
    IF v_renter_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'rental.deposit.fieldsInvalid');
    END IF;

    INSERT INTO rental_deposits (
      organization_id, renter_id, contract_id, required_amount, balance, currency
    )
    VALUES (
      v_org_id,
      v_renter_id,
      v_contract_id,
      COALESCE((p_payload ->> 'required_amount')::numeric, 0),
      0,
      COALESCE(NULLIF(p_payload ->> 'currency', ''), 'RUB')
    )
    RETURNING id INTO v_deposit_id;
  ELSE
    PERFORM 1 FROM rental_deposits rd WHERE rd.id = v_deposit_id AND rd.organization_id = v_org_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'rental.deposit.notFound');
    END IF;
  END IF;

  v_delta := CASE v_movement_type
    WHEN 'receive' THEN v_amount
    WHEN 'return' THEN -v_amount
    WHEN 'hold' THEN -v_amount
    WHEN 'apply_to_invoice' THEN -v_amount
  END;

  IF v_movement_type = 'apply_to_invoice' AND v_invoice_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.deposit.invoiceRequired');
  END IF;

  INSERT INTO rental_deposit_movements (
    organization_id, deposit_id, movement_type, amount, reason, invoice_id, idempotency_key, created_by
  )
  VALUES (
    v_org_id, v_deposit_id, v_movement_type, v_amount,
    trim(p_payload ->> 'reason'), v_invoice_id, v_key, v_member_id
  )
  RETURNING id INTO v_movement_id;

  UPDATE rental_deposits
  SET balance = balance + v_delta, updated_at = now()
  WHERE id = v_deposit_id AND organization_id = v_org_id;

  IF v_movement_type = 'apply_to_invoice' THEN
    PERFORM record_rental_invoice_payment(v_invoice_id, v_amount, 'transfer', CASE WHEN v_key IS NOT NULL THEN v_key || ':deposit' END);
  END IF;

  RETURN jsonb_build_object('success', true, 'movement_id', v_movement_id, 'deposit_id', v_deposit_id);
EXCEPTION
  WHEN unique_violation THEN
    IF v_key IS NOT NULL THEN
      SELECT id INTO v_movement_id FROM rental_deposit_movements WHERE organization_id = v_org_id AND idempotency_key = v_key;
      IF v_movement_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'movement_id', v_movement_id, 'already_applied', true);
      END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.duplicate');
END;
$$;


-- apply_rental_pricing_adjustment from 20261125000001_staff_cashier_rental_wallet_hold.sql
CREATE OR REPLACE FUNCTION apply_rental_pricing_adjustment(
  p_rental_id uuid,
  p_new_amount numeric,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_denied jsonb;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'hall_rent') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  v_denied := _rental_reject_miniapp_money_write(auth_organization_id(), p_rental_id);
  IF v_denied IS NOT NULL THEN
    RETURN v_denied;
  END IF;
  RETURN _cashier_apply_rental_pricing_adjustment(p_rental_id, p_new_amount, p_reason);
END;
$$;


-- upsert_rental_tariff from 20260845000001_rental_series_tariffs.sql
CREATE OR REPLACE FUNCTION upsert_rental_tariff(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_tariff_id uuid := NULLIF(p_payload ->> 'tariff_id', '')::uuid;
  v_name text := NULLIF(trim(p_payload ->> 'name'), '');
  v_type text := COALESCE(NULLIF(p_payload ->> 'tariff_type', ''), 'hourly');
  v_status text := COALESCE(NULLIF(p_payload ->> 'status', ''), 'active');
  v_location_id uuid := NULLIF(p_payload ->> 'location_id', '')::uuid;
  v_price numeric := COALESCE((p_payload ->> 'price')::numeric, 0);
  v_rule jsonb;
  v_rule_id uuid;
  v_overlap text;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'hall_rent') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT member_can_manage_rentals() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
  END IF;

  IF NOT can_read_financial() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  IF v_name IS NULL OR v_type NOT IN ('hourly', 'fixed') OR v_status NOT IN ('active', 'archived') THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.tariff.fieldsInvalid');
  END IF;

  IF v_price < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.tariff.priceInvalid');
  END IF;

  IF v_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM locations l WHERE l.id = v_location_id AND l.organization_id = v_org_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.locationInvalid');
  END IF;

  IF v_tariff_id IS NULL THEN
    INSERT INTO rental_tariffs (
      organization_id, name, tariff_type, location_id, price, currency,
      min_duration_minutes, rounding_step_minutes, valid_from, valid_to, status
    )
    VALUES (
      v_org_id,
      v_name,
      v_type,
      v_location_id,
      v_price,
      COALESCE(NULLIF(p_payload ->> 'currency', ''), 'RUB'),
      COALESCE((p_payload ->> 'min_duration_minutes')::int, 0),
      GREATEST(COALESCE((p_payload ->> 'rounding_step_minutes')::int, 1), 1),
      NULLIF(p_payload ->> 'valid_from', '')::date,
      NULLIF(p_payload ->> 'valid_to', '')::date,
      v_status
    )
    RETURNING id INTO v_tariff_id;
  ELSE
    UPDATE rental_tariffs
    SET
      name = v_name,
      tariff_type = v_type,
      location_id = v_location_id,
      price = v_price,
      currency = COALESCE(NULLIF(p_payload ->> 'currency', ''), currency),
      min_duration_minutes = COALESCE((p_payload ->> 'min_duration_minutes')::int, min_duration_minutes),
      rounding_step_minutes = GREATEST(COALESCE((p_payload ->> 'rounding_step_minutes')::int, rounding_step_minutes), 1),
      valid_from = CASE WHEN p_payload ? 'valid_from' THEN NULLIF(p_payload ->> 'valid_from', '')::date ELSE valid_from END,
      valid_to = CASE WHEN p_payload ? 'valid_to' THEN NULLIF(p_payload ->> 'valid_to', '')::date ELSE valid_to END,
      status = v_status,
      updated_at = now()
    WHERE id = v_tariff_id AND organization_id = v_org_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'rental.tariff.notFound');
    END IF;
  END IF;

  IF p_payload ? 'rules' THEN
    DELETE FROM rental_tariff_rules r
    WHERE r.tariff_id = v_tariff_id AND r.organization_id = v_org_id;

    FOR v_rule IN SELECT value FROM jsonb_array_elements(p_payload -> 'rules') LOOP
      INSERT INTO rental_tariff_rules (
        organization_id, tariff_id, priority, days_of_week, time_start, time_end,
        price_override, valid_from, valid_to
      )
      VALUES (
        v_org_id,
        v_tariff_id,
        COALESCE((v_rule ->> 'priority')::int, 0),
        ARRAY(SELECT value::int FROM jsonb_array_elements_text(v_rule -> 'days_of_week') AS t(value)),
        normalize_hhmm(v_rule ->> 'time_start'),
        normalize_hhmm(v_rule ->> 'time_end'),
        COALESCE((v_rule ->> 'price_override')::numeric, v_price),
        NULLIF(v_rule ->> 'valid_from', '')::date,
        NULLIF(v_rule ->> 'valid_to', '')::date
      );
    END LOOP;
  END IF;

  v_overlap := _validate_tariff_rules_no_ambiguous_overlap(v_tariff_id, v_org_id);
  IF v_overlap IS NOT NULL THEN
    RAISE EXCEPTION '%', v_overlap USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('success', true, 'tariff_id', v_tariff_id);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


-- upsert_location_rental_hour_rate from 20261041000002_renter_miniapp_r1d_staff_rpc.sql
CREATE OR REPLACE FUNCTION upsert_location_rental_hour_rate(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_loc uuid;
  v_kind text;
  v_price numeric;
  v_from date;
  v_id uuid;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'hall_rent') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_manage_settings() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
  END IF;

  v_loc := NULLIF(p_payload ->> 'location_id', '')::uuid;
  v_kind := NULLIF(trim(p_payload ->> 'kind'), '');
  v_price := NULLIF(p_payload ->> 'price', '')::numeric;
  v_from := COALESCE(NULLIF(p_payload ->> 'valid_from', '')::date, _org_local_date(v_org_id));

  IF v_loc IS NULL OR v_kind IS NULL OR v_price IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.rates.fieldsInvalid');
  END IF;

  IF v_kind NOT IN ('one_time', 'recurring', 'penalty') THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.rates.kindInvalid');
  END IF;

  IF v_price < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.rates.priceInvalid');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM locations loc
    WHERE loc.id = v_loc AND loc.organization_id = v_org_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.rates.locationInvalid');
  END IF;

  INSERT INTO location_rental_hour_rates (
    organization_id, location_id, kind, price, valid_from
  )
  VALUES (v_org_id, v_loc, v_kind, v_price, v_from)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.rates.fieldsInvalid');
END;
$$;


-- staff_renter_wallet_topup from 20261087000001_renter_miniapp_topup_currency_max.sql
CREATE OR REPLACE FUNCTION staff_renter_wallet_topup(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_org uuid := auth_organization_id();
  v_member uuid := auth_member_id();
  v_renter uuid;
  v_amount numeric;
  v_method text;
  v_key uuid;
  v_fp text;
  v_cached jsonb;
  v_currency text;
  v_advance uuid;
  v_external_ref text;
  v_result jsonb;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'hall_rent') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;
  IF NOT member_can_record_rental_payment() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  v_renter := NULLIF(p_payload ->> 'renter_id', '')::uuid;
  v_currency := _renter_org_currency(v_org);
  v_amount := _renter_round_money((p_payload ->> 'amount')::numeric, v_currency);
  v_method := COALESCE(NULLIF(trim(p_payload ->> 'method'), ''), 'cash');
  v_key := NULLIF(p_payload ->> 'idempotency_key', '')::uuid;
  v_external_ref := NULLIF(trim(p_payload ->> 'external_reference'), '');

  IF v_renter IS NULL OR v_amount IS NULL OR v_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.amountInvalid');
  END IF;
  IF v_amount > _renter_topup_amount_max(v_currency) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.amountTooLarge');
  END IF;
  IF v_method NOT IN ('qr', 'cash') THEN
    v_method := 'cash';
  END IF;
  IF v_key IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.idempotencyRequired');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM renters r WHERE r.id = v_renter AND r.organization_id = v_org
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.notFound');
  END IF;

  v_fp := md5(v_renter::text || ':' || v_amount::text || ':' || v_method);

  PERFORM _renter_acquire_miniapp_locks(v_org, v_renter, '[]'::jsonb);

  v_cached := claim_operation_idempotency(v_org, 'staff_renter_wallet_topup', v_key, v_fp);
  IF v_cached IS NOT NULL THEN
    IF v_cached ->> 'error_code' = 'idempotency_conflict' THEN
      RETURN v_cached;
    END IF;
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  v_advance := _renter_credit_wallet_topup(
    v_org, v_renter, v_amount, v_method, v_member, NULL, 'staff_wallet_topup', v_external_ref
  );

  v_result := jsonb_build_object(
    'success', true,
    'advance_id', v_advance,
    'amount', v_amount
  );
  PERFORM store_operation_idempotency(v_org, 'staff_renter_wallet_topup', v_key, v_fp, v_result);
  RETURN v_result;
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


-- staff_renter_wallet_adjust from 20261112000001_renter_wallet_balance_correction.sql
CREATE OR REPLACE FUNCTION staff_renter_wallet_adjust(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_org uuid := auth_organization_id();
  v_member uuid := auth_member_id();
  v_renter uuid;
  v_target numeric;
  v_reason text;
  v_key uuid;
  v_fp text;
  v_cached jsonb;
  v_currency text;
  v_quote jsonb;
  v_current numeric;
  v_min numeric;
  v_max numeric;
  v_delta numeric;
  v_today date;
  v_ledger uuid;
  v_result jsonb;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'hall_rent') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;
  IF NOT member_can_adjust_renter_wallet() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  v_renter := NULLIF(p_payload ->> 'renter_id', '')::uuid;
  v_reason := NULLIF(trim(COALESCE(p_payload ->> 'reason', '')), '');
  v_key := NULLIF(p_payload ->> 'idempotency_key', '')::uuid;
  v_currency := _renter_org_currency(v_org);
  v_max := _renter_topup_amount_max(v_currency);
  v_target := _renter_round_money((p_payload ->> 'target_amount')::numeric, v_currency);

  IF v_renter IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.notFound');
  END IF;
  IF v_key IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.walletAdjust.idempotencyRequired');
  END IF;
  IF v_reason IS NULL OR length(v_reason) < 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.walletAdjust.reasonRequired');
  END IF;
  IF v_target IS NULL OR v_target < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.walletAdjust.amountInvalid');
  END IF;
  IF v_target > v_max THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.amountTooLarge');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM renters r WHERE r.id = v_renter AND r.organization_id = v_org
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.notFound');
  END IF;

  v_today := _org_local_date(v_org);
  IF _is_finance_period_closed(v_org, v_today) THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.periodClosed');
  END IF;
  IF NOT organization_allows_writes(v_org) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.writesDisabled');
  END IF;

  v_fp := md5(v_renter::text || ':' || v_target::text || ':' || v_reason);

  PERFORM _renter_acquire_miniapp_locks(v_org, v_renter, '[]'::jsonb);

  v_cached := claim_operation_idempotency(v_org, 'staff_renter_wallet_adjust', v_key, v_fp);
  IF v_cached IS NOT NULL THEN
    IF v_cached ->> 'error_code' = 'idempotency_conflict' THEN
      RETURN v_cached;
    END IF;
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  v_quote := _renter_wallet_payout_quote(v_org, v_renter);
  v_current := (v_quote ->> 'wallet_balance')::numeric;
  v_min := (v_quote ->> 'obligated')::numeric;
  v_delta := _renter_round_money(v_target - v_current, v_currency);

  IF v_delta = 0 THEN
    PERFORM _renter_raise('renter.walletAdjust.unchanged');
  END IF;
  IF v_target < v_min THEN
    PERFORM _renter_raise('renter.walletAdjust.belowFloor');
  END IF;

  IF v_delta > 0 THEN
    v_ledger := _renter_credit_wallet_correction(v_org, v_renter, v_delta, v_member, v_reason);
  ELSE
    INSERT INTO renter_wallet_ledger (
      organization_id, renter_id, entry_type, amount, rental_id, advance_id, phase,
      correction_reason, created_by
    )
    VALUES (
      v_org, v_renter, 'wallet_correction_debit', abs(v_delta), NULL, NULL, NULL,
      v_reason, v_member
    )
    RETURNING id INTO v_ledger;

    PERFORM _renter_reduce_wallet_advances(v_org, v_renter, abs(v_delta));
  END IF;

  PERFORM _renter_apply_wallet(v_org, v_renter);
  PERFORM _renter_assert_wallet_invariant(v_org, v_renter);

  v_quote := _renter_wallet_payout_quote(v_org, v_renter);

  v_result := jsonb_build_object(
    'success', true,
    'ledger_id', v_ledger,
    'target_amount', v_target,
    'delta', abs(v_delta),
    'direction', CASE WHEN v_delta > 0 THEN 'credit' ELSE 'debit' END,
    'wallet_balance_after', (v_quote ->> 'wallet_balance')::numeric,
    'spendable_after', (v_quote ->> 'spendable')::numeric,
    'reserved_prepay_after', (v_quote ->> 'reserved_prepay')::numeric
  );
  PERFORM store_operation_idempotency(v_org, 'staff_renter_wallet_adjust', v_key, v_fp, v_result);
  RETURN v_result;
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


-- archive_renter from 20260844000001_renters_crm.sql
CREATE OR REPLACE FUNCTION archive_renter(
  p_renter_id uuid,
  p_force boolean DEFAULT false,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_renter renters%ROWTYPE;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'hall_rent') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;

  IF NOT member_can_manage_rentals() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  SELECT * INTO v_renter
  FROM renters r
  WHERE r.id = p_renter_id AND r.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.notFound');
  END IF;

  IF v_renter.status = 'archived' THEN
    RETURN jsonb_build_object('success', true, 'already_applied', true);
  END IF;

  IF NOT p_force AND _renter_has_active_or_future_rental(p_renter_id, v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.activeRentalsExist');
  END IF;

  UPDATE renters
  SET
    status = 'archived',
    archived_at = now(),
    blocked_reason = NULL,
    internal_notes = CASE
      WHEN NULLIF(trim(p_reason), '') IS NOT NULL
        THEN trim(both E'\n' FROM concat_ws(E'\n', internal_notes, 'Archived: ' || trim(p_reason)))
      ELSE internal_notes
    END
  WHERE id = p_renter_id;

  RETURN jsonb_build_object('success', true, 'renter_id', p_renter_id);
END;
$$;


-- accept_venue_cost_rule_version from 20260900000002_venue_cost_group_reprice.sql
CREATE OR REPLACE FUNCTION accept_venue_cost_rule_version(
  p_rule_version_id uuid,
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
  v_rule venue_cost_rule_versions%ROWTYPE;
  v_cursor date;
  v_period_from date;
  v_period_to date;
  v_result jsonb;
  v_cached jsonb;
  v_fingerprint text := md5(COALESCE(p_rule_version_id::text, ''));
  v_closure record;
  v_loc_row record;
  v_has_locations boolean;
  v_repriced_zero integer := 0;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'hall_rent') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  v_cached := check_operation_idempotency(v_org_id, 'accept_venue_cost_rule_version', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT member_can_manage_venue_cost_rules() THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_org_id::text || ':venue-rules', 0));
  SELECT * INTO v_rule
  FROM venue_cost_rule_versions
  WHERE id = p_rule_version_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'rule_not_found');
  END IF;
  IF v_rule.status = 'accepted' THEN
    RETURN jsonb_build_object('success', true, 'rule_version_id', v_rule.id, 'already_applied', true);
  END IF;
  IF NOT venue_cost_rule_references_are_valid(v_org_id, v_rule.mode, v_rule.rules) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_rule_reference');
  END IF;
  IF venue_cost_versions_have_conflict(
    v_org_id,
    v_rule.id,
    v_rule.mode,
    v_rule.rules,
    v_rule.valid_from,
    v_rule.valid_to
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'accepted_rule_overlap');
  END IF;

  UPDATE venue_cost_rule_versions
  SET status = 'accepted', accepted_by = v_member_id, accepted_at = now()
  WHERE id = v_rule.id
  RETURNING * INTO v_rule;

  IF v_rule.mode = 'fixed_period' THEN
    v_has_locations := jsonb_array_length(COALESCE(v_rule.rules -> 'locations', '[]'::jsonb)) > 0;
    v_cursor := v_rule.valid_from;
    WHILE v_cursor <= v_rule.valid_to LOOP
      v_period_from := v_cursor;
      IF v_rule.rules ->> 'period' = 'week' THEN
        v_period_to := LEAST(v_rule.valid_to, v_cursor + 6);
        v_cursor := v_period_to + 1;
      ELSIF v_rule.rules ->> 'period' = 'month' THEN
        v_period_to := LEAST(v_rule.valid_to, (date_trunc('month', v_cursor) + interval '1 month - 1 day')::date);
        v_cursor := v_period_to + 1;
      ELSE
        v_period_to := v_rule.valid_to;
        v_cursor := v_rule.valid_to + 1;
      END IF;

      IF v_has_locations THEN
        FOR v_loc_row IN
          SELECT
            NULLIF(elem ->> 'location_id', '')::uuid AS location_id,
            round((elem ->> 'amount')::numeric, 2) AS amount
          FROM jsonb_array_elements(v_rule.rules -> 'locations') elem
        LOOP
          INSERT INTO venue_cost_accruals (
            organization_id, rule_version_id, location_id, accrual_kind, accrual_status, accrual_date,
            period_from, period_to, amount, currency, rule_snapshot, source_snapshot, created_by
          ) VALUES (
            v_org_id, v_rule.id, v_loc_row.location_id, 'fixed_period', 'posted', v_period_to,
            v_period_from, v_period_to, v_loc_row.amount,
            COALESCE(NULLIF(v_rule.rules ->> 'currency', ''), 'RUB'),
            to_jsonb(v_rule),
            jsonb_build_object('period', v_rule.rules ->> 'period', 'location_id', v_loc_row.location_id),
            v_member_id
          );
        END LOOP;
      ELSE
        INSERT INTO venue_cost_accruals (
          organization_id, rule_version_id, location_id, accrual_kind, accrual_status, accrual_date,
          period_from, period_to, amount, currency, rule_snapshot, source_snapshot, created_by
        ) VALUES (
          v_org_id, v_rule.id, NULL, 'fixed_period', 'posted', v_period_to,
          v_period_from, v_period_to, round((v_rule.rules ->> 'amount')::numeric, 2),
          COALESCE(NULLIF(v_rule.rules ->> 'currency', ''), 'RUB'),
          to_jsonb(v_rule), jsonb_build_object('period', v_rule.rules ->> 'period'), v_member_id
        );
      END IF;
    END LOOP;
  END IF;

  FOR v_closure IN
    SELECT c.id
    FROM lesson_occurrence_closures c
    WHERE c.organization_id = v_org_id
      AND c.status = 'closed'
      AND c.pricing_status = 'pending_unpriced'
      AND c.occurrence_date BETWEEN v_rule.valid_from AND COALESCE(v_rule.valid_to, 'infinity'::date)
    ORDER BY c.occurrence_date, c.id
  LOOP
    PERFORM post_venue_cost_for_closure(v_closure.id, v_member_id);
  END LOOP;

  IF v_rule.mode = 'per_lesson' THEN
    v_repriced_zero := venue_cost_reprice_zero_lesson_accruals(v_org_id, v_rule, v_member_id);
  END IF;

  v_result := jsonb_build_object(
    'success', true,
    'rule_version_id', v_rule.id,
    'repriced_zero_lesson_accruals', v_repriced_zero
  );
  PERFORM store_operation_idempotency(v_org_id, 'accept_venue_cost_rule_version', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;


-- save_venue_cost_rule_draft from 20260859000001_hall_rent_accountant_settings.sql
CREATE OR REPLACE FUNCTION save_venue_cost_rule_draft(
  p_payload jsonb,
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
  v_id uuid := NULLIF(p_payload ->> 'id', '')::uuid;
  v_version bigint;
  v_result jsonb;
  v_fingerprint text := md5(COALESCE(p_payload::text, ''));
  v_cached jsonb;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'hall_rent') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  v_cached := check_operation_idempotency(v_org_id, 'save_venue_cost_rule_draft', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT member_can_manage_venue_cost_rules() THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  IF NOT venue_cost_rules_are_valid(
    p_payload ->> 'mode',
    COALESCE(p_payload -> 'rules', '{}'::jsonb)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_rule');
  END IF;

  IF NOT venue_cost_rule_references_are_valid(
    v_org_id,
    p_payload ->> 'mode',
    COALESCE(p_payload -> 'rules', '{}'::jsonb)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_rule_reference');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_org_id::text || ':venue-rules', 0));

  IF v_id IS NULL THEN
    SELECT COALESCE(max(version_number), 0) + 1 INTO v_version
    FROM venue_cost_rule_versions WHERE organization_id = v_org_id;

    INSERT INTO venue_cost_rule_versions (
      organization_id, version_number, mode, valid_from, valid_to, rules, created_by
    ) VALUES (
      v_org_id, v_version, p_payload ->> 'mode',
      (p_payload ->> 'valid_from')::date,
      NULLIF(p_payload ->> 'valid_to', '')::date,
      COALESCE(p_payload -> 'rules', '{}'::jsonb), v_member_id
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE venue_cost_rule_versions
    SET mode = p_payload ->> 'mode',
        valid_from = (p_payload ->> 'valid_from')::date,
        valid_to = NULLIF(p_payload ->> 'valid_to', '')::date,
        rules = COALESCE(p_payload -> 'rules', '{}'::jsonb)
    WHERE id = v_id AND organization_id = v_org_id AND status = 'draft';
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'draft_not_found');
    END IF;
  END IF;

  v_result := jsonb_build_object('success', true, 'rule_version_id', v_id);
  PERFORM store_operation_idempotency(v_org_id, 'save_venue_cost_rule_draft', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
EXCEPTION
  WHEN check_violation OR invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_rule', 'error', SQLERRM);
END;
$$;


-- delete_venue_cost_rule_draft from 20260885000001_delete_venue_cost_rule_draft.sql
CREATE OR REPLACE FUNCTION delete_venue_cost_rule_draft(
  p_rule_version_id uuid,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_result jsonb;
  v_fingerprint text := md5(COALESCE(p_rule_version_id::text, ''));
  v_cached jsonb;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'hall_rent') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  v_cached := check_operation_idempotency(v_org_id, 'delete_venue_cost_rule_draft', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT member_can_manage_venue_cost_rules() THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_org_id::text || ':venue-rules', 0));

  DELETE FROM venue_cost_rule_versions
  WHERE id = p_rule_version_id
    AND organization_id = v_org_id
    AND status = 'draft';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'draft_not_found');
  END IF;

  v_result := jsonb_build_object('success', true, 'rule_version_id', p_rule_version_id);
  PERFORM store_operation_idempotency(v_org_id, 'delete_venue_cost_rule_draft', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;


-- confirm_venue_cost_rule_gap from 20260874000001_hall_rent_integration_fixes_3.sql
CREATE OR REPLACE FUNCTION confirm_venue_cost_rule_gap(
  p_gap_from date,
  p_gap_to date DEFAULT NULL,
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
  v_status jsonb;
  v_expired_rule_id uuid;
  v_result jsonb;
  v_cached jsonb;
  v_fingerprint text := md5(
    concat_ws('|', p_gap_from, COALESCE(p_gap_to::text, ''), COALESCE(p_reason, ''))
  );
  v_ack_id uuid;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'hall_rent') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  v_cached := check_operation_idempotency(v_org_id, 'confirm_venue_cost_rule_gap', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT member_can_manage_venue_cost_rules() THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  IF p_reason IS NULL OR char_length(trim(p_reason)) < 3 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'reason_required');
  END IF;

  IF p_gap_to IS NOT NULL AND p_gap_to < p_gap_from THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_gap_period');
  END IF;

  v_status := venue_cost_status_for_org(
    v_org_id,
    CASE
      WHEN COALESCE((venue_cost_status_for_org(v_org_id, current_date) ->> 'acknowledgement_required')::boolean, false)
        THEN current_date
      ELSE p_gap_from
    END
  );
  v_expired_rule_id := (v_status ->> 'latest_rule_id')::uuid;
  IF v_expired_rule_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'expired_rule_not_found');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM venue_rule_gap_acknowledgements g
    WHERE g.organization_id = v_org_id
      AND g.expired_rule_id = v_expired_rule_id
      AND p_gap_from >= g.gap_from
      AND (g.gap_to IS NULL OR p_gap_from <= g.gap_to)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'gap_already_acknowledged');
  END IF;

  v_status := venue_cost_status_for_org(v_org_id, current_date);
  IF NOT COALESCE((v_status ->> 'acknowledgement_required')::boolean, false)
    AND NOT COALESCE((venue_cost_status_for_org(v_org_id, p_gap_from) ->> 'acknowledgement_required')::boolean, false)
  THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'gap_not_required');
  END IF;

  INSERT INTO venue_rule_gap_acknowledgements (
    organization_id, expired_rule_id, gap_from, gap_to, reason,
    acknowledged_by, status_snapshot, idempotency_key
  ) VALUES (
    v_org_id, v_expired_rule_id, p_gap_from, p_gap_to, trim(p_reason),
    v_member_id, v_status, p_idempotency_key
  )
  RETURNING id INTO v_ack_id;

  v_result := jsonb_build_object(
    'success', true,
    'acknowledgement_id', v_ack_id,
    'venue_rule_status', venue_cost_status_for_org(v_org_id, current_date)
  );
  PERFORM store_operation_idempotency(v_org_id, 'confirm_venue_cost_rule_gap', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;


-- create_calendar_event_with_cancellations from 20260831000001_calendar_events_master_class.sql
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
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'calendar_events') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

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


-- update_calendar_event from 20260831100001_calendar_event_update_payment.sql
CREATE OR REPLACE FUNCTION update_calendar_event(
  p_event_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_event calendar_events%ROWTYPE;
  v_title text;
  v_event_type text;
  v_income_amount numeric;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'calendar_events') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.orgReadOnly');
  END IF;

  IF NOT member_can_manage_calendar_events() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.forbidden');
  END IF;

  SELECT *
  INTO v_event
  FROM calendar_events ce
  WHERE ce.id = p_event_id
    AND ce.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.notFound');
  END IF;

  v_title := COALESCE(NULLIF(trim(p_payload ->> 'title'), ''), v_event.title);
  v_event_type := COALESCE(p_payload ->> 'event_type', v_event.event_type);

  IF v_event_type NOT IN ('master_class', 'open_lesson') THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.typeInvalid');
  END IF;

  v_income_amount := v_event.income_amount;
  IF p_payload ? 'income_amount' THEN
    IF NOT can_read_financial() THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.event.financeForbidden');
    END IF;
    v_income_amount := COALESCE((p_payload ->> 'income_amount')::numeric, 0);
    IF v_income_amount < 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.event.incomeInvalid');
    END IF;
    IF v_event.paid_amount > v_income_amount THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.event.paidExceedsIncome');
    END IF;
  END IF;

  UPDATE calendar_events
  SET
    title = v_title,
    event_type = v_event_type,
    comment = CASE
      WHEN p_payload ? 'comment' THEN NULLIF(trim(p_payload ->> 'comment'), '')
      ELSE comment
    END,
    guest_teacher = CASE
      WHEN p_payload ? 'guest_teacher' THEN NULLIF(trim(p_payload ->> 'guest_teacher'), '')
      ELSE guest_teacher
    END,
    organizer = CASE
      WHEN p_payload ? 'organizer' THEN NULLIF(trim(p_payload ->> 'organizer'), '')
      ELSE organizer
    END,
    planned_guest_count = CASE
      WHEN p_payload ? 'planned_guest_count' THEN (p_payload ->> 'planned_guest_count')::integer
      ELSE planned_guest_count
    END,
    actual_guest_count = CASE
      WHEN p_payload ? 'actual_guest_count' THEN (p_payload ->> 'actual_guest_count')::integer
      ELSE actual_guest_count
    END,
    income_amount = v_income_amount,
    payment_comment = CASE
      WHEN p_payload ? 'payment_comment' AND can_read_financial()
        THEN NULLIF(trim(p_payload ->> 'payment_comment'), '')
      ELSE payment_comment
    END,
    payment_status = _calendar_event_payment_status(v_income_amount, paid_amount),
    updated_at = now()
  WHERE id = p_event_id;

  RETURN jsonb_build_object('success', true, 'event_id', p_event_id);
END;
$$;


-- update_calendar_event_with_cancellations from 20260831200001_calendar_event_sessions_update.sql
CREATE OR REPLACE FUNCTION update_calendar_event_with_cancellations(
  p_event_id uuid,
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
  v_event calendar_events%ROWTYPE;
  v_sessions jsonb;
  v_group_cancels jsonb;
  v_personal_cancels jsonb;
  v_session jsonb;
  v_date date;
  v_time_start text;
  v_time_end text;
  v_location_id uuid;
  v_session_id uuid;
  v_keep_ids uuid[] := ARRAY[]::uuid[];
  v_title text;
  v_event_type text;
  v_income_amount numeric;
  v_slot_id uuid;
  v_lesson_id uuid;
  v_slot schedule_slots%ROWTYPE;
  v_cancel jsonb;
  v_cancel_dates date[];
  v_sorted date[];
  v_conflict_count integer;
  v_selected_group integer;
  v_selected_personal integer;
  v_total_conflicts integer;
  v_group_cancel_count integer := 0;
  v_personal_cancel_count integer := 0;
  v_preview jsonb;
  v_conflict jsonb;
  v_matched integer;
  v_i integer;
  v_j integer;
  v_a jsonb;
  v_b jsonb;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'calendar_events') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.orgReadOnly');
  END IF;

  IF NOT member_can_manage_calendar_events() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.forbidden');
  END IF;

  SELECT *
  INTO v_event
  FROM calendar_events ce
  WHERE ce.id = p_event_id
    AND ce.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.notFound');
  END IF;

  v_sessions := COALESCE(p_payload -> 'sessions', '[]'::jsonb);
  v_group_cancels := COALESCE(p_payload -> 'group_cancellations', '[]'::jsonb);
  v_personal_cancels := COALESCE(p_payload -> 'personal_cancellations', '[]'::jsonb);

  IF jsonb_typeof(v_sessions) <> 'array' OR jsonb_array_length(v_sessions) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.sessionsEmpty');
  END IF;

  v_title := COALESCE(NULLIF(trim(p_payload ->> 'title'), ''), v_event.title);
  v_event_type := COALESCE(p_payload ->> 'event_type', v_event.event_type);

  IF v_event_type NOT IN ('master_class', 'open_lesson') THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.typeInvalid');
  END IF;

  v_income_amount := v_event.income_amount;
  IF p_payload ? 'income_amount' THEN
    IF NOT can_read_financial() THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.event.financeForbidden');
    END IF;
    v_income_amount := COALESCE((p_payload ->> 'income_amount')::numeric, 0);
    IF v_income_amount < 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.event.incomeInvalid');
    END IF;
    IF v_event.paid_amount > v_income_amount THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.event.paidExceedsIncome');
    END IF;
  END IF;

  FOR v_i IN 0 .. jsonb_array_length(v_sessions) - 1 LOOP
    FOR v_j IN v_i + 1 .. jsonb_array_length(v_sessions) - 1 LOOP
      v_a := v_sessions -> v_i;
      v_b := v_sessions -> v_j;
      IF (v_a ->> 'date')::date = (v_b ->> 'date')::date
        AND (v_a ->> 'location_id')::uuid IS NOT DISTINCT FROM (v_b ->> 'location_id')::uuid
        AND schedule_time_ranges_overlap(
          normalize_hhmm(v_a ->> 'time_start'),
          normalize_hhmm(v_a ->> 'time_end'),
          normalize_hhmm(v_b ->> 'time_start'),
          normalize_hhmm(v_b ->> 'time_end')
        ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'schedule.event.sessionOverlap');
      END IF;
    END LOOP;
  END LOOP;

  FOR v_session IN SELECT value FROM jsonb_array_elements(v_sessions) LOOP
    v_session_id := NULLIF(v_session ->> 'session_id', '')::uuid;
    v_date := (v_session ->> 'date')::date;
    v_time_start := normalize_hhmm(v_session ->> 'time_start');
    v_time_end := normalize_hhmm(v_session ->> 'time_end');
    v_location_id := (v_session ->> 'location_id')::uuid;

    IF v_time_end <= v_time_start THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.event.sessionInvalid');
    END IF;

    IF v_session_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1
        FROM calendar_event_sessions ces
        WHERE ces.id = v_session_id
          AND ces.event_id = p_event_id
          AND ces.organization_id = v_org_id
      ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'schedule.event.sessionNotFound');
      END IF;
      v_keep_ids := array_append(v_keep_ids, v_session_id);
    END IF;
  END LOOP;

  v_preview := preview_calendar_event_conflicts(v_sessions, p_event_id);
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
    ELSIF v_conflict ->> 'kind' = 'event' THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.event.eventConflict');
    END IF;
  END LOOP;

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

  UPDATE calendar_events
  SET
    title = v_title,
    event_type = v_event_type,
    comment = CASE
      WHEN p_payload ? 'comment' THEN NULLIF(trim(p_payload ->> 'comment'), '')
      ELSE comment
    END,
    guest_teacher = CASE
      WHEN p_payload ? 'guest_teacher' THEN NULLIF(trim(p_payload ->> 'guest_teacher'), '')
      ELSE guest_teacher
    END,
    organizer = CASE
      WHEN p_payload ? 'organizer' THEN NULLIF(trim(p_payload ->> 'organizer'), '')
      ELSE organizer
    END,
    planned_guest_count = CASE
      WHEN p_payload ? 'planned_guest_count' THEN (p_payload ->> 'planned_guest_count')::integer
      ELSE planned_guest_count
    END,
    actual_guest_count = CASE
      WHEN p_payload ? 'actual_guest_count' THEN (p_payload ->> 'actual_guest_count')::integer
      ELSE actual_guest_count
    END,
    income_amount = v_income_amount,
    payment_comment = CASE
      WHEN p_payload ? 'payment_comment' AND can_read_financial()
        THEN NULLIF(trim(p_payload ->> 'payment_comment'), '')
      ELSE payment_comment
    END,
    payment_status = _calendar_event_payment_status(v_income_amount, paid_amount),
    updated_at = now()
  WHERE id = p_event_id;

  DELETE FROM calendar_event_sessions ces
  WHERE ces.event_id = p_event_id
    AND ces.organization_id = v_org_id
    AND NOT (ces.id = ANY (v_keep_ids));

  FOR v_session IN SELECT value FROM jsonb_array_elements(v_sessions) LOOP
    v_session_id := NULLIF(v_session ->> 'session_id', '')::uuid;
    v_date := (v_session ->> 'date')::date;
    v_time_start := normalize_hhmm(v_session ->> 'time_start');
    v_time_end := normalize_hhmm(v_session ->> 'time_end');
    v_location_id := (v_session ->> 'location_id')::uuid;

    IF schedule_location_has_conflict(
      v_org_id, v_date, v_time_start, v_time_end, v_location_id, NULL, p_event_id
    ) THEN
      RAISE EXCEPTION 'schedule.event.slotConflict' USING ERRCODE = 'P0001';
    END IF;

    IF v_session_id IS NOT NULL THEN
      UPDATE calendar_event_sessions ces
      SET
        session_date = v_date,
        time_start = v_time_start,
        time_end = v_time_end,
        location_id = v_location_id
      WHERE ces.id = v_session_id
        AND ces.event_id = p_event_id
        AND ces.organization_id = v_org_id;
    ELSE
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
        p_event_id,
        v_date,
        v_time_start,
        v_time_end,
        v_location_id
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'session_count', jsonb_array_length(v_sessions),
    'group_cancel_count', v_group_cancel_count,
    'personal_cancel_count', v_personal_cancel_count
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


-- record_calendar_event_payment from 20261013000001_s11_finance_period_main_cash.sql
CREATE OR REPLACE FUNCTION record_calendar_event_payment(
  p_event_id uuid,
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
  v_event calendar_events%ROWTYPE;
  v_key text := NULLIF(trim(p_idempotency_key), '');
  v_existing other_income%ROWTYPE;
  v_payment_id uuid;
  v_new_paid numeric;
  v_new_status text;
  v_operation_date date;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'calendar_events') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.orgReadOnly');
  END IF;

  IF NOT can_read_financial() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.financeForbidden');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.paymentAmountInvalid');
  END IF;

  IF p_method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.paymentMethodInvalid');
  END IF;

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM other_income oi
    WHERE oi.organization_id = v_org_id
      AND oi.idempotency_key = v_key;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'payment_id', v_existing.id,
        'already_applied', true
      );
    END IF;
  END IF;

  v_operation_date := _calendar_event_operation_date(v_org_id, p_event_id);
  IF _is_finance_period_closed(v_org_id, v_operation_date) THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.periodClosed');
  END IF;

  SELECT *
  INTO v_event
  FROM calendar_events ce
  WHERE ce.id = p_event_id
    AND ce.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.notFound');
  END IF;

  IF v_event.payment_status = 'paid'
    AND COALESCE(v_event.income_amount, 0) > 0
    AND v_event.paid_amount >= v_event.income_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.alreadyPaid');
  END IF;

  v_new_paid := v_event.paid_amount + p_amount;

  IF COALESCE(v_event.income_amount, 0) > 0 AND v_new_paid > v_event.income_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.paidExceedsIncome');
  END IF;

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
    p_event_id,
    p_amount,
    v_event.currency,
    p_method,
    NULLIF(trim(p_method_comment), ''),
    v_key,
    v_member_id
  )
  RETURNING id INTO v_payment_id;

  v_new_status := _calendar_event_payment_status(v_event.income_amount, v_new_paid);

  UPDATE calendar_events
  SET
    paid_amount = v_new_paid,
    payment_status = v_new_status,
    updated_at = now()
  WHERE id = p_event_id;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'paid_amount', v_new_paid,
    'payment_status', v_new_status
  );
EXCEPTION
  WHEN unique_violation THEN
    IF v_key IS NOT NULL THEN
      SELECT id INTO v_payment_id
      FROM other_income
      WHERE organization_id = v_org_id AND idempotency_key = v_key;

      IF v_payment_id IS NOT NULL THEN
        RETURN jsonb_build_object(
          'success', true,
          'payment_id', v_payment_id,
          'already_applied', true
        );
      END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.duplicate');
END;
$$;


-- renter_create_booking from 20261123000001_rental_slot_purpose_miniapp.sql
CREATE OR REPLACE FUNCTION renter_create_booking(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_ctx record;
  v_org uuid;
  v_renter uuid;
  v_member uuid;
  v_loc uuid;
  v_date date;
  v_start text;
  v_end text;
  v_key text;
  v_purpose text;
  v_existing rentals%ROWTYPE;
  v_counts record;
  v_id uuid;
  v_extra jsonb;
  v_check jsonb;
  v_reasons text[];
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'renter_miniapp') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  SELECT * INTO v_ctx FROM _renter_actor_ctx();
  v_org := v_ctx.org_id;
  v_member := v_ctx.member_id;

  IF v_ctx.is_renter THEN
    v_renter := v_ctx.jwt_renter_id;
  ELSE
    v_renter := NULLIF(p_payload ->> 'renter_id', '')::uuid;
    IF v_renter IS NULL THEN
      PERFORM _renter_raise('renter.booking.fieldsInvalid');
    END IF;
    PERFORM _renter_staff_create_renter_ok(v_org, v_renter);
  END IF;

  v_loc := NULLIF(p_payload ->> 'location_id', '')::uuid;
  v_date := (p_payload ->> 'rental_date')::date;
  v_start := normalize_hhmm(p_payload ->> 'time_start');
  v_end := normalize_hhmm(p_payload ->> 'time_end');
  v_key := NULLIF(trim(p_payload ->> 'idempotency_key'), '');
  v_purpose := NULLIF(left(trim(COALESCE(p_payload ->> 'purpose', '')), 200), '');

  IF v_loc IS NULL OR v_date IS NULL OR v_start IS NULL OR v_end IS NULL THEN
    PERFORM _renter_raise('renter.booking.fieldsInvalid');
  END IF;

  v_check := _renter_validate_one_time_booking(
    v_org, v_renter, v_loc, v_date, v_start, v_end, 'one_time', true
  );
  SELECT COALESCE(array_agg(value), '{}')
  INTO v_reasons
  FROM jsonb_array_elements_text(v_check -> 'reasons') t(value);
  PERFORM _renter_raise_first_reason(v_reasons);

  v_extra := jsonb_build_array(
    jsonb_build_object('location_id', v_loc, 'date', v_date)
  );
  PERFORM _renter_acquire_miniapp_locks(v_org, v_renter, v_extra);
  PERFORM _renter_create_gates(v_org, v_renter, true);

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM rentals r
    WHERE r.organization_id = v_org AND r.idempotency_key = v_key;

    IF FOUND THEN
      IF v_existing.location_id IS DISTINCT FROM v_loc
         OR v_existing.rental_date IS DISTINCT FROM v_date
         OR v_existing.time_start IS DISTINCT FROM v_start
         OR v_existing.time_end IS DISTINCT FROM v_end
         OR v_existing.renter_id IS DISTINCT FROM v_renter THEN
        PERFORM _renter_raise('renter.booking.idempotencyMismatch');
      END IF;
      RETURN jsonb_build_object(
        'success', true,
        'already_applied', true,
        'rental', _renter_public_rental_json(v_existing.id)
      );
    END IF;
  END IF;

  SELECT * INTO v_existing
  FROM rentals r
  WHERE r.organization_id = v_org
    AND r.renter_id = v_renter
    AND r.location_id = v_loc
    AND r.rental_date = v_date
    AND r.time_start = v_start
    AND r.time_end = v_end
    AND r.channel = 'miniapp'
    AND r.lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged')
  ORDER BY r.created_at
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_applied', true,
      'rental', _renter_public_rental_json(v_existing.id)
    );
  END IF;

  SELECT * INTO v_counts FROM _renter_unfinished_counts(v_org, v_renter);
  IF v_counts.awaiting_n >= 4 THEN
    PERFORM _renter_raise('renter.booking.holdLimit');
  END IF;
  IF v_counts.unfinished_n >= 32 THEN
    PERFORM _renter_raise('renter.booking.unfinishedLimit');
  END IF;

  v_id := _renter_insert_occurrence(
    v_org, v_renter, v_loc, v_date, v_start, v_end,
    'one_time', NULL, v_key, v_member, v_purpose
  );

  PERFORM _renter_apply_wallet(v_org, v_renter);

  RETURN jsonb_build_object(
    'success', true,
    'rental', _renter_public_rental_json(v_id)
  );
EXCEPTION
  WHEN unique_violation THEN
    IF v_key IS NOT NULL THEN
      SELECT id INTO v_id FROM rentals WHERE organization_id = v_org AND idempotency_key = v_key;
      IF v_id IS NOT NULL THEN
        RETURN jsonb_build_object(
          'success', true,
          'already_applied', true,
          'rental', _renter_public_rental_json(v_id)
        );
      END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'renter.booking.duplicate');
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.booking.fieldsInvalid');
END;
$$;


-- renter_create_recurring_pack from 20261110000008_renter_pack_ios_date_payload.sql
CREATE OR REPLACE FUNCTION renter_create_recurring_pack(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'renter_miniapp') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  RETURN _renter_rpc_fields_invalid_if_unmapped(
    _renter_create_recurring_pack_inner(_renter_normalize_booking_payload(p_payload))
  );
EXCEPTION
  WHEN invalid_datetime_format THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.booking.fieldsInvalid');
  WHEN datetime_field_overflow THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.booking.fieldsInvalid');
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.booking.fieldsInvalid');
  WHEN invalid_parameter_value THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.booking.fieldsInvalid');
END;
$$;


-- renter_quote_booking from 20261110000008_renter_pack_ios_date_payload.sql
CREATE OR REPLACE FUNCTION renter_quote_booking(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'renter_miniapp') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  RETURN _renter_rpc_fields_invalid_if_unmapped(
    _renter_quote_booking_inner(_renter_normalize_booking_payload(p_payload))
  );
EXCEPTION
  WHEN invalid_datetime_format THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.booking.fieldsInvalid');
  WHEN datetime_field_overflow THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.booking.fieldsInvalid');
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.booking.fieldsInvalid');
  WHEN invalid_parameter_value THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.booking.fieldsInvalid');
END;
$$;


-- renter_submit_topup from 20261110000001_renter_staff_topup_receipt_alert.sql
CREATE OR REPLACE FUNCTION renter_submit_topup(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_ctx record;
  v_amount numeric;
  v_method text;
  v_qr uuid;
  v_id uuid;
  v_currency text;
  v_code text;
  v_chat text;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'renter_miniapp') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  SELECT * INTO v_ctx FROM _renter_require_renter_ctx();

  IF NOT _renter_check_rpc_rate_limit(v_ctx.org_id, v_ctx.telegram_id) THEN
    PERFORM _renter_raise('renter.rateLimited');
  END IF;

  IF NOT renter_miniapp_addon_is_active(v_ctx.org_id) THEN
    PERFORM _renter_raise('renter.addonInactive');
  END IF;
  IF NOT organization_allows_writes(v_ctx.org_id) THEN
    PERFORM _renter_raise('renter.writesDisabled');
  END IF;

  v_currency := _renter_org_currency(v_ctx.org_id);
  v_amount := _renter_round_money((p_payload ->> 'amount')::numeric, v_currency);
  v_method := NULLIF(trim(COALESCE(p_payload ->> 'method', '')), '');
  v_qr := NULLIF(p_payload ->> 'qr_asset_id', '')::uuid;

  IF v_method IS NULL OR v_method NOT IN ('qr', 'cash') THEN
    PERFORM _renter_raise('renter.topup.methodInvalid');
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    PERFORM _renter_raise('renter.topup.amountInvalid');
  END IF;
  IF v_amount > _renter_topup_amount_max(v_currency) THEN
    PERFORM _renter_raise('renter.topup.amountTooLarge');
  END IF;
  IF v_method = 'qr' THEN
    SELECT c.telegram_chat_url
    INTO v_chat
    FROM organization_renter_channel c
    WHERE c.organization_id = v_ctx.org_id;

    IF v_chat IS NULL OR NOT _renter_telegram_chat_url_ok(v_chat) THEN
      PERFORM _renter_raise('renter.topup.chatRequired');
    END IF;

    IF v_qr IS NULL OR NOT EXISTS (
      SELECT 1 FROM organization_rental_qr_assets a
      WHERE a.id = v_qr AND a.organization_id = v_ctx.org_id AND a.is_active
    ) THEN
      PERFORM _renter_raise('renter.topup.qrInvalid');
    END IF;
  ELSE
    v_qr := NULL;
  END IF;

  v_code := _renter_allocate_topup_correlation_code(v_ctx.org_id);

  INSERT INTO renter_topup_requests (
    organization_id, renter_id, amount, method, qr_asset_id, status, correlation_code
  )
  VALUES (v_ctx.org_id, v_ctx.renter_id, v_amount, v_method, v_qr, 'pending', v_code)
  RETURNING id INTO v_id;

  PERFORM _renter_enqueue_topup_created(v_ctx.org_id, v_ctx.renter_id, v_id, v_amount);

  BEGIN
    PERFORM _renter_enqueue_staff_topup_submitted(
      v_ctx.org_id, v_ctx.renter_id, v_id, v_amount, v_method, v_code
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_id,
    'amount', v_amount,
    'correlation_code', v_code
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.pendingExists');
  WHEN check_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.amountTooLarge');
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


-- renter_cancel_occurrence from 20261040000002_renter_miniapp_r1c_booking_rpc.sql
CREATE OR REPLACE FUNCTION renter_cancel_occurrence(p_rental_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_ctx record;
  v_r rentals%ROWTYPE;
  v_reason text;
  v_extra jsonb;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'renter_miniapp') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  SELECT * INTO v_ctx FROM _renter_actor_ctx();

  SELECT * INTO v_r FROM rentals WHERE id = p_rental_id;
  IF NOT FOUND OR v_r.organization_id IS DISTINCT FROM v_ctx.org_id OR v_r.channel <> 'miniapp' THEN
    PERFORM _renter_raise('renter.forbidden');
  END IF;
  IF v_ctx.is_renter AND v_r.renter_id IS DISTINCT FROM v_ctx.jwt_renter_id THEN
    PERFORM _renter_raise('renter.forbidden');
  END IF;

  v_extra := jsonb_build_array(
    jsonb_build_object('location_id', v_r.location_id, 'date', v_r.rental_date)
  );
  PERFORM _renter_acquire_miniapp_locks(v_ctx.org_id, v_r.renter_id, v_extra);

  v_reason := _renter_cancel_one_slot(p_rental_id, v_ctx.is_renter, v_ctx.member_id);

  RETURN jsonb_build_object(
    'success', true,
    'reason', v_reason,
    'rental', _renter_public_rental_json(p_rental_id)
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


-- renter_cancel_pack_from_date from 20261128000006_miniapp_cancel_flags_pack_from_date.sql
CREATE OR REPLACE FUNCTION renter_cancel_pack_from_date(
  p_series_id uuid,
  p_from_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_ctx record;
  v_s rental_series%ROWTYPE;
  v_slot record;
  v_r rentals%ROWTYPE;
  v_now timestamptz := now();
  v_start timestamptz;
  v_extra jsonb := '[]'::jsonb;
  v_reasons jsonb := '[]'::jsonb;
  v_reason text;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'renter_miniapp') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  SELECT * INTO v_ctx FROM _renter_actor_ctx();

  IF p_from_date IS NULL THEN
    PERFORM _renter_raise('renter.cancel.packNotCancellable');
  END IF;

  SELECT * INTO v_s FROM rental_series WHERE id = p_series_id;
  IF NOT FOUND OR v_s.organization_id IS DISTINCT FROM v_ctx.org_id OR v_s.channel <> 'miniapp' THEN
    PERFORM _renter_raise('renter.forbidden');
  END IF;
  IF v_ctx.is_renter AND v_s.renter_id IS DISTINCT FROM v_ctx.jwt_renter_id THEN
    PERFORM _renter_raise('renter.forbidden');
  END IF;
  IF v_s.status NOT IN ('active', 'awaiting_payment') THEN
    PERFORM _renter_raise('renter.cancel.packNotCancellable');
  END IF;

  FOR v_slot IN
    SELECT r.id, r.location_id, r.rental_date, r.lifecycle
    FROM rentals r
    WHERE r.rental_series_id = p_series_id
      AND r.channel = 'miniapp'
      AND r.rental_date >= p_from_date
  LOOP
    v_extra := v_extra || jsonb_build_array(
      jsonb_build_object('location_id', v_slot.location_id, 'date', v_slot.rental_date)
    );
  END LOOP;

  IF jsonb_array_length(v_extra) = 0 THEN
    PERFORM _renter_raise('renter.cancel.packNotCancellable');
  END IF;

  PERFORM _renter_acquire_miniapp_locks(v_ctx.org_id, v_s.renter_id, v_extra);

  FOR v_slot IN
    SELECT r.id, r.rental_date, r.time_start, r.lifecycle, r.organization_id, r.prepay_charged_at, r.created_by
    FROM rentals r
    WHERE r.rental_series_id = p_series_id
      AND r.channel = 'miniapp'
      AND r.rental_date >= p_from_date
      AND r.lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged', 'debt')
  LOOP
    v_start := _renter_slot_ts(v_slot.organization_id, v_slot.rental_date, v_slot.time_start);
    IF v_ctx.is_renter AND v_now >= v_start THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_r FROM rentals WHERE id = v_slot.id FOR UPDATE;

    IF _renter_can_delete_hold_row(v_r, v_ctx.is_renter) THEN
      PERFORM _renter_delete_hold_slot(v_slot.id, v_ctx.member_id, true);
      v_reason := 'hold_deleted';
    ELSE
      v_reason := _renter_cancel_one_slot(v_slot.id, v_ctx.is_renter, v_ctx.member_id, true);
    END IF;

    v_reasons := v_reasons || jsonb_build_array(
      jsonb_build_object('rental_id', v_slot.id, 'reason', v_reason)
    );
  END LOOP;

  IF jsonb_array_length(v_reasons) = 0 THEN
    PERFORM _renter_raise('renter.cancel.packNotCancellable');
  END IF;

  PERFORM _renter_apply_wallet(v_ctx.org_id, v_s.renter_id);
  PERFORM _renter_after_pack_slot_terminal(p_series_id, 'incremental');

  RETURN jsonb_build_object(
    'success', true,
    'series_id', p_series_id,
    'from_date', p_from_date,
    'cancelled', v_reasons
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


-- renter_cancel_bookings_from_date from 20261128000007_renter_cancel_bookings_from_date.sql
CREATE OR REPLACE FUNCTION renter_cancel_bookings_from_date(
  p_renter_id uuid,
  p_from_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_ctx record;
  v_slot record;
  v_r rentals%ROWTYPE;
  v_now timestamptz := now();
  v_start timestamptz;
  v_extra jsonb := '[]'::jsonb;
  v_reasons jsonb := '[]'::jsonb;
  v_reason text;
  v_series_ids uuid[] := '{}';
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'renter_miniapp') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  SELECT * INTO v_ctx FROM _renter_actor_ctx();

  IF p_renter_id IS NULL OR p_from_date IS NULL THEN
    PERFORM _renter_raise('renter.cancel.renterFromDateNotCancellable');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM renters ren
    WHERE ren.id = p_renter_id AND ren.organization_id = v_ctx.org_id
  ) THEN
    PERFORM _renter_raise('renter.forbidden');
  END IF;

  IF v_ctx.is_renter AND p_renter_id IS DISTINCT FROM v_ctx.jwt_renter_id THEN
    PERFORM _renter_raise('renter.forbidden');
  END IF;

  FOR v_slot IN
    SELECT r.id, r.location_id, r.rental_date
    FROM rentals r
    WHERE r.organization_id = v_ctx.org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.rental_date >= p_from_date
      AND COALESCE(r.lifecycle, '') NOT IN ('cancelled', 'auto_deleted', 'hold_deleted')
  LOOP
    v_extra := v_extra || jsonb_build_array(
      jsonb_build_object('location_id', v_slot.location_id, 'date', v_slot.rental_date)
    );
  END LOOP;

  IF jsonb_array_length(v_extra) = 0 THEN
    PERFORM _renter_raise('renter.cancel.renterFromDateNotCancellable');
  END IF;

  PERFORM _renter_acquire_miniapp_locks(v_ctx.org_id, p_renter_id, v_extra);

  FOR v_slot IN
    SELECT r.id, r.rental_date, r.time_start, r.lifecycle, r.organization_id, r.rental_series_id
    FROM rentals r
    WHERE r.organization_id = v_ctx.org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.rental_date >= p_from_date
      AND r.lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged', 'debt')
    ORDER BY r.rental_date, r.time_start, r.created_at
  LOOP
    v_start := _renter_slot_ts(v_slot.organization_id, v_slot.rental_date, v_slot.time_start);
    IF v_ctx.is_renter AND v_now >= v_start THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_r FROM rentals WHERE id = v_slot.id FOR UPDATE;

    IF NOT _renter_slot_is_staff_cancellable(v_r, v_ctx.is_renter) THEN
      CONTINUE;
    END IF;

    IF _renter_can_delete_hold_row(v_r, v_ctx.is_renter) THEN
      PERFORM _renter_delete_hold_slot(v_slot.id, v_ctx.member_id, true);
      v_reason := 'hold_deleted';
    ELSE
      v_reason := _renter_cancel_one_slot(v_slot.id, v_ctx.is_renter, v_ctx.member_id, true);
    END IF;

    v_reasons := v_reasons || jsonb_build_array(
      jsonb_build_object('rental_id', v_slot.id, 'reason', v_reason)
    );

    IF v_slot.rental_series_id IS NOT NULL THEN
      v_series_ids := array_append(v_series_ids, v_slot.rental_series_id);
    END IF;
  END LOOP;

  IF jsonb_array_length(v_reasons) = 0 THEN
    PERFORM _renter_raise('renter.cancel.renterFromDateNotCancellable');
  END IF;

  PERFORM _renter_apply_wallet(v_ctx.org_id, p_renter_id);

  IF v_series_ids <> '{}' THEN
    PERFORM _renter_after_pack_slot_terminal(sid, 'incremental')
    FROM (SELECT DISTINCT unnest(v_series_ids) AS sid) s;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'renter_id', p_renter_id,
    'from_date', p_from_date,
    'cancelled', v_reasons
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


-- renter_delete_hold from 20261040000002_renter_miniapp_r1c_booking_rpc.sql
CREATE OR REPLACE FUNCTION renter_delete_hold(p_rental_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_ctx record;
  v_r rentals%ROWTYPE;
  v_extra jsonb;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'renter_miniapp') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  SELECT * INTO v_ctx FROM _renter_actor_ctx();

  SELECT * INTO v_r FROM rentals WHERE id = p_rental_id;
  IF NOT FOUND OR v_r.organization_id IS DISTINCT FROM v_ctx.org_id OR v_r.channel <> 'miniapp' THEN
    PERFORM _renter_raise('renter.forbidden');
  END IF;
  IF v_ctx.is_renter AND v_r.renter_id IS DISTINCT FROM v_ctx.jwt_renter_id THEN
    PERFORM _renter_raise('renter.forbidden');
  END IF;

  v_extra := jsonb_build_array(
    jsonb_build_object('location_id', v_r.location_id, 'date', v_r.rental_date)
  );
  PERFORM _renter_acquire_miniapp_locks(v_ctx.org_id, v_r.renter_id, v_extra);

  PERFORM _renter_delete_hold_slot(p_rental_id, v_ctx.member_id);

  RETURN jsonb_build_object(
    'success', true,
    'rental', _renter_public_rental_json(p_rental_id)
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


-- sync_offline_mark_attendance from 20260842000001_offline_mark_attendance_sync.sql
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
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'offline_attendance') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

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


-- restate_personal_lesson_amount from 20260931000001_personal_debt_writeoff_trace.sql
CREATE OR REPLACE FUNCTION restate_personal_lesson_amount(
  p_lesson_id uuid,
  p_new_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  SELECT organization_id INTO v_org_id FROM personal_lessons WHERE id = p_lesson_id;
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'personal_lessons') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

  RETURN restate_personal_lesson_charge(p_lesson_id, p_new_amount, NULL, 'wrong_amount', NULL);
END;
$$;


-- enqueue_calendar_sync from 20260924000001_gcal_event_format_refresh.sql
CREATE OR REPLACE FUNCTION enqueue_calendar_sync(
  p_organization_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_occurrence_date date,
  p_operation text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dedupe_key text;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(p_organization_id, 'google_calendar') THEN
    RETURN;
  END IF;

  IF p_operation = 'reconcile_member' THEN
    v_dedupe_key := 'reconcile_member:' || p_source_id::text;
  ELSIF p_operation = 'refresh_member' THEN
    v_dedupe_key := 'refresh_member:' || p_source_id::text;
  ELSIF p_operation = 'incremental_sync' THEN
    IF p_source_type = 'member_binding' THEN
      v_dedupe_key := 'incremental_sync:member:' || p_source_id::text;
    ELSIF p_source_type = 'organization_binding' THEN
      v_dedupe_key := 'incremental_sync:org:' || p_source_id::text;
    ELSE
      RAISE EXCEPTION 'invalid_incremental_sync_source_type';
    END IF;
  ELSE
    IF p_occurrence_date IS NULL THEN
      RAISE EXCEPTION 'calendar_sync_occurrence_date_required';
    END IF;
    v_dedupe_key := build_calendar_sync_dedupe_key(
      p_source_type,
      p_source_id,
      p_occurrence_date
    );
  END IF;

  INSERT INTO calendar_sync_outbox (
    organization_id,
    source_type,
    source_id,
    occurrence_date,
    dedupe_key,
    operation,
    status,
    available_at
  ) VALUES (
    p_organization_id,
    p_source_type,
    p_source_id,
    p_occurrence_date,
    v_dedupe_key,
    p_operation,
    'pending',
    now()
  )
  ON CONFLICT (organization_id, dedupe_key)
    WHERE status IN ('pending', 'retry')
  DO UPDATE SET
    source_type = EXCLUDED.source_type,
    source_id = EXCLUDED.source_id,
    occurrence_date = EXCLUDED.occurrence_date,
    operation = EXCLUDED.operation,
    status = 'pending',
    attempt_count = 0,
    available_at = now(),
    locked_at = NULL,
    locked_by = NULL,
    last_error_code = NULL,
    last_error_message = NULL,
    processed_at = NULL;
END;
$$;


-- upsert_renter from 20261041000002_renter_miniapp_r1d_staff_rpc.sql
CREATE OR REPLACE FUNCTION upsert_renter(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_id uuid := NULLIF(p_payload ->> 'renter_id', '')::uuid;
  v_type text := COALESCE(NULLIF(p_payload ->> 'counterparty_type', ''), 'individual');
  v_status text := COALESCE(NULLIF(p_payload ->> 'status', ''), 'active');
  v_display_name text := NULLIF(trim(p_payload ->> 'display_name'), '');
  v_duplicate_reason text := NULLIF(trim(p_payload ->> 'duplicate_create_reason'), '');
  v_preferred uuid[];
  v_has_tg boolean := p_payload ? 'telegram_id';
  v_tg_raw text;
  v_telegram bigint;
  v_con text;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;

  IF NOT member_can_manage_rentals() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  IF v_display_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.displayNameRequired');
  END IF;

  IF v_type NOT IN ('individual', 'sole_proprietor', 'company') THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.typeInvalid');
  END IF;

  IF v_status NOT IN ('active', 'archived', 'blocked') THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.statusInvalid');
  END IF;

  IF v_status = 'blocked' AND NULLIF(trim(p_payload ->> 'blocked_reason'), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.blockedReasonRequired');
  END IF;

  IF v_has_tg THEN
    v_tg_raw := NULLIF(trim(p_payload ->> 'telegram_id'), '');
    IF v_tg_raw IS NULL THEN
      v_telegram := NULL;
    ELSIF v_tg_raw !~ '^[0-9]+$' THEN
      RETURN jsonb_build_object('success', false, 'error', 'renters.error.telegramIdInvalid');
    ELSE
      v_telegram := v_tg_raw::bigint;
      IF v_telegram IS NULL OR v_telegram <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'renters.error.telegramIdInvalid');
      END IF;
    END IF;
  END IF;

  IF p_payload ? 'preferred_location_ids' THEN
    SELECT COALESCE(array_agg(value::uuid), '{}')
    INTO v_preferred
    FROM jsonb_array_elements_text(p_payload -> 'preferred_location_ids') AS t(value);
  END IF;

  IF v_id IS NULL THEN
    IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'hall_rent') THEN
      RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
    END IF;

    IF v_duplicate_reason IS NULL AND jsonb_array_length((check_renter_duplicates(p_payload) -> 'duplicates')) > 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'renters.error.duplicateRequiresReason');
    END IF;

    INSERT INTO renters (
      organization_id,
      display_name,
      counterparty_type,
      legal_name,
      tax_id,
      registration_number,
      legal_address,
      actual_address,
      contact_phone,
      contact_email,
      telegram_id,
      notes,
      status,
      blocked_reason,
      internal_notes,
      preferred_location_ids,
      payment_due_days,
      archived_at,
      duplicate_create_reason,
      duplicate_create_by
    )
    VALUES (
      v_org_id,
      v_display_name,
      v_type,
      NULLIF(trim(p_payload ->> 'legal_name'), ''),
      NULLIF(trim(p_payload ->> 'tax_id'), ''),
      NULLIF(trim(p_payload ->> 'registration_number'), ''),
      NULLIF(trim(p_payload ->> 'legal_address'), ''),
      NULLIF(trim(p_payload ->> 'actual_address'), ''),
      NULLIF(trim(p_payload ->> 'contact_phone'), ''),
      NULLIF(trim(p_payload ->> 'contact_email'), ''),
      CASE WHEN v_has_tg THEN v_telegram ELSE NULL END,
      NULLIF(trim(p_payload ->> 'notes'), ''),
      v_status,
      NULLIF(trim(p_payload ->> 'blocked_reason'), ''),
      NULLIF(trim(p_payload ->> 'internal_notes'), ''),
      COALESCE(v_preferred, '{}'),
      NULLIF(p_payload ->> 'payment_due_days', '')::int,
      CASE WHEN v_status = 'archived' THEN now() ELSE NULL END,
      v_duplicate_reason,
      CASE WHEN v_duplicate_reason IS NOT NULL THEN v_member_id END
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE renters
    SET
      display_name = v_display_name,
      counterparty_type = v_type,
      legal_name = CASE WHEN p_payload ? 'legal_name' THEN NULLIF(trim(p_payload ->> 'legal_name'), '') ELSE legal_name END,
      tax_id = CASE WHEN p_payload ? 'tax_id' THEN NULLIF(trim(p_payload ->> 'tax_id'), '') ELSE tax_id END,
      registration_number = CASE WHEN p_payload ? 'registration_number' THEN NULLIF(trim(p_payload ->> 'registration_number'), '') ELSE registration_number END,
      legal_address = CASE WHEN p_payload ? 'legal_address' THEN NULLIF(trim(p_payload ->> 'legal_address'), '') ELSE legal_address END,
      actual_address = CASE WHEN p_payload ? 'actual_address' THEN NULLIF(trim(p_payload ->> 'actual_address'), '') ELSE actual_address END,
      contact_phone = CASE WHEN p_payload ? 'contact_phone' THEN NULLIF(trim(p_payload ->> 'contact_phone'), '') ELSE contact_phone END,
      contact_email = CASE WHEN p_payload ? 'contact_email' THEN NULLIF(trim(p_payload ->> 'contact_email'), '') ELSE contact_email END,
      telegram_id = CASE WHEN v_has_tg THEN v_telegram ELSE telegram_id END,
      notes = CASE WHEN p_payload ? 'notes' THEN NULLIF(trim(p_payload ->> 'notes'), '') ELSE notes END,
      status = v_status,
      blocked_reason = CASE WHEN v_status = 'blocked' THEN NULLIF(trim(p_payload ->> 'blocked_reason'), '') ELSE NULL END,
      internal_notes = CASE WHEN p_payload ? 'internal_notes' THEN NULLIF(trim(p_payload ->> 'internal_notes'), '') ELSE internal_notes END,
      preferred_location_ids = CASE WHEN p_payload ? 'preferred_location_ids' THEN COALESCE(v_preferred, '{}') ELSE preferred_location_ids END,
      payment_due_days = CASE WHEN p_payload ? 'payment_due_days' THEN NULLIF(p_payload ->> 'payment_due_days', '')::int ELSE payment_due_days END,
      archived_at = CASE
        WHEN v_status = 'archived' THEN COALESCE(archived_at, now())
        ELSE NULL
      END
    WHERE id = v_id AND organization_id = v_org_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'renters.error.notFound');
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'renter_id', v_id);
EXCEPTION
  WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con = 'renters_org_telegram_id_unique' OR SQLERRM LIKE '%renters_org_telegram_id_unique%' THEN
      RETURN jsonb_build_object('success', false, 'error', 'renters.error.telegramIdTaken');
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.duplicateIdentity');
  WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con = 'renters_telegram_id_positive_chk' OR SQLERRM LIKE '%renters_telegram_id_positive_chk%' THEN
      RETURN jsonb_build_object('success', false, 'error', 'renters.error.telegramIdInvalid');
    END IF;
    RAISE;
  WHEN numeric_value_out_of_range THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.telegramIdInvalid');
END;
$$;


-- close_group_lesson_occurrence from 20261025000001_s26_group_closure_attendance_count.sql
CREATE OR REPLACE FUNCTION close_group_lesson_occurrence(
  p_schedule_slot_id uuid,
  p_occurrence_date date,
  p_confirmed_attendee_count integer,
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
  v_slot schedule_slots%ROWTYPE;
  v_closure_id uuid;
  v_existing_attendee_count integer;
  v_present_count integer;
  v_max_capacity integer;
  v_fingerprint text;
  v_cached jsonb;
  v_result jsonb;
BEGIN
  v_fingerprint := md5(concat_ws('|', p_schedule_slot_id, p_occurrence_date, p_confirmed_attendee_count));
  v_cached := check_operation_idempotency(v_org_id, 'close_group_lesson_occurrence', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN RETURN v_cached || jsonb_build_object('already_applied', true); END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL
    OR NOT member_can_close_group_venue_occurrence(p_schedule_slot_id, p_occurrence_date)
  THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;
  IF p_occurrence_date IS NULL OR p_occurrence_date > current_date
    OR p_confirmed_attendee_count IS NULL OR p_confirmed_attendee_count < 0
  THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_occurrence');
  END IF;

  SELECT * INTO v_slot FROM schedule_slots s
  WHERE s.id = p_schedule_slot_id AND s.organization_id = v_org_id
    AND s.class_id IS NOT NULL
    AND s.day_of_week = EXTRACT(ISODOW FROM p_occurrence_date)::integer
    AND s.valid_from <= p_occurrence_date
    AND (s.valid_to IS NULL OR s.valid_to >= p_occurrence_date);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'group_occurrence_not_found');
  END IF;

  v_present_count := _group_occurrence_present_attendee_count(
    v_org_id, p_occurrence_date, v_slot.id, v_slot.class_id
  );

  IF p_confirmed_attendee_count IS DISTINCT FROM v_present_count THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'attendee_count_mismatch',
      'present_attendee_count', v_present_count,
      'confirmed_attendee_count', p_confirmed_attendee_count
    );
  END IF;

  SELECT c.max_capacity INTO v_max_capacity
  FROM classes c
  WHERE c.id = v_slot.class_id AND c.organization_id = v_org_id;

  IF v_max_capacity IS NOT NULL AND v_present_count > v_max_capacity THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'attendee_count_exceeds_capacity',
      'present_attendee_count', v_present_count,
      'max_capacity', v_max_capacity
    );
  END IF;

  SELECT id, confirmed_attendee_count INTO v_closure_id, v_existing_attendee_count
  FROM lesson_occurrence_closures
  WHERE organization_id = v_org_id AND schedule_slot_id = v_slot.id
    AND occurrence_date = p_occurrence_date AND status = 'closed';
  IF v_closure_id IS NOT NULL THEN
    IF v_existing_attendee_count IS DISTINCT FROM p_confirmed_attendee_count THEN
      RETURN jsonb_build_object(
        'success', false, 'error_code', 'closure_attendee_count_conflict',
        'closure_id', v_closure_id,
        'confirmed_attendee_count', v_existing_attendee_count
      );
    END IF;
    RETURN jsonb_build_object('success', true, 'closure_id', v_closure_id, 'already_applied', true);
  END IF;

  INSERT INTO lesson_occurrence_closures (
    organization_id, occurrence_kind, occurrence_date, schedule_slot_id,
    discipline_id, location_id, teacher_member_id, confirmed_attendee_count, source_snapshot, closed_by
  ) VALUES (
    v_org_id, 'group', p_occurrence_date, v_slot.id, v_slot.discipline_id,
    v_slot.location_id, v_slot.teacher_member_id, v_present_count,
    jsonb_build_object(
      'schedule_slot_id', v_slot.id, 'class_id', v_slot.class_id,
      'discipline_id', v_slot.discipline_id, 'location_id', v_slot.location_id,
      'teacher_member_id', v_slot.teacher_member_id,
      'confirmed_attendee_count', v_present_count,
      'present_attendee_count', v_present_count
    ), v_member_id
  ) RETURNING id INTO v_closure_id;

  IF editions_lifecycle_enabled() AND edition_allows(v_org_id, 'hall_rent') THEN
    v_result := post_venue_cost_for_closure(v_closure_id, v_member_id);
  ELSE
    v_result := jsonb_build_object('success', true, 'closure_id', v_closure_id);
  END IF;
  IF NOT can_read_financial() THEN
    v_result := v_result - 'amount';
  END IF;
  PERFORM store_operation_idempotency(v_org_id, 'close_group_lesson_occurrence', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;


-- close_personal_lesson_occurrence from 20260854000001_venue_cost_teacher_scope.sql
CREATE OR REPLACE FUNCTION close_personal_lesson_occurrence(
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
  v_member_id uuid := auth_member_id();
  v_lesson personal_lessons%ROWTYPE;
  v_closure_id uuid;
  v_fingerprint text := md5(COALESCE(p_personal_lesson_id::text, ''));
  v_cached jsonb;
  v_result jsonb;
BEGIN
  v_cached := check_operation_idempotency(v_org_id, 'close_personal_lesson_occurrence', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN RETURN v_cached || jsonb_build_object('already_applied', true); END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL
    OR NOT member_can_close_personal_venue_occurrence(p_personal_lesson_id)
  THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  SELECT * INTO v_lesson FROM personal_lessons p
  WHERE p.id = p_personal_lesson_id AND p.organization_id = v_org_id
    AND p.date <= current_date AND p.cancelled_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'personal_lesson_not_found');
  END IF;

  SELECT id INTO v_closure_id FROM lesson_occurrence_closures
  WHERE organization_id = v_org_id
    AND source_personal_lesson_id = v_lesson.id
    AND status = 'closed';
  IF v_closure_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'closure_id', v_closure_id, 'already_applied', true);
  END IF;

  INSERT INTO lesson_occurrence_closures (
    organization_id, occurrence_kind, occurrence_date, personal_lesson_id,
    source_personal_lesson_id,
    discipline_id, location_id, teacher_member_id, source_snapshot, closed_by
  ) VALUES (
    v_org_id, 'personal', v_lesson.date, v_lesson.id, v_lesson.id, v_lesson.discipline_id,
    v_lesson.location_id, v_lesson.teacher_member_id, to_jsonb(v_lesson), v_member_id
  ) RETURNING id INTO v_closure_id;

  IF editions_lifecycle_enabled() AND edition_allows(v_org_id, 'hall_rent') THEN
    v_result := post_venue_cost_for_closure(v_closure_id, v_member_id);
  ELSE
    v_result := jsonb_build_object('success', true, 'closure_id', v_closure_id);
  END IF;
  IF NOT can_read_financial() THEN
    v_result := v_result - 'amount';
  END IF;
  PERFORM store_operation_idempotency(v_org_id, 'close_personal_lesson_occurrence', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;


-- can_export_data from 20260705000001_v2_rbac_export_helpers_sync.sql
CREATE OR REPLACE FUNCTION can_export_data()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT (
    current_member_role() IN ('owner', 'director')
    OR (
      current_member_role() = 'admin'
      AND EXISTS (
        SELECT 1
        FROM organization_settings os
        WHERE os.organization_id = auth_organization_id()
          AND os.admin_can_export = true
      )
    )
    OR (
      current_member_role() = 'teacher'
      AND EXISTS (
        SELECT 1
        FROM organization_settings os
        WHERE os.organization_id = auth_organization_id()
          AND os.teachers_can_export = true
      )
      AND teacher_has_any_scope()
    )
  )
  AND (
    NOT editions_lifecycle_enabled()
    OR edition_allows(auth_organization_id(), 'export_operational')
  );
$$;


-- can_export_financial from 20260629000001_v2_rbac_roles_refinement.sql
CREATE OR REPLACE FUNCTION can_export_financial()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT
    current_member_role() IN ('owner', 'director', 'accountant')
    AND (
      NOT editions_lifecycle_enabled()
      OR edition_allows(auth_organization_id(), 'export_financial')
    );
$$;


DROP FUNCTION IF EXISTS create_group_subscription(
  text, uuid, uuid, uuid, uuid, int, date, text, uuid, uuid, text, uuid[], uuid, text, date
);

GRANT EXECUTE ON FUNCTION create_group_subscription(
  text, uuid, uuid, uuid, uuid, int, date, text, uuid, uuid, text, uuid[], uuid, text, date, text
) TO authenticated;

COMMIT;
