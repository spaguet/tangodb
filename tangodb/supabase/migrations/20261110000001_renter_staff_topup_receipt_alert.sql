-- HALL-RENT-TOPUP-2: staff duplicate alert in receipt chat; renter telegram_username;
-- group/private receipt chat_id bind. Staff enqueue must not fail renter_submit_topup.

BEGIN;

-- =============================================================================
-- 1. Schema
-- =============================================================================

ALTER TABLE renters
  ADD COLUMN IF NOT EXISTS telegram_username text;

ALTER TABLE renters
  DROP CONSTRAINT IF EXISTS renters_telegram_username_check;

ALTER TABLE renters
  ADD CONSTRAINT renters_telegram_username_check
  CHECK (
    telegram_username IS NULL
    OR telegram_username ~ '^[A-Za-z0-9_]{5,32}$'
  );

COMMENT ON COLUMN renters.telegram_username IS
  'Telegram @username without @. Updated from Mini App initData on mint; may be null.';

ALTER TABLE organization_renter_channel
  ADD COLUMN IF NOT EXISTS telegram_receipt_chat_id bigint;

ALTER TABLE organization_renter_channel
  ADD COLUMN IF NOT EXISTS telegram_receipt_chat_bound_at timestamptz;

ALTER TABLE organization_renter_channel
  DROP CONSTRAINT IF EXISTS organization_renter_channel_receipt_chat_id_check;

ALTER TABLE organization_renter_channel
  ADD CONSTRAINT organization_renter_channel_receipt_chat_id_check
  CHECK (telegram_receipt_chat_id IS NULL OR telegram_receipt_chat_id <> 0);

COMMENT ON COLUMN organization_renter_channel.telegram_receipt_chat_id IS
  'Bot API chat_id for staff top-up alerts. Negative for groups/supergroups.';

ALTER TABLE renter_telegram_outbox
  DROP CONSTRAINT IF EXISTS renter_telegram_outbox_telegram_id_check;

ALTER TABLE renter_telegram_outbox
  ADD CONSTRAINT renter_telegram_outbox_telegram_id_check
  CHECK (
    telegram_id <> 0
    AND (
      telegram_id > 0
      OR event_type LIKE 'staff_%'
    )
  );

-- =============================================================================
-- 2. URL / username helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_normalize_telegram_username(p_username text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v text;
BEGIN
  v := NULLIF(trim(COALESCE(p_username, '')), '');
  IF v IS NULL THEN
    RETURN NULL;
  END IF;
  v := regexp_replace(v, '^@+', '');
  IF v ~ '^[A-Za-z0-9_]{5,32}$' THEN
    RETURN v;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_telegram_url_user_id(p_url text)
RETURNS bigint
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v text;
  v_id bigint;
BEGIN
  v := trim(COALESCE(p_url, ''));
  IF v !~* '^tg://user\?id=[0-9]+$' THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_id := (regexp_match(v, 'id=([0-9]+)$'))[1]::bigint;
  EXCEPTION WHEN invalid_text_representation OR data_exception THEN
    RETURN NULL;
  END;
  IF v_id IS NULL OR v_id <= 0 THEN
    RETURN NULL;
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_telegram_url_username(p_url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v text;
  v_user text;
BEGIN
  v := trim(COALESCE(p_url, ''));
  IF v ~* '^https://t\.me/[A-Za-z0-9_]{5,32}/?$' THEN
    v_user := regexp_replace(v, '^https://t\.me/([A-Za-z0-9_]{5,32})/?$', '\1', 'i');
    RETURN _renter_normalize_telegram_username(v_user);
  END IF;
  IF v ~* '^tg://resolve\?domain=[A-Za-z0-9_]{5,32}$' THEN
    v_user := regexp_replace(v, '^tg://resolve\?domain=', '', 'i');
    RETURN _renter_normalize_telegram_username(v_user);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_telegram_url_is_invite(p_url text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT trim(COALESCE(p_url, '')) ~* '^https://t\.me/\+[A-Za-z0-9_-]+/?$'
      OR trim(COALESCE(p_url, '')) ~* '^https://t\.me/joinchat/[A-Za-z0-9_-]+/?$';
$$;

CREATE OR REPLACE FUNCTION _renter_receipt_notify_status(p_url text, p_chat_id bigint)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_chat_id IS NOT NULL AND p_chat_id <> 0 THEN
    RETURN 'bound';
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
  SELECT c.telegram_receipt_chat_id, c.telegram_chat_url
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

-- =============================================================================
-- 3. Staff outbox enqueue (negative chat_id allowed)
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_enqueue_staff_telegram(
  p_org_id uuid,
  p_renter_id uuid,
  p_chat_id bigint,
  p_event_type text,
  p_text text,
  p_dedupe_key text DEFAULT NULL,
  p_topup_request_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_plain text;
BEGIN
  IF p_event_type IS NULL OR p_event_type NOT LIKE 'staff_%' THEN
    RETURN NULL;
  END IF;
  IF NOT renter_miniapp_addon_is_active(p_org_id) THEN
    RETURN NULL;
  END IF;
  IF p_chat_id IS NULL OR p_chat_id = 0 THEN
    RETURN NULL;
  END IF;

  v_plain := _renter_telegram_plain(p_text);
  IF v_plain IS NULL OR v_plain = '' THEN
    RETURN NULL;
  END IF;

  BEGIN
    INSERT INTO renter_telegram_outbox (
      organization_id, renter_id, telegram_id, event_type, text,
      dedupe_key, topup_request_id
    )
    VALUES (
      p_org_id, p_renter_id, p_chat_id, p_event_type, v_plain,
      p_dedupe_key, p_topup_request_id
    )
    RETURNING id INTO v_id;
    RETURN v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_enqueue_staff_topup_submitted(
  p_org_id uuid,
  p_renter_id uuid,
  p_request_id uuid,
  p_amount numeric,
  p_method text,
  p_code text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_chat bigint;
  v_renter renters%ROWTYPE;
  v_currency text;
  v_handle text;
  v_method_label text;
  v_text text;
BEGIN
  v_chat := _renter_resolve_staff_alert_chat_id(p_org_id);
  IF v_chat IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_renter
  FROM renters r
  WHERE r.id = p_renter_id AND r.organization_id = p_org_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_currency := _renter_org_currency(p_org_id);
  v_handle := CASE
    WHEN v_renter.telegram_username IS NOT NULL THEN '@' || v_renter.telegram_username
    ELSE 'без username'
  END;
  v_method_label := CASE WHEN p_method = 'qr' THEN 'QR' ELSE 'наличные' END;

  v_text := format(
    E'Заявка на пополнение Mini App\n\nАрендатор: %s %s\nTelegram ID: %s\nСумма: %s\nСпособ: %s\nКод заявки: %s\n\nНужно обработать заявку в CRM:\nhttps://tangodb.vercel.app/finance/renter-topup',
    COALESCE(NULLIF(trim(v_renter.display_name), ''), 'Telegram user'),
    v_handle,
    COALESCE(v_renter.telegram_id::text, '—'),
    _renter_telegram_fmt_money(p_amount, v_currency),
    v_method_label,
    COALESCE(NULLIF(trim(p_code), ''), '—')
  );

  RETURN _renter_enqueue_staff_telegram(
    p_org_id,
    p_renter_id,
    v_chat,
    'staff_topup_submitted',
    v_text,
    'staff_topup_submitted:' || p_request_id::text,
    p_request_id
  );
END;
$$;

-- =============================================================================
-- 4. prepare_send — do not rebind staff chat_id to renter
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
  v_staff boolean;
BEGIN
  SELECT * INTO v_row FROM renter_telegram_outbox WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('action', 'skip', 'reason', 'not_found');
  END IF;

  v_staff := v_row.event_type LIKE 'staff_%';

  IF v_staff THEN
    v_current := v_row.telegram_id;
    IF v_current IS NULL OR v_current = 0 THEN
      RETURN jsonb_build_object('action', 'skip', 'reason', 'recipient_unbound');
    END IF;

    IF NOT renter_miniapp_addon_is_active(v_row.organization_id) THEN
      RETURN jsonb_build_object('action', 'skip', 'reason', 'addon_inactive');
    END IF;

    IF v_current < 0 THEN
      RETURN jsonb_build_object(
        'action', 'send',
        'telegram_id', v_current,
        'text', v_row.text,
        'include_miniapp_button', false
      );
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
      'text', v_row.text,
      'include_miniapp_button', false
    );
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
    'text', v_row.text,
    'include_miniapp_button', true
  );
END;
$$;

COMMENT ON FUNCTION renter_telegram_outbox_prepare_send(uuid) IS
  'Resolve renter telegram_id at drain; staff_* keeps stored chat_id (may be negative).';

-- =============================================================================
-- 5. Channel get/update + receipt bind
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
    'miniapp_url', _renter_miniapp_direct_link(v_org),
    'telegram_receipt_chat_id', v_row.telegram_receipt_chat_id,
    'telegram_receipt_chat_bound_at', v_row.telegram_receipt_chat_bound_at,
    'telegram_receipt_notify_status', _renter_receipt_notify_status(
      v_row.telegram_chat_url,
      v_row.telegram_receipt_chat_id
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
    updated_at = now();

  RETURN get_organization_renter_channel();
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
  v_url text;
  v_url_user text;
  v_url_id bigint;
  v_invite boolean;
  v_bound bigint;
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

  IF v_org IS NULL OR v_chat IS NULL OR v_chat = 0 OR v_action NOT IN ('bind', 'unbind') THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.webhook.badPayload');
  END IF;

  SELECT c.telegram_chat_url, c.telegram_receipt_chat_id
  INTO v_url, v_bound
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
    RETURN jsonb_build_object('success', true, 'bound', false, 'cleared', v_bound IS NOT DISTINCT FROM v_chat);
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
    ELSIF v_invite AND v_bound IS NULL THEN
      v_match := true;
    END IF;
  END IF;

  IF NOT v_match THEN
    RETURN jsonb_build_object('success', true, 'bound', false);
  END IF;

  UPDATE organization_renter_channel
  SET telegram_receipt_chat_id = v_chat,
      telegram_receipt_chat_bound_at = COALESCE(telegram_receipt_chat_bound_at, now()),
      updated_at = now()
  WHERE organization_id = v_org;

  RETURN jsonb_build_object('success', true, 'bound', true, 'chat_id', v_chat);
END;
$$;

-- =============================================================================
-- 6. renter_submit_topup — best-effort staff alert after INSERT
-- =============================================================================

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
  v_code text;
  v_chat text;
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
  IF v_amount > _renter_topup_amount_max(v_currency) THEN
    PERFORM _renter_raise('renter.topup.amountTooLarge');
  END IF;
  IF v_method = 'qr' THEN
    SELECT c.telegram_chat_url
    INTO v_chat
    FROM organization_renter_channel c
    WHERE c.organization_id = v_ctx.org_id;

    IF v_chat IS NULL OR NOT _renter_telegram_chat_url_ok(v_chat) THEN
      PERFORM _renter_raise('renter.topup.chatRequired');
    END IF;

    IF v_qr IS NULL OR NOT EXISTS (
      SELECT 1 FROM organization_rental_qr_assets a
      WHERE a.id = v_qr AND a.organization_id = v_ctx.org_id AND a.is_active
    ) THEN
      PERFORM _renter_raise('renter.topup.qrInvalid');
    END IF;
  ELSE
    v_qr := NULL;
  END IF;

  v_code := _renter_allocate_topup_correlation_code(v_ctx.org_id);

  INSERT INTO renter_topup_requests (
    organization_id, renter_id, amount, method, qr_asset_id, status, correlation_code
  )
  VALUES (v_ctx.org_id, v_ctx.renter_id, v_amount, v_method, v_qr, 'pending', v_code)
  RETURNING id INTO v_id;

  PERFORM _renter_enqueue_topup_created(v_ctx.org_id, v_ctx.renter_id, v_id, v_amount);

  BEGIN
    PERFORM _renter_enqueue_staff_topup_submitted(
      v_ctx.org_id, v_ctx.renter_id, v_id, v_amount, v_method, v_code
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_id,
    'amount', v_amount,
    'correlation_code', v_code
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.pendingExists');
  WHEN check_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.amountTooLarge');
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- =============================================================================
-- 7. Mint — persist telegram_username, never clobber display_name
-- =============================================================================

CREATE OR REPLACE FUNCTION renter_telegram_mint_prepare(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_telegram bigint;
  v_display_name text;
  v_username text;
  v_init_hash text;
  v_allows_write boolean;
  v_renter_id uuid;
  v_auth_user_id uuid;
  v_status text;
  v_existed boolean := false;
  v_addon_active boolean;
  v_hash_row renter_init_data_hashes%ROWTYPE;
BEGIN
  v_org := NULLIF(p_payload ->> 'organization_id', '')::uuid;
  BEGIN
    v_telegram := NULLIF(p_payload ->> 'telegram_id', '')::bigint;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.auth.forbidden');
  END;
  v_display_name := left(
    regexp_replace(
      trim(COALESCE(p_payload ->> 'display_name', '')),
      '[[:cntrl:]]',
      '',
      'g'
    ),
    80
  );
  v_username := _renter_normalize_telegram_username(p_payload ->> 'telegram_username');
  v_init_hash := NULLIF(trim(COALESCE(p_payload ->> 'init_data_hash', '')), '');
  v_allows_write := COALESCE((p_payload ->> 'allows_write_to_pm')::boolean, false);

  IF v_org IS NULL OR v_telegram IS NULL OR v_telegram <= 0 OR v_init_hash IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.auth.forbidden');
  END IF;

  IF v_display_name = '' THEN
    v_display_name := 'Telegram user';
  END IF;

  PERFORM pg_advisory_xact_lock(_renter_mint_lock_key(v_org, v_telegram));

  SELECT *
  INTO v_hash_row
  FROM renter_init_data_hashes h
  WHERE h.init_data_hash = v_init_hash
    AND h.organization_id = v_org
    AND h.created_at > now() - interval '15 minutes';

  IF FOUND THEN
    IF NOT organization_allows_writes(v_org) THEN
      RETURN jsonb_build_object('success', false, 'error', 'renter.auth.forbidden');
    END IF;

    SELECT r.id, r.auth_user_id, r.status
    INTO v_renter_id, v_auth_user_id, v_status
    FROM renters r
    WHERE r.id = v_hash_row.renter_id
      AND r.organization_id = v_org
      AND r.telegram_id = v_telegram;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'renter.auth.forbidden');
    END IF;

    UPDATE renters
    SET telegram_username = v_username
    WHERE id = v_renter_id
      AND organization_id = v_org;

    RETURN jsonb_build_object(
      'success', true,
      'renter_id', v_renter_id,
      'auth_user_id', v_auth_user_id,
      'needs_create_user', v_auth_user_id IS NULL,
      'is_new_renter', false,
      'status', v_status,
      'idempotent', true
    );
  END IF;

  IF NOT organization_allows_writes(v_org) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.auth.forbidden');
  END IF;

  SELECT r.id, r.auth_user_id, r.status
  INTO v_renter_id, v_auth_user_id, v_status
  FROM renters r
  WHERE r.organization_id = v_org
    AND r.telegram_id = v_telegram;

  v_existed := FOUND;

  v_addon_active := renter_miniapp_addon_is_active(v_org);

  IF NOT v_existed AND NOT v_addon_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.auth.forbidden');
  END IF;

  IF NOT v_existed THEN
    INSERT INTO renters (
      organization_id,
      display_name,
      telegram_id,
      telegram_username,
      counterparty_type,
      status
    )
    VALUES (
      v_org,
      v_display_name,
      v_telegram,
      v_username,
      'individual',
      'active'
    )
    RETURNING id, auth_user_id, status
    INTO v_renter_id, v_auth_user_id, v_status;
  ELSE
    UPDATE renters
    SET telegram_username = v_username
    WHERE id = v_renter_id
      AND organization_id = v_org;
  END IF;

  IF v_allows_write THEN
    INSERT INTO renter_telegram_dialog (
      organization_id,
      telegram_id,
      allows_write_to_pm,
      updated_at
    )
    VALUES (v_org, v_telegram, true, now())
    ON CONFLICT (organization_id, telegram_id) DO UPDATE SET
      allows_write_to_pm = true,
      updated_at = now();
  END IF;

  INSERT INTO renter_init_data_hashes (
    init_data_hash,
    organization_id,
    telegram_id,
    auth_user_id,
    renter_id
  )
  VALUES (
    v_init_hash,
    v_org,
    v_telegram,
    v_auth_user_id,
    v_renter_id
  )
  ON CONFLICT (init_data_hash) DO UPDATE SET
    auth_user_id = EXCLUDED.auth_user_id,
    renter_id = EXCLUDED.renter_id,
    created_at = now();

  RETURN jsonb_build_object(
    'success', true,
    'renter_id', v_renter_id,
    'auth_user_id', v_auth_user_id,
    'needs_create_user', v_auth_user_id IS NULL,
    'is_new_renter', NOT v_existed,
    'status', v_status,
    'idempotent', false
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.auth.forbidden');
END;
$$;

-- =============================================================================
-- 8. get_renter_detail — telegram_id/username for profile OR finance readers
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
  v_can_telegram boolean;
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
  v_can_telegram := v_can_profile OR v_can_finance;

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
    v_wallet_entries := _renter_wallet_entries_detail_json(v_org_id, p_renter_id, 20);

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
        WHEN v_can_telegram AND v_renter.telegram_id IS NOT NULL THEN v_renter.telegram_id::text
        ELSE NULL
      END,
      'telegram_username', CASE
        WHEN v_can_telegram THEN v_renter.telegram_username
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
-- 9. Grants
-- =============================================================================

REVOKE ALL ON FUNCTION _renter_normalize_telegram_username(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_telegram_url_user_id(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_telegram_url_username(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_telegram_url_is_invite(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_receipt_notify_status(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_resolve_staff_alert_chat_id(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_enqueue_staff_telegram(uuid, uuid, bigint, text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_enqueue_staff_topup_submitted(uuid, uuid, uuid, numeric, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION renter_telegram_receipt_chat_ingest(jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION renter_telegram_receipt_chat_ingest(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION renter_telegram_outbox_prepare_send(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION get_organization_renter_channel() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_organization_renter_channel(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION renter_submit_topup(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION renter_telegram_mint_prepare(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION get_renter_detail(uuid) TO authenticated, service_role;

COMMIT;
