-- Personal lesson payments: skip venue-rule acknowledgement when lesson date
-- falls inside an accepted non-disabled rule's [valid_from, valid_to].

BEGIN;

CREATE OR REPLACE FUNCTION venue_rule_covers_lesson_date(
  p_org_id uuid,
  p_lesson_date date
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM venue_cost_rule_versions r
    WHERE r.organization_id = p_org_id
      AND r.status = 'accepted'
      AND r.mode <> 'disabled'
      AND r.valid_from <= p_lesson_date
      AND (r.valid_to IS NULL OR r.valid_to >= p_lesson_date)
  );
$$;

REVOKE ALL ON FUNCTION venue_rule_covers_lesson_date(uuid, date) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION venue_cost_payment_ack_required(
  p_org_id uuid,
  p_lesson_date date DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_lesson_date IS NOT NULL
    AND venue_rule_covers_lesson_date(p_org_id, p_lesson_date)
  THEN
    RETURN false;
  END IF;

  RETURN COALESCE(
    (venue_cost_status_for_org(p_org_id, current_date) ->> 'acknowledgement_required')::boolean,
    false
  );
END;
$$;

REVOKE ALL ON FUNCTION venue_cost_payment_ack_required(uuid, date) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION get_venue_cost_rule_status(
  p_at date DEFAULT current_date,
  p_lesson_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_status jsonb;
  v_eval_date date;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'unauthorized');
  END IF;

  IF NOT (
    can_read_financial()
    OR current_member_role() = 'admin'
    OR (
      current_member_role() = 'teacher'
      AND (
        teacher_can_write_subscriptions()
        OR teacher_can_write_personal_lessons()
        OR EXISTS (
          SELECT 1
          FROM organization_settings os
          WHERE os.organization_id = v_org_id
            AND os.teachers_can_record_single_visits = true
        )
      )
    )
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  v_eval_date := COALESCE(p_lesson_date, COALESCE(p_at, current_date));

  IF p_lesson_date IS NOT NULL
    AND venue_rule_covers_lesson_date(v_org_id, p_lesson_date)
  THEN
    v_status := venue_cost_status_for_org(v_org_id, p_lesson_date);
    RETURN v_status
      || jsonb_build_object('acknowledgement_required', false, 'success', true);
  END IF;

  IF venue_cost_payment_ack_required(v_org_id, p_lesson_date) THEN
    v_status := venue_cost_status_for_org(v_org_id, current_date);
    RETURN v_status
      || jsonb_build_object(
        'acknowledgement_required', true,
        'status', 'expired_ack_required',
        'success', true
      );
  END IF;

  v_status := venue_cost_status_for_org(v_org_id, v_eval_date);
  RETURN v_status
    || jsonb_build_object('acknowledgement_required', false, 'success', true);
END;
$$;

REVOKE ALL ON FUNCTION get_venue_cost_rule_status(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_venue_cost_rule_status(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
