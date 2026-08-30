-- R5 follow-up: apply penalty tariff before cancelling futures (rate check needs live slots).

BEGIN;

CREATE OR REPLACE FUNCTION _renter_apply_booking_ban(p_org_id uuid, p_renter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r renters%ROWTYPE;
  v_first boolean;
BEGIN
  SELECT * INTO v_r
  FROM renters
  WHERE id = p_renter_id
    AND organization_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_first := v_r.booking_banned_at IS NULL;

  IF v_first THEN
    UPDATE renters
    SET booking_banned_at = now(), updated_at = now()
    WHERE id = p_renter_id
      AND organization_id = p_org_id;

    IF v_r.auth_user_id IS NOT NULL THEN
      PERFORM revoke_auth_sessions_for_user(v_r.auth_user_id);
    END IF;
  END IF;

  PERFORM _renter_try_apply_penalty_tariff(p_org_id, p_renter_id);

  IF v_first THEN
    PERFORM _renter_cancel_future_miniapp_for_ban(p_org_id, p_renter_id);
    PERFORM _renter_enqueue_booking_banned(p_org_id, p_renter_id);
  END IF;
END;
$$;

COMMIT;
