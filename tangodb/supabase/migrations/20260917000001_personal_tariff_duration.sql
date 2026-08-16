-- Personal tariff duration: schema stage 1 (PL-TARIFF Prompt 2)
-- Ref: tangodb_personal_tariff_duration_payments.md §6.1, §4.2–§4.3
-- Legacy pair lessons without payer_client_id: debt row shows client_id1 (expected).

BEGIN;

-- =============================================================================
-- 1. Tariff duration on prices (NULL = legacy fixed tariff, no auto-backfill)
-- =============================================================================

ALTER TABLE prices
  ADD COLUMN IF NOT EXISTS duration_minutes INT NULL;

ALTER TABLE prices
  DROP CONSTRAINT IF EXISTS prices_duration_minutes_check;

ALTER TABLE prices
  ADD CONSTRAINT prices_duration_minutes_check
  CHECK (duration_minutes IS NULL OR duration_minutes > 0);

-- =============================================================================
-- 2. personal_lessons.price_id + payer_client_id
-- =============================================================================

ALTER TABLE personal_lessons
  ADD COLUMN IF NOT EXISTS price_id UUID NULL;

ALTER TABLE personal_lessons
  DROP CONSTRAINT IF EXISTS personal_lessons_organization_id_price_id_fkey;

ALTER TABLE personal_lessons
  ADD CONSTRAINT personal_lessons_organization_id_price_id_fkey
  FOREIGN KEY (organization_id, price_id)
  REFERENCES prices (organization_id, id) ON DELETE SET NULL;

ALTER TABLE personal_lessons
  ADD COLUMN IF NOT EXISTS payer_client_id UUID NULL;

ALTER TABLE personal_lessons
  DROP CONSTRAINT IF EXISTS personal_lessons_payer_client_check;

ALTER TABLE personal_lessons
  ADD CONSTRAINT personal_lessons_payer_client_check
  CHECK (
    payer_client_id IS NULL
    OR payer_client_id = client_id1
    OR (client_id2 IS NOT NULL AND payer_client_id = client_id2)
    OR (client_id3 IS NOT NULL AND payer_client_id = client_id3)
    OR (client_id4 IS NOT NULL AND payer_client_id = client_id4)
  );

ALTER TABLE personal_lessons
  DROP CONSTRAINT IF EXISTS personal_lessons_organization_id_payer_client_id_fkey;

ALTER TABLE personal_lessons
  ADD CONSTRAINT personal_lessons_organization_id_payer_client_id_fkey
  FOREIGN KEY (organization_id, payer_client_id)
  REFERENCES clients (organization_id, id);

-- =============================================================================
-- 3. Payment tariff snapshot (new payments.price_id — not single_visits reuse)
-- =============================================================================

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS price_id UUID NULL;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS tariff_duration_minutes INT NULL;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS tariff_units NUMERIC(12,4) NULL;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS tariff_price NUMERIC NULL;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS tariff_label TEXT NULL;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS lesson_duration_minutes INT NULL;

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_organization_id_price_id_fkey;

ALTER TABLE payments
  ADD CONSTRAINT payments_organization_id_price_id_fkey
  FOREIGN KEY (organization_id, price_id)
  REFERENCES prices (organization_id, id) ON DELETE SET NULL;

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_tariff_duration_minutes_check;

ALTER TABLE payments
  ADD CONSTRAINT payments_tariff_duration_minutes_check
  CHECK (tariff_duration_minutes IS NULL OR tariff_duration_minutes > 0);

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_tariff_units_check;

ALTER TABLE payments
  ADD CONSTRAINT payments_tariff_units_check
  CHECK (tariff_units IS NULL OR tariff_units > 0);

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_tariff_price_check;

ALTER TABLE payments
  ADD CONSTRAINT payments_tariff_price_check
  CHECK (tariff_price IS NULL OR tariff_price >= 0);

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_lesson_duration_minutes_check;

ALTER TABLE payments
  ADD CONSTRAINT payments_lesson_duration_minutes_check
  CHECK (lesson_duration_minutes IS NULL OR lesson_duration_minutes > 0);

-- =============================================================================
-- 4. Tenant consistency — price_id on personal_lessons / payments
-- =============================================================================

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
    IF NEW.price_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM prices pr
      WHERE pr.organization_id = NEW.organization_id AND pr.id = NEW.price_id
    ) THEN
      RAISE EXCEPTION 'price_id does not belong to organization';
    END IF;
    IF NEW.payer_client_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM clients c
      WHERE c.organization_id = NEW.organization_id AND c.id = NEW.payer_client_id
    ) THEN
      RAISE EXCEPTION 'payer_client_id does not belong to organization';
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
    IF NEW.price_id IS NOT NULL AND NOT EXISTS (
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
    IF NEW.price_id IS NOT NULL AND NOT EXISTS (
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
  END IF;

  RETURN NEW;
END;
$$;

-- =============================================================================
-- 5. financial_debtors_v — payer display, client_id4, other participants in detail
-- =============================================================================

DROP VIEW IF EXISTS financial_debtors_v;

CREATE OR REPLACE VIEW financial_debtors_v
WITH (security_invoker = false) AS
SELECT
  s.organization_id,
  ('sub-' || s.id::text) AS id,
  NULL::uuid AS personal_lesson_id,
  s.client_id1 AS client_id1,
  s.client_id2 AS client_id2,
  s.client_id3 AS client_id3,
  NULL::uuid AS client_id4,
  NULL::uuid AS payer_client_id,
  NULL::text AS lesson_time_start,
  NULL::text AS lesson_time_end,
  NULL::uuid AS location_id,
  s.discipline_id AS discipline_id,
  NULL::uuid AS teacher_member_id,
  'subscription'::text AS kind,
  COALESCE(
    NULLIF(
      TRIM(BOTH ' &' FROM CONCAT_WS(
        ' & ',
        TRIM(c1.last_name || ' ' || c1.first_name),
        CASE WHEN s.client_id2 IS NOT NULL THEN TRIM(c2.last_name || ' ' || c2.first_name) END,
        CASE WHEN s.client_id3 IS NOT NULL THEN TRIM(c3.last_name || ' ' || c3.first_name) END
      )),
      ''
    ),
    s.client_id1::text
  ) AS client_display,
  COALESCE(NULLIF(TRIM(c1.telegram), ''), '—') AS contact,
  ('Осталось ' || s.lessons_left::text || ' из ' || s.lessons_total::text || ' занятий') AS detail,
  0::numeric AS amount,
  0::numeric AS billed_amount,
  0::numeric AS paid_amount,
  s.lessons_left,
  s.lessons_total,
  NULL::date AS lesson_date,
  NULL::uuid AS rental_id,
  NULL::uuid AS renter_id
FROM subscriptions s
INNER JOIN clients c1
  ON c1.organization_id = s.organization_id AND c1.id = s.client_id1
LEFT JOIN clients c2
  ON c2.organization_id = s.organization_id AND c2.id = s.client_id2
LEFT JOIN clients c3
  ON c3.organization_id = s.organization_id AND c3.id = s.client_id3
LEFT JOIN organization_settings os
  ON os.organization_id = s.organization_id
WHERE s.organization_id = auth_organization_id()
  AND business_row_readable()
  AND can_read_financial()
  AND s.status = 'active'
  AND s.lessons_left <= COALESCE(os.low_balance_threshold, 2)

UNION ALL

SELECT
  pl.organization_id,
  ('pl-' || pl.id::text) AS id,
  pl.id AS personal_lesson_id,
  pl.client_id1,
  pl.client_id2,
  pl.client_id3,
  pl.client_id4,
  pl.payer_client_id,
  pl.time_start AS lesson_time_start,
  pl.time_end AS lesson_time_end,
  pl.location_id,
  pl.discipline_id,
  pl.teacher_member_id,
  'personal'::text AS kind,
  COALESCE(
    NULLIF(TRIM(cp.last_name || ' ' || cp.first_name), ''),
    COALESCE(pl.payer_client_id, pl.client_id1)::text,
    'Клиент не указан'
  ) AS client_display,
  COALESCE(NULLIF(TRIM(cp.telegram), ''), '—') AS contact,
  CASE
    WHEN NULLIF(
      TRIM(BOTH ', ' FROM CONCAT_WS(
        ', ',
        CASE
          WHEN pl.client_id1 IS NOT NULL
            AND pl.client_id1 IS DISTINCT FROM COALESCE(pl.payer_client_id, pl.client_id1)
          THEN TRIM(c1.last_name || ' ' || c1.first_name)
        END,
        CASE
          WHEN pl.client_id2 IS NOT NULL
            AND pl.client_id2 IS DISTINCT FROM COALESCE(pl.payer_client_id, pl.client_id1)
          THEN TRIM(c2.last_name || ' ' || c2.first_name)
        END,
        CASE
          WHEN pl.client_id3 IS NOT NULL
            AND pl.client_id3 IS DISTINCT FROM COALESCE(pl.payer_client_id, pl.client_id1)
          THEN TRIM(c3.last_name || ' ' || c3.first_name)
        END,
        CASE
          WHEN pl.client_id4 IS NOT NULL
            AND pl.client_id4 IS DISTINCT FROM COALESCE(pl.payer_client_id, pl.client_id1)
          THEN TRIM(c4.last_name || ' ' || c4.first_name)
        END
      )),
      ''
    ) IS NOT NULL THEN
      ('Персональный · ' || pl.date::text || ' · с '
        || TRIM(BOTH ', ' FROM CONCAT_WS(
          ', ',
          CASE
            WHEN pl.client_id1 IS NOT NULL
              AND pl.client_id1 IS DISTINCT FROM COALESCE(pl.payer_client_id, pl.client_id1)
            THEN TRIM(c1.last_name || ' ' || c1.first_name)
          END,
          CASE
            WHEN pl.client_id2 IS NOT NULL
              AND pl.client_id2 IS DISTINCT FROM COALESCE(pl.payer_client_id, pl.client_id1)
            THEN TRIM(c2.last_name || ' ' || c2.first_name)
          END,
          CASE
            WHEN pl.client_id3 IS NOT NULL
              AND pl.client_id3 IS DISTINCT FROM COALESCE(pl.payer_client_id, pl.client_id1)
            THEN TRIM(c3.last_name || ' ' || c3.first_name)
          END,
          CASE
            WHEN pl.client_id4 IS NOT NULL
              AND pl.client_id4 IS DISTINCT FROM COALESCE(pl.payer_client_id, pl.client_id1)
            THEN TRIM(c4.last_name || ' ' || c4.first_name)
          END
        )))
    ELSE
      ('Персональный · ' || pl.date::text)
  END AS detail,
  GREATEST(pl.price - pl.paid_amount, 0) AS amount,
  pl.price AS billed_amount,
  pl.paid_amount AS paid_amount,
  NULL::integer AS lessons_left,
  NULL::integer AS lessons_total,
  pl.date AS lesson_date,
  NULL::uuid AS rental_id,
  NULL::uuid AS renter_id
FROM personal_lessons pl
LEFT JOIN clients cp
  ON cp.organization_id = pl.organization_id
  AND cp.id = COALESCE(pl.payer_client_id, pl.client_id1)
LEFT JOIN clients c1
  ON c1.organization_id = pl.organization_id AND c1.id = pl.client_id1
LEFT JOIN clients c2
  ON c2.organization_id = pl.organization_id AND c2.id = pl.client_id2
LEFT JOIN clients c3
  ON c3.organization_id = pl.organization_id AND c3.id = pl.client_id3
LEFT JOIN clients c4
  ON c4.organization_id = pl.organization_id AND c4.id = pl.client_id4
WHERE pl.organization_id = auth_organization_id()
  AND business_row_readable()
  AND can_read_financial()
  AND pl.paid = 'no'

UNION ALL

SELECT
  r.organization_id,
  ('rent-' || r.id::text) AS id,
  NULL::uuid AS personal_lesson_id,
  NULL::uuid AS client_id1,
  NULL::uuid AS client_id2,
  NULL::uuid AS client_id3,
  NULL::uuid AS client_id4,
  NULL::uuid AS payer_client_id,
  r.time_start AS lesson_time_start,
  r.time_end AS lesson_time_end,
  r.location_id,
  NULL::uuid AS discipline_id,
  NULL::uuid AS teacher_member_id,
  'rental'::text AS kind,
  ren.display_name AS client_display,
  COALESCE(
    NULLIF(TRIM(ren.contact_phone), ''),
    NULLIF(TRIM(ren.contact_email), ''),
    '—'
  ) AS contact,
  ('Аренда · ' || r.rental_date::text || COALESCE(' · ' || loc.name, '')) AS detail,
  GREATEST(
    _rental_effective_amount(r.fixed_amount, r.final_amount)
      - _rental_paid_total(r.id, r.organization_id),
    0
  ) AS amount,
  _rental_effective_amount(r.fixed_amount, r.final_amount) AS billed_amount,
  _rental_paid_total(r.id, r.organization_id) AS paid_amount,
  NULL::integer AS lessons_left,
  NULL::integer AS lessons_total,
  r.rental_date AS lesson_date,
  r.id AS rental_id,
  r.renter_id AS renter_id
FROM rentals r
INNER JOIN renters ren
  ON ren.id = r.renter_id AND ren.organization_id = r.organization_id
LEFT JOIN locations loc
  ON loc.id = r.location_id AND loc.organization_id = r.organization_id
WHERE r.organization_id = auth_organization_id()
  AND business_row_readable()
  AND can_read_financial()
  AND r.booking_status = 'confirmed'
  AND _rental_effective_amount(r.fixed_amount, r.final_amount) > 0
  AND _rental_paid_total(r.id, r.organization_id)
      < _rental_effective_amount(r.fixed_amount, r.final_amount);

GRANT SELECT ON financial_debtors_v TO authenticated;

COMMIT;
