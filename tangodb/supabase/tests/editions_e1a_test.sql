-- E1a: one_raising XOR (studio_monthly + pro_lifetime → unique violation).
-- Run: npm run test:db:editions-e1a

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
  v_org uuid := 'e1a11111-1111-4111-8111-111111111111';
  v_raised boolean := false;
  v_n int;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2' LIMIT 1;
  PERFORM _test_assert(v_version_id IS NOT NULL, 'crm v2 version exists');

  INSERT INTO organizations (
    id, name, slug, status, crm_version_id, owner_user_id
  )
  VALUES (
    v_org, 'E1a XOR Org', 'e1a-xor-org', 'licensed', v_version_id, NULL
  )
  ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status;

  INSERT INTO organization_edition_state (
    organization_id, active_edition, changed_at, change_reason
  )
  VALUES (v_org, 'pro', now(), 'admin_adjust')
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO organization_entitlements (
    organization_id, edition, instrument, status,
    period_start, period_end, billing_anchor_day
  )
  VALUES (
    v_org, 'lite', 'free_lifetime', 'active', NULL, NULL, NULL
  );

  INSERT INTO organization_entitlements (
    organization_id, edition, instrument, status,
    period_start, period_end, billing_anchor_day
  )
  VALUES (
    v_org, 'studio', 'studio_monthly', 'active',
    now(), now() + interval '30 days', 1
  );

  BEGIN
    INSERT INTO organization_entitlements (
      organization_id, edition, instrument, status, period_start, period_end
    )
    VALUES (
      v_org, 'pro', 'pro_lifetime', 'active', NULL, NULL
    );
  EXCEPTION
    WHEN unique_violation THEN v_raised := true;
  END;

  PERFORM _test_assert(v_raised, 'one_raising must block studio_monthly + pro_lifetime');

  SELECT count(*)::int INTO v_n
  FROM organization_entitlements e
  WHERE e.organization_id = v_org
    AND e.status IN ('active', 'past_due')
    AND e.instrument IN ('trial_pro', 'studio_monthly', 'pro_monthly', 'pro_lifetime');

  PERFORM _test_assert(v_n = 1, 'only one raising instrument may be live');

  PERFORM _test_assert(NOT editions_lifecycle_enabled(), 'editions_lifecycle seed must be off');
END;
$$;

ROLLBACK;
