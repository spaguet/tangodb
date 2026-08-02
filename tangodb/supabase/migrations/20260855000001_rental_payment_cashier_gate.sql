-- Stage 1 (hall rent audit): cashier can record rental payments without full finance.read.
-- Gate: can_read_financial() OR (member_can_manage_rentals() ∧ admin payment-accept).
-- Does NOT use bare payments.write / member_can_accept_payments() alone
-- (restricted_admin and teachers would incorrectly pass).

BEGIN;

CREATE OR REPLACE FUNCTION member_can_record_rental_payment()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_role text := current_member_role();
  v_admin_can_accept boolean;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN false;
  END IF;

  IF can_read_financial() THEN
    RETURN true;
  END IF;

  -- Full operational admin path: manage rentals already excludes restricted_admin / teacher.
  IF NOT member_can_manage_rentals() THEN
    RETURN false;
  END IF;

  IF v_role = 'admin' THEN
    SELECT os.admin_can_accept_payments
    INTO v_admin_can_accept
    FROM organization_settings os
    WHERE os.organization_id = v_org_id;

    RETURN COALESCE(v_admin_can_accept, true);
  END IF;

  -- Owner/director already covered by can_read_financial(); other roles stay false.
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION member_can_record_rental_payment() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_record_rental_payment() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION record_rental_payment(
  p_rental_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_method_comment text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
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
  v_key text := NULLIF(trim(p_idempotency_key), '');
  v_existing rental_payments%ROWTYPE;
  v_payment_id uuid;
  v_new_paid numeric;
  v_new_status text;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.orgReadOnly');
  END IF;

  IF NOT member_can_record_rental_payment() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.paymentAmountInvalid');
  END IF;

  IF p_method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.paymentMethodInvalid');
  END IF;

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM rental_payments rp
    WHERE rp.organization_id = v_org_id AND rp.idempotency_key = v_key;

    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'payment_id', v_existing.id, 'already_applied', true);
    END IF;
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

  INSERT INTO rental_payments (
    organization_id, rental_id, amount, currency, method, method_comment, idempotency_key, created_by
  )
  VALUES (
    v_org_id,
    p_rental_id,
    p_amount,
    v_rental.currency,
    p_method,
    NULLIF(trim(p_method_comment), ''),
    v_key,
    v_member_id
  )
  RETURNING id INTO v_payment_id;

  v_new_paid := _rental_paid_total(p_rental_id, v_org_id);
  v_new_status := _rental_payment_status(v_rental.fixed_amount, v_new_paid);

  UPDATE rentals SET updated_at = now() WHERE id = p_rental_id;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'paid_amount', v_new_paid,
    'payment_status', v_new_status
  );
EXCEPTION
  WHEN unique_violation THEN
    IF v_key IS NOT NULL THEN
      SELECT id INTO v_payment_id FROM rental_payments WHERE organization_id = v_org_id AND idempotency_key = v_key;
      IF v_payment_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id, 'already_applied', true);
      END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.duplicate');
END;
$$;

CREATE OR REPLACE FUNCTION get_rental_detail(p_rental_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_sensitive boolean;
  v_can_cash boolean;
  v_rental rentals%ROWTYPE;
  v_renter renters%ROWTYPE;
  v_paid numeric;
  v_effective numeric;
  v_payments jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_operational() AND current_member_role() <> 'teacher' THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  SELECT * INTO v_rental FROM rentals r WHERE r.id = p_rental_id AND r.organization_id = v_org_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.notFound');
  END IF;

  SELECT * INTO v_renter FROM renters ren WHERE ren.id = v_rental.renter_id AND ren.organization_id = v_org_id;
  v_sensitive := member_can_see_rental_sensitive();
  v_can_cash := member_can_record_rental_payment();
  v_paid := _rental_paid_total(p_rental_id, v_org_id);
  v_effective := _rental_effective_amount(v_rental.fixed_amount, v_rental.final_amount);

  -- Payment history for finance OR cashier gate (not bare sensitive / manage_rentals).
  IF v_can_cash THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', rp.id,
      'amount', rp.amount,
      'currency', rp.currency,
      'method', rp.method,
      'method_comment', rp.method_comment,
      'created_at', rp.created_at
    ) ORDER BY rp.created_at), '[]'::jsonb)
    INTO v_payments
    FROM rental_payments rp
    WHERE rp.rental_id = p_rental_id AND rp.organization_id = v_org_id;
  ELSE
    v_payments := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'rental', jsonb_build_object(
      'id', v_rental.id,
      'rental_date', v_rental.rental_date,
      'time_start', v_rental.time_start,
      'time_end', v_rental.time_end,
      'location_id', v_rental.location_id,
      'rental_series_id', v_rental.rental_series_id,
      'booking_status', v_rental.booking_status,
      'purpose', CASE WHEN v_sensitive THEN v_rental.purpose ELSE NULL END,
      'internal_comment', CASE WHEN v_sensitive THEN v_rental.internal_comment ELSE NULL END,
      'fixed_amount', CASE WHEN v_sensitive THEN v_effective ELSE NULL END,
      'calculated_amount', CASE WHEN v_sensitive AND can_read_financial() THEN v_rental.calculated_amount ELSE NULL END,
      'currency', CASE WHEN v_sensitive THEN v_rental.currency ELSE NULL END,
      'paid_amount', CASE WHEN v_sensitive THEN v_paid ELSE NULL END,
      'payment_status', CASE WHEN v_sensitive THEN _rental_payment_status(v_effective, v_paid) ELSE NULL END,
      'cancelled_at', v_rental.cancelled_at,
      'cancelled_reason', CASE WHEN v_sensitive THEN v_rental.cancelled_reason ELSE NULL END
    ),
    'renter', jsonb_build_object(
      'id', v_renter.id,
      'display_name', CASE WHEN v_sensitive THEN v_renter.display_name ELSE NULL END,
      'contact_phone', CASE WHEN v_sensitive AND can_read_financial() THEN v_renter.contact_phone ELSE NULL END,
      'contact_email', CASE WHEN v_sensitive AND can_read_financial() THEN v_renter.contact_email ELSE NULL END
    ),
    'payments', v_payments
  );
END;
$$;

COMMIT;
