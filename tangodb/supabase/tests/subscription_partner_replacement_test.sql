-- subscription partner replacement tests (CRM scenario 7 / Prompt 7)
-- Run: psql $DATABASE_URL -f supabase/tests/subscription_partner_replacement_test.sql

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
  v_org uuid := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  v_user uuid := '77777777-7777-7777-7777-777777777777';
  v_member uuid := 'eeeeeeee-eeee-eeee-eeee-000000000001';
  v_client1 uuid := 'eeeeeeee-eeee-eeee-eeee-000000000101';
  v_client2 uuid := 'eeeeeeee-eeee-eeee-eeee-000000000102';
  v_client3 uuid := 'eeeeeeee-eeee-eeee-eeee-000000000103';
  v_disc uuid := 'eeeeeeee-eeee-eeee-eeee-000000000201';
  v_loc uuid := 'eeeeeeee-eeee-eeee-eeee-000000000301';
  v_class uuid := 'eeeeeeee-eeee-eeee-eeee-000000000401';
  v_sub uuid := 'eeeeeeee-eeee-eeee-eeee-000000000601';
  v_price uuid := 'eeeeeeee-eeee-eeee-eeee-000000000701';
  v_result jsonb;
  v_lessons_left int;
  v_client_id2 uuid;
  v_display text;
  v_idempotency uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    v_user,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'partner-replace@test.local',
    crypt('testpass123', gen_salt('bf')),
    now(),
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'Partner Replace Org', 'partner-replace', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'Owner Replace')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO disciplines (id, organization_id, name)
  VALUES (v_disc, v_org, 'Tango')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO locations (id, organization_id, name)
  VALUES (v_loc, v_org, 'Studio')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO classes (id, organization_id, name, discipline_id, default_location_id)
  VALUES (v_class, v_org, 'Pair Group', v_disc, v_loc)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO clients (id, organization_id, first_name, last_name)
  VALUES
    (v_client1, v_org, 'Anna', 'Alpha'),
    (v_client2, v_org, 'Boris', 'Beta'),
    (v_client3, v_org, 'Clara', 'Gamma')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO prices (id, organization_id, type, lessons, price, category, discipline_id)
  VALUES (v_price, v_org, 'pair_hm', 8, 1000000, 'group', v_disc)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO subscriptions (
    id, organization_id, type, client_id1, client_id2, lessons_total, lessons_left,
    activation_date, status, pair_month, discipline_id, price_id, category, billing_model
  )
  VALUES (
    v_sub, v_org, 'pair_hm', v_client1, v_client2, 8, 5,
    CURRENT_DATE - 14, 'active', '', v_disc, v_price, 'group', 'lesson_count'
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO subscription_groups (organization_id, subscription_id, schedule_group_id)
  VALUES (v_org, v_sub, v_class)
  ON CONFLICT DO NOTHING;

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  v_result := replace_subscription_partner(
    v_sub::text,
    v_client2,
    v_client3,
    CURRENT_DATE,
    'Partner left',
    v_idempotency
  );

  PERFORM _test_assert((v_result ->> 'success')::boolean, 'replace must succeed');
  PERFORM _test_assert(v_result ->> 'status' = 'applied', 'immediate replacement must be applied');

  SELECT client_id2, lessons_left INTO v_client_id2, v_lessons_left
  FROM subscriptions WHERE id = v_sub;

  PERFORM _test_assert(v_client_id2 = v_client3, 'client_id2 must be updated');
  PERFORM _test_assert(v_lessons_left = 5, 'lessons_left must stay unchanged');

  v_result := replace_subscription_partner(
    v_sub::text,
    v_client2,
    v_client3,
    CURRENT_DATE,
    'Partner left',
    v_idempotency
  );
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'idempotent retry must succeed');
  PERFORM _test_assert((v_result ->> 'idempotent')::boolean, 'idempotent retry must be flagged');

  v_result := replace_subscription_partner(
    v_sub::text,
    v_client3,
    v_client2,
    CURRENT_DATE,
    'swap back'
  );
  PERFORM _test_assert((v_result ->> 'success')::boolean IS DISTINCT FROM true, 'already member must fail');

  UPDATE subscriptions SET status = 'finished' WHERE id = v_sub;
  v_result := replace_subscription_partner(
    v_sub::text,
    v_client3,
    v_client2,
    CURRENT_DATE,
    'finished sub'
  );
  PERFORM _test_assert((v_result ->> 'success')::boolean IS DISTINCT FROM true, 'finished subscription must fail');
END;
$$;

ROLLBACK;
