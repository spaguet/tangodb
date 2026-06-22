-- Teacher schedule needs paid status (operational, not financial) for red-cell indicator.
-- Price remains excluded from personal_lessons_teacher_v.

BEGIN;

CREATE OR REPLACE VIEW personal_lessons_teacher_v
WITH (security_invoker = false) AS
SELECT
  pl.id,
  pl.organization_id,
  pl.type,
  pl.client_id1,
  pl.client_id2,
  pl.client_id3,
  pl.date,
  pl.time_start,
  pl.time_end,
  pl.discipline_id,
  pl.subscription_id,
  pl.location_id,
  pl.teacher_member_id,
  pl.attendance_status,
  pl.created_at,
  pl.paid
FROM personal_lessons pl
WHERE pl.organization_id = auth_organization_id()
  AND business_row_readable()
  AND current_member_role() = 'teacher'
  AND teacher_can_access_lesson(pl.id);

COMMIT;
