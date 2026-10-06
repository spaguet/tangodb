-- E3: write-RPC edition gates (flag on in fixture, off at end).
-- Run: npm run test:db:editions-e3

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
  v_org uuid := 'e3a11111-1111-4111-8111-111111111111';
  v_before int;
  v_after int;
BEGIN
  UPDATE platform_runtime_flags
  SET value = '{"enabled": true}'::jsonb
  WHERE key = 'editions_lifecycle';

  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2' LIMIT 1;
  PERFORM _test_assert(v_version_id IS NOT NULL, 'crm v2 version exists');

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'E3 Org', 'e3-org', 'licensed', v_version_id, NULL)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed';

  INSERT INTO organization_settings (organization_id)
  VALUES (v_org)
  ON CONFLICT DO NOTHING;

  INSERT INTO organization_entitlements (
    organization_id, edition, instrument, status, period_start, period_end
  )
  VALUES (v_org, 'lite', 'free_lifetime', 'active', NULL, NULL)
  ON CONFLICT DO NOTHING;

  INSERT INTO organization_edition_state (
    organization_id, active_edition, changed_at, change_reason
  )
  VALUES (v_org, 'lite', now(), 'admin_adjust')
  ON CONFLICT (organization_id) DO UPDATE
    SET active_edition = 'lite';

  PERFORM _test_assert(
    NOT edition_allows(v_org, 'group_subscriptions'),
    'lite: group_subscriptions closed'
  );

  PERFORM enqueue_calendar_sync(v_org, 'personal_lesson', gen_random_uuid(), current_date, 'upsert');
  SELECT count(*) INTO v_before FROM calendar_sync_outbox WHERE organization_id = v_org;
  PERFORM enqueue_calendar_sync(v_org, 'personal_lesson', gen_random_uuid(), current_date + 1, 'upsert');
  SELECT count(*) INTO v_after FROM calendar_sync_outbox WHERE organization_id = v_org;
  PERFORM _test_assert(v_before = v_after, 'studio/lite: enqueue_calendar_sync no-op (F96)');

  UPDATE platform_runtime_flags
  SET value = '{"enabled": false}'::jsonb
  WHERE key = 'editions_lifecycle';
END;
$$;

COMMIT;
