-- DC1 (Prompt 18): Dev Console tenant admin — storage estimate, org notes, manual purge

-- =============================================================================
-- 1. Payment ref on organizations (manual purchase lookup)
-- =============================================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS payment_ref TEXT;

CREATE INDEX IF NOT EXISTS idx_organizations_payment_ref
  ON organizations (upper(payment_ref))
  WHERE payment_ref IS NOT NULL;

-- =============================================================================
-- 2. Support notes (service role only)
-- =============================================================================

CREATE TABLE IF NOT EXISTS platform_org_notes (
  organization_id UUID PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  note            TEXT NOT NULL DEFAULT '',
  updated_by      UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE platform_org_notes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON platform_org_notes FROM anon, authenticated;

-- =============================================================================
-- 3. Safe email lookup for Dev Console tenant search
-- =============================================================================

CREATE OR REPLACE FUNCTION dev_console_user_ids_by_email(p_query text)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT u.id
  FROM auth.users u
  WHERE length(trim(coalesce(p_query, ''))) >= 3
    AND (
      lower(u.email) = lower(trim(p_query))
      OR lower(u.email) LIKE '%' || lower(trim(p_query)) || '%'
    )
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION dev_console_user_ids_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dev_console_user_ids_by_email(text) TO service_role;

-- =============================================================================
-- 4. estimate_org_storage — row counts + heuristic bytes (MVP)
-- =============================================================================

CREATE OR REPLACE FUNCTION estimate_org_storage(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clients       bigint := 0;
  v_subscriptions bigint := 0;
  v_payments      bigint := 0;
  v_attendance    bigint := 0;
  v_personal      bigint := 0;
  v_schedule      bigint := 0;
  v_prices        bigint := 0;
  v_disciplines   bigint := 0;
  v_locations     bigint := 0;
  v_classes       bigint := 0;
  v_members       bigint := 0;
  v_total_rows    bigint := 0;
  v_estimated_bytes bigint := 0;
BEGIN
  IF p_org_id IS NULL THEN
    RETURN jsonb_build_object('total_rows', 0, 'estimated_bytes', 0, 'breakdown', '{}'::jsonb);
  END IF;

  SELECT count(*) INTO v_clients FROM clients WHERE organization_id = p_org_id;
  SELECT count(*) INTO v_subscriptions FROM subscriptions WHERE organization_id = p_org_id;
  SELECT count(*) INTO v_payments FROM payments WHERE organization_id = p_org_id;
  SELECT count(*) INTO v_attendance FROM attendance WHERE organization_id = p_org_id;
  SELECT count(*) INTO v_personal FROM personal_lessons WHERE organization_id = p_org_id;
  SELECT count(*) INTO v_schedule FROM schedule_slots WHERE organization_id = p_org_id;
  SELECT count(*) INTO v_prices FROM prices WHERE organization_id = p_org_id;
  SELECT count(*) INTO v_disciplines FROM disciplines WHERE organization_id = p_org_id;
  SELECT count(*) INTO v_locations FROM locations WHERE organization_id = p_org_id;
  SELECT count(*) INTO v_classes FROM classes WHERE organization_id = p_org_id;
  SELECT count(*) INTO v_members FROM organization_members WHERE organization_id = p_org_id;

  v_total_rows :=
    v_clients + v_subscriptions + v_payments + v_attendance + v_personal
    + v_schedule + v_prices + v_disciplines + v_locations + v_classes + v_members;

  -- Heuristic: ~2 KB per row (decision_log DC1)
  v_estimated_bytes := v_total_rows * 2048;

  RETURN jsonb_build_object(
    'total_rows', v_total_rows,
    'estimated_bytes', v_estimated_bytes,
    'breakdown', jsonb_build_object(
      'clients', v_clients,
      'subscriptions', v_subscriptions,
      'payments', v_payments,
      'attendance', v_attendance,
      'personal_lessons', v_personal,
      'schedule_slots', v_schedule,
      'prices', v_prices,
      'disciplines', v_disciplines,
      'locations', v_locations,
      'classes', v_classes,
      'members', v_members
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION estimate_org_storage(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION estimate_org_storage(uuid) TO service_role;

-- =============================================================================
-- 5. Manual single-org purge (reuse cron purge logic)
-- =============================================================================

CREATE OR REPLACE FUNCTION purge_single_organization(
  p_org_id uuid,
  p_actor_user_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_force_licensed boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org record;
  v_key_id uuid;
  v_has_lifetime boolean := false;
  v_has_active_sub boolean := false;
BEGIN
  SELECT o.id, o.access_key_id, o.name, o.status, o.owner_user_id
  INTO v_org
  FROM organizations o
  WHERE o.id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_not_found' USING ERRCODE = '22023';
  END IF;

  IF v_org.status = 'purged' THEN
    RAISE EXCEPTION 'organization_already_purged' USING ERRCODE = '22023';
  END IF;

  SELECT organization_has_lifetime_license(p_org_id) INTO v_has_lifetime;

  IF v_has_lifetime AND NOT coalesce(p_force_licensed, false) THEN
    RAISE EXCEPTION 'licensed_org_purge_forbidden' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM organization_subscriptions os
    WHERE os.organization_id = p_org_id
      AND os.status IN ('active', 'past_due')
  ) INTO v_has_active_sub;

  IF v_has_active_sub AND NOT coalesce(p_force_licensed, false) THEN
    RAISE EXCEPTION 'active_subscription_purge_forbidden' USING ERRCODE = '22023';
  END IF;

  v_key_id := v_org.access_key_id;

  DELETE FROM user_active_organizations uao
  WHERE uao.organization_id = p_org_id;

  DELETE FROM organization_licenses ol
  WHERE ol.organization_id = p_org_id;

  DELETE FROM organization_members om
  WHERE om.organization_id = p_org_id;

  DELETE FROM organization_settings os
  WHERE os.organization_id = p_org_id;

  UPDATE organizations
  SET
    name = 'purged',
    slug = NULL,
    status = 'purged',
    owner_user_id = NULL,
    demo_activated_at = NULL,
    demo_expires_at = NULL,
    data_purge_at = NULL,
    access_key_id = NULL,
    payment_ref = NULL
  WHERE id = p_org_id;

  IF v_key_id IS NOT NULL THEN
    UPDATE access_keys
    SET status = 'consumed'
    WHERE id = v_key_id
      AND key_type = 'demo';
  END IF;

  UPDATE demo_owner_retention
  SET purged_at = now()
  WHERE purged_at IS NULL
    AND owner_email_hash IN (
      SELECT owner_email_hash(u.email)
      FROM auth.users u
      WHERE u.id = v_org.owner_user_id
    );

  INSERT INTO platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  VALUES (
    p_actor_user_id,
    'org.manual_purge',
    'organization',
    p_org_id,
    jsonb_build_object(
      'previous_name', v_org.name,
      'previous_status', v_org.status,
      'reason', left(coalesce(p_reason, ''), 500),
      'force_licensed', coalesce(p_force_licensed, false)
    )
  );

  RETURN jsonb_build_object('ok', true, 'organization_id', p_org_id);
END;
$$;

REVOKE ALL ON FUNCTION purge_single_organization(uuid, uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_single_organization(uuid, uuid, text, boolean) TO service_role;
