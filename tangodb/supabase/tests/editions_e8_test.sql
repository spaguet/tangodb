-- E8: expire flag branches, GCal cron skip, Mini App fail-closed on Studio.
-- Run: npm run test:db:editions-e8

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
  v_owner uuid := 'e8a11111-1111-4111-8111-111111111111';
  v_org_suspend uuid := 'e8b11111-1111-4111-8111-111111111111';
  v_org_lite uuid := 'e8c11111-1111-4111-8111-111111111111';
  v_org_studio uuid := 'e8d11111-1111-4111-8111-111111111111';
  v_member uuid := 'e8e11111-1111-4111-8111-111111111111';
  v_as_of timestamptz := timestamptz '2026-10-01 12:00:00+00';
  v_period_end timestamptz := v_as_of;
  v_result jsonb;
  v_org_status text;
  v_reconcile jsonb;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2' LIMIT 1;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'e8-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()
  )
  ON CONFLICT (id) DO NOTHING;

  -- Flag off: expire → suspend (2.11)
  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org_suspend, 'E8 Suspend', 'e8-suspend', 'licensed', v_version_id, v_owner)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed';

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org_suspend, v_version_id, 'subscription', v_as_of - interval '20 days')
  ON CONFLICT DO NOTHING;

  INSERT INTO organization_subscriptions (
    organization_id, plan, billing_period, status, provider,
    current_period_start, current_period_end, billing_anchor_day
  )
  VALUES (
    v_org_suspend, 'standard', 'monthly', 'past_due', 'manual',
    v_as_of - interval '30 days', v_period_end, 1
  )
  ON CONFLICT (organization_id) DO UPDATE
    SET status = 'past_due', current_period_end = EXCLUDED.current_period_end;

  UPDATE platform_runtime_flags
  SET value = '{"enabled": false}'::jsonb
  WHERE key = 'editions_lifecycle';

  v_result := expire_crm_organization_subscriptions(200, v_as_of + interval '7 days');
  PERFORM _test_assert(
    COALESCE((v_result ->> 'suspended_count')::int, 0) >= 1,
    'flag off: grace end suspends org'
  );

  SELECT status INTO v_org_status FROM organizations WHERE id = v_org_suspend;
  PERFORM _test_assert(v_org_status = 'suspended', 'flag off: org suspended');

  -- Flag on: expire → Lite licensed, not suspended
  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org_lite, 'E8 Lite Expire', 'e8-lite-expire', 'licensed', v_version_id, v_owner)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed';

  INSERT INTO organization_settings (organization_id) VALUES (v_org_lite) ON CONFLICT DO NOTHING;
  INSERT INTO organization_edition_state (organization_id, active_edition, changed_at, change_reason)
  VALUES (v_org_lite, 'pro', now(), 'admin_adjust')
  ON CONFLICT (organization_id) DO UPDATE SET active_edition = 'pro';

  INSERT INTO organization_entitlements (
    organization_id, edition, instrument, status, period_start, period_end
  )
  VALUES (
    v_org_lite, 'pro', 'pro_monthly', 'past_due',
    v_as_of - interval '30 days', v_period_end
  )
  ON CONFLICT DO NOTHING;

  UPDATE platform_runtime_flags
  SET value = '{"enabled": true}'::jsonb
  WHERE key = 'editions_lifecycle';

  v_result := expire_crm_organization_subscriptions(200, v_as_of + interval '7 days');
  PERFORM _test_assert(
    COALESCE((v_result ->> 'suspended_count')::int, 0) = 0,
    'flag on: no suspend on expire'
  );
  PERFORM _test_assert(
    COALESCE((v_result ->> 'canceled_count')::int, 0) >= 1,
    'flag on: month canceled after grace'
  );

  SELECT status INTO v_org_status FROM organizations WHERE id = v_org_lite;
  PERFORM _test_assert(v_org_status = 'licensed', 'flag on: org stays licensed');

  PERFORM _test_assert(
    (SELECT active_edition FROM organization_edition_state WHERE organization_id = v_org_lite) = 'lite',
    'flag on: clamp to lite'
  );

  -- Studio: Mini App addon off (F4/F52)
  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org_studio, 'E8 Studio', 'e8-studio', 'licensed', v_version_id, v_owner)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed';

  INSERT INTO organization_settings (organization_id) VALUES (v_org_studio) ON CONFLICT DO NOTHING;
  INSERT INTO organization_edition_state (organization_id, active_edition, changed_at, change_reason)
  VALUES (v_org_studio, 'studio', now(), 'admin_adjust')
  ON CONFLICT (organization_id) DO UPDATE SET active_edition = 'studio';

  INSERT INTO organization_entitlements (
    organization_id, edition, instrument, status, period_start, period_end
  )
  VALUES (
    v_org_studio, 'studio', 'studio_monthly', 'active',
    v_as_of - interval '5 days', v_as_of + interval '25 days'
  )
  ON CONFLICT DO NOTHING;

  PERFORM _test_assert(
    NOT renter_miniapp_addon_is_active(v_org_studio),
    'studio licensed: mini app addon inactive'
  );

  v_reconcile := execute_member_personal_lessons_reconcile(v_org_studio, v_member, false);
  PERFORM _test_assert(
    (v_reconcile ->> 'skipped')::boolean IS TRUE
    AND v_reconcile ->> 'reason' = 'edition_paused',
    'lite/studio: reconcile RPC paused when lifecycle on'
  );

  UPDATE platform_runtime_flags
  SET value = '{"enabled": false}'::jsonb
  WHERE key = 'editions_lifecycle';
END;
$$;

COMMIT;
