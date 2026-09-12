-- S4: expire CRM SaaS month → past_due → suspend; writes/Mini App off at period_end; digest source.
-- Run: npm run test:db:crm-monthly-s4

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
  v_owner uuid := 'c4111111-1111-4111-8111-111111111111';
  v_org_expire uuid := 'c5111111-1111-4111-8111-111111111111';
  v_org_future uuid := 'c5222222-2222-4222-8222-222222222222';
  v_org_life uuid := 'c5333333-3333-4333-8333-333333333333';
  v_org_t7 uuid := 'c5444444-4444-4444-8444-444444444444';
  v_as_of timestamptz := timestamptz '2026-09-12 12:00:00+00';
  v_period_end timestamptz := v_as_of;
  v_result jsonb;
  v_sub_status text;
  v_org_status text;
  v_digest_expiring int;
  v_digest_overdue int;
  v_purge jsonb;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2' LIMIT 1;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    's4-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES
    (v_org_expire, 'S4 Expire', 's4-expire', 'licensed', v_version_id, v_owner),
    (v_org_future, 'S4 Future', 's4-future', 'licensed', v_version_id, v_owner),
    (v_org_life, 'S4 Lifetime', 's4-lifetime', 'licensed', v_version_id, v_owner),
    (v_org_t7, 'S4 TMinus7', 's4-tminus7', 'licensed', v_version_id, v_owner);

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES
    (v_org_expire, v_version_id, 'subscription', v_as_of - interval '20 days'),
    (v_org_future, v_version_id, 'subscription', v_as_of - interval '5 days'),
    (v_org_life, v_version_id, 'lifetime', v_as_of),
    (v_org_t7, v_version_id, 'subscription', v_as_of - interval '23 days');

  INSERT INTO organization_subscriptions (
    organization_id, plan, billing_period, status, provider,
    current_period_start, current_period_end, billing_anchor_day
  )
  VALUES
    (
      v_org_expire, 'standard', 'monthly', 'active', 'manual',
      v_as_of - interval '30 days', v_period_end, 12
    ),
    (
      v_org_future, 'standard', 'monthly', 'active', 'manual',
      v_as_of - interval '5 days', v_as_of + interval '25 days', 12
    ),
    (
      v_org_life, 'standard', 'monthly', 'active', 'manual',
      v_as_of - interval '10 days', v_as_of - interval '1 day', 12
    ),
    (
      v_org_t7, 'standard', 'monthly', 'active', 'manual',
      v_as_of - interval '23 days', v_as_of + interval '3 days', 12
    );

  -- Exact now() boundary: writes + Mini App off while status is still active (no cron yet)
  PERFORM _test_assert(
    NOT organization_has_active_subscription(v_org_expire),
    'period_end = as_of is not an active subscription'
  );
  PERFORM _test_assert(
    NOT organization_allows_writes(v_org_expire),
    'writes closed at period_end without cron'
  );
  PERFORM _test_assert(
    NOT renter_miniapp_addon_is_active(v_org_expire),
    'Mini App off at period_end without cron'
  );
  PERFORM _test_assert(
    organization_allows_reads(v_org_expire),
    'licensed reads still open during grace'
  );

  SELECT status INTO v_sub_status FROM organization_subscriptions WHERE organization_id = v_org_expire;
  PERFORM _test_assert(v_sub_status = 'active', 'cron lag: status still active before expire RPC');

  PERFORM _test_assert(
    organization_has_active_subscription(v_org_future),
    'future period still active'
  );
  PERFORM _test_assert(
    organization_allows_writes(v_org_future),
    'future period still writable'
  );
  PERFORM _test_assert(
    renter_miniapp_addon_is_active(v_org_future),
    'Mini App on while period open'
  );

  -- Lifetime leftover row must not expire the org
  v_result := expire_crm_organization_subscriptions(200, v_as_of);
  PERFORM _test_assert((v_result ->> 'ok')::boolean, 'expire rpc ok');
  PERFORM _test_assert((v_result ->> 'past_due_count')::int = 1, 'only expired non-lifetime → past_due');
  PERFORM _test_assert((v_result ->> 'suspended_count')::int = 0, 'grace not finished yet');

  SELECT status INTO v_sub_status FROM organization_subscriptions WHERE organization_id = v_org_expire;
  PERFORM _test_assert(v_sub_status = 'past_due', 'expired month is past_due');
  SELECT status INTO v_org_status FROM organizations WHERE id = v_org_expire;
  PERFORM _test_assert(v_org_status = 'licensed', 'grace keeps licensed');

  SELECT status INTO v_sub_status FROM organization_subscriptions WHERE organization_id = v_org_life;
  PERFORM _test_assert(v_sub_status = 'active', 'lifetime org subscription not expired');
  SELECT status INTO v_org_status FROM organizations WHERE id = v_org_life;
  PERFORM _test_assert(v_org_status = 'licensed', 'lifetime org stays licensed');

  -- Idempotent second tick
  v_result := expire_crm_organization_subscriptions(200, v_as_of);
  PERFORM _test_assert((v_result ->> 'past_due_count')::int = 0, 'idempotent past_due');
  PERFORM _test_assert((v_result ->> 'suspended_count')::int = 0, 'idempotent suspend before grace');

  -- Digest source: T−7 expiring + overdue licensed
  SELECT count(*) INTO v_digest_expiring
  FROM list_platform_crm_subscription_digest(v_as_of)
  WHERE digest_type = 'expiring' AND organization_id = v_org_t7;
  PERFORM _test_assert(v_digest_expiring = 1, 'T−7 org in expiring digest');

  SELECT count(*) INTO v_digest_overdue
  FROM list_platform_crm_subscription_digest(v_as_of)
  WHERE digest_type = 'overdue' AND organization_id = v_org_expire;
  PERFORM _test_assert(v_digest_overdue = 1, 'past_due org in overdue digest');

  SELECT count(*) INTO v_digest_expiring
  FROM list_platform_crm_subscription_digest(v_as_of)
  WHERE organization_id = v_org_future;
  PERFORM _test_assert(v_digest_expiring = 0, 'far-future period not in digest');

  -- After grace → canceled + suspended
  v_result := expire_crm_organization_subscriptions(200, v_as_of + interval '7 days');
  PERFORM _test_assert((v_result ->> 'suspended_count')::int = 1, 'grace end suspends');

  SELECT status INTO v_sub_status FROM organization_subscriptions WHERE organization_id = v_org_expire;
  PERFORM _test_assert(v_sub_status = 'canceled', 'subscription canceled after grace');
  SELECT status INTO v_org_status FROM organizations WHERE id = v_org_expire;
  PERFORM _test_assert(v_org_status = 'suspended', 'org suspended after grace');
  PERFORM _test_assert(NOT organization_allows_reads(v_org_expire), 'reads closed after suspend');
  PERFORM _test_assert(NOT organization_allows_writes(v_org_expire), 'writes closed after suspend');
  PERFORM _test_assert(NOT renter_miniapp_addon_is_active(v_org_expire), 'Mini App off after suspend');

  v_result := expire_crm_organization_subscriptions(200, v_as_of + interval '7 days');
  PERFORM _test_assert((v_result ->> 'suspended_count')::int = 0, 'idempotent after suspend');

  -- Licensed/suspended data stay (purge only demo)
  v_purge := purge_expired_demo_organizations();
  PERFORM _test_assert(
    EXISTS (SELECT 1 FROM organizations WHERE id = v_org_expire),
    'suspended org not purged'
  );
  PERFORM _test_assert(
    EXISTS (SELECT 1 FROM organizations WHERE id = v_org_future),
    'licensed org not purged'
  );

  PERFORM _test_assert(
    NOT COALESCE(
      has_function_privilege(
        'authenticated',
        'expire_crm_organization_subscriptions(integer, timestamp with time zone)',
        'execute'
      ),
      false
    ),
    'JWT cannot execute expire rpc'
  );
  PERFORM _test_assert(
    has_function_privilege(
      'service_role',
      'expire_crm_organization_subscriptions(integer, timestamp with time zone)',
      'execute'
    ),
    'service_role can execute expire rpc'
  );
  PERFORM _test_assert(
    NOT COALESCE(
      has_function_privilege(
        'authenticated',
        'list_platform_crm_subscription_digest(timestamp with time zone)',
        'execute'
      ),
      false
    ),
    'JWT cannot execute digest rpc'
  );

  RAISE NOTICE 'All S4 subscription expire SQL tests passed';
END;
$$;

ROLLBACK;
