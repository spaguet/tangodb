-- Integration fix: drop legacy record_rental_payment overloads (ambiguous with fiscal 11-arg version).
-- Fix list_renter_rental_advances referencing non-existent rental_advances.notes.

BEGIN;

DROP FUNCTION IF EXISTS record_rental_payment(uuid, numeric, text, text, text);
DROP FUNCTION IF EXISTS record_rental_payment(uuid, numeric, text, text, text, date);

CREATE OR REPLACE FUNCTION list_renter_rental_advances(p_renter_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_financial() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', ra.id,
    'amount', ra.amount,
    'allocated_amount', ra.allocated_amount,
    'available', GREATEST(ra.amount - ra.allocated_amount, 0),
    'currency', ra.currency,
    'method', ra.method,
    'operation_date', ra.operation_date,
    'created_at', ra.created_at
  ) ORDER BY ra.operation_date DESC, ra.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM rental_advances ra
  WHERE ra.organization_id = v_org_id
    AND ra.renter_id = p_renter_id;

  RETURN jsonb_build_object('success', true, 'advances', v_rows);
END;
$$;

COMMIT;
