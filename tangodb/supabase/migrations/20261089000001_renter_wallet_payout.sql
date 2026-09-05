-- Wallet payout: return unused Mini App spendable to the renter (cash/card/transfer).
-- Not a topup_reversal (posting correction) and not ledger `refund` (cancel → wallet).
-- Refundable = wallet − Mini App debt − full hold costs − remainder of live bookings.
-- (Not spendable − full holds: reserved 50% is already outside spendable, so that would double-count.)

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Ledger: wallet_payout
-- ---------------------------------------------------------------------------

ALTER TABLE renter_wallet_ledger
  ADD COLUMN IF NOT EXISTS payout_method text,
  ADD COLUMN IF NOT EXISTS payout_document_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'renter_wallet_ledger_payout_document_fk'
  ) THEN
    ALTER TABLE renter_wallet_ledger
      ADD CONSTRAINT renter_wallet_ledger_payout_document_fk
      FOREIGN KEY (organization_id, payout_document_id)
      REFERENCES renter_documents (organization_id, id);
  END IF;
END;
$$;

ALTER TABLE renter_wallet_ledger
  DROP CONSTRAINT IF EXISTS renter_wallet_ledger_entry_type_check;

ALTER TABLE renter_wallet_ledger
  ADD CONSTRAINT renter_wallet_ledger_entry_type_check
  CHECK (entry_type IN (
    'topup',
    'topup_reversal',
    'wallet_payout',
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
      entry_type IN ('topup', 'topup_reversal', 'wallet_payout')
      AND rental_id IS NULL
    )
    OR (entry_type NOT IN ('topup', 'topup_reversal', 'wallet_payout'))
  );

ALTER TABLE renter_wallet_ledger
  DROP CONSTRAINT IF EXISTS renter_wallet_ledger_payout_meta_chk;

ALTER TABLE renter_wallet_ledger
  ADD CONSTRAINT renter_wallet_ledger_payout_meta_chk
  CHECK (
    entry_type <> 'wallet_payout'
    OR (
      correction_reason IS NOT NULL
      AND length(trim(correction_reason)) >= 3
      AND payout_method IN ('cash', 'card', 'transfer')
    )
  );

ALTER TABLE renter_wallet_ledger
  DROP CONSTRAINT IF EXISTS renter_wallet_ledger_payout_method_null_chk;

ALTER TABLE renter_wallet_ledger
  ADD CONSTRAINT renter_wallet_ledger_payout_method_null_chk
  CHECK (
    (entry_type = 'wallet_payout' AND payout_method IS NOT NULL)
    OR (entry_type <> 'wallet_payout' AND payout_method IS NULL)
  );

-- ---------------------------------------------------------------------------
-- 2. Balance: subtract wallet_payout
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
      WHEN l.entry_type IN ('topup', 'refund') THEN l.amount
      WHEN l.entry_type IN (
        'topup_reversal',
        'wallet_payout',
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
  'Σ ledger: topup + refund − topup_reversal − wallet_payout − charges − debt_settle − surcharge.';

-- ---------------------------------------------------------------------------
-- 3. Quote: refundable leftover after debt + full holds + live remainders
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION _renter_wallet_payout_quote(
  p_org_id uuid,
  p_renter_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_currency text;
  v_wallet numeric;
  v_spendable numeric;
  v_reserved numeric;
  v_debt numeric;
  v_holds numeric;
  v_remainders numeric;
  v_hold_count integer;
  v_live_count integer;
  v_obligated numeric;
  v_refundable numeric;
BEGIN
  v_currency := _renter_org_currency(p_org_id);
  v_wallet := _renter_wallet_balance(p_org_id, p_renter_id);
  v_spendable := _renter_wallet_spendable(p_org_id, p_renter_id);
  v_reserved := _renter_wallet_reserved_prepay(p_org_id, p_renter_id);
  v_debt := _renter_wallet_debt_outstanding(p_org_id, p_renter_id);

  SELECT
    COALESCE(SUM(COALESCE(r.prepay_amount, 0) + COALESCE(r.remainder_amount, 0)), 0),
    COUNT(*)::integer
  INTO v_holds, v_hold_count
  FROM rentals r
  WHERE r.organization_id = p_org_id
    AND r.renter_id = p_renter_id
    AND r.channel = 'miniapp'
    AND r.booking_status = 'confirmed'
    AND r.lifecycle = 'awaiting_payment';

  SELECT
    COALESCE(SUM(COALESCE(r.remainder_amount, 0)), 0),
    COUNT(*)::integer
  INTO v_remainders, v_live_count
  FROM rentals r
  WHERE r.organization_id = p_org_id
    AND r.renter_id = p_renter_id
    AND r.channel = 'miniapp'
    AND r.booking_status = 'confirmed'
    AND r.remainder_charged_at IS NULL
    AND (
      (r.lifecycle = 'active' AND r.prepay_charged_at IS NULL)
      OR r.lifecycle = 'prepaid_charged'
    );

  v_holds := _renter_round_money(v_holds, v_currency);
  v_remainders := _renter_round_money(v_remainders, v_currency);
  v_obligated := _renter_round_money(v_debt + v_holds + v_remainders, v_currency);
  -- Keep enough of the wallet to settle debt and fully pay holds/remainders (FIFO after payout).
  v_refundable := _renter_round_money(GREATEST(v_wallet - v_obligated, 0), v_currency);

  RETURN jsonb_build_object(
    'wallet_balance', v_wallet,
    'spendable', v_spendable,
    'reserved_prepay', v_reserved,
    'debt_to_keep', v_debt,
    'holds_full_cost', v_holds,
    'holds_count', v_hold_count,
    'remainders_to_keep', v_remainders,
    'live_booking_count', v_live_count,
    'obligated', v_obligated,
    'refundable', v_refundable,
    'currency', v_currency
  );
END;
$$;

REVOKE ALL ON FUNCTION _renter_wallet_payout_quote(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _renter_wallet_payout_quote(uuid, uuid) TO service_role;

COMMENT ON FUNCTION _renter_wallet_payout_quote(uuid, uuid) IS
  'Refundable leftover = wallet − Mini App debt − 100% of awaiting_payment holds − remainder of live bookings.';

-- ---------------------------------------------------------------------------
-- 4. FIFO-reduce Mini App wallet advances (cashier inflow) by payout amount
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
     AND l.entry_type = 'topup'
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

REVOKE ALL ON FUNCTION _renter_reduce_wallet_advances(uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _renter_reduce_wallet_advances(uuid, uuid, numeric) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Telegram notify
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION _renter_enqueue_wallet_payout(
  p_org_id uuid,
  p_renter_id uuid,
  p_payout_id uuid,
  p_amount numeric,
  p_spendable numeric
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
    'wallet_payout',
    format(
      'Студия вернула средства с баланса: %s. Свободный остаток: %s.',
      _renter_telegram_fmt_money(p_amount, v_currency),
      _renter_telegram_fmt_money(p_spendable, v_currency)
    ),
    'wallet_payout:' || p_payout_id::text
  );
END;
$$;

REVOKE ALL ON FUNCTION _renter_enqueue_wallet_payout(uuid, uuid, uuid, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _renter_enqueue_wallet_payout(uuid, uuid, uuid, numeric, numeric) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Preview + payout RPC
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION preview_renter_wallet_payout(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid := auth_organization_id();
  v_renter uuid;
  v_amount numeric;
  v_currency text;
  v_name text;
  v_quote jsonb;
  v_refundable numeric;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;
  IF NOT member_can_record_rental_payment() THEN
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
  v_refundable := (v_quote ->> 'refundable')::numeric;
  v_currency := v_quote ->> 'currency';
  v_amount := CASE
    WHEN p_payload ->> 'amount' IS NULL OR trim(p_payload ->> 'amount') = '' THEN v_refundable
    ELSE _renter_round_money((p_payload ->> 'amount')::numeric, v_currency)
  END;

  RETURN jsonb_build_object(
    'success', true,
    'renter_id', v_renter,
    'renter_name', v_name,
    'amount', v_amount,
    'amount_ok', v_amount IS NOT NULL AND v_amount > 0 AND v_amount <= v_refundable,
    'quote', v_quote
  );
END;
$$;

CREATE OR REPLACE FUNCTION staff_renter_wallet_payout(p_payload jsonb)
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
  v_reason text;
  v_ack boolean;
  v_key uuid;
  v_fp text;
  v_cached jsonb;
  v_currency text;
  v_quote jsonb;
  v_refundable numeric;
  v_today date;
  v_payout_id uuid;
  v_doc uuid;
  v_ext text;
  v_result jsonb;
  v_max numeric;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;
  IF NOT member_can_record_rental_payment() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  v_renter := NULLIF(p_payload ->> 'renter_id', '')::uuid;
  v_method := NULLIF(trim(COALESCE(p_payload ->> 'method', '')), '');
  v_reason := NULLIF(trim(COALESCE(p_payload ->> 'reason', '')), '');
  v_ack := COALESCE((p_payload ->> 'application_ack')::boolean, false);
  v_key := NULLIF(p_payload ->> 'idempotency_key', '')::uuid;
  v_doc := NULLIF(p_payload ->> 'document_id', '')::uuid;
  v_ext := NULLIF(trim(COALESCE(p_payload ->> 'external_reference', '')), '');
  v_currency := _renter_org_currency(v_org);
  v_max := _renter_topup_amount_max(v_currency);
  v_amount := _renter_round_money((p_payload ->> 'amount')::numeric, v_currency);

  IF v_renter IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.notFound');
  END IF;
  IF v_key IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.payout.idempotencyRequired');
  END IF;
  IF NOT v_ack THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.payout.ackRequired');
  END IF;
  IF v_reason IS NULL OR length(v_reason) < 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.payout.reasonRequired');
  END IF;
  IF v_method IS NULL OR v_method NOT IN ('cash', 'card', 'transfer') THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.payout.methodInvalid');
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.amountInvalid');
  END IF;
  IF v_amount > v_max THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.amountTooLarge');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM renters r WHERE r.id = v_renter AND r.organization_id = v_org
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.notFound');
  END IF;

  IF v_doc IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM renter_documents d
    WHERE d.id = v_doc
      AND d.organization_id = v_org
      AND d.renter_id = v_renter
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.payout.documentInvalid');
  END IF;

  v_today := _org_local_date(v_org);
  IF _is_finance_period_closed(v_org, v_today) THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.periodClosed');
  END IF;
  IF NOT organization_allows_writes(v_org) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.writesDisabled');
  END IF;

  v_fp := md5(
    v_renter::text || ':' || v_amount::text || ':' || v_method || ':' || v_reason
  );

  PERFORM _renter_acquire_miniapp_locks(v_org, v_renter, '[]'::jsonb);

  v_cached := claim_operation_idempotency(v_org, 'staff_renter_wallet_payout', v_key, v_fp);
  IF v_cached IS NOT NULL THEN
    IF v_cached ->> 'error_code' = 'idempotency_conflict' THEN
      RETURN v_cached;
    END IF;
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  v_quote := _renter_wallet_payout_quote(v_org, v_renter);
  v_refundable := (v_quote ->> 'refundable')::numeric;

  IF v_refundable <= 0 THEN
    PERFORM _renter_raise('renter.payout.nothingToRefund');
  END IF;
  IF v_amount > v_refundable THEN
    PERFORM _renter_raise('renter.payout.exceedsRefundable');
  END IF;

  INSERT INTO renter_wallet_ledger (
    organization_id, renter_id, entry_type, amount, rental_id, advance_id, phase,
    correction_reason, created_by, external_reference, payout_method, payout_document_id
  )
  VALUES (
    v_org, v_renter, 'wallet_payout', v_amount, NULL, NULL, NULL,
    v_reason, v_member, v_ext, v_method, v_doc
  )
  RETURNING id INTO v_payout_id;

  PERFORM _renter_reduce_wallet_advances(v_org, v_renter, v_amount);
  PERFORM _renter_apply_wallet(v_org, v_renter);
  PERFORM _renter_assert_wallet_invariant(v_org, v_renter);

  v_quote := _renter_wallet_payout_quote(v_org, v_renter);

  PERFORM _renter_enqueue_wallet_payout(
    v_org,
    v_renter,
    v_payout_id,
    v_amount,
    (v_quote ->> 'spendable')::numeric
  );

  v_result := jsonb_build_object(
    'success', true,
    'payout_id', v_payout_id,
    'amount', v_amount,
    'method', v_method,
    'wallet_balance_after', (v_quote ->> 'wallet_balance')::numeric,
    'spendable_after', (v_quote ->> 'spendable')::numeric,
    'refundable_after', (v_quote ->> 'refundable')::numeric
  );
  PERFORM store_operation_idempotency(v_org, 'staff_renter_wallet_payout', v_key, v_fp, v_result);
  RETURN v_result;
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Wallet entries on renter card include payout method
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
    WHERE l.organization_id = p_org_id
      AND l.renter_id = p_renter_id
    ORDER BY l.created_at DESC
    LIMIT p_limit
  ) e;
$$;

REVOKE ALL ON FUNCTION preview_renter_wallet_payout(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION staff_renter_wallet_payout(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION preview_renter_wallet_payout(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION staff_renter_wallet_payout(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION preview_renter_wallet_payout(jsonb) IS
  'Read-only quote of Mini App wallet payout (refundable leftover after debt/holds/remainders).';
COMMENT ON FUNCTION staff_renter_wallet_payout(jsonb) IS
  'Cash-out unused Mini App spendable. Same gate as staff topup. One-step completed today in org TZ.';

COMMIT;
