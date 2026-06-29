-- Align group attendance access with schedule_group_ids scope (not only assigned teacher on slot)

BEGIN;

CREATE OR REPLACE FUNCTION default_teacher_scope()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT '{
    "discipline_ids": [],
    "location_ids": [],
    "schedule_group_ids": [],
    "all_disciplines": true,
    "all_locations": true,
    "all_groups": true,
    "can_view_all_clients": false
  }'::jsonb;
$$;

CREATE OR REPLACE FUNCTION teacher_scope_has_access(p_scope jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    COALESCE((p_scope ->> 'all_disciplines')::boolean, false)
    OR COALESCE((p_scope ->> 'all_locations')::boolean, false)
    OR COALESCE((p_scope ->> 'all_groups')::boolean, false)
    OR jsonb_array_length(COALESCE(p_scope -> 'discipline_ids', '[]'::jsonb)) > 0
    OR jsonb_array_length(COALESCE(p_scope -> 'location_ids', '[]'::jsonb)) > 0
    OR jsonb_array_length(COALESCE(p_scope -> 'schedule_group_ids', '[]'::jsonb)) > 0;
$$;

CREATE OR REPLACE FUNCTION teacher_can_mark_group_attendance(
  p_date date,
  p_schedule_group_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_dow int;
BEGIN
  IF NOT teacher_has_schedule_group_access(p_schedule_group_id) THEN
    RETURN false;
  END IF;

  v_dow := EXTRACT(ISODOW FROM p_date)::int;

  RETURN EXISTS (
    SELECT 1
    FROM schedule_slots ss
    WHERE ss.organization_id = auth_organization_id()
      AND ss.class_id = p_schedule_group_id
      AND ss.day_of_week = v_dow
      AND COALESCE(ss.valid_from, DATE '2000-01-01') <= p_date
      AND (ss.valid_to IS NULL OR ss.valid_to >= p_date)
  );
END;
$$;

COMMIT;
