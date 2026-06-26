-- F5: operational expenses table, RLS, audit
-- Ref: tangodb_expenses_payroll_plan.md §2, Промт 19

BEGIN;

-- =============================================================================
-- 1. Expenses table
-- =============================================================================

CREATE TABLE expenses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  amount          NUMERIC NOT NULL CHECK (amount > 0),
  category        TEXT NOT NULL CHECK (category IN (
    'rent', 'utilities', 'marketing', 'salary', 'other'
  )),
  description     TEXT,
  expense_date    DATE NOT NULL CHECK (expense_date <= CURRENT_DATE),
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, created_by)
    REFERENCES organization_members (organization_id, id)
);

CREATE INDEX idx_expenses_org_date ON expenses (organization_id, expense_date DESC);

-- =============================================================================
-- 2. Tenant consistency (extend shared trigger)
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
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER expenses_org_consistency
  BEFORE INSERT OR UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_row_org_consistency();

-- =============================================================================
-- 3. Audit trigger
-- =============================================================================

CREATE TRIGGER audit_expenses
  AFTER INSERT OR UPDATE OR DELETE ON expenses
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

-- =============================================================================
-- 4. RLS — owner, director, accountant only
-- =============================================================================

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY expenses_select
  ON expenses FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_financial()
  );

CREATE POLICY expenses_insert
  ON expenses FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_read_financial()
  );

CREATE POLICY expenses_update
  ON expenses FOR UPDATE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_read_financial()
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_read_financial()
  );

CREATE POLICY expenses_delete
  ON expenses FOR DELETE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_read_financial()
  );

COMMIT;
