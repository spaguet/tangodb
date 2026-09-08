-- Cancelled Mini App bookings and retired/cancelled group slots must leave occupancy + list_mine.
-- Run: npm run test:db:renter-miniapp-occupancy-cancel

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

CREATE OR REPLACE FUNCTION _occ_set_renter_jwt(p_user uuid, p_org uuid, p_telegram bigint)
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
  v_org uuid := 'c0cc0000-0000-4000-8000-000000000001';
  v_user uuid := 'c0cc0000-0000-4000-8000-000000000011';
  v_member uuid := 'c0cc0000-0000-4000-8000-000000000021';
  v_renter_user uuid := 'c0cc0000-0000-4000-8000-000000000013';
  v_loc uuid := 'c0cc0000-0000-4000-8000-0000000000aa';
  v_renter uuid := 'c0cc0000-0000-4000-8000-000000000041';
  v_live uuid := 'c0cc0000-0000-4000-8000-0000000000b1';
  v_cancelled uuid := 'c0cc0000-0000-4000-8000-0000000000b2';
  v_to_cancel uuid := 'c0cc0000-0000-4000-8000-0000000000b3';
  v_retired_slot uuid := 'c0cc0000-0000-4000-8000-0000000000c1';
  v_live_slot uuid := 'c0cc0000-0000-4000-8000-0000000000c2';
  v_occ_date date;
  v_dow integer;
  v_win record;
  v_result jsonb;
  v_cancel jsonb;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES
    (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'occ-hide-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_renter_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'occ-hide-renter@users.invalid', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
     jsonb_build_object('actor', 'renter', 'organization_id', v_org::text, 'telegram_id', '91041'),
     '{}'::jsonb)
  ON CONFLICT (id) DO UPDATE SET raw_app_meta_data = EXCLUDED.raw_app_meta_data;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'Occupancy Hide Org', 'occ-hide-cancelled', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime', activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'Occ Hide Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO UPDATE SET timezone = EXCLUDED.timezone;

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES (v_loc, v_org, 'Hall Occ', true)
  ON CONFLICT (id) DO UPDATE SET miniapp_enabled = EXCLUDED.miniapp_enabled;

  DELETE FROM location_rental_hour_rates WHERE organization_id = v_org;
  INSERT INTO location_rental_hour_rates (organization_id, location_id, kind, price, currency, valid_from)
  VALUES
    (v_org, v_loc, 'one_time', 1000, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc, 'recurring', 800, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc, 'penalty', 1500, 'RUB', DATE '2000-01-01');

  INSERT INTO renters (id, organization_id, display_name, telegram_id, status)
  VALUES (v_renter, v_org, 'Occ Hide Renter', 91041, 'active')
  ON CONFLICT (id) DO UPDATE SET telegram_id = EXCLUDED.telegram_id, status = 'active';

  SELECT * INTO v_win FROM _renter_occupancy_window(v_org);
  v_occ_date := GREATEST(_org_local_date(v_org) + 2, v_win.window_start);
  IF v_occ_date > v_win.window_end THEN
    v_occ_date := v_win.window_end;
  END IF;
  v_dow := EXTRACT(ISODOW FROM v_occ_date)::integer;

  DELETE FROM schedule_occurrence_cancellations WHERE organization_id = v_org;
  DELETE FROM schedule_slots WHERE organization_id = v_org;
  DELETE FROM rentals WHERE organization_id = v_org;

  INSERT INTO schedule_slots (
    id, organization_id, day_of_week, time, time_end, location_id,
    group_name, valid_from, valid_to
  )
  VALUES (
    v_retired_slot, v_org, v_dow, '20:00', '21:00', v_loc,
    'Retired Group', v_occ_date, v_occ_date
  );

  INSERT INTO schedule_slots (
    id, organization_id, day_of_week, time, time_end, location_id,
    group_name, valid_from, valid_to
  )
  VALUES (
    v_live_slot, v_org, v_dow, '10:00', '11:00', v_loc,
    'Live Group', v_win.window_start, NULL
  );

  INSERT INTO schedule_occurrence_cancellations (
    organization_id, slot_id, occurrence_date, time, time_end, location_id, group_name
  )
  VALUES (v_org, v_live_slot, v_occ_date, '10:00', '11:00', v_loc, 'Live Group');

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, currency,
    cancelled_at, cancelled_reason
  )
  VALUES
    (
      v_live, v_org, v_renter, v_loc, v_occ_date, '14:00', '15:00',
      'confirmed', 'miniapp', 'active',
      500, 500, 0, 1000, 'RUB',
      NULL, NULL
    ),
    (
      v_cancelled, v_org, v_renter, v_loc, v_occ_date, '16:00', '17:00',
      'cancelled', 'miniapp', 'cancelled',
      500, 500, 0, 1000, 'RUB',
      now(), 'miniapp_cancel'
    ),
    (
      v_to_cancel, v_org, v_renter, v_loc, v_occ_date, '18:00', '19:00',
      'confirmed', 'miniapp', 'active',
      500, 500, 0, 1000, 'RUB',
      NULL, NULL
    );

  PERFORM _occ_set_renter_jwt(v_renter_user, v_org, 91041);

  v_result := renter_get_occupancy(v_loc);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'occupancy ok: ' || COALESCE(v_result ->> 'error', 'ok'));

  PERFORM _test_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_result -> 'mine') m
      WHERE m ->> 'id' = v_live::text
    ),
    'live booking stays in occupancy.mine'
  );
  PERFORM _test_assert(
    NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_result -> 'mine') m
      WHERE m ->> 'id' = v_cancelled::text
    ),
    'cancelled booking must leave occupancy.mine'
  );
  PERFORM _test_assert(
    NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_result -> 'busy') b
      WHERE b ->> 'date' = v_occ_date::text
        AND b ->> 'time_start' = '20:00'
    ),
    'retired group slot must not appear in occupancy.busy'
  );
  PERFORM _test_assert(
    NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_result -> 'busy') b
      WHERE b ->> 'date' = v_occ_date::text
        AND b ->> 'time_start' = '10:00'
    ),
    'cancelled group occurrence must not appear in occupancy.busy'
  );
  PERFORM _test_assert(
    NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_result -> 'busy') b
      WHERE b ->> 'date' = v_occ_date::text
        AND b ->> 'time_start' = '16:00'
    ),
    'cancelled rental must not occupy occupancy.busy'
  );

  v_result := renter_list_mine(20, 0);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'list_mine ok: ' || COALESCE(v_result ->> 'error', 'ok'));
  PERFORM _test_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_result -> 'items') i
      WHERE i ->> 'id' = v_live::text
    ),
    'live booking stays in list_mine'
  );
  PERFORM _test_assert(
    NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_result -> 'items') i
      WHERE i ->> 'id' = v_cancelled::text
    ),
    'cancelled booking must leave list_mine'
  );

  v_cancel := renter_cancel_occurrence(v_to_cancel);
  PERFORM _test_assert(
    (v_cancel ->> 'success')::boolean,
    'renter cancel succeeds: ' || COALESCE(v_cancel ->> 'error', 'ok')
  );

  v_result := renter_get_occupancy(v_loc);
  PERFORM _test_assert(
    NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_result -> 'mine') m
      WHERE m ->> 'id' = v_to_cancel::text
    ),
    'cancelled occurrence leaves occupancy.mine immediately'
  );

  v_result := renter_list_mine(20, 0);
  PERFORM _test_assert(
    NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_result -> 'items') i
      WHERE i ->> 'id' = v_to_cancel::text
    ),
    'cancelled occurrence leaves list_mine immediately'
  );

  RAISE NOTICE 'renter_miniapp_occupancy_hide_cancelled_test: all assertions passed';
END;
$$;

ROLLBACK;
