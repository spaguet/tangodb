-- FA3 concurrent race setup (committed fixtures for fa3-concurrent-race.mjs).
-- Run via: node scripts/fa3-concurrent-race.mjs

CREATE OR REPLACE FUNCTION _test_fa3_hold_wallet_mutate(
  p_org uuid,
  p_renter uuid,
  p_slot uuid,
  p_debt numeric,
  p_sleep_seconds double precision DEFAULT 2
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key bigint;
BEGIN
  v_key := _renter_wallet_lock_key(p_org, p_renter);
  PERFORM pg_advisory_lock(v_key);
  IF p_debt > 0 AND p_slot IS NOT NULL THEN
    UPDATE rentals
    SET debt_amount = p_debt,
        lifecycle = CASE WHEN p_debt > 0 THEN 'debt' ELSE lifecycle END
    WHERE id = p_slot;
  END IF;
  PERFORM pg_sleep(p_sleep_seconds);
  PERFORM pg_advisory_unlock(v_key);
END;
$$;

DO $$
DECLARE
  v_version_id uuid;
  v_org uuid := 'a0f30000-0000-4000-8000-000000000001';
  v_user uuid := 'a0f30000-0000-4000-8000-000000000011';
  v_member uuid := 'a0f30000-0000-4000-8000-000000000021';
  v_loc uuid := 'a0f30000-0000-4000-8000-0000000000aa';
  v_renter uuid := 'a0f30000-0000-4000-8000-000000000041';
  v_slot uuid := 'a0f30000-0000-4000-8000-000000000062';
  v_d date;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES (
    v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'fa3-concurrent@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
    '{}'::jsonb, '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'FA3 Concurrent Org', 'fa3-concurrent', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed';

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'FA3 Concurrent Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES (v_loc, v_org, 'FA3 Concurrent Hall', true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO renters (id, organization_id, display_name, status, telegram_id)
  VALUES (v_renter, v_org, 'FA3 Concurrent Renter', 'active', 93041)
  ON CONFLICT (id) DO UPDATE SET status = 'active', booking_banned_at = NULL;

  INSERT INTO organization_addons (organization_id, addon_code, status, period_start, period_end)
  VALUES (v_org, 'renter_miniapp', 'active', CURRENT_DATE - 1, CURRENT_DATE + 365)
  ON CONFLICT (organization_id, addon_code) DO UPDATE SET status = 'active';

  INSERT INTO location_rental_hour_rates (organization_id, location_id, kind, price, currency, valid_from)
  VALUES (v_org, v_loc, 'one_time', 1000, 'RUB', DATE '2000-01-01')
  ON CONFLICT DO NOTHING;

  INSERT INTO location_rental_hour_rates (organization_id, location_id, kind, price, currency, valid_from)
  SELECT v_org, v_loc, kind, 1000, 'RUB', DATE '2000-01-01'
  FROM (VALUES ('recurring'), ('penalty')) AS k(kind)
  ON CONFLICT DO NOTHING;

  v_d := CURRENT_DATE + 10;

  DELETE FROM renter_wallet_ledger WHERE renter_id = v_renter;
  DELETE FROM rentals WHERE organization_id = v_org AND renter_id = v_renter;

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, hold_expires_at,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, currency
  )
  VALUES (
    'a0f30000-0000-4000-8000-000000000061', v_org, v_renter, v_loc, v_d, '08:00', '09:00',
    'confirmed', 'miniapp', 'active', now() + interval '5 hours',
    500, 500, 0, 1000, 'RUB'
  ),
  (
    v_slot, v_org, v_renter, v_loc, v_d, '09:00', '10:00',
    'confirmed', 'miniapp', 'active', now() + interval '5 hours',
    500, 500, 0, 1000, 'RUB'
  );

  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount)
  VALUES (v_org, v_renter, 'topup', 5000)
  ON CONFLICT DO NOTHING;
  PERFORM _renter_apply_wallet(v_org, v_renter);
END;
$$;
