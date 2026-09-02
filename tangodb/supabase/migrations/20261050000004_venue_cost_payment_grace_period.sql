-- Restore lesson-date gate with grace period after valid_to.
-- Migration 20261050000003 dropped grace and used raw acknowledgement_required.

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
DECLARE
  v_status jsonb;
  v_eval_date date;
  v_valid_to date;
  v_coverage_end date;
BEGIN
  IF p_lesson_date IS NOT NULL
    AND venue_rule_covers_lesson_date(p_org_id, p_lesson_date)
  THEN
    RETURN false;
  END IF;

  v_eval_date := COALESCE(p_lesson_date, current_date);
  v_status := venue_cost_status_for_org(p_org_id, v_eval_date);
  IF NOT COALESCE((v_status ->> 'acknowledgement_required')::boolean, false) THEN
    RETURN false;
  END IF;

  IF p_lesson_date IS NULL THEN
    RETURN true;
  END IF;

  v_valid_to := (v_status ->> 'latest_valid_to')::date;
  IF v_valid_to IS NULL THEN
    RETURN true;
  END IF;

  v_coverage_end := ((date_trunc('month', v_valid_to::timestamp) + interval '2 months')::date - 1);
  RETURN p_lesson_date > v_coverage_end;
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
    AND NOT venue_cost_payment_ack_required(v_org_id, p_lesson_date)
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

CREATE OR REPLACE FUNCTION record_personal_lesson_payment(
  p_lesson_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_idempotency_key uuid DEFAULT NULL,
  p_venue_rule_acknowledged boolean DEFAULT false,
  p_price_id uuid DEFAULT NULL,
  p_tariff_units numeric DEFAULT NULL,
  p_tariff_duration_minutes integer DEFAULT NULL,
  p_tariff_price numeric DEFAULT NULL,
  p_tariff_label text DEFAULT NULL,
  p_lesson_duration_minutes integer DEFAULT NULL,
  p_client_id uuid DEFAULT NULL,
  p_charge_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_status jsonb;
  v_result jsonb;
  v_cached jsonb;
  v_existing_payment_id uuid;
  v_lesson_date date;
  v_fingerprint text := md5(concat_ws(
    '|',
    p_lesson_id,
    p_amount,
    p_method,
    p_venue_rule_acknowledged,
    p_price_id,
    p_tariff_units,
    p_client_id,
    p_charge_id
  ));
  v_legacy_fingerprint text := md5(
    coalesce(p_lesson_id::text, '') || '|' ||
    coalesce(p_amount::text, '') || '|' ||
    coalesce(p_method, '')
  );
BEGIN
  v_cached := check_operation_idempotency(
    v_org_id, 'record_personal_lesson_payment', p_idempotency_key, v_fingerprint
  );
  IF v_cached IS NOT NULL THEN
    IF v_cached ->> 'error_code' = 'idempotency_conflict'
      AND NOT COALESCE(p_venue_rule_acknowledged, false)
    THEN
      v_cached := check_operation_idempotency(
        v_org_id,
        'record_personal_lesson_payment',
        p_idempotency_key,
        v_legacy_fingerprint
      );
    END IF;
    IF v_cached ->> 'error_code' = 'idempotency_conflict' THEN
      RETURN v_cached;
    END IF;
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  SELECT pl.date INTO v_lesson_date
  FROM personal_lessons pl
  WHERE pl.id = p_lesson_id
    AND (v_org_id IS NULL OR pl.organization_id = v_org_id);

  IF FOUND AND _is_finance_period_closed(v_org_id, v_lesson_date) THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.periodClosed');
  END IF;

  IF venue_cost_payment_ack_required(v_org_id, v_lesson_date)
    AND NOT COALESCE(p_venue_rule_acknowledged, false)
  THEN
    v_status := venue_cost_status_for_org(v_org_id, current_date);
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'venue_rule_ack_required',
      'error', 'venue_rule_ack_required',
      'venue_rule_status', v_status
    );
  END IF;

  v_status := venue_cost_status_for_org(
    v_org_id,
    COALESCE(v_lesson_date, current_date)
  );

  SELECT p.id INTO v_existing_payment_id
  FROM payments p
  WHERE p.organization_id = v_org_id
    AND p.personal_lesson_id = p_lesson_id
    AND p.operation_kind = 'payment'
    AND p.replaces_payment_id IS NULL
    AND payment_remaining_amount(v_org_id, p.id) > 0
  ORDER BY p.created_at
  LIMIT 1;

  v_result := _record_personal_lesson_payment_impl(
    p_lesson_id,
    p_amount,
    p_method,
    p_idempotency_key,
    p_price_id,
    p_tariff_units,
    p_tariff_duration_minutes,
    p_tariff_price,
    p_tariff_label,
    p_lesson_duration_minutes,
    p_client_id,
    p_charge_id
  );

  IF COALESCE((v_result ->> 'success')::boolean, false) THEN
    IF v_existing_payment_id IS NULL
      AND NOT COALESCE((v_result ->> 'already_applied')::boolean, false)
    THEN
      PERFORM store_venue_payment_ack_if_required(
        v_status,
        (v_result ->> 'payment_id')::uuid,
        'record_personal_lesson_payment',
        p_idempotency_key
      );
    END IF;
    PERFORM store_operation_idempotency(
      v_org_id,
      'record_personal_lesson_payment',
      p_idempotency_key,
      v_fingerprint,
      v_result
    );
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION record_personal_lesson_payment(
  uuid, numeric, text, uuid, boolean, uuid, numeric, integer, numeric, text, integer, uuid, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_personal_lesson_payment(
  uuid, numeric, text, uuid, boolean, uuid, numeric, integer, numeric, text, integer, uuid, uuid
) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
