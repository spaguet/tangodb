-- TangoDB v2 Phase 5 (F-1): organization_version_migrations + migrate_organization_version RPC
-- Depends on: 20260625000001_version_migration_scripts.sql

-- =============================================================================
-- 1. Audit table
-- =============================================================================

CREATE TABLE organization_version_migrations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  from_version_id   UUID NOT NULL REFERENCES crm_product_versions (id),
  to_version_id     UUID NOT NULL REFERENCES crm_product_versions (id),
  status            TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'rolled_back')),
  dry_run           BOOLEAN NOT NULL DEFAULT false,
  initiated_by      UUID REFERENCES auth.users (id),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  error_message     TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  previous_status   TEXT,
  CONSTRAINT organization_version_migrations_distinct_versions
    CHECK (from_version_id <> to_version_id)
);

CREATE INDEX idx_org_version_migrations_org
  ON organization_version_migrations (organization_id, started_at DESC);

CREATE INDEX idx_org_version_migrations_status
  ON organization_version_migrations (status)
  WHERE status IN ('pending', 'running');

-- =============================================================================
-- 2. Developer-only helper
-- =============================================================================

CREATE OR REPLACE FUNCTION is_platform_developer(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    WHERE u.id = p_user_id
      AND u.raw_app_meta_data ->> 'platform_role' = 'developer'
  );
$$;

-- =============================================================================
-- 3. Migration path dispatcher
-- =============================================================================

CREATE OR REPLACE FUNCTION execute_version_migration_script(
  p_organization_id uuid,
  p_from_code text,
  p_to_code text,
  p_dry_run boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_from_code = 'v2' AND p_to_code = 'v3' THEN
    v_result := run_version_migration_v2_to_v3(p_organization_id, p_dry_run);
  ELSIF p_from_code = 'v3' AND p_to_code = 'v2' THEN
    v_result := run_version_migration_v3_to_v2(p_organization_id, p_dry_run);
  ELSE
    RAISE EXCEPTION 'unsupported migration path % -> %', p_from_code, p_to_code
      USING ERRCODE = '22023';
  END IF;

  RETURN v_result;
END;
$$;

-- =============================================================================
-- 4. Core RPC: migrate_organization_version
-- =============================================================================

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
  v_actor uuid := coalesce(p_actor_user_id, auth.uid());
  v_org organizations%ROWTYPE;
  v_from_version crm_product_versions%ROWTYPE;
  v_to_version crm_product_versions%ROWTYPE;
  v_migration_id uuid;
  v_script_result jsonb;
  v_restore_status text;
BEGIN
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

-- =============================================================================
-- 5. RLS
-- =============================================================================

ALTER TABLE organization_version_migrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY organization_version_migrations_select_developer
  ON organization_version_migrations FOR SELECT
  TO authenticated
  USING (auth_platform_role() = 'developer');

CREATE POLICY organization_version_migrations_select_member
  ON organization_version_migrations FOR SELECT
  TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND is_active_member(auth.uid(), organization_id)
  );

GRANT SELECT ON organization_version_migrations TO authenticated;
GRANT ALL ON organization_version_migrations TO service_role;

GRANT EXECUTE ON FUNCTION migrate_organization_version(uuid, uuid, boolean, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION migrate_organization_version(uuid, uuid, boolean, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION is_platform_developer(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION execute_version_migration_script(uuid, text, text, boolean) TO service_role;
