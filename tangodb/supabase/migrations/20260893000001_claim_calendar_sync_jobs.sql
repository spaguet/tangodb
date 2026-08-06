-- Google Calendar sync worker: atomic job claim (GCAL Prompt 6)

BEGIN;

CREATE OR REPLACE FUNCTION claim_calendar_sync_jobs(
  p_batch_size int,
  p_worker_id text,
  p_lease_seconds int DEFAULT 300
)
RETURNS SETOF calendar_sync_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 100 THEN
    RAISE EXCEPTION 'invalid_batch_size';
  END IF;

  IF p_worker_id IS NULL OR length(trim(p_worker_id)) = 0 THEN
    RAISE EXCEPTION 'worker_id_required';
  END IF;

  IF p_lease_seconds IS NULL OR p_lease_seconds < 30 THEN
    RAISE EXCEPTION 'invalid_lease_seconds';
  END IF;

  -- Expired processing leases → retry
  UPDATE calendar_sync_outbox o
  SET
    status = 'retry',
    locked_at = NULL,
    locked_by = NULL,
    available_at = now()
  WHERE o.status = 'processing'
    AND o.locked_at IS NOT NULL
    AND o.locked_at < now() - make_interval(secs => p_lease_seconds);

  RETURN QUERY
  WITH candidates AS (
    SELECT o.id
    FROM calendar_sync_outbox o
    WHERE o.status IN ('pending', 'retry')
      AND o.available_at <= now()
      AND NOT EXISTS (
        SELECT 1
        FROM calendar_sync_outbox p
        WHERE p.organization_id = o.organization_id
          AND p.dedupe_key = o.dedupe_key
          AND p.status = 'processing'
          AND p.locked_at IS NOT NULL
          AND p.locked_at >= now() - make_interval(secs => p_lease_seconds)
      )
    ORDER BY o.available_at ASC, o.created_at ASC
    LIMIT p_batch_size
    FOR UPDATE OF o SKIP LOCKED
  )
  UPDATE calendar_sync_outbox o
  SET
    status = 'processing',
    locked_at = now(),
    locked_by = p_worker_id
  FROM candidates c
  WHERE o.id = c.id
  RETURNING o.*;
END;
$$;

REVOKE ALL ON FUNCTION claim_calendar_sync_jobs(int, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_calendar_sync_jobs(int, text, int) TO service_role;

COMMIT;
