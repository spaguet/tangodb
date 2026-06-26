-- TangoDB v2 Phase 1A-L — access key activation + lifecycle tests
-- Run: psql $DATABASE_URL -f supabase/tests/v2_access_key_test.sql

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

CREATE OR REPLACE FUNCTION _test_hash(p_plaintext text)
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN encode(hmac(p_plaintext::bytea, 'test-pepper-local'::bytea, 'sha256'), 'hex');
END;
$$;

DO $$
DECLARE
  v_version_id uuid;
  v_user_id uuid := '44444444-4444-4444-4444-444444444444';
  v_other_user uuid := '55555555-5555-5555-5555-555555555555';
  v_demo_hash text := _test_hash('TDB-DEMO-TEST-0001');
  v_life_hash text := _test_hash('TDB-LIFE-TEST-0001');
  v_result jsonb;
  v_org_id uuid;
  v_key_status text;
  v_org_status text;
  v_purge_at timestamptz;
  v_purge_user uuid := '66666666-6666-6666-6666-666666666666';
  v_purge_demo_hash text := _test_hash('TDB-DEMO-PURGE-0001');
  v_purge_org_id uuid;
  v_client_count int;
  v_retention_count int;
  v_demo_expires timestamptz;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES
    (v_user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'demo-user@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()),
    (v_other_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO access_keys (key_hash, key_type, status, crm_version_id, email)
  VALUES
    (v_demo_hash, 'demo', 'pending', v_version_id, 'demo-user@test.local'),
    (v_life_hash, 'lifetime', 'pending', v_version_id, NULL);

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user_id::text)::text,
    true
  );

  v_result := activate_access_key(v_demo_hash, 'Demo Test Org');
  v_org_id := (v_result ->> 'organization_id')::uuid;

  PERFORM _test_assert(v_result ->> 'key_type' = 'demo', 'demo activation key_type');
  PERFORM _test_assert(v_result ->> 'status' = 'demo_active', 'demo activation status');

  SELECT status INTO v_key_status FROM access_keys WHERE key_hash = v_demo_hash;
  PERFORM _test_assert(v_key_status = 'active', 'demo key status active after activation');

  SELECT status, data_purge_at INTO v_org_status, v_purge_at FROM organizations WHERE id = v_org_id;
  PERFORM _test_assert(v_org_status = 'demo_active', 'org demo_active');
  PERFORM _test_assert(v_purge_at IS NOT NULL, 'org data_purge_at set for demo');

  -- Wrong email must fail
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_other_user::text)::text,
    true
  );

  BEGIN
    PERFORM activate_access_key(_test_hash('TDB-DEMO-OTHER-0001'), 'Fail Org');
    PERFORM _test_assert(false, 'wrong email demo activation must fail');
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%invalid access key%' THEN
        RAISE;
      END IF;
  END;

  -- Duplicate demo email request blocked by unique index
  BEGIN
    INSERT INTO access_keys (key_hash, key_type, status, crm_version_id, email)
    VALUES (_test_hash('TDB-DEMO-DUP-0001'), 'demo', 'pending', v_version_id, 'demo-user@test.local');
    PERFORM _test_assert(false, 'duplicate demo email must fail');
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;

  -- Lifetime upgrade preserves org and clears purge
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user_id::text)::text,
    true
  );

  v_result := activate_access_key(v_life_hash, 'Ignored Name');
  PERFORM _test_assert((v_result ->> 'organization_id')::uuid = v_org_id, 'lifetime upgrade same org');
  PERFORM _test_assert((v_result ->> 'upgraded')::boolean = true, 'lifetime upgrade flag');
  PERFORM _test_assert(v_result ->> 'status' = 'licensed', 'lifetime upgrade licensed');

  SELECT status, data_purge_at INTO v_org_status, v_purge_at FROM organizations WHERE id = v_org_id;
  PERFORM _test_assert(v_org_status = 'licensed', 'org licensed after upgrade');
  PERFORM _test_assert(v_purge_at IS NULL, 'data_purge_at cleared after lifetime upgrade');

  SELECT status INTO v_key_status FROM access_keys WHERE key_hash = v_life_hash;
  PERFORM _test_assert(v_key_status = 'consumed', 'lifetime key consumed');

  PERFORM _test_assert(
    EXISTS (SELECT 1 FROM organization_licenses WHERE organization_id = v_org_id),
    'organization_licenses row created'
  );

  -- S5: strict 30-day purge on separate demo org (licensed org above must not be purged)
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    v_purge_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'purge-user@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO access_keys (key_hash, key_type, status, crm_version_id, email)
  VALUES (v_purge_demo_hash, 'demo', 'pending', v_version_id, 'purge-user@test.local');

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_purge_user::text)::text,
    true
  );

  v_result := activate_access_key(v_purge_demo_hash, 'Purge Test Org');
  v_purge_org_id := (v_result ->> 'organization_id')::uuid;

  SELECT demo_expires_at, data_purge_at
  INTO v_demo_expires, v_purge_at
  FROM organizations
  WHERE id = v_purge_org_id;

  PERFORM _test_assert(v_demo_expires IS NOT NULL, 'purge demo demo_expires_at set');
  PERFORM _test_assert(v_purge_at = v_demo_expires, 'data_purge_at equals demo_expires_at (strict 30d)');

  INSERT INTO clients (organization_id, first_name, last_name)
  VALUES (v_purge_org_id, 'Purge', 'Client');

  UPDATE organizations
  SET demo_expires_at = now() - interval '1 hour',
      data_purge_at = now() - interval '1 hour'
  WHERE id = v_purge_org_id;

  v_result := run_demo_lifecycle();
  PERFORM _test_assert((v_result ->> 'transitioned_to_retention')::int = 0, 'no demo_retention transition');

  SELECT status INTO v_org_status FROM organizations WHERE id = v_purge_org_id;
  PERFORM _test_assert(v_org_status = 'demo_active', 'expired demo stays demo_active until purge');

  v_result := purge_expired_demo_organizations();
  PERFORM _test_assert((v_result ->> 'purged_count')::int >= 1, 'purge removes expired demo org');

  PERFORM _test_assert(
    NOT EXISTS (SELECT 1 FROM organizations WHERE id = v_purge_org_id),
    'org row deleted after purge'
  );

  SELECT count(*) INTO v_client_count FROM clients WHERE organization_id = v_purge_org_id;
  PERFORM _test_assert(v_client_count = 0, 'clients deleted after purge');

  SELECT count(*) INTO v_retention_count
  FROM demo_owner_retention
  WHERE owner_email_hash = owner_email_hash('purge-user@test.local')
    AND purged_at IS NOT NULL;

  PERFORM _test_assert(v_retention_count >= 1, 'demo_owner_retention record after purge');

  SELECT status INTO v_key_status FROM access_keys WHERE key_hash = v_purge_demo_hash;
  PERFORM _test_assert(v_key_status = 'consumed', 'demo key consumed after purge');

  RAISE NOTICE 'v2 access key tests passed';
END;
$$;

DROP FUNCTION _test_assert(boolean, text);
DROP FUNCTION _test_hash(text);

ROLLBACK;
