-- FB4 / P1-06, P1-07: hold cooldown same date only; pack cancel guards + read-model flags.
-- Run: npm run test:db:renter-miniapp-fb4

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

CREATE OR REPLACE FUNCTION _fb4_set_renter_jwt(p_user uuid, p_org uuid, p_telegram bigint)
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
        'renter_id', '00000000-0000-4000-8000-00000000dead',
        'telegram_id', p_telegram::text
      )
    )::text,
    true
  );
END;
$$;

CREATE OR REPLACE FUNCTION _fb4_slot_at(p_org uuid, p_ahead interval)
RETURNS TABLE (d date, ts text, te text)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_local timestamp;
  v_tz text;
BEGIN
  v_tz := _org_timezone(p_org);
  v_local := date_trunc('hour', (now() AT TIME ZONE v_tz) + p_ahead);
  IF EXTRACT(MINUTE FROM ((now() AT TIME ZONE v_tz) + p_ahead)) > 0 THEN
    v_local := v_local + interval '1 hour';
  END IF;
  IF EXTRACT(HOUR FROM v_local) >= 22 THEN
    v_local := date_trunc('day', v_local) + interval '1 day' + interval '18 hours';
  END IF;
  IF EXTRACT(HOUR FROM v_local) < 8 THEN
    v_local := date_trunc('day', v_local) + interval '18 hours';
  END IF;
  d := v_local::date;
  ts := to_char(v_local, 'HH24:MI');
  te := to_char(v_local + interval '1 hour', 'HH24:MI');
  RETURN NEXT;
END;
$$;

DO $$
DECLARE
  v_version_id uuid;
  v_org uuid := 'fb400000-0000-4000-8000-000000000001';
  v_user uuid := 'fb400000-0000-4000-8000-000000000011';
  v_member uuid := 'fb400000-0000-4000-8000-000000000021';
  v_renter_user uuid := 'fb400000-0000-4000-8000-000000000013';
  v_loc uuid := 'fb400000-0000-4000-8000-0000000000aa';
  v_renter uuid := 'fb400000-0000-4000-8000-000000000041';
  v_series uuid := 'fb400000-0000-4000-8000-0000000000a1';
  v_slot_hold uuid := 'fb400000-0000-4000-8000-0000000000b1';
  v_slot_active uuid := 'fb400000-0000-4000-8000-0000000000b2';
  v_d_mon date;
  v_d_fri date;
  v_exp timestamptz;
  v_result jsonb;
  v_exp2 timestamptz;
  v_item jsonb;
  v_d1 date;
  v_d2 date;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES
    (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'fb4-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_renter_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'fb4-renter@users.invalid', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
     jsonb_build_object('actor', 'renter', 'organization_id', v_org::text, 'telegram_id', '94001'),
     '{}'::jsonb)
  ON CONFLICT (id) DO UPDATE SET raw_app_meta_data = EXCLUDED.raw_app_meta_data;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'FB4 Org', 'fb4-org', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed';

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime';

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'FB4 Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO UPDATE SET timezone = EXCLUDED.timezone;

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES (v_loc, v_org, 'FB4 Hall', true)
  ON CONFLICT (id) DO UPDATE SET miniapp_enabled = true;

  INSERT INTO renters (id, organization_id, display_name, status, telegram_id)
  VALUES (v_renter, v_org, 'FB4 Renter', 'active', 94001)
  ON CONFLICT (id) DO UPDATE SET status = 'active', telegram_id = EXCLUDED.telegram_id;

  INSERT INTO organization_addons (organization_id, addon_code, status, period_start, period_end)
  VALUES (v_org, 'renter_miniapp', 'active', CURRENT_DATE - 1, CURRENT_DATE + 365)
  ON CONFLICT (organization_id, addon_code) DO UPDATE SET status = 'active';

  INSERT INTO location_rental_hour_rates (organization_id, location_id, kind, price, currency, valid_from)
  VALUES
    (v_org, v_loc, 'one_time', 1000, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc, 'recurring', 800, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc, 'penalty', 1500, 'RUB', DATE '2000-01-01')
  ON CONFLICT DO NOTHING;

  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount)
  VALUES (v_org, v_renter, 'topup', 50000);

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');

  SELECT d INTO v_d_mon FROM _fb4_slot_at(v_org, interval '72 hours');
  v_d_fri := v_d_mon + 4;

  -- ---------------------------------------------------------------------------
  -- P1-06: same date inherits hold_deleted expiry
  -- ---------------------------------------------------------------------------
  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, hold_expires_at,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, currency,
    cancelled_at, cancelled_reason
  )
  VALUES (
    'fb400000-0000-4000-8000-000000000087',
    v_org, v_renter, v_loc, v_d_mon, '16:00', '17:00',
    'cancelled', 'miniapp', 'hold_deleted', now() + interval '8 hours',
    500, 500, 0, 1000, 'RUB',
    now(), 'miniapp_hold_deleted'
  );
  v_exp := now() + interval '8 hours';
  v_result := renter_create_booking(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc,
    'rental_date', v_d_mon,
    'time_start', '16:30',
    'time_end', '17:30',
    'idempotency_key', 'fb4-inherit-same-date'
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'P1-06 same date create: ' || COALESCE(v_result ->> 'error', 'ok'));
  v_exp2 := (v_result -> 'rental' ->> 'hold_expires_at')::timestamptz;
  PERFORM _test_assert(
    abs(extract(epoch FROM (v_exp2 - v_exp))) < 2,
    'P1-06 same date inherits hold_deleted expiry'
  );

  -- ---------------------------------------------------------------------------
  -- P1-06: different date does NOT inherit
  -- ---------------------------------------------------------------------------
  v_result := renter_create_booking(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc,
    'rental_date', v_d_fri,
    'time_start', '16:30',
    'time_end', '17:30',
    'idempotency_key', 'fb4-inherit-diff-date'
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'P1-06 diff date create: ' || COALESCE(v_result ->> 'error', 'ok'));
  PERFORM _test_assert(
    abs(extract(epoch FROM (
      (v_result -> 'rental' ->> 'hold_expires_at')::timestamptz - v_exp
    ))) > 60,
    'P1-06 Friday does not inherit Monday hold expiry'
  );

  -- ---------------------------------------------------------------------------
  -- P1-07: completed series cannot be pack-cancelled
  -- ---------------------------------------------------------------------------
  SELECT d INTO v_d1 FROM _fb4_slot_at(v_org, interval '96 hours');
  v_d2 := v_d1 + 7;

  INSERT INTO rental_series (
    id, organization_id, renter_id, location_id, tariff_id, valid_from, valid_to, status, channel
  )
  VALUES (
    v_series, v_org, v_renter, v_loc, NULL, v_d1 - 1, v_d2 + 7, 'completed', 'miniapp'
  );

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, rental_series_id,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, calculated_amount, currency,
    prepay_charged_at, hold_expires_at
  )
  VALUES (
    v_slot_active, v_org, v_renter, v_loc, v_d1, '10:00', '11:00',
    'confirmed', 'miniapp', 'settled', v_series,
    400, 400, 0, 800, 800, 'RUB',
    now() - interval '2 days', v_d1::timestamp + time '10:00'
  );

  v_result := renter_cancel_pack(v_series);
  PERFORM _test_assert(
    (v_result ->> 'success') IS DISTINCT FROM 'true',
    'P1-07 completed series pack cancel must fail'
  );
  PERFORM _test_assert(
    v_result ->> 'error' = 'renter.cancel.packNotCancellable',
    'P1-07 completed series error code'
  );

  -- ---------------------------------------------------------------------------
  -- P1-07: active pack with only past slots → packNotCancellable
  -- ---------------------------------------------------------------------------
  UPDATE rental_series SET status = 'active', updated_at = now() WHERE id = v_series;
  UPDATE rentals
  SET lifecycle = 'settled', rental_date = CURRENT_DATE - 3, time_start = '10:00', time_end = '11:00'
  WHERE id = v_slot_active;

  v_result := renter_cancel_pack(v_series);
  PERFORM _test_assert(
    (v_result ->> 'success') IS DISTINCT FROM 'true',
    'P1-07 no cancellable future slots must fail'
  );
  PERFORM _test_assert(
    v_result ->> 'error' = 'renter.cancel.packNotCancellable',
    'P1-07 empty cancellable batch error code'
  );

  -- ---------------------------------------------------------------------------
  -- P1-07: read model flags — hold row: delete_hold yes, pack cancel no
  -- ---------------------------------------------------------------------------
  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, rental_series_id,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, calculated_amount, currency,
    hold_expires_at
  )
  VALUES (
    v_slot_hold, v_org, v_renter, v_loc, v_d2, '12:00', '13:00',
    'confirmed', 'miniapp', 'awaiting_payment', v_series,
    400, 400, 0, 800, 800, 'RUB',
    now() + interval '12 hours'
  );

  PERFORM _fb4_set_renter_jwt(v_renter_user, v_org, 94001);
  v_item := _renter_public_rental_json(v_slot_hold);
  PERFORM _test_assert((v_item ->> 'can_delete_hold')::boolean, 'P1-07 hold row can_delete_hold');
  PERFORM _test_assert((v_item ->> 'can_cancel_pack')::boolean IS FALSE, 'P1-07 hold row no can_cancel_pack');
  PERFORM _test_assert((v_item ->> 'can_cancel_occurrence')::boolean IS FALSE, 'P1-07 hold row no can_cancel_occurrence');

  v_result := renter_list_mine(20, 0);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'list_mine exposes flags');
  PERFORM _test_assert(
    EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_result -> 'items') elem
      WHERE (elem ->> 'id')::uuid = v_slot_hold
        AND (elem ->> 'can_delete_hold')::boolean
        AND NOT COALESCE((elem ->> 'can_cancel_pack')::boolean, false)
    ),
    'P1-07 list_mine hold flags'
  );
END;
$$;

ROLLBACK;
