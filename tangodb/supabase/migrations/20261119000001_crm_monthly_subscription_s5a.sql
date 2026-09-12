-- S5a / 2.11.8: platform notification settings + outbox + worker RPCs.
-- Purchase submit enqueues email+telegram in the same transaction. No authenticated GRANT.
-- Token stays in Edge secret PLATFORM_TELEGRAM_BOT_TOKEN — never in these tables.

BEGIN;

-- =============================================================================
-- 1. Destination singleton (chat_id only; no bot token)
-- =============================================================================

CREATE TABLE IF NOT EXISTS platform_notification_settings (
  id                 smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  telegram_chat_id   bigint,
  title              text,
  updated_by         uuid,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_notification_settings_chat_id_chk
    CHECK (telegram_chat_id IS NULL OR telegram_chat_id <> 0)
);

COMMENT ON TABLE platform_notification_settings IS
  'S5a: singleton destination for platform outbound bot. Token is Edge secret, not stored here.';
COMMENT ON COLUMN platform_notification_settings.telegram_chat_id IS
  'Group chat_id < 0 or private chat_id > 0. Null = not configured.';

INSERT INTO platform_notification_settings (id, title)
VALUES (1, 'developer')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE platform_notification_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform_notification_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE platform_notification_settings TO service_role;

-- =============================================================================
-- 2. Outbox
-- =============================================================================

CREATE TABLE IF NOT EXISTS platform_notification_outbox (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel            text NOT NULL CHECK (channel IN ('email', 'telegram')),
  event_kind         text NOT NULL,
  source_type        text NOT NULL,
  source_id          uuid,
  dedupe_key         text NOT NULL,
  payload            jsonb NOT NULL DEFAULT '{}'::jsonb,
  status             text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'retry', 'blocked', 'sent', 'dead')),
  attempts           integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts       integer NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
  available_at       timestamptz NOT NULL DEFAULT now(),
  lease_owner        text,
  lease_until        timestamptz,
  claim_token        uuid,
  sent_at            timestamptz,
  last_error_code    text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_notification_outbox_payload_object_chk
    CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT platform_notification_outbox_channel_dedupe_key UNIQUE (channel, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_platform_notification_outbox_claim
  ON platform_notification_outbox (available_at, created_at)
  WHERE status IN ('pending', 'retry');

COMMENT ON TABLE platform_notification_outbox IS
  'S5a: platform email+Telegram outbox. HTTP send is Edge worker only.';

ALTER TABLE platform_notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform_notification_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE platform_notification_outbox TO service_role;

-- =============================================================================
-- 3. Helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION _platform_notification_plain(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT left(
    replace(replace(replace(COALESCE(p_text, ''), '<', '‹'), '>', '›'), '&', 'и'),
    4096
  );
$$;

CREATE OR REPLACE FUNCTION _platform_notification_short_id(p_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT left(replace(p_id::text, '-', ''), 8) || '…';
$$;

CREATE OR REPLACE FUNCTION _platform_notification_sanitize_payload(p_payload jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(p_payload, '{}'::jsonb)
    - ARRAY[
      'token', 'jwt', 'password', 'access_key', 'plaintext_key',
      'recovery_code', 'init_data', 'bot_token', 'authorization',
      'ip', 'user_agent'
    ];
$$;

-- =============================================================================
-- 4. Enqueue
-- =============================================================================

CREATE OR REPLACE FUNCTION enqueue_platform_notification(
  p_channel text,
  p_event_kind text,
  p_source_type text,
  p_source_id uuid,
  p_dedupe_key text,
  p_payload jsonb,
  p_status text DEFAULT 'pending',
  p_error_code text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_status text := COALESCE(NULLIF(trim(p_status), ''), 'pending');
BEGIN
  IF p_channel NOT IN ('email', 'telegram') THEN
    RAISE EXCEPTION 'invalid_channel' USING ERRCODE = '22023';
  END IF;
  IF p_event_kind IS NULL OR length(trim(p_event_kind)) = 0 THEN
    RAISE EXCEPTION 'event_kind_required' USING ERRCODE = '22023';
  END IF;
  IF p_source_type IS NULL OR length(trim(p_source_type)) = 0 THEN
    RAISE EXCEPTION 'source_type_required' USING ERRCODE = '22023';
  END IF;
  IF p_dedupe_key IS NULL OR length(trim(p_dedupe_key)) = 0 THEN
    RAISE EXCEPTION 'dedupe_key_required' USING ERRCODE = '22023';
  END IF;
  IF v_status NOT IN ('pending', 'blocked') THEN
    RAISE EXCEPTION 'invalid_enqueue_status' USING ERRCODE = '22023';
  END IF;

  INSERT INTO platform_notification_outbox (
    channel, event_kind, source_type, source_id, dedupe_key, payload,
    status, last_error_code
  )
  VALUES (
    p_channel,
    trim(p_event_kind),
    trim(p_source_type),
    p_source_id,
    trim(p_dedupe_key),
    _platform_notification_sanitize_payload(p_payload),
    v_status,
    CASE WHEN v_status = 'blocked' THEN COALESCE(p_error_code, 'config_missing') ELSE NULL END
  )
  ON CONFLICT (channel, dedupe_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id
    FROM platform_notification_outbox
    WHERE channel = p_channel AND dedupe_key = trim(p_dedupe_key);
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION enqueue_platform_purchase_request_notifications(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req platform_purchase_requests%ROWTYPE;
  v_quote_details text;
  v_chat_id bigint;
  v_email_to text;
  v_kind_label text;
  v_contact text;
  v_header text;
  v_comment text;
  v_telegram text;
  v_email_subject text;
  v_email_text text;
  v_payload jsonb;
  v_tg_status text;
  v_tg_error text;
  v_email_id uuid;
  v_tg_id uuid;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_req FROM platform_purchase_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'purchase_request_not_found' USING ERRCODE = '22023';
  END IF;

  SELECT telegram_chat_id INTO v_chat_id
  FROM platform_notification_settings
  WHERE id = 1;

  SELECT NULLIF(trim(config #>> '{contacts,email}'), '')
  INTO v_email_to
  FROM platform_payment_methods
  WHERE id = 1;

  IF v_req.quote_id IS NOT NULL THEN
    SELECT payment_details_snapshot INTO v_quote_details
    FROM platform_purchase_quotes
    WHERE id = v_req.quote_id;
  END IF;

  v_kind_label := CASE v_req.request_kind
    WHEN 'crm_subscription' THEN 'Месяц'
    ELSE 'Lifetime'
  END;

  v_contact := COALESCE(NULLIF(trim(v_req.contact_email), ''), '—');
  IF NULLIF(trim(v_req.contact_telegram), '') IS NOT NULL THEN
    v_contact := v_contact || ' · ' || left(trim(v_req.contact_telegram), 40);
  END IF;

  v_header := format(
    E'[purchase] %s · %s\norg: %s  request: %s\nожидаем: %s %s\nконтакт: %s',
    v_kind_label,
    left(_platform_notification_plain(v_req.organization_name), 80),
    _platform_notification_short_id(v_req.organization_id),
    _platform_notification_short_id(v_req.id),
    COALESCE(v_req.amount, '—'),
    COALESCE(v_req.currency, ''),
    v_contact
  );

  v_comment := left(
    _platform_notification_plain(v_req.payment_comment),
    GREATEST(4096 - char_length(v_header) - 8, 0)
  );
  v_telegram := left(v_header || E'\n«' || v_comment || E'»', 4096);

  v_email_subject := CASE v_req.request_kind
    WHEN 'crm_subscription' THEN
      'TangoDB: заявка на месячную подписку CRM — ' || COALESCE(v_req.organization_name, '')
    ELSE
      'TangoDB: заявка на полную версию — ' || COALESCE(v_req.organization_name, '')
  END;

  v_email_text := concat_ws(
    E'\n',
    CASE v_req.request_kind
      WHEN 'crm_subscription' THEN 'Новая заявка на месячную подписку CRM.'
      ELSE 'Новая заявка на покупку полной версии TangoDB.'
    END,
    '',
    'Request ID: ' || v_req.id::text,
    'Kind: ' || v_req.request_kind,
    'Quote ID: ' || COALESCE(v_req.quote_id::text, ''),
    'Method: ' || COALESCE(v_req.method_code, ''),
    'Amount: ' || COALESCE(v_req.amount, '') || ' ' || COALESCE(v_req.currency, ''),
    'Pricing revision: ' || COALESCE(v_req.pricing_revision::text, ''),
    'Organization: ' || COALESCE(v_req.organization_name, '') || ' (' || v_req.organization_id::text || ')',
    'Requester email: ' || COALESCE(v_req.requester_email, 'not provided'),
    'Contact email: ' || COALESCE(v_req.contact_email, v_req.requester_email, 'not provided'),
    'Telegram: ' || COALESCE(v_req.contact_telegram, 'not provided'),
    '',
    'Payment details (quote snapshot):',
    COALESCE(v_quote_details, ''),
    '',
    'Комментарий пользователя:',
    _platform_notification_plain(v_req.payment_comment),
    '',
    'Проверьте поступление средств и активируйте доступ в Dev Console → Inbox.'
  );

  v_payload := _platform_notification_sanitize_payload(jsonb_build_object(
    'telegram_text', v_telegram,
    'email_subject', left(v_email_subject, 200),
    'email_text', left(v_email_text, 8000),
    'email_to', v_email_to,
    'org_id', v_req.organization_id,
    'org_name', left(v_req.organization_name, 120),
    'request_id', v_req.id,
    'request_kind', v_req.request_kind,
    'amount', v_req.amount,
    'currency', v_req.currency,
    'method_code', v_req.method_code,
    'contact_email', v_req.contact_email,
    'contact_telegram', left(COALESCE(v_req.contact_telegram, ''), 40)
  ));

  IF v_chat_id IS NULL THEN
    v_tg_status := 'blocked';
    v_tg_error := 'config_missing';
  ELSE
    v_tg_status := 'pending';
    v_tg_error := NULL;
  END IF;

  v_email_id := enqueue_platform_notification(
    'email',
    'purchase_request',
    'platform_purchase_request',
    v_req.id,
    'purchase:' || v_req.id::text || ':email',
    v_payload,
    'pending',
    NULL
  );

  v_tg_id := enqueue_platform_notification(
    'telegram',
    'purchase_request',
    'platform_purchase_request',
    v_req.id,
    'purchase:' || v_req.id::text || ':telegram',
    v_payload,
    v_tg_status,
    v_tg_error
  );

  RETURN jsonb_build_object(
    'ok', true,
    'email_id', v_email_id,
    'telegram_id', v_tg_id,
    'telegram_status', v_tg_status
  );
END;
$$;

-- =============================================================================
-- 5. Claim / complete / requeue
-- =============================================================================

CREATE OR REPLACE FUNCTION claim_platform_notification_outbox(
  p_batch_size integer DEFAULT 10,
  p_worker_id text DEFAULT 'worker',
  p_lease_seconds integer DEFAULT 120
)
RETURNS SETOF platform_notification_outbox
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

  UPDATE platform_notification_outbox o
  SET
    status = 'retry',
    lease_owner = NULL,
    lease_until = NULL,
    claim_token = NULL,
    available_at = now()
  WHERE o.status = 'processing'
    AND o.lease_until IS NOT NULL
    AND o.lease_until < now();

  RETURN QUERY
  WITH candidates AS (
    SELECT o.id
    FROM platform_notification_outbox o
    WHERE o.status IN ('pending', 'retry')
      AND o.available_at <= now()
    ORDER BY o.available_at ASC, o.created_at ASC
    LIMIT p_batch_size
    FOR UPDATE OF o SKIP LOCKED
  )
  UPDATE platform_notification_outbox o
  SET
    status = 'processing',
    lease_owner = p_worker_id,
    lease_until = now() + make_interval(secs => COALESCE(p_lease_seconds, 120)),
    claim_token = gen_random_uuid()
  FROM candidates c
  WHERE o.id = c.id
  RETURNING o.*;
END;
$$;

CREATE OR REPLACE FUNCTION complete_platform_notification_outbox(
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
  v_row platform_notification_outbox%ROWTYPE;
  v_delay integer;
BEGIN
  SELECT * INTO v_row FROM platform_notification_outbox WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_row.status IN ('sent', 'dead') THEN
    RETURN;
  END IF;

  IF v_row.status = 'processing' THEN
    IF p_claim_token IS NULL OR v_row.claim_token IS DISTINCT FROM p_claim_token THEN
      RETURN;
    END IF;
  END IF;

  IF p_outcome = 'sent' THEN
    UPDATE platform_notification_outbox
    SET
      status = 'sent',
      sent_at = now(),
      lease_owner = NULL,
      lease_until = NULL,
      claim_token = NULL,
      last_error_code = NULL
    WHERE id = p_id;
    RETURN;
  END IF;

  IF p_outcome = 'blocked' THEN
    UPDATE platform_notification_outbox
    SET
      status = 'blocked',
      lease_owner = NULL,
      lease_until = NULL,
      claim_token = NULL,
      last_error_code = COALESCE(p_error_code, 'blocked')
    WHERE id = p_id;
    RETURN;
  END IF;

  IF p_outcome = 'dead' THEN
    UPDATE platform_notification_outbox
    SET
      status = 'dead',
      lease_owner = NULL,
      lease_until = NULL,
      claim_token = NULL,
      last_error_code = COALESCE(p_error_code, 'dead')
    WHERE id = p_id;
    RETURN;
  END IF;

  -- retry (channel failure): burn an attempt; exhausted → dead
  v_delay := GREATEST(COALESCE(p_retry_seconds, 60), 15);
  UPDATE platform_notification_outbox
  SET
    status = CASE WHEN attempts + 1 >= max_attempts THEN 'dead' ELSE 'retry' END,
    attempts = attempts + 1,
    lease_owner = NULL,
    lease_until = NULL,
    claim_token = NULL,
    last_error_code = p_error_code,
    available_at = now() + make_interval(secs => v_delay)
  WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION requeue_blocked_platform_notification(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n int;
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'id_required' USING ERRCODE = '22023';
  END IF;

  UPDATE platform_notification_outbox
  SET
    status = 'pending',
    available_at = now(),
    lease_owner = NULL,
    lease_until = NULL,
    claim_token = NULL,
    last_error_code = NULL
  WHERE id = p_id
    AND status = 'blocked';

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$$;

-- =============================================================================
-- 6. Patch submit_platform_purchase_request — enqueue in the same TX
-- =============================================================================

CREATE OR REPLACE FUNCTION submit_platform_purchase_request(
  p_quote_id uuid,
  p_client_request_id uuid,
  p_organization_id uuid,
  p_requester_user_id uuid,
  p_requester_email text,
  p_organization_name text,
  p_contact_email text,
  p_contact_telegram text,
  p_payment_comment text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_existing platform_purchase_requests%ROWTYPE;
  v_quote platform_purchase_quotes%ROWTYPE;
  v_org organizations%ROWTYPE;
  v_kind text;
  v_now timestamptz := now();
  v_request_id uuid;
BEGIN
  IF p_quote_id IS NULL OR p_client_request_id IS NULL OR p_organization_id IS NULL
     OR p_requester_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_submit_payload' USING ERRCODE = '22023';
  END IF;

  IF p_payment_comment IS NULL OR length(trim(p_payment_comment)) = 0 THEN
    RAISE EXCEPTION 'payment_comment_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM platform_purchase_requests
  WHERE requester_user_id = p_requester_user_id
    AND client_request_id = p_client_request_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'request_id', v_existing.id,
      'status', v_existing.status
    );
  END IF;

  SELECT * INTO v_org
  FROM organizations
  WHERE id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_not_found' USING ERRCODE = '22023';
  END IF;

  IF v_org.data_purge_at IS NOT NULL AND v_now >= v_org.data_purge_at THEN
    RAISE EXCEPTION 'demo_purge_deadline_passed' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_quote
  FROM platform_purchase_quotes
  WHERE id = p_quote_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote_not_found' USING ERRCODE = '22023';
  END IF;

  IF v_quote.organization_id IS DISTINCT FROM p_organization_id
     OR v_quote.requester_user_id IS DISTINCT FROM p_requester_user_id THEN
    RAISE EXCEPTION 'quote_forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_quote.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'quote_already_consumed' USING ERRCODE = '22023';
  END IF;

  IF v_quote.expires_at <= v_now THEN
    RAISE EXCEPTION 'quote_expired' USING ERRCODE = '22023';
  END IF;

  v_kind := CASE v_quote.sku
    WHEN 'crm_license' THEN 'crm_license'
    WHEN 'crm_subscription' THEN 'crm_subscription'
    ELSE NULL
  END;

  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'invalid_quote_sku' USING ERRCODE = '22023';
  END IF;

  IF v_kind = 'crm_subscription' AND organization_has_lifetime_license(p_organization_id) THEN
    RAISE EXCEPTION 'lifetime_org_monthly_forbidden' USING ERRCODE = '22023';
  END IF;

  UPDATE platform_purchase_quotes
  SET consumed_at = v_now
  WHERE id = p_quote_id
    AND consumed_at IS NULL;

  INSERT INTO platform_purchase_requests (
    organization_id,
    requester_user_id,
    requester_email,
    organization_name,
    contact_email,
    contact_telegram,
    payment_comment,
    request_kind,
    quote_id,
    client_request_id,
    method_code,
    amount,
    currency,
    pricing_revision,
    payment_details_fingerprint,
    status
  )
  VALUES (
    p_organization_id,
    p_requester_user_id,
    NULLIF(trim(p_requester_email), ''),
    COALESCE(NULLIF(trim(p_organization_name), ''), v_org.name),
    NULLIF(trim(p_contact_email), ''),
    NULLIF(trim(p_contact_telegram), ''),
    trim(p_payment_comment),
    v_kind,
    p_quote_id,
    p_client_request_id,
    v_quote.method_code,
    v_quote.amount,
    v_quote.currency,
    v_quote.pricing_revision,
    v_quote.qr_sha256,
    'new'
  )
  RETURNING id INTO v_request_id;

  IF v_org.status IN ('demo_active', 'demo_retention')
     AND v_org.data_purge_at IS NOT NULL
     AND v_now < v_org.data_purge_at
     AND v_org.purchase_review_hold_until IS NULL THEN
    UPDATE organizations
    SET purchase_review_hold_until = v_org.data_purge_at + interval '72 hours'
    WHERE id = p_organization_id;
  END IF;

  PERFORM enqueue_platform_purchase_request_notifications(v_request_id);

  RETURN jsonb_build_object(
    'ok', true,
    'request_id', v_request_id,
    'request_kind', v_kind
  );
END;
$$;

REVOKE ALL ON FUNCTION enqueue_platform_notification(text, text, text, uuid, text, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION enqueue_platform_purchase_request_notifications(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_platform_notification_outbox(integer, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_platform_notification_outbox(uuid, text, text, integer, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION requeue_blocked_platform_notification(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION submit_platform_purchase_request(
  uuid, uuid, uuid, uuid, text, text, text, text, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION enqueue_platform_notification(text, text, text, uuid, text, jsonb, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION enqueue_platform_purchase_request_notifications(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION claim_platform_notification_outbox(integer, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION complete_platform_notification_outbox(uuid, text, text, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION requeue_blocked_platform_notification(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION submit_platform_purchase_request(
  uuid, uuid, uuid, uuid, text, text, text, text, text
) TO service_role;

COMMIT;
