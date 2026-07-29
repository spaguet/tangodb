-- Conducted group lessons report + optional discipline category (CRM scenario 4 / Prompt 4)
-- Source of truth for "conducted": expanded schedule occurrence, not cancelled, lesson end <= now (org TZ).

BEGIN;

ALTER TABLE disciplines
  ADD COLUMN IF NOT EXISTS category TEXT;

COMMENT ON COLUMN disciplines.category IS
  'Optional grouping label for reports (e.g. ballroom, latin). Not used for matching by name.';

CREATE OR REPLACE FUNCTION _expand_group_slot_dates_in_range(
  p_slot schedule_slots,
  p_range_start date,
  p_range_end date
)
RETURNS date[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_valid_from date := COALESCE(p_slot.valid_from, DATE '2000-01-01');
BEGIN
  IF p_range_end < p_range_start THEN
    RETURN ARRAY[]::date[];
  END IF;

  IF p_slot.valid_to IS NOT NULL AND p_slot.valid_to <= p_slot.valid_from THEN
    IF v_valid_from >= p_range_start AND v_valid_from <= p_range_end THEN
      RETURN ARRAY[v_valid_from];
    END IF;
    RETURN ARRAY[]::date[];
  END IF;

  RETURN _group_slot_occurrences_in_range(p_slot, p_range_start, p_range_end);
END;
$$;

CREATE OR REPLACE FUNCTION _group_lesson_occurrence_conducted(
  p_occurrence_date date,
  p_time_end text,
  p_timezone text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_tz text := COALESCE(NULLIF(trim(p_timezone), ''), 'UTC');
  v_now_local timestamp;
  v_end_local timestamp;
BEGIN
  v_now_local := timezone(v_tz, now());
  v_end_local := p_occurrence_date::timestamp + normalize_hhmm(p_time_end)::time;
  RETURN v_end_local <= v_now_local;
END;
$$;

CREATE OR REPLACE FUNCTION get_conducted_group_lessons_report(
  p_date_from text,
  p_date_to text,
  p_discipline_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_date_from date;
  v_date_to date;
  v_tz text;
  v_disc_count integer;
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'report.error.unauthorized');
  END IF;

  IF NOT can_export_data() THEN
    RETURN jsonb_build_object('success', false, 'error', 'report.error.forbidden');
  END IF;

  IF p_date_from IS NULL OR p_date_from !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'report.error.dateFromInvalid');
  END IF;

  IF p_date_to IS NULL OR p_date_to !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'report.error.dateToInvalid');
  END IF;

  BEGIN
    v_date_from := p_date_from::date;
    v_date_to := p_date_to::date;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'error', 'report.error.dateRangeInvalid');
  END;

  IF v_date_to < v_date_from THEN
    RETURN jsonb_build_object('success', false, 'error', 'report.error.dateRangeInvalid');
  END IF;

  IF p_discipline_ids IS NULL OR array_length(p_discipline_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('success', true, 'rows', '[]'::jsonb);
  END IF;

  SELECT count(*)
  INTO v_disc_count
  FROM unnest(p_discipline_ids) AS did
  JOIN disciplines d
    ON d.id = did
   AND d.organization_id = v_org_id;

  IF v_disc_count <> array_length(p_discipline_ids, 1) THEN
    RETURN jsonb_build_object('success', false, 'error', 'report.error.disciplineInvalid');
  END IF;

  SELECT os.timezone
  INTO v_tz
  FROM organization_settings os
  WHERE os.organization_id = v_org_id;

  WITH expanded AS (
    SELECT
      ss.id AS slot_id,
      ss.class_id AS schedule_group_id,
      ss.group_name,
      ss.discipline_id,
      ss.location_id,
      ss.teacher_member_id,
      ss.time AS time_start,
      ss.time_end,
      occ.occurrence_date
    FROM schedule_slots ss
    CROSS JOIN LATERAL unnest(
      _expand_group_slot_dates_in_range(ss, v_date_from, v_date_to)
    ) AS occ(occurrence_date)
    WHERE ss.organization_id = v_org_id
      AND ss.discipline_id = ANY (p_discipline_ids)
      AND _group_lesson_occurrence_conducted(occ.occurrence_date, ss.time_end, v_tz)
      AND NOT EXISTS (
        SELECT 1
        FROM schedule_occurrence_cancellations soc
        WHERE soc.organization_id = v_org_id
          AND soc.slot_id = ss.id
          AND soc.occurrence_date = occ.occurrence_date
      )
  ),
  attendance_agg AS (
    SELECT
      a.date,
      a.schedule_group_id,
      count(*) FILTER (WHERE a.attendance_status = 'present') AS present_count,
      count(*) FILTER (WHERE a.attendance_status = 'absent') AS absent_count,
      count(*) FILTER (WHERE a.attendance_status = 'freeze') AS freeze_count
    FROM attendance a
    WHERE a.organization_id = v_org_id
      AND a.date >= v_date_from
      AND a.date <= v_date_to
    GROUP BY a.date, a.schedule_group_id
  )
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'occurrence_id', e.slot_id::text || ':' || to_char(e.occurrence_date, 'YYYY-MM-DD'),
        'slot_id', e.slot_id,
        'schedule_group_id', e.schedule_group_id,
        'date', to_char(e.occurrence_date, 'YYYY-MM-DD'),
        'day_of_week', EXTRACT(ISODOW FROM e.occurrence_date)::integer,
        'time_start', normalize_hhmm(e.time_start),
        'time_end', normalize_hhmm(e.time_end),
        'discipline_category', coalesce(d.category, ''),
        'discipline_id', e.discipline_id,
        'discipline_name', coalesce(d.name, ''),
        'group_name', coalesce(e.group_name, ''),
        'teacher_name', coalesce(nullif(trim(om.display_name), ''), ''),
        'location_name', coalesce(l.name, ''),
        'present_count', coalesce(aa.present_count, 0),
        'absent_count', coalesce(aa.absent_count, 0),
        'freeze_count', coalesce(aa.freeze_count, 0)
      )
      ORDER BY e.occurrence_date, normalize_hhmm(e.time_start), coalesce(l.name, ''), coalesce(e.group_name, '')
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM expanded e
  LEFT JOIN disciplines d
    ON d.id = e.discipline_id
   AND d.organization_id = v_org_id
  LEFT JOIN locations l
    ON l.id = e.location_id
   AND l.organization_id = v_org_id
  LEFT JOIN organization_members om
    ON om.id = e.teacher_member_id
   AND om.organization_id = v_org_id
  LEFT JOIN attendance_agg aa
    ON aa.date = e.occurrence_date
   AND aa.schedule_group_id = e.schedule_group_id;

  RETURN jsonb_build_object('success', true, 'rows', coalesce(v_rows, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION get_conducted_group_lessons_report(text, text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_conducted_group_lessons_report(text, text, uuid[]) TO authenticated;

COMMIT;
