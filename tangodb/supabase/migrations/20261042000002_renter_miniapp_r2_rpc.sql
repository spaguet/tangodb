-- R2 / 2.9.5: RPC for channel, QR, topup inbox, staff wallet, bootstrap/detail patches.

BEGIN;

-- =============================================================================
-- Allowlist + Mini App href (never a stored mini_app_url)
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_telegram_chat_url_ok(p_url text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v text;
BEGIN
  v := trim(COALESCE(p_url, ''));
  IF v = '' THEN
    RETURN false;
  END IF;
  IF v ~* 'javascript:' THEN
    RETURN false;
  END IF;
  IF v ~* 't\.me/share' OR v ~* '/iv(/|$|\?)' THEN
    RETURN false;
  END IF;
  IF v ~* '^https://t\.me/[A-Za-z0-9_]{5,32}/?$' THEN
    RETURN true;
  END IF;
  IF v ~* '^https://t\.me/\+[A-Za-z0-9_-]+/?$' THEN
    RETURN true;
  END IF;
  IF v ~* '^https://t\.me/joinchat/[A-Za-z0-9_-]+/?$' THEN
    RETURN true;
  END IF;
  IF v ~* '^tg://resolve\?domain=[A-Za-z0-9_]{5,32}$' THEN
    RETURN true;
  END IF;
  IF v ~* '^tg://user\?id=[0-9]+$' THEN
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

COMMENT ON FUNCTION _renter_telegram_chat_url_ok(text) IS
  '§1.9 chat URL allowlist. share/iv/javascript/other tg:// / arbitrary http refused.';

CREATE OR REPLACE FUNCTION _renter_miniapp_direct_link(p_org_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user text;
  v_app text;
BEGIN
  SELECT c.bot_username, c.app_short_name
  INTO v_user, v_app
  FROM organization_renter_channel c
  WHERE c.organization_id = p_org_id;

  IF v_user IS NULL OR trim(v_user) = '' OR v_app IS NULL OR trim(v_app) = '' THEN
    RETURN NULL;
  END IF;

  RETURN format(
    'https://t.me/%s/%s?startapp=%s',
    v_user,
    v_app,
    p_org_id::text
  );
END;
$$;

COMMENT ON FUNCTION _renter_miniapp_direct_link(uuid) IS
  'Outgoing Mini App button href from getMe username + BotFather short name. Not a form URL.';

CREATE OR REPLACE FUNCTION _renter_b64url(p_data bytea)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT rtrim(translate(encode(p_data, 'base64'), '+/', '-_'), '=');
$$;

CREATE OR REPLACE FUNCTION _renter_qr_signed_url(p_storage_path text, p_expires_in integer DEFAULT 300)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_secret text;
  v_base text;
  v_exp integer;
  v_header text;
  v_payload text;
  v_sig text;
  v_path text;
BEGIN
  v_path := NULLIF(trim(COALESCE(p_storage_path, '')), '');
  IF v_path IS NULL THEN
    RETURN NULL;
  END IF;

  v_secret := NULLIF(current_setting('app.settings.jwt_secret', true), '');
  IF v_secret IS NULL THEN
    RETURN NULL;
  END IF;

  v_base := rtrim(COALESCE(NULLIF(current_setting('app.settings.supabase_url', true), ''), ''), '/');
  v_exp := floor(extract(epoch FROM clock_timestamp()))::integer + GREATEST(COALESCE(p_expires_in, 300), 60);
  v_header := _renter_b64url(convert_to('{"alg":"HS256","typ":"JWT"}', 'utf8'));
  v_payload := _renter_b64url(
    convert_to(
      json_build_object('url', 'org-rental-qr/' || v_path, 'exp', v_exp)::text,
      'utf8'
    )
  );
  v_sig := _renter_b64url(
    hmac(
      convert_to(v_header || '.' || v_payload, 'utf8'),
      convert_to(v_secret, 'utf8'),
      'sha256'
    )
  );

  IF v_base = '' THEN
    RETURN format(
      '/storage/v1/object/sign/org-rental-qr/%s?token=%s.%s.%s',
      v_path,
      v_header,
      v_payload,
      v_sig
    );
  END IF;

  RETURN format(
    '%s/storage/v1/object/sign/org-rental-qr/%s?token=%s.%s.%s',
    v_base,
    v_path,
    v_header,
    v_payload,
    v_sig
  );
END;
$$;

-- =============================================================================
-- Wallet topup insert (advance fully allocated + ledger topup)
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_wallet_insert_topup(
  p_org_id uuid,
  p_renter_id uuid,
  p_amount numeric,
  p_advance_id uuid,
  p_topup_request_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO renter_wallet_ledger (
    organization_id, renter_id, entry_type, amount, rental_id, advance_id, phase, topup_request_id
  )
  VALUES (
    p_org_id, p_renter_id, 'topup', p_amount::numeric(12, 2), NULL, p_advance_id, NULL, p_topup_request_id
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_credit_wallet_topup(
  p_org_id uuid,
  p_renter_id uuid,
  p_amount numeric,
  p_method text,
  p_member_id uuid,
  p_topup_request_id uuid,
  p_notes text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today date;
  v_advance uuid;
  v_currency text;
  v_advance_method text;
BEGIN
  v_today := _org_local_date(p_org_id);

  IF _is_finance_period_closed(p_org_id, v_today) THEN
    PERFORM _renter_raise('finance.error.periodClosed');
  END IF;

  IF NOT organization_allows_writes(p_org_id) THEN
    PERFORM _renter_raise('renter.writesDisabled');
  END IF;

  v_currency := _renter_org_currency(p_org_id);
  v_advance_method := CASE WHEN p_method = 'qr' THEN 'transfer' ELSE 'cash' END;

  INSERT INTO rental_advances (
    organization_id, renter_id, amount, allocated_amount, currency, method,
    created_by, notes, operation_date
  )
  VALUES (
    p_org_id,
    p_renter_id,
    p_amount,
    p_amount,
    v_currency,
    v_advance_method,
    p_member_id,
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    v_today
  )
  RETURNING id INTO v_advance;

  PERFORM _renter_wallet_insert_topup(
    p_org_id, p_renter_id, p_amount, v_advance, p_topup_request_id
  );
  PERFORM _renter_apply_wallet(p_org_id, p_renter_id);

  RETURN v_advance;
END;
$$;

-- =============================================================================
-- Channel settings
-- =============================================================================

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
    'miniapp_url', _renter_miniapp_direct_link(v_org)
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
    updated_at = now();

  RETURN get_organization_renter_channel();
END;
$$;

CREATE OR REPLACE FUNCTION commit_organization_renter_bot(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_bot_id bigint;
  v_username text;
  v_last4 text;
  v_app text;
  v_token_hex text;
  v_encrypted bytea;
  v_wh_token text;
  v_wh_secret text;
  v_other uuid;
BEGIN
  v_org := NULLIF(p_payload ->> 'organization_id', '')::uuid;
  v_bot_id := NULLIF(p_payload ->> 'telegram_bot_id', '')::bigint;
  v_username := NULLIF(trim(COALESCE(p_payload ->> 'bot_username', '')), '');
  v_last4 := NULLIF(trim(COALESCE(p_payload ->> 'bot_token_last4', '')), '');
  v_app := NULLIF(trim(COALESCE(p_payload ->> 'app_short_name', '')), '');
  v_token_hex := NULLIF(trim(COALESCE(p_payload ->> 'encrypted_bot_token_hex', '')), '');
  v_wh_token := NULLIF(trim(COALESCE(p_payload ->> 'webhook_token', '')), '');
  v_wh_secret := NULLIF(trim(COALESCE(p_payload ->> 'webhook_secret', '')), '');

  IF v_org IS NULL OR v_bot_id IS NULL OR v_token_hex IS NULL OR v_wh_token IS NULL OR v_wh_secret IS NULL THEN
    PERFORM _renter_raise('renter.channel.botPayloadInvalid');
  END IF;

  SELECT c.organization_id INTO v_other
  FROM organization_renter_channel c
  WHERE c.telegram_bot_id = v_bot_id
    AND c.organization_id IS DISTINCT FROM v_org
  LIMIT 1;

  IF v_other IS NOT NULL THEN
    PERFORM _renter_raise('renter.channel.botTaken');
  END IF;

  v_encrypted := decode(replace(v_token_hex, '\x', ''), 'hex');

  INSERT INTO organization_renter_channel (
    organization_id, encrypted_bot_token, telegram_bot_id, bot_username,
    bot_token_last4, app_short_name, webhook_token, webhook_secret, updated_at
  )
  VALUES (
    v_org, v_encrypted, v_bot_id, v_username, v_last4, v_app, v_wh_token, v_wh_secret, now()
  )
  ON CONFLICT (organization_id) DO UPDATE SET
    encrypted_bot_token = EXCLUDED.encrypted_bot_token,
    telegram_bot_id = EXCLUDED.telegram_bot_id,
    bot_username = EXCLUDED.bot_username,
    bot_token_last4 = EXCLUDED.bot_token_last4,
    app_short_name = COALESCE(EXCLUDED.app_short_name, organization_renter_channel.app_short_name),
    webhook_token = EXCLUDED.webhook_token,
    webhook_secret = EXCLUDED.webhook_secret,
    updated_at = now();

  RETURN jsonb_build_object(
    'success', true,
    'token_last4', v_last4,
    'bot_username', v_username,
    'miniapp_url', _renter_miniapp_direct_link(v_org)
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.channel.botTaken');
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION restore_organization_renter_bot(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_token_hex text;
BEGIN
  v_org := NULLIF(p_payload ->> 'organization_id', '')::uuid;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.channel.botPayloadInvalid');
  END IF;

  v_token_hex := NULLIF(trim(COALESCE(p_payload ->> 'encrypted_bot_token_hex', '')), '');

  IF v_token_hex IS NULL THEN
    UPDATE organization_renter_channel
    SET
      encrypted_bot_token = NULL,
      telegram_bot_id = NULL,
      bot_username = NULL,
      bot_token_last4 = NULL,
      webhook_token = NULL,
      webhook_secret = NULL,
      updated_at = now()
    WHERE organization_id = v_org;
  ELSE
    UPDATE organization_renter_channel
    SET
      encrypted_bot_token = decode(replace(v_token_hex, '\x', ''), 'hex'),
      telegram_bot_id = NULLIF(p_payload ->> 'telegram_bot_id', '')::bigint,
      bot_username = NULLIF(p_payload ->> 'bot_username', ''),
      bot_token_last4 = NULLIF(p_payload ->> 'bot_token_last4', ''),
      webhook_token = NULLIF(p_payload ->> 'webhook_token', ''),
      webhook_secret = NULLIF(p_payload ->> 'webhook_secret', ''),
      updated_at = now()
    WHERE organization_id = v_org;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION get_organization_renter_bot_internal(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row organization_renter_channel%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM organization_renter_channel WHERE organization_id = p_org;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'exists', false);
  END IF;
  RETURN jsonb_build_object(
    'success', true,
    'exists', true,
    'telegram_bot_id', v_row.telegram_bot_id,
    'bot_username', v_row.bot_username,
    'bot_token_last4', v_row.bot_token_last4,
    'app_short_name', v_row.app_short_name,
    'webhook_token', v_row.webhook_token,
    'webhook_secret', v_row.webhook_secret,
    'encrypted_bot_token_hex', CASE
      WHEN v_row.encrypted_bot_token IS NULL THEN NULL
      ELSE encode(v_row.encrypted_bot_token, 'hex')
    END
  );
END;
$$;

CREATE OR REPLACE FUNCTION lookup_renter_channel_by_webhook_token(p_webhook_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row organization_renter_channel%ROWTYPE;
BEGIN
  IF NULLIF(trim(COALESCE(p_webhook_token, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false);
  END IF;

  SELECT * INTO v_row
  FROM organization_renter_channel
  WHERE webhook_token = p_webhook_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'organization_id', v_row.organization_id,
    'webhook_secret', v_row.webhook_secret,
    'telegram_bot_id', v_row.telegram_bot_id,
    'encrypted_bot_token_hex', CASE
      WHEN v_row.encrypted_bot_token IS NULL THEN NULL
      ELSE encode(v_row.encrypted_bot_token, 'hex')
    END
  );
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
    organization_id, telegram_id, bot_started_at, allows_write_to_pm, updated_at
  )
  VALUES (
    v_org,
    v_tg,
    CASE WHEN v_is_start THEN now() ELSE NULL END,
    CASE WHEN v_blocked THEN false ELSE COALESCE(v_allows, false) END,
    now()
  )
  ON CONFLICT (organization_id, telegram_id) DO UPDATE SET
    bot_started_at = CASE
      WHEN v_is_start THEN COALESCE(renter_telegram_dialog.bot_started_at, now())
      ELSE renter_telegram_dialog.bot_started_at
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
-- QR CRUD
-- =============================================================================

CREATE OR REPLACE FUNCTION create_organization_rental_qr_asset(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_id uuid;
  v_path text;
  v_mime text;
  v_size integer;
  v_width integer;
  v_height integer;
  v_label text;
  v_active boolean;
  v_member uuid;
BEGIN
  v_org := NULLIF(p_payload ->> 'organization_id', '')::uuid;
  v_id := COALESCE(NULLIF(p_payload ->> 'id', '')::uuid, gen_random_uuid());
  v_path := NULLIF(trim(COALESCE(p_payload ->> 'storage_path', '')), '');
  v_mime := NULLIF(trim(COALESCE(p_payload ->> 'mime_type', '')), '');
  v_size := COALESCE(NULLIF(p_payload ->> 'file_size', '')::integer, 0);
  v_width := NULLIF(p_payload ->> 'width', '')::integer;
  v_height := NULLIF(p_payload ->> 'height', '')::integer;
  v_label := NULLIF(trim(COALESCE(p_payload ->> 'label', '')), '');
  v_active := COALESCE((p_payload ->> 'is_active')::boolean, false);
  v_member := NULLIF(p_payload ->> 'created_by', '')::uuid;

  IF v_org IS NULL OR v_path IS NULL OR v_mime IS NULL OR v_size <= 0 THEN
    PERFORM _renter_raise('renter.qr.payloadInvalid');
  END IF;

  INSERT INTO organization_rental_qr_assets (
    id, organization_id, storage_path, mime_type, file_size, width, height, label, is_active, created_by
  )
  VALUES (v_id, v_org, v_path, v_mime, v_size, v_width, v_height, v_label, v_active, v_member);

  RETURN jsonb_build_object('success', true, 'id', v_id, 'storage_path', v_path);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  WHEN check_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.qr.mimeInvalid');
END;
$$;

CREATE OR REPLACE FUNCTION list_organization_rental_qr_assets()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid := auth_organization_id();
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;
  IF NOT can_manage_settings() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'label', a.label,
      'mime_type', a.mime_type,
      'is_active', a.is_active,
      'storage_path', a.storage_path,
      'signed_url', _renter_qr_signed_url(a.storage_path, 300),
      'created_at', a.created_at
    ) ORDER BY a.created_at DESC
  ), '[]'::jsonb)
  INTO v_rows
  FROM organization_rental_qr_assets a
  WHERE a.organization_id = v_org;

  RETURN jsonb_build_object('success', true, 'assets', v_rows, 'expires_in', 300);
END;
$$;

CREATE OR REPLACE FUNCTION update_organization_rental_qr_asset(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid := auth_organization_id();
  v_id uuid;
  v_old_path text;
  v_new_path text;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;
  IF NOT can_manage_settings() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  v_id := NULLIF(p_payload ->> 'id', '')::uuid;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.qr.payloadInvalid');
  END IF;

  SELECT storage_path INTO v_old_path
  FROM organization_rental_qr_assets
  WHERE id = v_id AND organization_id = v_org;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.qr.notFound');
  END IF;

  v_new_path := NULLIF(trim(COALESCE(p_payload ->> 'storage_path', '')), '');

  UPDATE organization_rental_qr_assets
  SET
    label = COALESCE(NULLIF(trim(COALESCE(p_payload ->> 'label', '')), ''), label),
    is_active = COALESCE((p_payload ->> 'is_active')::boolean, is_active),
    storage_path = COALESCE(v_new_path, storage_path),
    mime_type = COALESCE(NULLIF(p_payload ->> 'mime_type', ''), mime_type),
    file_size = COALESCE(NULLIF(p_payload ->> 'file_size', '')::integer, file_size),
    width = COALESCE(NULLIF(p_payload ->> 'width', '')::integer, width),
    height = COALESCE(NULLIF(p_payload ->> 'height', '')::integer, height)
  WHERE id = v_id AND organization_id = v_org;

  IF v_new_path IS NOT NULL AND v_old_path IS DISTINCT FROM v_new_path THEN
    IF NOT EXISTS (
      SELECT 1 FROM renter_topup_requests t
      WHERE t.qr_asset_id = v_id AND t.status = 'pending'
    ) THEN
      DELETE FROM storage.objects
      WHERE bucket_id = 'org-rental-qr' AND name = v_old_path;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION delete_organization_rental_qr_asset(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid := auth_organization_id();
  v_path text;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;
  IF NOT can_manage_settings() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  IF EXISTS (
    SELECT 1 FROM renter_topup_requests t
    WHERE t.qr_asset_id = p_id AND t.organization_id = v_org AND t.status = 'pending'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.qr.pendingRefs');
  END IF;

  SELECT storage_path INTO v_path
  FROM organization_rental_qr_assets
  WHERE id = p_id AND organization_id = v_org;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.qr.notFound');
  END IF;

  DELETE FROM organization_rental_qr_assets
  WHERE id = p_id AND organization_id = v_org;

  DELETE FROM storage.objects
  WHERE bucket_id = 'org-rental-qr' AND name = v_path;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- =============================================================================
-- Renter topup + list QR
-- =============================================================================

CREATE OR REPLACE FUNCTION renter_list_active_qr()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ctx record;
  v_rows jsonb;
BEGIN
  SELECT * INTO v_ctx FROM _renter_require_renter_ctx();
  IF NOT _renter_check_rpc_rate_limit(v_ctx.org_id, v_ctx.telegram_id) THEN
    PERFORM _renter_raise('renter.rateLimited');
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'label', a.label,
      'signed_url', _renter_qr_signed_url(a.storage_path, 300),
      'storage_path', a.storage_path
    ) ORDER BY a.created_at DESC
  ), '[]'::jsonb)
  INTO v_rows
  FROM organization_rental_qr_assets a
  WHERE a.organization_id = v_ctx.org_id
    AND a.is_active;

  RETURN jsonb_build_object('success', true, 'assets', v_rows, 'expires_in', 300);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION renter_submit_topup(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ctx record;
  v_amount numeric;
  v_method text;
  v_qr uuid;
  v_id uuid;
  v_currency text;
BEGIN
  SELECT * INTO v_ctx FROM _renter_require_renter_ctx();

  IF NOT _renter_check_rpc_rate_limit(v_ctx.org_id, v_ctx.telegram_id) THEN
    PERFORM _renter_raise('renter.rateLimited');
  END IF;

  IF NOT renter_miniapp_addon_is_active(v_ctx.org_id) THEN
    PERFORM _renter_raise('renter.addonInactive');
  END IF;
  IF NOT organization_allows_writes(v_ctx.org_id) THEN
    PERFORM _renter_raise('renter.writesDisabled');
  END IF;

  v_currency := _renter_org_currency(v_ctx.org_id);
  v_amount := _renter_round_money((p_payload ->> 'amount')::numeric, v_currency);
  v_method := NULLIF(trim(COALESCE(p_payload ->> 'method', '')), '');
  v_qr := NULLIF(p_payload ->> 'qr_asset_id', '')::uuid;

  IF v_method IS NULL OR v_method NOT IN ('qr', 'cash') THEN
    PERFORM _renter_raise('renter.topup.methodInvalid');
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    PERFORM _renter_raise('renter.topup.amountInvalid');
  END IF;
  IF v_amount > 1000000 THEN
    PERFORM _renter_raise('renter.topup.amountTooLarge');
  END IF;
  IF v_method = 'qr' THEN
    IF v_qr IS NULL OR NOT EXISTS (
      SELECT 1 FROM organization_rental_qr_assets a
      WHERE a.id = v_qr AND a.organization_id = v_ctx.org_id AND a.is_active
    ) THEN
      PERFORM _renter_raise('renter.topup.qrInvalid');
    END IF;
  ELSE
    v_qr := NULL;
  END IF;

  INSERT INTO renter_topup_requests (
    organization_id, renter_id, amount, method, qr_asset_id, status
  )
  VALUES (v_ctx.org_id, v_ctx.renter_id, v_amount, v_method, v_qr, 'pending')
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id, 'amount', v_amount);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.pendingExists');
  WHEN check_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.amountTooLarge');
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION list_renter_topup_inbox(
  p_status text DEFAULT 'pending',
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid := auth_organization_id();
  v_limit integer;
  v_offset integer;
  v_status text;
  v_total integer;
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;
  IF NOT member_can_record_rental_payment() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);
  v_status := COALESCE(NULLIF(trim(p_status), ''), 'pending');
  IF v_status NOT IN ('pending', 'confirmed', 'rejected', 'all') THEN
    v_status := 'pending';
  END IF;

  SELECT count(*)
  INTO v_total
  FROM renter_topup_requests t
  WHERE t.organization_id = v_org
    AND (v_status = 'all' OR t.status = v_status);

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', x.id,
      'renter_id', x.renter_id,
      'renter_name', x.display_name,
      'amount', x.amount,
      'method', x.method,
      'status', x.status,
      'amount_fact', x.amount_fact,
      'qr_asset_id', x.qr_asset_id,
      'qr_signed_url', x.qr_signed_url,
      'created_at', x.created_at,
      'resolved_at', x.resolved_at
    ) ORDER BY x.created_at DESC
  ), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      t.id,
      t.renter_id,
      r.display_name,
      t.amount,
      t.method,
      t.status,
      t.amount_fact,
      t.qr_asset_id,
      CASE
        WHEN t.qr_asset_id IS NOT NULL THEN _renter_qr_signed_url(a.storage_path, 300)
        ELSE NULL
      END AS qr_signed_url,
      t.created_at,
      t.resolved_at
    FROM renter_topup_requests t
    JOIN renters r ON r.id = t.renter_id AND r.organization_id = t.organization_id
    LEFT JOIN organization_rental_qr_assets a
      ON a.id = t.qr_asset_id AND a.organization_id = t.organization_id
    WHERE t.organization_id = v_org
      AND (v_status = 'all' OR t.status = v_status)
    ORDER BY t.created_at DESC
    LIMIT v_limit OFFSET v_offset
  ) x;

  RETURN jsonb_build_object(
    'success', true,
    'items', v_rows,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
END;
$$;

CREATE OR REPLACE FUNCTION resolve_renter_topup(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid := auth_organization_id();
  v_member uuid := auth_member_id();
  v_id uuid;
  v_action text;
  v_fact numeric;
  v_key uuid;
  v_fp text;
  v_cached jsonb;
  v_row renter_topup_requests%ROWTYPE;
  v_updated renter_topup_requests%ROWTYPE;
  v_currency text;
  v_today date;
  v_advance uuid;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;
  IF NOT member_can_record_rental_payment() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  v_id := NULLIF(p_payload ->> 'id', '')::uuid;
  v_action := NULLIF(trim(COALESCE(p_payload ->> 'action', '')), '');
  v_key := NULLIF(p_payload ->> 'idempotency_key', '')::uuid;
  v_currency := _renter_org_currency(v_org);
  v_fact := CASE
    WHEN p_payload ->> 'amount_fact' IS NULL OR trim(p_payload ->> 'amount_fact') = '' THEN NULL
    ELSE _renter_round_money((p_payload ->> 'amount_fact')::numeric, v_currency)
  END;

  IF v_id IS NULL OR v_action NOT IN ('confirm', 'reject') THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.resolveInvalid');
  END IF;

  -- Client operation_date is ignored (HALL-RENT-9). Fingerprint uses action + fact.
  v_fp := md5(v_id::text || ':' || v_action || ':' || COALESCE(v_fact::text, ''));
  v_cached := check_operation_idempotency(v_org, 'resolve_renter_topup', v_key, v_fp);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  SELECT * INTO v_row
  FROM renter_topup_requests
  WHERE id = v_id AND organization_id = v_org;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.notFound');
  END IF;

  v_today := _org_local_date(v_org);
  IF v_action = 'confirm' THEN
    IF _is_finance_period_closed(v_org, v_today) THEN
      RETURN jsonb_build_object('success', false, 'error', 'finance.error.periodClosed');
    END IF;
    IF NOT organization_allows_writes(v_org) THEN
      RETURN jsonb_build_object('success', false, 'error', 'renter.writesDisabled');
    END IF;
  END IF;

  PERFORM _renter_acquire_miniapp_locks(v_org, v_row.renter_id, '[]'::jsonb);

  IF v_action = 'reject' THEN
    UPDATE renter_topup_requests
    SET status = 'rejected', resolved_by = v_member, resolved_at = now()
    WHERE id = v_id AND organization_id = v_org AND status = 'pending'
    RETURNING * INTO v_updated;

    IF NOT FOUND THEN
      v_result := jsonb_build_object('success', true, 'already_applied', true);
      PERFORM store_operation_idempotency(v_org, 'resolve_renter_topup', v_key, v_fp, v_result);
      RETURN v_result;
    END IF;

    v_result := jsonb_build_object('success', true, 'status', 'rejected', 'id', v_id);
    PERFORM store_operation_idempotency(v_org, 'resolve_renter_topup', v_key, v_fp, v_result);
    RETURN v_result;
  END IF;

  v_fact := COALESCE(v_fact, v_row.amount);
  IF v_fact <= 0 OR v_fact > 1000000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.amountInvalid');
  END IF;

  UPDATE renter_topup_requests
  SET
    status = 'confirmed',
    amount_fact = v_fact,
    resolved_by = v_member,
    resolved_at = now()
  WHERE id = v_id AND organization_id = v_org AND status = 'pending'
  RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    v_result := jsonb_build_object('success', true, 'already_applied', true);
    PERFORM store_operation_idempotency(v_org, 'resolve_renter_topup', v_key, v_fp, v_result);
    RETURN v_result;
  END IF;

  v_advance := _renter_credit_wallet_topup(
    v_org, v_row.renter_id, v_fact, v_row.method, v_member, v_id,
    'miniapp_topup_request'
  );

  v_result := jsonb_build_object(
    'success', true,
    'status', 'confirmed',
    'id', v_id,
    'amount', v_row.amount,
    'amount_fact', v_fact,
    'advance_id', v_advance
  );
  PERFORM store_operation_idempotency(v_org, 'resolve_renter_topup', v_key, v_fp, v_result);
  RETURN v_result;
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION staff_renter_wallet_topup(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid := auth_organization_id();
  v_member uuid := auth_member_id();
  v_renter uuid;
  v_amount numeric;
  v_method text;
  v_key uuid;
  v_fp text;
  v_cached jsonb;
  v_currency text;
  v_advance uuid;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;
  IF NOT member_can_record_rental_payment() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  v_renter := NULLIF(p_payload ->> 'renter_id', '')::uuid;
  v_currency := _renter_org_currency(v_org);
  v_amount := _renter_round_money((p_payload ->> 'amount')::numeric, v_currency);
  v_method := COALESCE(NULLIF(trim(p_payload ->> 'method'), ''), 'cash');
  v_key := NULLIF(p_payload ->> 'idempotency_key', '')::uuid;

  IF v_renter IS NULL OR v_amount IS NULL OR v_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.amountInvalid');
  END IF;
  IF v_amount > 1000000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.amountTooLarge');
  END IF;
  IF v_method NOT IN ('qr', 'cash') THEN
    v_method := 'cash';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM renters r WHERE r.id = v_renter AND r.organization_id = v_org
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.notFound');
  END IF;

  v_fp := md5(v_renter::text || ':' || v_amount::text || ':' || v_method);
  v_cached := check_operation_idempotency(v_org, 'staff_renter_wallet_topup', v_key, v_fp);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  PERFORM _renter_acquire_miniapp_locks(v_org, v_renter, '[]'::jsonb);

  v_advance := _renter_credit_wallet_topup(
    v_org, v_renter, v_amount, v_method, v_member, NULL, 'staff_wallet_topup'
  );

  v_result := jsonb_build_object(
    'success', true,
    'advance_id', v_advance,
    'amount', v_amount
  );
  PERFORM store_operation_idempotency(v_org, 'staff_renter_wallet_topup', v_key, v_fp, v_result);
  RETURN v_result;
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- =============================================================================
-- Patch renter_bootstrap (keep R1c fields + chat/dialog flags)
-- =============================================================================

CREATE OR REPLACE FUNCTION renter_bootstrap()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ctx record;
  v_name text;
  v_branding text;
  v_tz text;
  v_currency text;
  v_locale text;
  v_chat text;
  v_started timestamptz;
  v_allows boolean;
BEGIN
  SELECT * INTO v_ctx FROM _renter_require_renter_ctx();

  SELECT o.name, os.branding_name, os.timezone, os.currency_code, os.locale
  INTO v_name, v_branding, v_tz, v_currency, v_locale
  FROM organizations o
  JOIN organization_settings os ON os.organization_id = o.id
  WHERE o.id = v_ctx.org_id;

  SELECT c.telegram_chat_url
  INTO v_chat
  FROM organization_renter_channel c
  WHERE c.organization_id = v_ctx.org_id;

  IF v_chat IS NOT NULL AND NOT _renter_telegram_chat_url_ok(v_chat) THEN
    v_chat := NULL;
  END IF;

  SELECT d.bot_started_at, d.allows_write_to_pm
  INTO v_started, v_allows
  FROM renter_telegram_dialog d
  WHERE d.organization_id = v_ctx.org_id
    AND d.telegram_id = v_ctx.telegram_id;

  RETURN jsonb_build_object(
    'success', true,
    'studio_name', COALESCE(NULLIF(trim(v_branding), ''), v_name),
    'timezone', COALESCE(v_tz, 'UTC'),
    'currency_code', COALESCE(v_currency, 'RUB'),
    'locale', COALESCE(v_locale, 'ru'),
    'chat_url', v_chat,
    'addon_active', renter_miniapp_addon_is_active(v_ctx.org_id),
    'bot_started', v_started IS NOT NULL,
    'allows_write', COALESCE(v_allows, false)
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- =============================================================================
-- Patch get_renter_detail — staff wallet via this RPC, not renter_get_wallet
-- =============================================================================

CREATE OR REPLACE FUNCTION get_renter_detail(p_renter_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_renter renters%ROWTYPE;
  v_can_finance boolean;
  v_can_profile boolean;
  v_can_documents boolean;
  v_contacts jsonb;
  v_contracts jsonb;
  v_documents_list jsonb;
  v_communications jsonb;
  v_finance_summary jsonb;
  v_rental_counts jsonb;
  v_paid numeric;
  v_fixed numeric;
  v_debt numeric;
  v_wallet numeric;
  v_spendable numeric;
  v_reserved numeric;
  v_miniapp_debt numeric;
  v_wallet_entries jsonb;
  v_miniapp_debts jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;

  IF NOT member_can_read_renter_directory() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  SELECT * INTO v_renter
  FROM renters r
  WHERE r.id = p_renter_id AND r.organization_id = v_org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.notFound');
  END IF;

  v_can_finance := member_can_read_renter_finance();
  v_can_profile := member_can_read_renter_profile();
  v_can_documents := member_can_read_renter_documents();

  IF v_can_profile THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', rc.id,
      'full_name', rc.full_name,
      'role_title', rc.role_title,
      'phone', rc.phone,
      'email', rc.email,
      'telegram', rc.telegram,
      'is_primary', rc.is_primary,
      'notes', rc.notes
    ) ORDER BY rc.is_primary DESC, rc.full_name), '[]'::jsonb)
    INTO v_contacts
    FROM renter_contacts rc
    WHERE rc.organization_id = v_org_id AND rc.renter_id = p_renter_id;
  ELSE
    v_contacts := '[]'::jsonb;
  END IF;

  IF v_can_profile THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'contract_number', c.contract_number,
      'title', c.title,
      'contract_type', c.contract_type,
      'signed_at', c.signed_at,
      'valid_from', c.valid_from,
      'valid_to', c.valid_to,
      'status', c.status,
      'signatory_name', c.signatory_name,
      'location_ids', c.location_ids,
      'deposit_info', c.deposit_info
    ) ORDER BY c.valid_from DESC NULLS LAST, c.created_at DESC), '[]'::jsonb)
    INTO v_contracts
    FROM renter_contracts c
    WHERE c.organization_id = v_org_id AND c.renter_id = p_renter_id;
  ELSE
    v_contracts := '[]'::jsonb;
  END IF;

  IF v_can_documents THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', d.id,
      'contract_id', d.contract_id,
      'category', d.category,
      'display_name', d.display_name,
      'document_date', d.document_date,
      'valid_until', d.valid_until,
      'mime_type', d.mime_type,
      'file_size', d.file_size,
      'created_at', d.created_at
    ) ORDER BY d.created_at DESC), '[]'::jsonb)
    INTO v_documents_list
    FROM renter_documents d
    WHERE d.organization_id = v_org_id AND d.renter_id = p_renter_id;
  ELSE
    v_documents_list := '[]'::jsonb;
  END IF;

  IF v_can_profile THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', cm.id,
      'comm_type', cm.comm_type,
      'occurred_at', cm.occurred_at,
      'subject', cm.subject,
      'body', cm.body,
      'contact_id', cm.contact_id,
      'next_action_at', cm.next_action_at,
      'author_member_id', cm.author_member_id,
      'created_at', cm.created_at
    ) ORDER BY cm.occurred_at DESC), '[]'::jsonb)
    INTO v_communications
    FROM renter_communications cm
    WHERE cm.organization_id = v_org_id AND cm.renter_id = p_renter_id;
  ELSE
    v_communications := '[]'::jsonb;
  END IF;

  IF v_can_finance THEN
    SELECT COALESCE(sum(_rental_paid_total(r.id, r.organization_id)), 0)
    INTO v_paid
    FROM rentals r
    WHERE r.organization_id = v_org_id
      AND r.renter_id = p_renter_id
      AND r.booking_status = 'confirmed'
      AND r.channel = 'cashier';

    SELECT COALESCE(sum(_rental_effective_amount(r.fixed_amount, r.final_amount)), 0)
    INTO v_fixed
    FROM rentals r
    WHERE r.organization_id = v_org_id
      AND r.renter_id = p_renter_id
      AND r.booking_status = 'confirmed'
      AND r.channel = 'cashier';

    v_debt := _renter_debt_total(p_renter_id, v_org_id);
    v_wallet := _renter_wallet_balance(v_org_id, p_renter_id);
    v_spendable := _renter_wallet_spendable(v_org_id, p_renter_id);
    v_reserved := _renter_wallet_reserved_prepay(v_org_id, p_renter_id);
    v_miniapp_debt := _renter_wallet_debt_outstanding(v_org_id, p_renter_id);

    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'entry_type', e.entry_type,
        'amount', e.amount,
        'created_at', e.created_at
      ) ORDER BY e.created_at DESC
    ), '[]'::jsonb)
    INTO v_wallet_entries
    FROM (
      SELECT l.id, l.entry_type, l.amount, l.created_at
      FROM renter_wallet_ledger l
      WHERE l.organization_id = v_org_id AND l.renter_id = p_renter_id
      ORDER BY l.created_at DESC
      LIMIT 20
    ) e;

    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'rental_id', d.id,
        'rental_date', d.rental_date,
        'time_start', d.time_start,
        'time_end', d.time_end,
        'debt_amount', d.debt_amount,
        'location_id', d.location_id
      ) ORDER BY d.rental_date, d.time_start
    ), '[]'::jsonb)
    INTO v_miniapp_debts
    FROM rentals d
    WHERE d.organization_id = v_org_id
      AND d.renter_id = p_renter_id
      AND d.channel = 'miniapp'
      AND COALESCE(d.debt_amount, 0) > 0;

    v_finance_summary := jsonb_build_object(
      'fixed_total', v_fixed,
      'paid_total', v_paid,
      'debt_total', v_debt,
      'overpaid_total', GREATEST(COALESCE(v_paid, 0) - COALESCE(v_fixed, 0), 0),
      'wallet_balance', v_wallet,
      'spendable', v_spendable,
      'reserved_prepay', v_reserved,
      'miniapp_debt_total', v_miniapp_debt,
      'wallet_entries', v_wallet_entries,
      'miniapp_debts', v_miniapp_debts
    );
  ELSE
    v_finance_summary := NULL;
  END IF;

  SELECT jsonb_build_object(
    'completed', count(*) FILTER (WHERE r.rental_date < current_date AND r.booking_status = 'confirmed'),
    'upcoming', count(*) FILTER (WHERE r.rental_date >= current_date AND r.booking_status = 'confirmed'),
    'cancelled', count(*) FILTER (WHERE r.booking_status = 'cancelled')
  )
  INTO v_rental_counts
  FROM rentals r
  WHERE r.organization_id = v_org_id AND r.renter_id = p_renter_id;

  RETURN jsonb_build_object(
    'success', true,
    'renter', jsonb_build_object(
      'id', v_renter.id,
      'display_name', v_renter.display_name,
      'counterparty_type', CASE WHEN v_can_profile THEN v_renter.counterparty_type ELSE NULL END,
      'status', v_renter.status,
      'contact_phone', CASE WHEN v_can_profile THEN v_renter.contact_phone ELSE NULL END,
      'contact_email', CASE WHEN v_can_profile THEN v_renter.contact_email ELSE NULL END,
      'telegram_id', CASE
        WHEN v_can_profile AND v_renter.telegram_id IS NOT NULL THEN v_renter.telegram_id::text
        ELSE NULL
      END,
      'legal_name', CASE WHEN v_can_profile THEN v_renter.legal_name ELSE NULL END,
      'tax_id', CASE WHEN v_can_profile THEN v_renter.tax_id ELSE NULL END,
      'registration_number', CASE WHEN v_can_profile THEN v_renter.registration_number ELSE NULL END,
      'legal_address', CASE WHEN v_can_profile THEN v_renter.legal_address ELSE NULL END,
      'actual_address', CASE WHEN v_can_profile THEN v_renter.actual_address ELSE NULL END,
      'blocked_reason', CASE WHEN v_can_profile THEN v_renter.blocked_reason ELSE NULL END,
      'internal_notes', CASE WHEN v_can_profile THEN v_renter.internal_notes ELSE NULL END,
      'preferred_location_ids', CASE WHEN v_can_profile THEN v_renter.preferred_location_ids ELSE NULL END,
      'payment_due_days', CASE WHEN v_can_profile THEN v_renter.payment_due_days ELSE NULL END,
      'notes', CASE WHEN v_can_profile THEN v_renter.notes ELSE NULL END,
      'archived_at', v_renter.archived_at,
      'next_rental_date', _renter_next_rental_date(p_renter_id, v_org_id),
      'on_time_count', CASE WHEN v_can_finance THEN v_renter.on_time_count ELSE NULL END,
      'untimely_count', CASE WHEN v_can_finance THEN v_renter.untimely_count ELSE NULL END,
      'booking_banned_at', CASE WHEN v_can_finance THEN v_renter.booking_banned_at ELSE NULL END,
      'penalty_tariff_applied_at', CASE WHEN v_can_finance THEN v_renter.penalty_tariff_applied_at ELSE NULL END
    ),
    'contacts', v_contacts,
    'contracts', v_contracts,
    'documents', v_documents_list,
    'communications', v_communications,
    'finance', v_finance_summary,
    'rental_counts', v_rental_counts
  );
END;
$$;

-- =============================================================================
-- Grants
-- =============================================================================

REVOKE ALL ON FUNCTION _renter_telegram_chat_url_ok(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_miniapp_direct_link(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_b64url(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_qr_signed_url(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_wallet_insert_topup(uuid, uuid, numeric, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_credit_wallet_topup(uuid, uuid, numeric, text, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION commit_organization_renter_bot(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION restore_organization_renter_bot(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION lookup_renter_channel_by_webhook_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_organization_renter_bot_internal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION renter_telegram_webhook_ingest(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_organization_rental_qr_asset(jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION get_organization_renter_channel() FROM PUBLIC;
REVOKE ALL ON FUNCTION update_organization_renter_channel(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION list_organization_rental_qr_assets() FROM PUBLIC;
REVOKE ALL ON FUNCTION update_organization_rental_qr_asset(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION delete_organization_rental_qr_asset(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION renter_list_active_qr() FROM PUBLIC;
REVOKE ALL ON FUNCTION renter_submit_topup(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION list_renter_topup_inbox(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_renter_topup(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION staff_renter_wallet_topup(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION renter_bootstrap() FROM PUBLIC;
REVOKE ALL ON FUNCTION get_renter_detail(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION get_organization_renter_channel() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_organization_renter_channel(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION list_organization_rental_qr_assets() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_organization_rental_qr_asset(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION delete_organization_rental_qr_asset(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION renter_list_active_qr() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION renter_submit_topup(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION list_renter_topup_inbox(text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION resolve_renter_topup(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION staff_renter_wallet_topup(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION renter_bootstrap() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_renter_detail(uuid) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION commit_organization_renter_bot(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION restore_organization_renter_bot(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION lookup_renter_channel_by_webhook_token(text) TO service_role;
GRANT EXECUTE ON FUNCTION get_organization_renter_bot_internal(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION renter_telegram_webhook_ingest(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION create_organization_rental_qr_asset(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_miniapp_direct_link(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_telegram_chat_url_ok(text) TO service_role;

-- Tests run as postgres (superuser) and call ingest/commit/chat_url_ok directly.

COMMIT;
