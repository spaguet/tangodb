-- Single-visit group attendance payments, tariffs, permissions, and payroll split

BEGIN;

-- =============================================================================
-- 1. Tariff category and role toggles
-- =============================================================================

ALTER TABLE prices
  DROP CONSTRAINT IF EXISTS prices_category_check,
  DROP CONSTRAINT IF EXISTS prices_type_category_check;

ALTER TABLE prices
  ADD CONSTRAINT prices_category_check
  CHECK (category IN ('group', 'private', 'single_visit'));

ALTER TABLE prices
  ADD CONSTRAINT prices_type_category_check
  CHECK (
    (
      category = 'group'
      AND (
        type IN ('solo', 'pair_m1', 'pair_m2', 'pair_m3', 'pair_hm', 'monthly_unlimited')
        OR type ~ '^tariff_[a-f0-9]{12}$'
      )
    )
    OR (
      category = 'private'
      AND (
        type IN ('personal_solo', 'personal_pair', 'personal_trio', 'personal_quad')
        OR type ~ '^tariff_[a-f0-9]{12}$'
      )
    )
    OR (
      category = 'single_visit'
      AND (
        type = 'single_visit'
        OR type ~ '^tariff_[a-f0-9]{12}$'
      )
    )
  );

ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS teachers_can_record_single_visits BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_can_record_single_visits BOOLEAN NOT NULL DEFAULT true;

-- =============================================================================
-- 2. Single visits and payments link
-- =============================================================================

CREATE TABLE IF NOT EXISTS single_visits (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  visit_date        DATE NOT NULL,
  schedule_slot_id  UUID NOT NULL,
  schedule_group_id UUID NOT NULL,
  client_id         UUID NOT NULL,
  client_display    TEXT NOT NULL DEFAULT '',
  price_id          UUID NOT NULL,
  amount            NUMERIC NOT NULL CHECK (amount >= 0),
  method            TEXT NOT NULL DEFAULT 'cash'
    CHECK (method IN ('cash', 'transfer', 'card', 'other')),
  attendance_status TEXT NOT NULL DEFAULT 'present'
    CHECK (attendance_status IN ('present')),
  location_id       UUID,
  discipline_id     UUID,
  teacher_member_id UUID,
  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, visit_date, schedule_slot_id, client_id),
  FOREIGN KEY (organization_id, schedule_slot_id)
    REFERENCES schedule_slots (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, schedule_group_id)
    REFERENCES classes (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, client_id)
    REFERENCES clients (organization_id, id),
  FOREIGN KEY (organization_id, price_id)
    REFERENCES prices (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, location_id)
    REFERENCES locations (organization_id, id),
  FOREIGN KEY (organization_id, discipline_id)
    REFERENCES disciplines (organization_id, id),
  FOREIGN KEY (organization_id, teacher_member_id)
    REFERENCES organization_members (organization_id, id),
  FOREIGN KEY (organization_id, created_by)
    REFERENCES organization_members (organization_id, id)
);

CREATE INDEX IF NOT EXISTS idx_single_visits_org_date
  ON single_visits (organization_id, visit_date DESC);

CREATE INDEX IF NOT EXISTS idx_single_visits_org_teacher
  ON single_visits (organization_id, teacher_member_id);

CREATE INDEX IF NOT EXISTS idx_single_visits_org_client
  ON single_visits (organization_id, client_id);

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS single_visit_id UUID;

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_check,
  DROP CONSTRAINT IF EXISTS payments_source_check,
  ADD CONSTRAINT payments_source_check
  CHECK (num_nonnulls(subscription_id, personal_lesson_id, single_visit_id) = 1);

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_organization_id_single_visit_id_fkey,
  ADD CONSTRAINT payments_organization_id_single_visit_id_fkey
  FOREIGN KEY (organization_id, single_visit_id)
  REFERENCES single_visits (organization_id, id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payments_org_single_visit_unique
  ON payments (organization_id, single_visit_id)
  WHERE single_visit_id IS NOT NULL;

CREATE TRIGGER audit_single_visits
  AFTER INSERT OR UPDATE OR DELETE ON single_visits
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

ALTER TABLE single_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY single_visits_select_operational_financial
  ON single_visits FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND (
      can_read_operational()
      OR can_read_financial()
      OR (
        current_member_role() = 'teacher'
        AND (
          teacher_member_id = auth_member_id()
          OR teacher_has_discipline_access(discipline_id)
          OR teacher_has_location_access(location_id)
        )
      )
    )
  );

CREATE POLICY single_visits_insert_admin
  ON single_visits FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  );

CREATE POLICY single_visits_update_admin
  ON single_visits FOR UPDATE TO authenticated
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

CREATE POLICY single_visits_delete_admin
  ON single_visits FOR DELETE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  );

-- =============================================================================
-- 3. Tenant consistency
-- =============================================================================

CREATE OR REPLACE FUNCTION enforce_tenant_row_org_consistency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'class_teachers' THEN
    IF NOT EXISTS (
      SELECT 1 FROM classes c
      WHERE c.organization_id = NEW.organization_id AND c.id = NEW.class_id
    ) THEN
      RAISE EXCEPTION 'class_id does not belong to organization';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = NEW.organization_id AND om.id = NEW.member_id
    ) THEN
      RAISE EXCEPTION 'member_id does not belong to organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'subscriptions' THEN
    IF NEW.discipline_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM disciplines d
      WHERE d.organization_id = NEW.organization_id AND d.id = NEW.discipline_id
    ) THEN
      RAISE EXCEPTION 'discipline_id does not belong to organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'attendance' THEN
    IF NOT EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.organization_id = NEW.organization_id AND s.id = NEW.subscription_id
    ) THEN
      RAISE EXCEPTION 'subscription_id does not belong to organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'personal_lessons' THEN
    IF NEW.subscription_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.organization_id = NEW.organization_id AND s.id = NEW.subscription_id
    ) THEN
      RAISE EXCEPTION 'subscription_id does not belong to organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'schedule_slots' THEN
    IF NEW.discipline_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM disciplines d
      WHERE d.organization_id = NEW.organization_id AND d.id = NEW.discipline_id
    ) THEN
      RAISE EXCEPTION 'discipline_id does not belong to organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'single_visits' THEN
    IF NOT EXISTS (
      SELECT 1 FROM schedule_slots ss
      WHERE ss.organization_id = NEW.organization_id AND ss.id = NEW.schedule_slot_id
    ) THEN
      RAISE EXCEPTION 'schedule_slot_id does not belong to organization';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM classes c
      WHERE c.organization_id = NEW.organization_id AND c.id = NEW.schedule_group_id
    ) THEN
      RAISE EXCEPTION 'schedule_group_id does not belong to organization';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM clients c
      WHERE c.organization_id = NEW.organization_id AND c.id = NEW.client_id
    ) THEN
      RAISE EXCEPTION 'client_id does not belong to organization';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM prices pr
      WHERE pr.organization_id = NEW.organization_id AND pr.id = NEW.price_id
    ) THEN
      RAISE EXCEPTION 'price_id does not belong to organization';
    END IF;
    IF NEW.created_by IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = NEW.organization_id AND om.id = NEW.created_by
    ) THEN
      RAISE EXCEPTION 'created_by does not belong to organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'payments' THEN
    IF NOT EXISTS (
      SELECT 1 FROM clients c
      WHERE c.organization_id = NEW.organization_id AND c.id = NEW.client_id
    ) THEN
      RAISE EXCEPTION 'client_id does not belong to organization';
    END IF;
    IF NEW.subscription_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.organization_id = NEW.organization_id AND s.id = NEW.subscription_id
    ) THEN
      RAISE EXCEPTION 'subscription_id does not belong to organization';
    END IF;
    IF NEW.personal_lesson_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM personal_lessons pl
      WHERE pl.organization_id = NEW.organization_id AND pl.id = NEW.personal_lesson_id
    ) THEN
      RAISE EXCEPTION 'personal_lesson_id does not belong to organization';
    END IF;
    IF NEW.single_visit_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM single_visits sv
      WHERE sv.organization_id = NEW.organization_id AND sv.id = NEW.single_visit_id
    ) THEN
      RAISE EXCEPTION 'single_visit_id does not belong to organization';
    END IF;
    IF NEW.created_by IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = NEW.organization_id AND om.id = NEW.created_by
    ) THEN
      RAISE EXCEPTION 'created_by does not belong to organization';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER single_visits_org_consistency
  BEFORE INSERT OR UPDATE ON single_visits
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_row_org_consistency();

-- =============================================================================
-- 4. RPC for recording a paid present single visit
-- =============================================================================

CREATE OR REPLACE FUNCTION can_record_single_visit_for_slot(
  p_slot schedule_slots
)
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
      );
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION record_single_visit(
  p_visit_date date,
  p_schedule_slot_id uuid,
  p_client_id uuid,
  p_price_id uuid,
  p_method text DEFAULT 'cash'
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
  v_client_display text;
  v_visit_id uuid;
BEGIN
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

  IF v_price.discipline_id IS NOT NULL AND v_price.discipline_id IS DISTINCT FROM v_slot.discipline_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Тариф не подходит для этого направления');
  END IF;

  SELECT trim(coalesce(c.last_name, '') || ' ' || coalesce(c.first_name, ''))
  INTO v_client_display
  FROM clients c
  WHERE c.organization_id = v_org_id
    AND c.id = p_client_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Клиент не найден');
  END IF;

  INSERT INTO single_visits (
    organization_id,
    visit_date,
    schedule_slot_id,
    schedule_group_id,
    client_id,
    client_display,
    price_id,
    amount,
    method,
    location_id,
    discipline_id,
    teacher_member_id,
    created_by
  )
  VALUES (
    v_org_id,
    p_visit_date,
    v_slot.id,
    v_slot.class_id,
    p_client_id,
    coalesce(nullif(v_client_display, ''), 'Клиент'),
    v_price.id,
    v_price.price,
    p_method,
    v_slot.location_id,
    v_slot.discipline_id,
    v_slot.teacher_member_id,
    v_member_id
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

  INSERT INTO payments (
    organization_id,
    client_id,
    client_display,
    amount,
    method,
    single_visit_id,
    created_by,
    created_at
  )
  VALUES (
    v_org_id,
    p_client_id,
    coalesce(nullif(v_client_display, ''), 'Клиент'),
    v_price.price,
    p_method,
    v_visit_id,
    v_member_id,
    now()
  )
  ON CONFLICT (organization_id, single_visit_id)
  DO UPDATE SET
    client_id = EXCLUDED.client_id,
    client_display = EXCLUDED.client_display,
    amount = EXCLUDED.amount,
    method = EXCLUDED.method,
    created_by = EXCLUDED.created_by,
    created_at = now();

  RETURN jsonb_build_object('success', true, 'visitId', v_visit_id);
END;
$$;

GRANT EXECUTE ON FUNCTION record_single_visit(date, uuid, uuid, uuid, text) TO authenticated;

-- =============================================================================
-- 5. Payroll single-visit percent and resolver
-- =============================================================================

ALTER TABLE teacher_pay_rates
  ADD COLUMN IF NOT EXISTS single_visit_rate_percent NUMERIC NOT NULL DEFAULT 0;

UPDATE teacher_pay_rates
SET single_visit_rate_percent = group_rate_percent
WHERE single_visit_rate_percent = 0
  AND COALESCE(group_rate_percent, 0) > 0;

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
      SELECT pl.teacher_member_id
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
  v_date_from date;
  v_date_to date;
  v_member record;
  v_pay_mode text;
  v_rate_fixed_amount numeric;
  v_rate_group_percent numeric;
  v_rate_personal_percent numeric;
  v_rate_single_visit_percent numeric;
  v_fixed_amount numeric;
  v_group_percent numeric;
  v_personal_percent numeric;
  v_single_visit_percent numeric;
  v_accrued numeric;
  v_existing_paid numeric;
BEGIN
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
    SELECT
      tpr.pay_mode,
      tpr.fixed_amount,
      tpr.group_rate_percent,
      tpr.personal_rate_percent,
      tpr.single_visit_rate_percent
    INTO v_pay_mode, v_rate_fixed_amount, v_rate_group_percent, v_rate_personal_percent, v_rate_single_visit_percent
    FROM teacher_pay_rates tpr
    WHERE tpr.organization_id = p_org_id
      AND tpr.member_id = v_member.member_id
      AND tpr.effective_from <= v_date_to
    ORDER BY tpr.effective_from DESC, tpr.created_at DESC
    LIMIT 1;

    v_fixed_amount := CASE
      WHEN COALESCE(v_pay_mode, 'percent') IN ('fixed', 'fixed_plus_percent')
        THEN COALESCE(v_rate_fixed_amount, 0)
      ELSE 0
    END;
    v_group_percent := CASE
      WHEN COALESCE(v_pay_mode, 'percent') IN ('percent', 'fixed_plus_percent')
        THEN COALESCE(v_rate_group_percent, 0)
      ELSE 0
    END;
    v_personal_percent := CASE
      WHEN COALESCE(v_pay_mode, 'percent') IN ('percent', 'fixed_plus_percent')
        THEN COALESCE(v_rate_personal_percent, 0)
      ELSE 0
    END;
    v_single_visit_percent := CASE
      WHEN COALESCE(v_pay_mode, 'percent') IN ('percent', 'fixed_plus_percent')
        THEN COALESCE(v_rate_single_visit_percent, v_rate_group_percent, 0)
      ELSE 0
    END;

    SELECT v_fixed_amount + COALESCE(SUM(
      p.amount * CASE
        WHEN p.personal_lesson_id IS NOT NULL THEN v_personal_percent
        WHEN p.single_visit_id IS NOT NULL THEN v_single_visit_percent
        WHEN p.subscription_id IS NOT NULL THEN v_group_percent
        ELSE 0
      END / 100.0
    ), 0)
    INTO v_accrued
    FROM payments p
    WHERE p.organization_id = p_org_id
      AND p.created_at >= v_date_from
      AND p.created_at < (v_date_to + interval '1 day')
      AND payroll_resolve_payment_teacher_id(
        p_org_id,
        p.personal_lesson_id,
        p.subscription_id,
        p.single_visit_id
      ) = v_member.member_id;

    SELECT ts.amount_paid
    INTO v_existing_paid
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
      COALESCE(v_accrued, 0),
      COALESCE(v_existing_paid, 0),
      now()
    )
    ON CONFLICT (organization_id, member_id, period_year, period_month)
    DO UPDATE SET
      amount_accrued = EXCLUDED.amount_accrued,
      computed_at = now();
  END LOOP;
END;
$$;

COMMIT;
