-- R4 / 2.9.9: renter_telegram_outbox, enqueue in phase helpers, claim/drain (Edge send).

BEGIN;

-- =============================================================================
-- 1. Outbox table
-- =============================================================================

CREATE TABLE IF NOT EXISTS renter_telegram_outbox (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  renter_id           uuid,
  telegram_id         bigint NOT NULL CHECK (telegram_id > 0),
  event_type          text NOT NULL,
  text                text NOT NULL CHECK (char_length(text) > 0 AND char_length(text) <= 4096),
  dedupe_key          text,
  rental_id           uuid,
  topup_request_id    uuid,
  status              text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'retry', 'dead', 'skipped')),
  attempts            integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts        integer NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
  available_at        timestamptz NOT NULL DEFAULT now(),
  locked_at           timestamptz,
  locked_by           text,
  last_error_code     text,
  sent_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_renter_telegram_outbox_claim
  ON renter_telegram_outbox (available_at, created_at)
  WHERE status IN ('pending', 'retry');

CREATE UNIQUE INDEX IF NOT EXISTS renter_telegram_outbox_dedupe_unique
  ON renter_telegram_outbox (organization_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL
    AND status NOT IN ('dead', 'skipped');

COMMENT ON TABLE renter_telegram_outbox IS
  'R4: Telegram sendMessage queue. RPC only enqueue; drain in renter-booking-worker Edge.';

ALTER TABLE renter_telegram_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE renter_telegram_outbox FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE renter_telegram_outbox TO service_role;

-- =============================================================================
-- 2. Text helpers (plain text, no parse_mode)
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_telegram_plain(p_text text)
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

CREATE OR REPLACE FUNCTION _renter_telegram_fmt_money(p_amount numeric, p_currency text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT trim(to_char(COALESCE(p_amount, 0), 'FM999999990.00')) || ' ' || COALESCE(p_currency, '');
$$;

CREATE OR REPLACE FUNCTION _renter_telegram_fmt_slot_line(p_rental_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r rentals%ROWTYPE;
  v_loc text;
BEGIN
  SELECT * INTO v_r FROM rentals WHERE id = p_rental_id;
  IF NOT FOUND THEN
    RETURN '';
  END IF;
  SELECT l.name INTO v_loc
  FROM locations l
  WHERE l.id = v_r.location_id;
  RETURN format(
    '%s %s–%s, %s',
    to_char(v_r.rental_date, 'DD.MM.YYYY'),
    v_r.time_start,
    v_r.time_end,
    COALESCE(v_loc, 'зал')
  );
END;
$$;

CREATE OR REPLACE FUNCTION _renter_telegram_fmt_hold_timer(p_hold_expires_at timestamptz)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_secs integer;
  v_h integer;
  v_m integer;
BEGIN
  IF p_hold_expires_at IS NULL THEN
    RETURN 'скоро';
  END IF;
  v_secs := GREATEST(0, floor(extract(epoch FROM (p_hold_expires_at - now())))::integer);
  v_h := v_secs / 3600;
  v_m := (v_secs % 3600) / 60;
  IF v_h > 0 THEN
    RETURN format('%s ч %s мин', v_h, v_m);
  END IF;
  RETURN format('%s мин', GREATEST(v_m, 1));
END;
$$;

-- =============================================================================
-- 3. Send gate + bot config (service_role only)
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
BEGIN
  IF NOT renter_miniapp_addon_is_active(p_org_id) THEN
    RETURN jsonb_build_object('can_send', false, 'skip_reason', 'addon_inactive');
  END IF;

  SELECT * INTO v_dialog
  FROM renter_telegram_dialog d
  WHERE d.organization_id = p_org_id
    AND d.telegram_id = p_telegram_id;

  IF v_dialog.bot_started_at IS NULL THEN
    RETURN jsonb_build_object('can_send', false, 'skip_reason', 'no_bot_started');
  END IF;

  IF v_dialog.allows_write_to_pm IS FALSE THEN
    RETURN jsonb_build_object('can_send', false, 'skip_reason', 'blocked');
  END IF;

  RETURN jsonb_build_object('can_send', true);
END;
$$;

CREATE OR REPLACE FUNCTION get_renter_telegram_bot_send_config(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row organization_renter_channel%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM organization_renter_channel WHERE organization_id = p_org_id;
  IF NOT FOUND OR v_row.encrypted_bot_token IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'encrypted_bot_token', encode(v_row.encrypted_bot_token, 'hex'),
    'miniapp_url', _renter_miniapp_direct_link(p_org_id)
  );
END;
$$;

-- =============================================================================
-- 4. Enqueue core + R5 stubs
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_enqueue_telegram(
  p_org_id uuid,
  p_renter_id uuid,
  p_event_type text,
  p_text text,
  p_dedupe_key text DEFAULT NULL,
  p_rental_id uuid DEFAULT NULL,
  p_topup_request_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tg bigint;
  v_id uuid;
  v_plain text;
BEGIN
  IF NOT renter_miniapp_addon_is_active(p_org_id) THEN
    RETURN NULL;
  END IF;

  SELECT r.telegram_id INTO v_tg
  FROM renters r
  WHERE r.id = p_renter_id
    AND r.organization_id = p_org_id;

  IF v_tg IS NULL OR v_tg <= 0 THEN
    RETURN NULL;
  END IF;

  v_plain := _renter_telegram_plain(p_text);
  IF v_plain IS NULL OR v_plain = '' THEN
    RETURN NULL;
  END IF;

  BEGIN
    INSERT INTO renter_telegram_outbox (
      organization_id, renter_id, telegram_id, event_type, text,
      dedupe_key, rental_id, topup_request_id
    )
    VALUES (
      p_org_id, p_renter_id, v_tg, p_event_type, v_plain,
      p_dedupe_key, p_rental_id, p_topup_request_id
    )
    RETURNING id INTO v_id;
    RETURN v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_enqueue_penalty_prepay_bounce(p_rental_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r rentals%ROWTYPE;
BEGIN
  SELECT * INTO v_r FROM rentals WHERE id = p_rental_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN _renter_enqueue_telegram(
    v_r.organization_id,
    v_r.renter_id,
    'penalty_prepay_bounce',
    format(
      'Предоплата по слоту %s выросла из‑за тарифа штрафника. Слот снова ожидает оплаты.',
      _renter_telegram_fmt_slot_line(p_rental_id)
    ),
    'penalty_prepay_bounce:' || p_rental_id::text,
    p_rental_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION _renter_enqueue_booking_banned(p_org_id uuid, p_renter_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN _renter_enqueue_telegram(
    p_org_id,
    p_renter_id,
    'booking_banned',
    'Бронирование зала через Mini App временно запрещено из‑за надёжности. Обратитесь в студию.',
    'booking_banned:' || p_renter_id::text
  );
END;
$$;

CREATE OR REPLACE FUNCTION _renter_enqueue_penalty_tariff(p_org_id uuid, p_renter_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN _renter_enqueue_telegram(
    p_org_id,
    p_renter_id,
    'penalty_tariff_applied',
    'Вам назначен тариф штрафника на бронирование зала. Проверьте предоплату по активным слотам.',
    'penalty_tariff:' || p_renter_id::text || ':' || to_char(now(), 'YYYYMMDD')
  );
END;
$$;

CREATE OR REPLACE FUNCTION _renter_enqueue_ban_lifted(p_org_id uuid, p_renter_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN _renter_enqueue_telegram(
    p_org_id,
    p_renter_id,
    'ban_lifted',
    'Ограничение на бронирование зала снято. Можно снова создавать записи в Mini App.',
    'ban_lifted:' || p_renter_id::text || ':' || to_char(now(), 'YYYYMMDD')
  );
END;
$$;

-- =============================================================================
-- 5. Event-specific enqueue helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_enqueue_hold_awaiting(p_rental_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r rentals%ROWTYPE;
BEGIN
  SELECT * INTO v_r FROM rentals WHERE id = p_rental_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN _renter_enqueue_telegram(
    v_r.organization_id,
    v_r.renter_id,
    'hold_awaiting',
    format(
      'Холд создан: %s. Ожидает оплаты. Автоудаление через %s.',
      _renter_telegram_fmt_slot_line(p_rental_id),
      _renter_telegram_fmt_hold_timer(v_r.hold_expires_at)
    ),
    'hold_awaiting:' || p_rental_id::text,
    p_rental_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION _renter_enqueue_booking_activated(p_rental_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r rentals%ROWTYPE;
BEGIN
  SELECT * INTO v_r FROM rentals WHERE id = p_rental_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN _renter_enqueue_telegram(
    v_r.organization_id,
    v_r.renter_id,
    'booking_activated',
    format('Бронь активирована: %s.', _renter_telegram_fmt_slot_line(p_rental_id)),
    'booking_activated:' || p_rental_id::text,
    p_rental_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION _renter_enqueue_prepay_failed_t24(p_rental_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r rentals%ROWTYPE;
BEGIN
  SELECT * INTO v_r FROM rentals WHERE id = p_rental_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN _renter_enqueue_telegram(
    v_r.organization_id,
    v_r.renter_id,
    'prepay_failed_t24',
    format(
      'За 24 ч до начала не удалось списать предоплату. Слот %s снова ожидает оплаты (до %s).',
      _renter_telegram_fmt_slot_line(p_rental_id),
      _renter_telegram_fmt_hold_timer(v_r.hold_expires_at)
    ),
    'prepay_failed_t24:' || p_rental_id::text,
    p_rental_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION _renter_enqueue_auto_deleted(p_rental_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r rentals%ROWTYPE;
BEGIN
  SELECT * INTO v_r FROM rentals WHERE id = p_rental_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN _renter_enqueue_telegram(
    v_r.organization_id,
    v_r.renter_id,
    'auto_deleted',
    format('Холд автоматически удалён: %s.', _renter_telegram_fmt_slot_line(p_rental_id)),
    'auto_deleted:' || p_rental_id::text,
    p_rental_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION _renter_enqueue_debt_accrued(p_rental_id uuid, p_amount numeric)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r rentals%ROWTYPE;
BEGIN
  SELECT * INTO v_r FROM rentals WHERE id = p_rental_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN _renter_enqueue_telegram(
    v_r.organization_id,
    v_r.renter_id,
    'debt_accrued',
    format(
      'Начислен долг %s за слот %s.',
      _renter_telegram_fmt_money(p_amount, v_r.currency),
      _renter_telegram_fmt_slot_line(p_rental_id)
    ),
    'debt_accrued:' || p_rental_id::text,
    p_rental_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION _renter_enqueue_debt_settled(p_rental_id uuid, p_amount numeric)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r rentals%ROWTYPE;
BEGIN
  SELECT * INTO v_r FROM rentals WHERE id = p_rental_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN _renter_enqueue_telegram(
    v_r.organization_id,
    v_r.renter_id,
    'debt_settled',
    format(
      'Долг %s по слоту %s погашен с кошелька.',
      _renter_telegram_fmt_money(p_amount, v_r.currency),
      _renter_telegram_fmt_slot_line(p_rental_id)
    ),
    'debt_settled:' || p_rental_id::text || ':' || to_char(now(), 'YYYYMMDDHH24MISS'),
    p_rental_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION _renter_enqueue_staff_cancelled(p_rental_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r rentals%ROWTYPE;
BEGIN
  SELECT * INTO v_r FROM rentals WHERE id = p_rental_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN _renter_enqueue_telegram(
    v_r.organization_id,
    v_r.renter_id,
    'staff_cancelled',
    format('Студия отменила бронь: %s.', _renter_telegram_fmt_slot_line(p_rental_id)),
    'staff_cancelled:' || p_rental_id::text,
    p_rental_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION _renter_enqueue_topup_created(
  p_org_id uuid,
  p_renter_id uuid,
  p_request_id uuid,
  p_amount numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_currency text;
BEGIN
  v_currency := _renter_org_currency(p_org_id);
  RETURN _renter_enqueue_telegram(
    p_org_id,
    p_renter_id,
    'topup_created',
    format('Заявка на пополнение %s создана. Ожидайте подтверждения студии.', _renter_telegram_fmt_money(p_amount, v_currency)),
    'topup_created:' || p_request_id::text,
    NULL,
    p_request_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION _renter_enqueue_topup_confirmed(
  p_org_id uuid,
  p_renter_id uuid,
  p_request_id uuid,
  p_amount numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_currency text;
BEGIN
  v_currency := _renter_org_currency(p_org_id);
  RETURN _renter_enqueue_telegram(
    p_org_id,
    p_renter_id,
    'topup_confirmed',
    format('Пополнение подтверждено: зачислено %s.', _renter_telegram_fmt_money(p_amount, v_currency)),
    'topup_confirmed:' || p_request_id::text,
    NULL,
    p_request_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION _renter_enqueue_topup_rejected(
  p_org_id uuid,
  p_renter_id uuid,
  p_request_id uuid,
  p_amount numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_currency text;
BEGIN
  v_currency := _renter_org_currency(p_org_id);
  RETURN _renter_enqueue_telegram(
    p_org_id,
    p_renter_id,
    'topup_rejected',
    format('Заявка на пополнение %s отклонена студией.', _renter_telegram_fmt_money(p_amount, v_currency)),
    'topup_rejected:' || p_request_id::text,
    NULL,
    p_request_id
  );
END;
$$;

-- =============================================================================
-- 6. Claim + complete (drain from Edge)
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
    locked_by = p_worker_id
  FROM candidates c
  WHERE o.id = c.id
  RETURNING o.*;
END;
$$;

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
    SET status = 'sent', sent_at = now(), locked_at = NULL, locked_by = NULL, last_error_code = NULL
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
-- 7. Patch phase helpers — enqueue on transition (one place per event)
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_insert_occurrence(
  p_org_id uuid,
  p_renter_id uuid,
  p_location_id uuid,
  p_date date,
  p_time_start text,
  p_time_end text,
  p_kind text,
  p_series_id uuid,
  p_idempotency_key text,
  p_created_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_quote jsonb;
  v_kind text;
  v_start_ts timestamptz;
  v_now timestamptz := now();
  v_created timestamptz := now();
  v_hold timestamptz;
  v_inherited timestamptz;
  v_id uuid;
  v_currency text;
BEGIN
  PERFORM _renter_validate_slot_grid(p_time_start, p_time_end);

  v_start_ts := _renter_slot_ts(p_org_id, p_date, p_time_start);
  IF v_start_ts < v_now + interval '1 hour' THEN
    PERFORM _renter_raise('renter.booking.tooSoon');
  END IF;

  IF NOT _renter_location_channel_ok(p_org_id, p_location_id, p_date) THEN
    PERFORM _renter_raise('renter.booking.locationUnavailable');
  END IF;

  IF _renter_location_slot_busy(p_org_id, p_date, p_time_start, p_time_end, p_location_id) THEN
    PERFORM _renter_raise('renter.booking.conflict');
  END IF;

  v_kind := _renter_effective_kind(p_org_id, p_renter_id, p_kind);
  v_quote := _renter_quote_slot_amounts(
    p_org_id, p_location_id, v_kind, p_date, p_time_start, p_time_end
  );
  v_currency := v_quote ->> 'currency';
  v_inherited := _renter_inherited_hold_expires_at(
    p_org_id, p_renter_id, p_location_id, p_time_start, p_time_end
  );
  v_hold := COALESCE(
    v_inherited,
    _renter_compute_hold_expires_at(v_created, v_start_ts)
  );

  INSERT INTO rentals (
    organization_id,
    location_id,
    rental_date,
    time_start,
    time_end,
    renter_id,
    rental_series_id,
    booking_status,
    channel,
    lifecycle,
    hold_expires_at,
    prepay_amount,
    remainder_amount,
    debt_amount,
    fixed_amount,
    calculated_amount,
    final_amount,
    currency,
    tariff_id,
    tariff_type,
    tariff_snapshot,
    idempotency_key,
    created_by,
    created_at
  )
  VALUES (
    p_org_id,
    p_location_id,
    p_date,
    normalize_hhmm(p_time_start),
    normalize_hhmm(p_time_end),
    p_renter_id,
    p_series_id,
    'confirmed',
    'miniapp',
    'awaiting_payment',
    v_hold,
    (v_quote ->> 'prepay')::numeric,
    (v_quote ->> 'remainder')::numeric,
    0,
    (v_quote ->> 'cost')::numeric,
    (v_quote ->> 'cost')::numeric,
    NULL,
    v_currency,
    NULL,
    NULL,
    NULL,
    p_idempotency_key,
    p_created_by,
    v_created
  )
  RETURNING id INTO v_id;

  PERFORM _renter_enqueue_hold_awaiting(v_id);

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_fifo_activate(p_org_id uuid, p_renter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slot record;
  v_now timestamptz := now();
  v_start timestamptz;
  v_available numeric;
  v_charged boolean;
BEGIN
  FOR v_slot IN
    SELECT r.*
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.lifecycle = 'awaiting_payment'
    ORDER BY r.rental_date, r.time_start, r.created_at
  LOOP
    v_start := _renter_slot_ts(p_org_id, v_slot.rental_date, v_slot.time_start);

    IF v_now >= v_start OR (v_slot.hold_expires_at IS NOT NULL AND v_now >= v_slot.hold_expires_at) THEN
      CONTINUE;
    END IF;

    v_available := _renter_wallet_available(p_org_id, p_renter_id);
    IF v_available < v_slot.prepay_amount THEN
      CONTINUE;
    END IF;

    IF v_now >= v_start - interval '24 hours' AND v_now < v_start THEN
      v_charged := _renter_charge_prepay(v_slot.id);
      IF v_charged THEN
        PERFORM _renter_enqueue_booking_activated(v_slot.id);
      END IF;
    ELSE
      UPDATE rentals
      SET lifecycle = 'active', updated_at = now()
      WHERE id = v_slot.id
        AND lifecycle = 'awaiting_payment';
      IF FOUND THEN
        PERFORM _renter_enqueue_booking_activated(v_slot.id);
      END IF;
      PERFORM _renter_assert_wallet_invariant(p_org_id, p_renter_id);
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_mark_terminal(
  p_rental_id uuid,
  p_lifecycle text,
  p_reason text,
  p_cancelled_by uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE rentals
  SET
    booking_status = 'cancelled',
    lifecycle = p_lifecycle,
    cancelled_at = COALESCE(cancelled_at, now()),
    cancelled_reason = p_reason,
    cancelled_by = p_cancelled_by,
    updated_at = now()
  WHERE id = p_rental_id
    AND channel = 'miniapp';

  IF FOUND AND p_lifecycle = 'auto_deleted' THEN
    PERFORM _renter_enqueue_auto_deleted(p_rental_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_debt_settle(p_org_id uuid, p_renter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slot record;
  v_spendable numeric;
  v_amount numeric;
BEGIN
  LOOP
    v_spendable := _renter_wallet_spendable(p_org_id, p_renter_id);
    IF v_spendable <= 0 THEN
      EXIT;
    END IF;

    SELECT r.id, r.debt_amount
    INTO v_slot
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.debt_amount > 0
    ORDER BY
      _renter_slot_ts(r.organization_id, r.rental_date, r.time_end),
      r.created_at
    LIMIT 1;

    EXIT WHEN v_slot.id IS NULL;
    EXIT WHEN v_spendable < v_slot.debt_amount;

    v_amount := v_slot.debt_amount;

    PERFORM _renter_wallet_insert_entry(
      p_org_id,
      p_renter_id,
      'debt_settle',
      v_amount,
      v_slot.id,
      'debt_settle'
    );

    UPDATE rentals
    SET
      debt_amount = 0,
      lifecycle = CASE
        WHEN remainder_charged_at IS NOT NULL OR remainder_amount = 0 THEN 'settled'
        ELSE lifecycle
      END,
      updated_at = now()
    WHERE id = v_slot.id;

    IF FOUND THEN
      PERFORM _renter_enqueue_debt_settled(v_slot.id, v_amount);
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_charge_remainder(p_rental_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r rentals%ROWTYPE;
  v_spendable numeric;
  v_was_debt boolean;
BEGIN
  SELECT * INTO v_r FROM rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND OR v_r.channel <> 'miniapp' THEN
    RETURN false;
  END IF;

  IF v_r.remainder_charged_at IS NOT NULL THEN
    RETURN true;
  END IF;

  IF v_r.prepay_charged_at IS NULL THEN
    RETURN false;
  END IF;

  v_spendable := _renter_wallet_spendable(v_r.organization_id, v_r.renter_id);

  IF v_r.remainder_amount <= 0 THEN
    UPDATE rentals
    SET
      lifecycle = 'settled',
      remainder_charged_at = now(),
      updated_at = now()
    WHERE id = p_rental_id
      AND remainder_charged_at IS NULL;
    RETURN true;
  END IF;

  IF v_spendable < v_r.remainder_amount THEN
    v_was_debt := v_r.lifecycle = 'debt';
    UPDATE rentals
    SET
      lifecycle = 'debt',
      debt_amount = v_r.remainder_amount,
      updated_at = now()
    WHERE id = p_rental_id
      AND remainder_charged_at IS NULL
      AND lifecycle IS DISTINCT FROM 'debt';
    IF FOUND AND NOT v_was_debt THEN
      PERFORM _renter_enqueue_debt_accrued(p_rental_id, v_r.remainder_amount);
    END IF;
    RETURN false;
  END IF;

  PERFORM _renter_wallet_insert_entry(
    v_r.organization_id,
    v_r.renter_id,
    'remainder_charge',
    v_r.remainder_amount,
    v_r.id,
    'remainder'
  );

  UPDATE rentals
  SET
    lifecycle = 'settled',
    remainder_charged_at = now(),
    debt_amount = 0,
    updated_at = now()
  WHERE id = p_rental_id
    AND remainder_charged_at IS NULL;

  PERFORM _renter_assert_wallet_invariant(v_r.organization_id, v_r.renter_id);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_cancel_one_slot(
  p_rental_id uuid,
  p_is_renter boolean,
  p_member_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r rentals%ROWTYPE;
  v_now timestamptz := now();
  v_start timestamptz;
  v_end timestamptz;
  v_reason text;
BEGIN
  SELECT * INTO v_r FROM rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND OR v_r.channel <> 'miniapp' THEN
    PERFORM _renter_raise('renter.booking.notCancellable');
  END IF;

  IF v_r.lifecycle IN ('settled', 'debt', 'cancelled', 'auto_deleted', 'hold_deleted') THEN
    PERFORM _renter_raise('renter.booking.notCancellable');
  END IF;

  v_start := _renter_slot_ts(v_r.organization_id, v_r.rental_date, v_r.time_start);
  v_end := _renter_slot_ts(v_r.organization_id, v_r.rental_date, v_r.time_end);

  IF v_now >= v_end THEN
    PERFORM _renter_raise('renter.booking.notCancellable');
  END IF;

  IF p_is_renter AND v_now >= v_start THEN
    PERFORM _renter_raise('renter.booking.alreadyStarted');
  END IF;

  IF v_r.lifecycle = 'awaiting_payment' AND v_r.prepay_charged_at IS NULL THEN
    IF p_is_renter THEN
      PERFORM _renter_raise('renter.cancel.useDeleteHold');
    END IF;
    PERFORM _renter_mark_terminal(v_r.id, 'hold_deleted', 'miniapp_hold_deleted', p_member_id);
    PERFORM _renter_after_pack_slot_terminal(v_r.rental_series_id);
    PERFORM _renter_apply_wallet(v_r.organization_id, v_r.renter_id);
    RETURN 'hold_deleted';
  END IF;

  IF p_is_renter AND v_r.lifecycle = 'awaiting_payment' THEN
    PERFORM _renter_raise('renter.cancel.useDeleteHold');
  END IF;

  IF v_now < v_start - interval '24 hours' THEN
    PERFORM _renter_refund_prepay(v_r.id);
    v_reason := 'miniapp_cancel_refund';
  ELSE
    IF v_r.prepay_charged_at IS NULL THEN
      IF NOT _renter_charge_prepay(v_r.id) THEN
        v_reason := 'miniapp_cancel';
      ELSE
        v_reason := 'miniapp_cancel_retain';
      END IF;
    ELSE
      v_reason := 'miniapp_cancel_retain';
    END IF;
  END IF;

  PERFORM _renter_mark_terminal(v_r.id, 'cancelled', v_reason, p_member_id);
  PERFORM _renter_after_pack_slot_terminal(v_r.rental_series_id);
  PERFORM _renter_apply_wallet(v_r.organization_id, v_r.renter_id);

  IF NOT p_is_renter AND p_member_id IS NOT NULL THEN
    PERFORM _renter_enqueue_staff_cancelled(p_rental_id);
  END IF;

  RETURN v_reason;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_expire_and_catchup(p_org_id uuid, p_renter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_slot record;
  v_start timestamptz;
  v_end timestamptz;
  v_charged boolean;
  v_allowed boolean;
  v_was_debt boolean;
BEGIN
  v_allowed := _renter_reliability_tick_allowed(p_org_id);

  FOR v_slot IN
    SELECT r.*
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.lifecycle = 'awaiting_payment'
  LOOP
    v_start := _renter_slot_ts(p_org_id, v_slot.rental_date, v_slot.time_start);
    IF v_now >= COALESCE(v_slot.hold_expires_at, v_start) OR v_now >= v_start THEN
      PERFORM _renter_mark_terminal(v_slot.id, 'auto_deleted', 'miniapp_auto_deleted', NULL);
      PERFORM _renter_apply_reliability(v_slot.id, 'untimely', v_allowed);
      PERFORM _renter_after_pack_slot_terminal(v_slot.rental_series_id);
    END IF;
  END LOOP;

  FOR v_slot IN
    SELECT r.*
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.lifecycle = 'active'
  LOOP
    v_end := _renter_slot_ts(p_org_id, v_slot.rental_date, v_slot.time_end);
    IF v_now < v_end THEN
      CONTINUE;
    END IF;

    v_charged := _renter_charge_prepay(v_slot.id);
    IF NOT v_charged THEN
      v_was_debt := v_slot.lifecycle = 'debt';
      UPDATE rentals
      SET
        lifecycle = 'debt',
        debt_amount = GREATEST(debt_amount, fixed_amount),
        updated_at = now()
      WHERE id = v_slot.id
        AND lifecycle IS DISTINCT FROM 'debt';
      IF FOUND AND NOT v_was_debt THEN
        PERFORM _renter_enqueue_debt_accrued(v_slot.id, GREATEST(v_slot.debt_amount, v_slot.fixed_amount));
      END IF;
    ELSE
      PERFORM _renter_charge_remainder(v_slot.id);
    END IF;
    PERFORM _renter_after_pack_slot_terminal(v_slot.rental_series_id);
  END LOOP;

  FOR v_slot IN
    SELECT r.*
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.lifecycle = 'active'
  LOOP
    v_start := _renter_slot_ts(p_org_id, v_slot.rental_date, v_slot.time_start);
    v_end := _renter_slot_ts(p_org_id, v_slot.rental_date, v_slot.time_end);
    IF v_now < v_start OR v_now >= v_end THEN
      CONTINUE;
    END IF;

    IF NOT _renter_charge_prepay(v_slot.id) THEN
      PERFORM _renter_mark_terminal(v_slot.id, 'auto_deleted', 'miniapp_auto_deleted', NULL);
      PERFORM _renter_apply_reliability(v_slot.id, 'untimely', v_allowed);
      PERFORM _renter_after_pack_slot_terminal(v_slot.rental_series_id);
    END IF;
  END LOOP;

  FOR v_slot IN
    SELECT r.*
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.lifecycle = 'active'
  LOOP
    v_start := _renter_slot_ts(p_org_id, v_slot.rental_date, v_slot.time_start);
    IF v_now < v_start - interval '24 hours' OR v_now >= v_start THEN
      CONTINUE;
    END IF;

    IF NOT _renter_charge_prepay(v_slot.id) THEN
      UPDATE rentals
      SET
        lifecycle = 'awaiting_payment',
        hold_expires_at = LEAST(v_now + interval '24 hours', v_start),
        updated_at = now()
      WHERE id = v_slot.id
        AND lifecycle = 'active';
      IF FOUND THEN
        PERFORM _renter_enqueue_prepay_failed_t24(v_slot.id);
      END IF;
    END IF;
  END LOOP;

  FOR v_slot IN
    SELECT r.*
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.lifecycle = 'prepaid_charged'
  LOOP
    v_end := _renter_slot_ts(p_org_id, v_slot.rental_date, v_slot.time_end);
    IF v_now >= v_end THEN
      PERFORM _renter_charge_remainder(v_slot.id);
      PERFORM _renter_after_pack_slot_terminal(v_slot.rental_series_id);
    END IF;
  END LOOP;

  PERFORM _renter_apply_wallet(p_org_id, p_renter_id);
END;
$$;

-- Topup RPC patches
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

  PERFORM _renter_enqueue_topup_created(v_ctx.org_id, v_ctx.renter_id, v_id, v_amount);

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

-- resolve_renter_topup: enqueue confirm/reject (patch reject + confirm branches only via full replace tail)
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

    PERFORM _renter_enqueue_topup_rejected(v_org, v_row.renter_id, v_id, v_row.amount);

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

  PERFORM _renter_enqueue_topup_confirmed(v_org, v_row.renter_id, v_id, v_fact);

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

-- Worker: drain moved to Edge (no Bot API in SQL); expiry must not wait on Telegram
CREATE OR REPLACE FUNCTION run_renter_booking_maintenance(p_batch_size integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row record;
  v_n integer := 0;
  v_extra jsonb;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 100 THEN
    RAISE EXCEPTION 'invalid_batch_size';
  END IF;

  FOR v_row IN
    SELECT c.organization_id, c.renter_id
    FROM claim_renter_booking_maintenance(p_batch_size) c
  LOOP
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object('location_id', r.location_id, 'date', r.rental_date)
        ORDER BY r.location_id, r.rental_date
      ),
      '[]'::jsonb
    )
    INTO v_extra
    FROM rentals r
    WHERE r.organization_id = v_row.organization_id
      AND r.renter_id = v_row.renter_id
      AND r.channel = 'miniapp'
      AND r.lifecycle IN ('active', 'prepaid_charged');

    PERFORM _renter_acquire_miniapp_locks(v_row.organization_id, v_row.renter_id, v_extra);
    PERFORM _renter_expire_and_catchup(v_row.organization_id, v_row.renter_id);
    v_n := v_n + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'processed', v_n);
END;
$$;

COMMENT ON FUNCTION run_renter_booking_maintenance(integer) IS
  'R1d/R4: claim renters, lock, expire/catch-up/FIFO. Telegram drain in renter-booking-worker Edge.';

CREATE OR REPLACE FUNCTION _renter_drain_telegram_outbox()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- R4: actual send is in renter-booking-worker Edge (claim_renter_telegram_outbox).
  RETURN;
END;
$$;

-- =============================================================================
-- Grants
-- =============================================================================

REVOKE ALL ON FUNCTION _renter_telegram_plain(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_enqueue_telegram(uuid, uuid, text, text, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_renter_telegram_outbox(integer, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_renter_telegram_outbox(uuid, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION renter_telegram_outbox_send_gate(uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_renter_telegram_bot_send_config(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION claim_renter_telegram_outbox(integer, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION complete_renter_telegram_outbox(uuid, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION renter_telegram_outbox_send_gate(uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION get_renter_telegram_bot_send_config(uuid) TO service_role;

COMMIT;
