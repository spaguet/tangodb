-- HALL-RENT-TOPUP-3: Mini App receipt chat and CRM staff-alert chat are independent.
-- telegram_chat_url remains the link renters open to send a screenshot.
-- telegram_staff_alert_chat_url is where the studio bot posts top-up alerts.

BEGIN;

ALTER TABLE organization_renter_channel
  ADD COLUMN IF NOT EXISTS telegram_staff_alert_chat_url text;

COMMENT ON COLUMN organization_renter_channel.telegram_staff_alert_chat_url IS
  'Chat URL for CRM staff top-up alerts (group or private). Independent of telegram_chat_url (renter receipts).';

COMMENT ON COLUMN organization_renter_channel.telegram_chat_url IS
  'Link Mini App opens so the renter can send a payment screenshot. Not used as the bot alert destination when telegram_staff_alert_chat_url is set.';

UPDATE organization_renter_channel
SET telegram_staff_alert_chat_url = telegram_chat_url
WHERE telegram_staff_alert_chat_url IS NULL
  AND telegram_chat_url IS NOT NULL;

CREATE OR REPLACE FUNCTION _renter_staff_alert_url(p_staff_url text, p_receipt_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    NULLIF(trim(COALESCE(p_staff_url, '')), ''),
    NULLIF(trim(COALESCE(p_receipt_url, '')), '')
  );
$$;

CREATE OR REPLACE FUNCTION _renter_resolve_staff_alert_chat_id(p_org_id uuid)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_chat_id bigint;
  v_url text;
  v_from_url bigint;
BEGIN
  SELECT
    c.telegram_receipt_chat_id,
    _renter_staff_alert_url(c.telegram_staff_alert_chat_url, c.telegram_chat_url)
  INTO v_chat_id, v_url
  FROM organization_renter_channel c
  WHERE c.organization_id = p_org_id;

  IF v_chat_id IS NOT NULL AND v_chat_id <> 0 THEN
    RETURN v_chat_id;
  END IF;

  v_from_url := _renter_telegram_url_user_id(v_url);
  RETURN v_from_url;
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

  SELECT
    _renter_staff_alert_url(c.telegram_staff_alert_chat_url, c.telegram_chat_url),
    c.telegram_receipt_chat_id,
    c.telegram_receipt_candidate_chat_id
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
    'telegram_staff_alert_chat_url', v_row.telegram_staff_alert_chat_url,
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
      _renter_staff_alert_url(v_row.telegram_staff_alert_chat_url, v_row.telegram_chat_url),
      v_row.telegram_receipt_chat_id,
      v_row.telegram_receipt_candidate_chat_id
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION update_organization_renter_channel(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid := auth_organization_id();
  v_chat text;
  v_staff text;
  v_app text;
  v_staff_in boolean;
  v_old organization_renter_channel%ROWTYPE;
  v_new_staff text;
  v_old_match text;
  v_new_match text;
  v_clear boolean;
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

  v_staff_in := p_payload ? 'telegram_staff_alert_chat_url';
  IF v_staff_in THEN
    v_staff := NULLIF(trim(COALESCE(p_payload ->> 'telegram_staff_alert_chat_url', '')), '');
    IF v_staff IS NOT NULL AND NOT _renter_telegram_chat_url_ok(v_staff) THEN
      RETURN jsonb_build_object('success', false, 'error', 'renter.channel.chatUrlInvalid');
    END IF;
  END IF;

  v_app := NULLIF(trim(COALESCE(p_payload ->> 'app_short_name', '')), '');
  IF v_app IS NOT NULL AND v_app !~ '^[A-Za-z0-9_]{1,64}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.channel.appShortNameInvalid');
  END IF;

  SELECT * INTO v_old FROM organization_renter_channel WHERE organization_id = v_org;

  v_new_staff := CASE WHEN v_staff_in THEN v_staff ELSE v_old.telegram_staff_alert_chat_url END;
  v_old_match := _renter_staff_alert_url(v_old.telegram_staff_alert_chat_url, v_old.telegram_chat_url);
  v_new_match := _renter_staff_alert_url(v_new_staff, v_chat);
  v_clear := v_old_match IS DISTINCT FROM v_new_match;

  INSERT INTO organization_renter_channel (
    organization_id, telegram_chat_url, telegram_staff_alert_chat_url, app_short_name, updated_at
  )
  VALUES (v_org, v_chat, v_new_staff, v_app, now())
  ON CONFLICT (organization_id) DO UPDATE SET
    telegram_chat_url = EXCLUDED.telegram_chat_url,
    telegram_staff_alert_chat_url = EXCLUDED.telegram_staff_alert_chat_url,
    app_short_name = COALESCE(EXCLUDED.app_short_name, organization_renter_channel.app_short_name),
    telegram_receipt_chat_id = CASE
      WHEN v_clear THEN NULL
      ELSE organization_renter_channel.telegram_receipt_chat_id
    END,
    telegram_receipt_chat_bound_at = CASE
      WHEN v_clear THEN NULL
      ELSE organization_renter_channel.telegram_receipt_chat_bound_at
    END,
    telegram_receipt_candidate_chat_id = CASE
      WHEN v_clear THEN NULL
      ELSE organization_renter_channel.telegram_receipt_candidate_chat_id
    END,
    telegram_receipt_candidate_title = CASE
      WHEN v_clear THEN NULL
      ELSE organization_renter_channel.telegram_receipt_candidate_title
    END,
    telegram_receipt_candidate_at = CASE
      WHEN v_clear THEN NULL
      ELSE organization_renter_channel.telegram_receipt_candidate_at
    END,
    updated_at = now();

  RETURN get_organization_renter_channel();
END;
$$;

REVOKE ALL ON FUNCTION _renter_staff_alert_url(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_resolve_staff_alert_chat_id(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION renter_telegram_receipt_chat_ingest(jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION renter_telegram_receipt_chat_ingest(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION get_organization_renter_channel() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_organization_renter_channel(jsonb) TO authenticated, service_role;

COMMIT;
