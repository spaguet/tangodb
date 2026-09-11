-- Staff posting correction of Mini App wallet amount (not a cash payout).
-- Owner / director / accountant, or full admin with admin_can_manage_renter_balance.
-- Debit: ledger + FIFO-reduce rental_advances. Credit: ledger + matching advance.
-- Floor: target >= obligated (same quote as payout). Then apply_wallet + invariant.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Ledger entry types
-- ---------------------------------------------------------------------------

ALTER TABLE renter_wallet_ledger
  DROP CONSTRAINT IF EXISTS renter_wallet_ledger_entry_type_check;

ALTER TABLE renter_wallet_ledger
  ADD CONSTRAINT renter_wallet_ledger_entry_type_check
  CHECK (entry_type IN (
    'topup',
    'topup_reversal',
    'wallet_payout',
    'wallet_correction_credit',
    'wallet_correction_debit',
    'prepay_charge',
    'remainder_charge',
    'refund',
    'debt_settle',
    'surcharge_one_time_recalc'
  ));

ALTER TABLE renter_wallet_ledger
  DROP CONSTRAINT IF EXISTS renter_wallet_ledger_check;

ALTER TABLE renter_wallet_ledger
  ADD CONSTRAINT renter_wallet_ledger_check
  CHECK (
    (
      entry_type IN (
        'topup',
        'topup_reversal',
        'wallet_payout',
        'wallet_correction_credit',
        'wallet_correction_debit'
      )
      AND rental_id IS NULL
    )
    OR (
      entry_type NOT IN (
        'topup',
        'topup_reversal',
        'wallet_payout',
        'wallet_correction_credit',
        'wallet_correction_debit'
      )
    )
  );

ALTER TABLE renter_wallet_ledger
  DROP CONSTRAINT IF EXISTS renter_wallet_ledger_correction_meta_chk;

ALTER TABLE renter_wallet_ledger
  ADD CONSTRAINT renter_wallet_ledger_correction_meta_chk
  CHECK (
    entry_type NOT IN ('wallet_correction_credit', 'wallet_correction_debit')
    OR (
      correction_reason IS NOT NULL
      AND length(trim(correction_reason)) >= 3
      AND created_by IS NOT NULL
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Balance + Mini App history sign
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION _renter_wallet_balance(p_org_id uuid, p_renter_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(
    CASE
      WHEN l.entry_type IN ('topup', 'refund', 'wallet_correction_credit') THEN l.amount
      WHEN l.entry_type IN (
        'topup_reversal',
        'wallet_payout',
        'wallet_correction_debit',
        'prepay_charge',
        'remainder_charge',
        'debt_settle',
        'surcharge_one_time_recalc'
      ) THEN -l.amount
      ELSE 0
    END
  ), 0)::numeric(12, 2)
  FROM renter_wallet_ledger l
  WHERE l.organization_id = p_org_id
    AND l.renter_id = p_renter_id;
$$;

COMMENT ON FUNCTION _renter_wallet_balance(uuid, uuid) IS
  'Σ ledger: credits (topup/refund/correction_credit) − debits (reversal/payout/correction_debit/charges/debt/surcharge).';

CREATE OR REPLACE FUNCTION _renter_wallet_entry_signed_amount(p_entry_type text, p_amount numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_entry_type IN ('topup', 'refund', 'wallet_correction_credit') THEN p_amount
    WHEN p_entry_type IN (
      'prepay_charge',
      'remainder_charge',
      'debt_settle',
      'surcharge_one_time_recalc',
      'topup_reversal',
      'wallet_payout',
      'wallet_correction_debit'
    ) THEN -p_amount
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION _renter_wallet_entry_direction(p_entry_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_entry_type IN ('topup', 'refund', 'wallet_correction_credit') THEN 'credit'
    ELSE 'debit'
  END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Currency guard: correction credit is a positive wallet movement
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION organization_settings_miniapp_currency_tz_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.currency_code IS DISTINCT FROM NEW.currency_code THEN
    IF EXISTS (
      SELECT 1
      FROM location_rental_hour_rates r
      WHERE r.organization_id = NEW.organization_id
    ) OR EXISTS (
      SELECT 1
      FROM rentals x
      WHERE x.organization_id = NEW.organization_id
        AND x.channel = 'miniapp'
    ) OR EXISTS (
      SELECT 1
      FROM renter_wallet_ledger l
      WHERE l.organization_id = NEW.organization_id
      GROUP BY l.renter_id
      HAVING SUM(
        CASE
          WHEN l.entry_type IN ('topup', 'refund', 'wallet_correction_credit') THEN l.amount
          ELSE -l.amount
        END
      ) <> 0
    ) THEN
      RAISE EXCEPTION 'currency_code cannot change while Mini App rates, slots, or a non-zero wallet exist'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.timezone IS DISTINCT FROM NEW.timezone THEN
    IF EXISTS (
      SELECT 1
      FROM rentals x
      WHERE x.organization_id = NEW.organization_id
        AND x.channel = 'miniapp'
        AND x.lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged')
    ) THEN
      RAISE EXCEPTION 'timezone cannot change while Mini App slots are awaiting_payment/active/prepaid_charged'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. FIFO-reduce advances: include correction credits
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION _renter_reduce_wallet_advances(
  p_org_id uuid,
  p_renter_id uuid,
  p_amount numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_left numeric := p_amount;
  v_adv record;
  v_take numeric;
BEGIN
  IF COALESCE(v_left, 0) <= 0 THEN
    RETURN;
  END IF;

  FOR v_adv IN
    SELECT ra.id, ra.amount
    FROM rental_advances ra
    JOIN renter_wallet_ledger l
      ON l.advance_id = ra.id
     AND l.organization_id = ra.organization_id
     AND l.entry_type IN ('topup', 'wallet_correction_credit')
    WHERE ra.organization_id = p_org_id
      AND ra.renter_id = p_renter_id
      AND ra.amount > 0
      AND NOT EXISTS (
        SELECT 1
        FROM renter_wallet_ledger rev
        WHERE rev.organization_id = l.organization_id
          AND rev.corrects_ledger_id = l.id
          AND rev.entry_type = 'topup_reversal'
      )
    ORDER BY ra.operation_date, ra.created_at, ra.id
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := LEAST(v_adv.amount, v_left);
    UPDATE rental_advances
    SET
      amount = GREATEST(0, amount - v_take),
      allocated_amount = GREATEST(0, allocated_amount - v_take)
    WHERE id = v_adv.id
      AND organization_id = p_org_id;
    v_left := v_left - v_take;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Director dashboard revenue includes posting corrections
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_renter_miniapp_dashboard_stats(p_year_month text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_role text := current_member_role();
  v_tz text;
  v_year_month text;
  v_month_start date;
  v_month_end date;
  v_addon_active boolean;
  v_revenue numeric;
  v_occupancy_slots integer;
  v_pending_count integer;
  v_pending_sla_breached integer;
  v_debt_total numeric;
  v_expiring_holds integer;
  v_topup_submitted integer;
  v_topup_confirmed integer;
  v_topup_rejected integer;
  v_topup_resolved integer;
  v_conversion numeric;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;

  IF v_role NOT IN ('owner', 'director') THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  v_tz := COALESCE(_org_timezone(v_org_id), 'UTC');
  v_year_month := COALESCE(NULLIF(trim(p_year_month), ''), to_char((now() AT TIME ZONE v_tz), 'YYYY-MM'));

  IF v_year_month !~ '^\d{4}-\d{2}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'dashboard.error.invalidYearMonth');
  END IF;

  v_month_start := to_date(v_year_month || '-01', 'YYYY-MM-DD');
  v_month_end := (v_month_start + interval '1 month' - interval '1 day')::date;

  v_addon_active := renter_miniapp_addon_is_active(v_org_id);

  IF NOT v_addon_active THEN
    RETURN jsonb_build_object(
      'success', true,
      'year_month', v_year_month,
      'addon_active', false,
      'miniapp', jsonb_build_object(
        'revenue', 0,
        'occupancy_slots', 0,
        'pending_count', 0,
        'pending_sla_breached', 0,
        'debt_total', 0,
        'expiring_holds', 0,
        'topup_submitted', 0,
        'topup_confirmed', 0,
        'topup_rejected', 0,
        'topup_conversion_rate', NULL
      )
    );
  END IF;

  SELECT COALESCE(sum(
    CASE
      WHEN l.entry_type IN ('topup', 'wallet_correction_credit') THEN l.amount
      WHEN l.entry_type IN ('topup_reversal', 'wallet_correction_debit') THEN -l.amount
      ELSE 0
    END
  ), 0)
  INTO v_revenue
  FROM renter_wallet_ledger l
  WHERE l.organization_id = v_org_id
    AND l.entry_type IN (
      'topup',
      'topup_reversal',
      'wallet_correction_credit',
      'wallet_correction_debit'
    )
    AND (l.created_at AT TIME ZONE v_tz)::date BETWEEN v_month_start AND v_month_end;

  SELECT count(*)::integer
  INTO v_occupancy_slots
  FROM rentals r
  WHERE r.organization_id = v_org_id
    AND r.channel = 'miniapp'
    AND r.booking_status = 'confirmed'
    AND r.rental_date BETWEEN v_month_start AND v_month_end;

  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE t.created_at < now() - interval '4 hours'
    )::integer
  INTO v_pending_count, v_pending_sla_breached
  FROM renter_topup_requests t
  WHERE t.organization_id = v_org_id
    AND t.status = 'pending';

  SELECT COALESCE(sum(_renter_wallet_debt_outstanding(v_org_id, r.id)), 0)
  INTO v_debt_total
  FROM renters r
  WHERE r.organization_id = v_org_id
    AND r.status = 'active';

  SELECT count(*)::integer
  INTO v_expiring_holds
  FROM rentals r
  WHERE r.organization_id = v_org_id
    AND r.channel = 'miniapp'
    AND r.lifecycle = 'awaiting_payment'
    AND r.hold_expires_at IS NOT NULL
    AND r.hold_expires_at > now()
    AND r.hold_expires_at <= now() + interval '24 hours';

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE t.status = 'confirmed')::integer,
    count(*) FILTER (WHERE t.status = 'rejected')::integer
  INTO v_topup_submitted, v_topup_confirmed, v_topup_rejected
  FROM renter_topup_requests t
  WHERE t.organization_id = v_org_id
    AND (t.created_at AT TIME ZONE v_tz)::date BETWEEN v_month_start AND v_month_end;

  v_topup_resolved := v_topup_confirmed + v_topup_rejected;
  v_conversion := CASE
    WHEN v_topup_resolved > 0 THEN round(v_topup_confirmed::numeric / v_topup_resolved, 4)
    ELSE NULL
  END;

  RETURN jsonb_build_object(
    'success', true,
    'year_month', v_year_month,
    'addon_active', true,
    'miniapp', jsonb_build_object(
      'revenue', v_revenue,
      'occupancy_slots', v_occupancy_slots,
      'pending_count', v_pending_count,
      'pending_sla_breached', v_pending_sla_breached,
      'debt_total', v_debt_total,
      'expiring_holds', v_expiring_holds,
      'topup_submitted', v_topup_submitted,
      'topup_confirmed', v_topup_confirmed,
      'topup_rejected', v_topup_rejected,
      'topup_conversion_rate', v_conversion
    )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Wallet entries on renter card: actor name
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION _renter_wallet_entries_detail_json(
  p_org_id uuid,
  p_renter_id uuid,
  p_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', e.id,
      'entry_type', e.entry_type,
      'amount', e.amount,
      'created_at', e.created_at,
      'external_reference', e.external_reference,
      'correction_reason', e.correction_reason,
      'corrects_ledger_id', e.corrects_ledger_id,
      'payout_method', e.payout_method,
      'created_by', e.created_by,
      'created_by_name', e.created_by_name,
      'can_reverse', e.can_reverse
    ) ORDER BY e.created_at DESC
  ), '[]'::jsonb)
  FROM (
    SELECT
      l.id,
      l.entry_type,
      l.amount,
      l.created_at,
      l.external_reference,
      l.correction_reason,
      l.corrects_ledger_id,
      l.payout_method,
      l.created_by,
      NULLIF(trim(COALESCE(m.display_name, '')), '') AS created_by_name,
      (
        l.entry_type = 'topup'
        AND l.advance_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM renter_wallet_ledger r
          WHERE r.organization_id = l.organization_id
            AND r.corrects_ledger_id = l.id
            AND r.entry_type = 'topup_reversal'
        )
      ) AS can_reverse
    FROM renter_wallet_ledger l
    LEFT JOIN organization_members m
      ON m.organization_id = l.organization_id
     AND m.id = l.created_by
    WHERE l.organization_id = p_org_id
      AND l.renter_id = p_renter_id
    ORDER BY l.created_at DESC
    LIMIT p_limit
  ) e;
$$;

-- ---------------------------------------------------------------------------
-- 7. Credit helper: matching cashier advance
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION _renter_credit_wallet_correction(
  p_org_id uuid,
  p_renter_id uuid,
  p_amount numeric,
  p_member_id uuid,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today date;
  v_advance uuid;
  v_ledger uuid;
  v_currency text;
BEGIN
  v_today := _org_local_date(p_org_id);
  v_currency := _renter_org_currency(p_org_id);

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
    'cash',
    p_member_id,
    'wallet_correction: ' || trim(p_reason),
    v_today
  )
  RETURNING id INTO v_advance;

  INSERT INTO renter_wallet_ledger (
    organization_id, renter_id, entry_type, amount, rental_id, advance_id, phase,
    correction_reason, created_by
  )
  VALUES (
    p_org_id, p_renter_id, 'wallet_correction_credit', p_amount, NULL, v_advance, NULL,
    trim(p_reason), p_member_id
  )
  RETURNING id INTO v_ledger;

  RETURN v_ledger;
END;
$$;

REVOKE ALL ON FUNCTION _renter_credit_wallet_correction(uuid, uuid, numeric, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _renter_credit_wallet_correction(uuid, uuid, numeric, uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. Preview + apply
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION member_can_adjust_renter_wallet()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT can_read_financial() OR member_can_manage_renter_balance();
$$;

REVOKE ALL ON FUNCTION member_can_adjust_renter_wallet() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_adjust_renter_wallet() TO authenticated, service_role;

COMMENT ON FUNCTION member_can_adjust_renter_wallet() IS
  'Owner/director/accountant, or full admin with admin_can_manage_renter_balance.';

CREATE OR REPLACE FUNCTION preview_staff_renter_wallet_adjust(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid := auth_organization_id();
  v_renter uuid;
  v_target numeric;
  v_currency text;
  v_name text;
  v_quote jsonb;
  v_current numeric;
  v_min numeric;
  v_max numeric;
  v_delta numeric;
  v_direction text;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;
  IF NOT member_can_adjust_renter_wallet() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  v_renter := NULLIF(p_payload ->> 'renter_id', '')::uuid;
  IF v_renter IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.notFound');
  END IF;

  SELECT r.display_name INTO v_name
  FROM renters r
  WHERE r.id = v_renter AND r.organization_id = v_org;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.notFound');
  END IF;

  v_quote := _renter_wallet_payout_quote(v_org, v_renter);
  v_current := (v_quote ->> 'wallet_balance')::numeric;
  v_min := (v_quote ->> 'obligated')::numeric;
  v_currency := v_quote ->> 'currency';
  v_max := _renter_topup_amount_max(v_currency);
  v_target := CASE
    WHEN p_payload ->> 'target_amount' IS NULL OR trim(p_payload ->> 'target_amount') = '' THEN v_current
    ELSE _renter_round_money((p_payload ->> 'target_amount')::numeric, v_currency)
  END;
  v_delta := _renter_round_money(v_target - v_current, v_currency);
  v_direction := CASE
    WHEN v_delta > 0 THEN 'credit'
    WHEN v_delta < 0 THEN 'debit'
    ELSE 'none'
  END;

  RETURN jsonb_build_object(
    'success', true,
    'renter_id', v_renter,
    'renter_name', v_name,
    'target_amount', v_target,
    'current_amount', v_current,
    'delta', abs(v_delta),
    'direction', v_direction,
    'min_amount', v_min,
    'max_amount', v_max,
    'amount_ok', v_target IS NOT NULL
      AND v_target >= 0
      AND v_target >= v_min
      AND v_target <= v_max
      AND v_delta <> 0,
    'quote', v_quote
  );
END;
$$;

CREATE OR REPLACE FUNCTION staff_renter_wallet_adjust(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid := auth_organization_id();
  v_member uuid := auth_member_id();
  v_renter uuid;
  v_target numeric;
  v_reason text;
  v_key uuid;
  v_fp text;
  v_cached jsonb;
  v_currency text;
  v_quote jsonb;
  v_current numeric;
  v_min numeric;
  v_max numeric;
  v_delta numeric;
  v_today date;
  v_ledger uuid;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;
  IF NOT member_can_adjust_renter_wallet() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  v_renter := NULLIF(p_payload ->> 'renter_id', '')::uuid;
  v_reason := NULLIF(trim(COALESCE(p_payload ->> 'reason', '')), '');
  v_key := NULLIF(p_payload ->> 'idempotency_key', '')::uuid;
  v_currency := _renter_org_currency(v_org);
  v_max := _renter_topup_amount_max(v_currency);
  v_target := _renter_round_money((p_payload ->> 'target_amount')::numeric, v_currency);

  IF v_renter IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.notFound');
  END IF;
  IF v_key IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.walletAdjust.idempotencyRequired');
  END IF;
  IF v_reason IS NULL OR length(v_reason) < 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.walletAdjust.reasonRequired');
  END IF;
  IF v_target IS NULL OR v_target < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.walletAdjust.amountInvalid');
  END IF;
  IF v_target > v_max THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.amountTooLarge');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM renters r WHERE r.id = v_renter AND r.organization_id = v_org
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.notFound');
  END IF;

  v_today := _org_local_date(v_org);
  IF _is_finance_period_closed(v_org, v_today) THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.periodClosed');
  END IF;
  IF NOT organization_allows_writes(v_org) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.writesDisabled');
  END IF;

  v_fp := md5(v_renter::text || ':' || v_target::text || ':' || v_reason);

  PERFORM _renter_acquire_miniapp_locks(v_org, v_renter, '[]'::jsonb);

  v_cached := claim_operation_idempotency(v_org, 'staff_renter_wallet_adjust', v_key, v_fp);
  IF v_cached IS NOT NULL THEN
    IF v_cached ->> 'error_code' = 'idempotency_conflict' THEN
      RETURN v_cached;
    END IF;
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  v_quote := _renter_wallet_payout_quote(v_org, v_renter);
  v_current := (v_quote ->> 'wallet_balance')::numeric;
  v_min := (v_quote ->> 'obligated')::numeric;
  v_delta := _renter_round_money(v_target - v_current, v_currency);

  IF v_delta = 0 THEN
    PERFORM _renter_raise('renter.walletAdjust.unchanged');
  END IF;
  IF v_target < v_min THEN
    PERFORM _renter_raise('renter.walletAdjust.belowFloor');
  END IF;

  IF v_delta > 0 THEN
    v_ledger := _renter_credit_wallet_correction(v_org, v_renter, v_delta, v_member, v_reason);
  ELSE
    INSERT INTO renter_wallet_ledger (
      organization_id, renter_id, entry_type, amount, rental_id, advance_id, phase,
      correction_reason, created_by
    )
    VALUES (
      v_org, v_renter, 'wallet_correction_debit', abs(v_delta), NULL, NULL, NULL,
      v_reason, v_member
    )
    RETURNING id INTO v_ledger;

    PERFORM _renter_reduce_wallet_advances(v_org, v_renter, abs(v_delta));
  END IF;

  PERFORM _renter_apply_wallet(v_org, v_renter);
  PERFORM _renter_assert_wallet_invariant(v_org, v_renter);

  v_quote := _renter_wallet_payout_quote(v_org, v_renter);

  v_result := jsonb_build_object(
    'success', true,
    'ledger_id', v_ledger,
    'target_amount', v_target,
    'delta', abs(v_delta),
    'direction', CASE WHEN v_delta > 0 THEN 'credit' ELSE 'debit' END,
    'wallet_balance_after', (v_quote ->> 'wallet_balance')::numeric,
    'spendable_after', (v_quote ->> 'spendable')::numeric,
    'reserved_prepay_after', (v_quote ->> 'reserved_prepay')::numeric
  );
  PERFORM store_operation_idempotency(v_org, 'staff_renter_wallet_adjust', v_key, v_fp, v_result);
  RETURN v_result;
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION preview_staff_renter_wallet_adjust(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION staff_renter_wallet_adjust(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION preview_staff_renter_wallet_adjust(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION staff_renter_wallet_adjust(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION preview_staff_renter_wallet_adjust(jsonb) IS
  'Read-only quote for setting Mini App wallet to a target amount. Floor = obligated (debt+holds+remainders).';
COMMENT ON FUNCTION staff_renter_wallet_adjust(jsonb) IS
  'Posting correction of Mini App wallet. Owner/director/accountant (or flagged admin). Audit: created_by, created_at, reason.';

COMMIT;
