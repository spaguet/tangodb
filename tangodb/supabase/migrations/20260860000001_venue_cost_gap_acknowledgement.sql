-- Hall-rent stage 16: close venue cost gap without a client payment (F30).
-- Standalone gap acknowledgement for roles with member_can_manage_venue_cost_rules().

CREATE TABLE venue_rule_gap_acknowledgements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  expired_rule_id   UUID NOT NULL,
  gap_from          DATE NOT NULL,
  gap_to            DATE,
  reason            TEXT NOT NULL CHECK (char_length(trim(reason)) >= 3),
  acknowledged_by   UUID NOT NULL,
  acknowledged_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  status_snapshot   JSONB NOT NULL,
  idempotency_key   UUID,
  UNIQUE (organization_id, idempotency_key),
  FOREIGN KEY (organization_id, expired_rule_id)
    REFERENCES venue_cost_rule_versions (organization_id, id),
  FOREIGN KEY (organization_id, acknowledged_by)
    REFERENCES organization_members (organization_id, id),
  CHECK (gap_to IS NULL OR gap_to >= gap_from)
);

CREATE INDEX idx_venue_rule_gap_ack_org_dates
  ON venue_rule_gap_acknowledgements (organization_id, gap_from, gap_to);

CREATE TRIGGER audit_venue_rule_gap_acknowledgements
  AFTER INSERT OR UPDATE OR DELETE ON venue_rule_gap_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

ALTER TABLE venue_rule_gap_acknowledgements ENABLE ROW LEVEL SECURITY;

CREATE POLICY venue_rule_gap_acks_select ON venue_rule_gap_acknowledgements
  FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_financial()
  );

CREATE POLICY venue_rule_gap_acks_write_none ON venue_rule_gap_acknowledgements
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

REVOKE ALL ON venue_rule_gap_acknowledgements FROM PUBLIC, anon;
GRANT SELECT ON venue_rule_gap_acknowledgements TO authenticated;

CREATE OR REPLACE FUNCTION venue_cost_gap_is_acknowledged(
  p_org_id uuid,
  p_expired_rule_id uuid,
  p_at date
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM venue_rule_gap_acknowledgements g
    WHERE g.organization_id = p_org_id
      AND g.expired_rule_id = p_expired_rule_id
      AND p_at >= g.gap_from
      AND (g.gap_to IS NULL OR p_at <= g.gap_to)
  );
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
  v_ack boolean := false;
  v_pending_unpriced_count bigint := 0;
BEGIN
  SELECT * INTO v_current
  FROM venue_cost_rule_versions r
  WHERE r.organization_id = p_org_id
    AND r.status = 'accepted'
    AND r.valid_from <= p_at
    AND (r.valid_to IS NULL OR r.valid_to >= p_at)
  ORDER BY r.accepted_at DESC, r.version_number DESC
  LIMIT 1;

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

CREATE OR REPLACE FUNCTION preview_venue_cost_gap_impact(p_as_of date DEFAULT current_date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_status jsonb;
  v_expired_rule venue_cost_rule_versions%ROWTYPE;
  v_gap_from date;
  v_gap_to date;
  v_next_rule_from date;
  v_draft_id uuid;
  v_closed_pending bigint := 0;
  v_closed_priced bigint := 0;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT can_read_financial() THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  v_status := venue_cost_status_for_org(v_org_id, p_as_of);
  IF NOT COALESCE((v_status ->> 'acknowledgement_required')::boolean, false) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'gap_not_required');
  END IF;

  SELECT * INTO v_expired_rule
  FROM venue_cost_rule_versions
  WHERE id = (v_status ->> 'latest_rule_id')::uuid
    AND organization_id = v_org_id;

  v_gap_from := COALESCE(v_expired_rule.valid_to + 1, p_as_of);

  SELECT min(r.valid_from) INTO v_next_rule_from
  FROM venue_cost_rule_versions r
  WHERE r.organization_id = v_org_id
    AND r.status = 'accepted'
    AND r.valid_from > v_gap_from;

  v_gap_to := CASE
    WHEN v_next_rule_from IS NOT NULL THEN v_next_rule_from - 1
    ELSE NULL
  END;

  SELECT id INTO v_draft_id
  FROM venue_cost_rule_versions
  WHERE organization_id = v_org_id
    AND status = 'draft'
  ORDER BY version_number DESC
  LIMIT 1;

  SELECT count(*) INTO v_closed_pending
  FROM lesson_occurrence_closures c
  WHERE c.organization_id = v_org_id
    AND c.status = 'closed'
    AND c.pricing_status = 'pending_unpriced'
    AND c.occurrence_date >= v_gap_from
    AND (v_gap_to IS NULL OR c.occurrence_date <= v_gap_to);

  SELECT count(*) INTO v_closed_priced
  FROM lesson_occurrence_closures c
  WHERE c.organization_id = v_org_id
    AND c.status = 'closed'
    AND c.pricing_status <> 'pending_unpriced'
    AND c.occurrence_date >= v_gap_from
    AND (v_gap_to IS NULL OR c.occurrence_date <= v_gap_to);

  RETURN jsonb_build_object(
    'success', true,
    'as_of', p_as_of,
    'expired_rule_id', v_expired_rule.id,
    'expired_rule_valid_to', v_expired_rule.valid_to,
    'suggested_gap_from', v_gap_from,
    'suggested_gap_to', v_gap_to,
    'next_rule_valid_from', v_next_rule_from,
    'draft_version_id', v_draft_id,
    'closed_pending_unpriced_in_gap', v_closed_pending,
    'closed_priced_in_gap', v_closed_priced,
    'pending_unpriced_total', COALESCE((v_status ->> 'pending_unpriced_count')::bigint, 0),
    'past_will_not_recalculate', true
  );
END;
$$;

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

  v_status := venue_cost_status_for_org(v_org_id, current_date);
  IF NOT COALESCE((v_status ->> 'acknowledgement_required')::boolean, false)
    AND NOT COALESCE((venue_cost_status_for_org(v_org_id, p_gap_from) ->> 'acknowledgement_required')::boolean, false)
  THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'gap_not_required');
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

REVOKE ALL ON FUNCTION venue_cost_gap_is_acknowledged(uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION venue_cost_gap_is_acknowledged(uuid, uuid, date) TO authenticated, service_role;

REVOKE ALL ON FUNCTION preview_venue_cost_gap_impact(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION preview_venue_cost_gap_impact(date) TO authenticated, service_role;

REVOKE ALL ON FUNCTION confirm_venue_cost_rule_gap(date, date, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confirm_venue_cost_rule_gap(date, date, text, uuid) TO authenticated, service_role;
