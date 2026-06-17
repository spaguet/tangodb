-- TangoDB v2 Phase 1A (A-3): auth helpers, active org RPC, JWT hook

-- =============================================================================
-- 1. JWT / membership helpers (STABLE, fixed search_path)
-- =============================================================================

CREATE OR REPLACE FUNCTION auth_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT auth.uid();
$$;

CREATE OR REPLACE FUNCTION auth_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::jsonb ->> 'organization_id',
    ''
  )::uuid;
$$;

CREATE OR REPLACE FUNCTION auth_member_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::jsonb ->> 'member_id',
    ''
  )::uuid;
$$;

CREATE OR REPLACE FUNCTION auth_member_role()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::jsonb ->> 'role',
    ''
  );
$$;

CREATE OR REPLACE FUNCTION auth_platform_role()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::jsonb ->> 'platform_role',
    ''
  );
$$;

CREATE OR REPLACE FUNCTION is_active_member(p_user_id uuid, p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organization_members om
    WHERE om.user_id = p_user_id
      AND om.organization_id = p_org_id
      AND om.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION auth_is_member_of(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT is_active_member(auth.uid(), p_org_id);
$$;

CREATE OR REPLACE FUNCTION member_role(p_user_id uuid, p_org_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT om.role
  FROM organization_members om
  WHERE om.user_id = p_user_id
    AND om.organization_id = p_org_id
    AND om.is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION member_scope(p_user_id uuid, p_org_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT om.scope
  FROM organization_members om
  WHERE om.user_id = p_user_id
    AND om.organization_id = p_org_id
    AND om.is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION organization_allows_reads(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organizations o
    WHERE o.id = p_org_id
      AND o.status IN ('demo_active', 'demo_retention', 'licensed')
  );
$$;

CREATE OR REPLACE FUNCTION organization_allows_writes(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organizations o
    WHERE o.id = p_org_id
      AND o.status IN ('demo_active', 'licensed')
      AND NOT o.schema_version_locked
  );
$$;

CREATE OR REPLACE FUNCTION can_manage_settings()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT auth_member_role() IN ('owner', 'director', 'admin');
$$;

CREATE OR REPLACE FUNCTION can_manage_team()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT auth_member_role() IN ('owner', 'director', 'admin');
$$;

-- =============================================================================
-- 2. Set active organization (server-side tenant selection)
-- =============================================================================

CREATE OR REPLACE FUNCTION set_active_organization(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_member_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT om.id
  INTO v_member_id
  FROM organization_members om
  WHERE om.user_id = v_user_id
    AND om.organization_id = p_organization_id
    AND om.is_active = true;

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'not an active member of organization';
  END IF;

  INSERT INTO user_active_organizations (user_id, organization_id, member_id, updated_at)
  VALUES (v_user_id, p_organization_id, v_member_id, now())
  ON CONFLICT (user_id) DO UPDATE
    SET organization_id = EXCLUDED.organization_id,
        member_id = EXCLUDED.member_id,
        updated_at = EXCLUDED.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION set_active_organization(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_active_organization(uuid) TO authenticated;

-- =============================================================================
-- 3. Custom Access Token Hook (org claims from user_active_organizations)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  claims jsonb;
  tgid text;
  v_user_id uuid;
  v_org_id uuid;
  v_member_id uuid;
  v_role text;
BEGIN
  claims := event -> 'claims';
  v_user_id := (claims ->> 'sub')::uuid;

  tgid := claims -> 'app_metadata' ->> 'telegram_id';
  IF tgid IS NOT NULL AND tgid <> '' THEN
    claims := jsonb_set(claims, '{telegram_id}', to_jsonb(tgid));
  END IF;

  SELECT uao.organization_id, uao.member_id, om.role
  INTO v_org_id, v_member_id, v_role
  FROM user_active_organizations uao
  JOIN organization_members om ON om.id = uao.member_id
  WHERE uao.user_id = v_user_id
    AND om.is_active = true;

  IF v_org_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{organization_id}', to_jsonb(v_org_id::text));
    claims := jsonb_set(claims, '{member_id}', to_jsonb(v_member_id::text));
    claims := jsonb_set(claims, '{role}', to_jsonb(v_role));
  END IF;

  RETURN jsonb_build_object('claims', claims);
END;
$$;

GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, PUBLIC;
