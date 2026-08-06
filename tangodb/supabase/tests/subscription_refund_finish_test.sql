-- subscription refund finish tests (CRM scenario 9 / Prompt 9)
-- Run: psql $DATABASE_URL -f supabase/tests/subscription_refund_finish_test.sql

BEGIN;

CREATE OR REPLACE FUNCTION _refund_test_assert(p_condition boolean, p_message text)
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
  v_org uuid := 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  v_user uuid := '88888888-8888-8888-8888-888888888888';
  v_member uuid := 'ffffffff-ffff-ffff-ffff-000000000001';
  v_client uuid := 'ffffffff-ffff-ffff-ffff-000000000101';
  v_disc uuid := 'ffffffff-ffff-ffff-ffff-000000000201';
  v_loc uuid := 'ffffffff-ffff-ffff-ffff-000000000301';
  v_class uuid := 'ffffffff-ffff-ffff-ffff-000000000401';
  v_sub uuid := 'ffffffff-ffff-ffff-ffff-000000000601';
  v_price uuid := 'ffffffff-ffff-ffff-ffff-000000000701';
  v_payment uuid := 'ffffffff-ffff-ffff-ffff-000000000801';
  v_preview jsonb;
  v_result jsonb;
  v_status text;
  v_refund_amount numeric;
  v_refund_id uuid;
  v_lessons_left int;
  v_idempotency uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    v_user,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'refund-finish@test.local',
    crypt('testpass123', gen_salt('bf')),
    now(),
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'Refund Finish Org', 'refund-finish', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'Owner Refund')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO disciplines (id, organization_id, name)
  VALUES (v_disc, v_org, 'Tango')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO locations (id, organization_id, name)
  VALUES (v_loc, v_org, 'Studio')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO classes (id, organization_id, name, discipline_id, default_location_id)
  VALUES (v_class, v_org, 'Solo Group', v_disc, v_loc)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO clients (id, organization_id, first_name, last_name)
  VALUES (v_client, v_org, 'Ivan', 'Refund')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO prices (id, organization_id, type, lessons, price, category, discipline_id)
  VALUES (v_price, v_org, 'solo', 12, 12000, 'group', v_disc)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO subscriptions (
    id, organization_id, type, client_id1, lessons_total, lessons_left,
    activation_date, status, discipline_id, price_id, category, billing_model
  )
  VALUES (
    v_sub, v_org, 'solo', v_client, 12, 5,
    CURRENT_DATE - 30, 'active', v_disc, v_price, 'group', 'lesson_count'
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO subscription_groups (organization_id, subscription_id, schedule_group_id)
  VALUES (v_org, v_sub, v_class)
  ON CONFLICT DO NOTHING;

  INSERT INTO payments (
    id, organization_id, client_id, client_display, amount, method, subscription_id, created_at
  )
  VALUES (
    v_payment, v_org, v_client, 'Refund Ivan', 12000, 'cash', v_sub, now() - interval '20 days'
  )
  ON CONFLICT (id) DO NOTHING;

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  v_preview := preview_subscription_refund(v_sub::text);
  PERFORM _refund_test_assert((v_preview ->> 'success')::boolean, 'preview should succeed');
  PERFORM _refund_test_assert(
    (v_preview #>> '{formula,recommendedAmount}')::numeric = 5000,
    '12 lessons / 12000 with 5 left should recommend 5000'
  );

  -- Single-visit rate preview: 1 used lesson @ 2500 → refund 9500
  v_sub := 'ffffffff-ffff-ffff-ffff-000000000611';
  INSERT INTO prices (id, organization_id, type, lessons, price, category, discipline_id)
  VALUES ('ffffffff-ffff-ffff-ffff-000000000711', v_org, 'solo', 1, 2500, 'single_visit', v_disc)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO subscriptions (
    id, organization_id, type, client_id1, lessons_total, lessons_left,
    activation_date, status, discipline_id, price_id, category, billing_model
  )
  VALUES (
    v_sub, v_org, 'solo', v_client, 12, 11,
    CURRENT_DATE - 20, 'active', v_disc, v_price, 'group', 'lesson_count'
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO payments (
    id, organization_id, client_id, client_display, amount, method, subscription_id, created_at
  )
  VALUES (
    'ffffffff-ffff-ffff-ffff-000000000811', v_org, v_client, 'Refund Ivan', 12000, 'cash', v_sub, now() - interval '15 days'
  )
  ON CONFLICT (id) DO NOTHING;

  v_preview := preview_subscription_refund(v_sub::text, 'single_visit_rate', 2500, NULL);
  PERFORM _refund_test_assert((v_preview ->> 'success')::boolean, 'single-visit preview should succeed');
  PERFORM _refund_test_assert(
    (v_preview #>> '{formula,recommendedAmount}')::numeric = 9500,
    '12000 - 1*2500 should recommend 9500'
  );
  PERFORM _refund_test_assert(
    v_preview #>> '{formula,calcMode}' = 'single_visit_rate',
    'formula snapshot should record single_visit_rate calc mode'
  );

  v_sub := 'ffffffff-ffff-ffff-ffff-000000000601';
  v_result := finish_subscription_with_refund(
    v_sub::text,
    v_client,
    5000,
    'transfer',
    'Переезд',
    'completed',
    current_date,
    v_idempotency
  );
  PERFORM _refund_test_assert((v_result ->> 'success')::boolean, 'finish with refund should succeed');
  PERFORM _refund_test_assert((v_result ->> 'amount')::numeric = 5000, 'refund amount should be 5000');

  SELECT status INTO v_status FROM subscriptions WHERE id = v_sub;
  PERFORM _refund_test_assert(v_status = 'finished', 'subscription should be finished');

  SELECT amount INTO v_refund_amount
  FROM subscription_refunds
  WHERE subscription_id = v_sub
  LIMIT 1;
  PERFORM _refund_test_assert(v_refund_amount = 5000, 'refund row should exist');

  v_result := finish_subscription_with_refund(
    v_sub::text,
    v_client,
    5000,
    'transfer',
    'Переезд',
    'completed',
    current_date,
    v_idempotency
  );
  PERFORM _refund_test_assert((v_result ->> 'idempotentReplay')::boolean, 'idempotent replay should be flagged');

  PERFORM _refund_test_assert(
    (SELECT COUNT(*) FROM subscription_refunds WHERE subscription_id = v_sub) = 1,
    'idempotency should not create duplicate refund'
  );

  -- Partial refund on a fresh subscription
  v_sub := 'ffffffff-ffff-ffff-ffff-000000000602';
  INSERT INTO subscriptions (
    id, organization_id, type, client_id1, lessons_total, lessons_left,
    activation_date, status, discipline_id, price_id, category, billing_model
  )
  VALUES (
    v_sub, v_org, 'solo', v_client, 8, 6,
    CURRENT_DATE - 10, 'active', v_disc, v_price, 'group', 'lesson_count'
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO payments (
    id, organization_id, client_id, client_display, amount, method, subscription_id, created_at
  )
  VALUES (
    'ffffffff-ffff-ffff-ffff-000000000802', v_org, v_client, 'Refund Ivan', 8000, 'cash', v_sub, now()
  )
  ON CONFLICT (id) DO NOTHING;

  v_result := create_subscription_refund(
    v_sub::text,
    v_client,
    2000,
    'cash',
    'Частичный возврат',
    'pending',
    current_date,
    'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
    2
  );
  PERFORM _refund_test_assert((v_result ->> 'success')::boolean, 'partial pending refund should succeed');
  PERFORM _refund_test_assert((v_result ->> 'lessonsDeducted')::int = 2, 'should deduct 2 lessons');

  SELECT status, lessons_left INTO v_status, v_lessons_left
  FROM subscriptions WHERE id = v_sub;
  PERFORM _refund_test_assert(v_status = 'active', 'partial refund keeps subscription active');
  PERFORM _refund_test_assert(v_lessons_left = 4, 'lessons_left should decrease by 2');

  SELECT id INTO v_refund_id FROM subscription_refunds
  WHERE subscription_id = v_sub AND status = 'pending' LIMIT 1;

  v_result := complete_subscription_refund(v_refund_id, current_date);
  PERFORM _refund_test_assert((v_result ->> 'success')::boolean, 'complete pending refund should succeed');
END;
$$;

ROLLBACK;
