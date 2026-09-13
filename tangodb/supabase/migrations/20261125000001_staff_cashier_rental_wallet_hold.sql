-- Staff cashier create for a Mini App renter (telegram_id) with enough
-- wallet to cover 50% prepay: promote the slot to channel=miniapp so FIFO
-- reserves the hold and the booking worker charges remainder at time_end.
-- Do not promote unpaid cashier slots that cannot activate — they would
-- become awaiting_payment and auto-delete. Accountant cashier create stays cashier.

CREATE OR REPLACE FUNCTION _renter_cashier_rental_wallet_eligible(p_rental_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r rentals%ROWTYPE;
  v_cost numeric;
BEGIN
  SELECT * INTO v_r FROM rentals WHERE id = p_rental_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_r.channel IS DISTINCT FROM 'cashier' OR v_r.lifecycle IS NOT NULL THEN
    RETURN false;
  END IF;
  IF v_r.booking_status IS DISTINCT FROM 'confirmed' THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM renters rt
    WHERE rt.id = v_r.renter_id
      AND rt.organization_id = v_r.organization_id
      AND rt.telegram_id IS NOT NULL
  ) THEN
    RETURN false;
  END IF;
  IF _rental_paid_total(v_r.id, v_r.organization_id) > 0 THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM rental_invoice_lines l
    WHERE l.organization_id = v_r.organization_id
      AND l.rental_id = v_r.id
  ) THEN
    RETURN false;
  END IF;
  v_cost := COALESCE(_rental_effective_amount(v_r.fixed_amount, v_r.final_amount), 0);
  IF v_cost <= 0 THEN
    RETURN false;
  END IF;
  IF _renter_slot_ts(v_r.organization_id, v_r.rental_date, v_r.time_end) <= now() THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_promote_cashier_rental_to_miniapp(p_rental_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r rentals%ROWTYPE;
  v_cost numeric;
  v_currency text;
  v_prepay numeric;
  v_remainder numeric;
  v_start timestamptz;
BEGIN
  SELECT * INTO v_r FROM rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF NOT _renter_cashier_rental_wallet_eligible(p_rental_id) THEN
    RETURN false;
  END IF;

  v_cost := _rental_effective_amount(v_r.fixed_amount, v_r.final_amount);
  v_currency := COALESCE(NULLIF(v_r.currency, ''), _renter_org_currency(v_r.organization_id));
  v_prepay := _renter_round_money(v_cost / 2, v_currency);
  v_remainder := v_cost - v_prepay;
  v_start := _renter_slot_ts(v_r.organization_id, v_r.rental_date, v_r.time_start);

  UPDATE rentals
  SET
    channel = 'miniapp',
    lifecycle = 'awaiting_payment',
    fixed_amount = v_cost,
    final_amount = NULL,
    prepay_amount = v_prepay,
    remainder_amount = v_remainder,
    debt_amount = 0,
    hold_expires_at = _renter_compute_hold_expires_at(COALESCE(created_at, now()), v_start),
    updated_at = now()
  WHERE id = p_rental_id
    AND channel = 'cashier'
    AND lifecycle IS NULL;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_attach_wallet_to_staff_cashier_rentals(p_rental_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_org uuid;
  v_renter uuid;
  v_sorted uuid[];
  v_r rentals%ROWTYPE;
  v_cost numeric;
  v_currency text;
  v_prepay numeric;
BEGIN
  IF p_rental_ids IS NULL OR coalesce(array_length(p_rental_ids, 1), 0) = 0 THEN
    RETURN;
  END IF;

  SELECT r.organization_id, r.renter_id
  INTO v_org, v_renter
  FROM rentals r
  WHERE r.id = p_rental_ids[1];

  IF v_org IS NULL OR v_renter IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(_renter_wallet_lock_key(v_org, v_renter));

  SELECT COALESCE(array_agg(r.id ORDER BY r.rental_date, r.time_start, r.created_at), '{}')
  INTO v_sorted
  FROM unnest(p_rental_ids) AS x(id)
  JOIN rentals r ON r.id = x.id
  WHERE r.organization_id = v_org
    AND r.renter_id = v_renter
    AND _renter_cashier_rental_wallet_eligible(r.id);

  IF v_sorted IS NULL OR coalesce(array_length(v_sorted, 1), 0) = 0 THEN
    RETURN;
  END IF;

  FOREACH v_id IN ARRAY v_sorted
  LOOP
    SELECT * INTO v_r FROM rentals WHERE id = v_id;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;
    v_cost := _rental_effective_amount(v_r.fixed_amount, v_r.final_amount);
    v_currency := COALESCE(NULLIF(v_r.currency, ''), _renter_org_currency(v_org));
    v_prepay := _renter_round_money(v_cost / 2, v_currency);
    IF _renter_wallet_available(v_org, v_renter) < v_prepay THEN
      CONTINUE;
    END IF;
    IF _renter_promote_cashier_rental_to_miniapp(v_id) THEN
      PERFORM _renter_apply_wallet(v_org, v_renter);
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_attach_wallet_to_staff_cashier_rental(p_rental_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_rental_id IS NULL THEN
    RETURN;
  END IF;
  PERFORM _renter_attach_wallet_to_staff_cashier_rentals(ARRAY[p_rental_id]);
END;
$$;

CREATE OR REPLACE FUNCTION create_rental(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_result jsonb;
  v_rental_id uuid;
BEGIN
  IF _rental_payload_is_miniapp_channel(p_payload) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.miniappChannelForbidden');
  END IF;

  v_result := _cashier_create_rental(p_payload);
  IF COALESCE((v_result ->> 'success')::boolean, false)
     AND member_can_manage_rentals() THEN
    v_rental_id := NULLIF(v_result ->> 'rental_id', '')::uuid;
    IF v_rental_id IS NOT NULL THEN
      PERFORM _renter_attach_wallet_to_staff_cashier_rental(v_rental_id);
    END IF;
  END IF;

  RETURN v_result;
END;
$$;

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

      PERFORM _renter_attach_wallet_to_staff_cashier_rentals(v_created_ids);

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

  PERFORM _renter_attach_wallet_to_staff_cashier_rentals(v_created_ids);

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

-- Slot edit (2.11.17) may pass Mini App through update_rental; money RPCs must not.
CREATE OR REPLACE FUNCTION _rental_reject_miniapp_money_write(p_org_id uuid, p_rental_id uuid)
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
  v_denied := _rental_reject_miniapp_money_write(auth_organization_id(), p_rental_id);
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
  v_denied := _rental_reject_miniapp_money_write(auth_organization_id(), p_rental_id);
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
  v_denied := _rental_reject_miniapp_money_write(auth_organization_id(), p_rental_id);
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

REVOKE ALL ON FUNCTION _renter_cashier_rental_wallet_eligible(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_promote_cashier_rental_to_miniapp(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_attach_wallet_to_staff_cashier_rentals(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_attach_wallet_to_staff_cashier_rental(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _rental_reject_miniapp_money_write(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION _renter_cashier_rental_wallet_eligible(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_promote_cashier_rental_to_miniapp(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_attach_wallet_to_staff_cashier_rentals(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_attach_wallet_to_staff_cashier_rental(uuid) TO service_role;

REVOKE ALL ON FUNCTION create_rental(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_rental(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION create_rental_series(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_rental_series(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION cancel_rental(uuid, text, text, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_rental(uuid, text, text, numeric, text) TO authenticated;

REVOKE ALL ON FUNCTION apply_rental_pricing_adjustment(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_rental_pricing_adjustment(uuid, numeric, text) TO authenticated;

REVOKE ALL ON FUNCTION record_rental_payment(uuid, numeric, text, text, text, date, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_rental_payment(uuid, numeric, text, text, text, date, text, text, text, text, text) TO authenticated;

COMMENT ON FUNCTION _renter_attach_wallet_to_staff_cashier_rentals(uuid[]) IS
  'If Mini App renter has enough available wallet for 50% of unpaid cashier slots, promote to miniapp and FIFO-activate.';

DO $$
DECLARE
  v_renter uuid;
  v_ids uuid[];
BEGIN
  FOR v_renter IN
    SELECT DISTINCT r.renter_id
    FROM rentals r
    JOIN renters rt
      ON rt.id = r.renter_id
     AND rt.organization_id = r.organization_id
    WHERE r.channel = 'cashier'
      AND r.booking_status = 'confirmed'
      AND rt.telegram_id IS NOT NULL
  LOOP
    SELECT COALESCE(array_agg(r.id), '{}')
    INTO v_ids
    FROM rentals r
    WHERE r.renter_id = v_renter
      AND r.channel = 'cashier'
      AND r.booking_status = 'confirmed';
    PERFORM _renter_attach_wallet_to_staff_cashier_rentals(v_ids);
  END LOOP;
END;
$$;
