-- rental operation_date + finance period closing (hall rent stage 9)
-- Run: psql $DATABASE_URL -f supabase/tests/rental_operation_date_test.sql

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
  v_org uuid := 'ffffffff-ffff-ffff-ffff-fffffffffff2';
  v_user uuid := '66666666-6666-6666-6666-66666666fff2';
  v_member uuid := 'ffffffff-ffff-ffff-ffff-ffffffffff12';
  v_loc uuid := 'ffffffff-ffff-ffff-ffff-000000000212';
  v_renter uuid := 'ffffffff-ffff-ffff-ffff-000000000312';
  v_rental uuid := 'ffffffff-ffff-ffff-ffff-000000000412';
  v_rental2 uuid := 'ffffffff-ffff-ffff-ffff-000000000413';
  v_result jsonb;
  v_payment_id uuid;
  v_yesterday date;
  v_today date;
  v_closed date;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    v_user,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'rental-opdate@test.local',
    crypt('testpass123', gen_salt('bf')),
    now(),
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'Rental OpDate Org', 'rental-opdate', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'Owner OpDate')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, finance_period_closed_until)
  VALUES (v_org, 'Europe/Moscow', NULL)
  ON CONFLICT (organization_id) DO UPDATE SET
    timezone = EXCLUDED.timezone,
    finance_period_closed_until = EXCLUDED.finance_period_closed_until;

  INSERT INTO locations (id, organization_id, name)
  VALUES (v_loc, v_org, 'OpDate Hall')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO renters (id, organization_id, display_name)
  VALUES (v_renter, v_org, 'OpDate Renter')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, fixed_amount, currency
  )
  VALUES
    (v_rental, v_org, v_renter, v_loc, current_date + 3, '10:00', '12:00', 'confirmed', 3000, 'RUB'),
    (v_rental2, v_org, v_renter, v_loc, current_date + 4, '14:00', '16:00', 'confirmed', 2000, 'RUB')
  ON CONFLICT (id) DO UPDATE SET booking_status = 'confirmed';

  DELETE FROM rental_payments WHERE rental_id IN (v_rental, v_rental2);

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.organization_id', v_org::text, true);
  PERFORM set_config('request.jwt.claim.member_id', v_member::text, true);
  PERFORM set_config('request.jwt.claim.role', 'owner', true);

  v_today := _org_local_date(v_org);
  v_yesterday := v_today - 1;

  -- Yesterday's cash day, recorded today
  v_result := record_rental_payment(v_rental, 1000, 'cash', NULL, 'opdate-test-1', v_yesterday);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'yesterday operation_date should succeed');
  v_payment_id := (v_result ->> 'payment_id')::uuid;

  PERFORM _test_assert(
  EXISTS (
    SELECT 1 FROM rental_payments rp
    WHERE rp.id = v_payment_id
      AND rp.operation_date = v_yesterday
      AND rp.created_at IS NOT NULL
  ),
  'operation_date stored separately from created_at'
  );

  -- Register filters by operation_date
  SELECT list_rental_money_register(v_yesterday::text, v_yesterday::text) INTO v_result;
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'list register success');
  PERFORM _test_assert(
    jsonb_array_length(v_result -> 'entries') >= 1,
    'yesterday payment appears in yesterday register slice'
  );

  -- Future date rejected
  v_result := record_rental_payment(
    v_rental2, 500, 'cash', NULL, 'opdate-test-future', v_today + 1
  );
  PERFORM _test_assert(
    (v_result ->> 'success')::boolean IS NOT TRUE
    AND v_result ->> 'error' = 'finance.error.operationDateFuture',
    'future operation_date rejected'
  );

  -- Closed period blocks cashier path
  v_closed := v_today - 2;
  UPDATE organization_settings
  SET finance_period_closed_until = v_closed
  WHERE organization_id = v_org;

  v_result := record_rental_payment(
    v_rental2, 500, 'cash', NULL, 'opdate-test-closed', v_closed
  );
  PERFORM _test_assert(
    (v_result ->> 'success')::boolean IS NOT TRUE
    AND v_result ->> 'error' = 'finance.error.periodClosed',
    'closed period blocks direct payment'
  );

  -- Open day after closed_until still works
  v_result := record_rental_payment(
    v_rental2, 500, 'cash', NULL, 'opdate-test-open', v_closed + 1
  );
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'day after closed_until allowed');

  RAISE NOTICE 'rental_operation_date_test: OK';
END;
$$;

ROLLBACK;
