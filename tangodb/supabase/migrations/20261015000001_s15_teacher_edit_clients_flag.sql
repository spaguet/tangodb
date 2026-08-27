-- S15 / H11: teachers_can_edit_clients enforced in SQL; teacher DELETE clients forbidden;
-- subscriptions UPDATE teacher WITH CHECK on client_id* (insurance if GRANT UPDATE restored after S08).

-- =============================================================================
-- 1. Scope helper vs org flag (was conflated in teacher_can_write_clients)
-- =============================================================================

CREATE OR REPLACE FUNCTION teacher_has_client_write_scope()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_scope jsonb := auth_teacher_scope();
BEGIN
  RETURN COALESCE((v_scope ->> 'can_view_all_clients')::boolean, false)
    OR COALESCE((v_scope ->> 'all_disciplines')::boolean, false)
    OR COALESCE((v_scope ->> 'all_locations')::boolean, false)
    OR COALESCE((v_scope ->> 'all_groups')::boolean, false)
    OR jsonb_array_length(COALESCE(v_scope -> 'discipline_ids', '[]'::jsonb)) > 0
    OR jsonb_array_length(COALESCE(v_scope -> 'location_ids', '[]'::jsonb)) > 0
    OR jsonb_array_length(COALESCE(v_scope -> 'schedule_group_ids', '[]'::jsonb)) > 0;
END;
$$;

CREATE OR REPLACE FUNCTION teacher_can_write_clients()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM organization_settings os
      WHERE os.organization_id = auth_organization_id()
        AND os.teachers_can_edit_clients = true
    )
    AND teacher_has_client_write_scope();
$$;

GRANT EXECUTE ON FUNCTION teacher_has_client_write_scope() TO authenticated, service_role;

-- =============================================================================
-- 2. clients: teacher INSERT/UPDATE require org flag; DELETE forbidden
-- =============================================================================

DROP POLICY IF EXISTS clients_update_teacher ON clients;

CREATE POLICY clients_update_teacher
  ON clients FOR UPDATE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_write_clients()
    AND teacher_can_access_client(id)
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_write_clients()
    AND teacher_can_access_client(id)
  );

DROP POLICY IF EXISTS clients_delete_teacher ON clients;

-- =============================================================================
-- 3. subscriptions UPDATE teacher: client_id* must be teacher-accessible (S08 keeps REVOKE UPDATE)
-- =============================================================================

CREATE OR REPLACE FUNCTION subscription_teacher_update_client_ids_valid(
  p_subscription_id uuid,
  p_client_id1 uuid,
  p_client_id2 uuid,
  p_client_id3 uuid,
  p_client_id4 uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF p_client_id1 IS NOT NULL AND NOT teacher_can_access_client(p_client_id1) THEN
    RETURN false;
  END IF;

  IF p_client_id2 IS NOT NULL AND NOT teacher_can_access_client(p_client_id2) THEN
    RETURN false;
  END IF;

  IF p_client_id3 IS NOT NULL AND NOT teacher_can_access_client(p_client_id3) THEN
    RETURN false;
  END IF;

  IF p_client_id4 IS NOT NULL AND NOT teacher_can_access_client(p_client_id4) THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM subscriptions s
    WHERE s.id = p_subscription_id
      AND s.organization_id = auth_organization_id()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION subscription_teacher_update_client_ids_valid(uuid, uuid, uuid, uuid, uuid)
  TO authenticated, service_role;

DROP POLICY IF EXISTS subscriptions_update_teacher ON subscriptions;

CREATE POLICY subscriptions_update_teacher
  ON subscriptions FOR UPDATE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_write_subscriptions()
    AND teacher_can_access_subscription(id)
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_write_subscriptions()
    AND teacher_can_access_subscription(id)
    AND subscription_teacher_update_client_ids_valid(
      id,
      client_id1,
      client_id2,
      client_id3,
      client_id4
    )
  );
