-- Hall-rent stage 17 (F24, F25): primary documents + fiscal payment metadata
-- Product scope: CRM issues numbered invoices OR export package; fiscal fields optional per org profile.

-- =============================================================================
-- 1. Schema
-- =============================================================================

ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS rental_billing_profile JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE rental_invoices
  ADD COLUMN IF NOT EXISTS document_number TEXT,
  ADD COLUMN IF NOT EXISTS document_version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS vat_mode TEXT
    CHECK (vat_mode IS NULL OR vat_mode IN ('none', 'included', 'on_top')),
  ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS net_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS issued_by UUID,
  ADD COLUMN IF NOT EXISTS export_batch_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS rental_invoices_org_document_number_unique
  ON rental_invoices (organization_id, document_number)
  WHERE document_number IS NOT NULL;

ALTER TABLE rental_payments
  ADD COLUMN IF NOT EXISTS fiscal_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (fiscal_status IN ('not_required', 'pending', 'issued', 'failed', 'refunded')),
  ADD COLUMN IF NOT EXISTS fiscal_receipt_number TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_cash_register_id TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_terminal_id TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_acquiring_id TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_refund_receipt_number TEXT;

ALTER TABLE rental_invoice_payments
  ADD COLUMN IF NOT EXISTS fiscal_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (fiscal_status IN ('not_required', 'pending', 'issued', 'failed', 'refunded')),
  ADD COLUMN IF NOT EXISTS fiscal_receipt_number TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_cash_register_id TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_terminal_id TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_acquiring_id TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_refund_receipt_number TEXT;

-- =============================================================================
-- 2. Helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION _rental_billing_profile(p_org_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(os.rental_billing_profile, '{}'::jsonb)
  FROM organization_settings os
  WHERE os.organization_id = p_org_id;
$$;

CREATE OR REPLACE FUNCTION _rental_fiscal_tracking_enabled(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE((_rental_billing_profile(p_org_id) ->> 'fiscal_tracking_enabled')::boolean, false);
$$;

CREATE OR REPLACE FUNCTION _rental_documents_mode(p_org_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(NULLIF(trim(_rental_billing_profile(p_org_id) ->> 'documents_mode'), ''), 'off');
$$;

CREATE OR REPLACE FUNCTION _rental_compute_vat(
  p_total numeric,
  p_vat_mode text,
  p_vat_rate numeric
)
RETURNS TABLE (net_amount numeric, vat_amount numeric)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_rate numeric := COALESCE(p_vat_rate, 0);
  v_net numeric;
  v_vat numeric;
BEGIN
  IF p_total IS NULL OR p_total < 0 THEN
    RETURN QUERY SELECT 0::numeric, 0::numeric;
    RETURN;
  END IF;

  IF p_vat_mode IS NULL OR p_vat_mode = 'none' OR v_rate <= 0 THEN
    RETURN QUERY SELECT round(p_total, 2), 0::numeric;
    RETURN;
  END IF;

  IF p_vat_mode = 'included' THEN
    v_vat := round(p_total * v_rate / (100 + v_rate), 2);
    v_net := round(p_total - v_vat, 2);
    RETURN QUERY SELECT v_net, v_vat;
    RETURN;
  END IF;

  -- on_top: total is net base
  v_net := round(p_total, 2);
  v_vat := round(v_net * v_rate / 100, 2);
  RETURN QUERY SELECT v_net, v_vat;
END;
$$;

CREATE OR REPLACE FUNCTION _rental_resolve_fiscal_status(
  p_org_id uuid,
  p_method text,
  p_requested text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT _rental_fiscal_tracking_enabled(p_org_id) THEN
    RETURN 'not_required';
  END IF;

  IF p_requested IS NOT NULL
    AND p_requested IN ('not_required', 'pending', 'issued', 'failed', 'refunded') THEN
    RETURN p_requested;
  END IF;

  IF p_method IN ('cash', 'card') THEN
    RETURN 'pending';
  END IF;

  RETURN 'not_required';
END;
$$;

CREATE OR REPLACE FUNCTION _rental_next_invoice_number(p_org_id uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_profile jsonb;
  v_prefix text;
  v_next int;
  v_number text;
BEGIN
  SELECT rental_billing_profile INTO v_profile
  FROM organization_settings
  WHERE organization_id = p_org_id
  FOR UPDATE;

  v_prefix := COALESCE(NULLIF(trim(v_profile ->> 'invoice_number_prefix'), ''), '');
  v_next := GREATEST(COALESCE((v_profile ->> 'next_invoice_number')::int, 1), 1);
  v_number := v_prefix || v_next::text;

  UPDATE organization_settings
  SET rental_billing_profile = jsonb_set(
        COALESCE(rental_billing_profile, '{}'::jsonb),
        '{next_invoice_number}',
        to_jsonb(v_next + 1),
        true
      ),
      updated_at = now()
  WHERE organization_id = p_org_id;

  RETURN v_number;
END;
$$;

-- =============================================================================
-- 3. Billing profile RPCs
-- =============================================================================

CREATE OR REPLACE FUNCTION get_rental_billing_profile()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT (can_read_financial() OR member_can_record_rental_payment()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  RETURN jsonb_build_object('success', true, 'profile', _rental_billing_profile(v_org_id));
END;
$$;

CREATE OR REPLACE FUNCTION update_rental_billing_profile(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_current jsonb;
  v_next jsonb;
  v_mode text;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT member_can_manage_venue_cost_rules() OR NOT can_read_financial() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.orgReadOnly');
  END IF;

  v_current := _rental_billing_profile(v_org_id);
  v_next := v_current || COALESCE(p_payload, '{}'::jsonb);

  v_mode := COALESCE(NULLIF(trim(v_next ->> 'documents_mode'), ''), 'off');
  IF v_mode NOT IN ('off', 'crm', 'export') THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.billing.documentsModeInvalid');
  END IF;

  IF COALESCE((v_next ->> 'vat_rate')::numeric, 0) < 0
    OR COALESCE((v_next ->> 'vat_rate')::numeric, 0) > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.billing.vatRateInvalid');
  END IF;

  UPDATE organization_settings
  SET rental_billing_profile = v_next,
      updated_at = now()
  WHERE organization_id = v_org_id;

  RETURN jsonb_build_object('success', true, 'profile', v_next);
END;
$$;

-- =============================================================================
-- 4. Invoice document issue / detail / export
-- =============================================================================

CREATE OR REPLACE FUNCTION issue_rental_invoice_document(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_invoice rental_invoices%ROWTYPE;
  v_profile jsonb;
  v_vat_mode text;
  v_vat_rate numeric;
  v_net numeric;
  v_vat numeric;
  v_number text;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_financial() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  IF _rental_documents_mode(v_org_id) <> 'crm' THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.billing.documentsModeNotCrm');
  END IF;

  SELECT * INTO v_invoice
  FROM rental_invoices ri
  WHERE ri.id = p_invoice_id AND ri.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.invoice.notFound');
  END IF;

  IF v_invoice.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.invoice.cancelled');
  END IF;

  v_profile := _rental_billing_profile(v_org_id);
  v_vat_mode := COALESCE(NULLIF(trim(v_profile ->> 'vat_mode'), ''), 'none');
  v_vat_rate := COALESCE((v_profile ->> 'vat_rate')::numeric, 0);

  SELECT c.net_amount, c.vat_amount
  INTO v_net, v_vat
  FROM _rental_compute_vat(v_invoice.total_amount, v_vat_mode, v_vat_rate) c;

  IF v_invoice.document_number IS NOT NULL THEN
    UPDATE rental_invoices
    SET document_version = document_version + 1,
        vat_mode = v_vat_mode,
        vat_rate = v_vat_rate,
        net_amount = v_net,
        vat_amount = v_vat,
        issued_at = now(),
        issued_by = v_member_id,
        updated_at = now()
    WHERE id = p_invoice_id;

    RETURN jsonb_build_object(
      'success', true,
      'invoice_id', p_invoice_id,
      'document_number', v_invoice.document_number,
      'document_version', v_invoice.document_version + 1,
      'reissued', true
    );
  END IF;

  v_number := _rental_next_invoice_number(v_org_id);

  UPDATE rental_invoices
  SET document_number = v_number,
      document_version = 1,
      vat_mode = v_vat_mode,
      vat_rate = v_vat_rate,
      net_amount = v_net,
      vat_amount = v_vat,
      issued_at = now(),
      issued_by = v_member_id,
      status = CASE WHEN status = 'draft' THEN 'invoiced' ELSE status END,
      updated_at = now()
  WHERE id = p_invoice_id;

  RETURN jsonb_build_object(
    'success', true,
    'invoice_id', p_invoice_id,
    'document_number', v_number,
    'document_version', 1,
    'reissued', false
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.billing.documentNumberDuplicate');
END;
$$;

CREATE OR REPLACE FUNCTION get_rental_invoice_document(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_invoice rental_invoices%ROWTYPE;
  v_profile jsonb;
  v_renter jsonb;
  v_lines jsonb;
  v_org_name text;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_financial() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  SELECT * INTO v_invoice
  FROM rental_invoices ri
  WHERE ri.id = p_invoice_id AND ri.organization_id = v_org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.invoice.notFound');
  END IF;

  v_profile := _rental_billing_profile(v_org_id);

  SELECT jsonb_build_object(
    'id', r.id,
    'display_name', r.display_name,
    'company_name', NULL,
    'inn', NULL
  )
  INTO v_renter
  FROM renters r
  WHERE r.organization_id = v_org_id AND r.id = v_invoice.renter_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', ril.id,
    'rental_id', ril.rental_id,
    'line_type', ril.line_type,
    'description', ril.description,
    'amount', ril.amount
  ) ORDER BY ril.created_at), '[]'::jsonb)
  INTO v_lines
  FROM rental_invoice_lines ril
  WHERE ril.organization_id = v_org_id AND ril.invoice_id = p_invoice_id;

  SELECT COALESCE(NULLIF(trim(os.branding_name), ''), o.name)
  INTO v_org_name
  FROM organization_settings os
  JOIN organizations o ON o.id = os.organization_id
  WHERE os.organization_id = v_org_id;

  RETURN jsonb_build_object(
    'success', true,
    'document', jsonb_build_object(
      'invoice_id', v_invoice.id,
      'document_number', v_invoice.document_number,
      'document_version', v_invoice.document_version,
      'export_batch_id', v_invoice.export_batch_id,
      'period_start', v_invoice.period_start,
      'period_end', v_invoice.period_end,
      'due_date', v_invoice.due_date,
      'status', v_invoice.status,
      'currency', v_invoice.currency,
      'total_amount', v_invoice.total_amount,
      'net_amount', v_invoice.net_amount,
      'vat_amount', v_invoice.vat_amount,
      'vat_mode', v_invoice.vat_mode,
      'vat_rate', v_invoice.vat_rate,
      'issued_at', v_invoice.issued_at,
      'issued_by', v_invoice.issued_by,
      'paid_amount', _rental_invoice_paid_total(v_invoice.id, v_org_id),
      'outstanding', GREATEST(v_invoice.total_amount - _rental_invoice_paid_total(v_invoice.id, v_org_id), 0),
      'lines', v_lines,
      'renter', v_renter,
      'organization_name', v_org_name,
      'billing_profile', v_profile
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION export_rental_invoice_documents(p_invoice_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_mode text;
  v_batch_id uuid := gen_random_uuid();
  v_docs jsonb := '[]'::jsonb;
  v_invoice_id uuid;
  v_doc jsonb;
  v_number text;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_financial() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  v_mode := _rental_documents_mode(v_org_id);
  IF v_mode = 'off' THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.billing.documentsModeOff');
  END IF;

  IF p_invoice_ids IS NULL OR cardinality(p_invoice_ids) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.billing.exportEmpty');
  END IF;

  FOREACH v_invoice_id IN ARRAY p_invoice_ids LOOP
    IF v_mode = 'export' THEN
      PERFORM 1
      FROM rental_invoices ri
      WHERE ri.id = v_invoice_id
        AND ri.organization_id = v_org_id
        AND ri.status <> 'cancelled'
      FOR UPDATE;

      IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'rental.invoice.notFound');
      END IF;

      IF (SELECT document_number FROM rental_invoices WHERE id = v_invoice_id) IS NULL THEN
        v_number := _rental_next_invoice_number(v_org_id);
        UPDATE rental_invoices
        SET document_number = v_number,
            export_batch_id = v_batch_id,
            updated_at = now()
        WHERE id = v_invoice_id;
      ELSE
        UPDATE rental_invoices
        SET export_batch_id = v_batch_id,
            updated_at = now()
        WHERE id = v_invoice_id;
      END IF;
    ELSE
      UPDATE rental_invoices
      SET export_batch_id = v_batch_id,
          updated_at = now()
      WHERE id = v_invoice_id
        AND organization_id = v_org_id
        AND status <> 'cancelled';

      IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'rental.invoice.notFound');
      END IF;
    END IF;

    v_doc := get_rental_invoice_document(v_invoice_id) -> 'document';
    v_docs := v_docs || jsonb_build_array(v_doc);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'export_batch_id', v_batch_id,
    'documents', v_docs
  );
END;
$$;

-- =============================================================================
-- 5. List invoices — document fields
-- =============================================================================

CREATE OR REPLACE FUNCTION list_renter_rental_invoices(p_renter_id uuid)
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
    'id', ri.id,
    'series_id', ri.series_id,
    'period_start', ri.period_start,
    'period_end', ri.period_end,
    'due_date', ri.due_date,
    'status', ri.status,
    'currency', ri.currency,
    'total_amount', ri.total_amount,
    'paid_amount', _rental_invoice_paid_total(ri.id, ri.organization_id),
    'outstanding', GREATEST(ri.total_amount - _rental_invoice_paid_total(ri.id, ri.organization_id), 0),
    'document_number', ri.document_number,
    'document_version', ri.document_version,
    'vat_mode', ri.vat_mode,
    'vat_rate', ri.vat_rate,
    'net_amount', ri.net_amount,
    'vat_amount', ri.vat_amount,
    'issued_at', ri.issued_at,
    'export_batch_id', ri.export_batch_id
  ) ORDER BY ri.period_start DESC), '[]'::jsonb)
  INTO v_rows
  FROM rental_invoices ri
  WHERE ri.organization_id = v_org_id AND ri.renter_id = p_renter_id;

  RETURN jsonb_build_object('success', true, 'invoices', v_rows);
END;
$$;

-- =============================================================================
-- 6. Payments — fiscal metadata
-- =============================================================================

CREATE OR REPLACE FUNCTION record_rental_payment(
  p_rental_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_method_comment text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_operation_date date DEFAULT NULL,
  p_fiscal_status text DEFAULT NULL,
  p_fiscal_receipt_number text DEFAULT NULL,
  p_fiscal_cash_register_id text DEFAULT NULL,
  p_fiscal_terminal_id text DEFAULT NULL,
  p_fiscal_acquiring_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_rental rentals%ROWTYPE;
  v_key text := NULLIF(trim(p_idempotency_key), '');
  v_existing rental_payments%ROWTYPE;
  v_payment_id uuid;
  v_new_paid numeric;
  v_effective numeric;
  v_new_status text;
  v_operation_date date;
  v_today date;
  v_fiscal_status text;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.orgReadOnly');
  END IF;

  IF NOT member_can_record_rental_payment() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.paymentAmountInvalid');
  END IF;

  IF p_method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.paymentMethodInvalid');
  END IF;

  v_today := _org_local_date(v_org_id);
  v_operation_date := COALESCE(p_operation_date, v_today);

  IF v_operation_date > v_today THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.operationDateFuture');
  END IF;

  IF _is_finance_period_closed(v_org_id, v_operation_date) THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.periodClosed');
  END IF;

  v_fiscal_status := _rental_resolve_fiscal_status(v_org_id, p_method, p_fiscal_status);

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM rental_payments rp
    WHERE rp.organization_id = v_org_id AND rp.idempotency_key = v_key;

    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'payment_id', v_existing.id, 'already_applied', true);
    END IF;
  END IF;

  SELECT * INTO v_rental
  FROM rentals r
  WHERE r.id = p_rental_id AND r.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.notFound');
  END IF;

  IF v_rental.booking_status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.alreadyCancelled');
  END IF;

  INSERT INTO rental_payments (
    organization_id, rental_id, amount, currency, method, method_comment,
    idempotency_key, created_by, operation_date,
    fiscal_status, fiscal_receipt_number, fiscal_cash_register_id,
    fiscal_terminal_id, fiscal_acquiring_id
  )
  VALUES (
    v_org_id,
    p_rental_id,
    p_amount,
    v_rental.currency,
    p_method,
    NULLIF(trim(p_method_comment), ''),
    v_key,
    v_member_id,
    v_operation_date,
    v_fiscal_status,
    NULLIF(trim(p_fiscal_receipt_number), ''),
    NULLIF(trim(p_fiscal_cash_register_id), ''),
    NULLIF(trim(p_fiscal_terminal_id), ''),
    NULLIF(trim(p_fiscal_acquiring_id), '')
  )
  RETURNING id INTO v_payment_id;

  v_new_paid := _rental_paid_total(p_rental_id, v_org_id);
  v_effective := _rental_effective_amount(v_rental.fixed_amount, v_rental.final_amount);
  v_new_status := _rental_payment_status(v_effective, v_new_paid);

  UPDATE rentals SET updated_at = now() WHERE id = p_rental_id;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'paid_amount', v_new_paid,
    'payment_status', v_new_status,
    'operation_date', v_operation_date,
    'fiscal_status', v_fiscal_status
  );
EXCEPTION
  WHEN unique_violation THEN
    IF v_key IS NOT NULL THEN
      SELECT id INTO v_payment_id FROM rental_payments WHERE organization_id = v_org_id AND idempotency_key = v_key;
      IF v_payment_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id, 'already_applied', true);
      END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.duplicate');
END;
$$;

CREATE OR REPLACE FUNCTION record_rental_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_idempotency_key text DEFAULT NULL,
  p_operation_date date DEFAULT NULL,
  p_fiscal_status text DEFAULT NULL,
  p_fiscal_receipt_number text DEFAULT NULL,
  p_fiscal_cash_register_id text DEFAULT NULL,
  p_fiscal_terminal_id text DEFAULT NULL,
  p_fiscal_acquiring_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_key text := NULLIF(trim(p_idempotency_key), '');
  v_invoice rental_invoices%ROWTYPE;
  v_existing rental_invoice_payments%ROWTYPE;
  v_payment_id uuid;
  v_paid numeric;
  v_status text;
  v_operation_date date;
  v_today date;
  v_fiscal_status text;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_financial() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.paymentAmountInvalid');
  END IF;

  IF p_method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.paymentMethodInvalid');
  END IF;

  v_today := _org_local_date(v_org_id);
  v_operation_date := COALESCE(p_operation_date, v_today);

  IF v_operation_date > v_today THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.operationDateFuture');
  END IF;

  IF _is_finance_period_closed(v_org_id, v_operation_date) THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.periodClosed');
  END IF;

  v_fiscal_status := _rental_resolve_fiscal_status(v_org_id, p_method, p_fiscal_status);

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM rental_invoice_payments rip
    WHERE rip.organization_id = v_org_id AND rip.idempotency_key = v_key;

    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'payment_id', v_existing.id, 'already_applied', true);
    END IF;
  END IF;

  SELECT * INTO v_invoice
  FROM rental_invoices ri
  WHERE ri.id = p_invoice_id AND ri.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.invoice.notFound');
  END IF;

  IF v_invoice.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.invoice.cancelled');
  END IF;

  INSERT INTO rental_invoice_payments (
    organization_id, invoice_id, amount, currency, method, idempotency_key, created_by, operation_date,
    fiscal_status, fiscal_receipt_number, fiscal_cash_register_id,
    fiscal_terminal_id, fiscal_acquiring_id
  )
  VALUES (
    v_org_id, p_invoice_id, p_amount, v_invoice.currency, p_method, v_key, v_member_id, v_operation_date,
    v_fiscal_status,
    NULLIF(trim(p_fiscal_receipt_number), ''),
    NULLIF(trim(p_fiscal_cash_register_id), ''),
    NULLIF(trim(p_fiscal_terminal_id), ''),
    NULLIF(trim(p_fiscal_acquiring_id), '')
  )
  RETURNING id INTO v_payment_id;

  v_paid := _rental_invoice_paid_total(p_invoice_id, v_org_id);
  v_status := _rental_invoice_status(v_invoice.total_amount, v_paid, v_invoice.due_date, v_invoice.status);

  UPDATE rental_invoices
  SET status = v_status, updated_at = now()
  WHERE id = p_invoice_id;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'paid_amount', v_paid,
    'status', v_status,
    'fiscal_status', v_fiscal_status
  );
EXCEPTION
  WHEN unique_violation THEN
    IF v_key IS NOT NULL THEN
      SELECT id INTO v_payment_id FROM rental_invoice_payments WHERE organization_id = v_org_id AND idempotency_key = v_key;
      IF v_payment_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id, 'already_applied', true);
      END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.duplicate');
END;
$$;

CREATE OR REPLACE FUNCTION update_rental_payment_fiscal(
  p_payment_id uuid,
  p_source text,
  p_fiscal_status text DEFAULT NULL,
  p_fiscal_receipt_number text DEFAULT NULL,
  p_fiscal_cash_register_id text DEFAULT NULL,
  p_fiscal_terminal_id text DEFAULT NULL,
  p_fiscal_acquiring_id text DEFAULT NULL,
  p_fiscal_refund_receipt_number text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_financial() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  IF p_source NOT IN ('rental_payments', 'rental_invoice_payments') THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.billing.fiscalSourceInvalid');
  END IF;

  IF p_fiscal_status IS NOT NULL
    AND p_fiscal_status NOT IN ('not_required', 'pending', 'issued', 'failed', 'refunded') THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.billing.fiscalStatusInvalid');
  END IF;

  IF p_source = 'rental_payments' THEN
    UPDATE rental_payments rp
    SET fiscal_status = COALESCE(p_fiscal_status, rp.fiscal_status),
        fiscal_receipt_number = COALESCE(NULLIF(trim(p_fiscal_receipt_number), ''), rp.fiscal_receipt_number),
        fiscal_cash_register_id = COALESCE(NULLIF(trim(p_fiscal_cash_register_id), ''), rp.fiscal_cash_register_id),
        fiscal_terminal_id = COALESCE(NULLIF(trim(p_fiscal_terminal_id), ''), rp.fiscal_terminal_id),
        fiscal_acquiring_id = COALESCE(NULLIF(trim(p_fiscal_acquiring_id), ''), rp.fiscal_acquiring_id),
        fiscal_refund_receipt_number = COALESCE(NULLIF(trim(p_fiscal_refund_receipt_number), ''), rp.fiscal_refund_receipt_number)
    WHERE rp.id = p_payment_id AND rp.organization_id = v_org_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.paymentNotFound');
    END IF;
  ELSE
    UPDATE rental_invoice_payments rip
    SET fiscal_status = COALESCE(p_fiscal_status, rip.fiscal_status),
        fiscal_receipt_number = COALESCE(NULLIF(trim(p_fiscal_receipt_number), ''), rip.fiscal_receipt_number),
        fiscal_cash_register_id = COALESCE(NULLIF(trim(p_fiscal_cash_register_id), ''), rip.fiscal_cash_register_id),
        fiscal_terminal_id = COALESCE(NULLIF(trim(p_fiscal_terminal_id), ''), rip.fiscal_terminal_id),
        fiscal_acquiring_id = COALESCE(NULLIF(trim(p_fiscal_acquiring_id), ''), rip.fiscal_acquiring_id),
        fiscal_refund_receipt_number = COALESCE(NULLIF(trim(p_fiscal_refund_receipt_number), ''), rip.fiscal_refund_receipt_number)
    WHERE rip.id = p_payment_id AND rip.organization_id = v_org_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'rental.billing.invoicePaymentNotFound');
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'payment_id', p_payment_id);
END;
$$;

-- =============================================================================
-- 7. Grants
-- =============================================================================

REVOKE ALL ON FUNCTION get_rental_billing_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_rental_billing_profile() TO authenticated;

REVOKE ALL ON FUNCTION update_rental_billing_profile(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_rental_billing_profile(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION issue_rental_invoice_document(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION issue_rental_invoice_document(uuid) TO authenticated;

REVOKE ALL ON FUNCTION get_rental_invoice_document(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_rental_invoice_document(uuid) TO authenticated;

REVOKE ALL ON FUNCTION export_rental_invoice_documents(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION export_rental_invoice_documents(uuid[]) TO authenticated;

REVOKE ALL ON FUNCTION update_rental_payment_fiscal(uuid, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_rental_payment_fiscal(uuid, text, text, text, text, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION record_rental_payment(uuid, numeric, text, text, text, date, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_rental_payment(uuid, numeric, text, text, text, date, text, text, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION record_rental_invoice_payment(uuid, numeric, text, text, date, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_rental_invoice_payment(uuid, numeric, text, text, date, text, text, text, text, text) TO authenticated;
