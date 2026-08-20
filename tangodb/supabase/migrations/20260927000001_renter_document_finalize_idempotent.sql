-- Idempotent finalize for renter document upload: retry after a committed INSERT
-- (lost RPC response) must return the existing row instead of unique_violation.

BEGIN;

CREATE OR REPLACE FUNCTION finalize_renter_document_upload(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_renter_id uuid := (p_payload ->> 'renter_id')::uuid;
  v_storage_path text := NULLIF(trim(p_payload ->> 'storage_path'), '');
  v_mime text := NULLIF(trim(p_payload ->> 'mime_type'), '');
  v_size bigint := (p_payload ->> 'file_size')::bigint;
  v_display_name text := NULLIF(trim(p_payload ->> 'display_name'), '');
  v_document_id uuid;
  v_contract_id uuid := NULLIF(p_payload ->> 'contract_id', '')::uuid;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;

  IF NOT member_can_read_renter_documents() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  IF v_renter_id IS NULL OR v_storage_path IS NULL OR v_display_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.fieldsInvalid');
  END IF;

  IF v_storage_path !~ ('^' || v_org_id::text || '/' || v_renter_id::text || '/[0-9a-f-]{36}$') THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.documentPathInvalid');
  END IF;

  IF v_mime IS NULL OR NOT (v_mime = ANY (_renter_allowed_document_mimes())) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.documentMimeInvalid');
  END IF;

  IF v_size IS NULL OR v_size <= 0 OR v_size > _renter_document_max_bytes() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.documentSizeInvalid');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects o
    WHERE o.bucket_id = 'renter-documents'
      AND o.name = v_storage_path
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.documentNotUploaded');
  END IF;

  SELECT d.id INTO v_document_id
  FROM renter_documents d
  WHERE d.organization_id = v_org_id
    AND d.renter_id = v_renter_id
    AND d.storage_path = v_storage_path;

  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'document_id', v_document_id);
  END IF;

  INSERT INTO renter_documents (
    organization_id,
    renter_id,
    contract_id,
    category,
    display_name,
    document_date,
    valid_until,
    mime_type,
    file_size,
    storage_path,
    notes,
    uploaded_by
  )
  VALUES (
    v_org_id,
    v_renter_id,
    v_contract_id,
    NULLIF(trim(p_payload ->> 'category'), ''),
    v_display_name,
    NULLIF(p_payload ->> 'document_date', '')::date,
    NULLIF(p_payload ->> 'valid_until', '')::date,
    v_mime,
    v_size,
    v_storage_path,
    NULLIF(trim(p_payload ->> 'notes'), ''),
    v_member_id
  )
  RETURNING id INTO v_document_id;

  RETURN jsonb_build_object('success', true, 'document_id', v_document_id);
EXCEPTION
  WHEN unique_violation THEN
    SELECT d.id INTO v_document_id
    FROM renter_documents d
    WHERE d.organization_id = v_org_id
      AND d.storage_path = v_storage_path;
    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'document_id', v_document_id);
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.documentDuplicate');
END;
$$;

REVOKE ALL ON FUNCTION finalize_renter_document_upload(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finalize_renter_document_upload(jsonb) TO authenticated;

COMMIT;
