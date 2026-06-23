-- Prices: optional discipline binding (alongside location binding)

ALTER TABLE prices
  ADD COLUMN IF NOT EXISTS discipline_id UUID;

ALTER TABLE prices
  ADD CONSTRAINT prices_discipline_fkey
  FOREIGN KEY (organization_id, discipline_id)
  REFERENCES disciplines (organization_id, id)
  ON DELETE SET NULL;

DROP INDEX IF EXISTS prices_org_type_lessons_global_idx;
DROP INDEX IF EXISTS prices_org_type_lessons_local_idx;

CREATE UNIQUE INDEX IF NOT EXISTS prices_org_type_lessons_fully_global_idx
  ON prices (organization_id, type, lessons)
  WHERE location_id IS NULL AND discipline_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS prices_org_type_lessons_location_idx
  ON prices (organization_id, type, lessons, location_id)
  WHERE location_id IS NOT NULL AND discipline_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS prices_org_type_lessons_discipline_idx
  ON prices (organization_id, type, lessons, discipline_id)
  WHERE discipline_id IS NOT NULL AND location_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS prices_org_type_lessons_location_discipline_idx
  ON prices (organization_id, type, lessons, location_id, discipline_id)
  WHERE location_id IS NOT NULL AND discipline_id IS NOT NULL;
