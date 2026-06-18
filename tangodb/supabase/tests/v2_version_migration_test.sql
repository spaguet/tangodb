-- TangoDB v2 Phase 5 — version migration tests
-- Run: psql $DATABASE_URL -f supabase/tests/v2_version_migration_test.sql

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
  v_v2_id uuid;
  v_v3_id uuid;
  v_dev_user uuid := '44444444-4444-4444-4444-444444444444';
  v_org uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  v_member uuid := 'dddddddd-dddd-dddd-dddd-dddddddddd01';
  v_result jsonb;
  v_locked boolean;
  v_status text;
  v_version_code text;
  v_write_ok boolean;
BEGIN
  SELECT id INTO v_v2_id FROM crm_product_versions WHERE code = 'v2';
  SELECT id INTO v_v3_id FROM crm_product_versions WHERE code = 'v3';

  PERFORM _test_assert(v_v3_id IS NOT NULL, 'v3 product version must exist');

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, created_at, updated_at)
  VALUES (
    v_dev_user,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'dev-migrate@test.local',
    crypt('testpass123', gen_salt('bf')),
    now(),
    '{"platform_role":"developer"}'::jsonb,
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET raw_app_meta_data = '{"platform_role":"developer"}'::jsonb;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'Migrate Test Org', 'migrate-test', 'licensed', v_v2_id, v_dev_user);

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_dev_user, 'owner', 'Dev Owner');

  INSERT INTO organization_settings (organization_id) VALUES (v_org);

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type)
  VALUES (v_org, v_v2_id, 'lifetime');

  INSERT INTO user_active_organizations (user_id, organization_id, member_id)
  VALUES (v_dev_user, v_org, v_member);

  -- schema_version_locked denies writes
  UPDATE organizations SET schema_version_locked = true WHERE id = v_org;

  PERFORM _test_assert(
    NOT organization_allows_writes(v_org),
    'Locked org must deny writes via organization_allows_writes'
  );

  UPDATE organizations SET schema_version_locked = false WHERE id = v_org;

  -- dry-run: no version change, no lock left behind
  v_result := migrate_organization_version(v_org, v_v3_id, true, v_dev_user);

  PERFORM _test_assert((v_result ->> 'dry_run')::boolean = true, 'dry_run flag must be true');
  PERFORM _test_assert(v_result ->> 'to_version' = 'v3', 'dry_run target must be v3');

  SELECT schema_version_locked, status INTO v_locked, v_status FROM organizations WHERE id = v_org;
  PERFORM _test_assert(v_locked = false, 'dry_run must not leave org locked');
  PERFORM _test_assert(v_status = 'licensed', 'dry_run must not change org status');

  SELECT cv.code INTO v_version_code
  FROM organizations o
  JOIN crm_product_versions cv ON cv.id = o.crm_version_id
  WHERE o.id = v_org;
  PERFORM _test_assert(v_version_code = 'v2', 'dry_run must not change crm_version_id');

  -- apply migration v2 -> v3
  v_result := migrate_organization_version(v_org, v_v3_id, false, v_dev_user);

  PERFORM _test_assert((v_result ->> 'ok')::boolean = true, 'apply migration must succeed');

  SELECT cv.code INTO v_version_code
  FROM organizations o
  JOIN crm_product_versions cv ON cv.id = o.crm_version_id
  WHERE o.id = v_org;
  PERFORM _test_assert(v_version_code = 'v3', 'org must be on v3 after migration');

  SELECT schema_version_locked INTO v_locked FROM organizations WHERE id = v_org;
  PERFORM _test_assert(v_locked = false, 'org must be unlocked after successful migration');

  -- rollback v3 -> v2
  v_result := migrate_organization_version(v_org, v_v2_id, false, v_dev_user);
  PERFORM _test_assert(v_result ->> 'from_version' = 'v3', 'downgrade must start from v3');

  SELECT cv.code INTO v_version_code
  FROM organizations o
  JOIN crm_product_versions cv ON cv.id = o.crm_version_id
  WHERE o.id = v_org;
  PERFORM _test_assert(v_version_code = 'v2', 'org must be back on v2 after downgrade');

  RAISE NOTICE 'All version migration tests passed';
END;
$$;

ROLLBACK;
