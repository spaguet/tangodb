-- H31 / S03: ignore client p_actor_user_id spoof; PostgREST cannot call migrate_organization_version.
-- Dev Console Edge (service_role) passes p_actor_user_id when auth.uid() is NULL.

CREATE OR REPLACE FUNCTION migrate_organization_version(
  p_organization_id uuid,
  p_target_version_id uuid,
  p_dry_run boolean DEFAULT false,
  p_actor_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid;
  v_org organizations%ROWTYPE;
  v_from_version crm_product_versions%ROWTYPE;
  v_to_version crm_product_versions%ROWTYPE;
  v_migration_id uuid;
  v_script_result jsonb;
  v_restore_status text;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    v_actor := auth.uid();
  ELSE
    v_actor := p_actor_user_id;
  END IF;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'actor required' USING ERRCODE = '42501';
  END IF;

  IF NOT is_platform_developer(v_actor) AND auth_platform_role() IS DISTINCT FROM 'developer' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization not found' USING ERRCODE = '22023';
  END IF;

  IF v_org.schema_version_locked THEN
    RAISE EXCEPTION 'organization migration already in progress' USING ERRCODE = '22023';
  END IF;

  IF v_org.status NOT IN ('licensed', 'demo_active', 'demo_retention') THEN
    RAISE EXCEPTION 'organization status % does not allow migration', v_org.status
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_from_version FROM crm_product_versions WHERE id = v_org.crm_version_id;
  SELECT * INTO v_to_version FROM crm_product_versions WHERE id = p_target_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'target version not found' USING ERRCODE = '22023';
  END IF;

  IF v_from_version.id = v_to_version.id THEN
    RAISE EXCEPTION 'organization already on target version' USING ERRCODE = '22023';
  END IF;

  v_restore_status := v_org.status;

  INSERT INTO organization_version_migrations (
    organization_id,
    from_version_id,
    to_version_id,
    status,
    dry_run,
    initiated_by,
    previous_status,
    metadata
  )
  VALUES (
    p_organization_id,
    v_from_version.id,
    v_to_version.id,
    'running',
    p_dry_run,
    v_actor,
    v_restore_status,
    jsonb_build_object(
      'from_code', v_from_version.code,
      'to_code', v_to_version.code,
      'from_schema_version', v_from_version.schema_version,
      'to_schema_version', v_to_version.schema_version
    )
  )
  RETURNING id INTO v_migration_id;

  IF p_dry_run THEN
    v_script_result := execute_version_migration_script(
      p_organization_id,
      v_from_version.code,
      v_to_version.code,
      true
    );

    UPDATE organization_version_migrations
    SET status = 'completed',
        completed_at = now(),
        metadata = metadata || jsonb_build_object('dry_run_result', v_script_result)
    WHERE id = v_migration_id;

    RETURN jsonb_build_object(
      'ok', true,
      'dry_run', true,
      'migration_id', v_migration_id,
      'from_version', v_from_version.code,
      'to_version', v_to_version.code,
      'preview', v_script_result
    );
  END IF;

  UPDATE organizations
  SET schema_version_locked = true,
      status = 'suspended'
  WHERE id = p_organization_id;

  v_script_result := execute_version_migration_script(
    p_organization_id,
    v_from_version.code,
    v_to_version.code,
    false
  );

  UPDATE organizations
  SET crm_version_id = v_to_version.id,
      schema_version_locked = false,
      status = 'licensed'
  WHERE id = p_organization_id;

  UPDATE organization_licenses
  SET crm_version_id = v_to_version.id
  WHERE organization_id = p_organization_id;

  UPDATE organization_version_migrations
  SET status = 'completed',
      completed_at = now(),
      metadata = metadata || jsonb_build_object('script_result', v_script_result)
  WHERE id = v_migration_id;

  INSERT INTO platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  VALUES (
    v_actor,
    'org.version_migrate',
    'organization',
    p_organization_id,
    jsonb_build_object(
      'migration_id', v_migration_id,
      'from_code', v_from_version.code,
      'to_code', v_to_version.code,
      'dry_run', false
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', false,
    'migration_id', v_migration_id,
    'from_version', v_from_version.code,
    'to_version', v_to_version.code,
    'app_url', v_to_version.app_url,
    'result', v_script_result
  );

EXCEPTION
  WHEN OTHERS THEN
    IF v_migration_id IS NOT NULL THEN
      UPDATE organization_version_migrations
      SET status = 'failed',
          completed_at = now(),
          error_message = SQLERRM
      WHERE id = v_migration_id;
    END IF;

    UPDATE organizations
    SET schema_version_locked = false,
        status = coalesce(v_restore_status, status)
    WHERE id = p_organization_id
      AND schema_version_locked = true;

    RAISE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.migrate_organization_version(uuid, uuid, boolean, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.migrate_organization_version(uuid, uuid, boolean, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.migrate_organization_version(uuid, uuid, boolean, uuid) FROM authenticated;
