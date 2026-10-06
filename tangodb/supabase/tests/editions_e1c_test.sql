-- E1c: purchase IN, purge, adjust, notifications, flag off Studio
-- Run: npm run test:db:editions-e1c

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
  v_owner uuid := 'e1c11111-1111-4111-8111-111111111111';
  v_actor uuid := 'e1c22222-2222-4222-8222-222222222222';
  v_org uuid := 'e1c33333-3333-4333-8333-333333333333';
  v_quote_id uuid;
  v_req_id uuid;
  v_preview jsonb;
  v_result jsonb;
  v_err text;
  v_payload jsonb;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2' LIMIT 1;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'e1c-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()),
    (v_actor, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'e1c-actor@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'E1c Org', 'e1c-org', 'licensed', v_version_id, v_owner)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed';

  INSERT INTO organization_settings (organization_id) VALUES (v_org) ON CONFLICT DO NOTHING;

  INSERT INTO organization_entitlements (organization_id, edition, instrument, status)
  VALUES (v_org, 'lite', 'free_lifetime', 'active')
  ON CONFLICT DO NOTHING;

  INSERT INTO organization_edition_state (organization_id, active_edition, changed_at, change_reason)
  VALUES (v_org, 'lite', now(), 'admin_adjust')
  ON CONFLICT (organization_id) DO UPDATE SET active_edition = 'lite';

  -- Studio quote + request
  INSERT INTO platform_purchase_quotes (
    organization_id, requester_user_id, sku, method_code, amount, currency,
    pricing_revision, payment_details_snapshot, expires_at
  )
  VALUES (
    v_org, v_owner, 'crm_studio_subscription', 'bankTransfer', '19', 'USD',
    1, 'x', now() + interval '1 day'
  )
  RETURNING id INTO v_quote_id;

  v_result := submit_platform_purchase_request(
    v_quote_id, gen_random_uuid(), v_org, v_owner,
    NULL, 'E1c Org', NULL, NULL, 'studio month'
  );
  v_req_id := (v_result ->> 'request_id')::uuid;

  -- Flag off: preview Studio → editions_lifecycle_off
  BEGIN
    v_preview := preview_activate_platform_purchase_request(v_req_id);
    RAISE EXCEPTION 'expected editions_lifecycle_off on preview';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM _test_assert(v_err = 'editions_lifecycle_off', 'preview studio flag off');
  END;

  BEGIN
    PERFORM activate_platform_purchase_request(v_req_id, v_actor);
    RAISE EXCEPTION 'expected editions_lifecycle_off on activate';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM _test_assert(v_err = 'editions_lifecycle_off', 'activate studio flag off');
  END;

  -- Enable lifecycle for Studio activate path
  UPDATE platform_runtime_flags
  SET value = '{"enabled": true}'::jsonb
  WHERE key = 'editions_lifecycle';

  v_preview := preview_activate_platform_purchase_request(v_req_id);
  PERFORM _test_assert((v_preview ->> 'ok')::boolean, 'preview studio ok');
  PERFORM _test_assert(v_preview ? 'period_end', 'preview studio has period');

  v_result := activate_platform_purchase_request(v_req_id, v_actor);
  PERFORM _test_assert((v_result ->> 'ok')::boolean, 'activate studio ok');
  PERFORM _test_assert(
    EXISTS (
      SELECT 1 FROM organization_entitlements e
      WHERE e.organization_id = v_org
        AND e.instrument = 'studio_monthly'
        AND e.status = 'active'
    ),
    'studio_monthly entitlement'
  );
  PERFORM _test_assert(
    (SELECT plan FROM organization_subscriptions WHERE organization_id = v_org) = 'studio',
    'mirror plan studio'
  );

  -- extend_one_month on Studio
  v_result := dev_console_adjust_organization_subscription(
    v_org, v_actor, 'active', NULL, NULL, 'manual', true, 'extend studio'
  );
  PERFORM _test_assert((v_result ->> 'ok')::boolean, 'extend studio ok');

  -- licensed Lite purge forbidden
  BEGIN
    PERFORM purge_single_organization(v_org, v_actor, 'test purge', false, false);
    RAISE EXCEPTION 'expected licensed purge forbidden';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM _test_assert(v_err = 'licensed_org_purge_forbidden', 'licensed lite purge');
  END;

  -- Notification Studio label (F114)
  PERFORM enqueue_platform_purchase_request_notifications(v_req_id);
  SELECT payload INTO v_payload
  FROM platform_notification_outbox
  WHERE dedupe_key = 'purchase:' || v_req_id::text || ':email'
  ORDER BY created_at DESC
  LIMIT 1;

  PERFORM _test_assert(
    v_payload ->> 'email_subject' LIKE '%Studio%',
    'notification subject mentions Studio'
  );
  PERFORM _test_assert(
    (v_payload ->> 'telegram_text') NOT LIKE '%Lifetime%',
    'telegram not lifetime for studio'
  );

  -- Re-purchase Studio after cancel (F32)
  UPDATE organization_entitlements
  SET status = 'canceled', updated_at = now()
  WHERE organization_id = v_org
    AND instrument = 'studio_monthly'
    AND status IN ('active', 'past_due');

  DELETE FROM organization_licenses WHERE organization_id = v_org;

  UPDATE organization_subscriptions
  SET status = 'canceled', updated_at = now()
  WHERE organization_id = v_org;

  INSERT INTO platform_purchase_quotes (
    organization_id, requester_user_id, sku, method_code, amount, currency,
    pricing_revision, payment_details_snapshot, expires_at
  )
  VALUES (
    v_org, v_owner, 'crm_studio_subscription', 'bankTransfer', '19', 'USD',
    1, 'y', now() + interval '1 day'
  )
  RETURNING id INTO v_quote_id;

  v_result := submit_platform_purchase_request(
    v_quote_id, gen_random_uuid(), v_org, v_owner,
    NULL, 'E1c Org', NULL, NULL, 'studio again'
  );
  v_req_id := (v_result ->> 'request_id')::uuid;

  v_result := activate_platform_purchase_request(v_req_id, v_actor);
  PERFORM _test_assert((v_result ->> 'ok')::boolean, 'reactivate studio ok');
  PERFORM _test_assert(
    (
      SELECT count(*)::int
      FROM organization_entitlements e
      WHERE e.organization_id = v_org
        AND e.instrument = 'studio_monthly'
        AND e.status = 'active'
    ) = 1,
    'single live studio row'
  );

  UPDATE platform_runtime_flags
  SET value = '{"enabled": false}'::jsonb
  WHERE key = 'editions_lifecycle';

  RAISE NOTICE 'All E1c SQL tests passed';
END;
$$;

ROLLBACK;
