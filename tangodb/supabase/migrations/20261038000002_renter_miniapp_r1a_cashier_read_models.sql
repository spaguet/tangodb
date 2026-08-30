-- R1a: cashier unpaid/debt read-models skip Mini App; renter card/list keep Mini App rows.

BEGIN;

CREATE OR REPLACE FUNCTION _renter_debt_total(p_renter_id uuid, p_org_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(sum(
    GREATEST(
      _rental_effective_amount(r.fixed_amount, r.final_amount) - _rental_paid_total(r.id, r.organization_id),
      0
    )
  ), 0)
  FROM rentals r
  WHERE r.organization_id = p_org_id
    AND r.renter_id = p_renter_id
    AND r.booking_status = 'confirmed'
    AND r.channel = 'cashier'
    AND _rental_effective_amount(r.fixed_amount, r.final_amount)
      > _rental_paid_total(r.id, r.organization_id);
$$;

CREATE OR REPLACE FUNCTION get_renter_detail(p_renter_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_renter renters%ROWTYPE;
  v_can_finance boolean;
  v_can_profile boolean;
  v_can_documents boolean;
  v_contacts jsonb;
  v_contracts jsonb;
  v_documents_list jsonb;
  v_communications jsonb;
  v_finance_summary jsonb;
  v_rental_counts jsonb;
  v_paid numeric;
  v_fixed numeric;
  v_debt numeric;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;

  IF NOT member_can_read_renter_directory() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  SELECT * INTO v_renter
  FROM renters r
  WHERE r.id = p_renter_id AND r.organization_id = v_org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.notFound');
  END IF;

  v_can_finance := member_can_read_renter_finance();
  v_can_profile := member_can_read_renter_profile();
  v_can_documents := member_can_read_renter_documents();

  IF v_can_profile THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', rc.id,
      'full_name', rc.full_name,
      'role_title', rc.role_title,
      'phone', rc.phone,
      'email', rc.email,
      'telegram', rc.telegram,
      'is_primary', rc.is_primary,
      'notes', rc.notes
    ) ORDER BY rc.is_primary DESC, rc.full_name), '[]'::jsonb)
    INTO v_contacts
    FROM renter_contacts rc
    WHERE rc.organization_id = v_org_id AND rc.renter_id = p_renter_id;
  ELSE
    v_contacts := '[]'::jsonb;
  END IF;

  IF v_can_profile THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'contract_number', c.contract_number,
      'title', c.title,
      'contract_type', c.contract_type,
      'signed_at', c.signed_at,
      'valid_from', c.valid_from,
      'valid_to', c.valid_to,
      'status', c.status,
      'signatory_name', c.signatory_name,
      'location_ids', c.location_ids,
      'deposit_info', c.deposit_info
    ) ORDER BY c.valid_from DESC NULLS LAST, c.created_at DESC), '[]'::jsonb)
    INTO v_contracts
    FROM renter_contracts c
    WHERE c.organization_id = v_org_id AND c.renter_id = p_renter_id;
  ELSE
    v_contracts := '[]'::jsonb;
  END IF;

  IF v_can_documents THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', d.id,
      'contract_id', d.contract_id,
      'category', d.category,
      'display_name', d.display_name,
      'document_date', d.document_date,
      'valid_until', d.valid_until,
      'mime_type', d.mime_type,
      'file_size', d.file_size,
      'created_at', d.created_at
    ) ORDER BY d.created_at DESC), '[]'::jsonb)
    INTO v_documents_list
    FROM renter_documents d
    WHERE d.organization_id = v_org_id AND d.renter_id = p_renter_id;
  ELSE
    v_documents_list := '[]'::jsonb;
  END IF;

  IF v_can_profile THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', cm.id,
      'comm_type', cm.comm_type,
      'occurred_at', cm.occurred_at,
      'subject', cm.subject,
      'body', cm.body,
      'contact_id', cm.contact_id,
      'next_action_at', cm.next_action_at,
      'author_member_id', cm.author_member_id,
      'created_at', cm.created_at
    ) ORDER BY cm.occurred_at DESC), '[]'::jsonb)
    INTO v_communications
    FROM renter_communications cm
    WHERE cm.organization_id = v_org_id AND cm.renter_id = p_renter_id;
  ELSE
    v_communications := '[]'::jsonb;
  END IF;

  IF v_can_finance THEN
    SELECT COALESCE(sum(_rental_paid_total(r.id, r.organization_id)), 0)
    INTO v_paid
    FROM rentals r
    WHERE r.organization_id = v_org_id
      AND r.renter_id = p_renter_id
      AND r.booking_status = 'confirmed'
      AND r.channel = 'cashier';

    SELECT COALESCE(sum(_rental_effective_amount(r.fixed_amount, r.final_amount)), 0)
    INTO v_fixed
    FROM rentals r
    WHERE r.organization_id = v_org_id
      AND r.renter_id = p_renter_id
      AND r.booking_status = 'confirmed'
      AND r.channel = 'cashier';

    v_debt := _renter_debt_total(p_renter_id, v_org_id);

    v_finance_summary := jsonb_build_object(
      'fixed_total', v_fixed,
      'paid_total', v_paid,
      'debt_total', v_debt,
      'overpaid_total', GREATEST(COALESCE(v_paid, 0) - COALESCE(v_fixed, 0), 0)
    );
  ELSE
    v_finance_summary := NULL;
  END IF;

  SELECT jsonb_build_object(
    'completed', count(*) FILTER (WHERE r.rental_date < current_date AND r.booking_status = 'confirmed'),
    'upcoming', count(*) FILTER (WHERE r.rental_date >= current_date AND r.booking_status = 'confirmed'),
    'cancelled', count(*) FILTER (WHERE r.booking_status = 'cancelled')
  )
  INTO v_rental_counts
  FROM rentals r
  WHERE r.organization_id = v_org_id AND r.renter_id = p_renter_id;

  RETURN jsonb_build_object(
    'success', true,
    'renter', jsonb_build_object(
      'id', v_renter.id,
      'display_name', v_renter.display_name,
      'counterparty_type', CASE WHEN v_can_profile THEN v_renter.counterparty_type ELSE NULL END,
      'status', v_renter.status,
      'contact_phone', CASE WHEN v_can_profile THEN v_renter.contact_phone ELSE NULL END,
      'contact_email', CASE WHEN v_can_profile THEN v_renter.contact_email ELSE NULL END,
      'legal_name', CASE WHEN v_can_profile THEN v_renter.legal_name ELSE NULL END,
      'tax_id', CASE WHEN v_can_profile THEN v_renter.tax_id ELSE NULL END,
      'registration_number', CASE WHEN v_can_profile THEN v_renter.registration_number ELSE NULL END,
      'legal_address', CASE WHEN v_can_profile THEN v_renter.legal_address ELSE NULL END,
      'actual_address', CASE WHEN v_can_profile THEN v_renter.actual_address ELSE NULL END,
      'blocked_reason', CASE WHEN v_can_profile THEN v_renter.blocked_reason ELSE NULL END,
      'internal_notes', CASE WHEN v_can_profile THEN v_renter.internal_notes ELSE NULL END,
      'preferred_location_ids', CASE WHEN v_can_profile THEN v_renter.preferred_location_ids ELSE NULL END,
      'payment_due_days', CASE WHEN v_can_profile THEN v_renter.payment_due_days ELSE NULL END,
      'notes', CASE WHEN v_can_profile THEN v_renter.notes ELSE NULL END,
      'archived_at', v_renter.archived_at,
      'next_rental_date', _renter_next_rental_date(p_renter_id, v_org_id)
    ),
    'contacts', v_contacts,
    'contracts', v_contracts,
    'documents', v_documents_list,
    'communications', v_communications,
    'finance', v_finance_summary,
    'rental_counts', v_rental_counts
  );
END;
$$;

CREATE OR REPLACE FUNCTION list_renter_rentals(p_renter_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_finance boolean;
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;

  IF NOT member_can_read_renter_directory() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM renters r
    WHERE r.id = p_renter_id AND r.organization_id = v_org_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.notFound');
  END IF;

  v_finance := member_can_read_renter_finance();

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'rental_date', r.rental_date,
    'time_start', r.time_start,
    'time_end', r.time_end,
    'location_id', r.location_id,
    'purpose', CASE WHEN member_can_read_renter_profile() THEN r.purpose ELSE NULL END,
    'booking_status', r.booking_status,
    'channel', r.channel,
    'lifecycle', r.lifecycle,
    'fixed_amount', CASE
      WHEN NOT v_finance THEN NULL
      WHEN r.channel = 'miniapp' THEN r.fixed_amount
      ELSE _rental_effective_amount(r.fixed_amount, r.final_amount)
    END,
    'currency', CASE WHEN v_finance THEN r.currency ELSE NULL END,
    'paid_amount', CASE
      WHEN NOT v_finance THEN NULL
      WHEN r.channel = 'miniapp' THEN NULL
      ELSE _rental_paid_total(r.id, r.organization_id)
    END,
    'payment_status', CASE
      WHEN NOT v_finance THEN NULL
      WHEN r.channel = 'miniapp' THEN NULL
      ELSE _rental_payment_status(
        _rental_effective_amount(r.fixed_amount, r.final_amount),
        _rental_paid_total(r.id, r.organization_id)
      )
    END,
    'cancelled_at', r.cancelled_at
  ) ORDER BY r.rental_date DESC, r.time_start DESC), '[]'::jsonb)
  INTO v_rows
  FROM rentals r
  WHERE r.organization_id = v_org_id
    AND r.renter_id = p_renter_id;

  RETURN jsonb_build_object('success', true, 'rentals', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION list_rental_payment_inbox(
  p_bucket text DEFAULT 'queue',
  p_as_of_date date DEFAULT NULL,
  p_location_id uuid DEFAULT NULL,
  p_renter_id uuid DEFAULT NULL,
  p_payment_status text DEFAULT NULL,
  p_cashier_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_today date;
  v_bucket text := lower(COALESCE(NULLIF(trim(p_bucket), ''), 'queue'));
  v_limit integer := GREATEST(LEAST(COALESCE(p_limit, 50), 200), 1);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_rows jsonb;
  v_total integer;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'unauthorized');
  END IF;

  IF NOT member_can_record_rental_payment() THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  v_today := COALESCE(p_as_of_date, _org_local_date(v_org_id));

  IF v_bucket NOT IN ('queue', 'today', 'overdue', 'partial', 'overpaid', 'unpaid') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_bucket');
  END IF;

  IF p_payment_status IS NOT NULL
     AND p_payment_status NOT IN ('unpaid', 'partial', 'paid', 'overpaid') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_status');
  END IF;

  WITH base AS (
    SELECT
      r.id AS rental_id,
      r.rental_date,
      r.time_start,
      r.time_end,
      r.location_id,
      r.rental_series_id,
      r.purpose,
      r.renter_id,
      ren.display_name AS renter_name,
      loc.name AS location_name,
      COALESCE(r.currency, 'RUB') AS currency,
      _rental_effective_amount(r.fixed_amount, r.final_amount) AS effective_amount,
      _rental_paid_total(r.id, r.organization_id) AS paid_amount,
      _rental_payment_status(
        _rental_effective_amount(r.fixed_amount, r.final_amount),
        _rental_paid_total(r.id, r.organization_id)
      ) AS payment_status,
      GREATEST(
        _rental_effective_amount(r.fixed_amount, r.final_amount)
          - _rental_paid_total(r.id, r.organization_id),
        0
      ) AS remaining_amount,
      (
        SELECT rp.created_by
        FROM rental_payments rp
        WHERE rp.organization_id = r.organization_id
          AND rp.rental_id = r.id
          AND COALESCE(rp.operation_kind, 'payment') = 'payment'
        ORDER BY rp.created_at DESC
        LIMIT 1
      ) AS last_payment_by
    FROM rentals r
    INNER JOIN renters ren
      ON ren.id = r.renter_id
     AND ren.organization_id = r.organization_id
    LEFT JOIN locations loc
      ON loc.id = r.location_id
     AND loc.organization_id = r.organization_id
    WHERE r.organization_id = v_org_id
      AND business_row_readable()
      AND r.booking_status = 'confirmed'
      AND r.channel = 'cashier'
      AND _rental_effective_amount(r.fixed_amount, r.final_amount) > 0
  ),
  filtered AS (
    SELECT *
    FROM base b
    WHERE
      (p_location_id IS NULL OR b.location_id = p_location_id)
      AND (p_renter_id IS NULL OR b.renter_id = p_renter_id)
      AND (p_payment_status IS NULL OR b.payment_status = p_payment_status)
      AND (
        p_cashier_id IS NULL
        OR b.last_payment_by = p_cashier_id
        OR (b.last_payment_by IS NULL AND b.payment_status = 'unpaid')
      )
      AND (
        CASE v_bucket
          WHEN 'today' THEN
            b.rental_date = v_today
            AND b.payment_status IN ('unpaid', 'partial')
          WHEN 'overdue' THEN
            b.rental_date < v_today
            AND b.payment_status IN ('unpaid', 'partial')
          WHEN 'partial' THEN
            b.payment_status = 'partial'
          WHEN 'overpaid' THEN
            b.payment_status = 'overpaid'
          WHEN 'unpaid' THEN
            b.payment_status = 'unpaid'
          ELSE
            b.payment_status IN ('unpaid', 'partial', 'overpaid')
        END
      )
  ),
  counted AS (
    SELECT count(*)::integer AS total FROM filtered
  ),
  page AS (
    SELECT *
    FROM filtered
    ORDER BY
      CASE WHEN rental_date < v_today AND payment_status IN ('unpaid', 'partial') THEN 0 ELSE 1 END,
      rental_date ASC,
      time_start ASC,
      renter_name ASC
    LIMIT v_limit
    OFFSET v_offset
  )
  SELECT
    (SELECT total FROM counted),
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'rental_id', p.rental_id,
            'rental_date', p.rental_date,
            'time_start', p.time_start,
            'time_end', p.time_end,
            'location_id', p.location_id,
            'location_name', p.location_name,
            'rental_series_id', p.rental_series_id,
            'purpose', p.purpose,
            'renter_id', p.renter_id,
            'renter_name', p.renter_name,
            'currency', p.currency,
            'effective_amount', p.effective_amount,
            'paid_amount', p.paid_amount,
            'remaining_amount', p.remaining_amount,
            'payment_status', p.payment_status,
            'last_payment_by', p.last_payment_by,
            'is_overdue', p.rental_date < v_today AND p.payment_status IN ('unpaid', 'partial')
          )
          ORDER BY
            CASE WHEN p.rental_date < v_today AND p.payment_status IN ('unpaid', 'partial') THEN 0 ELSE 1 END,
            p.rental_date ASC,
            p.time_start ASC,
            p.renter_name ASC
        )
        FROM page p
      ),
      '[]'::jsonb
    )
  INTO v_total, v_rows;

  RETURN jsonb_build_object(
    'success', true,
    'as_of_date', v_today,
    'bucket', v_bucket,
    'total', COALESCE(v_total, 0),
    'limit', v_limit,
    'offset', v_offset,
    'items', COALESCE(v_rows, '[]'::jsonb)
  );
END;
$$;

-- Rental branch of AR view: cashier only. Personal/group/subscription branches unchanged.
DO $$
BEGIN
  IF to_regclass('public._financial_debtors_v_unfiltered') IS NULL THEN
    ALTER VIEW public.financial_debtors_v RENAME TO _financial_debtors_v_unfiltered;
  END IF;
END $$;

REVOKE ALL ON TABLE _financial_debtors_v_unfiltered FROM PUBLIC, anon, authenticated;

DROP VIEW IF EXISTS public.financial_debtors_v;

CREATE VIEW public.financial_debtors_v
WITH (security_invoker = false) AS
SELECT v.*
FROM _financial_debtors_v_unfiltered v
WHERE v.kind IS DISTINCT FROM 'rental'
   OR EXISTS (
     SELECT 1
     FROM rentals r
     WHERE r.id = v.rental_id
       AND r.organization_id = v.organization_id
       AND r.channel = 'cashier'
   );

COMMENT ON VIEW financial_debtors_v IS
  'AR register. Rental rows are channel=cashier only (R1a); Mini App holds are not 2.5 debtors.';

GRANT SELECT ON financial_debtors_v TO authenticated;

COMMIT;
