-- Hall-rent stage 22: operational rental payment inbox for cashiers.
-- Gate: member_can_record_rental_payment() (same as stage 1; reception excluded).

BEGIN;

CREATE OR REPLACE FUNCTION list_rental_payment_inbox(
  p_bucket text DEFAULT 'queue',
  p_as_of_date date DEFAULT NULL,
  p_location_id uuid DEFAULT NULL,
  p_renter_id uuid DEFAULT NULL,
  p_payment_status text DEFAULT NULL,
  p_cashier_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_today date;
  v_bucket text := lower(COALESCE(NULLIF(trim(p_bucket), ''), 'queue'));
  v_limit integer := GREATEST(LEAST(COALESCE(p_limit, 50), 200), 1);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_rows jsonb;
  v_total integer;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'unauthorized');
  END IF;

  IF NOT member_can_record_rental_payment() THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  v_today := COALESCE(p_as_of_date, _org_local_date(v_org_id));

  IF v_bucket NOT IN ('queue', 'today', 'overdue', 'partial', 'overpaid', 'unpaid') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_bucket');
  END IF;

  IF p_payment_status IS NOT NULL
     AND p_payment_status NOT IN ('unpaid', 'partial', 'paid', 'overpaid') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_status');
  END IF;

  WITH base AS (
    SELECT
      r.id AS rental_id,
      r.rental_date,
      r.time_start,
      r.time_end,
      r.location_id,
      r.rental_series_id,
      r.purpose,
      r.renter_id,
      ren.display_name AS renter_name,
      loc.name AS location_name,
      COALESCE(r.currency, 'RUB') AS currency,
      _rental_effective_amount(r.fixed_amount, r.final_amount) AS effective_amount,
      _rental_paid_total(r.id, r.organization_id) AS paid_amount,
      _rental_payment_status(
        _rental_effective_amount(r.fixed_amount, r.final_amount),
        _rental_paid_total(r.id, r.organization_id)
      ) AS payment_status,
      GREATEST(
        _rental_effective_amount(r.fixed_amount, r.final_amount)
          - _rental_paid_total(r.id, r.organization_id),
        0
      ) AS remaining_amount,
      (
        SELECT rp.created_by
        FROM rental_payments rp
        WHERE rp.organization_id = r.organization_id
          AND rp.rental_id = r.id
          AND COALESCE(rp.operation_kind, 'payment') = 'payment'
        ORDER BY rp.created_at DESC
        LIMIT 1
      ) AS last_payment_by
    FROM rentals r
    INNER JOIN renters ren
      ON ren.id = r.renter_id
     AND ren.organization_id = r.organization_id
    LEFT JOIN locations loc
      ON loc.id = r.location_id
     AND loc.organization_id = r.organization_id
    WHERE r.organization_id = v_org_id
      AND business_row_readable()
      AND r.booking_status = 'confirmed'
      AND _rental_effective_amount(r.fixed_amount, r.final_amount) > 0
  ),
  filtered AS (
    SELECT *
    FROM base b
    WHERE
      (p_location_id IS NULL OR b.location_id = p_location_id)
      AND (p_renter_id IS NULL OR b.renter_id = p_renter_id)
      AND (p_payment_status IS NULL OR b.payment_status = p_payment_status)
      AND (
        p_cashier_id IS NULL
        OR b.last_payment_by = p_cashier_id
        OR (b.last_payment_by IS NULL AND b.payment_status = 'unpaid')
      )
      AND (
        CASE v_bucket
          WHEN 'today' THEN
            b.rental_date = v_today
            AND b.payment_status IN ('unpaid', 'partial')
          WHEN 'overdue' THEN
            b.rental_date < v_today
            AND b.payment_status IN ('unpaid', 'partial')
          WHEN 'partial' THEN
            b.payment_status = 'partial'
          WHEN 'overpaid' THEN
            b.payment_status = 'overpaid'
          WHEN 'unpaid' THEN
            b.payment_status = 'unpaid'
          ELSE
            b.payment_status IN ('unpaid', 'partial', 'overpaid')
        END
      )
  ),
  counted AS (
    SELECT count(*)::integer AS total FROM filtered
  ),
  page AS (
    SELECT *
    FROM filtered
    ORDER BY
      CASE WHEN rental_date < v_today AND payment_status IN ('unpaid', 'partial') THEN 0 ELSE 1 END,
      rental_date ASC,
      time_start ASC,
      renter_name ASC
    LIMIT v_limit
    OFFSET v_offset
  )
  SELECT
    (SELECT total FROM counted),
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'rental_id', p.rental_id,
            'rental_date', p.rental_date,
            'time_start', p.time_start,
            'time_end', p.time_end,
            'location_id', p.location_id,
            'location_name', p.location_name,
            'rental_series_id', p.rental_series_id,
            'purpose', p.purpose,
            'renter_id', p.renter_id,
            'renter_name', p.renter_name,
            'currency', p.currency,
            'effective_amount', p.effective_amount,
            'paid_amount', p.paid_amount,
            'remaining_amount', p.remaining_amount,
            'payment_status', p.payment_status,
            'last_payment_by', p.last_payment_by,
            'is_overdue', p.rental_date < v_today AND p.payment_status IN ('unpaid', 'partial')
          )
          ORDER BY
            CASE WHEN p.rental_date < v_today AND p.payment_status IN ('unpaid', 'partial') THEN 0 ELSE 1 END,
            p.rental_date ASC,
            p.time_start ASC,
            p.renter_name ASC
        )
        FROM page p
      ),
      '[]'::jsonb
    )
  INTO v_total, v_rows;

  RETURN jsonb_build_object(
    'success', true,
    'as_of_date', v_today,
    'bucket', v_bucket,
    'total', COALESCE(v_total, 0),
    'limit', v_limit,
    'offset', v_offset,
    'items', COALESCE(v_rows, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION list_rental_payment_inbox(text, date, uuid, uuid, text, uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_rental_payment_inbox(text, date, uuid, uuid, text, uuid, integer, integer) TO authenticated;

COMMIT;
