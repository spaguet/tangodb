-- Integration fixes: ambiguous schedule_location_has_conflict overloads;
-- rental payment idempotency scoped uniqueness; gap confirm duplicate detection order.

BEGIN;

DROP FUNCTION IF EXISTS schedule_location_has_conflict(uuid, date, text, text, uuid);
DROP FUNCTION IF EXISTS schedule_location_has_conflict(uuid, date, text, text, uuid, uuid);
DROP FUNCTION IF EXISTS schedule_location_has_conflict(uuid, date, text, text, uuid, uuid, uuid);

DROP INDEX IF EXISTS rental_payments_org_idempotency_unique;

CREATE UNIQUE INDEX IF NOT EXISTS rental_payments_org_idempotency_legacy_unique
  ON rental_payments (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_scope IS NULL;

CREATE OR REPLACE FUNCTION confirm_venue_cost_rule_gap(
  p_gap_from date,
  p_gap_to date DEFAULT NULL,
  p_reason text DEFAULT NULL,
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
  v_status jsonb;
  v_expired_rule_id uuid;
  v_result jsonb;
  v_cached jsonb;
  v_fingerprint text := md5(
    concat_ws('|', p_gap_from, COALESCE(p_gap_to::text, ''), COALESCE(p_reason, ''))
  );
  v_ack_id uuid;
BEGIN
  v_cached := check_operation_idempotency(v_org_id, 'confirm_venue_cost_rule_gap', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT member_can_manage_venue_cost_rules() THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  IF p_reason IS NULL OR char_length(trim(p_reason)) < 3 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'reason_required');
  END IF;

  IF p_gap_to IS NOT NULL AND p_gap_to < p_gap_from THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_gap_period');
  END IF;

  v_status := venue_cost_status_for_org(
    v_org_id,
    CASE
      WHEN COALESCE((venue_cost_status_for_org(v_org_id, current_date) ->> 'acknowledgement_required')::boolean, false)
        THEN current_date
      ELSE p_gap_from
    END
  );
  v_expired_rule_id := (v_status ->> 'latest_rule_id')::uuid;
  IF v_expired_rule_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'expired_rule_not_found');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM venue_rule_gap_acknowledgements g
    WHERE g.organization_id = v_org_id
      AND g.expired_rule_id = v_expired_rule_id
      AND p_gap_from >= g.gap_from
      AND (g.gap_to IS NULL OR p_gap_from <= g.gap_to)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'gap_already_acknowledged');
  END IF;

  v_status := venue_cost_status_for_org(v_org_id, current_date);
  IF NOT COALESCE((v_status ->> 'acknowledgement_required')::boolean, false)
    AND NOT COALESCE((venue_cost_status_for_org(v_org_id, p_gap_from) ->> 'acknowledgement_required')::boolean, false)
  THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'gap_not_required');
  END IF;

  INSERT INTO venue_rule_gap_acknowledgements (
    organization_id, expired_rule_id, gap_from, gap_to, reason,
    acknowledged_by, status_snapshot, idempotency_key
  ) VALUES (
    v_org_id, v_expired_rule_id, p_gap_from, p_gap_to, trim(p_reason),
    v_member_id, v_status, p_idempotency_key
  )
  RETURNING id INTO v_ack_id;

  v_result := jsonb_build_object(
    'success', true,
    'acknowledgement_id', v_ack_id,
    'venue_rule_status', venue_cost_status_for_org(v_org_id, current_date)
  );
  PERFORM store_operation_idempotency(v_org_id, 'confirm_venue_cost_rule_gap', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;

COMMIT;
