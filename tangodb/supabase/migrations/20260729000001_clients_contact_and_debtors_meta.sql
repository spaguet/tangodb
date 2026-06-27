-- Client phone/email fields; structured metadata on financial_debtors_v for UI i18n

BEGIN;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';

CREATE OR REPLACE VIEW financial_debtors_v
WITH (security_invoker = false) AS
SELECT
  s.organization_id,
  ('sub-' || s.id::text) AS id,
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
  s.lessons_left AS lessons_left,
  s.lessons_total AS lessons_total,
  NULL::date AS lesson_date
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
  'personal'::text AS kind,
  COALESCE(
    NULLIF(
      TRIM(BOTH ' &' FROM CONCAT_WS(
        ' & ',
        CASE WHEN pl.client_id1 IS NOT NULL THEN TRIM(c1.last_name || ' ' || c1.first_name) END,
        CASE WHEN pl.client_id2 IS NOT NULL THEN TRIM(c2.last_name || ' ' || c2.first_name) END,
        CASE WHEN pl.client_id3 IS NOT NULL THEN TRIM(c3.last_name || ' ' || c3.first_name) END
      )),
      ''
    ),
    COALESCE(pl.client_id1::text, 'Клиент не указан')
  ) AS client_display,
  COALESCE(NULLIF(TRIM(c1.telegram), ''), '—') AS contact,
  ('Персональный · ' || pl.date::text) AS detail,
  pl.price AS amount,
  NULL::integer AS lessons_left,
  NULL::integer AS lessons_total,
  pl.date AS lesson_date
FROM personal_lessons pl
LEFT JOIN clients c1
  ON c1.organization_id = pl.organization_id AND c1.id = pl.client_id1
LEFT JOIN clients c2
  ON c2.organization_id = pl.organization_id AND c2.id = pl.client_id2
LEFT JOIN clients c3
  ON c3.organization_id = pl.organization_id AND c3.id = pl.client_id3
WHERE pl.organization_id = auth_organization_id()
  AND business_row_readable()
  AND can_read_financial()
  AND pl.paid = 'no';

GRANT SELECT ON financial_debtors_v TO authenticated;

COMMIT;
