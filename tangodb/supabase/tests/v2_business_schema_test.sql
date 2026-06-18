-- TangoDB v2 Phase 2A — cross-org FK and constraint smoke tests
-- Run: psql $DATABASE_URL -f supabase/tests/v2_business_schema_test.sql

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
  v_client_a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001';
  v_client_b uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-000000000001';
  v_disc_a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000101';
  v_disc_b uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-000000000101';
  v_caught boolean;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES
    (v_user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'biz-a@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()),
    (v_user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'biz-b@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES
    (v_org_a, 'Biz Org A', 'biz-a', 'licensed', v_version_id, v_user_a),
    (v_org_b, 'Biz Org B', 'biz-b', 'licensed', v_version_id, v_user_b)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES
    (v_member_a, v_org_a, v_user_a, 'owner', 'Owner A'),
    (v_member_b, v_org_b, v_user_b, 'owner', 'Owner B')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id)
  VALUES (v_org_a), (v_org_b)
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO clients (id, organization_id, first_name, last_name)
  VALUES
    (v_client_a, v_org_a, 'Anna', 'Alpha'),
    (v_client_b, v_org_b, 'Boris', 'Beta')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO disciplines (id, organization_id, name)
  VALUES
    (v_disc_a, v_org_a, 'Tango'),
    (v_disc_b, v_org_b, 'Salsa')
  ON CONFLICT (id) DO NOTHING;

  -- Cross-org subscription: client from org B in org A subscription must fail
  v_caught := false;
  BEGIN
    INSERT INTO subscriptions (
      organization_id, type, client_id1, lessons_total, lessons_left,
      activation_date, discipline_id, category
    )
    VALUES (
      v_org_a, 'solo', v_client_b, 8, 8, CURRENT_DATE, v_disc_a, 'group'
    );
  EXCEPTION
    WHEN OTHERS THEN
      v_caught := true;
  END;
  PERFORM _test_assert(v_caught, 'Cross-org client_id1 FK must be rejected');

  -- Cross-org discipline in subscription
  v_caught := false;
  BEGIN
    INSERT INTO subscriptions (
      organization_id, type, client_id1, lessons_total, lessons_left,
      activation_date, discipline_id, category
    )
    VALUES (
      v_org_a, 'solo', v_client_a, 8, 8, CURRENT_DATE, v_disc_b, 'group'
    );
  EXCEPTION
    WHEN OTHERS THEN
      v_caught := true;
  END;
  PERFORM _test_assert(v_caught, 'Cross-org discipline_id FK must be rejected');

  -- Valid same-org subscription succeeds
  INSERT INTO subscriptions (
    id, organization_id, type, client_id1, lessons_total, lessons_left,
    activation_date, discipline_id, category
  )
  VALUES (
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000201',
    v_org_a, 'solo', v_client_a, 8, 8, CURRENT_DATE, v_disc_a, 'group'
  )
  ON CONFLICT (id) DO NOTHING;

  -- Cross-org attendance subscription
  v_caught := false;
  BEGIN
    INSERT INTO attendance (
      organization_id, date, subscription_id, client_display, attendance_status
    )
    VALUES (
      v_org_b, CURRENT_DATE, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000201', 'Test', 'present'
    );
  EXCEPTION
    WHEN OTHERS THEN
      v_caught := true;
  END;
  PERFORM _test_assert(v_caught, 'Cross-org attendance subscription FK must be rejected');

  -- pair_month constraint: pair requires m1/m2/m3
  v_caught := false;
  BEGIN
    INSERT INTO subscriptions (
      organization_id, type, client_id1, client_id2, lessons_total, lessons_left,
      activation_date, discipline_id, category, pair_month
    )
    VALUES (
      v_org_a, 'pair', v_client_a, v_client_a, 8, 8, CURRENT_DATE, v_disc_a, 'group', ''
    );
  EXCEPTION
    WHEN check_violation THEN
      v_caught := true;
  END;
  PERFORM _test_assert(v_caught, 'pair subscription without pair_month must fail CHECK');

  RAISE NOTICE 'All v2 business schema tests passed.';
END;
$$;

ROLLBACK;
