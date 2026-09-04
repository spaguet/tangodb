-- FC5: read-only Mini App director dashboard aggregates (P1-12).
-- Separate miniapp KPIs; never mix cashier unpaid / rental register with miniapp debt or revenue.

BEGIN;

CREATE OR REPLACE FUNCTION get_renter_miniapp_dashboard_stats(p_year_month text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_role text := current_member_role();
  v_tz text;
  v_year_month text;
  v_month_start date;
  v_month_end date;
  v_addon_active boolean;
  v_revenue numeric;
  v_occupancy_slots integer;
  v_pending_count integer;
  v_pending_sla_breached integer;
  v_debt_total numeric;
  v_expiring_holds integer;
  v_topup_submitted integer;
  v_topup_confirmed integer;
  v_topup_rejected integer;
  v_topup_resolved integer;
  v_conversion numeric;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;

  IF v_role NOT IN ('owner', 'director') THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  v_tz := COALESCE(_org_timezone(v_org_id), 'UTC');
  v_year_month := COALESCE(NULLIF(trim(p_year_month), ''), to_char((now() AT TIME ZONE v_tz), 'YYYY-MM'));

  IF v_year_month !~ '^\d{4}-\d{2}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'dashboard.error.invalidYearMonth');
  END IF;

  v_month_start := to_date(v_year_month || '-01', 'YYYY-MM-DD');
  v_month_end := (v_month_start + interval '1 month' - interval '1 day')::date;

  v_addon_active := renter_miniapp_addon_is_active(v_org_id);

  IF NOT v_addon_active THEN
    RETURN jsonb_build_object(
      'success', true,
      'year_month', v_year_month,
      'addon_active', false,
      'miniapp', jsonb_build_object(
        'revenue', 0,
        'occupancy_slots', 0,
        'pending_count', 0,
        'pending_sla_breached', 0,
        'debt_total', 0,
        'expiring_holds', 0,
        'topup_submitted', 0,
        'topup_confirmed', 0,
        'topup_rejected', 0,
        'topup_conversion_rate', NULL
      )
    );
  END IF;

  SELECT COALESCE(sum(
    CASE
      WHEN l.entry_type = 'topup' THEN l.amount
      WHEN l.entry_type = 'topup_reversal' THEN -l.amount
      ELSE 0
    END
  ), 0)
  INTO v_revenue
  FROM renter_wallet_ledger l
  WHERE l.organization_id = v_org_id
    AND l.entry_type IN ('topup', 'topup_reversal')
    AND (l.created_at AT TIME ZONE v_tz)::date BETWEEN v_month_start AND v_month_end;

  SELECT count(*)::integer
  INTO v_occupancy_slots
  FROM rentals r
  WHERE r.organization_id = v_org_id
    AND r.channel = 'miniapp'
    AND r.booking_status = 'confirmed'
    AND r.rental_date BETWEEN v_month_start AND v_month_end;

  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE t.created_at < now() - interval '4 hours'
    )::integer
  INTO v_pending_count, v_pending_sla_breached
  FROM renter_topup_requests t
  WHERE t.organization_id = v_org_id
    AND t.status = 'pending';

  SELECT COALESCE(sum(_renter_wallet_debt_outstanding(v_org_id, r.id)), 0)
  INTO v_debt_total
  FROM renters r
  WHERE r.organization_id = v_org_id
    AND r.status = 'active';

  SELECT count(*)::integer
  INTO v_expiring_holds
  FROM rentals r
  WHERE r.organization_id = v_org_id
    AND r.channel = 'miniapp'
    AND r.lifecycle = 'awaiting_payment'
    AND r.hold_expires_at IS NOT NULL
    AND r.hold_expires_at > now()
    AND r.hold_expires_at <= now() + interval '24 hours';

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE t.status = 'confirmed')::integer,
    count(*) FILTER (WHERE t.status = 'rejected')::integer
  INTO v_topup_submitted, v_topup_confirmed, v_topup_rejected
  FROM renter_topup_requests t
  WHERE t.organization_id = v_org_id
    AND (t.created_at AT TIME ZONE v_tz)::date BETWEEN v_month_start AND v_month_end;

  v_topup_resolved := v_topup_confirmed + v_topup_rejected;
  v_conversion := CASE
    WHEN v_topup_resolved > 0 THEN round(v_topup_confirmed::numeric / v_topup_resolved, 4)
    ELSE NULL
  END;

  RETURN jsonb_build_object(
    'success', true,
    'year_month', v_year_month,
    'addon_active', true,
    'miniapp', jsonb_build_object(
      'revenue', v_revenue,
      'occupancy_slots', v_occupancy_slots,
      'pending_count', v_pending_count,
      'pending_sla_breached', v_pending_sla_breached,
      'debt_total', v_debt_total,
      'expiring_holds', v_expiring_holds,
      'topup_submitted', v_topup_submitted,
      'topup_confirmed', v_topup_confirmed,
      'topup_rejected', v_topup_rejected,
      'topup_conversion_rate', v_conversion
    )
  );
END;
$$;

COMMENT ON FUNCTION get_renter_miniapp_dashboard_stats(text) IS
  'FC5: owner/director read-only Mini App aggregates — wallet topup revenue, channel occupancy, pending SLA, miniapp debt, expiring holds, topup conversion. Never mixes cashier.';

REVOKE ALL ON FUNCTION get_renter_miniapp_dashboard_stats(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_renter_miniapp_dashboard_stats(text) TO authenticated, service_role;

COMMIT;
