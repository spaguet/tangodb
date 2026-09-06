-- Substitute can SELECT the covered slot/lesson/location without permanent group scope.

BEGIN;

CREATE POLICY schedule_slots_select_teacher_substitute
  ON schedule_slots FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() = 'teacher'
    AND EXISTS (
      SELECT 1
      FROM lesson_occurrence_substitutes s
      WHERE s.organization_id = schedule_slots.organization_id
        AND s.occurrence_kind = 'group'
        AND s.schedule_slot_id = schedule_slots.id
        AND s.substitute_teacher_member_id = auth_member_id()
    )
  );

CREATE POLICY personal_lessons_select_teacher_substitute
  ON personal_lessons FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() = 'teacher'
    AND cancelled_at IS NULL
    AND teacher_is_personal_occurrence_substitute(id)
  );

CREATE POLICY locations_select_teacher_substitute
  ON locations FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() = 'teacher'
    AND EXISTS (
      SELECT 1
      FROM lesson_occurrence_substitutes s
      LEFT JOIN schedule_slots ss
        ON ss.organization_id = s.organization_id
       AND ss.id = s.schedule_slot_id
      LEFT JOIN personal_lessons pl
        ON pl.organization_id = s.organization_id
       AND pl.id = s.personal_lesson_id
      WHERE s.organization_id = locations.organization_id
        AND s.substitute_teacher_member_id = auth_member_id()
        AND (
          ss.location_id = locations.id
          OR pl.location_id = locations.id
        )
    )
  );

COMMIT;
