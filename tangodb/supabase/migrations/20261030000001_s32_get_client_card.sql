-- S32 follow-up: teacher client card still needs phone/telegram/email/guardians.
-- Bulk GET /clients stays closed (no teacher SELECT on base). One-id RPC only.

BEGIN;

CREATE OR REPLACE FUNCTION get_client_card(p_client_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_row clients%ROWTYPE;
  v_allowed boolean := false;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL OR p_client_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  IF NOT business_row_readable() THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  SELECT *
  INTO v_row
  FROM clients c
  WHERE c.id = p_client_id
    AND c.organization_id = v_org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'not_found');
  END IF;

  IF can_read_all_business() THEN
    v_allowed := true;
  ELSIF current_member_role() = 'teacher' AND teacher_can_access_client(p_client_id) THEN
    v_allowed := true;
  END IF;

  IF NOT v_allowed THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'client', jsonb_build_object(
      'id', v_row.id,
      'organization_id', v_row.organization_id,
      'first_name', v_row.first_name,
      'last_name', v_row.last_name,
      'phone', v_row.phone,
      'telegram', v_row.telegram,
      'email', v_row.email,
      'is_minor', v_row.is_minor,
      'guardian1_name', v_row.guardian1_name,
      'guardian1_phone', v_row.guardian1_phone,
      'guardian1_telegram', v_row.guardian1_telegram,
      'guardian1_address', v_row.guardian1_address,
      'guardian2_name', v_row.guardian2_name,
      'guardian2_phone', v_row.guardian2_phone,
      'guardian2_telegram', v_row.guardian2_telegram,
      'guardian2_address', v_row.guardian2_address,
      'archived_at', v_row.archived_at,
      'created_at', v_row.created_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION get_client_card(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_client_card(uuid) TO authenticated, service_role;

COMMIT;
