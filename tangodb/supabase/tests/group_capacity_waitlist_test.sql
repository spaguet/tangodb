-- Group capacity and waitlist tests (CRM scenario 6)

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
  v_org uuid := 'f6111111-1111-4111-8111-111111111111';
  v_owner uuid := 'f6222222-2222-4222-8222-222222222222';
  v_disc uuid;
  v_loc uuid;
  v_class uuid := 'f6333333-3333-4333-8333-333333333333';
  v_client1 uuid := 'f6444444-4444-4444-8444-444444444444';
  v_client2 uuid := 'f6555555-5555-4555-8555-555555555555';
  v_client3 uuid := 'f6666666-6666-4666-8666-666666666666';
  v_price uuid;
  v_sub uuid;
  v_result jsonb;
  v_entry uuid;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2' LIMIT 1;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'capacity-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'Capacity Org', 'capacity-org', 'licensed', v_version_id, v_owner)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT DO NOTHING;

  INSERT INTO organization_members (organization_id, user_id, role, is_active)
  VALUES (v_org, v_owner, 'owner', true)
  ON CONFLICT DO NOTHING;

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.organization_id', v_org::text, true);
  PERFORM set_config('request.jwt.claim.member_role', 'owner', true);

  INSERT INTO disciplines (organization_id, name, description)
  VALUES (v_org, 'Tango capacity', '')
  RETURNING id INTO v_disc;

  INSERT INTO locations (organization_id, name)
  VALUES (v_org, 'Hall capacity')
  RETURNING id INTO v_loc;

  INSERT INTO classes (id, organization_id, name, discipline_id, default_location_id, max_capacity)
  VALUES (v_class, v_org, 'Capacity group', v_disc, v_loc, 2);

  INSERT INTO clients (id, organization_id, first_name, last_name)
  VALUES
    (v_client1, v_org, 'One', 'Client'),
    (v_client2, v_org, 'Two', 'Client'),
    (v_client3, v_org, 'Three', 'Client');

  INSERT INTO prices (organization_id, type, label, lessons, price, category, billing_model)
  VALUES (v_org, 'solo', '8 lessons', 8, 1000, 'group', 'lesson_count')
  RETURNING id INTO v_price;

  PERFORM _test_assert(count_group_occupied_seats(v_org, v_class, CURRENT_DATE) = 0, 'empty group');

  v_sub := gen_random_uuid();
  v_result := create_group_subscription(
    'solo', v_client1, NULL, NULL, NULL,
    8, CURRENT_DATE, '', v_disc, v_price, 'lesson_count',
    ARRAY[v_class], v_sub, NULL, NULL
  );
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'first sale ok');
  PERFORM _test_assert(count_group_occupied_seats(v_org, v_class, CURRENT_DATE) = 1, 'one seat occupied');

  v_result := create_group_subscription(
    'solo', v_client2, NULL, NULL, NULL,
    8, CURRENT_DATE, '', v_disc, v_price, 'lesson_count',
    ARRAY[v_class], gen_random_uuid(), NULL, NULL
  );
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'second sale ok');
  PERFORM _test_assert(count_group_occupied_seats(v_org, v_class, CURRENT_DATE) = 2, 'two seats occupied');

  v_result := create_group_subscription(
    'solo', v_client3, NULL, NULL, NULL,
    8, CURRENT_DATE, '', v_disc, v_price, 'lesson_count',
    ARRAY[v_class], gen_random_uuid(), NULL, NULL
  );
  PERFORM _test_assert((v_result ->> 'success')::boolean IS NOT TRUE, 'third sale blocked');
  PERFORM _test_assert(v_result ->> 'error' = 'group_capacity_exceeded', 'capacity error code');

  v_result := add_group_waitlist_entry(v_class, v_client3, 'Need a spot');
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'waitlist add ok');
  v_entry := (v_result ->> 'id')::uuid;

  v_result := add_group_waitlist_entry(v_class, v_client3, 'duplicate');
  PERFORM _test_assert((v_result ->> 'success')::boolean IS NOT TRUE, 'duplicate waitlist blocked');

  UPDATE subscriptions SET status = 'finished' WHERE id = v_sub;
  PERFORM notify_groups_after_subscription_release(v_sub);

  PERFORM _test_assert(
    EXISTS (
      SELECT 1 FROM group_spot_notifications gsn
      WHERE gsn.waitlist_entry_id = v_entry AND gsn.dismissed_at IS NULL
    ),
    'spot notification created'
  );

  PERFORM _test_assert(count_group_occupied_seats(v_org, v_class, CURRENT_DATE) = 1, 'finished sub freed seat');
END;
$$;

ROLLBACK;
