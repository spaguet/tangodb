-- FE3 / 2.9.59: outbox gate_wait retention → skipped; claim_token fencing; bootstrap undelivered summary.

BEGIN;

-- =============================================================================
-- 1. Outbox columns — fencing + retention + renter ack
-- =============================================================================

ALTER TABLE renter_telegram_outbox
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS gate_wait_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skipped_acknowledged_at timestamptz;

ALTER TABLE renter_telegram_outbox
  DROP CONSTRAINT IF EXISTS renter_telegram_outbox_gate_wait_count_chk;

ALTER TABLE renter_telegram_outbox
  ADD CONSTRAINT renter_telegram_outbox_gate_wait_count_chk
  CHECK (gate_wait_count >= 0);

COMMENT ON COLUMN renter_telegram_outbox.claim_token IS
  'FE3: fencing token set on claim; complete must match or no-op.';
COMMENT ON COLUMN renter_telegram_outbox.gate_wait_count IS
  'FE3: gate_wait cycles (no_bot_started/blocked); after max → skipped.';
COMMENT ON COLUMN renter_telegram_outbox.skipped_acknowledged_at IS
  'FE3: renter saw undelivered summary in Mini App.';

CREATE OR REPLACE FUNCTION _renter_outbox_gate_wait_max_count()
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT 288;
$$;

COMMENT ON FUNCTION _renter_outbox_gate_wait_max_count() IS
  'FE3: ~24h at 5-min gate_wait backoff before skipped.';

CREATE OR REPLACE FUNCTION _renter_outbox_gate_retention_interval()
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT interval '7 days';
$$;

-- =============================================================================
-- 2. Claim — issue claim_token; clear on lease expiry
-- =============================================================================

CREATE OR REPLACE FUNCTION claim_renter_telegram_outbox(
  p_batch_size integer DEFAULT 10,
  p_worker_id text DEFAULT 'worker',
  p_lease_seconds integer DEFAULT 120
)
RETURNS SETOF renter_telegram_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 50 THEN
    RAISE EXCEPTION 'invalid_batch_size';
  END IF;
  IF p_worker_id IS NULL OR length(trim(p_worker_id)) = 0 THEN
    RAISE EXCEPTION 'worker_id_required';
  END IF;

  UPDATE renter_telegram_outbox o
  SET
    status = 'retry',
    locked_at = NULL,
    locked_by = NULL,
    claim_token = NULL,
    available_at = now()
  WHERE o.status = 'processing'
    AND o.locked_at IS NOT NULL
    AND o.locked_at < now() - make_interval(secs => COALESCE(p_lease_seconds, 120));

  RETURN QUERY
  WITH candidates AS (
    SELECT o.id
    FROM renter_telegram_outbox o
    WHERE o.status IN ('pending', 'retry')
      AND o.available_at <= now()
    ORDER BY o.available_at ASC, o.created_at ASC
    LIMIT p_batch_size
    FOR UPDATE OF o SKIP LOCKED
  )
  UPDATE renter_telegram_outbox o
  SET
    status = 'processing',
    locked_at = now(),
    locked_by = p_worker_id,
    claim_token = gen_random_uuid()
  FROM candidates c
  WHERE o.id = c.id
  RETURNING o.*;
END;
$$;

-- =============================================================================
-- 3. Complete — fencing + gate_wait retention
-- =============================================================================

DROP FUNCTION IF EXISTS complete_renter_telegram_outbox(uuid, text, text, integer);

CREATE OR REPLACE FUNCTION complete_renter_telegram_outbox(
  p_id uuid,
  p_outcome text,
  p_error_code text DEFAULT NULL,
  p_retry_seconds integer DEFAULT NULL,
  p_claim_token uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row renter_telegram_outbox%ROWTYPE;
  v_delay integer;
  v_gate_count integer;
  v_reason text;
BEGIN
  SELECT * INTO v_row FROM renter_telegram_outbox WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_row.status IN ('sent', 'skipped', 'dead') THEN
    RETURN;
  END IF;

  IF v_row.status = 'processing' THEN
    IF p_claim_token IS NULL OR v_row.claim_token IS DISTINCT FROM p_claim_token THEN
      RETURN;
    END IF;
  END IF;

  IF p_outcome = 'sent' THEN
    UPDATE renter_telegram_outbox
    SET
      status = 'sent',
      sent_at = now(),
      locked_at = NULL,
      locked_by = NULL,
      claim_token = NULL,
      last_error_code = NULL,
      text = '.'
    WHERE id = p_id;
    RETURN;
  END IF;

  IF p_outcome = 'skipped' THEN
    UPDATE renter_telegram_outbox
    SET
      status = 'skipped',
      locked_at = NULL,
      locked_by = NULL,
      claim_token = NULL,
      last_error_code = p_error_code
    WHERE id = p_id;
    RETURN;
  END IF;

  IF p_outcome = 'dead' THEN
    UPDATE renter_telegram_outbox
    SET
      status = 'dead',
      locked_at = NULL,
      locked_by = NULL,
      claim_token = NULL,
      last_error_code = p_error_code
    WHERE id = p_id;
    RETURN;
  END IF;

  IF p_outcome = 'gate_wait' THEN
    v_reason := COALESCE(p_error_code, 'gate');
    v_gate_count := v_row.gate_wait_count + 1;

    IF v_gate_count >= _renter_outbox_gate_wait_max_count()
       OR v_row.created_at < now() - _renter_outbox_gate_retention_interval() THEN
      UPDATE renter_telegram_outbox
      SET
        status = 'skipped',
        gate_wait_count = v_gate_count,
        locked_at = NULL,
        locked_by = NULL,
        claim_token = NULL,
        last_error_code = v_reason
      WHERE id = p_id;
      RETURN;
    END IF;

    v_delay := GREATEST(COALESCE(p_retry_seconds, 300), 60);
    UPDATE renter_telegram_outbox
    SET
      status = 'pending',
      gate_wait_count = v_gate_count,
      locked_at = NULL,
      locked_by = NULL,
      claim_token = NULL,
      last_error_code = v_reason,
      available_at = now() + make_interval(secs => v_delay)
    WHERE id = p_id;
    RETURN;
  END IF;

  -- retry
  v_delay := GREATEST(COALESCE(p_retry_seconds, 60), 15);
  UPDATE renter_telegram_outbox
  SET
    status = CASE WHEN attempts + 1 >= max_attempts THEN 'dead' ELSE 'retry' END,
    attempts = attempts + 1,
    locked_at = NULL,
    locked_by = NULL,
    claim_token = NULL,
    last_error_code = p_error_code,
    available_at = now() + make_interval(secs => v_delay)
  WHERE id = p_id;
END;
$$;

COMMENT ON FUNCTION complete_renter_telegram_outbox(uuid, text, text, integer, uuid) IS
  'FE3: claim_token fencing; gate_wait retention → skipped.';

-- =============================================================================
-- 4. Undelivered summary for Mini App bootstrap
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_outbox_unacknowledged_skipped_count(
  p_org_id uuid,
  p_renter_id uuid
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::integer
  FROM renter_telegram_outbox o
  WHERE o.organization_id = p_org_id
    AND o.renter_id = p_renter_id
    AND o.status = 'skipped'
    AND o.skipped_acknowledged_at IS NULL
    AND o.last_error_code IN ('no_bot_started', 'blocked', 'gate', 'time_budget')
    AND o.created_at > now() - interval '30 days';
$$;

CREATE OR REPLACE FUNCTION renter_ack_outbox_skipped()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ctx record;
  v_n integer;
BEGIN
  SELECT * INTO v_ctx FROM _renter_require_renter_ctx();

  UPDATE renter_telegram_outbox o
  SET skipped_acknowledged_at = now()
  WHERE o.organization_id = v_ctx.org_id
    AND o.renter_id = v_ctx.renter_id
    AND o.status = 'skipped'
    AND o.skipped_acknowledged_at IS NULL
    AND o.last_error_code IN ('no_bot_started', 'blocked', 'gate', 'time_budget');

  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'acknowledged', v_n);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

COMMENT ON FUNCTION renter_ack_outbox_skipped() IS
  'FE3: renter dismisses undelivered Telegram notification summary.';

-- =============================================================================
-- 5. Bootstrap — undelivered_notifications count
-- =============================================================================

CREATE OR REPLACE FUNCTION renter_bootstrap()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ctx record;
  v_renter renters%ROWTYPE;
  v_name text;
  v_branding text;
  v_tz text;
  v_currency text;
  v_locale text;
  v_chat text;
  v_started timestamptz;
  v_allows boolean;
  v_started_bot bigint;
  v_channel_bot bigint;
  v_bot_started boolean;
  v_bot_url text;
  v_undelivered integer;
BEGIN
  SELECT * INTO v_ctx FROM _renter_require_renter_ctx();

  SELECT r.*
  INTO v_renter
  FROM renters r
  WHERE r.id = v_ctx.renter_id
    AND r.organization_id = v_ctx.org_id;

  SELECT o.name, os.branding_name, os.timezone, os.currency_code, os.locale
  INTO v_name, v_branding, v_tz, v_currency, v_locale
  FROM organizations o
  JOIN organization_settings os ON os.organization_id = o.id
  WHERE o.id = v_ctx.org_id;

  SELECT c.telegram_chat_url, c.telegram_bot_id
  INTO v_chat, v_channel_bot
  FROM organization_renter_channel c
  WHERE c.organization_id = v_ctx.org_id;

  IF v_chat IS NOT NULL AND NOT _renter_telegram_chat_url_ok(v_chat) THEN
    v_chat := NULL;
  END IF;

  SELECT d.bot_started_at, d.allows_write_to_pm, d.bot_started_bot_id
  INTO v_started, v_allows, v_started_bot
  FROM renter_telegram_dialog d
  WHERE d.organization_id = v_ctx.org_id
    AND d.telegram_id = v_ctx.telegram_id;

  v_bot_started := v_started IS NOT NULL
    AND (v_channel_bot IS NULL OR v_started_bot = v_channel_bot);

  v_bot_url := _renter_telegram_bot_open_url(v_ctx.org_id);

  v_undelivered := _renter_outbox_unacknowledged_skipped_count(v_ctx.org_id, v_ctx.renter_id);

  RETURN jsonb_build_object(
    'success', true,
    'studio_name', COALESCE(NULLIF(trim(v_branding), ''), v_name),
    'timezone', COALESCE(v_tz, 'UTC'),
    'currency_code', COALESCE(v_currency, 'RUB'),
    'locale', COALESCE(v_locale, 'ru'),
    'chat_url', v_chat,
    'bot_url', v_bot_url,
    'addon_active', renter_miniapp_addon_is_active(v_ctx.org_id),
    'bot_started', v_bot_started,
    'allows_write', COALESCE(v_allows, false),
    'display_name', v_renter.display_name,
    'contact_phone', v_renter.contact_phone,
    'booking_banned', v_renter.booking_banned_at IS NOT NULL,
    'server_now', now(),
    'undelivered_notifications', v_undelivered
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION renter_ack_outbox_skipped() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION renter_ack_outbox_skipped() TO authenticated;

REVOKE ALL ON FUNCTION complete_renter_telegram_outbox(uuid, text, text, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_renter_telegram_outbox(uuid, text, text, integer, uuid) TO service_role;

COMMIT;
