-- S39 / L18+L21+L24+L26+L28: leftover v1 allowlist, no telegram_id JWT claim,
-- GCal last_error text only for owner/director, venue-status for cashier roles.
-- L15 prices catalog and L22 platform_payment_methods SELECT are product-necessary
-- (teacher sale / license payment UI) — not changed here.

BEGIN;

-- =============================================================================
-- L26: leftover v1 allowlist
-- =============================================================================

DROP FUNCTION IF EXISTS public.is_allowed_teacher() CASCADE;
DROP FUNCTION IF EXISTS public.auth_telegram_id() CASCADE;
DROP TABLE IF EXISTS public.allowed_users CASCADE;

-- =============================================================================
-- L26: stop copying telegram_id into JWT (Mini App login removed)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  claims jsonb;
  v_user_id uuid;
  v_org_id uuid;
  v_member_id uuid;
  v_role text;
BEGIN
  claims := event -> 'claims';
  v_user_id := (claims ->> 'sub')::uuid;

  SELECT uao.organization_id, uao.member_id, om.role
  INTO v_org_id, v_member_id, v_role
  FROM user_active_organizations uao
  JOIN organization_members om ON om.id = uao.member_id
  WHERE uao.user_id = v_user_id
    AND om.is_active = true;

  IF v_org_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{organization_id}', to_jsonb(v_org_id::text));
    claims := jsonb_set(claims, '{member_id}', to_jsonb(v_member_id::text));
    claims := jsonb_set(claims, '{member_role}', to_jsonb(v_role));
  END IF;

  RETURN jsonb_build_object('claims', claims);
END;
$$;

-- =============================================================================
-- L21/L24: last_error text only for owner/director (teacher popups / RPC)
-- =============================================================================

CREATE OR REPLACE FUNCTION get_personal_lesson_google_sync_status(p_lesson_id uuid)
RETURNS TABLE (
  sync_status text,
  last_synced_at timestamptz,
  last_error text,
  has_pending_job boolean,
  teacher_has_binding boolean,
  calendar_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_teacher_member_id uuid;
BEGIN
  IF v_org_id IS NULL OR NOT business_row_readable() THEN
    RETURN;
  END IF;

  IF NOT (
    can_read_all_business()
    OR (current_member_role() = 'teacher' AND teacher_can_access_lesson(p_lesson_id))
  ) THEN
    RETURN;
  END IF;

  SELECT pl.teacher_member_id
  INTO v_teacher_member_id
  FROM personal_lessons pl
  WHERE pl.id = p_lesson_id
    AND pl.organization_id = v_org_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH link_row AS (
    SELECT
      l.sync_status,
      l.last_synced_at,
      l.last_error,
      mb.calendar_name AS link_calendar_name
    FROM google_calendar_event_links l
    LEFT JOIN member_google_calendar_bindings mb
      ON mb.id = l.member_binding_id
     AND mb.organization_id = l.organization_id
    WHERE l.organization_id = v_org_id
      AND l.source_type = 'personal_lesson'
      AND l.source_id = p_lesson_id
    ORDER BY l.updated_at DESC
    LIMIT 1
  ),
  pending_job AS (
    SELECT EXISTS (
      SELECT 1
      FROM calendar_sync_outbox o
      WHERE o.organization_id = v_org_id
        AND o.source_type = 'personal_lesson'
        AND o.source_id = p_lesson_id
        AND o.status IN ('pending', 'retry', 'processing')
    ) AS has_pending_job
  ),
  teacher_binding AS (
    SELECT
      EXISTS (
        SELECT 1
        FROM member_google_calendar_bindings b
        JOIN organization_members om
          ON om.id = b.organization_member_id
         AND om.organization_id = b.organization_id
        WHERE b.organization_id = v_org_id
          AND b.organization_member_id = v_teacher_member_id
          AND b.enabled = true
          AND b.sync_personal = true
          AND om.is_active = true
          AND v_teacher_member_id IS NOT NULL
      ) AS teacher_has_binding,
      (
        SELECT b.calendar_name
        FROM member_google_calendar_bindings b
        JOIN organization_members om
          ON om.id = b.organization_member_id
         AND om.organization_id = b.organization_id
        WHERE b.organization_id = v_org_id
          AND b.organization_member_id = v_teacher_member_id
          AND b.enabled = true
          AND b.sync_personal = true
          AND om.is_active = true
          AND v_teacher_member_id IS NOT NULL
        LIMIT 1
      ) AS binding_calendar_name
  )
  SELECT
    lr.sync_status,
    lr.last_synced_at,
    CASE
      WHEN current_member_role() IN ('owner', 'director') THEN lr.last_error
      ELSE NULL
    END,
    COALESCE(pj.has_pending_job, false),
    COALESCE(tb.teacher_has_binding, false),
    COALESCE(lr.link_calendar_name, tb.binding_calendar_name)
  FROM teacher_binding tb
  CROSS JOIN pending_job pj
  LEFT JOIN link_row lr ON true;
END;
$$;

CREATE OR REPLACE FUNCTION get_group_occurrence_google_sync_status(
  p_slot_id uuid,
  p_occurrence_date date
)
RETURNS TABLE (
  sync_status text,
  last_synced_at timestamptz,
  last_error text,
  has_pending_job boolean,
  teacher_has_binding boolean,
  calendar_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_teacher_member_id uuid;
BEGIN
  IF v_org_id IS NULL OR NOT business_row_readable() THEN
    RETURN;
  END IF;

  SELECT ss.teacher_member_id
  INTO v_teacher_member_id
  FROM schedule_slots ss
  WHERE ss.id = p_slot_id
    AND ss.organization_id = v_org_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH link_row AS (
    SELECT
      l.sync_status,
      l.last_synced_at,
      l.last_error,
      mb.calendar_name AS link_calendar_name
    FROM google_calendar_event_links l
    LEFT JOIN member_google_calendar_bindings mb
      ON mb.id = l.member_binding_id
     AND mb.organization_id = l.organization_id
    WHERE l.organization_id = v_org_id
      AND l.source_type = 'group_occurrence'
      AND l.source_id = p_slot_id
      AND l.occurrence_date = p_occurrence_date
    ORDER BY l.updated_at DESC
    LIMIT 1
  ),
  pending_job AS (
    SELECT EXISTS (
      SELECT 1
      FROM calendar_sync_outbox o
      WHERE o.organization_id = v_org_id
        AND o.source_type = 'group_occurrence'
        AND o.source_id = p_slot_id
        AND o.occurrence_date = p_occurrence_date
        AND o.status IN ('pending', 'retry', 'processing')
    ) AS has_pending_job
  ),
  teacher_binding AS (
    SELECT
      EXISTS (
        SELECT 1
        FROM member_google_calendar_bindings b
        JOIN organization_members om
          ON om.id = b.organization_member_id
         AND om.organization_id = b.organization_id
        WHERE b.organization_id = v_org_id
          AND b.organization_member_id = v_teacher_member_id
          AND b.enabled = true
          AND b.sync_group = true
          AND om.is_active = true
          AND v_teacher_member_id IS NOT NULL
      ) AS teacher_has_binding,
      (
        SELECT b.calendar_name
        FROM member_google_calendar_bindings b
        JOIN organization_members om
          ON om.id = b.organization_member_id
         AND om.organization_id = b.organization_id
        WHERE b.organization_id = v_org_id
          AND b.organization_member_id = v_teacher_member_id
          AND b.enabled = true
          AND b.sync_group = true
          AND om.is_active = true
          AND v_teacher_member_id IS NOT NULL
        LIMIT 1
      ) AS binding_calendar_name
  )
  SELECT
    lr.sync_status,
    lr.last_synced_at,
    CASE
      WHEN current_member_role() IN ('owner', 'director') THEN lr.last_error
      ELSE NULL
    END,
    COALESCE(pj.has_pending_job, false),
    COALESCE(tb.teacher_has_binding, false),
    COALESCE(lr.link_calendar_name, tb.binding_calendar_name)
  FROM teacher_binding tb
  CROSS JOIN pending_job pj
  LEFT JOIN link_row lr ON true;
END;
$$;

REVOKE ALL ON FUNCTION get_personal_lesson_google_sync_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_personal_lesson_google_sync_status(uuid) TO authenticated;

REVOKE ALL ON FUNCTION get_group_occurrence_google_sync_status(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_group_occurrence_google_sync_status(uuid, date) TO authenticated;

-- =============================================================================
-- L28: cashier + financial may call status; not can_read_financial-only
-- list_venue_cost_rule_versions stays financial
-- =============================================================================

CREATE OR REPLACE FUNCTION get_venue_cost_rule_status(p_at date DEFAULT current_date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'unauthorized');
  END IF;

  IF NOT (
    can_read_financial()
    OR current_member_role() = 'admin'
    OR (
      current_member_role() = 'teacher'
      AND (
        teacher_can_write_subscriptions()
        OR teacher_can_write_personal_lessons()
        OR EXISTS (
          SELECT 1
          FROM organization_settings os
          WHERE os.organization_id = v_org_id
            AND os.teachers_can_record_single_visits = true
        )
      )
    )
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  RETURN venue_cost_status_for_org(v_org_id, p_at) || jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION get_venue_cost_rule_status(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_venue_cost_rule_status(date) TO authenticated;

COMMIT;
