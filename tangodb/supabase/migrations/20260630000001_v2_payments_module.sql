-- TangoDB v2 RBAC R3: payments journal, RLS, teacher RPC, backfill
-- Ref: tangodb_roles_rbac_TZ.md §7 R3

BEGIN;

-- =============================================================================
-- 1. Payments table
-- =============================================================================

CREATE TABLE payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  client_id           UUID NOT NULL,
  client_display      TEXT NOT NULL DEFAULT '',
  amount              NUMERIC NOT NULL CHECK (amount >= 0),
  method              TEXT NOT NULL DEFAULT 'cash'
    CHECK (method IN ('cash', 'transfer', 'card', 'other')),
  subscription_id     UUID,
  personal_lesson_id  UUID,
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, client_id)
    REFERENCES clients (organization_id, id),
  FOREIGN KEY (organization_id, subscription_id)
    REFERENCES subscriptions (organization_id, id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, personal_lesson_id)
    REFERENCES personal_lessons (organization_id, id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, created_by)
    REFERENCES organization_members (organization_id, id),
  CHECK (
    subscription_id IS NOT NULL
    OR personal_lesson_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX payments_org_personal_lesson_unique
  ON payments (organization_id, personal_lesson_id)
  WHERE personal_lesson_id IS NOT NULL;

CREATE UNIQUE INDEX payments_org_subscription_sale_unique
  ON payments (organization_id, subscription_id)
  WHERE subscription_id IS NOT NULL AND personal_lesson_id IS NULL;

CREATE INDEX idx_payments_org_created ON payments (organization_id, created_at DESC);
CREATE INDEX idx_payments_org_client ON payments (organization_id, client_id);

-- =============================================================================
-- 2. Tenant consistency trigger
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
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER payments_org_consistency
  BEFORE INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_row_org_consistency();

-- =============================================================================
-- 3. Audit trigger
-- =============================================================================

CREATE TRIGGER audit_payments
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

-- =============================================================================
-- 4. RLS
-- =============================================================================

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY payments_select
  ON payments FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND (can_read_operational() OR can_read_financial())
  );

CREATE POLICY payments_write_admin
  ON payments FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  );

CREATE POLICY payments_update_admin
  ON payments FOR UPDATE TO authenticated
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

CREATE POLICY payments_delete_admin
  ON payments FOR DELETE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  );

-- =============================================================================
-- 5. Teacher RPC: record payment for own personal lesson only
-- =============================================================================

CREATE OR REPLACE FUNCTION record_personal_lesson_payment(
  p_lesson_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_lesson personal_lessons%ROWTYPE;
  v_member_id uuid := auth_member_id();
  v_client_display text;
BEGIN
  IF current_member_role() <> 'teacher' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Только преподаватель может использовать этот метод');
  END IF;

  IF p_method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недопустимый способ оплаты');
  END IF;

  IF p_amount IS NULL OR p_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Сумма должна быть неотрицательной');
  END IF;

  SELECT * INTO v_lesson
  FROM personal_lessons
  WHERE id = p_lesson_id
    AND organization_id = auth_organization_id();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Урок не найден');
  END IF;

  IF v_lesson.teacher_member_id IS DISTINCT FROM v_member_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Нет доступа к этому уроку');
  END IF;

  IF v_lesson.client_id1 IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'У урока не указан клиент');
  END IF;

  SELECT trim(coalesce(c.last_name, '') || ' ' || coalesce(c.first_name, ''))
  INTO v_client_display
  FROM clients c
  WHERE c.organization_id = v_lesson.organization_id
    AND c.id = v_lesson.client_id1;

  INSERT INTO payments (
    organization_id,
    client_id,
    client_display,
    amount,
    method,
    personal_lesson_id,
    created_by,
    created_at
  )
  VALUES (
    v_lesson.organization_id,
    v_lesson.client_id1,
    coalesce(nullif(v_client_display, ''), 'Клиент'),
    p_amount,
    p_method,
    v_lesson.id,
    v_member_id,
    now()
  )
  ON CONFLICT DO NOTHING;

  UPDATE personal_lessons
  SET paid = 'yes'
  WHERE id = v_lesson.id
    AND organization_id = v_lesson.organization_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION record_personal_lesson_payment(uuid, numeric, text) TO authenticated;

-- =============================================================================
-- 6. Backfill from personal_lessons.paid and subscription sales
-- =============================================================================

INSERT INTO payments (
  organization_id,
  client_id,
  client_display,
  amount,
  method,
  personal_lesson_id,
  created_by,
  created_at
)
SELECT
  pl.organization_id,
  pl.client_id1,
  trim(coalesce(c.last_name, '') || ' ' || coalesce(c.first_name, '')),
  pl.price,
  'cash',
  pl.id,
  pl.teacher_member_id,
  coalesce(pl.created_at, now())
FROM personal_lessons pl
JOIN clients c
  ON c.organization_id = pl.organization_id
 AND c.id = pl.client_id1
WHERE pl.paid = 'yes'
  AND pl.price > 0
  AND pl.client_id1 IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM payments p
    WHERE p.organization_id = pl.organization_id
      AND p.personal_lesson_id = pl.id
  );

INSERT INTO payments (
  organization_id,
  client_id,
  client_display,
  amount,
  method,
  subscription_id,
  created_at
)
SELECT
  s.organization_id,
  s.client_id1,
  trim(coalesce(c.last_name, '') || ' ' || coalesce(c.first_name, '')),
  coalesce(pr.price, 0),
  'cash',
  s.id,
  coalesce(s.created_at, now())
FROM subscriptions s
JOIN clients c
  ON c.organization_id = s.organization_id
 AND c.id = s.client_id1
LEFT JOIN prices pr
  ON pr.organization_id = s.organization_id
 AND pr.id = s.price_id
WHERE s.price_id IS NOT NULL
  AND coalesce(pr.price, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM payments p
    WHERE p.organization_id = s.organization_id
      AND p.subscription_id = s.id
      AND p.personal_lesson_id IS NULL
  );

COMMIT;
