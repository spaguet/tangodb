-- S35 / M23 + M29: expenses write respects closed cash period; director audit without
-- full old_data/new_data snapshots. Do not REVOKE expenses INSERT/DELETE (useExpenses
-- writes the table directly; there is no expenses RPC).

BEGIN;

-- =============================================================================
-- 1. M23 — expenses write policies: closed period (same helper as H29 / S11)
-- =============================================================================

DROP POLICY IF EXISTS expenses_insert ON expenses;
DROP POLICY IF EXISTS expenses_update ON expenses;
DROP POLICY IF EXISTS expenses_delete ON expenses;

CREATE POLICY expenses_insert
  ON expenses FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_read_financial()
    AND NOT _is_finance_period_closed(organization_id, expense_date)
  );

CREATE POLICY expenses_update
  ON expenses FOR UPDATE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_read_financial()
    AND NOT _is_finance_period_closed(organization_id, expense_date)
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_read_financial()
    AND NOT _is_finance_period_closed(organization_id, expense_date)
  );

CREATE POLICY expenses_delete
  ON expenses FOR DELETE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_read_financial()
    AND NOT _is_finance_period_closed(organization_id, expense_date)
  );

-- =============================================================================
-- 2. M29 — director cannot SELECT full row snapshots; owner keeps the trail
-- =============================================================================

DROP POLICY IF EXISTS audit_log_select_leadership ON audit_log;

CREATE POLICY audit_log_select_owner
  ON audit_log FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() = 'owner'
  );

CREATE OR REPLACE VIEW audit_log_leadership_v
WITH (security_invoker = false) AS
SELECT
  al.id,
  al.organization_id,
  al.table_name,
  al.operation,
  al.row_id,
  CASE
    WHEN current_member_role() = 'owner' THEN al.old_data
    ELSE NULL
  END AS old_data,
  CASE
    WHEN current_member_role() = 'owner' THEN al.new_data
    ELSE NULL
  END AS new_data,
  al.changed_at,
  al.changed_by
FROM audit_log al
WHERE al.organization_id = auth_organization_id()
  AND business_row_readable()
  AND current_member_role() IN ('owner', 'director');

REVOKE SELECT ON audit_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON audit_log TO service_role;
GRANT SELECT ON audit_log_leadership_v TO authenticated, service_role;

COMMENT ON VIEW audit_log_leadership_v IS
  'S35/M29: owner sees old_data/new_data; director sees metadata only. Teacher not granted.';

COMMIT;
