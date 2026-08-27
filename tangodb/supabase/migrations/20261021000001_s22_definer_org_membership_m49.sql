-- S22 / M34+M56+M49: DEFINER RPC must not leak cross-tenant data by UUID; revoke PUBLIC/anon EXECUTE.
-- Do NOT REVOKE EXECUTE FROM authenticated wholesale — RLS helpers and SPA RPC keep explicit grants.

BEGIN;

-- =============================================================================
-- 1. M34 — tenant guard on DEFINER helpers used in RLS (keep EXECUTE for authenticated)
-- =============================================================================

CREATE OR REPLACE FUNCTION is_active_member(p_user_id uuid, p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT (
      auth_organization_id() IS NULL
      OR p_org_id IS NOT DISTINCT FROM auth_organization_id()
    )
    AND EXISTS (
      SELECT 1
      FROM organization_members om
      WHERE om.user_id = p_user_id
        AND om.organization_id = p_org_id
        AND om.is_active = true
    );
$$;

CREATE OR REPLACE FUNCTION member_role(p_user_id uuid, p_org_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT CASE
    WHEN auth_organization_id() IS NOT NULL
      AND p_org_id IS DISTINCT FROM auth_organization_id()
    THEN NULL
    ELSE (
      SELECT om.role
      FROM organization_members om
      WHERE om.user_id = p_user_id
        AND om.organization_id = p_org_id
        AND om.is_active = true
      LIMIT 1
    )
  END;
$$;

CREATE OR REPLACE FUNCTION member_scope(p_user_id uuid, p_org_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT CASE
    WHEN auth_organization_id() IS NOT NULL
      AND p_org_id IS DISTINCT FROM auth_organization_id()
    THEN NULL
    ELSE (
      SELECT om.scope
      FROM organization_members om
      WHERE om.user_id = p_user_id
        AND om.organization_id = p_org_id
        AND om.is_active = true
      LIMIT 1
    )
  END;
$$;

CREATE OR REPLACE FUNCTION organization_allows_reads(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT (
      auth_organization_id() IS NULL
      OR p_org_id IS NOT DISTINCT FROM auth_organization_id()
    )
    AND EXISTS (
      SELECT 1
      FROM organizations o
      WHERE o.id = p_org_id
        AND o.status IN ('demo_active', 'demo_retention', 'licensed')
    );
$$;

CREATE OR REPLACE FUNCTION organization_allows_writes(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT (
      auth_organization_id() IS NULL
      OR p_org_id IS NOT DISTINCT FROM auth_organization_id()
    )
    AND EXISTS (
      SELECT 1
      FROM organizations o
      WHERE o.id = p_org_id
        AND NOT o.schema_version_locked
        AND (
          (
            o.status = 'demo_active'
            AND (o.demo_expires_at IS NULL OR o.demo_expires_at > now())
          )
          OR (
            o.status = 'licensed'
            AND (
              organization_has_lifetime_license(o.id)
              OR organization_has_active_subscription(o.id)
            )
          )
        )
    );
$$;

-- =============================================================================
-- 2. M34 — entity-scoped DEFINER RPC (subscription / waitlist / scheduled changes)
-- =============================================================================

CREATE OR REPLACE FUNCTION subscription_client_ids_at_date(
  p_sub_id uuid,
  p_as_of date
)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_sub subscriptions%ROWTYPE;
  v_change RECORD;
  v_ids uuid[];
  v_slot smallint;
  v_jwt_org uuid := auth_organization_id();
BEGIN
  SELECT * INTO v_sub
  FROM subscriptions
  WHERE id = p_sub_id;

  IF NOT FOUND THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  IF v_jwt_org IS NOT NULL AND v_sub.organization_id IS DISTINCT FROM v_jwt_org THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  v_ids := subscription_client_id_array(
    v_sub.client_id1,
    v_sub.client_id2,
    v_sub.client_id3,
    v_sub.client_id4
  );

  FOR v_change IN
    SELECT smc.member_slot, smc.outgoing_client_id, smc.incoming_client_id
    FROM subscription_member_changes smc
    WHERE smc.subscription_id = p_sub_id
      AND smc.organization_id = v_sub.organization_id
      AND smc.status = 'applied'
      AND smc.effective_date > p_as_of
    ORDER BY smc.effective_date DESC, smc.created_at DESC, smc.id DESC
  LOOP
    v_slot := v_change.member_slot;
    IF v_slot = 1 THEN
      IF v_sub.client_id1 = v_change.incoming_client_id THEN
        v_sub.client_id1 := v_change.outgoing_client_id;
      END IF;
    ELSIF v_slot = 2 THEN
      IF v_sub.client_id2 = v_change.incoming_client_id THEN
        v_sub.client_id2 := v_change.outgoing_client_id;
      END IF;
    ELSIF v_slot = 3 THEN
      IF v_sub.client_id3 = v_change.incoming_client_id THEN
        v_sub.client_id3 := v_change.outgoing_client_id;
      END IF;
    ELSIF v_slot = 4 THEN
      IF v_sub.client_id4 = v_change.incoming_client_id THEN
        v_sub.client_id4 := v_change.outgoing_client_id;
      END IF;
    END IF;
  END LOOP;

  RETURN subscription_client_id_array(
    v_sub.client_id1,
    v_sub.client_id2,
    v_sub.client_id3,
    v_sub.client_id4
  );
END;
$$;

CREATE OR REPLACE FUNCTION subscription_client_display_for_date(
  p_sub_id uuid,
  p_as_of date
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid;
  v_client_id uuid;
  v_display text := '';
  v_name text;
  v_jwt_org uuid := auth_organization_id();
BEGIN
  SELECT organization_id INTO v_org_id FROM subscriptions WHERE id = p_sub_id;
  IF NOT FOUND THEN
    RETURN '';
  END IF;

  IF v_jwt_org IS NOT NULL AND v_org_id IS DISTINCT FROM v_jwt_org THEN
    RETURN '';
  END IF;

  FOR v_client_id IN
    SELECT unnest(subscription_client_ids_at_date(p_sub_id, p_as_of))
  LOOP
    SELECT TRIM(c.last_name || ' ' || c.first_name)
    INTO v_name
    FROM clients c
    WHERE c.id = v_client_id
      AND c.organization_id = v_org_id;

    IF v_name IS NULL OR v_name = '' THEN
      v_name := v_client_id::text;
    END IF;

    IF v_display = '' THEN
      v_display := v_name;
    ELSE
      v_display := v_display || ' & ' || v_name;
    END IF;
  END LOOP;

  RETURN v_display;
END;
$$;

CREATE OR REPLACE FUNCTION apply_scheduled_subscription_member_changes(
  p_org_id uuid DEFAULT auth_organization_id()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_change RECORD;
  v_today date := CURRENT_DATE;
  v_org_id uuid := auth_organization_id();
BEGIN
  IF v_org_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_change IN
    SELECT smc.*
    FROM subscription_member_changes smc
    INNER JOIN subscriptions s
      ON s.id = smc.subscription_id
     AND s.organization_id = smc.organization_id
    WHERE smc.organization_id = v_org_id
      AND smc.status = 'scheduled'
      AND smc.effective_date <= v_today
    ORDER BY smc.effective_date ASC, smc.created_at ASC, smc.id ASC
    FOR UPDATE OF smc, s
  LOOP
    IF v_change.member_slot = 1 THEN
      UPDATE subscriptions
      SET client_id1 = v_change.incoming_client_id
      WHERE id = v_change.subscription_id
        AND organization_id = v_org_id
        AND client_id1 = v_change.outgoing_client_id;
    ELSIF v_change.member_slot = 2 THEN
      UPDATE subscriptions
      SET client_id2 = v_change.incoming_client_id
      WHERE id = v_change.subscription_id
        AND organization_id = v_org_id
        AND client_id2 = v_change.outgoing_client_id;
    ELSIF v_change.member_slot = 3 THEN
      UPDATE subscriptions
      SET client_id3 = v_change.incoming_client_id
      WHERE id = v_change.subscription_id
        AND organization_id = v_org_id
        AND client_id3 = v_change.outgoing_client_id;
    ELSIF v_change.member_slot = 4 THEN
      UPDATE subscriptions
      SET client_id4 = v_change.incoming_client_id
      WHERE id = v_change.subscription_id
        AND organization_id = v_org_id
        AND client_id4 = v_change.outgoing_client_id;
    END IF;

    UPDATE subscription_member_changes
    SET status = 'applied', applied_at = now()
    WHERE id = v_change.id;

    UPDATE attendance a
    SET client_display = subscription_client_display_for_date(v_change.subscription_id, a.date)
    WHERE a.organization_id = v_org_id
      AND a.subscription_id = v_change.subscription_id
      AND a.date >= v_change.effective_date;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION count_group_occupied_seats(
  p_org_id uuid,
  p_class_id uuid,
  p_as_of date DEFAULT CURRENT_DATE
)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT CASE
    WHEN auth_organization_id() IS NULL THEN
      COALESCE((
        SELECT count(DISTINCT client_id)::int
        FROM (
          SELECT unnest(subscription_client_ids_at_date(s.id, p_as_of)) AS client_id
          FROM subscriptions s
          INNER JOIN subscription_groups sg
            ON sg.organization_id = s.organization_id
           AND sg.subscription_id = s.id
           AND sg.schedule_group_id = p_class_id
          WHERE s.organization_id = p_org_id
            AND subscription_occupies_group_seat(s, p_as_of)
        ) occupied
      ), 0)
    WHEN p_org_id IS DISTINCT FROM auth_organization_id() THEN
      0
    ELSE
      COALESCE((
        SELECT count(DISTINCT client_id)::int
        FROM (
          SELECT unnest(subscription_client_ids_at_date(s.id, p_as_of)) AS client_id
          FROM subscriptions s
          INNER JOIN subscription_groups sg
            ON sg.organization_id = s.organization_id
           AND sg.subscription_id = s.id
           AND sg.schedule_group_id = p_class_id
          WHERE s.organization_id = auth_organization_id()
            AND subscription_occupies_group_seat(s, p_as_of)
        ) occupied
      ), 0)
  END;
$$;

-- =============================================================================
-- 3. M56 — venue gap acknowledgement oracle
-- =============================================================================

CREATE OR REPLACE FUNCTION venue_cost_gap_is_acknowledged(
  p_org_id uuid,
  p_expired_rule_id uuid,
  p_at date
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT CASE
    WHEN auth_organization_id() IS NOT NULL
      AND p_org_id IS DISTINCT FROM auth_organization_id()
    THEN false
    ELSE EXISTS (
      SELECT 1
      FROM venue_rule_gap_acknowledgements g
      WHERE g.organization_id = p_org_id
        AND g.expired_rule_id = p_expired_rule_id
        AND p_at >= g.gap_from
        AND (g.gap_to IS NULL OR p_at <= g.gap_to)
    )
  END;
$$;

-- =============================================================================
-- 4. Internal-only license / developer / teacher oracle helpers — no client EXECUTE
-- =============================================================================

REVOKE ALL ON FUNCTION organization_has_lifetime_license(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION organization_has_lifetime_license(uuid) TO service_role;

REVOKE ALL ON FUNCTION organization_has_active_subscription(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION organization_has_active_subscription(uuid) TO service_role;

REVOKE ALL ON FUNCTION is_platform_developer(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION is_platform_developer(uuid) TO service_role;

REVOKE ALL ON FUNCTION teacher_member_has_future_lessons(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION teacher_member_has_future_lessons(uuid, uuid) TO service_role;

-- =============================================================================
-- 5. M49 — default PUBLIC EXECUTE on all functions; never revoke authenticated wholesale
-- =============================================================================

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION run_version_migration_v2_to_v3(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION run_version_migration_v2_to_v3(uuid, boolean) TO service_role;

REVOKE ALL ON FUNCTION run_version_migration_v3_to_v2(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION run_version_migration_v3_to_v2(uuid, boolean) TO service_role;

REVOKE ALL ON FUNCTION execute_version_migration_script(uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION execute_version_migration_script(uuid, text, text, boolean) TO service_role;

COMMIT;
