-- FC3: list_renters separate cashier_debt / miniapp_debt and debt filters.
-- Run: psql "%DATABASE_URL%" -v ON_ERROR_STOP=1 -f supabase/tests/_hall_rent_test_jwt.sql -f supabase/tests/renter_miniapp_fc3_separate_debts_test.sql

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
  v_org uuid := 'c3a00000-0000-4000-8000-000000000001';
  v_user uuid := 'c3a00000-0000-4000-8000-000000000011';
  v_member uuid := 'c3a00000-0000-4000-8000-000000000021';
  v_loc uuid := 'c3a00000-0000-4000-8000-0000000000aa';
  v_cashier_only uuid := 'c3a00000-0000-4000-8000-000000000041';
  v_miniapp_only uuid := 'c3a00000-0000-4000-8000-000000000042';
  v_both uuid := 'c3a00000-0000-4000-8000-000000000043';
  v_clean uuid := 'c3a00000-0000-4000-8000-000000000044';
  v_result jsonb;
  v_rows jsonb;
  v_row jsonb;
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
    'fc3-owner@test.local',
    crypt('testpass123', gen_salt('bf')),
    now(), now(), now(),
    '{}'::jsonb,
    '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'FC3 Debt Org', 'fc3-debt', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET
    status = 'licensed',
    owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET
    license_type = 'lifetime',
    activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'FC3 Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code)
  VALUES (v_org, 'Europe/Moscow', 'RUB')
  ON CONFLICT (organization_id) DO UPDATE SET
    timezone = EXCLUDED.timezone,
    currency_code = EXCLUDED.currency_code;

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES (v_loc, v_org, 'FC3 Hall', true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO renters (id, organization_id, display_name, counterparty_type, status, contact_phone)
  VALUES
    (v_cashier_only, v_org, 'FC3 Cashier Debt', 'individual', 'active', '+79001111111'),
    (v_miniapp_only, v_org, 'FC3 Mini App Debt', 'individual', 'active', '+79002222222'),
    (v_both, v_org, 'FC3 Both Debts', 'individual', 'active', '+79003333333'),
    (v_clean, v_org, 'FC3 No Debt', 'individual', 'active', '+79004444444')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, fixed_amount, currency, channel
  )
  VALUES (
    'c3a00000-0000-4000-8000-000000000051',
    v_org, v_cashier_only, v_loc, current_date - 1, '10:00', '12:00',
    'confirmed', 3000, 'RUB', 'cashier'
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, fixed_amount, currency, channel, lifecycle,
    prepay_amount, remainder_amount, debt_amount
  )
  VALUES (
    'c3a00000-0000-4000-8000-000000000052',
    v_org, v_miniapp_only, v_loc, current_date - 2, '14:00', '16:00',
    'confirmed', 2000, 'RUB', 'miniapp', 'debt',
    1000, 1000, 150
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, fixed_amount, currency, channel
  )
  VALUES (
    'c3a00000-0000-4000-8000-000000000053',
    v_org, v_both, v_loc, current_date - 3, '09:00', '11:00',
    'confirmed', 4000, 'RUB', 'cashier'
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, fixed_amount, currency, channel, lifecycle,
    prepay_amount, remainder_amount, debt_amount
  )
  VALUES (
    'c3a00000-0000-4000-8000-000000000054',
    v_org, v_both, v_loc, current_date - 4, '15:00', '17:00',
    'confirmed', 2500, 'RUB', 'miniapp', 'debt',
    1200, 1300, 75
  )
  ON CONFLICT (id) DO NOTHING;

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');

  v_result := list_renters(NULL, NULL, 'active', NULL, NULL);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'list_renters succeeds');

  SELECT elem INTO v_row
  FROM jsonb_array_elements(v_result -> 'renters') elem
  WHERE elem ->> 'id' = v_cashier_only::text;

  PERFORM _test_assert(v_row IS NOT NULL, 'cashier-only renter in list');
  PERFORM _test_assert((v_row ->> 'cashier_debt')::numeric = 3000, 'cashier_debt for cashier-only');
  PERFORM _test_assert((v_row ->> 'miniapp_debt')::numeric = 0, 'miniapp_debt zero for cashier-only');
  PERFORM _test_assert(v_row ? 'debt_amount' IS NOT TRUE, 'legacy debt_amount removed');

  SELECT elem INTO v_row
  FROM jsonb_array_elements(v_result -> 'renters') elem
  WHERE elem ->> 'id' = v_miniapp_only::text;

  PERFORM _test_assert((v_row ->> 'cashier_debt')::numeric = 0, 'cashier_debt zero for miniapp-only');
  PERFORM _test_assert((v_row ->> 'miniapp_debt')::numeric = 150, 'miniapp_debt for miniapp-only');

  SELECT elem INTO v_row
  FROM jsonb_array_elements(v_result -> 'renters') elem
  WHERE elem ->> 'id' = v_both::text;

  PERFORM _test_assert((v_row ->> 'cashier_debt')::numeric = 4000, 'cashier_debt for both');
  PERFORM _test_assert((v_row ->> 'miniapp_debt')::numeric = 75, 'miniapp_debt for both');

  v_result := list_renters(NULL, NULL, 'active', 'miniapp', NULL);
  v_rows := v_result -> 'renters';
  PERFORM _test_assert(
    jsonb_array_length(v_rows) = 2
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_rows) e WHERE e ->> 'id' = v_cashier_only::text
      ),
    'miniapp filter excludes cashier-only debtor'
  );

  v_result := list_renters(NULL, NULL, 'active', 'cashier', NULL);
  v_rows := v_result -> 'renters';
  PERFORM _test_assert(
    jsonb_array_length(v_rows) = 2
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_rows) e WHERE e ->> 'id' = v_miniapp_only::text
      ),
    'cashier filter excludes miniapp-only debtor'
  );

  v_result := list_renters(NULL, NULL, 'active', 'any', NULL);
  v_rows := v_result -> 'renters';
  PERFORM _test_assert(
    jsonb_array_length(v_rows) = 3
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_rows) e WHERE e ->> 'id' = v_clean::text
      ),
    'any filter returns all debtors across channels'
  );

  v_result := list_renters(NULL, NULL, 'active', 'invalid', NULL);
  PERFORM _test_assert(
    (v_result ->> 'success')::boolean IS NOT TRUE
      AND v_result ->> 'error' = 'renters.error.invalidDebtFilter',
    'invalid debt filter rejected'
  );

  RAISE NOTICE 'renter_miniapp_fc3_separate_debts_test: OK';
END;
$$;

ROLLBACK;
