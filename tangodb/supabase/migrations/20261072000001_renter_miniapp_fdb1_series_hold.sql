-- FDB1 / 2.9.54: series-level hold for miniapp pack (variant B §1.5).
-- One hold_expires_at on rental_series; pack without full balance occupies grid instead of ROLLBACK.

BEGIN;

-- =============================================================================
-- 1. rental_series lifecycle columns
-- =============================================================================

ALTER TABLE rental_series
  ADD COLUMN IF NOT EXISTS hold_expires_at timestamptz;

ALTER TABLE rental_series
  DROP CONSTRAINT IF EXISTS rental_series_status_chk;

ALTER TABLE rental_series
  DROP CONSTRAINT IF EXISTS rental_series_status_check;

ALTER TABLE rental_series
  ADD CONSTRAINT rental_series_status_chk
    CHECK (status IN ('active', 'awaiting_payment', 'cancelled', 'completed'));

ALTER TABLE rental_series
  DROP CONSTRAINT IF EXISTS rental_series_miniapp_hold_chk;

ALTER TABLE rental_series
  ADD CONSTRAINT rental_series_miniapp_hold_chk
    CHECK (
      NOT (channel = 'miniapp' AND status = 'awaiting_payment')
      OR hold_expires_at IS NOT NULL
    );

CREATE INDEX IF NOT EXISTS idx_rental_series_miniapp_hold
  ON rental_series (organization_id, renter_id, hold_expires_at)
  WHERE channel = 'miniapp' AND status = 'awaiting_payment';

COMMENT ON COLUMN rental_series.hold_expires_at IS
  'FDB1: single pack hold timer = min(created_at+24h, earliest occurrence time_start). NULL when active/completed.';

-- =============================================================================
-- 2. Series hold helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_compute_series_hold_expires_at(p_org_id uuid, p_series_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT _renter_compute_hold_expires_at(
    rs.created_at,
    MIN(_renter_slot_ts(p_org_id, r.rental_date, r.time_start))
  )
  FROM rental_series rs
  JOIN rentals r
    ON r.rental_series_id = rs.id
   AND r.channel = 'miniapp'
  WHERE rs.id = p_series_id
  GROUP BY rs.created_at;
$$;

COMMENT ON FUNCTION _renter_compute_series_hold_expires_at(uuid, uuid) IS
  'FDB1: series hold = min(created_at+24h, earliest slot start) per §1.5 variant B.';

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

  RETURN v_hold;
END;
$$;

COMMENT ON FUNCTION _renter_place_series_on_hold(uuid, uuid) IS
  'FDB1: mark miniapp series awaiting_payment; sync occurrence hold_expires_at to series timer.';

-- =============================================================================
-- 3. FIFO — skip pack slots while series is on hold (activation = FDB2)
-- =============================================================================

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

-- =============================================================================
-- 4. Worker — series-level expiry (one untimely per series until FDB3)
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
  v_first_rental uuid;
BEGIN
  v_allowed := _renter_reliability_tick_allowed(p_org_id);

  -- FDB1: expired series hold — all awaiting slots in one pass, one untimely
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
    SELECT r.id
    INTO v_first_rental
    FROM rentals r
    WHERE r.rental_series_id = v_series.id
      AND r.lifecycle = 'awaiting_payment'
    ORDER BY r.rental_date, r.time_start, r.created_at
    LIMIT 1;

    FOR v_slot IN
      SELECT r.*
      FROM rentals r
      WHERE r.rental_series_id = v_series.id
        AND r.lifecycle = 'awaiting_payment'
    LOOP
      PERFORM _renter_mark_terminal(v_slot.id, 'auto_deleted', 'miniapp_auto_deleted', NULL);
    END LOOP;

    IF v_first_rental IS NOT NULL THEN
      PERFORM _renter_apply_reliability(v_first_rental, 'untimely', v_allowed);
    END IF;

    UPDATE rental_series
    SET status = 'cancelled', hold_expires_at = NULL, updated_at = now()
    WHERE id = v_series.id;

    PERFORM _renter_after_pack_slot_terminal(v_series.id);
  END LOOP;

  -- §4.1 p.1 awaiting expired or past start → auto_deleted (one-time / activated pack slots)
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

COMMENT ON FUNCTION _renter_expire_and_catchup(uuid, uuid) IS
  'R1c/R1d/R4/FDB1: catch-up/expiry; pack series on hold expire atomically with one untimely.';

-- =============================================================================
-- 5. renter_create_recurring_pack — series hold instead of packIncomplete ROLLBACK
-- =============================================================================

CREATE OR REPLACE FUNCTION renter_create_recurring_pack(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ctx record;
  v_org uuid;
  v_renter uuid;
  v_member uuid;
  v_loc uuid;
  v_from date;
  v_to date;
  v_start text;
  v_end text;
  v_key text;
  v_fp text;
  v_weekdays int[];
  v_existing rental_series%ROWTYPE;
  v_patterns jsonb;
  v_occ record;
  v_extra jsonb := '[]'::jsonb;
  v_series_id uuid;
  v_id uuid;
  v_ids uuid[] := '{}';
  v_counts record;
  v_n integer := 0;
  v_awaiting integer;
  v_check jsonb;
  v_reasons text[];
  v_total_prepay numeric;
  v_available numeric;
  v_hold timestamptz;
BEGIN
  SELECT * INTO v_ctx FROM _renter_actor_ctx();
  v_org := v_ctx.org_id;
  v_member := v_ctx.member_id;

  IF v_ctx.is_renter THEN
    v_renter := v_ctx.jwt_renter_id;
  ELSE
    v_renter := NULLIF(p_payload ->> 'renter_id', '')::uuid;
    IF v_renter IS NULL THEN
      PERFORM _renter_raise('renter.booking.fieldsInvalid');
    END IF;
    PERFORM _renter_staff_create_renter_ok(v_org, v_renter);
  END IF;

  v_loc := NULLIF(p_payload ->> 'location_id', '')::uuid;
  v_from := (p_payload ->> 'valid_from')::date;
  v_to := (p_payload ->> 'valid_to')::date;
  v_start := normalize_hhmm(p_payload ->> 'time_start');
  v_end := normalize_hhmm(p_payload ->> 'time_end');
  v_key := NULLIF(trim(p_payload ->> 'idempotency_key'), '');

  IF p_payload -> 'weekdays' IS NOT NULL THEN
    SELECT COALESCE(array_agg(value::int), '{}')
    INTO v_weekdays
    FROM jsonb_array_elements_text(p_payload -> 'weekdays') t(value);
  ELSE
    SELECT COALESCE(array_agg(value::int), '{}')
    INTO v_weekdays
    FROM jsonb_array_elements_text(p_payload -> 'days_of_week') t(value);
  END IF;

  IF v_loc IS NULL OR v_from IS NULL OR v_to IS NULL OR cardinality(v_weekdays) = 0 THEN
    PERFORM _renter_raise('renter.booking.fieldsInvalid');
  END IF;

  v_check := _renter_validate_pack_booking(
    v_org, v_renter, v_loc, v_from, v_to, v_weekdays, v_start, v_end, true
  );
  v_fp := v_check ->> 'fingerprint';
  v_n := COALESCE((v_check ->> 'occurrence_count')::int, 0);

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM rental_series rs
    WHERE rs.organization_id = v_org AND rs.idempotency_key = v_key;

    IF FOUND THEN
      IF _renter_pack_series_fingerprint(v_existing.id) IS DISTINCT FROM v_fp THEN
        PERFORM _renter_raise('renter.booking.idempotencyMismatch');
      END IF;
      SELECT COALESCE(array_agg(r.id), '{}')
      INTO v_ids
      FROM rentals r
      WHERE r.rental_series_id = v_existing.id;
      RETURN jsonb_build_object(
        'success', true,
        'already_applied', true,
        'series_id', v_existing.id,
        'rental_ids', to_jsonb(v_ids),
        'series_status', v_existing.status,
        'hold_expires_at', v_existing.hold_expires_at
      );
    END IF;
  END IF;

  SELECT COALESCE(array_agg(value), '{}')
  INTO v_reasons
  FROM jsonb_array_elements_text(v_check -> 'reasons') t(value);
  PERFORM _renter_raise_first_reason(v_reasons);

  v_patterns := jsonb_build_array(
    jsonb_build_object(
      'days_of_week', to_jsonb(v_weekdays),
      'time_start', v_start,
      'time_end', v_end
    )
  );

  FOR v_occ IN
    SELECT occurrence_date, time_start, time_end
    FROM _generate_series_occurrence_dates(v_from, v_to, v_patterns)
  LOOP
    v_extra := v_extra || jsonb_build_array(
      jsonb_build_object('location_id', v_loc, 'date', v_occ.occurrence_date)
    );
  END LOOP;

  PERFORM _renter_acquire_miniapp_locks(v_org, v_renter, v_extra);
  PERFORM _renter_create_gates(v_org, v_renter, true);

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM rental_series rs
    WHERE rs.organization_id = v_org AND rs.idempotency_key = v_key;

    IF FOUND THEN
      IF _renter_pack_series_fingerprint(v_existing.id) IS DISTINCT FROM v_fp THEN
        PERFORM _renter_raise('renter.booking.idempotencyMismatch');
      END IF;
      SELECT COALESCE(array_agg(r.id), '{}')
      INTO v_ids
      FROM rentals r
      WHERE r.rental_series_id = v_existing.id;
      RETURN jsonb_build_object(
        'success', true,
        'already_applied', true,
        'series_id', v_existing.id,
        'rental_ids', to_jsonb(v_ids),
        'series_status', v_existing.status,
        'hold_expires_at', v_existing.hold_expires_at
      );
    END IF;
  END IF;

  SELECT * INTO v_counts FROM _renter_unfinished_counts(v_org, v_renter);
  IF v_counts.unfinished_n + v_n > 32 THEN
    PERFORM _renter_raise('renter.booking.unfinishedLimit');
  END IF;

  INSERT INTO rental_series (
    organization_id, renter_id, contract_id, location_id, tariff_id,
    channel, valid_from, valid_to, status, purpose, idempotency_key,
    payload_fingerprint, created_by
  )
  VALUES (
    v_org, v_renter, NULL, v_loc, NULL,
    'miniapp', v_from, v_to, 'active',
    NULLIF(trim(p_payload ->> 'purpose'), ''),
    v_key, v_fp, v_member
  )
  RETURNING id INTO v_series_id;

  INSERT INTO rental_series_patterns (organization_id, series_id, days_of_week, time_start, time_end)
  VALUES (v_org, v_series_id, v_weekdays, v_start, v_end);

  FOR v_occ IN
    SELECT occurrence_date, time_start, time_end
    FROM _generate_series_occurrence_dates(v_from, v_to, v_patterns)
  LOOP
    v_id := _renter_insert_occurrence(
      v_org,
      v_renter,
      v_loc,
      v_occ.occurrence_date,
      v_occ.time_start,
      v_occ.time_end,
      'recurring',
      v_series_id,
      CASE WHEN v_key IS NULL THEN NULL ELSE v_key || ':' || v_occ.occurrence_date::text END,
      v_member
    );
    v_ids := v_ids || v_id;
  END LOOP;

  SELECT COALESCE(sum(r.prepay_amount), 0)
  INTO v_total_prepay
  FROM rentals r
  WHERE r.rental_series_id = v_series_id;

  v_available := _renter_wallet_available(v_org, v_renter);

  IF v_available >= v_total_prepay THEN
    PERFORM _renter_apply_wallet(v_org, v_renter);
  END IF;

  SELECT count(*)
  INTO v_awaiting
  FROM rentals r
  WHERE r.rental_series_id = v_series_id
    AND r.lifecycle = 'awaiting_payment';

  IF v_awaiting > 0 THEN
    UPDATE rentals
    SET lifecycle = 'awaiting_payment', updated_at = now()
    WHERE rental_series_id = v_series_id
      AND channel = 'miniapp'
      AND lifecycle IN ('active', 'prepaid_charged')
      AND prepay_charged_at IS NULL;

    v_hold := _renter_place_series_on_hold(v_org, v_series_id);

    RETURN jsonb_build_object(
      'success', true,
      'series_id', v_series_id,
      'rental_ids', to_jsonb(v_ids),
      'occurrence_count', v_n,
      'series_status', 'awaiting_payment',
      'hold_expires_at', v_hold
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'series_id', v_series_id,
    'rental_ids', to_jsonb(v_ids),
    'occurrence_count', v_n,
    'series_status', 'active'
  );
EXCEPTION
  WHEN unique_violation THEN
    IF v_key IS NOT NULL THEN
      SELECT * INTO v_existing
      FROM rental_series rs
      WHERE rs.organization_id = v_org AND rs.idempotency_key = v_key;
      IF FOUND THEN
        IF _renter_pack_series_fingerprint(v_existing.id) IS DISTINCT FROM v_fp THEN
          RETURN jsonb_build_object('success', false, 'error', 'renter.booking.idempotencyMismatch');
        END IF;
        SELECT COALESCE(array_agg(r.id), '{}')
        INTO v_ids
        FROM rentals r
        WHERE r.rental_series_id = v_existing.id;
        RETURN jsonb_build_object(
          'success', true,
          'already_applied', true,
          'series_id', v_existing.id,
          'rental_ids', to_jsonb(v_ids),
          'series_status', v_existing.status,
          'hold_expires_at', v_existing.hold_expires_at
        );
      END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'renter.booking.duplicate');
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.booking.fieldsInvalid');
END;
$$;

COMMENT ON FUNCTION renter_create_recurring_pack(jsonb) IS
  'R1c/FA3/FA5/FB2/FDB1: pack create; series-level hold when balance insufficient (variant B).';

REVOKE ALL ON FUNCTION _renter_compute_series_hold_expires_at(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_place_series_on_hold(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION _renter_compute_series_hold_expires_at(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_place_series_on_hold(uuid, uuid) TO service_role;

COMMIT;
