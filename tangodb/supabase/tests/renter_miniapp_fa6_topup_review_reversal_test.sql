-- FA6 / P0-01 operational: staff topup preview + append-only topup_reversal.
-- Run: npm run test:db:renter-miniapp-fa6

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
  v_org uuid := 'fa600000-0000-4000-8000-000000000001';
  v_user uuid := 'fa600000-0000-4000-8000-000000000011';
  v_member uuid := 'fa600000-0000-4000-8000-000000000021';
  v_renter uuid := 'fa600000-0000-4000-8000-000000000041';
  v_key uuid;
  v_result jsonb;
  v_preview jsonb;
  v_balance numeric;
  v_ledger_id uuid;
  v_reversal_id uuid;
  v_n int;
  v_entries jsonb;
  v_entry jsonb;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES (
    v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'fa6-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
    '{}'::jsonb, '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'FA6 Topup Review Org', 'fa6-topup-review', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime', activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'FA6 Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO UPDATE SET
    timezone = EXCLUDED.timezone,
    currency_code = EXCLUDED.currency_code;

  INSERT INTO renters (id, organization_id, display_name, status)
  VALUES (v_renter, v_org, 'FA6 Topup Renter', 'active')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_addons (organization_id, addon_code, status, period_start, period_end)
  VALUES (v_org, 'renter_miniapp', 'active', CURRENT_DATE - 1, CURRENT_DATE + 365)
  ON CONFLICT (organization_id, addon_code) DO UPDATE SET
    status = 'active', period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end;

  DELETE FROM renter_wallet_ledger WHERE renter_id = v_renter;
  DELETE FROM rental_advances WHERE renter_id = v_renter;
  DELETE FROM operation_idempotency
  WHERE organization_id = v_org AND scope = 'staff_renter_wallet_topup';

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');

  -- Preview before credit
  v_preview := preview_staff_renter_wallet_topup(jsonb_build_object(
    'renter_id', v_renter,
    'amount', 250,
    'method', 'cash',
    'external_reference', 'CHK-123'
  ));
  PERFORM _test_assert((v_preview ->> 'success')::boolean, 'FA6 preview: success');
  PERFORM _test_assert(
    (v_preview ->> 'renter_name') = 'FA6 Topup Renter',
    'FA6 preview: renter name'
  );
  PERFORM _test_assert(
    (v_preview -> 'effect' ->> 'wallet_balance_before')::numeric = 0,
    'FA6 preview: balance before 0'
  );
  PERFORM _test_assert(
    (v_preview -> 'effect' ->> 'wallet_balance_after')::numeric = 250,
    'FA6 preview: balance after 250'
  );
  PERFORM _test_assert(
    v_preview ->> 'external_reference' = 'CHK-123',
    'FA6 preview: external reference echoed'
  );

  -- Staff topup with external reference
  v_key := gen_random_uuid();
  v_result := staff_renter_wallet_topup(jsonb_build_object(
    'renter_id', v_renter,
    'amount', 250,
    'method', 'cash',
    'idempotency_key', v_key,
    'external_reference', 'CHK-123'
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'FA6 topup: success');

  SELECT id INTO v_ledger_id
  FROM renter_wallet_ledger
  WHERE renter_id = v_renter AND entry_type = 'topup'
  ORDER BY created_at DESC
  LIMIT 1;

  PERFORM _test_assert(v_ledger_id IS NOT NULL, 'FA6 topup: ledger row exists');
  PERFORM _test_assert(
    (SELECT external_reference FROM renter_wallet_ledger WHERE id = v_ledger_id) = 'CHK-123',
    'FA6 topup: external_reference stored'
  );

  v_balance := _renter_wallet_balance(v_org, v_renter);
  PERFORM _test_assert(v_balance = 250, 'FA6 topup: balance +250 (got ' || v_balance || ')');

  -- get_renter_detail exposes can_reverse on fresh topup
  v_result := get_renter_detail(v_renter);
  v_entries := v_result -> 'finance' -> 'wallet_entries';
  PERFORM _test_assert(jsonb_typeof(v_entries) = 'array', 'FA6 detail: wallet_entries array');
  v_entry := v_entries -> 0;
  PERFORM _test_assert(
    (v_entry ->> 'entry_type') = 'topup'
    AND (v_entry ->> 'can_reverse')::boolean,
    'FA6 detail: can_reverse on topup'
  );

  -- Reversal requires reason
  v_result := reverse_renter_wallet_topup(jsonb_build_object(
    'ledger_entry_id', v_ledger_id,
    'reason', 'ab',
    'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert(
    v_result ->> 'error' = 'renter.topup.reversalReasonRequired',
    'FA6 reversal: short reason rejected'
  );

  -- Append-only reversal
  v_result := reverse_renter_wallet_topup(jsonb_build_object(
    'ledger_entry_id', v_ledger_id,
    'reason', 'Wrong renter credited',
    'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'FA6 reversal: success');
  v_reversal_id := (v_result ->> 'reversal_id')::uuid;
  PERFORM _test_assert(v_reversal_id IS NOT NULL, 'FA6 reversal: reversal_id returned');

  v_balance := _renter_wallet_balance(v_org, v_renter);
  PERFORM _test_assert(v_balance = 0, 'FA6 reversal: balance back to 0 (got ' || v_balance || ')');

  SELECT count(*) INTO v_n
  FROM renter_wallet_ledger
  WHERE renter_id = v_renter AND entry_type = 'topup';
  PERFORM _test_assert(v_n = 1, 'FA6 reversal: original topup row preserved');

  SELECT count(*) INTO v_n
  FROM renter_wallet_ledger
  WHERE renter_id = v_renter AND entry_type = 'topup_reversal';
  PERFORM _test_assert(v_n = 1, 'FA6 reversal: one reversal row');

  PERFORM _test_assert(
    (SELECT correction_reason FROM renter_wallet_ledger WHERE id = v_reversal_id) = 'Wrong renter credited',
    'FA6 reversal: reason stored'
  );

  -- Second reversal blocked
  v_result := reverse_renter_wallet_topup(jsonb_build_object(
    'ledger_entry_id', v_ledger_id,
    'reason', 'Duplicate attempt',
    'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert(
    v_result ->> 'error' = 'renter.topup.reversalAlreadyApplied',
    'FA6 reversal: duplicate blocked'
  );

  v_result := get_renter_detail(v_renter);
  v_entries := v_result -> 'finance' -> 'wallet_entries';
  PERFORM _test_assert(
    NOT COALESCE((v_entries -> 1 ->> 'can_reverse')::boolean, false),
    'FA6 detail: reversed topup not reversible again'
  );

  RAISE NOTICE 'renter_miniapp_fa6_topup_review_reversal_test: FA6 invariants passed';
END;
$$;

ROLLBACK;
