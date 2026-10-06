-- E4: roster journal (Lite mark_roster_attendance, payroll unchanged).
-- Run: npm run test:db:editions-e4

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
  v_org uuid := 'e4a11111-1111-4111-8111-111111111111';
  v_owner_user uuid := 'e4a44444-4444-4444-8444-444444444444';
  v_owner_member uuid := 'e4a55555-5555-4555-8555-555555555555';
  v_client uuid := 'e4a22222-2222-4222-8222-222222222222';
  v_class uuid := 'e4a33333-3333-4333-8333-333333333333';
  v_disc uuid;
  v_loc uuid;
  v_payroll_before int;
  v_payroll_after int;
  v_mark jsonb;
  v_today text := to_char(current_date, 'YYYY-MM-DD');
BEGIN
  UPDATE platform_runtime_flags
  SET value = '{"enabled": true}'::jsonb
  WHERE key = 'editions_lifecycle';

  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2' LIMIT 1;
  PERFORM _test_assert(v_version_id IS NOT NULL, 'crm v2 version exists');

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at
  ) VALUES (
    v_owner_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'e4-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'E4 Org', 'e4-org', 'licensed', v_version_id, v_owner_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = v_owner_user;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name, is_active)
  VALUES (v_owner_member, v_org, v_owner_user, 'owner', 'E4 Owner', true)
  ON CONFLICT (organization_id, user_id) DO NOTHING;

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

  INSERT INTO clients (id, organization_id, first_name, last_name)
  VALUES (v_client, v_org, 'Roster', 'Student')
  ON CONFLICT (id) DO NOTHING;

  SELECT id INTO v_disc FROM disciplines WHERE organization_id = v_org LIMIT 1;
  IF v_disc IS NULL THEN
    INSERT INTO disciplines (organization_id, name)
    VALUES (v_org, 'Tango E4')
    RETURNING id INTO v_disc;
  END IF;

  SELECT id INTO v_loc FROM locations WHERE organization_id = v_org LIMIT 1;
  IF v_loc IS NULL THEN
    INSERT INTO locations (organization_id, name)
    VALUES (v_org, 'Hall E4')
    RETURNING id INTO v_loc;
  END IF;

  INSERT INTO classes (id, organization_id, name, discipline_id, default_location_id)
  VALUES (v_class, v_org, 'E4 Group', v_disc, v_loc)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO schedule_group_roster (organization_id, schedule_group_id, client_id)
  VALUES (v_org, v_class, v_client)
  ON CONFLICT DO NOTHING;

  PERFORM set_config('request.jwt.claim.sub', v_owner_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', v_owner_user,
      'role', 'authenticated',
      'organization_id', v_org,
      'member_id', v_owner_member
    )::text,
    true
  );
  PERFORM set_active_organization(v_org);

  SELECT count(*) INTO v_payroll_before
  FROM teacher_settlement_line_items
  WHERE organization_id = v_org;

  v_mark := mark_roster_attendance(v_today, v_class, v_client, 'present');
  PERFORM _test_assert((v_mark ->> 'success')::boolean, 'mark_roster_attendance ok on Lite');

  SELECT count(*) INTO v_payroll_after
  FROM teacher_settlement_line_items
  WHERE organization_id = v_org;
  PERFORM _test_assert(v_payroll_before = v_payroll_after, 'roster mark: payroll lines unchanged');

  PERFORM _test_assert(
    EXISTS (
      SELECT 1
      FROM roster_attendance ra
      WHERE ra.organization_id = v_org
        AND ra.client_id = v_client
        AND ra.attendance_status = 'present'
    ),
    'roster_attendance row written'
  );

  UPDATE platform_runtime_flags
  SET value = '{"enabled": false}'::jsonb
  WHERE key = 'editions_lifecycle';
END;
$$;

COMMIT;
