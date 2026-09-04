-- Filter cancelled rentals from schedule; refund prepay from ledger on cancel.

BEGIN;

CREATE OR REPLACE FUNCTION _renter_refund_prepay(p_rental_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r rentals%ROWTYPE;
  v_charged numeric;
  v_refunded numeric;
  v_delta numeric;
BEGIN
  SELECT * INTO v_r FROM rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT COALESCE(SUM(l.amount), 0)
  INTO v_charged
  FROM renter_wallet_ledger l
  WHERE l.rental_id = p_rental_id
    AND l.entry_type = 'prepay_charge';

  IF v_charged <= 0 THEN
    IF v_r.prepay_charged_at IS NOT NULL AND COALESCE(v_r.prepay_amount, 0) > 0 THEN
      v_charged := v_r.prepay_amount;
    ELSE
      RETURN true;
    END IF;
  END IF;

  SELECT COALESCE(SUM(l.amount), 0)
  INTO v_refunded
  FROM renter_wallet_ledger l
  WHERE l.rental_id = p_rental_id
    AND l.entry_type = 'refund';

  v_delta := v_charged - v_refunded;
  IF v_delta <= 0 THEN
    RETURN true;
  END IF;

  PERFORM _renter_wallet_insert_entry(
    v_r.organization_id,
    v_r.renter_id,
    'refund',
    v_delta,
    v_r.id,
    'refund'
  );

  PERFORM _renter_assert_wallet_invariant(v_r.organization_id, v_r.renter_id);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION get_rentals_for_schedule_week(
  p_week_start date,
  p_week_end date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_sensitive boolean;
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF NOT can_read_operational() AND current_member_role() <> 'teacher' THEN
    RETURN '[]'::jsonb;
  END IF;

  v_sensitive := member_can_see_rental_sensitive();

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.rental_date, x.time_start), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      r.id AS rental_id,
      r.rental_date,
      r.time_start,
      r.time_end,
      r.location_id,
      r.rental_series_id,
      r.booking_status,
      r.channel,
      r.lifecycle,
      CASE WHEN v_sensitive THEN r.purpose ELSE NULL END AS purpose,
      CASE WHEN v_sensitive THEN ren.display_name ELSE NULL END AS renter_name,
      CASE WHEN v_sensitive THEN _rental_effective_amount(r.fixed_amount, r.final_amount) ELSE NULL END AS fixed_amount,
      CASE WHEN v_sensitive THEN r.currency ELSE NULL END AS currency,
      CASE
        WHEN NOT v_sensitive THEN NULL
        WHEN r.channel = 'miniapp' THEN NULL
        ELSE _rental_paid_total(r.id, r.organization_id)
      END AS paid_amount,
      CASE
        WHEN NOT v_sensitive THEN NULL
        WHEN r.channel = 'miniapp' THEN NULL
        ELSE _rental_payment_status(
          _rental_effective_amount(r.fixed_amount, r.final_amount),
          _rental_paid_total(r.id, r.organization_id)
        )
      END AS payment_status,
      CASE
        WHEN r.channel = 'miniapp' THEN _renter_can_delete_hold_row(r, false)
        ELSE false
      END AS can_delete_hold,
      CASE
        WHEN r.channel = 'miniapp' THEN _renter_can_cancel_occurrence_row(r, false)
        ELSE false
      END AS can_cancel_occurrence,
      CASE
        WHEN r.channel = 'miniapp' THEN _renter_can_cancel_pack_row(r, false)
        ELSE false
      END AS can_cancel_pack
    FROM rentals r
    JOIN renters ren ON ren.id = r.renter_id AND ren.organization_id = r.organization_id
    WHERE r.organization_id = v_org_id
      AND r.rental_date >= p_week_start
      AND r.rental_date <= p_week_end
      AND r.booking_status = 'confirmed'
      AND teacher_can_view_schedule_location(r.location_id)
  ) x;

  RETURN v_rows;
END;
$$;

COMMIT;
