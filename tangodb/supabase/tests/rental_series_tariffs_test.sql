-- rental_series_tariffs RPC tests (CRM scenario 14 / Prompt 14)
-- Run: psql $DATABASE_URL -f supabase/tests/rental_series_tariffs_test.sql

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
  v_org uuid := 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  v_user uuid := '66666666-6666-6666-6666-666666666666';
  v_member uuid := 'ffffffff-ffff-ffff-ffff-ffffffffff01';
  v_loc uuid := 'ffffffff-ffff-ffff-ffff-000000000201';
  v_renter uuid := 'ffffffff-ffff-ffff-ffff-000000000301';
  v_tariff_hourly uuid := 'ffffffff-ffff-ffff-ffff-000000000401';
  v_tariff_fixed uuid := 'ffffffff-ffff-ffff-ffff-000000000402';
  v_series uuid;
  v_result jsonb;
  v_count integer;
  v_rental_count integer;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    v_user,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'rental-series@test.local',
    crypt('testpass123', gen_salt('bf')),
    now(),
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'Rental Series Org', 'rental-series', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'Owner Rental')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone)
  VALUES (v_org, 'Europe/Moscow')
  ON CONFLICT (organization_id) DO UPDATE SET timezone = EXCLUDED.timezone;

  INSERT INTO locations (id, organization_id, name)
  VALUES (v_loc, v_org, 'Small Hall')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO renters (id, organization_id, display_name)
  VALUES (v_renter, v_org, 'Yoga School')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO rental_tariffs (id, organization_id, name, tariff_type, location_id, price, currency, min_duration_minutes, rounding_step_minutes, status)
  VALUES
    (v_tariff_hourly, v_org, 'Hourly Small Hall', 'hourly', v_loc, 500, 'RUB', 60, 60, 'active'),
    (v_tariff_fixed, v_org, 'Fixed Event', 'fixed', v_loc, 3000, 'RUB', 0, 1, 'active')
  ON CONFLICT (id) DO NOTHING;

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  PERFORM set_active_organization(v_org);

  -- Preview series: Tue+Thu 08:00-10:00 for 3 months
  v_result := preview_rental_series(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc,
    'tariff_id', v_tariff_hourly,
    'valid_from', '2026-01-06',
    'valid_to', '2026-03-31',
    'patterns', jsonb_build_array(
      jsonb_build_object('days_of_week', ARRAY[2, 4], 'time_start', '08:00', 'time_end', '10:00')
    )
  ));

  PERFORM _test_assert(COALESCE((v_result ->> 'success')::boolean, false), 'preview should succeed');
  PERFORM _test_assert(jsonb_array_length(v_result -> 'occurrences') > 20, 'preview should have many occurrences');

  -- Create series atomically
  v_result := create_rental_series(jsonb_build_object(
    'idempotency_key', 'test-series-yoga-2026-q1',
    'renter_id', v_renter,
    'location_id', v_loc,
    'tariff_id', v_tariff_hourly,
    'valid_from', '2026-01-06',
    'valid_to', '2026-03-31',
    'purpose', 'Yoga classes',
    'patterns', jsonb_build_array(
      jsonb_build_object('days_of_week', ARRAY[2, 4], 'time_start', '08:00', 'time_end', '10:00')
    )
  ));

  PERFORM _test_assert(COALESCE((v_result ->> 'success')::boolean, false), 'create series should succeed');
  v_series := (v_result ->> 'series_id')::uuid;

  SELECT count(*) INTO v_rental_count
  FROM rentals r
  WHERE r.organization_id = v_org
    AND r.rental_series_id = v_series
    AND r.booking_status = 'confirmed';

  PERFORM _test_assert(v_rental_count > 20, 'series should create confirmed rentals');

  SELECT count(*) INTO v_count
  FROM rentals r
  WHERE r.organization_id = v_org
    AND r.rental_series_id = v_series
    AND r.calculated_amount IS NOT NULL
    AND r.tariff_snapshot IS NOT NULL;

  PERFORM _test_assert(v_count = v_rental_count, 'each rental should have pricing snapshot');

  -- Idempotent create
  v_result := create_rental_series(jsonb_build_object(
    'idempotency_key', 'test-series-yoga-2026-q1',
    'renter_id', v_renter,
    'location_id', v_loc,
    'tariff_id', v_tariff_hourly,
    'valid_from', '2026-01-06',
    'valid_to', '2026-03-31',
    'patterns', jsonb_build_array(
      jsonb_build_object('days_of_week', ARRAY[2, 4], 'time_start', '08:00', 'time_end', '10:00')
    )
  ));

  PERFORM _test_assert(COALESCE((v_result ->> 'already_applied')::boolean, false), 'idempotent create should return already_applied');

  -- Cancel single occurrence
  v_result := cancel_rental_series_occurrence(
    v_series,
    date '2026-01-08',
    'Holiday',
    'none',
    NULL
  );

  PERFORM _test_assert(COALESCE((v_result ->> 'success')::boolean, false), 'cancel occurrence should succeed');

  SELECT booking_status INTO v_count
  FROM rentals r
  WHERE r.organization_id = v_org
    AND r.rental_series_id = v_series
    AND r.rental_date = date '2026-01-08';

  PERFORM _test_assert(v_count::text = 'cancelled', 'cancelled date should be cancelled rental');

  SELECT count(*) INTO v_count
  FROM rentals r
  WHERE r.organization_id = v_org
    AND r.rental_series_id = v_series
    AND r.booking_status = 'confirmed';

  PERFORM _test_assert(v_count = v_rental_count - 1, 'other occurrences remain confirmed');

  -- Fixed tariff one-off rental
  v_result := create_rental(jsonb_build_object(
    'idempotency_key', 'test-fixed-rental-1',
    'rental_date', '2026-02-15',
    'time_start', '14:00',
    'time_end', '18:00',
    'location_id', v_loc,
    'renter_id', v_renter,
    'tariff_id', v_tariff_fixed,
    'purpose', 'Monthly gathering'
  ));

  PERFORM _test_assert(COALESCE((v_result ->> 'success')::boolean, false), 'fixed tariff rental should succeed');

  SELECT fixed_amount INTO v_count
  FROM rentals r
  WHERE r.organization_id = v_org
    AND r.idempotency_key = 'test-fixed-rental-1';

  PERFORM _test_assert(v_count::numeric = 3000, 'fixed tariff should set amount to 3000');

  RAISE NOTICE 'All rental series tariffs tests passed.';
END;
$$;

ROLLBACK;
