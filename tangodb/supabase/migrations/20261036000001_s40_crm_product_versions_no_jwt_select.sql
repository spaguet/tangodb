-- S40 / L6: crm_product_versions is an internal catalog (codes v2/v3), not a SPA table.
-- Write already denied for JWT (S04/H33). SELECT USING (true) was leftover: CRM never
-- queries this table (Edge uses service_role). Drop the open policy; do not GRANT
-- SELECT back to authenticated/anon.

BEGIN;

DROP POLICY IF EXISTS crm_product_versions_select_authenticated ON crm_product_versions;

REVOKE SELECT ON crm_product_versions FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON crm_product_versions TO service_role;

COMMENT ON TABLE crm_product_versions IS
  'S40/L6: not in Data API for authenticated; service_role only. JWT write still denied (S04).';

COMMIT;
