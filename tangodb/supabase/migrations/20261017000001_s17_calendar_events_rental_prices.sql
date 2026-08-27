-- S17 / H24, H25, H28: teacher calendar_events without financial columns; rental series/renters
-- write only via RPC; price_disciplines / price_teacher_members write = can_manage_prices().

BEGIN;

-- =============================================================================
-- 1. calendar_events: teacher reads masking view (H24)
-- =============================================================================

DROP VIEW IF EXISTS calendar_events_teacher_v;

CREATE VIEW calendar_events_teacher_v
WITH (security_invoker = false) AS
SELECT
  ce.id,
  ce.organization_id,
  ce.title,
  ce.event_type,
  ce.comment,
  ce.guest_teacher,
  ce.organizer,
  ce.planned_guest_count
FROM calendar_events ce
WHERE ce.organization_id = auth_organization_id()
  AND business_row_readable()
  AND current_member_role() = 'teacher';

GRANT SELECT ON calendar_events_teacher_v TO authenticated;

DROP POLICY IF EXISTS calendar_events_select_teacher ON calendar_events;

-- =============================================================================
-- 2. Rental series + renters CRM: REVOKE write; UI uses RPC (H25)
-- =============================================================================

REVOKE INSERT, UPDATE, DELETE ON rental_series FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON rental_series_patterns FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON rental_series_exceptions FROM anon, authenticated;

REVOKE INSERT, UPDATE, DELETE ON renters FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON renter_contacts FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON renter_contracts FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON renter_contract_rental_links FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON renter_documents FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON renter_communications FROM anon, authenticated;

GRANT SELECT ON rental_series TO authenticated;
GRANT SELECT ON rental_series_patterns TO authenticated;
GRANT SELECT ON rental_series_exceptions TO authenticated;
GRANT SELECT ON renters TO authenticated;
GRANT SELECT ON renter_contacts TO authenticated;
GRANT SELECT ON renter_contracts TO authenticated;
GRANT SELECT ON renter_contract_rental_links TO authenticated;
GRANT SELECT ON renter_documents TO authenticated;
GRANT SELECT ON renter_communications TO authenticated;

DROP POLICY IF EXISTS rental_series_write ON rental_series;
DROP POLICY IF EXISTS rental_series_patterns_write ON rental_series_patterns;
DROP POLICY IF EXISTS rental_series_exceptions_write ON rental_series_exceptions;

DROP POLICY IF EXISTS renters_insert ON renters;
DROP POLICY IF EXISTS renters_update ON renters;
DROP POLICY IF EXISTS renter_contacts_write ON renter_contacts;
DROP POLICY IF EXISTS renter_contracts_write ON renter_contracts;
DROP POLICY IF EXISTS renter_contract_rental_links_write ON renter_contract_rental_links;
DROP POLICY IF EXISTS renter_documents_write ON renter_documents;
DROP POLICY IF EXISTS renter_communications_write ON renter_communications;

-- =============================================================================
-- 3. Price junction tables: write only can_manage_prices() (H28)
-- =============================================================================

DROP POLICY IF EXISTS price_disciplines_write_admin ON price_disciplines;

CREATE POLICY price_disciplines_write_manage
  ON price_disciplines FOR ALL TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_manage_prices()
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_manage_prices()
  );

DROP POLICY IF EXISTS price_teacher_members_write_admin ON price_teacher_members;

CREATE POLICY price_teacher_members_write_manage
  ON price_teacher_members FOR ALL TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_manage_prices()
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_manage_prices()
  );

COMMIT;
