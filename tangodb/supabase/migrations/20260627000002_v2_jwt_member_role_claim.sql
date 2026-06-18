-- Fix JWT hook: member role must not overwrite Supabase "role" claim (authenticated/anon).
-- PostgREST uses top-level JWT "role" as the PostgreSQL session role.

CREATE OR REPLACE FUNCTION auth_member_role()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'member_role', ''),
    CASE
      WHEN NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') IN (
        'owner', 'director', 'admin', 'teacher', 'accountant'
      )
      THEN NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '')
      ELSE NULL
    END
  );
$$;

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  claims jsonb;
  tgid text;
  platform_role text;
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

  platform_role := claims -> 'app_metadata' ->> 'platform_role';
  IF platform_role IS NOT NULL AND platform_role <> '' THEN
    claims := jsonb_set(claims, '{platform_role}', to_jsonb(platform_role));
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
    claims := jsonb_set(claims, '{member_role}', to_jsonb(v_role));
  END IF;

  RETURN jsonb_build_object('claims', claims);
END;
$$;
