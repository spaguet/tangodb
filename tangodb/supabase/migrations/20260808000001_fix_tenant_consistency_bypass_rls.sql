-- Fix: teacher subscription payment fails with
-- "subscription_id does not belong to organization" even though the subscription exists.
-- BEFORE triggers run in the invoker context; teachers read subscriptions only via
-- subscriptions_teacher_v, so EXISTS checks on subscriptions inside
-- enforce_tenant_row_org_consistency fail under RLS. SECURITY DEFINER bypasses RLS for
-- org-consistency checks only (not authorization).

BEGIN;

CREATE OR REPLACE FUNCTION enforce_tenant_row_org_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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

COMMIT;
