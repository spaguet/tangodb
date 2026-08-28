-- S32 / H7: teacher reads clients through masking view (names + id, no contact PII).
-- DROP teacher SELECT on base clients only after SPA can use clients_teacher_v.
-- Operational/financial SELECT (clients_select_full_access) unchanged.
-- security_invoker=false: teacher has no SELECT on base after this migration (same as other R4 views).

BEGIN;

DROP VIEW IF EXISTS clients_teacher_v;

CREATE VIEW clients_teacher_v
WITH (security_invoker = false) AS
SELECT
  c.id,
  c.organization_id,
  c.first_name,
  c.last_name,
  c.is_minor,
  c.archived_at,
  c.created_at
FROM clients c
WHERE c.organization_id = auth_organization_id()
  AND business_row_readable()
  AND current_member_role() = 'teacher'
  AND teacher_can_access_client(c.id);

COMMENT ON VIEW clients_teacher_v IS
  'S32/H7: teacher-safe clients (id, names, is_minor, archive). No phone/telegram/email/guardian PII.';

GRANT SELECT ON clients_teacher_v TO authenticated;

DROP POLICY IF EXISTS clients_select_teacher ON clients;

COMMIT;
