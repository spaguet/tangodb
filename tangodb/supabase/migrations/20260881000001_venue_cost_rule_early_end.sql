-- Allow ending an accepted venue cost rule early (shorten valid_to) via a dedicated,
-- audited RPC instead of waiting for the originally chosen end date.
-- The immutability guard still blocks every other kind of edit on accepted rows.

BEGIN;

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
    IF EXISTS (
      SELECT 1
      FROM venue_cost_rule_versions r
      WHERE r.organization_id = NEW.organization_id
        AND r.status = 'accepted'
        AND r.id <> NEW.id
        AND daterange(r.valid_from, COALESCE(r.valid_to, 'infinity'::date), '[]')
            && daterange(NEW.valid_from, COALESCE(NEW.valid_to, 'infinity'::date), '[]')
    ) THEN
      RAISE EXCEPTION 'accepted_venue_rule_overlap' USING ERRCODE = '23P01';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION end_venue_cost_rule_early(
  p_rule_version_id uuid,
  p_end_date date DEFAULT current_date,
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
  v_result jsonb;
  v_cached jsonb;
  v_fingerprint text := md5(concat_ws('|', p_rule_version_id, p_end_date));
BEGIN
  v_cached := check_operation_idempotency(v_org_id, 'end_venue_cost_rule_early', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT member_can_manage_venue_cost_rules()
    OR NOT organization_allows_writes(v_org_id)
  THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  IF p_end_date IS NULL OR p_end_date < current_date THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'end_date_in_past');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_org_id::text || ':venue-rules', 0));
  SELECT * INTO v_rule
  FROM venue_cost_rule_versions
  WHERE id = p_rule_version_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND OR v_rule.status <> 'accepted' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'rule_not_found');
  END IF;

  IF p_end_date < v_rule.valid_from THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'end_date_before_start');
  END IF;

  IF v_rule.valid_to IS NOT NULL AND p_end_date >= v_rule.valid_to THEN
    RETURN jsonb_build_object('success', true, 'rule_version_id', v_rule.id, 'already_applied', true);
  END IF;

  PERFORM set_config('app.venue_cost_rule_allow_early_end', 'on', true);
  UPDATE venue_cost_rule_versions
  SET valid_to = p_end_date
  WHERE id = v_rule.id AND organization_id = v_org_id;
  PERFORM set_config('app.venue_cost_rule_allow_early_end', 'off', true);

  -- Fixed-period accruals for periods that no longer fall within validity must not
  -- keep showing up as posted studio costs.
  UPDATE venue_cost_accruals
  SET accrual_status = 'void', reason = 'rule_ended_early:' || p_end_date::text
  WHERE organization_id = v_org_id
    AND rule_version_id = v_rule.id
    AND accrual_kind = 'fixed_period'
    AND accrual_status = 'posted'
    AND period_from > p_end_date;

  v_result := jsonb_build_object('success', true, 'rule_version_id', v_rule.id, 'valid_to', p_end_date);
  PERFORM store_operation_idempotency(v_org_id, 'end_venue_cost_rule_early', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION end_venue_cost_rule_early(uuid, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION end_venue_cost_rule_early(uuid, date, uuid) TO authenticated;

COMMIT;
