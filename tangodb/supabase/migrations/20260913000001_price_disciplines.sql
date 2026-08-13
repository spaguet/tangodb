-- Prices: optional multi-discipline binding (empty = all disciplines)

CREATE TABLE price_disciplines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  price_id        UUID NOT NULL,
  discipline_id   UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, price_id, discipline_id),
  FOREIGN KEY (organization_id, price_id)
    REFERENCES prices (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, discipline_id)
    REFERENCES disciplines (organization_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_price_disciplines_org_price
  ON price_disciplines (organization_id, price_id);

CREATE INDEX idx_price_disciplines_org_discipline
  ON price_disciplines (organization_id, discipline_id);

ALTER TABLE price_disciplines ENABLE ROW LEVEL SECURITY;

CREATE POLICY price_disciplines_select
  ON price_disciplines FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() IN ('owner', 'director', 'admin', 'accountant', 'teacher')
  );

CREATE POLICY price_disciplines_write_admin
  ON price_disciplines FOR ALL TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON price_disciplines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON price_disciplines TO service_role;

INSERT INTO price_disciplines (organization_id, price_id, discipline_id)
SELECT p.organization_id, p.id, p.discipline_id
FROM prices p
WHERE p.discipline_id IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.price_matches_slot_discipline(
  p_price_id uuid,
  p_org_id uuid,
  p_slot_discipline_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    NOT EXISTS (
      SELECT 1
      FROM prices p
      WHERE p.id = p_price_id
        AND p.organization_id = p_org_id
        AND (
          p.discipline_id IS NOT NULL
          OR EXISTS (
            SELECT 1
            FROM price_disciplines pd
            WHERE pd.organization_id = p_org_id
              AND pd.price_id = p.id
          )
        )
    )
    OR p_slot_discipline_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM prices p
      WHERE p.id = p_price_id
        AND p.organization_id = p_org_id
        AND (
          p.discipline_id = p_slot_discipline_id
          OR EXISTS (
            SELECT 1
            FROM price_disciplines pd
            WHERE pd.organization_id = p_org_id
              AND pd.price_id = p.id
              AND pd.discipline_id = p_slot_discipline_id
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.price_matches_slot_discipline(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.price_matches_slot_discipline(uuid, uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_archived_prices()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_prices jsonb;
BEGIN
  IF v_org_id IS NULL OR NOT can_read_prices() THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      to_jsonb(p)
      || jsonb_build_object(
        'teacher_member_ids',
        COALESCE(
          (
            SELECT jsonb_agg(ptm.member_id ORDER BY ptm.member_id)
            FROM public.price_teacher_members ptm
            WHERE ptm.organization_id = v_org_id
              AND ptm.price_id = p.id
          ),
          '[]'::jsonb
        ),
        'discipline_ids',
        COALESCE(
          (
            SELECT jsonb_agg(pd.discipline_id ORDER BY pd.discipline_id)
            FROM public.price_disciplines pd
            WHERE pd.organization_id = v_org_id
              AND pd.price_id = p.id
          ),
          CASE
            WHEN p.discipline_id IS NULL THEN '[]'::jsonb
            ELSE jsonb_build_array(p.discipline_id)
          END
        ),
        'sales_count',
        (
          SELECT count(*)
          FROM public.subscriptions s
          WHERE s.organization_id = v_org_id
            AND s.price_id = p.id
        )
        +
        (
          SELECT count(*)
          FROM public.single_visits sv
          WHERE sv.organization_id = v_org_id
            AND sv.price_id = p.id
        )
      )
      ORDER BY p.archived_at DESC, p.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_prices
  FROM public.prices p
  WHERE p.organization_id = v_org_id
    AND p.status = 'archived';

  RETURN jsonb_build_object('success', true, 'prices', v_prices);
END;
$$;

REVOKE ALL ON FUNCTION public.list_archived_prices() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_archived_prices() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION _record_single_visit_before_venue_rules(
  p_visit_date date,
  p_schedule_slot_id uuid,
  p_client_id uuid,
  p_price_id uuid DEFAULT NULL,
  p_method text DEFAULT 'cash',
  p_idempotency_key uuid DEFAULT NULL,
  p_amount numeric DEFAULT NULL
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
  v_price prices%ROWTYPE;
  v_amount numeric;
  v_client_display text;
  v_visit_id uuid;
  v_payment_id uuid;
  v_fingerprint text;
  v_cached jsonb;
  v_op_num bigint;
  v_result jsonb;
BEGIN
  v_fingerprint := md5(
    coalesce(p_visit_date::text, '') || '|' ||
    coalesce(p_schedule_slot_id::text, '') || '|' ||
    coalesce(p_client_id::text, '') || '|' ||
    coalesce(p_price_id::text, '') || '|' ||
    coalesce(p_method, '') || '|' ||
    coalesce(p_amount::text, '')
  );

  v_cached := check_operation_idempotency(
    v_org_id, 'record_single_visit', p_idempotency_key, v_fingerprint
  );
  IF v_cached IS NOT NULL THEN
    IF (v_cached ->> 'success')::boolean IS NOT TRUE AND v_cached ->> 'error_code' = 'idempotency_conflict' THEN
      RETURN v_cached;
    END IF;
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Организация в режиме только чтения');
  END IF;

  IF p_visit_date IS NULL OR p_visit_date > current_date THEN
    RETURN jsonb_build_object('success', false, 'error', 'Разовое посещение можно отметить только за прошедший или текущий день');
  END IF;

  IF p_method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недопустимый способ оплаты');
  END IF;

  IF p_amount IS NOT NULL AND p_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Сумма должна быть неотрицательной');
  END IF;

  SELECT * INTO v_slot
  FROM schedule_slots ss
  WHERE ss.organization_id = v_org_id
    AND ss.id = p_schedule_slot_id
    AND ss.class_id IS NOT NULL
    AND ss.valid_from <= p_visit_date
    AND (ss.valid_to IS NULL OR ss.valid_to >= p_visit_date)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Групповое занятие не найдено');
  END IF;

  IF NOT can_record_single_visit_for_slot(v_slot) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав для разового посещения');
  END IF;

  IF p_price_id IS NULL THEN
    IF p_amount IS NULL OR p_amount <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Укажите тариф или сумму оплаты');
    END IF;
    v_amount := p_amount;
  ELSE
    SELECT * INTO v_price
    FROM prices pr
    WHERE pr.organization_id = v_org_id
      AND pr.id = p_price_id
      AND pr.category = 'single_visit';

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Тариф разового посещения не найден');
    END IF;

    IF v_price.location_id IS NOT NULL AND v_price.location_id IS DISTINCT FROM v_slot.location_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'Тариф не подходит для этой локации');
    END IF;

    IF NOT price_matches_slot_discipline(p_price_id, v_org_id, v_slot.discipline_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Тариф не подходит для этого направления');
    END IF;

    v_amount := COALESCE(p_amount, v_price.price);
  END IF;

  SELECT trim(coalesce(c.last_name, '') || ' ' || coalesce(c.first_name, ''))
  INTO v_client_display
  FROM clients c
  WHERE c.organization_id = v_org_id AND c.id = p_client_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Клиент не найден');
  END IF;

  INSERT INTO single_visits (
    organization_id, visit_date, schedule_slot_id, schedule_group_id,
    client_id, client_display, price_id, amount, method,
    location_id, discipline_id, teacher_member_id, created_by
  )
  VALUES (
    v_org_id, p_visit_date, v_slot.id, v_slot.class_id,
    p_client_id, coalesce(nullif(v_client_display, ''), 'Клиент'),
    p_price_id, v_amount, p_method,
    v_slot.location_id, v_slot.discipline_id, v_slot.teacher_member_id, v_member_id
  )
  ON CONFLICT (organization_id, visit_date, schedule_slot_id, client_id)
  DO UPDATE SET
    price_id = EXCLUDED.price_id,
    amount = EXCLUDED.amount,
    method = EXCLUDED.method,
    client_display = EXCLUDED.client_display,
    teacher_member_id = EXCLUDED.teacher_member_id,
    created_by = EXCLUDED.created_by,
    created_at = now()
  RETURNING id INTO v_visit_id;

  SELECT p.id INTO v_payment_id
  FROM payments p
  WHERE p.organization_id = v_org_id
    AND p.single_visit_id = v_visit_id
    AND p.operation_kind = 'payment'
    AND p.replaces_payment_id IS NULL
    AND payment_remaining_amount(v_org_id, p.id) > 0
  LIMIT 1;

  IF v_payment_id IS NULL THEN
    v_op_num := next_payment_operation_number(v_org_id);

    INSERT INTO payments (
      organization_id, client_id, client_display, amount, method,
      single_visit_id, created_by, operation_number,
      idempotency_key, idempotency_scope, payload_fingerprint
    )
    VALUES (
      v_org_id, p_client_id, coalesce(nullif(v_client_display, ''), 'Клиент'),
      v_amount, p_method, v_visit_id, v_member_id, v_op_num,
      p_idempotency_key, 'record_single_visit', v_fingerprint
    )
    RETURNING id INTO v_payment_id;
  ELSE
    SELECT p.operation_number INTO v_op_num
    FROM payments p WHERE p.id = v_payment_id;
  END IF;

  v_result := jsonb_build_object(
    'success', true,
    'visitId', v_visit_id,
    'payment_id', v_payment_id,
    'operation_number', v_op_num
  );

  PERFORM store_operation_idempotency(
    v_org_id, 'record_single_visit', p_idempotency_key, v_fingerprint, v_result
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION _record_single_visit_before_venue_rules(date, uuid, uuid, uuid, text, uuid, numeric) FROM PUBLIC, authenticated;
