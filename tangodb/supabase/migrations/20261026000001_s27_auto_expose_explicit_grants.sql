-- S27 / M31+M32+L10: auto-expose OFF; carpet REVOKE for anon; explicit GRANT for authenticated.
-- After S05–S26 point REVOKEs — do not restore RPC-only write (attendance, payments, rental money, …).

BEGIN;

-- =============================================================================
-- 1. Carpet REVOKE (anon loses all; authenticated reset before explicit GRANT)
-- =============================================================================

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;

-- =============================================================================
-- 2. authenticated: SELECT on SPA-readable tables (named list — not "etc.")
-- =============================================================================

GRANT SELECT ON
  organizations,
  organization_settings,
  organization_licenses,
  organization_subscriptions,
  organization_members,
  organization_invites,
  clients,
  subscriptions,
  subscription_groups,
  subscription_member_changes,
  subscription_freeze_periods,
  subscription_refunds,
  attendance,
  schedule_slots,
  personal_lessons,
  prices,
  price_disciplines,
  price_teacher_members,
  locations,
  disciplines,
  classes,
  payments,
  expenses,
  client_notes,
  calendar_events,
  calendar_event_sessions,
  group_waitlist_entries,
  group_spot_notifications,
  other_income,
  audit_log,
  single_visits,
  personal_lesson_charges,
  teacher_settlements,
  teacher_settlement_payments,
  teacher_pay_rates,
  teacher_pay_rules,
  rental_tariff_rules,
  schedule_occurrence_cancellations,
  lesson_occurrence_closures,
  member_google_calendar_bindings,
  organization_google_calendar_bindings,
  platform_payment_methods,
  renter_documents
TO authenticated;

-- S24 column-level bundle (restore after carpet REVOKE)
REVOKE SELECT ON organization_licenses FROM authenticated;
GRANT SELECT (
  organization_id,
  license_type,
  activated_at,
  expires_at
) ON organization_licenses TO authenticated;

REVOKE SELECT ON organization_subscriptions FROM authenticated;
GRANT SELECT (
  organization_id,
  plan,
  billing_period,
  status,
  provider,
  current_period_start,
  current_period_end
) ON organization_subscriptions TO authenticated;

-- =============================================================================
-- 3. authenticated: SELECT on masking / tenant views
-- =============================================================================

GRANT SELECT ON
  personal_lessons_teacher_v,
  subscriptions_teacher_v,
  financial_debtors_v,
  calendar_events_teacher_v,
  single_visits_teacher_v,
  organization_members_roster_v,
  organization_invites_team_v
TO authenticated;

-- =============================================================================
-- 4. authenticated: SPA direct write (RPC-only tables excluded)
-- =============================================================================

GRANT INSERT ON subscriptions TO authenticated;
GRANT INSERT ON personal_lessons TO authenticated;

GRANT INSERT, UPDATE, DELETE ON schedule_slots TO authenticated;
GRANT INSERT, UPDATE, DELETE ON locations TO authenticated;
GRANT INSERT, UPDATE, DELETE ON expenses TO authenticated;
GRANT INSERT, UPDATE, DELETE ON prices TO authenticated;
GRANT INSERT, UPDATE, DELETE ON price_disciplines TO authenticated;
GRANT INSERT, UPDATE, DELETE ON price_teacher_members TO authenticated;
GRANT INSERT, UPDATE ON clients TO authenticated;
GRANT UPDATE ON organization_settings TO authenticated;
GRANT INSERT, UPDATE, DELETE ON disciplines TO authenticated;
GRANT INSERT, DELETE ON client_notes TO authenticated;

-- =============================================================================
-- 5. Default privileges: new tables do not auto-expose via Data API
-- =============================================================================

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;

COMMIT;
