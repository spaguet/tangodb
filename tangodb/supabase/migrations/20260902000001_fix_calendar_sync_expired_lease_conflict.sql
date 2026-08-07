-- Prevent an expired processing lease from blocking the whole calendar queue
-- when a newer pending/retry row already exists for the same dedupe key.

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

  -- enqueue_calendar_sync may create a newer pending row while the previous
  -- row is processing. If that processing lease expires, keep the newer row
  -- and remove the stale one before changing any status to retry; otherwise
  -- the partial unique index rejects the UPDATE and no jobs can be claimed.
  DELETE FROM calendar_sync_outbox expired
  WHERE expired.status = 'processing'
    AND expired.locked_at IS NOT NULL
    AND expired.locked_at < now() - make_interval(secs => p_lease_seconds)
    AND EXISTS (
      SELECT 1
      FROM calendar_sync_outbox queued
      WHERE queued.organization_id = expired.organization_id
        AND queued.dedupe_key = expired.dedupe_key
        AND queued.status IN ('pending', 'retry')
    );

  -- Expired processing leases without a replacement row can be retried.
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
