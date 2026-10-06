-- E1b: time-aware helpers, caps, triggers (flag on in fixture, off at end).
-- Run: npm run test:db:editions-e1b

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
  v_org uuid := 'e1b11111-1111-4111-8111-111111111111';
  v_loc uuid;
  v_loc2 uuid;
BEGIN
  UPDATE platform_runtime_flags
  SET value = '{"enabled": true}'::jsonb
  WHERE key = 'editions_lifecycle';

  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2' LIMIT 1;
  PERFORM _test_assert(v_version_id IS NOT NULL, 'crm v2 version exists');

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'E1b Org', 'e1b-org', 'licensed', v_version_id, NULL)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed';

  INSERT INTO organization_settings (organization_id)
  VALUES (v_org)
  ON CONFLICT DO NOTHING;

  INSERT INTO organization_entitlements (
    organization_id, edition, instrument, status, period_start, period_end
  )
  VALUES (v_org, 'lite', 'free_lifetime', 'active', NULL, NULL)
  ON CONFLICT DO NOTHING;

  INSERT INTO organization_edition_state (
    organization_id, active_edition, changed_at, change_reason
  )
  VALUES (v_org, 'lite', now(), 'admin_adjust')
  ON CONFLICT (organization_id) DO UPDATE
    SET active_edition = 'lite';

  -- Grace: period_end in past, status still active → active_edition lite, cash closed
  INSERT INTO organization_entitlements (
    organization_id, edition, instrument, status,
    period_start, period_end, billing_anchor_day
  )
  VALUES (
    v_org, 'pro', 'pro_monthly', 'active',
    now() - interval '40 days',
    now() - interval '1 day',
    1
  )
  ON CONFLICT DO NOTHING;

  PERFORM _test_assert(
    organization_active_edition(v_org) = 'lite',
    'grace: active_edition lite before cron'
  );
  PERFORM _test_assert(
    NOT edition_allows(v_org, 'group_subscriptions'),
    'grace: group_subscriptions closed'
  );
  PERFORM _test_assert(
    edition_allows(v_org, 'attendance'),
    'grace: attendance journal open'
  );

  -- get_organization_edition fail-closed / clamped state
  PERFORM _test_assert(
    (get_organization_edition(v_org) ->> 'active_edition') = 'lite',
    'get_organization_edition active lite'
  );
  PERFORM _test_assert(
    (get_organization_edition(v_org) ->> 'persisted_active_edition') IN ('lite', 'pro'),
    'get_organization_edition persisted clamped'
  );

  -- First location ok on Lite, second cap
  INSERT INTO locations (organization_id, name, sort_order)
  VALUES (v_org, 'Hall A', 1)
  RETURNING id INTO v_loc;

  BEGIN
    INSERT INTO locations (organization_id, name, sort_order)
    VALUES (v_org, 'Hall B', 2);
    RAISE EXCEPTION 'expected edition_cap_exceeded on 2nd location';
  EXCEPTION WHEN OTHERS THEN
    PERFORM _test_assert(SQLERRM LIKE '%edition_cap_exceeded%', '2nd location cap');
  END;

  UPDATE locations SET name = 'Hall A renamed' WHERE id = v_loc;
  PERFORM _test_assert(true, 'location rename allowed on Lite');

  -- Flag off → 2.11 writes path for licensed+month mirror (use org with sub)
  UPDATE platform_runtime_flags
  SET value = '{"enabled": false}'::jsonb
  WHERE key = 'editions_lifecycle';

  PERFORM _test_assert(
    editions_lifecycle_enabled() IS FALSE,
    'lifecycle flag off'
  );

  DELETE FROM organization_entitlements
  WHERE organization_id = v_org AND instrument = 'pro_monthly';

  INSERT INTO organization_licenses (organization_id, license_type, activated_at)
  VALUES (v_org, 'subscription', now())
  ON CONFLICT (organization_id) DO UPDATE
    SET license_type = 'subscription';

  INSERT INTO organization_subscriptions (
    organization_id, plan, billing_period, status, provider,
    current_period_start, current_period_end
  )
  VALUES (
    v_org, 'pro', 'monthly', 'active', 'manual',
    now() - interval '5 days', now() + interval '25 days'
  )
  ON CONFLICT (organization_id) DO UPDATE
    SET status = 'active',
        current_period_end = now() + interval '25 days';

  PERFORM _test_assert(
    organization_allows_writes(v_org) IS TRUE,
    'flag off: licensed+active month writes like 2.11'
  );

  -- Cleanup fixture org
  DELETE FROM locations WHERE organization_id = v_org;
  DELETE FROM organization_entitlements WHERE organization_id = v_org;
  DELETE FROM organization_edition_state WHERE organization_id = v_org;
  DELETE FROM organization_subscriptions WHERE organization_id = v_org;
  DELETE FROM organization_licenses WHERE organization_id = v_org;
  DELETE FROM organization_settings WHERE organization_id = v_org;
  DELETE FROM organizations WHERE id = v_org;
END;
$$;

ROLLBACK;
