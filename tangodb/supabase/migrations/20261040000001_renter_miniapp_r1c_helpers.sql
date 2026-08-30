-- R1c / 2.9.3: Mini App slot engine helpers (auth, occupancy, rates, locks, FIFO, expiry, early-close).
-- Public RPC in 20261040000002. Worker (R1d) calls these names; do not fork a second copy.

BEGIN;

-- =============================================================================
-- Indexes for Mini App tick / FIFO (partial, channel = miniapp)
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_rentals_miniapp_hold_expires
  ON rentals (organization_id, hold_expires_at)
  WHERE channel = 'miniapp' AND lifecycle = 'awaiting_payment';

CREATE INDEX IF NOT EXISTS idx_rentals_miniapp_lifecycle_start
  ON rentals (organization_id, rental_date, time_start)
  WHERE channel = 'miniapp'
    AND lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged');

CREATE INDEX IF NOT EXISTS idx_rentals_miniapp_renter_lifecycle
  ON rentals (organization_id, renter_id, lifecycle)
  WHERE channel = 'miniapp';

CREATE INDEX IF NOT EXISTS idx_rentals_miniapp_unfinished
  ON rentals (organization_id, renter_id)
  WHERE channel = 'miniapp'
    AND lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged');

-- =============================================================================
-- JWT / actor
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_jwt_app_metadata()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_jwt jsonb;
BEGIN
  BEGIN
    v_jwt := COALESCE(
      auth.jwt(),
      NULLIF(current_setting('request.jwt.claims', true), '')::jsonb,
      '{}'::jsonb
    );
  EXCEPTION WHEN invalid_text_representation THEN
    v_jwt := '{}'::jsonb;
  END;

  RETURN COALESCE(v_jwt -> 'app_metadata', '{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION _renter_raise(p_code text)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '%', p_code USING ERRCODE = 'P0001';
END;
$$;

-- Card match on (organization_id, telegram_id) from app_metadata. No fallback to JWT renter_id.
CREATE OR REPLACE FUNCTION auth_renter_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_meta jsonb;
  v_org uuid;
  v_telegram bigint;
  v_id uuid;
BEGIN
  v_meta := _renter_jwt_app_metadata();

  IF COALESCE(v_meta ->> 'actor', '') IS DISTINCT FROM 'renter' THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_org := NULLIF(v_meta ->> 'organization_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
  END;

  BEGIN
    v_telegram := NULLIF(v_meta ->> 'telegram_id', '')::bigint;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
  END;

  IF v_org IS NULL OR v_telegram IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT r.id
  INTO v_id
  FROM renters r
  WHERE r.organization_id = v_org
    AND r.telegram_id = v_telegram;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION auth_renter_id() IS
  'R1c: renter JWT → renters.id via (org, telegram_id) card match. No auth_organization_id. No JWT renter_id fallback.';

CREATE OR REPLACE FUNCTION _renter_check_rpc_rate_limit(p_org_id uuid, p_telegram_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_org_id IS NULL OR p_telegram_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN check_edge_rate_limit(
    'renter-rpc:' || p_org_id::text || ':' || p_telegram_id::text,
    180,
    60
  );
END;
$$;

COMMENT ON FUNCTION _renter_check_rpc_rate_limit(uuid, bigint) IS
  'R1c: SQL rate-limit per (organization_id, telegram_id). R2 submit_topup calls the same helper.';

CREATE OR REPLACE FUNCTION _renter_actor_ctx()
RETURNS TABLE (
  is_renter boolean,
  org_id uuid,
  jwt_renter_id uuid,
  member_id uuid,
  telegram_id bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_meta jsonb;
  v_rid uuid;
  v_org uuid;
  v_tg bigint;
BEGIN
  v_meta := _renter_jwt_app_metadata();

  IF COALESCE(v_meta ->> 'actor', '') = 'renter' THEN
    v_rid := auth_renter_id();
    IF v_rid IS NULL THEN
      PERFORM _renter_raise('renter.unauthorized');
    END IF;

    SELECT r.organization_id, r.telegram_id
    INTO v_org, v_tg
    FROM renters r
    WHERE r.id = v_rid;

    IF v_org IS NULL THEN
      PERFORM _renter_raise('renter.unauthorized');
    END IF;

    IF NOT _renter_check_rpc_rate_limit(v_org, v_tg) THEN
      PERFORM _renter_raise('renter.rateLimited');
    END IF;

    is_renter := true;
    org_id := v_org;
    jwt_renter_id := v_rid;
    member_id := NULL;
    telegram_id := v_tg;
    RETURN NEXT;
    RETURN;
  END IF;

  IF member_can_manage_rentals() THEN
    is_renter := false;
    org_id := auth_organization_id();
    jwt_renter_id := NULL;
    member_id := auth_member_id();
    telegram_id := NULL;
    IF org_id IS NULL THEN
      PERFORM _renter_raise('renter.unauthorized');
    END IF;
    RETURN NEXT;
    RETURN;
  END IF;

  IF auth.uid() IS NULL THEN
    PERFORM _renter_raise('renter.unauthorized');
  END IF;

  PERFORM _renter_raise('renter.forbidden');
END;
$$;

-- =============================================================================
-- Money / time / rates
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_currency_minor(p_currency text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE upper(COALESCE(p_currency, 'RUB'))
    WHEN 'JPY' THEN 0
    WHEN 'KRW' THEN 0
    WHEN 'VND' THEN 0
    ELSE 2
  END;
$$;

CREATE OR REPLACE FUNCTION _renter_round_money(p_amount numeric, p_currency text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT round(COALESCE(p_amount, 0), _renter_currency_minor(p_currency))::numeric(12, 2);
$$;

CREATE OR REPLACE FUNCTION _renter_org_currency(p_org_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(NULLIF(trim(os.currency_code), ''), 'RUB')
  FROM organization_settings os
  WHERE os.organization_id = p_org_id;
$$;

CREATE OR REPLACE FUNCTION _renter_slot_ts(p_org_id uuid, p_date date, p_time text)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT ((p_date::timestamp + COALESCE(p_time, '00:00')::time) AT TIME ZONE _org_timezone(p_org_id));
$$;

CREATE OR REPLACE FUNCTION _renter_compute_hold_expires_at(
  p_created_at timestamptz,
  p_time_start_ts timestamptz
)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT LEAST(p_created_at + interval '24 hours', p_time_start_ts);
$$;

COMMENT ON FUNCTION _renter_compute_hold_expires_at(timestamptz, timestamptz) IS
  'R1c: primary hold timer = min(created_at+24h, time_start_ts). Worker R1d reuses this.';

CREATE OR REPLACE FUNCTION _renter_occupancy_window(p_org_id uuid)
RETURNS TABLE (window_start date, window_end date)
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today date;
  v_monday date;
BEGIN
  v_today := _org_local_date(p_org_id);
  v_monday := v_today - (EXTRACT(ISODOW FROM v_today)::integer - 1);
  window_start := v_monday;
  window_end := v_monday + 20;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_hour_rate(
  p_org_id uuid,
  p_location_id uuid,
  p_kind text,
  p_date date
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_price numeric;
BEGIN
  SELECT r.price
  INTO v_price
  FROM location_rental_hour_rates r
  WHERE r.organization_id = p_org_id
    AND r.location_id = p_location_id
    AND r.kind = p_kind
    AND r.valid_from <= p_date
  ORDER BY r.valid_from DESC, r.created_at DESC, r.id DESC
  LIMIT 1;

  RETURN v_price;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_location_has_three_kinds(
  p_org_id uuid,
  p_location_id uuid,
  p_date date
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    _renter_hour_rate(p_org_id, p_location_id, 'one_time', p_date) IS NOT NULL
    AND _renter_hour_rate(p_org_id, p_location_id, 'recurring', p_date) IS NOT NULL
    AND _renter_hour_rate(p_org_id, p_location_id, 'penalty', p_date) IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION _renter_effective_kind(
  p_org_id uuid,
  p_renter_id uuid,
  p_base_kind text
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM renters r
      WHERE r.id = p_renter_id
        AND r.organization_id = p_org_id
        AND r.penalty_tariff_applied_at IS NOT NULL
    ) THEN 'penalty'
    ELSE p_base_kind
  END;
$$;

CREATE OR REPLACE FUNCTION _renter_quote_slot_amounts(
  p_org_id uuid,
  p_location_id uuid,
  p_kind text,
  p_date date,
  p_time_start text,
  p_time_end text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_minutes integer;
  v_hours numeric;
  v_rate numeric;
  v_currency text;
  v_cost numeric;
  v_prepay numeric;
  v_remainder numeric;
BEGIN
  v_minutes := _hhmm_to_minutes(p_time_end) - _hhmm_to_minutes(p_time_start);
  IF v_minutes < 60 THEN
    PERFORM _renter_raise('renter.booking.timeInvalid');
  END IF;

  v_rate := _renter_hour_rate(p_org_id, p_location_id, p_kind, p_date);
  IF v_rate IS NULL THEN
    PERFORM _renter_raise('renter.booking.noRate');
  END IF;

  v_currency := _renter_org_currency(p_org_id);
  v_hours := (v_minutes::numeric / 60);
  v_cost := _renter_round_money(v_hours * v_rate, v_currency);
  v_prepay := _renter_round_money(v_cost / 2, v_currency);
  v_remainder := v_cost - v_prepay;

  RETURN jsonb_build_object(
    'kind', p_kind,
    'hours', v_hours,
    'rate', v_rate,
    'cost', v_cost,
    'prepay', v_prepay,
    'remainder', v_remainder,
    'currency', v_currency
  );
END;
$$;

-- Occupancy predicate: schedule_location_has_conflict PLUS cancelled group occurrences are free.
CREATE OR REPLACE FUNCTION _renter_location_slot_busy(
  p_org_id uuid,
  p_date date,
  p_time_start text,
  p_time_end text,
  p_location_id uuid,
  p_exclude_rental_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_time_start text;
  v_time_end text;
  v_dow integer;
BEGIN
  v_time_start := normalize_hhmm(p_time_start);
  v_time_end := normalize_hhmm(p_time_end);

  IF _hhmm_to_minutes(v_time_end) <= _hhmm_to_minutes(v_time_start) THEN
    RETURN true;
  END IF;

  v_dow := EXTRACT(ISODOW FROM p_date)::integer;

  IF EXISTS (
    SELECT 1
    FROM personal_lessons p
    WHERE p.organization_id = p_org_id
      AND p.date = p_date
      AND p.cancelled_at IS NULL
      AND p.location_id IS NOT DISTINCT FROM p_location_id
      AND schedule_time_ranges_overlap(p.time_start, p.time_end, v_time_start, v_time_end)
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM schedule_slots s
    WHERE s.organization_id = p_org_id
      AND s.day_of_week = v_dow
      AND s.location_id IS NOT DISTINCT FROM p_location_id
      AND s.valid_from <= p_date
      AND (s.valid_to IS NULL OR s.valid_to >= p_date)
      AND schedule_time_ranges_overlap(s.time, s.time_end, v_time_start, v_time_end)
      AND NOT EXISTS (
        SELECT 1
        FROM schedule_occurrence_cancellations soc
        WHERE soc.organization_id = p_org_id
          AND soc.slot_id = s.id
          AND soc.occurrence_date = p_date
      )
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM calendar_event_sessions ces
    JOIN calendar_events ce ON ce.id = ces.event_id AND ce.organization_id = ces.organization_id
    WHERE ces.organization_id = p_org_id
      AND ces.session_date = p_date
      AND ces.location_id IS NOT DISTINCT FROM p_location_id
      AND schedule_time_ranges_overlap(ces.time_start, ces.time_end, v_time_start, v_time_end)
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.rental_date = p_date
      AND r.location_id IS NOT DISTINCT FROM p_location_id
      AND r.booking_status = 'confirmed'
      AND r.id IS DISTINCT FROM p_exclude_rental_id
      AND schedule_time_ranges_overlap(r.time_start, r.time_end, v_time_start, v_time_end)
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION _renter_location_slot_busy(uuid, date, text, text, uuid, uuid) IS
  'R1c: occupancy+create predicate = group/personal/event/rental confirmed PLUS NOT EXISTS schedule_occurrence_cancellations.';

CREATE OR REPLACE FUNCTION _renter_validate_slot_grid(p_time_start text, p_time_end text)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start integer;
  v_end integer;
  v_dur integer;
BEGIN
  v_start := _hhmm_to_minutes(normalize_hhmm(p_time_start));
  v_end := _hhmm_to_minutes(normalize_hhmm(p_time_end));
  v_dur := v_end - v_start;

  IF v_end <= v_start THEN
    PERFORM _renter_raise('renter.booking.timeInvalid');
  END IF;
  IF (v_start % 30) <> 0 OR (v_end % 30) <> 0 THEN
    PERFORM _renter_raise('renter.booking.timeInvalid');
  END IF;
  IF v_dur < 60 OR (v_dur % 30) <> 0 THEN
    PERFORM _renter_raise('renter.booking.timeInvalid');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_location_channel_ok(
  p_org_id uuid,
  p_location_id uuid,
  p_date date
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM locations l
    WHERE l.id = p_location_id
      AND l.organization_id = p_org_id
      AND l.miniapp_enabled
      AND _renter_location_has_three_kinds(p_org_id, p_location_id, p_date)
  );
$$;

-- =============================================================================
-- Locks: awaiting of this renter ∪ extra slot/pack dates, then wallet
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_lock_candidate_pairs(
  p_org_id uuid,
  p_renter_id uuid,
  p_extra_pairs jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE (location_id uuid, occurrence_date date)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT x.location_id, x.occurrence_date
  FROM (
    SELECT DISTINCT
      q.location_id,
      q.occurrence_date
    FROM (
      SELECT r.location_id, r.rental_date AS occurrence_date
      FROM rentals r
      WHERE r.organization_id = p_org_id
        AND r.renter_id = p_renter_id
        AND r.channel = 'miniapp'
        AND r.lifecycle = 'awaiting_payment'
      UNION ALL
      SELECT (e->>'location_id')::uuid, (e->>'date')::date
      FROM jsonb_array_elements(COALESCE(p_extra_pairs, '[]'::jsonb)) e
      WHERE NULLIF(e->>'location_id', '') IS NOT NULL
        AND NULLIF(e->>'date', '') IS NOT NULL
    ) q
    WHERE q.location_id IS NOT NULL
      AND q.occurrence_date IS NOT NULL
  ) x
  ORDER BY x.location_id, x.occurrence_date;
$$;

COMMENT ON FUNCTION _renter_lock_candidate_pairs(uuid, uuid, jsonb) IS
  'R1c: location-date set = awaiting of this renter ∪ extra create/pack/cancel dates. Lock these, then wallet.';

CREATE OR REPLACE FUNCTION _renter_acquire_miniapp_locks(
  p_org_id uuid,
  p_renter_id uuid,
  p_extra_pairs jsonb DEFAULT '[]'::jsonb
)
RETURNS bigint[]
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pairs jsonb;
  v_keys bigint[];
BEGIN
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('location_id', p.location_id, 'date', p.occurrence_date)
      ORDER BY p.location_id, p.occurrence_date
    ),
    '[]'::jsonb
  )
  INTO v_pairs
  FROM _renter_lock_candidate_pairs(p_org_id, p_renter_id, p_extra_pairs) p;

  v_keys := _rental_acquire_location_date_locks(p_org_id, v_pairs);
  PERFORM pg_advisory_xact_lock(_renter_wallet_lock_key(p_org_id, p_renter_id));
  RETURN v_keys;
END;
$$;

-- =============================================================================
-- Wallet apply / FIFO / charges
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_assert_wallet_invariant(p_org_id uuid, p_renter_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF _renter_wallet_balance(p_org_id, p_renter_id)
     < _renter_wallet_reserved_prepay(p_org_id, p_renter_id) THEN
    RAISE EXCEPTION 'renter.wallet.invariant'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_wallet_insert_entry(
  p_org_id uuid,
  p_renter_id uuid,
  p_entry_type text,
  p_amount numeric,
  p_rental_id uuid,
  p_phase text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF COALESCE(p_amount, 0) <= 0 THEN
    RETURN NULL;
  END IF;

  BEGIN
    INSERT INTO renter_wallet_ledger (
      organization_id, renter_id, entry_type, amount, rental_id, advance_id, phase
    )
    VALUES (
      p_org_id, p_renter_id, p_entry_type, p_amount::numeric(12, 2), p_rental_id, NULL, p_phase
    )
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT l.id INTO v_id
    FROM renter_wallet_ledger l
    WHERE l.rental_id = p_rental_id AND l.phase = p_phase;
    RETURN v_id;
  END;

  PERFORM _renter_assert_wallet_invariant(p_org_id, p_renter_id);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_charge_prepay(p_rental_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r rentals%ROWTYPE;
  v_available numeric;
  v_balance numeric;
  v_reserved numeric;
BEGIN
  SELECT * INTO v_r FROM rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND OR v_r.channel <> 'miniapp' THEN
    RETURN false;
  END IF;

  IF v_r.prepay_charged_at IS NOT NULL THEN
    RETURN true;
  END IF;

  IF v_r.prepay_amount <= 0 THEN
    UPDATE rentals
    SET
      lifecycle = 'prepaid_charged',
      prepay_charged_at = now(),
      updated_at = now()
    WHERE id = p_rental_id
      AND prepay_charged_at IS NULL;
    RETURN true;
  END IF;

  v_balance := _renter_wallet_balance(v_r.organization_id, v_r.renter_id);
  v_reserved := _renter_wallet_reserved_prepay(v_r.organization_id, v_r.renter_id);
  v_available := _renter_wallet_available(v_r.organization_id, v_r.renter_id);

  IF v_r.lifecycle = 'active' THEN
    -- Covered by reserved; fail-safe if invariant already broken.
    IF v_balance < v_r.prepay_amount THEN
      RETURN false;
    END IF;
    IF (v_balance - (v_reserved - v_r.prepay_amount)) < v_r.prepay_amount THEN
      RETURN false;
    END IF;
  ELSE
    IF v_available < v_r.prepay_amount THEN
      RETURN false;
    END IF;
  END IF;

  PERFORM _renter_wallet_insert_entry(
    v_r.organization_id,
    v_r.renter_id,
    'prepay_charge',
    v_r.prepay_amount,
    v_r.id,
    'prepay'
  );

  UPDATE rentals
  SET
    lifecycle = 'prepaid_charged',
    prepay_charged_at = now(),
    updated_at = now()
  WHERE id = p_rental_id
    AND prepay_charged_at IS NULL;

  PERFORM _renter_assert_wallet_invariant(v_r.organization_id, v_r.renter_id);
  RETURN true;
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
    UPDATE rentals
    SET
      lifecycle = 'debt',
      debt_amount = v_r.remainder_amount,
      updated_at = now()
    WHERE id = p_rental_id
      AND remainder_charged_at IS NULL
      AND lifecycle IS DISTINCT FROM 'debt';
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

CREATE OR REPLACE FUNCTION _renter_refund_prepay(p_rental_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r rentals%ROWTYPE;
BEGIN
  SELECT * INTO v_r FROM rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_r.prepay_charged_at IS NULL OR v_r.prepay_amount <= 0 THEN
    RETURN true;
  END IF;

  PERFORM _renter_wallet_insert_entry(
    v_r.organization_id,
    v_r.renter_id,
    'refund',
    v_r.prepay_amount,
    v_r.id,
    'refund'
  );

  PERFORM _renter_assert_wallet_invariant(v_r.organization_id, v_r.renter_id);
  RETURN true;
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

    PERFORM _renter_wallet_insert_entry(
      p_org_id,
      p_renter_id,
      'debt_settle',
      v_slot.debt_amount,
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
  END LOOP;
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
      IF _renter_charge_prepay(v_slot.id) THEN
        NULL;
      END IF;
    ELSE
      UPDATE rentals
      SET lifecycle = 'active', updated_at = now()
      WHERE id = v_slot.id
        AND lifecycle = 'awaiting_payment';
      PERFORM _renter_assert_wallet_invariant(p_org_id, p_renter_id);
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_apply_wallet(p_org_id uuid, p_renter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM _renter_debt_settle(p_org_id, p_renter_id);
  PERFORM _renter_fifo_activate(p_org_id, p_renter_id);
  PERFORM _renter_assert_wallet_invariant(p_org_id, p_renter_id);
END;
$$;

COMMENT ON FUNCTION _renter_apply_wallet(uuid, uuid) IS
  'R1c: debt_settle from spendable, then FIFO. Call after ledger/create/cancel. R1d/R2 reuse.';

-- =============================================================================
-- Terminal / cooldown / reliability stub / catch-up / early-close
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_apply_reliability(
  p_rental_id uuid,
  p_phase text,
  p_allowed boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- R1c/R1d stub: no on_time++/untimely++. R5 replaces this body in-place.
  RETURN;
END;
$$;

COMMENT ON FUNCTION _renter_apply_reliability(uuid, text, boolean) IS
  'R1c stub (always no-op). R1d calls with allowed=false. R5 replaces the body; keep the name.';

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
END;
$$;

CREATE OR REPLACE FUNCTION _renter_inherited_hold_expires_at(
  p_org_id uuid,
  p_renter_id uuid,
  p_location_id uuid,
  p_time_start text,
  p_time_end text
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_exp timestamptz;
  v_now timestamptz := now();
BEGIN
  SELECT MAX(x.exp)
  INTO v_exp
  FROM (
    SELECT r.hold_expires_at AS exp
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.location_id = p_location_id
      AND r.channel = 'miniapp'
      AND r.lifecycle = 'hold_deleted'
      AND r.hold_expires_at IS NOT NULL
      AND schedule_time_ranges_overlap(r.time_start, r.time_end, p_time_start, p_time_end)
    UNION ALL
    SELECT _renter_slot_ts(r.organization_id, r.rental_date, r.time_start)
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.location_id = p_location_id
      AND r.channel = 'miniapp'
      AND r.lifecycle = 'cancelled'
      AND r.cancelled_reason IN ('miniapp_cancel_refund', 'miniapp_cancel')
      AND schedule_time_ranges_overlap(r.time_start, r.time_end, p_time_start, p_time_end)
  ) x
  WHERE x.exp IS NOT NULL
    AND x.exp > v_now;

  RETURN v_exp;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_unfinished_counts(p_org_id uuid, p_renter_id uuid)
RETURNS TABLE (awaiting_n integer, unfinished_n integer)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    count(*) FILTER (WHERE r.lifecycle = 'awaiting_payment')::integer,
    count(*) FILTER (
      WHERE r.lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged')
    )::integer
  FROM rentals r
  WHERE r.organization_id = p_org_id
    AND r.renter_id = p_renter_id
    AND r.channel = 'miniapp';
$$;

CREATE OR REPLACE FUNCTION _renter_try_complete_pack(p_series_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total integer;
  v_used integer;
BEGIN
  IF p_series_id IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*), count(*) FILTER (WHERE r.lifecycle IN ('settled', 'debt'))
  INTO v_total, v_used
  FROM rentals r
  WHERE r.rental_series_id = p_series_id
    AND r.channel = 'miniapp';

  IF v_total > 0 AND v_total = v_used THEN
    UPDATE rental_series
    SET status = 'completed', updated_at = now()
    WHERE id = p_series_id
      AND status = 'active';
  END IF;
END;
$$;

COMMENT ON FUNCTION _renter_try_complete_pack(uuid) IS
  'R1c: all pack dates used (settled/debt) → series.completed without surcharge.';

CREATE OR REPLACE FUNCTION _renter_early_close_pack(p_series_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_series rental_series%ROWTYPE;
  v_now timestamptz := now();
  v_slot record;
  v_one_time numeric;
  v_penalty numeric;
  v_rate numeric;
  v_minutes integer;
  v_hours numeric;
  v_currency text;
  v_recalc numeric;
  v_already numeric;
  v_delta numeric;
  v_spendable numeric;
  v_take numeric;
  v_has_terminal boolean;
  v_has_future boolean;
BEGIN
  IF p_series_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_series FROM rental_series WHERE id = p_series_id FOR UPDATE;
  IF NOT FOUND OR v_series.channel <> 'miniapp' OR v_series.status <> 'active' THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM rentals r
    WHERE r.rental_series_id = p_series_id
      AND r.channel = 'miniapp'
      AND r.lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged')
      AND _renter_slot_ts(r.organization_id, r.rental_date, r.time_start) > v_now
  ) INTO v_has_future;

  IF v_has_future THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM rentals r
    WHERE r.rental_series_id = p_series_id
      AND r.channel = 'miniapp'
      AND r.lifecycle IN ('cancelled', 'hold_deleted', 'auto_deleted')
  ) INTO v_has_terminal;

  IF NOT v_has_terminal THEN
    PERFORM _renter_try_complete_pack(p_series_id);
    RETURN;
  END IF;

  v_currency := _renter_org_currency(v_series.organization_id);

  FOR v_slot IN
    SELECT r.*
    FROM rentals r
    WHERE r.rental_series_id = p_series_id
      AND r.channel = 'miniapp'
      AND _renter_slot_ts(r.organization_id, r.rental_date, r.time_end) <= v_now
      AND r.lifecycle IN ('settled', 'debt', 'prepaid_charged', 'active')
    ORDER BY r.rental_date, r.time_start
  LOOP
    v_one_time := _renter_hour_rate(
      v_series.organization_id, v_series.location_id, 'one_time', v_slot.rental_date
    );
    v_penalty := _renter_hour_rate(
      v_series.organization_id, v_series.location_id, 'penalty', v_slot.rental_date
    );
    IF EXISTS (
      SELECT 1 FROM renters x
      WHERE x.id = v_series.renter_id AND x.penalty_tariff_applied_at IS NOT NULL
    ) THEN
      v_rate := GREATEST(COALESCE(v_one_time, 0), COALESCE(v_penalty, 0));
    ELSE
      v_rate := COALESCE(v_one_time, 0);
    END IF;

    v_minutes := _hhmm_to_minutes(v_slot.time_end) - _hhmm_to_minutes(v_slot.time_start);
    v_hours := v_minutes::numeric / 60;
    v_recalc := _renter_round_money(v_hours * v_rate, v_currency);
    v_already := COALESCE(v_slot.prepay_amount, 0)
      * CASE WHEN v_slot.prepay_charged_at IS NOT NULL THEN 1 ELSE 0 END
      + COALESCE(v_slot.remainder_amount, 0)
      * CASE WHEN v_slot.remainder_charged_at IS NOT NULL THEN 1 ELSE 0 END;
    v_delta := GREATEST(0, v_recalc - v_already);
    IF v_delta <= 0 THEN
      CONTINUE;
    END IF;

    v_spendable := _renter_wallet_spendable(v_series.organization_id, v_series.renter_id);
    v_take := LEAST(v_spendable, v_delta);

    IF v_take > 0 THEN
      PERFORM _renter_wallet_insert_entry(
        v_series.organization_id,
        v_series.renter_id,
        'surcharge_one_time_recalc',
        v_take,
        v_slot.id,
        'surcharge'
      );
    END IF;

    IF v_delta - v_take > 0 THEN
      UPDATE rentals
      SET
        debt_amount = debt_amount + (v_delta - v_take),
        lifecycle = CASE
          WHEN lifecycle IN ('settled', 'prepaid_charged', 'active') THEN 'debt'
          ELSE lifecycle
        END,
        updated_at = now()
      WHERE id = v_slot.id;
    END IF;
  END LOOP;

  UPDATE rental_series
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_series_id
    AND status = 'active';
END;
$$;

COMMENT ON FUNCTION _renter_early_close_pack(uuid) IS
  'R1c: no remaining future dates AND at least one cancelled/hold_deleted/auto_deleted → surcharge used, then series.cancelled. Call after futures are closed. Worker/ban reuse.';

CREATE OR REPLACE FUNCTION _renter_after_pack_slot_terminal(p_series_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM _renter_early_close_pack(p_series_id);
  PERFORM _renter_try_complete_pack(p_series_id);
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
BEGIN
  -- §4.1 p.1 awaiting expired or past start → auto_deleted (no untimely++ until R5)
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
      PERFORM _renter_apply_reliability(v_slot.id, 'untimely', false);
      PERFORM _renter_after_pack_slot_terminal(v_slot.rental_series_id);
    END IF;
  END LOOP;

  -- §4.1 p.2 active ∧ now ≥ time_end → charge prepay then remainder; never auto_deleted
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
      UPDATE rentals
      SET
        lifecycle = 'debt',
        debt_amount = GREATEST(debt_amount, fixed_amount),
        updated_at = now()
      WHERE id = v_slot.id;
    ELSE
      PERFORM _renter_charge_remainder(v_slot.id);
    END IF;
    PERFORM _renter_after_pack_slot_terminal(v_slot.rental_series_id);
  END LOOP;

  -- §4.1 p.3 active ∧ time_start ≤ now < time_end → charge or auto_deleted
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
      PERFORM _renter_apply_reliability(v_slot.id, 'untimely', false);
      PERFORM _renter_after_pack_slot_terminal(v_slot.rental_series_id);
    END IF;
  END LOOP;

  -- §4.1 p.4 active in T−24 window before start → charge or back to awaiting
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
      WHERE id = v_slot.id;
    END IF;
  END LOOP;

  -- §4.1 p.5 prepaid_charged ∧ now ≥ time_end → remainder / debt
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

COMMENT ON FUNCTION _renter_expire_and_catchup(uuid, uuid) IS
  'R1c: §4.1 catch-up/expiry in one pass. R1d worker claims renters and calls this. No untimely++.';

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

  -- awaiting without prepay: hold_deleted (renter uses delete_hold; staff occupancy same)
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
    -- retain 50% (equality at T−24 included)
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
  RETURN v_reason;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_delete_hold_slot(
  p_rental_id uuid,
  p_member_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r rentals%ROWTYPE;
BEGIN
  SELECT * INTO v_r FROM rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND OR v_r.channel <> 'miniapp' THEN
    PERFORM _renter_raise('renter.booking.notCancellable');
  END IF;

  IF v_r.lifecycle IS DISTINCT FROM 'awaiting_payment' OR v_r.prepay_charged_at IS NOT NULL THEN
    PERFORM _renter_raise('renter.cancel.notHold');
  END IF;

  PERFORM _renter_mark_terminal(v_r.id, 'hold_deleted', 'miniapp_hold_deleted', p_member_id);
  PERFORM _renter_after_pack_slot_terminal(v_r.rental_series_id);
  PERFORM _renter_apply_wallet(v_r.organization_id, v_r.renter_id);
END;
$$;

CREATE OR REPLACE FUNCTION _renter_staff_create_renter_ok(p_org_id uuid, p_renter_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r renters%ROWTYPE;
BEGIN
  SELECT * INTO v_r FROM renters WHERE id = p_renter_id AND organization_id = p_org_id;
  IF NOT FOUND THEN
    PERFORM _renter_raise('renter.forbidden');
  END IF;
  IF v_r.telegram_id IS NULL THEN
    PERFORM _renter_raise('renter.booking.noTelegram');
  END IF;
  IF v_r.status IS DISTINCT FROM 'active' THEN
    PERFORM _renter_raise('renter.booking.inactive');
  END IF;
  IF v_r.booking_banned_at IS NOT NULL THEN
    PERFORM _renter_raise('renter.booking.banned');
  END IF;
  IF _renter_wallet_debt_outstanding(p_org_id, p_renter_id) > 0 THEN
    PERFORM _renter_raise('renter.booking.debt');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_create_gates(
  p_org_id uuid,
  p_renter_id uuid,
  p_need_addon boolean
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r renters%ROWTYPE;
BEGIN
  IF p_need_addon AND NOT renter_miniapp_addon_is_active(p_org_id) THEN
    PERFORM _renter_raise('renter.addonInactive');
  END IF;

  IF NOT organization_allows_writes(p_org_id) THEN
    PERFORM _renter_raise('renter.orgWritesDisabled');
  END IF;

  SELECT * INTO v_r FROM renters WHERE id = p_renter_id AND organization_id = p_org_id;
  IF NOT FOUND THEN
    PERFORM _renter_raise('renter.forbidden');
  END IF;
  IF v_r.status IS DISTINCT FROM 'active' THEN
    PERFORM _renter_raise('renter.booking.inactive');
  END IF;
  IF v_r.booking_banned_at IS NOT NULL THEN
    PERFORM _renter_raise('renter.booking.banned');
  END IF;
  IF _renter_wallet_debt_outstanding(p_org_id, p_renter_id) > 0 THEN
    PERFORM _renter_raise('renter.booking.debt');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_public_rental_json(p_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'id', r.id,
    'rental_series_id', r.rental_series_id,
    'location_id', r.location_id,
    'rental_date', r.rental_date,
    'time_start', r.time_start,
    'time_end', r.time_end,
    'channel', r.channel,
    'lifecycle', r.lifecycle,
    'booking_status', r.booking_status,
    'hold_expires_at', r.hold_expires_at,
    'prepay_amount', r.prepay_amount,
    'remainder_amount', r.remainder_amount,
    'debt_amount', r.debt_amount,
    'fixed_amount', r.fixed_amount,
    'currency', r.currency,
    'prepay_charged_at', r.prepay_charged_at,
    'remainder_charged_at', r.remainder_charged_at
  )
  FROM rentals r
  WHERE r.id = p_id;
$$;

REVOKE ALL ON FUNCTION _renter_jwt_app_metadata() FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_raise(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_renter_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_check_rpc_rate_limit(uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_actor_ctx() FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_currency_minor(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_round_money(numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_org_currency(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_slot_ts(uuid, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_compute_hold_expires_at(timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_occupancy_window(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_hour_rate(uuid, uuid, text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_location_has_three_kinds(uuid, uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_effective_kind(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_quote_slot_amounts(uuid, uuid, text, date, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_location_slot_busy(uuid, date, text, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_validate_slot_grid(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_location_channel_ok(uuid, uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_lock_candidate_pairs(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_acquire_miniapp_locks(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_assert_wallet_invariant(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_wallet_insert_entry(uuid, uuid, text, numeric, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_charge_prepay(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_charge_remainder(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_refund_prepay(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_debt_settle(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_fifo_activate(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_apply_wallet(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_apply_reliability(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_mark_terminal(uuid, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_inherited_hold_expires_at(uuid, uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_unfinished_counts(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_try_complete_pack(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_early_close_pack(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_after_pack_slot_terminal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_expire_and_catchup(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_cancel_one_slot(uuid, boolean, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_delete_hold_slot(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_staff_create_renter_ok(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_create_gates(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_public_rental_json(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION auth_renter_id() TO service_role;
GRANT EXECUTE ON FUNCTION _renter_check_rpc_rate_limit(uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_actor_ctx() TO service_role;
GRANT EXECUTE ON FUNCTION _renter_compute_hold_expires_at(timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_location_slot_busy(uuid, date, text, text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_lock_candidate_pairs(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_acquire_miniapp_locks(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_apply_wallet(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_apply_reliability(uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_early_close_pack(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_try_complete_pack(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_expire_and_catchup(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_charge_prepay(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_charge_remainder(uuid) TO service_role;

COMMIT;
