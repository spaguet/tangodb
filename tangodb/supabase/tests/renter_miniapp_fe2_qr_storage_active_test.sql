-- FE2 / P1-24: renter cannot Storage-SELECT inactive or replaced QR; staff can read inactive.
-- Run: psql "%DATABASE_URL%" -v ON_ERROR_STOP=1 -f supabase/tests/_hall_rent_test_jwt.sql -f supabase/tests/renter_miniapp_fe2_qr_storage_active_test.sql

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

CREATE OR REPLACE FUNCTION _fe2_set_renter_jwt(p_user uuid, p_org uuid, p_telegram bigint)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', p_user::text,
      'role', 'authenticated',
      'app_metadata', json_build_object(
        'actor', 'renter',
        'organization_id', p_org::text,
        'telegram_id', p_telegram::text
      )
    )::text,
    true
  );
END;
$$;

DO $$
DECLARE
  v_version_id uuid;
  v_org uuid := 'fe200000-0000-4000-8000-000000000101';
  v_user uuid := 'fe200000-0000-4000-8000-000000000111';
  v_renter_user uuid := 'fe200000-0000-4000-8000-000000000112';
  v_member uuid := 'fe200000-0000-4000-8000-000000000121';
  v_renter uuid := 'fe200000-0000-4000-8000-000000000141';
  v_active_qr uuid := 'fe200000-0000-4000-8000-000000000201';
  v_inactive_qr uuid := 'fe200000-0000-4000-8000-000000000202';
  v_replaced_qr uuid := 'fe200000-0000-4000-8000-000000000203';
  v_active_path text;
  v_inactive_path text;
  v_replaced_path text;
  v_readable boolean;
  v_list jsonb;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES
    (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'fe2-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_renter_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'fe2-renter@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'FE2 Org', 'fe2-org', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime';

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'FE2 Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO renters (id, organization_id, display_name, status, telegram_id)
  VALUES (v_renter, v_org, 'FE2 Renter', 'active', 97201)
  ON CONFLICT (organization_id, id) DO UPDATE SET telegram_id = 97201, status = 'active';

  v_active_path := v_org::text || '/' || v_active_qr::text;
  v_inactive_path := v_org::text || '/' || v_inactive_qr::text;
  v_replaced_path := v_org::text || '/' || v_replaced_qr::text;

  INSERT INTO organization_rental_qr_assets (
    id, organization_id, storage_path, mime_type, file_size, label, is_active, created_by
  )
  VALUES
    (v_active_qr, v_org, v_active_path, 'image/png', 1024, 'Active QR', true, v_member),
    (v_inactive_qr, v_org, v_inactive_path, 'image/png', 1024, 'Inactive QR', false, v_member),
    (v_replaced_qr, v_org, v_replaced_path, 'image/png', 1024, 'Replaced QR', false, v_member)
  ON CONFLICT (id) DO UPDATE SET
    storage_path = EXCLUDED.storage_path,
    is_active = EXCLUDED.is_active,
    label = EXCLUDED.label;

  PERFORM _fe2_set_renter_jwt(v_renter_user, v_org, 97201);

  v_readable := _org_rental_qr_storage_readable(v_active_path);
  PERFORM _test_assert(v_readable, 'renter should read active QR storage object');

  v_readable := _org_rental_qr_storage_readable(v_inactive_path);
  PERFORM _test_assert(NOT v_readable, 'renter must not read inactive QR storage object');

  v_readable := _org_rental_qr_storage_readable(v_replaced_path);
  PERFORM _test_assert(NOT v_readable, 'renter must not read replaced (deactivated) QR storage object');

  v_list := renter_list_active_qr();
  PERFORM _test_assert(v_list ->> 'success' = 'true', 'renter_list_active_qr should succeed');
  PERFORM _test_assert(
    jsonb_array_length(COALESCE(v_list -> 'assets', '[]'::jsonb)) = 1,
    'renter_list_active_qr returns only one active asset'
  );
  PERFORM _test_assert(
    (v_list -> 'assets' -> 0 ->> 'id') = v_active_qr::text,
    'active asset id in list'
  );
  PERFORM _test_assert(
    COALESCE((v_list ->> 'expires_in')::integer, 0) = 300,
    'renter_list_active_qr expires_in should be 300'
  );

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');

  v_readable := _org_rental_qr_storage_readable(v_inactive_path);
  PERFORM _test_assert(v_readable, 'staff should read inactive QR for inbox/history');

  v_readable := _org_rental_qr_storage_readable(v_replaced_path);
  PERFORM _test_assert(v_readable, 'staff should read replaced QR storage object');
END;
$$;

ROLLBACK;
