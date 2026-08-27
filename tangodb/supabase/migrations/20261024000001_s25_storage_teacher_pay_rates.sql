-- S25 / M48+M51+M52: renter-documents Storage only via prepare intent paths; exports bucket
-- requires can_export_data(); teacher_pay_rates write only via save_teacher_pay_rate RPC.

BEGIN;

-- =============================================================================
-- 1. Renter document upload intents (Storage INSERT/DELETE gated on prepare RPC)
-- =============================================================================

CREATE TABLE IF NOT EXISTS renter_document_upload_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  renter_id uuid NOT NULL REFERENCES renters(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  created_by uuid REFERENCES organization_members(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '2 hours'),
  UNIQUE (organization_id, storage_path)
);

CREATE INDEX IF NOT EXISTS idx_renter_doc_upload_intents_path
  ON renter_document_upload_intents (storage_path);

ALTER TABLE renter_document_upload_intents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS renter_document_upload_intents_select ON renter_document_upload_intents;
CREATE POLICY renter_document_upload_intents_select
  ON renter_document_upload_intents FOR SELECT TO authenticated
  USING (organization_id = auth_organization_id());

REVOKE ALL ON renter_document_upload_intents FROM anon, authenticated;
GRANT SELECT ON renter_document_upload_intents TO authenticated;

CREATE OR REPLACE FUNCTION prepare_renter_document_upload(
  p_renter_id uuid,
  p_filename text,
  p_mime text,
  p_size bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_object_id uuid := gen_random_uuid();
  v_safe_name text;
  v_path text;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;

  IF NOT member_can_read_renter_documents() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM renters r
    WHERE r.id = p_renter_id AND r.organization_id = v_org_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.notFound');
  END IF;

  IF p_mime IS NULL OR NOT (p_mime = ANY (_renter_allowed_document_mimes())) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.documentMimeInvalid');
  END IF;

  IF p_size IS NULL OR p_size <= 0 OR p_size > _renter_document_max_bytes() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.documentSizeInvalid');
  END IF;

  v_safe_name := regexp_replace(coalesce(p_filename, 'file'), '[^a-zA-Z0-9._-]', '_', 'g');
  IF v_safe_name = '' THEN
    v_safe_name := 'file';
  END IF;

  v_path := v_org_id::text || '/' || p_renter_id::text || '/' || v_object_id::text;

  INSERT INTO renter_document_upload_intents (
    organization_id,
    renter_id,
    storage_path,
    created_by
  )
  VALUES (
    v_org_id,
    p_renter_id,
    v_path,
    v_member_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'storage_path', v_path,
    'bucket', 'renter-documents',
    'object_id', v_object_id
  );
END;
$$;

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
    DELETE FROM renter_document_upload_intents i
    WHERE i.organization_id = v_org_id AND i.storage_path = v_storage_path;
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

  DELETE FROM renter_document_upload_intents i
  WHERE i.organization_id = v_org_id AND i.storage_path = v_storage_path;

  RETURN jsonb_build_object('success', true, 'document_id', v_document_id);
EXCEPTION
  WHEN unique_violation THEN
    SELECT d.id INTO v_document_id
    FROM renter_documents d
    WHERE d.organization_id = v_org_id
      AND d.storage_path = v_storage_path;
    IF FOUND THEN
      DELETE FROM renter_document_upload_intents i
      WHERE i.organization_id = v_org_id AND i.storage_path = v_storage_path;
      RETURN jsonb_build_object('success', true, 'document_id', v_document_id);
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.documentDuplicate');
END;
$$;

-- =============================================================================
-- 2. renter-documents Storage: path must match prepare intent or finalized row
-- =============================================================================

DROP POLICY IF EXISTS renter_documents_storage_insert ON storage.objects;
DROP POLICY IF EXISTS renter_documents_storage_select ON storage.objects;
DROP POLICY IF EXISTS renter_documents_storage_delete ON storage.objects;

CREATE POLICY renter_documents_storage_insert
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'renter-documents'
  AND member_can_read_renter_documents()
  AND EXISTS (
    SELECT 1
    FROM renter_document_upload_intents i
    WHERE i.storage_path = name
      AND i.organization_id = auth_organization_id()
      AND i.expires_at > now()
  )
);

CREATE POLICY renter_documents_storage_select
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'renter-documents'
  AND member_can_read_renter_documents()
  AND (
    EXISTS (
      SELECT 1
      FROM renter_documents d
      WHERE d.storage_path = name
        AND d.organization_id = auth_organization_id()
    )
    OR EXISTS (
      SELECT 1
      FROM renter_document_upload_intents i
      WHERE i.storage_path = name
        AND i.organization_id = auth_organization_id()
        AND i.expires_at > now()
    )
  )
);

CREATE POLICY renter_documents_storage_delete
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'renter-documents'
  AND member_can_read_renter_documents()
  AND EXISTS (
    SELECT 1
    FROM renter_document_upload_intents i
    WHERE i.storage_path = name
      AND i.organization_id = auth_organization_id()
  )
);

-- =============================================================================
-- 3. exports bucket: can_export_data(); drop application/octet-stream
-- =============================================================================

UPDATE storage.buckets
SET allowed_mime_types = ARRAY['text/csv', 'text/plain', 'application/csv']
WHERE id = 'exports';

DROP POLICY IF EXISTS exports_insert_own ON storage.objects;

CREATE POLICY exports_insert_own
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'exports'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND can_export_data()
);

-- exports_select_own / exports_delete_own unchanged (own uid prefix)

-- =============================================================================
-- 4. teacher_pay_rates: save_teacher_pay_rate RPC, then REVOKE client write
-- =============================================================================

CREATE OR REPLACE FUNCTION save_teacher_pay_rate(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := NULLIF(p_payload ->> 'member_id', '')::uuid;
  v_pay_mode text := NULLIF(p_payload ->> 'pay_mode', '');
  v_fixed_amount numeric := COALESCE(NULLIF(p_payload ->> 'fixed_amount', '')::numeric, 0);
  v_group_rate numeric := COALESCE(NULLIF(p_payload ->> 'group_rate_percent', '')::numeric, 0);
  v_personal_rate numeric := COALESCE(NULLIF(p_payload ->> 'personal_rate_percent', '')::numeric, 0);
  v_single_visit_rate numeric := COALESCE(NULLIF(p_payload ->> 'single_visit_rate_percent', '')::numeric, 0);
  v_effective_from date := COALESCE(NULLIF(p_payload ->> 'effective_from', '')::date, CURRENT_DATE);
  v_rate_id uuid;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'unauthorized');
  END IF;

  IF NOT can_manage_payroll_rates() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  IF v_member_id IS NULL
    OR v_pay_mode NOT IN ('percent', 'fixed', 'fixed_plus_percent')
    OR v_fixed_amount < 0
    OR v_group_rate < 0
    OR v_personal_rate < 0
    OR v_single_visit_rate < 0
  THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_payload');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM organization_members om
    WHERE om.organization_id = v_org_id
      AND om.id = v_member_id
      AND om.role = 'teacher'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'member_not_found');
  END IF;

  INSERT INTO teacher_pay_rates (
    organization_id,
    member_id,
    pay_mode,
    fixed_amount,
    rate_percent,
    group_rate_percent,
    personal_rate_percent,
    single_visit_rate_percent,
    effective_from
  )
  VALUES (
    v_org_id,
    v_member_id,
    v_pay_mode,
    v_fixed_amount,
    GREATEST(v_group_rate, v_personal_rate, v_single_visit_rate),
    v_group_rate,
    v_personal_rate,
    v_single_visit_rate,
    v_effective_from
  )
  RETURNING id INTO v_rate_id;

  RETURN jsonb_build_object('success', true, 'rate_id', v_rate_id);
END;
$$;

REVOKE ALL ON FUNCTION save_teacher_pay_rate(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_teacher_pay_rate(jsonb) TO authenticated;

REVOKE INSERT, UPDATE, DELETE ON teacher_pay_rates FROM anon, authenticated;

DROP POLICY IF EXISTS teacher_pay_rates_insert ON teacher_pay_rates;
DROP POLICY IF EXISTS teacher_pay_rates_update ON teacher_pay_rates;
DROP POLICY IF EXISTS teacher_pay_rates_delete ON teacher_pay_rates;

GRANT SELECT ON teacher_pay_rates TO authenticated;

COMMIT;
