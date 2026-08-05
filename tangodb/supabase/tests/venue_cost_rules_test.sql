-- Internal venue cost rules regression tests.
-- Run: psql "$DATABASE_URL" -f supabase/tests/venue_cost_rules_test.sql

BEGIN;

CREATE OR REPLACE FUNCTION _venue_test_assert(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT COALESCE(p_condition, false) THEN
    RAISE EXCEPTION 'ASSERT FAILED: %', p_message;
  END IF;
END;
$$;

DO $$
DECLARE
  v_product_version uuid;
  v_org uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  v_user uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001';
  v_member uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0002';
  v_discipline uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0003';
  v_location uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0004';
  v_lesson uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0005';
  v_location_other uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0006';
  v_teacher_user uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0007';
  v_teacher_member uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0008';
  v_teacher_lesson uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0009';
  v_client uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0011';
  v_rule_id uuid;
  v_pending_rule_id uuid;
  v_fixed_rule_id uuid;
  v_disabled_rule_id uuid;
  v_expiring_rule_id uuid;
  v_future_rule_id uuid;
  v_closure_id uuid;
  v_result jsonb;
  v_status jsonb;
  v_rule venue_cost_rule_versions%ROWTYPE;
  v_count integer;
  v_key uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0010';
  v_overlap_rejected boolean := false;
  v_immutable_rejected boolean := false;
BEGIN
  SELECT id INTO v_product_version FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at
  ) VALUES (
    v_user, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'venue-cost@test.local',
    crypt('testpass123', gen_salt('bf')), now(), now(), now()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'Venue Cost Test', 'venue-cost-test', 'licensed', v_product_version, v_user)
  ON CONFLICT (id) DO UPDATE SET
    status = 'licensed',
    owner_user_id = EXCLUDED.owner_user_id;
  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_product_version, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET
    license_type = 'lifetime',
    activated_at = now();

  DELETE FROM venue_rule_gap_acknowledgements WHERE organization_id = v_org;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'Venue Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  UPDATE organization_members
  SET meta = COALESCE(meta, '{}'::jsonb) || '{"can_edit_past_schedule":true}'::jsonb
  WHERE id = v_member AND organization_id = v_org;

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at
  ) VALUES (
    v_teacher_user, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'venue-teacher@test.local',
    crypt('testpass123', gen_salt('bf')), now(), now(), now()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_teacher_member, v_org, v_teacher_user, 'teacher', 'Venue Teacher')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone)
  VALUES (v_org, 'Europe/Moscow')
  ON CONFLICT (organization_id) DO UPDATE SET timezone = EXCLUDED.timezone;

  INSERT INTO disciplines (id, organization_id, name)
  VALUES (v_discipline, v_org, 'Tango')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO locations (id, organization_id, name)
  VALUES
    (v_location, v_org, 'Main Hall'),
    (v_location_other, v_org, 'Other Hall')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO clients (id, organization_id, first_name, last_name)
  VALUES (v_client, v_org, 'Venue', 'Client')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO personal_lessons (
    id, organization_id, type, date, discipline_id, location_id,
    teacher_member_id, price, paid
  ) VALUES (
    v_lesson, v_org, 'solo', date '2026-02-10', v_discipline, v_location,
    v_member, 0, 'no'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO personal_lessons (
    id, organization_id, type, client_id1, date, discipline_id, location_id,
    teacher_member_id, price, paid
  ) VALUES (
    v_teacher_lesson, v_org, 'solo', v_client, current_date, v_discipline, v_location,
    v_teacher_member, 100, 'no'
  ) ON CONFLICT (id) DO NOTHING;

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');

  -- Existing organizations are not gated before any accepted policy.
  v_status := get_venue_cost_rule_status(date '2026-01-01');
  PERFORM _venue_test_assert(v_status ->> 'status' = 'not_configured', 'no rules is not configured');
  PERFORM _venue_test_assert(NOT (v_status ->> 'acknowledgement_required')::boolean, 'no rules does not gate');

  v_result := save_venue_cost_rule_draft(
    jsonb_build_object(
      'mode', 'per_lesson', 'valid_from', '2025-12-01', 'valid_to', '2025-12-31',
      'rules', jsonb_build_object(
        'group', '[]'::jsonb,
        'personal', jsonb_build_array(jsonb_build_object(
          'location_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'amount', 1
        ))
      )
    ),
    gen_random_uuid()
  );
  PERFORM _venue_test_assert(
    v_result ->> 'error_code' = 'invalid_rule_reference',
    'draft rejects location from outside organization'
  );

  -- Draft validation and operation idempotency.
  v_result := save_venue_cost_rule_draft(
    jsonb_build_object(
      'mode', 'per_lesson',
      'valid_from', '2026-01-01',
      'valid_to', '2026-01-31',
      'rules', jsonb_build_object(
        'currency', 'RUB',
        'group', jsonb_build_array(
          jsonb_build_object(
            'discipline_id', v_discipline, 'location_id', v_location,
            'attendance_tiers', jsonb_build_array(
              jsonb_build_object('min_attendees', 0, 'max_attendees', 4, 'amount', 1200),
              jsonb_build_object('min_attendees', 5, 'max_attendees', NULL, 'amount', 1700)
            )
          ),
          jsonb_build_object(
            'discipline_id', v_discipline,
            'attendance_tiers', jsonb_build_array(
              jsonb_build_object('min_attendees', 0, 'max_attendees', 4, 'amount', 1000),
              jsonb_build_object('min_attendees', 5, 'max_attendees', NULL, 'amount', 1500)
            )
          )
        ),
        'personal', jsonb_build_array(
          jsonb_build_object(
            'discipline_id', v_discipline, 'location_id', v_location, 'amount', 750
          ),
          jsonb_build_object(
            'discipline_id', v_discipline, 'amount', 700
          )
        )
      )
    ),
    v_key
  );
  PERFORM _venue_test_assert((v_result ->> 'success')::boolean, 'per-lesson draft saves');
  v_rule_id := (v_result ->> 'rule_version_id')::uuid;

  v_result := save_venue_cost_rule_draft(
    jsonb_build_object(
      'mode', 'per_lesson',
      'valid_from', '2026-01-01',
      'valid_to', '2026-01-31',
      'rules', jsonb_build_object(
        'currency', 'RUB',
        'group', jsonb_build_array(
          jsonb_build_object(
            'discipline_id', v_discipline, 'location_id', v_location,
            'attendance_tiers', jsonb_build_array(
              jsonb_build_object('min_attendees', 0, 'max_attendees', 4, 'amount', 1200),
              jsonb_build_object('min_attendees', 5, 'max_attendees', NULL, 'amount', 1700)
            )
          ),
          jsonb_build_object(
            'discipline_id', v_discipline,
            'attendance_tiers', jsonb_build_array(
              jsonb_build_object('min_attendees', 0, 'max_attendees', 4, 'amount', 1000),
              jsonb_build_object('min_attendees', 5, 'max_attendees', NULL, 'amount', 1500)
            )
          )
        ),
        'personal', jsonb_build_array(
          jsonb_build_object(
            'discipline_id', v_discipline, 'location_id', v_location, 'amount', 750
          ),
          jsonb_build_object(
            'discipline_id', v_discipline, 'amount', 700
          )
        )
      )
    ),
    v_key
  );
  PERFORM _venue_test_assert((v_result ->> 'already_applied')::boolean, 'draft save is idempotent');
  PERFORM _venue_test_assert((v_result ->> 'rule_version_id')::uuid = v_rule_id, 'idempotency returns same draft');

  v_result := accept_venue_cost_rule_version(v_rule_id, gen_random_uuid());
  PERFORM _venue_test_assert((v_result ->> 'success')::boolean, 'per-lesson rule accepts');

  SELECT * INTO v_rule FROM venue_cost_rule_versions WHERE id = v_rule_id;
  PERFORM _venue_test_assert(
    venue_cost_amount_for_lesson(v_rule, 'group', v_discipline, v_location, 4, v_teacher_member) = 1200,
    'attendance boundary 4 uses location-specific lower tier'
  );
  PERFORM _venue_test_assert(
    venue_cost_amount_for_lesson(v_rule, 'group', v_discipline, v_location, 5, v_teacher_member) = 1700,
    'attendance boundary 5 uses location-specific upper tier'
  );
  PERFORM _venue_test_assert(
    venue_cost_amount_for_lesson(v_rule, 'group', v_discipline, v_location_other, 4, v_teacher_member) = 1000,
    'group pricing falls back to discipline-only rule'
  );
  PERFORM _venue_test_assert(
    venue_cost_amount_for_lesson(v_rule, 'personal', v_discipline, v_location, NULL, v_teacher_member) = 750,
    'personal location-specific rule has precedence'
  );
  PERFORM _venue_test_assert(
    venue_cost_amount_for_lesson(v_rule, 'personal', v_discipline, v_location_other, NULL, v_teacher_member) = 700,
    'personal pricing falls back to discipline-only rule'
  );
  PERFORM _venue_test_assert(
    venue_cost_amount_for_lesson(v_rule, 'group', v_discipline, v_location, 4, v_member) = 0,
    'group pricing does not apply to another teacher'
  );

  -- Accepted snapshots cannot be mutated.
  BEGIN
    UPDATE venue_cost_rule_versions SET rules = '{}'::jsonb WHERE id = v_rule_id;
  EXCEPTION WHEN check_violation THEN
    v_immutable_rejected := true;
  END;
  PERFORM _venue_test_assert(v_immutable_rejected, 'accepted rule is immutable');

  -- Inclusive overlap: a rule starting on the previous valid_to is rejected.
  BEGIN
    INSERT INTO venue_cost_rule_versions (
      organization_id, version_number, status, mode, valid_from, valid_to,
      rules, created_by, accepted_by, accepted_at
    ) VALUES (
      v_org, 999, 'accepted', 'disabled', date '2026-01-31', date '2026-02-01',
      '{}'::jsonb, v_member, v_member, now()
    );
  EXCEPTION WHEN exclusion_violation THEN
    v_overlap_rejected := true;
  END;
  PERFORM _venue_test_assert(v_overlap_rejected, 'inclusive accepted overlap rejected');

  -- Closing in a gap creates pending_unpriced.
  v_result := close_personal_lesson_occurrence(v_lesson, gen_random_uuid());
  PERFORM _venue_test_assert((v_result ->> 'success')::boolean, 'personal closure succeeds');
  PERFORM _venue_test_assert(v_result ->> 'pricing_status' = 'pending_unpriced', 'gap closure is pending');
  v_closure_id := (v_result ->> 'closure_id')::uuid;

  SELECT count(*) INTO v_count FROM venue_cost_accruals
  WHERE closure_id = v_closure_id AND accrual_status = 'pending_unpriced';
  PERFORM _venue_test_assert(v_count = 1, 'one pending ledger row exists');
  v_status := get_venue_cost_rule_status(date '2026-02-10');
  PERFORM _venue_test_assert(
    (v_status ->> 'pending_unpriced_count')::integer = 1,
    'status returns pending-unpriced dashboard count'
  );

  -- Accepting a covering rule resolves the pending closure.
  v_result := save_venue_cost_rule_draft(
    jsonb_build_object(
      'mode', 'per_lesson', 'valid_from', '2026-02-01', 'valid_to', '2026-02-28',
      'rules', jsonb_build_object(
        'group', '[]'::jsonb,
        'personal', jsonb_build_array(jsonb_build_object(
          'discipline_id', v_discipline, 'location_id', v_location, 'amount', 800
        ))
      )
    ),
    gen_random_uuid()
  );
  v_pending_rule_id := (v_result ->> 'rule_version_id')::uuid;
  v_result := accept_venue_cost_rule_version(v_pending_rule_id, gen_random_uuid());
  PERFORM _venue_test_assert((v_result ->> 'success')::boolean, 'covering rule accepts');

  SELECT count(*) INTO v_count FROM venue_cost_accruals
  WHERE closure_id = v_closure_id AND accrual_status = 'posted' AND amount = 800;
  PERFORM _venue_test_assert(v_count = 1, 'pending closure resolved at snapshot amount');

  v_key := gen_random_uuid();
  v_result := recalculate_pending_venue_costs(date '2026-02-01', date '2026-02-28', v_key);
  PERFORM _venue_test_assert((v_result ->> 'resolved_count')::integer = 0, 'recalc leaves no covered pending rows');
  v_result := recalculate_pending_venue_costs(date '2026-02-01', date '2026-02-28', v_key);
  PERFORM _venue_test_assert((v_result ->> 'already_applied')::boolean, 'pending recalc is idempotent');

  -- Existing delete RPC remains successful while the closed immutable snapshot survives.
  v_result := delete_personal_lesson(v_lesson::text);
  PERFORM _venue_test_assert((v_result ->> 'success')::boolean, 'closed lesson delete RPC remains explicit and successful');
  SELECT count(*) INTO v_count
  FROM lesson_occurrence_closures
  WHERE id = v_closure_id
    AND status = 'closed'
    AND personal_lesson_id IS NULL
    AND source_personal_lesson_id = v_lesson
    AND source_snapshot ->> 'id' = v_lesson::text;
  PERFORM _venue_test_assert(v_count = 1, 'deletion preserves closed source id and immutable snapshot');

  -- Reopen is idempotent and appends a compensating negative adjustment.
  v_key := gen_random_uuid();
  v_result := reopen_lesson_occurrence_closure(v_closure_id, 'Lesson cancelled', v_key);
  PERFORM _venue_test_assert((v_result ->> 'success')::boolean, 'reopen succeeds');
  SELECT count(*) INTO v_count FROM venue_cost_accruals
  WHERE closure_id = v_closure_id AND accrual_kind = 'adjustment' AND amount = -800;
  PERFORM _venue_test_assert(v_count = 1, 'reopen creates compensating adjustment');
  v_result := reopen_lesson_occurrence_closure(v_closure_id, 'Lesson cancelled', v_key);
  PERFORM _venue_test_assert((v_result ->> 'already_applied')::boolean, 'reopen is idempotent');

  -- Weekly fixed policy creates three finite schedule rows for 15 inclusive days.
  v_result := save_venue_cost_rule_draft(
    jsonb_build_object(
      'mode', 'fixed_period', 'valid_from', '2026-03-01', 'valid_to', '2026-03-15',
      'rules', jsonb_build_object('period', 'week', 'amount', 9000, 'currency', 'RUB')
    ),
    gen_random_uuid()
  );
  v_fixed_rule_id := (v_result ->> 'rule_version_id')::uuid;
  v_result := accept_venue_cost_rule_version(v_fixed_rule_id, gen_random_uuid());
  PERFORM _venue_test_assert((v_result ->> 'success')::boolean, 'fixed weekly rule accepts');
  SELECT count(*) INTO v_count FROM venue_cost_accruals
  WHERE rule_version_id = v_fixed_rule_id AND accrual_kind = 'fixed_period' AND accrual_status = 'posted';
  PERFORM _venue_test_assert(v_count = 3, 'fixed weekly schedule has 3 rows');

  -- Per-location fixed period: one accrual per hall per period (stage 14).
  v_result := save_venue_cost_rule_draft(
    jsonb_build_object(
      'mode', 'fixed_period', 'valid_from', '2026-07-01', 'valid_to', '2026-07-07',
      'rules', jsonb_build_object(
        'period', 'custom', 'amount', 0, 'currency', 'RUB',
        'locations', jsonb_build_array(
          jsonb_build_object('location_id', v_location, 'amount', 5000),
          jsonb_build_object('location_id', v_location_other, 'amount', 7000)
        )
      )
    ),
    gen_random_uuid()
  );
  v_fixed_rule_id := (v_result ->> 'rule_version_id')::uuid;
  v_result := accept_venue_cost_rule_version(v_fixed_rule_id, gen_random_uuid());
  PERFORM _venue_test_assert((v_result ->> 'success')::boolean, 'fixed per-location rule accepts');
  SELECT count(*) INTO v_count FROM venue_cost_accruals
  WHERE rule_version_id = v_fixed_rule_id AND accrual_kind = 'fixed_period' AND accrual_status = 'posted';
  PERFORM _venue_test_assert(v_count = 2, 'fixed per-location custom range has 2 rows');
  SELECT count(*) INTO v_count FROM venue_cost_accruals
  WHERE rule_version_id = v_fixed_rule_id AND location_id = v_location AND amount = 5000;
  PERFORM _venue_test_assert(v_count = 1, 'main hall fixed amount');
  SELECT count(*) INTO v_count FROM venue_cost_accruals
  WHERE rule_version_id = v_fixed_rule_id AND location_id = v_location_other AND amount = 7000;
  PERFORM _venue_test_assert(v_count = 1, 'other hall fixed amount');

  -- Explicit disabled policy does not gate while it covers the requested date.
  v_result := save_venue_cost_rule_draft(
    jsonb_build_object(
      'mode', 'disabled', 'valid_from', '2026-04-01', 'valid_to', '2026-04-30',
      'rules', '{}'::jsonb
    ),
    gen_random_uuid()
  );
  v_disabled_rule_id := (v_result ->> 'rule_version_id')::uuid;
  PERFORM accept_venue_cost_rule_version(v_disabled_rule_id, gen_random_uuid());
  v_status := get_venue_cost_rule_status(date '2026-04-15');
  PERFORM _venue_test_assert(NOT (v_status ->> 'acknowledgement_required')::boolean, 'current disabled rule does not gate');

  -- An expired latest non-disabled policy requires acknowledgement.
  v_result := save_venue_cost_rule_draft(
    jsonb_build_object(
      'mode', 'per_lesson', 'valid_from', '2026-05-01', 'valid_to', '2026-05-31',
      'rules', jsonb_build_object(
        'group', jsonb_build_array(jsonb_build_object(
          'discipline_id', NULL,
          'attendance_tiers', jsonb_build_array(
            jsonb_build_object('min_attendees', 0, 'max_attendees', NULL, 'amount', 100)
          )
        )),
        'personal', '[]'::jsonb
      )
    ),
    gen_random_uuid()
  );
  v_expiring_rule_id := (v_result ->> 'rule_version_id')::uuid;
  PERFORM accept_venue_cost_rule_version(v_expiring_rule_id, gen_random_uuid());
  v_status := get_venue_cost_rule_status(date '2026-06-01');
  PERFORM _venue_test_assert((v_status ->> 'acknowledgement_required')::boolean, 'expired non-disabled rule gates');
  PERFORM _venue_test_assert((v_status ->> 'latest_rule_id')::uuid = v_expiring_rule_id, 'status identifies expired rule');

  -- A future accepted rule must not hide the uncovered June gap.
  v_result := save_venue_cost_rule_draft(
    jsonb_build_object(
      'mode', 'per_lesson', 'valid_from', '2026-08-01', 'valid_to', '2026-08-31',
      'rules', jsonb_build_object(
        'group', jsonb_build_array(jsonb_build_object(
          'discipline_id', NULL, 'location_id', NULL,
          'attendance_tiers', jsonb_build_array(
            jsonb_build_object('min_attendees', 0, 'max_attendees', NULL, 'amount', 110)
          )
        )),
        'personal', jsonb_build_array(jsonb_build_object(
          'discipline_id', NULL, 'location_id', NULL, 'amount', 90
        ))
      )
    ),
    gen_random_uuid()
  );
  v_future_rule_id := (v_result ->> 'rule_version_id')::uuid;
  PERFORM accept_venue_cost_rule_version(v_future_rule_id, gen_random_uuid());
  v_status := get_venue_cost_rule_status(date '2026-06-01');
  PERFORM _venue_test_assert(
    (v_status ->> 'acknowledgement_required')::boolean,
    'future accepted rule does not hide current gap'
  );
  PERFORM _venue_test_assert(
    (v_status ->> 'latest_rule_id')::uuid = v_expiring_rule_id,
    'gap status uses most recent non-disabled rule effective by requested date'
  );

  -- Stage 16: preview + confirm gap without client payment (historical June gap).
  v_result := preview_venue_cost_gap_impact(date '2026-06-01');
  PERFORM _venue_test_assert((v_result ->> 'success')::boolean, 'gap preview succeeds');
  PERFORM _venue_test_assert(
    (v_result ->> 'expired_rule_id')::uuid = v_expiring_rule_id,
    'gap preview identifies expired rule'
  );
  PERFORM _venue_test_assert(
    (v_result ->> 'suggested_gap_from')::date = date '2026-06-01',
    'gap preview suggests day after expired rule'
  );

  v_result := confirm_venue_cost_rule_gap(
    date '2026-06-01', date '2026-07-31', 'planned policy gap', gen_random_uuid()
  );
  PERFORM _venue_test_assert((v_result ->> 'success')::boolean, 'confirm gap succeeds');

  v_status := get_venue_cost_rule_status(date '2026-06-15');
  PERFORM _venue_test_assert(
    NOT (v_status ->> 'acknowledgement_required')::boolean,
    'acknowledged gap date no longer gates'
  );

  v_result := confirm_venue_cost_rule_gap(
    date '2026-06-01', NULL, 'duplicate', gen_random_uuid()
  );
  PERFORM _venue_test_assert(v_result ->> 'error_code' = 'gap_already_acknowledged', 'second confirm rejected');

  -- Assigned teacher can close their personal lesson, but receives no amount.
  PERFORM set_config('request.jwt.claim.sub', v_teacher_user::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', v_teacher_user, 'organization_id', v_org,
      'member_id', v_teacher_member, 'role', 'teacher'
    )::text,
    true
  );
  PERFORM set_active_organization(v_org);
  v_result := close_personal_lesson_occurrence(v_teacher_lesson, gen_random_uuid());
  PERFORM _venue_test_assert((v_result ->> 'success')::boolean, 'assigned teacher may close personal lesson');
  PERFORM _venue_test_assert(NOT (v_result ? 'amount'), 'operational closer does not receive venue amount');

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', v_user, 'organization_id', v_org, 'member_id', v_member, 'role', 'owner'
    )::text,
    true
  );
  PERFORM set_active_organization(v_org);

  -- Legacy pre-migration fingerprint is accepted when acknowledgement=false.
  v_key := gen_random_uuid();
  INSERT INTO operation_idempotency (
    organization_id, scope, idempotency_key, payload_fingerprint, result_json
  ) VALUES (
    v_org,
    'record_personal_lesson_payment',
    v_key,
    md5(v_teacher_lesson::text || '|100|cash'),
    jsonb_build_object('success', true, 'payment_id', gen_random_uuid())
  );
  v_result := record_personal_lesson_payment(v_teacher_lesson, 100, 'cash', v_key, false);
  PERFORM _venue_test_assert(
    (v_result ->> 'success')::boolean AND (v_result ->> 'already_applied')::boolean,
    'legacy idempotency fingerprint does not conflict solely because ack=false was added'
  );

  -- Payment wrapper checks acknowledgement before looking up its business object.
  -- Use the current date only when the test clock is after the policy.
  v_status := get_venue_cost_rule_status(current_date);
  IF (v_status ->> 'acknowledgement_required')::boolean THEN
    v_result := record_subscription_payment(
      gen_random_uuid(), 100, 'cash', NULL, gen_random_uuid(), false
    );
    PERFORM _venue_test_assert(
      v_result ->> 'error_code' = 'venue_rule_ack_required',
      'canonical payment RPC returns venue_rule_ack_required'
    );

    v_key := gen_random_uuid();
    v_result := record_personal_lesson_payment(v_teacher_lesson, 100, 'cash', v_key, true);
    PERFORM _venue_test_assert((v_result ->> 'success')::boolean, 'acknowledged payment succeeds');
    SELECT count(*) INTO v_count
    FROM venue_rule_payment_acknowledgements a
    WHERE a.organization_id = v_org
      AND a.payment_id = (v_result ->> 'payment_id')::uuid
      AND a.idempotency_key = v_key;
    PERFORM _venue_test_assert(v_count = 1, 'new expired-policy payment stores one acknowledgement');

    v_result := record_personal_lesson_payment(
      v_teacher_lesson, 100, 'cash', gen_random_uuid(), true
    );
    PERFORM _venue_test_assert((v_result ->> 'already_applied')::boolean, 'existing payment is returned');
    SELECT count(*) INTO v_count
    FROM venue_rule_payment_acknowledgements a
    WHERE a.organization_id = v_org
      AND a.payment_id = (v_result ->> 'payment_id')::uuid;
    PERFORM _venue_test_assert(v_count = 1, 'existing payment response creates no misleading new acknowledgement');
  END IF;

  -- Security objects exist for all venue financial tables.
  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'venue_cost_rule_versions', 'lesson_occurrence_closures',
      'venue_cost_accruals', 'venue_rule_payment_acknowledgements',
      'venue_rule_gap_acknowledgements'
    )
    AND policyname LIKE '%select%';
  PERFORM _venue_test_assert(v_count = 5, 'all venue financial tables have select RLS policy');

  SELECT count(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'record_subscription_payment', 'record_personal_lesson_payment', 'record_single_visit'
    )
    AND p.proargnames[array_length(p.proargnames, 1)] = 'p_venue_rule_acknowledged'
    AND (
      (p.proname = 'record_subscription_payment' AND p.pronargs = 6)
      OR (p.proname = 'record_personal_lesson_payment' AND p.pronargs = 5)
      OR (p.proname = 'record_single_visit' AND p.pronargs = 8)
    );
  PERFORM _venue_test_assert(v_count = 3, 'canonical PostgREST payment signatures are unambiguous');
  SELECT count(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'record_subscription_payment', 'record_personal_lesson_payment', 'record_single_visit'
    );
  PERFORM _venue_test_assert(v_count = 3, 'legacy payment overloads were removed');

  RAISE NOTICE 'All venue cost rules tests passed.';
END;
$$;

ROLLBACK;
