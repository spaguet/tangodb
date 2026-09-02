-- Google Calendar: hall rentals on a separate org binding (GCAL-5).
-- purpose=events remains the master-class calendar; purpose=rentals is independent
-- (another Google account or another calendar on the same account).

BEGIN;

-- =============================================================================
-- 1. organization_google_calendar_bindings.purpose
-- =============================================================================

ALTER TABLE organization_google_calendar_bindings
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'events';

ALTER TABLE organization_google_calendar_bindings
  DROP CONSTRAINT IF EXISTS organization_google_calendar_bindings_purpose_check;

ALTER TABLE organization_google_calendar_bindings
  ADD CONSTRAINT organization_google_calendar_bindings_purpose_check
  CHECK (purpose IN ('events', 'rentals'));

DROP INDEX IF EXISTS idx_org_gcal_bindings_one_active_per_org;

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_gcal_bindings_one_active_per_org_purpose
  ON organization_google_calendar_bindings (organization_id, purpose)
  WHERE enabled;

COMMENT ON COLUMN organization_google_calendar_bindings.purpose IS
  'events = master-class / open-lesson calendar; rentals = hall rental calendar';

-- =============================================================================
-- 2. Allow source_type = rental on event links
-- =============================================================================

ALTER TABLE google_calendar_event_links
  DROP CONSTRAINT IF EXISTS google_calendar_event_links_source_type_check;

ALTER TABLE google_calendar_event_links
  ADD CONSTRAINT google_calendar_event_links_source_type_check
  CHECK (source_type IN (
    'group_occurrence',
    'personal_lesson',
    'event_session',
    'rental'
  ));

-- =============================================================================
-- 3. Event-session reconcile: only the events binding
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
    AND b.purpose = 'events'
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

-- =============================================================================
-- 4. Enqueue triggers on rentals
-- =============================================================================

CREATE OR REPLACE FUNCTION rentals_calendar_sync_enqueue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.booking_status = 'confirmed' THEN
      PERFORM enqueue_calendar_sync(
        NEW.organization_id,
        'rental',
        NEW.id,
        NEW.rental_date,
        'upsert'
      );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.rental_date IS DISTINCT FROM NEW.rental_date THEN
      PERFORM enqueue_calendar_sync(
        OLD.organization_id,
        'rental',
        OLD.id,
        OLD.rental_date,
        'delete'
      );
    END IF;

    IF NEW.booking_status = 'confirmed' THEN
      PERFORM enqueue_calendar_sync(
        NEW.organization_id,
        'rental',
        NEW.id,
        NEW.rental_date,
        'upsert'
      );
    ELSE
      PERFORM enqueue_calendar_sync(
        NEW.organization_id,
        'rental',
        NEW.id,
        NEW.rental_date,
        'delete'
      );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM enqueue_calendar_sync(
      OLD.organization_id,
      'rental',
      OLD.id,
      OLD.rental_date,
      'delete'
    );
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS rentals_calendar_sync_after_iu_trg ON rentals;
CREATE TRIGGER rentals_calendar_sync_after_iu_trg
  AFTER INSERT OR UPDATE ON rentals
  FOR EACH ROW
  EXECUTE FUNCTION rentals_calendar_sync_enqueue();

DROP TRIGGER IF EXISTS rentals_calendar_sync_before_delete_trg ON rentals;
CREATE TRIGGER rentals_calendar_sync_before_delete_trg
  BEFORE DELETE ON rentals
  FOR EACH ROW
  EXECUTE FUNCTION rentals_calendar_sync_enqueue();

CREATE OR REPLACE FUNCTION renters_calendar_sync_enqueue()
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

  IF OLD.display_name IS NOT DISTINCT FROM NEW.display_name THEN
    RETURN NEW;
  END IF;

  FOR r IN
    SELECT id, rental_date
    FROM rentals
    WHERE organization_id = NEW.organization_id
      AND renter_id = NEW.id
      AND booking_status = 'confirmed'
      AND rental_date >= CURRENT_DATE
  LOOP
    PERFORM enqueue_calendar_sync(
      NEW.organization_id,
      'rental',
      r.id,
      r.rental_date,
      'upsert'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS renters_calendar_sync_after_update_trg ON renters;
CREATE TRIGGER renters_calendar_sync_after_update_trg
  AFTER UPDATE ON renters
  FOR EACH ROW
  EXECUTE FUNCTION renters_calendar_sync_enqueue();

-- =============================================================================
-- 5. Reconcile org rentals
-- =============================================================================

CREATE OR REPLACE FUNCTION execute_organization_rentals_reconcile(
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
    AND b.purpose = 'rentals'
  LIMIT 1;

  IF v_binding_id IS NULL THEN
    RETURN jsonb_build_object(
      'skipped', true,
      'reason', 'no_active_rental_org_binding',
      'upserts_enqueued', 0,
      'deletes_enqueued', 0
    );
  END IF;

  FOR r IN
    SELECT rt.id, rt.rental_date
    FROM rentals rt
    WHERE rt.organization_id = p_organization_id
      AND rt.booking_status = 'confirmed'
      AND rt.rental_date >= CURRENT_DATE
      AND NOT EXISTS (
        SELECT 1
        FROM google_calendar_event_links l
        WHERE l.organization_binding_id = v_binding_id
          AND l.source_type = 'rental'
          AND l.source_id = rt.id
          AND l.occurrence_date = rt.rental_date
          AND l.sync_status IN ('synced', 'pending')
      )
  LOOP
    PERFORM enqueue_calendar_sync(
      p_organization_id,
      'rental',
      r.id,
      r.rental_date,
      'upsert'
    );
    v_upserts := v_upserts + 1;
  END LOOP;

  FOR r IN
    SELECT l.source_id, l.occurrence_date
    FROM google_calendar_event_links l
    LEFT JOIN rentals rt
      ON rt.organization_id = l.organization_id
     AND rt.id = l.source_id
    WHERE l.organization_id = p_organization_id
      AND l.organization_binding_id = v_binding_id
      AND l.source_type = 'rental'
      AND l.sync_status <> 'detached'
      AND (
        rt.id IS NULL
        OR rt.booking_status IS DISTINCT FROM 'confirmed'
        OR rt.rental_date IS DISTINCT FROM l.occurrence_date
      )
  LOOP
    PERFORM enqueue_calendar_sync(
      p_organization_id,
      'rental',
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

REVOKE ALL ON FUNCTION execute_organization_rentals_reconcile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_organization_rentals_reconcile(uuid) TO service_role;

CREATE OR REPLACE FUNCTION request_organization_rentals_calendar_reconcile()
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

  RETURN execute_organization_rentals_reconcile(v_org_id);
END;
$$;

REVOKE ALL ON FUNCTION request_organization_rentals_calendar_reconcile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_organization_rentals_calendar_reconcile() TO authenticated;

COMMIT;
