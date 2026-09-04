-- FE3: gate_wait retention → skipped; claim_token fencing; undelivered bootstrap count.
-- Run: psql "%DATABASE_URL%" -v ON_ERROR_STOP=1 -f supabase/tests/_hall_rent_test_jwt.sql -f supabase/tests/renter_miniapp_fe3_outbox_retention_fencing_test.sql

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
  v_org uuid := 'fe300000-0000-4000-8000-000000000101';
  v_user uuid := 'fe300000-0000-4000-8000-000000000111';
  v_member uuid := 'fe300000-0000-4000-8000-000000000121';
  v_renter uuid := 'fe300000-0000-4000-8000-000000000141';
  v_renter_user uuid := 'fe300000-0000-4000-8000-000000000155';
  v_tg bigint := 97301;
  v_id uuid;
  v_row renter_telegram_outbox%ROWTYPE;
  v_row2 renter_telegram_outbox%ROWTYPE;
  v_status text;
  v_token_a uuid;
  v_token_b uuid;
  v_count integer;
  v_max integer;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';
  v_max := _renter_outbox_gate_wait_max_count();

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES (
    v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'fe3-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES (
    v_renter_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'fe3-renter@users.invalid', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
    jsonb_build_object('actor', 'renter', 'organization_id', v_org::text, 'telegram_id', v_tg::text),
    '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'FE3 Org', 'fe3-org', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime';

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'FE3 Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO organization_addons (organization_id, addon_code, status, period_start, period_end)
  VALUES (v_org, 'renter_miniapp', 'active', CURRENT_DATE - 1, CURRENT_DATE + 365)
  ON CONFLICT (organization_id, addon_code) DO UPDATE SET status = 'active';

  INSERT INTO organization_renter_channel (organization_id, bot_username, app_short_name)
  VALUES (v_org, 'fe3bot', 'hall')
  ON CONFLICT (organization_id) DO UPDATE SET bot_username = 'fe3bot', app_short_name = 'hall';

  INSERT INTO renters (id, organization_id, display_name, telegram_id, status, auth_user_id)
  VALUES (v_renter, v_org, 'FE3 Renter', v_tg, 'active', v_renter_user)
  ON CONFLICT (id) DO UPDATE SET telegram_id = EXCLUDED.telegram_id, auth_user_id = EXCLUDED.auth_user_id;

  DELETE FROM renter_telegram_outbox WHERE organization_id = v_org;

  -- ---------------------------------------------------------------------------
  -- gate_wait retention → skipped (no_bot_started)
  -- ---------------------------------------------------------------------------
  v_id := _renter_enqueue_telegram(
    v_org, v_renter, 'test_gate', 'gate retention test', 'fe3_gate:' || gen_random_uuid()::text
  );

  SELECT c.* INTO v_row
  FROM claim_renter_telegram_outbox(50, 'fe3-worker', 120) c
  WHERE c.id = v_id
  LIMIT 1;
  PERFORM _test_assert(v_row.id = v_id, 'claimed gate row');
  PERFORM _test_assert(v_row.claim_token IS NOT NULL, 'claim issues token');

  UPDATE renter_telegram_outbox
  SET gate_wait_count = v_max - 1
  WHERE id = v_id;

  PERFORM complete_renter_telegram_outbox(v_id, 'gate_wait', 'no_bot_started', 60, v_row.claim_token);

  SELECT status, last_error_code, gate_wait_count
  INTO v_status, v_row.last_error_code, v_row.gate_wait_count
  FROM renter_telegram_outbox
  WHERE id = v_id;

  PERFORM _test_assert(v_status = 'skipped', 'gate_wait max → skipped not eternal pending');
  PERFORM _test_assert(v_row.last_error_code = 'no_bot_started', 'skipped keeps gate reason');

  -- ---------------------------------------------------------------------------
  -- time retention (7 days) → skipped
  -- ---------------------------------------------------------------------------
  v_id := _renter_enqueue_telegram(
    v_org, v_renter, 'test_old', 'old retention', 'fe3_old:' || gen_random_uuid()::text
  );

  UPDATE renter_telegram_outbox
  SET created_at = now() - _renter_outbox_gate_retention_interval() - interval '1 hour'
  WHERE id = v_id;

  SELECT c.* INTO v_row
  FROM claim_renter_telegram_outbox(50, 'fe3-worker', 120) c
  WHERE c.id = v_id
  LIMIT 1;
  PERFORM complete_renter_telegram_outbox(v_id, 'gate_wait', 'blocked', 60, v_row.claim_token);

  SELECT status INTO v_status FROM renter_telegram_outbox WHERE id = v_id;
  PERFORM _test_assert(v_status = 'skipped', 'age retention → skipped');

  -- ---------------------------------------------------------------------------
  -- lease race: stale claim cannot mark sent
  -- ---------------------------------------------------------------------------
  v_id := _renter_enqueue_telegram(
    v_org, v_renter, 'test_fence', 'fencing test', 'fe3_fence:' || gen_random_uuid()::text
  );

  SELECT c.* INTO v_row
  FROM claim_renter_telegram_outbox(50, 'worker-a', 120) c
  WHERE c.id = v_id
  LIMIT 1;
  v_token_a := v_row.claim_token;

  UPDATE renter_telegram_outbox
  SET locked_at = now() - interval '121 seconds'
  WHERE id = v_id;

  SELECT c.* INTO v_row2
  FROM claim_renter_telegram_outbox(50, 'worker-b', 120) c
  WHERE c.id = v_id
  LIMIT 1;
  v_token_b := v_row2.claim_token;
  PERFORM _test_assert(v_token_b IS DISTINCT FROM v_token_a, 'reclaim issues new token');

  PERFORM complete_renter_telegram_outbox(v_id, 'sent', NULL, NULL, v_token_a);

  SELECT status INTO v_status FROM renter_telegram_outbox WHERE id = v_id;
  PERFORM _test_assert(v_status = 'processing', 'stale token cannot complete sent');

  PERFORM complete_renter_telegram_outbox(v_id, 'sent', NULL, NULL, v_token_b);
  SELECT status INTO v_status FROM renter_telegram_outbox WHERE id = v_id;
  PERFORM _test_assert(v_status = 'sent', 'valid token completes sent');

  -- ---------------------------------------------------------------------------
  -- undelivered count + ack
  -- ---------------------------------------------------------------------------
  v_count := _renter_outbox_unacknowledged_skipped_count(v_org, v_renter);
  PERFORM _test_assert(v_count >= 2, 'unacknowledged skipped count');

  PERFORM set_config('request.jwt.claim.sub', v_renter_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', v_renter_user::text,
      'role', 'authenticated',
      'app_metadata', json_build_object(
        'actor', 'renter',
        'organization_id', v_org::text,
        'telegram_id', v_tg::text
      )
    )::text,
    true
  );

  PERFORM renter_ack_outbox_skipped();

  v_count := _renter_outbox_unacknowledged_skipped_count(v_org, v_renter);
  PERFORM _test_assert(v_count = 0, 'ack clears undelivered count');

  RAISE NOTICE 'renter_miniapp_fe3_outbox_retention_fencing_test: OK';
END;
$$;

ROLLBACK;
