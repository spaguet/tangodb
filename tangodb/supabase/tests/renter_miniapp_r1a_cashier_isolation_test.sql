-- R1a: sorted series locks + cashier write/inbox isolation from channel=miniapp.
-- Run: psql "%DATABASE_URL%" -v ON_ERROR_STOP=1 -f supabase/tests/_hall_rent_test_jwt.sql -f supabase/tests/renter_miniapp_r1a_cashier_isolation_test.sql

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
  v_org uuid := 'a1a00000-0000-4000-8000-000000000001';
  v_user uuid := 'a1a00000-0000-4000-8000-000000000011';
  v_member uuid := 'a1a00000-0000-4000-8000-000000000021';
  v_loc_a uuid := 'a1a00000-0000-4000-8000-0000000000aa';
  v_loc_b uuid := 'a1a00000-0000-4000-8000-0000000000bb';
  v_renter uuid := 'a1a00000-0000-4000-8000-000000000041';
  v_hold uuid := 'a1a00000-0000-4000-8000-000000000051';
  v_cashier uuid := 'a1a00000-0000-4000-8000-000000000052';
  v_series uuid := 'a1a00000-0000-4000-8000-000000000061';
  v_series_occ uuid := 'a1a00000-0000-4000-8000-000000000062';
  v_pairs jsonb;
  v_keys bigint[];
  v_expected bigint[];
  v_result jsonb;
  v_mini jsonb;
  v_cash jsonb;
  v_def text;
  v_item jsonb;
  v_found boolean;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES (
    v_user,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'r1a-owner@test.local',
    crypt('testpass123', gen_salt('bf')),
    now(), now(), now(),
    '{}'::jsonb,
    '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'R1a Isolation Org', 'r1a-isolation', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET
    status = 'licensed',
    owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET
    license_type = 'lifetime',
    activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'R1a Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code)
  VALUES (v_org, 'Europe/Moscow', 'RUB')
  ON CONFLICT (organization_id) DO UPDATE SET
    timezone = EXCLUDED.timezone,
    currency_code = EXCLUDED.currency_code,
    finance_period_closed_until = NULL;

  INSERT INTO locations (id, organization_id, name)
  VALUES
    (v_loc_a, v_org, 'Hall A'),
    (v_loc_b, v_org, 'Hall B')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO renters (id, organization_id, display_name)
  VALUES (v_renter, v_org, 'R1a Renter')
  ON CONFLICT (id) DO NOTHING;

  -- Sorted lock keys: (loc_a, 09-03), (loc_b, 09-01), (loc_b, 09-10) — not input order.
  v_pairs := jsonb_build_array(
    jsonb_build_object('location_id', v_loc_b, 'date', '2026-09-10'),
    jsonb_build_object('location_id', v_loc_a, 'date', '2026-09-03'),
    jsonb_build_object('location_id', v_loc_b, 'date', '2026-09-01')
  );
  v_keys := _rental_acquire_location_date_locks(v_org, v_pairs);
  v_expected := ARRAY[
    _rental_location_lock_key(v_org, v_loc_a, '2026-09-03'::date),
    _rental_location_lock_key(v_org, v_loc_b, '2026-09-01'::date),
    _rental_location_lock_key(v_org, v_loc_b, '2026-09-10'::date)
  ];
  PERFORM _test_assert(v_keys = v_expected, 'location-date locks acquired in (location_id, date) order');

  v_def := pg_get_functiondef('create_rental_series(jsonb)'::regprocedure);
  PERFORM _test_assert(
    v_def LIKE '%_rental_acquire_location_date_locks%',
    'create_rental_series uses sorted lock helper, not preview-order locks'
  );
  PERFORM _test_assert(
    v_def NOT LIKE '%pg_advisory_xact_lock%',
    'create_rental_series no longer takes advisory locks in preview-order loop'
  );

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, fixed_amount, currency, channel, lifecycle, hold_expires_at,
    prepay_amount, remainder_amount, debt_amount
  )
  VALUES (
    v_hold, v_org, v_renter, v_loc_a, current_date + 8, '12:00', '14:00',
    'confirmed', 2000, 'RUB', 'miniapp', 'awaiting_payment', now() + interval '24 hours',
    1000, 1000, 0
  )
  ON CONFLICT (id) DO UPDATE SET
    channel = 'miniapp',
    lifecycle = 'awaiting_payment',
    booking_status = 'confirmed',
    fixed_amount = 2000,
    final_amount = NULL;

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, fixed_amount, currency
  )
  VALUES (
    v_cashier, v_org, v_renter, v_loc_a, current_date + 3, '10:00', '12:00',
    'confirmed', 1500, 'RUB'
  )
  ON CONFLICT (id) DO UPDATE SET
    channel = 'cashier',
    lifecycle = NULL,
    booking_status = 'confirmed',
    fixed_amount = 1500;

  INSERT INTO rental_series (
    id, organization_id, renter_id, location_id, tariff_id,
    valid_from, valid_to, status, channel
  )
  VALUES (
    v_series, v_org, v_renter, v_loc_a, NULL,
    current_date + 7, current_date + 34, 'active', 'miniapp'
  )
  ON CONFLICT (id) DO UPDATE SET
    channel = 'miniapp',
    tariff_id = NULL,
    status = 'active';

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, fixed_amount, currency, channel, lifecycle, rental_series_id,
    hold_expires_at, prepay_amount, remainder_amount, debt_amount
  )
  VALUES (
    v_series_occ, v_org, v_renter, v_loc_a, current_date + 7, '16:00', '18:00',
    'confirmed', 1800, 'RUB', 'miniapp', 'active', v_series,
    now() + interval '24 hours', 900, 900, 0
  )
  ON CONFLICT (id) DO UPDATE SET
    channel = 'miniapp',
    lifecycle = 'active',
    rental_series_id = v_series,
    booking_status = 'confirmed';

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');

  v_result := create_rental(jsonb_build_object(
    'channel', 'miniapp',
    'renter_id', v_renter,
    'location_id', v_loc_a,
    'rental_date', (current_date + 10)::text,
    'time_start', '12:00',
    'time_end', '13:00'
  ));
  PERFORM _test_assert(
    (v_result ->> 'success')::boolean IS NOT TRUE
      AND v_result ->> 'error' = 'schedule.rental.miniappChannelForbidden',
    'create_rental payload channel=miniapp rejected'
  );

  v_result := create_rental_series(jsonb_build_object('channel', 'miniapp'));
  PERFORM _test_assert(
    (v_result ->> 'success')::boolean IS NOT TRUE
      AND v_result ->> 'error' = 'schedule.rental.miniappChannelForbidden',
    'create_rental_series payload channel=miniapp rejected'
  );

  v_result := cancel_rental(v_hold, 'cashier cancel');
  PERFORM _test_assert(
    (v_result ->> 'success')::boolean IS NOT TRUE
      AND v_result ->> 'error' = 'schedule.rental.miniappChannelForbidden',
    'cancel_rental on miniapp rejected'
  );
  PERFORM _test_assert(
    (SELECT booking_status FROM rentals WHERE id = v_hold) = 'confirmed',
    'miniapp hold still confirmed after cashier cancel refusal'
  );

  v_result := update_rental(v_hold, jsonb_build_object('purpose', 'reschedule bypass'));
  PERFORM _test_assert(
    (v_result ->> 'success')::boolean IS NOT TRUE
      AND v_result ->> 'error' = 'schedule.rental.miniappChannelForbidden',
    'update_rental on miniapp rejected (reschedule too)'
  );

  v_result := record_rental_payment(v_hold, 100, 'cash');
  PERFORM _test_assert(
    (v_result ->> 'success')::boolean IS NOT TRUE
      AND v_result ->> 'error' = 'schedule.rental.miniappChannelForbidden',
    'record_rental_payment on miniapp rejected'
  );

  v_result := apply_rental_pricing_adjustment(v_hold, 500, 'cashier amount edit');
  PERFORM _test_assert(
    (v_result ->> 'success')::boolean IS NOT TRUE
      AND v_result ->> 'error' = 'schedule.rental.miniappChannelForbidden',
    'apply_rental_pricing_adjustment on miniapp rejected'
  );

  v_result := update_rental_series(v_series, jsonb_build_object('purpose', 'x'), 'all');
  PERFORM _test_assert(
    (v_result ->> 'success')::boolean IS NOT TRUE
      AND v_result ->> 'error' = 'schedule.rental.miniappChannelForbidden',
    'update_rental_series on miniapp series rejected'
  );

  v_result := cancel_rental_series_occurrence(v_series, current_date + 7, 'cashier occ cancel');
  PERFORM _test_assert(
    (v_result ->> 'success')::boolean IS NOT TRUE
      AND v_result ->> 'error' = 'schedule.rental.miniappChannelForbidden',
    'cancel_rental_series_occurrence on miniapp series rejected'
  );

  PERFORM _test_assert(
    _renter_debt_total(v_renter, v_org) = 1500,
    '_renter_debt_total is cashier unpaid only (miniapp hold excluded)'
  );

  v_result := list_rental_payment_inbox('unpaid', NULL, NULL, v_renter, NULL, NULL, 50, 0);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'list_rental_payment_inbox success');
  v_found := false;
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(v_result -> 'items', '[]'::jsonb))
  LOOP
    IF (v_item ->> 'rental_id') = v_hold::text THEN
      v_found := true;
    END IF;
  END LOOP;
  PERFORM _test_assert(NOT v_found, 'miniapp hold is not in cashier unpaid inbox');

  v_found := false;
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(v_result -> 'items', '[]'::jsonb))
  LOOP
    IF (v_item ->> 'rental_id') = v_cashier::text THEN
      v_found := true;
    END IF;
  END LOOP;
  PERFORM _test_assert(v_found, 'cashier unpaid slot remains in inbox');

  PERFORM _test_assert(
    NOT EXISTS (
      SELECT 1 FROM financial_debtors_v
      WHERE rental_id = v_hold AND organization_id = v_org
    ),
    'miniapp hold is not a financial_debtors_v rental row'
  );
  PERFORM _test_assert(
    EXISTS (
      SELECT 1 FROM financial_debtors_v
      WHERE rental_id = v_cashier AND organization_id = v_org AND kind = 'rental'
    ),
    'cashier unpaid rental remains in financial_debtors_v'
  );

  v_result := list_renter_rentals(v_renter);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'list_renter_rentals success');
  PERFORM _test_assert(
    jsonb_array_length(v_result -> 'rentals') >= 2,
    'list_renter_rentals keeps Mini App rows visible'
  );

  SELECT value INTO v_mini
  FROM jsonb_array_elements(v_result -> 'rentals')
  WHERE value ->> 'id' = v_hold::text;
  PERFORM _test_assert(v_mini IS NOT NULL, 'miniapp row present on renter card list');
  PERFORM _test_assert(v_mini ->> 'channel' = 'miniapp', 'list exposes channel=miniapp');
  PERFORM _test_assert(v_mini ->> 'lifecycle' = 'awaiting_payment', 'list exposes lifecycle');
  PERFORM _test_assert(v_mini ->> 'paid_amount' IS NULL, 'miniapp paid_amount is NULL not 0');
  PERFORM _test_assert(v_mini ->> 'payment_status' IS NULL, 'miniapp payment_status is NULL not unpaid');
  PERFORM _test_assert(
    (v_mini -> 'paid_amount') = 'null'::jsonb,
    'miniapp paid_amount JSON null (key present, not omitted unpaid 0)'
  );

  SELECT value INTO v_cash
  FROM jsonb_array_elements(v_result -> 'rentals')
  WHERE value ->> 'id' = v_cashier::text;
  PERFORM _test_assert(v_cash ->> 'channel' = 'cashier', 'cashier row still has channel=cashier');
  PERFORM _test_assert(v_cash ->> 'lifecycle' IS NULL, 'cashier lifecycle stays NULL');
  PERFORM _test_assert(v_cash ->> 'payment_status' = 'unpaid', 'cashier payment_status unpaid as before');
  PERFORM _test_assert((v_cash ->> 'paid_amount')::numeric = 0, 'cashier paid_amount 0 as before');
  PERFORM _test_assert((v_cash ->> 'fixed_amount')::numeric = 1500, 'cashier list still uses effective amount');

  v_result := get_renter_detail(v_renter);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'get_renter_detail success');
  PERFORM _test_assert(
    (v_result -> 'finance' ->> 'debt_total')::numeric = 1500,
    'get_renter_detail finance debt is cashier only'
  );
  PERFORM _test_assert(
    (v_result -> 'finance' ->> 'fixed_total')::numeric = 1500,
    'get_renter_detail finance fixed_total ignores miniapp cost'
  );
  PERFORM _test_assert(
    (v_result -> 'rental_counts' ->> 'upcoming')::int >= 2,
    'get_renter_detail still counts Mini App slots in rental_counts'
  );

  RAISE NOTICE 'renter_miniapp_r1a_cashier_isolation_test: OK';
END;
$$;

ROLLBACK;
