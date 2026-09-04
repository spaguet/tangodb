-- FE1: outbox recipient rebind enqueue→drain; bot identity on Start gate; bootstrap bot_url.
-- Run: psql "%DATABASE_URL%" -v ON_ERROR_STOP=1 -f supabase/tests/_hall_rent_test_jwt.sql -f supabase/tests/renter_miniapp_fe1_outbox_rebind_test.sql

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
  v_org uuid := 'fe100000-0000-4000-8000-000000000101';
  v_user uuid := 'fe100000-0000-4000-8000-000000000111';
  v_member uuid := 'fe100000-0000-4000-8000-000000000121';
  v_renter uuid := 'fe100000-0000-4000-8000-000000000141';
  v_tg_old bigint := 97101;
  v_tg_new bigint := 97102;
  v_bot_a bigint := 700001;
  v_bot_b bigint := 700002;
  v_id uuid;
  v_prep jsonb;
  v_gate jsonb;
  v_row renter_telegram_outbox%ROWTYPE;
  v_boot jsonb;
  v_url text;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES (
    v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'fe1-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'FE1 Org', 'fe1-org', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime';

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'FE1 Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO organization_addons (organization_id, addon_code, status, period_start, period_end)
  VALUES (v_org, 'renter_miniapp', 'active', CURRENT_DATE - 1, CURRENT_DATE + 365)
  ON CONFLICT (organization_id, addon_code) DO UPDATE SET status = 'active';

  INSERT INTO organization_renter_channel (organization_id, bot_username, app_short_name, telegram_bot_id)
  VALUES (v_org, 'fe1studio', 'hall', v_bot_a)
  ON CONFLICT (organization_id) DO UPDATE SET
    bot_username = 'fe1studio',
    app_short_name = 'hall',
    telegram_bot_id = v_bot_a;

  INSERT INTO renters (id, organization_id, display_name, telegram_id, status)
  VALUES (v_renter, v_org, 'FE1 Renter', v_tg_old, 'active')
  ON CONFLICT (id) DO UPDATE SET telegram_id = EXCLUDED.telegram_id;

  -- bot open URL from username only
  v_url := _renter_telegram_bot_open_url(v_org);
  PERFORM _test_assert(v_url = 'https://t.me/fe1studio', 'bot open URL from username');

  -- enqueue with old telegram snapshot
  v_id := _renter_enqueue_telegram(v_org, v_renter, 'fe1_rebind', 'FE1 rebind test', 'fe1_rebind');
  PERFORM _test_assert(v_id IS NOT NULL, 'enqueue ok');
  SELECT telegram_id INTO v_tg_old FROM renter_telegram_outbox WHERE id = v_id;
  PERFORM _test_assert(v_tg_old = 97101, 'enqueue snapshot old tg');

  -- rebind renter before drain
  UPDATE renters SET telegram_id = v_tg_new WHERE id = v_renter;

  -- no Start on new id → gate_wait
  v_prep := renter_telegram_outbox_prepare_send(v_id);
  PERFORM _test_assert(v_prep ->> 'action' = 'gate_wait', 'rebind without Start → gate_wait');
  PERFORM _test_assert((v_prep ->> 'telegram_id')::bigint = v_tg_new, 'prepare redirects to new tg');
  SELECT telegram_id INTO v_tg_new FROM renter_telegram_outbox WHERE id = v_id;
  PERFORM _test_assert(v_tg_new = 97102, 'outbox row updated to new tg');

  -- old telegram dialog with Start must not receive (gate uses new id only)
  INSERT INTO renter_telegram_dialog (organization_id, telegram_id, bot_started_at, bot_started_bot_id, allows_write_to_pm)
  VALUES (v_org, 97101, now(), v_bot_a, true)
  ON CONFLICT (organization_id, telegram_id) DO UPDATE SET
    bot_started_at = now(),
    bot_started_bot_id = v_bot_a,
    allows_write_to_pm = true;

  v_prep := renter_telegram_outbox_prepare_send(v_id);
  PERFORM _test_assert(v_prep ->> 'action' = 'gate_wait', 'old id Start does not help after rebind');

  -- Start on new id → send
  INSERT INTO renter_telegram_dialog (organization_id, telegram_id, bot_started_at, bot_started_bot_id, allows_write_to_pm)
  VALUES (v_org, 97102, now(), v_bot_a, true)
  ON CONFLICT (organization_id, telegram_id) DO UPDATE SET
    bot_started_at = now(),
    bot_started_bot_id = v_bot_a,
    allows_write_to_pm = true;

  v_prep := renter_telegram_outbox_prepare_send(v_id);
  PERFORM _test_assert(v_prep ->> 'action' = 'send', 'new id with Start → send');
  PERFORM _test_assert((v_prep ->> 'telegram_id')::bigint = 97102, 'send target is new id');

  -- unbound at send time (enqueue while bound, then clear telegram_id)
  UPDATE renters SET telegram_id = 97102 WHERE id = v_renter;
  v_id := _renter_enqueue_telegram(v_org, v_renter, 'fe1_unbound', 'unbound', 'fe1_unbound');
  PERFORM _test_assert(v_id IS NOT NULL, 'enqueue before unbind');
  UPDATE renters SET telegram_id = NULL WHERE id = v_renter;
  v_prep := renter_telegram_outbox_prepare_send(v_id);
  PERFORM _test_assert(v_prep ->> 'action' = 'skip', 'unbound renter → skip');
  PERFORM _test_assert(v_prep ->> 'reason' = 'recipient_unbound', 'skip reason recipient_unbound');

  -- bot identity: Start for bot A invalid after org switches to bot B
  UPDATE renters SET telegram_id = 97102 WHERE id = v_renter;
  UPDATE organization_renter_channel SET telegram_bot_id = v_bot_b WHERE organization_id = v_org;

  v_gate := renter_telegram_outbox_send_gate(v_org, 97102);
  PERFORM _test_assert((v_gate ->> 'can_send')::boolean IS FALSE, 'stale Start bot id → no send');
  PERFORM _test_assert(v_gate ->> 'skip_reason' = 'no_bot_started', 'stale Start → no_bot_started');

  PERFORM renter_telegram_webhook_ingest(jsonb_build_object(
    'organization_id', v_org::text,
    'telegram_id', '97102',
    'telegram_bot_id', v_bot_b::text,
    'update_id', '1',
    'is_start', true,
    'allows_write', true
  ));

  v_gate := renter_telegram_outbox_send_gate(v_org, 97102);
  PERFORM _test_assert((v_gate ->> 'can_send')::boolean, 'Start on new bot → can send');

  -- sent redacts text
  v_id := _renter_enqueue_telegram(v_org, v_renter, 'fe1_redact', 'secret balance info', 'fe1_redact');
  v_prep := renter_telegram_outbox_prepare_send(v_id);
  PERFORM _test_assert(v_prep ->> 'action' = 'send', 'redact test enqueue sendable');
  PERFORM complete_renter_telegram_outbox(v_id, 'sent');
  SELECT * INTO v_row FROM renter_telegram_outbox WHERE id = v_id;
  PERFORM _test_assert(v_row.text = '.', 'sent clears sensitive text');
  PERFORM _test_assert(v_row.status = 'sent', 'status sent');

  RAISE NOTICE 'renter_miniapp_fe1_outbox_rebind_test: OK';
END;
$$;

ROLLBACK;
