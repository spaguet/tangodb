-- Google Calendar: calendar_event_sessions sync (GCAL Prompt 11)

BEGIN;

-- =============================================================================
-- 1. Enqueue triggers on calendar_event_sessions
-- =============================================================================

CREATE OR REPLACE FUNCTION calendar_event_sessions_calendar_sync_enqueue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM enqueue_calendar_sync(
      NEW.organization_id,
      'event_session',
      NEW.id,
      NEW.session_date,
      'upsert'
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.session_date IS DISTINCT FROM NEW.session_date THEN
      PERFORM enqueue_calendar_sync(
        OLD.organization_id,
        'event_session',
        OLD.id,
        OLD.session_date,
        'delete'
      );
      PERFORM enqueue_calendar_sync(
        NEW.organization_id,
        'event_session',
        NEW.id,
        NEW.session_date,
        'upsert'
      );
    ELSE
      PERFORM enqueue_calendar_sync(
        NEW.organization_id,
        'event_session',
        NEW.id,
        NEW.session_date,
        'upsert'
      );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM enqueue_calendar_sync(
      OLD.organization_id,
      'event_session',
      OLD.id,
      OLD.session_date,
      'delete'
    );
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER calendar_event_sessions_calendar_sync_after_iu_trg
  AFTER INSERT OR UPDATE ON calendar_event_sessions
  FOR EACH ROW
  EXECUTE FUNCTION calendar_event_sessions_calendar_sync_enqueue();

CREATE TRIGGER calendar_event_sessions_calendar_sync_before_delete_trg
  BEFORE DELETE ON calendar_event_sessions
  FOR EACH ROW
  EXECUTE FUNCTION calendar_event_sessions_calendar_sync_enqueue();

-- =============================================================================
-- 2. Enqueue on calendar_events metadata changes (re-upsert all sessions)
-- =============================================================================

CREATE OR REPLACE FUNCTION calendar_events_calendar_sync_enqueue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF OLD.title IS NOT DISTINCT FROM NEW.title
    AND OLD.guest_teacher IS NOT DISTINCT FROM NEW.guest_teacher
    AND OLD.organizer IS NOT DISTINCT FROM NEW.organizer
    AND OLD.created_by IS NOT DISTINCT FROM NEW.created_by
  THEN
    RETURN NEW;
  END IF;

  FOR r IN
    SELECT ces.id, ces.session_date
    FROM calendar_event_sessions ces
    WHERE ces.organization_id = NEW.organization_id
      AND ces.event_id = NEW.id
  LOOP
    PERFORM enqueue_calendar_sync(
      NEW.organization_id,
      'event_session',
      r.id,
      r.session_date,
      'upsert'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER calendar_events_calendar_sync_after_update_trg
  AFTER UPDATE ON calendar_events
  FOR EACH ROW
  EXECUTE FUNCTION calendar_events_calendar_sync_enqueue();

-- =============================================================================
-- 3. Reconcile org event sessions (missing links / stale links)
-- =============================================================================

CREATE OR REPLACE FUNCTION execute_organization_event_sessions_reconcile(
  p_organization_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_binding_id uuid;
  v_upserts int := 0;
  v_deletes int := 0;
  r RECORD;
BEGIN
  SELECT b.id
  INTO v_binding_id
  FROM organization_google_calendar_bindings b
  WHERE b.organization_id = p_organization_id
    AND b.enabled = true
  LIMIT 1;

  IF v_binding_id IS NULL THEN
    RETURN jsonb_build_object(
      'skipped', true,
      'reason', 'no_active_org_binding',
      'upserts_enqueued', 0,
      'deletes_enqueued', 0
    );
  END IF;

  FOR r IN
    SELECT ces.id, ces.session_date
    FROM calendar_event_sessions ces
    WHERE ces.organization_id = p_organization_id
      AND ces.session_date >= CURRENT_DATE
      AND NOT EXISTS (
        SELECT 1
        FROM google_calendar_event_links l
        WHERE l.organization_binding_id = v_binding_id
          AND l.source_type = 'event_session'
          AND l.source_id = ces.id
          AND l.occurrence_date = ces.session_date
          AND l.sync_status IN ('synced', 'pending')
      )
  LOOP
    PERFORM enqueue_calendar_sync(
      p_organization_id,
      'event_session',
      r.id,
      r.session_date,
      'upsert'
    );
    v_upserts := v_upserts + 1;
  END LOOP;

  FOR r IN
    SELECT l.source_id, l.occurrence_date
    FROM google_calendar_event_links l
    LEFT JOIN calendar_event_sessions ces
      ON ces.organization_id = l.organization_id
     AND ces.id = l.source_id
    WHERE l.organization_id = p_organization_id
      AND l.organization_binding_id = v_binding_id
      AND l.source_type = 'event_session'
      AND l.sync_status <> 'detached'
      AND (
        ces.id IS NULL
        OR ces.session_date IS DISTINCT FROM l.occurrence_date
      )
  LOOP
    PERFORM enqueue_calendar_sync(
      p_organization_id,
      'event_session',
      r.source_id,
      r.occurrence_date,
      'delete'
    );
    v_deletes := v_deletes + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'skipped', false,
    'binding_id', v_binding_id,
    'upserts_enqueued', v_upserts,
    'deletes_enqueued', v_deletes
  );
END;
$$;

REVOKE ALL ON FUNCTION execute_organization_event_sessions_reconcile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_organization_event_sessions_reconcile(uuid) TO service_role;

CREATE OR REPLACE FUNCTION request_organization_calendar_reconcile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  v_org_id := auth_organization_id();
  IF v_org_id IS NULL OR NOT business_row_readable() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF current_member_role() NOT IN ('owner', 'director') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN execute_organization_event_sessions_reconcile(v_org_id);
END;
$$;

REVOKE ALL ON FUNCTION request_organization_calendar_reconcile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_organization_calendar_reconcile() TO authenticated;

COMMIT;
