-- S2c: preview activate + billing adjust RPC (Inbox Edge uses these)
-- Run: npm run test:db:crm-monthly-s2c

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
  v_owner uuid := 'c5111111-1111-4111-8111-111111111111';
  v_actor uuid := 'c5222222-2222-4222-8222-222222222222';
  v_org uuid := 'c5333333-3333-4333-8333-333333333333';
  v_quote_id uuid;
  v_req_id uuid;
  v_result jsonb;
  v_preview jsonb;
  v_end timestamptz;
  v_end2 timestamptz;
  v_now timestamptz := now();
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2' LIMIT 1;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's2c-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()),
    (v_actor, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's2c-actor@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id, demo_expires_at, data_purge_at)
  VALUES (v_org, 'S2c Monthly', 's2c-monthly', 'demo_active', v_version_id, v_owner, v_now + interval '5 days', v_now + interval '5 days')
  ON CONFLICT (id) DO NOTHING;

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
    NULL, 'S2c Monthly', NULL, NULL, 'first month'
  );
  v_req_id := (v_result ->> 'request_id')::uuid;

  v_preview := preview_activate_platform_purchase_request(v_req_id);
  PERFORM _test_assert((v_preview ->> 'ok')::boolean, 'preview ok');
  PERFORM _test_assert(v_preview ? 'period_start', 'preview has period_start');
  PERFORM _test_assert(v_preview ? 'period_end', 'preview has period_end');

  v_result := activate_platform_purchase_request(v_req_id, v_actor);
  PERFORM _test_assert((v_result ->> 'ok')::boolean, 'activate month ok');
  SELECT current_period_end INTO v_end FROM organization_subscriptions WHERE organization_id = v_org;

  v_result := activate_platform_purchase_request(v_req_id, v_actor);
  PERFORM _test_assert((v_result ->> 'already_activated')::boolean, 'inbox idempotent flag');
  SELECT current_period_end INTO v_end2 FROM organization_subscriptions WHERE organization_id = v_org;
  PERFORM _test_assert(v_end = v_end2, 'idempotent does not extend period');

  v_result := dev_console_adjust_organization_subscription(
    v_org, v_actor, 'active', NULL, NULL, 'manual', true, 'extend one month'
  );
  PERFORM _test_assert((v_result ->> 'ok')::boolean, 'billing extend ok');
  SELECT current_period_end INTO v_end2 FROM organization_subscriptions WHERE organization_id = v_org;
  PERFORM _test_assert(v_end2 > v_end, 'extend shifted period_end');

  RAISE NOTICE 'All S2c subscription SQL tests passed';
END;
$$;

ROLLBACK;
