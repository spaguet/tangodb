-- Allow owner / director / admin (member_can_manage_rentals) to edit miniapp rental slots via update_rental.

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
    IF member_can_manage_rentals() THEN
      RETURN NULL;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.miniappChannelForbidden');
  END IF;

  RETURN NULL;
END;
$$;
