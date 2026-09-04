-- FA7 / §9: committed fixtures for parallel same-key staff-topup race.
-- Run via: node scripts/fa2-concurrent-topup.mjs (after JWT helper).

CREATE OR REPLACE FUNCTION _test_fa7_parallel_topup_sql(p_key uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM _hall_rent_test_set_jwt(
    'fa700000-0000-4000-8000-000000000011'::uuid,
    'fa700000-0000-4000-8000-000000000001'::uuid,
    'fa700000-0000-4000-8000-000000000021'::uuid,
    'owner'
  );

  v_result := staff_renter_wallet_topup(jsonb_build_object(
    'renter_id', 'fa700000-0000-4000-8000-000000000041',
    'amount', 250,
    'method', 'cash',
    'idempotency_key', p_key
  ));

  RETURN v_result;
END;
$$;

DO $$
DECLARE
  v_version_id uuid;
  v_org uuid := 'fa700000-0000-4000-8000-000000000001';
  v_user uuid := 'fa700000-0000-4000-8000-000000000011';
  v_member uuid := 'fa700000-0000-4000-8000-000000000021';
  v_renter uuid := 'fa700000-0000-4000-8000-000000000041';
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES (
    v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'fa7-parallel@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
    '{}'::jsonb, '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'FA7 Parallel Topup Org', 'fa7-parallel-topup', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime', activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'FA7 Parallel Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO UPDATE SET
    timezone = EXCLUDED.timezone,
    currency_code = EXCLUDED.currency_code;

  INSERT INTO renters (id, organization_id, display_name, status)
  VALUES (v_renter, v_org, 'FA7 Parallel Topup Renter', 'active')
  ON CONFLICT (id) DO UPDATE SET status = 'active', booking_banned_at = NULL;

  INSERT INTO organization_addons (organization_id, addon_code, status, period_start, period_end)
  VALUES (v_org, 'renter_miniapp', 'active', CURRENT_DATE - 1, CURRENT_DATE + 365)
  ON CONFLICT (organization_id, addon_code) DO UPDATE SET
    status = 'active', period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end;

  DELETE FROM renter_wallet_ledger WHERE renter_id = v_renter;
  DELETE FROM rental_advances WHERE renter_id = v_renter;
  DELETE FROM operation_idempotency
  WHERE organization_id = v_org AND scope = 'staff_renter_wallet_topup';
END;
$$;
