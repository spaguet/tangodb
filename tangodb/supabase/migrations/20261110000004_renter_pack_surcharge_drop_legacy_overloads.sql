-- Drop legacy 1-arg overloads that still auto-applied surcharge.
-- Single-arg calls must resolve to (uuid, text DEFAULT 'incremental').

BEGIN;

DROP FUNCTION IF EXISTS _renter_after_pack_slot_terminal(uuid);
DROP FUNCTION IF EXISTS _renter_early_close_pack(uuid);

CREATE OR REPLACE FUNCTION _renter_maybe_queue_pack_surcharge_review(
  p_series_id uuid,
  p_cancel_mode text DEFAULT 'incremental'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_series rental_series%ROWTYPE;
  v_used_weeks integer;
  v_preview jsonb;
  v_total numeric;
  v_currency text;
BEGIN
  IF p_series_id IS NULL OR p_cancel_mode NOT IN ('bulk_pack', 'ban') THEN
    RETURN;
  END IF;

  SELECT * INTO v_series FROM rental_series WHERE id = p_series_id;
  IF NOT FOUND OR v_series.channel <> 'miniapp' THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM rental_series_surcharge_reviews r
    WHERE r.rental_series_id = p_series_id
  ) THEN
    RETURN;
  END IF;

  v_used_weeks := _renter_pack_used_week_count(p_series_id);
  -- Queue only when used time falls in the first calendar week of the pack.
  IF v_used_weeks <> 1 THEN
    RETURN;
  END IF;

  v_preview := _renter_compute_pack_surcharge(p_series_id);
  v_total := COALESCE((v_preview ->> 'total')::numeric, 0);
  v_currency := COALESCE(v_preview ->> 'currency', _renter_org_currency(v_series.organization_id));

  IF v_total <= 0 THEN
    RETURN;
  END IF;

  INSERT INTO rental_series_surcharge_reviews (
    organization_id,
    rental_series_id,
    renter_id,
    status,
    suggested_amount,
    currency,
    cancel_mode,
    used_week_count,
    reason_code
  )
  VALUES (
    v_series.organization_id,
    p_series_id,
    v_series.renter_id,
    'pending',
    v_total,
    v_currency,
    p_cancel_mode,
    v_used_weeks,
    'week1_only_bulk_cancel'
  );
END;
$$;

REVOKE ALL ON FUNCTION _renter_early_close_pack(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_after_pack_slot_terminal(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _renter_early_close_pack(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_after_pack_slot_terminal(uuid, text) TO service_role;

COMMENT ON FUNCTION _renter_maybe_queue_pack_surcharge_review(uuid, text) IS
  'Queue staff review only for bulk/ban close with exactly one used pack week.';

COMMIT;
