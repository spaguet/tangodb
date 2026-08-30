-- R1a: sorted hall-day locks for create_rental_series; cashier write RPCs reject channel=miniapp.

BEGIN;

-- ---------------------------------------------------------------------------
-- Lock helpers: same _rental_location_lock_key as create_rental, order (location_id, date)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION _rental_sorted_location_date_pairs(p_pairs jsonb)
RETURNS TABLE(location_id uuid, occurrence_date date)
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT x.location_id, x.occurrence_date
  FROM (
    SELECT DISTINCT
      (e->>'location_id')::uuid AS location_id,
      (e->>'date')::date AS occurrence_date
    FROM jsonb_array_elements(COALESCE(p_pairs, '[]'::jsonb)) e
    WHERE NULLIF(e->>'location_id', '') IS NOT NULL
      AND NULLIF(e->>'date', '') IS NOT NULL
  ) x
  ORDER BY x.location_id, x.occurrence_date;
$$;

CREATE OR REPLACE FUNCTION _rental_acquire_location_date_locks(
  p_org_id uuid,
  p_pairs jsonb
)
RETURNS bigint[]
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_loc uuid;
  v_date date;
  v_key bigint;
  v_keys bigint[] := '{}';
BEGIN
  IF p_org_id IS NULL THEN
    RETURN v_keys;
  END IF;

  FOR v_loc, v_date IN
    SELECT s.location_id, s.occurrence_date
    FROM _rental_sorted_location_date_pairs(p_pairs) s
  LOOP
    v_key := _rental_location_lock_key(p_org_id, v_loc, v_date);
    PERFORM pg_advisory_xact_lock(v_key);
    v_keys := v_keys || v_key;
  END LOOP;

  RETURN v_keys;
END;
$$;

COMMENT ON FUNCTION _rental_acquire_location_date_locks(uuid, jsonb) IS
  'R1a: take _rental_location_lock_key in (location_id, date) order. Mini App pack/FIFO (R1c) must use the same helper.';

CREATE OR REPLACE FUNCTION _rental_payload_is_miniapp_channel(p_payload jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(NULLIF(lower(trim(p_payload->>'channel')), ''), 'cashier') = 'miniapp';
$$;

CREATE OR REPLACE FUNCTION _rental_reject_miniapp_write(p_org_id uuid, p_rental_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_channel text;
BEGIN
  IF p_org_id IS NULL OR p_rental_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT r.channel INTO v_channel
  FROM rentals r
  WHERE r.id = p_rental_id AND r.organization_id = p_org_id;

  IF v_channel = 'miniapp' THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.miniappChannelForbidden');
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION _rental_reject_miniapp_series_write(p_org_id uuid, p_series_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_channel text;
BEGIN
  IF p_org_id IS NULL OR p_series_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT rs.channel INTO v_channel
  FROM rental_series rs
  WHERE rs.id = p_series_id AND rs.organization_id = p_org_id;

  IF v_channel = 'miniapp' THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.miniappChannelForbidden');
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION _rental_sorted_location_date_pairs(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _rental_acquire_location_date_locks(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _rental_payload_is_miniapp_channel(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _rental_reject_miniapp_write(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _rental_reject_miniapp_series_write(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_rental_series: channel=miniapp reject + sorted locks (body otherwise unchanged)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_rental_series(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_key text := NULLIF(trim(p_payload ->> 'idempotency_key'), '');
  v_existing rental_series%ROWTYPE;
  v_series_id uuid;
  v_renter_id uuid := (p_payload ->> 'renter_id')::uuid;
  v_contract_id uuid := NULLIF(p_payload ->> 'contract_id', '')::uuid;
  v_location_id uuid := (p_payload ->> 'location_id')::uuid;
  v_tariff_id uuid := (p_payload ->> 'tariff_id')::uuid;
  v_valid_from date := (p_payload ->> 'valid_from')::date;
  v_valid_to date := (p_payload ->> 'valid_to')::date;
  v_patterns jsonb := COALESCE(p_payload -> 'patterns', '[]'::jsonb);
  v_pattern jsonb;
  v_preview jsonb;
  v_occ jsonb;
  v_item jsonb;
  v_rental_id uuid;
  v_pricing jsonb;
  v_created_ids uuid[] := '{}';
  v_tariff_type text;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT member_can_manage_rentals() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
  END IF;

  IF _rental_payload_is_miniapp_channel(p_payload) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.miniappChannelForbidden');
  END IF;

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM rental_series rs
    WHERE rs.organization_id = v_org_id AND rs.idempotency_key = v_key;

    IF FOUND THEN
      SELECT COALESCE(array_agg(r.id), '{}')
      INTO v_created_ids
      FROM rentals r
      WHERE r.rental_series_id = v_existing.id AND r.organization_id = v_org_id;

      RETURN jsonb_build_object(
        'success', true,
        'series_id', v_existing.id,
        'rental_ids', to_jsonb(v_created_ids),
        'already_applied', true
      );
    END IF;
  END IF;

  v_preview := preview_rental_series(p_payload);
  IF NOT COALESCE((v_preview ->> 'success')::boolean, false) THEN
    RETURN v_preview;
  END IF;

  IF COALESCE((v_preview ->> 'has_conflicts')::boolean, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.conflict', 'preview', v_preview);
  END IF;

  IF jsonb_array_length(COALESCE(v_preview -> 'occurrences', '[]'::jsonb)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.series.noOccurrences');
  END IF;

  INSERT INTO rental_series (
    organization_id, renter_id, contract_id, location_id, tariff_id,
    valid_from, valid_to, status, purpose, idempotency_key, created_by
  )
  VALUES (
    v_org_id,
    v_renter_id,
    v_contract_id,
    v_location_id,
    v_tariff_id,
    v_valid_from,
    v_valid_to,
    'active',
    NULLIF(trim(p_payload ->> 'purpose'), ''),
    v_key,
    v_member_id
  )
  RETURNING id INTO v_series_id;

  FOR v_pattern IN SELECT value FROM jsonb_array_elements(v_patterns) LOOP
    INSERT INTO rental_series_patterns (organization_id, series_id, days_of_week, time_start, time_end)
    VALUES (
      v_org_id,
      v_series_id,
      ARRAY(SELECT value::int FROM jsonb_array_elements_text(v_pattern -> 'days_of_week') AS t(value)),
      normalize_hhmm(v_pattern ->> 'time_start'),
      normalize_hhmm(v_pattern ->> 'time_end')
    );
  END LOOP;

  v_occ := v_preview -> 'occurrences';

  -- Lock every occurrence day in (location_id, date) order, not preview order.
  PERFORM _rental_acquire_location_date_locks(
    v_org_id,
    (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'location_id', v_location_id,
          'date', e.value ->> 'occurrence_date'
        )
      ), '[]'::jsonb)
      FROM jsonb_array_elements(v_occ) AS e(value)
    )
  );

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_occ) LOOP
    IF schedule_location_has_conflict(
      v_org_id,
      (v_item ->> 'occurrence_date')::date,
      v_item ->> 'time_start',
      v_item ->> 'time_end',
      v_location_id
    ) THEN
      RAISE EXCEPTION 'schedule.rental.conflict' USING ERRCODE = 'P0001';
    END IF;

    v_pricing := _calculate_rental_pricing(
      v_tariff_id,
      v_org_id,
      (v_item ->> 'occurrence_date')::date,
      v_item ->> 'time_start',
      v_item ->> 'time_end'
    );

    v_tariff_type := v_pricing ->> 'tariff_type';

    INSERT INTO rentals (
      organization_id, location_id, rental_date, time_start, time_end,
      renter_id, purpose, rental_series_id, tariff_id, tariff_type,
      tariff_snapshot, pricing_breakdown, calculated_amount, adjustment_amount,
      final_amount, fixed_amount, currency, created_by
    )
    VALUES (
      v_org_id,
      v_location_id,
      (v_item ->> 'occurrence_date')::date,
      v_item ->> 'time_start',
      v_item ->> 'time_end',
      v_renter_id,
      NULLIF(trim(p_payload ->> 'purpose'), ''),
      v_series_id,
      v_tariff_id,
      v_tariff_type,
      v_pricing -> 'tariff_snapshot',
      v_pricing -> 'breakdown',
      (v_pricing ->> 'calculated_amount')::numeric,
      0,
      (v_pricing ->> 'calculated_amount')::numeric,
      (v_pricing ->> 'calculated_amount')::numeric,
      v_pricing ->> 'currency',
      v_member_id
    )
    RETURNING id INTO v_rental_id;

    v_created_ids := v_created_ids || v_rental_id;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'series_id', v_series_id,
    'rental_ids', to_jsonb(v_created_ids),
    'occurrence_count', array_length(v_created_ids, 1)
  );
EXCEPTION
  WHEN unique_violation THEN
    IF v_key IS NOT NULL THEN
      SELECT id INTO v_series_id FROM rental_series WHERE organization_id = v_org_id AND idempotency_key = v_key;
      IF v_series_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'series_id', v_series_id, 'already_applied', true);
      END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.duplicate');
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ---------------------------------------------------------------------------
-- Wrap cashier write RPCs so Mini App slots cannot use 2.5 money/reschedule paths
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF to_regprocedure('public._cashier_create_rental(jsonb)') IS NULL THEN
    ALTER FUNCTION public.create_rental(jsonb) RENAME TO _cashier_create_rental;
  END IF;
  IF to_regprocedure('public._cashier_update_rental(uuid, jsonb)') IS NULL THEN
    ALTER FUNCTION public.update_rental(uuid, jsonb) RENAME TO _cashier_update_rental;
  END IF;
  IF to_regprocedure('public._cashier_cancel_rental(uuid, text, text, numeric, text)') IS NULL THEN
    ALTER FUNCTION public.cancel_rental(uuid, text, text, numeric, text) RENAME TO _cashier_cancel_rental;
  END IF;
  IF to_regprocedure('public._cashier_apply_rental_pricing_adjustment(uuid, numeric, text)') IS NULL THEN
    ALTER FUNCTION public.apply_rental_pricing_adjustment(uuid, numeric, text)
      RENAME TO _cashier_apply_rental_pricing_adjustment;
  END IF;
  IF to_regprocedure('public._cashier_record_rental_payment(uuid, numeric, text, text, text, date, text, text, text, text, text)') IS NULL THEN
    ALTER FUNCTION public.record_rental_payment(uuid, numeric, text, text, text, date, text, text, text, text, text)
      RENAME TO _cashier_record_rental_payment;
  END IF;
  IF to_regprocedure('public._cashier_update_rental_series(uuid, jsonb, text)') IS NULL THEN
    ALTER FUNCTION public.update_rental_series(uuid, jsonb, text) RENAME TO _cashier_update_rental_series;
  END IF;
  IF to_regprocedure('public._cashier_cancel_rental_series_occurrence(uuid, date, text, text, numeric, text)') IS NULL THEN
    ALTER FUNCTION public.cancel_rental_series_occurrence(uuid, date, text, text, numeric, text)
      RENAME TO _cashier_cancel_rental_series_occurrence;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION create_rental(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF _rental_payload_is_miniapp_channel(p_payload) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.miniappChannelForbidden');
  END IF;
  RETURN _cashier_create_rental(p_payload);
END;
$$;

CREATE OR REPLACE FUNCTION update_rental(p_rental_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_denied jsonb;
BEGIN
  v_denied := _rental_reject_miniapp_write(auth_organization_id(), p_rental_id);
  IF v_denied IS NOT NULL THEN
    RETURN v_denied;
  END IF;
  RETURN _cashier_update_rental(p_rental_id, p_payload);
END;
$$;

CREATE OR REPLACE FUNCTION cancel_rental(
  p_rental_id uuid,
  p_reason text,
  p_financial_action text DEFAULT 'none',
  p_penalty_amount numeric DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_denied jsonb;
BEGIN
  v_denied := _rental_reject_miniapp_write(auth_organization_id(), p_rental_id);
  IF v_denied IS NOT NULL THEN
    RETURN v_denied;
  END IF;
  RETURN _cashier_cancel_rental(
    p_rental_id, p_reason, p_financial_action, p_penalty_amount, p_idempotency_key
  );
END;
$$;

CREATE OR REPLACE FUNCTION apply_rental_pricing_adjustment(
  p_rental_id uuid,
  p_new_amount numeric,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_denied jsonb;
BEGIN
  v_denied := _rental_reject_miniapp_write(auth_organization_id(), p_rental_id);
  IF v_denied IS NOT NULL THEN
    RETURN v_denied;
  END IF;
  RETURN _cashier_apply_rental_pricing_adjustment(p_rental_id, p_new_amount, p_reason);
END;
$$;

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
  v_denied jsonb;
BEGIN
  v_denied := _rental_reject_miniapp_write(auth_organization_id(), p_rental_id);
  IF v_denied IS NOT NULL THEN
    RETURN v_denied;
  END IF;
  RETURN _cashier_record_rental_payment(
    p_rental_id,
    p_amount,
    p_method,
    p_method_comment,
    p_idempotency_key,
    p_operation_date,
    p_fiscal_status,
    p_fiscal_receipt_number,
    p_fiscal_cash_register_id,
    p_fiscal_terminal_id,
    p_fiscal_acquiring_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION update_rental_series(
  p_series_id uuid,
  p_payload jsonb,
  p_scope text DEFAULT 'future'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_denied jsonb;
BEGIN
  IF _rental_payload_is_miniapp_channel(p_payload) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.miniappChannelForbidden');
  END IF;
  v_denied := _rental_reject_miniapp_series_write(auth_organization_id(), p_series_id);
  IF v_denied IS NOT NULL THEN
    RETURN v_denied;
  END IF;
  RETURN _cashier_update_rental_series(p_series_id, p_payload, p_scope);
END;
$$;

CREATE OR REPLACE FUNCTION cancel_rental_series_occurrence(
  p_series_id uuid,
  p_date date,
  p_reason text,
  p_financial_action text DEFAULT 'none',
  p_penalty_amount numeric DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_denied jsonb;
BEGIN
  v_denied := _rental_reject_miniapp_series_write(auth_organization_id(), p_series_id);
  IF v_denied IS NOT NULL THEN
    RETURN v_denied;
  END IF;
  RETURN _cashier_cancel_rental_series_occurrence(
    p_series_id, p_date, p_reason, p_financial_action, p_penalty_amount, p_idempotency_key
  );
END;
$$;

REVOKE ALL ON FUNCTION _cashier_create_rental(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _cashier_update_rental(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _cashier_cancel_rental(uuid, text, text, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _cashier_apply_rental_pricing_adjustment(uuid, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _cashier_record_rental_payment(uuid, numeric, text, text, text, date, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _cashier_update_rental_series(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _cashier_cancel_rental_series_occurrence(uuid, date, text, text, numeric, text) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION create_rental(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_rental(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION update_rental(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_rental(uuid, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION cancel_rental(uuid, text, text, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_rental(uuid, text, text, numeric, text) TO authenticated;

REVOKE ALL ON FUNCTION apply_rental_pricing_adjustment(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_rental_pricing_adjustment(uuid, numeric, text) TO authenticated;

REVOKE ALL ON FUNCTION record_rental_payment(uuid, numeric, text, text, text, date, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_rental_payment(uuid, numeric, text, text, text, date, text, text, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION update_rental_series(uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_rental_series(uuid, jsonb, text) TO authenticated;

REVOKE ALL ON FUNCTION cancel_rental_series_occurrence(uuid, date, text, text, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_rental_series_occurrence(uuid, date, text, text, numeric, text) TO authenticated;

COMMIT;
