-- TangoDB v2 Phase 5 (F-2): version-specific migration scripts (v2 <-> v3)
-- Canonical copies also live in supabase/migrations/version_migrations/

-- Future v3 product version (stub for migration tooling; not current)
INSERT INTO crm_product_versions (code, name, schema_version, app_url, is_current, released_at)
VALUES ('v3', 'TangoDB CRM v3 (preview)', 3, 'https://v3.tangodb.vercel.app', false, now())
ON CONFLICT (code) DO NOTHING;

-- =============================================================================
-- v2 -> v3 (up)
-- Idempotent: safe to re-run; dry_run returns preview without mutating data.
-- =============================================================================

CREATE OR REPLACE FUNCTION run_version_migration_v2_to_v3(
  p_organization_id uuid,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_clients int;
  v_subscriptions int;
  v_disciplines int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM organizations o
    JOIN crm_product_versions cv ON cv.id = o.crm_version_id
    WHERE o.id = p_organization_id AND cv.code = 'v2'
  ) THEN
    RAISE EXCEPTION 'organization is not on v2' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_clients FROM clients WHERE organization_id = p_organization_id;
  SELECT count(*) INTO v_subscriptions FROM subscriptions WHERE organization_id = p_organization_id;
  SELECT count(*) INTO v_disciplines FROM disciplines WHERE organization_id = p_organization_id;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'direction', 'v2_to_v3',
      'dry_run', true,
      'would_transform', jsonb_build_object(
        'clients', v_clients,
        'subscriptions', v_subscriptions,
        'disciplines', v_disciplines
      ),
      'notes', 'No schema transform required in preview stub; version pointer update only'
    );
  END IF;

  -- Placeholder for future v2->v3 data transforms (idempotent)
  -- e.g. ALTER COLUMN, backfill new fields, etc.

  RETURN jsonb_build_object(
    'direction', 'v2_to_v3',
    'dry_run', false,
    'transformed', jsonb_build_object(
      'clients', v_clients,
      'subscriptions', v_subscriptions,
      'disciplines', v_disciplines
    )
  );
END;
$$;

-- =============================================================================
-- v3 -> v2 (down)
-- =============================================================================

CREATE OR REPLACE FUNCTION run_version_migration_v3_to_v2(
  p_organization_id uuid,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_clients int;
  v_subscriptions int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM organizations o
    JOIN crm_product_versions cv ON cv.id = o.crm_version_id
    WHERE o.id = p_organization_id AND cv.code = 'v3'
  ) THEN
    RAISE EXCEPTION 'organization is not on v3' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_clients FROM clients WHERE organization_id = p_organization_id;
  SELECT count(*) INTO v_subscriptions FROM subscriptions WHERE organization_id = p_organization_id;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'direction', 'v3_to_v2',
      'dry_run', true,
      'would_transform', jsonb_build_object(
        'clients', v_clients,
        'subscriptions', v_subscriptions
      ),
      'notes', 'Downgrade stub: validates counts; no destructive transform in preview'
    );
  END IF;

  RETURN jsonb_build_object(
    'direction', 'v3_to_v2',
    'dry_run', false,
    'transformed', jsonb_build_object(
      'clients', v_clients,
      'subscriptions', v_subscriptions
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION run_version_migration_v2_to_v3(uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION run_version_migration_v3_to_v2(uuid, boolean) TO service_role;
