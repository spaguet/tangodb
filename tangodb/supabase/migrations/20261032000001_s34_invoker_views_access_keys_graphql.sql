-- S34 / M5+M6+M7: lock view invoker flags, no client SELECT on access_keys, hide GraphQL.
-- M5: masking views + financial_debtors_v stay security_invoker=false (teacher/accountant
--     lack SELECT on all bases after S09). Venue-cost / rental register already have
--     SELECT on bases for financial roles — keep security_invoker=true.
-- M6: REVOKE SELECT on access_keys from JWT roles; activation is Edge + DEFINER RPC only.
-- M7: graphql_public unused in tangodb/; revoke client usage (config.toml schemas — same change).

BEGIN;

-- =============================================================================
-- 1. M5 — invoker flags (ALTER SET: keep bodies and GRANTs)
-- =============================================================================

-- Masking / R4 views: invoker=true would empty them (no teacher SELECT on base).
ALTER VIEW personal_lessons_teacher_v SET (security_invoker = false);
ALTER VIEW subscriptions_teacher_v SET (security_invoker = false);
ALTER VIEW clients_teacher_v SET (security_invoker = false);
ALTER VIEW calendar_events_teacher_v SET (security_invoker = false);
ALTER VIEW single_visits_teacher_v SET (security_invoker = false);
ALTER VIEW organization_members_roster_v SET (security_invoker = false);
ALTER VIEW organization_invites_team_v SET (security_invoker = false);

-- Debtors join clients/payments/charges/personal_lessons; invoker=true breaks
-- FinanceDebtorsPage if any base GRANT is missing (S09 teacher, S27 named list).
ALTER VIEW financial_debtors_v SET (security_invoker = false);

-- Caller already has SELECT on all bases used by these views (financial roles).
ALTER VIEW finance_cost_entries_v SET (security_invoker = true);
ALTER VIEW rental_money_register_v SET (security_invoker = true);

-- =============================================================================
-- 2. M6 — access_keys: no Data API SELECT for member JWT
-- =============================================================================

DROP POLICY IF EXISTS access_keys_select_owner_org ON access_keys;

REVOKE ALL ON access_keys FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON access_keys TO service_role;

COMMENT ON TABLE access_keys IS
  'S34/M6: no direct client access. Read/write via service_role (Edge) and DEFINER activate_access_key.';

-- =============================================================================
-- 3. M7 — GraphQL schema not a second Data API for JWT
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'graphql_public') THEN
    REVOKE USAGE ON SCHEMA graphql_public FROM PUBLIC, anon, authenticated;
    REVOKE ALL ON ALL TABLES IN SCHEMA graphql_public FROM PUBLIC, anon, authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA graphql_public FROM PUBLIC, anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA graphql_public
      REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA graphql_public
      REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

COMMIT;
