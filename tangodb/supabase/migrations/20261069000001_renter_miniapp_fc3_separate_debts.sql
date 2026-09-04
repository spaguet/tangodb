-- FC3: list_renters exposes cashier_debt and miniapp_debt separately; debt filter by channel.

BEGIN;

DROP FUNCTION IF EXISTS list_renters(text, text, text, boolean, boolean);

CREATE OR REPLACE FUNCTION list_renters(
  p_search text DEFAULT NULL,
  p_type text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_debt_filter text DEFAULT NULL,
  p_upcoming boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_finance boolean;
  v_search text := NULLIF(trim(p_search), '');
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;

  IF NOT member_can_read_renter_directory() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  IF p_debt_filter IS NOT NULL
    AND p_debt_filter NOT IN ('cashier', 'miniapp', 'any') THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.invalidDebtFilter');
  END IF;

  v_finance := member_can_read_renter_finance();

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.display_name), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      r.id,
      r.display_name,
      r.counterparty_type,
      r.status,
      r.contact_phone,
      r.contact_email,
      r.telegram_id::text AS telegram_id,
      (
        SELECT rc.full_name
        FROM renter_contacts rc
        WHERE rc.organization_id = r.organization_id
          AND rc.renter_id = r.id
          AND rc.is_primary = true
        LIMIT 1
      ) AS primary_contact_name,
      _renter_next_rental_date(r.id, r.organization_id) AS next_rental_date,
      CASE WHEN v_finance THEN _renter_debt_total(r.id, r.organization_id) ELSE NULL END AS cashier_debt,
      CASE
        WHEN v_finance THEN _renter_wallet_debt_outstanding(r.organization_id, r.id)
        ELSE NULL
      END AS miniapp_debt,
      EXISTS (
        SELECT 1
        FROM renter_documents rd
        WHERE rd.organization_id = r.organization_id
          AND rd.renter_id = r.id
          AND rd.valid_until IS NOT NULL
          AND rd.valid_until <= current_date + 30
      ) AS has_expiring_document,
      CASE
        WHEN v_finance
          AND r.payment_due_days IS NOT NULL
          AND _renter_debt_total(r.id, r.organization_id) > 0
          AND EXISTS (
            SELECT 1
            FROM rentals rt
            WHERE rt.organization_id = r.organization_id
              AND rt.renter_id = r.id
              AND rt.channel = 'cashier'
              AND rt.booking_status = 'confirmed'
              AND rt.fixed_amount > _rental_paid_total(rt.id, rt.organization_id)
              AND rt.rental_date + r.payment_due_days < current_date
          )
        THEN true
        ELSE false
      END AS has_overdue_debt,
      EXISTS (
        SELECT 1
        FROM renter_communications rc2
        WHERE rc2.organization_id = r.organization_id
          AND rc2.renter_id = r.id
          AND rc2.next_action_at IS NOT NULL
          AND rc2.next_action_at <= now()
      ) AS has_next_action_due
    FROM renters r
    WHERE r.organization_id = v_org_id
      AND (p_status IS NULL OR r.status = p_status)
      AND (p_type IS NULL OR r.counterparty_type = p_type)
      AND (
        v_search IS NULL
        OR r.display_name ILIKE '%' || v_search || '%'
        OR coalesce(r.legal_name, '') ILIKE '%' || v_search || '%'
        OR coalesce(r.contact_phone, '') ILIKE '%' || v_search || '%'
        OR coalesce(r.contact_email, '') ILIKE '%' || v_search || '%'
        OR coalesce(r.norm_phone, '') ILIKE '%' || normalize_renter_phone(v_search) || '%'
        OR coalesce(r.norm_email, '') ILIKE '%' || normalize_renter_email(v_search) || '%'
      )
      AND (
        p_debt_filter IS NULL
        OR (
          p_debt_filter = 'cashier'
          AND _renter_debt_total(r.id, r.organization_id) > 0
        )
        OR (
          p_debt_filter = 'miniapp'
          AND _renter_wallet_debt_outstanding(r.organization_id, r.id) > 0
        )
        OR (
          p_debt_filter = 'any'
          AND (
            _renter_debt_total(r.id, r.organization_id) > 0
            OR _renter_wallet_debt_outstanding(r.organization_id, r.id) > 0
          )
        )
      )
      AND (
        p_upcoming IS NULL
        OR (p_upcoming = true AND _renter_next_rental_date(r.id, r.organization_id) IS NOT NULL)
        OR (p_upcoming = false AND _renter_next_rental_date(r.id, r.organization_id) IS NULL)
      )
  ) x;

  RETURN jsonb_build_object('success', true, 'renters', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION list_renters(text, text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_renters(text, text, text, text, boolean) TO authenticated;

COMMIT;
