-- FC5: director dashboard stats — separate miniapp KPIs; owner/director only.
-- Run: npm run test:db:renter-miniapp-fc5

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
  v_org uuid := 'fc500000-0000-4000-8000-000000000001';
  v_owner uuid := 'fc500000-0000-4000-8000-000000000011';
  v_accountant uuid := 'fc500000-0000-4000-8000-000000000012';
  v_member_owner uuid := 'fc500000-0000-4000-8000-000000000021';
  v_member_accountant uuid := 'fc500000-0000-4000-8000-000000000022';
  v_renter uuid := 'fc500000-0000-4000-8000-000000000041';
  v_loc uuid := 'fc500000-0000-4000-8000-000000000051';
  v_rental_miniapp uuid := 'fc500000-0000-4000-8000-000000000061';
  v_rental_cashier uuid := 'fc500000-0000-4000-8000-000000000062';
  v_topup_pending uuid := 'fc500000-0000-4000-8000-000000000071';
  v_topup_confirmed uuid := 'fc500000-0000-4000-8000-000000000072';
  v_topup_rejected uuid := 'fc500000-0000-4000-8000-000000000073';
  v_result jsonb;
  v_mini jsonb;
  v_month text := to_char(current_date, 'YYYY-MM');
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fc5-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()),
    (v_accountant, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fc5-accountant@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'FC5 Dashboard Org', 'fc5-dashboard', 'licensed', v_version_id, v_owner)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime', activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name, meta)
  VALUES
    (v_member_owner, v_org, v_owner, 'owner', 'FC5 Owner', '{}'::jsonb),
    (v_member_accountant, v_org, v_accountant, 'accountant', 'FC5 Accountant', '{}'::jsonb)
  ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role;

  INSERT INTO organization_settings (organization_id, timezone)
  VALUES (v_org, 'UTC')
  ON CONFLICT (organization_id) DO UPDATE SET timezone = 'UTC';

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES (v_loc, v_org, 'FC5 Hall', true)
  ON CONFLICT (id) DO UPDATE SET miniapp_enabled = true;

  INSERT INTO renters (id, organization_id, display_name, status)
  VALUES (v_renter, v_org, 'FC5 Renter', 'active')
  ON CONFLICT (id) DO NOTHING;

  -- Cashier confirmed rental (must NOT inflate miniapp occupancy)
  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, fixed_amount, currency, channel
  )
  VALUES (
    v_rental_cashier, v_org, v_renter, v_loc, date_trunc('month', current_date)::date + 2, '10:00', '12:00',
    'confirmed', 3000, 'RUB', 'cashier'
  )
  ON CONFLICT (id) DO UPDATE SET channel = 'cashier', booking_status = 'confirmed', lifecycle = NULL;

  -- Mini App confirmed slot in current month
  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, fixed_amount, currency, channel, lifecycle
  )
  VALUES (
    v_rental_miniapp, v_org, v_renter, v_loc, date_trunc('month', current_date)::date + 3, '14:00', '16:00',
    'confirmed', 2000, 'RUB', 'miniapp', 'active'
  )
  ON CONFLICT (id) DO UPDATE SET channel = 'miniapp', booking_status = 'confirmed';

  -- Expiring hold (within 24h)
  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, fixed_amount, currency, channel, lifecycle, hold_expires_at
  )
  VALUES (
    'fc500000-0000-4000-8000-000000000063', v_org, v_renter, v_loc, current_date + 1, '18:00', '20:00',
    'confirmed', 1500, 'RUB', 'miniapp', 'awaiting_payment', now() + interval '2 hours'
  )
  ON CONFLICT (id) DO UPDATE SET
    channel = 'miniapp',
    lifecycle = 'awaiting_payment',
    hold_expires_at = now() + interval '2 hours';

  -- Mini App wallet topup revenue this month
  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount, created_at)
  VALUES (v_org, v_renter, 'topup', 500, now())
  ON CONFLICT DO NOTHING;

  -- Mini App debt row
  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, fixed_amount, currency, channel, lifecycle,
    prepay_amount, remainder_amount, debt_amount
  )
  VALUES (
    'fc500000-0000-4000-8000-000000000064', v_org, v_renter, v_loc, current_date - 1, '09:00', '11:00',
    'confirmed', 400, 'RUB', 'miniapp', 'debt', 200, 0, 200
  )
  ON CONFLICT (id) DO UPDATE SET lifecycle = 'debt', channel = 'miniapp', debt_amount = 200;

  -- Topup requests for conversion + SLA
  INSERT INTO renter_topup_requests (
    id, organization_id, renter_id, amount, method, status, correlation_code, created_at
  )
  VALUES
    (v_topup_pending, v_org, v_renter, 100, 'cash', 'pending', 'TDB-FC5A', now() - interval '5 hours'),
    (v_topup_confirmed, v_org, v_renter, 200, 'cash', 'confirmed', 'TDB-FC5B', now()),
    (v_topup_rejected, v_org, v_renter, 50, 'cash', 'rejected', 'TDB-FC5C', now())
  ON CONFLICT (id) DO UPDATE SET
    status = EXCLUDED.status,
    created_at = EXCLUDED.created_at;

  PERFORM _hall_rent_test_set_jwt(v_accountant, v_org, v_member_accountant, 'accountant');
  v_result := get_renter_miniapp_dashboard_stats(v_month);
  PERFORM _test_assert((v_result ->> 'success')::boolean = false, 'accountant forbidden');

  PERFORM _hall_rent_test_set_jwt(v_owner, v_org, v_member_owner, 'owner');
  v_result := get_renter_miniapp_dashboard_stats(v_month);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'owner can read dashboard stats');
  PERFORM _test_assert((v_result ->> 'addon_active')::boolean, 'addon active');

  v_mini := v_result -> 'miniapp';
  PERFORM _test_assert((v_mini ->> 'revenue')::numeric >= 500, 'miniapp wallet topup revenue');
  PERFORM _test_assert((v_mini ->> 'occupancy_slots')::integer = 3, 'miniapp channel slots only (not cashier)');
  PERFORM _test_assert((v_mini ->> 'pending_count')::integer >= 1, 'pending topup count');
  PERFORM _test_assert((v_mini ->> 'pending_sla_breached')::integer >= 1, 'SLA breached pending');
  PERFORM _test_assert((v_mini ->> 'debt_total')::numeric > 0, 'miniapp debt total');
  PERFORM _test_assert((v_mini ->> 'expiring_holds')::integer >= 1, 'expiring holds');
  PERFORM _test_assert((v_mini ->> 'topup_submitted')::integer >= 3, 'topup submitted in month');
  PERFORM _test_assert((v_mini ->> 'topup_confirmed')::integer >= 1, 'topup confirmed');
  PERFORM _test_assert((v_mini ->> 'topup_rejected')::integer >= 1, 'topup rejected');
  PERFORM _test_assert((v_mini ->> 'topup_conversion_rate')::numeric = 0.5, 'conversion 1/2 resolved');

  RAISE NOTICE 'renter_miniapp_fc5_director_dashboard_test: OK';
END;
$$;

ROLLBACK;
