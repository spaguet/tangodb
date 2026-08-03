-- Hall-rent stage 13: create_rental cash gate + preview pricing + manual override with reason.
-- Gates: member_can_record_rental_payment() (= finance OR operational admin cashier), not bare can_read_financial only.

BEGIN;

CREATE OR REPLACE FUNCTION preview_rental_pricing(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_tariff_id uuid;
  v_date date;
  v_time_start text;
  v_time_end text;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT member_can_see_rental_tariff_prices() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  v_tariff_id := NULLIF(p_payload ->> 'tariff_id', '')::uuid;
  v_date := (p_payload ->> 'rental_date')::date;
  v_time_start := normalize_hhmm(p_payload ->> 'time_start');
  v_time_end := normalize_hhmm(p_payload ->> 'time_end');

  IF v_tariff_id IS NULL OR v_date IS NULL OR v_time_start IS NULL OR v_time_end IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.fieldsInvalid');
  END IF;

  RETURN _calculate_rental_pricing(v_tariff_id, v_org_id, v_date, v_time_start, v_time_end);
END;
$$;

REVOKE ALL ON FUNCTION preview_rental_pricing(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION preview_rental_pricing(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION create_rental(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_idempotency_key text := NULLIF(trim(p_payload ->> 'idempotency_key'), '');
  v_existing rentals%ROWTYPE;
  v_rental_id uuid;
  v_date date;
  v_time_start text;
  v_time_end text;
  v_location_id uuid;
  v_renter_id uuid;
  v_tariff_id uuid := NULLIF(p_payload ->> 'tariff_id', '')::uuid;
  v_fixed_amount numeric;
  v_calculated_amount numeric;
  v_override_amount numeric;
  v_override_reason text;
  v_adjustment numeric := 0;
  v_final_amount numeric;
  v_currency text;
  v_conflicts jsonb;
  v_conflict jsonb;
  v_pricing jsonb;
  v_tariff_type text;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT member_can_manage_rentals() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
  END IF;

  IF v_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM rentals r
    WHERE r.organization_id = v_org_id AND r.idempotency_key = v_idempotency_key;

    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'rental_id', v_existing.id, 'already_applied', true);
    END IF;
  END IF;

  v_date := (p_payload ->> 'rental_date')::date;
  v_time_start := normalize_hhmm(p_payload ->> 'time_start');
  v_time_end := normalize_hhmm(p_payload ->> 'time_end');
  v_location_id := (p_payload ->> 'location_id')::uuid;
  v_renter_id := (p_payload ->> 'renter_id')::uuid;
  v_fixed_amount := COALESCE((p_payload ->> 'fixed_amount')::numeric, 0);
  v_currency := COALESCE(NULLIF(p_payload ->> 'currency', ''), 'RUB');

  IF v_date IS NULL OR v_location_id IS NULL OR v_renter_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.fieldsInvalid');
  END IF;

  IF _hhmm_to_minutes(v_time_end) <= _hhmm_to_minutes(v_time_start) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.timeRangeInvalid');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM locations l WHERE l.id = v_location_id AND l.organization_id = v_org_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.locationInvalid');
  END IF;

  IF NOT _renter_is_bookable(v_renter_id, v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.renterInvalid');
  END IF;

  IF v_tariff_id IS NOT NULL THEN
    v_pricing := _calculate_rental_pricing(v_tariff_id, v_org_id, v_date, v_time_start, v_time_end);
    IF NOT COALESCE((v_pricing ->> 'success')::boolean, false) THEN
      RETURN v_pricing;
    END IF;
    v_calculated_amount := (v_pricing ->> 'calculated_amount')::numeric;
    v_fixed_amount := v_calculated_amount;
    v_currency := v_pricing ->> 'currency';
    v_tariff_type := v_pricing ->> 'tariff_type';

    IF (p_payload ? 'fixed_amount') THEN
      v_override_amount := (p_payload ->> 'fixed_amount')::numeric;
      IF v_override_amount IS NOT NULL AND v_override_amount <> v_calculated_amount THEN
        IF NOT member_can_record_rental_payment() THEN
          RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
        END IF;
        v_override_reason := NULLIF(trim(p_payload ->> 'amount_override_reason'), '');
        IF v_override_reason IS NULL THEN
          RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.amountOverrideReasonRequired');
        END IF;
        v_adjustment := v_override_amount - v_calculated_amount;
        v_fixed_amount := v_override_amount;
      END IF;
    END IF;
  END IF;

  IF v_fixed_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.amountInvalid');
  END IF;

  IF v_fixed_amount > 0 AND NOT member_can_record_rental_payment() AND v_tariff_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  v_final_amount := CASE WHEN v_tariff_id IS NOT NULL THEN v_fixed_amount ELSE NULL END;

  v_conflicts := preview_rental_conflicts(v_date, v_time_start, v_time_end, v_location_id, NULL);
  IF NOT COALESCE((v_conflicts ->> 'success')::boolean, false) THEN
    RETURN v_conflicts;
  END IF;

  IF jsonb_array_length(COALESCE(v_conflicts -> 'conflicts', '[]'::jsonb)) > 0 THEN
    SELECT value INTO v_conflict FROM jsonb_array_elements(v_conflicts -> 'conflicts') LIMIT 1;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.conflict', 'conflict', v_conflict);
  END IF;

  PERFORM pg_advisory_xact_lock(_rental_location_lock_key(v_org_id, v_location_id, v_date));

  IF schedule_location_has_conflict(v_org_id, v_date, v_time_start, v_time_end, v_location_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.conflict');
  END IF;

  INSERT INTO rentals (
    organization_id, location_id, rental_date, time_start, time_end,
    renter_id, purpose, internal_comment, fixed_amount, currency,
    tariff_id, tariff_type, tariff_snapshot, pricing_breakdown,
    calculated_amount, adjustment_amount, final_amount,
    idempotency_key, created_by
  )
  VALUES (
    v_org_id, v_location_id, v_date, v_time_start, v_time_end,
    v_renter_id,
    NULLIF(trim(p_payload ->> 'purpose'), ''),
    NULLIF(trim(p_payload ->> 'internal_comment'), ''),
    v_fixed_amount, v_currency,
    v_tariff_id,
    v_tariff_type,
    CASE WHEN v_tariff_id IS NOT NULL THEN v_pricing -> 'tariff_snapshot' ELSE NULL END,
    CASE WHEN v_tariff_id IS NOT NULL THEN v_pricing -> 'breakdown' ELSE NULL END,
    CASE WHEN v_tariff_id IS NOT NULL THEN v_calculated_amount ELSE NULL END,
    CASE WHEN v_tariff_id IS NOT NULL THEN v_adjustment ELSE 0 END,
    v_final_amount,
    v_idempotency_key, v_member_id
  )
  RETURNING id INTO v_rental_id;

  IF COALESCE((p_payload ->> 'initial_payment')::numeric, 0) > 0 THEN
    IF NOT member_can_record_rental_payment() THEN
      RAISE EXCEPTION 'schedule.rental.financeForbidden' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO rental_payments (
      organization_id, rental_id, amount, currency, method, method_comment, idempotency_key, created_by
    )
    VALUES (
      v_org_id, v_rental_id, (p_payload ->> 'initial_payment')::numeric, v_currency,
      COALESCE(NULLIF(p_payload ->> 'payment_method', ''), 'cash'),
      NULLIF(trim(p_payload ->> 'payment_comment'), ''),
      CASE WHEN v_idempotency_key IS NOT NULL THEN v_idempotency_key || ':payment' END,
      v_member_id
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'rental_id', v_rental_id);
EXCEPTION
  WHEN unique_violation THEN
    IF v_idempotency_key IS NOT NULL THEN
      SELECT id INTO v_rental_id FROM rentals WHERE organization_id = v_org_id AND idempotency_key = v_idempotency_key;
      IF v_rental_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'rental_id', v_rental_id, 'already_applied', true);
      END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.duplicate');
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

COMMIT;
