-- Group display name for schedule slots (e.g. "Старшая группа")

ALTER TABLE schedule_slots
  ADD COLUMN IF NOT EXISTS group_name TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN schedule_slots.group_name IS 'Display name for the group, e.g. Старшая группа';

DROP INDEX IF EXISTS schedule_slots_no_discipline_unique;
DROP INDEX IF EXISTS schedule_slots_with_discipline_unique;

CREATE UNIQUE INDEX schedule_slots_with_group_unique
  ON schedule_slots (organization_id, day_of_week, time, lower(trim(group_name)))
  WHERE trim(group_name) <> '';

CREATE UNIQUE INDEX schedule_slots_legacy_no_group_unique
  ON schedule_slots (organization_id, day_of_week, time, discipline_id)
  WHERE trim(group_name) = '' AND discipline_id IS NOT NULL;

CREATE UNIQUE INDEX schedule_slots_legacy_no_discipline_unique
  ON schedule_slots (organization_id, day_of_week, time)
  WHERE trim(group_name) = '' AND discipline_id IS NULL;
