-- financial_debtors_v calls _rental_paid_total as SECURITY INVOKER; after S27 carpet
-- REVOKE, authenticated has no SELECT on rental_payments → debtors page fails.
-- Run as definer with org guard (same pattern as other internal rental helpers).

BEGIN;

CREATE OR REPLACE FUNCTION _rental_paid_total(p_rental_id uuid, p_org_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    SUM(
      CASE
        WHEN rp.operation_kind = 'payment' THEN rp.amount
        WHEN rp.operation_kind = 'storno' THEN -rp.amount
        ELSE 0
      END
    ),
    0
  )
  FROM rental_payments rp
  WHERE rp.rental_id = p_rental_id
    AND rp.organization_id = p_org_id
    AND p_org_id = auth_organization_id();
$$;

COMMIT;
