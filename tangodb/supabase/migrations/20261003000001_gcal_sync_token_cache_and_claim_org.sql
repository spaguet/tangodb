-- Google Calendar: cache access tokens, remember refresh-token issue time,
-- and allow org-scoped claim for user-triggered drain (calendar-sync-kick).

BEGIN;

ALTER TABLE user_google_accounts
  ADD COLUMN IF NOT EXISTS encrypted_access_token BYTEA,
  ADD COLUMN IF NOT EXISTS access_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refresh_token_issued_at TIMESTAMPTZ;

COMMENT ON COLUMN user_google_accounts.encrypted_access_token IS
  'AES-GCM access token cache (same encryption as refresh token). Backend-only.';
COMMENT ON COLUMN user_google_accounts.access_token_expires_at IS
  'When the cached access token should be treated as expired (skew already applied).';
COMMENT ON COLUMN user_google_accounts.refresh_token_issued_at IS
  'When the stored Google refresh token was last received from OAuth.';

DROP FUNCTION IF EXISTS list_my_google_accounts();

CREATE OR REPLACE FUNCTION list_my_google_accounts()
RETURNS TABLE (
  id uuid,
  google_email text,
  status text,
  granted_scopes text[],
  last_verified_at timestamptz,
  refresh_token_issued_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    uga.id,
    uga.google_email,
    uga.status,
    uga.granted_scopes,
    uga.last_verified_at,
    uga.refresh_token_issued_at,
    uga.created_at,
    uga.updated_at
  FROM user_google_accounts uga
  WHERE uga.user_id = auth.uid()
  ORDER BY uga.created_at;
$$;

REVOKE ALL ON FUNCTION list_my_google_accounts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_my_google_accounts() TO authenticated;

DROP FUNCTION IF EXISTS claim_calendar_sync_jobs(int, text, int);

CREATE OR REPLACE FUNCTION claim_calendar_sync_jobs(
  p_batch_size int,
  p_worker_id text,
  p_lease_seconds int DEFAULT 300,
  p_organization_id uuid DEFAULT NULL
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

  DELETE FROM calendar_sync_outbox expired
  WHERE expired.status = 'processing'
    AND expired.locked_at IS NOT NULL
    AND expired.locked_at < now() - make_interval(secs => p_lease_seconds)
    AND (p_organization_id IS NULL OR expired.organization_id = p_organization_id)
    AND EXISTS (
      SELECT 1
      FROM calendar_sync_outbox queued
      WHERE queued.organization_id = expired.organization_id
        AND queued.dedupe_key = expired.dedupe_key
        AND queued.status IN ('pending', 'retry')
    );

  UPDATE calendar_sync_outbox o
  SET
    status = 'retry',
    locked_at = NULL,
    locked_by = NULL,
    available_at = now()
  WHERE o.status = 'processing'
    AND o.locked_at IS NOT NULL
    AND o.locked_at < now() - make_interval(secs => p_lease_seconds)
    AND (p_organization_id IS NULL OR o.organization_id = p_organization_id);

  RETURN QUERY
  WITH candidates AS (
    SELECT o.id
    FROM calendar_sync_outbox o
    WHERE o.status IN ('pending', 'retry')
      AND o.available_at <= now()
      AND (p_organization_id IS NULL OR o.organization_id = p_organization_id)
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

REVOKE ALL ON FUNCTION claim_calendar_sync_jobs(int, text, int, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_calendar_sync_jobs(int, text, int, uuid) TO service_role;

COMMIT;
