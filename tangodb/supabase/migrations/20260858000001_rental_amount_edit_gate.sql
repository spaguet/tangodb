-- Stage 6 (hall rent audit): edit rental booking amount with audit + canonical cash gate.
-- Gate: same as member_can_record_rental_payment() (finance OR operational admin cashier).
-- Accountant without manage_rentals uses apply_rental_pricing_adjustment (narrow RPC).
-- Hard block: new_amount < paid (including new_amount = 0) until stage 8 storno.

BEGIN;

CREATE OR REPLACE FUNCTION member_can_adjust_rental_amount()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT member_can_record_rental_payment();
$$;

REVOKE ALL ON FUNCTION member_can_adjust_rental_amount() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_adjust_rental_amount() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION apply_rental_pricing_adjustment(
  p_rental_id uuid,
  p_new_amount numeric,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_rental rentals%ROWTYPE;
  v_old numeric;
  v_paid numeric;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.orgReadOnly');
  END IF;

  IF NOT member_can_adjust_rental_amount() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  IF NULLIF(trim(p_reason), '') IS NULL OR p_new_amount IS NULL OR p_new_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.fieldsInvalid');
  END IF;

  SELECT * INTO v_rental
  FROM rentals r
  WHERE r.id = p_rental_id AND r.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.notFound');
  END IF;

  IF v_rental.booking_status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.alreadyCancelled');
  END IF;

  IF _rental_is_in_active_invoice(p_rental_id, v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.pricing.invoiced');
  END IF;

  v_old := _rental_effective_amount(v_rental.fixed_amount, v_rental.final_amount);
  v_paid := _rental_paid_total(p_rental_id, v_org_id);

  IF p_new_amount < v_paid THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.paidExceedsFixed');
  END IF;

  INSERT INTO rental_pricing_adjustments (
    organization_id, rental_id, old_amount, new_amount, reason, created_by
  )
  VALUES (v_org_id, p_rental_id, v_old, p_new_amount, trim(p_reason), v_member_id);

  UPDATE rentals
  SET
    adjustment_amount = p_new_amount - COALESCE(calculated_amount, v_old),
    final_amount = p_new_amount,
    fixed_amount = p_new_amount,
    updated_at = now()
  WHERE id = p_rental_id;

  RETURN jsonb_build_object(
    'success', true,
    'rental_id', p_rental_id,
    'old_amount', v_old,
    'new_amount', p_new_amount,
    'paid_amount', v_paid,
    'remaining', GREATEST(p_new_amount - v_paid, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION update_rental(p_rental_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_rental rentals%ROWTYPE;
  v_date date;
  v_time_start text;
  v_time_end text;
  v_location_id uuid;
  v_renter_id uuid;
  v_fixed_amount numeric;
  v_paid numeric;
  v_conflicts jsonb;
  v_conflict jsonb;
  v_amount_changed boolean := false;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.orgReadOnly');
  END IF;

  IF NOT member_can_manage_rentals() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
  END IF;

  SELECT * INTO v_rental
  FROM rentals r
  WHERE r.id = p_rental_id AND r.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.notFound');
  END IF;

  IF v_rental.booking_status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.alreadyCancelled');
  END IF;

  v_date := COALESCE((p_payload ->> 'rental_date')::date, v_rental.rental_date);
  v_time_start := COALESCE(normalize_hhmm(p_payload ->> 'time_start'), v_rental.time_start);
  v_time_end := COALESCE(normalize_hhmm(p_payload ->> 'time_end'), v_rental.time_end);
  v_location_id := COALESCE((p_payload ->> 'location_id')::uuid, v_rental.location_id);
  v_renter_id := COALESCE((p_payload ->> 'renter_id')::uuid, v_rental.renter_id);

  IF _hhmm_to_minutes(v_time_end) <= _hhmm_to_minutes(v_time_start) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.timeRangeInvalid');
  END IF;

  IF NOT _renter_is_bookable(v_renter_id, v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.renterInvalid');
  END IF;

  v_fixed_amount := v_rental.fixed_amount;
  IF p_payload ? 'fixed_amount' THEN
    IF NOT member_can_adjust_rental_amount() THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
    END IF;
    v_fixed_amount := COALESCE((p_payload ->> 'fixed_amount')::numeric, 0);
    IF v_fixed_amount < 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.amountInvalid');
    END IF;
    v_paid := _rental_paid_total(p_rental_id, v_org_id);
    IF v_paid > v_fixed_amount THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.paidExceedsFixed');
    END IF;
    v_amount_changed := v_fixed_amount IS DISTINCT FROM v_rental.fixed_amount
      OR v_fixed_amount IS DISTINCT FROM v_rental.final_amount;
  END IF;

  v_conflicts := preview_rental_conflicts(v_date, v_time_start, v_time_end, v_location_id, p_rental_id);
  IF NOT COALESCE((v_conflicts ->> 'success')::boolean, false) THEN
    RETURN v_conflicts;
  END IF;

  IF jsonb_array_length(COALESCE(v_conflicts -> 'conflicts', '[]'::jsonb)) > 0 THEN
    SELECT value INTO v_conflict FROM jsonb_array_elements(v_conflicts -> 'conflicts') LIMIT 1;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.conflict', 'conflict', v_conflict);
  END IF;

  PERFORM pg_advisory_xact_lock(_rental_location_lock_key(v_org_id, v_location_id, v_date));

  IF schedule_location_has_conflict(v_org_id, v_date, v_time_start, v_time_end, v_location_id, NULL, NULL, p_rental_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.conflict');
  END IF;

  UPDATE rentals
  SET
    rental_date = v_date,
    time_start = v_time_start,
    time_end = v_time_end,
    location_id = v_location_id,
    renter_id = v_renter_id,
    purpose = CASE WHEN p_payload ? 'purpose' THEN NULLIF(trim(p_payload ->> 'purpose'), '') ELSE purpose END,
    internal_comment = CASE
      WHEN p_payload ? 'internal_comment' AND member_can_see_rental_sensitive()
        THEN NULLIF(trim(p_payload ->> 'internal_comment'), '')
      ELSE internal_comment
    END,
    fixed_amount = CASE WHEN p_payload ? 'fixed_amount' THEN v_fixed_amount ELSE fixed_amount END,
    final_amount = CASE
      WHEN p_payload ? 'fixed_amount' THEN v_fixed_amount
      ELSE final_amount
    END,
    adjustment_amount = CASE
      WHEN p_payload ? 'fixed_amount' AND v_amount_changed
        THEN v_fixed_amount - COALESCE(calculated_amount, _rental_effective_amount(v_rental.fixed_amount, v_rental.final_amount))
      ELSE adjustment_amount
    END,
    currency = COALESCE(NULLIF(p_payload ->> 'currency', ''), currency),
    updated_at = now()
  WHERE id = p_rental_id;

  RETURN jsonb_build_object('success', true, 'rental_id', p_rental_id);
END;
$$;

DROP POLICY IF EXISTS rental_pricing_adjustments_select ON rental_pricing_adjustments;
CREATE POLICY rental_pricing_adjustments_select ON rental_pricing_adjustments FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND (can_read_financial() OR member_can_adjust_rental_amount())
  );

COMMIT;
