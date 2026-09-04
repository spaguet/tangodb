-- Allow deleting QR assets referenced only by resolved top-up inbox rows.
-- Pending QR top-ups still block delete (renter.qr.pendingRefs).

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'renter_topup_requests'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%qr_asset_id%'
      AND pg_get_constraintdef(oid) LIKE '%method%'
  LOOP
    EXECUTE format('ALTER TABLE renter_topup_requests DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE renter_topup_requests
  ADD CONSTRAINT renter_topup_requests_qr_asset_required_chk
  CHECK (
    method <> 'qr'
    OR qr_asset_id IS NOT NULL
    OR status IN ('confirmed', 'rejected')
  );

CREATE OR REPLACE FUNCTION delete_organization_rental_qr_asset(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid := auth_organization_id();
  v_path text;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;
  IF NOT can_manage_settings() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  IF EXISTS (
    SELECT 1 FROM renter_topup_requests t
    WHERE t.qr_asset_id = p_id AND t.organization_id = v_org AND t.status = 'pending'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.qr.pendingRefs');
  END IF;

  SELECT storage_path INTO v_path
  FROM organization_rental_qr_assets
  WHERE id = p_id AND organization_id = v_org;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.qr.notFound');
  END IF;

  UPDATE renter_topup_requests
  SET qr_asset_id = NULL
  WHERE qr_asset_id = p_id
    AND organization_id = v_org
    AND status IN ('confirmed', 'rejected');

  DELETE FROM organization_rental_qr_assets
  WHERE id = p_id AND organization_id = v_org;

  RETURN jsonb_build_object('success', true, 'storage_path', v_path);
END;
$$;
