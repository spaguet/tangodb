-- R4: outbox enqueue, send gate, dedupe, plain text, addon gate.
-- Run: psql "%DATABASE_URL%" -v ON_ERROR_STOP=1 -f supabase/tests/_hall_rent_test_jwt.sql -f supabase/tests/renter_miniapp_r4_outbox_test.sql

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
  v_org uuid := 'a1d00000-0000-4000-8000-000000000101';
  v_org_off uuid := 'a1d00000-0000-4000-8000-000000000102';
  v_user uuid := 'a1d00000-0000-4000-8000-000000000111';
  v_member uuid := 'a1d00000-0000-4000-8000-000000000121';
  v_loc uuid := 'a1d00000-0000-4000-8000-0000000001aa';
  v_renter uuid := 'a1d00000-0000-4000-8000-000000000141';
  v_renter_off uuid := 'a1d00000-0000-4000-8000-000000000142';
  v_tg bigint := 94001;
  v_tg_off bigint := 94002;
  v_rental uuid;
  v_id uuid;
  v_id2 uuid;
  v_n int;
  v_gate jsonb;
  v_plain text;
  v_long text;
  v_href text;
  v_row renter_telegram_outbox%ROWTYPE;
  v_status text;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES (
    v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'r4-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES
    (v_org, 'R4 Outbox Org', 'r4-outbox', 'licensed', v_version_id, v_user),
    (v_org_off, 'R4 Off Org', 'r4-off', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'R4 Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru'), (v_org_off, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES (v_loc, v_org, 'Hall R4', true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO renters (id, organization_id, display_name, telegram_id, status)
  VALUES
    (v_renter, v_org, 'R4 <Test> & Co', v_tg, 'active'),
    (v_renter_off, v_org_off, 'R4 Off', v_tg_off, 'active')
  ON CONFLICT (id) DO UPDATE SET telegram_id = EXCLUDED.telegram_id;

  INSERT INTO organization_addons (organization_id, addon_code, status, period_start, period_end)
  VALUES (v_org, 'renter_miniapp', 'active', CURRENT_DATE - 1, CURRENT_DATE + 365)
  ON CONFLICT (organization_id, addon_code) DO UPDATE SET status = 'active';

  DELETE FROM organization_addons WHERE organization_id = v_org_off AND addon_code = 'renter_miniapp';

  INSERT INTO organization_renter_channel (organization_id, bot_username, app_short_name)
  VALUES (v_org, 'r4bot', 'hall')
  ON CONFLICT (organization_id) DO UPDATE SET bot_username = 'r4bot', app_short_name = 'hall';

  INSERT INTO location_rental_hour_rates (organization_id, location_id, kind, price, currency, valid_from)
  VALUES (v_org, v_loc, 'one_time', 1000, 'RUB', DATE '2000-01-01');

  -- plain text escape
  v_plain := _renter_telegram_plain('Hello <b>World</b> & Co');
  PERFORM _test_assert(v_plain NOT LIKE '%<%', 'angle brackets escaped');
  PERFORM _test_assert(v_plain LIKE '%и Co%', 'ampersand replaced');

  -- 4096 cap at enqueue
  v_long := repeat('x', 5000);
  v_id := _renter_enqueue_telegram(v_org, v_renter, 'test_long', v_long, 'test_long');
  SELECT char_length(text) INTO v_n FROM renter_telegram_outbox WHERE id = v_id;
  PERFORM _test_assert(v_n = 4096, 'text truncated to 4096 on enqueue');

  -- addon off → no row
  v_id := _renter_enqueue_telegram(v_org_off, v_renter_off, 'addon_off', 'no row', 'addon_off');
  PERFORM _test_assert(v_id IS NULL, 'addon off → no enqueue');

  -- send gate: mint allows_write without Start
  INSERT INTO renter_telegram_dialog (organization_id, telegram_id, allows_write_to_pm)
  VALUES (v_org, v_tg, true)
  ON CONFLICT (organization_id, telegram_id) DO UPDATE SET
    allows_write_to_pm = true,
    bot_started_at = NULL;

  v_gate := renter_telegram_outbox_send_gate(v_org, v_tg);
  PERFORM _test_assert((v_gate ->> 'can_send')::boolean IS FALSE, 'allows_write without Start → no send');
  PERFORM _test_assert(v_gate ->> 'skip_reason' = 'no_bot_started', 'skip reason no_bot_started');

  -- after Start → can send
  UPDATE renter_telegram_dialog
  SET bot_started_at = now(), allows_write_to_pm = true
  WHERE organization_id = v_org AND telegram_id = v_tg;

  v_gate := renter_telegram_outbox_send_gate(v_org, v_tg);
  PERFORM _test_assert((v_gate ->> 'can_send')::boolean, 'bot_started → can send');

  -- blocked
  UPDATE renter_telegram_dialog
  SET allows_write_to_pm = false
  WHERE organization_id = v_org AND telegram_id = v_tg;

  v_gate := renter_telegram_outbox_send_gate(v_org, v_tg);
  PERFORM _test_assert((v_gate ->> 'can_send')::boolean IS FALSE, 'blocked → no send');
  PERFORM _test_assert(v_gate ->> 'skip_reason' = 'blocked', 'skip reason blocked');

  UPDATE renter_telegram_dialog
  SET allows_write_to_pm = true
  WHERE organization_id = v_org AND telegram_id = v_tg;

  -- Mini App button href not arbitrary URL
  v_href := _renter_miniapp_direct_link(v_org);
  PERFORM _test_assert(
    v_href = 'https://t.me/r4bot/hall?startapp=' || v_org::text,
    'outbox button href from getMe + short name'
  );
  PERFORM _test_assert(v_href NOT LIKE '%mini_app_url%', 'not stored mini_app_url');

  -- auto_deleted dedupe (mark_terminal enqueue once)
  INSERT INTO rentals (
    organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, hold_expires_at,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, calculated_amount, currency
  )
  VALUES (
    v_org, v_renter, v_loc, CURRENT_DATE + 14, '10:00', '11:00',
    'confirmed', 'miniapp', 'awaiting_payment', now() + interval '1 hour',
    500, 500, 0, 1000, 1000, 'RUB'
  )
  RETURNING id INTO v_rental;

  PERFORM _renter_mark_terminal(v_rental, 'auto_deleted', 'miniapp_auto_deleted', NULL);
  PERFORM _renter_mark_terminal(v_rental, 'auto_deleted', 'miniapp_auto_deleted', NULL);

  SELECT count(*) INTO v_n
  FROM renter_telegram_outbox
  WHERE rental_id = v_rental AND event_type = 'auto_deleted';
  PERFORM _test_assert(v_n = 1, 'auto_deleted enqueue once (dedupe)');

  -- complete dead does not retry forever
  SELECT * INTO v_row
  FROM renter_telegram_outbox
  WHERE rental_id = v_rental AND event_type = 'auto_deleted'
  LIMIT 1;

  PERFORM complete_renter_telegram_outbox(v_row.id, 'dead', 'forbidden');
  SELECT status INTO v_status FROM renter_telegram_outbox WHERE id = v_row.id;
  PERFORM _test_assert(v_status = 'dead', '403/forbidden → dead letter');

  -- R5 stubs callable
  v_id := _renter_enqueue_booking_banned(v_org, v_renter);
  v_id2 := _renter_enqueue_penalty_tariff(v_org, v_renter);
  PERFORM _test_assert(v_id IS NOT NULL AND v_id2 IS NOT NULL, 'R5 enqueue stubs exist');

  RAISE NOTICE 'renter_miniapp_r4_outbox_test: OK';
END;
$$;

ROLLBACK;
