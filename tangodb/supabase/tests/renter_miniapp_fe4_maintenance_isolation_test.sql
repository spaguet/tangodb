-- FE4: one renter failure must not block maintenance batch for others.
-- Run: psql "%DATABASE_URL%" -v ON_ERROR_STOP=1 -f supabase/tests/_hall_rent_test_jwt.sql -f supabase/tests/renter_miniapp_fe4_maintenance_isolation_test.sql

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

CREATE OR REPLACE FUNCTION _fe4_insert_slot(
  p_org uuid,
  p_renter uuid,
  p_loc uuid,
  p_date date,
  p_ts text,
  p_te text,
  p_hold timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO rentals (
    organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, hold_expires_at,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, calculated_amount, currency
  )
  VALUES (
    p_org, p_renter, p_loc, p_date, p_ts, p_te,
    'confirmed', 'miniapp', 'awaiting_payment', p_hold,
    500, 500, 0, 1000, 1000, 'RUB'
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION _fe4_purge_renter(p_renter uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM renter_booking_maintenance_failures WHERE renter_id = p_renter;
  DELETE FROM renter_reliability_events WHERE renter_id = p_renter;
  DELETE FROM renter_wallet_ledger WHERE renter_id = p_renter;
  DELETE FROM rentals WHERE renter_id = p_renter;
  DELETE FROM rental_series WHERE renter_id = p_renter;
END;
$$;

-- Test stub: force failure for FE4 bad renter; minimal expiry for others.
CREATE OR REPLACE FUNCTION _renter_expire_and_catchup(p_org_id uuid, p_renter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_renter_id = 'fe400000-0000-4000-8000-000000000141'::uuid THEN
    RAISE EXCEPTION 'fe4_test_forced_failure';
  END IF;

  UPDATE rentals r
  SET lifecycle = 'auto_deleted', updated_at = now()
  WHERE r.organization_id = p_org_id
    AND r.renter_id = p_renter_id
    AND r.channel = 'miniapp'
    AND r.lifecycle = 'awaiting_payment'
    AND (
      COALESCE(r.hold_expires_at, _renter_slot_ts(r.organization_id, r.rental_date, r.time_start)) <= now()
      OR _renter_slot_ts(r.organization_id, r.rental_date, r.time_start) <= now()
    );
END;
$$;

DO $$
DECLARE
  v_version_id uuid;
  v_org uuid := 'fe400000-0000-4000-8000-000000000101';
  v_user uuid := 'fe400000-0000-4000-8000-000000000111';
  v_member uuid := 'fe400000-0000-4000-8000-000000000121';
  v_loc uuid := 'fe400000-0000-4000-8000-0000000000aa';
  v_bad uuid := 'fe400000-0000-4000-8000-000000000141';
  v_good uuid := 'fe400000-0000-4000-8000-000000000142';
  v_tz text;
  v_result jsonb;
  v_bad_life text;
  v_good_life text;
  v_fail_count integer;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES (
    v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'fe4-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'FE4 Org', 'fe4-org', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime';

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'FE4 Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO organization_addons (organization_id, addon_code, status, period_start, period_end)
  VALUES (v_org, 'renter_miniapp', 'active', CURRENT_DATE - 1, CURRENT_DATE + 365)
  ON CONFLICT (organization_id, addon_code) DO UPDATE SET status = 'active';

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES (v_loc, v_org, 'Hall FE4', true)
  ON CONFLICT (id) DO UPDATE SET miniapp_enabled = true;

  INSERT INTO renters (id, organization_id, display_name, telegram_id, status)
  VALUES
    (v_bad, v_org, 'FE4 Bad', 97401, 'active'),
    (v_good, v_org, 'FE4 Good', 97402, 'active')
  ON CONFLICT (id) DO UPDATE SET status = 'active';

  INSERT INTO location_rental_hour_rates (organization_id, location_id, kind, price, currency, valid_from)
  VALUES
    (v_org, v_loc, 'one_time', 1000, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc, 'recurring', 800, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc, 'penalty', 1500, 'RUB', DATE '2000-01-01')
  ON CONFLICT DO NOTHING;

  v_tz := _org_timezone(v_org);

  PERFORM _test_assert(
    pg_get_functiondef('run_renter_booking_maintenance(integer)'::regprocedure)
      LIKE '%EXCEPTION%'
    AND pg_get_functiondef('run_renter_booking_maintenance(integer)'::regprocedure)
      LIKE '%_renter_record_maintenance_failure%',
    'worker has per-renter exception isolation'
  );

  PERFORM _fe4_purge_renter(v_bad);
  PERFORM _fe4_purge_renter(v_good);

  PERFORM _fe4_insert_slot(
    v_org, v_bad, v_loc,
    (now() AT TIME ZONE v_tz)::date + 2, '18:00', '19:00',
    now() - interval '2 minutes'
  );
  PERFORM _fe4_insert_slot(
    v_org, v_good, v_loc,
    (now() AT TIME ZONE v_tz)::date + 2, '19:00', '20:00',
    now() - interval '2 minutes'
  );

  v_result := run_renter_booking_maintenance(20);

  PERFORM _test_assert((v_result ->> 'processed')::int = 1, 'good renter processed despite bad renter failure');
  PERFORM _test_assert((v_result ->> 'failed')::int = 1, 'bad renter counted as failed');
  PERFORM _test_assert(
    jsonb_array_length(COALESCE(v_result -> 'failures', '[]'::jsonb)) = 1,
    'failures array has one entry'
  );
  PERFORM _test_assert(
    (v_result -> 'failures' -> 0 ->> 'renter_id')::uuid = v_bad,
    'failure entry is for bad renter'
  );

  SELECT lifecycle INTO v_bad_life FROM rentals WHERE renter_id = v_bad LIMIT 1;
  SELECT lifecycle INTO v_good_life FROM rentals WHERE renter_id = v_good LIMIT 1;
  PERFORM _test_assert(v_bad_life = 'awaiting_payment', 'bad renter slot rolled back (still awaiting)');
  PERFORM _test_assert(v_good_life = 'auto_deleted', 'good renter slot expired');

  SELECT fail_count INTO v_fail_count
  FROM renter_booking_maintenance_failures
  WHERE organization_id = v_org AND renter_id = v_bad;
  PERFORM _test_assert(v_fail_count = 1, 'retryable failure recorded for bad renter');

  PERFORM _test_assert(
    NOT EXISTS (
      SELECT 1 FROM renter_booking_maintenance_failures
      WHERE organization_id = v_org AND renter_id = v_good
    ),
    'no failure row for good renter'
  );
END;
$$;

ROLLBACK;
