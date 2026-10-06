-- E1b / 2.12.1: time-aware edition helpers, writes wrap (flag off = 2.11), caps, table triggers, edition RPC.

BEGIN;

-- =============================================================================
-- 1. Core helpers (§3.1, §4.4)
-- =============================================================================

CREATE OR REPLACE FUNCTION organization_edition_rank(p_edition text)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_edition
    WHEN 'lite' THEN 1
    WHEN 'studio' THEN 2
    WHEN 'pro' THEN 3
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION organization_edition_from_rank(p_rank int)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_rank
    WHEN 1 THEN 'lite'
    WHEN 2 THEN 'studio'
    WHEN 3 THEN 'pro'
    ELSE 'lite'
  END;
$$;

CREATE OR REPLACE FUNCTION organization_entitlement_phase(
  p_instrument text,
  p_status text,
  p_period_end timestamptz,
  p_now timestamptz DEFAULT now()
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_instrument IN ('free_lifetime', 'pro_lifetime') THEN
    RETURN p_status;
  END IF;

  IF p_instrument = 'trial_pro' THEN
    IF p_status = 'canceled' THEN
      RETURN 'canceled';
    END IF;
    IF p_period_end IS NOT NULL AND p_period_end <= p_now THEN
      RETURN 'canceled';
    END IF;
    RETURN p_status;
  END IF;

  IF p_instrument IN ('studio_monthly', 'pro_monthly') THEN
    IF p_status = 'canceled' THEN
      RETURN 'canceled';
    END IF;
    IF p_period_end IS NULL THEN
      RETURN 'canceled';
    END IF;
    IF p_now < p_period_end THEN
      RETURN 'active';
    END IF;
    IF p_now < p_period_end + interval '7 days' THEN
      RETURN 'past_due';
    END IF;
    RETURN 'canceled';
  END IF;

  RETURN p_status;
END;
$$;

CREATE OR REPLACE FUNCTION organization_entitlement_row_phase(
  p_row organization_entitlements,
  p_now timestamptz DEFAULT now()
)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT organization_entitlement_phase(
    p_row.instrument,
    p_row.status,
    p_row.period_end,
    p_now
  );
$$;

CREATE OR REPLACE FUNCTION organization_effective_ceiling(p_org_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_max_rank int := 1;
  v_row organization_entitlements%ROWTYPE;
BEGIN
  FOR v_row IN
    SELECT e.*
    FROM organization_entitlements e
    WHERE e.organization_id = p_org_id
      AND e.status IN ('active', 'past_due')
  LOOP
    IF organization_entitlement_row_phase(v_row, v_now) IN ('active', 'past_due') THEN
      v_max_rank := greatest(v_max_rank, organization_edition_rank(v_row.edition));
    END IF;
  END LOOP;

  RETURN organization_edition_from_rank(v_max_rank);
END;
$$;

CREATE OR REPLACE FUNCTION organization_max_raising_active_rank(p_org_id uuid)
RETURNS int
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_max int := 0;
  v_row organization_entitlements%ROWTYPE;
BEGIN
  FOR v_row IN
    SELECT e.*
    FROM organization_entitlements e
    WHERE e.organization_id = p_org_id
      AND e.instrument IN ('trial_pro', 'studio_monthly', 'pro_monthly', 'pro_lifetime')
      AND e.status IN ('active', 'past_due')
  LOOP
    IF organization_entitlement_row_phase(v_row, v_now) = 'active' THEN
      v_max := greatest(v_max, organization_edition_rank(v_row.edition));
    END IF;
  END LOOP;

  RETURN v_max;
END;
$$;

CREATE OR REPLACE FUNCTION organization_active_edition(p_org_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_state text;
  v_state_rank int;
  v_max_active int;
  v_monthly_past_due boolean;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM organization_entitlements e
    WHERE e.organization_id = p_org_id
      AND e.instrument IN ('studio_monthly', 'pro_monthly')
      AND e.status IN ('active', 'past_due')
      AND organization_entitlement_row_phase(e, v_now) = 'past_due'
  ) THEN
    RETURN 'lite';
  END IF;

  SELECT s.active_edition INTO v_state
  FROM organization_edition_state s
  WHERE s.organization_id = p_org_id;

  IF v_state IS NULL THEN
    RETURN 'lite';
  END IF;

  v_max_active := organization_max_raising_active_rank(p_org_id);
  IF v_max_active <= 0 THEN
    v_max_active := 1;
  END IF;

  v_state_rank := organization_edition_rank(v_state);
  RETURN organization_edition_from_rank(least(v_state_rank, v_max_active));
END;
$$;

CREATE OR REPLACE FUNCTION organization_within_edition_cap(p_org_id uuid, p_resource text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count bigint;
BEGIN
  IF NOT editions_lifecycle_enabled() THEN
    RETURN true;
  END IF;

  IF organization_active_edition(p_org_id) <> 'lite' THEN
    RETURN true;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_org_id::text || ':edition-cap:' || p_resource, 0)
  );

  CASE p_resource
    WHEN 'locations' THEN
      SELECT count(*) INTO v_count FROM locations l WHERE l.organization_id = p_org_id;
      RETURN v_count < 1;
    WHEN 'disciplines' THEN
      SELECT count(*) INTO v_count FROM disciplines d WHERE d.organization_id = p_org_id;
      RETURN v_count < 1;
    WHEN 'clients' THEN
      SELECT count(*) INTO v_count
      FROM clients c
      WHERE c.organization_id = p_org_id
        AND c.archived_at IS NULL;
      RETURN v_count < 200;
    WHEN 'members' THEN
      SELECT
        (
          SELECT count(*)
          FROM organization_members om
          WHERE om.organization_id = p_org_id
            AND om.is_active
        )
        + (
          SELECT count(*)
          FROM organization_invites oi
          WHERE oi.organization_id = p_org_id
            AND oi.accepted_at IS NULL
            AND oi.revoked_at IS NULL
            AND oi.expires_at > now()
        )
      INTO v_count;
      RETURN v_count < 8;
    ELSE
      RETURN true;
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION edition_allows(p_org_id uuid, p_capability text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ed text;
BEGIN
  IF NOT editions_lifecycle_enabled() THEN
    RETURN true;
  END IF;

  v_ed := organization_active_edition(p_org_id);

  CASE p_capability
    WHEN 'schedule', 'attendance' THEN
      RETURN true;
    WHEN 'clients' THEN
      RETURN true;
    WHEN 'multi_location' THEN
      IF v_ed = 'lite' THEN
        RETURN organization_within_edition_cap(p_org_id, 'locations');
      END IF;
      RETURN v_ed IN ('studio', 'pro');
    WHEN 'multi_discipline' THEN
      IF v_ed = 'lite' THEN
        RETURN organization_within_edition_cap(p_org_id, 'disciplines');
      END IF;
      RETURN v_ed IN ('studio', 'pro');
    WHEN 'group_subscriptions', 'personal_lessons', 'prices', 'single_visits',
         'export_operational' THEN
      RETURN v_ed IN ('studio', 'pro');
    WHEN 'finance', 'payroll', 'hall_rent', 'renter_miniapp', 'google_calendar',
         'calendar_events', 'export_financial', 'offline_attendance' THEN
      RETURN v_ed = 'pro';
    ELSE
      RETURN false;
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION _edition_raise(p_code text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '%', p_code USING ERRCODE = 'P0001';
END;
$$;

-- =============================================================================
-- 2. organization_allows_writes / renter_miniapp (F91)
-- =============================================================================

CREATE OR REPLACE FUNCTION organization_allows_writes(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT CASE
    WHEN NOT editions_lifecycle_enabled() THEN (
      (
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
      )
    )
    ELSE (
      (
        auth_organization_id() IS NULL
        OR p_org_id IS NOT DISTINCT FROM auth_organization_id()
      )
      AND EXISTS (
        SELECT 1
        FROM organizations o
        WHERE o.id = p_org_id
          AND NOT o.schema_version_locked
          AND o.status IN ('demo_active', 'licensed')
          AND (
            (
              o.status = 'demo_active'
              AND (o.demo_expires_at IS NULL OR o.demo_expires_at > now())
            )
            OR (
              o.status = 'licensed'
              AND EXISTS (
                SELECT 1
                FROM organization_entitlements e
                WHERE e.organization_id = o.id
                  AND e.instrument = 'free_lifetime'
                  AND e.status IN ('active', 'past_due')
                  AND organization_entitlement_row_phase(e, now()) = 'active'
              )
            )
          )
      )
    )
  END;
$$;

CREATE OR REPLACE FUNCTION renter_miniapp_addon_is_active(p_org uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_jwt jsonb;
  v_renter_org uuid;
  v_actor text;
  v_uid uuid;
  v_visible boolean;
BEGIN
  IF p_org IS NULL THEN
    RETURN false;
  END IF;

  BEGIN
    v_jwt := COALESCE(
      auth.jwt(),
      NULLIF(current_setting('request.jwt.claims', true), '')::jsonb,
      '{}'::jsonb
    );
  EXCEPTION WHEN invalid_text_representation THEN
    v_jwt := '{}'::jsonb;
  END;

  v_uid := auth.uid();
  v_actor := COALESCE(v_jwt -> 'app_metadata' ->> 'actor', '');

  BEGIN
    v_renter_org := NULLIF(v_jwt -> 'app_metadata' ->> 'organization_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_renter_org := NULL;
  END;

  IF v_uid IS NOT NULL OR v_actor = 'renter' THEN
    v_visible :=
      auth_organization_id() = p_org
      OR (v_actor = 'renter' AND v_renter_org = p_org);

    IF v_visible IS NOT TRUE THEN
      RETURN false;
    END IF;
  END IF;

  IF NOT editions_lifecycle_enabled() THEN
    RETURN EXISTS (
      SELECT 1
      FROM organizations o
      WHERE o.id = p_org
        AND NOT o.schema_version_locked
        AND o.status = 'licensed'
        AND (
          organization_has_lifetime_license(o.id)
          OR organization_has_active_subscription(o.id)
        )
    );
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM organizations o
    WHERE o.id = p_org
      AND NOT o.schema_version_locked
      AND o.status = 'licensed'
  )
  AND organization_active_edition(p_org) = 'pro'
  AND edition_allows(p_org, 'renter_miniapp')
  AND NOT EXISTS (
    SELECT 1
    FROM organization_entitlements e
    WHERE e.organization_id = p_org
      AND e.instrument = 'trial_pro'
      AND e.status IN ('active', 'past_due')
      AND organization_entitlement_row_phase(e, now()) = 'active'
  );
END;
$$;

REVOKE ALL ON FUNCTION organization_edition_rank(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION organization_edition_from_rank(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION organization_entitlement_phase(text, text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION organization_entitlement_row_phase(organization_entitlements, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION organization_effective_ceiling(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION organization_max_raising_active_rank(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION organization_active_edition(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION organization_within_edition_cap(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION edition_allows(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _edition_raise(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION organization_edition_rank(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION organization_edition_from_rank(int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION organization_entitlement_phase(text, text, timestamptz, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION organization_entitlement_row_phase(organization_entitlements, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION organization_effective_ceiling(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION organization_max_raising_active_rank(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION organization_active_edition(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION organization_within_edition_cap(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION edition_allows(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION _edition_raise(text) TO service_role;

GRANT EXECUTE ON FUNCTION editions_lifecycle_enabled() TO authenticated;

-- =============================================================================
-- 3. Edition / cap triggers (§18.9, §18.12, F98)
-- =============================================================================

CREATE OR REPLACE FUNCTION _edition_gate_personal_lessons()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT editions_lifecycle_enabled() OR TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF NOT edition_allows(NEW.organization_id, 'personal_lessons') THEN
    PERFORM _edition_raise('edition_forbidden');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION _edition_gate_prices()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT editions_lifecycle_enabled() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF NOT edition_allows(COALESCE(NEW.organization_id, OLD.organization_id), 'prices') THEN
    PERFORM _edition_raise('edition_forbidden');
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION _edition_gate_expenses()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT editions_lifecycle_enabled() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF NOT edition_allows(COALESCE(NEW.organization_id, OLD.organization_id), 'finance') THEN
    PERFORM _edition_raise('edition_forbidden');
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION _edition_gate_subscriptions_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT editions_lifecycle_enabled() OR TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF NOT edition_allows(NEW.organization_id, 'group_subscriptions') THEN
    PERFORM _edition_raise('edition_forbidden');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION _edition_gate_subscription_groups_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT editions_lifecycle_enabled() OR TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF NOT edition_allows(NEW.organization_id, 'group_subscriptions') THEN
    PERFORM _edition_raise('edition_forbidden');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION _edition_cap_locations_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT editions_lifecycle_enabled() OR TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF NOT organization_within_edition_cap(NEW.organization_id, 'locations') THEN
    PERFORM _edition_raise('edition_cap_exceeded');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION _edition_cap_disciplines_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT editions_lifecycle_enabled() OR TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF NOT organization_within_edition_cap(NEW.organization_id, 'disciplines') THEN
    PERFORM _edition_raise('edition_cap_exceeded');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION _edition_cap_clients()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT editions_lifecycle_enabled() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT organization_within_edition_cap(NEW.organization_id, 'clients') THEN
      PERFORM _edition_raise('edition_cap_exceeded');
    END IF;
  ELSIF TG_OP = 'UPDATE'
    AND OLD.archived_at IS NOT NULL
    AND NEW.archived_at IS NULL
  THEN
    IF NOT organization_within_edition_cap(NEW.organization_id, 'clients') THEN
      PERFORM _edition_raise('edition_cap_exceeded');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION _edition_cap_members()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT editions_lifecycle_enabled() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.is_active
      AND NOT organization_within_edition_cap(NEW.organization_id, 'members')
    THEN
      PERFORM _edition_raise('edition_cap_exceeded');
    END IF;
  ELSIF TG_OP = 'UPDATE'
    AND OLD.is_active = false
    AND NEW.is_active = true
  THEN
    IF NOT organization_within_edition_cap(NEW.organization_id, 'members') THEN
      PERFORM _edition_raise('edition_cap_exceeded');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS edition_gate_personal_lessons_insert ON personal_lessons;
CREATE TRIGGER edition_gate_personal_lessons_insert
  BEFORE INSERT ON personal_lessons
  FOR EACH ROW
  EXECUTE FUNCTION _edition_gate_personal_lessons();

DROP TRIGGER IF EXISTS edition_gate_prices ON prices;
CREATE TRIGGER edition_gate_prices
  BEFORE INSERT OR UPDATE OR DELETE ON prices
  FOR EACH ROW
  EXECUTE FUNCTION _edition_gate_prices();

DROP TRIGGER IF EXISTS edition_gate_price_teacher_members ON price_teacher_members;
CREATE TRIGGER edition_gate_price_teacher_members
  BEFORE INSERT OR UPDATE OR DELETE ON price_teacher_members
  FOR EACH ROW
  EXECUTE FUNCTION _edition_gate_prices();

DROP TRIGGER IF EXISTS edition_gate_price_disciplines ON price_disciplines;
CREATE TRIGGER edition_gate_price_disciplines
  BEFORE INSERT OR UPDATE OR DELETE ON price_disciplines
  FOR EACH ROW
  EXECUTE FUNCTION _edition_gate_prices();

DROP TRIGGER IF EXISTS edition_gate_expenses ON expenses;
CREATE TRIGGER edition_gate_expenses
  BEFORE INSERT OR UPDATE OR DELETE ON expenses
  FOR EACH ROW
  EXECUTE FUNCTION _edition_gate_expenses();

DROP TRIGGER IF EXISTS edition_gate_subscriptions_insert ON subscriptions;
CREATE TRIGGER edition_gate_subscriptions_insert
  BEFORE INSERT ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION _edition_gate_subscriptions_insert();

DROP TRIGGER IF EXISTS edition_gate_subscription_groups_insert ON subscription_groups;
CREATE TRIGGER edition_gate_subscription_groups_insert
  BEFORE INSERT ON subscription_groups
  FOR EACH ROW
  EXECUTE FUNCTION _edition_gate_subscription_groups_insert();

DROP TRIGGER IF EXISTS edition_cap_locations_insert ON locations;
CREATE TRIGGER edition_cap_locations_insert
  BEFORE INSERT ON locations
  FOR EACH ROW
  EXECUTE FUNCTION _edition_cap_locations_insert();

DROP TRIGGER IF EXISTS edition_cap_disciplines_insert ON disciplines;
CREATE TRIGGER edition_cap_disciplines_insert
  BEFORE INSERT ON disciplines
  FOR EACH ROW
  EXECUTE FUNCTION _edition_cap_disciplines_insert();

DROP TRIGGER IF EXISTS edition_cap_clients ON clients;
CREATE TRIGGER edition_cap_clients
  BEFORE INSERT OR UPDATE ON clients
  FOR EACH ROW
  EXECUTE FUNCTION _edition_cap_clients();

DROP TRIGGER IF EXISTS edition_cap_members ON organization_members;
CREATE TRIGGER edition_cap_members
  BEFORE INSERT OR UPDATE ON organization_members
  FOR EACH ROW
  EXECUTE FUNCTION _edition_cap_members();

-- =============================================================================
-- 4. Edition RPC (§18.4)
-- =============================================================================

CREATE OR REPLACE FUNCTION get_organization_edition(p_org_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := coalesce(p_org_id, auth_organization_id());
  v_now timestamptz := now();
  v_active text;
  v_ceiling text;
  v_state_col text;
  v_month_phase text;
  v_caps jsonb;
  v_instruments jsonb;
BEGIN
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'no active organization';
  END IF;

  IF auth_organization_id() IS NOT NULL
    AND v_org_id IS DISTINCT FROM auth_organization_id()
  THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  IF auth.uid() IS NOT NULL
    AND NOT is_active_member(auth.uid(), v_org_id)
  THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  v_active := organization_active_edition(v_org_id);
  v_ceiling := organization_effective_ceiling(v_org_id);

  SELECT s.active_edition INTO v_state_col
  FROM organization_edition_state s
  WHERE s.organization_id = v_org_id;

  IF v_state_col IS NULL THEN
    v_state_col := 'lite';
  END IF;

  IF organization_edition_rank(v_state_col) > organization_edition_rank(v_active) THEN
    v_state_col := v_active;
  END IF;

  SELECT organization_entitlement_row_phase(e, v_now)
  INTO v_month_phase
  FROM organization_entitlements e
  WHERE e.organization_id = v_org_id
    AND e.instrument IN ('studio_monthly', 'pro_monthly')
    AND e.status IN ('active', 'past_due')
  ORDER BY organization_edition_rank(e.edition) DESC
  LIMIT 1;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'instrument', e.instrument,
      'edition', e.edition,
      'status', e.status,
      'phase', organization_entitlement_row_phase(e, v_now),
      'period_end', e.period_end
    )
  ), '[]'::jsonb)
  INTO v_instruments
  FROM organization_entitlements e
  WHERE e.organization_id = v_org_id
    AND e.status IN ('active', 'past_due');

  v_caps := jsonb_build_object(
    'locations', (SELECT count(*)::int FROM locations l WHERE l.organization_id = v_org_id),
    'disciplines', (SELECT count(*)::int FROM disciplines d WHERE d.organization_id = v_org_id),
    'clients_active', (
      SELECT count(*)::int
      FROM clients c
      WHERE c.organization_id = v_org_id AND c.archived_at IS NULL
    ),
    'members', (
      SELECT count(*)::int
      FROM organization_members om
      WHERE om.organization_id = v_org_id AND om.is_active
    ),
    'pending_invites', (
      SELECT count(*)::int
      FROM organization_invites oi
      WHERE oi.organization_id = v_org_id
        AND oi.accepted_at IS NULL
        AND oi.revoked_at IS NULL
        AND oi.expires_at > v_now
    )
  );

  RETURN jsonb_build_object(
    'organization_id', v_org_id,
    'active_edition', v_active,
    'effective_ceiling', v_ceiling,
    'persisted_active_edition', v_state_col,
    'live_month_phase', v_month_phase,
    'live_instruments', v_instruments,
    'caps', v_caps,
    'capabilities', jsonb_build_object(
      'group_subscriptions', edition_allows(v_org_id, 'group_subscriptions'),
      'personal_lessons', edition_allows(v_org_id, 'personal_lessons'),
      'prices', edition_allows(v_org_id, 'prices'),
      'finance', edition_allows(v_org_id, 'finance'),
      'attendance', edition_allows(v_org_id, 'attendance'),
      'hall_rent', edition_allows(v_org_id, 'hall_rent'),
      'renter_miniapp', edition_allows(v_org_id, 'renter_miniapp')
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION set_organization_active_edition(p_edition text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_uid uuid := auth.uid();
  v_from text;
  v_ceiling text;
  v_max_active int;
  v_target_rank int;
BEGIN
  IF v_org_id IS NULL OR v_uid IS NULL OR NOT can_manage_settings() THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  IF p_edition NOT IN ('lite', 'studio', 'pro') THEN
    RAISE EXCEPTION 'invalid edition' USING ERRCODE = '22023';
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  v_ceiling := organization_effective_ceiling(v_org_id);
  v_target_rank := organization_edition_rank(p_edition);

  IF v_target_rank > organization_edition_rank(v_ceiling) THEN
    PERFORM _edition_raise('edition_active_above_ceiling');
  END IF;

  v_max_active := organization_max_raising_active_rank(v_org_id);
  IF v_max_active <= 0 THEN
    v_max_active := 1;
  END IF;

  IF v_target_rank > v_max_active THEN
    PERFORM _edition_raise('edition_active_above_ceiling');
  END IF;

  SELECT s.active_edition INTO v_from
  FROM organization_edition_state s
  WHERE s.organization_id = v_org_id
  FOR UPDATE;

  IF v_from IS NULL THEN
    INSERT INTO organization_edition_state (
      organization_id, active_edition, changed_at, changed_by, change_reason
    )
    VALUES (v_org_id, p_edition, now(), v_uid, 'owner_mode');
  ELSE
    UPDATE organization_edition_state
    SET active_edition = p_edition,
        changed_at = now(),
        changed_by = v_uid,
        change_reason = 'owner_mode'
    WHERE organization_id = v_org_id;
  END IF;

  INSERT INTO organization_edition_events (
    organization_id, from_edition, to_edition, from_ceiling, to_ceiling,
    reason, actor_user_id
  )
  VALUES (
    v_org_id, v_from, p_edition, v_ceiling, v_ceiling,
    'owner_mode', v_uid
  );

  RETURN get_organization_edition(v_org_id);
END;
$$;

CREATE OR REPLACE FUNCTION cancel_organization_monthly_entitlement()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_uid uuid := auth.uid();
  v_from text;
  v_ceiling text;
  v_has_lifetime boolean;
BEGIN
  IF v_org_id IS NULL OR v_uid IS NULL OR NOT can_manage_settings() THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  PERFORM 1 FROM organizations o WHERE o.id = v_org_id FOR UPDATE;

  v_has_lifetime := EXISTS (
    SELECT 1
    FROM organization_entitlements e
    WHERE e.organization_id = v_org_id
      AND e.instrument = 'pro_lifetime'
      AND e.status IN ('active', 'past_due')
      AND organization_entitlement_row_phase(e, now()) = 'active'
  );

  UPDATE organization_entitlements e
  SET status = 'canceled',
      updated_at = now()
  WHERE e.organization_id = v_org_id
    AND e.instrument IN ('studio_monthly', 'pro_monthly')
    AND e.status IN ('active', 'past_due');

  IF NOT v_has_lifetime THEN
    DELETE FROM organization_licenses ol WHERE ol.organization_id = v_org_id;
  END IF;

  UPDATE organization_subscriptions os
  SET status = 'canceled',
      updated_at = now()
  WHERE os.organization_id = v_org_id;

  SELECT s.active_edition, organization_effective_ceiling(v_org_id)
  INTO v_from, v_ceiling
  FROM organization_edition_state s
  WHERE s.organization_id = v_org_id;

  UPDATE organization_edition_state
  SET active_edition = 'lite',
      changed_at = now(),
      changed_by = v_uid,
      change_reason = 'owner_cancel'
  WHERE organization_id = v_org_id;

  INSERT INTO organization_edition_events (
    organization_id, from_edition, to_edition, from_ceiling, to_ceiling,
    reason, actor_user_id
  )
  VALUES (
    v_org_id, v_from, 'lite', v_ceiling, organization_effective_ceiling(v_org_id),
    'owner_cancel', v_uid
  );

  RETURN get_organization_edition(v_org_id);
END;
$$;

REVOKE ALL ON FUNCTION get_organization_edition(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION set_organization_active_edition(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION cancel_organization_monthly_entitlement() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_organization_edition(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION set_organization_active_edition(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION cancel_organization_monthly_entitlement() TO authenticated, service_role;

-- =============================================================================
-- 5. Team invite RPC — member cap (F61, F77)
-- =============================================================================

CREATE OR REPLACE FUNCTION create_organization_invite(
  p_email text,
  p_role text,
  p_scope jsonb DEFAULT NULL,
  p_token_hash text DEFAULT NULL,
  p_meta jsonb DEFAULT NULL,
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_inviter_id uuid := auth_member_id();
  v_inviter_role text;
  v_invite_id uuid;
  v_scope jsonb;
  v_meta jsonb;
  v_email text;
  v_first_name text;
  v_last_name text;
BEGIN
  IF v_org_id IS NULL OR v_inviter_id IS NULL THEN
    RAISE EXCEPTION 'no active organization';
  END IF;

  IF is_restricted_admin()
    OR NOT can_manage_team()
    OR NOT organization_allows_writes(v_org_id)
  THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  v_inviter_role := member_role(auth.uid(), v_org_id);
  v_email := lower(trim(p_email));
  v_first_name := nullif(trim(p_first_name), '');
  v_last_name := nullif(trim(p_last_name), '');

  IF v_email = '' OR v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    RAISE EXCEPTION 'invalid email';
  END IF;

  IF v_first_name IS NULL OR v_last_name IS NULL THEN
    RAISE EXCEPTION 'first and last name required';
  END IF;

  IF NOT inviter_can_assign_role(v_inviter_role, p_role) THEN
    RAISE EXCEPTION 'cannot assign this role';
  END IF;

  IF p_role = 'director' AND organization_director_slot_taken(v_org_id) THEN
    RAISE EXCEPTION 'director_slot_taken';
  END IF;

  IF p_token_hash IS NULL OR length(p_token_hash) < 32 THEN
    RAISE EXCEPTION 'invalid token';
  END IF;

  IF NOT organization_within_edition_cap(v_org_id, 'members') THEN
    PERFORM _edition_raise('edition_cap_exceeded');
  END IF;

  IF EXISTS (
    SELECT 1 FROM organization_members om
    JOIN auth.users u ON u.id = om.user_id
    WHERE om.organization_id = v_org_id
      AND om.is_active = true
      AND lower(u.email) = v_email
  ) THEN
    RAISE EXCEPTION 'user already a member';
  END IF;

  IF EXISTS (
    SELECT 1 FROM organization_invites oi
    WHERE oi.organization_id = v_org_id
      AND lower(oi.email) = v_email
      AND oi.accepted_at IS NULL
      AND oi.revoked_at IS NULL
      AND oi.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'pending invite already exists';
  END IF;

  v_scope := normalize_member_scope(
    COALESCE(
      p_scope,
      CASE
        WHEN p_role = 'teacher' THEN default_teacher_scope()
        ELSE '{
          "discipline_ids": [],
          "location_ids": [],
          "schedule_group_ids": [],
          "all_disciplines": false,
          "all_locations": false,
          "all_groups": false,
          "can_view_all_clients": false
        }'::jsonb
      END
    ),
    p_role
  );

  IF v_inviter_role IN ('owner', 'director') THEN
    v_meta := normalize_member_meta(COALESCE(p_meta, '{}'::jsonb), p_role);
  ELSE
    v_meta := '{}'::jsonb;
  END IF;

  INSERT INTO organization_invites (
    organization_id, email, role, scope, meta, first_name, last_name, token_hash, invited_by, expires_at
  )
  VALUES (
    v_org_id, v_email, p_role, v_scope, v_meta, v_first_name, v_last_name, p_token_hash, v_inviter_id, now() + interval '7 days'
  )
  RETURNING id INTO v_invite_id;

  RETURN jsonb_build_object(
    'invite_id', v_invite_id,
    'email', v_email,
    'role', p_role,
    'expires_at', (now() + interval '7 days')
  );
END;
$$;

CREATE OR REPLACE FUNCTION accept_organization_invite(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_invite organization_invites%ROWTYPE;
  v_member_id uuid;
  v_scope jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT lower(email) INTO v_user_email FROM auth.users WHERE id = v_user_id;
  IF v_user_email IS NULL OR v_user_email = '' THEN
    RAISE EXCEPTION 'email required on account';
  END IF;

  SELECT * INTO v_invite
  FROM organization_invites oi
  WHERE oi.token_hash = p_token_hash
    AND oi.accepted_at IS NULL
    AND oi.revoked_at IS NULL
    AND oi.expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid or expired invite';
  END IF;

  IF lower(v_invite.email) <> v_user_email THEN
    RAISE EXCEPTION 'invite email mismatch';
  END IF;

  IF EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.organization_id = v_invite.organization_id
      AND om.user_id = v_user_id
      AND om.is_active = true
  ) THEN
    UPDATE organization_invites
    SET accepted_at = now()
    WHERE id = v_invite.id;
    RAISE EXCEPTION 'already a member';
  END IF;

  IF v_invite.role = 'director'
    AND organization_director_slot_taken(v_invite.organization_id, NULL, v_invite.id)
  THEN
    RAISE EXCEPTION 'director_slot_taken';
  END IF;

  IF NOT organization_within_edition_cap(v_invite.organization_id, 'members') THEN
    PERFORM _edition_raise('edition_cap_exceeded');
  END IF;

  v_scope := v_invite.scope;
  IF v_invite.role = 'teacher' AND NOT teacher_scope_has_access(v_scope) THEN
    v_scope := default_teacher_scope();
  END IF;

  INSERT INTO organization_members (
    organization_id, user_id, role, scope, meta,
    first_name, last_name, contact_email,
    display_name, is_active, invited_at, joined_at
  )
  VALUES (
    v_invite.organization_id,
    v_user_id,
    v_invite.role,
    v_scope,
    v_invite.meta,
    nullif(trim(v_invite.first_name), ''),
    nullif(trim(v_invite.last_name), ''),
    v_invite.email,
    NULL,
    true,
    v_invite.created_at,
    now()
  )
  ON CONFLICT (organization_id, user_id) DO UPDATE
    SET role = EXCLUDED.role,
        scope = EXCLUDED.scope,
        meta = EXCLUDED.meta,
        first_name = COALESCE(EXCLUDED.first_name, organization_members.first_name),
        last_name = COALESCE(EXCLUDED.last_name, organization_members.last_name),
        contact_email = COALESCE(EXCLUDED.contact_email, organization_members.contact_email),
        display_name = NULL,
        is_active = true,
        joined_at = now()
  RETURNING id INTO v_member_id;

  UPDATE organization_invites
  SET accepted_at = now()
  WHERE id = v_invite.id;

  RETURN jsonb_build_object(
    'organization_id', v_invite.organization_id,
    'member_id', v_member_id,
    'role', v_invite.role
  );
END;
$$;

CREATE OR REPLACE FUNCTION update_team_member(
  p_member_id uuid,
  p_role text DEFAULT NULL,
  p_scope jsonb DEFAULT NULL,
  p_is_active boolean DEFAULT NULL,
  p_display_name text DEFAULT NULL,
  p_meta jsonb DEFAULT NULL,
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL,
  p_patronymic text DEFAULT NULL,
  p_contact_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_telegram text DEFAULT NULL,
  p_profile_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_inviter_role text;
  v_target organization_members%ROWTYPE;
  v_profile_update boolean := false;
  v_effective_role text;
BEGIN
  IF v_org_id IS NULL
    OR is_restricted_admin()
    OR NOT can_manage_team()
    OR NOT organization_allows_writes(v_org_id)
  THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  v_inviter_role := member_role(auth.uid(), v_org_id);

  SELECT * INTO v_target
  FROM organization_members om
  WHERE om.id = p_member_id
    AND om.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'member not found';
  END IF;

  IF NOT inviter_can_manage_member(v_inviter_role, v_target.role) THEN
    RAISE EXCEPTION 'cannot manage this member';
  END IF;

  IF p_role IS NOT NULL AND p_role <> v_target.role THEN
    IF NOT inviter_can_assign_role(v_inviter_role, p_role) THEN
      RAISE EXCEPTION 'cannot assign this role';
    END IF;
    IF NOT inviter_can_manage_member(v_inviter_role, p_role) THEN
      RAISE EXCEPTION 'cannot assign this role';
    END IF;
    IF p_role = 'director' AND organization_director_slot_taken(v_org_id, p_member_id) THEN
      RAISE EXCEPTION 'director_slot_taken';
    END IF;
    v_target.role := p_role;
    v_target.meta := normalize_member_meta(v_target.meta, p_role);
  END IF;

  v_effective_role := v_target.role;

  IF p_is_active IS NOT NULL AND p_is_active = false THEN
    IF v_target.role = 'owner' AND count_active_owners(v_org_id) <= 1 THEN
      RAISE EXCEPTION 'cannot deactivate last owner';
    END IF;
    IF v_target.role = 'teacher'
      AND teacher_member_has_future_lessons(v_org_id, p_member_id)
    THEN
      RAISE EXCEPTION 'teacher_has_future_lessons';
    END IF;
    v_target.is_active := false;
  ELSIF p_is_active IS NOT NULL THEN
    IF p_is_active = true
      AND v_target.role = 'director'
      AND organization_director_slot_taken(v_org_id, p_member_id)
    THEN
      RAISE EXCEPTION 'director_slot_taken';
    END IF;
    IF p_is_active = true
      AND NOT v_target.is_active
      AND NOT organization_within_edition_cap(v_org_id, 'members')
    THEN
      PERFORM _edition_raise('edition_cap_exceeded');
    END IF;
    v_target.is_active := true;
  END IF;

  IF p_scope IS NOT NULL AND v_effective_role = 'teacher' THEN
    v_target.scope := normalize_member_scope(p_scope, 'teacher');
  END IF;

  IF p_meta IS NOT NULL AND v_inviter_role IN ('owner', 'director') THEN
    v_target.meta := normalize_member_meta(v_target.meta || p_meta, v_effective_role);
  END IF;

  IF p_display_name IS NOT NULL THEN
    v_target.display_name := nullif(trim(p_display_name), '');
  END IF;

  v_profile_update := (
    p_first_name IS NOT NULL
    OR p_last_name IS NOT NULL
    OR p_patronymic IS NOT NULL
    OR p_contact_email IS NOT NULL
    OR p_phone IS NOT NULL
    OR p_telegram IS NOT NULL
    OR p_profile_notes IS NOT NULL
  );

  IF v_profile_update AND v_inviter_role NOT IN ('owner', 'director') THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  IF p_first_name IS NOT NULL THEN
    v_target.first_name := nullif(trim(p_first_name), '');
  END IF;
  IF p_last_name IS NOT NULL THEN
    v_target.last_name := nullif(trim(p_last_name), '');
  END IF;
  IF p_patronymic IS NOT NULL THEN
    v_target.patronymic := nullif(trim(p_patronymic), '');
  END IF;
  IF p_contact_email IS NOT NULL THEN
    v_target.contact_email := nullif(trim(p_contact_email), '');
  END IF;
  IF p_phone IS NOT NULL THEN
    v_target.phone := nullif(trim(p_phone), '');
  END IF;
  IF p_telegram IS NOT NULL THEN
    v_target.telegram := nullif(trim(p_telegram), '');
  END IF;
  IF p_profile_notes IS NOT NULL THEN
    v_target.profile_notes := nullif(trim(p_profile_notes), '');
  END IF;

  UPDATE organization_members
  SET role = v_target.role,
      scope = v_target.scope,
      meta = v_target.meta,
      is_active = v_target.is_active,
      display_name = v_target.display_name,
      first_name = v_target.first_name,
      last_name = v_target.last_name,
      patronymic = v_target.patronymic,
      contact_email = v_target.contact_email,
      phone = v_target.phone,
      telegram = v_target.telegram,
      profile_notes = v_target.profile_notes
  WHERE id = p_member_id;
END;
$$;

COMMIT;
