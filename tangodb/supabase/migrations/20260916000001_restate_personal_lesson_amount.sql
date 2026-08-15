-- Financial restatement of a personal lesson billed amount (AR correction).
-- Separate from update_personal_lesson: accountants may adjust past lessons,
-- but cannot edit schedule fields through this RPC.

CREATE OR REPLACE FUNCTION restate_personal_lesson_amount(
  p_lesson_id uuid,
  p_new_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_lesson personal_lessons%ROWTYPE;
  v_paid numeric;
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

  IF p_lesson_id IS NULL OR p_new_amount IS NULL OR p_new_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.adjustInvalid');
  END IF;

  SELECT * INTO v_lesson
  FROM personal_lessons
  WHERE id = p_lesson_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.adjustFailed');
  END IF;

  v_paid := COALESCE(v_lesson.paid_amount, 0);

  IF p_new_amount < v_paid THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.adjustBelowPaid');
  END IF;

  UPDATE personal_lessons
  SET
    price = p_new_amount,
    paid = CASE WHEN p_new_amount <= v_paid THEN 'yes' ELSE 'no' END
  WHERE id = p_lesson_id
    AND organization_id = v_org_id;

  RETURN jsonb_build_object(
    'success', true,
    'old_amount', v_lesson.price,
    'new_amount', p_new_amount,
    'paid_amount', v_paid
  );
END;
$$;

REVOKE ALL ON FUNCTION restate_personal_lesson_amount(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION restate_personal_lesson_amount(uuid, numeric) TO authenticated, service_role;
