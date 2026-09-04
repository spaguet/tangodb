-- FDB3 / 2.9.56: one reliability outcome + one outbox message per pack series; list_mine series metadata.

BEGIN;

-- =============================================================================
-- 1. Series helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_series_anchor_rental(p_series_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT r.id
  FROM rentals r
  WHERE r.rental_series_id = p_series_id
    AND r.channel = 'miniapp'
  ORDER BY r.rental_date, r.time_start, r.created_at
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION _renter_series_occurrence_count(p_series_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::integer
  FROM rentals r
  WHERE r.rental_series_id = p_series_id
    AND r.channel = 'miniapp';
$$;

CREATE OR REPLACE FUNCTION _renter_telegram_fmt_series_summary(p_series_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_series rental_series%ROWTYPE;
  v_loc text;
  v_count integer;
  v_first rentals%ROWTYPE;
  v_last rentals%ROWTYPE;
BEGIN
  SELECT * INTO v_series FROM rental_series WHERE id = p_series_id;
  IF NOT FOUND THEN
    RETURN 'пакет';
  END IF;

  SELECT l.name INTO v_loc
  FROM locations l
  WHERE l.id = v_series.location_id;

  v_count := _renter_series_occurrence_count(p_series_id);

  SELECT * INTO v_first
  FROM rentals r
  WHERE r.rental_series_id = p_series_id
    AND r.channel = 'miniapp'
  ORDER BY r.rental_date, r.time_start, r.created_at
  LIMIT 1;

  SELECT * INTO v_last
  FROM rentals r
  WHERE r.rental_series_id = p_series_id
    AND r.channel = 'miniapp'
  ORDER BY r.rental_date DESC, r.time_start DESC, r.created_at DESC
  LIMIT 1;

  IF v_first.id IS NULL THEN
    RETURN format('пакет %s занятий, %s', v_count, COALESCE(v_loc, 'зал'));
  END IF;

  RETURN format(
    'пакет %s занятий %s–%s %s–%s, %s',
    v_count,
    to_char(v_first.rental_date, 'DD.MM'),
    to_char(v_last.rental_date, 'DD.MM.YYYY'),
    v_first.time_start,
    v_first.time_end,
    COALESCE(v_loc, 'зал')
  );
END;
$$;

-- =============================================================================
-- 2. Series-level reliability (one on_time / untimely per pack)
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_apply_series_reliability(
  p_series_id uuid,
  p_phase text,
  p_allowed boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_series rental_series%ROWTYPE;
  v_anchor uuid;
  v_inserted boolean := false;
BEGIN
  IF p_series_id IS NULL OR p_phase NOT IN ('on_time', 'untimely') THEN
    RETURN;
  END IF;

  IF p_phase = 'untimely' AND NOT COALESCE(p_allowed, false) THEN
    RETURN;
  END IF;

  SELECT * INTO v_series FROM rental_series WHERE id = p_series_id;
  IF NOT FOUND OR v_series.channel <> 'miniapp' OR v_series.renter_id IS NULL THEN
    RETURN;
  END IF;

  IF _renter_series_occurrence_count(p_series_id) <= 1 THEN
    RETURN;
  END IF;

  v_anchor := _renter_series_anchor_rental(p_series_id);
  IF v_anchor IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    INSERT INTO renter_reliability_events (
      organization_id, renter_id, rental_id, phase
    )
    VALUES (
      v_series.organization_id, v_series.renter_id, v_anchor, p_phase
    );
    v_inserted := true;
  EXCEPTION WHEN unique_violation THEN
    RETURN;
  END;

  IF NOT v_inserted THEN
    RETURN;
  END IF;

  IF p_phase = 'on_time' THEN
    UPDATE renters
    SET on_time_count = on_time_count + 1, updated_at = now()
    WHERE id = v_series.renter_id
      AND organization_id = v_series.organization_id;
  ELSE
    UPDATE renters
    SET untimely_count = untimely_count + 1, updated_at = now()
    WHERE id = v_series.renter_id
      AND organization_id = v_series.organization_id;

    PERFORM _renter_evaluate_reliability_thresholds(v_series.organization_id, v_series.renter_id);
  END IF;
END;
$$;

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
DECLARE
  v_r rentals%ROWTYPE;
  v_inserted boolean := false;
BEGIN
  IF p_phase NOT IN ('on_time', 'untimely') THEN
    RETURN;
  END IF;

  IF p_phase = 'untimely' AND NOT COALESCE(p_allowed, false) THEN
    RETURN;
  END IF;

  SELECT * INTO v_r FROM rentals WHERE id = p_rental_id;
  IF NOT FOUND OR v_r.channel <> 'miniapp' OR v_r.renter_id IS NULL THEN
    RETURN;
  END IF;

  IF v_r.rental_series_id IS NOT NULL
     AND _renter_series_occurrence_count(v_r.rental_series_id) > 1 THEN
    RETURN;
  END IF;

  BEGIN
    INSERT INTO renter_reliability_events (
      organization_id, renter_id, rental_id, phase
    )
    VALUES (
      v_r.organization_id, v_r.renter_id, p_rental_id, p_phase
    );
    v_inserted := true;
  EXCEPTION WHEN unique_violation THEN
    RETURN;
  END;

  IF NOT v_inserted THEN
    RETURN;
  END IF;

  IF p_phase = 'on_time' THEN
    UPDATE renters
    SET on_time_count = on_time_count + 1, updated_at = now()
    WHERE id = v_r.renter_id
      AND organization_id = v_r.organization_id;
  ELSE
    UPDATE renters
    SET untimely_count = untimely_count + 1, updated_at = now()
    WHERE id = v_r.renter_id
      AND organization_id = v_r.organization_id;

    PERFORM _renter_evaluate_reliability_thresholds(v_r.organization_id, v_r.renter_id);
  END IF;
END;
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
  v_completed boolean := false;
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

    IF FOUND THEN
      v_completed := true;
    END IF;
  END IF;

  IF v_completed AND _renter_series_occurrence_count(p_series_id) > 1 THEN
    PERFORM _renter_apply_series_reliability(p_series_id, 'on_time', true);
  END IF;
END;
$$;

-- =============================================================================
-- 3. Series-level outbox (one message per event, not per occurrence)
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_enqueue_series_hold_awaiting(p_series_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_series rental_series%ROWTYPE;
  v_anchor uuid;
BEGIN
  SELECT * INTO v_series FROM rental_series WHERE id = p_series_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_anchor := _renter_series_anchor_rental(p_series_id);

  RETURN _renter_enqueue_telegram(
    v_series.organization_id,
    v_series.renter_id,
    'hold_awaiting',
    format(
      'Пакет удерживается: %s. Ожидает оплаты. Автоудаление через %s.',
      _renter_telegram_fmt_series_summary(p_series_id),
      _renter_telegram_fmt_hold_timer(v_series.hold_expires_at)
    ),
    'series_hold_awaiting:' || p_series_id::text,
    v_anchor
  );
END;
$$;

CREATE OR REPLACE FUNCTION _renter_enqueue_series_activated(p_series_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_series rental_series%ROWTYPE;
  v_anchor uuid;
  v_count integer;
BEGIN
  SELECT * INTO v_series FROM rental_series WHERE id = p_series_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_count := _renter_series_occurrence_count(p_series_id);
  IF v_count <= 1 THEN
    RETURN NULL;
  END IF;

  v_anchor := _renter_series_anchor_rental(p_series_id);

  RETURN _renter_enqueue_telegram(
    v_series.organization_id,
    v_series.renter_id,
    'booking_activated',
    format('Пакет активирован: %s (%s дат).', _renter_telegram_fmt_series_summary(p_series_id), v_count),
    'series_activated:' || p_series_id::text,
    v_anchor
  );
END;
$$;

CREATE OR REPLACE FUNCTION _renter_enqueue_series_auto_deleted(p_series_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_series rental_series%ROWTYPE;
  v_anchor uuid;
BEGIN
  SELECT * INTO v_series FROM rental_series WHERE id = p_series_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_anchor := _renter_series_anchor_rental(p_series_id);

  RETURN _renter_enqueue_telegram(
    v_series.organization_id,
    v_series.renter_id,
    'auto_deleted',
    format('Холд пакета автоматически удалён: %s.', _renter_telegram_fmt_series_summary(p_series_id)),
    'series_auto_deleted:' || p_series_id::text,
    v_anchor
  );
END;
$$;

CREATE OR REPLACE FUNCTION _renter_maybe_enqueue_series_activated(p_series_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_series_id IS NULL OR _renter_series_occurrence_count(p_series_id) <= 1 THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM rentals r
    WHERE r.rental_series_id = p_series_id
      AND r.channel = 'miniapp'
      AND r.lifecycle = 'awaiting_payment'
  ) THEN
    RETURN;
  END IF;

  PERFORM _renter_enqueue_series_activated(p_series_id);
END;
$$;

CREATE OR REPLACE FUNCTION _renter_place_series_on_hold(p_org_id uuid, p_series_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hold timestamptz;
BEGIN
  v_hold := _renter_compute_series_hold_expires_at(p_org_id, p_series_id);

  UPDATE rental_series
  SET
    status = 'awaiting_payment',
    hold_expires_at = v_hold,
    updated_at = now()
  WHERE id = p_series_id;

  UPDATE rentals
  SET hold_expires_at = v_hold, updated_at = now()
  WHERE rental_series_id = p_series_id
    AND channel = 'miniapp'
    AND lifecycle = 'awaiting_payment';

  PERFORM _renter_enqueue_series_hold_awaiting(p_series_id);

  RETURN v_hold;
END;
$$;

DROP FUNCTION IF EXISTS _renter_mark_terminal(uuid, text, text, uuid);

CREATE OR REPLACE FUNCTION _renter_mark_terminal(
  p_rental_id uuid,
  p_lifecycle text,
  p_reason text,
  p_cancelled_by uuid,
  p_suppress_outbox boolean DEFAULT false
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

  IF FOUND AND p_lifecycle = 'auto_deleted' AND NOT COALESCE(p_suppress_outbox, false) THEN
    PERFORM _renter_enqueue_auto_deleted(p_rental_id);
  END IF;
END;
$$;

-- =============================================================================
-- 4. Atomic activation — one outbox row per series
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_activate_series_holds(p_org_id uuid, p_renter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_series record;
  v_slot record;
  v_now timestamptz := now();
  v_start timestamptz;
  v_total_prepay numeric;
  v_available numeric;
  v_remaining integer;
  v_activated boolean := false;
BEGIN
  FOR v_series IN
    SELECT rs.*
    FROM rental_series rs
    WHERE rs.organization_id = p_org_id
      AND rs.renter_id = p_renter_id
      AND rs.channel = 'miniapp'
      AND rs.status = 'awaiting_payment'
      AND rs.hold_expires_at IS NOT NULL
      AND v_now < rs.hold_expires_at
    ORDER BY rs.hold_expires_at, rs.created_at
    FOR UPDATE
  LOOP
    v_activated := false;

    SELECT COALESCE(sum(r.prepay_amount), 0)
    INTO v_total_prepay
    FROM rentals r
    WHERE r.rental_series_id = v_series.id
      AND r.channel = 'miniapp'
      AND r.lifecycle = 'awaiting_payment';

    IF v_total_prepay <= 0 THEN
      CONTINUE;
    END IF;

    v_available := _renter_wallet_available(p_org_id, p_renter_id);
    IF v_available < v_total_prepay THEN
      CONTINUE;
    END IF;

    PERFORM 1
    FROM rentals r
    WHERE r.rental_series_id = v_series.id
      AND r.channel = 'miniapp'
      AND r.lifecycle = 'awaiting_payment'
    FOR UPDATE;

    FOR v_slot IN
      SELECT r.*
      FROM rentals r
      WHERE r.rental_series_id = v_series.id
        AND r.channel = 'miniapp'
        AND r.lifecycle = 'awaiting_payment'
      ORDER BY r.rental_date, r.time_start, r.created_at
    LOOP
      v_start := _renter_slot_ts(p_org_id, v_slot.rental_date, v_slot.time_start);

      IF v_now >= v_start THEN
        RAISE EXCEPTION 'renter.series.activationPastStart';
      END IF;

      IF v_now >= v_start - interval '24 hours' THEN
        IF NOT _renter_charge_prepay(v_slot.id) THEN
          RAISE EXCEPTION 'renter.series.activationChargeFailed';
        END IF;
      ELSE
        UPDATE rentals
        SET
          lifecycle = 'active',
          hold_expires_at = NULL,
          updated_at = now()
        WHERE id = v_slot.id
          AND lifecycle = 'awaiting_payment';
      END IF;
    END LOOP;

    SELECT count(*)
    INTO v_remaining
    FROM rentals r
    WHERE r.rental_series_id = v_series.id
      AND r.channel = 'miniapp'
      AND r.lifecycle = 'awaiting_payment';

    IF v_remaining > 0 THEN
      RAISE EXCEPTION 'renter.series.partialActivationForbidden';
    END IF;

    UPDATE rental_series
    SET
      status = 'active',
      hold_expires_at = NULL,
      updated_at = now()
    WHERE id = v_series.id;

    v_activated := true;

    IF v_activated THEN
      PERFORM _renter_maybe_enqueue_series_activated(v_series.id);
    END IF;
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
  v_changed boolean;
BEGIN
  PERFORM _renter_activate_series_holds(p_org_id, p_renter_id);

  FOR v_slot IN
    SELECT r.*
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.lifecycle = 'awaiting_payment'
      AND NOT EXISTS (
        SELECT 1
        FROM rental_series rs
        WHERE rs.id = r.rental_series_id
          AND rs.status = 'awaiting_payment'
      )
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

    v_changed := false;

    IF v_now >= v_start - interval '24 hours' AND v_now < v_start THEN
      IF _renter_charge_prepay(v_slot.id) THEN
        v_changed := true;
      END IF;
    ELSE
      UPDATE rentals
      SET lifecycle = 'active', updated_at = now()
      WHERE id = v_slot.id
        AND lifecycle = 'awaiting_payment';
      IF FOUND THEN
        v_changed := true;
      END IF;
      PERFORM _renter_assert_wallet_invariant(p_org_id, p_renter_id);
    END IF;

    IF v_changed AND v_slot.rental_series_id IS NOT NULL THEN
      PERFORM _renter_maybe_enqueue_series_activated(v_slot.rental_series_id);
    END IF;
  END LOOP;
END;
$$;

-- =============================================================================
-- 5. Worker — suppress per-slot outbox on series expiry
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_expire_and_catchup(p_org_id uuid, p_renter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_series record;
  v_slot record;
  v_start timestamptz;
  v_end timestamptz;
  v_charged boolean;
  v_allowed boolean;
  v_was_debt boolean;
BEGIN
  v_allowed := _renter_reliability_tick_allowed(p_org_id);

  FOR v_series IN
    SELECT rs.*
    FROM rental_series rs
    WHERE rs.organization_id = p_org_id
      AND rs.renter_id = p_renter_id
      AND rs.channel = 'miniapp'
      AND rs.status = 'awaiting_payment'
      AND rs.hold_expires_at IS NOT NULL
      AND v_now >= rs.hold_expires_at
  LOOP
    FOR v_slot IN
      SELECT r.*
      FROM rentals r
      WHERE r.rental_series_id = v_series.id
        AND r.lifecycle = 'awaiting_payment'
    LOOP
      PERFORM _renter_mark_terminal(v_slot.id, 'auto_deleted', 'miniapp_auto_deleted', NULL, true);
    END LOOP;

    PERFORM _renter_apply_series_reliability(v_series.id, 'untimely', v_allowed);
    PERFORM _renter_enqueue_series_auto_deleted(v_series.id);

    UPDATE rental_series
    SET status = 'cancelled', hold_expires_at = NULL, updated_at = now()
    WHERE id = v_series.id;

    PERFORM _renter_after_pack_slot_terminal(v_series.id);
  END LOOP;

  FOR v_slot IN
    SELECT r.*
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.lifecycle = 'awaiting_payment'
      AND NOT EXISTS (
        SELECT 1
        FROM rental_series rs
        WHERE rs.id = r.rental_series_id
          AND rs.status = 'awaiting_payment'
      )
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

-- =============================================================================
-- 6. list_mine read model — series metadata for in-app timeline
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_public_rental_json(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_r rentals%ROWTYPE;
  v_ctx record;
  v_is_renter boolean := true;
  v_can_delete_hold boolean;
  v_can_cancel_occ boolean;
  v_can_cancel_pack boolean;
  v_series rental_series%ROWTYPE;
  v_series_count integer := 0;
  v_series_index integer := 0;
BEGIN
  SELECT * INTO v_r FROM rentals WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  BEGIN
    SELECT * INTO v_ctx FROM _renter_actor_ctx();
    v_is_renter := v_ctx.is_renter;
  EXCEPTION
    WHEN OTHERS THEN
      v_is_renter := true;
  END;

  v_can_delete_hold := _renter_can_delete_hold_row(v_r, v_is_renter);
  v_can_cancel_occ := _renter_can_cancel_occurrence_row(v_r, v_is_renter);
  v_can_cancel_pack := _renter_can_cancel_pack_row(v_r, v_is_renter);

  IF v_r.rental_series_id IS NOT NULL THEN
    SELECT * INTO v_series FROM rental_series WHERE id = v_r.rental_series_id;
    v_series_count := _renter_series_occurrence_count(v_r.rental_series_id);
    SELECT count(*)::integer
    INTO v_series_index
    FROM rentals r2
    WHERE r2.rental_series_id = v_r.rental_series_id
      AND r2.channel = 'miniapp'
      AND (r2.rental_date, r2.time_start, r2.created_at)
        <= (v_r.rental_date, v_r.time_start, v_r.created_at);
  END IF;

  RETURN jsonb_build_object(
    'id', v_r.id,
    'rental_series_id', v_r.rental_series_id,
    'location_id', v_r.location_id,
    'rental_date', v_r.rental_date,
    'time_start', v_r.time_start,
    'time_end', v_r.time_end,
    'channel', v_r.channel,
    'lifecycle', v_r.lifecycle,
    'booking_status', v_r.booking_status,
    'hold_expires_at', v_r.hold_expires_at,
    'prepay_amount', v_r.prepay_amount,
    'remainder_amount', v_r.remainder_amount,
    'debt_amount', v_r.debt_amount,
    'fixed_amount', v_r.fixed_amount,
    'currency', v_r.currency,
    'prepay_charged_at', v_r.prepay_charged_at,
    'remainder_charged_at', v_r.remainder_charged_at,
    'can_delete_hold', v_can_delete_hold,
    'can_cancel_occurrence', v_can_cancel_occ,
    'can_cancel_pack', v_can_cancel_pack,
    'series_status', v_series.status,
    'series_hold_expires_at', v_series.hold_expires_at,
    'series_occurrence_count', v_series_count,
    'series_occurrence_index', v_series_index
  );
END;
$$;

COMMENT ON FUNCTION _renter_apply_series_reliability(uuid, text, boolean) IS
  'FDB3: one on_time/untimely per multi-occurrence miniapp pack series.';

COMMENT ON FUNCTION _renter_apply_reliability(uuid, text, boolean) IS
  'R5/FDB3: per-slot reliability; pack occurrences defer to _renter_apply_series_reliability.';

COMMENT ON FUNCTION _renter_expire_and_catchup(uuid, uuid) IS
  'R1c/R1d/R4/FDB1/FDB3: series expiry one untimely + one outbox; slots suppressed.';

REVOKE ALL ON FUNCTION _renter_series_anchor_rental(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_series_occurrence_count(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_telegram_fmt_series_summary(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_apply_series_reliability(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_maybe_enqueue_series_activated(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_enqueue_series_hold_awaiting(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_enqueue_series_activated(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_enqueue_series_auto_deleted(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION _renter_series_anchor_rental(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_series_occurrence_count(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_telegram_fmt_series_summary(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_apply_series_reliability(uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_maybe_enqueue_series_activated(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_enqueue_series_hold_awaiting(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_enqueue_series_activated(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_enqueue_series_auto_deleted(uuid) TO service_role;

COMMIT;
