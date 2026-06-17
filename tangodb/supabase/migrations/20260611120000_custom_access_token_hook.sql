-- Adds telegram_id claim to JWT from app_metadata (required for auth_telegram_id() RLS)
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claims jsonb;
  tgid text;
BEGIN
  claims := event->'claims';
  tgid := claims->'app_metadata'->>'telegram_id';
  IF tgid IS NOT NULL AND tgid <> '' THEN
    claims := jsonb_set(claims, '{telegram_id}', to_jsonb(tgid));
  END IF;
  RETURN jsonb_build_object('claims', claims);
END;
$$;

GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;
