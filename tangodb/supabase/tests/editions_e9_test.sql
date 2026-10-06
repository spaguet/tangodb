-- E9: demo trial_end → licensed Lite; flag off still purges.
-- Run: npm run test:db:editions-e9

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
  v_owner uuid := 'e9a11111-1111-4111-8111-111111111111';
  v_org_convert uuid := 'e9b11111-1111-4111-8111-111111111111';
  v_org_purge uuid := 'e9c11111-1111-4111-8111-111111111111';
  v_org_mode uuid := 'e9d11111-1111-4111-8111-111111111111';
  v_now timestamptz := timestamptz '2026-10-15 12:00:00+00';
  v_expired timestamptz := v_now - interval '1 day';
  v_result jsonb;
  v_status text;
  v_active text;
  v_trial_status text;
  v_client_count int;
  v_purged_exists boolean;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2' LIMIT 1;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'e9-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()
  )
  ON CONFLICT (id) DO NOTHING;

  -- Flag on: convert keeps tenant data
  INSERT INTO organizations (
    id, name, slug, status, crm_version_id, owner_user_id,
    demo_activated_at, demo_expires_at, data_purge_at
  )
  VALUES (
    v_org_convert, 'E9 Convert', 'e9-convert', 'demo_active', v_version_id, v_owner,
    v_now - interval '31 days', v_expired, v_expired
  )
  ON CONFLICT (id) DO UPDATE
    SET status = 'demo_active',
        data_purge_at = EXCLUDED.data_purge_at,
        demo_expires_at = EXCLUDED.demo_expires_at;

  INSERT INTO organization_settings (organization_id) VALUES (v_org_convert) ON CONFLICT DO NOTHING;

  PERFORM _seed_demo_edition_entitlements(v_org_convert, v_now - interval '31 days', v_expired);

  INSERT INTO clients (id, organization_id, first_name, last_name)
  VALUES ('e9e11111-1111-4111-8111-111111111111', v_org_convert, 'Keep', 'Me')
  ON CONFLICT (id) DO NOTHING;

  UPDATE platform_runtime_flags
  SET value = '{"enabled": true}'::jsonb
  WHERE key = 'editions_lifecycle';

  v_result := purge_expired_demo_organizations();
  PERFORM _test_assert(
    COALESCE((v_result ->> 'converted_count')::int, 0) = 1,
    'flag on: one demo converted'
  );

  SELECT status INTO v_status FROM organizations WHERE id = v_org_convert;
  SELECT (data_purge_at IS NULL) INTO v_purged_exists FROM organizations WHERE id = v_org_convert;
  PERFORM _test_assert(v_status = 'licensed', 'flag on: status licensed');
  PERFORM _test_assert(v_purged_exists, 'flag on: data_purge_at cleared');

  SELECT e.status INTO v_trial_status
  FROM organization_entitlements e
  WHERE e.organization_id = v_org_convert AND e.instrument = 'trial_pro';
  PERFORM _test_assert(v_trial_status = 'canceled', 'flag on: trial_pro canceled');

  SELECT s.active_edition INTO v_active
  FROM organization_edition_state s WHERE s.organization_id = v_org_convert;
  PERFORM _test_assert(v_active = 'lite', 'flag on: default active_edition lite after trial');

  SELECT count(*)::int INTO v_client_count FROM clients WHERE organization_id = v_org_convert;
  PERFORM _test_assert(v_client_count = 1, 'flag on: client row kept');

  PERFORM _test_assert(
    organization_allows_writes(v_org_convert),
    'flag on: licensed Lite may write'
  );

  -- Flag on: owner_mode lite during demo preserved
  INSERT INTO organizations (
    id, name, slug, status, crm_version_id, owner_user_id,
    demo_activated_at, demo_expires_at, data_purge_at
  )
  VALUES (
    v_org_mode, 'E9 Mode Lite', 'e9-mode-lite', 'demo_active', v_version_id, v_owner,
    v_now - interval '31 days', v_expired, v_expired
  )
  ON CONFLICT (id) DO UPDATE
    SET status = 'demo_active',
        data_purge_at = EXCLUDED.data_purge_at;

  INSERT INTO organization_settings (organization_id) VALUES (v_org_mode) ON CONFLICT DO NOTHING;
  PERFORM _seed_demo_edition_entitlements(v_org_mode, v_now - interval '31 days', v_expired);

  UPDATE organization_edition_state
  SET active_edition = 'lite', change_reason = 'owner_mode'
  WHERE organization_id = v_org_mode;

  PERFORM convert_expired_demo_to_lite(v_org_mode);

  SELECT s.active_edition INTO v_active
  FROM organization_edition_state s WHERE s.organization_id = v_org_mode;
  PERFORM _test_assert(v_active = 'lite', 'flag on: owner_mode lite kept at trial_end');

  -- Flag off: legacy purge
  UPDATE platform_runtime_flags
  SET value = '{"enabled": false}'::jsonb
  WHERE key = 'editions_lifecycle';

  INSERT INTO organizations (
    id, name, slug, status, crm_version_id, owner_user_id,
    demo_activated_at, demo_expires_at, data_purge_at
  )
  VALUES (
    v_org_purge, 'E9 Purge', 'e9-purge', 'demo_active', v_version_id, v_owner,
    v_now - interval '31 days', v_expired, v_expired
  )
  ON CONFLICT (id) DO UPDATE
    SET status = 'demo_active',
        data_purge_at = EXCLUDED.data_purge_at;

  INSERT INTO organization_settings (organization_id) VALUES (v_org_purge) ON CONFLICT DO NOTHING;

  v_result := purge_expired_demo_organizations();
  PERFORM _test_assert(
    COALESCE((v_result ->> 'purged_count')::int, 0) = 1,
    'flag off: demo purged'
  );

  PERFORM _test_assert(
    NOT EXISTS (SELECT 1 FROM organizations WHERE id = v_org_purge),
    'flag off: org row removed'
  );
END;
$$;

ROLLBACK;
