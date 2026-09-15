-- Cancel debt slot clears wallet debt; stale cancelled rows do not count.
-- Run: npm run test:db:renter-miniapp-debt-cancel-wallet

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
  v_org uuid := 'dc280000-0000-4000-8000-000000000001';
  v_user uuid := 'dc280000-0000-4000-8000-000000000011';
  v_member uuid := 'dc280000-0000-4000-8000-000000000021';
  v_loc uuid := 'dc280000-0000-4000-8000-0000000000aa';
  v_renter uuid := 'dc280000-0000-4000-8000-000000000041';
  v_slot_debt uuid := 'dc280000-0000-4000-8000-0000000000c1';
  v_slot_stale uuid := 'dc280000-0000-4000-8000-0000000000c2';
  v_d date;
  v_debt numeric;
  v_life text;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES (
    v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'dc28-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'DC28 Org', 'dc28-org', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed';

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime';

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'DC28 Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale, branding_name)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru', 'DC28 Studio')
  ON CONFLICT (organization_id) DO UPDATE SET timezone = EXCLUDED.timezone;

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES (v_loc, v_org, 'Hall DC28', true)
  ON CONFLICT (id) DO UPDATE SET miniapp_enabled = true;

  INSERT INTO renters (id, organization_id, display_name, telegram_id, status)
  VALUES (v_renter, v_org, 'DC28 Renter', 928001, 'active')
  ON CONFLICT (id) DO UPDATE SET status = 'active';

  DELETE FROM renter_wallet_ledger WHERE renter_id = v_renter;
  DELETE FROM rentals WHERE renter_id = v_renter;

  v_d := (CURRENT_DATE + 10)::date;

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, created_by,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, calculated_amount, currency,
    prepay_charged_at, debt_charge_seq
  )
  VALUES (
    v_slot_debt, v_org, v_renter, v_loc, v_d, '20:00', '21:00',
    'confirmed', 'miniapp', 'debt', v_member,
    0, 0, 4000000, 4000000, 4000000, 'RUB',
    NULL, 1
  );

  PERFORM _test_assert(
    _renter_wallet_debt_outstanding(v_org, v_renter) = 4000000,
    'debt_outstanding counts lifecycle=debt'
  );

  PERFORM _renter_cancel_one_slot(v_slot_debt, true, NULL, true);

  SELECT lifecycle, debt_amount INTO v_life, v_debt FROM rentals WHERE id = v_slot_debt;
  PERFORM _test_assert(v_life = 'cancelled', 'debt cancel → cancelled');
  PERFORM _test_assert(v_debt = 0, 'debt cancel clears debt_amount');
  PERFORM _test_assert(
    _renter_wallet_debt_outstanding(v_org, v_renter) = 0,
    'debt_outstanding zero after renter cancel'
  );

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, calculated_amount, currency
  )
  VALUES (
    v_slot_stale, v_org, v_renter, v_loc, v_d - 30, '20:00', '21:00',
    'cancelled', 'miniapp', 'cancelled',
    0, 0, 8600000, 8600000, 8600000, 'RUB'
  );

  PERFORM _test_assert(
    _renter_wallet_debt_outstanding(v_org, v_renter) = 0,
    'cancelled lifecycle with stale debt_amount does not count'
  );
END;
$$;

ROLLBACK;
