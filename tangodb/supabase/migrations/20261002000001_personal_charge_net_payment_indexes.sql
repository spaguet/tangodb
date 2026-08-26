-- 20260931000001 rewrote personal_lesson_charge_net_payment with
-- OR + correlated EXISTS over payments. financial_debtors_v calls that
-- function three times per charge row, so the planner nested-looped org
-- payments × unpaid charges and hit statement_timeout.
--
-- Fix: two indexable SUMs in the helper; hash-aggregate joins in the view
-- so the debtors list scans payments once per org, not once per charge.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_payments_org_personal_lesson_charge
  ON payments (organization_id, personal_lesson_charge_id)
  WHERE personal_lesson_charge_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_org_lesson_client_unlinked
  ON payments (organization_id, personal_lesson_id, client_id)
  WHERE personal_lesson_id IS NOT NULL
    AND personal_lesson_charge_id IS NULL;

CREATE OR REPLACE FUNCTION personal_lesson_charge_net_payment(p_org_id uuid, p_charge_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    COALESCE((
      SELECT SUM(payment_effective_amount(p))
      FROM payments p
      WHERE p.organization_id = p_org_id
        AND p.personal_lesson_charge_id = p_charge_id
    ), 0)
    + COALESCE((
      SELECT SUM(payment_effective_amount(p))
      FROM personal_lesson_charges plc
      INNER JOIN payments p
        ON p.organization_id = plc.organization_id
       AND p.personal_lesson_id = plc.personal_lesson_id
       AND p.client_id = plc.client_id
       AND p.personal_lesson_charge_id IS NULL
      WHERE plc.organization_id = p_org_id
        AND plc.id = p_charge_id
    ), 0);
$$;

DROP VIEW IF EXISTS financial_debtors_v;

CREATE OR REPLACE VIEW financial_debtors_v
WITH (security_invoker = false) AS
SELECT
  s.organization_id,
  ('sub-' || s.id::text) AS id,
  NULL::uuid AS personal_lesson_id,
  NULL::uuid AS personal_lesson_charge_id,
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
  NULL::uuid AS renter_id,
  NULL::uuid AS price_id,
  NULL::text AS other_participants
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
  ('plc-' || plc.id::text) AS id,
  pl.id AS personal_lesson_id,
  plc.id AS personal_lesson_charge_id,
  pl.client_id1,
  pl.client_id2,
  pl.client_id3,
  pl.client_id4,
  plc.client_id AS payer_client_id,
  pl.time_start AS lesson_time_start,
  pl.time_end AS lesson_time_end,
  pl.location_id,
  pl.discipline_id,
  pl.teacher_member_id,
  'personal'::text AS kind,
  COALESCE(
    NULLIF(TRIM(cp.last_name || ' ' || cp.first_name), ''),
    plc.client_id::text,
    'Клиент не указан'
  ) AS client_display,
  COALESCE(NULLIF(TRIM(cp.telegram), ''), '—') AS contact,
  CASE
    WHEN NULLIF(
      TRIM(BOTH ', ' FROM CONCAT_WS(
        ', ',
        CASE
          WHEN pl.client_id1 IS NOT NULL AND pl.client_id1 IS DISTINCT FROM plc.client_id
          THEN TRIM(c1.last_name || ' ' || c1.first_name)
        END,
        CASE
          WHEN pl.client_id2 IS NOT NULL AND pl.client_id2 IS DISTINCT FROM plc.client_id
          THEN TRIM(c2.last_name || ' ' || c2.first_name)
        END,
        CASE
          WHEN pl.client_id3 IS NOT NULL AND pl.client_id3 IS DISTINCT FROM plc.client_id
          THEN TRIM(c3.last_name || ' ' || c3.first_name)
        END,
        CASE
          WHEN pl.client_id4 IS NOT NULL AND pl.client_id4 IS DISTINCT FROM plc.client_id
          THEN TRIM(c4.last_name || ' ' || c4.first_name)
        END
      )),
      ''
    ) IS NOT NULL THEN
      ('Персональный · ' || pl.date::text || ' · с '
        || TRIM(BOTH ', ' FROM CONCAT_WS(
          ', ',
          CASE
            WHEN pl.client_id1 IS NOT NULL AND pl.client_id1 IS DISTINCT FROM plc.client_id
            THEN TRIM(c1.last_name || ' ' || c1.first_name)
          END,
          CASE
            WHEN pl.client_id2 IS NOT NULL AND pl.client_id2 IS DISTINCT FROM plc.client_id
            THEN TRIM(c2.last_name || ' ' || c2.first_name)
          END,
          CASE
            WHEN pl.client_id3 IS NOT NULL AND pl.client_id3 IS DISTINCT FROM plc.client_id
            THEN TRIM(c3.last_name || ' ' || c3.first_name)
          END,
          CASE
            WHEN pl.client_id4 IS NOT NULL AND pl.client_id4 IS DISTINCT FROM plc.client_id
            THEN TRIM(c4.last_name || ' ' || c4.first_name)
          END
        )))
    ELSE
      ('Персональный · ' || pl.date::text)
  END AS detail,
  GREATEST(
    plc.billed_amount
      - COALESCE(pay_linked.paid_amount, 0)
      - COALESCE(pay_unlinked.paid_amount, 0),
    0
  ) AS amount,
  plc.billed_amount AS billed_amount,
  COALESCE(pay_linked.paid_amount, 0) + COALESCE(pay_unlinked.paid_amount, 0) AS paid_amount,
  NULL::integer AS lessons_left,
  NULL::integer AS lessons_total,
  pl.date AS lesson_date,
  NULL::uuid AS rental_id,
  NULL::uuid AS renter_id,
  pl.price_id AS price_id,
  NULLIF(
    TRIM(BOTH ', ' FROM CONCAT_WS(
      ', ',
      CASE
        WHEN pl.client_id1 IS NOT NULL AND pl.client_id1 IS DISTINCT FROM plc.client_id
        THEN TRIM(c1.last_name || ' ' || c1.first_name)
      END,
      CASE
        WHEN pl.client_id2 IS NOT NULL AND pl.client_id2 IS DISTINCT FROM plc.client_id
        THEN TRIM(c2.last_name || ' ' || c2.first_name)
      END,
      CASE
        WHEN pl.client_id3 IS NOT NULL AND pl.client_id3 IS DISTINCT FROM plc.client_id
        THEN TRIM(c3.last_name || ' ' || c3.first_name)
      END,
      CASE
        WHEN pl.client_id4 IS NOT NULL AND pl.client_id4 IS DISTINCT FROM plc.client_id
        THEN TRIM(c4.last_name || ' ' || c4.first_name)
      END
    )),
    ''
  ) AS other_participants
FROM personal_lesson_charges plc
INNER JOIN personal_lessons pl
  ON pl.organization_id = plc.organization_id
  AND pl.id = plc.personal_lesson_id
LEFT JOIN clients cp
  ON cp.organization_id = plc.organization_id
  AND cp.id = plc.client_id
LEFT JOIN clients c1
  ON c1.organization_id = pl.organization_id AND c1.id = pl.client_id1
LEFT JOIN clients c2
  ON c2.organization_id = pl.organization_id AND c2.id = pl.client_id2
LEFT JOIN clients c3
  ON c3.organization_id = pl.organization_id AND c3.id = pl.client_id3
LEFT JOIN clients c4
  ON c4.organization_id = pl.organization_id AND c4.id = pl.client_id4
LEFT JOIN (
  SELECT
    p.personal_lesson_charge_id,
    COALESCE(SUM(payment_effective_amount(p)), 0) AS paid_amount
  FROM payments p
  WHERE p.organization_id = auth_organization_id()
    AND p.personal_lesson_charge_id IS NOT NULL
  GROUP BY p.personal_lesson_charge_id
) pay_linked ON pay_linked.personal_lesson_charge_id = plc.id
LEFT JOIN (
  SELECT
    p.personal_lesson_id,
    p.client_id,
    COALESCE(SUM(payment_effective_amount(p)), 0) AS paid_amount
  FROM payments p
  WHERE p.organization_id = auth_organization_id()
    AND p.personal_lesson_charge_id IS NULL
    AND p.personal_lesson_id IS NOT NULL
  GROUP BY p.personal_lesson_id, p.client_id
) pay_unlinked
  ON pay_unlinked.personal_lesson_id = pl.id
 AND pay_unlinked.client_id = plc.client_id
WHERE pl.organization_id = auth_organization_id()
  AND business_row_readable()
  AND can_read_financial()
  AND pl.paid = 'no'
  AND GREATEST(
    plc.billed_amount
      - COALESCE(pay_linked.paid_amount, 0)
      - COALESCE(pay_unlinked.paid_amount, 0),
    0
  ) > 0

UNION ALL

SELECT
  r.organization_id,
  ('rent-' || r.id::text) AS id,
  NULL::uuid AS personal_lesson_id,
  NULL::uuid AS personal_lesson_charge_id,
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
  r.renter_id AS renter_id,
  NULL::uuid AS price_id,
  NULL::text AS other_participants
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
