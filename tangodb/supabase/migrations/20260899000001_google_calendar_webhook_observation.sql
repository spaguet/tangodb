-- Google Calendar webhook observation + incremental sync (GCAL Prompt 12)

BEGIN;

-- =============================================================================
-- 1. Backend-only watch channel state
-- =============================================================================

CREATE TABLE google_calendar_watch_channels (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  binding_kind              TEXT NOT NULL
    CHECK (binding_kind IN ('member', 'organization')),
  member_binding_id         UUID,
  organization_binding_id   UUID,
  organization_id           UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  calendar_id               TEXT NOT NULL,
  google_account_id         UUID NOT NULL REFERENCES user_google_accounts (id) ON DELETE CASCADE,
  channel_id                TEXT NOT NULL UNIQUE,
  resource_id               TEXT NOT NULL,
  channel_token             TEXT NOT NULL,
  expiration                TIMESTAMPTZ NOT NULL,
  calendar_sync_token       TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (binding_kind = 'member' AND member_binding_id IS NOT NULL AND organization_binding_id IS NULL)
    OR (binding_kind = 'organization' AND organization_binding_id IS NOT NULL AND member_binding_id IS NULL)
  )
);

CREATE UNIQUE INDEX idx_gcal_watch_member_binding
  ON google_calendar_watch_channels (member_binding_id)
  WHERE member_binding_id IS NOT NULL;

CREATE UNIQUE INDEX idx_gcal_watch_org_binding
  ON google_calendar_watch_channels (organization_binding_id)
  WHERE organization_binding_id IS NOT NULL;

CREATE INDEX idx_gcal_watch_expiration
  ON google_calendar_watch_channels (expiration);

CREATE INDEX idx_gcal_watch_channel_lookup
  ON google_calendar_watch_channels (channel_id, resource_id);

ALTER TABLE google_calendar_watch_channels ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE google_calendar_watch_channels FROM PUBLIC;
REVOKE ALL ON TABLE google_calendar_watch_channels FROM anon;
REVOKE ALL ON TABLE google_calendar_watch_channels FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON google_calendar_watch_channels TO service_role;

-- =============================================================================
-- 2. Outbox: incremental_sync operation
-- =============================================================================

ALTER TABLE calendar_sync_outbox
  DROP CONSTRAINT IF EXISTS calendar_sync_outbox_operation_check;

ALTER TABLE calendar_sync_outbox
  ADD CONSTRAINT calendar_sync_outbox_operation_check
  CHECK (operation IN ('upsert', 'delete', 'reconcile_member', 'incremental_sync'));

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
  ELSIF p_operation = 'incremental_sync' THEN
    IF p_source_type = 'member_binding' THEN
      v_dedupe_key := 'incremental_sync:member:' || p_source_id::text;
    ELSIF p_source_type = 'organization_binding' THEN
      v_dedupe_key := 'incremental_sync:org:' || p_source_id::text;
    ELSE
      RAISE EXCEPTION 'invalid_incremental_sync_source_type';
    END IF;
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

-- Webhook handler enqueues incremental sync by binding id
CREATE OR REPLACE FUNCTION enqueue_binding_incremental_sync(
  p_binding_kind text,
  p_binding_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_source_type text;
BEGIN
  IF p_binding_kind = 'member' THEN
    SELECT b.organization_id
    INTO v_org_id
    FROM member_google_calendar_bindings b
    WHERE b.id = p_binding_id
      AND b.enabled = true;

    v_source_type := 'member_binding';
  ELSIF p_binding_kind = 'organization' THEN
    SELECT b.organization_id
    INTO v_org_id
    FROM organization_google_calendar_bindings b
    WHERE b.id = p_binding_id
      AND b.enabled = true;

    v_source_type := 'organization_binding';
  ELSE
    RAISE EXCEPTION 'invalid_binding_kind';
  END IF;

  IF v_org_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM enqueue_calendar_sync(
    v_org_id,
    v_source_type,
    p_binding_id,
    NULL,
    'incremental_sync'
  );
END;
$$;

REVOKE ALL ON FUNCTION enqueue_binding_incremental_sync(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enqueue_binding_incremental_sync(text, uuid) TO service_role;

COMMIT;
