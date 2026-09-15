-- renter_cancel_pack cancels lifecycle=debt staff series slots.
-- Run: npm run test:db:renter-miniapp-cancel-pack-debt

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
  v_org uuid := 'cp280000-0000-4000-8000-000000000001';
  v_user uuid := 'cp280000-0000-4000-8000-000000000011';
  v_member uuid := 'cp280000-0000-4000-8000-000000000021';
  v_loc uuid := 'cp280000-0000-4000-8000-0000000000aa';
  v_renter uuid := 'cp280000-0000-4000-8000-000000000041';
  v_series uuid := 'cp280000-0000-4000-8000-0000000000a1';
  v_slot1 uuid := 'cp280000-0000-4000-8000-0000000000b1';
  v_slot2 uuid := 'cp280000-0000-4000-8000-0000000000b2';
  v_d1 date;
  v_d2 date;
  v_result jsonb;
  v_open int;
  v_debt numeric;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES (
    v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'cp28-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'CP28 Org', 'cp28-org', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed';

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'CP28 Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO renters (id, organization_id, display_name, telegram_id, status)
  VALUES (v_renter, v_org, 'CP28 Renter', 928028, 'active')
  ON CONFLICT (id) DO UPDATE SET status = 'active';

  DELETE FROM rentals WHERE renter_id = v_renter;
  DELETE FROM rental_series WHERE renter_id = v_renter;

  v_d1 := (CURRENT_DATE + 30)::date;
  v_d2 := (CURRENT_DATE + 37)::date;

  INSERT INTO rental_series (
    id, organization_id, renter_id, location_id, valid_from, valid_to, status, channel
  )
  VALUES (
    v_series, v_org, v_renter, v_loc, v_d1 - 1, v_d2 + 7, 'active', 'miniapp'
  );

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, rental_series_id, created_by,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, calculated_amount, currency
  )
  VALUES
    (
      v_slot1, v_org, v_renter, v_loc, v_d1, '20:00', '21:00',
      'confirmed', 'miniapp', 'debt', v_series, v_member,
      0, 0, 200000, 200000, 200000, 'RUB'
    ),
    (
      v_slot2, v_org, v_renter, v_loc, v_d2, '20:00', '21:00',
      'confirmed', 'miniapp', 'debt', v_series, v_member,
      0, 0, 200000, 200000, 200000, 'RUB'
    );

  PERFORM _test_assert(
    _renter_series_has_cancellable_pack_slots(v_series, false),
    'pack with only debt slots is cancellable (staff)'
  );

  PERFORM _test_assert(
    _renter_can_delete_hold_row((SELECT r FROM rentals r WHERE id = v_slot1), false),
    'staff can delete_hold staff debt before start'
  );

  PERFORM _test_assert(
    _renter_wallet_debt_outstanding(v_org, v_renter) = 400000,
    'wallet debt sums debt slots'
  );

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');

  v_result := renter_cancel_pack(v_series);

  PERFORM _test_assert((v_result ->> 'success')::boolean IS TRUE, 'renter_cancel_pack success');

  SELECT count(*) INTO v_open
  FROM rentals
  WHERE rental_series_id = v_series
    AND channel = 'miniapp'
    AND lifecycle IN ('debt', 'active', 'awaiting_payment', 'prepaid_charged');

  PERFORM _test_assert(v_open = 0, 'debt pack slots terminal after cancel');

  PERFORM _test_assert(
    _renter_wallet_debt_outstanding(v_org, v_renter) = 0,
    'wallet debt zero after pack cancel'
  );
END;
$$;

ROLLBACK;
