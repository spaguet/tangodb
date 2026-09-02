-- Mini App top-up: renters/staff can create Storage signed URLs for studio QR
-- (SQL jwt_secret GUC is often unset on hosted Supabase, so RPC signed_url was null).
-- Inbox also returns qr_storage_path for the CRM fallback.

CREATE OR REPLACE FUNCTION _org_rental_qr_storage_readable(p_object_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_prefix text;
  v_org uuid;
  v_actor text;
  v_renter_org text;
BEGIN
  v_prefix := split_part(COALESCE(p_object_name, ''), '/', 1);
  IF v_prefix !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;

  v_actor := COALESCE(auth.jwt() -> 'app_metadata' ->> 'actor', '');
  IF v_actor = 'renter' THEN
    v_renter_org := COALESCE(auth.jwt() -> 'app_metadata' ->> 'organization_id', '');
    RETURN v_renter_org = v_prefix;
  END IF;

  v_org := auth_organization_id();
  IF v_org IS NULL OR v_org::text <> v_prefix THEN
    RETURN false;
  END IF;
  RETURN can_manage_settings() OR member_can_record_rental_payment();
END;
$$;

REVOKE ALL ON FUNCTION _org_rental_qr_storage_readable(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _org_rental_qr_storage_readable(text) TO authenticated, service_role;

DROP POLICY IF EXISTS org_rental_qr_storage_select ON storage.objects;
CREATE POLICY org_rental_qr_storage_select
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'org-rental-qr'
    AND _org_rental_qr_storage_readable(name)
  );

CREATE OR REPLACE FUNCTION list_renter_topup_inbox(
  p_status text DEFAULT 'pending',
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid := auth_organization_id();
  v_limit integer;
  v_offset integer;
  v_status text;
  v_total integer;
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;
  IF NOT member_can_record_rental_payment() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);
  v_status := COALESCE(NULLIF(trim(p_status), ''), 'pending');
  IF v_status NOT IN ('pending', 'confirmed', 'rejected', 'all') THEN
    v_status := 'pending';
  END IF;

  SELECT count(*)
  INTO v_total
  FROM renter_topup_requests t
  WHERE t.organization_id = v_org
    AND (v_status = 'all' OR t.status = v_status);

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', x.id,
      'renter_id', x.renter_id,
      'renter_name', x.display_name,
      'amount', x.amount,
      'method', x.method,
      'status', x.status,
      'amount_fact', x.amount_fact,
      'qr_asset_id', x.qr_asset_id,
      'qr_storage_path', x.qr_storage_path,
      'qr_signed_url', x.qr_signed_url,
      'created_at', x.created_at,
      'resolved_at', x.resolved_at
    ) ORDER BY x.created_at DESC
  ), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      t.id,
      t.renter_id,
      r.display_name,
      t.amount,
      t.method,
      t.status,
      t.amount_fact,
      t.qr_asset_id,
      a.storage_path AS qr_storage_path,
      CASE
        WHEN t.qr_asset_id IS NOT NULL THEN _renter_qr_signed_url(a.storage_path, 3600)
        ELSE NULL
      END AS qr_signed_url,
      t.created_at,
      t.resolved_at
    FROM renter_topup_requests t
    JOIN renters r ON r.id = t.renter_id AND r.organization_id = t.organization_id
    LEFT JOIN organization_rental_qr_assets a
      ON a.id = t.qr_asset_id AND a.organization_id = t.organization_id
    WHERE t.organization_id = v_org
      AND (v_status = 'all' OR t.status = v_status)
    ORDER BY t.created_at DESC
    LIMIT v_limit OFFSET v_offset
  ) x;

  RETURN jsonb_build_object(
    'success', true,
    'items', v_rows,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
END;
$$;
