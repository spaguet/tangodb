-- Allow multiple tariffs with the same type/lessons/location/discipline binding.
-- Subscriptions reference prices by price_id; sale UI lists tariffs by label.
-- Partial unique indexes blocked editing/creating custom tariffs that share a binding key.

DROP INDEX IF EXISTS prices_org_type_lessons_fully_global_idx;
DROP INDEX IF EXISTS prices_org_type_lessons_location_idx;
DROP INDEX IF EXISTS prices_org_type_lessons_discipline_idx;
DROP INDEX IF EXISTS prices_org_type_lessons_location_discipline_idx;
