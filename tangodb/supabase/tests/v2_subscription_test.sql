-- TangoDB v2 Phase 7 — subscription gating + grandfathering tests
-- Run: psql $DATABASE_URL -f supabase/tests/v2_subscription_test.sql

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
  v_org_lifetime uuid := 'a1111111-1111-4111-8111-111111111111';
  v_org_sub uuid := 'a2222222-2222-4222-8222-222222222222';
  v_owner uuid := 'b1111111-1111-4111-8111-111111111111';
  v_now timestamptz := now();
  v_result jsonb;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2' LIMIT 1;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sub-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES
    (v_org_lifetime, 'Lifetime Org', 'lifetime-org', 'licensed', v_version_id, v_owner),
    (v_org_sub, 'Subscription Org', 'subscription-org', 'licensed', v_version_id, v_owner);

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org_lifetime, v_version_id, 'lifetime', v_now);

  PERFORM _test_assert(organization_has_lifetime_license(v_org_lifetime), 'lifetime license detected');
  PERFORM _test_assert(organization_allows_writes(v_org_lifetime), 'lifetime org allows writes');

  v_result := sync_organization_subscription(
    v_org_sub,
    'standard',
    'monthly',
    'active',
    'stripe',
    'cus_test_1',
    'sub_test_1',
    v_now,
    v_now + interval '30 days',
    'evt_test_active_1',
    'test.subscription.active'
  );

  PERFORM _test_assert((v_result ->> 'ok')::boolean, 'sync subscription ok');
  PERFORM _test_assert(organization_has_active_subscription(v_org_sub), 'active subscription detected');
  PERFORM _test_assert(organization_allows_writes(v_org_sub), 'subscribed org allows writes');

  v_result := sync_organization_subscription(
    v_org_sub,
    'standard',
    'monthly',
    'past_due',
    'stripe',
    'cus_test_1',
    'sub_test_1',
    v_now,
    v_now + interval '30 days',
    'evt_test_past_due_1',
    'test.subscription.past_due'
  );

  PERFORM _test_assert(NOT organization_has_active_subscription(v_org_sub), 'past_due not active');
  PERFORM _test_assert(NOT organization_allows_writes(v_org_sub), 'past_due blocks writes');
  PERFORM _test_assert(organization_allows_reads(v_org_sub), 'past_due still allows reads');

  v_result := sync_organization_subscription(
    v_org_sub,
    'standard',
    'monthly',
    'active',
    'stripe',
    'cus_test_1',
    'sub_test_1',
    v_now,
    v_now + interval '30 days',
    'evt_test_active_1',
    'test.subscription.active'
  );

  PERFORM _test_assert((v_result ->> 'duplicate')::boolean, 'webhook idempotency');

  v_result := sync_organization_subscription(
    v_org_lifetime,
    'standard',
    'monthly',
    'canceled',
    'stripe',
    'cus_lifetime',
    'sub_lifetime',
    v_now,
    v_now + interval '30 days',
    'evt_lifetime_1',
    'test.lifetime.grandfather'
  );

  PERFORM _test_assert((v_result ->> 'grandfathered_lifetime')::boolean, 'lifetime grandfather flag');
  PERFORM _test_assert(organization_allows_writes(v_org_lifetime), 'lifetime writes after canceled sub sync');

  RAISE NOTICE 'All subscription tests passed';
END;
$$;

ROLLBACK;
