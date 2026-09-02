-- Re-enqueue future pair/trio/quad personal lessons (and lessons whose client
-- names already contain "&") so Google Calendar titles list every person.
-- Do not use refresh_member: that purges the teacher's whole calendar.

BEGIN;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT pl.organization_id, pl.id, pl.date
    FROM personal_lessons pl
    WHERE pl.cancelled_at IS NULL
      AND pl.date >= CURRENT_DATE
      AND pl.teacher_member_id IS NOT NULL
      AND (
        pl.client_id2 IS NOT NULL
        OR pl.client_id3 IS NOT NULL
        OR pl.client_id4 IS NOT NULL
        OR EXISTS (
          SELECT 1
          FROM clients c
          WHERE c.organization_id = pl.organization_id
            AND c.id IN (pl.client_id1, pl.client_id2, pl.client_id3, pl.client_id4)
            AND (
              COALESCE(c.first_name, '') LIKE '%&%'
              OR COALESCE(c.last_name, '') LIKE '%&%'
            )
        )
      )
  LOOP
    PERFORM enqueue_calendar_sync(
      r.organization_id,
      'personal_lesson',
      r.id,
      r.date,
      'upsert'
    );
  END LOOP;
END;
$$;

COMMIT;
