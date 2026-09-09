-- Pack early-close surcharge: staff review instead of automatic one-time recalc.
-- Incremental occurrence cancel or multi-week usage → no review queue.
-- Bulk pack cancel / ban with week-1-only usage → pending review for staff.

BEGIN;

-- =============================================================================
-- 1. Review queue table
-- =============================================================================

CREATE TABLE IF NOT EXISTS rental_series_surcharge_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rental_series_id uuid NOT NULL REFERENCES rental_series(id) ON DELETE CASCADE,
  renter_id uuid NOT NULL REFERENCES renters(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'applied', 'waived')),
  suggested_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (suggested_amount >= 0),
  currency text NOT NULL,
  cancel_mode text NOT NULL CHECK (cancel_mode IN ('bulk_pack', 'ban')),
  used_week_count integer NOT NULL DEFAULT 1 CHECK (used_week_count >= 1),
  reason_code text NOT NULL DEFAULT 'week1_only_bulk_cancel',
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES organization_members(id),
  review_notes text,
  applied_at timestamptz,
  idempotency_key uuid,
  CONSTRAINT rental_series_surcharge_reviews_series_unique UNIQUE (rental_series_id)
);

CREATE INDEX IF NOT EXISTS rental_series_surcharge_reviews_org_status_idx
  ON rental_series_surcharge_reviews (organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS rental_series_surcharge_reviews_renter_idx
  ON rental_series_surcharge_reviews (organization_id, renter_id, status);

ALTER TABLE rental_series_surcharge_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY rental_series_surcharge_reviews_staff_read ON rental_series_surcharge_reviews
  FOR SELECT
  USING (
    organization_id = auth_organization_id()
    AND (member_can_manage_rentals() OR can_read_financial())
  );

CREATE POLICY rental_series_surcharge_reviews_staff_write ON rental_series_surcharge_reviews
  FOR UPDATE
  USING (
    organization_id = auth_organization_id()
    AND (member_can_manage_rentals() OR can_read_financial())
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND (member_can_manage_rentals() OR can_read_financial())
  );

COMMENT ON TABLE rental_series_surcharge_reviews IS
  'Mini App pack early-close: staff-reviewed one-time tariff recalc (no auto-apply).';

-- =============================================================================
-- 2. Helpers — used weeks, surcharge preview/apply
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_pack_used_week_count(p_series_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (
      SELECT count(DISTINCT ((r.rental_date - rs.valid_from) / 7)::integer)
      FROM rentals r
      JOIN rental_series rs ON rs.id = r.rental_series_id
      WHERE r.rental_series_id = p_series_id
        AND r.channel = 'miniapp'
        AND _renter_slot_ts(r.organization_id, r.rental_date, r.time_end) <= now()
        AND r.lifecycle IN ('settled', 'debt', 'prepaid_charged', 'active')
    ),
    0
  )::integer;
$$;

CREATE OR REPLACE FUNCTION _renter_compute_pack_surcharge(p_series_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
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
  v_total numeric := 0;
  v_items jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_series FROM rental_series WHERE id = p_series_id;
  IF NOT FOUND OR v_series.channel <> 'miniapp' THEN
    RETURN jsonb_build_object('total', 0, 'currency', 'RUB', 'items', '[]'::jsonb);
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

    IF v_delta > 0 THEN
      v_total := v_total + v_delta;
      v_items := v_items || jsonb_build_array(
        jsonb_build_object(
          'rental_id', v_slot.id,
          'rental_date', v_slot.rental_date,
          'delta', v_delta
        )
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'total', v_total,
    'currency', v_currency,
    'items', v_items
  );
END;
$$;

CREATE OR REPLACE FUNCTION _renter_apply_pack_surcharge(p_series_id uuid)
RETURNS numeric
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
  v_applied numeric := 0;
BEGIN
  SELECT * INTO v_series FROM rental_series WHERE id = p_series_id FOR UPDATE;
  IF NOT FOUND OR v_series.channel <> 'miniapp' THEN
    RETURN 0;
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
    FOR UPDATE
  LOOP
    IF EXISTS (
      SELECT 1 FROM renter_wallet_ledger w
      WHERE w.rental_id = v_slot.id
        AND w.entry_type = 'surcharge_one_time_recalc'
    ) THEN
      CONTINUE;
    END IF;

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
      v_applied := v_applied + v_take;
    END IF;

    IF v_delta - v_take > 0 THEN
      UPDATE rentals
      SET
        debt_amount = (v_delta - v_take),
        lifecycle = CASE
          WHEN lifecycle IN ('settled', 'prepaid_charged', 'active') THEN 'debt'
          ELSE lifecycle
        END,
        updated_at = now()
      WHERE id = v_slot.id;
      v_applied := v_applied + (v_delta - v_take);
    END IF;
  END LOOP;

  RETURN v_applied;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_maybe_queue_pack_surcharge_review(
  p_series_id uuid,
  p_cancel_mode text DEFAULT 'incremental'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_series rental_series%ROWTYPE;
  v_used_weeks integer;
  v_preview jsonb;
  v_total numeric;
  v_currency text;
BEGIN
  IF p_series_id IS NULL OR p_cancel_mode NOT IN ('bulk_pack', 'ban') THEN
    RETURN;
  END IF;

  SELECT * INTO v_series FROM rental_series WHERE id = p_series_id;
  IF NOT FOUND OR v_series.channel <> 'miniapp' THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM rental_series_surcharge_reviews r
    WHERE r.rental_series_id = p_series_id
  ) THEN
    RETURN;
  END IF;

  v_used_weeks := _renter_pack_used_week_count(p_series_id);
  IF v_used_weeks >= 2 THEN
    RETURN;
  END IF;

  v_preview := _renter_compute_pack_surcharge(p_series_id);
  v_total := COALESCE((v_preview ->> 'total')::numeric, 0);
  v_currency := COALESCE(v_preview ->> 'currency', _renter_org_currency(v_series.organization_id));

  IF v_total <= 0 THEN
    RETURN;
  END IF;

  INSERT INTO rental_series_surcharge_reviews (
    organization_id,
    rental_series_id,
    renter_id,
    status,
    suggested_amount,
    currency,
    cancel_mode,
    used_week_count,
    reason_code
  )
  VALUES (
    v_series.organization_id,
    p_series_id,
    v_series.renter_id,
    'pending',
    v_total,
    v_currency,
    p_cancel_mode,
    v_used_weeks,
    'week1_only_bulk_cancel'
  );
END;
$$;

-- =============================================================================
-- 3. Early close — close pack, queue review (no auto surcharge)
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_early_close_pack(
  p_series_id uuid,
  p_cancel_mode text DEFAULT 'incremental'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_series rental_series%ROWTYPE;
  v_now timestamptz := now();
  v_has_future boolean;
  v_has_terminal boolean;
BEGIN
  IF p_series_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_series FROM rental_series WHERE id = p_series_id FOR UPDATE;
  IF NOT FOUND
     OR v_series.channel <> 'miniapp'
     OR v_series.status NOT IN ('active', 'awaiting_payment') THEN
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

  IF v_series.status = 'awaiting_payment' THEN
    UPDATE rental_series
    SET status = 'cancelled', hold_expires_at = NULL, updated_at = now()
    WHERE id = p_series_id;
    RETURN;
  END IF;

  PERFORM _renter_maybe_queue_pack_surcharge_review(p_series_id, p_cancel_mode);

  UPDATE rental_series
  SET status = 'cancelled', hold_expires_at = NULL, updated_at = now()
  WHERE id = p_series_id
    AND status IN ('active', 'awaiting_payment');
END;
$$;

CREATE OR REPLACE FUNCTION _renter_after_pack_slot_terminal(
  p_series_id uuid,
  p_cancel_mode text DEFAULT 'incremental'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM _renter_early_close_pack(p_series_id, p_cancel_mode);
  PERFORM _renter_try_complete_pack(p_series_id);
END;
$$;

COMMENT ON FUNCTION _renter_early_close_pack(uuid, text) IS
  'Pack early close: cancel series; surcharge queued for staff (bulk/ban + week-1-only), not auto-applied.';

COMMENT ON FUNCTION _renter_after_pack_slot_terminal(uuid, text) IS
  'After terminal pack slot: early close with cancel mode (incremental|bulk_pack|ban).';

-- =============================================================================
-- 4. Cancel paths — pass cancel mode
-- =============================================================================

CREATE OR REPLACE FUNCTION renter_cancel_pack(p_series_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ctx record;
  v_s rental_series%ROWTYPE;
  v_slot record;
  v_now timestamptz := now();
  v_start timestamptz;
  v_extra jsonb := '[]'::jsonb;
  v_reasons jsonb := '[]'::jsonb;
  v_reason text;
  v_review jsonb;
BEGIN
  SELECT * INTO v_ctx FROM _renter_actor_ctx();

  SELECT * INTO v_s FROM rental_series WHERE id = p_series_id;
  IF NOT FOUND OR v_s.organization_id IS DISTINCT FROM v_ctx.org_id OR v_s.channel <> 'miniapp' THEN
    PERFORM _renter_raise('renter.forbidden');
  END IF;
  IF v_ctx.is_renter AND v_s.renter_id IS DISTINCT FROM v_ctx.jwt_renter_id THEN
    PERFORM _renter_raise('renter.forbidden');
  END IF;
  IF v_s.status NOT IN ('active', 'awaiting_payment') THEN
    PERFORM _renter_raise('renter.cancel.packNotCancellable');
  END IF;
  IF NOT _renter_series_has_cancellable_pack_slots(p_series_id, v_ctx.is_renter) THEN
    PERFORM _renter_raise('renter.cancel.packNotCancellable');
  END IF;

  FOR v_slot IN
    SELECT r.id, r.location_id, r.rental_date, r.lifecycle
    FROM rentals r
    WHERE r.rental_series_id = p_series_id
      AND r.channel = 'miniapp'
  LOOP
    v_extra := v_extra || jsonb_build_array(
      jsonb_build_object('location_id', v_slot.location_id, 'date', v_slot.rental_date)
    );
  END LOOP;

  PERFORM _renter_acquire_miniapp_locks(v_ctx.org_id, v_s.renter_id, v_extra);

  FOR v_slot IN
    SELECT r.id, r.rental_date, r.time_start, r.lifecycle, r.organization_id, r.prepay_charged_at
    FROM rentals r
    WHERE r.rental_series_id = p_series_id
      AND r.channel = 'miniapp'
      AND r.lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged')
  LOOP
    v_start := _renter_slot_ts(v_slot.organization_id, v_slot.rental_date, v_slot.time_start);
    IF v_ctx.is_renter AND v_now >= v_start THEN
      CONTINUE;
    END IF;
    IF v_slot.lifecycle = 'awaiting_payment' AND v_slot.prepay_charged_at IS NULL THEN
      PERFORM _renter_delete_hold_slot(v_slot.id, v_ctx.member_id, true);
      v_reason := 'hold_deleted';
    ELSE
      v_reason := _renter_cancel_one_slot(v_slot.id, v_ctx.is_renter, v_ctx.member_id, true);
    END IF;
    v_reasons := v_reasons || jsonb_build_array(
      jsonb_build_object('rental_id', v_slot.id, 'reason', v_reason)
    );
  END LOOP;

  IF jsonb_array_length(v_reasons) = 0 THEN
    PERFORM _renter_raise('renter.cancel.packNotCancellable');
  END IF;

  PERFORM _renter_apply_wallet(v_ctx.org_id, v_s.renter_id);
  PERFORM _renter_after_pack_slot_terminal(p_series_id, 'bulk_pack');

  SELECT jsonb_build_object(
    'id', r.id,
    'status', r.status,
    'suggested_amount', r.suggested_amount,
    'currency', r.currency,
    'used_week_count', r.used_week_count
  )
  INTO v_review
  FROM rental_series_surcharge_reviews r
  WHERE r.rental_series_id = p_series_id;

  RETURN jsonb_build_object(
    'success', true,
    'series_id', p_series_id,
    'cancelled', v_reasons,
    'surcharge_review', v_review
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION _renter_cancel_future_miniapp_for_ban(p_org_id uuid, p_renter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slot record;
  v_now timestamptz := now();
  v_start timestamptz;
  v_series_ids uuid[] := '{}';
BEGIN
  FOR v_slot IN
    SELECT r.*
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged')
    ORDER BY r.rental_date, r.time_start, r.created_at
  LOOP
    v_start := _renter_slot_ts(p_org_id, v_slot.rental_date, v_slot.time_start);
    IF v_start <= v_now THEN
      CONTINUE;
    END IF;

    IF v_slot.lifecycle = 'awaiting_payment' AND v_slot.prepay_charged_at IS NULL THEN
      PERFORM _renter_delete_hold_slot(v_slot.id, NULL);
    ELSE
      PERFORM _renter_cancel_one_slot(v_slot.id, false, NULL);
    END IF;

    IF v_slot.rental_series_id IS NOT NULL THEN
      v_series_ids := array_append(v_series_ids, v_slot.rental_series_id);
    END IF;
  END LOOP;

  IF v_series_ids <> '{}' THEN
    PERFORM _renter_after_pack_slot_terminal(sid, 'ban')
    FROM (SELECT DISTINCT unnest(v_series_ids) AS sid) s;
  END IF;
END;
$$;

-- =============================================================================
-- 5. Staff RPC — preview / apply / waive / list
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_staff_can_review_pack_surcharge()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT member_can_manage_rentals() OR can_read_financial();
$$;

CREATE OR REPLACE FUNCTION preview_renter_pack_surcharge(p_series_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid := auth_organization_id();
  v_series rental_series%ROWTYPE;
  v_review rental_series_surcharge_reviews%ROWTYPE;
  v_preview jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL OR NOT _renter_staff_can_review_pack_surcharge() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  SELECT * INTO v_series FROM rental_series WHERE id = p_series_id;
  IF NOT FOUND OR v_series.organization_id IS DISTINCT FROM v_org OR v_series.channel <> 'miniapp' THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.notFound');
  END IF;

  SELECT * INTO v_review FROM rental_series_surcharge_reviews WHERE rental_series_id = p_series_id;

  v_preview := _renter_compute_pack_surcharge(p_series_id);

  RETURN jsonb_build_object(
    'success', true,
    'series_id', p_series_id,
    'series_status', v_series.status,
    'used_week_count', _renter_pack_used_week_count(p_series_id),
    'preview', v_preview,
    'review', CASE WHEN v_review.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_review.id,
      'status', v_review.status,
      'suggested_amount', v_review.suggested_amount,
      'currency', v_review.currency,
      'cancel_mode', v_review.cancel_mode,
      'used_week_count', v_review.used_week_count,
      'created_at', v_review.created_at,
      'reviewed_at', v_review.reviewed_at,
      'review_notes', v_review.review_notes
    ) END
  );
END;
$$;

CREATE OR REPLACE FUNCTION apply_renter_pack_surcharge(
  p_series_id uuid,
  p_idempotency_key uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid := auth_organization_id();
  v_member uuid := auth_member_id();
  v_series rental_series%ROWTYPE;
  v_review rental_series_surcharge_reviews%ROWTYPE;
  v_applied numeric;
  v_cached jsonb;
  v_fp text;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL OR NOT _renter_staff_can_review_pack_surcharge() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  SELECT * INTO v_series FROM rental_series WHERE id = p_series_id FOR UPDATE;
  IF NOT FOUND OR v_series.organization_id IS DISTINCT FROM v_org OR v_series.channel <> 'miniapp' THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.notFound');
  END IF;

  SELECT * INTO v_review
  FROM rental_series_surcharge_reviews
  WHERE rental_series_id = p_series_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.surchargeReview.notFound');
  END IF;

  IF v_review.status = 'applied' THEN
    RETURN jsonb_build_object('success', true, 'already_applied', true, 'applied_amount', v_review.suggested_amount);
  END IF;

  IF v_review.status = 'waived' THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.surchargeReview.alreadyWaived');
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    v_fp := p_series_id::text;
    v_cached := claim_operation_idempotency(v_org, 'apply_renter_pack_surcharge', p_idempotency_key, v_fp);
    IF v_cached IS NOT NULL THEN
      RETURN v_cached;
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(_renter_wallet_lock_key(v_org, v_series.renter_id));
  v_applied := _renter_apply_pack_surcharge(p_series_id);

  UPDATE rental_series_surcharge_reviews
  SET
    status = 'applied',
    reviewed_at = now(),
    reviewed_by = v_member,
    review_notes = NULLIF(trim(p_notes), ''),
    applied_at = now(),
    idempotency_key = p_idempotency_key
  WHERE id = v_review.id;

  PERFORM _renter_apply_wallet(v_org, v_series.renter_id);

  v_result := jsonb_build_object(
    'success', true,
    'series_id', p_series_id,
    'applied_amount', v_applied,
    'currency', v_review.currency
  );

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM store_operation_idempotency(v_org, 'apply_renter_pack_surcharge', p_idempotency_key, v_fp, v_result);
  END IF;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION waive_renter_pack_surcharge(
  p_series_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid := auth_organization_id();
  v_member uuid := auth_member_id();
  v_series rental_series%ROWTYPE;
  v_review rental_series_surcharge_reviews%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL OR NOT _renter_staff_can_review_pack_surcharge() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  SELECT * INTO v_series FROM rental_series WHERE id = p_series_id;
  IF NOT FOUND OR v_series.organization_id IS DISTINCT FROM v_org THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.notFound');
  END IF;

  SELECT * INTO v_review
  FROM rental_series_surcharge_reviews
  WHERE rental_series_id = p_series_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.surchargeReview.notFound');
  END IF;

  IF v_review.status = 'applied' THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.surchargeReview.alreadyApplied');
  END IF;

  IF v_review.status = 'waived' THEN
    RETURN jsonb_build_object('success', true, 'already_waived', true);
  END IF;

  UPDATE rental_series_surcharge_reviews
  SET
    status = 'waived',
    reviewed_at = now(),
    reviewed_by = v_member,
    review_notes = NULLIF(trim(p_notes), '')
  WHERE id = v_review.id;

  RETURN jsonb_build_object('success', true, 'series_id', p_series_id);
END;
$$;

CREATE OR REPLACE FUNCTION list_renter_pack_surcharge_reviews(p_renter_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid := auth_organization_id();
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL OR NOT _renter_staff_can_review_pack_surcharge() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'rental_series_id', r.rental_series_id,
      'renter_id', r.renter_id,
      'status', r.status,
      'suggested_amount', r.suggested_amount,
      'currency', r.currency,
      'cancel_mode', r.cancel_mode,
      'used_week_count', r.used_week_count,
      'reason_code', r.reason_code,
      'created_at', r.created_at,
      'reviewed_at', r.reviewed_at,
      'review_notes', r.review_notes,
      'series_valid_from', rs.valid_from,
      'series_valid_to', rs.valid_to,
      'location_id', rs.location_id
    )
    ORDER BY r.created_at DESC
  ), '[]'::jsonb)
  INTO v_rows
  FROM rental_series_surcharge_reviews r
  JOIN rental_series rs ON rs.id = r.rental_series_id
  WHERE r.organization_id = v_org
    AND (p_renter_id IS NULL OR r.renter_id = p_renter_id);

  RETURN jsonb_build_object('success', true, 'items', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION _renter_pending_surcharge_reviews_json(p_org_id uuid, p_renter_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'rental_series_id', r.rental_series_id,
      'suggested_amount', r.suggested_amount,
      'currency', r.currency,
      'cancel_mode', r.cancel_mode,
      'used_week_count', r.used_week_count,
      'created_at', r.created_at,
      'series_valid_from', rs.valid_from,
      'series_valid_to', rs.valid_to
    )
    ORDER BY r.created_at DESC
  ), '[]'::jsonb)
  FROM rental_series_surcharge_reviews r
  JOIN rental_series rs ON rs.id = r.rental_series_id
  WHERE r.organization_id = p_org_id
    AND r.renter_id = p_renter_id
    AND r.status = 'pending';
$$;

-- =============================================================================
-- 6. renter_bootstrap — pending surcharge notices for renter cabinet
-- =============================================================================

CREATE OR REPLACE FUNCTION renter_bootstrap()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ctx record;
  v_renter renters%ROWTYPE;
  v_name text;
  v_branding text;
  v_tz text;
  v_currency text;
  v_locale text;
  v_chat text;
  v_started timestamptz;
  v_allows boolean;
  v_started_bot bigint;
  v_channel_bot bigint;
  v_bot_started boolean;
  v_bot_url text;
  v_undelivered integer;
  v_surcharge_reviews jsonb;
BEGIN
  SELECT * INTO v_ctx FROM _renter_require_renter_ctx();

  SELECT r.*
  INTO v_renter
  FROM renters r
  WHERE r.id = v_ctx.renter_id
    AND r.organization_id = v_ctx.org_id;

  SELECT o.name, os.branding_name, os.timezone, os.currency_code, os.locale
  INTO v_name, v_branding, v_tz, v_currency, v_locale
  FROM organizations o
  JOIN organization_settings os ON os.organization_id = o.id
  WHERE o.id = v_ctx.org_id;

  SELECT c.telegram_chat_url, c.telegram_bot_id
  INTO v_chat, v_channel_bot
  FROM organization_renter_channel c
  WHERE c.organization_id = v_ctx.org_id;

  IF v_chat IS NOT NULL AND NOT _renter_telegram_chat_url_ok(v_chat) THEN
    v_chat := NULL;
  END IF;

  SELECT d.bot_started_at, d.allows_write_to_pm, d.bot_started_bot_id
  INTO v_started, v_allows, v_started_bot
  FROM renter_telegram_dialog d
  WHERE d.organization_id = v_ctx.org_id
    AND d.telegram_id = v_ctx.telegram_id;

  v_bot_started := v_started IS NOT NULL
    AND (v_channel_bot IS NULL OR v_started_bot = v_channel_bot);

  v_bot_url := _renter_telegram_bot_open_url(v_ctx.org_id);

  v_undelivered := _renter_outbox_unacknowledged_skipped_count(v_ctx.org_id, v_ctx.renter_id);

  v_surcharge_reviews := _renter_pending_surcharge_reviews_json(v_ctx.org_id, v_ctx.renter_id);

  RETURN jsonb_build_object(
    'success', true,
    'studio_name', COALESCE(NULLIF(trim(v_branding), ''), v_name),
    'timezone', COALESCE(v_tz, 'UTC'),
    'currency_code', COALESCE(v_currency, 'RUB'),
    'locale', COALESCE(v_locale, 'ru'),
    'chat_url', v_chat,
    'bot_url', v_bot_url,
    'addon_active', renter_miniapp_addon_is_active(v_ctx.org_id),
    'bot_started', v_bot_started,
    'allows_write', COALESCE(v_allows, false),
    'display_name', v_renter.display_name,
    'contact_phone', v_renter.contact_phone,
    'booking_banned', v_renter.booking_banned_at IS NOT NULL,
    'server_now', now(),
    'undelivered_notifications', v_undelivered,
    'topup_max_amount', _renter_topup_amount_max(COALESCE(v_currency, 'RUB')),
    'pending_surcharge_reviews', v_surcharge_reviews
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- =============================================================================
-- 7. Grants
-- =============================================================================

REVOKE ALL ON TABLE rental_series_surcharge_reviews FROM PUBLIC;
GRANT SELECT, UPDATE ON TABLE rental_series_surcharge_reviews TO authenticated;
GRANT ALL ON TABLE rental_series_surcharge_reviews TO service_role;

REVOKE ALL ON FUNCTION _renter_pack_used_week_count(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_compute_pack_surcharge(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_apply_pack_surcharge(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_maybe_queue_pack_surcharge_review(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_staff_can_review_pack_surcharge() FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_pending_surcharge_reviews_json(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION preview_renter_pack_surcharge(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION apply_renter_pack_surcharge(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION waive_renter_pack_surcharge(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION list_renter_pack_surcharge_reviews(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION _renter_pack_used_week_count(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_compute_pack_surcharge(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_apply_pack_surcharge(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_maybe_queue_pack_surcharge_review(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_staff_can_review_pack_surcharge() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION _renter_pending_surcharge_reviews_json(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION preview_renter_pack_surcharge(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION apply_renter_pack_surcharge(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION waive_renter_pack_surcharge(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION list_renter_pack_surcharge_reviews(uuid) TO authenticated, service_role;

COMMIT;
