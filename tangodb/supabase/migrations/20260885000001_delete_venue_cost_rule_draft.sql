-- Allow owners/directors/accountants to discard venue cost rule drafts.

CREATE OR REPLACE FUNCTION delete_venue_cost_rule_draft(
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
  v_result jsonb;
  v_fingerprint text := md5(COALESCE(p_rule_version_id::text, ''));
  v_cached jsonb;
BEGIN
  v_cached := check_operation_idempotency(v_org_id, 'delete_venue_cost_rule_draft', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT member_can_manage_venue_cost_rules() THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_org_id::text || ':venue-rules', 0));

  DELETE FROM venue_cost_rule_versions
  WHERE id = p_rule_version_id
    AND organization_id = v_org_id
    AND status = 'draft';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'draft_not_found');
  END IF;

  v_result := jsonb_build_object('success', true, 'rule_version_id', p_rule_version_id);
  PERFORM store_operation_idempotency(v_org_id, 'delete_venue_cost_rule_draft', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION delete_venue_cost_rule_draft(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_venue_cost_rule_draft(uuid, uuid) TO authenticated;
