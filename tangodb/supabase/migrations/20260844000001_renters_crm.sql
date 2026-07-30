-- Renters CRM database (CRM scenario 13 / Prompt 13)
-- Extends minimal renters from 20260843000001_hall_rentals.sql

BEGIN;

-- =============================================================================
-- 1. Extend renters
-- =============================================================================

ALTER TABLE renters
  ADD COLUMN IF NOT EXISTS counterparty_type TEXT NOT NULL DEFAULT 'individual'
    CHECK (counterparty_type IN ('individual', 'sole_proprietor', 'company')),
  ADD COLUMN IF NOT EXISTS legal_name TEXT,
  ADD COLUMN IF NOT EXISTS tax_id TEXT,
  ADD COLUMN IF NOT EXISTS registration_number TEXT,
  ADD COLUMN IF NOT EXISTS legal_address TEXT,
  ADD COLUMN IF NOT EXISTS actual_address TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived', 'blocked')),
  ADD COLUMN IF NOT EXISTS blocked_reason TEXT,
  ADD COLUMN IF NOT EXISTS internal_notes TEXT,
  ADD COLUMN IF NOT EXISTS preferred_location_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS payment_due_days INT
    CHECK (payment_due_days IS NULL OR payment_due_days >= 0),
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS norm_phone TEXT,
  ADD COLUMN IF NOT EXISTS norm_email TEXT,
  ADD COLUMN IF NOT EXISTS norm_tax_id TEXT,
  ADD COLUMN IF NOT EXISTS duplicate_create_reason TEXT,
  ADD COLUMN IF NOT EXISTS duplicate_create_by UUID;

ALTER TABLE renters DROP CONSTRAINT IF EXISTS renters_duplicate_create_by_fk;
ALTER TABLE renters
  ADD CONSTRAINT renters_duplicate_create_by_fk
  FOREIGN KEY (organization_id, duplicate_create_by)
  REFERENCES organization_members (organization_id, id);

ALTER TABLE renters
  ADD CONSTRAINT renters_blocked_reason_required
  CHECK (status <> 'blocked' OR NULLIF(trim(blocked_reason), '') IS NOT NULL);

ALTER TABLE renters
  ADD CONSTRAINT renters_archived_at_consistency
  CHECK (
    (status = 'archived' AND archived_at IS NOT NULL)
    OR (status <> 'archived' AND archived_at IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_renters_org_status_name
  ON renters (organization_id, status, display_name);

CREATE INDEX IF NOT EXISTS idx_renters_org_type
  ON renters (organization_id, counterparty_type)
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS renters_org_norm_phone_unique
  ON renters (organization_id, norm_phone)
  WHERE norm_phone IS NOT NULL AND status <> 'archived';

CREATE UNIQUE INDEX IF NOT EXISTS renters_org_norm_email_unique
  ON renters (organization_id, norm_email)
  WHERE norm_email IS NOT NULL AND status <> 'archived';

CREATE UNIQUE INDEX IF NOT EXISTS renters_org_norm_tax_id_unique
  ON renters (organization_id, norm_tax_id)
  WHERE norm_tax_id IS NOT NULL AND status <> 'archived';

-- =============================================================================
-- 2. Related tables
-- =============================================================================

CREATE TABLE renter_contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  renter_id       UUID NOT NULL,
  full_name       TEXT NOT NULL,
  role_title      TEXT,
  phone           TEXT,
  email           TEXT,
  telegram        TEXT,
  is_primary      BOOLEAN NOT NULL DEFAULT false,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, renter_id)
    REFERENCES renters (organization_id, id) ON DELETE CASCADE,
  CHECK (length(trim(full_name)) > 0)
);

CREATE UNIQUE INDEX renter_contacts_one_primary
  ON renter_contacts (organization_id, renter_id)
  WHERE is_primary = true;

CREATE INDEX idx_renter_contacts_org_renter
  ON renter_contacts (organization_id, renter_id);

CREATE TABLE renter_contracts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  renter_id           UUID NOT NULL,
  contract_number     TEXT,
  title               TEXT NOT NULL,
  contract_type       TEXT,
  signed_at           DATE,
  valid_from          DATE,
  valid_to            DATE,
  status              TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'expired', 'terminated')),
  signatory_name      TEXT,
  location_ids        UUID[] NOT NULL DEFAULT '{}',
  access_terms        TEXT,
  cancellation_terms  TEXT,
  deposit_info        TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, renter_id)
    REFERENCES renters (organization_id, id) ON DELETE CASCADE,
  CHECK (length(trim(title)) > 0),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE INDEX idx_renter_contracts_org_renter
  ON renter_contracts (organization_id, renter_id, status);

CREATE TABLE renter_contract_rental_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  contract_id     UUID NOT NULL,
  rental_id       UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, contract_id, rental_id),
  FOREIGN KEY (organization_id, contract_id)
    REFERENCES renter_contracts (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, rental_id)
    REFERENCES rentals (organization_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_renter_contract_rental_links_rental
  ON renter_contract_rental_links (organization_id, rental_id);

CREATE TABLE renter_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  renter_id       UUID NOT NULL,
  contract_id     UUID,
  category        TEXT,
  display_name    TEXT NOT NULL,
  document_date   DATE,
  valid_until     DATE,
  mime_type       TEXT NOT NULL,
  file_size       BIGINT NOT NULL CHECK (file_size > 0),
  storage_path    TEXT NOT NULL,
  notes           TEXT,
  uploaded_by     UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, storage_path),
  FOREIGN KEY (organization_id, renter_id)
    REFERENCES renters (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, contract_id)
    REFERENCES renter_contracts (organization_id, id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, uploaded_by)
    REFERENCES organization_members (organization_id, id),
  CHECK (length(trim(display_name)) > 0),
  CHECK (length(trim(storage_path)) > 0)
);

CREATE INDEX idx_renter_documents_org_renter
  ON renter_documents (organization_id, renter_id, created_at DESC);

CREATE INDEX idx_renter_documents_valid_until
  ON renter_documents (organization_id, valid_until)
  WHERE valid_until IS NOT NULL;

CREATE TABLE renter_communications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  renter_id         UUID NOT NULL,
  contact_id        UUID,
  comm_type         TEXT NOT NULL
    CHECK (comm_type IN ('call', 'email', 'messenger', 'meeting', 'note')),
  occurred_at       TIMESTAMPTZ NOT NULL,
  subject           TEXT,
  body              TEXT,
  next_action_at    TIMESTAMPTZ,
  author_member_id  UUID NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, renter_id)
    REFERENCES renters (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, contact_id)
    REFERENCES renter_contacts (organization_id, id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, author_member_id)
    REFERENCES organization_members (organization_id, id),
  CHECK (NULLIF(trim(body), '') IS NOT NULL OR NULLIF(trim(subject), '') IS NOT NULL)
);

CREATE INDEX idx_renter_communications_org_renter
  ON renter_communications (organization_id, renter_id, occurred_at DESC);

CREATE INDEX idx_renter_communications_next_action
  ON renter_communications (organization_id, next_action_at)
  WHERE next_action_at IS NOT NULL;

-- =============================================================================
-- 3. Normalization + row maintenance
-- =============================================================================

CREATE OR REPLACE FUNCTION normalize_renter_phone(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(
    regexp_replace(
      CASE WHEN p_phone LIKE '+%' THEN substring(p_phone FROM 2) ELSE p_phone END,
      '[^0-9]',
      '',
      'g'
    ),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION normalize_renter_email(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(lower(trim(p_email)), '');
$$;

CREATE OR REPLACE FUNCTION normalize_renter_tax_id(p_tax_id text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(
    upper(regexp_replace(coalesce(p_tax_id, ''), '[^0-9A-Za-z]', '', 'g')),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION renters_apply_normalized_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.norm_phone := normalize_renter_phone(NEW.contact_phone);
  NEW.norm_email := normalize_renter_email(NEW.contact_email);
  NEW.norm_tax_id := normalize_renter_tax_id(NEW.tax_id);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS renters_normalize_fields ON renters;
CREATE TRIGGER renters_normalize_fields
  BEFORE INSERT OR UPDATE ON renters
  FOR EACH ROW EXECUTE FUNCTION renters_apply_normalized_fields();

CREATE OR REPLACE FUNCTION set_renter_row_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER renter_contacts_updated_at
  BEFORE UPDATE ON renter_contacts
  FOR EACH ROW EXECUTE FUNCTION set_renter_row_updated_at();

CREATE TRIGGER renter_contracts_updated_at
  BEFORE UPDATE ON renter_contracts
  FOR EACH ROW EXECUTE FUNCTION set_renter_row_updated_at();

CREATE TRIGGER renter_documents_updated_at
  BEFORE UPDATE ON renter_documents
  FOR EACH ROW EXECUTE FUNCTION set_renter_row_updated_at();

CREATE TRIGGER renter_communications_updated_at
  BEFORE UPDATE ON renter_communications
  FOR EACH ROW EXECUTE FUNCTION set_renter_row_updated_at();

-- =============================================================================
-- 4. Permission helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION member_can_read_renter_directory()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT member_can_manage_rentals() OR can_read_financial();
$$;

CREATE OR REPLACE FUNCTION member_can_read_renter_profile()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT member_can_manage_rentals();
$$;

CREATE OR REPLACE FUNCTION member_can_read_renter_documents()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role text := current_member_role();
BEGIN
  IF NOT member_can_manage_rentals() THEN
    RETURN false;
  END IF;

  IF v_role IN ('owner', 'director') THEN
    RETURN true;
  END IF;

  IF v_role = 'admin' AND NOT is_restricted_admin() THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION member_can_read_renter_finance()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT can_read_financial();
$$;

CREATE OR REPLACE FUNCTION _renter_is_bookable(p_renter_id uuid, p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM renters r
    WHERE r.id = p_renter_id
      AND r.organization_id = p_org_id
      AND r.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION _renter_debt_total(p_renter_id uuid, p_org_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(sum(
    GREATEST(r.fixed_amount - _rental_paid_total(r.id, r.organization_id), 0)
  ), 0)
  FROM rentals r
  WHERE r.organization_id = p_org_id
    AND r.renter_id = p_renter_id
    AND r.booking_status = 'confirmed'
    AND r.fixed_amount > _rental_paid_total(r.id, r.organization_id);
$$;

CREATE OR REPLACE FUNCTION _renter_next_rental_date(p_renter_id uuid, p_org_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT min(r.rental_date)
  FROM rentals r
  WHERE r.organization_id = p_org_id
    AND r.renter_id = p_renter_id
    AND r.booking_status = 'confirmed'
    AND r.rental_date >= current_date;
$$;

CREATE OR REPLACE FUNCTION _renter_has_active_or_future_rental(p_renter_id uuid, p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.booking_status = 'confirmed'
      AND r.rental_date >= current_date
  );
$$;

CREATE OR REPLACE FUNCTION _renter_allowed_document_mimes()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::text[];
$$;

CREATE OR REPLACE FUNCTION _renter_document_max_bytes()
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT 10485760::bigint;
$$;

CREATE OR REPLACE FUNCTION _renter_audit_with_reason(
  p_table_name text,
  p_operation text,
  p_row_id text,
  p_old_data jsonb,
  p_new_data jsonb,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
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
    auth_organization_id(),
    p_table_name,
    p_operation,
    p_row_id,
    p_old_data,
    CASE
      WHEN p_reason IS NOT NULL AND NULLIF(trim(p_reason), '') IS NOT NULL
        THEN COALESCE(p_new_data, '{}'::jsonb) || jsonb_build_object('_reason', trim(p_reason))
      ELSE p_new_data
    END,
    auth.uid()
  );
END;
$$;

-- =============================================================================
-- 5. RPCs
-- =============================================================================

CREATE OR REPLACE FUNCTION list_renters(
  p_search text DEFAULT NULL,
  p_type text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_has_debt boolean DEFAULT NULL,
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
      (
        SELECT rc.full_name
        FROM renter_contacts rc
        WHERE rc.organization_id = r.organization_id
          AND rc.renter_id = r.id
          AND rc.is_primary = true
        LIMIT 1
      ) AS primary_contact_name,
      _renter_next_rental_date(r.id, r.organization_id) AS next_rental_date,
      CASE WHEN v_finance THEN _renter_debt_total(r.id, r.organization_id) ELSE NULL END AS debt_amount,
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
        p_has_debt IS NULL
        OR (p_has_debt = true AND _renter_debt_total(r.id, r.organization_id) > 0)
        OR (p_has_debt = false AND _renter_debt_total(r.id, r.organization_id) <= 0)
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
      AND r.booking_status = 'confirmed';

    SELECT COALESCE(sum(r.fixed_amount), 0)
    INTO v_fixed
    FROM rentals r
    WHERE r.organization_id = v_org_id
      AND r.renter_id = p_renter_id
      AND r.booking_status = 'confirmed';

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

CREATE OR REPLACE FUNCTION check_renter_duplicates(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_self_id uuid := NULLIF(p_payload ->> 'renter_id', '')::uuid;
  v_norm_phone text := normalize_renter_phone(p_payload ->> 'contact_phone');
  v_norm_email text := normalize_renter_email(p_payload ->> 'contact_email');
  v_norm_tax_id text := normalize_renter_tax_id(p_payload ->> 'tax_id');
  v_matches jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;

  IF NOT member_can_read_renter_profile() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'display_name', r.display_name,
    'counterparty_type', r.counterparty_type,
    'status', r.status,
    'contact_phone', r.contact_phone,
    'contact_email', r.contact_email,
    'tax_id', r.tax_id,
    'match_fields', array_remove(ARRAY[
      CASE WHEN v_norm_phone IS NOT NULL AND r.norm_phone = v_norm_phone THEN 'phone' END,
      CASE WHEN v_norm_email IS NOT NULL AND r.norm_email = v_norm_email THEN 'email' END,
      CASE WHEN v_norm_tax_id IS NOT NULL AND r.norm_tax_id = v_norm_tax_id THEN 'tax_id' END
    ], NULL)
  ) ORDER BY r.display_name), '[]'::jsonb)
  INTO v_matches
  FROM renters r
  WHERE r.organization_id = v_org_id
    AND r.status <> 'archived'
    AND r.id IS DISTINCT FROM v_self_id
    AND (
      (v_norm_phone IS NOT NULL AND r.norm_phone = v_norm_phone)
      OR (v_norm_email IS NOT NULL AND r.norm_email = v_norm_email)
      OR (v_norm_tax_id IS NOT NULL AND r.norm_tax_id = v_norm_tax_id)
    );

  RETURN jsonb_build_object('success', true, 'duplicates', v_matches);
END;
$$;

CREATE OR REPLACE FUNCTION upsert_renter(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_id uuid := NULLIF(p_payload ->> 'renter_id', '')::uuid;
  v_type text := COALESCE(NULLIF(p_payload ->> 'counterparty_type', ''), 'individual');
  v_status text := COALESCE(NULLIF(p_payload ->> 'status', ''), 'active');
  v_display_name text := NULLIF(trim(p_payload ->> 'display_name'), '');
  v_duplicate_reason text := NULLIF(trim(p_payload ->> 'duplicate_create_reason'), '');
  v_preferred uuid[];
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;

  IF NOT member_can_manage_rentals() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  IF v_display_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.displayNameRequired');
  END IF;

  IF v_type NOT IN ('individual', 'sole_proprietor', 'company') THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.typeInvalid');
  END IF;

  IF v_status NOT IN ('active', 'archived', 'blocked') THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.statusInvalid');
  END IF;

  IF v_status = 'blocked' AND NULLIF(trim(p_payload ->> 'blocked_reason'), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.blockedReasonRequired');
  END IF;

  IF p_payload ? 'preferred_location_ids' THEN
    SELECT COALESCE(array_agg(value::uuid), '{}')
    INTO v_preferred
    FROM jsonb_array_elements_text(p_payload -> 'preferred_location_ids') AS t(value);
  END IF;

  IF v_id IS NULL THEN
    IF v_duplicate_reason IS NULL AND jsonb_array_length((check_renter_duplicates(p_payload) -> 'duplicates')) > 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'renters.error.duplicateRequiresReason');
    END IF;

    INSERT INTO renters (
      organization_id,
      display_name,
      counterparty_type,
      legal_name,
      tax_id,
      registration_number,
      legal_address,
      actual_address,
      contact_phone,
      contact_email,
      notes,
      status,
      blocked_reason,
      internal_notes,
      preferred_location_ids,
      payment_due_days,
      archived_at,
      duplicate_create_reason,
      duplicate_create_by
    )
    VALUES (
      v_org_id,
      v_display_name,
      v_type,
      NULLIF(trim(p_payload ->> 'legal_name'), ''),
      NULLIF(trim(p_payload ->> 'tax_id'), ''),
      NULLIF(trim(p_payload ->> 'registration_number'), ''),
      NULLIF(trim(p_payload ->> 'legal_address'), ''),
      NULLIF(trim(p_payload ->> 'actual_address'), ''),
      NULLIF(trim(p_payload ->> 'contact_phone'), ''),
      NULLIF(trim(p_payload ->> 'contact_email'), ''),
      NULLIF(trim(p_payload ->> 'notes'), ''),
      v_status,
      NULLIF(trim(p_payload ->> 'blocked_reason'), ''),
      NULLIF(trim(p_payload ->> 'internal_notes'), ''),
      COALESCE(v_preferred, '{}'),
      NULLIF(p_payload ->> 'payment_due_days', '')::int,
      CASE WHEN v_status = 'archived' THEN now() ELSE NULL END,
      v_duplicate_reason,
      CASE WHEN v_duplicate_reason IS NOT NULL THEN v_member_id END
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE renters
    SET
      display_name = v_display_name,
      counterparty_type = v_type,
      legal_name = CASE WHEN p_payload ? 'legal_name' THEN NULLIF(trim(p_payload ->> 'legal_name'), '') ELSE legal_name END,
      tax_id = CASE WHEN p_payload ? 'tax_id' THEN NULLIF(trim(p_payload ->> 'tax_id'), '') ELSE tax_id END,
      registration_number = CASE WHEN p_payload ? 'registration_number' THEN NULLIF(trim(p_payload ->> 'registration_number'), '') ELSE registration_number END,
      legal_address = CASE WHEN p_payload ? 'legal_address' THEN NULLIF(trim(p_payload ->> 'legal_address'), '') ELSE legal_address END,
      actual_address = CASE WHEN p_payload ? 'actual_address' THEN NULLIF(trim(p_payload ->> 'actual_address'), '') ELSE actual_address END,
      contact_phone = CASE WHEN p_payload ? 'contact_phone' THEN NULLIF(trim(p_payload ->> 'contact_phone'), '') ELSE contact_phone END,
      contact_email = CASE WHEN p_payload ? 'contact_email' THEN NULLIF(trim(p_payload ->> 'contact_email'), '') ELSE contact_email END,
      notes = CASE WHEN p_payload ? 'notes' THEN NULLIF(trim(p_payload ->> 'notes'), '') ELSE notes END,
      status = v_status,
      blocked_reason = CASE WHEN v_status = 'blocked' THEN NULLIF(trim(p_payload ->> 'blocked_reason'), '') ELSE NULL END,
      internal_notes = CASE WHEN p_payload ? 'internal_notes' THEN NULLIF(trim(p_payload ->> 'internal_notes'), '') ELSE internal_notes END,
      preferred_location_ids = CASE WHEN p_payload ? 'preferred_location_ids' THEN COALESCE(v_preferred, '{}') ELSE preferred_location_ids END,
      payment_due_days = CASE WHEN p_payload ? 'payment_due_days' THEN NULLIF(p_payload ->> 'payment_due_days', '')::int ELSE payment_due_days END,
      archived_at = CASE
        WHEN v_status = 'archived' THEN COALESCE(archived_at, now())
        ELSE NULL
      END
    WHERE id = v_id AND organization_id = v_org_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'renters.error.notFound');
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'renter_id', v_id);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.duplicateIdentity');
END;
$$;

CREATE OR REPLACE FUNCTION archive_renter(
  p_renter_id uuid,
  p_force boolean DEFAULT false,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_renter renters%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;

  IF NOT member_can_manage_rentals() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  SELECT * INTO v_renter
  FROM renters r
  WHERE r.id = p_renter_id AND r.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.notFound');
  END IF;

  IF v_renter.status = 'archived' THEN
    RETURN jsonb_build_object('success', true, 'already_applied', true);
  END IF;

  IF NOT p_force AND _renter_has_active_or_future_rental(p_renter_id, v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.activeRentalsExist');
  END IF;

  UPDATE renters
  SET
    status = 'archived',
    archived_at = now(),
    blocked_reason = NULL,
    internal_notes = CASE
      WHEN NULLIF(trim(p_reason), '') IS NOT NULL
        THEN trim(both E'\n' FROM concat_ws(E'\n', internal_notes, 'Archived: ' || trim(p_reason)))
      ELSE internal_notes
    END
  WHERE id = p_renter_id;

  RETURN jsonb_build_object('success', true, 'renter_id', p_renter_id);
END;
$$;

CREATE OR REPLACE FUNCTION upsert_renter_contact(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_contact_id uuid := NULLIF(p_payload ->> 'contact_id', '')::uuid;
  v_renter_id uuid := (p_payload ->> 'renter_id')::uuid;
  v_is_primary boolean := COALESCE((p_payload ->> 'is_primary')::boolean, false);
  v_full_name text := NULLIF(trim(p_payload ->> 'full_name'), '');
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;

  IF NOT member_can_manage_rentals() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  IF v_renter_id IS NULL OR v_full_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.fieldsInvalid');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM renters r
    WHERE r.id = v_renter_id AND r.organization_id = v_org_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.notFound');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_org_id::text || ':' || v_renter_id::text || ':contacts'));

  IF v_contact_id IS NULL THEN
    INSERT INTO renter_contacts (
      organization_id, renter_id, full_name, role_title, phone, email, telegram, is_primary, notes
    )
    VALUES (
      v_org_id,
      v_renter_id,
      v_full_name,
      NULLIF(trim(p_payload ->> 'role_title'), ''),
      NULLIF(trim(p_payload ->> 'phone'), ''),
      NULLIF(trim(p_payload ->> 'email'), ''),
      NULLIF(trim(p_payload ->> 'telegram'), ''),
      v_is_primary,
      NULLIF(trim(p_payload ->> 'notes'), '')
    )
    RETURNING id INTO v_contact_id;
  ELSE
    UPDATE renter_contacts
    SET
      full_name = v_full_name,
      role_title = CASE WHEN p_payload ? 'role_title' THEN NULLIF(trim(p_payload ->> 'role_title'), '') ELSE role_title END,
      phone = CASE WHEN p_payload ? 'phone' THEN NULLIF(trim(p_payload ->> 'phone'), '') ELSE phone END,
      email = CASE WHEN p_payload ? 'email' THEN NULLIF(trim(p_payload ->> 'email'), '') ELSE email END,
      telegram = CASE WHEN p_payload ? 'telegram' THEN NULLIF(trim(p_payload ->> 'telegram'), '') ELSE telegram END,
      is_primary = v_is_primary,
      notes = CASE WHEN p_payload ? 'notes' THEN NULLIF(trim(p_payload ->> 'notes'), '') ELSE notes END
    WHERE id = v_contact_id AND organization_id = v_org_id AND renter_id = v_renter_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'renters.error.contactNotFound');
    END IF;
  END IF;

  IF v_is_primary THEN
    UPDATE renter_contacts
    SET is_primary = false
    WHERE organization_id = v_org_id
      AND renter_id = v_renter_id
      AND id <> v_contact_id
      AND is_primary = true;

    UPDATE renter_contacts
    SET is_primary = true
    WHERE id = v_contact_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'contact_id', v_contact_id);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.primaryContactConflict');
END;
$$;

CREATE OR REPLACE FUNCTION delete_renter_contact(p_contact_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;

  IF NOT member_can_manage_rentals() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  DELETE FROM renter_contacts rc
  WHERE rc.id = p_contact_id AND rc.organization_id = v_org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.contactNotFound');
  END IF;

  RETURN jsonb_build_object('success', true, 'contact_id', p_contact_id);
END;
$$;

CREATE OR REPLACE FUNCTION upsert_renter_contract(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_contract_id uuid := NULLIF(p_payload ->> 'contract_id', '')::uuid;
  v_renter_id uuid := (p_payload ->> 'renter_id')::uuid;
  v_title text := NULLIF(trim(p_payload ->> 'title'), '');
  v_status text := COALESCE(NULLIF(p_payload ->> 'status', ''), 'draft');
  v_location_ids uuid[];
  v_rental_id uuid;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;

  IF NOT member_can_manage_rentals() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  IF v_renter_id IS NULL OR v_title IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.fieldsInvalid');
  END IF;

  IF v_status NOT IN ('draft', 'active', 'expired', 'terminated') THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.contractStatusInvalid');
  END IF;

  IF p_payload ? 'location_ids' THEN
    SELECT COALESCE(array_agg(value::uuid), '{}')
    INTO v_location_ids
    FROM jsonb_array_elements_text(p_payload -> 'location_ids') AS t(value);
  END IF;

  IF v_contract_id IS NULL THEN
    INSERT INTO renter_contracts (
      organization_id, renter_id, contract_number, title, contract_type,
      signed_at, valid_from, valid_to, status, signatory_name,
      location_ids, access_terms, cancellation_terms, deposit_info, notes
    )
    VALUES (
      v_org_id,
      v_renter_id,
      NULLIF(trim(p_payload ->> 'contract_number'), ''),
      v_title,
      NULLIF(trim(p_payload ->> 'contract_type'), ''),
      NULLIF(p_payload ->> 'signed_at', '')::date,
      NULLIF(p_payload ->> 'valid_from', '')::date,
      NULLIF(p_payload ->> 'valid_to', '')::date,
      v_status,
      NULLIF(trim(p_payload ->> 'signatory_name'), ''),
      COALESCE(v_location_ids, '{}'),
      NULLIF(trim(p_payload ->> 'access_terms'), ''),
      NULLIF(trim(p_payload ->> 'cancellation_terms'), ''),
      NULLIF(trim(p_payload ->> 'deposit_info'), ''),
      NULLIF(trim(p_payload ->> 'notes'), '')
    )
    RETURNING id INTO v_contract_id;
  ELSE
    UPDATE renter_contracts
    SET
      contract_number = CASE WHEN p_payload ? 'contract_number' THEN NULLIF(trim(p_payload ->> 'contract_number'), '') ELSE contract_number END,
      title = v_title,
      contract_type = CASE WHEN p_payload ? 'contract_type' THEN NULLIF(trim(p_payload ->> 'contract_type'), '') ELSE contract_type END,
      signed_at = CASE WHEN p_payload ? 'signed_at' THEN NULLIF(p_payload ->> 'signed_at', '')::date ELSE signed_at END,
      valid_from = CASE WHEN p_payload ? 'valid_from' THEN NULLIF(p_payload ->> 'valid_from', '')::date ELSE valid_from END,
      valid_to = CASE WHEN p_payload ? 'valid_to' THEN NULLIF(p_payload ->> 'valid_to', '')::date ELSE valid_to END,
      status = v_status,
      signatory_name = CASE WHEN p_payload ? 'signatory_name' THEN NULLIF(trim(p_payload ->> 'signatory_name'), '') ELSE signatory_name END,
      location_ids = CASE WHEN p_payload ? 'location_ids' THEN COALESCE(v_location_ids, '{}') ELSE location_ids END,
      access_terms = CASE WHEN p_payload ? 'access_terms' THEN NULLIF(trim(p_payload ->> 'access_terms'), '') ELSE access_terms END,
      cancellation_terms = CASE WHEN p_payload ? 'cancellation_terms' THEN NULLIF(trim(p_payload ->> 'cancellation_terms'), '') ELSE cancellation_terms END,
      deposit_info = CASE WHEN p_payload ? 'deposit_info' THEN NULLIF(trim(p_payload ->> 'deposit_info'), '') ELSE deposit_info END,
      notes = CASE WHEN p_payload ? 'notes' THEN NULLIF(trim(p_payload ->> 'notes'), '') ELSE notes END
    WHERE id = v_contract_id AND organization_id = v_org_id AND renter_id = v_renter_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'renters.error.contractNotFound');
    END IF;
  END IF;

  IF p_payload ? 'rental_ids' THEN
    DELETE FROM renter_contract_rental_links l
    WHERE l.organization_id = v_org_id AND l.contract_id = v_contract_id;

    FOR v_rental_id IN
      SELECT value::uuid
      FROM jsonb_array_elements_text(p_payload -> 'rental_ids') AS t(value)
    LOOP
      INSERT INTO renter_contract_rental_links (organization_id, contract_id, rental_id)
      SELECT v_org_id, v_contract_id, v_rental_id
      WHERE EXISTS (
        SELECT 1 FROM rentals r
        WHERE r.id = v_rental_id
          AND r.organization_id = v_org_id
          AND r.renter_id = v_renter_id
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object('success', true, 'contract_id', v_contract_id);
END;
$$;

CREATE OR REPLACE FUNCTION prepare_renter_document_upload(
  p_renter_id uuid,
  p_filename text,
  p_mime text,
  p_size bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_object_id uuid := gen_random_uuid();
  v_safe_name text;
  v_path text;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;

  IF NOT member_can_read_renter_documents() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM renters r
    WHERE r.id = p_renter_id AND r.organization_id = v_org_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.notFound');
  END IF;

  IF p_mime IS NULL OR NOT (p_mime = ANY (_renter_allowed_document_mimes())) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.documentMimeInvalid');
  END IF;

  IF p_size IS NULL OR p_size <= 0 OR p_size > _renter_document_max_bytes() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.documentSizeInvalid');
  END IF;

  v_safe_name := regexp_replace(coalesce(p_filename, 'file'), '[^a-zA-Z0-9._-]', '_', 'g');
  IF v_safe_name = '' THEN
    v_safe_name := 'file';
  END IF;

  v_path := v_org_id::text || '/' || p_renter_id::text || '/' || v_object_id::text;

  RETURN jsonb_build_object(
    'success', true,
    'storage_path', v_path,
    'bucket', 'renter-documents',
    'object_id', v_object_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION finalize_renter_document_upload(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_renter_id uuid := (p_payload ->> 'renter_id')::uuid;
  v_storage_path text := NULLIF(trim(p_payload ->> 'storage_path'), '');
  v_mime text := NULLIF(trim(p_payload ->> 'mime_type'), '');
  v_size bigint := (p_payload ->> 'file_size')::bigint;
  v_display_name text := NULLIF(trim(p_payload ->> 'display_name'), '');
  v_document_id uuid;
  v_contract_id uuid := NULLIF(p_payload ->> 'contract_id', '')::uuid;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;

  IF NOT member_can_read_renter_documents() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  IF v_renter_id IS NULL OR v_storage_path IS NULL OR v_display_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.fieldsInvalid');
  END IF;

  IF v_storage_path !~ ('^' || v_org_id::text || '/' || v_renter_id::text || '/[0-9a-f-]{36}$') THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.documentPathInvalid');
  END IF;

  IF v_mime IS NULL OR NOT (v_mime = ANY (_renter_allowed_document_mimes())) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.documentMimeInvalid');
  END IF;

  IF v_size IS NULL OR v_size <= 0 OR v_size > _renter_document_max_bytes() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.documentSizeInvalid');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects o
    WHERE o.bucket_id = 'renter-documents'
      AND o.name = v_storage_path
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.documentNotUploaded');
  END IF;

  INSERT INTO renter_documents (
    organization_id,
    renter_id,
    contract_id,
    category,
    display_name,
    document_date,
    valid_until,
    mime_type,
    file_size,
    storage_path,
    notes,
    uploaded_by
  )
  VALUES (
    v_org_id,
    v_renter_id,
    v_contract_id,
    NULLIF(trim(p_payload ->> 'category'), ''),
    v_display_name,
    NULLIF(p_payload ->> 'document_date', '')::date,
    NULLIF(p_payload ->> 'valid_until', '')::date,
    v_mime,
    v_size,
    v_storage_path,
    NULLIF(trim(p_payload ->> 'notes'), ''),
    v_member_id
  )
  RETURNING id INTO v_document_id;

  RETURN jsonb_build_object('success', true, 'document_id', v_document_id);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.documentDuplicate');
END;
$$;

CREATE OR REPLACE FUNCTION get_renter_document_download_url(p_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, storage
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_doc renter_documents%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;

  IF NOT member_can_read_renter_documents() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  SELECT * INTO v_doc
  FROM renter_documents d
  WHERE d.id = p_document_id AND d.organization_id = v_org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.documentNotFound');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'bucket', 'renter-documents',
    'storage_path', v_doc.storage_path,
    'expires_in', 300
  );
END;
$$;

CREATE OR REPLACE FUNCTION delete_renter_document(p_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, storage
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_doc renter_documents%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;

  IF NOT member_can_read_renter_documents() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  SELECT * INTO v_doc
  FROM renter_documents d
  WHERE d.id = p_document_id AND d.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.documentNotFound');
  END IF;

  DELETE FROM renter_documents WHERE id = p_document_id;

  DELETE FROM storage.objects o
  WHERE o.bucket_id = 'renter-documents'
    AND o.name = v_doc.storage_path;

  RETURN jsonb_build_object('success', true, 'document_id', p_document_id);
END;
$$;

CREATE OR REPLACE FUNCTION create_renter_communication(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_renter_id uuid := (p_payload ->> 'renter_id')::uuid;
  v_comm_type text := NULLIF(trim(p_payload ->> 'comm_type'), '');
  v_comm_id uuid;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;

  IF NOT member_can_manage_rentals() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  IF v_renter_id IS NULL OR v_comm_type IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.fieldsInvalid');
  END IF;

  IF v_comm_type NOT IN ('call', 'email', 'messenger', 'meeting', 'note') THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.commTypeInvalid');
  END IF;

  INSERT INTO renter_communications (
    organization_id,
    renter_id,
    contact_id,
    comm_type,
    occurred_at,
    subject,
    body,
    next_action_at,
    author_member_id
  )
  VALUES (
    v_org_id,
    v_renter_id,
    NULLIF(p_payload ->> 'contact_id', '')::uuid,
    v_comm_type,
    COALESCE((p_payload ->> 'occurred_at')::timestamptz, now()),
    NULLIF(trim(p_payload ->> 'subject'), ''),
    NULLIF(trim(p_payload ->> 'body'), ''),
    NULLIF(p_payload ->> 'next_action_at', '')::timestamptz,
    v_member_id
  )
  RETURNING id INTO v_comm_id;

  RETURN jsonb_build_object('success', true, 'communication_id', v_comm_id);
END;
$$;

CREATE OR REPLACE FUNCTION update_renter_communication(
  p_comm_id uuid,
  p_payload jsonb,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_old renter_communications%ROWTYPE;
  v_new renter_communications%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;

  IF NOT member_can_manage_rentals() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  IF NULLIF(trim(p_reason), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.reasonRequired');
  END IF;

  SELECT * INTO v_old
  FROM renter_communications cm
  WHERE cm.id = p_comm_id AND cm.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.communicationNotFound');
  END IF;

  UPDATE renter_communications
  SET
    contact_id = CASE WHEN p_payload ? 'contact_id' THEN NULLIF(p_payload ->> 'contact_id', '')::uuid ELSE contact_id END,
    comm_type = CASE WHEN p_payload ? 'comm_type' THEN NULLIF(trim(p_payload ->> 'comm_type'), '') ELSE comm_type END,
    occurred_at = CASE WHEN p_payload ? 'occurred_at' THEN (p_payload ->> 'occurred_at')::timestamptz ELSE occurred_at END,
    subject = CASE WHEN p_payload ? 'subject' THEN NULLIF(trim(p_payload ->> 'subject'), '') ELSE subject END,
    body = CASE WHEN p_payload ? 'body' THEN NULLIF(trim(p_payload ->> 'body'), '') ELSE body END,
    next_action_at = CASE WHEN p_payload ? 'next_action_at' THEN NULLIF(p_payload ->> 'next_action_at', '')::timestamptz ELSE next_action_at END
  WHERE id = p_comm_id
  RETURNING * INTO v_new;

  PERFORM _renter_audit_with_reason(
    'renter_communications',
    'UPDATE',
    p_comm_id::text,
    to_jsonb(v_old),
    to_jsonb(v_new),
    p_reason
  );

  RETURN jsonb_build_object('success', true, 'communication_id', p_comm_id);
END;
$$;

CREATE OR REPLACE FUNCTION delete_renter_communication(
  p_comm_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_old renter_communications%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;

  IF NOT member_can_manage_rentals() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  IF NULLIF(trim(p_reason), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.reasonRequired');
  END IF;

  SELECT * INTO v_old
  FROM renter_communications cm
  WHERE cm.id = p_comm_id AND cm.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.communicationNotFound');
  END IF;

  PERFORM _renter_audit_with_reason(
    'renter_communications',
    'DELETE',
    p_comm_id::text,
    to_jsonb(v_old),
    NULL,
    p_reason
  );

  DELETE FROM renter_communications WHERE id = p_comm_id;

  RETURN jsonb_build_object('success', true, 'communication_id', p_comm_id);
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
    'fixed_amount', CASE WHEN v_finance THEN r.fixed_amount ELSE NULL END,
    'currency', CASE WHEN v_finance THEN r.currency ELSE NULL END,
    'paid_amount', CASE WHEN v_finance THEN _rental_paid_total(r.id, r.organization_id) ELSE NULL END,
    'payment_status', CASE
      WHEN v_finance THEN _rental_payment_status(r.fixed_amount, _rental_paid_total(r.id, r.organization_id))
      ELSE NULL
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

-- =============================================================================
-- 6. Patch hall rental RPCs for archived/blocked renters
-- =============================================================================

CREATE OR REPLACE FUNCTION create_rental(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_idempotency_key text := NULLIF(trim(p_payload ->> 'idempotency_key'), '');
  v_existing rentals%ROWTYPE;
  v_rental_id uuid;
  v_date date;
  v_time_start text;
  v_time_end text;
  v_location_id uuid;
  v_renter_id uuid;
  v_fixed_amount numeric;
  v_currency text;
  v_conflicts jsonb;
  v_conflict jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT member_can_manage_rentals() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
  END IF;

  IF v_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM rentals r
    WHERE r.organization_id = v_org_id AND r.idempotency_key = v_idempotency_key;

    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'rental_id', v_existing.id, 'already_applied', true);
    END IF;
  END IF;

  v_date := (p_payload ->> 'rental_date')::date;
  v_time_start := normalize_hhmm(p_payload ->> 'time_start');
  v_time_end := normalize_hhmm(p_payload ->> 'time_end');
  v_location_id := (p_payload ->> 'location_id')::uuid;
  v_renter_id := (p_payload ->> 'renter_id')::uuid;
  v_fixed_amount := COALESCE((p_payload ->> 'fixed_amount')::numeric, 0);
  v_currency := COALESCE(NULLIF(p_payload ->> 'currency', ''), 'RUB');

  IF v_date IS NULL OR v_location_id IS NULL OR v_renter_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.fieldsInvalid');
  END IF;

  IF _hhmm_to_minutes(v_time_end) <= _hhmm_to_minutes(v_time_start) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.timeRangeInvalid');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM locations l WHERE l.id = v_location_id AND l.organization_id = v_org_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.locationInvalid');
  END IF;

  IF NOT _renter_is_bookable(v_renter_id, v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.renterInvalid');
  END IF;

  IF v_fixed_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.amountInvalid');
  END IF;

  IF v_fixed_amount > 0 AND NOT can_read_financial() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  v_conflicts := preview_rental_conflicts(v_date, v_time_start, v_time_end, v_location_id, NULL);
  IF NOT COALESCE((v_conflicts ->> 'success')::boolean, false) THEN
    RETURN v_conflicts;
  END IF;

  IF jsonb_array_length(COALESCE(v_conflicts -> 'conflicts', '[]'::jsonb)) > 0 THEN
    SELECT value INTO v_conflict
    FROM jsonb_array_elements(v_conflicts -> 'conflicts') LIMIT 1;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'schedule.rental.conflict',
      'conflict', v_conflict
    );
  END IF;

  PERFORM pg_advisory_xact_lock(_rental_location_lock_key(v_org_id, v_location_id, v_date));

  IF schedule_location_has_conflict(v_org_id, v_date, v_time_start, v_time_end, v_location_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.conflict');
  END IF;

  INSERT INTO rentals (
    organization_id, location_id, rental_date, time_start, time_end,
    renter_id, purpose, internal_comment, fixed_amount, currency,
    idempotency_key, created_by
  )
  VALUES (
    v_org_id, v_location_id, v_date, v_time_start, v_time_end,
    v_renter_id,
    NULLIF(trim(p_payload ->> 'purpose'), ''),
    NULLIF(trim(p_payload ->> 'internal_comment'), ''),
    v_fixed_amount, v_currency, v_idempotency_key, v_member_id
  )
  RETURNING id INTO v_rental_id;

  IF COALESCE((p_payload ->> 'initial_payment')::numeric, 0) > 0 THEN
    IF NOT can_read_financial() THEN
      RAISE EXCEPTION 'schedule.rental.financeForbidden' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO rental_payments (
      organization_id, rental_id, amount, currency, method, method_comment, idempotency_key, created_by
    )
    VALUES (
      v_org_id,
      v_rental_id,
      (p_payload ->> 'initial_payment')::numeric,
      v_currency,
      COALESCE(NULLIF(p_payload ->> 'payment_method', ''), 'cash'),
      NULLIF(trim(p_payload ->> 'payment_comment'), ''),
      CASE WHEN v_idempotency_key IS NOT NULL THEN v_idempotency_key || ':payment' END,
      v_member_id
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'rental_id', v_rental_id);
EXCEPTION
  WHEN unique_violation THEN
    IF v_idempotency_key IS NOT NULL THEN
      SELECT id INTO v_rental_id FROM rentals WHERE organization_id = v_org_id AND idempotency_key = v_idempotency_key;
      IF v_rental_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'rental_id', v_rental_id, 'already_applied', true);
      END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.duplicate');
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION update_rental(p_rental_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_rental rentals%ROWTYPE;
  v_date date;
  v_time_start text;
  v_time_end text;
  v_location_id uuid;
  v_renter_id uuid;
  v_fixed_amount numeric;
  v_paid numeric;
  v_conflicts jsonb;
  v_conflict jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT member_can_manage_rentals() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
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

  v_date := COALESCE((p_payload ->> 'rental_date')::date, v_rental.rental_date);
  v_time_start := COALESCE(normalize_hhmm(p_payload ->> 'time_start'), v_rental.time_start);
  v_time_end := COALESCE(normalize_hhmm(p_payload ->> 'time_end'), v_rental.time_end);
  v_location_id := COALESCE((p_payload ->> 'location_id')::uuid, v_rental.location_id);
  v_renter_id := COALESCE((p_payload ->> 'renter_id')::uuid, v_rental.renter_id);

  IF _hhmm_to_minutes(v_time_end) <= _hhmm_to_minutes(v_time_start) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.timeRangeInvalid');
  END IF;

  IF NOT _renter_is_bookable(v_renter_id, v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.renterInvalid');
  END IF;

  v_fixed_amount := v_rental.fixed_amount;
  IF p_payload ? 'fixed_amount' THEN
    IF NOT can_read_financial() THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
    END IF;
    v_fixed_amount := COALESCE((p_payload ->> 'fixed_amount')::numeric, 0);
    IF v_fixed_amount < 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.amountInvalid');
    END IF;
    v_paid := _rental_paid_total(p_rental_id, v_org_id);
    IF v_paid > v_fixed_amount AND v_fixed_amount > 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.paidExceedsFixed');
    END IF;
  END IF;

  v_conflicts := preview_rental_conflicts(v_date, v_time_start, v_time_end, v_location_id, p_rental_id);
  IF NOT COALESCE((v_conflicts ->> 'success')::boolean, false) THEN
    RETURN v_conflicts;
  END IF;

  IF jsonb_array_length(COALESCE(v_conflicts -> 'conflicts', '[]'::jsonb)) > 0 THEN
    SELECT value INTO v_conflict FROM jsonb_array_elements(v_conflicts -> 'conflicts') LIMIT 1;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.conflict', 'conflict', v_conflict);
  END IF;

  PERFORM pg_advisory_xact_lock(_rental_location_lock_key(v_org_id, v_location_id, v_date));

  IF schedule_location_has_conflict(v_org_id, v_date, v_time_start, v_time_end, v_location_id, NULL, NULL, p_rental_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.conflict');
  END IF;

  UPDATE rentals
  SET
    rental_date = v_date,
    time_start = v_time_start,
    time_end = v_time_end,
    location_id = v_location_id,
    renter_id = v_renter_id,
    purpose = CASE WHEN p_payload ? 'purpose' THEN NULLIF(trim(p_payload ->> 'purpose'), '') ELSE purpose END,
    internal_comment = CASE
      WHEN p_payload ? 'internal_comment' AND member_can_see_rental_sensitive()
        THEN NULLIF(trim(p_payload ->> 'internal_comment'), '')
      ELSE internal_comment
    END,
    updated_at = now()
  WHERE id = p_rental_id;

  RETURN jsonb_build_object('success', true, 'rental_id', p_rental_id);
END;
$$;

-- =============================================================================
-- 7. RLS
-- =============================================================================

DROP POLICY IF EXISTS renters_select ON renters;

CREATE POLICY renters_select ON renters FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND member_can_read_renter_profile()
  );

CREATE POLICY renter_contacts_select ON renter_contacts FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND member_can_read_renter_profile()
  );

CREATE POLICY renter_contacts_write ON renter_contacts FOR ALL TO authenticated
  USING (organization_id = auth_organization_id() AND member_can_manage_rentals())
  WITH CHECK (organization_id = auth_organization_id() AND member_can_manage_rentals());

CREATE POLICY renter_contracts_select ON renter_contracts FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND member_can_read_renter_profile()
  );

CREATE POLICY renter_contracts_write ON renter_contracts FOR ALL TO authenticated
  USING (organization_id = auth_organization_id() AND member_can_manage_rentals())
  WITH CHECK (organization_id = auth_organization_id() AND member_can_manage_rentals());

CREATE POLICY renter_contract_rental_links_select ON renter_contract_rental_links FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND member_can_read_renter_profile()
  );

CREATE POLICY renter_contract_rental_links_write ON renter_contract_rental_links FOR ALL TO authenticated
  USING (organization_id = auth_organization_id() AND member_can_manage_rentals())
  WITH CHECK (organization_id = auth_organization_id() AND member_can_manage_rentals());

CREATE POLICY renter_documents_select ON renter_documents FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND member_can_read_renter_documents()
  );

CREATE POLICY renter_documents_write ON renter_documents FOR ALL TO authenticated
  USING (organization_id = auth_organization_id() AND member_can_read_renter_documents())
  WITH CHECK (organization_id = auth_organization_id() AND member_can_read_renter_documents());

CREATE POLICY renter_communications_select ON renter_communications FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND member_can_read_renter_profile()
  );

CREATE POLICY renter_communications_write ON renter_communications FOR ALL TO authenticated
  USING (organization_id = auth_organization_id() AND member_can_manage_rentals())
  WITH CHECK (organization_id = auth_organization_id() AND member_can_manage_rentals());

ALTER TABLE renter_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE renter_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE renter_contract_rental_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE renter_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE renter_communications ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 8. Storage bucket
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'renter-documents',
  'renter-documents',
  false,
  10485760,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS renter_documents_storage_insert ON storage.objects;
DROP POLICY IF EXISTS renter_documents_storage_select ON storage.objects;
DROP POLICY IF EXISTS renter_documents_storage_delete ON storage.objects;

CREATE POLICY renter_documents_storage_insert
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'renter-documents'
  AND (storage.foldername(name))[1] = auth_organization_id()::text
  AND member_can_read_renter_documents()
);

CREATE POLICY renter_documents_storage_select
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'renter-documents'
  AND (storage.foldername(name))[1] = auth_organization_id()::text
  AND member_can_read_renter_documents()
);

CREATE POLICY renter_documents_storage_delete
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'renter-documents'
  AND (storage.foldername(name))[1] = auth_organization_id()::text
  AND member_can_read_renter_documents()
);

-- =============================================================================
-- 9. Audit triggers
-- =============================================================================

CREATE TRIGGER audit_renters
  AFTER INSERT OR UPDATE OR DELETE ON renters
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_renter_contacts
  AFTER INSERT OR UPDATE OR DELETE ON renter_contacts
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_renter_contracts
  AFTER INSERT OR UPDATE OR DELETE ON renter_contracts
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_renter_communications_insert
  AFTER INSERT ON renter_communications
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

-- =============================================================================
-- 10. Grants
-- =============================================================================

REVOKE ALL ON FUNCTION member_can_read_renter_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_read_renter_directory() TO authenticated, service_role;

REVOKE ALL ON FUNCTION member_can_read_renter_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_read_renter_profile() TO authenticated, service_role;

REVOKE ALL ON FUNCTION member_can_read_renter_documents() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_read_renter_documents() TO authenticated, service_role;

REVOKE ALL ON FUNCTION member_can_read_renter_finance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_read_renter_finance() TO authenticated, service_role;

REVOKE ALL ON FUNCTION normalize_renter_phone(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION normalize_renter_phone(text) TO authenticated;

REVOKE ALL ON FUNCTION normalize_renter_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION normalize_renter_email(text) TO authenticated;

REVOKE ALL ON FUNCTION normalize_renter_tax_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION normalize_renter_tax_id(text) TO authenticated;

REVOKE ALL ON FUNCTION list_renters(text, text, text, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_renters(text, text, text, boolean, boolean) TO authenticated;

REVOKE ALL ON FUNCTION get_renter_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_renter_detail(uuid) TO authenticated;

REVOKE ALL ON FUNCTION check_renter_duplicates(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_renter_duplicates(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION upsert_renter(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_renter(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION archive_renter(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION archive_renter(uuid, boolean, text) TO authenticated;

REVOKE ALL ON FUNCTION upsert_renter_contact(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_renter_contact(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION delete_renter_contact(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_renter_contact(uuid) TO authenticated;

REVOKE ALL ON FUNCTION upsert_renter_contract(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_renter_contract(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION prepare_renter_document_upload(uuid, text, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prepare_renter_document_upload(uuid, text, text, bigint) TO authenticated;

REVOKE ALL ON FUNCTION finalize_renter_document_upload(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finalize_renter_document_upload(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION get_renter_document_download_url(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_renter_document_download_url(uuid) TO authenticated;

REVOKE ALL ON FUNCTION delete_renter_document(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_renter_document(uuid) TO authenticated;

REVOKE ALL ON FUNCTION create_renter_communication(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_renter_communication(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION update_renter_communication(uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_renter_communication(uuid, jsonb, text) TO authenticated;

REVOKE ALL ON FUNCTION delete_renter_communication(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_renter_communication(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION list_renter_rentals(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_renter_rentals(uuid) TO authenticated;

COMMIT;

-- =============================================================================
-- 7. RLS
-- =============================================================================

DROP POLICY IF EXISTS renters_select ON renters;

CREATE POLICY renters_select ON renters FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND member_can_read_renter_profile()
  );

CREATE POLICY renter_contacts_select ON renter_contacts FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND member_can_read_renter_profile()
  );

CREATE POLICY renter_contacts_write ON renter_contacts FOR ALL TO authenticated
  USING (organization_id = auth_organization_id() AND member_can_manage_rentals())
  WITH CHECK (organization_id = auth_organization_id() AND member_can_manage_rentals());

CREATE POLICY renter_contracts_select ON renter_contracts FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND member_can_read_renter_profile()
  );

CREATE POLICY renter_contracts_write ON renter_contracts FOR ALL TO authenticated
  USING (organization_id = auth_organization_id() AND member_can_manage_rentals())
  WITH CHECK (organization_id = auth_organization_id() AND member_can_manage_rentals());

CREATE POLICY renter_contract_rental_links_select ON renter_contract_rental_links FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND member_can_read_renter_profile()
  );

CREATE POLICY renter_contract_rental_links_write ON renter_contract_rental_links FOR ALL TO authenticated
  USING (organization_id = auth_organization_id() AND member_can_manage_rentals())
  WITH CHECK (organization_id = auth_organization_id() AND member_can_manage_rentals());

CREATE POLICY renter_documents_select ON renter_documents FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND member_can_read_renter_documents()
  );

CREATE POLICY renter_documents_write ON renter_documents FOR ALL TO authenticated
  USING (organization_id = auth_organization_id() AND member_can_read_renter_documents())
  WITH CHECK (organization_id = auth_organization_id() AND member_can_read_renter_documents());

CREATE POLICY renter_communications_select ON renter_communications FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND member_can_read_renter_profile()
  );

CREATE POLICY renter_communications_write ON renter_communications FOR ALL TO authenticated
  USING (organization_id = auth_organization_id() AND member_can_manage_rentals())
  WITH CHECK (organization_id = auth_organization_id() AND member_can_manage_rentals());

ALTER TABLE renter_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE renter_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE renter_contract_rental_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE renter_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE renter_communications ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 8. Storage bucket
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'renter-documents',
  'renter-documents',
  false,
  10485760,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS renter_documents_storage_insert ON storage.objects;
DROP POLICY IF EXISTS renter_documents_storage_select ON storage.objects;
DROP POLICY IF EXISTS renter_documents_storage_delete ON storage.objects;

CREATE POLICY renter_documents_storage_insert
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'renter-documents'
  AND (storage.foldername(name))[1] = auth_organization_id()::text
  AND member_can_read_renter_documents()
);

CREATE POLICY renter_documents_storage_select
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'renter-documents'
  AND (storage.foldername(name))[1] = auth_organization_id()::text
  AND member_can_read_renter_documents()
);

CREATE POLICY renter_documents_storage_delete
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'renter-documents'
  AND (storage.foldername(name))[1] = auth_organization_id()::text
  AND member_can_read_renter_documents()
);

-- =============================================================================
-- 9. Audit triggers
-- =============================================================================

CREATE TRIGGER audit_renters
  AFTER INSERT OR UPDATE OR DELETE ON renters
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_renter_contacts
  AFTER INSERT OR UPDATE OR DELETE ON renter_contacts
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_renter_contracts
  AFTER INSERT OR UPDATE OR DELETE ON renter_contracts
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_renter_communications_insert
  AFTER INSERT ON renter_communications
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

-- =============================================================================
-- 10. Grants
-- =============================================================================

REVOKE ALL ON FUNCTION member_can_read_renter_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_read_renter_directory() TO authenticated, service_role;

REVOKE ALL ON FUNCTION member_can_read_renter_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_read_renter_profile() TO authenticated, service_role;

REVOKE ALL ON FUNCTION member_can_read_renter_documents() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_read_renter_documents() TO authenticated, service_role;

REVOKE ALL ON FUNCTION member_can_read_renter_finance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_read_renter_finance() TO authenticated, service_role;

REVOKE ALL ON FUNCTION normalize_renter_phone(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION normalize_renter_phone(text) TO authenticated;

REVOKE ALL ON FUNCTION normalize_renter_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION normalize_renter_email(text) TO authenticated;

REVOKE ALL ON FUNCTION normalize_renter_tax_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION normalize_renter_tax_id(text) TO authenticated;

REVOKE ALL ON FUNCTION list_renters(text, text, text, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_renters(text, text, text, boolean, boolean) TO authenticated;

REVOKE ALL ON FUNCTION get_renter_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_renter_detail(uuid) TO authenticated;

REVOKE ALL ON FUNCTION check_renter_duplicates(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_renter_duplicates(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION upsert_renter(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_renter(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION archive_renter(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION archive_renter(uuid, boolean, text) TO authenticated;

REVOKE ALL ON FUNCTION upsert_renter_contact(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_renter_contact(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION delete_renter_contact(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_renter_contact(uuid) TO authenticated;

REVOKE ALL ON FUNCTION upsert_renter_contract(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_renter_contract(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION prepare_renter_document_upload(uuid, text, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prepare_renter_document_upload(uuid, text, text, bigint) TO authenticated;

REVOKE ALL ON FUNCTION finalize_renter_document_upload(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finalize_renter_document_upload(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION get_renter_document_download_url(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_renter_document_download_url(uuid) TO authenticated;

REVOKE ALL ON FUNCTION delete_renter_document(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_renter_document(uuid) TO authenticated;

REVOKE ALL ON FUNCTION create_renter_communication(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_renter_communication(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION update_renter_communication(uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_renter_communication(uuid, jsonb, text) TO authenticated;

REVOKE ALL ON FUNCTION delete_renter_communication(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_renter_communication(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION list_renter_rentals(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_renter_rentals(uuid) TO authenticated;

COMMIT;
