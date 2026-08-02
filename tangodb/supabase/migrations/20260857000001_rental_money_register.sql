-- Stage 5: unified read-model for rental cash movements (F20, F21).
-- Canonical source for finance journal / aggregates. Excludes internal transfers
-- (advance allocations, deposit apply_to_invoice) to prevent double counting.
-- operation_date is provisional (= created_at in org TZ); editable field — stage 9.

-- =============================================================================
-- 1. Read-model view
-- =============================================================================

CREATE OR REPLACE VIEW rental_money_register_v
WITH (security_invoker = true)
AS
SELECT
  rp.organization_id,
  ('rental_payments:' || rp.id::text) AS register_key,
  rp.id AS entry_id,
  'direct_booking_payment'::text AS entry_type,
  'rental_payments'::text AS source_table,
  rp.id AS source_id,
  rp.amount::numeric(14, 2) AS signed_amount,
  rp.currency,
  rp.method,
  rp.method_comment,
  r.renter_id,
  rp.rental_id,
  NULL::uuid AS invoice_id,
  NULL::uuid AS advance_id,
  NULL::uuid AS deposit_id,
  rp.created_by,
  rp.created_at AS operation_ts,
  (rp.created_at AT TIME ZONE COALESCE(NULLIF(trim(os.timezone), ''), 'UTC'))::date AS operation_date,
  r.rental_date,
  r.location_id,
  ren.display_name AS renter_display
FROM rental_payments rp
JOIN rentals r
  ON r.id = rp.rental_id
 AND r.organization_id = rp.organization_id
JOIN renters ren
  ON ren.id = r.renter_id
 AND ren.organization_id = r.organization_id
LEFT JOIN organization_settings os
  ON os.organization_id = rp.organization_id

UNION ALL

SELECT
  rip.organization_id,
  ('rental_invoice_payments:' || rip.id::text),
  rip.id,
  'invoice_payment',
  'rental_invoice_payments',
  rip.id,
  rip.amount::numeric(14, 2),
  rip.currency,
  rip.method,
  NULL::text,
  ri.renter_id,
  NULL::uuid,
  rip.invoice_id,
  NULL::uuid,
  NULL::uuid,
  rip.created_by,
  rip.created_at,
  (rip.created_at AT TIME ZONE COALESCE(NULLIF(trim(os.timezone), ''), 'UTC'))::date,
  NULL::date,
  NULL::uuid,
  ren.display_name
FROM rental_invoice_payments rip
JOIN rental_invoices ri
  ON ri.id = rip.invoice_id
 AND ri.organization_id = rip.organization_id
JOIN renters ren
  ON ren.id = ri.renter_id
 AND ren.organization_id = ri.organization_id
LEFT JOIN organization_settings os
  ON os.organization_id = rip.organization_id

UNION ALL

SELECT
  ra.organization_id,
  ('rental_advances:' || ra.id::text),
  ra.id,
  'advance_received',
  'rental_advances',
  ra.id,
  ra.amount::numeric(14, 2),
  ra.currency,
  ra.method,
  NULL::text,
  ra.renter_id,
  NULL::uuid,
  NULL::uuid,
  ra.id,
  NULL::uuid,
  ra.created_by,
  ra.created_at,
  (ra.created_at AT TIME ZONE COALESCE(NULLIF(trim(os.timezone), ''), 'UTC'))::date,
  NULL::date,
  NULL::uuid,
  ren.display_name
FROM rental_advances ra
JOIN renters ren
  ON ren.id = ra.renter_id
 AND ren.organization_id = ra.organization_id
LEFT JOIN organization_settings os
  ON os.organization_id = ra.organization_id

UNION ALL

SELECT
  rdm.organization_id,
  ('rental_deposit_movements:' || rdm.id::text),
  rdm.id,
  'deposit_receive',
  'rental_deposit_movements',
  rdm.id,
  rdm.amount::numeric(14, 2),
  rd.currency,
  'other'::text,
  rdm.reason,
  rd.renter_id,
  NULL::uuid,
  rdm.invoice_id,
  NULL::uuid,
  rdm.deposit_id,
  rdm.created_by,
  rdm.created_at,
  (rdm.created_at AT TIME ZONE COALESCE(NULLIF(trim(os.timezone), ''), 'UTC'))::date,
  NULL::date,
  NULL::uuid,
  ren.display_name
FROM rental_deposit_movements rdm
JOIN rental_deposits rd
  ON rd.id = rdm.deposit_id
 AND rd.organization_id = rdm.organization_id
JOIN renters ren
  ON ren.id = rd.renter_id
 AND ren.organization_id = rd.organization_id
LEFT JOIN organization_settings os
  ON os.organization_id = rdm.organization_id
WHERE rdm.movement_type = 'receive'

UNION ALL

SELECT
  rdm.organization_id,
  ('rental_deposit_movements:' || rdm.id::text),
  rdm.id,
  'deposit_return',
  'rental_deposit_movements',
  rdm.id,
  (-rdm.amount)::numeric(14, 2),
  rd.currency,
  'other'::text,
  rdm.reason,
  rd.renter_id,
  NULL::uuid,
  NULL::uuid,
  NULL::uuid,
  rdm.deposit_id,
  rdm.created_by,
  rdm.created_at,
  (rdm.created_at AT TIME ZONE COALESCE(NULLIF(trim(os.timezone), ''), 'UTC'))::date,
  NULL::date,
  NULL::uuid,
  ren.display_name
FROM rental_deposit_movements rdm
JOIN rental_deposits rd
  ON rd.id = rdm.deposit_id
 AND rd.organization_id = rdm.organization_id
JOIN renters ren
  ON ren.id = rd.renter_id
 AND ren.organization_id = rd.organization_id
LEFT JOIN organization_settings os
  ON os.organization_id = rdm.organization_id
WHERE rdm.movement_type = 'return';

COMMENT ON VIEW rental_money_register_v IS
  'Unified rental cash register (stage 5). Excludes advance allocations and deposit apply_to_invoice.';

-- =============================================================================
-- 2. List RPC (finance.read gate)
-- =============================================================================

CREATE OR REPLACE FUNCTION list_rental_money_register(
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_entries jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT can_read_financial() THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_to < p_date_from THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_period');
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'register_key', r.register_key,
        'entry_id', r.entry_id,
        'entry_type', r.entry_type,
        'source_table', r.source_table,
        'source_id', r.source_id,
        'signed_amount', r.signed_amount,
        'amount', r.signed_amount,
        'currency', r.currency,
        'method', r.method,
        'method_comment', r.method_comment,
        'renter_id', r.renter_id,
        'renter_display', r.renter_display,
        'rental_id', r.rental_id,
        'invoice_id', r.invoice_id,
        'advance_id', r.advance_id,
        'deposit_id', r.deposit_id,
        'created_by', r.created_by,
        'operation_ts', r.operation_ts,
        'operation_date', r.operation_date,
        'rental_date', r.rental_date,
        'location_id', r.location_id
      )
      ORDER BY r.operation_ts DESC
    ),
    '[]'::jsonb
  )
  INTO v_entries
  FROM rental_money_register_v r
  WHERE r.organization_id = v_org_id
    AND (p_date_from IS NULL OR r.operation_date >= p_date_from)
    AND (p_date_to IS NULL OR r.operation_date <= p_date_to);

  RETURN jsonb_build_object('success', true, 'entries', v_entries);
END;
$$;

REVOKE ALL ON FUNCTION list_rental_money_register(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_rental_money_register(date, date) TO authenticated;
