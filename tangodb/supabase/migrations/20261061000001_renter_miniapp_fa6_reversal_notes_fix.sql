-- FA6 follow-up: reverse_renter_wallet_topup must not touch rental_advances.notes.

CREATE OR REPLACE FUNCTION reverse_renter_wallet_topup(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid := auth_organization_id();
  v_member uuid := auth_member_id();
  v_ledger_id uuid;
  v_reason text;
  v_key uuid;
  v_orig renter_wallet_ledger%ROWTYPE;
  v_reversal_id uuid;
  v_today date;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;
  IF NOT member_can_record_rental_payment() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  v_ledger_id := NULLIF(p_payload ->> 'ledger_entry_id', '')::uuid;
  v_reason := NULLIF(trim(p_payload ->> 'reason'), '');
  v_key := NULLIF(p_payload ->> 'idempotency_key', '')::uuid;

  IF v_ledger_id IS NULL OR v_reason IS NULL OR length(v_reason) < 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.reversalReasonRequired');
  END IF;
  IF v_key IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.idempotencyRequired');
  END IF;

  v_today := _org_local_date(v_org);
  IF _is_finance_period_closed(v_org, v_today) THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.periodClosed');
  END IF;

  SELECT * INTO v_orig
  FROM renter_wallet_ledger l
  WHERE l.id = v_ledger_id
    AND l.organization_id = v_org
    AND l.entry_type = 'topup';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.reversalNotAllowed');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM renter_wallet_ledger r
    WHERE r.organization_id = v_org
      AND r.corrects_ledger_id = v_orig.id
      AND r.entry_type = 'topup_reversal'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.reversalAlreadyApplied');
  END IF;

  IF _renter_wallet_spendable(v_org, v_orig.renter_id) < v_orig.amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.reversalInsufficient');
  END IF;

  PERFORM _renter_acquire_miniapp_locks(v_org, v_orig.renter_id, '[]'::jsonb);

  INSERT INTO renter_wallet_ledger (
    organization_id, renter_id, entry_type, amount, rental_id, advance_id, phase,
    corrects_ledger_id, correction_reason, created_by
  )
  VALUES (
    v_org, v_orig.renter_id, 'topup_reversal', v_orig.amount, NULL, NULL, NULL,
    v_orig.id, v_reason, v_member
  )
  RETURNING id INTO v_reversal_id;

  IF v_orig.advance_id IS NOT NULL THEN
    UPDATE rental_advances ra
    SET
      amount = GREATEST(0, ra.amount - v_orig.amount),
      allocated_amount = GREATEST(0, ra.allocated_amount - v_orig.amount)
    WHERE ra.id = v_orig.advance_id
      AND ra.organization_id = v_org;
  END IF;

  PERFORM _renter_apply_wallet(v_org, v_orig.renter_id);
  PERFORM _renter_assert_wallet_invariant(v_org, v_orig.renter_id);

  RETURN jsonb_build_object(
    'success', true,
    'reversal_id', v_reversal_id,
    'amount', v_orig.amount
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.reversalAlreadyApplied');
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
