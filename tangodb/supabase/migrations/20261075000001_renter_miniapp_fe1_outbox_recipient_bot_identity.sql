-- FE1 / 2.9.57: outbox recipient resolve at send; bot identity on Start gate; bootstrap bot URL.

BEGIN;

-- =============================================================================
-- 1. Dialog: bind Start to telegram_bot_id
-- =============================================================================

ALTER TABLE renter_telegram_dialog
  ADD COLUMN IF NOT EXISTS bot_started_bot_id bigint
  CHECK (bot_started_bot_id IS NULL OR bot_started_bot_id > 0);

COMMENT ON COLUMN renter_telegram_dialog.bot_started_bot_id IS
  'FE1: Telegram bot id when renter pressed /start. Invalidated when org replaces bot token.';

UPDATE renter_telegram_dialog d
SET bot_started_bot_id = c.telegram_bot_id
FROM organization_renter_channel c
WHERE d.organization_id = c.organization_id
  AND d.bot_started_at IS NOT NULL
  AND d.bot_started_bot_id IS NULL
  AND c.telegram_bot_id IS NOT NULL;

-- =============================================================================
-- 2. Safe bot open URL (https://t.me/username only)
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_telegram_bot_open_url(p_org_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user text;
BEGIN
  SELECT c.bot_username INTO v_user
  FROM organization_renter_channel c
  WHERE c.organization_id = p_org_id;

  v_user := NULLIF(trim(COALESCE(v_user, '')), '');
  IF v_user IS NULL OR v_user !~ '^[A-Za-z0-9_]{5,32}$' THEN
    RETURN NULL;
  END IF;

  RETURN 'https://t.me/' || v_user;
END;
$$;

COMMENT ON FUNCTION _renter_telegram_bot_open_url(uuid) IS
  'FE1: server-built https://t.me/{username} for BotBanner CTA. No arbitrary URLs.';

-- =============================================================================
-- 3. Send gate — Start must match current org bot id
-- =============================================================================

CREATE OR REPLACE FUNCTION renter_telegram_outbox_send_gate(
  p_org_id uuid,
  p_telegram_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_dialog renter_telegram_dialog%ROWTYPE;
  v_bot bigint;
BEGIN
  IF NOT renter_miniapp_addon_is_active(p_org_id) THEN
    RETURN jsonb_build_object('can_send', false, 'skip_reason', 'addon_inactive');
  END IF;

  SELECT c.telegram_bot_id INTO v_bot
  FROM organization_renter_channel c
  WHERE c.organization_id = p_org_id;

  SELECT * INTO v_dialog
  FROM renter_telegram_dialog d
  WHERE d.organization_id = p_org_id
    AND d.telegram_id = p_telegram_id;

  IF v_dialog.bot_started_at IS NULL THEN
    RETURN jsonb_build_object('can_send', false, 'skip_reason', 'no_bot_started');
  END IF;

  IF v_bot IS NOT NULL AND v_dialog.bot_started_bot_id IS DISTINCT FROM v_bot THEN
    RETURN jsonb_build_object('can_send', false, 'skip_reason', 'no_bot_started');
  END IF;

  IF v_dialog.allows_write_to_pm IS FALSE THEN
    RETURN jsonb_build_object('can_send', false, 'skip_reason', 'blocked');
  END IF;

  RETURN jsonb_build_object('can_send', true);
END;
$$;

-- =============================================================================
-- 4. Resolve current recipient before send (rebind enqueue → drain)
-- =============================================================================

CREATE OR REPLACE FUNCTION renter_telegram_outbox_prepare_send(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row renter_telegram_outbox%ROWTYPE;
  v_current bigint;
  v_gate jsonb;
BEGIN
  SELECT * INTO v_row FROM renter_telegram_outbox WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('action', 'skip', 'reason', 'not_found');
  END IF;

  IF v_row.renter_id IS NOT NULL THEN
    SELECT r.telegram_id INTO v_current
    FROM renters r
    WHERE r.id = v_row.renter_id
      AND r.organization_id = v_row.organization_id;

    IF v_current IS NULL OR v_current <= 0 THEN
      RETURN jsonb_build_object('action', 'skip', 'reason', 'recipient_unbound');
    END IF;

    IF v_current IS DISTINCT FROM v_row.telegram_id THEN
      UPDATE renter_telegram_outbox
      SET telegram_id = v_current
      WHERE id = p_id;
      v_row.telegram_id := v_current;
    END IF;
  ELSE
    v_current := v_row.telegram_id;
  END IF;

  v_gate := renter_telegram_outbox_send_gate(v_row.organization_id, v_current);

  IF NOT COALESCE((v_gate ->> 'can_send')::boolean, false) THEN
    IF v_gate ->> 'skip_reason' = 'addon_inactive' THEN
      RETURN jsonb_build_object('action', 'skip', 'reason', 'addon_inactive');
    END IF;
    RETURN jsonb_build_object(
      'action', 'gate_wait',
      'reason', COALESCE(v_gate ->> 'skip_reason', 'gate'),
      'telegram_id', v_current
    );
  END IF;

  RETURN jsonb_build_object(
    'action', 'send',
    'telegram_id', v_current,
    'text', v_row.text
  );
END;
$$;

COMMENT ON FUNCTION renter_telegram_outbox_prepare_send(uuid) IS
  'FE1: resolve renter telegram_id at drain; redirect on rebind; gate before send.';

-- =============================================================================
-- 5. Webhook — persist bot id on /start
-- =============================================================================

CREATE OR REPLACE FUNCTION renter_telegram_webhook_ingest(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_tg bigint;
  v_bot bigint;
  v_update bigint;
  v_is_start boolean;
  v_blocked boolean;
  v_allows boolean;
  v_inserted integer := 0;
BEGIN
  v_org := NULLIF(p_payload ->> 'organization_id', '')::uuid;
  BEGIN
    v_tg := NULLIF(p_payload ->> 'telegram_id', '')::bigint;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.webhook.badTelegramId');
  END;
  v_bot := NULLIF(p_payload ->> 'telegram_bot_id', '')::bigint;
  v_update := NULLIF(p_payload ->> 'update_id', '')::bigint;
  v_is_start := COALESCE((p_payload ->> 'is_start')::boolean, false);
  v_blocked := COALESCE((p_payload ->> 'blocked')::boolean, false);
  v_allows := CASE
    WHEN p_payload ->> 'allows_write' IS NULL THEN NULL
    ELSE (p_payload ->> 'allows_write')::boolean
  END;

  IF v_org IS NULL OR v_tg IS NULL OR v_tg <= 0 OR v_bot IS NULL OR v_update IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.webhook.badPayload');
  END IF;

  INSERT INTO renter_telegram_webhook_updates (telegram_bot_id, update_id)
  VALUES (v_bot, v_update)
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN jsonb_build_object('success', true, 'already_applied', true);
  END IF;

  INSERT INTO renter_telegram_dialog (
    organization_id, telegram_id, bot_started_at, bot_started_bot_id, allows_write_to_pm, updated_at
  )
  VALUES (
    v_org,
    v_tg,
    CASE WHEN v_is_start THEN now() ELSE NULL END,
    CASE WHEN v_is_start THEN v_bot ELSE NULL END,
    CASE WHEN v_blocked THEN false ELSE COALESCE(v_allows, false) END,
    now()
  )
  ON CONFLICT (organization_id, telegram_id) DO UPDATE SET
    bot_started_at = CASE
      WHEN v_is_start THEN COALESCE(renter_telegram_dialog.bot_started_at, now())
      ELSE renter_telegram_dialog.bot_started_at
    END,
    bot_started_bot_id = CASE
      WHEN v_is_start THEN v_bot
      ELSE renter_telegram_dialog.bot_started_bot_id
    END,
    allows_write_to_pm = CASE
      WHEN v_blocked THEN false
      WHEN v_allows IS NOT NULL THEN v_allows
      ELSE renter_telegram_dialog.allows_write_to_pm
    END,
    updated_at = now();

  RETURN jsonb_build_object('success', true, 'already_applied', false);
END;
$$;

-- =============================================================================
-- 6. Redact outbox text after successful send
-- =============================================================================

CREATE OR REPLACE FUNCTION complete_renter_telegram_outbox(
  p_id uuid,
  p_outcome text,
  p_error_code text DEFAULT NULL,
  p_retry_seconds integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row renter_telegram_outbox%ROWTYPE;
  v_delay integer;
BEGIN
  SELECT * INTO v_row FROM renter_telegram_outbox WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF p_outcome = 'sent' THEN
    UPDATE renter_telegram_outbox
    SET
      status = 'sent',
      sent_at = now(),
      locked_at = NULL,
      locked_by = NULL,
      last_error_code = NULL,
      text = '.'
    WHERE id = p_id;
    RETURN;
  END IF;

  IF p_outcome = 'skipped' THEN
    UPDATE renter_telegram_outbox
    SET status = 'skipped', locked_at = NULL, locked_by = NULL, last_error_code = p_error_code
    WHERE id = p_id;
    RETURN;
  END IF;

  IF p_outcome = 'dead' THEN
    UPDATE renter_telegram_outbox
    SET status = 'dead', locked_at = NULL, locked_by = NULL, last_error_code = p_error_code
    WHERE id = p_id;
    RETURN;
  END IF;

  IF p_outcome = 'gate_wait' THEN
    v_delay := GREATEST(COALESCE(p_retry_seconds, 300), 60);
    UPDATE renter_telegram_outbox
    SET
      status = 'pending',
      locked_at = NULL,
      locked_by = NULL,
      last_error_code = p_error_code,
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
    last_error_code = p_error_code,
    available_at = now() + make_interval(secs => v_delay)
  WHERE id = p_id;
END;
$$;

-- =============================================================================
-- 7. Bootstrap — bot_url + bot_started tied to current bot
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
    'server_now', now()
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION _renter_telegram_bot_open_url(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION renter_telegram_outbox_prepare_send(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION _renter_telegram_bot_open_url(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION renter_telegram_outbox_prepare_send(uuid) TO service_role;

COMMIT;
