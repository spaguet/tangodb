-- TangoDB v2 Phase 1A — RLS smoke tests
-- Run: psql $DATABASE_URL -f supabase/tests/v2_tenant_rls_test.sql
-- Uses a transaction; rolls back all test data.

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
  v_org_a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_org_b uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_user_a uuid := '11111111-1111-1111-1111-111111111111';
  v_user_b uuid := '22222222-2222-2222-2222-222222222222';
  v_member_a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01';
  v_member_b uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01';
  v_retention_org uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  v_retention_member uuid := 'cccccccc-cccc-cccc-cccc-cccccccccc01';
  v_retention_user uuid := '33333333-3333-3333-3333-333333333333';
  v_count int;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES
    (v_user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()),
    (v_user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()),
    (v_retention_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'retention@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES
    (v_org_a, 'Org A', 'org-a', 'licensed', v_version_id, v_user_a),
    (v_org_b, 'Org B', 'org-b', 'licensed', v_version_id, v_user_b),
    (v_retention_org, 'Org Retention', 'org-retention', 'demo_retention', v_version_id, v_retention_user);

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES
    (v_member_a, v_org_a, v_user_a, 'owner', 'Owner A'),
    (v_member_b, v_org_b, v_user_b, 'owner', 'Owner B'),
    (v_retention_member, v_retention_org, v_retention_user, 'owner', 'Retention Owner');

  INSERT INTO organization_settings (organization_id)
  VALUES (v_org_a), (v_org_b), (v_retention_org);

  INSERT INTO user_active_organizations (user_id, organization_id, member_id)
  VALUES
    (v_user_a, v_org_a, v_member_a),
    (v_user_b, v_org_b, v_member_b),
    (v_retention_user, v_retention_org, v_retention_member);

  -- User A sees only own membership (org picker) without cross-tenant leak
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', v_user_a::text,
      'organization_id', v_org_a::text,
      'member_id', v_member_a::text,
      'member_role', 'owner'
    )::text,
    true
  );

  SELECT count(*) INTO v_count
  FROM organization_members
  WHERE organization_id = v_org_b;

  PERFORM _test_assert(v_count = 0, 'User A must not read Org B memberships via active-org policy');

  SELECT count(*) INTO v_count
  FROM organization_members
  WHERE user_id = v_user_a;

  PERFORM _test_assert(v_count = 1, 'User A must read own membership for org picker');

  -- User A cannot read Org B organization row
  SELECT count(*) INTO v_count FROM organizations WHERE id = v_org_b;
  PERFORM _test_assert(v_count = 0, 'User A must not read Org B organization');

  -- demo_retention: SELECT settings ok, UPDATE denied
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', v_retention_user::text,
      'organization_id', v_retention_org::text,
      'member_id', v_retention_member::text,
      'member_role', 'owner'
    )::text,
    true
  );

  SELECT count(*) INTO v_count
  FROM organization_settings
  WHERE organization_id = v_retention_org;

  PERFORM _test_assert(v_count = 1, 'demo_retention org settings SELECT must succeed');

  BEGIN
    UPDATE organization_settings
    SET locale = 'en-US'
    WHERE organization_id = v_retention_org;
    PERFORM _test_assert(false, 'demo_retention settings UPDATE must be denied');
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%violates row-level security%' AND SQLERRM NOT LIKE '%permission denied%' THEN
        RAISE;
      END IF;
  END;

  PERFORM _test_assert(
    organization_allows_reads(v_retention_org),
    'organization_allows_reads true for demo_retention'
  );
  PERFORM _test_assert(
    NOT organization_allows_writes(v_retention_org),
    'organization_allows_writes false for demo_retention'
  );

  RAISE NOTICE 'v2 tenant RLS tests passed';
END;
$$;

DROP FUNCTION _test_assert(boolean, text);

ROLLBACK;
