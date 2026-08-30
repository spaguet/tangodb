-- Hosted Storage forbids DELETE FROM storage.objects (storage.protect_delete).
-- Metadata-only; Edge renter-qr-upload action=delete removes the object via Storage API.

CREATE OR REPLACE FUNCTION update_organization_rental_qr_asset(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid := auth_organization_id();
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;
  IF NOT can_manage_settings() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  v_id := NULLIF(p_payload ->> 'id', '')::uuid;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.qr.payloadInvalid');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organization_rental_qr_assets
    WHERE id = v_id AND organization_id = v_org
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.qr.notFound');
  END IF;

  UPDATE organization_rental_qr_assets
  SET
    label = COALESCE(NULLIF(trim(COALESCE(p_payload ->> 'label', '')), ''), label),
    is_active = COALESCE((p_payload ->> 'is_active')::boolean, is_active)
  WHERE id = v_id AND organization_id = v_org;

  RETURN jsonb_build_object('success', true);
END;
$$;

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

  DELETE FROM organization_rental_qr_assets
  WHERE id = p_id AND organization_id = v_org;

  RETURN jsonb_build_object('success', true, 'storage_path', v_path);
END;
$$;
