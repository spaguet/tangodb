-- List every miniapp_enabled location in renter cabinet (booking still requires 3 rate kinds).
BEGIN;

CREATE OR REPLACE FUNCTION renter_list_locations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ctx record;
  v_today date;
  v_rows jsonb;
BEGIN
  SELECT * INTO v_ctx FROM _renter_require_renter_ctx();
  v_today := _org_local_date(v_ctx.org_id);

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', l.id,
      'name', l.name,
      'bookable', _renter_location_has_three_kinds(v_ctx.org_id, l.id, v_today)
    )
    ORDER BY l.name
  ), '[]'::jsonb)
  INTO v_rows
  FROM locations l
  WHERE l.organization_id = v_ctx.org_id
    AND l.miniapp_enabled;

  RETURN jsonb_build_object('success', true, 'locations', v_rows);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

COMMIT;
