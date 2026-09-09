-- Pack surcharge staff review: no auto-apply; queue on bulk week-1-only close.
-- Run: psql "%DATABASE_URL%" -v ON_ERROR_STOP=1 -f supabase/tests/renter_miniapp_pack_surcharge_review_test.sql

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

DO $body$
DECLARE
  v_version_id uuid;
  v_org uuid := 'a1c00000-0000-4000-8000-000000000101';
  v_loc uuid := 'a1c00000-0000-4000-8000-000000000201';
  v_renter_a uuid := 'a1c00000-0000-4000-8000-000000000301';
  v_renter_b uuid := 'a1c00000-0000-4000-8000-000000000302';
  v_series_a uuid := 'a1c00000-0000-4000-8000-000000000401';
  v_series_b uuid := 'a1c00000-0000-4000-8000-000000000402';
  v_slot_w1 uuid := 'a1c00000-0000-4000-8000-000000000501';
  v_slot_w2 uuid := 'a1c00000-0000-4000-8000-000000000502';
  v_slot_term uuid := 'a1c00000-0000-4000-8000-000000000503';
  v_slot_b1 uuid := 'a1c00000-0000-4000-8000-000000000504';
  v_slot_b_term uuid := 'a1c00000-0000-4000-8000-000000000505';
  v_past date;
  v_review_count integer;
  v_debt numeric;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO organizations (id, name, slug, status, crm_version_id)
  VALUES (v_org, 'Pack Surcharge Review Org', 'pack-surcharge-review', 'licensed', v_version_id)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed';

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO UPDATE SET timezone = EXCLUDED.timezone;

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES (v_loc, v_org, 'Review Hall', true)
  ON CONFLICT (id) DO UPDATE SET miniapp_enabled = true;

  INSERT INTO renters (id, organization_id, display_name, status)
  VALUES
    (v_renter_a, v_org, 'Pack Review A', 'active'),
    (v_renter_b, v_org, 'Pack Review B', 'active')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_addons (organization_id, addon_code, status, period_start, period_end)
  VALUES (v_org, 'renter_miniapp', 'active', CURRENT_DATE - 1, CURRENT_DATE + 365)
  ON CONFLICT (organization_id, addon_code) DO UPDATE SET status = 'active';

  INSERT INTO location_rental_hour_rates (organization_id, location_id, kind, price, currency, valid_from)
  VALUES
    (v_org, v_loc, 'one_time', 1000, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc, 'recurring', 800, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc, 'penalty', 1500, 'RUB', DATE '2000-01-01')
  ON CONFLICT DO NOTHING;

  v_past := (_org_local_date(v_org) - 10);

  INSERT INTO rental_series (
    id, organization_id, renter_id, location_id, valid_from, valid_to, status, channel
  )
  VALUES (
    v_series_a, v_org, v_renter_a, v_loc, v_past, v_past + 20, 'active', 'miniapp'
  )
  ON CONFLICT (id) DO UPDATE SET status = 'active';

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, rental_series_id,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, calculated_amount, currency,
    prepay_charged_at, remainder_charged_at
  )
  VALUES (
    v_slot_w1, v_org, v_renter_a, v_loc, v_past, '10:00', '11:00',
    'confirmed', 'miniapp', 'settled', v_series_a,
    400, 400, 0, 800, 800, 'RUB',
    now() - interval '5 days', now() - interval '4 days'
  )
  ON CONFLICT (id) DO UPDATE SET lifecycle = 'settled', debt_amount = 0;

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, rental_series_id,
    prepay_amount, remainder_amount, fixed_amount, calculated_amount, currency,
    cancelled_at, cancelled_reason
  )
  VALUES (
    v_slot_term, v_org, v_renter_a, v_loc, v_past + 7, '10:00', '11:00',
    'cancelled', 'miniapp', 'cancelled', v_series_a,
    400, 400, 800, 800, 'RUB',
    now(), 'miniapp_cancel_refund'
  )
  ON CONFLICT (id) DO UPDATE SET lifecycle = 'cancelled';

  DELETE FROM rental_series_surcharge_reviews WHERE rental_series_id = v_series_a;
  PERFORM _renter_early_close_pack(v_series_a, 'bulk_pack');

  SELECT count(*) INTO v_review_count
  FROM rental_series_surcharge_reviews
  WHERE rental_series_id = v_series_a AND status = 'pending';

  PERFORM _test_assert(v_review_count = 1, 'bulk week-1-only queues pending review');

  SELECT debt_amount INTO v_debt FROM rentals WHERE id = v_slot_w1;
  PERFORM _test_assert(
    COALESCE(v_debt, 0) = 0,
    'bulk week-1-only does not auto-apply surcharge debt'
  );

  INSERT INTO rental_series (
    id, organization_id, renter_id, location_id, valid_from, valid_to, status, channel
  )
  VALUES (
    v_series_b, v_org, v_renter_b, v_loc, v_past - 7, v_past + 14, 'active', 'miniapp'
  )
  ON CONFLICT (id) DO UPDATE SET status = 'active';

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, rental_series_id,
    prepay_amount, remainder_amount, fixed_amount, calculated_amount, currency,
    prepay_charged_at, remainder_charged_at
  )
  VALUES
    (
      v_slot_b1, v_org, v_renter_b, v_loc, v_past - 7, '10:00', '11:00',
      'confirmed', 'miniapp', 'settled', v_series_b,
      400, 400, 800, 800, 'RUB',
      now() - interval '12 days', now() - interval '11 days'
    ),
    (
      v_slot_w2, v_org, v_renter_b, v_loc, v_past, '10:00', '11:00',
      'confirmed', 'miniapp', 'settled', v_series_b,
      400, 400, 800, 800, 'RUB',
      now() - interval '5 days', now() - interval '4 days'
    )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, rental_series_id,
    prepay_amount, remainder_amount, fixed_amount, calculated_amount, currency,
    cancelled_at, cancelled_reason
  )
  VALUES (
    v_slot_b_term, v_org, v_renter_b, v_loc, v_past + 7, '10:00', '11:00',
    'cancelled', 'miniapp', 'cancelled', v_series_b,
    400, 400, 800, 800, 'RUB',
    now(), 'miniapp_cancel_refund'
  )
  ON CONFLICT (id) DO UPDATE SET lifecycle = 'cancelled';

  DELETE FROM rental_series_surcharge_reviews WHERE rental_series_id = v_series_b;
  PERFORM _renter_early_close_pack(v_series_b, 'bulk_pack');

  SELECT count(*) INTO v_review_count
  FROM rental_series_surcharge_reviews
  WHERE rental_series_id = v_series_b;

  PERFORM _test_assert(v_review_count = 0, 'multi-week usage skips review queue');

  UPDATE rental_series SET status = 'active' WHERE id = v_series_a;
  DELETE FROM rental_series_surcharge_reviews WHERE rental_series_id = v_series_a;
  PERFORM _renter_early_close_pack(v_series_a, 'incremental');

  SELECT count(*) INTO v_review_count
  FROM rental_series_surcharge_reviews
  WHERE rental_series_id = v_series_a;

  PERFORM _test_assert(v_review_count = 0, 'incremental close skips review queue');

  DELETE FROM rental_series_surcharge_reviews WHERE rental_series_id = v_series_a;
  PERFORM _renter_maybe_queue_pack_surcharge_review(v_series_a, 'bulk_pack');

  PERFORM _renter_apply_pack_surcharge(v_series_a);

  SELECT debt_amount INTO v_debt FROM rentals WHERE id = v_slot_w1;
  PERFORM _test_assert(v_debt = 200, 'apply_pack_surcharge assigns delta 1000-800=200');

  PERFORM _test_assert(
    (SELECT count(*) FROM renter_wallet_ledger
     WHERE rental_id = v_slot_w1 AND entry_type = 'surcharge_one_time_recalc') = 0,
    'apply with zero spendable leaves wallet untouched'
  );

  -- Single-arg early_close must hit incremental overload (no auto surcharge, no review)
  UPDATE rental_series SET status = 'active' WHERE id = v_series_a;
  DELETE FROM rental_series_surcharge_reviews WHERE rental_series_id = v_series_a;
  UPDATE rentals SET debt_amount = 0, lifecycle = 'settled' WHERE id = v_slot_w1;

  PERFORM _renter_early_close_pack(v_series_a);

  SELECT count(*) INTO v_review_count
  FROM rental_series_surcharge_reviews
  WHERE rental_series_id = v_series_a;

  PERFORM _test_assert(v_review_count = 0, 'legacy single-arg early_close does not queue review');

  SELECT debt_amount INTO v_debt FROM rentals WHERE id = v_slot_w1;
  PERFORM _test_assert(
    COALESCE(v_debt, 0) = 0,
    'legacy single-arg early_close does not auto-apply surcharge'
  );
END;
$body$;

ROLLBACK;
