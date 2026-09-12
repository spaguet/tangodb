-- S6 / 2.11.10: platform support tickets, submit RPC, dev console status, outbox enqueue.

CREATE TABLE IF NOT EXISTS platform_support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_request_id uuid NOT NULL UNIQUE,
  ticket_kind text NOT NULL,
  status text NOT NULL DEFAULT 'new',
  user_id uuid,
  email text,
  contact_telegram text,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  organization_name text,
  locale text,
  message text NOT NULL,
  page_path text NOT NULL,
  close_reason text,
  close_note text,
  closed_by_user_id uuid,
  opened_at timestamptz,
  opened_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CONSTRAINT platform_support_tickets_kind_chk
    CHECK (ticket_kind IN ('login_help', 'forgot_password', 'license_help', 'other')),
  CONSTRAINT platform_support_tickets_status_chk
    CHECK (status IN ('new', 'open', 'closed')),
  CONSTRAINT platform_support_tickets_message_len_chk
    CHECK (char_length(message) BETWEEN 1 AND 4000)
);

CREATE INDEX IF NOT EXISTS idx_platform_support_tickets_status_created
  ON platform_support_tickets (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_support_tickets_kind_created
  ON platform_support_tickets (ticket_kind, created_at DESC);

COMMENT ON TABLE platform_support_tickets IS
  'S6: user support tickets (login/forgot/license/header). Not purchase/org_created.';

ALTER TABLE platform_support_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform_support_tickets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE platform_support_tickets TO service_role;

CREATE OR REPLACE FUNCTION _platform_support_ticket_kind_page_ok(
  p_kind text,
  p_page_path text,
  p_authenticated boolean
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_path text := left(trim(COALESCE(p_page_path, '')), 200);
BEGIN
  IF p_kind = 'login_help' THEN
    RETURN v_path IN ('/login') AND NOT p_authenticated;
  END IF;
  IF p_kind = 'forgot_password' THEN
    RETURN v_path IN ('/auth/forgot-password') AND NOT p_authenticated;
  END IF;
  IF p_kind = 'license_help' THEN
    RETURN v_path IN ('/settings/license', '/license-required') AND p_authenticated;
  END IF;
  IF p_kind = 'other' THEN
    RETURN p_authenticated
      AND v_path ~ '^/[a-zA-Z0-9/_-]*$'
      AND char_length(v_path) BETWEEN 1 AND 120
      AND v_path NOT IN ('/login', '/auth/forgot-password');
  END IF;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION enqueue_platform_support_ticket_notifications(p_ticket_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_t platform_support_tickets%ROWTYPE;
  v_chat_id bigint;
  v_email_to text;
  v_kind_label text;
  v_contact text;
  v_header text;
  v_body text;
  v_telegram text;
  v_email_subject text;
  v_email_text text;
  v_payload jsonb;
  v_tg_status text;
  v_tg_error text;
  v_email_id uuid;
  v_tg_id uuid;
BEGIN
  IF p_ticket_id IS NULL THEN
    RAISE EXCEPTION 'ticket_id_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_t FROM platform_support_tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'support_ticket_not_found' USING ERRCODE = '22023';
  END IF;

  v_kind_label := CASE v_t.ticket_kind
    WHEN 'login_help' THEN 'login_help'
    WHEN 'forgot_password' THEN 'forgot_password'
    WHEN 'license_help' THEN 'license_help'
    ELSE 'other'
  END;

  SELECT telegram_chat_id INTO v_chat_id
  FROM platform_notification_settings
  WHERE id = 1;

  SELECT NULLIF(trim(config #>> '{contacts,email}'), '')
  INTO v_email_to
  FROM platform_payment_methods
  WHERE id = 1;

  v_contact := COALESCE(NULLIF(trim(v_t.email), ''), '—');
  IF NULLIF(trim(v_t.contact_telegram), '') IS NOT NULL THEN
    v_contact := v_contact || ' · ' || left(trim(v_t.contact_telegram), 40);
  END IF;

  v_header := format(
    E'[support] %s\nticket: %s\norg: %s\npath: %s\nконтакт: %s',
    v_kind_label,
    _platform_notification_short_id(v_t.id),
    COALESCE(_platform_notification_short_id(v_t.organization_id), '—'),
    left(_platform_notification_plain(v_t.page_path), 80),
    v_contact
  );

  v_body := left(_platform_notification_plain(v_t.message), GREATEST(4096 - char_length(v_header) - 8, 0));
  v_telegram := left(v_header || E'\n«' || v_body || E'»', 4096);

  v_email_subject := 'TangoDB: support — ' || v_kind_label;
  v_email_text := concat_ws(
    E'\n',
    'Новое обращение в поддержку.',
    '',
    'Ticket ID: ' || v_t.id::text,
    'Kind: ' || v_t.ticket_kind,
    'Status: ' || v_t.status,
    'Page: ' || v_t.page_path,
    'Locale: ' || COALESCE(v_t.locale, '—'),
    'Organization: ' || COALESCE(v_t.organization_name, '—')
      || CASE WHEN v_t.organization_id IS NOT NULL THEN ' (' || v_t.organization_id::text || ')' ELSE '' END,
    'Email: ' || COALESCE(v_t.email, '—'),
    'Telegram: ' || COALESCE(v_t.contact_telegram, '—'),
    '',
    'Сообщение:',
    _platform_notification_plain(v_t.message),
    '',
    'Dev Console → Inbox → Support.'
  );

  v_payload := _platform_notification_sanitize_payload(jsonb_build_object(
    'telegram_text', v_telegram,
    'email_subject', left(v_email_subject, 200),
    'email_text', left(v_email_text, 8000),
    'email_to', v_email_to,
    'ticket_id', v_t.id,
    'ticket_kind', v_t.ticket_kind,
    'org_id', v_t.organization_id,
    'org_name', left(COALESCE(v_t.organization_name, ''), 120),
    'page_path', left(v_t.page_path, 120)
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
    'support_ticket',
    'support_ticket',
    v_t.id,
    'support:' || v_t.id::text || ':email',
    v_payload,
    'pending',
    NULL
  );

  v_tg_id := enqueue_platform_notification(
    'telegram',
    'support_ticket',
    'support_ticket',
    v_t.id,
    'support:' || v_t.id::text || ':telegram',
    v_payload,
    v_tg_status,
    v_tg_error
  );

  RETURN jsonb_build_object(
    'ticket_id', v_t.id,
    'email_id', v_email_id,
    'telegram_id', v_tg_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION submit_platform_support_ticket(
  p_client_request_id uuid,
  p_ticket_kind text,
  p_email text,
  p_contact_telegram text,
  p_message text,
  p_page_path text,
  p_locale text,
  p_user_id uuid,
  p_organization_id uuid,
  p_organization_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_kind text := lower(trim(COALESCE(p_ticket_kind, '')));
  v_path text := left(trim(COALESCE(p_page_path, '')), 120);
  v_msg text := left(trim(COALESCE(p_message, '')), 4000);
  v_email text := left(lower(trim(COALESCE(p_email, ''))), 160);
  v_tg text := left(trim(COALESCE(p_contact_telegram, '')), 160);
  v_locale text := left(trim(COALESCE(p_locale, '')), 16);
  v_org_name text := left(trim(COALESCE(p_organization_name, '')), 200);
  v_auth boolean := p_user_id IS NOT NULL;
  v_ticket_id uuid;
  v_existing uuid;
BEGIN
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id_required' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_existing
  FROM platform_support_tickets
  WHERE client_request_id = p_client_request_id;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('accepted', true, 'duplicate', true, 'ticket_id', v_existing);
  END IF;

  IF v_kind NOT IN ('login_help', 'forgot_password', 'license_help', 'other') THEN
    RAISE EXCEPTION 'invalid_ticket_kind' USING ERRCODE = '22023';
  END IF;

  IF NOT _platform_support_ticket_kind_page_ok(v_kind, v_path, v_auth) THEN
    RAISE EXCEPTION 'kind_page_mismatch' USING ERRCODE = '22023';
  END IF;

  IF char_length(v_msg) < 3 THEN
    RAISE EXCEPTION 'message_too_short' USING ERRCODE = '22023';
  END IF;

  IF v_kind IN ('login_help', 'forgot_password') THEN
    IF v_email = '' OR position('@' in v_email) = 0 THEN
      RAISE EXCEPTION 'email_required' USING ERRCODE = '22023';
    END IF;
    IF p_user_id IS NOT NULL OR p_organization_id IS NOT NULL THEN
      RAISE EXCEPTION 'guest_fields_forbidden' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_user_id IS NULL OR p_organization_id IS NULL THEN
      RAISE EXCEPTION 'auth_context_required' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO platform_support_tickets (
    client_request_id,
    ticket_kind,
    status,
    user_id,
    email,
    contact_telegram,
    organization_id,
    organization_name,
    locale,
    message,
    page_path
  )
  VALUES (
    p_client_request_id,
    v_kind,
    'new',
    p_user_id,
    NULLIF(v_email, ''),
    NULLIF(v_tg, ''),
    p_organization_id,
    NULLIF(v_org_name, ''),
    NULLIF(v_locale, ''),
    v_msg,
    v_path
  )
  RETURNING id INTO v_ticket_id;

  PERFORM enqueue_platform_support_ticket_notifications(v_ticket_id);

  RETURN jsonb_build_object('accepted', true, 'duplicate', false, 'ticket_id', v_ticket_id);
END;
$$;

CREATE OR REPLACE FUNCTION dev_console_update_support_ticket(
  p_ticket_id uuid,
  p_actor_user_id uuid,
  p_status text,
  p_close_reason text,
  p_close_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_t platform_support_tickets%ROWTYPE;
  v_status text := lower(trim(COALESCE(p_status, '')));
  v_reason text := left(trim(COALESCE(p_close_reason, '')), 500);
  v_note text := left(trim(COALESCE(p_close_note, '')), 2000);
  v_now timestamptz := now();
BEGIN
  IF p_ticket_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'ticket_and_actor_required' USING ERRCODE = '22023';
  END IF;

  IF v_status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_t FROM platform_support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'support_ticket_not_found' USING ERRCODE = '22023';
  END IF;

  IF v_status = 'open' THEN
    IF v_t.status = 'closed' THEN
      RAISE EXCEPTION 'cannot_reopen' USING ERRCODE = '22023';
    END IF;
    UPDATE platform_support_tickets
    SET
      status = 'open',
      opened_at = COALESCE(opened_at, v_now),
      opened_by_user_id = COALESCE(opened_by_user_id, p_actor_user_id),
      updated_at = v_now
    WHERE id = p_ticket_id;
  ELSE
    IF v_reason = '' THEN
      RAISE EXCEPTION 'close_reason_required' USING ERRCODE = '22023';
    END IF;
    UPDATE platform_support_tickets
    SET
      status = 'closed',
      close_reason = v_reason,
      close_note = NULLIF(v_note, ''),
      closed_by_user_id = p_actor_user_id,
      closed_at = v_now,
      updated_at = v_now
    WHERE id = p_ticket_id;
  END IF;

  INSERT INTO platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  VALUES (
    p_actor_user_id,
    CASE WHEN v_status = 'closed' THEN 'support_ticket.closed' ELSE 'support_ticket.opened' END,
    'platform_support_ticket',
    p_ticket_id,
    jsonb_build_object(
      'previous_status', v_t.status,
      'new_status', v_status,
      'close_reason', CASE WHEN v_status = 'closed' THEN v_reason ELSE NULL END,
      'ticket_kind', v_t.ticket_kind
    )
  );

  RETURN jsonb_build_object('ok', true, 'ticket_id', p_ticket_id, 'status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION _platform_support_ticket_kind_page_ok(text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION enqueue_platform_support_ticket_notifications(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION submit_platform_support_ticket(
  uuid, text, text, text, text, text, text, uuid, uuid, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dev_console_update_support_ticket(uuid, uuid, text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION enqueue_platform_support_ticket_notifications(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION submit_platform_support_ticket(
  uuid, text, text, text, text, text, text, uuid, uuid, text
) TO service_role;
GRANT EXECUTE ON FUNCTION dev_console_update_support_ticket(uuid, uuid, text, text, text) TO service_role;

COMMENT ON FUNCTION submit_platform_support_ticket IS
  'S6: atomic ticket insert + outbox enqueue. Idempotent by client_request_id.';
COMMENT ON FUNCTION dev_console_update_support_ticket IS
  'S6: developer-only via Edge; close requires close_reason.';
