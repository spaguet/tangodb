-- HALL-RENT-TOPUP-2 follow-up: invite groups need CRM confirm (no first-group bind);
-- /start releases staff gate_wait; candidate chat + CRM copy.

BEGIN;

ALTER TABLE organization_renter_channel
  ADD COLUMN IF NOT EXISTS telegram_receipt_candidate_chat_id bigint;

ALTER TABLE organization_renter_channel
  ADD COLUMN IF NOT EXISTS telegram_receipt_candidate_title text;

ALTER TABLE organization_renter_channel
  ADD COLUMN IF NOT EXISTS telegram_receipt_candidate_at timestamptz;

ALTER TABLE organization_renter_channel
  DROP CONSTRAINT IF EXISTS organization_renter_channel_receipt_candidate_chat_id_check;

ALTER TABLE organization_renter_channel
  ADD CONSTRAINT organization_renter_channel_receipt_candidate_chat_id_check
  CHECK (telegram_receipt_candidate_chat_id IS NULL OR telegram_receipt_candidate_chat_id <> 0);

COMMENT ON COLUMN organization_renter_channel.telegram_receipt_candidate_chat_id IS
  'Invite-link groups: bot was added here, staff must confirm in CRM before alerts.';

CREATE OR REPLACE FUNCTION _renter_receipt_chat_title(p_title text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(left(trim(COALESCE(p_title, '')), 80), '');
$$;

CREATE OR REPLACE FUNCTION _renter_receipt_notify_status(
  p_url text,
  p_chat_id bigint,
  p_candidate bigint
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_chat_id IS NOT NULL AND p_chat_id <> 0 THEN
    RETURN 'bound';
  END IF;
  IF p_candidate IS NOT NULL AND p_candidate <> 0 THEN
    RETURN 'need_confirm';
  END IF;
  IF NOT _renter_telegram_chat_url_ok(p_url) THEN
    RETURN 'unconfigured';
  END IF;
  IF _renter_telegram_url_user_id(p_url) IS NOT NULL THEN
    RETURN 'need_start';
  END IF;
  IF _renter_telegram_url_username(p_url) IS NOT NULL
     OR _renter_telegram_url_is_invite(p_url) THEN
    RETURN 'need_bot_in_group';
  END IF;
  RETURN 'unconfigured';
END;
$$;

CREATE OR REPLACE FUNCTION _renter_clear_receipt_candidate(p_org uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE organization_renter_channel
  SET telegram_receipt_candidate_chat_id = NULL,
      telegram_receipt_candidate_title = NULL,
      telegram_receipt_candidate_at = NULL,
      updated_at = now()
  WHERE organization_id = p_org;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_release_staff_outbox_gate(p_org_id uuid, p_chat_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n integer := 0;
BEGIN
  IF p_org_id IS NULL OR p_chat_id IS NULL OR p_chat_id = 0 THEN
    RETURN 0;
  END IF;

  UPDATE renter_telegram_outbox
  SET
    status = 'pending',
    available_at = now(),
    locked_at = NULL,
    locked_by = NULL,
    claim_token = NULL,
    gate_wait_count = 0,
    last_error_code = NULL
  WHERE organization_id = p_org_id
    AND telegram_id = p_chat_id
    AND event_type LIKE 'staff_%'
    AND sent_at IS NULL
    AND status IN ('pending', 'retry', 'skipped');

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

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

  IF v_is_start THEN
    PERFORM _renter_release_staff_outbox_gate(v_org, v_tg);
  END IF;

  RETURN jsonb_build_object('success', true, 'already_applied', false);
END;
$$;

CREATE OR REPLACE FUNCTION renter_telegram_receipt_chat_ingest(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_chat bigint;
  v_action text;
  v_chat_user text;
  v_from_user text;
  v_title text;
  v_url text;
  v_url_user text;
  v_url_id bigint;
  v_invite boolean;
  v_bound bigint;
  v_candidate bigint;
  v_match boolean := false;
BEGIN
  v_org := NULLIF(p_payload ->> 'organization_id', '')::uuid;
  BEGIN
    v_chat := NULLIF(p_payload ->> 'chat_id', '')::bigint;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.webhook.badChatId');
  END;
  v_action := NULLIF(trim(COALESCE(p_payload ->> 'action', '')), '');
  v_chat_user := _renter_normalize_telegram_username(p_payload ->> 'chat_username');
  v_from_user := _renter_normalize_telegram_username(p_payload ->> 'from_username');
  v_title := _renter_receipt_chat_title(p_payload ->> 'chat_title');

  IF v_org IS NULL OR v_chat IS NULL OR v_chat = 0 OR v_action NOT IN ('bind', 'unbind') THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.webhook.badPayload');
  END IF;

  SELECT c.telegram_chat_url, c.telegram_receipt_chat_id, c.telegram_receipt_candidate_chat_id
  INTO v_url, v_bound, v_candidate
  FROM organization_renter_channel c
  WHERE c.organization_id = v_org;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'bound', false);
  END IF;

  IF v_action = 'unbind' THEN
    IF v_bound IS NOT DISTINCT FROM v_chat THEN
      UPDATE organization_renter_channel
      SET telegram_receipt_chat_id = NULL,
          telegram_receipt_chat_bound_at = NULL,
          updated_at = now()
      WHERE organization_id = v_org;
    END IF;
    IF v_candidate IS NOT DISTINCT FROM v_chat THEN
      PERFORM _renter_clear_receipt_candidate(v_org);
    END IF;
    RETURN jsonb_build_object(
      'success', true,
      'bound', false,
      'cleared', v_bound IS NOT DISTINCT FROM v_chat
    );
  END IF;

  v_url_user := _renter_telegram_url_username(v_url);
  v_url_id := _renter_telegram_url_user_id(v_url);
  v_invite := _renter_telegram_url_is_invite(v_url);

  IF v_chat > 0 THEN
    IF v_url_id IS NOT NULL AND v_url_id = v_chat THEN
      v_match := true;
    ELSIF v_url_user IS NOT NULL AND v_from_user IS NOT NULL
      AND lower(v_url_user) = lower(v_from_user) THEN
      v_match := true;
    END IF;
  ELSE
    IF v_url_user IS NOT NULL AND v_chat_user IS NOT NULL
      AND lower(v_url_user) = lower(v_chat_user) THEN
      v_match := true;
    END IF;
  END IF;

  IF v_match THEN
    UPDATE organization_renter_channel
    SET telegram_receipt_chat_id = v_chat,
        telegram_receipt_chat_bound_at = COALESCE(telegram_receipt_chat_bound_at, now()),
        telegram_receipt_candidate_chat_id = NULL,
        telegram_receipt_candidate_title = NULL,
        telegram_receipt_candidate_at = NULL,
        updated_at = now()
    WHERE organization_id = v_org;

    PERFORM _renter_release_staff_outbox_gate(v_org, v_chat);

    RETURN jsonb_build_object('success', true, 'bound', true, 'chat_id', v_chat);
  END IF;

  -- Invite links have no public username: wait for CRM confirm, never auto-bind.
  IF v_invite AND v_bound IS NULL AND v_chat < 0 THEN
    UPDATE organization_renter_channel
    SET telegram_receipt_candidate_chat_id = v_chat,
        telegram_receipt_candidate_title = v_title,
        telegram_receipt_candidate_at = now(),
        updated_at = now()
    WHERE organization_id = v_org;

    RETURN jsonb_build_object(
      'success', true,
      'bound', false,
      'candidate', true,
      'chat_id', v_chat
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'bound', false);
END;
$$;

CREATE OR REPLACE FUNCTION get_organization_renter_channel()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid := auth_organization_id();
  v_row organization_renter_channel%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;
  IF NOT can_manage_settings() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  SELECT * INTO v_row FROM organization_renter_channel WHERE organization_id = v_org;

  RETURN jsonb_build_object(
    'success', true,
    'telegram_chat_url', v_row.telegram_chat_url,
    'bot_username', v_row.bot_username,
    'telegram_bot_id', v_row.telegram_bot_id,
    'app_short_name', v_row.app_short_name,
    'token_set', v_row.encrypted_bot_token IS NOT NULL,
    'token_last4', v_row.bot_token_last4,
    'miniapp_url', _renter_miniapp_direct_link(v_org),
    'telegram_receipt_chat_id', v_row.telegram_receipt_chat_id,
    'telegram_receipt_chat_bound_at', v_row.telegram_receipt_chat_bound_at,
    'telegram_receipt_candidate_chat_id', v_row.telegram_receipt_candidate_chat_id,
    'telegram_receipt_candidate_title', v_row.telegram_receipt_candidate_title,
    'telegram_receipt_notify_status', _renter_receipt_notify_status(
      v_row.telegram_chat_url,
      v_row.telegram_receipt_chat_id,
      v_row.telegram_receipt_candidate_chat_id
    )
  );
END;
$$;

DROP FUNCTION IF EXISTS _renter_receipt_notify_status(text, bigint);

CREATE OR REPLACE FUNCTION update_organization_renter_channel(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid := auth_organization_id();
  v_chat text;
  v_app text;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;
  IF NOT can_manage_settings() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;
  IF NOT organization_allows_writes(v_org) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.writesDisabled');
  END IF;

  v_chat := NULLIF(trim(COALESCE(p_payload ->> 'telegram_chat_url', '')), '');
  IF v_chat IS NOT NULL AND NOT _renter_telegram_chat_url_ok(v_chat) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.channel.chatUrlInvalid');
  END IF;

  v_app := NULLIF(trim(COALESCE(p_payload ->> 'app_short_name', '')), '');
  IF v_app IS NOT NULL AND v_app !~ '^[A-Za-z0-9_]{1,64}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.channel.appShortNameInvalid');
  END IF;

  INSERT INTO organization_renter_channel (organization_id, telegram_chat_url, app_short_name, updated_at)
  VALUES (v_org, v_chat, v_app, now())
  ON CONFLICT (organization_id) DO UPDATE SET
    telegram_chat_url = EXCLUDED.telegram_chat_url,
    app_short_name = COALESCE(EXCLUDED.app_short_name, organization_renter_channel.app_short_name),
    telegram_receipt_chat_id = CASE
      WHEN organization_renter_channel.telegram_chat_url IS DISTINCT FROM EXCLUDED.telegram_chat_url
      THEN NULL
      ELSE organization_renter_channel.telegram_receipt_chat_id
    END,
    telegram_receipt_chat_bound_at = CASE
      WHEN organization_renter_channel.telegram_chat_url IS DISTINCT FROM EXCLUDED.telegram_chat_url
      THEN NULL
      ELSE organization_renter_channel.telegram_receipt_chat_bound_at
    END,
    telegram_receipt_candidate_chat_id = CASE
      WHEN organization_renter_channel.telegram_chat_url IS DISTINCT FROM EXCLUDED.telegram_chat_url
      THEN NULL
      ELSE organization_renter_channel.telegram_receipt_candidate_chat_id
    END,
    telegram_receipt_candidate_title = CASE
      WHEN organization_renter_channel.telegram_chat_url IS DISTINCT FROM EXCLUDED.telegram_chat_url
      THEN NULL
      ELSE organization_renter_channel.telegram_receipt_candidate_title
    END,
    telegram_receipt_candidate_at = CASE
      WHEN organization_renter_channel.telegram_chat_url IS DISTINCT FROM EXCLUDED.telegram_chat_url
      THEN NULL
      ELSE organization_renter_channel.telegram_receipt_candidate_at
    END,
    updated_at = now();

  RETURN get_organization_renter_channel();
END;
$$;

CREATE OR REPLACE FUNCTION confirm_organization_renter_receipt_chat()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid := auth_organization_id();
  v_candidate bigint;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;
  IF NOT can_manage_settings() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;
  IF NOT organization_allows_writes(v_org) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.writesDisabled');
  END IF;

  SELECT telegram_receipt_candidate_chat_id
  INTO v_candidate
  FROM organization_renter_channel
  WHERE organization_id = v_org;

  IF v_candidate IS NULL OR v_candidate = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.channel.receiptCandidateMissing');
  END IF;

  UPDATE organization_renter_channel
  SET telegram_receipt_chat_id = v_candidate,
      telegram_receipt_chat_bound_at = now(),
      telegram_receipt_candidate_chat_id = NULL,
      telegram_receipt_candidate_title = NULL,
      telegram_receipt_candidate_at = NULL,
      updated_at = now()
  WHERE organization_id = v_org;

  PERFORM _renter_release_staff_outbox_gate(v_org, v_candidate);

  RETURN get_organization_renter_channel();
END;
$$;

CREATE OR REPLACE FUNCTION reject_organization_renter_receipt_chat()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid := auth_organization_id();
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;
  IF NOT can_manage_settings() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;
  IF NOT organization_allows_writes(v_org) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.writesDisabled');
  END IF;

  PERFORM _renter_clear_receipt_candidate(v_org);
  RETURN get_organization_renter_channel();
END;
$$;

REVOKE ALL ON FUNCTION _renter_receipt_chat_title(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_receipt_notify_status(text, bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_clear_receipt_candidate(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_release_staff_outbox_gate(uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION confirm_organization_renter_receipt_chat() FROM PUBLIC;
REVOKE ALL ON FUNCTION reject_organization_renter_receipt_chat() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION renter_telegram_webhook_ingest(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION renter_telegram_receipt_chat_ingest(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION get_organization_renter_channel() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_organization_renter_channel(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION confirm_organization_renter_receipt_chat() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION reject_organization_renter_receipt_chat() TO authenticated, service_role;

COMMIT;
