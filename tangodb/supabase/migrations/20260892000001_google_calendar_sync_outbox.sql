-- Google Calendar sync outbox, event links, and personal_lessons enqueue (GCAL Prompt 5)

BEGIN;

-- =============================================================================
-- 1. google_calendar_event_links
-- =============================================================================

CREATE TABLE google_calendar_event_links (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  recipient_kind          TEXT NOT NULL
    CHECK (recipient_kind IN ('member', 'organization')),
  member_binding_id       UUID,
  organization_binding_id UUID,
  source_type             TEXT NOT NULL
    CHECK (source_type IN ('group_occurrence', 'personal_lesson', 'event_session')),
  source_id               UUID NOT NULL,
  occurrence_date         DATE NOT NULL,
  google_event_id         TEXT,
  google_etag             TEXT,
  desired_hash            TEXT,
  sync_status             TEXT NOT NULL DEFAULT 'pending'
    CHECK (sync_status IN ('pending', 'synced', 'failed', 'detached')),
  detach_reason           TEXT,
  last_synced_at          TIMESTAMPTZ,
  last_error              TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, member_binding_id)
    REFERENCES member_google_calendar_bindings (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, organization_binding_id)
    REFERENCES organization_google_calendar_bindings (organization_id, id) ON DELETE CASCADE,
  CHECK (
    (recipient_kind = 'member' AND member_binding_id IS NOT NULL AND organization_binding_id IS NULL)
    OR (recipient_kind = 'organization' AND organization_binding_id IS NOT NULL AND member_binding_id IS NULL)
  )
);

CREATE UNIQUE INDEX idx_gcal_event_links_member_source
  ON google_calendar_event_links (member_binding_id, source_type, source_id, occurrence_date)
  WHERE member_binding_id IS NOT NULL;

CREATE UNIQUE INDEX idx_gcal_event_links_org_source
  ON google_calendar_event_links (organization_binding_id, source_type, source_id, occurrence_date)
  WHERE organization_binding_id IS NOT NULL;

CREATE INDEX idx_gcal_event_links_org_source_lookup
  ON google_calendar_event_links (organization_id, source_type, source_id);

CREATE INDEX idx_gcal_event_links_member_binding
  ON google_calendar_event_links (member_binding_id)
  WHERE member_binding_id IS NOT NULL;

-- =============================================================================
-- 2. calendar_sync_outbox
-- =============================================================================

CREATE TABLE calendar_sync_outbox (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  source_type         TEXT NOT NULL,
  source_id           UUID NOT NULL,
  occurrence_date     DATE,
  dedupe_key          TEXT NOT NULL,
  operation           TEXT NOT NULL
    CHECK (operation IN ('upsert', 'delete', 'reconcile_member')),
  status              TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'retry', 'done', 'dead')),
  attempt_count       INT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at           TIMESTAMPTZ,
  locked_by           TEXT,
  last_error_code     TEXT,
  last_error_message  TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at        TIMESTAMPTZ
);

CREATE INDEX idx_calendar_sync_outbox_worker_pick
  ON calendar_sync_outbox (status, available_at);

CREATE INDEX idx_calendar_sync_outbox_org_status
  ON calendar_sync_outbox (organization_id, status);

CREATE UNIQUE INDEX idx_calendar_sync_outbox_pending_dedupe
  ON calendar_sync_outbox (organization_id, dedupe_key)
  WHERE status IN ('pending', 'retry');

-- =============================================================================
-- 3. enqueue helper
-- =============================================================================

CREATE OR REPLACE FUNCTION build_calendar_sync_dedupe_key(
  p_source_type text,
  p_source_id uuid,
  p_occurrence_date date
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_source_type || ':' || p_source_id::text || ':' || p_occurrence_date::text;
$$;

CREATE OR REPLACE FUNCTION enqueue_calendar_sync(
  p_organization_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_occurrence_date date,
  p_operation text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dedupe_key text;
BEGIN
  IF p_operation = 'reconcile_member' THEN
    v_dedupe_key := 'reconcile_member:' || p_source_id::text;
  ELSE
    IF p_occurrence_date IS NULL THEN
      RAISE EXCEPTION 'calendar_sync_occurrence_date_required';
    END IF;
    v_dedupe_key := build_calendar_sync_dedupe_key(
      p_source_type,
      p_source_id,
      p_occurrence_date
    );
  END IF;

  INSERT INTO calendar_sync_outbox (
    organization_id,
    source_type,
    source_id,
    occurrence_date,
    dedupe_key,
    operation,
    status,
    available_at
  ) VALUES (
    p_organization_id,
    p_source_type,
    p_source_id,
    p_occurrence_date,
    v_dedupe_key,
    p_operation,
    'pending',
    now()
  )
  ON CONFLICT (organization_id, dedupe_key)
    WHERE status IN ('pending', 'retry')
  DO UPDATE SET
    source_type = EXCLUDED.source_type,
    source_id = EXCLUDED.source_id,
    occurrence_date = EXCLUDED.occurrence_date,
    operation = EXCLUDED.operation,
    status = 'pending',
    attempt_count = 0,
    available_at = now(),
    locked_at = NULL,
    locked_by = NULL,
    last_error_code = NULL,
    last_error_message = NULL,
    processed_at = NULL;
END;
$$;

REVOKE ALL ON FUNCTION enqueue_calendar_sync(uuid, text, uuid, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enqueue_calendar_sync(uuid, text, uuid, date, text) TO service_role;

-- =============================================================================
-- 4. personal_lessons enqueue triggers
-- =============================================================================

CREATE OR REPLACE FUNCTION personal_lessons_calendar_sync_enqueue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM enqueue_calendar_sync(
      NEW.organization_id,
      'personal_lesson',
      NEW.id,
      NEW.date,
      'upsert'
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.date IS DISTINCT FROM NEW.date THEN
      PERFORM enqueue_calendar_sync(
        OLD.organization_id,
        'personal_lesson',
        OLD.id,
        OLD.date,
        'delete'
      );
      PERFORM enqueue_calendar_sync(
        NEW.organization_id,
        'personal_lesson',
        NEW.id,
        NEW.date,
        'upsert'
      );
    ELSE
      PERFORM enqueue_calendar_sync(
        NEW.organization_id,
        'personal_lesson',
        NEW.id,
        NEW.date,
        'upsert'
      );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM enqueue_calendar_sync(
      OLD.organization_id,
      'personal_lesson',
      OLD.id,
      OLD.date,
      'delete'
    );
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER personal_lessons_calendar_sync_after_iu_trg
  AFTER INSERT OR UPDATE ON personal_lessons
  FOR EACH ROW
  EXECUTE FUNCTION personal_lessons_calendar_sync_enqueue();

CREATE TRIGGER personal_lessons_calendar_sync_before_delete_trg
  BEFORE DELETE ON personal_lessons
  FOR EACH ROW
  EXECUTE FUNCTION personal_lessons_calendar_sync_enqueue();

-- delete_personal_lesson / delete_personal_lesson_series_from_date use DELETE on personal_lessons;
-- BEFORE DELETE trigger enqueues delete before the row disappears.

-- =============================================================================
-- 5. RLS — safe status for members / management; writes via service_role + worker
-- =============================================================================

ALTER TABLE google_calendar_event_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_sync_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE google_calendar_event_links FROM PUBLIC;
REVOKE ALL ON TABLE calendar_sync_outbox FROM PUBLIC;

GRANT SELECT (
  id,
  organization_id,
  recipient_kind,
  member_binding_id,
  organization_binding_id,
  source_type,
  source_id,
  occurrence_date,
  sync_status,
  detach_reason,
  last_synced_at,
  last_error,
  created_at,
  updated_at
) ON google_calendar_event_links TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON google_calendar_event_links TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON calendar_sync_outbox TO service_role;

CREATE POLICY gcal_event_links_select_member
  ON google_calendar_event_links FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND recipient_kind = 'member'
    AND member_binding_id = auth_member_id()
  );

CREATE POLICY gcal_event_links_select_management
  ON google_calendar_event_links FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() IN ('owner', 'director')
  );

CREATE POLICY calendar_sync_outbox_select_management
  ON calendar_sync_outbox FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() IN ('owner', 'director')
  );

CREATE OR REPLACE FUNCTION get_personal_lesson_google_sync_status(p_lesson_id uuid)
RETURNS TABLE (
  sync_status text,
  last_synced_at timestamptz,
  last_error text,
  has_pending_job boolean
)
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  WITH link_row AS (
    SELECT
      l.sync_status,
      l.last_synced_at,
      l.last_error
    FROM google_calendar_event_links l
    WHERE l.organization_id = auth_organization_id()
      AND l.source_type = 'personal_lesson'
      AND l.source_id = p_lesson_id
    ORDER BY l.updated_at DESC
    LIMIT 1
  ),
  pending_job AS (
    SELECT EXISTS (
      SELECT 1
      FROM calendar_sync_outbox o
      WHERE o.organization_id = auth_organization_id()
        AND o.source_type = 'personal_lesson'
        AND o.source_id = p_lesson_id
        AND o.status IN ('pending', 'retry', 'processing')
    ) AS has_pending_job
  )
  SELECT
    lr.sync_status,
    lr.last_synced_at,
    lr.last_error,
    pj.has_pending_job
  FROM pending_job pj
  LEFT JOIN link_row lr ON true;
$$;

REVOKE ALL ON FUNCTION get_personal_lesson_google_sync_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_personal_lesson_google_sync_status(uuid) TO authenticated;

COMMIT;
