-- S2a: CRM monthly subscription SQL (quotes, submit, activate, anchor, hold)
-- Run: psql $DATABASE_URL -f supabase/tests/crm_monthly_subscription_s2a_test.sql

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
  v_owner uuid := 'c2111111-1111-4111-8111-111111111111';
  v_actor uuid := 'c2222222-2222-4222-8222-222222222222';
  v_org_demo uuid := 'c3111111-1111-4111-8111-111111111111';
  v_org_sub uuid := 'c3222222-2222-4222-8222-222222222222';
  v_org_life uuid := 'c3333333-3333-4333-8333-333333333333';
  v_quote_id uuid;
  v_quote_id2 uuid;
  v_req_id uuid;
  v_req_id2 uuid;
  v_client_id uuid := 'd4111111-1111-4111-8111-111111111111';
  v_client_id2 uuid := 'd4222222-2222-4222-8222-222222222222';
  v_result jsonb;
  v_purge jsonb;
  v_end timestamptz;
  v_end2 timestamptz;
  v_org_status text;
  v_hold timestamptz;
  v_now timestamptz := now();
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2' LIMIT 1;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's2a-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()),
    (v_actor, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's2a-actor@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id, demo_expires_at, data_purge_at)
  VALUES
    (v_org_demo, 'S2a Demo', 's2a-demo', 'demo_active', v_version_id, v_owner, v_now + interval '5 days', v_now + interval '5 days'),
    (v_org_sub, 'S2a Monthly', 's2a-monthly', 'licensed', v_version_id, v_owner, NULL, NULL),
    (v_org_life, 'S2a Lifetime', 's2a-lifetime', 'licensed', v_version_id, v_owner, NULL, NULL);

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org_life, v_version_id, 'lifetime', v_now);

  -- add_calendar_month anchor 31: Jan 31 -> Feb 28/29
  v_end := add_calendar_month(
    timestamptz '2024-01-31 12:00:00+00',
    31::smallint
  );
  PERFORM _test_assert(
    extract(month FROM v_end) = 2 AND extract(day FROM v_end) IN (28, 29),
    'anchor 31 Jan -> Feb end'
  );

  v_end2 := add_calendar_month(v_end, 31::smallint);
  PERFORM _test_assert(
    extract(month FROM v_end2) = 3 AND extract(day FROM v_end2) = 31,
    'anchor 31 Feb end -> Mar 31'
  );

  -- Stripe null period_end still counts as active (non-manual)
  INSERT INTO organization_subscriptions (
    organization_id, plan, billing_period, status, provider,
    current_period_start, current_period_end
  )
  VALUES (
    v_org_sub, 'standard', 'monthly', 'active', 'stripe',
    v_now - interval '1 day', NULL
  );
  PERFORM _test_assert(
    organization_has_active_subscription(v_org_sub),
    'stripe null end still active'
  );

  -- manual active without end is not active
  UPDATE organization_subscriptions
  SET provider = 'manual',
      current_period_start = v_now - interval '10 days',
      current_period_end = NULL,
      billing_anchor_day = 15
  WHERE organization_id = v_org_sub;

  PERFORM _test_assert(
    NOT organization_has_active_subscription(v_org_sub),
    'manual null end not active'
  );

  -- submit + hold (does not extend on second submit)
  INSERT INTO platform_purchase_quotes (
    organization_id, requester_user_id, sku, method_code, amount, currency,
    pricing_revision, payment_details_snapshot, qr_sha256, expires_at
  )
  VALUES (
    v_org_demo, v_owner, 'crm_license', 'bankTransfer', '199', 'USD',
    1, 'IBAN test', 'abc', v_now + interval '1 day'
  )
  RETURNING id INTO v_quote_id;

  v_result := submit_platform_purchase_request(
    v_quote_id, v_client_id, v_org_demo, v_owner,
    's2a-owner@test.local', 'S2a Demo', NULL, NULL, 'paid comment long enough'
  );
  v_req_id := (v_result ->> 'request_id')::uuid;

  SELECT purchase_review_hold_until INTO v_hold FROM organizations WHERE id = v_org_demo;
  PERFORM _test_assert(v_hold IS NOT NULL, 'review hold set on first timely request');

  INSERT INTO platform_purchase_quotes (
    organization_id, requester_user_id, sku, method_code, amount, currency,
    pricing_revision, payment_details_snapshot, expires_at
  )
  VALUES (
    v_org_demo, v_owner, 'crm_license', 'bankTransfer', '199', 'USD',
    1, 'IBAN test', v_now + interval '1 day'
  )
  RETURNING id INTO v_quote_id2;

  PERFORM submit_platform_purchase_request(
    v_quote_id2, v_client_id2, v_org_demo, v_owner,
    's2a-owner@test.local', 'S2a Demo', NULL, NULL, 'second request comment'
  );

  SELECT purchase_review_hold_until INTO v_hold FROM organizations WHERE id = v_org_demo;
  PERFORM _test_assert(
    v_hold = (SELECT data_purge_at + interval '72 hours' FROM organizations WHERE id = v_org_demo),
    'hold not extended by second request'
  );

  v_purge := purge_expired_demo_organizations();
  PERFORM _test_assert((v_purge ->> 'purged_count')::int = 0, 'purge skipped while hold + eligible new');

  -- reject submit after data_purge_at
  UPDATE organizations SET data_purge_at = v_now - interval '1 minute' WHERE id = v_org_demo;
  BEGIN
    INSERT INTO platform_purchase_quotes (
      organization_id, requester_user_id, sku, method_code, amount, currency,
      pricing_revision, payment_details_snapshot, expires_at
    )
    VALUES (
      v_org_demo, v_owner, 'crm_license', 'bankTransfer', '199', 'USD',
      1, 'x', v_now + interval '1 day'
    )
    RETURNING id INTO v_quote_id;
    PERFORM submit_platform_purchase_request(
      v_quote_id, gen_random_uuid(), v_org_demo, v_owner,
      NULL, 'S2a Demo', NULL, NULL, 'late comment'
    );
    RAISE EXCEPTION 'expected demo_purge_deadline_passed';
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM _test_assert(SQLERRM LIKE '%demo_purge_deadline_passed%', 'reject after data_purge_at');
  END;

  UPDATE organizations
  SET data_purge_at = v_now + interval '5 days',
      purchase_review_hold_until = NULL
  WHERE id = v_org_demo;

  -- monthly on lifetime org forbidden
  INSERT INTO platform_purchase_quotes (
    organization_id, requester_user_id, sku, method_code, amount, currency,
    pricing_revision, payment_details_snapshot, expires_at
  )
  VALUES (
    v_org_life, v_owner, 'crm_subscription', 'bankTransfer', '29', 'USD',
    1, 'x', v_now + interval '1 day'
  )
  RETURNING id INTO v_quote_id;
  BEGIN
    PERFORM submit_platform_purchase_request(
      v_quote_id, gen_random_uuid(), v_org_life, v_owner,
      NULL, 'S2a Lifetime', NULL, NULL, 'monthly on lifetime'
    );
    RAISE EXCEPTION 'expected lifetime_org_monthly_forbidden';
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM _test_assert(SQLERRM LIKE '%lifetime_org_monthly_forbidden%', 'monthly quote on lifetime');
  END;

  -- activate month (manual with valid period)
  UPDATE organization_subscriptions
  SET provider = 'manual',
      status = 'active',
      current_period_start = v_now - interval '5 days',
      current_period_end = v_now + interval '20 days',
      billing_anchor_day = 10
  WHERE organization_id = v_org_sub;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org_sub, v_version_id, 'subscription', v_now)
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'subscription';

  INSERT INTO platform_purchase_quotes (
    organization_id, requester_user_id, sku, method_code, amount, currency,
    pricing_revision, payment_details_snapshot, expires_at
  )
  VALUES (
    v_org_sub, v_owner, 'crm_subscription', 'bankTransfer', '29', 'USD',
    1, 'x', v_now + interval '1 day'
  )
  RETURNING id INTO v_quote_id;

  v_result := submit_platform_purchase_request(
    v_quote_id, gen_random_uuid(), v_org_sub, v_owner,
    NULL, 'S2a Monthly', NULL, NULL, 'renew month one'
  );
  v_req_id := (v_result ->> 'request_id')::uuid;

  v_result := activate_platform_purchase_request(v_req_id, v_actor);
  PERFORM _test_assert((v_result ->> 'ok')::boolean, 'activate month ok');

  SELECT current_period_end INTO v_end FROM organization_subscriptions WHERE organization_id = v_org_sub;

  INSERT INTO platform_purchase_quotes (
    organization_id, requester_user_id, sku, method_code, amount, currency,
    pricing_revision, payment_details_snapshot, expires_at
  )
  VALUES (
    v_org_sub, v_owner, 'crm_subscription', 'bankTransfer', '29', 'USD',
    1, 'x', v_now + interval '1 day'
  )
  RETURNING id INTO v_quote_id2;

  v_result := submit_platform_purchase_request(
    v_quote_id2, gen_random_uuid(), v_org_sub, v_owner,
    NULL, 'S2a Monthly', NULL, NULL, 'renew month two'
  );
  v_req_id2 := (v_result ->> 'request_id')::uuid;

  v_result := activate_platform_purchase_request(v_req_id2, v_actor);
  SELECT current_period_end INTO v_end2 FROM organization_subscriptions WHERE organization_id = v_org_sub;
  PERFORM _test_assert(v_end2 > v_end, 'two months extend end twice');

  -- idempotent activate
  v_result := activate_platform_purchase_request(v_req_id2, v_actor);
  PERFORM _test_assert((v_result ->> 'already_activated')::boolean, 'idempotent activate');
  SELECT current_period_end INTO v_end FROM organization_subscriptions WHERE organization_id = v_org_sub;
  PERFORM _test_assert(v_end = v_end2, 'idempotent activate does not shift period');

  -- month on lifetime activate refused
  INSERT INTO platform_purchase_requests (
    organization_id, requester_user_id, organization_name, payment_comment,
    request_kind, status
  )
  VALUES (
    v_org_life, v_owner, 'S2a Lifetime', 'fake monthly', 'crm_subscription', 'new'
  )
  RETURNING id INTO v_req_id;
  BEGIN
    PERFORM activate_platform_purchase_request(v_req_id, v_actor);
    RAISE EXCEPTION 'expected month_on_lifetime_forbidden';
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM _test_assert(SQLERRM LIKE '%month_on_lifetime_forbidden%', 'activate month on lifetime');
  END;

  -- upgrade month -> lifetime without suspended
  INSERT INTO platform_purchase_requests (
    organization_id, requester_user_id, organization_name, payment_comment,
    request_kind, status
  )
  VALUES (
    v_org_sub, v_owner, 'S2a Monthly', 'upgrade', 'crm_license', 'new'
  )
  RETURNING id INTO v_req_id;

  v_result := activate_platform_purchase_request(
    v_req_id,
    v_actor,
    NULL,
    NULL,
    NULL,
    'deadbeef' || repeat('0', 56),
    's2a-owner@test.local'
  );
  PERFORM _test_assert((v_result ->> 'ok')::boolean, 'lifetime upgrade ok');

  SELECT status INTO v_org_status FROM organizations WHERE id = v_org_sub;
  PERFORM _test_assert(v_org_status = 'licensed', 'upgrade keeps licensed not suspended');
  PERFORM _test_assert(organization_has_lifetime_license(v_org_sub), 'upgrade sets lifetime');

  RAISE NOTICE 'All S2a subscription SQL tests passed';
END;
$$;

ROLLBACK;
