-- F6: teacher payroll — rates, settlements, partial payments, recalculate RPC
-- Ref: tangodb_expenses_payroll_plan.md §3, Промт 20

BEGIN;

-- =============================================================================
-- 1. Tables
-- =============================================================================

CREATE TABLE teacher_pay_rates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  member_id       UUID NOT NULL,
  rate_percent    NUMERIC NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  effective_from  DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_teacher_pay_rates_org_member
  ON teacher_pay_rates (organization_id, member_id, effective_from DESC);

CREATE TABLE teacher_settlements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  member_id       UUID NOT NULL,
  period_year     INT NOT NULL,
  period_month    INT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  amount_accrued  NUMERIC NOT NULL DEFAULT 0 CHECK (amount_accrued >= 0),
  amount_paid     NUMERIC NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, member_id, period_year, period_month),
  FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE CASCADE,
  CHECK (amount_paid <= amount_accrued)
);

CREATE INDEX idx_teacher_settlements_org_period
  ON teacher_settlements (organization_id, period_year DESC, period_month DESC);

CREATE TABLE teacher_settlement_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  settlement_id   UUID NOT NULL,
  amount          NUMERIC NOT NULL CHECK (amount > 0),
  paid_at         DATE NOT NULL CHECK (paid_at <= CURRENT_DATE),
  method          TEXT NOT NULL DEFAULT 'transfer'
    CHECK (method IN ('cash', 'transfer', 'card', 'other')),
  note            TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, settlement_id)
    REFERENCES teacher_settlements (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, created_by)
    REFERENCES organization_members (organization_id, id)
);

CREATE INDEX idx_teacher_settlement_payments_settlement
  ON teacher_settlement_payments (organization_id, settlement_id, paid_at DESC);

-- =============================================================================
-- 2. Helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION can_manage_payroll_rates()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT current_member_role() IN ('owner', 'director');
$$;

CREATE OR REPLACE FUNCTION can_write_payroll()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT can_read_financial();
$$;

CREATE OR REPLACE FUNCTION teacher_member_has_future_lessons(p_org_id uuid, p_member_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM personal_lessons pl
    WHERE pl.organization_id = p_org_id
      AND pl.teacher_member_id = p_member_id
      AND pl.date >= CURRENT_DATE
  )
  OR EXISTS (
    SELECT 1
    FROM schedule_slots ss
    WHERE ss.organization_id = p_org_id
      AND ss.teacher_member_id = p_member_id
      AND (ss.valid_to IS NULL OR ss.valid_to >= CURRENT_DATE)
  );
$$;

CREATE OR REPLACE FUNCTION payroll_resolve_payment_teacher_id(
  p_org_id uuid,
  p_personal_lesson_id uuid,
  p_subscription_id uuid
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

CREATE OR REPLACE FUNCTION payroll_active_rate_percent(
  p_org_id uuid,
  p_member_id uuid,
  p_as_of date
)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT tpr.rate_percent
    FROM teacher_pay_rates tpr
    WHERE tpr.organization_id = p_org_id
      AND tpr.member_id = p_member_id
      AND tpr.effective_from <= p_as_of
    ORDER BY tpr.effective_from DESC, tpr.created_at DESC
    LIMIT 1
  ), 0);
$$;

-- =============================================================================
-- 3. RPC: recalculate settlements for a month (idempotent)
-- =============================================================================

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
  v_teacher record;
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

  FOR v_teacher IN
    SELECT om.id AS member_id
    FROM organization_members om
    WHERE om.organization_id = p_org_id
      AND om.role = 'teacher'
      AND om.is_active = true
  LOOP
    SELECT COALESCE(SUM(
      p.amount * payroll_active_rate_percent(
        p_org_id,
        v_teacher.member_id,
        p.created_at::date
      ) / 100.0
    ), 0)
    INTO v_accrued
    FROM payments p
    WHERE p.organization_id = p_org_id
      AND p.created_at >= v_date_from
      AND p.created_at < (v_date_to + interval '1 day')
      AND payroll_resolve_payment_teacher_id(
        p_org_id,
        p.personal_lesson_id,
        p.subscription_id
      ) = v_teacher.member_id;

    SELECT ts.amount_paid
    INTO v_existing_paid
    FROM teacher_settlements ts
    WHERE ts.organization_id = p_org_id
      AND ts.member_id = v_teacher.member_id
      AND ts.period_year = p_year
      AND ts.period_month = p_month;

    IF v_existing_paid IS NOT NULL AND v_accrued < v_existing_paid THEN
      v_accrued := v_existing_paid;
    END IF;

    INSERT INTO teacher_settlements (
      organization_id,
      member_id,
      period_year,
      period_month,
      amount_accrued,
      computed_at
    )
    VALUES (
      p_org_id,
      v_teacher.member_id,
      p_year,
      p_month,
      v_accrued,
      now()
    )
    ON CONFLICT (organization_id, member_id, period_year, period_month)
    DO UPDATE SET
      amount_accrued = EXCLUDED.amount_accrued,
      computed_at = now();
  END LOOP;
END;
$$;

-- =============================================================================
-- 4. RPC: record partial/full payout
-- =============================================================================

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
  IF v_new_paid > v_settlement.amount_accrued THEN
    RAISE EXCEPTION 'amount_paid exceeds amount_accrued';
  END IF;

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

REVOKE ALL ON FUNCTION recalculate_teacher_settlement(uuid, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION recalculate_teacher_settlement(uuid, int, int) TO authenticated;

REVOKE ALL ON FUNCTION record_teacher_settlement_payment(uuid, numeric, date, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_teacher_settlement_payment(uuid, numeric, date, text, text) TO authenticated;

-- =============================================================================
-- 5. Tenant consistency trigger (extend shared function)
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
    IF NEW.created_by IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = NEW.organization_id AND om.id = NEW.created_by
    ) THEN
      RAISE EXCEPTION 'created_by does not belong to organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'expenses' THEN
    IF NEW.created_by IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = NEW.organization_id AND om.id = NEW.created_by
    ) THEN
      RAISE EXCEPTION 'created_by does not belong to organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'teacher_pay_rates' THEN
    IF NOT EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = NEW.organization_id
        AND om.id = NEW.member_id
        AND om.role = 'teacher'
    ) THEN
      RAISE EXCEPTION 'member_id must be an active teacher in organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'teacher_settlements' THEN
    IF NOT EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = NEW.organization_id AND om.id = NEW.member_id
    ) THEN
      RAISE EXCEPTION 'member_id does not belong to organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'teacher_settlement_payments' THEN
    IF NOT EXISTS (
      SELECT 1 FROM teacher_settlements ts
      WHERE ts.organization_id = NEW.organization_id AND ts.id = NEW.settlement_id
    ) THEN
      RAISE EXCEPTION 'settlement_id does not belong to organization';
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

CREATE TRIGGER teacher_pay_rates_org_consistency
  BEFORE INSERT OR UPDATE ON teacher_pay_rates
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_row_org_consistency();

CREATE TRIGGER teacher_settlements_org_consistency
  BEFORE INSERT OR UPDATE ON teacher_settlements
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_row_org_consistency();

CREATE TRIGGER teacher_settlement_payments_org_consistency
  BEFORE INSERT OR UPDATE ON teacher_settlement_payments
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_row_org_consistency();

-- =============================================================================
-- 6. Audit triggers
-- =============================================================================

CREATE TRIGGER audit_teacher_pay_rates
  AFTER INSERT OR UPDATE OR DELETE ON teacher_pay_rates
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_teacher_settlements
  AFTER INSERT OR UPDATE OR DELETE ON teacher_settlements
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_teacher_settlement_payments
  AFTER INSERT OR UPDATE OR DELETE ON teacher_settlement_payments
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

-- =============================================================================
-- 7. RLS
-- =============================================================================

ALTER TABLE teacher_pay_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_settlement_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY teacher_pay_rates_select
  ON teacher_pay_rates FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_financial()
  );

CREATE POLICY teacher_pay_rates_insert
  ON teacher_pay_rates FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_manage_payroll_rates()
  );

CREATE POLICY teacher_pay_rates_update
  ON teacher_pay_rates FOR UPDATE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_manage_payroll_rates()
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_manage_payroll_rates()
  );

CREATE POLICY teacher_pay_rates_delete
  ON teacher_pay_rates FOR DELETE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_manage_payroll_rates()
  );

CREATE POLICY teacher_settlements_select_financial
  ON teacher_settlements FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_financial()
  );

CREATE POLICY teacher_settlements_select_own
  ON teacher_settlements FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() = 'teacher'
    AND member_id = auth_member_id()
  );

CREATE POLICY teacher_settlements_insert
  ON teacher_settlements FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_payroll()
  );

CREATE POLICY teacher_settlements_update
  ON teacher_settlements FOR UPDATE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_payroll()
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_payroll()
  );

CREATE POLICY teacher_settlement_payments_select_financial
  ON teacher_settlement_payments FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_financial()
  );

CREATE POLICY teacher_settlement_payments_select_own
  ON teacher_settlement_payments FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() = 'teacher'
    AND EXISTS (
      SELECT 1 FROM teacher_settlements ts
      WHERE ts.organization_id = teacher_settlement_payments.organization_id
        AND ts.id = teacher_settlement_payments.settlement_id
        AND ts.member_id = auth_member_id()
    )
  );

CREATE POLICY teacher_settlement_payments_insert
  ON teacher_settlement_payments FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_payroll()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON teacher_pay_rates TO authenticated;
GRANT SELECT, INSERT, UPDATE ON teacher_settlements TO authenticated;
GRANT SELECT, INSERT ON teacher_settlement_payments TO authenticated;

-- =============================================================================
-- 8. Guard: block teacher deactivation with future lessons
-- =============================================================================

CREATE OR REPLACE FUNCTION update_team_member(
  p_member_id uuid,
  p_role text DEFAULT NULL,
  p_scope jsonb DEFAULT NULL,
  p_is_active boolean DEFAULT NULL,
  p_display_name text DEFAULT NULL,
  p_meta jsonb DEFAULT NULL,
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL,
  p_patronymic text DEFAULT NULL,
  p_contact_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_telegram text DEFAULT NULL,
  p_profile_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_inviter_role text;
  v_target organization_members%ROWTYPE;
  v_profile_update boolean := false;
BEGIN
  IF v_org_id IS NULL OR NOT can_manage_team() OR NOT organization_allows_writes(v_org_id) THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  v_inviter_role := member_role(auth.uid(), v_org_id);

  SELECT * INTO v_target
  FROM organization_members om
  WHERE om.id = p_member_id
    AND om.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'member not found';
  END IF;

  IF NOT inviter_can_manage_member(v_inviter_role, v_target.role) THEN
    RAISE EXCEPTION 'cannot manage this member';
  END IF;

  IF p_role IS NOT NULL AND p_role <> v_target.role THEN
    IF NOT inviter_can_assign_role(v_inviter_role, p_role) THEN
      RAISE EXCEPTION 'cannot assign this role';
    END IF;
    IF NOT inviter_can_manage_member(v_inviter_role, p_role) THEN
      RAISE EXCEPTION 'cannot assign this role';
    END IF;
    v_target.role := p_role;
  END IF;

  IF p_is_active IS NOT NULL AND p_is_active = false THEN
    IF v_target.role = 'owner' AND count_active_owners(v_org_id) <= 1 THEN
      RAISE EXCEPTION 'cannot deactivate last owner';
    END IF;
    IF v_target.role = 'teacher'
      AND teacher_member_has_future_lessons(v_org_id, p_member_id)
    THEN
      RAISE EXCEPTION 'teacher_has_future_lessons';
    END IF;
    v_target.is_active := false;
  ELSIF p_is_active IS NOT NULL THEN
    v_target.is_active := true;
  END IF;

  IF p_scope IS NOT NULL THEN
    v_target.scope := p_scope;
  END IF;

  IF p_meta IS NOT NULL THEN
    IF jsonb_typeof(p_meta) <> 'object' THEN
      RAISE EXCEPTION 'invalid meta';
    END IF;
    v_target.meta := p_meta;
  END IF;

  IF p_display_name IS NOT NULL THEN
    v_target.display_name := nullif(trim(p_display_name), '');
  END IF;

  v_profile_update := (
    p_first_name IS NOT NULL
    OR p_last_name IS NOT NULL
    OR p_patronymic IS NOT NULL
    OR p_contact_email IS NOT NULL
    OR p_phone IS NOT NULL
    OR p_telegram IS NOT NULL
    OR p_profile_notes IS NOT NULL
  );

  IF v_profile_update AND v_inviter_role NOT IN ('owner', 'director') THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  IF p_first_name IS NOT NULL THEN
    v_target.first_name := nullif(trim(p_first_name), '');
  END IF;
  IF p_last_name IS NOT NULL THEN
    v_target.last_name := nullif(trim(p_last_name), '');
  END IF;
  IF p_patronymic IS NOT NULL THEN
    v_target.patronymic := nullif(trim(p_patronymic), '');
  END IF;
  IF p_contact_email IS NOT NULL THEN
    v_target.contact_email := nullif(trim(p_contact_email), '');
  END IF;
  IF p_phone IS NOT NULL THEN
    v_target.phone := nullif(trim(p_phone), '');
  END IF;
  IF p_telegram IS NOT NULL THEN
    v_target.telegram := nullif(trim(p_telegram), '');
  END IF;
  IF p_profile_notes IS NOT NULL THEN
    v_target.profile_notes := nullif(trim(p_profile_notes), '');
  END IF;

  UPDATE organization_members
  SET role = v_target.role,
      scope = v_target.scope,
      meta = v_target.meta,
      is_active = v_target.is_active,
      display_name = v_target.display_name,
      first_name = v_target.first_name,
      last_name = v_target.last_name,
      patronymic = v_target.patronymic,
      contact_email = v_target.contact_email,
      phone = v_target.phone,
      telegram = v_target.telegram,
      profile_notes = v_target.profile_notes
  WHERE id = p_member_id;
END;
$$;

COMMIT;
