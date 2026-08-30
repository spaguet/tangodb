-- R1d / 2.9.4: staff RPC for hour rates, miniapp_enabled, telegram_id, schedule payload.

BEGIN;

-- =============================================================================
-- Hour rates + miniapp_enabled (no GRANT SELECT authenticated on the table)
-- =============================================================================

CREATE OR REPLACE FUNCTION list_location_rental_hour_rates()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_show_prices boolean;
  v_can_write boolean;
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT (member_can_manage_rentals() OR can_read_financial()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
  END IF;

  v_show_prices := member_can_see_rental_tariff_prices();
  v_can_write := can_manage_settings() AND organization_allows_writes(v_org_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'location_id', loc.id,
    'name', loc.name,
    'miniapp_enabled', loc.miniapp_enabled,
    'kinds_complete', _renter_location_has_three_kinds(v_org_id, loc.id, _org_local_date(v_org_id)),
    'rates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', cur.id,
        'kind', cur.kind,
        'price', CASE WHEN v_show_prices THEN cur.price ELSE NULL END,
        'currency', CASE WHEN v_show_prices THEN cur.currency ELSE NULL END,
        'valid_from', cur.valid_from
      ) ORDER BY cur.kind)
      FROM (
        SELECT DISTINCT ON (hr.kind)
          hr.id, hr.kind, hr.price, hr.currency, hr.valid_from
        FROM location_rental_hour_rates hr
        WHERE hr.organization_id = v_org_id
          AND hr.location_id = loc.id
          AND hr.valid_from <= _org_local_date(v_org_id)
        ORDER BY hr.kind, hr.valid_from DESC, hr.created_at DESC, hr.id DESC
      ) cur
    ), '[]'::jsonb)
  ) ORDER BY loc.name), '[]'::jsonb)
  INTO v_rows
  FROM locations loc
  WHERE loc.organization_id = v_org_id;

  RETURN jsonb_build_object(
    'success', true,
    'addon_active', renter_miniapp_addon_is_active(v_org_id),
    'can_write', v_can_write,
    'show_prices', v_show_prices,
    'locations', v_rows
  );
END;
$$;

CREATE OR REPLACE FUNCTION upsert_location_rental_hour_rate(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_loc uuid;
  v_kind text;
  v_price numeric;
  v_from date;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_manage_settings() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
  END IF;

  v_loc := NULLIF(p_payload ->> 'location_id', '')::uuid;
  v_kind := NULLIF(trim(p_payload ->> 'kind'), '');
  v_price := NULLIF(p_payload ->> 'price', '')::numeric;
  v_from := COALESCE(NULLIF(p_payload ->> 'valid_from', '')::date, _org_local_date(v_org_id));

  IF v_loc IS NULL OR v_kind IS NULL OR v_price IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.rates.fieldsInvalid');
  END IF;

  IF v_kind NOT IN ('one_time', 'recurring', 'penalty') THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.rates.kindInvalid');
  END IF;

  IF v_price < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.rates.priceInvalid');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM locations loc
    WHERE loc.id = v_loc AND loc.organization_id = v_org_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.rates.locationInvalid');
  END IF;

  INSERT INTO location_rental_hour_rates (
    organization_id, location_id, kind, price, valid_from
  )
  VALUES (v_org_id, v_loc, v_kind, v_price, v_from)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.rates.fieldsInvalid');
END;
$$;

CREATE OR REPLACE FUNCTION set_location_miniapp_enabled(p_location_id uuid, p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_manage_settings() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
  END IF;

  UPDATE locations
  SET miniapp_enabled = COALESCE(p_enabled, false)
  WHERE id = p_location_id
    AND organization_id = v_org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.rates.locationInvalid');
  END IF;

  RETURN jsonb_build_object('success', true, 'location_id', p_location_id, 'miniapp_enabled', COALESCE(p_enabled, false));
END;
$$;

-- =============================================================================
-- Schedule week: channel + lifecycle; Mini App paid/status NULL (S33 teacher scope kept)
-- =============================================================================

CREATE OR REPLACE FUNCTION get_rentals_for_schedule_week(
  p_week_start date,
  p_week_end date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_sensitive boolean;
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF NOT can_read_operational() AND current_member_role() <> 'teacher' THEN
    RETURN '[]'::jsonb;
  END IF;

  v_sensitive := member_can_see_rental_sensitive();

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.rental_date, x.time_start), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      r.id AS rental_id,
      r.rental_date,
      r.time_start,
      r.time_end,
      r.location_id,
      r.rental_series_id,
      r.booking_status,
      r.channel,
      r.lifecycle,
      CASE WHEN v_sensitive THEN r.purpose ELSE NULL END AS purpose,
      CASE WHEN v_sensitive THEN ren.display_name ELSE NULL END AS renter_name,
      CASE WHEN v_sensitive THEN _rental_effective_amount(r.fixed_amount, r.final_amount) ELSE NULL END AS fixed_amount,
      CASE WHEN v_sensitive THEN r.currency ELSE NULL END AS currency,
      CASE
        WHEN NOT v_sensitive THEN NULL
        WHEN r.channel = 'miniapp' THEN NULL
        ELSE _rental_paid_total(r.id, r.organization_id)
      END AS paid_amount,
      CASE
        WHEN NOT v_sensitive THEN NULL
        WHEN r.channel = 'miniapp' THEN NULL
        ELSE _rental_payment_status(
          _rental_effective_amount(r.fixed_amount, r.final_amount),
          _rental_paid_total(r.id, r.organization_id)
        )
      END AS payment_status
    FROM rentals r
    JOIN renters ren ON ren.id = r.renter_id AND ren.organization_id = r.organization_id
    WHERE r.organization_id = v_org_id
      AND r.rental_date >= p_week_start
      AND r.rental_date <= p_week_end
      AND teacher_can_view_schedule_location(r.location_id)
  ) x;

  RETURN v_rows;
END;
$$;

-- =============================================================================
-- Card list: Mini App debt_amount; paid/status stay NULL
-- =============================================================================

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
    'debt_amount', CASE
      WHEN NOT v_finance THEN NULL
      WHEN r.channel = 'miniapp' THEN r.debt_amount
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
-- telegram_id via upsert/detail/list (digit string, not JS number)
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
      'telegram_id', CASE
        WHEN v_can_profile AND v_renter.telegram_id IS NOT NULL THEN v_renter.telegram_id::text
        ELSE NULL
      END,
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
  v_has_tg boolean := p_payload ? 'telegram_id';
  v_tg_raw text;
  v_telegram bigint;
  v_con text;
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

  IF v_has_tg THEN
    v_tg_raw := NULLIF(trim(p_payload ->> 'telegram_id'), '');
    IF v_tg_raw IS NULL THEN
      v_telegram := NULL;
    ELSIF v_tg_raw !~ '^[0-9]+$' THEN
      RETURN jsonb_build_object('success', false, 'error', 'renters.error.telegramIdInvalid');
    ELSE
      v_telegram := v_tg_raw::bigint;
      IF v_telegram IS NULL OR v_telegram <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'renters.error.telegramIdInvalid');
      END IF;
    END IF;
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
      telegram_id,
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
      CASE WHEN v_has_tg THEN v_telegram ELSE NULL END,
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
      telegram_id = CASE WHEN v_has_tg THEN v_telegram ELSE telegram_id END,
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
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con = 'renters_org_telegram_id_unique' OR SQLERRM LIKE '%renters_org_telegram_id_unique%' THEN
      RETURN jsonb_build_object('success', false, 'error', 'renters.error.telegramIdTaken');
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.duplicateIdentity');
  WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con = 'renters_telegram_id_positive_chk' OR SQLERRM LIKE '%renters_telegram_id_positive_chk%' THEN
      RETURN jsonb_build_object('success', false, 'error', 'renters.error.telegramIdInvalid');
    END IF;
    RAISE;
  WHEN numeric_value_out_of_range THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.telegramIdInvalid');
END;
$$;

REVOKE ALL ON FUNCTION list_location_rental_hour_rates() FROM PUBLIC;
REVOKE ALL ON FUNCTION upsert_location_rental_hour_rate(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION set_location_miniapp_enabled(uuid, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION list_location_rental_hour_rates() TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_location_rental_hour_rate(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION set_location_miniapp_enabled(uuid, boolean) TO authenticated;

COMMIT;
