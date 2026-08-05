-- Allow multiple accepted venue-cost rule versions on overlapping dates when their
-- per-lesson scopes (teacher / discipline / location) or fixed-period locations do not conflict.
-- Lesson pricing resolves the best matching rule across all active per_lesson versions.

BEGIN;

CREATE OR REPLACE FUNCTION venue_cost_scope_specificity(p_rule jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    (CASE WHEN NULLIF(p_rule ->> 'teacher_member_id', '') IS NOT NULL THEN 1 ELSE 0 END)
  + (CASE WHEN NULLIF(p_rule ->> 'discipline_id', '') IS NOT NULL THEN 1 ELSE 0 END)
  + (CASE WHEN NULLIF(p_rule ->> 'location_id', '') IS NOT NULL THEN 1 ELSE 0 END);
$$;

CREATE OR REPLACE FUNCTION venue_cost_scopes_overlap(p_a jsonb, p_b jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NOT (
    (
      NULLIF(p_a ->> 'teacher_member_id', '') IS NOT NULL
      AND NULLIF(p_b ->> 'teacher_member_id', '') IS NOT NULL
      AND (p_a ->> 'teacher_member_id')::uuid <> (p_b ->> 'teacher_member_id')::uuid
    )
    OR (
      NULLIF(p_a ->> 'discipline_id', '') IS NOT NULL
      AND NULLIF(p_b ->> 'discipline_id', '') IS NOT NULL
      AND (p_a ->> 'discipline_id')::uuid <> (p_b ->> 'discipline_id')::uuid
    )
    OR (
      NULLIF(p_a ->> 'location_id', '') IS NOT NULL
      AND NULLIF(p_b ->> 'location_id', '') IS NOT NULL
      AND (p_a ->> 'location_id')::uuid <> (p_b ->> 'location_id')::uuid
    )
  );
$$;

CREATE OR REPLACE FUNCTION venue_cost_fixed_period_rules_conflict(
  p_rules_a jsonb,
  p_rules_b jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_a_has_locations boolean;
  v_b_has_locations boolean;
BEGIN
  v_a_has_locations := jsonb_array_length(COALESCE(p_rules_a -> 'locations', '[]'::jsonb)) > 0;
  v_b_has_locations := jsonb_array_length(COALESCE(p_rules_b -> 'locations', '[]'::jsonb)) > 0;

  IF NOT v_a_has_locations OR NOT v_b_has_locations THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_rules_a -> 'locations') a
    JOIN jsonb_array_elements(p_rules_b -> 'locations') b
      ON NULLIF(a ->> 'location_id', '') = NULLIF(b ->> 'location_id', '')
    WHERE NULLIF(a ->> 'location_id', '') IS NOT NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION venue_cost_per_lesson_rules_conflict(
  p_rules_a jsonb,
  p_rules_b jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_rules_a -> 'group', '[]'::jsonb)) a_rule
    JOIN jsonb_array_elements(COALESCE(p_rules_b -> 'group', '[]'::jsonb)) b_rule
      ON venue_cost_scopes_overlap(a_rule, b_rule)
    UNION ALL
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_rules_a -> 'personal', '[]'::jsonb)) a_rule
    JOIN jsonb_array_elements(COALESCE(p_rules_b -> 'personal', '[]'::jsonb)) b_rule
      ON venue_cost_scopes_overlap(a_rule, b_rule)
  );
$$;

CREATE OR REPLACE FUNCTION venue_cost_versions_have_conflict(
  p_org_id uuid,
  p_exclude_id uuid,
  p_mode text,
  p_rules jsonb,
  p_valid_from date,
  p_valid_to date
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM venue_cost_rule_versions r
    WHERE r.organization_id = p_org_id
      AND r.status = 'accepted'
      AND (p_exclude_id IS NULL OR r.id <> p_exclude_id)
      AND daterange(r.valid_from, COALESCE(r.valid_to, 'infinity'::date), '[]')
          && daterange(p_valid_from, COALESCE(p_valid_to, 'infinity'::date), '[]')
      AND (
        (p_mode = 'fixed_period' AND r.mode = 'fixed_period'
          AND venue_cost_fixed_period_rules_conflict(p_rules, r.rules))
        OR (p_mode = 'per_lesson' AND r.mode = 'per_lesson'
          AND venue_cost_per_lesson_rules_conflict(p_rules, r.rules))
        OR (p_mode = 'disabled' AND r.mode = 'disabled')
      )
  );
$$;

CREATE OR REPLACE FUNCTION venue_cost_rule_scopes_match_lesson(
  p_rule jsonb,
  p_discipline_id uuid,
  p_location_id uuid,
  p_teacher_member_id uuid
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    (NULLIF(p_rule ->> 'teacher_member_id', '') IS NULL
      OR (p_rule ->> 'teacher_member_id')::uuid = p_teacher_member_id)
    AND (NULLIF(p_rule ->> 'discipline_id', '') IS NULL
      OR (p_rule ->> 'discipline_id')::uuid = p_discipline_id)
    AND (NULLIF(p_rule ->> 'location_id', '') IS NULL
      OR (p_rule ->> 'location_id')::uuid = p_location_id);
$$;

CREATE OR REPLACE FUNCTION venue_cost_find_best_per_lesson_match(
  p_org_id uuid,
  p_date date,
  p_kind text,
  p_discipline_id uuid,
  p_location_id uuid,
  p_attendee_count integer,
  p_teacher_member_id uuid
)
RETURNS TABLE (
  matched boolean,
  amount numeric,
  rule_version_id uuid,
  currency text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version venue_cost_rule_versions%ROWTYPE;
  v_rule jsonb;
  v_tier jsonb;
  v_amount numeric;
  v_spec integer;
  v_best_amount numeric;
  v_best_version_id uuid;
  v_best_currency text;
  v_best_spec integer := -1;
  v_best_accepted_at timestamptz;
  v_best_version_number integer;
  v_section text;
  v_found boolean := false;
BEGIN
  matched := false;
  amount := 0;
  rule_version_id := NULL;
  currency := 'RUB';

  FOR v_version IN
    SELECT r.*
    FROM venue_cost_rule_versions r
    WHERE r.organization_id = p_org_id
      AND r.status = 'accepted'
      AND r.mode = 'per_lesson'
      AND r.valid_from <= p_date
      AND (r.valid_to IS NULL OR r.valid_to >= p_date)
    ORDER BY r.accepted_at DESC, r.version_number DESC
  LOOP
    v_section := CASE WHEN p_kind = 'personal' THEN 'personal' ELSE 'group' END;

    FOR v_rule IN
      SELECT value
      FROM jsonb_array_elements(COALESCE(v_version.rules -> v_section, '[]'::jsonb))
    LOOP
      IF NOT venue_cost_rule_scopes_match_lesson(
        v_rule, p_discipline_id, p_location_id, p_teacher_member_id
      ) THEN
        CONTINUE;
      END IF;

      v_spec := venue_cost_scope_specificity(v_rule);
      v_amount := NULL;

      IF v_section = 'personal' THEN
        v_amount := COALESCE((v_rule ->> 'amount')::numeric, 0);
      ELSE
        SELECT value INTO v_tier
        FROM jsonb_array_elements(COALESCE(v_rule -> 'attendance_tiers', '[]'::jsonb))
        WHERE (value ->> 'min_attendees')::integer <= COALESCE(p_attendee_count, 0)
          AND (
            NULLIF(value ->> 'max_attendees', '') IS NULL
            OR (value ->> 'max_attendees')::integer >= COALESCE(p_attendee_count, 0)
          )
        ORDER BY (value ->> 'min_attendees')::integer DESC
        LIMIT 1;

        IF v_tier IS NULL THEN
          CONTINUE;
        END IF;
        v_amount := COALESCE((v_tier ->> 'amount')::numeric, 0);
      END IF;

      v_found := true;
      IF v_spec > v_best_spec
        OR (v_spec = v_best_spec AND (
          v_version.accepted_at > v_best_accepted_at
          OR (v_version.accepted_at = v_best_accepted_at AND v_version.version_number > v_best_version_number)
        ))
      THEN
        v_best_spec := v_spec;
        v_best_amount := v_amount;
        v_best_version_id := v_version.id;
        v_best_currency := COALESCE(NULLIF(v_version.rules ->> 'currency', ''), 'RUB');
        v_best_accepted_at := v_version.accepted_at;
        v_best_version_number := v_version.version_number;
      END IF;
    END LOOP;
  END LOOP;

  matched := v_found;
  amount := COALESCE(v_best_amount, 0);
  rule_version_id := v_best_version_id;
  currency := COALESCE(v_best_currency, 'RUB');
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION venue_cost_rule_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_early_end boolean := COALESCE(NULLIF(current_setting('app.venue_cost_rule_allow_early_end', true), ''), 'off') = 'on';
  v_org_wide_migration boolean := COALESCE(NULLIF(current_setting('app.venue_cost_org_wide_migration', true), ''), 'off') = 'on';
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status = 'accepted' THEN
    RAISE EXCEPTION 'accepted_venue_rule_is_immutable' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'accepted' THEN
    IF v_early_end
      AND NEW.status = 'accepted'
      AND NEW.mode = OLD.mode
      AND NEW.rules = OLD.rules
      AND NEW.valid_from = OLD.valid_from
      AND NEW.valid_to IS DISTINCT FROM OLD.valid_to
    THEN
      NEW.updated_at := now();
      RETURN NEW;
    END IF;
    IF v_org_wide_migration
      AND NEW.status = 'accepted'
      AND NEW.mode = OLD.mode
      AND NEW.valid_from = OLD.valid_from
      AND NEW.valid_to IS NOT DISTINCT FROM OLD.valid_to
      AND venue_cost_rules_are_valid(NEW.mode, NEW.rules)
    THEN
      NEW.updated_at := now();
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'accepted_venue_rule_is_immutable' USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'accepted' THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(NEW.organization_id::text || ':venue-rules', 0)
    );
    IF venue_cost_versions_have_conflict(
      NEW.organization_id,
      NEW.id,
      NEW.mode,
      NEW.rules,
      NEW.valid_from,
      NEW.valid_to
    ) THEN
      RAISE EXCEPTION 'accepted_venue_rule_overlap' USING ERRCODE = '23P01';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION accept_venue_cost_rule_version(
  p_rule_version_id uuid,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_rule venue_cost_rule_versions%ROWTYPE;
  v_cursor date;
  v_period_from date;
  v_period_to date;
  v_result jsonb;
  v_cached jsonb;
  v_fingerprint text := md5(COALESCE(p_rule_version_id::text, ''));
  v_closure record;
  v_loc_row record;
  v_has_locations boolean;
BEGIN
  v_cached := check_operation_idempotency(v_org_id, 'accept_venue_cost_rule_version', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT member_can_manage_venue_cost_rules() THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_org_id::text || ':venue-rules', 0));
  SELECT * INTO v_rule
  FROM venue_cost_rule_versions
  WHERE id = p_rule_version_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'rule_not_found');
  END IF;
  IF v_rule.status = 'accepted' THEN
    RETURN jsonb_build_object('success', true, 'rule_version_id', v_rule.id, 'already_applied', true);
  END IF;
  IF NOT venue_cost_rule_references_are_valid(v_org_id, v_rule.mode, v_rule.rules) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_rule_reference');
  END IF;
  IF venue_cost_versions_have_conflict(
    v_org_id,
    v_rule.id,
    v_rule.mode,
    v_rule.rules,
    v_rule.valid_from,
    v_rule.valid_to
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'accepted_rule_overlap');
  END IF;

  UPDATE venue_cost_rule_versions
  SET status = 'accepted', accepted_by = v_member_id, accepted_at = now()
  WHERE id = v_rule.id
  RETURNING * INTO v_rule;

  IF v_rule.mode = 'fixed_period' THEN
    v_has_locations := jsonb_array_length(COALESCE(v_rule.rules -> 'locations', '[]'::jsonb)) > 0;
    v_cursor := v_rule.valid_from;
    WHILE v_cursor <= v_rule.valid_to LOOP
      v_period_from := v_cursor;
      IF v_rule.rules ->> 'period' = 'week' THEN
        v_period_to := LEAST(v_rule.valid_to, v_cursor + 6);
        v_cursor := v_period_to + 1;
      ELSIF v_rule.rules ->> 'period' = 'month' THEN
        v_period_to := LEAST(v_rule.valid_to, (date_trunc('month', v_cursor) + interval '1 month - 1 day')::date);
        v_cursor := v_period_to + 1;
      ELSE
        v_period_to := v_rule.valid_to;
        v_cursor := v_rule.valid_to + 1;
      END IF;

      IF v_has_locations THEN
        FOR v_loc_row IN
          SELECT
            NULLIF(elem ->> 'location_id', '')::uuid AS location_id,
            round((elem ->> 'amount')::numeric, 2) AS amount
          FROM jsonb_array_elements(v_rule.rules -> 'locations') elem
        LOOP
          INSERT INTO venue_cost_accruals (
            organization_id, rule_version_id, location_id, accrual_kind, accrual_status, accrual_date,
            period_from, period_to, amount, currency, rule_snapshot, source_snapshot, created_by
          ) VALUES (
            v_org_id, v_rule.id, v_loc_row.location_id, 'fixed_period', 'posted', v_period_to,
            v_period_from, v_period_to, v_loc_row.amount,
            COALESCE(NULLIF(v_rule.rules ->> 'currency', ''), 'RUB'),
            to_jsonb(v_rule),
            jsonb_build_object('period', v_rule.rules ->> 'period', 'location_id', v_loc_row.location_id),
            v_member_id
          );
        END LOOP;
      ELSE
        INSERT INTO venue_cost_accruals (
          organization_id, rule_version_id, location_id, accrual_kind, accrual_status, accrual_date,
          period_from, period_to, amount, currency, rule_snapshot, source_snapshot, created_by
        ) VALUES (
          v_org_id, v_rule.id, NULL, 'fixed_period', 'posted', v_period_to,
          v_period_from, v_period_to, round((v_rule.rules ->> 'amount')::numeric, 2),
          COALESCE(NULLIF(v_rule.rules ->> 'currency', ''), 'RUB'),
          to_jsonb(v_rule), jsonb_build_object('period', v_rule.rules ->> 'period'), v_member_id
        );
      END IF;
    END LOOP;
  END IF;

  FOR v_closure IN
    SELECT c.id
    FROM lesson_occurrence_closures c
    WHERE c.organization_id = v_org_id
      AND c.status = 'closed'
      AND c.pricing_status = 'pending_unpriced'
      AND c.occurrence_date BETWEEN v_rule.valid_from AND COALESCE(v_rule.valid_to, 'infinity'::date)
    ORDER BY c.occurrence_date, c.id
  LOOP
    PERFORM post_venue_cost_for_closure(v_closure.id, v_member_id);
  END LOOP;

  v_result := jsonb_build_object('success', true, 'rule_version_id', v_rule.id);
  PERFORM store_operation_idempotency(v_org_id, 'accept_venue_cost_rule_version', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION venue_cost_rule_at(p_org_id uuid, p_date date)
RETURNS venue_cost_rule_versions
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r
  FROM venue_cost_rule_versions r
  WHERE r.organization_id = p_org_id
    AND r.status = 'accepted'
    AND r.valid_from <= p_date
    AND (r.valid_to IS NULL OR r.valid_to >= p_date)
    AND r.mode <> 'disabled'
  ORDER BY r.accepted_at DESC, r.version_number DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION venue_cost_status_for_org(p_org_id uuid, p_at date DEFAULT current_date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_latest_non_disabled venue_cost_rule_versions%ROWTYPE;
  v_current venue_cost_rule_versions%ROWTYPE;
  v_disabled venue_cost_rule_versions%ROWTYPE;
  v_ack boolean := false;
  v_pending_unpriced_count bigint := 0;
BEGIN
  SELECT * INTO v_current
  FROM venue_cost_rule_versions r
  WHERE r.organization_id = p_org_id
    AND r.status = 'accepted'
    AND r.valid_from <= p_at
    AND (r.valid_to IS NULL OR r.valid_to >= p_at)
    AND r.mode <> 'disabled'
  ORDER BY r.accepted_at DESC, r.version_number DESC
  LIMIT 1;

  IF v_current.id IS NULL THEN
    SELECT * INTO v_disabled
    FROM venue_cost_rule_versions r
    WHERE r.organization_id = p_org_id
      AND r.status = 'accepted'
      AND r.mode = 'disabled'
      AND r.valid_from <= p_at
      AND (r.valid_to IS NULL OR r.valid_to >= p_at)
    ORDER BY r.accepted_at DESC, r.version_number DESC
    LIMIT 1;
    v_current := v_disabled;
  END IF;

  SELECT * INTO v_latest_non_disabled
  FROM venue_cost_rule_versions r
  WHERE r.organization_id = p_org_id
    AND r.status = 'accepted'
    AND r.mode <> 'disabled'
    AND r.valid_from <= p_at
  ORDER BY r.valid_from DESC, r.accepted_at DESC, r.version_number DESC
  LIMIT 1;

  v_ack := v_current.id IS NULL
    AND v_latest_non_disabled.id IS NOT NULL
    AND v_latest_non_disabled.valid_to IS NOT NULL
    AND v_latest_non_disabled.valid_to < p_at;

  IF v_ack
    AND venue_cost_gap_is_acknowledged(p_org_id, v_latest_non_disabled.id, p_at)
  THEN
    v_ack := false;
  END IF;

  SELECT count(*) INTO v_pending_unpriced_count
  FROM lesson_occurrence_closures c
  WHERE c.organization_id = p_org_id
    AND c.status = 'closed'
    AND c.pricing_status = 'pending_unpriced';

  RETURN jsonb_build_object(
    'status', CASE
      WHEN v_current.id IS NOT NULL AND v_current.mode = 'disabled' THEN 'disabled'
      WHEN v_current.id IS NOT NULL THEN 'active'
      WHEN v_ack THEN 'expired_ack_required'
      WHEN v_latest_non_disabled.id IS NULL THEN 'not_configured'
      ELSE 'inactive'
    END,
    'acknowledgement_required', v_ack,
    'current_rule_id', v_current.id,
    'current_mode', v_current.mode,
    'latest_rule_id', v_latest_non_disabled.id,
    'latest_mode', v_latest_non_disabled.mode,
    'latest_valid_to', v_latest_non_disabled.valid_to,
    'pending_unpriced_count', v_pending_unpriced_count,
    'as_of', p_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION post_venue_cost_for_closure_impl(
  p_closure_id uuid,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_closure lesson_occurrence_closures%ROWTYPE;
  v_rule venue_cost_rule_versions%ROWTYPE;
  v_amount numeric;
  v_accrual_id uuid;
  v_match record;
  v_has_covering_rule boolean;
BEGIN
  SELECT * INTO v_closure
  FROM lesson_occurrence_closures
  WHERE id = p_closure_id
  FOR UPDATE;

  IF NOT FOUND OR v_closure.status <> 'closed' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'closure_not_found');
  END IF;

  IF EXISTS (
    SELECT 1 FROM venue_cost_accruals a
    WHERE a.organization_id = v_closure.organization_id
      AND a.closure_id = v_closure.id
      AND a.accrual_status = 'posted'
      AND a.teacher_pay_rule_id IS NULL
      AND a.rule_version_id IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('success', true, 'already_applied', true);
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM venue_cost_rule_versions r
    WHERE r.organization_id = v_closure.organization_id
      AND r.status = 'accepted'
      AND r.valid_from <= v_closure.occurrence_date
      AND (r.valid_to IS NULL OR r.valid_to >= v_closure.occurrence_date)
  ) INTO v_has_covering_rule;

  IF NOT v_has_covering_rule THEN
    INSERT INTO venue_cost_accruals (
      organization_id, closure_id, accrual_kind, accrual_status, accrual_date,
      source_snapshot, created_by
    ) VALUES (
      v_closure.organization_id, v_closure.id, 'lesson', 'pending_unpriced',
      v_closure.occurrence_date, v_closure.source_snapshot, p_actor_id
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_accrual_id;

    UPDATE lesson_occurrence_closures
    SET pricing_status = 'pending_unpriced', rule_version_id = NULL
    WHERE id = v_closure.id;

    RETURN jsonb_build_object(
      'success', true, 'closure_id', v_closure.id, 'accrual_id', v_accrual_id,
      'pricing_status', 'pending_unpriced'
    );
  END IF;

  SELECT * INTO v_match
  FROM venue_cost_find_best_per_lesson_match(
    v_closure.organization_id,
    v_closure.occurrence_date,
    v_closure.occurrence_kind,
    v_closure.discipline_id,
    v_closure.location_id,
    v_closure.confirmed_attendee_count,
    v_closure.teacher_member_id
  );

  IF COALESCE(v_match.matched, false) THEN
    v_amount := COALESCE(v_match.amount, 0);
    SELECT * INTO v_rule
    FROM venue_cost_rule_versions
    WHERE id = v_match.rule_version_id;
  ELSE
    v_amount := 0;
    SELECT * INTO v_rule
    FROM venue_cost_rule_at(v_closure.organization_id, v_closure.occurrence_date);
    IF v_rule.id IS NULL THEN
      SELECT * INTO v_rule
      FROM venue_cost_rule_versions r
      WHERE r.organization_id = v_closure.organization_id
        AND r.status = 'accepted'
        AND r.valid_from <= v_closure.occurrence_date
        AND (r.valid_to IS NULL OR r.valid_to >= v_closure.occurrence_date)
      ORDER BY r.accepted_at DESC, r.version_number DESC
      LIMIT 1;
    END IF;
  END IF;

  UPDATE venue_cost_accruals
  SET accrual_status = 'void', amount = 0,
      reason = 'resolved_by_rule:' || v_rule.id::text
  WHERE organization_id = v_closure.organization_id
    AND closure_id = v_closure.id
    AND accrual_status = 'pending_unpriced';

  INSERT INTO venue_cost_accruals (
    organization_id, rule_version_id, closure_id, accrual_kind, accrual_status,
    accrual_date, amount, currency, rule_snapshot, source_snapshot, created_by
  ) VALUES (
    v_closure.organization_id, v_rule.id, v_closure.id, 'lesson', 'posted',
    v_closure.occurrence_date, round(v_amount, 2),
    COALESCE(
      NULLIF(v_match.currency, ''),
      NULLIF(v_rule.rules ->> 'currency', ''),
      'RUB'
    ),
    to_jsonb(v_rule), v_closure.source_snapshot, p_actor_id
  )
  RETURNING id INTO v_accrual_id;

  UPDATE lesson_occurrence_closures
  SET pricing_status = CASE
      WHEN COALESCE(v_match.matched, false) OR v_rule.mode = 'per_lesson' THEN 'priced'
      ELSE 'not_applicable'
    END,
    rule_version_id = v_rule.id
  WHERE id = v_closure.id;

  RETURN jsonb_build_object(
    'success', true, 'closure_id', v_closure.id, 'accrual_id', v_accrual_id,
    'pricing_status', CASE
      WHEN COALESCE(v_match.matched, false) OR v_rule.mode = 'per_lesson' THEN 'priced'
      ELSE 'not_applicable'
    END,
    'amount', round(v_amount, 2), 'rule_version_id', v_rule.id
  );
END;
$$;

COMMIT;
