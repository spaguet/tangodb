-- Hall-rent stage 12: read-only tariff price lookup for operational admin (cashier gate).
-- Reuses member_can_record_rental_payment() — same canonical gate as stage 1 / stage 13 create.

BEGIN;

CREATE OR REPLACE FUNCTION member_can_see_rental_tariff_prices()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT can_read_financial() OR member_can_record_rental_payment();
$$;

REVOKE ALL ON FUNCTION member_can_see_rental_tariff_prices() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_see_rental_tariff_prices() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION list_rental_tariffs(p_status text DEFAULT NULL, p_location_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_rows jsonb;
  v_show_prices boolean;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT (member_can_manage_rentals() OR can_read_financial()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
  END IF;

  v_show_prices := member_can_see_rental_tariff_prices();

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'tariff_type', t.tariff_type,
    'location_id', t.location_id,
    'price', CASE WHEN v_show_prices THEN t.price ELSE NULL END,
    'currency', CASE WHEN v_show_prices THEN t.currency ELSE NULL END,
    'min_duration_minutes', t.min_duration_minutes,
    'rounding_step_minutes', t.rounding_step_minutes,
    'valid_from', t.valid_from,
    'valid_to', t.valid_to,
    'status', t.status,
    'rules_count', (
      SELECT count(*) FROM rental_tariff_rules r
      WHERE r.tariff_id = t.id AND r.organization_id = v_org_id
    )
  ) ORDER BY t.name), '[]'::jsonb)
  INTO v_rows
  FROM rental_tariffs t
  WHERE t.organization_id = v_org_id
    AND (p_status IS NULL OR t.status = p_status)
    AND (p_location_id IS NULL OR t.location_id IS NULL OR t.location_id = p_location_id);

  RETURN jsonb_build_object('success', true, 'tariffs', v_rows);
END;
$$;

COMMIT;
