-- S2d: authenticated cannot INSERT purchase requests; RPC submit still works.
-- Run: npm run test:db:crm-monthly-s2d

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
  v_owner uuid := 'c6111111-1111-4111-8111-111111111111';
  v_member uuid := 'c6222222-2222-4222-8222-222222222222';
  v_org uuid := 'c6333333-3333-4333-8333-333333333333';
  v_quote_id uuid;
  v_result jsonb;
  v_now timestamptz := now();
  v_raised boolean;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2' LIMIT 1;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's2d-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id, demo_expires_at, data_purge_at)
  VALUES (v_org, 'S2d Demo', 's2d-demo', 'demo_active', v_version_id, v_owner, v_now + interval '5 days', v_now + interval '5 days')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, is_active)
  VALUES (v_member, v_org, v_owner, 'owner', true)
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('role', 'authenticated', true);

  v_raised := false;
  BEGIN
    INSERT INTO platform_purchase_requests (
      organization_id, requester_user_id, organization_name, payment_comment, request_kind
    )
    VALUES (
      v_org, v_owner, 'S2d Demo', 'direct insert crm_license', 'crm_license'
    );
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_raised := true;
    WHEN OTHERS THEN
      v_raised := SQLERRM LIKE '%permission denied%'
        OR SQLERRM LIKE '%purchase_request_kind_forbidden%';
  END;
  PERFORM _test_assert(v_raised, 'authenticated INSERT crm_license must fail');

  v_raised := false;
  BEGIN
    INSERT INTO platform_purchase_requests (
      organization_id, requester_user_id, organization_name, payment_comment, request_kind
    )
    VALUES (
      v_org, v_owner, 'S2d Demo', 'direct insert monthly', 'crm_subscription'
    );
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_raised := true;
    WHEN OTHERS THEN
      v_raised := SQLERRM LIKE '%permission denied%'
        OR SQLERRM LIKE '%purchase_request_kind_forbidden%';
  END;
  PERFORM _test_assert(v_raised, 'authenticated INSERT crm_subscription must fail');

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('role', 'service_role', true);

  INSERT INTO platform_purchase_quotes (
    organization_id, requester_user_id, sku, method_code, amount, currency,
    pricing_revision, payment_details_snapshot, expires_at
  )
  VALUES (
    v_org, v_owner, 'crm_subscription', 'bankTransfer', '29', 'USD',
    1, 'x', v_now + interval '1 day'
  )
  RETURNING id INTO v_quote_id;

  v_result := submit_platform_purchase_request(
    v_quote_id, gen_random_uuid(), v_org, v_owner,
    NULL, 'S2d Demo', NULL, NULL, 'rpc submit after s2d'
  );
  PERFORM _test_assert(v_result ? 'request_id', 'submit_platform_purchase_request ok');

  INSERT INTO platform_purchase_requests (
    organization_id, requester_user_id, organization_name, payment_comment, request_kind
  )
  VALUES (
    v_org, v_owner, 'S2d Demo', 'service_role addon row', 'renter_miniapp_addon'
  );

  RAISE NOTICE 'All S2d purchase request RLS tests passed';
END;
$$;

ROLLBACK;
