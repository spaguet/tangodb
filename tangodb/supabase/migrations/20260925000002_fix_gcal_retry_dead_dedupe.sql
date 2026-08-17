-- Fix bulk retry dead jobs: dedupe dead rows + skip keys already in queue

BEGIN;

CREATE OR REPLACE FUNCTION retry_organization_calendar_sync_dead_jobs(
  p_error_codes text[] DEFAULT ARRAY['token_revoked', 'token_missing', 'token_decrypt_failed']
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid;
  v_deleted int := 0;
  v_requeued int := 0;
  v_extra_deleted int := 0;
BEGIN
  v_org_id := auth_organization_id();
  IF v_org_id IS NULL OR NOT business_row_readable() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF current_member_role() NOT IN ('owner', 'director') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH doomed AS (
    SELECT dead.id
    FROM calendar_sync_outbox dead
    WHERE dead.organization_id = v_org_id
      AND dead.status = 'dead'
      AND (
        p_error_codes IS NULL
        OR dead.last_error_code = ANY (p_error_codes)
      )
      AND EXISTS (
        SELECT 1
        FROM calendar_sync_outbox live
        WHERE live.organization_id = dead.organization_id
          AND live.dedupe_key = dead.dedupe_key
          AND live.status IN ('pending', 'retry', 'processing')
      )
  )
  DELETE FROM calendar_sync_outbox o
  USING doomed d
  WHERE o.id = d.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  WITH duplicate_dead AS (
    SELECT dead.id
    FROM calendar_sync_outbox dead
    WHERE dead.organization_id = v_org_id
      AND dead.status = 'dead'
      AND (
        p_error_codes IS NULL
        OR dead.last_error_code = ANY (p_error_codes)
      )
      AND dead.id <> (
        SELECT d2.id
        FROM calendar_sync_outbox d2
        WHERE d2.organization_id = dead.organization_id
          AND d2.dedupe_key = dead.dedupe_key
          AND d2.status = 'dead'
        ORDER BY d2.created_at DESC
        LIMIT 1
      )
  )
  DELETE FROM calendar_sync_outbox o
  USING duplicate_dead d
  WHERE o.id = d.id;

  GET DIAGNOSTICS v_extra_deleted = ROW_COUNT;
  v_deleted := v_deleted + v_extra_deleted;

  UPDATE calendar_sync_outbox o
  SET
    status = 'pending',
    attempt_count = 0,
    available_at = now(),
    locked_at = NULL,
    locked_by = NULL,
    last_error_code = NULL,
    last_error_message = NULL,
    processed_at = NULL
  WHERE o.organization_id = v_org_id
    AND o.status = 'dead'
    AND (
      p_error_codes IS NULL
      OR o.last_error_code = ANY (p_error_codes)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM calendar_sync_outbox live
      WHERE live.organization_id = o.organization_id
        AND live.dedupe_key = o.dedupe_key
        AND live.status IN ('pending', 'retry', 'processing')
    );

  GET DIAGNOSTICS v_requeued = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted_duplicates', v_deleted,
    'requeued', v_requeued
  );
END;
$$;

CREATE OR REPLACE FUNCTION service_retry_calendar_sync_dead_jobs_for_orgs(
  p_organization_ids uuid[],
  p_error_codes text[] DEFAULT ARRAY['token_revoked', 'token_missing', 'token_decrypt_failed']
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted int := 0;
  v_requeued int := 0;
  v_extra_deleted int := 0;
BEGIN
  IF p_organization_ids IS NULL OR cardinality(p_organization_ids) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'deleted_duplicates', 0, 'requeued', 0);
  END IF;

  WITH doomed AS (
    SELECT dead.id
    FROM calendar_sync_outbox dead
    WHERE dead.organization_id = ANY (p_organization_ids)
      AND dead.status = 'dead'
      AND (
        p_error_codes IS NULL
        OR dead.last_error_code = ANY (p_error_codes)
      )
      AND EXISTS (
        SELECT 1
        FROM calendar_sync_outbox live
        WHERE live.organization_id = dead.organization_id
          AND live.dedupe_key = dead.dedupe_key
          AND live.status IN ('pending', 'retry', 'processing')
      )
  )
  DELETE FROM calendar_sync_outbox o
  USING doomed d
  WHERE o.id = d.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  WITH duplicate_dead AS (
    SELECT dead.id
    FROM calendar_sync_outbox dead
    WHERE dead.organization_id = ANY (p_organization_ids)
      AND dead.status = 'dead'
      AND (
        p_error_codes IS NULL
        OR dead.last_error_code = ANY (p_error_codes)
      )
      AND dead.id <> (
        SELECT d2.id
        FROM calendar_sync_outbox d2
        WHERE d2.organization_id = dead.organization_id
          AND d2.dedupe_key = dead.dedupe_key
          AND d2.status = 'dead'
        ORDER BY d2.created_at DESC
        LIMIT 1
      )
  )
  DELETE FROM calendar_sync_outbox o
  USING duplicate_dead d
  WHERE o.id = d.id;

  GET DIAGNOSTICS v_extra_deleted = ROW_COUNT;
  v_deleted := v_deleted + v_extra_deleted;

  UPDATE calendar_sync_outbox o
  SET
    status = 'pending',
    attempt_count = 0,
    available_at = now(),
    locked_at = NULL,
    locked_by = NULL,
    last_error_code = NULL,
    last_error_message = NULL,
    processed_at = NULL
  WHERE o.organization_id = ANY (p_organization_ids)
    AND o.status = 'dead'
    AND (
      p_error_codes IS NULL
      OR o.last_error_code = ANY (p_error_codes)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM calendar_sync_outbox live
      WHERE live.organization_id = o.organization_id
        AND live.dedupe_key = o.dedupe_key
        AND live.status IN ('pending', 'retry', 'processing')
    );

  GET DIAGNOSTICS v_requeued = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted_duplicates', v_deleted,
    'requeued', v_requeued
  );
END;
$$;

COMMIT;
