-- R6 / 2.9.11: platform_purchase_requests.request_kind, addon purchase gate, staff RPC addon info.

BEGIN;

-- =============================================================================
-- 1. request_kind on platform_purchase_requests
-- =============================================================================

ALTER TABLE platform_purchase_requests
  ADD COLUMN IF NOT EXISTS request_kind text NOT NULL DEFAULT 'crm_license';

ALTER TABLE platform_purchase_requests
  DROP CONSTRAINT IF EXISTS platform_purchase_requests_request_kind_check;

ALTER TABLE platform_purchase_requests
  ADD CONSTRAINT platform_purchase_requests_request_kind_check
  CHECK (request_kind IN ('crm_license', 'renter_miniapp_addon'));

COMMENT ON COLUMN platform_purchase_requests.request_kind IS
  'crm_license (default) | renter_miniapp_addon. Written by Edge service_role only for add-on; not organization_addons.addon_code.';

CREATE OR REPLACE FUNCTION platform_purchase_requests_kind_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_role text;
BEGIN
  v_role := COALESCE(auth.role(), current_setting('role', true));

  IF NEW.request_kind = 'renter_miniapp_addon' AND v_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'purchase_request_kind_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF v_role = 'authenticated' AND NEW.request_kind IS DISTINCT FROM 'crm_license' THEN
    RAISE EXCEPTION 'purchase_request_kind_forbidden'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS platform_purchase_requests_kind_guard ON platform_purchase_requests;

CREATE TRIGGER platform_purchase_requests_kind_guard
  BEFORE INSERT OR UPDATE OF request_kind
  ON platform_purchase_requests
  FOR EACH ROW
  EXECUTE FUNCTION platform_purchase_requests_kind_guard();

-- =============================================================================
-- 2. list_location_rental_hour_rates — addon status for CRM hall-rent UI
-- =============================================================================

CREATE OR REPLACE FUNCTION list_location_rental_hour_rates()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_show_prices boolean;
  v_can_write boolean;
  v_rows jsonb;
  v_addon_status text;
  v_addon_period_start date;
  v_addon_period_end date;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT (member_can_manage_rentals() OR can_read_financial()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
  END IF;

  v_show_prices := member_can_see_rental_tariff_prices();
  v_can_write := can_manage_settings() AND organization_allows_writes(v_org_id);

  SELECT a.status, a.period_start, a.period_end
  INTO v_addon_status, v_addon_period_start, v_addon_period_end
  FROM organization_addons a
  WHERE a.organization_id = v_org_id
    AND a.addon_code = 'renter_miniapp';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'location_id', loc.id,
    'name', loc.name,
    'miniapp_enabled', loc.miniapp_enabled,
    'kinds_complete', _renter_location_has_three_kinds(v_org_id, loc.id, _org_local_date(v_org_id)),
    'rates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', cur.id,
        'kind', cur.kind,
        'price', CASE WHEN v_show_prices THEN cur.price ELSE NULL END,
        'currency', CASE WHEN v_show_prices THEN cur.currency ELSE NULL END,
        'valid_from', cur.valid_from
      ) ORDER BY cur.kind)
      FROM (
        SELECT DISTINCT ON (hr.kind)
          hr.id, hr.kind, hr.price, hr.currency, hr.valid_from
        FROM location_rental_hour_rates hr
        WHERE hr.organization_id = v_org_id
          AND hr.location_id = loc.id
          AND hr.valid_from <= _org_local_date(v_org_id)
        ORDER BY hr.kind, hr.valid_from DESC, hr.created_at DESC, hr.id DESC
      ) cur
    ), '[]'::jsonb)
  ) ORDER BY loc.name), '[]'::jsonb)
  INTO v_rows
  FROM locations loc
  WHERE loc.organization_id = v_org_id;

  RETURN jsonb_build_object(
    'success', true,
    'addon_active', renter_miniapp_addon_is_active(v_org_id),
    'addon_status', v_addon_status,
    'addon_period_start', v_addon_period_start,
    'addon_period_end', v_addon_period_end,
    'can_write', v_can_write,
    'show_prices', v_show_prices,
    'locations', v_rows
  );
END;
$$;

COMMIT;
