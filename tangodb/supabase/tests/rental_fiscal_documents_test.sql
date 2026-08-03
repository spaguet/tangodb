-- rental fiscal documents (hall rent stage 17)
-- Run: psql $DATABASE_URL -f supabase/tests/rental_fiscal_documents_test.sql

BEGIN;

CREATE OR REPLACE FUNCTION _test_assert(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_condition THEN
    RAISE EXCEPTION 'ASSERT FAILED: %', p_message;
  END IF;
END;
$$;

DO $$
DECLARE
  v_org uuid := 'ffffffff-ffff-ffff-ffff-fffffffffff2';
  v_renter uuid := 'ffffffff-ffff-ffff-ffff-000000000312';
  v_invoice_id uuid;
  v_result jsonb;
  v_doc jsonb;
  v_number text;
  v_number2 text;
  v_vat record;
BEGIN
  UPDATE organization_settings
  SET rental_billing_profile = jsonb_build_object(
    'documents_mode', 'crm',
    'country_code', 'RU',
    'legal_name', 'Test Studio LLC',
    'inn', '7700000000',
    'vat_mode', 'included',
    'vat_rate', 20,
    'invoice_number_prefix', 'INV-',
    'next_invoice_number', 100,
    'fiscal_tracking_enabled', true
  )
  WHERE organization_id = v_org;

  PERFORM _test_assert(_rental_documents_mode(v_org) = 'crm', 'documents mode crm');
  PERFORM _test_assert(_rental_fiscal_tracking_enabled(v_org), 'fiscal tracking enabled');

  SELECT * INTO v_vat FROM _rental_compute_vat(120, 'included', 20);
  PERFORM _test_assert(v_vat.net_amount = 100 AND v_vat.vat_amount = 20, 'vat included split');

  SELECT * INTO v_vat FROM _rental_compute_vat(100, 'on_top', 20);
  PERFORM _test_assert(v_vat.net_amount = 100 AND v_vat.vat_amount = 20, 'vat on_top split');

  v_number := _rental_next_invoice_number(v_org);
  PERFORM _test_assert(v_number = 'INV-100', 'invoice number sequence');
  v_number2 := _rental_next_invoice_number(v_org);
  PERFORM _test_assert(v_number2 = 'INV-101', 'invoice number incremented');

  SELECT id INTO v_invoice_id
  FROM rental_invoices
  WHERE organization_id = v_org AND renter_id = v_renter
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_invoice_id IS NULL THEN
    RAISE EXCEPTION 'ASSERT FAILED: seed invoice missing';
  END IF;

  UPDATE rental_invoices
  SET document_number = NULL, document_version = 1, issued_at = NULL
  WHERE id = v_invoice_id;

  v_result := issue_rental_invoice_document(v_invoice_id);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'issue document success');
  PERFORM _test_assert(v_result ? 'document_number', 'issue returns document_number');

  v_result := issue_rental_invoice_document(v_invoice_id);
  PERFORM _test_assert((v_result ->> 'reissued')::boolean, 'reissue bumps version');
  PERFORM _test_assert((v_result ->> 'document_version')::int = 2, 'document version 2');

  v_result := get_rental_invoice_document(v_invoice_id);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'get document success');
  v_doc := v_result -> 'document';
  PERFORM _test_assert(v_doc ? 'lines', 'document has lines');
  PERFORM _test_assert(v_doc ? 'billing_profile', 'document has billing profile');

  v_result := export_rental_invoice_documents(ARRAY[v_invoice_id]);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'export success');
  PERFORM _test_assert(jsonb_array_length(v_result -> 'documents') = 1, 'export one document');

  PERFORM _test_assert(
    _rental_resolve_fiscal_status(v_org, 'card', NULL) = 'pending',
    'card defaults pending when fiscal on'
  );
  PERFORM _test_assert(
    _rental_resolve_fiscal_status(v_org, 'transfer', NULL) = 'not_required',
    'transfer not_required when fiscal on'
  );

  UPDATE organization_settings
  SET rental_billing_profile = '{}'::jsonb
  WHERE organization_id = v_org;
END;
$$;

ROLLBACK;
