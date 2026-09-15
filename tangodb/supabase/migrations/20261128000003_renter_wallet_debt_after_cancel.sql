-- Mini App: wallet debt must not include cancelled terminals; clear debt_amount on cancel.

BEGIN;

-- =============================================================================
-- 1. Backfill stale debt_amount on terminal lifecycles
-- =============================================================================

UPDATE rentals
SET debt_amount = 0, updated_at = now()
WHERE channel = 'miniapp'
  AND lifecycle IN ('cancelled', 'hold_deleted', 'auto_deleted', 'settled')
  AND COALESCE(debt_amount, 0) > 0;

-- =============================================================================
-- 2. Outstanding debt — only active debt slots
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_wallet_debt_outstanding(p_org_id uuid, p_renter_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(r.debt_amount), 0)::numeric(12, 2)
  FROM rentals r
  WHERE r.organization_id = p_org_id
    AND r.renter_id = p_renter_id
    AND r.channel = 'miniapp'
    AND r.lifecycle = 'debt'
    AND r.debt_amount > 0;
$$;

COMMENT ON FUNCTION _renter_wallet_debt_outstanding(uuid, uuid) IS
  'Mini App wallet debt: sum of lifecycle=debt slots only (excludes cancelled/terminal rows).';

-- =============================================================================
-- 3. Terminal transitions — zero debt_amount (cancel path used mark_terminal)
-- =============================================================================

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
    debt_amount = CASE
      WHEN p_lifecycle IN ('cancelled', 'hold_deleted', 'auto_deleted') THEN 0
      ELSE debt_amount
    END,
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
-- 4. Debt settle — only lifecycle=debt rows
-- =============================================================================

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
  v_phase text;
  v_ledger_id uuid;
BEGIN
  LOOP
    v_spendable := _renter_wallet_spendable(p_org_id, p_renter_id);
    IF v_spendable <= 0 THEN
      EXIT;
    END IF;

    SELECT r.id, r.debt_amount, r.debt_charge_seq
    INTO v_slot
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.lifecycle = 'debt'
      AND r.debt_amount > 0
    ORDER BY
      _renter_slot_ts(r.organization_id, r.rental_date, r.time_end),
      r.created_at
    LIMIT 1;

    EXIT WHEN v_slot.id IS NULL;
    EXIT WHEN v_spendable < v_slot.debt_amount;

    v_amount := v_slot.debt_amount;
    v_phase := 'debt_settle:' || COALESCE(v_slot.debt_charge_seq, 1);

    v_ledger_id := _renter_wallet_insert_entry(
      p_org_id,
      p_renter_id,
      'debt_settle',
      v_amount,
      v_slot.id,
      v_phase
    );

    IF v_ledger_id IS NULL THEN
      EXIT;
    END IF;

    UPDATE rentals
    SET
      debt_amount = 0,
      lifecycle = 'settled',
      remainder_charged_at = CASE
        WHEN remainder_charged_at IS NULL AND remainder_amount > 0 THEN now()
        ELSE remainder_charged_at
      END,
      updated_at = now()
    WHERE id = v_slot.id;

    IF FOUND THEN
      PERFORM _renter_enqueue_debt_settled(v_slot.id, v_amount);
    END IF;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
