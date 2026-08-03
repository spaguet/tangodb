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
  v_version_id uuid;
  v_org uuid := 'ffffffff-ffff-ffff-ffff-fffffffffff5';
  v_user uuid := '66666666-6666-6666-6666-66666666fff5';
  v_member uuid := 'ffffffff-ffff-ffff-ffff-ffffffffff15';
  v_loc uuid := 'ffffffff-ffff-ffff-ffff-000000000215';
  v_renter uuid := 'ffffffff-ffff-ffff-ffff-000000000315';
  v_invoice_id uuid := 'ffffffff-ffff-ffff-ffff-000000000515';
  v_result jsonb;
  v_doc jsonb;
  v_number text;
  v_number2 text;
  v_vat record;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    v_user,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'rental-fiscal@test.local',
    crypt('testpass123', gen_salt('bf')),
    now(),
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'Rental Fiscal Org', 'rental-fiscal', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET
    status = 'licensed',
    owner_user_id = EXCLUDED.owner_user_id;
  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET
    license_type = 'lifetime',
    activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'Owner Fiscal')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, rental_billing_profile)
  VALUES (
    v_org,
    'Europe/Moscow',
    jsonb_build_object(
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
  )
  ON CONFLICT (organization_id) DO UPDATE SET
    rental_billing_profile = EXCLUDED.rental_billing_profile;

  INSERT INTO locations (id, organization_id, name)
  VALUES (v_loc, v_org, 'Fiscal Hall')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO renters (id, organization_id, display_name)
  VALUES (v_renter, v_org, 'Fiscal Renter')
  ON CONFLICT (id) DO NOTHING;

  DELETE FROM rental_invoice_lines WHERE organization_id = v_org;
  DELETE FROM rental_invoices WHERE organization_id = v_org;

  INSERT INTO rental_invoices (
    id, organization_id, renter_id, period_start, period_end, due_date, status, total_amount, currency, created_by
  )
  VALUES (
    v_invoice_id, v_org, v_renter, current_date, current_date + 30, current_date + 14, 'invoiced', 5000, 'RUB', v_member
  );

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');

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
  PERFORM _test_assert(
    v_doc -> 'billing_profile' ->> 'legal_name' = 'Test Studio LLC',
    'document billing_profile has legal_name'
  );
  PERFORM _test_assert(v_doc ? 'lines', 'document has lines');

  RAISE NOTICE 'rental_fiscal_documents_test: ok';
END;
$$;

ROLLBACK;
