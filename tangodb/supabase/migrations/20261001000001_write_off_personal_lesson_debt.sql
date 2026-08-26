-- Write off remaining personal-lesson AR (billed → net paid) + debt history for the adjust dialog.
-- Frontend already calls these RPCs; they were missing from schema cache.

CREATE OR REPLACE FUNCTION get_personal_lesson_debt_trace(
  p_lesson_id uuid,
  p_charge_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_lesson_id uuid := p_lesson_id;
  v_charge personal_lesson_charges%ROWTYPE;
  v_charge_count integer;
  v_events jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_financial() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF v_lesson_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.traceFailed');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM personal_lessons
    WHERE id = v_lesson_id AND organization_id = v_org_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.traceFailed');
  END IF;

  IF p_charge_id IS NOT NULL THEN
    SELECT * INTO v_charge
    FROM personal_lesson_charges
    WHERE organization_id = v_org_id
      AND id = p_charge_id
      AND personal_lesson_id = v_lesson_id;
  ELSE
    SELECT COUNT(*)::integer INTO v_charge_count
    FROM personal_lesson_charges
    WHERE organization_id = v_org_id
      AND personal_lesson_id = v_lesson_id;

    IF v_charge_count <> 1 THEN
      RETURN jsonb_build_object('success', true, 'events', '[]'::jsonb);
    END IF;

    SELECT * INTO v_charge
    FROM personal_lesson_charges
    WHERE organization_id = v_org_id
      AND personal_lesson_id = v_lesson_id
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'events', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_event ORDER BY (row_to_event->>'at')), '[]'::jsonb)
  INTO v_events
  FROM (
    SELECT jsonb_build_object(
      'kind', 'charge_created',
      'at', v_charge.created_at,
      'amount', v_charge.billed_amount,
      'method', NULL,
      'comment', NULL
    ) AS row_to_event

    UNION ALL

    SELECT jsonb_build_object(
      'kind', CASE WHEN p.operation_kind = 'storno' THEN 'storno' ELSE 'payment' END,
      'at', p.created_at,
      'amount', p.amount,
      'method', p.method,
      'comment', p.correction_comment
    )
    FROM payments p
    WHERE p.organization_id = v_org_id
      AND (
        p.personal_lesson_charge_id = v_charge.id
        OR (
          p.personal_lesson_charge_id IS NULL
          AND p.personal_lesson_id = v_lesson_id
          AND p.client_id = v_charge.client_id
        )
      )

    UNION ALL

    SELECT jsonb_build_object(
      'kind', COALESCE(NULLIF(al.new_data->>'correction_kind', ''), 'billed_restated'),
      'at', al.changed_at,
      'amount', COALESCE((al.new_data->>'written_off')::numeric, 0),
      'method', NULL,
      'comment', al.new_data->>'reason_comment'
    )
    FROM audit_log al
    WHERE al.organization_id = v_org_id
      AND al.table_name = 'personal_lesson_charges'
      AND al.row_id = v_charge.id::text
      AND al.new_data->>'correction_kind' IN ('write_off', 'billed_restated')
  ) events;

  RETURN jsonb_build_object('success', true, 'events', COALESCE(v_events, '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION write_off_personal_lesson_debt(
  p_charge_id uuid,
  p_lesson_id uuid,
  p_reason_code text,
  p_reason_comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_lesson personal_lessons%ROWTYPE;
  v_charge personal_lesson_charges%ROWTYPE;
  v_charge_count integer;
  v_paid numeric;
  v_new_billed numeric;
  v_written_off numeric;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.orgReadOnly');
  END IF;

  IF NOT can_read_financial() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF p_lesson_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.adjustFailed');
  END IF;

  IF p_reason_code IS NULL OR trim(p_reason_code) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.writeOffReasonRequired');
  END IF;

  SELECT * INTO v_lesson
  FROM personal_lessons
  WHERE id = p_lesson_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.adjustFailed');
  END IF;

  IF p_charge_id IS NOT NULL THEN
    SELECT * INTO v_charge
    FROM personal_lesson_charges
    WHERE organization_id = v_org_id
      AND id = p_charge_id
      AND personal_lesson_id = p_lesson_id
    FOR UPDATE;
  ELSE
    SELECT COUNT(*)::integer INTO v_charge_count
    FROM personal_lesson_charges
    WHERE organization_id = v_org_id
      AND personal_lesson_id = p_lesson_id;

    IF v_charge_count <> 1 THEN
      RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.writeOffGroupHint');
    END IF;

    SELECT * INTO v_charge
    FROM personal_lesson_charges
    WHERE organization_id = v_org_id
      AND personal_lesson_id = p_lesson_id
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.adjustFailed');
  END IF;

  SELECT COALESCE(SUM(payment_effective_amount(p)), 0) INTO v_paid
  FROM payments p
  WHERE p.organization_id = v_org_id
    AND (
      p.personal_lesson_charge_id = v_charge.id
      OR (
        p.personal_lesson_charge_id IS NULL
        AND p.personal_lesson_id = p_lesson_id
        AND p.client_id = v_charge.client_id
      )
    );

  v_paid := GREATEST(COALESCE(v_paid, 0), 0);
  v_new_billed := v_paid;
  v_written_off := ROUND(v_charge.billed_amount - v_new_billed, 2);

  IF v_written_off <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.writeOffEmpty');
  END IF;

  UPDATE personal_lesson_charges
  SET billed_amount = v_new_billed
  WHERE organization_id = v_org_id
    AND id = v_charge.id;

  UPDATE personal_lessons
  SET price_id = NULL
  WHERE id = p_lesson_id
    AND organization_id = v_org_id;

  PERFORM sync_personal_lesson_paid_status(v_org_id, p_lesson_id);

  INSERT INTO audit_log (
    organization_id,
    table_name,
    operation,
    row_id,
    old_data,
    new_data,
    changed_by
  )
  VALUES (
    v_org_id,
    'personal_lesson_charges',
    'UPDATE',
    v_charge.id,
    jsonb_build_object('billed_amount', v_charge.billed_amount),
    jsonb_build_object(
      'billed_amount', v_new_billed,
      'written_off', v_written_off,
      'reason_code', p_reason_code,
      'reason_comment', p_reason_comment,
      'correction_kind', 'write_off'
    ),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'success', true,
    'written_off', v_written_off,
    'new_billed', v_new_billed,
    'paid_amount', v_paid
  );
END;
$$;

REVOKE ALL ON FUNCTION get_personal_lesson_debt_trace(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_personal_lesson_debt_trace(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION write_off_personal_lesson_debt(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION write_off_personal_lesson_debt(uuid, uuid, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
