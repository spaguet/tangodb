-- create_calendar_event_with_cancellations RPC tests (CRM scenario 3 / Prompt 3)
-- Run: psql $DATABASE_URL -f supabase/tests/calendar_events_test.sql

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
  v_org uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  v_user uuid := '66666666-6666-6666-6666-666666666666';
  v_member uuid := 'dddddddd-dddd-dddd-dddd-dddddddddd01';
  v_disc uuid := 'dddddddd-dddd-dddd-dddd-000000000101';
  v_loc uuid := 'dddddddd-dddd-dddd-dddd-000000000201';
  v_class uuid := 'dddddddd-dddd-dddd-dddd-000000000301';
  v_series uuid := 'dddddddd-dddd-dddd-dddd-000000000401';
  v_fri date := date '2026-08-07';
  v_preview jsonb;
  v_result jsonb;
  v_event_id uuid;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    v_user,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'calendar-event@test.local',
    crypt('testpass123', gen_salt('bf')),
    now(),
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'Calendar Event Org', 'calendar-event', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'Owner Event')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id)
  VALUES (v_org)
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO disciplines (id, organization_id, name)
  VALUES (v_disc, v_org, 'Tango')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO locations (id, organization_id, name)
  VALUES (v_loc, v_org, 'Studio A')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO classes (id, organization_id, name, discipline_id, default_location_id)
  VALUES (v_class, v_org, 'Group A', v_disc, v_loc)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO schedule_slots (
    id, organization_id, day_of_week, time, time_end, discipline_id, group_name,
    location_id, teacher_member_id, class_id, valid_from, valid_to
  )
  VALUES (
    v_series, v_org, 5, '15:00', '16:00', v_disc, 'Group A', v_loc, v_member, v_class,
    date '2026-01-01', NULL
  )
  ON CONFLICT (id) DO NOTHING;

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user::text)::text, true);

  UPDATE organization_members SET organization_id = v_org WHERE id = v_member;

  v_preview := preview_calendar_event_conflicts(
    jsonb_build_array(
      jsonb_build_object(
        'date', v_fri::text,
        'time_start', '14:00',
        'time_end', '20:00',
        'location_id', v_loc::text
      )
    )
  );

  PERFORM _test_assert((v_preview ->> 'success')::boolean, 'Preview should succeed');
  PERFORM _test_assert(jsonb_array_length(v_preview -> 'conflicts') >= 1, 'Should find group conflict');

  v_result := create_calendar_event_with_cancellations(
    jsonb_build_object(
      'idempotency_key', 'test-event-1',
      'title', 'Guest Master Class',
      'event_type', 'master_class',
      'guest_teacher', 'Guest Teacher',
      'income_amount', 50000,
      'paid_amount', 50000,
      'payment_status', 'paid',
      'payment_method', 'cash',
      'sessions', jsonb_build_array(
        jsonb_build_object(
          'date', v_fri::text,
          'time_start', '14:00',
          'time_end', '20:00',
          'location_id', v_loc::text
        )
      ),
      'group_cancellations', jsonb_build_array(
        jsonb_build_object('slot_id', v_series::text, 'date', v_fri::text)
      ),
      'personal_cancellations', '[]'::jsonb
    )
  );

  PERFORM _test_assert((v_result ->> 'success')::boolean, 'Create event should succeed');
  v_event_id := (v_result ->> 'event_id')::uuid;
  PERFORM _test_assert(v_event_id IS NOT NULL, 'Event id should be returned');

  PERFORM _test_assert(
    EXISTS (
      SELECT 1 FROM calendar_event_sessions ces
      WHERE ces.event_id = v_event_id AND ces.session_date = v_fri
    ),
    'Session should exist'
  );

  PERFORM _test_assert(
    EXISTS (SELECT 1 FROM other_income oi WHERE oi.calendar_event_id = v_event_id),
    'Other income row should exist'
  );

  v_result := create_calendar_event_with_cancellations(
    jsonb_build_object(
      'idempotency_key', 'test-event-1',
      'title', 'Guest Master Class',
      'event_type', 'master_class',
      'sessions', jsonb_build_array(
        jsonb_build_object(
          'date', v_fri::text,
          'time_start', '14:00',
          'time_end', '20:00',
          'location_id', v_loc::text
        )
      ),
      'group_cancellations', '[]'::jsonb,
      'personal_cancellations', '[]'::jsonb
    )
  );

  PERFORM _test_assert((v_result ->> 'already_applied')::boolean, 'Idempotent retry should return already_applied');

  v_result := update_calendar_event(
    v_event_id,
    jsonb_build_object(
      'title', 'Guest Master Class (updated)',
      'actual_guest_count', 42
    )
  );
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'Update event should succeed');

  v_result := record_calendar_event_payment(
    v_event_id,
    10000,
    'transfer',
    'partial top-up',
    'test-event-1:payment2'
  );
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'Additional payment should succeed');
  PERFORM _test_assert((v_result ->> 'payment_status') = 'paid', 'Should be fully paid');

  RAISE NOTICE 'All calendar_events tests passed.';
END;
$$;

ROLLBACK;
