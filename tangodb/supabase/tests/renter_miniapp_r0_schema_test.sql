-- R0 schema: channel/lifecycle, telegram_id unique, add-on fail-closed, hook actor=renter.
-- Run: psql "%DATABASE_URL%" -v ON_ERROR_STOP=1 -f supabase/tests/_hall_rent_test_jwt.sql -f supabase/tests/renter_miniapp_r0_schema_test.sql

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

CREATE OR REPLACE FUNCTION _r0_set_renter_jwt(p_user uuid, p_org uuid)
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
        'renter_id', '00000000-0000-4000-8000-0000000000aa',
        'telegram_id', '12345'
      )
    )::text,
    true
  );
END;
$$;

DO $$
DECLARE
  v_version_id uuid;
  v_org uuid := 'a0900000-0000-4000-8000-000000000001';
  v_org_b uuid := 'a0900000-0000-4000-8000-00000000000b';
  v_user uuid := 'a0900000-0000-4000-8000-000000000011';
  v_user_b uuid := 'a0900000-0000-4000-8000-000000000012';
  v_renter_user uuid := 'a0900000-0000-4000-8000-000000000013';
  v_renter_user_2 uuid := 'a0900000-0000-4000-8000-000000000014';
  v_member uuid := 'a0900000-0000-4000-8000-000000000021';
  v_member_b uuid := 'a0900000-0000-4000-8000-000000000022';
  v_loc uuid := 'a0900000-0000-4000-8000-000000000031';
  v_renter uuid := 'a0900000-0000-4000-8000-000000000041';
  v_renter2 uuid := 'a0900000-0000-4000-8000-000000000042';
  v_renter3 uuid := 'a0900000-0000-4000-8000-000000000043';
  v_rental uuid := 'a0900000-0000-4000-8000-000000000051';
  v_rental_hold uuid := 'a0900000-0000-4000-8000-000000000052';
  v_session uuid := 'a0900000-0000-4000-8000-000000000061';
  v_hook jsonb;
  v_raised boolean;
  v_today date;
  v_channel text;
  v_lifecycle text;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES
    (
      v_user,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'r0-owner@test.local',
      crypt('testpass123', gen_salt('bf')),
      now(), now(), now(),
      '{}'::jsonb,
      '{}'::jsonb
    ),
    (
      v_user_b,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'r0-owner-b@test.local',
      crypt('testpass123', gen_salt('bf')),
      now(), now(), now(),
      '{}'::jsonb,
      '{}'::jsonb
    ),
    (
      v_renter_user,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'r0-renter@users.invalid',
      crypt('testpass123', gen_salt('bf')),
      now(), now(), now(),
      jsonb_build_object('actor', 'renter', 'organization_id', v_org::text),
      '{}'::jsonb
    ),
    (
      v_renter_user_2,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'r0-renter-late@users.invalid',
      crypt('testpass123', gen_salt('bf')),
      now(), now(), now(),
      '{}'::jsonb,
      '{}'::jsonb
    )
  ON CONFLICT (id) DO UPDATE SET
    raw_app_meta_data = EXCLUDED.raw_app_meta_data,
    email = EXCLUDED.email;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES
    (v_org, 'R0 Mini App Org', 'r0-miniapp-a', 'licensed', v_version_id, v_user),
    (v_org_b, 'R0 Mini App Org B', 'r0-miniapp-b', 'licensed', v_version_id, v_user_b)
  ON CONFLICT (id) DO UPDATE SET
    status = 'licensed',
    owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES
    (v_org, v_version_id, 'lifetime', now()),
    (v_org_b, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET
    license_type = 'lifetime',
    activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES
    (v_member, v_org, v_user, 'owner', 'R0 Owner'),
    (v_member_b, v_org_b, v_user_b, 'owner', 'R0 Owner B')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code)
  VALUES
    (v_org, 'Europe/Moscow', 'RUB'),
    (v_org_b, 'Europe/Moscow', 'RUB')
  ON CONFLICT (organization_id) DO UPDATE SET
    timezone = EXCLUDED.timezone,
    currency_code = EXCLUDED.currency_code;

  INSERT INTO locations (id, organization_id, name)
  VALUES (v_loc, v_org, 'R0 Hall')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO renters (id, organization_id, display_name)
  VALUES
    (v_renter, v_org, 'R0 Cashier Renter'),
    (v_renter2, v_org, 'R0 Second NULL telegram'),
    (v_renter3, v_org, 'R0 Identity Renter')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, fixed_amount, currency
  )
  VALUES (
    v_rental, v_org, v_renter, v_loc, current_date + 3, '10:00', '12:00',
    'confirmed', 3000, 'RUB'
  )
  ON CONFLICT (id) DO UPDATE SET booking_status = 'confirmed';

  SELECT channel, lifecycle INTO v_channel, v_lifecycle
  FROM rentals WHERE id = v_rental;

  PERFORM _test_assert(v_channel = 'cashier', 'default channel is cashier');
  PERFORM _test_assert(v_lifecycle IS NULL, 'cashier lifecycle is NULL');

  v_raised := false;
  BEGIN
    INSERT INTO rentals (
      id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
      booking_status, fixed_amount, currency, channel
    )
    VALUES (
      'a0900000-0000-4000-8000-000000000059',
      v_org, v_renter, v_loc, current_date + 5, '10:00', '12:00',
      'confirmed', 1000, 'RUB', 'miniapp'
    );
  EXCEPTION WHEN check_violation OR OTHERS THEN
    v_raised := true;
  END;
  PERFORM _test_assert(v_raised, 'INSERT miniapp without lifecycle rejected');

  v_raised := false;
  BEGIN
    UPDATE rentals SET lifecycle = 'active' WHERE id = v_rental;
  EXCEPTION WHEN check_violation OR OTHERS THEN
    v_raised := true;
  END;
  PERFORM _test_assert(v_raised, 'cashier with lifecycle rejected');

  UPDATE renters SET telegram_id = NULL WHERE id IN (v_renter, v_renter2);
  PERFORM _test_assert(
    (SELECT count(*) FROM renters WHERE id IN (v_renter, v_renter2) AND telegram_id IS NULL) = 2,
    'two NULL telegram_id allowed'
  );

  UPDATE renters SET telegram_id = 777001 WHERE id = v_renter;
  v_raised := false;
  BEGIN
    UPDATE renters SET telegram_id = 777001 WHERE id = v_renter2;
  EXCEPTION WHEN unique_violation OR OTHERS THEN
    v_raised := true;
  END;
  PERFORM _test_assert(v_raised, 'duplicate telegram_id in same org rejected');
  UPDATE renters SET telegram_id = NULL WHERE id = v_renter;

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');
  DELETE FROM organization_addons WHERE organization_id IN (v_org, v_org_b);
  PERFORM _test_assert(
    renter_miniapp_addon_is_active(v_org) IS TRUE,
    'licensed lifetime without addon row is true'
  );

  INSERT INTO organization_addons (
    organization_id, addon_code, status, period_start, period_end
  )
  VALUES (v_org, 'renter_miniapp', 'paused', current_date - 1, current_date + 30)
  ON CONFLICT (organization_id, addon_code) DO UPDATE SET
    status = 'paused',
    period_start = EXCLUDED.period_start,
    period_end = EXCLUDED.period_end;

  PERFORM _test_assert(
    renter_miniapp_addon_is_active(v_org) IS TRUE,
    'paused addon row does not turn off licensed CRM'
  );

  UPDATE organizations SET status = 'demo_active' WHERE id = v_org;
  PERFORM _test_assert(
    renter_miniapp_addon_is_active(v_org) IS FALSE,
    'demo org is false even with addon row'
  );
  UPDATE organizations SET status = 'licensed' WHERE id = v_org;

  DELETE FROM organization_licenses WHERE organization_id = v_org;
  INSERT INTO organization_subscriptions (
    organization_id, plan, billing_period, status, current_period_start, current_period_end
  )
  VALUES (v_org, 'standard', 'monthly', 'active', now(), now() + interval '30 days')
  ON CONFLICT (organization_id) DO UPDATE SET
    plan = EXCLUDED.plan,
    billing_period = EXCLUDED.billing_period,
    status = EXCLUDED.status,
    current_period_start = EXCLUDED.current_period_start,
    current_period_end = EXCLUDED.current_period_end;
  PERFORM _test_assert(
    renter_miniapp_addon_is_active(v_org) IS TRUE,
    'licensed monthly CRM subscription without lifetime is true'
  );

  UPDATE organization_subscriptions
  SET status = 'past_due'
  WHERE organization_id = v_org;
  PERFORM _test_assert(
    renter_miniapp_addon_is_active(v_org) IS FALSE,
    'past_due CRM subscription is false'
  );

  DELETE FROM organization_subscriptions WHERE organization_id = v_org;
  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET
    license_type = 'lifetime',
    activated_at = now();

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');
  PERFORM _test_assert(
    renter_miniapp_addon_is_active(v_org_b) IS FALSE,
    'member helper with foreign p_org is false'
  );

  PERFORM _r0_set_renter_jwt(v_renter_user, v_org);
  PERFORM _test_assert(
    renter_miniapp_addon_is_active(v_org) IS TRUE,
    'renter helper for own licensed org is true'
  );
  PERFORM _test_assert(
    renter_miniapp_addon_is_active(v_org_b) IS FALSE,
    'renter helper with foreign p_org is false'
  );

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');
  v_hook := custom_access_token_hook(
    jsonb_build_object(
      'claims', jsonb_build_object(
        'sub', v_user::text,
        'role', 'authenticated',
        'email', 'r0-owner@test.local'
      )
    )
  );
  PERFORM _test_assert(
    v_hook -> 'claims' ->> 'organization_id' = v_org::text,
    'member JWT without actor still gets organization_id'
  );
  PERFORM _test_assert(
    v_hook -> 'claims' ->> 'member_id' = v_member::text,
    'member JWT without actor still gets member_id'
  );

  -- Plant uao for a user, then mark actor=renter: hook must not copy org claims.
  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (
    'a0900000-0000-4000-8000-000000000023',
    v_org,
    v_renter_user_2,
    'admin',
    'Should lose org claims'
  )
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO user_active_organizations (user_id, organization_id, member_id)
  SELECT v_renter_user_2, v_org, m.id
  FROM organization_members m
  WHERE m.user_id = v_renter_user_2 AND m.organization_id = v_org
  ON CONFLICT (user_id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    member_id = EXCLUDED.member_id;

  UPDATE auth.users
  SET raw_app_meta_data = jsonb_build_object('actor', 'renter', 'organization_id', v_org::text)
  WHERE id = v_renter_user_2;

  v_hook := custom_access_token_hook(
    jsonb_build_object(
      'claims', jsonb_build_object(
        'sub', v_renter_user_2::text,
        'role', 'authenticated',
        'organization_id', v_org::text,
        'member_id', v_member::text,
        'member_role', 'admin',
        'app_metadata', jsonb_build_object(
          'actor', 'renter',
          'organization_id', v_org::text,
          'telegram_id', '999'
        )
      )
    )
  );
  PERFORM _test_assert(
    NOT (v_hook -> 'claims' ? 'organization_id'),
    'renter hook strips top-level organization_id even with uao'
  );
  PERFORM _test_assert(
    NOT (v_hook -> 'claims' ? 'member_id'),
    'renter hook does not set member_id'
  );
  PERFORM _test_assert(
    v_hook -> 'claims' -> 'app_metadata' ->> 'actor' = 'renter',
    'renter hook keeps app_metadata.actor'
  );
  PERFORM _test_assert(
    NOT (v_hook -> 'claims' ? 'telegram_id'),
    'renter hook does not copy telegram_id to top-level claims'
  );

  v_raised := false;
  BEGIN
    INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
    VALUES (
      'a0900000-0000-4000-8000-000000000024',
      v_org,
      v_renter_user,
      'admin',
      'Renter as member'
    );
  EXCEPTION WHEN check_violation OR OTHERS THEN
    v_raised := true;
  END;
  PERFORM _test_assert(v_raised, 'INSERT organization_members for actor=renter rejected');

  UPDATE renters
  SET telegram_id = 888001,
      auth_user_id = v_renter_user
  WHERE id = v_renter3;

  INSERT INTO auth.sessions (id, user_id, created_at, updated_at)
  VALUES (v_session, v_renter_user, now(), now())
  ON CONFLICT (id) DO NOTHING;

  PERFORM _test_assert(
    EXISTS (SELECT 1 FROM auth.sessions WHERE id = v_session),
    'session exists before telegram_id clear'
  );

  UPDATE renters SET telegram_id = NULL WHERE id = v_renter3;

  PERFORM _test_assert(
    NOT EXISTS (SELECT 1 FROM auth.sessions WHERE id = v_session),
    'clearing telegram_id revokes old auth sessions'
  );

  v_today := _org_local_date(v_org);
  INSERT INTO location_rental_hour_rates (
    organization_id, location_id, kind, price, currency, valid_from
  )
  VALUES (v_org, v_loc, 'one_time', 1500, 'RUB', v_today);

  v_raised := false;
  BEGIN
    UPDATE organization_settings
    SET currency_code = 'USD'
    WHERE organization_id = v_org;
  EXCEPTION WHEN check_violation OR OTHERS THEN
    v_raised := true;
  END;
  PERFORM _test_assert(v_raised, 'currency change with live hour_rates rejected');

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, fixed_amount, currency, channel, lifecycle, hold_expires_at,
    prepay_amount, remainder_amount, debt_amount
  )
  VALUES (
    v_rental_hold, v_org, v_renter, v_loc, current_date + 6, '12:00', '14:00',
    'confirmed', 2000, 'RUB', 'miniapp', 'awaiting_payment', now() + interval '24 hours',
    1000, 1000, 0
  );

  v_raised := false;
  BEGIN
    UPDATE organization_settings
    SET timezone = 'Asia/Ho_Chi_Minh'
    WHERE organization_id = v_org;
  EXCEPTION WHEN check_violation OR OTHERS THEN
    v_raised := true;
  END;
  PERFORM _test_assert(v_raised, 'timezone change with live awaiting_payment rejected');

  RAISE NOTICE 'renter_miniapp_r0_schema_test: OK';
END;
$$;

ROLLBACK;
