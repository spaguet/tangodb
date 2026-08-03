-- Hall-rent stage 7: accountant read rental tariffs + manage venue cost rules (draft/accept).
-- Tariff write stays manage_rentals + finance; list/read opens for can_read_financial().

CREATE OR REPLACE FUNCTION member_can_manage_venue_cost_rules()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND auth_organization_id() IS NOT NULL
    AND organization_allows_writes(auth_organization_id())
    AND current_member_role() IN ('owner', 'director', 'accountant');
$$;

REVOKE ALL ON FUNCTION member_can_manage_venue_cost_rules() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_manage_venue_cost_rules() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION list_rental_tariffs(p_status text DEFAULT NULL, p_location_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT (member_can_manage_rentals() OR can_read_financial()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'tariff_type', t.tariff_type,
    'location_id', t.location_id,
    'price', CASE WHEN can_read_financial() THEN t.price ELSE NULL END,
    'currency', CASE WHEN can_read_financial() THEN t.currency ELSE NULL END,
    'min_duration_minutes', t.min_duration_minutes,
    'rounding_step_minutes', t.rounding_step_minutes,
    'valid_from', t.valid_from,
    'valid_to', t.valid_to,
    'status', t.status,
    'rules_count', (
      SELECT count(*) FROM rental_tariff_rules r
      WHERE r.tariff_id = t.id AND r.organization_id = v_org_id
    )
  ) ORDER BY t.name), '[]'::jsonb)
  INTO v_rows
  FROM rental_tariffs t
  WHERE t.organization_id = v_org_id
    AND (p_status IS NULL OR t.status = p_status)
    AND (p_location_id IS NULL OR t.location_id IS NULL OR t.location_id = p_location_id);

  RETURN jsonb_build_object('success', true, 'tariffs', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION save_venue_cost_rule_draft(
  p_payload jsonb,
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
  v_id uuid := NULLIF(p_payload ->> 'id', '')::uuid;
  v_version bigint;
  v_result jsonb;
  v_fingerprint text := md5(COALESCE(p_payload::text, ''));
  v_cached jsonb;
BEGIN
  v_cached := check_operation_idempotency(v_org_id, 'save_venue_cost_rule_draft', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT member_can_manage_venue_cost_rules() THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  IF NOT venue_cost_rules_are_valid(
    p_payload ->> 'mode',
    COALESCE(p_payload -> 'rules', '{}'::jsonb)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_rule');
  END IF;

  IF NOT venue_cost_rule_references_are_valid(
    v_org_id,
    p_payload ->> 'mode',
    COALESCE(p_payload -> 'rules', '{}'::jsonb)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_rule_reference');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_org_id::text || ':venue-rules', 0));

  IF v_id IS NULL THEN
    SELECT COALESCE(max(version_number), 0) + 1 INTO v_version
    FROM venue_cost_rule_versions WHERE organization_id = v_org_id;

    INSERT INTO venue_cost_rule_versions (
      organization_id, version_number, mode, valid_from, valid_to, rules, created_by
    ) VALUES (
      v_org_id, v_version, p_payload ->> 'mode',
      (p_payload ->> 'valid_from')::date,
      NULLIF(p_payload ->> 'valid_to', '')::date,
      COALESCE(p_payload -> 'rules', '{}'::jsonb), v_member_id
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE venue_cost_rule_versions
    SET mode = p_payload ->> 'mode',
        valid_from = (p_payload ->> 'valid_from')::date,
        valid_to = NULLIF(p_payload ->> 'valid_to', '')::date,
        rules = COALESCE(p_payload -> 'rules', '{}'::jsonb)
    WHERE id = v_id AND organization_id = v_org_id AND status = 'draft';
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'draft_not_found');
    END IF;
  END IF;

  v_result := jsonb_build_object('success', true, 'rule_version_id', v_id);
  PERFORM store_operation_idempotency(v_org_id, 'save_venue_cost_rule_draft', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
EXCEPTION
  WHEN check_violation OR invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_rule', 'error', SQLERRM);
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
  IF EXISTS (
    SELECT 1 FROM venue_cost_rule_versions r
    WHERE r.organization_id = v_org_id AND r.status = 'accepted'
      AND daterange(r.valid_from, COALESCE(r.valid_to, 'infinity'::date), '[]')
          && daterange(v_rule.valid_from, COALESCE(v_rule.valid_to, 'infinity'::date), '[]')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'accepted_rule_overlap');
  END IF;

  UPDATE venue_cost_rule_versions
  SET status = 'accepted', accepted_by = v_member_id, accepted_at = now()
  WHERE id = v_rule.id
  RETURNING * INTO v_rule;

  IF v_rule.mode = 'fixed_period' THEN
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

      INSERT INTO venue_cost_accruals (
        organization_id, rule_version_id, accrual_kind, accrual_status, accrual_date,
        period_from, period_to, amount, currency, rule_snapshot, source_snapshot, created_by
      ) VALUES (
        v_org_id, v_rule.id, 'fixed_period', 'posted', v_period_to,
        v_period_from, v_period_to, round((v_rule.rules ->> 'amount')::numeric, 2),
        COALESCE(NULLIF(v_rule.rules ->> 'currency', ''), 'RUB'),
        to_jsonb(v_rule), jsonb_build_object('period', v_rule.rules ->> 'period'), v_member_id
      );
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

DROP POLICY IF EXISTS rental_tariffs_select ON rental_tariffs;
CREATE POLICY rental_tariffs_select ON rental_tariffs FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND (member_can_manage_rentals() OR can_read_financial())
  );

DROP POLICY IF EXISTS rental_tariff_rules_select ON rental_tariff_rules;
CREATE POLICY rental_tariff_rules_select ON rental_tariff_rules FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND (member_can_manage_rentals() OR can_read_financial())
  );
