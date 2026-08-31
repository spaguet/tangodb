-- R6: request_kind trigger, addon activate must not license CRM.
-- Run: psql "%DATABASE_URL%" -v ON_ERROR_STOP=1 -f supabase/tests/_hall_rent_test_jwt.sql -f supabase/tests/renter_miniapp_r6_addon_purchase_test.sql

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
  v_org_demo uuid := 'a0600000-0000-4000-8000-000000000001';
  v_org_licensed uuid := 'a0600000-0000-4000-8000-000000000002';
  v_owner uuid := 'a0600000-0000-4000-8000-000000000011';
  v_member uuid := 'a0600000-0000-4000-8000-000000000021';
  v_request uuid := 'a0600000-0000-4000-8000-000000000031';
  v_keys_before int;
  v_keys_after int;
  v_licenses_before int;
  v_licenses_after int;
  v_org_status text;
  v_addon_code text;
  v_addon_status text;
  v_raised boolean;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES (
    v_owner,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'r6-owner@test.local',
    crypt('testpass123', gen_salt('bf')),
    now(), now(), now(),
    '{}'::jsonb,
    '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, status, crm_version_id)
  VALUES
    (v_org_demo, 'R6 Demo Org', 'demo_active', v_version_id),
    (v_org_licensed, 'R6 Licensed Org', 'licensed', v_version_id)
  ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status;

  INSERT INTO organization_members (id, organization_id, user_id, role, is_active)
  VALUES
    (v_member, v_org_licensed, v_owner, 'owner', true),
    ('a0600000-0000-4000-8000-000000000012', v_org_demo, v_owner, 'owner', true)
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code)
  VALUES
    (v_org_demo, 'Europe/Moscow', 'RUB'),
    (v_org_licensed, 'Europe/Moscow', 'RUB')
  ON CONFLICT (organization_id) DO NOTHING;

  PERFORM _hall_rent_test_set_jwt(v_owner, v_org_licensed, v_member, 'owner');

  v_raised := false;
  BEGIN
    INSERT INTO platform_purchase_requests (
      id, organization_id, requester_user_id, organization_name, payment_comment, request_kind
    )
    VALUES (
      gen_random_uuid(), v_org_licensed, v_owner, 'Licensed', 'comment long enough for test', 'renter_miniapp_addon'
    );
  EXCEPTION WHEN OTHERS THEN
    v_raised := SQLERRM LIKE '%purchase_request_kind_forbidden%';
  END;
  PERFORM _test_assert(v_raised, 'authenticated INSERT renter_miniapp_addon must fail');

  INSERT INTO platform_purchase_requests (
    id, organization_id, requester_user_id, organization_name, payment_comment
  )
  VALUES (
    gen_random_uuid(), v_org_licensed, v_owner, 'Licensed', 'crm license request long enough'
  );

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('role', 'service_role', true);

  INSERT INTO platform_purchase_requests (
    id, organization_id, requester_user_id, organization_name, payment_comment, request_kind
  )
  VALUES (
    v_request, v_org_demo, v_owner, 'R6 Demo Org', 'addon payment comment long enough', 'renter_miniapp_addon'
  );

  SELECT count(*) INTO v_keys_before FROM access_keys WHERE organization_id = v_org_demo;
  SELECT count(*) INTO v_licenses_before FROM organization_licenses WHERE organization_id = v_org_demo;

  INSERT INTO organization_addons (
    organization_id, addon_code, status, period_start, period_end
  )
  VALUES (
    v_org_demo,
    'renter_miniapp',
    'active',
    _org_local_date(v_org_demo),
    _org_local_date(v_org_demo) + 30
  )
  ON CONFLICT (organization_id, addon_code) DO UPDATE
  SET status = 'active',
      period_start = EXCLUDED.period_start,
      period_end = EXCLUDED.period_end,
      updated_at = now();

  UPDATE platform_purchase_requests
  SET status = 'activated', activated_at = now(), updated_at = now()
  WHERE id = v_request;

  SELECT count(*) INTO v_keys_after FROM access_keys WHERE organization_id = v_org_demo;
  SELECT count(*) INTO v_licenses_after FROM organization_licenses WHERE organization_id = v_org_demo;
  SELECT status INTO v_org_status FROM organizations WHERE id = v_org_demo;
  SELECT addon_code, status
  INTO v_addon_code, v_addon_status
  FROM organization_addons
  WHERE organization_id = v_org_demo;

  PERFORM _test_assert(v_keys_after = v_keys_before, 'addon activate must not insert access_keys');
  PERFORM _test_assert(v_licenses_after = v_licenses_before, 'addon activate must not insert organization_licenses');
  PERFORM _test_assert(v_org_status = 'demo_active', 'addon activate must not set organizations.status=licensed');
  PERFORM _test_assert(v_addon_code = 'renter_miniapp', 'addon_code must be renter_miniapp');
  PERFORM _test_assert(v_addon_status = 'active', 'addon status must be active');

  UPDATE organization_addons
  SET status = 'paused'
  WHERE organization_id = v_org_demo AND addon_code = 'renter_miniapp';

  PERFORM _test_assert(
    renter_miniapp_addon_is_active(v_org_demo) IS FALSE,
    'paused addon must fail closed'
  );

  UPDATE organization_addons
  SET status = 'active',
      period_start = _org_local_date(v_org_demo) - 30,
      period_end = _org_local_date(v_org_demo) - 1
  WHERE organization_id = v_org_demo AND addon_code = 'renter_miniapp';

  PERFORM _test_assert(
    renter_miniapp_addon_is_active(v_org_demo) IS FALSE,
    'expired addon period must fail closed'
  );

  RAISE NOTICE 'renter_miniapp_r6_addon_purchase_test: OK';
END;
$$;

ROLLBACK;
