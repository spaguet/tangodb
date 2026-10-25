-- M9 (audit 2026-10-25): edition gate must RAISE, not RETURN jsonb from a uuid function.

CREATE OR REPLACE FUNCTION record_teacher_settlement_payment(
  p_settlement_id uuid,
  p_amount numeric,
  p_paid_at date,
  p_method text DEFAULT 'transfer',
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_settlement teacher_settlements%ROWTYPE;
  v_payment_id uuid;
  v_new_paid numeric;
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'payroll') THEN
    PERFORM _edition_raise('edition_forbidden');
  END IF;

  IF v_org_id IS NULL
    OR NOT can_write_payroll()
    OR NOT organization_allows_writes(v_org_id)
  THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid amount';
  END IF;

  IF p_paid_at IS NULL OR p_paid_at > CURRENT_DATE THEN
    RAISE EXCEPTION 'paid_at cannot be in the future';
  END IF;

  IF p_method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RAISE EXCEPTION 'invalid method';
  END IF;

  SELECT * INTO v_settlement
  FROM teacher_settlements ts
  WHERE ts.id = p_settlement_id
    AND ts.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement not found';
  END IF;

  v_new_paid := v_settlement.amount_paid + p_amount;

  INSERT INTO teacher_settlement_payments (
    organization_id,
    settlement_id,
    amount,
    paid_at,
    method,
    note,
    created_by
  )
  VALUES (
    v_org_id,
    p_settlement_id,
    p_amount,
    p_paid_at,
    p_method,
    nullif(trim(p_note), ''),
    auth_member_id()
  )
  RETURNING id INTO v_payment_id;

  UPDATE teacher_settlements
  SET amount_paid = v_new_paid
  WHERE id = p_settlement_id;

  RETURN v_payment_id;
END;
$$;
